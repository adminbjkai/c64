/**
 * Word splitting and case conversion. Splitting follows the change-case
 * conventions: boundaries at lower→Upper ("fooBar"), at the end of an
 * acronym ("HTTPServer" → HTTP Server), and at any run of non-alphanumeric
 * characters (space, _, -, ., /, punctuation). Digits stay attached to the
 * letters before them ("utf8", "v2Beta" → v2 Beta). Unicode letters are
 * handled via \p{L} classes.
 */

export type CaseStyle =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'screaming'
  | 'kebab'
  | 'title'
  | 'sentence'
  | 'lower'
  | 'upper'
  | 'dot'
  | 'path'
  | 'header'
  | 'alternating';

export const CASE_STYLES: { value: CaseStyle; label: string }[] = [
  { value: 'camel', label: 'camelCase' },
  { value: 'pascal', label: 'PascalCase' },
  { value: 'snake', label: 'snake_case' },
  { value: 'screaming', label: 'SCREAMING_SNAKE' },
  { value: 'kebab', label: 'kebab-case' },
  { value: 'title', label: 'Title Case' },
  { value: 'sentence', label: 'Sentence case' },
  { value: 'lower', label: 'lower' },
  { value: 'upper', label: 'UPPER' },
  { value: 'dot', label: 'dot.case' },
  { value: 'path', label: 'path/case' },
  { value: 'header', label: 'Header-Case' },
  { value: 'alternating', label: 'aLtErNaTiNg' },
];

export function splitWords(text: string): string[] {
  return text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const low = (w: string) => w.toLowerCase();

export function convertCase(text: string, style: CaseStyle): string {
  if (style === 'lower') return text.toLowerCase();
  if (style === 'upper') return text.toUpperCase();
  const words = splitWords(text);
  switch (style) {
    case 'camel':
      return words.map((w, i) => (i === 0 ? low(w) : cap(w))).join('');
    case 'pascal':
      return words.map(cap).join('');
    case 'snake':
      return words.map(low).join('_');
    case 'screaming':
      return words.map((w) => w.toUpperCase()).join('_');
    case 'kebab':
      return words.map(low).join('-');
    case 'title':
      return words.map(cap).join(' ');
    case 'sentence':
      return words.map((w, i) => (i === 0 ? cap(w) : low(w))).join(' ');
    case 'dot':
      return words.map(low).join('.');
    case 'path':
      return words.map(low).join('/');
    case 'header':
      return words.map(cap).join('-');
    case 'alternating': {
      let upper = false;
      let out = '';
      for (const ch of words.map(low).join(' ')) {
        if (/\p{L}/u.test(ch)) {
          out += upper ? ch.toUpperCase() : ch;
          upper = !upper;
        } else out += ch;
      }
      return out;
    }
  }
}
