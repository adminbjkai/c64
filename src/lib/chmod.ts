/**
 * chmod.ts — Unix permission modes.
 *
 * What it implements
 * ------------------
 * - Octal modes: 3 digits (`755`) or 4 digits with the special-bit digit
 *   (`4755`, `0644`).
 * - Symbolic listings as shown by `ls -l`: 9 characters (`rwxr-xr-x`) or 10
 *   with a leading file-type character (`-rw-r--r--`, `drwxr-x---`); `s`/`S`
 *   and `t`/`T` set setuid/setgid/sticky.
 * - Symbolic mode expressions as accepted by chmod(1): comma-separated
 *   clauses of `[ugoa]*[+-=][rwxXst]*` applied to a base mode. `X` sets
 *   execute only when the base already has any execute bit. A missing who
 *   means `a` (umask is not applied).
 */

export class ChmodError extends Error {
  constructor(message: string, public hint: string, public col = 1) {
    super(message);
  }
}

export const S_ISUID = 0o4000;
export const S_ISGID = 0o2000;
export const S_ISVTX = 0o1000;

export function parseOctal(s: string): number {
  if (!/^[0-7]{3,4}$/.test(s)) throw new ChmodError(`"${s}" is not an octal mode`, 'Use three or four octal digits, e.g. 755, 0644 or 4755.');
  return parseInt(s, 8);
}

const SYMBOLIC_RE = /^([-dlbcps])?([-r])([-w])([-xsS])([-r])([-w])([-xsS])([-r])([-w])([-xtT])$/;

export function isSymbolic(s: string): boolean {
  return SYMBOLIC_RE.test(s);
}

export function parseSymbolic(s: string): number {
  const m = SYMBOLIC_RE.exec(s);
  if (!m) throw new ChmodError(`"${s}" is not a symbolic mode`, 'Expected nine permission characters like rwxr-xr-x, optionally after a file-type character (-, d, l …).');
  let mode = 0;
  const bit = (ch: string | undefined, on: string, value: number) => {
    if (ch === on) mode |= value;
  };
  bit(m[2], 'r', 0o400);
  bit(m[3], 'w', 0o200);
  if (m[4] === 'x' || m[4] === 's') mode |= 0o100;
  if (m[4] === 's' || m[4] === 'S') mode |= S_ISUID;
  bit(m[5], 'r', 0o040);
  bit(m[6], 'w', 0o020);
  if (m[7] === 'x' || m[7] === 's') mode |= 0o010;
  if (m[7] === 's' || m[7] === 'S') mode |= S_ISGID;
  bit(m[8], 'r', 0o004);
  bit(m[9], 'w', 0o002);
  if (m[10] === 'x' || m[10] === 't') mode |= 0o001;
  if (m[10] === 't' || m[10] === 'T') mode |= S_ISVTX;
  return mode;
}

const CLAUSE_RE = /^([ugoa]*)([+\-=])([rwxXst]*)$/;

export function isExpression(s: string): boolean {
  return s.split(',').every((c) => CLAUSE_RE.test(c));
}

/** Apply a chmod(1) symbolic expression such as `u+x,go-w` or `a=r` to `base`. */
export function applyExpression(expr: string, base: number): number {
  let mode = base;
  const clauses = expr.split(',');
  let col = 1;
  for (const clause of clauses) {
    const m = CLAUSE_RE.exec(clause);
    if (!m) throw new ChmodError(`"${clause}" is not a chmod clause`, 'A clause is who (u, g, o, a) + operator (+, -, =) + permissions (r, w, x, X, s, t), e.g. u+x or go-w.', col);
    const who = m[1] === '' ? 'ugo' : m[1]!.replace('a', 'ugo');
    const op = m[2]!;
    const perms = m[3]!;
    const hasAnyX = (mode & 0o111) !== 0;
    let bits = 0;
    let special = 0;
    for (const p of perms) {
      if (p === 'r') bits |= 4;
      else if (p === 'w') bits |= 2;
      else if (p === 'x') bits |= 1;
      else if (p === 'X' && hasAnyX) bits |= 1;
      else if (p === 's') {
        if (who.includes('u')) special |= S_ISUID;
        if (who.includes('g')) special |= S_ISGID;
      } else if (p === 't') special |= S_ISVTX;
    }
    let mask = 0;
    let value = 0;
    if (who.includes('u')) {
      mask |= 0o700;
      value |= bits << 6;
    }
    if (who.includes('g')) {
      mask |= 0o070;
      value |= bits << 3;
    }
    if (who.includes('o')) {
      mask |= 0o007;
      value |= bits;
    }
    if (op === '+') mode |= value | special;
    else if (op === '-') mode &= ~(value | special);
    else {
      // `=` clears the selected who's bits (and the special bits it names) before setting.
      let clear = mask;
      if (who.includes('u')) clear |= S_ISUID;
      if (who.includes('g')) clear |= S_ISGID;
      if (who.includes('o')) clear |= S_ISVTX;
      mode = (mode & ~clear) | value | special;
    }
    col += clause.length + 1;
  }
  return mode & 0o7777;
}

/* ---------------------------------------------------------------- format */

export function toOctal(mode: number, digits: 3 | 4): string {
  const s = (mode & 0o7777).toString(8).padStart(4, '0');
  return digits === 4 ? s : s.slice(1);
}

export function toSymbolic(mode: number): string {
  const r = (b: number) => (mode & b ? 'r' : '-');
  const w = (b: number) => (mode & b ? 'w' : '-');
  const x = (b: number, special: number, on: string, off: string) => (mode & special ? (mode & b ? on : off) : mode & b ? 'x' : '-');
  return r(0o400) + w(0o200) + x(0o100, S_ISUID, 's', 'S') + r(0o040) + w(0o020) + x(0o010, S_ISGID, 's', 'S') + r(0o004) + w(0o002) + x(0o001, S_ISVTX, 't', 'T');
}

export interface PermBits { r: boolean; w: boolean; x: boolean }

export function bitsOf(mode: number): { owner: PermBits; group: PermBits; others: PermBits; setuid: boolean; setgid: boolean; sticky: boolean } {
  const trip = (shift: number): PermBits => ({ r: ((mode >> shift) & 4) !== 0, w: ((mode >> shift) & 2) !== 0, x: ((mode >> shift) & 1) !== 0 });
  return { owner: trip(6), group: trip(3), others: trip(0), setuid: (mode & S_ISUID) !== 0, setgid: (mode & S_ISGID) !== 0, sticky: (mode & S_ISVTX) !== 0 };
}

/* ----------------------------------------------------------------- parse */

export interface ParsedMode {
  mode: number;
  /** How the input was read. */
  form: 'octal' | 'symbolic' | 'expression';
  /** File-type character when given (`d`, `l`, …). */
  fileType: string | null;
  note?: string;
}

/** Parse one input line: octal, ls-style symbolic, or `<expression> <base>`. */
export function parseModeLine(text: string): ParsedMode {
  const t = text.trim().replace(/\s+/g, ' ');
  if (/^[0-7]{3,4}$/.test(t)) return { mode: parseOctal(t), form: 'octal', fileType: null };
  if (SYMBOLIC_RE.test(t)) {
    const m = SYMBOLIC_RE.exec(t)!;
    return { mode: parseSymbolic(t), form: 'symbolic', fileType: m[1] && m[1] !== '-' ? m[1] : null };
  }
  const parts = t.split(' ');
  if (parts.length <= 2 && /[+\-=]/.test(parts[0]!) && /^[a-zA-Z,+\-=]+$/.test(parts[0]!)) {
    let base = 0;
    let note: string | undefined;
    if (parts.length === 2) {
      const b = parts[1]!;
      if (/^[0-7]{3,4}$/.test(b)) base = parseOctal(b);
      else if (SYMBOLIC_RE.test(b)) base = parseSymbolic(b);
      else throw new ChmodError(`"${b}" is not a base mode`, 'After the expression give the starting mode as octal (644) or symbolic (rw-r--r--).', parts[0]!.length + 2);
    } else {
      note = 'No base mode given — applied to 000.';
    }
    return { mode: applyExpression(parts[0]!, base), form: 'expression', fileType: null, note };
  }
  // Reversed order: `644 u+x` is a common slip.
  if (parts.length === 2 && isExpression(parts[1]!) && (/^[0-7]{3,4}$/.test(parts[0]!) || SYMBOLIC_RE.test(parts[0]!))) {
    return parseModeLine(`${parts[1]} ${parts[0]}`);
  }
  throw new ChmodError(`Cannot read "${t}" as a mode`, 'Use octal (755, 0644, 4755), symbolic (rwxr-xr-x, -rw-r--r--) or an expression with a base (u+x,go-w 644).');
}
