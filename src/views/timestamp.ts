/**
 * Timestamp renderer: one card per input line with labelled rows, each
 * copyable.
 */

import { h } from '../ui.js';
import type { TimestampData } from '../modes/timestamp.js';
import type { ViewRenderer } from './types.js';

export const renderTimestamp: ViewRenderer = (host, raw, ctx) => {
  const d = raw as TimestampData;
  for (const c of d.cards) {
    const body = h('tbody');
    for (const r of c.rows) {
      const copy = h('button.btn.small', { type: 'button' }, 'Copy');
      copy.addEventListener('click', () => ctx.copy(r.value, r.label));
      body.append(h('tr', {}, h('td.ts-label', {}, r.label), h('td.ts-value', {}, h('code', {}, r.value)), h('td.ts-actions', {}, copy)));
    }
    host.append(
      h(
        'section.jwt-section.ts-card',
        {},
        h('header', {}, h('h3', {}, h('code', {}, c.input)), h('span.badge.muted', {}, c.kind)),
        h('table.jwt-table.ts-table', {}, body),
      ),
    );
  }
};
