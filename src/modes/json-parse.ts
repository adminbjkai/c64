/**
 * A tolerant JSON parser with exact error positions and plain-English hints.
 *
 * Why hand-roll this when JSON.parse exists? Two reasons:
 *   1. Engines disagree on error messages and rarely give line/column.
 *   2. Real-world pasted JSON is often "almost JSON": trailing commas, smart
 *      quotes from a chat app, single quotes, `//` comments. We accept those
 *      (and report that we did) instead of failing.
 *
 * Callers should try the native JSON.parse fast path first (see json.ts) and
 * only fall back here — this parser is roughly 5–10× slower than native.
 */

export class JsonParseError extends Error {
  constructor(
    message: string,
    public readonly offset: number,
    public readonly line: number,
    public readonly col: number,
    public readonly hint?: string,
  ) {
    super(message);
  }
}

export interface TolerantResult {
  value: unknown;
  notes: string[];
  /** Only when `spans` was requested: pathKey → [start, end) offsets in the text. */
  spans?: Map<string, [number, number]>;
}

/**
 * Key used to look up a value's source span: path segments joined by U+0001.
 * (Objects and arrays never mix keys and indexes at one level, so "0" as a
 * key and 0 as an index cannot collide.)
 */
export function pathKey(segments: readonly (string | number)[]): string {
  return segments.join('\u0001');
}

const SMART_DOUBLE = /[“”„‟″‶]/;
const SMART_SINGLE = /[‘’‚‛′‵]/;

export function parseTolerant(text: string, opts: { spans?: boolean } = {}): TolerantResult {
  const notes = new Set<string>();
  let i = 0;
  const n = text.length;
  // Optional source-span tracking, used by Tree/Path/Graph to select a value
  // in the editor. Off by default — it costs a Map insert per value.
  const spans = opts.spans ? new Map<string, [number, number]>() : undefined;
  const path: string[] = [];

  const lineCol = (off: number): [number, number] => {
    let line = 1;
    let last = -1;
    for (let k = 0; k < off && k < n; k++) {
      if (text.charCodeAt(k) === 10) {
        line++;
        last = k;
      }
    }
    return [line, off - last];
  };

  const fail = (message: string, off = i, hint?: string): never => {
    const [line, col] = lineCol(off);
    throw new JsonParseError(message, off, line, col, hint);
  };

  const describe = (off: number): string => {
    if (off >= n) return 'end of input';
    const ch = text[off]!;
    if (ch === '\n') return 'line break';
    return `\`${ch}\``;
  };

  const skipWs = (): void => {
    for (;;) {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff || c === 0xa0) i++;
        else break;
      }
      if (text.startsWith('//', i)) {
        notes.add('Ignored // comments (not valid JSON).');
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (text.startsWith('/*', i)) {
        notes.add('Ignored /* */ comments (not valid JSON).');
        const end = text.indexOf('*/', i + 2);
        if (end === -1) fail('Comment never closes', i, 'Add `*/` to close the comment.');
        i = end + 2;
        continue;
      }
      break;
    }
  };

  const parseValue = (): unknown => {
    skipWs();
    if (!spans) return parseValueInner();
    const start = i;
    const v = parseValueInner();
    spans.set(path.join('\u0001'), [start, i]);
    return v;
  };

  const parseValueInner = (): unknown => {
    if (i >= n) return fail('Unexpected end of input', i, 'The JSON ends before the value is complete.');
    const ch = text[i]!;
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"' || ch === "'" || SMART_DOUBLE.test(ch) || SMART_SINGLE.test(ch)) return parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    if (text.startsWith('true', i)) return (i += 4), true;
    if (text.startsWith('false', i)) return (i += 5), false;
    if (text.startsWith('null', i)) return (i += 4), null;
    if (ch === ']' || ch === '}') {
      return fail(`Unexpected ${describe(i)}`, i, 'There is a closing bracket with nothing before it — maybe a stray comma?');
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const word = text.slice(i).match(/^[A-Za-z_$][\w$]*/)![0];
      const lower = word.toLowerCase();
      if (lower === 'true' || lower === 'false' || lower === 'null') {
        return fail(`Unexpected \`${word}\``, i, `JSON literals are lowercase: use \`${lower}\`.`);
      }
      if (word === 'undefined' || word === 'NaN' || word === 'Infinity') {
        return fail(`\`${word}\` is not valid JSON`, i, 'Use `null` instead (JSON has no undefined/NaN/Infinity).');
      }
      return fail(`Unexpected \`${word}\``, i, 'Strings must be wrapped in double quotes.');
    }
    return fail(`Unexpected ${describe(i)}`, i);
  };

  const parseString = (): string => {
    const open = text[i]!;
    let close = open;
    if (open === "'") {
      notes.add('Accepted single-quoted strings (JSON requires double quotes).');
    } else if (SMART_DOUBLE.test(open)) {
      notes.add('Replaced smart quotes (“ ”) with straight quotes.');
      close = ''; // any smart double quote closes
    } else if (SMART_SINGLE.test(open)) {
      notes.add('Replaced smart quotes (‘ ’) with straight quotes.');
      close = '';
    }
    const start = i;
    i++;
    let out = '';
    for (;;) {
      if (i >= n) return fail('Unterminated string', start, 'Add a closing `"`.');
      const c = text[i]!;
      const isClose = close ? c === close : open === "'" ? false : SMART_DOUBLE.test(c) || SMART_SINGLE.test(c) || c === '"';
      if (isClose) {
        i++;
        return out;
      }
      if (c === '\n') return fail('Line break inside a string', i, 'Escape it as `\\n` or close the string on the same line.');
      if (c === '\\') {
        i++;
        const e = text[i];
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case "'": out += "'"; break;
          case 'u': {
            const hex = text.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail('Bad unicode escape', i - 1, 'Use four hex digits, e.g. `\\u00e9`.');
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            return fail(`Bad escape \`\\${e ?? ''}\``, i - 1, 'Valid escapes are \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX.');
        }
        i++;
        continue;
      }
      out += c;
      i++;
    }
  };

  const parseNumber = (): number => {
    const start = i;
    const m = text.slice(i).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
    if (!m || m[0] === '-') return fail('Malformed number', start, 'Numbers look like `-12.5e3`; no leading `+`, `.5`, or `0x` allowed.');
    i += m[0].length;
    if (text[i] === '.' ) return fail('Malformed number', i, 'A number can have only one decimal point.');
    if (/[0-9]/.test(text[i] ?? '')) return fail('Malformed number', start, 'Leading zeros are not allowed (`012` → `12`).');
    return Number(m[0]);
  };

  const parseArray = (): unknown[] => {
    const start = i;
    i++; // [
    const arr: unknown[] = [];
    skipWs();
    if (text[i] === ']') return i++, arr;
    for (;;) {
      skipWs();
      if (text[i] === ']') {
        notes.add('Removed a trailing comma.');
        i++;
        return arr;
      }
      path.push(String(arr.length));
      arr.push(parseValue());
      path.pop();
      skipWs();
      const c = text[i];
      if (c === ',') { i++; continue; }
      if (c === ']') { i++; return arr; }
      if (i >= n) return fail('Unclosed array', start, 'Add a `]` to close the array.');
      return fail(`Expected \`,\` or \`]\` but found ${describe(i)}`, i, 'Array items must be separated by commas.');
    }
  };

  const parseObject = (): Record<string, unknown> => {
    const start = i;
    i++; // {
    const obj: Record<string, unknown> = {};
    skipWs();
    if (text[i] === '}') return i++, obj;
    for (;;) {
      skipWs();
      if (text[i] === '}') {
        notes.add('Removed a trailing comma.');
        i++;
        return obj;
      }
      if (i >= n) return fail('Unclosed object', start, 'Add a `}` to close the object.');
      let key: string;
      const c = text[i]!;
      if (c === '"' || c === "'" || SMART_DOUBLE.test(c) || SMART_SINGLE.test(c)) {
        key = parseString();
      } else if (/[A-Za-z_$]/.test(c)) {
        key = text.slice(i).match(/^[A-Za-z_$][\w$]*/)![0];
        i += key.length;
        notes.add('Quoted bare object keys (JSON requires "quoted" keys).');
      } else {
        return fail(`Expected a "key" but found ${describe(i)}`, i, 'Object keys must be strings in double quotes.');
      }
      skipWs();
      if (text[i] !== ':') return fail(`Expected \`:\` after key "${key}" but found ${describe(i)}`, i);
      i++;
      path.push(key);
      obj[key] = parseValue();
      path.pop();
      skipWs();
      const d = text[i];
      if (d === ',') { i++; continue; }
      if (d === '}') { i++; return obj; }
      if (i >= n) return fail('Unclosed object', start, 'Add a `}` to close the object.');
      return fail(`Expected \`,\` or \`}\` but found ${describe(i)}`, i, 'Object entries must be separated by commas.');
    }
  };

  const value = parseValue();
  skipWs();
  if (i < n) {
    fail(`Unexpected ${describe(i)} after the end of the JSON value`, i, 'Only one top-level value is allowed. Wrap multiple values in an array.');
  }
  return spans ? { value, notes: [...notes], spans } : { value, notes: [...notes] };
}
