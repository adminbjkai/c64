/**
 * Table renderer for CSV previews. Rows beyond the mode's cap are not sent
 * here at all (the mode reports the total), which keeps huge files snappy.
 */

import type { TableData } from '../modes/csv.js';
import type { ViewRenderer } from './types.js';
import { viewShell, dataTable, muted, type Column, type Row } from './ui.js';

export const renderTable: ViewRenderer = (host, raw) => {
  const d = raw as TableData;
  const n = Math.max(d.header?.length ?? 0, ...d.rows.map((r) => r.length), 0);
  const columns: Column[] = [];
  for (let c = 0; c < n; c++) columns.push({ key: String(c), label: d.header?.[c] ?? '', mono: true });
  const rows: Row[] = d.rows.map((r) => {
    const row: Row = {};
    for (let c = 0; c < n; c++) row[String(c)] = r[c];
    return row;
  });
  const { body } = viewShell(host, { flush: true });
  body.append(dataTable(columns, rows, { rowNum: true, header: !!d.header }));
  if (d.total > d.rows.length) {
    const foot = muted(`Showing the first ${d.rows.length.toLocaleString('en-US')} of ${d.total.toLocaleString('en-US')} rows. Raw and Copy still include everything.`);
    foot.classList.add('v-foot');
    body.append(foot);
  }
};
