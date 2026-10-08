import type { WebviewToHost } from "../../src/shared/messages";

// acquireVsCodeApi may only be called once per webview.
const api = acquireVsCodeApi();

export const send = (message: WebviewToHost): void => api.postMessage(message);

export function loadDraft(): string {
  return api.getState<{ draft?: string }>()?.draft ?? "";
}

export function saveDraft(draft: string): void {
  api.setState({ draft });
}
