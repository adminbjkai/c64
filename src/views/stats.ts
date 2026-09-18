/**
 * Text statistics renderer: a grid of stat tiles, a top-words table with
 * inline bars, and a character-class breakdown.
 */

import { h } from '../ui.js';
import type { TextStats } from '../modes/text-stats.js';
import { formatMinutes } from '../modes/text-stats.js';
import type { ViewRenderer } from './types.js';

const tile = (value: string, label: string) => h('div.stat-tile', {}, h('div.stat-value', {}, value), h('div.stat-label', {}, label));

export const renderStats: ViewRenderer = (host, raw) => {
  const s = raw as TextStats;
  const grid = h(
    'div.stat-grid',
    {},
    tile(String(s.words), 'words'),
    tile(String(s.characters), 'characters'),
    tile(String(s.charactersNoSpaces), 'chars, no spaces'),
    tile(String(s.bytes), 'bytes (UTF-8)'),
    tile(String(s.uniqueWords), 'unique words'),
    tile(String(s.sentences), 'sentences'),
    tile(String(s.paragraphs), 'paragraphs'),
    tile(String(s.lines), 'lines'),
    tile(s.avgWordLength.toFixed(1), 'avg word length'),
    tile(s.avgSentenceLength.toFixed(1), 'avg words / sentence'),
    tile(formatMinutes(s.readingMinutes), 'reading (200 wpm)'),
    tile(formatMinutes(s.speakingMinutes), 'speaking (130 wpm)'),
  );

  const max = s.topWords[0]?.count ?? 1;
  const body = h('tbody');
  s.topWords.forEach((t, i) => {
    body.append(
      h(
        'tr',
        {},
        h('td.rownum', {}, String(i + 1)),
        h('td', {}, h('code', {}, t.word)),
        h('td', {}, String(t.count)),
        h('td.stat-bar-cell', {}, h('span.stat-bar', { style: `width:${Math.round((t.count / max) * 100)}%` })),
      ),
    );
  });
  const top = h('table.csv-table.stat-words', {}, h('thead', {}, h('tr', {}, h('th.rownum', {}, '#'), h('th', {}, 'Word'), h('th', {}, 'Count'), h('th', {}, ''))), body);

  const c = s.classes;
  const total = Math.max(1, s.characters);
  const cls = h('table.csv-table.stat-classes', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Class'), h('th', {}, 'Count'), h('th', {}, '%'))));
  const cbody = h('tbody');
  for (const [k, v] of Object.entries(c)) cbody.append(h('tr', {}, h('td', {}, k), h('td', {}, String(v)), h('td', {}, `${((v / total) * 100).toFixed(1)}%`)));
  cls.append(cbody);

  host.append(
    grid,
    h('h3.stat-heading', {}, 'Top words'),
    s.topWords.length ? h('div.table-wrap', {}, top) : h('p.muted', {}, 'No words.'),
    h('h3.stat-heading', {}, 'Character classes'),
    h('div.table-wrap', {}, cls),
  );
};
