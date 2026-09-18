/**
 * Base-N renderer: one row per input number, columns dec / hex / oct / bin
 * (+ base-36), each cell copyable.
 */

import { h } from '../ui.js';
import type { BaseNData, BaseNRow } from '../modes/base-n.js';
import type { ViewRenderer } from './types.js';

const COLS: { key: keyof BaseNRow; label: string }[] = [
  { key: 'dec', label: 'Decimal' },
  { key: 'hex', label: 'Hex' },
  { key: 'oct', label: 'Octal' },
  { key: 'bin', label: 'Binary' },
  { key: 'base36', label: 'Base-36' },
];

const RADIX_OF: Partial<Record<keyof BaseNRow, string>> = { dec: '10', hex: '16', oct: '8', bin: '2', base36: '36' };

export const renderBaseN: ViewRenderer = (host, raw, ctx) => {
  const d = raw as BaseNData;
  const body = h('tbody');
  for (const r of d.rows) {
    const tr = h('tr', {}, h('td.rownum', {}, h('code', {}, r.input), h('span.muted', {}, ` b${r.detected}`)));
    for (const c of COLS) {
      const value = String(r[c.key]);
      const copy = h('button.btn.small', { type: 'button', title: `Copy ${c.label}` }, 'Copy');
      copy.addEventListener('click', () => ctx.copy(value, c.label.toLowerCase()));
      const dim = d.to !== 'all' && String(d.to) !== RADIX_OF[c.key];
      tr.append(h(dim ? 'td.basen-cell.basen-dim' : 'td.basen-cell', {}, h('code', {}, value), copy));
    }
    body.append(tr);
  }
  host.append(
    h('div.table-wrap', {}, h('table.csv-table.basen-table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Input'), ...COLS.map((c) => h('th', {}, c.label)))), body)),
  );
};
