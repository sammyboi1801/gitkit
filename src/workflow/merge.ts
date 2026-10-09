import { isAlias, isMap, isScalar, isSeq, parseDocument, visit, type Document, type Node, type Pair } from "yaml";

// Saves changes into a hand-written workflow without rewriting it: the original YAML is edited in
// place, so comments, blank lines, quoting and layout survive, and only what changed is touched.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Structural equality that ignores key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isObj(value)) {
    const entries = Object.entries(value).sort(([x], [y]) => x.localeCompare(y));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A node's value, with aliases resolved: what GitHub reads there. */
const js = (doc: Document, node: unknown): unknown =>
  node && typeof (node as { toJS?: unknown }).toJS === "function"
    ? (node as { toJS(doc: Document): unknown }).toJS(doc)
    : node;

/**
 * Before an anchored node (&name) is edited, every alias of it (*name) gets its own copy of the
 * old value, so the edit changes this place only, as it did in Studio.
 */
function detachAliases(doc: Document, node: Node): void {
  const anchor = (node as { anchor?: string }).anchor;
  if (!anchor) return;
  const old = js(doc, node);
  visit(doc, {
    Alias(_, alias) {
      if (alias.source === anchor) return doc.createNode(old);
    },
  });
  (node as { anchor?: string }).anchor = undefined;
}

/** `on: push` and `on: [push]` mean the same as the mapping form with nulls. */
function normalizeOn(on: unknown): unknown {
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [String(e), null]));
  return on;
}

/**
 * Whether the YAML already says this, written differently: a one-item list and its item (GitHub
 * reads `needs: [build]` and `needs: build` the same), or the short forms of `on:`.
 */
function sameMeaning(current: unknown, next: unknown, path: readonly string[]): boolean {
  if (stable(current) === stable(next)) return true;
  if (path.length === 1 && path[0] === "on") return stable(normalizeOn(current)) === stable(normalizeOn(next));
  if (Array.isArray(current) && current.length === 1 && !Array.isArray(next))
    return stable(current[0]) === stable(next);
  if (Array.isArray(next) && next.length === 1 && !Array.isArray(current)) return stable(next[0]) === stable(current);
  return false;
}

const keyOf = (pair: Pair) => String(isScalar(pair.key) ? pair.key.value : pair.key);

/** A fresh node for `value` that keeps the comments of the one it replaces. */
function replace(doc: Document, old: Node | null, value: unknown): Node {
  const fresh = doc.createNode(value) as Node;
  if (old) {
    fresh.commentBefore = old.commentBefore;
    fresh.comment = old.comment;
    fresh.spaceBefore = old.spaceBefore;
  }
  return fresh;
}

function merge(doc: Document, node: Node | null, value: unknown, path: readonly string[]): Node {
  if (node && sameMeaning(js(doc, node), value, path)) return node;
  // A changed alias becomes a value of its own: the anchor and its other uses stay as they were.
  if (isAlias(node)) return replace(doc, node, value);
  if (node) detachAliases(doc, node);
  if (isMap(node) && isObj(value)) {
    for (const pair of [...node.items]) if (!(keyOf(pair) in value)) node.items.splice(node.items.indexOf(pair), 1);
    const order = Object.keys(value);
    order.forEach((key, k) => {
      const next = value[key];
      const pair = node.items.find((p) => keyOf(p) === key);
      if (pair) {
        pair.value = merge(doc, (pair.value as Node | null) ?? null, next, [...path, key]);
        return;
      }
      // A new key goes where it would be in a fresh file: before the first existing key that follows it.
      const after = order.slice(k + 1);
      const at = node.items.findIndex((p) => after.includes(keyOf(p)));
      const fresh = doc.createPair(key, next) as Pair;
      if (at === -1) node.items.push(fresh);
      else {
        // A comment above the first key is the file's (or the block's) own: it stays on top.
        const first = node.items[0]?.key as Node | undefined;
        if (at === 0 && first?.commentBefore) {
          (fresh.key as Node).commentBefore = first.commentBefore;
          first.commentBefore = undefined;
        }
        node.items.splice(at, 0, fresh);
      }
    });
    return node;
  }
  if (isSeq(node) && Array.isArray(value)) {
    node.items = mergeList(doc, node.items as Node[], value, path);
    return node;
  }
  // A changed value keeps its quoting and block style: run: | stays a block.
  if (isScalar(node) && (value === null || typeof value !== "object")) {
    node.value = value;
    return node;
  }
  return replace(doc, node, value);
}

/**
 * Lists are matched item by item on content (a longest common subsequence), so adding or removing
 * a step leaves the other steps, and their comments, exactly as they were. Items changed in place
 * are edited rather than replaced.
 */
function mergeList(doc: Document, items: Node[], values: unknown[], path: readonly string[]): Node[] {
  const before = items.map((n) => stable(js(doc, n)));
  const after = values.map(stable);
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: Node[] = [];
  let i = 0;
  let j = 0;
  let removed: Node[] = [];
  let added: unknown[] = [];
  // Between two matches, removed and added items pair up: those are edits of the same item.
  const flush = () => {
    added.forEach((value, k) =>
      out.push(k < removed.length ? merge(doc, removed[k], value, path) : replace(doc, null, value)),
    );
    removed = [];
    added = [];
  };
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      flush();
      out.push(items[i]);
      i++;
      j++;
    } else if (j < after.length && (i === before.length || table[i][j + 1] >= table[i + 1][j])) {
      added.push(values[j++]);
    } else {
      removed.push(items[i++]);
    }
  }
  flush();
  return out;
}

/** The node a mapping's text ends with: its last value, followed down through nested mappings. */
function tailOf(node: unknown): unknown {
  return isMap(node) && node.items.length ? tailOf(node.items[node.items.length - 1].value) : node;
}

/**
 * The YAML parser hangs a comment that sits after a blank line, before the next key, on the end of
 * the previous value when that value is empty (`pull_request:`), and would print it indented under
 * it. People read it as the next key's comment, so it's moved there.
 */
function hoistComments(map: unknown): void {
  if (!isMap(map)) return;
  map.items.forEach((pair, i) => {
    hoistComments(pair.value);
    const next = map.items[i + 1];
    const tail = tailOf(pair.value);
    if (!next || !isScalar(tail) || tail.value !== null || !tail.comment || !tail.spaceBefore) return;
    const key = next.key as Node;
    key.commentBefore = key.commentBefore ? `${tail.comment}\n${key.commentBefore}` : tail.comment;
    key.spaceBefore = true;
    tail.comment = undefined;
    tail.spaceBefore = false;
  });
}

/** How the original indents: its indent width, and whether lists sit under their key or beside it. */
function layoutOf(text: string): { indent: number; indentSeq: boolean } {
  const lines = text.split(/\r?\n/);
  let indent: number | null = null;
  let indentSeq: boolean | null = null;
  for (let i = 0; i < lines.length - 1 && (indent === null || indentSeq === null); i++) {
    const key = /^(\s*)[^\s#-][^:]*:\s*$/.exec(lines[i]);
    if (!key) continue;
    const next = /^(\s*)(-\s+)?\S/.exec(lines[i + 1]);
    if (!next) continue;
    const by = next[1].length - key[1].length;
    if (next[2]) indentSeq ??= by > 0;
    else if (by > 0) indent ??= by;
  }
  return { indent: indent ?? 2, indentSeq: indentSeq ?? true };
}

/** `original` with `next` saved into it, or null when it isn't a YAML mapping to edit (it doesn't parse). */
export function updateYaml(original: string, next: Obj): string | null {
  const doc = parseDocument(original);
  if (doc.errors.length || !isMap(doc.contents)) return null;
  hoistComments(doc.contents);
  doc.contents = merge(doc, doc.contents as Node, next, []) as typeof doc.contents;
  const { indent, indentSeq } = layoutOf(original);
  const text = doc.toString({ lineWidth: 0, nullStr: "", flowCollectionPadding: false, indent, indentSeq });
  return original.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text;
}
