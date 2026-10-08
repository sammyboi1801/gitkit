// Builds a throwaway repo for the F5 dev host, so GitKit is never pointed at a real repo while developing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", ".vscode-test", "sandbox");

if (existsSync(join(dir, ".git"))) {
  console.log(`sandbox ready: ${dir}`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });

// Identity is passed per command so the sandbox never touches anyone's git config.
const git = (...args) =>
  execFileSync("git", ["-c", "user.name=GitKit Sandbox", "-c", "user.email=sandbox@gitkit.local", ...args], {
    cwd: dir,
    stdio: "pipe",
  });
const write = (file, text) => writeFileSync(join(dir, file), text);

git("init", "-b", "main");
write("README.md", "# Sandbox\n\nA playground repo for GitKit.\n");
git("add", ".");
git("commit", "-m", "chore: initial commit");

write("app.py", "def greet(name):\n    return f'hello {name}'\n");
git("add", ".");
git("commit", "-m", "feat: add greet");

git("checkout", "-b", "feat/login");
write("login.py", "def login(user):\n    return True\n");
git("add", ".");
git("commit", "-m", "feat: add login stub");

// Leave some uncommitted work so the panels have something to show.
write("app.py", "def greet(name):\n    return f'hello, {name}!'\n");
write("notes.txt", "todo: real auth\n");

console.log(`sandbox created: ${dir}`);
