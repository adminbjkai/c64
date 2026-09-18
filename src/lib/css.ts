/**
 * css.ts — dependency-free CSS tokenizer, beautifier and minifier.
 *
 * Approach
 * --------
 * 1. `tokenize` walks the source once and produces a flat list of tokens:
 *    whitespace runs, comments (`/* ... *­/`), strings (`'...'` / `"..."`),
 *    the structural characters `{ } ( ) ; : ,`, and "text" runs for
 *    everything else (identifiers, numbers, units, selector combinators,
 *    at-keywords, unquoted `url(...)` contents, etc). It throws
 *    `CssParseError` for an unterminated string or comment.
 *
 * 2. `parseNodes` groups that flat token stream into a shallow tree using a
 *    single generic rule, applied recursively: scan forward (tracking
 *    parenthesis nesting so a `;`/`:`/`,` inside `url(...)`, `calc(...)` or
 *    `rgba(...)` is never mistaken for a structural separator) until, at
 *    paren-depth 0, we hit `{` (nested block — a style rule or a block
 *    at-rule such as `@media`/`@supports`/`@keyframes`/`@font-face`), `;`
 *    (a declaration if the prelude has a top-level `:`, otherwise a
 *    semicolon-terminated at-rule like `@import url(x.css);`), or the end of
 *    the enclosing block/file (same decision, without requiring the `;`).
 *    Comments that appear where a new statement would start become
 *    standalone Comment nodes; comments elsewhere are kept inline as part of
 *    the surrounding token run.
 *
 * 3. `formatCss` and `minifyCss` both render that same tree — the source
 *    text is never touched directly — which is what makes `formatCss`
 *    idempotent: nothing about the output depends on the *original*
 *    whitespace, only on the token content, so re-formatting formatted CSS
 *    reproduces it exactly.
 *
 * Both entry points call `validateCss` first, so structurally broken input
 * (unbalanced braces, an unterminated string/comment, a stray `}`) raises a
 * `CssParseError` with a precise 1-based line/col and a plain-English hint
 * instead of silently producing garbage.
 *
 * Limitations (deliberate, per the "don't parse values semantically" brief)
 * ---------------------------------------------------------------------
 * - Selectors and values are never interpreted — no color/number
 *   normalization, no shorthand expansion, no vendor-prefix handling.
 * - Nested rules (CSS Nesting) are supported structurally (a rule found
 *   inside a rule's body is just another nested Rule node) but are not
 *   validated against the nesting spec.
 * - SCSS/LESS-only syntax (`$var`, `@mixin`, `&`) tokenizes as plain text
 *   and round-trips fine, but isn't specially understood.
 * - Whitespace around a lone `+`/`~` is only collapsed at paren-depth 0
 *   (selector combinators); inside parens (e.g. `calc(1px + 2px)`) it is
 *   assumed to be an arithmetic operator and kept spaced, per spec.
 */

/** Thrown for structural CSS problems. line/col are 1-based. */
export class CssParseError extends Error {
  line: number;
  col: number;
  hint?: string;

  constructor(message: string, line: number, col: number, hint?: string) {
    super(hint ? `${message} (line ${line}, col ${col}) — ${hint}` : `${message} (line ${line}, col ${col})`);
    this.name = 'CssParseError';
    this.line = line;
    this.col = col;
    this.hint = hint;
  }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokKind =
  | 'ws'
  | 'comment'
  | 'string'
  | 'lbrace'
  | 'rbrace'
  | 'lparen'
  | 'rparen'
  | 'semi'
  | 'colon'
  | 'comma'
  | 'text';

interface Tok {
  kind: TokKind;
  text: string;
  line: number;
  col: number;
}

const isWsChar = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (count = 1): void => {
    for (let k = 0; k < count && i < n; k++) {
      const ch = src[i]!;
      i++;
      if (ch === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
  };

  while (i < n) {
    const startLine = line;
    const startCol = col;
    const ch = src[i]!;

    if (isWsChar(ch)) {
      const s = i;
      while (i < n && isWsChar(src[i]!)) advance();
      toks.push({ kind: 'ws', text: src.slice(s, i), line: startLine, col: startCol });
      continue;
    }

    if (ch === '/' && src[i + 1] === '*') {
      const s = i;
      advance(2);
      let closed = false;
      while (i < n) {
        if (src[i] === '*' && src[i + 1] === '/') {
          advance(2);
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        throw new CssParseError('Unterminated comment', startLine, startCol, 'Add a closing `*/` for this comment.');
      }
      toks.push({ kind: 'comment', text: src.slice(s, i), line: startLine, col: startCol });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const s = i;
      advance();
      let closed = false;
      while (i < n) {
        const c = src[i]!;
        if (c === '\\' && i + 1 < n) {
          advance(2);
          continue;
        }
        if (c === quote) {
          advance();
          closed = true;
          break;
        }
        if (c === '\n') break; // literal newline ends an unterminated string
        advance();
      }
      if (!closed) {
        throw new CssParseError('Unterminated string', startLine, startCol, `Add a closing ${quote} for this string.`);
      }
      toks.push({ kind: 'string', text: src.slice(s, i), line: startLine, col: startCol });
      continue;
    }

    const single: Partial<Record<string, TokKind>> = {
      '{': 'lbrace',
      '}': 'rbrace',
      '(': 'lparen',
      ')': 'rparen',
      ';': 'semi',
      ':': 'colon',
      ',': 'comma',
    };
    const kind = single[ch];
    if (kind) {
      advance();
      toks.push({ kind, text: ch, line: startLine, col: startCol });
      continue;
    }

    // Generic text run: everything up to the next special character.
    {
      const s = i;
      while (i < n) {
        const c = src[i]!;
        if (isWsChar(c)) break;
        if (c === '/' && src[i + 1] === '*') break;
        if (c === '"' || c === "'") break;
        if (c === '{' || c === '}' || c === '(' || c === ')' || c === ';' || c === ':' || c === ',') break;
        advance();
      }
      if (i === s) advance(); // defensive: never loop forever
      toks.push({ kind: 'text', text: src.slice(s, i), line: startLine, col: startCol });
    }
  }

  return toks;
}

// ---------------------------------------------------------------------------
// Validation (structural only — brace balance + tokenizer-level errors)
// ---------------------------------------------------------------------------

export function validateCss(text: string): void {
  const toks = tokenize(text); // throws on unterminated string/comment
  const stack: Tok[] = [];
  for (const t of toks) {
    if (t.kind === 'lbrace') {
      stack.push(t);
    } else if (t.kind === 'rbrace') {
      if (stack.length === 0) {
        throw new CssParseError(
          'Unmatched closing brace',
          t.line,
          t.col,
          'Remove this `}` or add a matching `{` earlier in the file.',
        );
      }
      stack.pop();
    }
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1]!;
    throw new CssParseError('Unclosed block', open.line, open.col, 'Add a matching `}` for this `{`.');
  }
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

type Node =
  | { type: 'comment'; text: string }
  | { type: 'decl'; prop: Tok[]; value: Tok[] }
  | { type: 'at'; prelude: Tok[] }
  | { type: 'rule'; prelude: Tok[]; body: Node[] };

function trimWs(toks: Tok[]): Tok[] {
  let a = 0;
  let b = toks.length;
  while (a < b && toks[a]!.kind === 'ws') a++;
  while (b > a && toks[b - 1]!.kind === 'ws') b--;
  return toks.slice(a, b);
}

function pushPreludeAsNode(nodes: Node[], preludeToks: Tok[]): void {
  if (preludeToks.length === 0) return;
  let depth = 0;
  let colonIdx = -1;
  for (let idx = 0; idx < preludeToks.length; idx++) {
    const t = preludeToks[idx]!;
    if (t.kind === 'lparen') depth++;
    else if (t.kind === 'rparen') depth = Math.max(0, depth - 1);
    else if (depth === 0 && t.kind === 'colon') {
      colonIdx = idx;
      break;
    }
  }
  if (colonIdx === -1) {
    nodes.push({ type: 'at', prelude: preludeToks });
  } else {
    const prop = trimWs(preludeToks.slice(0, colonIdx));
    const value = trimWs(preludeToks.slice(colonIdx + 1));
    nodes.push({ type: 'decl', prop, value });
  }
}

/** Parses tokens[start:end) — the contents of one block (or the top level). */
function parseNodes(toks: Tok[], start: number, end: number): Node[] {
  const nodes: Node[] = [];
  let i = start;

  while (i < end) {
    while (i < end && toks[i]!.kind === 'ws') i++;
    if (i >= end) break;

    if (toks[i]!.kind === 'comment') {
      nodes.push({ type: 'comment', text: toks[i]!.text });
      i++;
      continue;
    }

    const preludeStart = i;
    let depth = 0;
    let terminatorIdx = -1;
    let terminatorKind: 'lbrace' | 'semi' | null = null;
    for (let j = i; j < end; j++) {
      const k = toks[j]!.kind;
      if (k === 'lparen') depth++;
      else if (k === 'rparen') depth = Math.max(0, depth - 1);
      else if (depth === 0 && k === 'lbrace') {
        terminatorIdx = j;
        terminatorKind = 'lbrace';
        break;
      } else if (depth === 0 && k === 'semi') {
        terminatorIdx = j;
        terminatorKind = 'semi';
        break;
      }
    }

    if (terminatorIdx === -1) {
      // Ran off the end of this block/file without a terminator: whatever
      // is left is a trailing declaration/at-statement missing its `;`.
      pushPreludeAsNode(nodes, trimWs(toks.slice(preludeStart, end)));
      break;
    }

    if (terminatorKind === 'lbrace') {
      const preludeToks = trimWs(toks.slice(preludeStart, terminatorIdx));
      let d = 1;
      let k = terminatorIdx + 1;
      for (; k < toks.length && d > 0; k++) {
        if (toks[k]!.kind === 'lbrace') d++;
        else if (toks[k]!.kind === 'rbrace') d--;
      }
      // Braces are already balance-checked by validateCss before parseNodes
      // runs, so `k - 1` is guaranteed to be the matching '}' index.
      const bodyEnd = k - 1;
      const body = parseNodes(toks, terminatorIdx + 1, bodyEnd);
      nodes.push({ type: 'rule', prelude: preludeToks, body });
      i = k;
      continue;
    }

    // terminatorKind === 'semi'
    pushPreludeAsNode(nodes, trimWs(toks.slice(preludeStart, terminatorIdx)));
    i = terminatorIdx + 1;
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function splitTopLevelCommas(toks: Tok[]): Tok[][] {
  const groups: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  for (const t of toks) {
    if (t.kind === 'lparen') depth++;
    else if (t.kind === 'rparen') depth = Math.max(0, depth - 1);
    if (depth === 0 && t.kind === 'comma') {
      groups.push(trimWs(cur));
      cur = [];
      continue;
    }
    cur.push(t);
  }
  groups.push(trimWs(cur));
  return groups;
}

const isLicenseComment = (text: string): boolean => text.startsWith('/*!');

// ---------------------------------------------------------------------------
// formatCss
// ---------------------------------------------------------------------------

/** Renders a token list with each original whitespace run collapsed to a single space. */
function renderTokens(toks: Tok[]): string {
  let out = '';
  for (const t of toks) {
    out += t.kind === 'ws' ? ' ' : t.text;
  }
  return out;
}

function renderNodes(nodes: Node[], depth: number, lines: string[], indentUnit: string): void {
  const indent = indentUnit.repeat(depth);
  for (const node of nodes) {
    if (node.type === 'comment') {
      lines.push(indent + node.text);
    } else if (node.type === 'decl') {
      lines.push(`${indent}${renderTokens(node.prop)}: ${renderTokens(node.value)};`);
    } else if (node.type === 'at') {
      lines.push(`${indent}${renderTokens(node.prelude)};`);
    } else {
      const groups = splitTopLevelCommas(node.prelude);
      if (groups.length === 1 && groups[0]!.length === 0) {
        lines.push(`${indent}{`);
      } else {
        groups.forEach((group, idx) => {
          const isLast = idx === groups.length - 1;
          lines.push(`${indent}${renderTokens(group)}${isLast ? ' {' : ','}`);
        });
      }
      renderNodes(node.body, depth + 1, lines, indentUnit);
      lines.push(`${indent}}`);
      if (depth === 0) lines.push('');
    }
  }
}

export function formatCss(text: string, opts?: { indent?: string }): string {
  validateCss(text);
  const indentUnit = opts?.indent ?? '  ';
  const toks = tokenize(text);
  const nodes = parseNodes(toks, 0, toks.length);
  const lines: string[] = [];
  renderNodes(nodes, 0, lines, indentUnit);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// minifyCss
// ---------------------------------------------------------------------------

/** True if a text token is a lone selector-combinator character. */
const isBareChar = (t: Tok, ch: string): boolean => t.kind === 'text' && t.text === ch;

function shouldKeepSpace(prev: Tok, cur: Tok, depth: number): boolean {
  if (prev.kind === 'comma' || cur.kind === 'comma') return false;
  if (prev.kind === 'lparen' || cur.kind === 'rparen') return false;
  if (isBareChar(prev, '>') || isBareChar(cur, '>')) return false;
  const isPlusOrTilde = (t: Tok): boolean => isBareChar(t, '+') || isBareChar(t, '~');
  if (isPlusOrTilde(prev) || isPlusOrTilde(cur)) {
    // Inside parens (calc(), clamp(), ...) treat as a spaced arithmetic
    // operator; at the top level treat as a tight selector combinator.
    return depth > 0;
  }
  return true;
}

function minTokens(toks: Tok[]): string {
  let out = '';
  let pendingSpace = false;
  let prev: Tok | null = null;
  let depth = 0;

  for (const t of toks) {
    if (t.kind === 'ws') {
      pendingSpace = true;
      continue;
    }
    if (t.kind === 'comment') {
      if (isLicenseComment(t.text)) {
        if (out.length > 0 && pendingSpace) out += ' ';
        out += t.text;
        prev = t;
        pendingSpace = false;
      }
      // Non-license comments are dropped; pendingSpace is left as-is so a
      // space that flanks it on either side still separates real tokens.
      continue;
    }

    if (t.kind === 'lparen') depth++;

    const keepSpace = out.length > 0 && pendingSpace && prev !== null && shouldKeepSpace(prev, t, depth);
    if (keepSpace) out += ' ';
    out += t.text;
    prev = t;
    pendingSpace = false;

    if (t.kind === 'rparen') depth = Math.max(0, depth - 1);
  }

  return out;
}

function renderBlockMin(nodes: Node[]): string {
  let lastBareIdx = -1;
  nodes.forEach((n, idx) => {
    if (n.type === 'decl' || n.type === 'at') lastBareIdx = idx;
  });

  let out = '';
  nodes.forEach((node, idx) => {
    if (node.type === 'comment') {
      if (isLicenseComment(node.text)) out += node.text;
      return;
    }
    if (node.type === 'decl') {
      out += `${minTokens(node.prop)}:${minTokens(node.value)}`;
      if (idx !== lastBareIdx) out += ';';
      return;
    }
    if (node.type === 'at') {
      out += minTokens(node.prelude);
      if (idx !== lastBareIdx) out += ';';
      return;
    }
    // rule
    const selector = splitTopLevelCommas(node.prelude).map(minTokens).join(',');
    out += `${selector}{${renderBlockMin(node.body)}}`;
  });
  return out;
}

export function minifyCss(text: string): string {
  validateCss(text);
  const toks = tokenize(text);
  const nodes = parseNodes(toks, 0, toks.length);
  return renderBlockMin(nodes);
}
