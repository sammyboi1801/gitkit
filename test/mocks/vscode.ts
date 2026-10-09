// A scriptable stand-in for the `vscode` module, so extension-side code can be tested on real
// throwaway repos without launching VS Code. Tests queue answers for dialogs and inspect what
// the extension showed, opened or ran. Only the API surface GitKit uses is implemented.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Listener<T> = (value: T) => void;

class Emitter<T> {
  private listeners: Listener<T>[] = [];
  event = (listener: Listener<T>) => {
    this.listeners.push(listener);
    return new Disposable(() => (this.listeners = this.listeners.filter((l) => l !== listener)));
  };
  fire(value: T) {
    this.listeners.forEach((l) => l(value));
  }
}

export class Disposable {
  constructor(private readonly onDispose: () => void = () => {}) {}
  dispose() {
    this.onDispose();
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
    readonly query = "",
  ) {}
  static file(path: string) {
    return new Uri("file", resolve(path));
  }
  static parse(value: string) {
    const match = /^([a-z][\w+.-]*):(.*)$/i.exec(value);
    return match ? new Uri(match[1], match[2]) : new Uri("file", value);
  }
  static from(parts: { scheme: string; path?: string; query?: string }) {
    return new Uri(parts.scheme, parts.path ?? "", parts.query ?? "");
  }
  static joinPath(base: Uri, ...segments: string[]) {
    return new Uri(base.scheme, join(base.path, ...segments));
  }
  get fsPath() {
    return this.path;
  }
  toString() {
    return `${this.scheme}:${this.path}${this.query ? `?${this.query}` : ""}`;
  }
}

export class Range {
  constructor(
    readonly start: unknown,
    readonly end: unknown,
    readonly endLine?: number,
    readonly endChar?: number,
  ) {}
}

export class WorkspaceEdit {
  readonly replacements: { uri: Uri; text: string }[] = [];
  replace(uri: Uri, _range: Range, text: string) {
    this.replacements.push({ uri, text });
  }
}

export class ThemeIcon {
  constructor(readonly id: string) {}
}

export const ViewColumn = { Active: -1, One: 1 };
export const QuickPickItemKind = { Separator: -1, Default: 0 };
export const ProgressLocation = { Notification: 15 };

// --- The harness tests drive -----------------------------------------------------------------

export interface FakeWebview {
  html: string;
  options: unknown;
  cspSource: string;
  posted: unknown[];
  asWebviewUri(uri: Uri): Uri;
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
  /** Simulates the webview sending a message to the extension. */
  send(message: unknown): Promise<void>;
}

function fakeWebview(): FakeWebview {
  const received = new Emitter<unknown>();
  const pending: Promise<unknown>[] = [];
  const webview: FakeWebview = {
    html: "",
    options: {},
    cspSource: "vscode-resource:",
    posted: [],
    asWebviewUri: (uri) => uri,
    postMessage: async (message) => {
      webview.posted.push(message);
      return true;
    },
    onDidReceiveMessage: (listener) =>
      received.event((message) => {
        const result = listener(message) as unknown;
        if (result instanceof Promise) pending.push(result);
      }),
    send: async (message) => {
      received.fire(message);
      while (pending.length) await pending.shift();
    },
  };
  return webview;
}

export const harness = {
  /** Answers for the next dialogs, consumed in order. A function receives the dialog's items. */
  answers: [] as unknown[],
  /** Everything shown to the user, for assertions. */
  shown: [] as { kind: string; message: string; detail?: string; items?: unknown[] }[],
  executed: [] as { command: string; args: unknown[] }[],
  opened: [] as string[],
  clipboard: "",
  config: {} as Record<string, unknown>,
  folders: [] as string[],
  focused: true,
  session: undefined as { accessToken: string } | undefined,
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  panels: [] as { viewType: string; title: string; webview: FakeWebview; dispose(): void }[],
  views: new Map<string, { resolveWebviewView(view: unknown): void }>(),
  contentProviders: new Map<string, { provideTextDocumentContent(uri: Uri): Promise<string> | string }>(),
  windowState: new Emitter<{ focused: boolean }>(),
  activeEditor: new Emitter<unknown>(),
  reset() {
    this.answers = [];
    this.shown = [];
    this.executed = [];
    this.opened = [];
    this.clipboard = "";
    this.config = {};
    this.folders = [];
    this.focused = true;
    this.session = undefined;
    this.commands.clear();
    this.panels = [];
    this.views.clear();
    this.contentProviders.clear();
  },
  /** Creates a fake sidebar webview view, resolved by the registered or given provider. */
  resolveView(provider: { resolveWebviewView(view: unknown): void }) {
    const webview = fakeWebview();
    const disposed = new Emitter<void>();
    const visibility = new Emitter<void>();
    const view = {
      webview,
      visible: true,
      onDidDispose: disposed.event,
      onDidChangeVisibility: visibility.event,
    };
    provider.resolveWebviewView(view);
    return webview;
  },
};

function nextAnswer(items?: unknown[]): unknown {
  const answer = harness.answers.shift();
  return typeof answer === "function" ? answer(items) : answer;
}

// --- window ----------------------------------------------------------------------------------

function message(kind: string) {
  return async (text: string, ...rest: unknown[]) => {
    const options =
      typeof rest[0] === "object" && rest[0] !== null && !Array.isArray(rest[0])
        ? (rest.shift() as { detail?: string })
        : {};
    harness.shown.push({ kind, message: text, detail: options.detail, items: rest });
    return rest.length ? nextAnswer(rest) : undefined;
  };
}

export const window = {
  showInformationMessage: message("info"),
  showWarningMessage: message("warning"),
  showErrorMessage: message("error"),
  async showQuickPick(items: unknown[] | Promise<unknown[]>, options?: { title?: string; canPickMany?: boolean }) {
    const list = await items;
    harness.shown.push({ kind: "quickPick", message: options?.title ?? "", items: list });
    return nextAnswer(list);
  },
  async showInputBox(options?: {
    title?: string;
    prompt?: string;
    value?: string;
    validateInput?: (v: string) => string | undefined;
  }) {
    harness.shown.push({ kind: "inputBox", message: options?.title ?? "", detail: options?.prompt });
    // An answer function gets the pre-filled value, so `([value]) => value` accepts it.
    const answer = nextAnswer([options?.value]) as string | undefined;
    if (answer !== undefined && options?.validateInput?.(answer)) return undefined;
    return answer;
  },
  async showTextDocument(target: Uri | { uri: Uri }) {
    const uri = target instanceof Uri ? target : target.uri;
    harness.opened.push(uri.fsPath);
    return {};
  },
  setStatusBarMessage: (text: string) => {
    harness.shown.push({ kind: "status", message: text });
    return new Disposable();
  },
  async withProgress<T>(_options: unknown, task: () => Promise<T>) {
    return task();
  },
  get state() {
    return { focused: harness.focused };
  },
  activeTextEditor: undefined as unknown,
  onDidChangeWindowState: harness.windowState.event,
  onDidChangeActiveTextEditor: harness.activeEditor.event,
  registerWebviewViewProvider(id: string, provider: { resolveWebviewView(view: unknown): void }) {
    harness.views.set(id, provider);
    return new Disposable();
  },
  createWebviewPanel(viewType: string, title: string) {
    const webview = fakeWebview();
    const disposed = new Emitter<void>();
    const panel = {
      viewType,
      title,
      webview,
      iconPath: undefined as unknown,
      reveal: () => {},
      onDidDispose: disposed.event,
      dispose: () => disposed.fire(),
    };
    harness.panels.push(panel);
    return panel;
  },
};

// --- workspace -------------------------------------------------------------------------------

class TextDocument {
  constructor(readonly uri: Uri) {}
  getText() {
    return readFileSync(this.uri.fsPath, "utf8");
  }
  positionAt(offset: number) {
    return offset;
  }
  async save() {
    return true;
  }
}

export const workspace = {
  getConfiguration(section: string) {
    return {
      get: <T>(key: string, fallback?: T) => {
        const value = harness.config[`${section}.${key}`];
        return (value === undefined ? fallback : value) as T;
      },
    };
  },
  get workspaceFolders() {
    return harness.folders.map((f) => ({ uri: Uri.file(f), name: f, index: 0 }));
  },
  createFileSystemWatcher() {
    const e = new Emitter<Uri>();
    return { onDidChange: e.event, onDidCreate: e.event, onDidDelete: e.event, dispose() {} };
  },
  onDidChangeWorkspaceFolders: new Emitter<void>().event,
  onDidChangeConfiguration: new Emitter<{ affectsConfiguration(s: string): boolean }>().event,
  async openTextDocument(target: Uri | string) {
    return new TextDocument(typeof target === "string" ? Uri.file(target) : target);
  },
  /** Applies whole-document replacements straight to disk, which is all GitKit does. */
  async applyEdit(edit: WorkspaceEdit) {
    for (const r of edit.replacements) writeFileSync(r.uri.fsPath, r.text);
    return true;
  },
  registerTextDocumentContentProvider(scheme: string, provider: { provideTextDocumentContent(uri: Uri): string }) {
    harness.contentProviders.set(scheme, provider);
    return new Disposable();
  },
};

// --- commands, env, authentication ----------------------------------------------------------

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
    harness.commands.set(id, handler);
    return new Disposable(() => harness.commands.delete(id));
  },
  async executeCommand(command: string, ...args: unknown[]) {
    harness.executed.push({ command, args });
    return harness.commands.get(command)?.(...args);
  },
};

export const env = {
  clipboard: {
    async writeText(text: string) {
      harness.clipboard = text;
    },
  },
  async openExternal(uri: Uri) {
    harness.opened.push(uri.toString());
    return true;
  },
};

export const authentication = {
  async getSession(_provider: string, _scopes: string[], options?: { createIfNone?: boolean; silent?: boolean }) {
    if (harness.session) return harness.session;
    if (options?.createIfNone) {
      const answer = nextAnswer() as { accessToken: string } | undefined;
      if (!answer) throw new Error("User did not consent to login.");
      harness.session = answer;
      return answer;
    }
    return undefined;
  },
};
