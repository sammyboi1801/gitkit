// Job and step conditions (`if:`) in plain words, so a card can say "only on main" instead of
// leaving people to read GitHub's expression syntax.

/** `${{ expr }}` → `expr`: GitHub accepts conditions with or without the wrapper. */
const unwrap = (expr: string) =>
  expr
    .trim()
    .replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1")
    .trim();

const EVENTS: Record<string, string> = {
  push: "pushes",
  pull_request: "pull requests",
  pull_request_target: "pull requests",
  workflow_dispatch: "manual runs",
  schedule: "scheduled runs",
  release: "releases",
  merge_group: "the merge queue",
  workflow_call: "calls from other workflows",
};

const quoted = String.raw`'([^']*)'`;

/** One clause, like `github.ref == 'refs/heads/main'`, in words; null when it isn't a known shape. */
function clause(raw: string): string | null {
  const c = raw
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  let m: RegExpExecArray | null;

  const status: Record<string, string> = {
    "always()": "even if something failed",
    "success()": "only if everything before it passed",
    "failure()": "only if something failed",
    "cancelled()": "only if the run was cancelled",
    "!cancelled()": "unless the run was cancelled",
  };
  if (status[c]) return status[c];

  if ((m = new RegExp(String.raw`^github\.ref\s*(==|!=)\s*${quoted}$`).exec(c))) {
    const [, op, ref] = m;
    const name = ref.replace(/^refs\/(heads|tags)\//, "");
    const kind = ref.startsWith("refs/tags/") ? "tag " : "";
    return op === "==" ? `only on ${kind}${name}` : `not on ${kind}${name}`;
  }
  if ((m = new RegExp(String.raw`^github\.ref_name\s*(==|!=)\s*${quoted}$`).exec(c))) {
    return m[1] === "==" ? `only on ${m[2]}` : `not on ${m[2]}`;
  }
  if ((m = new RegExp(String.raw`^github\.event_name\s*(==|!=)\s*${quoted}$`).exec(c))) {
    const what = EVENTS[m[2]] ?? `${m[2]} events`;
    return m[1] === "==" ? `only on ${what}` : `not on ${what}`;
  }
  if ((m = new RegExp(String.raw`^startsWith\(\s*github\.ref\s*,\s*${quoted}\s*\)$`).exec(c))) {
    const prefix = m[1];
    if (prefix === "refs/tags/") return "only for tags";
    if (prefix.startsWith("refs/tags/")) return `only for tags like ${prefix.slice(10)}*`;
    if (prefix.startsWith("refs/heads/")) return `only on branches like ${prefix.slice(11)}*`;
  }
  if (/^github\.event\.pull_request\.merged(\s*==\s*true)?$/.test(c)) return "only when the pull request is merged";
  if (/^github\.event\.pull_request\.draft\s*==\s*false$|^!github\.event\.pull_request\.draft$/.test(c)) {
    return "not on draft pull requests";
  }
  if (
    (m = new RegExp(String.raw`^contains\(\s*github\.event\.pull_request\.labels\.\*\.name\s*,\s*${quoted}\s*\)$`).exec(
      c,
    ))
  ) {
    return `only with the ${m[1]} label`;
  }
  if ((m = new RegExp(String.raw`^github\.repository\s*(==|!=)\s*${quoted}$`).exec(c))) {
    return m[1] === "==" ? `only in ${m[2]}, not forks` : `not in ${m[2]}`;
  }
  if ((m = new RegExp(String.raw`^github\.actor\s*(==|!=)\s*${quoted}$`).exec(c))) {
    return m[1] === "==" ? `only for ${m[2]}` : `not for ${m[2]}`;
  }
  if ((m = new RegExp(String.raw`^matrix\.([\w-]+)\s*(==|!=)\s*${quoted}$`).exec(c))) {
    return m[2] === "==" ? `only when ${m[1]} is ${m[3]}` : `except when ${m[1]} is ${m[3]}`;
  }
  return null;
}

/** Splits on a top-level `&&` (not inside parentheses or quotes). */
function splitAnd(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'") quote = !quote;
    else if (!quote && ch === "(") depth++;
    else if (!quote && ch === ")") depth--;
    else if (!quote && depth === 0 && expr.startsWith("&&", i)) {
      parts.push(expr.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

/**
 * A condition in words: "only on pushes to main", "even if something failed". Conditions without
 * a known shape come back as written, shortened, so the card still says that there is one.
 */
export function describeCondition(expr: unknown): string | null {
  if (expr === undefined || expr === null || expr === "") return null;
  if (typeof expr === "boolean") return expr ? null : "never (turned off)";
  const text = unwrap(String(expr));
  if (!text) return null;
  const parts = splitAnd(text).map(clause);
  if (parts.every((p): p is string => p !== null)) {
    // "only on pushes" + "only on main" reads better as "only on pushes to main".
    const pushes = parts.indexOf("only on pushes");
    const branch = parts.findIndex((p) => /^only on (?!pushes|pull requests|manual|scheduled|releases)/.test(p));
    if (pushes !== -1 && branch !== -1) {
      const merged = `only on pushes to ${parts[branch].slice("only on ".length)}`;
      return [merged, ...parts.filter((_, i) => i !== pushes && i !== branch)].join(" and ");
    }
    return parts.join(" and ");
  }
  return `if ${text.length > 48 ? `${text.slice(0, 47)}…` : text}`;
}

/** Whether a condition keeps a job off pull requests (or to one branch, or to merged PRs only). */
export function guardsAgainstPullRequests(expr: unknown): boolean {
  if (typeof expr !== "string" || !expr.trim()) return false;
  const text = unwrap(expr);
  return (
    /github\.ref\s*==|github\.ref_name\s*==|startsWith\(\s*github\.ref\b/.test(text) ||
    /github\.event_name\s*==\s*'(?!pull_request)/.test(text) ||
    /github\.event_name\s*!=\s*'pull_request/.test(text) ||
    /github\.event\.pull_request\.merged/.test(text)
  );
}
