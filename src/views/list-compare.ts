/**
 * List Compare renderer: four count badges in the bar and one table per
 * set — three (Only in A / In both / Only in B) for "All sets", a single
 * one otherwise. Each section's action copies that set.
 */

import { h } from '../ui.js';
import type { ListCompareData, ListShow } from '../modes/list-compare.js';
import type { ViewRenderer } from './types.js';
import { viewShell, section, dataTable, emptyState, badge, copyButton, plural } from './ui.js';

const COLUMNS: Record<Exclude<ListShow, 'all'>, { key: keyof ListCompareData; title: string; cls: string }> = {
  onlyA: { key: 'onlyA', title: 'Only in A', cls: 'lc-only-a' },
  intersection: { key: 'common', title: 'In both', cls: 'lc-common' },
  onlyB: { key: 'onlyB', title: 'Only in B', cls: 'lc-only-b' },
  union: { key: 'union', title: 'Union', cls: 'lc-union' },
  symmetric: { key: 'symmetric', title: 'Symmetric difference', cls: 'lc-symmetric' },
};

export const renderListCompare: ViewRenderer = (host, raw) => {
  const d = raw as ListCompareData;
  const { body } = viewShell(host, {
    status: [badge('neutral', `${d.countA.toLocaleString('en-US')} in A`), badge('neutral', `${d.countB.toLocaleString('en-US')} in B`), badge('ok', `${d.common.length.toLocaleString('en-US')} in both`), badge('warn', `${(d.onlyA.length + d.onlyB.length).toLocaleString('en-US')} different`)],
  });
  const shows: Exclude<ListShow, 'all'>[] = d.show === 'all' ? ['onlyA', 'intersection', 'onlyB'] : [d.show];
  const columns = h('div.lc-columns');
  for (const s of shows) {
    const col = COLUMNS[s];
    const items = d[col.key] as string[];
    const sec = section(
      col.title,
      { meta: plural(items.length, 'item'), actions: [copyButton('Copy list', () => items.join('\n'))] },
      items.length ? dataTable([{ key: 'item', label: 'Item', mono: true, wrap: true }], items.map((it) => ({ item: it })), { rowNum: true, header: false }) : emptyState('Nothing in this set.'),
    );
    sec.classList.add(col.cls);
    columns.append(sec);
  }
  body.append(columns);
};
