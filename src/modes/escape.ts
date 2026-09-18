/**
 * Escape / Unescape mode: quote text for JSON, JavaScript, CSV, POSIX shell,
 * regular expressions, XML or SQL. Unescaping is supported where it is
 * well-defined (json, javascript, csv, xml); shell, regex and sql are one-way.
 */

import { type ToolMode, type ModeResult, type RunContext, type Diagnostic } from './types.js';

export type EscapeLanguage = 'json' | 'javascript' | 'csv' | 'shell' | 'regex' | 'xml' | 'sql';
const LANGUAGES: EscapeLanguage[] = ['json', 'javascript', 'csv', 'shell', 'regex', 'xml', 'sql'];
const LABEL: Record<EscapeLanguage, string> = { json: 'JSON', javascript: 'JavaScript', csv: 'CSV', shell: 'shell', regex: 'regex', xml: 'XML', sql: 'SQL' };

class EscapeError extends Error {
  constructor(message: string, public offset: number, public hint: string) {
    super(message);
  }
}

/* ------------------------------------------------------------ escaping */

export function escapeJson(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

export function escapeJavascript(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = ch.charCodeAt(0);
    switch (ch) {
      case '\\': out += '\\\\'; break;
      case "'": out += "\\'"; break;
      case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break;
      case '\t': out += '\\t'; break;
      case '\b': out += '\\b'; break;
      case '\f': out += '\\f'; break;
      case '\v': out += '\\v'; break;
      case '\u2028': out += '\\u2028'; break;
      case '\u2029': out += '\\u2029'; break;
      default:
        if (code === 0 && !/[0-9]/.test(s[i + 1] ?? '')) out += '\\0';
        else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
        else out += ch;
    }
  }
  return out;
}

export function escapeCsv(s: string): string {
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function escapeShell(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

const XML: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML[c]!);
}

export function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

/* ---------------------------------------------------------- unescaping */

/** Strip one pair of surrounding quotes (`q`) if present. */
function stripQuotes(s: string, q: string): string {
  const t = s.trim();
  return t.length >= 2 && t.startsWith(q) && t.endsWith(q) ? t.slice(1, -1) : s;
}

function hex(s: string, at: number, n: number, what: string): number {
  const part = s.slice(at, at + n);
  if (part.length !== n || !/^[0-9a-fA-F]+$/.test(part)) throw new EscapeError(`Bad ${what} escape "\\${s[at - 1]}${part}"`, at - 2, `\\${s[at - 1]} must be followed by exactly ${n} hex digits.`);
  return parseInt(part, 16);
}

export function unescapeJson(input: string): string {
  const s = stripQuotes(input, '"');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const n = s[i + 1];
    if (n === undefined) throw new EscapeError('Trailing backslash', i, 'A backslash must be followed by an escape character such as n, t, " or \\.');
    switch (n) {
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'u': out += String.fromCharCode(hex(s, i + 2, 4, 'unicode')); i += 4; break;
      default:
        throw new EscapeError(`Invalid JSON escape "\\${n}"`, i, 'JSON only allows \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.');
    }
    i++;
  }
  return out;
}

export function unescapeJavascript(input: string): string {
  let s = input.trim();
  s = s.length >= 2 && ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`'))) ? s.slice(1, -1) : input;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const n = s[i + 1];
    if (n === undefined) throw new EscapeError('Trailing backslash', i, 'A backslash must be followed by an escape character.');
    i++;
    switch (n) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case '\n': break; // line continuation
      case 'x': out += String.fromCharCode(hex(s, i + 1, 2, 'hex')); i += 2; break;
      case 'u':
        if (s[i + 1] === '{') {
          const end = s.indexOf('}', i + 2);
          const body = end === -1 ? '' : s.slice(i + 2, end);
          if (!/^[0-9a-fA-F]{1,6}$/.test(body)) throw new EscapeError('Bad \\u{…} escape', i - 1, '\\u{…} must contain 1–6 hex digits.');
          out += String.fromCodePoint(parseInt(body, 16));
          i = end;
        } else {
          out += String.fromCharCode(hex(s, i + 1, 4, 'unicode'));
          i += 4;
        }
        break;
      default:
        out += n; // \' \" \\ and any unknown escape → the character itself
    }
  }
  return out;
}

export function unescapeCsv(input: string): string {
  const t = input.trim();
  if (!t.startsWith('"')) return input;
  if (t.length < 2 || !t.endsWith('"')) throw new EscapeError('Unterminated quoted field', t.length, 'A field that starts with a quote must end with one; inner quotes are doubled ("").');
  const body = t.slice(1, -1);
  const bad = /(^|[^"])"([^"]|$)/.exec(body);
  if (bad) throw new EscapeError('Lone quote inside quoted field', bad.index + 2, 'Quotes inside a quoted CSV field must be doubled: "".');
  return body.replace(/""/g, '"');
}

const XML_BACK: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x';
      const cp = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return XML_BACK[body] ?? whole;
  });
}

/* ---------------------------------------------------------------- mode */

const ONE_WAY_HINT: Record<'shell' | 'regex' | 'sql', string> = {
  shell: 'Shell quoting is only produced here. To unquote, run the text through a shell: printf %s <quoted>.',
  regex: 'Regex escaping is only produced here. Removing backslashes blindly would change the meaning of escapes like \\n or \\d.',
  sql: "SQL escaping is only produced here. To reverse it, replace each doubled quote ('') with a single one.",
};

export function runEscape(input: string, ctx: RunContext): ModeResult {
  if (input === '') return { output: '', status: '' };
  const langOpt = ctx.options['language'];
  const language: EscapeLanguage = LANGUAGES.includes(langOpt as EscapeLanguage) ? (langOpt as EscapeLanguage) : 'json';
  const direction = ctx.options['direction'] === 'unescape' ? 'unescape' : 'escape';
  const quotes = ctx.options['quotes'] === true;

  if (direction === 'escape') {
    let output: string;
    switch (language) {
      case 'json': output = quotes ? `"${escapeJson(input)}"` : escapeJson(input); break;
      case 'javascript': output = quotes ? `'${escapeJavascript(input)}'` : escapeJavascript(input); break;
      case 'csv': output = escapeCsv(input); break;
      case 'shell': output = escapeShell(input); break;
      case 'regex': output = escapeRegex(input); break;
      case 'xml': output = escapeXml(input); break;
      case 'sql': output = escapeSql(input); break;
    }
    return { output, status: `Escaped for ${LABEL[language]} · ${input.length} chars → ${output.length} chars` };
  }

  if (language === 'shell' || language === 'regex' || language === 'sql') {
    return {
      output: '',
      error: { message: `${LABEL[language]} escaping is one-way`, hint: ONE_WAY_HINT[language] },
      status: `Cannot unescape ${LABEL[language]}`,
    };
  }
  try {
    let output: string;
    switch (language) {
      case 'json': output = unescapeJson(input); break;
      case 'javascript': output = unescapeJavascript(input); break;
      case 'csv': output = unescapeCsv(input); break;
      case 'xml': output = unescapeXml(input); break;
    }
    return { output, status: `Unescaped ${LABEL[language]} · ${input.length} chars → ${output.length} chars` };
  } catch (e) {
    const error: Diagnostic = { message: e instanceof Error ? e.message : String(e) };
    if (e instanceof EscapeError) {
      const before = input.slice(0, e.offset);
      error.line = before.split('\n').length;
      error.col = e.offset - before.lastIndexOf('\n');
      error.hint = e.hint;
    }
    return { output: '', error, status: error.line ? `Invalid ${LABEL[language]} escape · line ${error.line}, col ${error.col}` : `Invalid ${LABEL[language]} escape` };
  }
}

export const escapeMode: ToolMode = {
  id: 'escape',
  label: 'Escape / Unescape',
  description: 'Quote text for JSON, JavaScript, CSV, shell, regex, XML or SQL — and unescape it again.',
  category: 'Text',
  icon: 'escape',
  keywords: ['quote', 'string', 'backslash', 'json', 'javascript', 'csv', 'shell', 'regex', 'xml', 'sql'],
  emptyHint: 'Paste text to escape for the chosen language, or an escaped string to unescape.',
  sample: 'He said "hi" \\ tab:\there\nline 2 with \'quotes\' & <tags>',
  supportsPretty: false,
  controls: [
    {
      kind: 'select',
      key: 'language',
      label: 'Language',
      default: 'json',
      options: LANGUAGES.map((l) => ({ value: l, label: LABEL[l] })),
    },
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      default: 'escape',
      options: [
        { value: 'escape', label: 'Escape' },
        { value: 'unescape', label: 'Unescape' },
      ],
    },
    { kind: 'toggle', key: 'quotes', label: 'Surrounding quotes', default: false },
  ],
  run: runEscape,
};
