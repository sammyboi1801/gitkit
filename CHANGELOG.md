# Changelog

## Unreleased

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
