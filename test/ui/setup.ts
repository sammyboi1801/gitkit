import { cleanup } from "@testing-library/svelte";
import { afterEach, beforeEach } from "vitest";

// Webviews talk to the extension through acquireVsCodeApi(); tests record what they send.
export const sent: unknown[] = [];
let viewState: unknown;

(globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => sent.push(message),
  getState: () => viewState,
  setState: (state: unknown) => (viewState = state),
});

// jsdom doesn't implement scrolling; webviews (real Chromium) do.
Element.prototype.scrollTo ??= function scrollTo() {};

beforeEach(() => {
  sent.length = 0;
  viewState = undefined;
});

afterEach(() => cleanup());
