// Pure checks run before a commit: secrets in added lines, files that shouldn't be committed,
// and committing under the wrong identity. All warn; none block on their own.

export interface GuardIssue {
  path: string;
  kind: "secret" | "sensitive-file" | "large-file";
  detail: string;
  line?: number;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, "a private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "a GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, "a GitHub token"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, "a Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "a Google API key"],
  [/\bsk_live_[0-9A-Za-z]{24,}\b/, "a Stripe live key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic API key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, "an OpenAI-style API key"],
];

// Template files are meant to be committed; they hold placeholders, not real values.
const TEMPLATE = /\.(example|sample|template|dist)$/i;

const SENSITIVE_FILES: [RegExp, string][] = [
  [/(^|\/)\.env(\.[^/]+)?$/, "an environment file, usually full of secrets"],
  [/\.(pem|key|p12|pfx|keystore|jks)$/i, "a key or certificate file"],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, "an SSH private key"],
  [/(^|\/)(credentials|service[-_]?account[^/]*)\.json$/i, "a credentials file"],
  [/(^|\/)\.(npmrc|pypirc|netrc)$/, "a config file that often holds tokens"],
];

/** Lines a commit would add, per file, from `git diff -U0` output. */
export function addedLines(diff: string): Map<string, { line: number; text: string }[]> {
  const files = new Map<string, { line: number; text: string }[]>();
  let current: { line: number; text: string }[] | null = null;
  let lineNo = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).replace(/^b\//, "");
      current = path === "/dev/null" ? null : [];
      if (current) files.set(path, current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (current && raw.startsWith("+")) current.push({ line: lineNo++, text: raw.slice(1) });
  }
  return files;
}

export function scanForSecrets(added: Map<string, { line: number; text: string }[]>): GuardIssue[] {
  const issues: GuardIssue[] = [];
  for (const [path, lines] of added) {
    for (const { line, text } of lines) {
      const hit = SECRET_PATTERNS.find(([pattern]) => pattern.test(text));
      if (hit) {
        issues.push({ path, line, kind: "secret", detail: `looks like ${hit[1]}` });
        break; // One finding per file is enough to make the point.
      }
    }
  }
  return issues;
}

export function checkFiles(files: readonly { path: string; size: number }[], maxBytes: number): GuardIssue[] {
  const issues: GuardIssue[] = [];
  for (const { path, size } of files) {
    const normalized = path.replace(/\\/g, "/");
    const sensitive = TEMPLATE.test(normalized) ? undefined : SENSITIVE_FILES.find(([p]) => p.test(normalized));
    if (sensitive) issues.push({ path, kind: "sensitive-file", detail: `is ${sensitive[1]}` });
    if (size > maxBytes) {
      issues.push({
        path,
        kind: "large-file",
        detail: `is ${(size / 1024 / 1024).toFixed(1)} MB; consider Git LFS or ignoring it`,
      });
    }
  }
  return issues;
}

// --- Identity -----------------------------------------------------------------------------

export interface IdentityRule {
  /** Glob on the remote, e.g. "github.com/neu-*" or "github.com/my-org/**". */
  remote?: string;
  /** Glob on the repo folder, e.g. "D:/Northeastern/**". */
  folder?: string;
  email: string;
  name?: string;
}

/** "git@github.com:org/repo.git" and "https://github.com/org/repo" both become "github.com/org/repo". */
export function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(?!\d)/, "$1/")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
}

export function globToRegExp(glob: string): RegExp {
  // "**" crosses folders, "*" and "?" stay within one; everything else is literal.
  const segment = (part: string) =>
    part
      .replace(/[.+^${}()|[\]]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]");
  const pattern = glob.replace(/\\/g, "/").split("**").map(segment).join(".*");
  return new RegExp(`^${pattern}$`, "i");
}

/** The first rule that applies to this repo, if any. Folder globs also match anything inside. */
export function matchIdentity(
  rules: readonly IdentityRule[],
  remoteUrl: string | null,
  folder: string,
): IdentityRule | undefined {
  const remote = remoteUrl ? normalizeRemote(remoteUrl) : null;
  const dir = folder.replace(/\\/g, "/");
  return rules.find((rule) => {
    if (rule.remote && !(remote && globToRegExp(rule.remote).test(remote))) return false;
    if (rule.folder && !globToRegExp(rule.folder.replace(/\/?$/, "/**")).test(dir + "/")) return false;
    return Boolean(rule.remote || rule.folder);
  });
}
