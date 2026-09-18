/**
 * Regex Tester mode. The pane input is the test string; pattern, flags and
 * the action (match / replace / split / test) are header controls. Matching
 * is capped at 10 000 matches and zero-length matches always advance so a
 * pattern like `a*` cannot loop forever.
 */

import { type ToolMode, type ModeResult, type RunContext } from './types.js';

export type RegexAction = 'match' | 'replace' | 'split' | 'test';
export const MATCH_CAP = 10_000;

export interface RegexMatch {
  index: number;
  end: number;
  match: string;
  /** Numbered groups, 1-based (index 0 = group 1); undefined when the group did not participate. */
  groups: (string | undefined)[];
  /** Named groups, when any. */
  named: Record<string, string | undefined>;
}

export interface RegexData {
  input: string;
  pattern: string;
  flags: string;
  matches: RegexMatch[];
  groupCount: number;
  groupNames: string[];
  capped: boolean;
}

export const REGEX_CHEATSHEET = '\\d digit · \\w word · \\s space · . any · ^ $ anchors · * + ? {n,m} quantifiers · [abc] class · (…) group · (?<name>…) named group · (?:…) non-capturing · a|b alternation · \\b word boundary';

/** Build a RegExp, always with `g` so we can enumerate. Throws the native SyntaxError. */
export function compile(pattern: string, flags: string): { re: RegExp; global: boolean } {
  const clean = Array.from(new Set(flags.replace(/\s+/g, ''))).join('');
  const global = clean.includes('g');
  const re = new RegExp(pattern, clean.includes('g') ? clean : clean + 'g');
  return { re, global };
}

export function countGroups(re: RegExp): { count: number; names: string[] } {
  // Matching the empty string against an alternation of the pattern with "" yields
  // an array whose length is groupCount + 1 without needing to parse the source.
  const probe = new RegExp(`${re.source}|`, re.flags.replace('g', '').replace('y', ''));
  const m = probe.exec('');
  const count = m ? m.length - 1 : 0;
  const names = m?.groups ? Object.keys(m.groups) : [];
  return { count, names };
}

export function findMatches(re: RegExp, input: string, global: boolean): { matches: RegexMatch[]; capped: boolean } {
  const matches: RegexMatch[] = [];
  re.lastIndex = 0;
  let capped = false;
  for (;;) {
    const m = re.exec(input);
    if (!m) break;
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      match: m[0],
      groups: m.slice(1),
      named: m.groups ? { ...m.groups } : {},
    });
    if (!global) break;
    if (m[0].length === 0) re.lastIndex = m.index + 1; // zero-length: step forward
    if (re.lastIndex > input.length) break;
    if (matches.length >= MATCH_CAP) {
      capped = true;
      break;
    }
  }
  return { matches, capped };
}

function q(s: string | undefined): string {
  return s === undefined ? 'undefined' : JSON.stringify(s);
}

export function formatMatches(d: RegexData): string {
  return d.matches
    .map((m, i) => {
      const parts: string[] = [];
      m.groups.forEach((g, gi) => parts.push(`g${gi + 1}=${q(g)}`));
      for (const [k, v] of Object.entries(m.named)) parts.push(`${k}=${q(v)}`);
      return `${i + 1}: [${m.index}-${m.end}] ${JSON.stringify(m.match)}${parts.length ? ` (${parts.join(', ')})` : ''}`;
    })
    .join('\n');
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : w === 'match' ? 'es' : 's'}`;

export function runRegex(input: string, ctx: RunContext): ModeResult {
  const pattern = typeof ctx.options['pattern'] === 'string' ? ctx.options['pattern'] : '';
  const flags = typeof ctx.options['flags'] === 'string' ? ctx.options['flags'] : 'g';
  const a = ctx.options['action'];
  const action: RegexAction = a === 'replace' || a === 'split' || a === 'test' ? a : 'match';
  const replacement = typeof ctx.options['replacement'] === 'string' ? ctx.options['replacement'] : '';

  if (pattern === '') {
    return { output: '', status: input === '' ? '' : 'Enter a pattern', notes: [REGEX_CHEATSHEET] };
  }
  if (input === '') return { output: '', status: '' };

  let re: RegExp;
  let global: boolean;
  try {
    ({ re, global } = compile(pattern, flags));
  } catch (e) {
    return {
      output: '',
      error: { message: (e as Error).message, hint: 'Check for unbalanced brackets or parentheses, a trailing backslash, or an unknown flag (valid: g i m s u y d v).' },
      status: 'Invalid regular expression',
    };
  }

  const { count: groupCount, names: groupNames } = countGroups(re);
  const groupsLabel = plural(groupCount, 'group');

  if (action === 'replace') {
    const out = input.replace(global ? re : new RegExp(re.source, re.flags.replace('g', '')), replacement);
    const { matches } = findMatches(re, input, global);
    return { output: out, status: `${plural(matches.length, 'replacement')} · ${groupsLabel}` };
  }
  if (action === 'split') {
    const parts = input.split(global ? re : new RegExp(re.source, re.flags.replace('g', '')));
    return { output: JSON.stringify(parts, null, 2), status: `${plural(parts.length, 'part')} · ${groupsLabel}` };
  }
  if (action === 'test') {
    re.lastIndex = 0;
    const ok = re.test(input);
    return { output: String(ok), status: ok ? 'Pattern matches' : 'No match' };
  }

  const { matches, capped } = findMatches(re, input, global);
  const data: RegexData = { input, pattern, flags: re.flags, matches, groupCount, groupNames, capped };
  const notes: string[] = [];
  if (capped) notes.push(`Stopped after ${MATCH_CAP} matches.`);
  if (!global) notes.push('No g flag: only the first match is reported.');
  return {
    output: formatMatches(data),
    status: `${plural(matches.length, 'match')} · ${groupsLabel}`,
    notes: notes.length ? notes : undefined,
    view: { kind: 'regex', data },
  };
}

export const regexMode: ToolMode = {
  id: 'regex',
  label: 'Regex Tester',
  description: 'Try a JavaScript regular expression against text: highlight matches, list groups, replace or split.',
  category: 'Developer',
  icon: 'regex',
  keywords: ['regexp', 'pattern', 'match', 'replace', 'split', 'capture', 'group'],
  emptyHint: 'Paste the text to test here; set the pattern and flags in the options above.',
  sample: 'Contact: ada@example.com, grace@hopper.org\nOrders: #1042 shipped 2026-09-18, #1043 pending 2026-09-20\n',
  sampleOptions: { pattern: '(?<user>\\w+)@(?<host>[\\w.]+)', flags: 'g' },
  supportsPretty: false,
  controls: [
    { kind: 'text', key: 'pattern', label: 'Pattern', placeholder: '(?<user>\\w+)@(?<host>[\\w.]+)', default: '' },
    { kind: 'text', key: 'flags', label: 'Flags', placeholder: 'gim', default: 'g' },
    {
      kind: 'select',
      key: 'action',
      label: 'Action',
      default: 'match',
      options: [
        { value: 'match', label: 'Match' },
        { value: 'replace', label: 'Replace' },
        { value: 'split', label: 'Split' },
        { value: 'test', label: 'Test' },
      ],
    },
    { kind: 'text', key: 'replacement', label: 'Replacement', placeholder: '$1 or $<name>', default: '' },
  ],
  run: runRegex,
};
