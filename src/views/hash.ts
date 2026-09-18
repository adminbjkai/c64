/**
 * Hash renderer: one row per algorithm with the digest and a copy button.
 */

import { h } from '../ui.js';
import type { HashData } from '../modes/hash.js';
import type { ViewRenderer } from './types.js';

const LABEL: Record<string, string> = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512', crc32: 'CRC32' };

export const renderHash: ViewRenderer = (host, raw, ctx) => {
  const d = raw as HashData;
  const body = h('tbody');
  for (const r of d.rows) {
    const name = (d.hmac && r.digest !== 'n/a' ? 'HMAC-' : '') + (LABEL[r.algorithm] ?? r.algorithm);
    const copy = h('button.btn.small', { type: 'button', disabled: r.digest === 'n/a' }, 'Copy');
    copy.addEventListener('click', () => ctx.copy(r.digest, name));
    body.append(
      h(
        'tr',
        { class: r.digest === 'n/a' ? 'is-na' : undefined },
        h('td.hash-algo', {}, h('strong', {}, name), h('span.muted', {}, ` ${r.bits}-bit`)),
        h('td.hash-digest', {}, r.digest === 'n/a' ? h('span.muted', {}, r.note ?? 'n/a') : h('code', {}, r.digest)),
        h('td.hash-actions', {}, copy),
      ),
    );
  }
  host.append(
    h('div.hash-meta', {}, h('span.badge.muted', {}, `${d.bytes} byte${d.bytes === 1 ? '' : 's'} hashed`), h('span.muted', {}, ` · ${d.encoding}${d.hmac ? ' · HMAC' : ''}`)),
    h('div.table-wrap', {}, h('table.csv-table.hash-table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Algorithm'), h('th', {}, 'Digest'), h('th', {}, ''))), body)),
  );
};
