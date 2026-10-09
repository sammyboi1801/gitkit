import { describe, expect, it } from "vitest";
import { describeCondition, guardsAgainstPullRequests } from "../../src/workflow/conditions";
import { newJob, type Job, type WorkflowModel } from "../../src/workflow/model";
import { deploys, warnings, workflowEvents } from "../../src/workflow/warnings";

describe("describeCondition", () => {
  it.each([
    ["github.ref == 'refs/heads/main'", "only on main"],
    ["${{ github.ref == 'refs/heads/main' }}", "only on main"],
    ["github.ref_name == 'release'", "only on release"],
    ["github.ref != 'refs/heads/main'", "not on main"],
    ["github.ref == 'refs/tags/v1'", "only on tag v1"],
    ["github.event_name == 'push'", "only on pushes"],
    ["github.event_name != 'pull_request'", "not on pull requests"],
    ["github.event_name == 'push' && github.ref == 'refs/heads/main'", "only on pushes to main"],
    ["startsWith(github.ref, 'refs/tags/')", "only for tags"],
    ["startsWith(github.ref, 'refs/tags/v')", "only for tags like v*"],
    ["always()", "even if something failed"],
    ["failure()", "only if something failed"],
    ["!cancelled()", "unless the run was cancelled"],
    ["github.event.pull_request.merged == true", "only when the pull request is merged"],
    ["contains(github.event.pull_request.labels.*.name, 'deploy')", "only with the deploy label"],
    ["github.repository == 'acme/web'", "only in acme/web, not forks"],
    ["github.actor != 'dependabot[bot]'", "not for dependabot[bot]"],
    ["matrix.os == 'ubuntu-latest'", "only when os is ubuntu-latest"],
    ["always() && github.ref == 'refs/heads/main'", "even if something failed and only on main"],
  ])("%s → %s", (expr, words) => {
    expect(describeCondition(expr)).toBe(words);
  });

  it("shows other conditions as written, shortened, and says nothing for none", () => {
    expect(describeCondition("needs.build.outputs.changed == 'true'")).toBe("if needs.build.outputs.changed == 'true'");
    expect(describeCondition(`${"x".repeat(60)} == 'y'`)).toMatch(/^if x{47}…$/);
    expect(describeCondition(undefined)).toBeNull();
    expect(describeCondition("")).toBeNull();
    expect(describeCondition(false)).toBe("never (turned off)");
  });

  it("knows which conditions keep a job off pull requests", () => {
    expect(guardsAgainstPullRequests("github.ref == 'refs/heads/main'")).toBe(true);
    expect(guardsAgainstPullRequests("github.event_name == 'push'")).toBe(true);
    expect(guardsAgainstPullRequests("github.event_name != 'pull_request'")).toBe(true);
    expect(guardsAgainstPullRequests("github.event.pull_request.merged")).toBe(true);
    expect(guardsAgainstPullRequests("always()")).toBe(false);
    expect(guardsAgainstPullRequests("github.event_name == 'pull_request'")).toBe(false);
    expect(guardsAgainstPullRequests(undefined)).toBe(false);
  });
});

describe("warnings", () => {
  const workflow = (jobs: Job[], on: unknown = { push: { branches: ["main"] }, pull_request: null }): WorkflowModel =>
    ({
      name: "CI",
      file: "ci.yml",
      triggers: {
        push: { enabled: false, branches: [] },
        pullRequest: { enabled: false, branches: [] },
        tags: { enabled: false, pattern: "v*" },
        schedule: { enabled: false, cron: "" },
        manual: false,
      },
      rawOn: on,
      jobs,
      readOnlyPermissions: true,
      cancelSuperseded: false,
    }) as WorkflowModel;
  const stepsJob = (id: string, extra: Job["extra"], steps: Job["steps"] = [{ run: "echo hi" }]): Job => ({
    id,
    name: id,
    template: "steps",
    runsOn: "ubuntu-latest",
    versions: [],
    needs: [],
    inputs: {},
    steps,
    extra,
  });

  it("warns when a deploy would also run on pull requests, with a fix", () => {
    const deploy = stepsJob("deploy", { environment: "github-pages" }, [{ uses: "actions/deploy-pages@v5" }]);
    expect(warnings(workflow([deploy]))).toEqual([
      {
        job: "deploy",
        message: "deploy also runs on pull requests, so every pull request would deploy. Limit it to main.",
        fix: { label: "Only run on main", condition: "github.ref == 'refs/heads/main'" },
      },
    ]);
    // Guarded, or not run on pull requests at all: nothing to say.
    expect(
      warnings(workflow([{ ...deploy, extra: { ...deploy.extra, if: "github.ref == 'refs/heads/main'" } }])),
    ).toEqual([]);
    expect(warnings(workflow([deploy], { push: null }))).toEqual([]);
  });

  it("knows a deploy by what it does, not its name", () => {
    expect(deploys(stepsJob("x", undefined, [{ uses: "docker/build-push-action@v7", with: { push: true } }]))).toBe(
      true,
    );
    expect(deploys(stepsJob("x", undefined, [{ uses: "docker/build-push-action@v7", with: { push: false } }]))).toBe(
      false,
    );
    expect(deploys(stepsJob("x", { permissions: { "id-token": "write" } }))).toBe(true);
    expect(deploys(stepsJob("deploy-notes", undefined, [{ run: "echo not really" }]))).toBe(false);
    expect(deploys(newJob("pages-deploy", []))).toBe(true);
    expect(deploys(newJob("node-test", []))).toBe(false);
  });

  it("flags checking out a pull request's code on pull_request_target", () => {
    const risky = stepsJob("label", undefined, [
      { uses: "actions/checkout@v7", with: { ref: "${{ github.event.pull_request.head.sha }}" } },
      { run: "npm test" },
    ]);
    const found = warnings(workflow([risky], { pull_request_target: null }));
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/checks out the pull request's own code on pull_request_target/);
    expect(warnings(workflow([risky], { pull_request: null }))).toEqual([]);
  });

  it("reads the events however on: is written", () => {
    expect(workflowEvents(workflow([], "push"))).toEqual(["push"]);
    expect(workflowEvents(workflow([], ["push", "pull_request"]))).toEqual(["push", "pull_request"]);
    expect(workflowEvents(workflow([], { release: { types: ["published"] } }))).toEqual(["release"]);
  });
});
