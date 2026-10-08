import type { WebviewToHost } from "../../src/shared/messages";

// acquireVsCodeApi may only be called once per webview.
const api = acquireVsCodeApi();

interface ViewState {
  /** Unsent commit messages, per repo root. */
  drafts?: Record<string, string>;
  reposCollapsed?: boolean;
  /** Collapsed sections by name, e.g. "history". */
  collapsed?: Record<string, boolean>;
}

const read = (): ViewState => api.getState<ViewState>() ?? {};
const write = (patch: Partial<ViewState>) => api.setState({ ...read(), ...patch });

export const send = (message: WebviewToHost): void => api.postMessage(message);

export function loadDraft(root: string): string {
  return read().drafts?.[root] ?? "";
}

export function saveDraft(root: string, draft: string): void {
  const drafts = { ...read().drafts };
  if (draft) drafts[root] = draft;
  else delete drafts[root];
  write({ drafts });
}

export function loadReposCollapsed(): boolean {
  return read().reposCollapsed ?? false;
}

export function saveReposCollapsed(collapsed: boolean): void {
  write({ reposCollapsed: collapsed });
}

export function loadCollapsed(section: string, fallback: boolean): boolean {
  return read().collapsed?.[section] ?? fallback;
}

export function saveCollapsed(section: string, collapsed: boolean): void {
  write({ collapsed: { ...read().collapsed, [section]: collapsed } });
}
