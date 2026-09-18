/**
 * URL renderer: a two-column breakdown of a parsed URL plus a table of its
 * query parameters, each with a copy button.
 */

import { h } from '../ui.js';
import type { UrlData } from '../modes/url.js';
import type { ViewRenderer } from './types.js';

const PARTS: [keyof UrlData, string][] = [
  ['href', 'href'],
  ['origin', 'origin'],
  ['protocol', 'protocol'],
  ['username', 'username'],
  ['password', 'password'],
  ['host', 'host'],
  ['hostname', 'hostname'],
  ['port', 'port'],
  ['pathname', 'pathname'],
  ['search', 'search'],
  ['hash', 'hash'],
];

export const renderUrl: ViewRenderer = (host, raw, ctx) => {
  const d = raw as UrlData;

  const parts = h('tbody');
  for (const [key, label] of PARTS) {
    const value = d[key];
    if (typeof value !== 'string') continue;
    const copy = h('button.btn.small', { type: 'button', disabled: value === '' }, 'Copy');
    copy.addEventListener('click', () => ctx.copy(value, label));
    parts.append(
      h(
        'tr',
        {},
        h('td.url-key', {}, h('code', {}, label)),
        h('td.url-value', {}, value === '' ? h('span.muted', {}, '(none)') : h('code', {}, value)),
        h('td.url-actions', {}, copy),
      ),
    );
  }
  host.append(
    h('section.url-section', {}, h('header', {}, h('h3', {}, 'URL parts')), h('div.table-wrap', {}, h('table.url-table', {}, parts))),
  );

  const paramsSection = h('section.url-section', {}, h('header', {}, h('h3', {}, 'Query parameters'), h('span.badge.muted', {}, `${d.params.length}`)));
  if (d.params.length === 0) {
    paramsSection.append(h('p.muted', {}, 'No query parameters.'));
  } else {
    const body = h('tbody');
    d.params.forEach(([name, value], i) => {
      const copy = h('button.btn.small', { type: 'button' }, 'Copy');
      copy.addEventListener('click', () => ctx.copy(value, name));
      body.append(
        h(
          'tr',
          {},
          h('td.rownum', {}, String(i + 1)),
          h('td.url-key', {}, h('code', {}, name)),
          h('td.url-value', {}, value === '' ? h('span.muted', {}, '(empty)') : h('code', {}, value)),
          h('td.url-actions', {}, copy),
        ),
      );
    });
    paramsSection.append(
      h('div.table-wrap', {}, h('table.url-params', {}, h('thead', {}, h('tr', {}, h('th.rownum', {}, '#'), h('th', {}, 'Name'), h('th', {}, 'Value'), h('th', {}, ''))), body)),
    );
  }
  host.append(paramsSection);
};
