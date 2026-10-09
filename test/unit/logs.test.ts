import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Job, JobStep } from "../../src/github/ci";
import { cleanLine, formatFailedLog, parseLog, stepLines } from "../../src/github/logs";
import jobFixture from "../fixtures/github/job-failed.json";

// The job's steps are GitHub's real ones. Its log follows GitHub's format (GitHub serves logs only
// to signed-in users): timestamps to the 100 ns, ANSI colors, and neighboring steps that start or
// end in the same second as the failed one.
const job = jobFixture as Job;
const raw = readFileSync(join(__dirname, "../fixtures/github/job-failed.log"), "utf8");
const step = (n: number) => job.steps!.find((s) => s.number === n)!;

describe("parseLog", () => {
  it("reads each line's time and drops the timestamp, colors and byte order mark", () => {
    const lines = parseLog(raw);
    expect(lines[0]).toEqual({
      second: Date.parse("2026-10-09T04:13:31Z") / 1000,
      text: "Current runner version: '2.329.0'",
    });
    expect(lines.find((l) => l.text.includes("vulnerabilities"))!.text).toBe("found 0 vulnerabilities");
    expect(lines.at(-1)!.text).toBe("Cleaning up orphan processes");
  });

  it("gives lines without a timestamp the time of the line before", () => {
    expect(parseLog("2026-10-09T04:00:00.5Z first\ncontinued\r\n")).toEqual([
      { second: Date.parse("2026-10-09T04:00:00Z") / 1000, text: "first" },
      { second: Date.parse("2026-10-09T04:00:00Z") / 1000, text: "continued" },
    ]);
  });
});

describe("stepLines", () => {
  const texts = (s: JobStep) => stepLines(parseLog(raw), s)!.map((l) => l.text);

  it("cuts out the failed step, though the steps around it share its first and last second", () => {
    const failed = texts(step(5));
    expect(failed[0]).toBe("##[group]Run npm test");
    expect(failed).not.toContain("found 0 vulnerabilities"); // npm ci, in the same second
    expect(failed.at(-1)).toBe("##[error]Process completed with exit code 1.");
    expect(failed).not.toContain("Post job cleanup."); // the next step, in the same second
  });

  it("keeps a step's own sections, like setup-node's environment details", () => {
    const setup = texts(step(3));
    expect(setup[0]).toBe("##[group]Run actions/setup-node@v5");
    expect(setup).toContain("node: v22.20.0");
    expect(setup).not.toContain("##[group]Run npm ci");
  });

  it("stops before GitHub's final step when it starts in the failed step's last second", () => {
    const log = [
      "2026-10-09T10:00:20.1Z ##[group]Run npm test",
      "2026-10-09T10:00:30.9Z ##[error]Process completed with exit code 1.",
      "2026-10-09T10:00:31.0Z Cleaning up orphan processes",
    ].join("\n");
    const s = {
      name: "Run npm test",
      number: 5,
      conclusion: "failure",
      started_at: "2026-10-09T10:00:20Z",
      completed_at: "2026-10-09T10:00:31Z",
    };
    expect(stepLines(parseLog(log), s)!.map((l) => l.text)).toEqual([
      "##[group]Run npm test",
      "##[error]Process completed with exit code 1.",
    ]);
  });

  it("finds nothing for a step without times, or outside the log", () => {
    expect(stepLines(parseLog(raw), { ...step(5), started_at: null })).toBeNull();
    const later = { ...step(5), started_at: "2026-10-10T00:00:00Z", completed_at: "2026-10-10T00:01:00Z" };
    expect(stepLines(parseLog(raw), later)).toBeNull();
  });
});

describe("cleanLine", () => {
  it.each([
    ["##[error]Process completed with exit code 1.", "Error: Process completed with exit code 1."],
    ["##[warning]Node 20 is deprecated", "Warning: Node 20 is deprecated"],
    ["##[group]Run npm test", "Run npm test"],
    ["##[endgroup]", null],
    ["[command]/usr/bin/git version", "$ /usr/bin/git version"],
    ["##[command]git version", "$ git version"],
    ["[vite] building for production", "[vite] building for production"],
  ])("%s", (line, expected) => {
    expect(cleanLine(line)).toBe(expected);
  });
});

describe("formatFailedLog", () => {
  const url = "https://github.com/o/r/actions/runs/1/job/2#step:5:1";

  it("shows the failed step with the cursor on its first error", () => {
    const { text, errorLine } = formatFailedLog(raw, { name: job.name, url }, step(5));
    const lines = text.split("\n");
    expect(lines.slice(0, 4)).toEqual([
      'Test (Windows) (22) failed at "npm test"',
      `Only that step's output is shown. The whole log: ${url}`,
      "",
      "Run npm test",
    ]);
    expect(lines[errorLine]).toBe("Error: AssertionError: expected [] to deeply equal [ 'before codex' ]");
    expect(text).not.toContain("##[");
    expect(text).not.toContain("npm ci");
  });

  it("shows the whole log when the step isn't known", () => {
    const { text, errorLine } = formatFailedLog(raw, { name: job.name, url }, null);
    expect(text.split("\n").slice(0, 2)).toEqual(["Test (Windows) (22) failed", `On GitHub: ${url}`]);
    expect(text).toContain("Current runner version");
    expect(text.split("\n")[errorLine]).toMatch(/^Error: AssertionError/);
  });

  it("puts the cursor at the top when nothing is marked as an error", () => {
    const quiet = "2026-10-09T04:14:07.1Z ##[group]Run npm test\n2026-10-09T04:14:08.1Z boom\n";
    expect(formatFailedLog(quiet, { name: "Test", url }, null).errorLine).toBe(3);
  });
});
