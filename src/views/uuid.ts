/**
 * UUID / ULID renderer: one card per decoded id with a validity badge,
 * field rows and copy buttons.
 */

import { h } from '../ui.js';
import type { UuidData } from '../modes/uuid.js';
import type { ViewRenderer } from './types.js';

export const renderUuid: ViewRenderer = (host, raw, ctx) => {
  const d = raw as UuidData;
  for (const i of d.ids) {
    const copy = h('button.btn.small', { type: 'button' }, 'Copy');
    copy.addEventListener('click', () => ctx.copy(i.id, i.kind.toUpperCase()));
    const body = h('tbody');
    for (const f of i.fields) body.append(h('tr', {}, h('td.uuid-label', {}, f.label), h('td.uuid-value', {}, h('code', {}, f.value))));
    const badge = i.valid ? (i.warnings.length ? ['warn', 'Valid with warnings'] : ['ok', 'Valid']) : ['bad', 'Invalid'];
    host.append(
      h(
        'section.jwt-section.uuid-card',
        {},
        h('header', {}, h('h3', {}, h('code.uuid-id', {}, i.id)), h('div.uuid-actions', {}, h(`span.badge.${badge[0]}`, {}, badge[1]), h('span.badge.muted', {}, i.kind.toUpperCase() + (i.version !== undefined ? ` v${i.version}` : '')), copy)),
        i.timestamp ? h('p.uuid-time', {}, h('span.muted', {}, 'Embedded time: '), h('code', {}, i.timestamp)) : null,
        body.childElementCount ? h('table.jwt-table.uuid-table', {}, body) : null,
        ...i.warnings.map((w) => h('div.notes', {}, '· ' + w)),
      ),
    );
  }
};
