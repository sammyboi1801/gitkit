// How long GitKit's refresh takes on a big repo: builds a synthetic one (20,000 commits, 5,000
// files, 200 branches, 5 worktrees with uncommitted work) and times readRepo, the read behind every
// refresh of the sidebar and the Branch Map.   node scripts/perf.mjs [--keep]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, ".vscode-test", "perf");
const repo = join(base, "big");
const COMMITS = 20_000;
const FILES = 5_000;
const BRANCHES = 200;
const WORKTREES = Number(process.argv.find((a) => a.startsWith("--worktrees="))?.split("=")[1] ?? 5);

rmSync(base, { recursive: true, force: true });
mkdirSync(repo, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe", maxBuffer: 1 << 30 });

console.log(`Building ${COMMITS} commits, ${FILES} files, ${BRANCHES} branches…`);
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.name", "Perf");
git(repo, "config", "user.email", "perf@example.com");

// fast-import writes history in one go instead of 20,000 git commit calls.
const lines = [];
const who = "Perf <perf@example.com>";
let mark = 0;
const commit = (ref, message, files, parent) => {
  mark++;
  lines.push(`commit ${ref}`, `mark :${mark}`, `committer ${who} ${1700000000 + mark} +0000`);
  lines.push(`data ${Buffer.byteLength(message)}`, message);
  if (parent) lines.push(`from :${parent}`);
  for (const [path, text] of files) lines.push(`M 100644 inline ${path}`, `data ${Buffer.byteLength(text)}`, text);
  lines.push("");
  return mark;
};
const first = Array.from({ length: FILES }, (_, i) => [`src/dir${i % 50}/file${i}.ts`, `export const v${i} = ${i};\n`]);
let tip = commit("refs/heads/main", "chore: initial import", first);
const branchPoints = [];
for (let i = 1; i < COMMITS; i++) {
  const f = i % FILES;
  tip = commit("refs/heads/main", `feat: change ${i}`, [[`src/dir${f % 50}/file${f}.ts`, `export const v${f} = ${i};\n`]], tip);
  if (i % Math.floor(COMMITS / BRANCHES) === 0) branchPoints.push(tip);
}
branchPoints.slice(0, BRANCHES).forEach((point, b) => {
  let head = point;
  for (let c = 0; c < 3; c++) {
    head = commit(`refs/heads/feature/${b}`, `feat(${b}): step ${c}`, [[`features/f${b}.ts`, `export const step = ${c};\n`]], head);
  }
});
execFileSync("git", ["fast-import", "--quiet"], { cwd: repo, input: lines.join("\n"), maxBuffer: 1 << 30 });
git(repo, "checkout", "-q", "-f", "main");

for (let w = 0; w < WORKTREES; w++) {
  const path = join(base, "big.worktrees", `agent-${w}`);
  git(repo, "worktree", "add", "-q", "-b", `agent/${w}`, path);
  for (let f = 0; f < 20; f++) writeFileSync(join(path, `src/dir${f}/file${f}.ts`), `// agent ${w} edit\n`);
  writeFileSync(join(path, `notes-${w}.md`), "work in progress\n");
}
for (let f = 0; f < 10; f++) writeFileSync(join(repo, `src/dir${f}/file${f}.ts`), "// local edit\n");

const bundle = join(base, "read-repo.mjs");
await esbuild.build({
  entryPoints: [join(root, "src", "git", "repo.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});
const { readRepo } = await import(pathToFileURL(bundle).href);

const times = [];
let state;
for (let run = 0; run < 6; run++) {
  const start = performance.now();
  state = await readRepo(repo);
  times.push(performance.now() - start);
}
const [cold, ...warm] = times;
warm.sort((a, b) => a - b);
console.log(`readRepo: first ${cold.toFixed(0)} ms, then median ${warm[Math.floor(warm.length / 2)].toFixed(0)} ms`);
console.log(
  `  graph ${state.graph.commits.length} commits in ${state.graph.lanes.length} lanes, ${state.status.files.length} changed files, ${state.worktrees.length} worktrees, ${state.worktreeOverlaps.length} overlaps`,
);
if (!process.argv.includes("--keep")) rmSync(base, { recursive: true, force: true });
