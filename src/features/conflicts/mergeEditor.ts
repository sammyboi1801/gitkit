import * as path from "node:path";
import * as vscode from "vscode";
import { runGit } from "../../git/runner";

// Serves the three index stages of a conflicted file (1 = common ancestor, 2 = ours, 3 = theirs)
// as read-only documents, so GitKit can open VS Code's merge editor for any repo, including
// nested ones the built-in git extension never discovered.

export const STAGE_SCHEME = "gitkit-stage";

export class StageContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { root, file, stage } = JSON.parse(uri.query) as { root: string; file: string; stage: number };
    try {
      const { stdout } = await runGit(["show", `:${stage}:${file}`], root);
      return stdout;
    } catch {
      // A stage can legitimately be missing, e.g. no common ancestor when both sides added the file.
      return "";
    }
  }
}

function stageUri(root: string, file: string, stage: 1 | 2 | 3): vscode.Uri {
  return vscode.Uri.from({
    scheme: STAGE_SCHEME,
    path: `/${file}`,
    query: JSON.stringify({ root, file, stage }),
  });
}

export interface SideNames {
  ours: string;
  oursDetail: string;
  theirs: string;
  theirsDetail: string;
}

export async function openMergeEditor(root: string, file: string, names: SideNames): Promise<void> {
  const output = vscode.Uri.file(path.join(root, file));
  try {
    // The command the built-in git extension itself uses to open the merge editor.
    await vscode.commands.executeCommand("_open.mergeEditor", {
      base: stageUri(root, file, 1),
      input1: { uri: stageUri(root, file, 2), title: names.ours, description: names.oursDetail },
      input2: { uri: stageUri(root, file, 3), title: names.theirs, description: names.theirsDetail },
      output,
    });
  } catch {
    // Older VS Code without that command: open the file, where inline conflict actions still work.
    await vscode.window.showTextDocument(output);
    void vscode.window.showInformationMessage(
      "Couldn't open the merge editor here, so GitKit opened the file. Use the Accept actions above each conflict.",
    );
  }
}
