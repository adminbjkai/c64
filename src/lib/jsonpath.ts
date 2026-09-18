/**
 * jsonpath.ts — a small, dependency-free JSONPath query engine.
 *
 * Approach
 * --------
 * 1. A hand-written recursive-descent parser turns the expression into a list
 *    of `Segment`s. Each segment is either a child segment (`.name`, `[...]`)
 *    or a descendant segment (`..name`, `..[...]`) holding one or more
 *    selectors (a bracket union like `[0,2]` yields several selectors).
 * 2. Evaluation walks the segments left to right over a list of nodes
 *    (`{ path, value }`), starting with the root. Selectors in a union are
 *    applied in the order written, per input node, so results are in document
 *    order and fully deterministic.
 *
 * Supported syntax
 * ----------------
 *   $                       root (optional: `a.b` is treated as `$.a.b`)
 *   .name  ['name'] ["n"]   child member
 *   [0]  [-1]               array index (negative counts from the end)
 *   [*]  .*                 wildcard (array items / object values)
 *   ..name  ..*  ..[sel]    recursive descent (pre-order, self included)
 *   [0,2]  ['a','b']        union (any mix of selectors)
 *   [start:end:step]        slice, Python semantics, every part optional
 *   [?(expr)]  [?expr]      filter over array items / object values
 *
 * Filter expressions: `||` of `&&` of terms. A term is either a comparison
 * `operand OP operand` (OP in == != < <= > >=) or an existence test
 * `@.path` (optionally negated with `!`). Operands are `@` / `$` relative
 * paths (dot or bracket children, indices) or literals (numbers, quoted
 * strings, true, false, null).
 *
 * Semantics / limitations
 * -----------------------
 * - Ordering comparisons only succeed between two numbers or two strings.
 * - `==` uses deep structural equality. If a path is missing, `==` is false
 *   and `!=` is true (unless both sides are missing, which count as equal).
 * - No parenthesised sub-expressions inside a filter, no functions
 *   (`length()`, `match()`...), no script expressions `[(...)]`.
 * - A slice step of 0 is a syntax error (Python raises for it too).
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Syntax error in a JSONPath expression. `col` is 1-based in the expression. */
export class JsonPathError extends Error {
  line: number;
  col: number;
  hint?: string;

  constructor(message: string, col: number, hint?: string, line = 1) {
    super(message);
    this.name = 'JsonPathError';
    this.line = line;
    this.col = col;
    if (hint !== undefined) this.hint = hint;
  }
}

/** One query result: the location (segments from root) and the value found there. */
export interface JsonPathMatch {
  path: (string | number)[];
  value: unknown;
}

/**
 * Run `expression` against `root` and return every match in document order.
 * Throws JsonPathError when the expression cannot be parsed.
 */
export function queryJsonPath(root: unknown, expression: string): JsonPathMatch[] {
  const segments = new Parser(expression).parseQuery();
  return evaluate(root, segments);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Render path segments as a JSONPath string.
 *  - 'dot' (default): `$.a.b[0].c`, falling back to `$["my key"]` for keys that
 *    are not plain identifiers.
 *  - 'bracket': `$['a']['b'][0]['c']` with single-quoted, escaped keys.
 */
export function formatPath(segments: (string | number)[], style: 'dot' | 'bracket' = 'dot'): string {
  let out = '$';
  for (const seg of segments) {
    if (typeof seg === 'number') {
      out += `[${seg}]`;
    } else if (style === 'bracket') {
      out += `['${escapeSingleQuoted(seg)}']`;
    } else if (IDENTIFIER.test(seg)) {
      out += `.${seg}`;
    } else {
      out += `[${JSON.stringify(seg)}]`;
    }
  }
  return out;
}

/** Escape a string for use inside single quotes (JSON-style escapes, `'` escaped instead of `"`). */
function escapeSingleQuoted(s: string): string {
  return JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Selector =
  | { kind: 'name'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'slice'; start: number | null; end: number | null; step: number | null }
  | { kind: 'filter'; expr: FilterExpr };

interface Segment {
  descendant: boolean;
  selectors: Selector[];
}

/** A path inside a filter: `@.a[0]['b']` (relative) or `$.x` (absolute). */
interface PathOperand {
  kind: 'path';
  absolute: boolean;
  steps: (string | number)[];
}
interface LiteralOperand {
  kind: 'literal';
  value: string | number | boolean | null;
}
type Operand = PathOperand | LiteralOperand;

type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

type FilterExpr =
  | { kind: 'or'; parts: FilterExpr[] }
  | { kind: 'and'; parts: FilterExpr[] }
  | { kind: 'not'; expr: FilterExpr }
  | { kind: 'exists'; path: PathOperand }
  | { kind: 'compare'; op: CompareOp; left: Operand; right: Operand };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const NAME_CHAR = /[\p{L}\p{N}_$-]/u;

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  /** Throw an error located at `pos` (0-based), reported 1-based. */
  private fail(message: string, hint?: string, pos = this.pos): never {
    throw new JsonPathError(message, pos + 1, hint);
  }

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }

  private skipWs(): void {
    while (!this.atEnd() && /\s/.test(this.peek())) this.pos++;
  }

  private expect(ch: string, hint?: string): void {
    this.skipWs();
    if (this.peek() !== ch) {
      const found = this.atEnd() ? 'end of expression' : `'${this.peek()}'`;
      this.fail(`Expected '${ch}' but found ${found}`, hint);
    }
    this.pos++;
  }

  /** Entry point: the whole expression. */
  parseQuery(): Segment[] {
    this.skipWs();
    if (this.atEnd()) {
      this.fail('Empty expression', "Start with '$' for the root, e.g. $.store.book[0]");
    }
    const segments: Segment[] = [];
    if (this.peek() === '$') {
      this.pos++;
    } else if (this.peek() === '@') {
      // Tolerate a leading '@' (common when copying from filters): same as '$'.
      this.pos++;
    } else if (this.peek() !== '.' && this.peek() !== '[') {
      // Bare expression like `store.book`: the first name is an implicit `$.` child.
      segments.push(this.parseDotChild(false));
    }

    for (;;) {
      this.skipWs();
      if (this.atEnd()) break;
      const ch = this.peek();
      if (ch === '.') {
        if (this.peek(1) === '.') {
          this.pos += 2;
          segments.push(this.parseDescendant());
        } else {
          this.pos++;
          segments.push(this.parseDotChild(false));
        }
      } else if (ch === '[') {
        segments.push({ descendant: false, selectors: this.parseBracket() });
      } else {
        this.fail(`Unexpected '${ch}'`, "Segments start with '.name', '[...]' or '..'");
      }
    }
    return segments;
  }

  /** After `..`: a name, `*` or a bracket. */
  private parseDescendant(): Segment {
    if (this.peek() === '[') return { descendant: true, selectors: this.parseBracket() };
    if (this.atEnd()) {
      this.fail("Expression ends after '..'", "Add a name, '*' or '[...]' after '..', e.g. $..price");
    }
    return this.parseDotChild(true);
  }

  /** A dot-notation child (`name` or `*`), cursor positioned just after the dot. */
  private parseDotChild(descendant: boolean): Segment {
    if (this.peek() === '*') {
      this.pos++;
      return { descendant, selectors: [{ kind: 'wildcard' }] };
    }
    const start = this.pos;
    while (!this.atEnd() && NAME_CHAR.test(this.peek())) this.pos++;
    if (this.pos === start) {
      if (this.atEnd()) this.fail("Expected a name after '.'", "Add a member name, e.g. $.items");
      this.fail(
        `Unexpected '${this.peek()}' in member name`,
        "Use bracket notation for unusual keys, e.g. $['my key']",
      );
    }
    return { descendant, selectors: [{ kind: 'name', name: this.src.slice(start, this.pos) }] };
  }

  /** `[ selector (, selector)* ]` — cursor on '['. */
  private parseBracket(): Selector[] {
    const open = this.pos;
    this.pos++; // '['
    const selectors: Selector[] = [];
    for (;;) {
      this.skipWs();
      if (this.atEnd()) this.fail("Unclosed '['", "Add a closing ']'", open);
      selectors.push(this.parseSelector());
      this.skipWs();
      if (this.peek() === ',') {
        this.pos++;
        continue;
      }
      if (this.peek() === ']') {
        this.pos++;
        return selectors;
      }
      if (this.atEnd()) this.fail("Unclosed '['", "Add a closing ']'", open);
      this.fail(`Unexpected '${this.peek()}' in brackets`, "Separate union members with ',' and close with ']'");
    }
  }

  private parseSelector(): Selector {
    const ch = this.peek();
    if (ch === '*') {
      this.pos++;
      return { kind: 'wildcard' };
    }
    if (ch === "'" || ch === '"') return { kind: 'name', name: this.parseString() };
    if (ch === '?') {
      this.pos++;
      return { kind: 'filter', expr: this.parseFilterBody() };
    }
    if (ch === '(') {
      this.fail('Script expressions are not supported', 'Use a filter instead, e.g. [?(@.price < 10)]');
    }
    if (ch === ':' || ch === '-' || isDigit(ch)) return this.parseIndexOrSlice();
    if (ch === ']' || ch === ',') this.fail('Empty selector', "Put an index, 'name', '*' or ?(filter) here");
    this.fail(
      `Unexpected '${ch}' in brackets`,
      "Quote member names in brackets, e.g. ['name'], or use an index like [0]",
    );
  }

  /** `n`, or a slice `start:end:step` with any part optional. */
  private parseIndexOrSlice(): Selector {
    const startPos = this.pos;
    const parts: (number | null)[] = [];
    let colons = 0;
    for (;;) {
      this.skipWs();
      parts.push(this.peek() === '-' || isDigit(this.peek()) ? this.parseInt() : null);
      this.skipWs();
      if (this.peek() === ':') {
        colons++;
        if (colons > 2) this.fail('Too many colons in slice', 'Slices look like [start:end:step]');
        this.pos++;
        continue;
      }
      break;
    }
    if (colons === 0) {
      const index = parts[0];
      if (index === null || index === undefined) this.fail('Expected an index', undefined, startPos);
      return { kind: 'index', index };
    }
    const [start = null, end = null, step = null] = parts;
    if (step === 0) this.fail('Slice step cannot be 0', 'Use a positive or negative step, e.g. [::2]', startPos);
    return { kind: 'slice', start, end, step };
  }

  private parseInt(): number {
    const start = this.pos;
    if (this.peek() === '-') this.pos++;
    const digitsStart = this.pos;
    while (isDigit(this.peek())) this.pos++;
    if (this.pos === digitsStart) this.fail("Expected digits after '-'", 'Negative indices look like [-1]', start);
    return Number(this.src.slice(start, this.pos));
  }

  /** Quoted string with JSON-style escapes; either quote style. */
  private parseString(): string {
    const start = this.pos;
    const quote = this.peek();
    this.pos++;
    let out = '';
    for (;;) {
      if (this.atEnd()) this.fail('Unterminated string', `Close the string with ${quote}`, start);
      const ch = this.peek();
      this.pos++;
      if (ch === quote) return out;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const esc = this.peek();
      this.pos++;
      switch (esc) {
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case "'": out += "'"; break;
        case '"': out += '"'; break;
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'u': {
          const hex = this.src.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            this.fail('Invalid \\u escape', 'Use four hex digits, e.g. \\u00e9', this.pos - 2);
          }
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
          break;
        }
        default:
          this.fail(`Invalid escape '\\${esc}'`, 'Escape backslashes as \\\\', this.pos - 2);
      }
    }
  }

  // --- filters -------------------------------------------------------------

  /** After `?`: either `( expr )` or a bare expr running up to `,` / `]`. */
  private parseFilterBody(): FilterExpr {
    this.skipWs();
    if (this.peek() === '(') {
      this.pos++;
      const expr = this.parseOr();
      this.expect(')', "Close the filter with ')', e.g. [?(@.price < 10)]");
      return expr;
    }
    return this.parseOr();
  }

  private parseOr(): FilterExpr {
    const parts = [this.parseAnd()];
    for (;;) {
      this.skipWs();
      if (this.peek() === '|' && this.peek(1) === '|') {
        this.pos += 2;
        parts.push(this.parseAnd());
      } else break;
    }
    return parts.length === 1 ? parts[0]! : { kind: 'or', parts };
  }

  private parseAnd(): FilterExpr {
    const parts = [this.parseTerm()];
    for (;;) {
      this.skipWs();
      if (this.peek() === '&' && this.peek(1) === '&') {
        this.pos += 2;
        parts.push(this.parseTerm());
      } else break;
    }
    return parts.length === 1 ? parts[0]! : { kind: 'and', parts };
  }

  private parseTerm(): FilterExpr {
    this.skipWs();
    if (this.peek() === '!' && this.peek(1) !== '=') {
      this.pos++;
      this.skipWs();
      const pos = this.pos;
      const operand = this.parseOperand();
      if (operand.kind !== 'path') this.fail("'!' must be followed by a path", 'e.g. [?(!@.deleted)]', pos);
      return { kind: 'not', expr: { kind: 'exists', path: operand } };
    }
    const leftPos = this.pos;
    const left = this.parseOperand();
    this.skipWs();
    const op = this.parseCompareOp();
    if (op === null) {
      if (left.kind !== 'path') {
        this.fail(
          'A literal on its own is not a condition',
          'Compare it with a path, e.g. [?(@.price < 10)]',
          leftPos,
        );
      }
      const ch = this.peek();
      if (ch === '=') this.fail("Single '=' is not an operator", "Use '==' to test equality");
      if (ch !== '' && ch !== ')' && ch !== ']' && ch !== ',' && ch !== '&' && ch !== '|') {
        this.fail(`Unexpected '${ch}' in filter`, 'Supported operators: == != < <= > >= && ||');
      }
      return { kind: 'exists', path: left };
    }
    this.skipWs();
    const right = this.parseOperand();
    return { kind: 'compare', op, left, right };
  }

  private parseCompareOp(): CompareOp | null {
    const two = this.src.slice(this.pos, this.pos + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      this.pos += 2;
      return two;
    }
    const one = this.peek();
    if (one === '<' || one === '>') {
      this.pos++;
      return one;
    }
    return null;
  }

  private parseOperand(): Operand {
    const ch = this.peek();
    if (ch === '@' || ch === '$') {
      this.pos++;
      return { kind: 'path', absolute: ch === '$', steps: this.parseFilterPathSteps() };
    }
    if (ch === "'" || ch === '"') return { kind: 'literal', value: this.parseString() };
    if (ch === '-' || isDigit(ch)) return { kind: 'literal', value: this.parseNumber() };
    for (const [word, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.src.startsWith(word, this.pos) && !NAME_CHAR.test(this.peek(word.length))) {
        this.pos += word.length;
        return { kind: 'literal', value };
      }
    }
    if (this.atEnd()) this.fail('Filter ends unexpectedly', "Complete the condition and close it with ')]'");
    if (ch === '(') this.fail('Nested parentheses are not supported in filters', 'Combine conditions with && and ||');
    this.fail(
      `Unexpected '${ch}' in filter`,
      "Use @.path, a number, a quoted string, true, false or null",
    );
  }

  /** Child steps after `@` / `$` inside a filter. */
  private parseFilterPathSteps(): (string | number)[] {
    const steps: (string | number)[] = [];
    for (;;) {
      const ch = this.peek();
      if (ch === '.') {
        if (this.peek(1) === '.') this.fail("Recursive descent '..' is not supported inside filters");
        this.pos++;
        if (this.peek() === '*') this.fail('Wildcards are not supported inside filters');
        const start = this.pos;
        while (!this.atEnd() && NAME_CHAR.test(this.peek())) this.pos++;
        if (this.pos === start) this.fail("Expected a name after '.'", "e.g. @.price or @['my key']");
        steps.push(this.src.slice(start, this.pos));
      } else if (ch === '[') {
        const open = this.pos;
        this.pos++;
        this.skipWs();
        const inner = this.peek();
        if (inner === "'" || inner === '"') steps.push(this.parseString());
        else if (inner === '-' || isDigit(inner)) steps.push(this.parseInt());
        else this.fail('Only names and indices are supported in filter paths', "e.g. @['key'] or @[0]");
        this.skipWs();
        if (this.peek() !== ']') this.fail("Expected ']'", undefined, this.atEnd() ? open : this.pos);
        this.pos++;
      } else {
        return steps;
      }
    }
  }

  private parseNumber(): number {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (!m) this.fail('Invalid number', 'Numbers look like 10, -2.5 or 1e3');
    this.pos += m[0].length;
    return Number(m[0]);
  }
}

function isDigit(ch: string): boolean {
  return ch.length === 1 && ch >= '0' && ch <= '9';
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function evaluate(root: Json, segments: Segment[]): JsonPathMatch[] {
  let nodes: JsonPathMatch[] = [{ path: [], value: root }];
  for (const seg of segments) {
    const next: JsonPathMatch[] = [];
    for (const node of nodes) {
      const targets = seg.descendant ? descendants(node) : [node];
      for (const t of targets) {
        for (const sel of seg.selectors) applySelector(root, t, sel, next);
      }
    }
    nodes = next;
  }
  return nodes;
}

/** Pre-order list of a node and all nodes beneath it (iterative: safe for deep docs). */
function descendants(node: JsonPathMatch): JsonPathMatch[] {
  const out: JsonPathMatch[] = [];
  const stack: JsonPathMatch[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    out.push(cur);
    const kids = children(cur);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return out;
}

function children(node: JsonPathMatch): JsonPathMatch[] {
  const v = node.value;
  if (Array.isArray(v)) return v.map((item, i) => ({ path: [...node.path, i], value: item }));
  if (isObject(v)) return Object.keys(v).map((k) => ({ path: [...node.path, k], value: v[k] }));
  return [];
}

function applySelector(root: Json, node: JsonPathMatch, sel: Selector, out: JsonPathMatch[]): void {
  const v = node.value;
  switch (sel.kind) {
    case 'name':
      if (isObject(v) && Object.prototype.hasOwnProperty.call(v, sel.name)) {
        out.push({ path: [...node.path, sel.name], value: v[sel.name] });
      }
      return;
    case 'index':
      if (Array.isArray(v)) {
        const i = sel.index < 0 ? v.length + sel.index : sel.index;
        if (i >= 0 && i < v.length) out.push({ path: [...node.path, i], value: v[i] });
      }
      return;
    case 'wildcard':
      out.push(...children(node));
      return;
    case 'slice':
      if (Array.isArray(v)) {
        for (const i of sliceIndices(v.length, sel.start, sel.end, sel.step)) {
          out.push({ path: [...node.path, i], value: v[i] });
        }
      }
      return;
    case 'filter':
      for (const child of children(node)) {
        if (testFilter(root, child.value, sel.expr)) out.push(child);
      }
      return;
  }
}

/** Python slice semantics: indices produced by `range(*slice(start, end, step).indices(len))`. */
function sliceIndices(len: number, start: number | null, end: number | null, step: number | null): number[] {
  const s = step ?? 1;
  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
  const norm = (n: number) => (n < 0 ? n + len : n);
  const out: number[] = [];
  if (s > 0) {
    const lo = start === null ? 0 : clamp(norm(start), 0, len);
    const hi = end === null ? len : clamp(norm(end), 0, len);
    for (let i = lo; i < hi; i += s) out.push(i);
  } else {
    const hi = start === null ? len - 1 : clamp(norm(start), -1, len - 1);
    const lo = end === null ? -1 : clamp(norm(end), -1, len - 1);
    for (let i = hi; i > lo; i += s) out.push(i);
  }
  return out;
}

/** Sentinel for "path does not exist". */
const NOTHING: unique symbol = Symbol('nothing');
type Resolved = Json | typeof NOTHING;

function resolve(root: Json, current: Json, operand: Operand): Resolved {
  if (operand.kind === 'literal') return operand.value;
  let v: Json = operand.absolute ? root : current;
  for (const step of operand.steps) {
    if (typeof step === 'number') {
      if (!Array.isArray(v)) return NOTHING;
      const i = step < 0 ? v.length + step : step;
      if (i < 0 || i >= v.length) return NOTHING;
      v = v[i];
    } else {
      if (!isObject(v) || !Object.prototype.hasOwnProperty.call(v, step)) return NOTHING;
      v = v[step];
    }
  }
  return v;
}

function testFilter(root: Json, current: Json, expr: FilterExpr): boolean {
  switch (expr.kind) {
    case 'or':
      return expr.parts.some((p) => testFilter(root, current, p));
    case 'and':
      return expr.parts.every((p) => testFilter(root, current, p));
    case 'not':
      return !testFilter(root, current, expr.expr);
    case 'exists':
      return resolve(root, current, expr.path) !== NOTHING;
    case 'compare':
      return compare(expr.op, resolve(root, current, expr.left), resolve(root, current, expr.right));
  }
}

function compare(op: CompareOp, a: Resolved, b: Resolved): boolean {
  switch (op) {
    case '==':
      return equal(a, b);
    case '!=':
      return !equal(a, b);
    default: {
      const comparable =
        (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
      if (!comparable) return false;
      const x = a as number | string;
      const y = b as number | string;
      if (op === '<') return x < y;
      if (op === '<=') return x <= y;
      if (op === '>') return x > y;
      return x >= y;
    }
  }
}

/** Deep structural equality; NOTHING equals only NOTHING. */
function equal(a: Resolved, b: Resolved): boolean {
  if (a === b) return true;
  if (a === NOTHING || b === NOTHING) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k]));
  }
  return false;
}
