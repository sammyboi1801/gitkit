import { describe, expect, it } from "vitest";
import { parseGitHubRemote, runIdFrom, summarizeChecks, type CheckRun } from "../../src/github/ci";

const run = (name: string, status: string, conclusion: string | null, id = 1): CheckRun => ({
  name,
  status,
  conclusion,
  html_url: `https://github.com/o/r/actions/runs/${id}/job/9`,
  details_url: `https://github.com/o/r/actions/runs/${id}/job/9`,
});
const actions = "https://github.com/o/r/actions";

describe("parseGitHubRemote", () => {
  it("reads owner and repo from GitHub remotes only", () => {
    expect(parseGitHubRemote("git@github.com:sammyboi1801/gitkit.git")).toEqual({
      owner: "sammyboi1801",
      repo: "gitkit",
    });
    expect(parseGitHubRemote("https://github.com/sammyboi1801/gitkit")).toEqual({
      owner: "sammyboi1801",
      repo: "gitkit",
    });
    expect(parseGitHubRemote("https://gitlab.com/a/b.git")).toBeNull();
    expect(parseGitHubRemote("D:/repos/local.git")).toBeNull();
  });
});

describe("summarizeChecks", () => {
  it("reports failures first, with names and the run to re-run", () => {
    const status = summarizeChecks(
      "abc",
      [run("lint", "completed", "success"), run("test", "completed", "failure", 42)],
      actions,
    );
    expect(status).toEqual({
      state: "failure",
      sha: "abc",
      summary: "1 of 2 checks failed",
      failed: ["test"],
      url: "https://github.com/o/r/actions/runs/42/job/9",
      runId: 42,
    });
  });

  it("says running while anything is still in progress", () => {
    expect(
      summarizeChecks("abc", [run("lint", "completed", "success"), run("test", "in_progress", null)], actions).state,
    ).toBe("pending");
  });

  it("passes when everything passed or was skipped", () => {
    const status = summarizeChecks(
      "abc",
      [run("a", "completed", "success"), run("b", "completed", "skipped")],
      actions,
    );
    expect(status).toMatchObject({ state: "success", summary: "All 2 checks passed" });
  });

  it("handles commits without checks", () => {
    expect(summarizeChecks("abc", [], actions)).toMatchObject({ state: "none", url: actions });
  });

  it("extracts run ids from Actions URLs", () => {
    expect(runIdFrom("https://github.com/o/r/actions/runs/123/job/4")).toBe(123);
    expect(runIdFrom("https://example.com/check")).toBeNull();
  });
});
