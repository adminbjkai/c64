/**
 * Base-N renderer: one row per input number, columns dec / hex / oct / bin
 * (+ base-36), each cell copyable. Bases other than the chosen target are
 * dimmed.
 */

import { h } from '../ui.js';
import type { BaseNData, BaseNRow } from '../modes/base-n.js';
import type { ViewRenderer } from './types.js';
import { viewShell, dataTable, muted, type Column, type Row } from './ui.js';

const COLS: { key: keyof BaseNRow; label: string; radix: string }[] = [
  { key: 'dec', label: 'Decimal', radix: '10' },
  { key: 'hex', label: 'Hex', radix: '16' },
  { key: 'oct', label: 'Octal', radix: '8' },
  { key: 'bin', label: 'Binary', radix: '2' },
  { key: 'base36', label: 'Base-36', radix: '36' },
];

export const renderBaseN: ViewRenderer = (host, raw) => {
  const d = raw as BaseNData;
  const columns: Column[] = [{ key: 'input', label: 'Input', mono: true }];
  for (const c of COLS) columns.push({ key: c.key, label: c.label, mono: true, cls: 'is-full' + (d.to !== 'all' && String(d.to) !== c.radix ? ' basen-dim' : '') });
  const rows: Row[] = d.rows.map((r) => {
    const row: Row = { input: h('span', {}, h('code', {}, r.input), ' ', muted(`base ${r.detected}`)) };
    for (const c of COLS) row[c.key] = String(r[c.key]);
    return row;
  });
  const { body } = viewShell(host, { flush: true });
  body.append(dataTable(columns, rows));
};
