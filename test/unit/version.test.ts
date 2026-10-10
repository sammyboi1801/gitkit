import { describe, expect, it } from "vitest";
import { gitVersionProblem, parseGitVersion } from "../../src/git/version";

describe("git version", () => {
  it("reads git's own version line on every platform", () => {
    expect(parseGitVersion("git version 2.45.1.windows.1\n")).toEqual([2, 45, 1]);
    expect(parseGitVersion("git version 2.39.5 (Apple Git-154)")).toEqual([2, 39, 5]);
    expect(parseGitVersion("git version 2.38.0")).toEqual([2, 38, 0]);
    expect(parseGitVersion("not git")).toBeNull();
  });

  it("explains what an old git can't do, and says nothing for a new enough one", () => {
    expect(gitVersionProblem("git version 2.38.0")).toBeNull();
    expect(gitVersionProblem("git version 3.0.0")).toBeNull();
    expect(gitVersionProblem("git version 2.34.1")).toMatch(
      /git 2\.34\.1.*2\.38 or newer.*conflict forecasts.*merged branches/,
    );
  });
});
