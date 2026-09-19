/**
 * Hash renderer: a bar with what was hashed, then one row per algorithm
 * with its (copyable) digest.
 */

import { h } from '../ui.js';
import type { HashData } from '../modes/hash.js';
import type { ViewRenderer } from './types.js';
import { viewShell, dataTable, badge, muted, plural, type Row } from './ui.js';

const LABEL: Record<string, string> = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512', crc32: 'CRC32' };

export const renderHash: ViewRenderer = (host, raw) => {
  const d = raw as HashData;
  const rows: Row[] = d.rows.map((r) => {
    const na = r.digest === 'n/a';
    const name = (d.hmac && !na ? 'HMAC-' : '') + (LABEL[r.algorithm] ?? r.algorithm);
    return {
      algo: h('span', {}, h('strong', {}, name), muted(` ${r.bits}-bit`)),
      digest: na ? h('span.v-muted', {}, r.note ?? 'not available') : r.digest,
    };
  });
  // The pane head already states bytes and encoding; only flag HMAC here.
  const { body } = viewShell(host, { status: d.hmac ? [badge('info', 'HMAC')] : undefined, flush: true });
  body.append(
    dataTable(
      [
        { key: 'algo', label: 'Algorithm' },
        { key: 'digest', label: 'Digest', mono: true, wrap: true },
      ],
      rows,
      { rowClass: (_r, i) => (d.rows[i]!.digest === 'n/a' ? 'is-na' : undefined) },
    ),
  );
};
