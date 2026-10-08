// Message protocol between the extension host and the Pulse webview.
import type { ActionRequest } from "../git/actions";
import type { CommitDetails, RepoState } from "./types";

export type PulseState =
  | { kind: "loading" }
  | { kind: "no-folder" }
  | { kind: "no-repo"; folder: string }
  | { kind: "repo"; repo: RepoState }
  | { kind: "error"; message: string };

export interface ActionError {
  command: string;
  message: string;
}

export type HostToWebview =
  | { type: "state"; state: PulseState }
  | { type: "busy"; label: string | null }
  | { type: "error"; error: ActionError }
  | { type: "commitDetails"; details: CommitDetails };

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
  | { type: "commitDetails"; hash: string };
