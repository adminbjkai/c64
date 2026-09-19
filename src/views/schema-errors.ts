/**
 * JSON Schema error table: one row per violation (pointer, keyword,
 * message). The instance lives in editor B, which the view cannot select
 * into, so clicking a row copies its JSON Pointer instead.
 */

import { h } from '../ui.js';
import type { SchemaErrorsData } from '../modes/json-schema.js';
import type { ViewRenderer } from './types.js';

export const renderSchemaErrors: ViewRenderer = (host, raw, ctx) => {
  const d = raw as SchemaErrorsData;
  if (d.valid) {
    host.append(h('div.schema-errors-ok', {}, h('strong', {}, '✓ Valid'), h('span.muted', {}, ' — the instance satisfies every keyword in the schema.')));
    return;
  }
  const body = h('tbody');
  d.errors.forEach((e, i) => {
    const pointer = e.instancePath || '/';
    const tr = h(
      'tr',
      { title: `Click to copy the pointer ${pointer}` },
      h('td.rownum', {}, String(i + 1)),
      h('td.schema-errors-path', {}, h('code', {}, pointer)),
      h('td.schema-errors-kw', {}, h('span.badge.muted', {}, e.keyword)),
      h('td.schema-errors-msg', {}, e.message),
      h('td.schema-errors-schema', {}, h('code.muted', {}, e.schemaPath || '/')),
    );
    tr.addEventListener('click', () => ctx.copy(pointer, 'pointer'));
    body.append(tr);
  });
  host.append(
    h('div.schema-errors-meta', {}, h('span.badge.bad', {}, `${d.errors.length} error${d.errors.length === 1 ? '' : 's'}`), h('span.muted', {}, ' · click a row to copy its instance pointer')),
    h(
      'div.table-wrap',
      {},
      h(
        'table.csv-table.schema-errors-table',
        {},
        h('thead', {}, h('tr', {}, h('th.rownum', {}, '#'), h('th', {}, 'Instance path'), h('th', {}, 'Keyword'), h('th', {}, 'Message'), h('th', {}, 'Schema path'))),
        body,
      ),
    ),
  );
};
