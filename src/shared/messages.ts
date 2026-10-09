// Message protocol between the extension host and the Pulse webview.
import type { ActionRequest } from "../git/actions";
import type { Resolution } from "../git/conflicts";
import type { ProjectFacts, WorkflowModel } from "../workflow/model";
import type { Explanation } from "../workflow/yaml";
import type { CommitDetails, ConflictBlock, RepoState, RepoSummary } from "./types";

export type PulseState =
  | { kind: "loading" }
  | { kind: "no-folder" }
  | { kind: "no-repo"; folder: string }
  /** repos lists every repo in the workspace when there's more than one; empty otherwise. */
  | { kind: "repo"; repo: RepoState; repos: RepoSummary[] }
  | { kind: "error"; message: string };

export interface ActionError {
  command: string;
  message: string;
}

export type HostToWebview =
  | { type: "state"; state: PulseState }
  | { type: "busy"; label: string | null }
  | { type: "error"; error: ActionError }
  | { type: "commitDetails"; details: CommitDetails }
  | { type: "fetching"; active: boolean }
  | { type: "config"; mainBranchColor: string }
  | { type: "conflictDetails"; path: string; blocks: ConflictBlock[] };

export type WebviewToHost =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "openFolder" }
  | { type: "initRepo" }
  | { type: "openFile"; path: string }
  | { type: "action"; request: ActionRequest }
  | { type: "pickBranch" }
  | { type: "branchFrom"; hash: string }
  | { type: "copyHash"; hash: string }
  | { type: "commitDetails"; hash: string }
  | { type: "selectRepo"; root: string }
  | { type: "openBranchMap" }
  | { type: "conflictDetails"; path: string }
  | { type: "resolveConflict"; path: string; block: number | "all"; choice: Resolution }
  | { type: "openMergeEditor"; path: string }
  | { type: "oops" }
  | { type: "signInGitHub" }
  | { type: "openUrl"; url: string }
  | { type: "rerunFailed" }
  | { type: "createPr" }
  | { type: "cleanupBranches" };

// --- Workflow Studio ------------------------------------------------------------------------

export interface WorkflowFile {
  file: string;
  /** Written by Workflow Studio, so it can be edited visually again. */
  byGitKit: boolean;
  /** One line for the start screen, e.g. "CI · on push, on pull requests · 3 jobs". */
  summary: string;
}

export type StudioToHost =
  | { type: "ready" }
  | { type: "new" }
  | { type: "open"; file: string }
  | { type: "openFile"; file: string }
  | { type: "save"; model: WorkflowModel };

export type HostToStudio =
  | { type: "init"; repoName: string; facts: ProjectFacts; suggestion: WorkflowModel; files: WorkflowFile[] }
  | { type: "opened"; file: string; model: WorkflowModel | null; imported: boolean; explanation: Explanation }
  | { type: "saved"; file: string; files: WorkflowFile[] }
  | { type: "error"; message: string };
