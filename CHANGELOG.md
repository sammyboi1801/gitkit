# Changelog

## Unreleased

- **Workflow Studio does all of GitHub Actions with controls:**
  - Any event can be a trigger, each with its own options: branch, tag and file filters (only these, or all except), activity types, several schedules with timezones, Run-button inputs, a reusable workflow's inputs, secrets and outputs, and which workflows to run after. Nothing is locked as "kept as written" any more.
  - Job cards say when the job runs ("only on pushes to main"), picked from a list of common conditions; steps get their own list (like "even if a step failed").
  - Warnings that don't block saving: a deploy that would run on every pull request (with a one-click fix), and running a pull request's own code on pull_request_target.
  - Saving a hand-written workflow edits only what changed, keeping its comments and formatting.
  - Jobs get an environment URL, concurrency, outputs, a default shell, matrix combinations to add or skip, a limit on how many run at once, runner label lists, and can run a reusable workflow. The workflow gets custom permissions, concurrency and a default shell.
  - Save catches trigger mistakes GitHub would reject, like a cron without five fields or a choice input without options.
- **Clearer wording throughout:** the header says "in sync with remote" and leads with main's conflicts; nothing claims to be up to date before the first check; the fork picture uses the graph's colors; your own pushes fold into one line of the activity feed; the Undo list says "Went back to <commit>" instead of a hash; Checkpoint and "Commit 2 files" say what they do; worktree overlaps say whose change is committed; and the update button is "Merge main" everywhere.
- The Branch Map and graph draw every fetched commit you haven't pulled as "not pulled yet", including teammates' new commits on main.
- **A clearer paused merge:** one instruction instead of two, conflicts right under it (ahead of the Remote card), and Continue shows how many files are left. Pull, Push and Sync are off until the merge is finished or aborted, the outdated conflict forecast is hidden, and Open in the merge editor leads each conflicted file while Keep both is the quieter choice.
- **New commits from teammates are announced:** when a background check finds that someone pushed to your branch or to main, a pop-up says who and how many (with Pull when it would just fast-forward), and a count appears on the GitKit icon until you look. `gitkit.newCommitAlerts` chooses a pop-up, only the count, or nothing. Background checks now also run while the GitKit panel is hidden.
- **Why CI failed:** under the CI row, each failed job with the step it stopped at and the errors GitHub reported (failing tests, lint errors), linked to their file and line. The failed step's log opens in a read-only tab with the cursor on the first error.
- Turning off `gitkit.ciStatus` now hides the CI and pull request rows right away, instead of leaving the last results.
- **Workflow Studio checks workflows against GitHub's official schema** before saving, so a typo in a YAML box is caught with a plain explanation ("jobs › test: GitHub doesn't know "runs_on"").
- **Open in Workflow Studio** from a workflow file's right-click menu or editor title bar.
- **Removing a worktree** closes the terminals open in it first (Windows can't delete a folder in use), and no longer reports an error when only the emptied folder is still briefly in use.
- A merge or rebase that **stops on conflicts** is shown as paused, not as a failed command.
- **Readability:** incoming-work colors readable in every theme, ↑/↓ counts drawn as icons, Pull/Push/Sync fit a narrow sidebar, commit subjects keep their space next to branch badges (extra badges fold into "+N" when narrow).
- **Tested on real VS Code:** an end-to-end tour (`npm run tour`) performs every action in a real window and screenshots it; CI now also runs on macOS.
- **Faster refreshes with many worktrees:** other worktrees' details are reused for a few seconds, so a refresh with five worktrees costs the same as with none.
- Job cards in Workflow Studio get icons from what the job does (lint, test, build, deploy, release).
- **Worktrees:** every worktree listed with its branch, uncommitted files, distance from main and last activity; create (with a setup command and copied files), open in a new window or this one, lock, remove and clean up. Branches open in another worktree are labelled everywhere, and switching or deleting them says where they're open.
- **Agents side by side:** worktrees that changed the same files are flagged, with an in-memory forecast of whether their commits would conflict.
- **Checkpoints** of a worktree's files (new files included), saved when a coding agent starts in a terminal, before removing a worktree with uncommitted work, or by hand; restorable from the Undo list. They never touch your files, staging area or stashes.
- **Pull request readiness** in the Remote card and the Branch Map, and **Open a PR** with a title and description drafted from the commits.
- **Branch Map:** remote status strip (upstream, main, CI, PR, last check), legend, readable remote flags, a lane for branches with no commits yet, hover details on branch flags, and tooltips that stay visible when the map is scrolled.
- **Workflow Studio:** any workflow opens as editable jobs (keeping what Studio doesn't model), a steps editor for your own flows, schedules picked from lists, custom runner labels.
- Command previews no longer quote revisions like `HEAD~1`.

## 0.1.0

First release.

- **Pulse panel:** repo status in one sentence; Pull, Push and Sync with command previews; changes with line counts; stage, unstage, undoable discard; commit box; branch switcher.
- **Remote card:** drift from main, in-memory conflict forecast, Update from main (merge or rebase, with a backup first), remote activity feed, focused-only auto-fetch.
- **CI status** for the latest pushed commit, with re-run of failed jobs.
- **Branch lanes** in the sidebar and a horizontal **Branch Map** tab; merged branches recovered from merge messages; configurable main-branch colour.
- **Interactive Branch Map:** drag a branch onto another to merge or rebase (with a conflict forecast), branch and commit menus, compact mode that folds quiet stretches into +N, fit to window, search, author initials and a people filter, keyboard navigation.
- **Conflict viewer** with plain-English sides, keep yours/incoming/both, merge editor for any repo, Continue and Abort.
- **Oops menu** and **undo timeline**: undo or amend the last commit, move commits to a new branch, recover deleted branches, restore discarded changes, untrack files, clean up merged (including squash-merged) branches.
- **Commit guard** for secrets, sensitive and large files, and the wrong identity per repo.
- **Workflow Studio**: starts from goals (checks, PR tests, Docker publish, releases, Pages, schedules), triggers as an editable sentence, jobs as a pipeline of cards, job-level permissions, YAML on demand, and plain-English reading of existing workflows.
- **Multi-repo folders**: repository list, follow the active editor, per-repo commit drafts.
- **Works in a narrow sidebar:** buttons collapse to icons instead of clipping.
- **Reliable everywhere:** git output is forced to be the same on every machine (language, colours, path quoting), actions plan from fresh repo state, and over 230 tests run on Linux and Windows plus a smoke test inside VS Code.
