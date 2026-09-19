/**
 * Regex renderer: the input with every match wrapped in <mark class="rx-m">,
 * then a table of matches with index, full match and each capture group
 * (numbered and named), every value copyable. Built from text nodes only.
 */

import { h } from '../ui.js';
import type { RegexData } from '../modes/regex.js';
import type { ViewRenderer } from './types.js';
import { viewShell, dataTable, emptyState, badge, plural, type Column, type Row } from './ui.js';

export const renderRegex: ViewRenderer = (host, raw, ctx) => {
  const d = raw as RegexData;

  const pre = h('pre.rx-text');
  let pos = 0;
  d.matches.forEach((m, i) => {
    if (m.index > pos) pre.append(document.createTextNode(d.input.slice(pos, m.index)));
    const mark = h('mark.rx-m', { title: `Match ${i + 1} at ${m.index}`, 'data-index': String(i) }, m.match === '' ? '​' : m.match);
    mark.addEventListener('click', () => ctx.selectInEditor(m.index, m.end));
    pre.append(mark);
    pos = Math.max(pos, m.end);
  });
  if (pos < d.input.length) pre.append(document.createTextNode(d.input.slice(pos)));

  const columns: Column[] = [
    { key: 'index', label: 'Index', mono: true, numeric: true },
    { key: 'match', label: 'Match', mono: true, wrap: true },
  ];
  for (let g = 1; g <= d.groupCount; g++) columns.push({ key: `g${g}`, label: `$${g}`, mono: true, wrap: true });
  for (const n of d.groupNames) columns.push({ key: `n:${n}`, label: `<${n}>`, mono: true, wrap: true });
  const cell = (text: string | undefined) => (text === undefined ? undefined : text === '' ? { text: h('span.v-muted', {}, 'empty'), copy: '' } : text);
  const rows: Row[] = d.matches.map((m) => {
    const row: Row = { index: { text: `${m.index}–${m.end}`, copy: false }, match: cell(m.match) };
    for (let g = 0; g < d.groupCount; g++) row[`g${g + 1}`] = cell(m.groups[g]);
    for (const n of d.groupNames) row[`n:${n}`] = cell(m.named[n]);
    return row;
  });

  const { body } = viewShell(host, {
    status: [h('code', {}, `/${d.pattern}/${d.flags}`), badge(d.matches.length ? 'ok' : 'neutral', plural(d.matches.length, 'match', 'matches')), d.capped ? badge('warn', 'capped') : null],
    flush: true,
    column: true,
  });
  body.append(pre, d.matches.length ? dataTable(columns, rows, { rowNum: true }) : emptyState('No matches. Adjust the pattern or flags.'));
};
