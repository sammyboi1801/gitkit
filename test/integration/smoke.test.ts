import * as assert from "node:assert/strict";
import * as vscode from "vscode";

// Runs inside a real VS Code, opened on a throwaway repo (see scripts/integration.mjs).
// Proves what unit tests can't: the packaged extension activates, contributes what package.json
// promises, and its views and tabs open without errors.

const EXTENSION_ID = "sammyboi1801.gitkit-vscode";

async function waitFor<T>(check: () => T | undefined | Promise<T | undefined>, what: string, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const tabLabels = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => t.label));

describe("GitKit in VS Code", () => {
  it("activates", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is installed`);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  it("registers every command it contributes", async () => {
    const contributed = (
      vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON.contributes.commands as { command: string }[]
    ).map((c) => c.command);
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const command of contributed) assert.ok(registered.has(command), `${command} is registered`);
  });

  it("opens the GitKit sidebar view", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.gitkit");
    await vscode.commands.executeCommand("gitkit.pulse.focus");
    await vscode.commands.executeCommand("gitkit.refresh");
  });

  it("opens the Branch Map tab", async () => {
    await vscode.commands.executeCommand("gitkit.openBranchMap");
    await waitFor(() => tabLabels().includes("Branch Map") || undefined, "the Branch Map tab");
  });

  it("opens the Workflow Studio tab once the repo is loaded", async () => {
    // The studio needs the panel to have read the repo; retry until it has.
    await waitFor(async () => {
      await vscode.commands.executeCommand("gitkit.openWorkflowStudio");
      return tabLabels().includes("Workflow Studio") || undefined;
    }, "the Workflow Studio tab");
  });
});
