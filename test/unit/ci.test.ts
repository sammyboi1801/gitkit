import { describe, expect, it } from "vitest";
import {
  annotationPath,
  describeFailures,
  errorsFrom,
  jobIdFrom,
  parseGitHubRemote,
  runIdFrom,
  summarizeChecks,
  type Annotation,
  type CheckRun,
  type Job,
} from "../../src/github/ci";
import annotationsFixture from "../fixtures/github/annotations-failed.json";
import jobFixture from "../fixtures/github/job-failed.json";

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
      failures: [],
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

// Real responses from GitHub for a failed job of this repo's CI (GET /actions/jobs/<id> and
// GET /check-runs/<id>/annotations).
const failedJob = jobFixture as Job;
const failedAnnotations = annotationsFixture as Annotation[];
const failedRun: CheckRun = {
  id: failedJob.id,
  name: failedJob.name,
  status: "completed",
  conclusion: "failure",
  html_url: failedJob.html_url,
  details_url: failedJob.html_url,
};

describe("describeFailures", () => {
  it("says which step failed and why, from GitHub's job and annotations", () => {
    expect(describeFailures([{ run: failedRun, job: failedJob, annotations: failedAnnotations }], "gitkit")).toEqual([
      {
        jobs: ["Test (Windows) (22)"],
        jobId: 113666254978,
        step: "npm test",
        url: "https://github.com/sammyboi1801/gitkit/actions/runs/37882859595/job/113666254978#step:5:1",
        errors: [
          {
            text: "checkpoints the worktree the terminal is in, even one opened by path",
            detail: expect.stringMatching(/^AssertionError: expected \[\] to deeply equal \[ 'before codex' \]/),
            file: "test/host/features.test.ts",
            line: 890,
            url: "https://github.com/sammyboi1801/gitkit/blob/fc9bb88b0af1fd4a2f6ea17d702742235beb54e8/test/host/features.test.ts#L890",
          },
          expect.objectContaining({ file: "test/host/features.test.ts", line: 650 }),
        ],
      },
    ]);
  });

  it("lists jobs that failed the same way once, like a test failing on every Node version", () => {
    const other = { ...failedJob, id: 2, name: "Test (Linux) (24)" };
    const lint = {
      ...failedJob,
      id: 3,
      name: "Lint",
      steps: failedJob.steps!.map((s) => (s.number === 5 ? { ...s, name: "Run npm run lint" } : s)),
    };
    const failures = describeFailures(
      [
        { run: failedRun, job: failedJob, annotations: failedAnnotations },
        { run: { ...failedRun, id: 2 }, job: other, annotations: failedAnnotations },
        { run: { ...failedRun, id: 3 }, job: lint, annotations: [] },
      ],
      "gitkit",
    );
    expect(failures.map((f) => [f.jobs, f.step, f.errors.length])).toEqual([
      [["Test (Windows) (22)", "Test (Linux) (24)"], "npm test", 2],
      [["Lint"], "npm run lint", 0],
    ]);
  });

  it("still names checks it can't read more about, without merging them", () => {
    const app = {
      ...run("codecov/patch", "completed", "failure"),
      details_url: "https://codecov.io/x",
      html_url: null,
    };
    const failures = describeFailures(
      [
        { run: app, job: null, annotations: [] },
        { run: { ...app, name: "other app" }, job: null, annotations: [] },
      ],
      "r",
    );
    expect(failures).toEqual([
      { jobs: ["codecov/patch"], jobId: null, step: null, url: "https://codecov.io/x", errors: [] },
      { jobs: ["other app"], jobId: null, step: null, url: "https://codecov.io/x", errors: [] },
    ]);
  });
});

describe("errorsFrom", () => {
  const annotation = (a: Partial<Annotation>): Annotation => ({
    path: "src/a.ts",
    start_line: 3,
    annotation_level: "failure",
    title: "",
    message: "'x' is assigned a value but never used.",
    blob_href: "https://github.com/o/r/blob/abc/src/a.ts",
    ...a,
  });

  it("skips warnings, duplicates and the exit code GitHub adds to every failed step", () => {
    expect(
      errorsFrom(
        [
          annotation({ path: ".github", message: "Process completed with exit code 1." }),
          annotation({ annotation_level: "warning", message: "Node 20 is deprecated" }),
          annotation({}),
          annotation({}),
        ],
        "r",
      ),
    ).toEqual([
      {
        text: "'x' is assigned a value but never used.",
        detail: "'x' is assigned a value but never used.",
        file: "src/a.ts",
        line: 3,
        url: "https://github.com/o/r/blob/abc/src/a.ts#L3",
      },
    ]);
  });

  it("keeps errors about no file in particular, without a link", () => {
    expect(errorsFrom([annotation({ path: ".github", message: "\nThe job timed out.\n" })], "r")).toEqual([
      { text: "The job timed out.", detail: "The job timed out.", file: null, line: null, url: null },
    ]);
  });
});

describe("annotationPath", () => {
  it.each([
    ["test/host/features.test.ts", "test/host/features.test.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["src\\a.ts", "src/a.ts"],
    ["/home/runner/work/gitkit/gitkit/src/a.ts", "src/a.ts"],
    ["D:\\a\\gitkit\\gitkit\\src\\a.ts", "src/a.ts"],
    ["/usr/lib/node/x.js", null],
    [".github", null],
    ["", null],
    ["../outside.txt", null],
  ])("%s → %s", (path, expected) => {
    expect(annotationPath(path, "gitkit")).toBe(expected);
  });
});

describe("jobIdFrom", () => {
  it("reads the job from an Actions check's URL only", () => {
    expect(jobIdFrom("https://github.com/o/r/actions/runs/123/job/456")).toBe(456);
    expect(jobIdFrom("https://github.com/o/r/runs/456")).toBeNull();
    expect(jobIdFrom(null)).toBeNull();
  });
});
