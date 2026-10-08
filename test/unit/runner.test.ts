import { describe, expect, it } from "vitest";
import { formatCommand } from "../../src/git/runner";

describe("formatCommand", () => {
  it("leaves plain args unquoted", () => {
    expect(formatCommand(["push", "--force-with-lease", "origin", "feat/pulse"])).toBe(
      "git push --force-with-lease origin feat/pulse",
    );
  });

  it("quotes args with spaces", () => {
    expect(formatCommand(["commit", "-m", "fix login bug"])).toBe('git commit -m "fix login bug"');
  });

  it("escapes shell-special characters inside quotes", () => {
    expect(formatCommand(["commit", "-m", 'say "hi" $HOME'])).toBe('git commit -m "say \\"hi\\" \\$HOME"');
  });
});
