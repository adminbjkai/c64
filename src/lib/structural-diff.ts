/**
 * Structural diff for JSON-like values: normalise → compare → change list,
 * plus RFC 6902 (JSON Patch) and RFC 7386 (JSON Merge Patch) generation and
 * application.
 *
 * Pipeline
 * --------
 *  1. `normalize(value, opts)` applies the comparison options once, up front:
 *     sorted keys, trimmed / lower-cased strings, numeric-string coercion and
 *     `ignorePaths` (JSON Pointer patterns where `*` matches any one segment;
 *     an ignored object key is dropped, an ignored array item becomes `null`
 *     so sibling indices do not shift).
 *  2. `diffValues(a, b, opts)` walks both values and emits a `Change[]` whose
 *     paths are RFC 6901 pointers (`~` → `~0`, `/` → `~1`). Objects compare by
 *     the union of their keys. Arrays compare according to `opts.arrays`:
 *       - `index` (default): position by position; extra items are added /
 *         removed at the end.
 *       - `lcs`: a Myers diff over stable hashes of the items, like a text
 *         diff; adjacent removed/added runs are paired and recursed so a
 *         one-field change inside an item shows as a nested change. With
 *         `detectMoves` (default on) an identical item removed in one place
 *         and added in another becomes one `move`.
 *       - `key`: items are matched by `opts.keyFields` (e.g. `['id']`) and
 *         recursed; reordering is a `move`, unmatched items add/remove. Items
 *         without a key are matched by value.
 *       - `set`: order-insensitive multiset — only membership counts.
 *     A change of JSON type (string → number, object → array, …) is a
 *     `replace` with `kind: 'type'`.
 *     Changes are emitted in an order that applies sequentially: every array
 *     index refers to the array *as it is at that point of the patch*, which
 *     is what RFC 6902 requires, so `applyJsonPatch(a, toJsonPatch(diffValues(a, b)))`
 *     deep-equals `b` (for `set` mode: as a multiset).
 *  3. `alignValues(a, b, opts)` produces the same comparison as a tree for
 *     side-by-side display: one node per path with a status and the left /
 *     right values; equal subtrees are leaves (their value is kept so a view
 *     can expand them on demand).
 *
 * `applyJsonPatch` implements add / remove / replace / move / copy / test with
 * full pointer semantics (`-` appends, indices must be canonical, `move`
 * may not target a descendant of its source) and throws a `JsonPatchError`
 * carrying the index of the failing operation.
 */

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

export type ArrayMode = 'index' | 'lcs' | 'key' | 'set';

export interface NormalizeOptions {
  /** Sort object keys (affects output ordering only; key order never matters for comparison). Default true. */
  sortKeys?: boolean;
  trimStrings?: boolean;
  caseInsensitive?: boolean;
  /** Coerce strings that look like JSON numbers ("1", "-2.5") into numbers. */
  numericStrings?: boolean;
  /** JSON Pointer patterns to drop before comparing; `*` matches any one segment. */
  ignorePaths?: string[];
}

export interface DiffOptions extends NormalizeOptions {
  arrays?: ArrayMode;
  /** Object fields that identify an array item in `key` mode. Default ['id']. */
  keyFields?: string[];
  /** In `lcs` mode, turn a matching remove + add into a `move`. Default true. */
  detectMoves?: boolean;
}

export interface Change {
  op: 'add' | 'remove' | 'replace' | 'move';
  /** RFC 6901 pointer. */
  path: string;
  /** Source pointer for `move`. */
  from?: string;
  old?: unknown;
  new?: unknown;
  /** For `replace`: did the JSON type change, or just the value? */
  kind?: 'type' | 'value';
}

export interface DiffSummary {
  added: number;
  removed: number;
  /** `replace` with the same JSON type. */
  changed: number;
  /** `replace` where the JSON type differs. */
  typeChanges: number;
  moved: number;
}

export type AlignStatus = 'eq' | 'add' | 'del' | 'chg' | 'type' | 'move';

export interface AlignNode {
  /** Object key or array index (in the right value for add/eq/chg, in the left for del); null for the root. */
  key: string | number | null;
  /** Pointer in the right value (left value for `del`). */
  path: string;
  status: AlignStatus;
  /** Pointer the item came from, for `move`. */
  from?: string;
  /** Present unless the node was added. */
  left?: unknown;
  /** Present unless the node was removed. */
  right?: unknown;
  /** Only for containers with differences inside; equal containers are leaves. */
  children?: AlignNode[];
  /** Number of changed descendants, including this node when it is not `eq`. */
  changes: number;
}

export interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  from?: string;
  value?: unknown;
}

export class JsonPatchError extends Error {
  constructor(
    message: string,
    /** 0-based index of the failing operation. */
    public readonly index: number,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'JsonPatchError';
  }
}

/* ------------------------------------------------------------------------ */
/* Pointers                                                                  */
/* ------------------------------------------------------------------------ */

export const escapeToken = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');
export const unescapeToken = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~');

export function joinPointer(segs: (string | number)[]): string {
  return segs.map((s) => '/' + escapeToken(String(s))).join('');
}

/** Split a pointer into unescaped tokens; '' is the root. Throws on a missing leading slash. */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer "${pointer}": must start with "/"`);
  return pointer.slice(1).split('/').map(unescapeToken);
}

/* ------------------------------------------------------------------------ */
/* Equality and hashing                                                      */
/* ------------------------------------------------------------------------ */

export type JsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

export function jsonType(v: unknown): JsonType {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'object') return 'object';
  if (t === 'boolean' || t === 'number' || t === 'string') return t;
  return 'string';
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

/** Canonical JSON text (sorted keys) — equal values hash equal, cheap enough for array matching. */
export function stableHash(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableHash).join(',') + ']';
  if (isObj(v)) {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableHash(v[k])).join(',') + '}';
  }
  return v === undefined ? 'null' : JSON.stringify(v);
}

export function deepClone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(deepClone) as unknown as T;
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
    return out as T;
  }
  return v;
}

/* ------------------------------------------------------------------------ */
/* Normalisation                                                             */
/* ------------------------------------------------------------------------ */

const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

function parsePattern(p: string): string[] | null {
  const t = p.trim();
  if (t === '') return null;
  try {
    return parsePointer(t.startsWith('/') ? t : '/' + t);
  } catch {
    return null;
  }
}

function matchesPattern(pattern: string[], segs: string[]): boolean {
  if (pattern.length !== segs.length) return false;
  for (let i = 0; i < pattern.length; i++) if (pattern[i] !== '*' && pattern[i] !== segs[i]) return false;
  return true;
}

export function normalize(value: unknown, opts: NormalizeOptions = {}): unknown {
  const sortKeys = opts.sortKeys !== false;
  const patterns = (opts.ignorePaths ?? []).map(parsePattern).filter((p): p is string[] => p !== null);
  const ignored = (segs: string[]) => patterns.some((p) => matchesPattern(p, segs));
  const walk = (v: unknown, segs: string[]): unknown => {
    if (Array.isArray(v)) {
      return v.map((item, i) => {
        const s = [...segs, String(i)];
        return ignored(s) ? null : walk(item, s);
      });
    }
    if (isObj(v)) {
      const keys = Object.keys(v);
      if (sortKeys) keys.sort();
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const s = [...segs, k];
        if (ignored(s)) continue;
        out[k] = walk(v[k], s);
      }
      return out;
    }
    if (v === undefined) return null;
    if (typeof v === 'string') {
      let s = v;
      if (opts.trimStrings) s = s.trim();
      if (opts.numericStrings && NUMERIC.test(s)) {
        const n = Number(s);
        if (Number.isFinite(n)) return n;
      }
      if (opts.caseInsensitive) s = s.toLowerCase();
      return s;
    }
    return v;
  };
  return walk(value, []);
}

/* ------------------------------------------------------------------------ */
/* Array matching                                                            */
/* ------------------------------------------------------------------------ */

/** Myers O(ND) diff over token arrays; returns [aIndex, bIndex] pairs of equal tokens. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const offset = max;
  let v = new Array<number>(2 * max + 2).fill(0);
  const trace: number[][] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
      else x = v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }
  // Backtrack.
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    v = trace[d]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) prevK = k + 1;
    else prevK = k - 1;
    const prevX = v[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    if (d > 0) {
      x = prevX;
      y = prevY;
    }
  }
  pairs.reverse();
  return pairs;
}

interface Matching {
  /** bIndex → aIndex for matched items. */
  pairOfB: (number | undefined)[];
  /** aIndex → bIndex. */
  pairOfA: (number | undefined)[];
}

function itemKey(item: unknown, fields: string[]): string {
  if (isObj(item)) {
    const present = fields.filter((f) => Object.prototype.hasOwnProperty.call(item, f));
    if (present.length > 0) return 'k:' + JSON.stringify(present.map((f) => [f, item[f]]));
  }
  return 'v:' + stableHash(item);
}

function matchArrays(a: unknown[], b: unknown[], opts: DiffOptions): Matching {
  const pairOfB: (number | undefined)[] = new Array(b.length).fill(undefined);
  const pairOfA: (number | undefined)[] = new Array(a.length).fill(undefined);
  const pair = (ai: number, bi: number) => {
    pairOfA[ai] = bi;
    pairOfB[bi] = ai;
  };
  const mode = opts.arrays ?? 'index';
  if (mode === 'index') {
    for (let i = 0; i < Math.min(a.length, b.length); i++) pair(i, i);
    return { pairOfA, pairOfB };
  }
  if (mode === 'key') {
    const fields = opts.keyFields && opts.keyFields.length > 0 ? opts.keyFields : ['id'];
    const keysA = a.map((x) => itemKey(x, fields));
    const keysB = b.map((x) => itemKey(x, fields));
    const queue = new Map<string, number[]>();
    keysA.forEach((k, i) => (queue.get(k) ?? queue.set(k, []).get(k)!).push(i));
    keysB.forEach((k, j) => {
      const q = queue.get(k);
      if (q && q.length > 0) pair(q.shift()!, j);
    });
    return { pairOfA, pairOfB };
  }
  const ha = a.map(stableHash);
  const hb = b.map(stableHash);
  if (mode === 'set') {
    const queue = new Map<string, number[]>();
    ha.forEach((k, i) => (queue.get(k) ?? queue.set(k, []).get(k)!).push(i));
    hb.forEach((k, j) => {
      const q = queue.get(k);
      if (q && q.length > 0) pair(q.shift()!, j);
    });
    return { pairOfA, pairOfB };
  }
  // lcs
  for (const [ai, bi] of lcsPairs(ha, hb)) pair(ai, bi);
  if (opts.detectMoves !== false) {
    const queue = new Map<string, number[]>();
    ha.forEach((k, i) => {
      if (pairOfA[i] === undefined) (queue.get(k) ?? queue.set(k, []).get(k)!).push(i);
    });
    hb.forEach((k, j) => {
      if (pairOfB[j] !== undefined) return;
      const q = queue.get(k);
      if (q && q.length > 0) pair(q.shift()!, j);
    });
  }
  // Pair leftover removed/added runs that sit between the same anchors so
  // "changed" items recurse instead of showing as remove + add.
  let ai = 0;
  let bi = 0;
  while (ai < a.length || bi < b.length) {
    // Skip matched or already-paired items on both sides up to the next anchor.
    const dels: number[] = [];
    const ins: number[] = [];
    while (ai < a.length && pairOfA[ai] === undefined) dels.push(ai++);
    while (bi < b.length && pairOfB[bi] === undefined) ins.push(bi++);
    const n = Math.min(dels.length, ins.length);
    for (let k = 0; k < n; k++) pair(dels[k]!, ins[k]!);
    // Advance past the next anchored pair(s).
    if (ai < a.length && bi < b.length && pairOfA[ai] === bi) {
      ai++;
      bi++;
    } else {
      // One side sits on an item paired elsewhere (a move); step over it.
      if (ai < a.length && pairOfA[ai] !== undefined) ai++;
      if (bi < b.length && pairOfB[bi] !== undefined) bi++;
    }
  }
  return { pairOfA, pairOfB };
}

/* ------------------------------------------------------------------------ */
/* Diff                                                                      */
/* ------------------------------------------------------------------------ */

/** a-indices of a longest subsequence of pairs that keeps its order in both arrays (patience LIS over b). */
function monotoneAnchors(m: Matching): Set<number> {
  const seq: number[] = [];
  for (const ai of m.pairOfB) if (ai !== undefined) seq.push(ai);
  const tails: number[] = []; // index into seq of the tail of each pile
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const out = new Set<number>();
  let k = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (k >= 0) {
    out.add(seq[k]!);
    k = prev[k]!;
  }
  return out;
}

interface Sim {
  /** a-index of each item currently in the working array, or -1 for a freshly added one. */
  w: number[];
  moved: Set<number>; // b indices whose pair was moved
}

/**
 * Turn a matching into a sequential op list. Removes first (descending), then
 * walk b: the expected item is either in place, further along (→ move), or
 * absent (→ add). Returns which b-indices ended up as moves.
 */
function simulateArray(a: unknown[], b: unknown[], m: Matching, path: (string | number)[], opts: DiffOptions, out: Change[]): Sim {
  const w: number[] = [];
  const removes: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (m.pairOfA[i] === undefined) removes.push(i);
    else w.push(i);
  }
  for (let r = removes.length - 1; r >= 0; r--) {
    const i = removes[r]!;
    out.push({ op: 'remove', path: joinPointer([...path, i]), old: a[i] });
  }
  const moved = new Set<number>();
  const setMode = (opts.arrays ?? 'index') === 'set';
  const anchors = monotoneAnchors(m);
  for (let j = 0; j < b.length; j++) {
    const ai = m.pairOfB[j];
    if (ai === undefined) {
      if (setMode) continue; // appended below
      out.push({ op: 'add', path: joinPointer([...path, j]), new: b[j] });
      w.splice(j, 0, -1);
      continue;
    }
    if (setMode) continue;
    while (w[j] !== ai) {
      // Something else sits here; it belongs later in b (everything before j
      // is settled and unmatched items are gone). If it is an anchor, bring
      // the expected item here (one move for the mover); if it is itself a
      // mover, push it to where it will end up so the anchors stay put (one
      // move for a rotation instead of one per anchor).
      const cur = w[j]!;
      if (anchors.has(cur)) {
        const k = w.indexOf(ai, j + 1);
        w.splice(k, 1);
        w.splice(j, 0, ai);
        moved.add(j);
        out.push({ op: 'move', from: joinPointer([...path, k]), path: joinPointer([...path, j]), new: b[j] });
      } else {
        const jd = m.pairOfA[cur]!;
        let t = j;
        for (let k = j + 1; k < w.length; k++) if (m.pairOfA[w[k]!]! < jd) t++;
        w.splice(j, 1);
        w.splice(t, 0, cur);
        moved.add(jd);
        out.push({ op: 'move', from: joinPointer([...path, j]), path: joinPointer([...path, t]), new: b[jd] });
      }
    }
    diffInto(a[ai], b[j], [...path, j], opts, out);
  }
  if (setMode) {
    let at = w.length;
    for (let j = 0; j < b.length; j++) {
      if (m.pairOfB[j] === undefined) out.push({ op: 'add', path: joinPointer([...path, at++]), new: b[j] });
    }
  }
  return { w, moved };
}

function diffInto(a: unknown, b: unknown, path: (string | number)[], opts: DiffOptions, out: Change[]): void {
  const ta = jsonType(a);
  const tb = jsonType(b);
  if (ta !== tb) {
    out.push({ op: 'replace', path: joinPointer(path), old: a, new: b, kind: 'type' });
    return;
  }
  if (ta === 'object') {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(oa), ...Object.keys(ob)]));
    if (opts.sortKeys !== false) keys.sort();
    for (const k of keys) {
      const inA = Object.prototype.hasOwnProperty.call(oa, k);
      const inB = Object.prototype.hasOwnProperty.call(ob, k);
      if (inA && !inB) out.push({ op: 'remove', path: joinPointer([...path, k]), old: oa[k] });
      else if (!inA && inB) out.push({ op: 'add', path: joinPointer([...path, k]), new: ob[k] });
      else diffInto(oa[k], ob[k], [...path, k], opts, out);
    }
    return;
  }
  if (ta === 'array') {
    const aa = a as unknown[];
    const ab = b as unknown[];
    if (deepEqual(aa, ab)) return;
    simulateArray(aa, ab, matchArrays(aa, ab, opts), path, opts, out);
    return;
  }
  if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) {
    out.push({ op: 'replace', path: joinPointer(path), old: a, new: b, kind: 'value' });
  }
}

/** Normalise both sides, then compare. Paths are RFC 6901 pointers. */
export function diffValues(a: unknown, b: unknown, opts: DiffOptions = {}): Change[] {
  const out: Change[] = [];
  diffInto(normalize(a, opts), normalize(b, opts), [], opts, out);
  return out;
}

export function summarize(changes: Change[]): DiffSummary {
  const s: DiffSummary = { added: 0, removed: 0, changed: 0, typeChanges: 0, moved: 0 };
  for (const c of changes) {
    if (c.op === 'add') s.added++;
    else if (c.op === 'remove') s.removed++;
    else if (c.op === 'move') s.moved++;
    else if (c.kind === 'type') s.typeChanges++;
    else s.changed++;
  }
  return s;
}

/* ------------------------------------------------------------------------ */
/* Alignment tree (for side-by-side views)                                   */
/* ------------------------------------------------------------------------ */

function alignInto(key: string | number | null, a: unknown, b: unknown, path: (string | number)[], opts: DiffOptions): AlignNode {
  const pointer = joinPointer(path);
  const ta = jsonType(a);
  const tb = jsonType(b);
  if (ta !== tb) return { key, path: pointer, status: 'type', left: a, right: b, changes: 1 };
  if (ta === 'object') {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(oa), ...Object.keys(ob)]));
    if (opts.sortKeys !== false) keys.sort();
    const children: AlignNode[] = [];
    let changes = 0;
    for (const k of keys) {
      const inA = Object.prototype.hasOwnProperty.call(oa, k);
      const inB = Object.prototype.hasOwnProperty.call(ob, k);
      let node: AlignNode;
      if (inA && !inB) node = { key: k, path: joinPointer([...path, k]), status: 'del', left: oa[k], changes: 1 };
      else if (!inA && inB) node = { key: k, path: joinPointer([...path, k]), status: 'add', right: ob[k], changes: 1 };
      else node = alignInto(k, oa[k], ob[k], [...path, k], opts);
      changes += node.changes;
      children.push(node);
    }
    if (changes === 0) return { key, path: pointer, status: 'eq', left: a, right: b, changes: 0 };
    return { key, path: pointer, status: 'chg', left: a, right: b, children, changes };
  }
  if (ta === 'array') {
    const aa = a as unknown[];
    const ab = b as unknown[];
    if (deepEqual(aa, ab)) return { key, path: pointer, status: 'eq', left: a, right: b, changes: 0 };
    const m = matchArrays(aa, ab, opts);
    const sim = simulateArray(aa, ab, m, path, opts, []);
    const setMode = (opts.arrays ?? 'index') === 'set';
    const children: AlignNode[] = [];
    let changes = 0;
    const push = (n: AlignNode) => {
      changes += n.changes;
      children.push(n);
    };
    let ai = 0;
    const flushA = (upTo: number) => {
      while (ai < upTo) {
        if (m.pairOfA[ai] === undefined) push({ key: ai, path: joinPointer([...path, ai]), status: 'del', left: aa[ai], changes: 1 });
        ai++;
      }
    };
    for (let j = 0; j < ab.length; j++) {
      const p = m.pairOfB[j];
      if (p === undefined) {
        push({ key: j, path: joinPointer([...path, j]), status: 'add', right: ab[j], changes: 1 });
        continue;
      }
      if (sim.moved.has(j) && !setMode) {
        const node = alignInto(j, aa[p], ab[j], [...path, j], opts);
        node.status = node.status === 'eq' ? 'move' : node.status;
        node.from = joinPointer([...path, p]);
        node.changes = Math.max(node.changes, 1);
        push(node);
        continue;
      }
      if (p >= ai) flushA(p);
      if (p === ai) ai++;
      push(alignInto(j, aa[p], ab[j], [...path, j], opts));
    }
    flushA(aa.length);
    if (changes === 0) return { key, path: pointer, status: 'eq', left: a, right: b, changes: 0 }; // e.g. set mode, reordered only
    return { key, path: pointer, status: 'chg', left: a, right: b, children, changes };
  }
  if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) return { key, path: pointer, status: 'chg', left: a, right: b, changes: 1 };
  return { key, path: pointer, status: 'eq', left: a, right: b, changes: 0 };
}

/** Normalise both sides and build the aligned tree. */
export function alignValues(a: unknown, b: unknown, opts: DiffOptions = {}): AlignNode {
  return alignInto(null, normalize(a, opts), normalize(b, opts), [], opts);
}

/* ------------------------------------------------------------------------ */
/* Change report                                                             */
/* ------------------------------------------------------------------------ */

export function compactValue(v: unknown, max = 80): string {
  const s = v === undefined ? 'null' : JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** One readable line per change: `~ /a/b: 1 → 2`, `+ /c: {…}`, `- /d`, `! /e: "1" → 1 (string → number)`, `> /x/2 ← /x/0`. */
export function formatChanges(changes: Change[]): string {
  return changes
    .map((c) => {
      const p = c.path === '' ? '(root)' : c.path;
      switch (c.op) {
        case 'add':
          return `+ ${p}: ${compactValue(c.new)}`;
        case 'remove':
          return `- ${p}: ${compactValue(c.old)}`;
        case 'move':
          return `> ${p} ← ${c.from}`;
        default:
          return c.kind === 'type'
            ? `! ${p}: ${compactValue(c.old)} → ${compactValue(c.new)} (${jsonType(c.old)} → ${jsonType(c.new)})`
            : `~ ${p}: ${compactValue(c.old)} → ${compactValue(c.new)}`;
      }
    })
    .join('\n');
}

/* ------------------------------------------------------------------------ */
/* JSON Patch (RFC 6902)                                                     */
/* ------------------------------------------------------------------------ */

export function toJsonPatch(changes: Change[], opts: { test?: boolean } = {}): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  for (const c of changes) {
    switch (c.op) {
      case 'add':
        ops.push({ op: 'add', path: c.path, value: c.new });
        break;
      case 'remove':
        if (opts.test) ops.push({ op: 'test', path: c.path, value: c.old });
        ops.push({ op: 'remove', path: c.path });
        break;
      case 'replace':
        if (opts.test) ops.push({ op: 'test', path: c.path, value: c.old });
        ops.push({ op: 'replace', path: c.path, value: c.new });
        break;
      case 'move':
        ops.push({ op: 'move', from: c.from!, path: c.path });
        break;
    }
  }
  return ops;
}

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

interface Loc {
  parent: Record<string, unknown> | unknown[];
  key: string;
}

/** Walk to the container of the last token. `root` is a wrapper so '' resolves to the document itself. */
function locate(wrapper: { '': unknown }, pointer: string, i: number, what: string): Loc {
  let tokens: string[];
  try {
    tokens = parsePointer(pointer);
  } catch (e) {
    throw new JsonPatchError(`op ${i}: ${what} ${(e as Error).message}`, i, 'A JSON Pointer is "" for the whole document or starts with "/"');
  }
  let parent: unknown = wrapper;
  let key = '';
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]!;
    const cur = (parent as Record<string, unknown>)[key];
    if (Array.isArray(cur)) {
      if (tok !== '-' && !ARRAY_INDEX.test(tok)) throw new JsonPatchError(`op ${i}: ${what} "${pointer}" — "${tok}" is not an array index`, i);
    } else if (!isObj(cur)) {
      throw new JsonPatchError(`op ${i}: ${what} "${pointer}" does not exist`, i, `"${joinPointer(tokens.slice(0, t))}" is not an object or array`);
    } else if (t < tokens.length - 1 && !Object.prototype.hasOwnProperty.call(cur, tok)) {
      throw new JsonPatchError(`op ${i}: ${what} "${pointer}" does not exist`, i, `no key "${tok}" at "${joinPointer(tokens.slice(0, t))}"`);
    }
    parent = cur;
    key = tok;
  }
  return { parent: parent as Loc['parent'], key };
}

function getAt(loc: Loc, pointer: string, i: number, what: string): unknown {
  if (Array.isArray(loc.parent)) {
    if (loc.key === '-') throw new JsonPatchError(`op ${i}: ${what} "${pointer}" — "-" is only valid for add`, i);
    const idx = Number(loc.key);
    if (idx >= loc.parent.length) throw new JsonPatchError(`op ${i}: ${what} "${pointer}" — index ${idx} is out of range (length ${loc.parent.length})`, i);
    return loc.parent[idx];
  }
  if (!Object.prototype.hasOwnProperty.call(loc.parent, loc.key)) throw new JsonPatchError(`op ${i}: ${what} "${pointer}" does not exist`, i);
  return loc.parent[loc.key];
}

function addAt(loc: Loc, value: unknown, pointer: string, i: number): void {
  if (Array.isArray(loc.parent)) {
    const idx = loc.key === '-' ? loc.parent.length : Number(loc.key);
    if (idx > loc.parent.length) throw new JsonPatchError(`op ${i}: path "${pointer}" — index ${idx} is out of range (length ${loc.parent.length})`, i, 'Use "-" to append');
    loc.parent.splice(idx, 0, value);
  } else {
    loc.parent[loc.key] = value;
  }
}

function removeAt(loc: Loc, pointer: string, i: number): unknown {
  const old = getAt(loc, pointer, i, 'path');
  if (Array.isArray(loc.parent)) loc.parent.splice(Number(loc.key), 1);
  else delete loc.parent[loc.key];
  return old;
}

/** Apply an RFC 6902 patch to a deep copy of `doc`; throws JsonPatchError with the failing op index. */
export function applyJsonPatch(doc: unknown, patch: unknown): unknown {
  if (!Array.isArray(patch)) throw new JsonPatchError('A JSON Patch must be an array of operations', -1, 'Wrap the operation(s) in [ ]');
  const wrapper: { '': unknown } = { '': deepClone(doc) };
  patch.forEach((raw, i) => {
    if (!isObj(raw)) throw new JsonPatchError(`op ${i}: not an object`, i);
    const op = raw['op'];
    const path = raw['path'];
    if (typeof path !== 'string') throw new JsonPatchError(`op ${i}: missing "path"`, i);
    const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
    switch (op) {
      case 'add': {
        if (!has('value')) throw new JsonPatchError(`op ${i} (add ${path}): missing "value"`, i);
        addAt(locate(wrapper, path, i, 'path'), deepClone(raw['value']), path, i);
        break;
      }
      case 'remove':
        removeAt(locate(wrapper, path, i, 'path'), path, i);
        break;
      case 'replace': {
        if (!has('value')) throw new JsonPatchError(`op ${i} (replace ${path}): missing "value"`, i);
        const loc = locate(wrapper, path, i, 'path');
        getAt(loc, path, i, 'path');
        if (Array.isArray(loc.parent)) loc.parent[Number(loc.key)] = deepClone(raw['value']);
        else loc.parent[loc.key] = deepClone(raw['value']);
        break;
      }
      case 'move': {
        const from = raw['from'];
        if (typeof from !== 'string') throw new JsonPatchError(`op ${i} (move → ${path}): missing "from"`, i);
        if (path === from) break;
        if (path.startsWith(from + '/')) throw new JsonPatchError(`op ${i} (move ${from} → ${path}): cannot move a value into its own child`, i);
        const value = removeAt(locate(wrapper, from, i, 'from'), from, i);
        addAt(locate(wrapper, path, i, 'path'), value, path, i);
        break;
      }
      case 'copy': {
        const from = raw['from'];
        if (typeof from !== 'string') throw new JsonPatchError(`op ${i} (copy → ${path}): missing "from"`, i);
        const value = deepClone(getAt(locate(wrapper, from, i, 'from'), from, i, 'from'));
        addAt(locate(wrapper, path, i, 'path'), value, path, i);
        break;
      }
      case 'test': {
        if (!has('value')) throw new JsonPatchError(`op ${i} (test ${path}): missing "value"`, i);
        const actual = getAt(locate(wrapper, path, i, 'path'), path, i, 'path');
        if (!deepEqual(actual, raw['value'])) {
          throw new JsonPatchError(`op ${i} (test ${path}): value is ${compactValue(actual)}, expected ${compactValue(raw['value'])}`, i);
        }
        break;
      }
      default:
        throw new JsonPatchError(`op ${i}: unknown op ${JSON.stringify(op)}`, i, 'Valid ops: add, remove, replace, move, copy, test');
    }
  });
  return wrapper[''];
}

/* ------------------------------------------------------------------------ */
/* JSON Merge Patch (RFC 7386)                                               */
/* ------------------------------------------------------------------------ */

/**
 * The merge patch that turns `a` into `b`. Note the format's limits: arrays
 * are replaced whole, and a `null` in `b` reads as "delete", so a value that
 * is literally null cannot be expressed.
 */
export function toMergePatch(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return deepClone(b);
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(a)) if (!Object.prototype.hasOwnProperty.call(b, k)) patch[k] = null;
  for (const k of Object.keys(b)) {
    const va = a[k];
    const vb = b[k];
    if (!Object.prototype.hasOwnProperty.call(a, k)) patch[k] = deepClone(vb);
    else if (deepEqual(va, vb)) continue;
    else if (isObj(va) && isObj(vb)) patch[k] = toMergePatch(va, vb);
    else patch[k] = deepClone(vb);
  }
  return patch;
}

/** RFC 7386 MergePatch(Target, Patch). Returns a new value; `doc` is not modified. */
export function applyMergePatch(doc: unknown, patch: unknown): unknown {
  if (!isObj(patch)) return deepClone(patch);
  const target: Record<string, unknown> = isObj(doc) ? deepClone(doc) : {};
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v === null || v === undefined) delete target[k];
    else target[k] = applyMergePatch(target[k], v);
  }
  return target;
}
