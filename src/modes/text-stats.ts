/**
 * Text Statistics mode: character / word / sentence / paragraph counts,
 * reading and speaking time, top words and a character-class breakdown.
 * Output is aligned key/value text; the view is a grid of stat tiles.
 */

import { type ToolMode, type ModeResult, type RunContext, byteLength } from './types.js';

export interface WordFreq {
  word: string;
  count: number;
}

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  bytes: number;
  words: number;
  uniqueWords: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  avgWordLength: number;
  avgSentenceLength: number;
  /** Minutes at 200 wpm. */
  readingMinutes: number;
  /** Minutes at 130 wpm. */
  speakingMinutes: number;
  topWords: WordFreq[];
  classes: { letters: number; digits: number; spaces: number; punctuation: number; other: number };
}

export const STOP_WORDS = new Set(
  'a an the and or but if then else of to in on at by for with from as is are was were be been being am it its this that these those i me my we our you your he him his she her they them their what which who whom do does did have has had not no yes so than too very can will would should could may might must shall just also into over under about up down out off again further once here there when where why how all any both each few more most other some such only own same s t don than'.split(
    ' ',
  ),
);

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export function tokenizeWords(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

export function countSentences(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const ends = t.match(/[.!?]+(?=\s|$)/g) ?? [];
  // Text that doesn't end with terminal punctuation still counts as one sentence.
  return ends.length + (/[.!?]\s*$/.test(t) ? 0 : 1);
}

export function computeStats(text: string, ignoreStopWords = true): TextStats {
  const chars = Array.from(text);
  const words = tokenizeWords(text);
  const lower = words.map((w) => w.toLowerCase());
  const freq = new Map<string, number>();
  for (const w of lower) freq.set(w, (freq.get(w) ?? 0) + 1);
  const topWords = [...freq.entries()]
    .filter(([w]) => !ignoreStopWords || !STOP_WORDS.has(w))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));
  const classes = { letters: 0, digits: 0, spaces: 0, punctuation: 0, other: 0 };
  for (const c of chars) {
    if (/\p{L}/u.test(c)) classes.letters++;
    else if (/\p{N}/u.test(c)) classes.digits++;
    else if (/\s/u.test(c)) classes.spaces++;
    else if (/[\p{P}\p{S}]/u.test(c)) classes.punctuation++;
    else classes.other++;
  }
  const sentences = countSentences(text);
  const paragraphs = text.split(/\n[ \t]*\n+/).filter((p) => p.trim() !== '').length;
  const lines = text === '' ? 0 : text.split(/\r\n|\r|\n/).length;
  const wordChars = words.reduce((n, w) => n + Array.from(w).length, 0);
  return {
    characters: chars.length,
    charactersNoSpaces: chars.length - classes.spaces,
    bytes: byteLength(text),
    words: words.length,
    uniqueWords: freq.size,
    sentences,
    paragraphs,
    lines,
    avgWordLength: words.length ? wordChars / words.length : 0,
    avgSentenceLength: sentences ? words.length / sentences : 0,
    readingMinutes: words.length / 200,
    speakingMinutes: words.length / 130,
    topWords,
    classes,
  };
}

export function formatMinutes(min: number): string {
  const s = Math.round(min * 60);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function formatStats(s: TextStats): string {
  const rows: [string, string][] = [
    ['Characters', String(s.characters)],
    ['Characters (no spaces)', String(s.charactersNoSpaces)],
    ['Bytes (UTF-8)', String(s.bytes)],
    ['Words', String(s.words)],
    ['Unique words', String(s.uniqueWords)],
    ['Sentences', String(s.sentences)],
    ['Paragraphs', String(s.paragraphs)],
    ['Lines', String(s.lines)],
    ['Average word length', s.avgWordLength.toFixed(1)],
    ['Average sentence length', `${s.avgSentenceLength.toFixed(1)} words`],
    ['Reading time (200 wpm)', formatMinutes(s.readingMinutes)],
    ['Speaking time (130 wpm)', formatMinutes(s.speakingMinutes)],
    ['Letters', String(s.classes.letters)],
    ['Digits', String(s.classes.digits)],
    ['Spaces', String(s.classes.spaces)],
    ['Punctuation', String(s.classes.punctuation)],
    ['Other', String(s.classes.other)],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `${k.padEnd(w)}  ${v}`);
  if (s.topWords.length) {
    lines.push('', 'Top words');
    const ww = Math.max(...s.topWords.map((t) => t.word.length));
    for (const t of s.topWords) lines.push(`  ${t.word.padEnd(ww)}  ${t.count}`);
  }
  return lines.join('\n');
}

export function runTextStats(input: string, ctx: RunContext): ModeResult {
  if (input === '') return { output: '', status: '' };
  const stats = computeStats(input, ctx.options['ignoreStopWords'] !== false);
  return {
    output: formatStats(stats),
    status: `${stats.words} words · ${stats.characters} chars · ${stats.sentences} sentences · ${formatMinutes(stats.readingMinutes)} read`,
    view: { kind: 'stats', data: stats },
  };
}

export const textStatsMode: ToolMode = {
  id: 'text-stats',
  label: 'Text Statistics',
  description: 'Count characters, words, sentences and paragraphs, estimate reading time and list the most frequent words.',
  category: 'Text',
  icon: 'lines',
  keywords: ['count', 'word count', 'reading time', 'frequency', 'characters', 'wc'],
  emptyHint: 'Paste any text to count words, sentences, reading time and the most frequent words.',
  sample:
    'The quick brown fox jumps over the lazy dog. The dog, unimpressed, yawns!\n\nDoes the fox try again? It does. It jumps 3 more times, and the dog finally moves.\n',
  supportsPretty: false,
  controls: [{ kind: 'toggle', key: 'ignoreStopWords', label: 'Ignore stop words', default: true }],
  run: runTextStats,
};
