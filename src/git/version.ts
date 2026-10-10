// Which git is installed, and whether it's new enough for everything GitKit does.

/** git merge-tree --write-tree, behind conflict forecasts and spotting merged branches, needs 2.38. */
export const MIN_GIT: readonly [number, number] = [2, 38];

/** "git version 2.45.1.windows.1" → [2, 45, 1]. */
export function parseGitVersion(output: string): [number, number, number] | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

/** What to tell the user about this git, or null when it's new enough (or can't be read). */
export function gitVersionProblem(output: string): string | null {
  const version = parseGitVersion(output);
  if (!version) return null;
  const [major, minor] = version;
  if (major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1])) return null;
  return `This is git ${version.join(".")}, and GitKit needs ${MIN_GIT.join(".")} or newer for conflict forecasts and finding merged branches; everything else works. Update git from git-scm.com, then restart VS Code.`;
}
