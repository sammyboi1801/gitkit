// Builds a throwaway repo (plus a local bare "remote") for the F5 dev host, so GitKit is never
// pointed at a real repo while developing. Pass --reset to rebuild it from scratch.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "4";
const root = join(import.meta.dirname, "..", ".vscode-test");
const dir = join(root, "sandbox");
const remote = join(root, "sandbox-remote.git");
const marker = join(dir, ".git", "gitkit-sandbox");

const current = existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;
if (current === VERSION && !process.argv.includes("--reset")) {
  console.log(`sandbox ready: ${dir}`);
  process.exit(0);
}

rmSync(dir, { recursive: true, force: true });
rmSync(remote, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// Identity is passed per command so the sandbox never touches anyone's git config.
const git = (...args) =>
  execFileSync("git", ["-c", "user.name=GitKit Sandbox", "-c", "user.email=sandbox@gitkit.local", ...args], {
    cwd: dir,
    stdio: "pipe",
  });
const write = (file, text) => writeFileSync(join(dir, file), text);
const commit = (message, files) => {
  for (const [file, text] of Object.entries(files)) write(file, text);
  git("add", ".");
  git("commit", "-m", message);
};

execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: "pipe" });
git("init", "-b", "main");
git("remote", "add", "origin", remote);

commit("chore: initial commit", { "README.md": "# Sandbox\n\nA playground repo for GitKit.\n" });
commit("feat: add greet", { "app.py": "def greet(name):\n    return f'hello {name}'\n" });

// A merged feature branch, so the graph has a fork and a merge.
git("checkout", "-b", "feat/ui");
commit("style: friendlier greeting", { "app.py": "def greet(name):\n    return f'hello, {name}!'\n" });
commit("feat: add banner", { "banner.txt": "*** Sandbox ***\n" });
git("checkout", "main");
commit("docs: usage notes", { "USAGE.md": "Run app.py\n" });
git("merge", "--no-ff", "feat/ui", "-m", "Merge branch 'feat/ui'");
git("tag", "v0.1.0");
git("push", "-u", "origin", "main", "--tags");
git("branch", "-D", "feat/ui");

// A published feature branch with one unpushed commit: "1 commit ready to push".
git("checkout", "-b", "feat/login");
commit("feat: add login stub", { "login.py": "def login(user):\n    return True\n" });
git("push", "-u", "origin", "feat/login");
// Also edits the greeting line, which a teammate changes on main below: a predicted conflict.
commit("feat: check password length", {
  "login.py": "def login(user, password):\n    return len(password) >= 8\n",
  "app.py": "def greet(name):\n    return f'welcome back, {name}!'\n",
});

// A teammate pushes to main from their own clone; fetching it shows up in the activity feed.
const teammate = join(root, "sandbox-teammate");
rmSync(teammate, { recursive: true, force: true });
execFileSync("git", ["clone", "-q", remote, teammate], { stdio: "pipe" });
const asAlex = (...args) =>
  execFileSync("git", ["-c", "user.name=Alex Chen", "-c", "user.email=alex@gitkit.local", ...args], {
    cwd: teammate,
    stdio: "pipe",
  });
writeFileSync(join(teammate, "app.py"), "def greet(name):\n    return f'hello, {name or \"friend\"}!'\n");
asAlex("commit", "-qam", "fix: handle empty name");
writeFileSync(join(teammate, "CHANGELOG.md"), "## 0.1.1\n- Greets nameless users\n");
asAlex("add", ".");
asAlex("commit", "-qm", "docs: changelog for 0.1.1");
asAlex("push", "-q");
rmSync(teammate, { recursive: true, force: true });
git("fetch", "origin");

// Uncommitted work so the changes list has something in every group.
write("app.py", "def greet(name):\n    return f'welcome back, {name}!!'\n\n\ndef bye(name):\n    return f'bye {name}'\n");
write("notes.txt", "todo: real auth\n");
write("login.py", "def login(user, password):\n    # TODO: hash\n    return len(password) >= 8\n");
git("add", "login.py");

buildMultiRepoWorkspace(join(root, "multi"));

writeFileSync(marker, VERSION);
console.log(`sandbox created: ${dir}`);

/**
 * A folder holding several repos, like opening a parent "projects" folder:
 *   api/          clean, but its remote has 2 new commits
 *   web/          uncommitted work, never published
 *   packages/ui/  nested two levels down, stopped mid-merge with a conflict
 *   notes/        a plain folder, not a repo (must not show up)
 */
function buildMultiRepoWorkspace(base) {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(join(base, "notes"), { recursive: true });
  writeFileSync(join(base, "notes", "ideas.md"), "Not a repo.\n");

  const repo = (path) => {
    const cwd = join(base, path);
    mkdirSync(cwd, { recursive: true });
    const run = (...args) =>
      execFileSync("git", ["-c", "user.name=GitKit Sandbox", "-c", "user.email=sandbox@gitkit.local", ...args], {
        cwd,
        stdio: "pipe",
      });
    const save = (message, files) => {
      for (const [file, text] of Object.entries(files)) writeFileSync(join(cwd, file), text);
      run("add", ".");
      run("commit", "-qm", message);
    };
    run("init", "-q", "-b", "main");
    return { cwd, run, save };
  };

  const api = repo("api");
  const apiRemote = join(base, ".remotes", "api.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", apiRemote], { stdio: "pipe" });
  api.run("remote", "add", "origin", apiRemote);
  api.save("feat: health endpoint", { "server.py": "def health():\n    return 'ok'\n" });
  api.save("feat: version endpoint", { "version.py": "VERSION = '1.0'\n" });
  api.save("fix: bump version", { "version.py": "VERSION = '1.1'\n" });
  api.run("push", "-q", "-u", "origin", "main");
  api.run("reset", "-q", "--hard", "HEAD~2");

  const web = repo("web");
  web.save("chore: scaffold", { "index.html": "<h1>Hello</h1>\n" });
  writeFileSync(join(web.cwd, "index.html"), "<h1>Hello, GitKit</h1>\n");
  writeFileSync(join(web.cwd, "style.css"), "h1 { color: teal; }\n");

  const ui = repo(join("packages", "ui"));
  ui.save("feat: button", { "button.ts": "export const label = 'Click';\n" });
  ui.run("checkout", "-q", "-b", "feat/label");
  ui.save("feat: clearer label", { "button.ts": "export const label = 'Click me';\n" });
  ui.run("checkout", "-q", "main");
  ui.save("feat: shorter label", { "button.ts": "export const label = 'Go';\n" });
  try {
    ui.run("merge", "feat/label");
  } catch {
    // Expected: the merge stops on the conflict, which is the state we want to show.
  }
}
