/**
 * Myers O(ND) diff over arrays of tokens (Eugene Myers, "An O(ND) Difference
 * Algorithm and Its Variations", 1986). Implements the forward greedy
 * algorithm with a V-array history so the edit script is recovered by
 * backtracking; no linear-space refinement (inputs here are pane-sized).
 *
 * Tokenisers: lines (split on \n, \r\n), words (runs of non-whitespace with
 * the whitespace kept as separate tokens so it round-trips), chars.
 */

export type DiffOpType = 'equal' | 'insert' | 'delete';
export interface DiffOp {
  type: DiffOpType;
  value: string;
}

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

/** Normalise a token for comparison only; the emitted value is the original. */
function keyOf(tok: string, opts: DiffOptions): string {
  let k = tok;
  if (opts.ignoreWhitespace) k = k.trim().replace(/\s+/g, ' ');
  if (opts.ignoreCase) k = k.toLowerCase();
  return k;
}

/** Core Myers algorithm. Returns ops over the ORIGINAL a/b tokens. */
export function diffTokens(a: readonly string[], b: readonly string[], opts: DiffOptions = {}): DiffOp[] {
  const ka = a.map((t) => keyOf(t, opts));
  const kb = b.map((t) => keyOf(t, opts));
  const n = ka.length;
  const m = kb.length;
  const max = n + m;
  const offset = max;
  // V is indexed by k + offset; trace stores a copy of V per d-step for backtracking.
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 2);
  v[offset + 1] = 0;
  let found = false;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      const vDown = v[offset + k - 1] ?? 0;
      const vUp = v[offset + k + 1] ?? 0;
      if (k === -d || (k !== d && vDown < vUp)) x = vUp;
      else x = vDown + 1;
      let y = x - k;
      while (x < n && y < m && ka[x] === kb[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break outer;
      }
    }
  }
  if (!found) return []; // unreachable: max steps always suffice

  // Backtrack from (n, m) through the trace.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    let prevK: number;
    const vDown = vd[offset + k - 1] ?? 0;
    const vUp = vd[offset + k + 1] ?? 0;
    if (k === -d || (k !== d && vDown < vUp)) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    // Diagonal (equal) run.
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: 'equal', value: a[x]! });
    }
    if (d > 0) {
      if (x === prevX) {
        y--;
        ops.push({ type: 'insert', value: b[y]! });
      } else {
        x--;
        ops.push({ type: 'delete', value: a[x]! });
      }
    }
  }
  ops.reverse();
  return ops;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Words and the whitespace between them, as alternating tokens. */
export function splitWords(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

export function splitChars(text: string): string[] {
  return Array.from(text);
}

export function diffLines(a: string, b: string, opts: DiffOptions = {}): DiffOp[] {
  return diffTokens(splitLines(a), splitLines(b), opts);
}

export function diffWords(a: string, b: string, opts: DiffOptions = {}): DiffOp[] {
  return coalesce(diffTokens(splitWords(a), splitWords(b), opts));
}

export function diffChars(a: string, b: string, opts: DiffOptions = {}): DiffOp[] {
  return coalesce(diffTokens(splitChars(a), splitChars(b), opts));
}

/** Join consecutive ops of the same type into one op (for inline display). */
export function coalesce(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.type === op.type) last.value += op.value;
    else out.push({ ...op });
  }
  return out;
}

export interface DiffStats {
  added: number;
  removed: number;
  equal: number;
}

export function diffStats(ops: readonly DiffOp[]): DiffStats {
  const s: DiffStats = { added: 0, removed: 0, equal: 0 };
  for (const op of ops) {
    if (op.type === 'insert') s.added++;
    else if (op.type === 'delete') s.removed++;
    else s.equal++;
  }
  return s;
}

/** Unified-style text: one prefixed line per op. */
export function formatLineDiff(ops: readonly DiffOp[]): string {
  return ops.map((op) => (op.type === 'insert' ? '+' : op.type === 'delete' ? '-' : ' ') + op.value).join('\n');
}

/** Inline `[-old-]{+new+}` notation for word/char diffs. */
export function formatInlineDiff(ops: readonly DiffOp[]): string {
  return ops.map((op) => (op.type === 'insert' ? `{+${op.value}+}` : op.type === 'delete' ? `[-${op.value}-]` : op.value)).join('');
}
