import * as path from "node:path";
import * as vscode from "vscode";
import { isValidBranchName, planAction, type ActionRequest } from "../../git/actions";
import { discoverRepos, pathKey, repoForPath, repoLabel } from "../../git/discover";
import { findWorkspaceRepo, readBranches, readCommitDetails, readRepo, readSummary } from "../../git/repo";
import { GitError, formatCommand, runGit } from "../../git/runner";
import type { HostToWebview, PulseState, WebviewToHost } from "../../shared/messages";
import type { Branch, RepoState } from "../../shared/types";

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
  private lastFetchAttempt = 0;
  private readonly fetchTimer: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

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
    view.webview.html = renderHtml(view.webview, distUri);

    view.webview.onDidReceiveMessage((message: WebviewToHost) => void this.handle(message));
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
      this.repo = { ...repo, fetchError: this.fetchError };
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

  private select(root: string): void {
    if (this.selected && pathKey(this.selected) === pathKey(root)) return;
    this.selected = root;
    void this.state.update(SELECTED_KEY, root);
    this.lastPosted = "";
    void this.refresh();
  }

  private followEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.uri.scheme !== "file" || !this.roots || this.roots.length < 2) return;
    if (!vscode.workspace.getConfiguration("gitkit").get<boolean>("followActiveEditor", true)) return;
    const root = repoForPath(editor.document.uri.fsPath, this.roots);
    if (root) this.select(root);
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

  private async handle(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case "ready":
      case "refresh":
        this.lastPosted = "";
        return this.refresh();
      case "openFolder":
        await vscode.commands.executeCommand("vscode.openFolder");
        return;
      case "initRepo": {
        const folder = workspaceFolders()[0];
        if (!folder) return;
        this.roots = undefined;
        await this.run("Initialize", [["init"]], folder);
        return;
      }
      case "selectRepo":
        this.select(message.root);
        return;
      case "openFile":
        return this.openFile(message.path);
      case "action":
        return this.runAction(message.request);
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
    type Item = vscode.QuickPickItem & { branch?: string; create?: boolean };
    const items: Item[] = [
      { label: "$(add) Create new branch…", create: true, alwaysShow: true },
      { label: "Branches", kind: vscode.QuickPickItemKind.Separator },
      ...branches.map((b) => ({
        label: `${b.current ? "$(check)" : "$(git-branch)"} ${b.name}`,
        description: describeTracking(b),
        detail: b.subject,
        branch: b.name,
      })),
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
    } else if (choice.branch) {
      await this.runAction({ type: "switch", branch: choice.branch });
    }
  }

  private async runAction(request: ActionRequest): Promise<void> {
    if (!this.repo || this.busy) return;
    // Re-plan from the host's own state: never execute commands built by the webview.
    const result = planAction(request, this.repo);
    if (!result.ok) {
      this.post({ type: "error", error: { command: "", message: result.reason } });
      return;
    }
    const { plan } = result;
    if (plan.confirm) {
      const detail = plan.steps.map(formatCommand).join("\n");
      const choice = await vscode.window.showWarningMessage(plan.confirm, { modal: true, detail }, plan.label);
      if (choice !== plan.label) return;
    }
    await this.run(plan.label, plan.steps, this.repo.root);
  }

  private async run(label: string, steps: string[][], cwd: string): Promise<void> {
    this.busy = true;
    this.post({ type: "busy", label });
    try {
      let failed = false;
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
  }

  private postState(state: PulseState): void {
    // Skip identical states so watcher-driven refreshes don't make the view flicker.
    const serialized = JSON.stringify(state);
    if (serialized === this.lastPosted) return;
    this.lastPosted = serialized;
    this.post({ type: "state", state });
  }

  private post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
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

function renderHtml(webview: vscode.Webview, distUri: vscode.Uri): string {
  const nonce = createNonce();
  const script = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "pulse.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "pulse.css"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${style}" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
