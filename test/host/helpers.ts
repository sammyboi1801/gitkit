import { afterEach, beforeEach } from "vitest";
import { PulseViewProvider } from "../../src/features/pulse/PulseViewProvider";
import type { HostToWebview, PulseState, WebviewToHost } from "../../src/shared/messages";
import type { RepoState } from "../../src/shared/types";
import { harness, Uri, type FakeWebview } from "../mocks/vscode";

// Drives the real extension-side code through the fake vscode module, the way the webview does.

const providers: PulseViewProvider[] = [];

beforeEach(() => {
  harness.reset();
  // Background work would race the temp-dir cleanup; tests that need it turn it back on.
  harness.config["gitkit.autoFetchMinutes"] = 0;
  harness.config["gitkit.ciStatus"] = false;
});

afterEach(() => {
  providers.splice(0).forEach((p) => p.dispose());
});

export function memento() {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T,
    update: async (key: string, value: unknown) => void values.set(key, value),
    keys: () => [...values.keys()],
  };
}

export interface Panel {
  provider: PulseViewProvider;
  webview: FakeWebview;
  send(message: WebviewToHost): Promise<void>;
  state(): PulseState;
  repo(): RepoState;
  posted<T extends HostToWebview["type"]>(type: T): Extract<HostToWebview, { type: T }>[];
}

/** Opens the Pulse panel on the given workspace folders and waits for the first state. */
export async function openPanel(...folders: string[]): Promise<Panel> {
  harness.folders = folders;
  const provider = new PulseViewProvider(Uri.file("/extension"), memento() as never);
  providers.push(provider);
  const webview = harness.resolveView(provider);
  const panel: Panel = {
    provider,
    webview,
    send: (message) => provider.receive(message),
    posted: (type) => webview.posted.filter((m) => (m as HostToWebview).type === type) as never,
    state: () => {
      const states = panel.posted("state");
      if (!states.length) throw new Error("No state posted yet");
      return states[states.length - 1].state;
    },
    repo: () => {
      const state = panel.state();
      if (state.kind !== "repo") throw new Error(`Expected a repo, got ${state.kind}`);
      return state.repo;
    },
  };
  await panel.send({ type: "ready" });
  return panel;
}
