/**
 * Safe arithmetic expression evaluator: tokenizer + shunting-yard to RPN +
 * a stack evaluator. No eval, no Function. Implements: decimal / 0x / 0b /
 * 0o literals with underscores and exponents; + - * / % ^ (right-assoc
 * power); unary minus/plus; parentheses; postfix percent (`15%` = 0.15,
 * distinguished from modulo by what follows); functions (sqrt cbrt abs
 * floor ceil round trunc sign min max sum avg pow exp log log2 log10 sin cos
 * tan asin acos atan atan2 hypot gcd lcm fact); constants pi, e; variables
 * assigned with `name = expr`; `ans` = previous result. Integer-only
 * expressions using + - * ^ % (and integer-preserving functions) are
 * evaluated exactly with BigInt; anything else falls back to floats.
 */

export type Value = number | bigint;

export class MathError extends Error {
  col: number;
  hint?: string;
  constructor(message: string, col: number, hint?: string) {
    super(message);
    this.col = col;
    this.hint = hint;
  }
}

type TokenType = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'percent';
interface Token {
  type: TokenType;
  text: string;
  col: number;
  value?: Value;
}

/* ------------------------------------------------------------ tokenizer */

function parseNumber(text: string, col: number): Value {
  const clean = text.replace(/_/g, '');
  if (/^0[xX]/.test(clean)) return BigInt(clean);
  if (/^0[bB]/.test(clean)) return BigInt(clean);
  if (/^0[oO]/.test(clean)) return BigInt(clean);
  if (/^\d+$/.test(clean)) return BigInt(clean);
  const n = Number(clean);
  if (!Number.isFinite(n)) throw new MathError(`"${text}" is not a valid number.`, col);
  return n;
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    const col = i + 1;
    if (ch === ' ' || ch === '\t') { i++; continue; }
    let m: RegExpExecArray | null;
    const rest = src.slice(i);
    if (/^0[xXbBoO](?![0-9a-fA-F])/.test(rest)) throw new MathError(`Incomplete number "${rest.slice(0, 2)}".`, col, 'Prefixes need digits after them, e.g. 0xff, 0b1010, 0o17.');
    if ((m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)/.exec(rest))) {
      const text = m[0];
      if (/_$/.test(text) || /__/.test(text)) throw new MathError(`Misplaced underscore in "${text}".`, col, 'Underscores may only sit between digits, e.g. 1_000_000.');
      if (/^0[xX][^0-9a-fA-F]*$/.test(text) || /^0[bB]_*$/.test(text) || /^0[oO]_*$/.test(text)) throw new MathError(`Incomplete number "${text}".`, col);
      tokens.push({ type: 'num', text, col, value: parseNumber(text, col) });
      i += text.length;
      continue;
    }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
      tokens.push({ type: 'ident', text: m[0], col });
      i += m[0].length;
      continue;
    }
    if ('+-*/^'.includes(ch)) { tokens.push({ type: 'op', text: ch, col }); i++; continue; }
    if (ch === '%') {
      // Modulo when an operand follows; percent otherwise.
      const after = src.slice(i + 1).trimStart();
      const operandFollows = /^[0-9A-Za-z_.(]/.test(after);
      tokens.push({ type: operandFollows ? 'op' : 'percent', text: '%', col });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen', text: ch, col }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', text: ch, col }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', text: ch, col }); i++; continue; }
    if (ch === '×' || ch === '·') { tokens.push({ type: 'op', text: '*', col }); i++; continue; }
    if (ch === '÷') { tokens.push({ type: 'op', text: '/', col }); i++; continue; }
    if (ch === '−') { tokens.push({ type: 'op', text: '-', col }); i++; continue; }
    if (ch === '*' ) { i++; continue; }
    throw new MathError(`Unexpected character '${ch}'.`, col, ch === '=' ? 'Assignments look like "name = expression" with a single "=".' : ch === '!' ? 'Use fact(n) for factorials.' : undefined);
  }
  return tokens;
}

/* ---------------------------------------------------------- shunting-yard */

interface OpInfo { prec: number; right: boolean; }
const BINARY: Record<string, OpInfo> = { '+': { prec: 1, right: false }, '-': { prec: 1, right: false }, '*': { prec: 2, right: false }, '/': { prec: 2, right: false }, '%': { prec: 2, right: false }, '^': { prec: 4, right: true } };
const UNARY_PREC = 3;

type Rpn =
  | { kind: 'num'; value: Value; col: number }
  | { kind: 'var'; name: string; col: number }
  | { kind: 'bin'; op: string; col: number }
  | { kind: 'neg'; col: number }
  | { kind: 'pct'; col: number }
  | { kind: 'call'; name: string; argc: number; col: number };

type StackItem = { kind: 'bin'; op: string; col: number } | { kind: 'neg'; col: number } | { kind: 'lparen'; col: number; fn?: string; argc: number; sawArg: boolean };

export function toRpn(tokens: Token[]): Rpn[] {
  const out: Rpn[] = [];
  const stack: StackItem[] = [];
  let expectOperand = true;
  let lastCol = 0;
  const popOps = (minPrec: number, right: boolean) => {
    while (stack.length) {
      const top = stack[stack.length - 1] as StackItem;
      if (top.kind === 'lparen') break;
      const prec = top.kind === 'neg' ? UNARY_PREC : (BINARY[top.op] as OpInfo).prec;
      if (prec > minPrec || (prec === minPrec && !right)) out.push(stack.pop() as Rpn);
      else break;
    }
  };
  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx] as Token;
    lastCol = t.col + t.text.length;
    const next = tokens[idx + 1];
    switch (t.type) {
      case 'num':
        if (!expectOperand) throw new MathError(`Unexpected number "${t.text}".`, t.col, 'Did you forget an operator between two values?');
        out.push({ kind: 'num', value: t.value as Value, col: t.col });
        expectOperand = false;
        break;
      case 'ident':
        if (!expectOperand) throw new MathError(`Unexpected "${t.text}".`, t.col, 'Did you forget an operator? Implicit multiplication is not supported.');
        if (next && next.type === 'lparen') {
          stack.push({ kind: 'lparen', col: next.col, fn: t.text, argc: 0, sawArg: false });
          idx++;
          expectOperand = true;
        } else {
          out.push({ kind: 'var', name: t.text, col: t.col });
          expectOperand = false;
        }
        break;
      case 'op':
        if (expectOperand) {
          if (t.text === '-') { stack.push({ kind: 'neg', col: t.col }); break; }
          if (t.text === '+') break;
          throw new MathError(`Missing operand before "${t.text}".`, t.col);
        }
        {
          const info = BINARY[t.text] as OpInfo;
          popOps(info.prec, info.right);
          stack.push({ kind: 'bin', op: t.text, col: t.col });
          expectOperand = true;
        }
        break;
      case 'percent':
        if (expectOperand) throw new MathError('Missing operand before "%".', t.col);
        out.push({ kind: 'pct', col: t.col });
        break;
      case 'lparen':
        if (!expectOperand) throw new MathError('Unexpected "(".', t.col, 'Did you forget an operator? Implicit multiplication is not supported.');
        stack.push({ kind: 'lparen', col: t.col, argc: 0, sawArg: false });
        expectOperand = true;
        break;
      case 'comma': {
        if (expectOperand) throw new MathError('Missing value before ",".', t.col);
        popOps(0, false);
        const top = stack[stack.length - 1];
        if (!top || top.kind !== 'lparen' || top.fn === undefined) throw new MathError('"," outside a function call.', t.col);
        top.argc++;
        expectOperand = true;
        break;
      }
      case 'rparen': {
        if (expectOperand) {
          const top = stack[stack.length - 1];
          if (top && top.kind === 'lparen' && top.fn !== undefined && top.argc === 0 && tokens[idx - 1]?.type === 'lparen') {
            // f() with no arguments
            stack.pop();
            out.push({ kind: 'call', name: top.fn, argc: 0, col: top.col });
            expectOperand = false;
            break;
          }
          throw new MathError('Missing value before ")".', t.col);
        }
        popOps(0, false);
        const top = stack.pop();
        if (!top || top.kind !== 'lparen') throw new MathError('Unmatched ")".', t.col);
        if (top.fn !== undefined) out.push({ kind: 'call', name: top.fn, argc: top.argc + 1, col: top.col });
        expectOperand = false;
        break;
      }
    }
  }
  if (expectOperand) throw new MathError(tokens.length ? 'Expression ends with an operator.' : 'Empty expression.', lastCol || 1);
  while (stack.length) {
    const top = stack.pop() as StackItem;
    if (top.kind === 'lparen') throw new MathError('Unmatched "(".', top.col, 'Add the closing parenthesis.');
    out.push(top);
  }
  return out;
}

/* ------------------------------------------------------------- evaluate */

const isInt = (v: Value): v is bigint => typeof v === 'bigint';
const num = (v: Value): number => (typeof v === 'bigint' ? Number(v) : v);

function bigPow(base: bigint, exp: bigint): bigint {
  if (exp > 100000n) throw new Error('Exponent too large for exact arithmetic.');
  let result = 1n;
  let b = base;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result *= b;
    e >>= 1n;
    if (e > 0n) b *= b;
  }
  return result;
}

function gcdBig(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function factorial(n: Value): Value {
  const k = num(n);
  if (!Number.isInteger(k) || k < 0) throw new Error('fact() needs a non-negative integer.');
  if (k > 5000) throw new Error('fact() argument too large (max 5000).');
  let r = 1n;
  for (let i = 2n; i <= BigInt(k); i++) r *= i;
  return r;
}

function binary(op: string, a: Value, b: Value): Value {
  if (isInt(a) && isInt(b)) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '%': if (b === 0n) throw new Error('Division by zero.'); return a % b;
      case '^': if (b >= 0n) return bigPow(a, b); return num(a) ** num(b);
      case '/': {
        if (b === 0n) throw new Error('Division by zero.');
        if (a % b === 0n) return a / b;
        return num(a) / num(b);
      }
    }
  }
  const x = num(a);
  const y = num(b);
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': if (y === 0) throw new Error('Division by zero.'); return x / y;
    case '%': if (y === 0) throw new Error('Division by zero.'); return x % y;
    case '^': return x ** y;
  }
  throw new Error(`Unknown operator ${op}`);
}

const F1: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, exp: Math.exp, log: Math.log, ln: Math.log, log2: Math.log2, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
};

export const FUNCTIONS = ['sqrt', 'cbrt', 'abs', 'floor', 'ceil', 'round', 'trunc', 'sign', 'min', 'max', 'sum', 'avg', 'pow', 'exp', 'log', 'ln', 'log2', 'log10', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'hypot', 'gcd', 'lcm', 'fact'];

function call(name: string, args: Value[]): Value {
  const need = (n: number) => { if (args.length !== n) throw new Error(`${name}() takes ${n} argument${n === 1 ? '' : 's'}, got ${args.length}.`); };
  const atLeast = (n: number) => { if (args.length < n) throw new Error(`${name}() needs at least ${n} argument${n === 1 ? '' : 's'}.`); };
  const allInt = args.every(isInt);
  if (F1[name]) { need(1); return (F1[name] as (x: number) => number)(num(args[0] as Value)); }
  switch (name) {
    case 'abs': need(1); return isInt(args[0] as Value) ? ((args[0] as bigint) < 0n ? -(args[0] as bigint) : (args[0] as bigint)) : Math.abs(args[0] as number);
    case 'sign': need(1); return isInt(args[0] as Value) ? BigInt(Math.sign(num(args[0] as Value))) : Math.sign(args[0] as number);
    case 'floor': need(1); return isInt(args[0] as Value) ? (args[0] as Value) : Math.floor(args[0] as number);
    case 'ceil': need(1); return isInt(args[0] as Value) ? (args[0] as Value) : Math.ceil(args[0] as number);
    case 'trunc': need(1); return isInt(args[0] as Value) ? (args[0] as Value) : Math.trunc(args[0] as number);
    case 'round': {
      atLeast(1);
      if (args.length > 2) throw new Error('round() takes 1 or 2 arguments.');
      if (isInt(args[0] as Value) && args.length === 1) return args[0] as Value;
      const d = args.length === 2 ? num(args[1] as Value) : 0;
      const f = 10 ** d;
      return Math.round(num(args[0] as Value) * f) / f;
    }
    case 'min': atLeast(1); return allInt ? (args as bigint[]).reduce((m, v) => (v < m ? v : m)) : Math.min(...args.map(num));
    case 'max': atLeast(1); return allInt ? (args as bigint[]).reduce((m, v) => (v > m ? v : m)) : Math.max(...args.map(num));
    case 'sum': atLeast(1); return allInt ? (args as bigint[]).reduce((s, v) => s + v, 0n) : args.map(num).reduce((s, v) => s + v, 0);
    case 'avg': atLeast(1); return args.map(num).reduce((s, v) => s + v, 0) / args.length;
    case 'pow': need(2); return binary('^', args[0] as Value, args[1] as Value);
    case 'atan2': need(2); return Math.atan2(num(args[0] as Value), num(args[1] as Value));
    case 'hypot': atLeast(1); return Math.hypot(...args.map(num));
    case 'gcd': {
      atLeast(2);
      if (!allInt) throw new Error('gcd() needs integers.');
      return (args as bigint[]).reduce((g, v) => gcdBig(g, v));
    }
    case 'lcm': {
      atLeast(2);
      if (!allInt) throw new Error('lcm() needs integers.');
      return (args as bigint[]).reduce((l, v) => (l === 0n || v === 0n ? 0n : (l * v < 0n ? -(l * v) : l * v) / gcdBig(l, v)));
    }
    case 'fact': need(1); return factorial(args[0] as Value);
  }
  throw new Error(`Unknown function ${name}().`);
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

export function evaluateRpn(rpn: Rpn[], vars: Map<string, Value>): Value {
  const st: Value[] = [];
  const pop = (col: number): Value => {
    const v = st.pop();
    if (v === undefined) throw new MathError('Missing operand.', col);
    return v;
  };
  for (const n of rpn) {
    try {
      switch (n.kind) {
        case 'num': st.push(n.value); break;
        case 'var': {
          const v = vars.get(n.name) ?? (Object.prototype.hasOwnProperty.call(CONSTANTS, n.name) ? (CONSTANTS[n.name] as number) : undefined);
          if (v === undefined) {
            const isFn = FUNCTIONS.includes(n.name);
            throw new MathError(isFn ? `${n.name} is a function — call it with parentheses.` : `Unknown variable "${n.name}".`, n.col, isFn ? `Try ${n.name}(…).` : 'Define it on an earlier line, e.g. "x = 5", or use ans for the previous result.');
          }
          st.push(v);
          break;
        }
        case 'neg': { const v = pop(n.col); st.push(isInt(v) ? -v : -v); break; }
        case 'pct': { const v = pop(n.col); st.push(num(v) / 100); break; }
        case 'bin': { const b = pop(n.col); const a = pop(n.col); st.push(binary(n.op, a, b)); break; }
        case 'call': {
          const args: Value[] = [];
          for (let i = 0; i < n.argc; i++) args.unshift(pop(n.col));
          if (!FUNCTIONS.includes(n.name)) throw new MathError(`Unknown function ${n.name}().`, n.col, `Available: ${FUNCTIONS.join(', ')}.`);
          st.push(call(n.name, args));
          break;
        }
      }
    } catch (e) {
      if (e instanceof MathError) throw e;
      throw new MathError((e as Error).message, n.col);
    }
  }
  if (st.length !== 1) throw new MathError('Malformed expression.', 1);
  const v = st[0] as Value;
  if (typeof v === 'number' && !Number.isFinite(v)) throw new MathError(Number.isNaN(v) ? 'Result is not a number.' : 'Result overflows to infinity.', 1);
  return v;
}

export function evaluate(expr: string, vars: Map<string, Value> = new Map()): Value {
  return evaluateRpn(toRpn(tokenize(expr)), vars);
}

/* ------------------------------------------------------------- formatting */

export type NumberFormat = 'auto' | 'fixed2' | 'scientific' | 'hex' | 'binary';

function autoNumber(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return String(x);
  const s = String(Number(x.toPrecision(12)));
  return s;
}

export function formatValue(v: Value, format: NumberFormat = 'auto'): string {
  switch (format) {
    case 'fixed2': return isInt(v) ? `${v}.00` : v.toFixed(2);
    case 'scientific': return num(v).toExponential(6);
    case 'hex':
    case 'binary': {
      const radix = format === 'hex' ? 16 : 2;
      const prefix = format === 'hex' ? '0x' : '0b';
      if (isInt(v)) return (v < 0n ? '-' : '') + prefix + (v < 0n ? -v : v).toString(radix);
      if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) return (v < 0 ? '-' : '') + prefix + Math.abs(v).toString(radix);
      return autoNumber(v);
    }
    default:
      return isInt(v) ? v.toString() : autoNumber(v);
  }
}

/* ---------------------------------------------------------- multi-line */

export interface LineResult {
  line: number;
  source: string;
  /** Assigned variable name, when the line was `name = expr`. */
  name?: string;
  value?: Value;
  error?: { message: string; col: number; hint?: string };
}

const RESERVED = new Set(['ans', 'pi', 'e', 'tau', ...FUNCTIONS]);

/** Evaluates each non-empty, non-comment line; variables and `ans` carry forward. */
export function evaluateLines(text: string): LineResult[] {
  const vars = new Map<string, Value>();
  const results: LineResult[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const source = raw.replace(/(#|\/\/).*$/, '').trim();
    if (source === '') return;
    const r: LineResult = { line: i + 1, source: raw.trim() };
    let expr = source;
    let name: string | undefined;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(source);
    if (m) {
      name = m[1] as string;
      expr = m[2] as string;
      if (RESERVED.has(name)) {
        r.error = { message: `"${name}" is reserved and cannot be assigned.`, col: raw.indexOf(name) + 1 };
        results.push(r);
        return;
      }
    }
    try {
      const v = evaluate(expr, vars);
      r.value = v;
      if (name) { r.name = name; vars.set(name, v); }
      vars.set('ans', v);
    } catch (e) {
      const err = e as MathError;
      const offset = raw.length - raw.trimStart().length + (name ? source.indexOf(expr) : 0);
      r.error = { message: err.message, col: (err.col ?? 1) + offset, hint: err.hint };
    }
    results.push(r);
  });
  return results;
}
