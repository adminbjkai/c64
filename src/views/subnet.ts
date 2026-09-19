/**
 * Subnet renderer: a card per parsed item with a label → value table and
 * copy buttons; IPv4 blocks get a "split into /N" select that re-runs the
 * mode with the `split` option, listing the sub-blocks.
 */

import { h } from '../ui.js';
import type { SubnetData, SubnetItem } from '../modes/ip-subnet.js';
import type { ViewRenderer, ViewContext } from './types.js';

export const renderSubnet: ViewRenderer = (host, raw, ctx) => {
  const d = raw as SubnetData;
  for (const it of d.items) host.append(renderItem(it, ctx));
};

function copyBtn(ctx: ViewContext, value: string, what: string): HTMLElement {
  const b = h('button.btn.small', { type: 'button' }, 'Copy');
  b.addEventListener('click', () => ctx.copy(value, what));
  return b;
}

function renderItem(it: SubnetItem, ctx: ViewContext): HTMLElement {
  if (it.kind === 'range') {
    const body = h('tbody');
    for (const c of it.cidrs) body.append(h('tr', {}, h('td.subnet-value', {}, h('code', {}, c)), h('td.subnet-actions', {}, copyBtn(ctx, c, c))));
    return h(
      'section.subnet-card',
      {},
      h('header.subnet-head', {}, h('code.subnet-input', {}, it.input), h('span.badge', {}, `IPv${it.version} range`), h('span.muted', {}, ` ${it.count} addresses · line ${it.line}`)),
      h('div.table-wrap', {}, h('table.csv-table.subnet-table', {}, body)),
      h('div.subnet-foot', {}, copyBtn(ctx, it.cidrs.join('\n'), 'CIDR list')),
    );
  }
  const body = h('tbody');
  for (const r of it.rows) {
    body.append(h('tr', {}, h('td.subnet-label', {}, r.label), h('td.subnet-value', {}, h('code', {}, r.value)), h('td.subnet-actions', {}, copyBtn(ctx, r.value, r.label))));
  }
  const card = h(
    'section.subnet-card',
    {},
    h('header.subnet-head', {}, h('code.subnet-input', {}, it.cidr), h('span.badge', {}, `IPv${it.version}`), h('span.badge.subnet-type', {}, it.type), h('span.muted', {}, ` line ${it.line}`)),
    h('div.table-wrap', {}, h('table.csv-table.subnet-table', {}, body)),
  );
  if (it.splitChoices.length) {
    const sel = h<HTMLSelectElement>('select.subnet-split-select', { 'aria-label': 'Split into' });
    const base = Number(it.cidr.split('/')[1]);
    sel.append(h('option', { value: 'none' }, 'no split'));
    for (const n of it.splitChoices) sel.append(h('option', { value: `+${n}` }, `/${base + n} (${2 ** n} blocks)`));
    sel.value = it.splitPrefix === null ? 'none' : `+${it.splitPrefix - base}`;
    sel.addEventListener('change', () => ctx.setOption('split', sel.value));
    const bar = h('div.subnet-split', {}, h('span.muted', {}, 'Split into '), sel);
    card.append(bar);
    if (it.splits.length) {
      const sb = h('tbody');
      for (const s of it.splits) {
        sb.append(h('tr', {}, h('td.subnet-value', {}, h('code', {}, s.cidr)), h('td.subnet-value', {}, h('code', {}, `${s.first} – ${s.last}`)), h('td.subnet-actions', {}, copyBtn(ctx, s.cidr, s.cidr))));
      }
      card.append(h('div.table-wrap', {}, h('table.csv-table.subnet-table.subnet-splits', {}, h('thead', {}, h('tr', {}, h('th', {}, 'block'), h('th', {}, 'hosts'), h('th'))), sb)));
    }
  }
  return card;
}
