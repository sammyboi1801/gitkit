// Builds a throwaway repo (plus a local bare "remote") for the F5 dev host, so GitKit is never
// pointed at a real repo while developing. Pass --reset to rebuild it from scratch.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "2";
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

// main gets a commit on the remote that the local copy doesn't have yet: "1 new commit on the remote".
commit("fix: handle empty name", { "app.py": "def greet(name):\n    return f'hello, {name or \"friend\"}!'\n" });
git("push");
git("reset", "--hard", "HEAD~1");

// A published feature branch with one unpushed commit: "1 commit ready to push".
git("checkout", "-b", "feat/login");
commit("feat: add login stub", { "login.py": "def login(user):\n    return True\n" });
git("push", "-u", "origin", "feat/login");
commit("feat: check password length", { "login.py": "def login(user, password):\n    return len(password) >= 8\n" });

// Uncommitted work so the changes list has something in every group.
write("app.py", "def greet(name):\n    return f'hello, {name}!!'\n\n\ndef bye(name):\n    return f'bye {name}'\n");
write("notes.txt", "todo: real auth\n");
write("login.py", "def login(user, password):\n    # TODO: hash\n    return len(password) >= 8\n");
git("add", "login.py");

writeFileSync(marker, VERSION);
console.log(`sandbox created: ${dir}`);
