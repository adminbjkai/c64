/**
 * JWT renderer: colour-coded token segments, header + claims tables,
 * validity badge, and the permanent "signature not verified" notice.
 */

import { h } from '../ui.js';
import type { JwtData } from '../modes/jwt.js';
import type { ViewRenderer } from './types.js';

export const renderJwt: ViewRenderer = (host, raw, ctx) => {
  const d = raw as JwtData;

  const notice = h(
    'div.jwt-notice',
    { role: 'note' },
    h('strong', {}, 'Decoded, not verified. '),
    `The signature (${d.alg}) cannot be checked without the issuer's key, which this tool never has or fetches. Treat every claim below as unverified.`,
  );

  const badge = {
    'valid-window': ['ok', 'Within validity window'],
    expired: ['bad', 'Expired'],
    'not-yet-valid': ['warn', 'Not yet valid'],
    'no-exp': ['muted', 'No expiry claim'],
  }[d.status];

  const segs = h(
    'div.jwt-segments',
    {},
    h('span.jwt-h', { title: 'Header' }, d.segments[0]),
    h('span.jwt-dot', {}, '.'),
    h('span.jwt-p', { title: 'Payload' }, d.segments[1]),
    h('span.jwt-dot', {}, '.'),
    h('span.jwt-s', { title: 'Signature (not verified)' }, d.segments[2] || '(empty)'),
  );

  const table = (title: string, cls: string, rows: { name: string; value: unknown; meaning?: string; human?: string; warn?: string }[], copyText: string) => {
    const copy = h('button.btn.small', { type: 'button' }, 'Copy JSON');
    copy.addEventListener('click', () => ctx.copy(copyText, title.toLowerCase()));
    const body = h('tbody');
    for (const r of rows) {
      const val = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
      body.append(
        h(
          'tr',
          { class: r.warn ? 'is-warn' : undefined },
          h('td.jwt-claim', {}, h('code', {}, r.name), r.meaning ? h('span.jwt-meaning', {}, r.meaning) : null),
          h('td.jwt-value', {}, h('code', {}, val), r.human ? h('div.jwt-human', {}, r.human) : null, r.warn ? h('div.jwt-warn', {}, r.warn) : null),
        ),
      );
    }
    return h('section.jwt-section', {}, h('header', {}, h(`h3.${cls}`, {}, title), copy), h('table.jwt-table', {}, body));
  };

  host.append(
    notice,
    h('div.jwt-status', {}, h(`span.badge.${badge[0]}`, {}, badge[1]), h('span.muted', {}, ` · alg ${d.alg}${d.header['typ'] ? ` · typ ${String(d.header['typ'])}` : ''}${d.header['kid'] ? ` · kid ${String(d.header['kid'])}` : ''}`)),
    ...d.warnings.map((w) => h('div.notes', {}, '· ' + w)),
    segs,
    table('Header', 'jwt-h', Object.entries(d.header).map(([name, value]) => ({ name, value })), JSON.stringify(d.header, null, 2)),
    table('Payload (claims)', 'jwt-p', d.claims, JSON.stringify(d.payload, null, 2)),
    h('section.jwt-section', {}, h('header', {}, h('h3.jwt-s', {}, 'Signature')), h('code.jwt-sig', {}, d.signature || '(empty)'), h('p.muted', {}, 'Shown as-is. Verification requires the signing key and is intentionally not performed.')),
  );
};
