import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { isValidBranchName, planAction, type ActionRequest } from "../../git/actions";
import { parseConflicts, resolveConflict, sideNames, type Resolution } from "../../git/conflicts";
import { discoverRepos, pathKey, repoForPath, repoLabel } from "../../git/discover";
import {
  findWorkspaceRepo,
  predictConflicts,
  readBranches,
  readCommitDetails,
  readRepo,
  readSummary,
} from "../../git/repo";
import { GitError, formatCommand, runGit } from "../../git/runner";
import { filesToCopy, newWorktreePath, withWorktreesExcluded, type WorktreeLocation } from "../../git/worktrees";
import type { HostToWebview, PulseState, WebviewToHost } from "../../shared/messages";
import type { Branch, CiStatus, PrState, RepoState, RepoSummary } from "../../shared/types";
import { COMMIT_LOG_FORMAT, parseCommitLog, prDraft } from "../../github/pr";
import { createPullRequest, newPullRequestUrl, readCi, readPullRequest, rerunFailedJobs } from "../../github/client";
import { openMergeEditor } from "../conflicts/mergeEditor";
import { guardCommit } from "../guards/commitGuard";
import { pickCleanup, pickOops } from "../oops/oops";
import { renderWebviewHtml } from "../webviewHtml";

const REFRESH_DELAY_MS = 400;
const FETCH_CHECK_MS = 30_000;
const SELECTED_KEY = "gitkit.selectedRepo";

export class PulseViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "gitkit.pulse";

  private view?: vscode.WebviewView;
  private repo?: RepoState;
  /** All repos found in the workspace; undefined until the first scan. */
  private roots?: string[];
  private selected?: string;
  private lastPosted = "";
  private refreshTimer?: NodeJS.Timeout;
  private refreshing = false;
  private refreshQueued = false;
  private busy = false;
  private fetching = false;
  private fetchError?: string;
  private ci: CiStatus | null = null;
  /** The branch's pull request, refreshed with CI. */
  private pr: PrState | null = null;
  private lastRepos: RepoSummary[] = [];
  private ciCheckedAt = 0;
  private ciInFlight?: Promise<void>;
  private lastFetchAttempt = 0;
  private readonly fetchTimer: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly panels = new Set<vscode.Webview>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: vscode.Memento,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const onChange = (uri: vscode.Uri) => {
      // Git writes lock files during its own operations; the final rename triggers another event anyway.
      if (uri.fsPath.endsWith(".lock")) return;
      // A new repo (git init, clone) appeared somewhere: look for repos again.
      if (path.basename(uri.fsPath) === ".git" || uri.fsPath.endsWith(path.join(".git", "HEAD")))
        this.roots = undefined;
      this.scheduleRefresh();
    };
    this.disposables.push(
      watcher,
      watcher.onDidChange(onChange),
      watcher.onDidCreate(onChange),
      watcher.onDidDelete(onChange),
      vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused) return;
        this.scheduleRefresh();
        void this.maybeAutoFetch();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.roots = undefined;
        this.scheduleRefresh();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("gitkit.mainBranchColor")) this.postConfig();
        if (!e.affectsConfiguration("gitkit.repoScanDepth")) return;
        this.roots = undefined;
        this.scheduleRefresh();
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.followEditor(editor)),
    );
    this.fetchTimer = setInterval(() => void this.maybeAutoFetch(), FETCH_CHECK_MS);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.lastPosted = "";
    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");

    view.webview.options = { enableScripts: true, localResourceRoots: [distUri] };
    view.webview.html = renderWebviewHtml(view.webview, distUri, "pulse");

    // Returning the promise lets tests await the handling; VS Code ignores it.
    view.webview.onDidReceiveMessage((message: WebviewToHost) => this.receive(message));
    view.onDidChangeVisibility(() => view.visible && this.scheduleRefresh());
    view.onDidDispose(() => (this.view = undefined));
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    clearInterval(this.fetchTimer);
    this.disposables.forEach((d) => d.dispose());
  }

  /** A full reload: rescans the workspace for repos, then reads everything again. */
  reload(): Promise<void> {
    this.roots = undefined;
    this.lastPosted = "";
    return this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    try {
      this.postState(await this.readState());
      void this.maybeAutoFetch();
      void this.maybeCheckCi();
    } finally {
      this.refreshing = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }

  private scheduleRefresh(): void {
    if (this.busy || !this.view?.visible) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), REFRESH_DELAY_MS);
  }

  private async readState(): Promise<PulseState> {
    const folders = workspaceFolders();
    if (folders.length === 0) return { kind: "no-folder" };
    try {
      if (!this.roots) await this.discover();
      const roots = this.roots ?? [];
      if (roots.length === 0) {
        this.repo = undefined;
        return { kind: "no-repo", folder: folders[0] };
      }
      const selected = this.pickSelected(roots);
      // Every other repo only gets a cheap status for its row; the full read is for the selected one.
      const [repo, repos] = await Promise.all([
        readRepo(selected),
        roots.length > 1 ? Promise.all(roots.map((r) => readSummary(r, repoLabel(r, folders)))) : [],
      ]);
      // CI belongs to a commit and a PR to a remote branch; drop them once there's no remote branch.
      if (repo.status.upstream === null) {
        this.ci = null;
        this.pr = null;
      }
      this.repo = this.withRemoteInfo(repo);
      this.lastRepos = repos;
      return { kind: "repo", repo: this.repo, repos };
    } catch (error) {
      return { kind: "error", message: describe(error) };
    }
  }

  private async discover(): Promise<void> {
    const depth = vscode.workspace.getConfiguration("gitkit").get<number>("repoScanDepth", 2);
    this.roots = await discoverRepos(workspaceFolders(), depth, findWorkspaceRepo);
  }

  /** Remembered choice if still valid, else the repo of the open file, else the first one found. */
  private pickSelected(roots: string[]): string {
    const has = (root: string | undefined) => !!root && roots.some((r) => pathKey(r) === pathKey(root));
    if (!has(this.selected)) {
      const remembered = this.state.get<string>(SELECTED_KEY);
      const editorFile = vscode.window.activeTextEditor?.document.uri;
      const fromEditor = editorFile?.scheme === "file" ? repoForPath(editorFile.fsPath, roots) : undefined;
      this.selected = has(remembered) ? remembered : (fromEditor ?? roots[0]);
    }
    return this.selected!;
  }

  private async select(root: string): Promise<void> {
    if (this.selected && pathKey(this.selected) === pathKey(root)) return;
    this.selected = root;
    void this.state.update(SELECTED_KEY, root);
    this.lastPosted = "";
    await this.refresh();
  }

  private followEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.uri.scheme !== "file" || !this.roots || this.roots.length < 2) return;
    if (!vscode.workspace.getConfiguration("gitkit").get<boolean>("followActiveEditor", true)) return;
    const root = repoForPath(editor.document.uri.fsPath, this.roots);
    if (root) void this.select(root);
  }

  /** Re-checks CI: every minute while checks run, every five minutes otherwise, only while focused. */
  private async maybeCheckCi(force = false, prompt = false): Promise<void> {
    if (this.ciInFlight) {
      if (!force) return;
      // An explicit request (like Sign in) waits for the background check, then runs its own.
      await this.ciInFlight.catch(() => {});
    }
    const repo = this.repo;
    if (!repo || !vscode.workspace.getConfiguration("gitkit").get<boolean>("ciStatus", true)) return;
    if (!force && (!vscode.window.state.focused || !this.view?.visible)) return;
    const interval = this.ci?.state === "pending" ? 60_000 : 300_000;
    // A push or fetch moved the remote branch: the old result is for an older commit.
    const upstreamSha = repo.graph.commits.find((c) =>
      c.refs.some((r) => r.kind === "remote" && r.name === repo.status.upstream),
    )?.hash;
    const moved = !!this.ci && !!upstreamSha && this.ci.sha !== upstreamSha;
    if (!force && !moved && Date.now() - this.ciCheckedAt < interval) return;

    this.ciInFlight = (async () => {
      try {
        // Offline or GitHub unreachable: hide the rows rather than nag.
        [this.ci, this.pr] = await Promise.all([
          readCi(repo, prompt).catch(() => null),
          readPullRequest(repo).catch(() => null),
        ]);
      } catch {
        this.ci = null;
        this.pr = null;
      } finally {
        this.ciCheckedAt = Date.now();
      }
    })();
    try {
      await this.ciInFlight;
    } finally {
      this.ciInFlight = undefined;
    }
    this.lastPosted = "";
    if (this.repo) {
      // Keep the host's own copy current too: actions like "Open a PR" read it.
      this.repo = this.withRemoteInfo(this.repo);
      this.postState({ kind: "repo", repo: this.repo, repos: this.lastRepos });
    }
  }

  /**
   * Keeps remote info fresh without being wasteful: only while the window is focused and the
   * view visible, at most once per interval, and never prompting for credentials.
   */
  private async maybeAutoFetch(): Promise<void> {
    const minutes = vscode.workspace.getConfiguration("gitkit").get<number>("autoFetchMinutes", 5);
    const repo = this.repo;
    if (minutes <= 0 || !repo || repo.remotes.length === 0) return;
    if (!vscode.window.state.focused || !this.view?.visible || this.busy || this.fetching) return;

    const now = Date.now() / 1000;
    const interval = minutes * 60;
    if (now - (repo.lastFetch ?? 0) < interval || now - this.lastFetchAttempt < interval) return;

    this.lastFetchAttempt = now;
    this.fetching = true;
    this.post({ type: "fetching", active: true });
    try {
      await runGit(["fetch", "--all", "--prune", "--quiet"], repo.root, { env: { GCM_INTERACTIVE: "never" } });
      this.fetchError = undefined;
    } catch (error) {
      this.fetchError = describe(error).split("\n")[0];
    } finally {
      this.fetching = false;
      this.post({ type: "fetching", active: false });
      await this.refresh();
    }
  }

  /** Handles a message from the sidebar or the Branch Map; both speak the same protocol. */
  async receive(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case "ready":
      case "refresh":
        this.postConfig();
        this.lastPosted = "";
        return this.refresh();
      case "openBranchMap":
        await vscode.commands.executeCommand("gitkit.openBranchMap");
        return;
      case "openFolder":
        await vscode.commands.executeCommand("vscode.openFolder");
        return;
      case "newWorktree":
        return this.newWorktree();
      case "openWorktree":
        return this.openWorktree(message.path, message.newWindow);
      case "initRepo": {
        const folder = workspaceFolders()[0];
        if (!folder) return;
        this.roots = undefined;
        await this.run("Initialize", [["init"]], folder);
        return;
      }
      case "selectRepo":
        return this.select(message.root);
      case "openFile":
        return this.openFile(message.path);
      case "action":
        return this.runAction(message.request);
      case "signInGitHub":
        return this.maybeCheckCi(true, true);
      case "openUrl":
        // Only web links: the URL comes from the webview, so never open other schemes from it.
        if (/^https:\/\//.test(message.url)) await vscode.env.openExternal(vscode.Uri.parse(message.url));
        return;
      case "createPr":
        return this.createPr();
      case "rerunFailed": {
        if (!this.repo || !this.ci?.runId) return;
        try {
          await rerunFailedJobs(this.repo, this.ci.runId);
          void vscode.window.setStatusBarMessage("GitKit: re-running failed jobs…", 3000);
          this.ci = { ...this.ci, state: "pending", summary: "Re-running failed jobs" };
          setTimeout(() => void this.maybeCheckCi(true), 10_000);
          this.lastPosted = "";
          await this.refresh();
        } catch (error) {
          this.post({ type: "error", error: { command: "", message: describe(error) } });
        }
        return;
      }
      case "oops":
        return this.oops();
      case "cleanupBranches":
        return this.cleanupBranches();
      case "pickBranch":
        return this.pickBranch();
      case "branchFrom": {
        const name = await askBranchName(`Create a branch at ${message.hash.slice(0, 7)}`);
        if (name) await this.runAction({ type: "createBranch", name, from: message.hash });
        return;
      }
      case "copyHash":
        await vscode.env.clipboard.writeText(message.hash);
        void vscode.window.setStatusBarMessage(`Copied ${message.hash.slice(0, 7)}`, 2000);
        return;
      case "conflictDetails":
        return this.postConflicts(message.path);
      case "resolveConflict":
        return this.resolveConflict(message.path, message.block, message.choice);
      case "openMergeEditor": {
        const repo = this.repo;
        if (!repo) return;
        const names = sideNames(repo.operation);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(repo.root, message.path)));
        const block = parseConflicts(document.getText())[0];
        await openMergeEditor(repo.root, message.path, {
          ours: names.ours,
          oursDetail: repo.operation === "rebase" ? (repo.base?.ref ?? "") : (repo.status.branch ?? "HEAD"),
          theirs: names.theirs,
          theirsDetail: block?.theirsLabel ?? "",
        });
        return;
      }
      case "commitDetails": {
        if (!this.repo) return;
        try {
          this.post({ type: "commitDetails", details: await readCommitDetails(this.repo.root, message.hash) });
        } catch (error) {
          this.post({ type: "error", error: { command: "", message: describe(error) } });
        }
        return;
      }
    }
  }

  private async postConflicts(relative: string): Promise<void> {
    if (!this.repo) return;
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(this.repo.root, relative)));
      this.post({ type: "conflictDetails", path: relative, blocks: parseConflicts(document.getText()) });
    } catch (error) {
      this.post({ type: "error", error: { command: "", message: `Couldn't read ${relative}: ${describe(error)}` } });
    }
  }

  /** Edits through the editor rather than the disk, so the change shows up in undo history. */
  private async resolveConflict(relative: string, block: number | "all", choice: Resolution): Promise<void> {
    if (!this.repo) return;
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(this.repo.root, relative)));
    const text = document.getText();
    const resolved = resolveConflict(text, block, choice);
    if (resolved !== text) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), resolved);
      await vscode.workspace.applyEdit(edit);
      await document.save();
    }
    await this.postConflicts(relative);
  }

  /** The repo the panel is showing, for features that open their own tabs. */
  get currentRepo(): RepoState | undefined {
    return this.repo;
  }

  /** For merges and rebases between branches: a test merge in memory, so the dialog can say what will happen. */
  private async mergeForecast(request: ActionRequest, root: string): Promise<string> {
    const pair =
      request.type === "mergeBranch"
        ? { ours: "HEAD", theirs: request.branch }
        : request.type === "switchAndMerge"
          ? { ours: request.target, theirs: request.source }
          : request.type === "rebaseOnto"
            ? { ours: request.branch, theirs: "HEAD" }
            : null;
    if (!pair) return "";
    const conflicts = await predictConflicts(root, pair.theirs, pair.ours).catch(() => null);
    if (conflicts === null) return "";
    return conflicts.length ? ` Expect conflicts in ${conflicts.join(", ")}.` : " It merges cleanly, no conflicts.";
  }

  /** The Oops menu: plain-English fixes for common mistakes. */
  async oops(): Promise<void> {
    if (!this.repo || this.busy) return;
    const request = await pickOops(this.repo);
    if (request) await this.runAction(request);
  }

  async cleanupBranches(): Promise<void> {
    const repo = this.repo;
    if (!repo || this.busy) return;
    if (!repo.base) {
      void vscode.window.showInformationMessage("GitKit couldn't find a main branch to compare with.");
      return;
    }
    const request = await pickCleanup(repo, repo.base.ref, repo.base.name);
    if (request) await this.runAction(request);
  }

  private async openFile(relative: string): Promise<void> {
    if (!this.repo) return;
    const uri = vscode.Uri.file(path.join(this.repo.root, relative));
    const file = this.repo.status.files.find((f) => f.path === relative);
    // Show the diff for tracked changes, like the built-in view; new and deleted files open (or fail) as plain files.
    if (file && !file.untracked && file.worktree !== "D") {
      try {
        await vscode.commands.executeCommand("git.openChange", uri);
        return;
      } catch {
        // The built-in git extension may be disabled; fall back to the file itself.
      }
    }
    await vscode.window.showTextDocument(uri);
  }

  private async pickBranch(): Promise<void> {
    if (!this.repo) return;
    const branches = await readBranches(this.repo.root);
    type Item = vscode.QuickPickItem & { branch?: string; create?: boolean; worktree?: string; newWorktree?: boolean };
    const elsewhere = new Map(
      this.repo.worktrees.filter((w) => w.branch && !w.current).map((w) => [w.branch!, w.path] as const),
    );
    const items: Item[] = [
      { label: "$(add) Create new branch…", create: true, alwaysShow: true },
      {
        label: "$(folder-library) New worktree…",
        description: "work on a branch in its own folder",
        newWorktree: true,
        alwaysShow: true,
      },
      { label: "Branches", kind: vscode.QuickPickItemKind.Separator },
      ...branches.map((b) => {
        const where = elsewhere.get(b.name);
        return where
          ? {
              label: `$(folder-opened) ${b.name}`,
              // Git won't check out a branch another worktree has; open that worktree instead.
              description: `open in a worktree: ${where}`,
              detail: b.subject,
              worktree: where,
            }
          : {
              label: `${b.current ? "$(check)" : "$(git-branch)"} ${b.name}`,
              description: describeTracking(b),
              detail: b.subject,
              branch: b.name,
            };
      }),
    ];
    const choice = await vscode.window.showQuickPick(items, {
      title: "Switch branch",
      placeHolder: "Pick a branch, or type to filter",
      matchOnDetail: true,
    });
    if (!choice) return;
    if (choice.create) {
      const name = await askBranchName("Create a new branch from the current commit");
      if (name) await this.runAction({ type: "createBranch", name });
    } else if (choice.newWorktree) {
      await this.newWorktree();
    } else if (choice.worktree) {
      await this.openWorktree(choice.worktree, true);
    } else if (choice.branch) {
      await this.runAction({ type: "switch", branch: choice.branch });
    }
  }

  /**
   * "New worktree": a branch (new, or an existing one no other worktree has), where a new branch
   * starts from, then one confirmation showing every command. After that, the listed ignored
   * files are copied over and the setup command runs in a terminal there, visibly.
   */
  async newWorktree(): Promise<void> {
    const repo = this.repo;
    if (!repo || this.busy) return;
    const mainRoot = repo.worktrees.find((w) => w.main)?.path ?? repo.root;
    const branch = (
      await vscode.window.showInputBox({
        title: "New worktree",
        prompt: "The branch to work on in it: a new name, or a branch that already exists",
        placeHolder: "agent/fix-login",
        validateInput: (v) => (isValidBranchName(v.trim()) ? undefined : "That isn't a valid branch name."),
      })
    )?.trim();
    if (!branch) return;

    const exists = await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo.root).then(
      () => true,
      () => false,
    );
    let from: string | undefined;
    if (!exists) {
      const starts: (vscode.QuickPickItem & { ref: string })[] = [];
      if (repo.base) {
        starts.push({ label: repo.base.ref, description: "the main branch, as of the last fetch", ref: repo.base.ref });
      }
      if (repo.status.branch && repo.status.branch !== repo.base?.name) {
        starts.push({ label: repo.status.branch, description: "the branch you're on", ref: repo.status.branch });
      }
      if (starts.length > 1) {
        const pick = await vscode.window.showQuickPick(starts, { title: `Start ${branch} from` });
        if (!pick) return;
        from = pick.ref;
      } else from = starts[0]?.ref;
    }

    const config = vscode.workspace.getConfiguration("gitkit");
    const location = config.get<WorktreeLocation>("worktrees.location", "sibling");
    const taken = new Set(repo.worktrees.map((w) => pathKey(w.path)));
    const target = newWorktreePath(mainRoot, branch, location, (p) => taken.has(pathKey(p)) || existsSync(p));
    const result = planAction({ type: "addWorktree", branch, path: target, newBranch: !exists, from }, repo);
    if (!result.ok) {
      this.post({ type: "error", error: { command: "", message: result.reason } });
      return;
    }

    const copies = filesToCopy(config.get<string[]>("worktrees.copyFiles", []), mainRoot, target, existsSync);
    const setup = config.get<string>("worktrees.setupCommand", "").trim();
    const then = [
      location === "inside"
        ? "add /.worktrees/ to .git/info/exclude (not .gitignore, so there's nothing to commit)"
        : "",
      copies.copy.length ? `copy ${copies.copy.map((c) => c.name).join(", ")} from the main checkout` : "",
      setup ? `run "${setup}" in a terminal there` : "",
    ].filter(Boolean);
    const skipped = copies.skipped.map((c) => `${c.name} (${c.why})`);
    const detail = [
      ...result.plan.steps.map(formatCommand),
      ...(then.length ? ["", `Then: ${then.join("; ")}.`] : []),
      ...(skipped.length ? ["", `Not copied: ${skipped.join(", ")}.`] : []),
    ].join("\n");
    const choice = await vscode.window.showInformationMessage(
      `Create a worktree for ${branch}${exists ? "" : ` (new, from ${from ?? "HEAD"})`} at ${target}?`,
      { modal: true, detail },
      "Create",
    );
    if (choice !== "Create") return;

    try {
      if (location === "inside") await this.excludeWorktreesFolder(repo.root);
    } catch (error) {
      this.post({
        type: "error",
        error: { command: "", message: `Couldn't update .git/info/exclude: ${describe(error)}` },
      });
      return;
    }
    if (!(await this.run(result.plan.label, result.plan.steps, repo.root))) return;

    for (const c of copies.copy) {
      try {
        cpSync(c.from, c.to, { recursive: true, force: false, errorOnExist: false });
      } catch (error) {
        this.post({ type: "error", error: { command: "", message: `Couldn't copy ${c.name}: ${describe(error)}` } });
      }
    }
    if (setup) {
      const terminal = vscode.window.createTerminal({ name: `Setup: ${path.basename(target)}`, cwd: target });
      terminal.show(true);
      terminal.sendText(setup);
    }
    const open = await vscode.window.showInformationMessage(
      `Created a worktree for ${branch}.`,
      "Open in New Window",
      "Add to This Window",
    );
    if (open) await this.openWorktree(target, open === "Open in New Window");
  }

  /** Keeps in-repo worktrees out of git status, without a change to .gitignore to commit. */
  private async excludeWorktreesFolder(root: string): Promise<void> {
    const out = (await runGit(["rev-parse", "--git-common-dir"], root)).stdout.trim();
    const file = path.join(path.resolve(root, out), "info", "exclude");
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const updated = withWorktreesExcluded(current);
    if (updated === null) return;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, updated);
  }

  /** After a worktree is removed: its branch can go too, if it's merged, and only if the user says so. */
  private async offerBranchCleanup(branch: string): Promise<void> {
    const repo = this.repo;
    if (!repo || branch === repo.status.branch || repo.worktrees.some((w) => w.branch === branch)) return;
    const base = repo.base?.ref ?? "main";
    const merged = await runGit(["branch", "--merged", base, "--list", branch], repo.root).then(
      (r) => r.stdout.trim() !== "",
      () => false,
    );
    if (!merged) return;
    const choice = await vscode.window.showInformationMessage(
      `Removed the worktree. ${branch} is merged into ${repo.base?.name ?? "main"}: delete the branch too?`,
      "Delete Branch",
    );
    if (choice !== "Delete Branch") return;
    const result = planAction({ type: "deleteBranches", names: [branch] }, repo);
    if (result.ok) await this.run("Delete branch", result.plan.steps, repo.root);
  }

  /**
   * Opens a worktree in a new window, or adds it to this one. Only paths git listed for this repo:
   * the path comes from the webview, which must never be able to open arbitrary folders.
   */
  private async openWorktree(path: string, newWindow: boolean): Promise<void> {
    const worktree = this.repo?.worktrees.find((w) => pathKey(w.path) === pathKey(path));
    if (!worktree || worktree.current) return;
    const uri = vscode.Uri.file(worktree.path);
    if (newWindow) {
      await vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
      return;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.some((f) => pathKey(f.uri.fsPath) === pathKey(worktree.path))) return;
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri });
  }

  /** What the extension knows about the remote besides git: fetch errors, CI and the PR. */
  private withRemoteInfo(repo: RepoState): RepoState {
    return { ...repo, fetchError: this.fetchError, ci: this.ci, pr: this.pr };
  }

  /**
   * Opens a pull request for the pushed branch: a title (pre-filled from the commits), then create,
   * create as draft, or finish it on GitHub's own page. Nothing is sent before the last choice.
   */
  private async createPr(): Promise<void> {
    const repo = this.repo;
    if (!repo) return;
    const pr = repo.pr;
    if (!repo.status.upstream || !repo.base || pr?.kind !== "none") {
      this.post({
        type: "error",
        error: { command: "", message: "Publish this branch first, then open a pull request for it." },
      });
      return;
    }
    const { head, base } = pr;
    const log = await runGit(["log", COMMIT_LOG_FORMAT, `${repo.base.ref}..@{upstream}`], repo.root).then(
      (r) => r.stdout,
      () => "",
    );
    const commits = parseCommitLog(log);
    if (commits.length === 0) {
      this.post({
        type: "error",
        error: {
          command: "",
          message: `${head} has no pushed commits that aren't on ${base} yet, so there's nothing to review.`,
        },
      });
      return;
    }
    const draft = prDraft(head, commits);
    const title = await vscode.window.showInputBox({
      title: "Pull request title",
      prompt: `${head} → ${base}, ${commits.length} commit${commits.length === 1 ? "" : "s"}`,
      value: draft.title,
      validateInput: (v) => (v.trim() ? undefined : "A pull request needs a title."),
    });
    if (title === undefined) return;

    const unpushed = repo.status.ahead;
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(git-pull-request-create) Create pull request",
          detail: `Asks GitHub to open a PR from ${head} into ${base}`,
          mode: "create",
        },
        {
          label: "$(git-pull-request-draft) Create as draft",
          detail: "Not ready for review yet; reviewers aren't notified",
          mode: "draft",
        },
        {
          label: "$(globe) Edit on GitHub first",
          detail: "Opens GitHub's page with the title and description filled in",
          mode: "web",
        },
      ] as const,
      {
        title: `Open a pull request: ${title}`,
        placeHolder: unpushed
          ? `${unpushed} local commit${unpushed === 1 ? " isn't" : "s aren't"} pushed and won't be included`
          : undefined,
      },
    );
    if (!choice) return;

    const filled = { title: title.trim(), body: draft.body };
    try {
      if (choice.mode === "web") {
        const url = await newPullRequestUrl(repo, base, filled);
        if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
        return;
      }
      const created = await createPullRequest(repo, { ...filled, base, draft: choice.mode === "draft" });
      void vscode.window
        .showInformationMessage(`Opened pull request #${created.number}.`, "Open on GitHub")
        .then((open) => open && vscode.env.openExternal(vscode.Uri.parse(created.url)));
      await this.maybeCheckCi(true);
    } catch (error) {
      this.post({ type: "error", error: { command: "", message: describe(error) } });
    }
  }

  private async runAction(request: ActionRequest): Promise<void> {
    if (!this.repo || this.busy) return;
    // Re-read first: the file watcher refreshes after a short delay, and an action clicked right
    // after an edit must not be planned from the state before it.
    this.repo = this.withRemoteInfo(await readRepo(this.repo.root));
    // Plan from the host's own state: never execute commands built by the webview.
    const result = planAction(request, this.repo);
    if (!result.ok) {
      this.post({ type: "error", error: { command: "", message: result.reason } });
      return;
    }
    const { plan } = result;
    if (plan.confirm) {
      const detail = plan.steps.map(formatCommand).join("\n");
      const forecast = await this.mergeForecast(request, this.repo.root);
      const choice = await vscode.window.showWarningMessage(
        plan.confirm + forecast,
        { modal: true, detail },
        plan.label,
      );
      if (choice !== plan.label) return;
    }
    let steps = plan.steps;
    if (request.type === "commit") {
      const guarded = await guardCommit(this.repo, plan);
      if (!guarded) return;
      steps = guarded;
    }
    const removed =
      request.type === "removeWorktree" ? this.repo.worktrees.find((w) => w.path === request.path) : undefined;
    const worked = await this.run(plan.label, steps, this.repo.root);
    if (worked && removed?.branch && removed.prunable === null) await this.offerBranchCleanup(removed.branch);
  }

  /** Runs the steps in order, stopping at the first failure; true when all of them worked. */
  private async run(label: string, steps: string[][], cwd: string): Promise<boolean> {
    this.busy = true;
    this.post({ type: "busy", label });
    let failed = false;
    try {
      for (const args of steps) {
        try {
          await runGit(args, cwd);
        } catch (error) {
          failed = true;
          this.post({ type: "error", error: { command: formatCommand(args), message: describe(error) } });
          break;
        }
      }
      if (!failed && steps.some((args) => args[0] === "fetch" || args[0] === "pull")) this.fetchError = undefined;
    } finally {
      this.busy = false;
      this.post({ type: "busy", label: null });
      await this.refresh();
    }
    return !failed;
  }

  /** Lets another webview (the Branch Map) receive the same live state as the sidebar. */
  attach(webview: vscode.Webview): vscode.Disposable {
    this.panels.add(webview);
    return new vscode.Disposable(() => this.panels.delete(webview));
  }

  private postState(state: PulseState): void {
    // Skip identical states so watcher-driven refreshes don't make the view flicker.
    const serialized = JSON.stringify(state);
    if (serialized === this.lastPosted) return;
    this.lastPosted = serialized;
    this.post({ type: "state", state });
  }

  private postConfig(): void {
    const color = vscode.workspace.getConfiguration("gitkit").get<string>("mainBranchColor", "blue");
    this.post({ type: "config", mainBranchColor: color });
  }

  private post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
    for (const panel of this.panels) void panel.postMessage(message);
  }
}

function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);
}

function describeTracking(branch: Branch): string {
  if (branch.gone) return "remote branch deleted";
  if (!branch.upstream) return "local only";
  const counts = [branch.ahead && `↑${branch.ahead}`, branch.behind && `↓${branch.behind}`].filter(Boolean);
  return counts.length ? `${counts.join(" ")}  ${branch.upstream}` : branch.upstream;
}

function askBranchName(title: string): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title,
    placeHolder: "feat/my-change",
    validateInput: (value) =>
      !value.trim() || isValidBranchName(value.trim()) ? undefined : "Not a valid branch name",
  });
}

function describe(error: unknown): string {
  if (error instanceof GitError) return error.stderr.trim() || error.message;
  return error instanceof Error ? error.message : String(error);
}
