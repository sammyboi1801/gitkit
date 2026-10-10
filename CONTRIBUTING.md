# Contributing to GitKit

Thanks for helping. Bug reports and ideas are welcome as issues; for code, open a pull request against `main`.

## Setting up

You need Node.js 22 or newer and git 2.38 or newer.

```bash
npm install
npm run check             # typecheck, lint, unit and component tests, build
npm run test:integration  # a smoke test inside a real VS Code (downloaded once)
npm run watch             # rebuild on change
```

Press **F5** to launch GitKit against a throwaway sandbox repository with its own local remote, or choose **Run GitKit (multi-repo folder)** to try several repositories at once. `npm run sandbox -- --reset` rebuilds the sandboxes. Your own repositories are never touched.

## How it's built

- **Extension:** TypeScript, bundled with esbuild. Git runs directly (never through a shell), and its output is parsed by small modules in `src/git/` that don't depend on VS Code, so they can be unit-tested.
- **Panels:** Svelte 5 webviews in `webview/`, styled only with VS Code's theme variables. They talk to the extension through the typed messages in `src/shared/`.
- **Every change to a repository** goes through `planAction()` in `src/git/actions.ts`, which also produces the command preview shown on hover.

## Tests

- `npm test` runs everything that doesn't need VS Code: parsers and logic against real git output on temporary repositories (with no global git configuration, so they behave the same on every machine), the extension code through a scriptable fake of the VS Code API, and the panels rendered in jsdom. CI runs it on Linux, Windows and macOS.
- `npm run tour` (Windows only) opens a real VS Code on a made-up project, performs every main action step by step, checks the result in git, and screenshots each step into `.vscode-test/tour/shots`. The README's images come from it.
- `node scripts/perf.mjs` times a refresh on a synthetic repository with 20,000 commits, 200 branches and 5 worktrees.

A bug fix comes with a test that fails without the fix.

After adding or updating a dependency, run `npm run notices` to refresh `ThirdPartyNotices.txt`; a test fails until it lists every bundled package.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), one logical change per commit, for example `fix(pulse): keep the commit draft when switching repos`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
