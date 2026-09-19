/**
 * toml.ts — a hand-rolled TOML 1.0 parser and emitter (no dependencies).
 *
 * Parser (`parseToml`) implements the full TOML 1.0 grammar:
 *  - bare / quoted / dotted keys; `key = value` pairs; comments
 *  - strings: basic (all escapes incl. \uXXXX / \UXXXXXXXX), literal,
 *    multi-line basic (line-ending backslash) and multi-line literal
 *  - integers: decimal with underscores, 0x / 0o / 0b; floats with fraction,
 *    exponent, `inf` / `nan`
 *  - booleans
 *  - offset date-time, local date-time, local date, local time — emitted as
 *    plain ISO strings (JSON has no date type); a `T` replaces a space
 *    separator so the strings are always ISO-8601
 *  - arrays (multi-line, trailing comma, mixed types), inline tables
 *  - tables `[a.b]`, arrays of tables `[[x]]`, with the spec's rules on
 *    redefinition (duplicate keys / tables are errors, inline tables and
 *    static arrays are immutable)
 *
 * Errors are `TomlParseError`s with a 1-based line / column and a hint.
 *
 * Emitter (`stringifyToml`) writes deterministic TOML: simple keys first,
 * then nested objects as `[a.b]` tables and arrays of objects as `[[x]]`
 * arrays of tables; other arrays inline; keys quoted only when needed;
 * insertion order preserved. `null` has no TOML form and is skipped (the
 * skipped paths are reported through `opts.skipped`).
 */

export class TomlParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'TomlParseError';
  }
}

type Table = Record<string, unknown>;

const isTable = (v: unknown): v is Table => typeof v === 'object' && v !== null && !Array.isArray(v);

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const DEC_INT = /^[+-]?(0|[1-9](_?[0-9])*)$/;
const FLOAT = /^[+-]?(0|[1-9](_?[0-9])*)(\.[0-9](_?[0-9])*)?([eE][+-]?[0-9](_?[0-9])*)?$/;
const PREFIXED_INT = /^0(x[0-9A-Fa-f](_?[0-9A-Fa-f])*|o[0-7](_?[0-7])*|b[01](_?[01])*)$/;
const OFFSET_DT = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/;
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export interface ParseInfo {
  value: unknown;
  /** Number of date / time values that were emitted as strings. */
  dates: number;
}

class Parser {
  private pos = 0;
  private root: Table = {};
  /** Tables defined with a [header]. */
  private explicit = new Set<object>();
  /** Tables created by dotted keys in key/value pairs (cannot be reopened by a header). */
  private dotted = new Set<object>();
  /** Inline tables and static arrays — immutable after creation. */
  private frozen = new Set<object>();
  /** Arrays created by [[header]]. */
  private arrayTables = new Set<unknown[]>();
  dates = 0;

  constructor(private src: string) {}

  /* ---------------------------------------------------------- positions */

  private lineCol(pos: number): [number, number] {
    let line = 1;
    let last = 0;
    for (let i = 0; i < pos && i < this.src.length; i++) {
      if (this.src.charCodeAt(i) === 10) {
        line++;
        last = i + 1;
      }
    }
    return [line, pos - last + 1];
  }

  private error(message: string, hint?: string, pos = this.pos): never {
    const [line, col] = this.lineCol(pos);
    throw new TomlParseError(message, line, col, hint);
  }

  private peek(off = 0): string {
    return this.src[this.pos + off] ?? '';
  }

  private eof(): boolean {
    return this.pos >= this.src.length;
  }

  private skipWs(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++;
  }

  private skipComment(): void {
    if (this.peek() === '#') {
      while (!this.eof() && this.peek() !== '\n') this.pos++;
    }
  }

  private skipNewline(): boolean {
    if (this.peek() === '\n') {
      this.pos++;
      return true;
    }
    if (this.peek() === '\r' && this.peek(1) === '\n') {
      this.pos += 2;
      return true;
    }
    return false;
  }

  /** Whitespace, comments and newlines (between statements and inside arrays). */
  private skipBlank(): void {
    for (;;) {
      this.skipWs();
      this.skipComment();
      if (!this.skipNewline()) return;
    }
  }

  private expectLineEnd(): void {
    this.skipWs();
    this.skipComment();
    if (this.eof() || this.skipNewline()) return;
    this.error(`Unexpected "${this.peek()}" after value`, 'Each key/value pair and table header must be on its own line.');
  }

  /* --------------------------------------------------------------- keys */

  private parseKeySegment(): string {
    const c = this.peek();
    if (c === '"') return this.parseBasicString();
    if (c === "'") return this.parseLiteralString();
    const start = this.pos;
    while (/[A-Za-z0-9_-]/.test(this.peek())) this.pos++;
    if (this.pos === start) {
      if (this.eof() || c === '\n' || c === '\r') this.error('Expected a key', 'Keys are bare (a-z, 0-9, _ -) or quoted strings.');
      this.error(`Invalid character "${c}" in key`, 'Bare keys may only contain A-Z, a-z, 0-9, _ and -; quote anything else: "my key" = 1');
    }
    return this.src.slice(start, this.pos);
  }

  private parseKey(): string[] {
    const segs = [this.parseKeySegment()];
    for (;;) {
      this.skipWs();
      if (this.peek() !== '.') return segs;
      this.pos++;
      this.skipWs();
      segs.push(this.parseKeySegment());
    }
  }

  /* ------------------------------------------------------------ strings */

  private parseEscape(): string {
    // this.pos is just after the backslash
    const c = this.peek();
    const at = this.pos - 1;
    this.pos++;
    switch (c) {
      case 'b':
        return '\b';
      case 't':
        return '\t';
      case 'n':
        return '\n';
      case 'f':
        return '\f';
      case 'r':
        return '\r';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case 'u':
      case 'U': {
        const len = c === 'u' ? 4 : 8;
        const hex = this.src.slice(this.pos, this.pos + len);
        if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) this.error(`Invalid unicode escape \\${c}${hex}`, `\\${c} must be followed by exactly ${len} hex digits.`, at);
        const cp = parseInt(hex, 16);
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) this.error(`Invalid unicode code point \\${c}${hex}`, 'The code point must be a Unicode scalar value.', at);
        this.pos += len;
        return String.fromCodePoint(cp);
      }
      default:
        this.error(`Invalid escape sequence \\${c}`, 'Valid escapes are \\b \\t \\n \\f \\r \\" \\\\ \\uXXXX \\UXXXXXXXX. Use a literal string (\'...\') for raw backslashes.', at);
    }
  }

  private parseBasicString(): string {
    const start = this.pos;
    this.pos++; // opening quote
    let out = '';
    for (;;) {
      if (this.eof() || this.peek() === '\n' || this.peek() === '\r') this.error('Unterminated string', 'Add the closing " — or use """ for a multi-line string.', start);
      const c = this.peek();
      if (c === '"') {
        this.pos++;
        return out;
      }
      if (c === '\\') {
        this.pos++;
        out += this.parseEscape();
        continue;
      }
      const code = c.charCodeAt(0);
      if ((code < 0x20 && code !== 9) || code === 0x7f) this.error('Control character in string', 'Escape it (\\n, \\t, \\u0007 …) instead of including it raw.');
      out += c;
      this.pos++;
    }
  }

  private parseMultilineBasic(): string {
    const start = this.pos;
    this.pos += 3;
    this.skipNewline();
    let out = '';
    for (;;) {
      if (this.eof()) this.error('Unterminated multi-line string', 'Add the closing """.', start);
      if (this.src.startsWith('"""', this.pos)) {
        // Up to two extra quotes belong to the content.
        let extra = 0;
        while (extra < 2 && this.peek(3 + extra) === '"') extra++;
        out += '"'.repeat(extra);
        this.pos += 3 + extra;
        return out;
      }
      const c = this.peek();
      if (c === '\\') {
        // Line-ending backslash: trim all whitespace and newlines that follow.
        let j = this.pos + 1;
        while (this.src[j] === ' ' || this.src[j] === '\t') j++;
        if (this.src[j] === '\n' || (this.src[j] === '\r' && this.src[j + 1] === '\n')) {
          while (j < this.src.length && /[ \t\r\n]/.test(this.src[j]!)) j++;
          this.pos = j;
          continue;
        }
        this.pos++;
        out += this.parseEscape();
        continue;
      }
      if (c === '\r' && this.peek(1) === '\n') {
        out += '\n';
        this.pos += 2;
        continue;
      }
      const code = c.charCodeAt(0);
      if ((code < 0x20 && code !== 9 && code !== 10) || code === 0x7f) this.error('Control character in string', 'Escape it (\\u0007 …) instead of including it raw.');
      out += c;
      this.pos++;
    }
  }

  private parseLiteralString(): string {
    const start = this.pos;
    this.pos++;
    const end = this.src.indexOf("'", this.pos);
    const nl = this.src.slice(this.pos, end === -1 ? undefined : end).search(/[\r\n]/);
    if (end === -1 || nl !== -1) this.error('Unterminated literal string', "Add the closing ' — or use ''' for a multi-line literal string.", start);
    const s = this.src.slice(this.pos, end);
    this.pos = end + 1;
    return s;
  }

  private parseMultilineLiteral(): string {
    const start = this.pos;
    this.pos += 3;
    this.skipNewline();
    let out = '';
    for (;;) {
      if (this.eof()) this.error('Unterminated multi-line literal string', "Add the closing '''.", start);
      if (this.src.startsWith("'''", this.pos)) {
        let extra = 0;
        while (extra < 2 && this.peek(3 + extra) === "'") extra++;
        out += "'".repeat(extra);
        this.pos += 3 + extra;
        return out;
      }
      if (this.peek() === '\r' && this.peek(1) === '\n') {
        out += '\n';
        this.pos += 2;
        continue;
      }
      out += this.peek();
      this.pos++;
    }
  }

  /* ------------------------------------------------------------- values */

  private parseValue(): unknown {
    const c = this.peek();
    if (c === '"') return this.src.startsWith('"""', this.pos) ? this.parseMultilineBasic() : this.parseBasicString();
    if (c === "'") return this.src.startsWith("'''", this.pos) ? this.parseMultilineLiteral() : this.parseLiteralString();
    if (c === '[') return this.parseArray();
    if (c === '{') return this.parseInlineTable();
    if (this.eof() || c === '\n' || c === '\r' || c === '#') this.error('Expected a value', 'Every key needs a value: key = "value".');
    const start = this.pos;
    while (!this.eof() && !/[\s,\]}#]/.test(this.peek())) this.pos++;
    let tok = this.src.slice(start, this.pos);
    // Local / offset date-time written with a space separator: "1979-05-27 07:32:00".
    if (LOCAL_DATE.test(tok) && this.peek() === ' ' && /\d/.test(this.peek(1))) {
      let j = this.pos + 1;
      while (j < this.src.length && !/[\s,\]}#]/.test(this.src[j]!)) j++;
      const rest = this.src.slice(this.pos + 1, j);
      if (LOCAL_TIME.test(rest) || /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/.test(rest)) {
        tok = `${tok}T${rest}`;
        this.pos = j;
      }
    }
    if (tok === '') this.error(`Unexpected "${c}"`, 'Expected a value here.');
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (/^[+-]?inf$/.test(tok)) return tok.startsWith('-') ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(tok)) return NaN;
    if (PREFIXED_INT.test(tok)) {
      const digits = tok.slice(2).replace(/_/g, '');
      const radix = tok[1] === 'x' ? 16 : tok[1] === 'o' ? 8 : 2;
      return parseInt(digits, radix);
    }
    if (DEC_INT.test(tok)) return Number(tok.replace(/_/g, ''));
    if (FLOAT.test(tok)) return Number(tok.replace(/_/g, ''));
    if (OFFSET_DT.test(tok) || LOCAL_DT.test(tok) || LOCAL_DATE.test(tok) || LOCAL_TIME.test(tok)) {
      this.dates++;
      return tok.replace(/^(\d{4}-\d{2}-\d{2})[t ]/, '$1T');
    }
    // Diagnose the most common mistakes.
    if (/^[+-]?0\d/.test(tok)) this.error(`Invalid number "${tok}"`, 'Leading zeros are not allowed — write 7 instead of 007.', start);
    if (/^[+-]?\d/.test(tok) && /^[+-]?[\d_.eE+-]+$/.test(tok)) this.error(`Invalid number "${tok}"`, 'Underscores must sit between digits and a float needs digits on both sides of the dot (1.0, not 1.).', start);
    if (/^[+-]?\d/.test(tok)) this.error(`Invalid value "${tok}"`, 'Numbers cannot be followed by letters; quote it if it is a string.', start);
    this.error(`Invalid value "${tok}"`, `Strings must be quoted: "${tok}". Bare words are only allowed for true, false, inf and nan.`, start);
  }

  private parseArray(): unknown[] {
    const start = this.pos;
    this.pos++; // [
    const arr: unknown[] = [];
    this.frozen.add(arr);
    for (;;) {
      this.skipBlank();
      if (this.eof()) this.error('Unterminated array', 'Add the closing ].', start);
      if (this.peek() === ']') {
        this.pos++;
        return arr;
      }
      arr.push(this.parseValue());
      this.skipBlank();
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      if (this.peek() === ']') {
        this.pos++;
        return arr;
      }
      if (this.eof()) this.error('Unterminated array', 'Add the closing ].', start);
      this.error(`Expected "," or "]" in array, got "${this.peek()}"`, 'Separate array items with commas.');
    }
  }

  private parseInlineTable(): Table {
    const start = this.pos;
    this.pos++; // {
    const tbl: Table = {};
    this.frozen.add(tbl);
    this.skipWs();
    if (this.peek() === '}') {
      this.pos++;
      return tbl;
    }
    for (;;) {
      this.skipWs();
      if (this.peek() === '}') this.error('Trailing comma in inline table', 'Inline tables cannot end with a comma: { a = 1, b = 2 }.');
      if (this.eof() || this.peek() === '\n' || this.peek() === '\r') this.error('Unterminated inline table', 'Inline tables must be on one line and end with }.', start);
      this.parseKeyValue(tbl);
      this.skipWs();
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      if (this.peek() === '}') {
        this.pos++;
        this.freezeDeep(tbl);
        return tbl;
      }
      if (this.eof() || this.peek() === '\n' || this.peek() === '\r') this.error('Unterminated inline table', 'Inline tables must be on one line and end with }.', start);
      this.error(`Expected "," or "}" in inline table, got "${this.peek()}"`, 'Separate inline table pairs with commas.');
    }
  }

  private freezeDeep(tbl: Table): void {
    for (const v of Object.values(tbl)) {
      if (isTable(v)) {
        this.frozen.add(v);
        this.freezeDeep(v);
      }
    }
  }

  /* --------------------------------------------------------- statements */

  private parseKeyValue(into: Table): void {
    const keyStart = this.pos;
    const segs = this.parseKey();
    this.skipWs();
    if (this.peek() !== '=') this.error(`Expected "=" after key "${segs.join('.')}"`, 'Write key = value. Keys with spaces or dots must be quoted.');
    this.pos++;
    this.skipWs();
    let node = into;
    for (let i = 0; i < segs.length - 1; i++) {
      const k = segs[i]!;
      const existing = node[k];
      if (existing === undefined) {
        const t: Table = {};
        node[k] = t;
        this.dotted.add(t);
        node = t;
      } else if (isTable(existing)) {
        if (this.frozen.has(existing)) this.error(`Cannot add to inline table "${segs.slice(0, i + 1).join('.')}"`, 'Inline tables are closed once written; add the key inside the braces instead.', keyStart);
        if (this.explicit.has(existing)) this.error(`Cannot extend table "${segs.slice(0, i + 1).join('.')}" with dotted keys`, 'That table was defined with a [header]; add the key under the header instead.', keyStart);
        node = existing;
      } else {
        this.error(`Key "${segs.slice(0, i + 1).join('.')}" is not a table`, 'Dotted keys can only go through tables; this key already holds a value.', keyStart);
      }
    }
    const last = segs[segs.length - 1]!;
    if (Object.prototype.hasOwnProperty.call(node, last)) this.error(`Duplicate key "${segs.join('.')}"`, 'Each key can only be defined once in a table.', keyStart);
    node[last] = this.parseValue();
  }

  private descend(segs: string[], keyStart: number): Table {
    let node = this.root;
    for (const k of segs) {
      const existing = node[k];
      if (existing === undefined) {
        const t: Table = {};
        node[k] = t;
        node = t;
      } else if (isTable(existing)) {
        if (this.frozen.has(existing)) this.error(`Cannot open inline table "${k}" as a table`, 'Inline tables are closed once written.', keyStart);
        node = existing;
      } else if (Array.isArray(existing) && this.arrayTables.has(existing)) {
        node = existing[existing.length - 1] as Table;
      } else {
        this.error(`Key "${k}" is not a table`, 'A [header] path can only pass through tables and arrays of tables.', keyStart);
      }
    }
    return node;
  }

  private parseTableHeader(): Table {
    const start = this.pos;
    this.pos++; // [
    this.skipWs();
    const segs = this.parseKey();
    this.skipWs();
    if (this.peek() !== ']') this.error('Expected "]" to close the table header', 'Table headers look like [name] or [parent.child].');
    this.pos++;
    const parent = this.descend(segs.slice(0, -1), start);
    const last = segs[segs.length - 1]!;
    const existing = parent[last];
    if (existing === undefined) {
      const t: Table = {};
      parent[last] = t;
      this.explicit.add(t);
      return t;
    }
    if (isTable(existing) && !this.explicit.has(existing) && !this.dotted.has(existing) && !this.frozen.has(existing)) {
      this.explicit.add(existing); // implicitly created by a deeper header earlier
      return existing;
    }
    if (isTable(existing) || Array.isArray(existing)) this.error(`Table "${segs.join('.')}" is already defined`, 'Tables can only be defined once — merge the keys under a single [header].', start);
    this.error(`"${segs.join('.')}" is already defined as a value, not a table`, 'A key cannot be both a value and a table header.', start);
  }

  private parseArrayTableHeader(): Table {
    const start = this.pos;
    this.pos += 2; // [[
    this.skipWs();
    const segs = this.parseKey();
    this.skipWs();
    if (!this.src.startsWith(']]', this.pos)) this.error('Expected "]]" to close the array-of-tables header', 'Array of tables headers look like [[name]].');
    this.pos += 2;
    const parent = this.descend(segs.slice(0, -1), start);
    const last = segs[segs.length - 1]!;
    const existing = parent[last];
    const t: Table = {};
    this.explicit.add(t);
    if (existing === undefined) {
      const arr: unknown[] = [t];
      parent[last] = arr;
      this.arrayTables.add(arr);
      return t;
    }
    if (Array.isArray(existing) && this.arrayTables.has(existing)) {
      existing.push(t);
      return t;
    }
    if (Array.isArray(existing)) this.error(`Cannot append to static array "${segs.join('.')}"`, 'Arrays written inline ([...]) cannot be extended with [[header]].', start);
    this.error(`"${segs.join('.')}" is already defined as a ${isTable(existing) ? 'table' : 'value'}`, 'A [[header]] needs a new name, or must repeat an earlier [[header]].', start);
  }

  parse(): Table {
    let current = this.root;
    for (;;) {
      this.skipBlank();
      if (this.eof()) return this.root;
      if (this.peek() === '[') {
        current = this.src.startsWith('[[', this.pos) ? this.parseArrayTableHeader() : this.parseTableHeader();
      } else {
        this.parseKeyValue(current);
      }
      this.expectLineEnd();
    }
  }
}

/** Parse TOML text to a plain JS value; throws TomlParseError. */
export function parseTomlWithInfo(text: string): ParseInfo {
  const p = new Parser(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const value = p.parse();
  return { value, dates: p.dates };
}

export function parseToml(text: string): unknown {
  return parseTomlWithInfo(text).value;
}

/* ------------------------------------------------------------------------ */
/* Emitter                                                                   */
/* ------------------------------------------------------------------------ */

export interface StringifyTomlOptions {
  /** Receives the dotted path of every null / undefined value that was skipped. */
  skipped?: string[];
}

function formatKey(k: string): string {
  return BARE_KEY.test(k) ? k : formatBasicString(k);
}

function formatBasicString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
    else out += ch;
  }
  return out + '"';
}

function formatString(s: string): string {
  // Multi-line basic string when it reads better and needs no escaping beyond backslashes.
  if (s.includes('\n') && !s.includes('"""') && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s)) {
    return '"""\n' + s.replace(/\\/g, '\\\\') + '"""';
  }
  return formatBasicString(s);
}

function formatNumber(n: number): string {
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (Number.isNaN(n)) return 'nan';
  const s = String(n);
  if (Number.isInteger(n) && !/e/i.test(s)) return s;
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

function isArrayOfTables(v: unknown): v is Table[] {
  return Array.isArray(v) && v.length > 0 && v.every(isTable);
}

function formatInline(v: unknown, path: string, opts: StringifyTomlOptions): string {
  if (v === null || v === undefined) {
    opts.skipped?.push(path);
    return '';
  }
  if (typeof v === 'string') return formatString(v);
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const items = v.map((x, i) => formatInline(x, `${path}[${i}]`, opts)).filter((s) => s !== '');
    return `[${items.join(', ')}]`;
  }
  if (isTable(v)) {
    const pairs = Object.entries(v)
      .map(([k, x]) => [formatKey(k), formatInline(x, path ? `${path}.${k}` : k, opts)] as const)
      .filter(([, s]) => s !== '')
      .map(([k, s]) => `${k} = ${s}`);
    return pairs.length ? `{ ${pairs.join(', ')} }` : '{}';
  }
  throw new Error(`Cannot represent a ${typeof v} in TOML`);
}

function emitTable(tbl: Table, path: string[], lines: string[], opts: StringifyTomlOptions, header: 'table' | 'array' | 'none'): void {
  const simple: [string, unknown][] = [];
  const tables: [string, Table][] = [];
  const arrays: [string, Table[]][] = [];
  for (const [k, v] of Object.entries(tbl)) {
    if (v === null || v === undefined) opts.skipped?.push([...path, k].join('.'));
    else if (isTable(v)) tables.push([k, v]);
    else if (isArrayOfTables(v)) arrays.push([k, v]);
    else simple.push([k, v]);
  }
  const dotted = path.map(formatKey).join('.');
  const needsHeader = header !== 'none' && (simple.length > 0 || (tables.length === 0 && arrays.length === 0));
  if (header === 'array' || needsHeader) {
    if (lines.length) lines.push('');
    lines.push(header === 'array' ? `[[${dotted}]]` : `[${dotted}]`);
  }
  for (const [k, v] of simple) {
    const s = formatInline(v, [...path, k].join('.'), opts);
    if (s !== '') lines.push(`${formatKey(k)} = ${s}`);
  }
  for (const [k, v] of tables) emitTable(v, [...path, k], lines, opts, 'table');
  for (const [k, arr] of arrays) for (const item of arr) emitTable(item, [...path, k], lines, opts, 'array');
}

/** Serialise a plain object as TOML. Throws for non-object roots. */
export function stringifyToml(value: unknown, opts: StringifyTomlOptions = {}): string {
  if (!isTable(value)) {
    throw Object.assign(new Error(`TOML documents must be an object at the top level (got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value})`), {
      hint: 'Wrap the value in an object, e.g. {"items": [...]}.',
    });
  }
  const lines: string[] = [];
  emitTable(value, [], lines, opts, 'none');
  return lines.join('\n');
}

/* ------------------------------------------------------------------------ */
/* Sniffing                                                                  */
/* ------------------------------------------------------------------------ */

const HEADER_LINE = /^\[\[?\s*[A-Za-z0-9_.\- ]+\s*\]\]?\s*(#.*)?$/;

/** True when the text looks like TOML rather than JSON / YAML / CSV. */
export function looksLikeToml(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  const first = lines[0];
  if (!first) return false;
  if (HEADER_LINE.test(first)) return true;
  return /^([A-Za-z0-9_-]+|"[^"]*"|'[^']*')(\s*\.\s*([A-Za-z0-9_-]+|"[^"]*"|'[^']*'))*\s*=/.test(first);
}
