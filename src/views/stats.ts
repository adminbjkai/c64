/**
 * Text statistics renderer: a grid of compact stat cards, a top-words table
 * with inline bars, and a character-class breakdown.
 */

import { h } from '../ui.js';
import type { TextStats } from '../modes/text-stats.js';
import { formatMinutes } from '../modes/text-stats.js';
import type { ViewRenderer } from './types.js';
import { viewShell, section, cardList, dataTable, emptyState, type Card } from './ui.js';

const stat = (value: string, label: string): Card => ({ body: h('div.v-stat', {}, h('div.v-stat-n', {}, value), h('div.v-stat-l', {}, label)) });
const n = (v: number) => v.toLocaleString('en-US');

export const renderStats: ViewRenderer = (host, raw) => {
  const s = raw as TextStats;
  const grid = cardList(
    [
      stat(n(s.words), 'words'),
      stat(n(s.characters), 'characters'),
      stat(n(s.charactersNoSpaces), 'characters, no spaces'),
      stat(n(s.bytes), 'bytes (UTF-8)'),
      stat(n(s.uniqueWords), 'unique words'),
      stat(n(s.sentences), 'sentences'),
      stat(n(s.paragraphs), 'paragraphs'),
      stat(n(s.lines), 'lines'),
      stat(s.avgWordLength.toFixed(1), 'average word length'),
      stat(s.avgSentenceLength.toFixed(1), 'words per sentence'),
      stat(formatMinutes(s.readingMinutes), 'reading at 200 wpm'),
      stat(formatMinutes(s.speakingMinutes), 'speaking at 130 wpm'),
    ],
    { compact: true },
  );

  const max = s.topWords[0]?.count ?? 1;
  const top = dataTable(
    [
      { key: 'word', label: 'Word', mono: true },
      { key: 'count', label: 'Count', numeric: true },
      { key: 'bar', label: '', cls: 'stat-bar-cell' },
    ],
    s.topWords.map((t) => ({ word: t.word, count: { text: n(t.count), copy: false }, bar: h('span.stat-bar', { style: `width:${Math.round((t.count / max) * 100)}%` }) })),
    { rowNum: true },
  );

  const total = Math.max(1, s.characters);
  const classes = dataTable(
    [
      { key: 'cls', label: 'Class' },
      { key: 'count', label: 'Count', numeric: true },
      { key: 'share', label: 'Share', numeric: true },
    ],
    Object.entries(s.classes).map(([k, v]) => ({ cls: { text: k, copy: false }, count: { text: n(v), copy: false }, share: { text: `${((v / total) * 100).toFixed(1)}%`, copy: false } })),
  );

  const { body } = viewShell(host);
  body.append(grid, section('Top words', {}, s.topWords.length ? top : emptyState('No words yet.')), section('Character classes', {}, classes));
};
