// Isolates every test from the machine it runs on: GitKit's own git calls (through runGit)
// inherit this environment, so a developer's aliases, hooks, signing or default branch, or
// CI's system config, can't change what the tests see.
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
process.env.LC_ALL = "C";
process.env.GIT_TERMINAL_PROMPT = "0";
