// Message protocol between the extension host and the Pulse webview.

export type PulseState =
  | { kind: "loading" }
  | { kind: "no-folder" }
  | { kind: "no-repo"; folder: string }
  | { kind: "repo"; folder: string; branch: string; command: string }
  | { kind: "error"; message: string };

export type HostToWebview = { type: "state"; state: PulseState };

export type WebviewToHost = { type: "ready" } | { type: "refresh" };
