/**
 * Regex renderer: the input with every match wrapped in <mark class="rx-m">,
 * then a table of matches with index, full match and each capture group
 * (numbered and named) with copy buttons. Built from text nodes only.
 */

import { h } from '../ui.js';
import type { RegexData } from '../modes/regex.js';
import type { ViewRenderer } from './types.js';

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

  const copyBtn = (text: string, what: string) => {
    const b = h('button.btn.small.rx-copy', { type: 'button', title: `Copy ${what}` }, 'Copy');
    b.addEventListener('click', () => ctx.copy(text, what));
    return b;
  };
  const cell = (text: string | undefined, what: string) =>
    text === undefined ? h('td.missing.muted', {}, '—') : h('td', {}, h('code', {}, text === '' ? '(empty)' : text), copyBtn(text, what));

  const table = h('table.csv-table.rx-table');
  const head = h('tr', {}, h('th.rownum', {}, '#'), h('th', {}, 'Index'), h('th', {}, 'Match'));
  for (let g = 1; g <= d.groupCount; g++) head.append(h('th', {}, `$${g}`));
  for (const n of d.groupNames) head.append(h('th', {}, `<${n}>`));
  table.append(h('thead', {}, head));
  const body = h('tbody');
  d.matches.forEach((m, i) => {
    const tr = h('tr', {}, h('td.rownum', {}, String(i + 1)), h('td', {}, `${m.index}–${m.end}`), cell(m.match, `match ${i + 1}`));
    for (let g = 0; g < d.groupCount; g++) tr.append(cell(m.groups[g], `group ${g + 1}`));
    for (const n of d.groupNames) tr.append(cell(m.named[n], `group ${n}`));
    body.append(tr);
  });
  table.append(body);

  host.append(
    h('div.rx-head', {}, h('code', {}, `/${d.pattern}/${d.flags}`), h('span.muted', {}, ` · ${d.matches.length} match${d.matches.length === 1 ? '' : 'es'}${d.capped ? ' (capped)' : ''}`)),
    pre,
    d.matches.length ? h('div.table-wrap', {}, table) : h('p.muted', {}, 'No matches.'),
  );
};
