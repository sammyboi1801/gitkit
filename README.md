<p align="center">
  <img src="media/icon.png" width="112" alt="GitKit logo" />
</p>

<h1 align="center">GitKit</h1>

<p align="center">
  <strong>Everyday git and GitHub in VS Code, made visual and safe.</strong>
</p>

<p align="center">
  <a href="https://github.com/sammyboi1801/gitkit/actions/workflows/ci.yml"><img src="https://github.com/sammyboi1801/gitkit/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.95%2B-007ACC.svg" alt="VS Code 1.95 or newer" />
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#settings">Settings</a> ·
  <a href="#privacy-and-security">Privacy</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

GitKit adds a sidebar to VS Code that shows where your repository stands at a glance, puts committing, pushing and syncing one click away, and makes the riskier parts of git (rebases, conflicts, undoing mistakes) safe and understandable.

**Nothing happens behind your back.** Every action shows the exact `git` command it will run, actions that change history ask first, and discarded work is kept so it can be restored.

## Features

### Repository status

- **A one-sentence summary** of where you stand: _"1 commit ready to push"_, _"3 new commits on the remote"_, _"Diverged: 2 to push, 1 to pull"_.
- **Pull, Push and Sync**, with the right one highlighted. Pull only fast-forwards, so it never creates a surprise merge commit.
- **Changes with line counts** (`+12 −3`) per file, one-click staging, and a commit box that commits everything when nothing is staged.
- **Undoable discard:** discarded changes are saved as a stash and can be restored from _Saved changes_.
- **Branch switcher** showing what each branch is ahead or behind by, which exist only locally, and which lost their remote branch.

### Remote awareness

- **Drift from main:** how many commits your branch and main have each gained since you branched.
- **Conflict forecast:** GitKit test-merges in memory, without touching your files, and reports _"would conflict in app.py"_ or _"merges cleanly"_ before you do anything.
- **Update from main** in one click: it merges into published branches and rebases unpublished ones, after saving a backup.
- **Team activity** such as _"Alex Chen added 2 commits to origin/main"_, read from your own fetch history.
- **CI status** for your latest pushed commit, with **Re-run failed jobs**. Public repositories need no sign-in.
- Background fetching every few minutes, only while VS Code is focused.

### Branch lanes and the Branch Map

Each branch gets its own lane and color, with main always first, so branches visibly fork off and merge back. Merged branches stay visible after deletion, because GitKit recovers their names from merge messages. Hollow dots mark commits you haven't pushed; faded, dashed ones are on the remote but not yet pulled.

The **Branch Map** opens the same view horizontally in an editor tab, and you can work in it directly:

| Action          | How                                                                               |
| --------------- | --------------------------------------------------------------------------------- |
| Merge or rebase | Drag one branch onto another; the confirmation forecasts conflicts first          |
| Branch actions  | Click a branch name: switch, merge, rebase, branch from here, delete              |
| Commit actions  | Right-click a commit: revert, cherry-pick, branch from here, copy hash            |
| Navigate        | Scroll to zoom, drag to pan, arrow keys step through commits, `0` fits the window |
| Long histories  | Quiet stretches fold into **+N** groups that expand on click                      |
| Find work       | Search by message, author or hash; filter by person; hover a lane to isolate it   |

### Conflict resolution

When a merge or rebase stops, each conflict is shown as **Yours** against **Incoming**, with _Keep yours_, _Keep incoming_, _Keep both_ and _Open in the merge editor_. During a rebase the labels become **Upstream** and **Your commit**, because git's "ours" and "theirs" swap meaning there. Resolutions go through the editor, so they can be undone with Ctrl+Z. Finish with **Continue**, or **Abort** to return to exactly where you started.

### Oops: fix a mistake

A single menu for the problems people most often search for:

- Undo the last commit and keep its changes (or revert it safely if it's already pushed)
- Reword the last commit, or add forgotten changes to it
- Move commits made on the wrong branch to a new one
- Recover a deleted branch
- Restore discarded changes
- Stop tracking a file while keeping it on disk
- Delete merged branches, **including squash-merged ones**
- Step back through an **undo timeline** of commits, merges, rebases and resets; undo is itself undoable

### Commit guard

Before each commit, GitKit reviews the lines being added and warns about:

- **Likely secrets**, including AWS, GitHub, Slack, Stripe, Google, OpenAI and Anthropic keys and private keys, with a jump to the exact line.
- **Files that rarely belong in a repository**, such as `.env` files, keys, credentials and very large files, with an option to leave them out and ignore them.
- **The wrong identity** for the repository, based on your `gitkit.identities` rules, for anyone who uses separate work, school and personal addresses.

### Workflow Studio

Create GitHub Actions workflows without writing YAML. Studio starts from **what you want to automate**: checking every push, testing pull requests, publishing a Docker image, releasing on a version tag, deploying to GitHub Pages, running a scheduled job, or starting from scratch. Goals that fit your project are marked as recommended.

- Triggers read as a sentence, _"CI runs on pushes to main and on pull requests"_, where each part is editable.
- Jobs appear as a pipeline of cards. Choose Linux, Windows or macOS, toggle the versions to test, and set what runs after what.
- **Least privilege by default:** workflows get read-only access, and only the jobs that need more (such as publishing an image) receive it.
- Problems are explained on the card they belong to; the generated YAML is one click away.
- Existing workflows open as a plain-English summary. Workflows created in Studio remain editable in Studio.

### Multi-repository folders

Open a parent folder and GitKit discovers every repository inside it. Each appears under **Repositories** with its branch, ahead/behind count, changes and conflicts. GitKit follows the file you are editing and keeps a separate commit draft per repository.

## Getting started

### Requirements

- VS Code 1.95 or newer
- git 2.38 or newer (used for the conflict forecast and merged-branch detection)

### Installation

Until GitKit is published on the Marketplace, install it from a `.vsix` package:

1. Build the package with `npm install` and `npm run package`, or download it from a release.
2. In VS Code, open the Extensions view, choose **…** → **Install from VSIX…**, and select `gitkit-<version>.vsix`.

### First steps

1. Open a folder that contains a git repository.
2. Select the **GitKit** icon in the activity bar.
3. Use the icons at the top of the panel to open **Oops**, the **Branch Map** and **Workflow Studio**.

## Commands

All commands are available from the Command Palette under **GitKit**.

| Command                             | Description                                       |
| ----------------------------------- | ------------------------------------------------- |
| `GitKit: Refresh`                   | Re-read every repository in the workspace         |
| `GitKit: Open Branch Map`           | Open the interactive branch diagram               |
| `GitKit: Oops: Fix a Mistake…`      | Undo, recover or clean up with guided fixes       |
| `GitKit: Clean Up Merged Branches…` | Find and delete merged and squash-merged branches |
| `GitKit: Open Workflow Studio`      | Create or review GitHub Actions workflows         |

## Settings

| Setting                            | Default | Description                                                                                       |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `gitkit.autoFetchMinutes`          | `5`     | How often to check the remote while VS Code is focused. `0` disables it.                          |
| `gitkit.mainBranchColor`           | `blue`  | Color of the main branch: `blue`, `green`, `purple`, `orange`, `red`, `yellow`, or any CSS color. |
| `gitkit.repoScanDepth`             | `2`     | How many folder levels to search for repositories.                                                |
| `gitkit.followActiveEditor`        | `true`  | Switch to the repository of the file you are editing.                                             |
| `gitkit.commitGuard.enabled`       | `true`  | Check commits for secrets, sensitive files and large files.                                       |
| `gitkit.commitGuard.maxFileSizeMB` | `10`    | File size, in MB, above which the commit guard warns.                                             |
| `gitkit.identities`                | `[]`    | Expected commit email per remote or folder (see below).                                           |
| `gitkit.ciStatus`                  | `true`  | Show GitHub check results for the latest pushed commit.                                           |

Example identity rules; the first matching rule applies:

```json
"gitkit.identities": [
  { "remote": "github.com/my-university-org/**", "email": "me@university.edu" },
  { "folder": "D:/Work", "email": "me@company.com", "name": "My Name" }
]
```

## Privacy and security

- GitKit runs your local `git`. It contacts the network only for `git fetch` and, when CI status is enabled, the GitHub API for your repository's check results.
- There is no telemetry.
- GitHub sign-in uses the account VS Code already manages, and is requested only when you choose **Sign in**.
- Webviews run with a strict content security policy, and commands are executed without a shell, so branch and file names cannot inject commands.

## Contributing

```bash
npm install
npm run check             # typecheck, lint, unit and component tests, build
npm run test:integration  # smoke test inside a real VS Code (downloaded once)
npm run watch             # rebuild on change
```

Press **F5** to launch GitKit against a throwaway sandbox repository, or choose **Run GitKit (multi-repo folder)** to try several repositories at once. `npm run sandbox -- --reset` rebuilds the sandboxes.

Tests run on temporary repositories with no global git configuration, so they behave identically on every machine. Extension code is exercised through a scriptable fake of the VS Code API, webview components are rendered in jsdom, and CI runs the suite on Linux and Windows plus a smoke test inside VS Code.

## License

[MIT](LICENSE) © Sam Selvaraj
