import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { readFailedLog } from "../../github/client";
import type { CiError, CiFailure, RepoState } from "../../shared/types";

// A failed CI step's log in a read-only editor tab, and jumping from a CI error to its line.

export const CI_LOG_SCHEME = "gitkit-ci-log";

/** Serves logs GitKit downloaded; the tab is read-only because nothing can write to this scheme. */
export class CiLogProvider implements vscode.TextDocumentContentProvider {
  private readonly logs = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.logs.get(uri.toString()) ?? "";
  }

  set(uri: vscode.Uri, text: string): void {
    this.logs.set(uri.toString(), text);
    // An open tab for the same job shows the new download.
    this.changed.fire(uri);
  }
}

export async function openCiLog(provider: CiLogProvider, repo: RepoState, failure: CiFailure): Promise<void> {
  if (failure.jobId === null) return;
  const jobId = failure.jobId;
  const log = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "GitKit: downloading the CI log…" },
    () => readFailedLog(repo, jobId),
  );
  // The .log extension gives the tab VS Code's log colors; the name is what the tab shows.
  const uri = vscode.Uri.from({
    scheme: CI_LOG_SCHEME,
    path: `/${log.name.replace(/[\\/]/g, "-")}.log`,
    query: `job=${jobId}`,
  });
  provider.set(uri, log.text);
  const document = await vscode.workspace.openTextDocument(uri);
  const line = new vscode.Range(log.errorLine, 0, log.errorLine, 0);
  await vscode.window.showTextDocument(document, { preview: false, selection: line });
}

/** Opens the file and line an error points at, or the line on GitHub when the file isn't here. */
export async function openCiError(repo: RepoState, error: CiError): Promise<void> {
  const local = error.file ? path.join(repo.root, error.file) : null;
  if (local && existsSync(local)) {
    const line = Math.max(0, (error.line ?? 1) - 1);
    await vscode.window.showTextDocument(vscode.Uri.file(local), { selection: new vscode.Range(line, 0, line, 0) });
  } else if (error.url?.startsWith("https://")) {
    await vscode.env.openExternal(vscode.Uri.parse(error.url));
  }
}
