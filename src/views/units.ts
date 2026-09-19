/**
 * Units renderer: one card per input quantity with a category badge and a
 * unit → value table, every row with a copy button.
 */

import { h } from '../ui.js';
import type { UnitsData } from '../modes/unit-convert.js';
import type { ViewRenderer } from './types.js';

export const renderUnits: ViewRenderer = (host, raw, ctx) => {
  const d = raw as UnitsData;
  for (const e of d.entries) {
    const body = h('tbody');
    for (const r of e.rows) {
      const copy = h('button.btn.small', { type: 'button' }, 'Copy');
      copy.addEventListener('click', () => ctx.copy(r.value, r.symbol));
      body.append(
        h(
          `tr${r.self ? '.units-self' : ''}`,
          {},
          h('td.units-unit', {}, h('code', {}, r.symbol), h('span.muted', {}, ` ${r.name}`)),
          h('td.units-value', {}, h('code', {}, r.value)),
          h('td.units-actions', {}, copy),
        ),
      );
    }
    host.append(
      h(
        'section.units-card',
        {},
        h('header.units-head', {}, h('code.units-input', {}, e.input), h('span.badge.units-category', {}, e.category), h('span.muted', {}, ` line ${e.line}`)),
        h('div.table-wrap', {}, h('table.csv-table.units-table', {}, body)),
      ),
    );
  }
};
