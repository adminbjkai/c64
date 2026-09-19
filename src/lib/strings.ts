/**
 * Small string transforms for the String Utilities mode: slugify, deburr
 * (NFKD + strip combining marks), reverse (code-point safe), ROT13 / ROT47,
 * NATO phonetic spelling, obfuscate (mask the middle), Roman numerals both
 * ways (1–3999), \uXXXX escaping / unescaping, and per-code-point listing
 * with UTF-8 / UTF-16 byte lengths.
 */

export function deburr(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[Øø]/g, (c) => (c === 'Ø' ? 'O' : 'o')).replace(/[Łł]/g, (c) => (c === 'Ł' ? 'L' : 'l')).replace(/Æ/g, 'AE').replace(/æ/g, 'ae').replace(/Œ/g, 'OE').replace(/œ/g, 'oe').replace(/Đ/g, 'D').replace(/đ/g, 'd');
}

export function slugify(s: string, opts: { lowercase?: boolean; separator?: string; maxLength?: number } = {}): string {
  const sep = opts.separator ?? '-';
  let out = deburr(s).replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/\s+/g, sep);
  if (opts.lowercase !== false) out = out.toLowerCase();
  if (opts.maxLength && opts.maxLength > 0 && out.length > opts.maxLength) {
    out = out.slice(0, opts.maxLength);
    if (sep !== '' && out.endsWith(sep)) out = out.slice(0, -sep.length);
    // Avoid cutting a word in half when a separator sits within the last quarter.
    const lastSep = sep === '' ? -1 : out.lastIndexOf(sep);
    if (lastSep > opts.maxLength * 0.75) out = out.slice(0, lastSep);
  }
  return out;
}

export function reverseString(s: string): string {
  return Array.from(s).reverse().join('');
}

export function rot13(s: string): string {
  return s.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

export function rot47(s: string): string {
  return s.replace(/[!-~]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 33 + 47) % 94) + 33));
}

const NATO: Record<string, string> = {
  a: 'Alfa', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot', g: 'Golf', h: 'Hotel', i: 'India', j: 'Juliett', k: 'Kilo', l: 'Lima', m: 'Mike',
  n: 'November', o: 'Oscar', p: 'Papa', q: 'Quebec', r: 'Romeo', s: 'Sierra', t: 'Tango', u: 'Uniform', v: 'Victor', w: 'Whiskey', x: 'X-ray', y: 'Yankee', z: 'Zulu',
  '0': 'Zero', '1': 'One', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine',
  '-': 'Dash', '.': 'Stop', ',': 'Comma', '@': 'At', '/': 'Slash', '_': 'Underscore',
};

export function nato(s: string): string {
  const out: string[] = [];
  for (const ch of s) {
    if (ch === ' ') { out.push('(space)'); continue; }
    const word = NATO[ch.toLowerCase()];
    if (word === undefined) out.push(`'${ch}'`);
    else out.push(ch >= 'A' && ch <= 'Z' ? word.toUpperCase() : word);
  }
  return out.join(' ');
}

export function obfuscate(s: string, keep = 2, mask = '*'): string {
  const chars = Array.from(s);
  if (chars.length <= keep * 2) return mask.repeat(chars.length);
  return chars.slice(0, keep).join('') + mask.repeat(chars.length - keep * 2) + chars.slice(chars.length - keep).join('');
}

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new Error(`${n} is out of range for Roman numerals (1–3999).`);
  let out = '';
  for (const [v, sym] of ROMAN) while (n >= v) { out += sym; n -= v; }
  return out;
}

export function fromRoman(s: string): number {
  const t = s.trim().toUpperCase();
  if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(t) || t === '') throw new Error(`"${s}" is not a valid Roman numeral.`);
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const cur = val[t[i] as string] as number;
    const nxt = val[t[i + 1] as string] ?? 0;
    total += cur < nxt ? -cur : cur;
  }
  return total;
}

/** Number → Roman or Roman → number, chosen by what the text looks like. */
export function roman(s: string): string {
  const t = s.trim();
  if (/^\d+$/.test(t)) return toRoman(Number(t));
  return String(fromRoman(t));
}

/** Escapes every non-ASCII (and control) char as \uXXXX (surrogate pairs stay as two escapes, like JSON). */
export function unicodeEscape(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x20 && c < 0x7f ? s[i] : `\\u${c.toString(16).padStart(4, '0')}`;
  }
  return out;
}

export function unicodeUnescape(s: string): string {
  return s.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g, (_, brace: string | undefined, four: string | undefined, two: string | undefined) =>
    String.fromCodePoint(parseInt((brace ?? four ?? two) as string, 16)),
  );
}

/** Escape if the text has anything to escape, otherwise unescape. */
export function unicodeEscapeAuto(s: string): { text: string; direction: 'escape' | 'unescape' } {
  if (/\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]{1,6}\}|\\x[0-9a-fA-F]{2}/.test(s) && !/[^\x20-\x7e\n\r\t]/.test(s)) return { text: unicodeUnescape(s), direction: 'unescape' };
  return { text: unicodeEscape(s), direction: 'escape' };
}

export interface CodePointInfo {
  char: string;
  codePoint: string;
  decimal: number;
  utf8: number;
  utf16: number;
  category: string;
}

function categoryOf(ch: string): string {
  if (/\p{Lu}/u.test(ch)) return 'Uppercase letter';
  if (/\p{Ll}/u.test(ch)) return 'Lowercase letter';
  if (/\p{L}/u.test(ch)) return 'Letter';
  if (/\p{Nd}/u.test(ch)) return 'Decimal digit';
  if (/\p{N}/u.test(ch)) return 'Number';
  if (/\p{Zs}/u.test(ch)) return 'Space';
  if (/\p{P}/u.test(ch)) return 'Punctuation';
  if (/\p{S}/u.test(ch)) return 'Symbol';
  if (/\p{M}/u.test(ch)) return 'Combining mark';
  if (/\p{Cc}/u.test(ch)) return 'Control';
  if (/\p{Cf}/u.test(ch)) return 'Format';
  return 'Other';
}

export function codePoints(s: string): CodePointInfo[] {
  const out: CodePointInfo[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    out.push({
      char: ch,
      codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      decimal: cp,
      utf8: cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4,
      utf16: cp < 0x10000 ? 2 : 4,
      category: categoryOf(ch),
    });
  }
  return out;
}
