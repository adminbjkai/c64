/**
 * Query string ↔ JSON. Implements the common PHP/Rails/qs conventions:
 *  - `a=1&b=x&b=y`      → { a: "1", b: ["x", "y"] }   (repeated keys → array)
 *  - `c[k]=v&c[j]=w`    → { c: { k: "v", j: "w" } }   (bracket path → nested object)
 *  - `arr[]=1&arr[]=2`  → { arr: ["1", "2"] }         (empty bracket → push)
 *  - `a=&b`             → { a: "", b: "" }            (empty values preserved)
 * Values are decoded as application/x-www-form-urlencoded ("+" is a space).
 * Everything stays a string unless `typed` is set, which coerces numbers,
 * booleans and null. The reverse direction emits bracket notation with `[]`
 * for arrays of primitives and `[index]` for arrays of objects/arrays.
 */

export type QueryValue = string | number | boolean | null | QueryValue[] | { [k: string]: QueryValue };
export type QueryObject = { [k: string]: QueryValue };

const FULL_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Extract the raw query part from a full URL, a "?..." string or a bare "a=1&b=2". */
export function extractQuery(text: string): string {
  let s = text.trim();
  if (FULL_URL.test(s)) {
    const q = s.indexOf('?');
    if (q === -1) return '';
    s = s.slice(q);
  }
  if (s.startsWith('?')) s = s.slice(1);
  const hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(0, hash);
  return s;
}

function decodePart(s: string): string {
  const plus = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus;
  }
}

function coerce(v: string): QueryValue {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(v) && Number.isFinite(Number(v))) return Number(v);
  return v;
}

/** `a[b][c][]` → ['a', 'b', 'c', '']. A key without brackets is a single segment. */
function keyPath(key: string): string[] {
  const m = /^([^[\]]*)((?:\[[^[\]]*\])*)$/.exec(key);
  if (!m || m[2] === '') return [key];
  const path = [m[1]!];
  for (const seg of m[2]!.matchAll(/\[([^[\]]*)\]/g)) path.push(seg[1]!);
  return path;
}

function assign(root: QueryObject, path: string[], value: QueryValue): void {
  let cur: QueryObject | QueryValue[] = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]!;
    const next = path[i + 1]!;
    const wantArray = next === '' || /^\d+$/.test(next);
    let child: QueryValue | undefined = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
    if (child === null || typeof child !== 'object') {
      child = wantArray ? [] : {};
      if (Array.isArray(cur)) cur[seg === '' ? cur.length : Number(seg)] = child;
      else cur[seg] = child;
    }
    cur = child as QueryObject | QueryValue[];
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(cur)) {
    if (last === '') cur.push(value);
    else cur[Number(last)] = value;
    return;
  }
  const existing = cur[last];
  if (existing === undefined) cur[last] = value;
  else if (Array.isArray(existing)) existing.push(value);
  else cur[last] = [existing, value];
}

export function parseQueryString(text: string, opts: { typed?: boolean } = {}): { value: QueryObject; pairs: number } {
  const qs = extractQuery(text);
  const root: QueryObject = {};
  let pairs = 0;
  for (const part of qs.split('&')) {
    if (part === '') continue;
    pairs++;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawVal = eq === -1 ? '' : part.slice(eq + 1);
    const key = decodePart(rawKey);
    const val = decodePart(rawVal);
    assign(root, keyPath(key), opts.typed ? coerce(val) : val);
  }
  return { value: root, pairs };
}

function encodePart(s: string): string {
  return encodeURIComponent(s).replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+');
}

function encodeKey(path: string[]): string {
  const [head, ...rest] = path;
  return encodePart(head ?? '') + rest.map((s) => `[${encodePart(s)}]`).join('');
}

function isPrimitive(v: QueryValue): v is string | number | boolean | null {
  return v === null || typeof v !== 'object';
}

export function stringifyQuery(obj: QueryObject): string {
  const out: string[] = [];
  const walk = (path: string[], v: QueryValue) => {
    if (isPrimitive(v)) {
      out.push(`${encodeKey(path)}=${encodePart(v === null ? '' : String(v))}`);
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push(`${encodeKey([...path, ''])}=`);
        return;
      }
      v.forEach((item, i) => walk([...path, isPrimitive(item) ? '' : String(i)], item));
    } else {
      for (const [k, child] of Object.entries(v)) walk([...path, k], child);
    }
  };
  for (const [k, v] of Object.entries(obj)) walk([k], v);
  return out.join('&');
}
