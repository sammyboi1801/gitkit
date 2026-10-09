import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { HostToStudio, StudioToHost, WorkflowFile } from "../../shared/messages";
import { suggestWorkflow, validate, type ProjectFacts, type WorkflowModel } from "../../workflow/model";
import { importWorkflow } from "../../workflow/import";
import { explain, readModel, toYaml } from "../../workflow/yaml";
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

  static show(extensionUri: vscode.Uri, repo: { root: string; baseName: string | null } | undefined): void {
    if (!repo) {
      void vscode.window.showInformationMessage(
        "Open a git repository first; Workflow Studio saves into its .github/workflows folder.",
      );
      return;
    }
    if (WorkflowStudioPanel.current && WorkflowStudioPanel.current.root === repo.root) {
      WorkflowStudioPanel.current.panel.reveal();
      return;
    }
    WorkflowStudioPanel.current?.panel.dispose();
    WorkflowStudioPanel.current = new WorkflowStudioPanel(extensionUri, repo.root, repo.baseName);
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    extensionUri: vscode.Uri,
    private readonly root: string,
    private readonly baseName: string | null,
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
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "gitkit.svg");
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
          return;
        }
        case "open":
          return this.open(message.file);
        case "save":
          return this.save(message.model);
        case "openFile":
          await vscode.window.showTextDocument(vscode.Uri.file(path.join(this.workflowsDir, message.file)));
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

  private async open(file: string): Promise<void> {
    const text = await readFile(path.join(this.workflowsDir, file), "utf8");
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
    const target = path.join(this.workflowsDir, model.file);
    const existing = await readFile(target, "utf8").catch(() => null);
    if (existing !== null) {
      const embedded = readModel(existing);
      const handWritten = !embedded || embedded.editedByHand;
      const choice = await vscode.window.showWarningMessage(
        handWritten
          ? `${model.file} was written or edited by hand. Saving rewrites it in Studio's layout: jobs, steps and settings are kept, but YAML comments and formatting are not. Replace it?`
          : `Update ${model.file}?`,
        { modal: true },
        handWritten ? "Replace" : "Update",
      );
      if (!choice) return;
    }
    await mkdir(this.workflowsDir, { recursive: true });
    await writeFile(target, toYaml(model));
    this.post({ type: "saved", file: model.file, files: await this.listWorkflows() });

    const relative = path.relative(this.root, target).replace(/\\/g, "/");
    const choice = await vscode.window.showInformationMessage(
      `Saved ${relative}. Commit and push it to run it on GitHub.`,
      "Open File",
    );
    if (choice) await vscode.window.showTextDocument(vscode.Uri.file(target));
  }
}
