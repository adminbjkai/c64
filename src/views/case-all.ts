/**
 * Case renderer: every case variant of the first line in one table, each
 * row with a copy button.
 */

import { h } from '../ui.js';
import type { CaseAllData } from '../modes/case.js';
import type { ViewRenderer } from './types.js';

export const renderCaseAll: ViewRenderer = (host, raw, ctx) => {
  const d = raw as CaseAllData;
  const body = h('tbody');
  for (const v of d.variants) {
    const copy = h('button.btn.small', { type: 'button' }, 'Copy');
    copy.addEventListener('click', () => ctx.copy(v.value, v.name));
    body.append(h('tr', {}, h('td.case-name', {}, v.name), h('td.case-value', {}, h('code', {}, v.value)), h('td.case-actions', {}, copy)));
  }
  host.append(
    h('section.case-section', {}, h('header', {}, h('h3', {}, 'All variants'), h('span.muted', {}, ' of '), h('code', {}, d.source)), h('div.table-wrap', {}, h('table.case-table', {}, body))),
  );
};
