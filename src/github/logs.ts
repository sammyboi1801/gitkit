import type { JobStep } from "./ci";

// Pure helpers for GitHub Actions job logs: cut out the step that failed and make it readable.
// A job's log is one text file in which every line starts with a timestamp, and workflow commands
// like ##[group] and ##[error] mark sections and errors.

export interface LogLine {
  /** Unix seconds, from the line's timestamp. */
  second: number | null;
  text: string;
}

const STAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z ?/;
// eslint-disable-next-line no-control-regex -- logs keep the colors programs printed
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function parseLog(raw: string): LogLine[] {
  let second: number | null = null;
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n$/, "")
    .split(/\r?\n/)
    .map((line) => {
      const stamp = STAMP.exec(line);
      // A line without a timestamp continues the one before it.
      if (stamp) second = Date.parse(`${stamp[1]}Z`) / 1000;
      return { second, text: (stamp ? line.slice(stamp[0].length) : line).replace(ANSI, "") };
    });
}

/** Where a step's output begins: GitHub opens each step with a group, except its own post and final steps. */
const isStepStart = (text: string) =>
  text.startsWith("##[group]") || text === "Post job cleanup." || text === "Cleaning up orphan processes";
const isError = (text: string) => text.startsWith("##[error]");

/**
 * The lines a step printed, found by its start and end times. Those are whole seconds, so the
 * steps before and after can share a second with it: its output starts at the first section that
 * opens in its first second, and stops before a section that opens in its last second (unless an
 * error follows, which would be part of a step with sections of its own, like a composite action).
 */
export function stepLines(lines: readonly LogLine[], step: JobStep): LogLine[] | null {
  if (!step.started_at || !step.completed_at) return null;
  const from = Date.parse(step.started_at) / 1000;
  const to = Date.parse(step.completed_at) / 1000;
  const first = lines.findIndex((l) => l.second !== null && l.second >= from);
  if (first === -1 || lines[first].second! > to) return null;
  let last = first;
  while (last + 1 < lines.length && (lines[last + 1].second ?? to) <= to) last++;

  let begin = first;
  for (let i = first; i <= last && lines[i].second === from; i++) {
    if (isStepStart(lines[i].text)) {
      begin = i;
      break;
    }
  }
  let end = last;
  for (let i = begin + 1; i <= last; i++) {
    if (lines[i].second === to && isStepStart(lines[i].text)) {
      if (!lines.slice(i, last + 1).some((l) => isError(l.text))) end = i - 1;
      break;
    }
  }
  return lines.slice(begin, end + 1);
}

const COMMANDS: Record<string, string> = {
  error: "Error: ",
  warning: "Warning: ",
  notice: "Notice: ",
  debug: "Debug: ",
  command: "$ ",
};

/** A log line as GitHub's log viewer shows it: errors spelled out, section markers gone. */
export function cleanLine(text: string): string | null {
  // Commands that actions run are logged as "[command]git version", without the ##.
  if (text.startsWith("[command]")) return `$ ${text.slice("[command]".length)}`;
  const match = /^##\[(\w+)\]/.exec(text);
  if (!match) return text;
  if (match[1] === "endgroup") return null;
  return (COMMANDS[match[1]] ?? "") + text.slice(match[0].length);
}

/**
 * The text of the log tab: what failed, the failed step's output (or the whole log when the step
 * can't be found in it), and the line of the first error to put the cursor on.
 */
export function formatFailedLog(
  raw: string,
  job: { name: string; url: string },
  step: JobStep | null,
): { text: string; errorLine: number } {
  const lines = parseLog(raw);
  const section = step ? stepLines(lines, step) : null;
  const body = (section ?? lines).map((l) => cleanLine(l.text)).filter((l): l is string => l !== null);
  const what = step ? `${job.name} failed at "${step.name.replace(/^Run /, "")}"` : `${job.name} failed`;
  const header = [
    what,
    section ? `Only that step's output is shown. The whole log: ${job.url}` : `On GitHub: ${job.url}`,
    "",
  ];
  const text = [...header, ...body].join("\n") + "\n";
  const firstError = body.findIndex((l) => l.startsWith("Error: "));
  return { text, errorLine: firstError === -1 ? header.length : header.length + firstError };
}
