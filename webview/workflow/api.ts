import type { StudioToHost } from "../../src/shared/messages";

// acquireVsCodeApi may only be called once per webview.
const api = acquireVsCodeApi();

export const send = (message: StudioToHost): void => api.postMessage(message);
