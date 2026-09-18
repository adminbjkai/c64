/**
 * Table renderer for CSV previews. Rows beyond the mode's cap are not sent
 * here at all (the mode reports the total), which keeps huge files snappy.
 */

import { h } from '../ui.js';
import type { TableData } from '../modes/csv.js';
import type { ViewRenderer } from './types.js';

export const renderTable: ViewRenderer = (host, raw) => {
  const d = raw as TableData;
  const table = h('table.csv-table');
  const cols = d.header?.length ?? d.rows[0]?.length ?? 0;
  if (d.header) {
    table.append(h('thead', {}, h('tr', {}, h('th.rownum', {}, '#'), ...d.header.map((c) => h('th', {}, c)))));
  }
  const body = h('tbody');
  d.rows.forEach((r, i) => {
    const tr = h('tr', {}, h('td.rownum', {}, String(i + 1)));
    for (let c = 0; c < Math.max(cols, r.length); c++) tr.append(h('td', { class: r[c] === undefined ? 'missing' : undefined }, r[c] ?? ''));
    body.append(tr);
  });
  table.append(body);
  const wrap = h('div.table-wrap', {}, table);
  host.append(wrap);
  if (d.total > d.rows.length) host.append(h('div.path-count', {}, `Showing the first ${d.rows.length} of ${d.total} rows. Raw / Copy still include everything.`));
};
