/**
 * List Compare renderer: four stat tiles (A, B, in both, different) and one
 * column per set — three columns (Only in A / In both / Only in B) for
 * "All sets", a single column otherwise. Clicking a column header copies
 * that set.
 */

import { h } from '../ui.js';
import type { ListCompareData, ListShow } from '../modes/list-compare.js';
import type { ViewRenderer } from './types.js';

const tile = (value: string, label: string) => h('div.stat-tile', {}, h('div.stat-value', {}, value), h('div.stat-label', {}, label));

const COLUMNS: Record<Exclude<ListShow, 'all'>, { key: keyof ListCompareData; title: string; cls: string }> = {
  onlyA: { key: 'onlyA', title: 'Only in A', cls: 'lc-only-a' },
  intersection: { key: 'common', title: 'In both', cls: 'lc-common' },
  onlyB: { key: 'onlyB', title: 'Only in B', cls: 'lc-only-b' },
  union: { key: 'union', title: 'Union', cls: 'lc-union' },
  symmetric: { key: 'symmetric', title: 'Symmetric difference', cls: 'lc-symmetric' },
};

export const renderListCompare: ViewRenderer = (host, raw, ctx) => {
  const d = raw as ListCompareData;
  const grid = h(
    'div.stat-grid.lc-stats',
    {},
    tile(String(d.countA), 'in A'),
    tile(String(d.countB), 'in B'),
    tile(String(d.common.length), 'in both'),
    tile(String(d.onlyA.length + d.onlyB.length), 'different'),
  );
  const shows: Exclude<ListShow, 'all'>[] = d.show === 'all' ? ['onlyA', 'intersection', 'onlyB'] : [d.show];
  const columns = h('div.lc-columns');
  for (const s of shows) {
    const col = COLUMNS[s];
    const items = d[col.key] as string[];
    const table = h(`table.csv-table.lc-table.${col.cls}`);
    const head = h('th', { title: 'Click to copy this list' }, `${col.title} (${items.length})`);
    head.addEventListener('click', () => ctx.copy(items.join('\n'), col.title));
    table.append(h('thead', {}, h('tr', {}, h('th.rownum', {}, '#'), head)));
    const body = h('tbody');
    items.forEach((it, i) => body.append(h('tr', {}, h('td.rownum', {}, String(i + 1)), h('td.lc-item', {}, it))));
    if (items.length === 0) body.append(h('tr', {}, h('td.lc-empty.muted', { colspan: '2' }, 'none')));
    table.append(body);
    columns.append(h('div.lc-column.table-wrap', {}, table));
  }
  host.append(h('div.lc-wrap', {}, grid, columns));
};
