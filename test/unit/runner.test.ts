import { describe, expect, it } from "vitest";
import { formatCommand } from "../../src/git/runner";

describe("formatCommand", () => {
  it("leaves plain args unquoted", () => {
    expect(formatCommand(["push", "--force-with-lease", "origin", "feat/pulse"])).toBe(
      "git push --force-with-lease origin feat/pulse",
    );
  });

  it("leaves revisions like HEAD~1 and main^ unquoted, but not a leading ~", () => {
    expect(formatCommand(["reset", "--soft", "HEAD~1"])).toBe("git reset --soft HEAD~1");
    expect(formatCommand(["show", "main^"])).toBe("git show main^");
    expect(formatCommand(["add", "~/notes"])).toBe('git add "~/notes"');
  });

  it("quotes args with spaces", () => {
    expect(formatCommand(["commit", "-m", "fix login bug"])).toBe('git commit -m "fix login bug"');
  });

  it("escapes shell-special characters inside quotes", () => {
    expect(formatCommand(["commit", "-m", 'say "hi" $HOME'])).toBe('git commit -m "say \\"hi\\" \\$HOME"');
  });
});
