import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";
import type { HostToStudio, StudioToHost, WorkflowFile } from "../../shared/messages";
import { suggestWorkflow, validate, type ProjectFacts, type WorkflowModel } from "../../workflow/model";
import { importWorkflow } from "../../workflow/import";
import { updateYaml } from "../../workflow/merge";
import { schemaProblems } from "../../workflow/schema";
import { explain, readModel, toYaml, workflowObject } from "../../workflow/yaml";
import { renderWebviewHtml } from "../webviewHtml";

/** "CI · on push, on pull requests · 3 jobs", or why the file couldn't be read. */
function summarize(text: string): string {
  const e = explain(text);
  if (e.error) return "Couldn't read this file";
  const jobs = `${e.jobs.length} job${e.jobs.length === 1 ? "" : "s"}`;
  return [e.name, e.triggers.slice(0, 2).join(", ") || "no triggers", jobs].join(" · ");
}

/** Workflow Studio: build GitHub Actions workflows visually, or read existing ones in plain English. */
export class WorkflowStudioPanel {
  private static current?: WorkflowStudioPanel;

  /** Opens Studio for the repo; with `file` (a name in .github/workflows), straight on that workflow. */
  static show(
    extensionUri: vscode.Uri,
    repo: { root: string; baseName: string | null } | undefined,
    file?: string,
  ): Promise<void> | void {
    if (!repo) {
      void vscode.window.showInformationMessage(
        "Open a git repository first; Workflow Studio saves into its .github/workflows folder.",
      );
      return;
    }
    const current = WorkflowStudioPanel.current;
    if (current && current.root === repo.root) {
      current.panel.reveal();
      if (file) return current.receive({ type: "open", file });
      return;
    }
    current?.panel.dispose();
    WorkflowStudioPanel.current = new WorkflowStudioPanel(extensionUri, repo.root, repo.baseName, file);
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    extensionUri: vscode.Uri,
    private readonly root: string,
    private readonly baseName: string | null,
    /** A workflow to open as soon as the webview is ready. */
    private pendingFile?: string,
  ) {
    const distUri = vscode.Uri.joinPath(extensionUri, "dist", "webview");
    this.panel = vscode.window.createWebviewPanel(
      "gitkit.workflowStudio",
      "Workflow Studio",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [distUri],
        retainContextWhenHidden: true,
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "tab.svg");
    this.panel.webview.html = renderWebviewHtml(this.panel.webview, distUri, "workflow");
    this.panel.webview.onDidReceiveMessage((message: StudioToHost) => this.receive(message));
    this.panel.onDidDispose(() => {
      if (WorkflowStudioPanel.current === this) WorkflowStudioPanel.current = undefined;
    });
  }

  private get workflowsDir(): string {
    return path.join(this.root, ".github", "workflows");
  }

  private post(message: HostToStudio): void {
    void this.panel.webview.postMessage(message);
  }

  private async receive(message: StudioToHost): Promise<void> {
    try {
      switch (message.type) {
        case "ready":
        case "new": {
          const facts = await this.facts();
          this.post({
            type: "init",
            repoName: path.basename(this.root),
            facts,
            suggestion: suggestWorkflow(facts),
            files: await this.listWorkflows(),
          });
          if (message.type === "ready" && this.pendingFile) {
            const file = this.pendingFile;
            this.pendingFile = undefined;
            await this.open(file);
          }
          return;
        }
        // Awaited, so their failures land in the catch below and reach the webview.
        case "open":
          return await this.open(message.file);
        case "save":
          return await this.save(message.model);
        case "openFile":
          await vscode.window.showTextDocument(vscode.Uri.file(this.workflowPath(message.file)));
          return;
      }
    } catch (error) {
      this.post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async facts(): Promise<ProjectFacts> {
    const files = await readdir(this.root).catch(() => [] as string[]);
    let npmScripts: Record<string, string> | undefined;
    if (files.includes("package.json")) {
      const pkg = JSON.parse(await readFile(path.join(this.root, "package.json"), "utf8").catch(() => "{}"));
      npmScripts = pkg.scripts ?? {};
    }
    return { files, npmScripts, defaultBranch: this.baseName ?? "main" };
  }

  private async listWorkflows(): Promise<WorkflowFile[]> {
    const names = (await readdir(this.workflowsDir).catch(() => [] as string[])).filter((n) => /\.ya?ml$/i.test(n));
    return Promise.all(
      names.sort().map(async (file) => {
        const text = await readFile(path.join(this.workflowsDir, file), "utf8").catch(() => "");
        return { file, byGitKit: readModel(text) !== null, summary: summarize(text) };
      }),
    );
  }

  /** A file in .github/workflows, by the bare name the webview sends; nothing outside that folder. */
  private workflowPath(file: string): string {
    if (!/^[^\\/]+\.ya?ml$/i.test(file) || file.startsWith("..")) {
      throw new Error(`"${file}" isn't a workflow file in .github/workflows.`);
    }
    return path.join(this.workflowsDir, file);
  }

  private async open(file: string): Promise<void> {
    const text = await readFile(this.workflowPath(file), "utf8");
    const explanation = explain(text);
    const embedded = readModel(text);
    if (embedded && !embedded.editedByHand) {
      this.post({ type: "opened", file, model: embedded.model, imported: false, explanation });
      return;
    }
    // Hand-written, or edited by hand since Studio wrote it: read the file itself, so hand edits
    // show up as editable jobs and steps.
    try {
      this.post({ type: "opened", file, model: importWorkflow(text, file), imported: true, explanation });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({
        type: "opened",
        file,
        model: null,
        imported: false,
        explanation: { ...explanation, error: explanation.error ?? message },
      });
    }
  }

  private async save(model: WorkflowModel): Promise<void> {
    const problems = validate(model);
    if (problems.length) {
      this.post({ type: "error", message: problems[0].message });
      return;
    }
    // GitHub's own schema catches what Studio's checks can't, like a typo in a YAML box. It can lag
    // behind new GitHub features, so it warns instead of refusing.
    const schemaIssues = schemaProblems(parse(toYaml(model)));
    if (schemaIssues.length) {
      const choice = await vscode.window.showWarningMessage(
        `GitHub would likely reject ${model.file}: it doesn't match the workflow schema.`,
        { modal: true, detail: schemaIssues.map((p) => `• ${p}`).join("\n") },
        "Save Anyway",
      );
      if (choice !== "Save Anyway") {
        this.post({ type: "error", message: `Not saved. ${schemaIssues[0]}` });
        return;
      }
    }
    const target = path.join(this.workflowsDir, model.file);
    const existing = await readFile(target, "utf8").catch(() => null);
    let text = toYaml(model);
    if (existing !== null) {
      const embedded = readModel(existing);
      const handWritten = !embedded || embedded.editedByHand;
      // A file someone wrote keeps their comments and layout: only what changed is edited, though
      // the YAML printer tidies spacing (runs of blank lines, lined-up comments).
      const merged = handWritten ? updateYaml(existing, workflowObject(model)) : null;
      if (merged !== null) text = merged;
      const choice = await vscode.window.showWarningMessage(
        merged !== null
          ? `Update ${model.file}? Only what you changed is edited and its comments are kept. Spacing may be tidied: extra blank lines and lined-up comments.`
          : handWritten
            ? `${model.file} on disk isn't valid YAML any more, so it can't be edited in place. Saving replaces it with what Studio shows. Replace it?`
            : `Update ${model.file}?`,
        { modal: true },
        handWritten && merged === null ? "Replace" : "Update",
      );
      if (!choice) return;
    }
    await mkdir(this.workflowsDir, { recursive: true });
    await writeFile(target, text);
    this.post({ type: "saved", file: model.file, files: await this.listWorkflows() });

    const relative = path.relative(this.root, target).replace(/\\/g, "/");
    const choice = await vscode.window.showInformationMessage(
      `Saved ${relative}. Commit and push it to run it on GitHub.`,
      "Open File",
    );
    if (choice) await vscode.window.showTextDocument(vscode.Uri.file(target));
  }
}
