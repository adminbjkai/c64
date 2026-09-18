/**
 * A small, hand-rolled YAML 1.2 *subset* parser and emitter.
 *
 * Why not a library? The project is dependency-free, and the YAML people paste
 * into a workspace (config files, k8s manifests, CI pipelines, API fixtures)
 * uses a small, predictable slice of the spec. A focused parser gives exact
 * line/column errors with plain-English hints, which general libraries rarely do.
 *
 * Approach
 * --------
 * Block structure is parsed line by line with recursive descent: every block
 * node (mapping, sequence, scalar) starts at a known (line, column), and that
 * column is its indentation for sibling entries. Flow collections (`[..]`,
 * `{..}`) and quoted scalars can span lines, so they are scanned on absolute
 * offsets and the line cursor is resynced afterwards. Plain scalars are typed
 * with the YAML 1.2 core schema.
 *
 * The emitter produces deterministic block-style YAML that this parser (and
 * any conforming YAML 1.2 parser) reads back to the same JSON value.
 *
 * Supported
 * ---------
 *  - Block mappings and sequences with arbitrary nesting, including compact
 *    `- key: v` items, `- - x` nested items and `key:` followed by `- item`
 *    at the same indentation as the key.
 *  - Flow mappings and sequences (nested, multi-line, trailing comma,
 *    `{a, b}` null-valued keys, `[a: 1]` single-pair maps).
 *  - Plain scalars (including multi-line folding), 'single' ('' escape) and
 *    "double" quoted scalars (all YAML escapes, multi-line folding).
 *  - Block scalars `|` / `>` with chomping (`-`, `+`) and an optional
 *    indentation indicator digit.
 *  - Comments, a leading `---` (optionally with an inline value) and a
 *    trailing `...`.
 *  - Core schema typing: null / ~ / empty, true / false, decimal / 0x / 0o
 *    integers, floats including .inf / .nan. Everything else is a string.
 *
 * Limitations (each reported as a YamlParseError with a hint)
 * -----------
 *  - One document per input; a second `---` is an error.
 *  - No anchors (`&a`), aliases (`*a`), tags (`!!str`), directives (`%YAML`),
 *    or complex keys (`? key`). Merge keys (`<<`) are treated as plain keys.
 *  - Mapping keys are always strings (`1: x` gives the key "1"); collection
 *    keys (`[a, b]: x`) and multi-line keys are not supported.
 *  - Tabs are never accepted as indentation.
 *  - Integers beyond Number.MAX_SAFE_INTEGER lose precision (JS numbers).
 *  - Some rarely-seen spec corner cases are accepted leniently rather than
 *    rejected (e.g. indentation of continuation lines inside quoted scalars
 *    and flow collections is not checked).
 */

export class YamlParseError extends Error {
  constructor(
    message: string,
    /** 1-based line of the problem. */
    public readonly line: number,
    /** 1-based column of the problem. */
    public readonly col: number,
    /** Plain-English suggestion for fixing it. */
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'YamlParseError';
  }
}

const UNSUPPORTED_HINT = 'Anchors, aliases and tags are not supported in this tool — write the value out in full.';
const TAB_HINT = 'YAML indentation must use spaces — replace the tab with spaces.';

/* ------------------------------------------------------------------------ */
/* Scalar typing (YAML 1.2 core schema)                                      */
/* ------------------------------------------------------------------------ */

const INT_DEC = /^[-+]?[0-9]+$/;
const INT_OCT = /^0o[0-7]+$/;
const INT_HEX = /^0x[0-9a-fA-F]+$/;
const FLOAT = /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/;
const INF = /^[-+]?\.(inf|Inf|INF)$/;
const NAN = /^\.(nan|NaN|NAN)$/;

/** Resolve an (unquoted) plain scalar to its core-schema value. */
function resolvePlain(s: string): unknown {
  switch (s) {
    case '':
    case '~':
    case 'null':
    case 'Null':
    case 'NULL':
      return null;
    case 'true':
    case 'True':
    case 'TRUE':
      return true;
    case 'false':
    case 'False':
    case 'FALSE':
      return false;
  }
  const c = s.charCodeAt(0);
  // Quick reject: every number starts with a digit, sign or dot.
  if (!((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return s;
  if (INT_DEC.test(s)) return Number(s);
  if (INT_OCT.test(s)) return parseInt(s.slice(2), 8);
  if (INT_HEX.test(s)) return parseInt(s.slice(2), 16);
  if (FLOAT.test(s)) return Number(s);
  if (INF.test(s)) return s[0] === '-' ? -Infinity : Infinity;
  if (NAN.test(s)) return NaN;
  return s;
}

/** Define an own, enumerable property (safe even for keys like `__proto__`). */
function setKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

/* ------------------------------------------------------------------------ */
/* Parser                                                                    */
/* ------------------------------------------------------------------------ */

/** Parse a single YAML document. Throws YamlParseError on invalid input. */
export function parseYaml(text: string): unknown {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const n = src.length;

  // Line table. A trailing newline does not start an extra (empty) line.
  const lines = src.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const N = lines.length;
  const lineStarts: number[] = [];
  {
    let off = 0;
    for (const l of lines) {
      lineStarts.push(off);
      off += l.length + 1;
    }
  }

  /** Current line cursor for block parsing: the next line not yet consumed. */
  let ln = 0;

  const lineText = (i: number): string => lines[i] ?? '';

  const fail = (message: string, line0: number, col0: number, hint?: string): never => {
    throw new YamlParseError(message, line0 + 1, col0 + 1, hint);
  };

  /** Zero-based line index containing absolute offset `off`. */
  const lineOf = (off: number): number => {
    let lo = 0;
    let hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const failAt = (message: string, off: number, hint?: string): never => {
    const l = lineOf(off);
    return fail(message, l, off - (lineStarts[l] ?? 0), hint);
  };

  const isWs = (c: string | undefined): boolean => c === ' ' || c === '\t';
  const isFlowIndicator = (c: string | undefined): boolean =>
    c === ',' || c === '[' || c === ']' || c === '{' || c === '}';

  /** `---` or `...` document marker at column 0. */
  const isMarker = (i: number): boolean => /^(---|\.\.\.)([ \t]|$)/.test(lineText(i));

  /** Blank or comment-only line. */
  const isBlank = (i: number): boolean => {
    const t = lineText(i).trimStart();
    return t === '' || t[0] === '#';
  };

  const skipBlank = (): void => {
    while (ln < N && isBlank(ln)) ln++;
  };

  /** True when the rest of `t` from `p` is only whitespace or a comment. */
  const restIsEmpty = (t: string, p: number): boolean => {
    while (p < t.length && isWs(t[p])) p++;
    return p >= t.length || t[p] === '#';
  };

  /** Indentation (leading spaces) of a content line; tabs are an error. */
  const indentOf = (i: number): number => {
    const t = lineText(i);
    let sp = 0;
    while (t[sp] === ' ') sp++;
    if (t[sp] === '\t') {
      fail('Tab character used for indentation', i, sp, TAB_HINT);
    }
    return sp;
  };

  const isDash = (t: string, col: number): boolean =>
    t[col] === '-' && (col + 1 >= t.length || isWs(t[col + 1]));

  const unsupported = (c: string, line0: number, col0: number): never => {
    const what =
      c === '&' ? 'Anchors (`&name`) are' : c === '*' ? 'Aliases (`*name`) are' : 'Tags (`!tag`) are';
    return fail(`${what} not supported`, line0, col0, UNSUPPORTED_HINT);
  };

  /* ---- quoted scalars (offset based, may span lines) ---- */

  const HEX_ESC: Record<string, number> = { x: 2, u: 4, U: 8 };
  const SIMPLE_ESC: Record<string, string> = {
    '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r',
    e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029',
  };

  /** Scan a quoted scalar starting at `off` (the quote). Returns value and end offset (after the quote). */
  const scanQuoted = (off: number): { value: string; end: number } => {
    const q = src[off]!;
    const dbl = q === '"';
    let p = off + 1;
    let out = '';
    for (;;) {
      if (p >= n) {
        return failAt('Unterminated quoted string', off, `Add a closing \`${q}\` to end the string.`);
      }
      const c = src[p]!;
      if (c === q) {
        if (!dbl && src[p + 1] === "'") {
          out += "'";
          p += 2;
          continue;
        }
        return { value: out, end: p + 1 };
      }
      if (dbl && c === '\\') {
        const e = src[p + 1];
        if (e === '\n') {
          // Escaped line break: join lines without a space.
          p += 2;
          while (isWs(src[p])) p++;
          continue;
        }
        if (e !== undefined && e in SIMPLE_ESC) {
          out += SIMPLE_ESC[e];
          p += 2;
          continue;
        }
        const len = e === undefined ? undefined : HEX_ESC[e];
        if (len !== undefined) {
          const hex = src.slice(p + 2, p + 2 + len);
          if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex)) {
            return failAt(`Bad escape \`\\${e}\``, p, `\\${e} needs exactly ${len} hex digits.`);
          }
          const cp = parseInt(hex, 16);
          if (cp > 0x10ffff) return failAt('Escape is outside the Unicode range', p);
          out += len === 8 ? String.fromCodePoint(cp) : String.fromCharCode(cp);
          p += 2 + len;
          continue;
        }
        return failAt(
          `Bad escape \`\\${e === '\n' || e === undefined ? '' : e}\``,
          p,
          'Valid escapes include \\n \\t \\" \\\\ \\xXX \\uXXXX. Use single quotes to keep backslashes literally.',
        );
      }
      if (c === ' ' || c === '\t' || c === '\n') {
        // Whitespace: kept unless it runs into a line break (folding).
        let r = p;
        while (isWs(src[r])) r++;
        if (src[r] !== '\n') {
          out += src.slice(p, r);
          p = r;
          continue;
        }
        // Fold: one break -> space, k extra blank lines -> k newlines.
        p = r + 1;
        let breaks = 0;
        for (;;) {
          while (isWs(src[p])) p++;
          if (src[p] === '\n') {
            breaks++;
            p++;
          } else break;
        }
        out += breaks ? '\n'.repeat(breaks) : ' ';
        continue;
      }
      out += c;
      p++;
    }
  };

  /** After a quoted/flow value ends at `end`, the rest of its line must be empty. Advances `ln`. */
  const finishInline = (end: number): void => {
    const l = lineOf(end);
    const t = lineText(l);
    let p = end - (lineStarts[l] ?? 0);
    if (!restIsEmpty(t, p)) {
      while (isWs(t[p])) p++;
      const isComment = t[p] === '#';
      if (!isComment) {
        fail(
          `Unexpected \`${t[p]}\` after the value`,
          l,
          p,
          t[p] === ':'
            ? 'Only simple one-line keys are supported. Put the key on one line (quoted if needed).'
            : 'A value ends at its closing quote or bracket. Quote the whole value if it is meant to be text.',
        );
      }
    }
    // `"a"#x` — a comment needs a space before `#`.
    if (t[p] === '#' && !isWs(t[p - 1])) {
      fail('A comment needs a space before `#`', l, p, 'Add a space before `#`.');
    }
    ln = l + 1;
  };

  /* ---- flow collections (offset based, may span lines) ---- */

  interface FlowNode {
    value: unknown;
    /** Present for scalars: the text to use if this node turns out to be a key. */
    keyText?: string;
  }

  const parseFlow = (start: number): { value: unknown; end: number } => {
    let p = start;

    const skipWs = (): void => {
      for (;;) {
        const c = src[p];
        if (c === ' ' || c === '\t' || c === '\n') p++;
        else if (c === '#' && (p === 0 || /\s/.test(src[p - 1]!))) {
          while (p < n && src[p] !== '\n') p++;
        } else return;
      }
    };

    const openerHint = (open: number, close: string): string =>
      `Did you forget the \`${close}\` for the \`${src[open]}\` on line ${lineOf(open) + 1}?`;

    const node = (): FlowNode => {
      skipWs();
      const c = src[p];
      if (c === undefined) return failAt('Unexpected end of input inside a flow collection', p);
      if (c === '[') return { value: seq() };
      if (c === '{') return { value: map() };
      if (c === '"' || c === "'") {
        const r = scanQuoted(p);
        p = r.end;
        return { value: r.value, keyText: r.value };
      }
      if (c === '&' || c === '*' || c === '!') {
        const l = lineOf(p);
        return unsupported(c, l, p - (lineStarts[l] ?? 0));
      }
      if (c === '|' || c === '>') {
        return failAt('Block scalars cannot be used inside `[ ]` or `{ }`', p, 'Use a quoted string with \\n escapes instead.');
      }
      if (c === '-' && (src[p + 1] === undefined || /\s/.test(src[p + 1]!))) {
        return failAt('`- ` list items cannot be used inside `[ ]` or `{ }`', p, 'Separate flow items with commas instead.');
      }
      if (isFlowIndicator(c) || c === '#' || c === '%' || c === '@' || c === '`' || (c === ':' && !/[^\s,[\]{}]/.test(src[p + 1] ?? ' '))) {
        return failAt(`Unexpected \`${c}\``, p, c === ',' ? 'Remove the extra comma — empty items are not allowed.' : 'Wrap the value in quotes.');
      }
      // Plain scalar: runs until an indicator, `: `, or ` #`.
      const s = p;
      while (p < n) {
        const d = src[p]!;
        if (isFlowIndicator(d)) break;
        if (d === ':' && (p + 1 >= n || /\s/.test(src[p + 1]!) || isFlowIndicator(src[p + 1]))) break;
        if (d === '#' && /\s/.test(src[p - 1]!)) break;
        p++;
      }
      const segs = src.slice(s, p).split('\n').map((x) => x.trim());
      while (segs.length && segs[segs.length - 1] === '') segs.pop();
      let out = '';
      let blanks = 0;
      segs.forEach((seg, k) => {
        if (seg === '') return void blanks++;
        if (k > 0) out += blanks ? '\n'.repeat(blanks) : ' ';
        out += seg;
        blanks = 0;
      });
      return { value: resolvePlain(out), keyText: out };
    };

    const seq = (): unknown[] => {
      const open = p++;
      const arr: unknown[] = [];
      for (;;) {
        skipWs();
        if (p >= n) return failAt('Unclosed `[`', open, 'Add a `]` to close the list.');
        if (src[p] === ']') {
          p++;
          return arr;
        }
        const keyStart = p;
        const item = node();
        skipWs();
        if (src[p] === ':') {
          // `[a: 1]` is a list holding the single-pair map {a: 1}.
          if (item.keyText === undefined) {
            return failAt('Collection keys are not supported', keyStart, 'Only string keys are supported in this tool.');
          }
          p++;
          skipWs();
          const pair: Record<string, unknown> = {};
          setKey(pair, item.keyText, src[p] === ',' || src[p] === ']' ? null : node().value);
          arr.push(pair);
          skipWs();
        } else {
          arr.push(item.value);
        }
        if (src[p] === ',') p++;
        else if (src[p] !== ']') {
          if (p >= n) return failAt('Unclosed `[`', open, 'Add a `]` to close the list.');
          return failAt(`Expected \`,\` or \`]\` but found \`${src[p]}\``, p, `Separate items with commas. ${openerHint(open, ']')}`);
        }
      }
    };

    const map = (): Record<string, unknown> => {
      const open = p++;
      const obj: Record<string, unknown> = {};
      for (;;) {
        skipWs();
        if (p >= n) return failAt('Unclosed `{`', open, 'Add a `}` to close the mapping.');
        if (src[p] === '}') {
          p++;
          return obj;
        }
        const keyStart = p;
        const k = node();
        if (k.keyText === undefined) {
          return failAt('Collection keys are not supported', keyStart, 'Only string keys are supported in this tool.');
        }
        skipWs();
        let value: unknown = null;
        if (src[p] === ':') {
          p++;
          skipWs();
          if (src[p] !== ',' && src[p] !== '}') value = node().value;
        }
        if (hasOwn(obj, k.keyText)) {
          return failAt(`Duplicate key "${k.keyText}"`, keyStart, 'Each key can appear only once in a mapping.');
        }
        setKey(obj, k.keyText, value);
        skipWs();
        if (src[p] === ',') p++;
        else if (src[p] !== '}') {
          if (p >= n) return failAt('Unclosed `{`', open, 'Add a `}` to close the mapping.');
          return failAt(
            `Expected \`,\` or \`}\` but found \`${src[p]}\``,
            p,
            `Separate entries with commas (and use \`key: value\` with a space after the colon). ${openerHint(open, '}')}`,
          );
        }
      }
    };

    const value = src[p] === '[' ? seq() : map();
    return { value, end: p };
  };

  /* ---- block scalars ---- */

  const parseBlockScalar = (line: number, col: number, parentIndent: number): string => {
    const t = lineText(line);
    const style = t[col]!;
    let p = col + 1;
    let chomp = '';
    let explicit = 0;
    for (let k = 0; k < 2; k++) {
      const c = t[p];
      if ((c === '-' || c === '+') && !chomp) {
        chomp = c;
        p++;
      } else if (c !== undefined && c >= '1' && c <= '9' && !explicit) {
        explicit = Number(c);
        p++;
      }
    }
    if (!restIsEmpty(t, p) || (t[p] === '#')) {
      fail(
        'Invalid block scalar header',
        line,
        p,
        'Use `|`, `|-`, `|+`, `>`, `>-` or `>+`, optionally followed by a space and a comment. Content goes on the next lines.',
      );
    }

    // Determine content indentation.
    let contentIndent: number;
    if (explicit) {
      contentIndent = Math.max(parentIndent, 0) + explicit;
    } else {
      contentIndent = parentIndent + 1;
      for (let k = line + 1; k < N; k++) {
        const l = lineText(k);
        if (l.trim() === '') continue;
        let sp = 0;
        while (l[sp] === ' ') sp++;
        if (sp > parentIndent && !(sp === 0 && isMarker(k))) contentIndent = sp;
        break;
      }
    }

    // Collect lines: '' marks an empty line; trailing empties are chomping material.
    const body: string[] = [];
    let k = line + 1;
    for (; k < N; k++) {
      const l = lineText(k);
      if (isMarker(k)) break;
      let sp = 0;
      while (l[sp] === ' ') sp++;
      if (l.trim() === '') {
        body.push(sp > contentIndent ? l.slice(contentIndent) : '');
        continue;
      }
      if (sp < contentIndent) break;
      body.push(l.slice(contentIndent));
    }
    ln = k;

    let trailing = 0;
    while (body.length && body[body.length - 1] === '') {
      body.pop();
      trailing++;
    }
    if (!body.length) return chomp === '+' ? '\n'.repeat(trailing) : '';

    let text: string;
    if (style === '|') {
      text = body.join('\n');
    } else {
      // Folding: single breaks between normal lines become spaces; empty lines
      // become newlines; breaks around more-indented lines are kept.
      text = '';
      let pending = 0;
      let started = false;
      let prevMore = false;
      for (const b of body) {
        if (b === '') {
          pending++;
          continue;
        }
        const more = b[0] === ' ' || b[0] === '\t';
        if (!started) text += '\n'.repeat(pending);
        else if (more || prevMore) text += '\n'.repeat(pending + 1);
        else text += pending ? '\n'.repeat(pending) : ' ';
        text += b;
        started = true;
        pending = 0;
        prevMore = more;
      }
    }
    if (chomp === '-') return text;
    if (chomp === '+') return text + '\n' + '\n'.repeat(trailing);
    return text + '\n';
  };

  /* ---- plain scalars in block context (may continue on deeper lines) ---- */

  /** Strip a trailing ` # comment` from a plain-scalar fragment. */
  const stripComment = (s: string): { text: string; hadComment: boolean } => {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '#' && (i === 0 || isWs(s[i - 1]))) return { text: s.slice(0, i), hadComment: true };
    }
    return { text: s, hadComment: false };
  };

  const checkNoMappingIndicator = (frag: string, line0: number, col0: number): void => {
    const m = /:([ \t]|$)/.exec(frag);
    if (m) {
      fail(
        'Unexpected `:` inside a value',
        line0,
        col0 + m.index,
        'A value cannot contain `: ` unless quoted. Wrap it in quotes, or put a nested mapping on the next line, indented.',
      );
    }
  };

  const parsePlainBlock = (line: number, col: number, parentIndent: number): unknown => {
    const t = lineText(line);
    const first = stripComment(t.slice(col));
    const head = first.text.trimEnd();
    checkNoMappingIndicator(head, line, col);
    let out = head;
    let done = first.hadComment;
    ln = line + 1;
    while (!done) {
      let j = ln;
      while (j < N && lineText(j).trim() === '') j++;
      if (j >= N || isMarker(j)) break;
      const ind = indentOf(j);
      if (ind <= parentIndent) break;
      const lt = lineText(j);
      if (lt[ind] === '#') break;
      if (isDash(lt, ind) || readKey(j, ind)) {
        fail(
          isDash(lt, ind) ? 'Unexpected list item' : 'Unexpected mapping entry',
          j,
          ind,
          'This line does not line up with the structure above. Check its indentation, or a missing `:` on the line above.',
        );
      }
      const frag = stripComment(lt.slice(ind));
      const body = frag.text.trimEnd();
      checkNoMappingIndicator(body, j, ind);
      const blanks = j - ln;
      out += blanks ? '\n'.repeat(blanks) : ' ';
      out += body;
      ln = j + 1;
      done = frag.hadComment;
    }
    return resolvePlain(out);
  };

  /* ---- block structure ---- */

  /**
   * If the line has a `key:` at `col`, return the key and the column right
   * after the colon. Otherwise null.
   */
  function readKey(line: number, col: number): { key: string; after: number } | null {
    const t = lineText(line);
    const c = t[col];
    if (c === undefined) return null;
    if (c === '&' || c === '*' || c === '!') return unsupported(c, line, col);
    if (c === '?' && (col + 1 >= t.length || isWs(t[col + 1]))) {
      return fail('Complex mapping keys (`? key`) are not supported', line, col, 'Complex keys are not supported in this tool — use a plain or quoted key.');
    }
    if (c === '"' || c === "'") {
      const r = scanQuoted((lineStarts[line] ?? 0) + col);
      const endCol = r.end - (lineStarts[line] ?? 0);
      if (endCol > t.length) return null; // multi-line quoted: not a key
      let p = endCol;
      while (isWs(t[p])) p++;
      if (t[p] === ':' && (p + 1 >= t.length || isWs(t[p + 1]))) return { key: r.value, after: p + 1 };
      return null;
    }
    if (isFlowIndicator(c) || c === '#' || c === '|' || c === '>' || c === '%' || c === '@' || c === '`') return null;
    if (isDash(t, col)) return null;
    for (let i = col; i < t.length; i++) {
      const d = t[i];
      if (d === '#' && i > col && isWs(t[i - 1])) return null;
      if (d === ':' && (i + 1 >= t.length || isWs(t[i + 1]))) {
        const key = t.slice(col, i).trimEnd();
        return key === '' ? null : { key, after: i + 1 };
      }
    }
    return null;
  }

  /** Parse a value that starts at (line, col) on the same line as its indicator. */
  const parseInline = (line: number, col: number, parentIndent: number): unknown => {
    const t = lineText(line);
    const c = t[col]!;
    const next = t[col + 1];
    const off = (lineStarts[line] ?? 0) + col;
    switch (c) {
      case '&':
      case '*':
      case '!':
        return unsupported(c, line, col);
      case '|':
      case '>':
        return parseBlockScalar(line, col, parentIndent);
      case '[':
      case '{': {
        const r = parseFlow(off);
        finishInline(r.end);
        return r.value;
      }
      case '"':
      case "'": {
        const r = scanQuoted(off);
        finishInline(r.end);
        return r.value;
      }
      case '%':
      case '@':
      case '`':
      case ',':
      case ']':
      case '}':
        return fail(`A plain value cannot start with \`${c}\``, line, col, 'Wrap the value in quotes.');
    }
    if (c === '-' && (next === undefined || isWs(next))) {
      return fail('A list cannot start on the same line as its key', line, col, 'Move the `- ` items to the next line, indented under the key.');
    }
    if (c === '?' && (next === undefined || isWs(next))) {
      return fail('Complex mapping keys (`? key`) are not supported', line, col, 'Complex keys are not supported in this tool — use a plain or quoted key.');
    }
    if (c === ':' && (next === undefined || isWs(next))) {
      return fail('Missing key before `:`', line, col, 'Write the key before the colon, e.g. `name: value`.');
    }
    return parsePlainBlock(line, col, parentIndent);
  };

  /**
   * Parse the value that follows an indicator (`key:` or `-`) ending at
   * column `after` of `line`. `parentIndent` is the column of the owning
   * mapping/sequence. When `allowSameIndentSeq` is set (mapping values), a
   * `- item` list at the key's own indentation is accepted as the value.
   */
  const parseValueAfter = (line: number, after: number, parentIndent: number, allowSameIndentSeq: boolean): unknown => {
    const t = lineText(line);
    let p = after;
    while (isWs(t[p])) p++;
    if (p < t.length && t[p] !== '#') return parseInline(line, p, parentIndent);
    // Nothing on this line: the value (if any) is on following lines.
    ln = line + 1;
    skipBlank();
    if (ln >= N || isMarker(ln)) return null;
    const ind = indentOf(ln);
    if (ind > parentIndent) return parseNode(ln, ind, parentIndent);
    if (allowSameIndentSeq && ind === parentIndent && isDash(lineText(ln), ind)) {
      return parseSeq(ln, ind, true);
    }
    return null;
  };

  /** Parse any block node whose first token is at (line, col). */
  function parseNode(line: number, col: number, parentIndent: number): unknown {
    const t = lineText(line);
    if (isDash(t, col)) return parseSeq(line, col, false);
    const k = readKey(line, col);
    if (k) return parseMap(line, col, k);
    return parseInline(line, col, parentIndent);
  }

  /** After an entry, decide whether the collection at `col` continues. */
  const continues = (col: number): boolean => {
    skipBlank();
    if (ln >= N || isMarker(ln)) return false;
    const ind = indentOf(ln);
    if (ind < col) return false;
    if (ind > col) {
      fail(
        'Inconsistent indentation',
        ln,
        ind,
        'This line is indented more than the entries above it. Align it with its siblings (use the same number of spaces).',
      );
    }
    return true;
  };

  function parseSeq(line: number, col: number, inMapValue: boolean): unknown[] {
    const arr: unknown[] = [];
    let cur = line;
    for (;;) {
      const t = lineText(cur);
      let p = col + 1;
      while (isWs(t[p])) p++;
      arr.push(p >= t.length || t[p] === '#' ? parseValueAfter(cur, col + 1, col, false) : parseNode(cur, p, col));
      if (!continues(col)) return arr;
      cur = ln;
      if (!isDash(lineText(cur), col)) {
        if (inMapValue) return arr;
        const k = readKey(cur, col);
        return fail(
          k ? 'Unexpected mapping entry inside a list' : 'Expected a `- ` list item',
          cur,
          col,
          k
            ? 'A list and a mapping cannot share the same indentation. Put the list under a key, or make this a list item.'
            : 'Every item in a list must start with `- ` at the same indentation.',
        );
      }
    }
  }

  function parseMap(line: number, col: number, firstKey: { key: string; after: number }): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    let cur = line;
    let k: { key: string; after: number } | null = firstKey;
    for (;;) {
      if (!k) {
        const t = lineText(cur);
        if (isDash(t, col)) {
          return fail('Unexpected list item inside a mapping', cur, col, 'Indent the `- ` items under a key, or remove the mapping keys around them.');
        }
        const end = stripComment(t).text.trimEnd().length;
        const colon = t.indexOf(':', col);
        return fail(
          'Expected `key: value` but found no `:`',
          cur,
          colon >= 0 && colon < end ? colon : end,
          colon >= 0 && colon < end
            ? 'Add a space after the `:` — YAML needs `key: value`.'
            : 'Add `:` after the key, or indent this line if it continues the previous value.',
        );
      }
      if (hasOwn(obj, k.key)) {
        return fail(`Duplicate key "${k.key}"`, cur, col, 'Each key can appear only once in a mapping.');
      }
      setKey(obj, k.key, parseValueAfter(cur, k.after, col, true));
      if (!continues(col)) return obj;
      cur = ln;
      k = readKey(cur, col);
    }
  }

  /* ---- document ---- */

  skipBlank();
  if (ln < N && lineText(ln).startsWith('%')) {
    fail('Directives (`%YAML`, `%TAG`) are not supported', ln, 0, 'Directives are not supported in this tool — remove the line.');
  }

  let value: unknown = null;
  if (ln < N && isMarker(ln) && lineText(ln).startsWith('---')) {
    value = parseValueAfter(ln, 3, -1, false);
  } else if (ln < N && !isMarker(ln)) {
    value = parseNode(ln, indentOf(ln), -1);
  }

  skipBlank();
  if (ln < N && lineText(ln).startsWith('...') && isMarker(ln)) {
    if (!restIsEmpty(lineText(ln), 3)) fail('Unexpected content after `...`', ln, 3);
    ln++;
    skipBlank();
    if (ln < N && !(isMarker(ln) && lineText(ln).startsWith('---'))) {
      fail('Unexpected content after the document end marker `...`', ln, indentOf(ln), 'Only comments may follow `...`.');
    }
  }
  if (ln < N) {
    if (isMarker(ln) && lineText(ln).startsWith('---')) {
      fail('multiple documents are not supported', ln, 0, 'Paste one document at a time (split the input at each `---`).');
    }
    fail(
      'Inconsistent indentation',
      ln,
      indentOf(ln),
      'This line is indented less than the start of the document. Align it with the top-level entries.',
    );
  }
  return value;
}

/* ------------------------------------------------------------------------ */
/* Emitter                                                                   */
/* ------------------------------------------------------------------------ */

export interface StringifyYamlOptions {
  /** Spaces per nesting level (1–8). Default 2. */
  indent?: number;
}

type Emitted =
  | { kind: 'inline'; text: string }
  | { kind: 'block'; lines: string[] }
  | { kind: 'literal'; header: string; body: string[] };

// Characters that force double quoting (and cannot appear in a block literal).
const UNSAFE_CHARS = /[\x00-\x08\x0b-\x1f\x7f\x85\u2028\u2029\uFEFF]/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const YAML11_BOOL = /^(yes|no|on|off)$/i;
const INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;

/** Does a single-line string need double quotes to survive as a plain scalar? */
function needsQuotes(s: string): boolean {
  if (s === '') return true;
  if (/[\x00-\x1f]/.test(s) || UNSAFE_CHARS.test(s) || LONE_SURROGATE.test(s)) return true;
  if (s !== s.trim()) return true;
  if (typeof resolvePlain(s) !== 'string') return true;
  if (YAML11_BOOL.test(s)) return true; // friendlier to YAML 1.1 readers
  if (s.startsWith('---') || s.startsWith('...')) return true;
  if (INDICATOR_START.test(s)) {
    // `-x`, `?x`, `:x` are valid plain scalars; everything else needs quotes.
    const c = s[0];
    if (!((c === '-' || c === '?' || c === ':') && s.length > 1 && s[1] !== ' ')) return true;
  }
  return s.includes(': ') || s.endsWith(':') || s.includes(' #');
}

function doubleQuote(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = s.charCodeAt(i);
    switch (ch) {
      case '\\': out += '\\\\'; continue;
      case '"': out += '\\"'; continue;
      case '\n': out += '\\n'; continue;
      case '\t': out += '\\t'; continue;
      case '\r': out += '\\r'; continue;
      case '\0': out += '\\0'; continue;
      case '\b': out += '\\b'; continue;
      case '\f': out += '\\f'; continue;
      case '\v': out += '\\v'; continue;
      case '\x07': out += '\\a'; continue;
      case '\x1b': out += '\\e'; continue;
      case '\x85': out += '\\N'; continue;
      case '\u2028': out += '\\L'; continue;
      case '\u2029': out += '\\P'; continue;
    }
    if (code < 0x20 || code === 0x7f) {
      out += '\\x' + code.toString(16).padStart(2, '0');
    } else if (code === 0xfeff) {
      out += '\\uFEFF';
    } else if (code >= 0xd800 && code <= 0xdfff) {
      const next = s.charCodeAt(i + 1);
      if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        out += ch + s[i + 1];
        i++;
      } else {
        out += '\\u' + code.toString(16).toUpperCase().padStart(4, '0');
      }
    } else {
      out += ch;
    }
  }
  return out + '"';
}

const formatString = (s: string): string => (needsQuotes(s) ? doubleQuote(s) : s);

/** Can this multi-line string be written as a `|` block literal and read back exactly? */
function canBeLiteral(s: string): boolean {
  if (!s.includes('\n') || UNSAFE_CHARS.test(s) || LONE_SURROGATE.test(s)) return false;
  const parts = s.split('\n');
  const firstContent = parts.find((l) => l !== '');
  if (firstContent === undefined || firstContent[0] === ' ' || firstContent[0] === '\t') return false;
  // Whitespace-only lines are ambiguous with indentation.
  return !parts.some((l) => l !== '' && l.trim() === '');
}

function formatNumber(v: number): string {
  if (Number.isNaN(v)) return '.nan';
  if (v === Infinity) return '.inf';
  if (v === -Infinity) return '-.inf';
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

/**
 * Serialize a JSON-like value as block-style YAML. Deterministic: keys keep
 * insertion order. `undefined`/functions are skipped in objects and become
 * `null` in arrays (like JSON.stringify). No trailing newline is added unless
 * required to preserve a `|+` block scalar at the very end.
 */
export function stringifyYaml(value: unknown, opts: StringifyYamlOptions = {}): string {
  const indent = Math.min(8, Math.max(1, Math.floor(opts.indent ?? 2)));
  const pad = ' '.repeat(indent);
  const dash = '-' + ' '.repeat(Math.max(1, indent - 1));
  const dashPad = ' '.repeat(dash.length);
  const stack = new Set<object>();

  const isSkippable = (v: unknown): boolean => v === undefined || typeof v === 'function' || typeof v === 'symbol';
  const indentLine = (prefix: string, l: string): string => (l === '' ? '' : prefix + l);

  const emit = (input: unknown): Emitted => {
    let v = input;
    if (v !== null && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
      v = (v as { toJSON: () => unknown }).toJSON();
    }
    if (v === null || isSkippable(v)) return { kind: 'inline', text: 'null' };
    switch (typeof v) {
      case 'boolean':
        return { kind: 'inline', text: String(v) };
      case 'number':
        return { kind: 'inline', text: formatNumber(v) };
      case 'bigint':
        return { kind: 'inline', text: v.toString() };
      case 'string': {
        if (!canBeLiteral(v)) return { kind: 'inline', text: formatString(v) };
        const trailing = /\n*$/.exec(v)![0].length;
        const chomp = trailing === 0 ? '-' : trailing === 1 ? '' : '+';
        const body = (trailing === 0 ? v : v.slice(0, -1)).split('\n');
        return { kind: 'literal', header: '|' + chomp, body };
      }
    }
    const obj = v as object;
    if (stack.has(obj)) throw new TypeError('Converting circular structure to YAML');
    stack.add(obj);
    try {
      const lines: string[] = [];
      if (Array.isArray(obj)) {
        if (obj.length === 0) return { kind: 'inline', text: '[]' };
        for (const item of obj as unknown[]) {
          const e = emit(item);
          // Scalars always use `- `; the wider dash (indent > 2) only
          // aligns the continuation lines of nested collections.
          if (e.kind === 'inline') lines.push('- ' + e.text);
          else if (e.kind === 'literal') {
            lines.push('- ' + e.header);
            for (const l of e.body) lines.push(indentLine(dashPad, l));
          } else {
            lines.push(dash + e.lines[0]);
            for (const l of e.lines.slice(1)) lines.push(indentLine(dashPad, l));
          }
        }
        return { kind: 'block', lines };
      }
      for (const [key, item] of Object.entries(obj)) {
        if (isSkippable(item)) continue;
        const k = formatString(key);
        const e = emit(item);
        if (e.kind === 'inline') lines.push(`${k}: ${e.text}`);
        else if (e.kind === 'literal') {
          lines.push(`${k}: ${e.header}`);
          for (const l of e.body) lines.push(indentLine(pad, l));
        } else {
          lines.push(`${k}:`);
          for (const l of e.lines) lines.push(indentLine(pad, l));
        }
      }
      if (lines.length === 0) return { kind: 'inline', text: '{}' };
      return { kind: 'block', lines };
    } finally {
      stack.delete(obj);
    }
  };

  const root = emit(value);
  let lines: string[];
  if (root.kind === 'inline') lines = [root.text];
  else if (root.kind === 'literal') lines = [root.header, ...root.body.map((l) => indentLine(pad, l))];
  else lines = root.lines;
  const out = lines.join('\n');
  // A trailing empty line belongs to a `|+` scalar; the parser treats the
  // final newline as a line terminator, so add one more to keep it.
  return lines[lines.length - 1] === '' ? out + '\n' : out;
}
