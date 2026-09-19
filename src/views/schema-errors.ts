/**
 * JSON Schema error table: one row per violation (pointer, keyword,
 * message). The instance lives in editor B, which the view cannot select
 * into, so clicking a row copies its JSON Pointer instead.
 */

import type { SchemaErrorsData } from '../modes/json-schema.js';
import type { ViewRenderer } from './types.js';
import { viewShell, dataTable, emptyState, badge, muted, copyInline, plural } from './ui.js';

export const renderSchemaErrors: ViewRenderer = (host, raw) => {
  const d = raw as SchemaErrorsData;
  const { body } = viewShell(host, d.valid ? {} : { status: [badge('danger', plural(d.errors.length, 'error')), muted('Click a row to copy its instance pointer')], flush: true });
  if (d.valid) {
    body.append(emptyState('Valid. Every keyword in the schema is satisfied.'));
    return;
  }
  body.append(
    dataTable(
      [
        { key: 'path', label: 'Instance path', mono: true },
        { key: 'keyword', label: 'Keyword' },
        { key: 'message', label: 'Message', wrap: true },
        { key: 'schema', label: 'Schema path', mono: true, cls: 'v-muted' },
      ],
      d.errors.map((e) => ({ path: e.instancePath || '/', keyword: badge('neutral', e.keyword), message: { text: e.message, copy: false }, schema: e.schemaPath || '/' })),
      {
        rowNum: true,
        onRow: (row, _i, tr) => {
          const btn = tr.querySelector<HTMLElement>('.v-copy');
          if (btn) copyInline(btn, String((row['path'] as string) ?? ''));
        },
      },
    ),
  );
};
