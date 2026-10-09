# GitKit

**Everyday git and GitHub, made visual and safe.** GitKit is a sidebar for VS Code that shows where your repo stands at a glance, lets you commit, push and sync in a click, and makes the scary parts of git (rebases, conflicts, undo) feel safe.

Every button shows the exact `git` command it will run before it runs it. Nothing happens behind your back.

## What you get

### Pulse: your repo at a glance

- **One sentence on where you stand:** _"1 commit ready to push"_, _"3 new commits on the remote"_, _"Diverged: 2 to push, 1 to pull. Sync replays yours on top"_.
- **Pull, Push and Sync**, with the one that makes sense right now highlighted. Pull only fast-forwards, so you never get a surprise merge commit.
- **Changes with line counts** (`+12 −3`) for every file, stage and unstage in a click, and a commit box that commits everything when nothing is staged.
- **Discard is undoable.** Discarded changes go to a stash, and _Saved changes_ lets you restore them.
- **Switch branches** from a list showing what each branch is ahead or behind by, which are local only, and which had their remote branch deleted.

### Remote: know what's coming before you merge

- **How far your branch and main have drifted apart** since you branched, drawn as a small fork.
- **Conflict forecast.** GitKit test-merges in memory, without touching your files, and tells you _"would conflict in app.py"_ or _"merges cleanly"_ before you do anything.
- **Update from main** in one click. It merges into branches you've already published and rebases ones you haven't, after saving a backup.
- **Activity:** _"Alex Chen added 2 commits to origin/main · 20m ago"_, read from your own fetch history. No sign-in needed.
- **CI status** for your latest pushed commit, with **Re-run failed jobs**. Public repos need no sign-in.
- Checks the remote quietly every few minutes, and only while you're looking.

### Branch lanes and the Branch Map

- **Every branch gets its own lane and colour**, and main is always the first, straight one. Branches visibly fork off and merge back.
- **Merged branches stay visible** even after they're deleted: GitKit recovers their names from merge messages.
- Hollow dots are commits you haven't pushed; faded, dashed ones are on the remote but not pulled yet.

The **Branch Map** opens the same picture horizontally in an editor tab, like a whiteboard diagram, and you can work in it directly:

- **Drag one branch onto another** to merge or rebase. Before anything runs, the confirmation tells you whether the merge would conflict.
- **Click a branch name** for _Switch to_, _Merge into current_, _Rebase current onto_, _New branch from here_ or _Delete_. **Right-click a commit** for _Revert_, _Cherry-pick_, _New branch from here_ or _Copy hash_.
- **Long histories fit:** quiet stretches fold into **+N** (click to open), and **Fit** zooms the whole thing into the window.
- **See who did what:** every commit shows its author's initials, and the **People** row highlights one person's commits.
- **Find commits** by message, author or hash. Hover a lane to pick out one branch; arrow keys step through commits.

### Conflicts, explained

When a merge or rebase stops, GitKit shows each clash as **Yours** against **Incoming** in plain words, with _Keep yours_, _Keep incoming_, _Keep both_, or _Open in the merge editor_. During a rebase the labels change to **Upstream** and **Your commit**, because git's "ours" and "theirs" swap meaning there. Then press **Continue**, or **Abort** to put everything back.

### Oops: fix a mistake

One menu for the things everyone searches for:

- Undo my last commit (keep the changes); if it's already pushed, GitKit offers a safe revert instead
- Change the last commit's message, or add forgotten changes to it
- I committed to the wrong branch
- Recover a deleted branch
- Get back changes I discarded
- Stop tracking a file but keep it on disk (and ignore it)
- Clean up branches that are already merged, **including squash-merged ones**
- Go back in time through an **undo timeline** of commits, merges, rebases and resets. Undo is itself undoable.

### Commit guard

Before each commit, GitKit checks what you're about to add, and offers a fix when it finds something:

- **Likely secrets** (AWS, GitHub, Slack, Stripe, Google, OpenAI and Anthropic keys, private keys): _Show me_ jumps to the line.
- **Files that shouldn't be committed** (`.env`, keys, credential files) and **huge files**: _Leave those out_ unstages them and ignores new ones.
- **The wrong email for this repo**, using your rules in `gitkit.identities`. Handy if you have a work or school address and a personal one.

### Workflow Studio

Build GitHub Actions workflows without writing YAML. It starts with **what you want to automate**:

- _Check every push_, _Test pull requests_, _Publish a Docker image_, _Release when I tag a version_, _Deploy a site to GitHub Pages_, _Run something on a schedule_, or start from scratch. Goals that fit your project are marked as recommended.
- **Triggers read as a sentence**, _"CI runs on pushes to main and on pull requests"_, and each part is a chip you click to change.
- **Jobs are cards in a pipeline**, left to right in the order they run. Add a job after any step, pick Linux, Windows or macOS, and toggle the versions to test on.
- **Least privilege by default:** read-only access, and jobs that need more (publishing an image, creating a release) get it for that job only. Studio tells you which ones.
- Plain-English problems on the card they belong to, and the YAML whenever you want to see it.
- Existing workflows open in plain English; ones made in Studio can be edited visually again.

### Many repos in one folder

Open a parent folder and GitKit finds every repo inside it, a couple of levels deep. Each one gets a row in **Repositories** with its branch, ahead/behind count, changes and conflicts. GitKit follows the file you're editing, and keeps a separate commit draft for each repo.

## Getting started

1. Install GitKit and open a folder that contains a git repository.
2. Click the **GitKit** icon in the activity bar.
3. That's it. The icons at the top of the panel open **Oops**, the **Branch Map** and **Workflow Studio**.

Requires git 2.38 or newer, for the conflict forecast and merged-branch detection.

## Settings

| Setting                            | Default | What it does                                                                                                 |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `gitkit.autoFetchMinutes`          | `5`     | How often to check the remote while VS Code is focused. `0` turns it off.                                    |
| `gitkit.mainBranchColor`           | `blue`  | Colour of main/master in the graph: `blue`, `green`, `purple`, `orange`, `red`, `yellow`, or any CSS colour. |
| `gitkit.repoScanDepth`             | `2`     | How deep to look for repositories inside the opened folder.                                                  |
| `gitkit.followActiveEditor`        | `true`  | Switch to the repository of the file you're editing.                                                         |
| `gitkit.commitGuard.enabled`       | `true`  | Check commits for secrets, sensitive files and large files.                                                  |
| `gitkit.commitGuard.maxFileSizeMB` | `10`    | Size above which a file gets a warning.                                                                      |
| `gitkit.identities`                | `[]`    | Which email to commit with, by remote or folder. See below.                                                  |
| `gitkit.ciStatus`                  | `true`  | Show GitHub check results for the latest pushed commit.                                                      |

Example `gitkit.identities`:

```json
"gitkit.identities": [
  { "remote": "github.com/my-university-org/**", "email": "me@university.edu" },
  { "folder": "D:/Work", "email": "me@company.com", "name": "My Name" }
]
```

## Privacy

GitKit runs your local `git` and talks to the network only for `git fetch` and, if CI status is on, the GitHub API for your repo's check results. It has no telemetry. Signing in to GitHub uses the account VS Code already manages, and GitKit only asks when you click **Sign in**.

## Development

```
npm install
npm run check             # typecheck, lint, tests, build
npm run test:integration  # smoke test inside a real VS Code (downloads it once)
npm run watch             # rebuild on change
```

Tests run on throwaway git repos with no global git config, so they behave the same on every machine. Extension-side code is driven through a scriptable fake of the VS Code API, and webview components render in jsdom.

Press **F5** to launch GitKit on a throwaway sandbox repository, or pick **Run GitKit (multi-repo folder)** to try it on several repos at once. `npm run sandbox -- --reset` rebuilds the sandboxes.

## License

[MIT](LICENSE)
