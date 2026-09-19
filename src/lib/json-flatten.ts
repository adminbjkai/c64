/**
 * json-flatten.ts — flatten a nested JSON value into a single-level object
 * of path → leaf, and rebuild it again.
 *
 * Key styles
 * ----------
 *  - dot:     a.b[0].c   (or a.b.0.c when arraysAsIndex is off; the "."
 *             delimiter is configurable)
 *  - bracket: a[b][0][c]
 *  - slash:   /a/b/0/c   (RFC 6901 JSON Pointer, ~0 / ~1 escaping)
 *
 * Empty objects and arrays are kept as `{}` / `[]` leaves so nothing is
 * lost on the round trip. Unflatten rebuilds arrays for nodes whose keys are
 * all canonical non-negative integers (holes become null) when
 * `rebuildArrays` is on; otherwise they stay objects with "0", "1" keys.
 */

export type FlattenStyle = 'dot' | 'bracket' | 'slash';

export interface FlattenOptions {
  style?: FlattenStyle;
  /** Dot style only. Default ".". */
  delimiter?: string;
  /** Dot style only: write array indices as `[0]` (true) or `.0` (false). Default true. */
  arraysAsIndex?: boolean;
  /** Depth at which nested values are kept as-is (JSON leaves). Default unlimited. */
  maxDepth?: number;
}

export interface UnflattenOptions {
  style?: FlattenStyle;
  delimiter?: string;
  rebuildArrays?: boolean;
}

type Seg = { key: string; index: boolean };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isLeaf(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (isPlainObject(v)) return Object.keys(v).length === 0;
  return true;
}

function joinPath(segs: Seg[], opts: FlattenOptions): string {
  const style = opts.style ?? 'dot';
  const delim = opts.delimiter ?? '.';
  if (style === 'slash') return segs.map((s) => '/' + s.key.replace(/~/g, '~0').replace(/\//g, '~1')).join('');
  if (style === 'bracket') return segs.map((s, i) => (i === 0 && !s.index ? s.key : `[${s.key}]`)).join('');
  const asIndex = opts.arraysAsIndex !== false;
  let out = '';
  segs.forEach((s, i) => {
    if (s.index && asIndex) out += `[${s.key}]`;
    else out += (i === 0 ? '' : delim) + s.key;
  });
  return out;
}

/** Flatten `value` into { path: leaf }. A primitive root yields { "": value }. */
export function flatten(value: unknown, opts: FlattenOptions = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const maxDepth = opts.maxDepth ?? Infinity;
  const walk = (v: unknown, segs: Seg[]) => {
    if (isLeaf(v) || segs.length >= maxDepth) {
      out[joinPath(segs, opts)] = v;
      return;
    }
    if (Array.isArray(v)) v.forEach((item, i) => walk(item, [...segs, { key: String(i), index: true }]));
    else for (const [k, item] of Object.entries(v as Record<string, unknown>)) walk(item, [...segs, { key: k, index: false }]);
  };
  walk(value, []);
  return out;
}

/** Split a flattened key back into path segments for the given style. */
export function splitPath(path: string, opts: UnflattenOptions = {}): Seg[] {
  const style = opts.style ?? 'dot';
  if (style === 'slash') {
    if (path === '') return [];
    const body = path.startsWith('/') ? path.slice(1) : path;
    return body.split('/').map((s) => ({ key: s.replace(/~1/g, '/').replace(/~0/g, '~'), index: /^(0|[1-9]\d*)$/.test(s) }));
  }
  const delim = style === 'bracket' ? '' : opts.delimiter || '.';
  const segs: Seg[] = [];
  let i = 0;
  let cur = '';
  let started = false;
  const flush = () => {
    if (started || cur !== '') segs.push({ key: cur, index: false });
    cur = '';
    started = false;
  };
  while (i < path.length) {
    const ch = path[i]!;
    if (ch === '[') {
      const end = path.indexOf(']', i);
      if (end === -1) {
        cur += ch;
        i++;
        continue;
      }
      flush();
      const inner = path.slice(i + 1, end);
      segs.push({ key: inner, index: /^(0|[1-9]\d*)$/.test(inner) });
      i = end + 1;
      if (delim && path.startsWith(delim, i)) i += delim.length;
      continue;
    }
    if (delim && path.startsWith(delim, i)) {
      flush();
      started = true;
      i += delim.length;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur !== '' || started) segs.push({ key: cur, index: false });
  return segs;
}

/** Rebuild a nested value from { path: leaf }. */
export function unflatten(flat: Record<string, unknown>, opts: UnflattenOptions = {}): unknown {
  const rebuild = opts.rebuildArrays !== false;
  const root: Record<string, unknown> = {};
  let rootValue: unknown = undefined;
  let hasRootValue = false;
  for (const [path, leaf] of Object.entries(flat)) {
    const segs = splitPath(path, opts);
    if (segs.length === 0) {
      rootValue = leaf;
      hasRootValue = true;
      continue;
    }
    let node: Record<string, unknown> = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const k = segs[i]!.key;
      let next = node[k];
      if (!isPlainObject(next)) {
        next = {};
        node[k] = next;
      }
      node = next as Record<string, unknown>;
    }
    node[segs[segs.length - 1]!.key] = leaf;
  }
  if (hasRootValue && Object.keys(root).length === 0) return rootValue;
  const convert = (v: unknown): unknown => {
    if (!isPlainObject(v)) return v;
    const keys = Object.keys(v);
    for (const k of keys) v[k] = convert(v[k]);
    if (rebuild && keys.length > 0 && keys.every((k) => /^(0|[1-9]\d*)$/.test(k))) {
      const max = Math.max(...keys.map(Number));
      const arr: unknown[] = new Array(max + 1).fill(null);
      for (const k of keys) arr[Number(k)] = v[k];
      return arr;
    }
    return v;
  };
  return convert(root);
}

/** Heuristic: an object whose keys all look like paths and whose values are all leaves. */
export function looksFlattened(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((k) => /[.[/]/.test(k)) && Object.values(value).every(isLeaf);
}
