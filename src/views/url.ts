/**
 * URL renderer: the parsed parts as a label/value grid, then the query
 * parameters as a table. Every value is copyable.
 */

import type { UrlData } from '../modes/url.js';
import type { ViewRenderer } from './types.js';
import { viewShell, section, kvTable, dataTable, emptyState, muted, type KvRow, type Row } from './ui.js';

const PARTS: (keyof UrlData)[] = ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];

export const renderUrl: ViewRenderer = (host, raw) => {
  const d = raw as UrlData;
  const parts: KvRow[] = [];
  for (const key of PARTS) {
    const value = d[key];
    if (typeof value !== 'string') continue;
    parts.push(value === '' ? { label: key, value: muted('none'), copy: false } : { label: key, value });
  }
  const { body } = viewShell(host);
  body.append(section('Parts', {}, kvTable(parts)));

  const rows: Row[] = d.params.map(([name, value]) => ({ name, value: value === '' ? { text: muted('empty'), copy: false } : value }));
  body.append(
    section(
      'Query parameters',
      { meta: String(d.params.length) },
      rows.length
        ? dataTable(
            [
              { key: 'name', label: 'Name', mono: true },
              { key: 'value', label: 'Value', mono: true, wrap: true },
            ],
            rows,
            { rowNum: true },
          )
        : emptyState('No query parameters in this URL.'),
    ),
  );
};
