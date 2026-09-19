/**
 * JWT renderer: validity badges in the bar, colour-coded token segments,
 * then header, claims and signature sections. The "decoded, not verified"
 * notice is permanent.
 */

import { h } from '../ui.js';
import type { JwtData } from '../modes/jwt.js';
import type { ViewRenderer } from './types.js';
import { viewShell, section, kvTable, badge, note, copyButton, type KvRow, type Tone } from './ui.js';

export const renderJwt: ViewRenderer = (host, raw) => {
  const d = raw as JwtData;
  const status: Record<JwtData['status'], [Tone, string]> = {
    'valid-window': ['ok', 'Within validity window'],
    expired: ['danger', 'Expired'],
    'not-yet-valid': ['warn', 'Not yet valid'],
    'no-exp': ['neutral', 'No expiry claim'],
  };
  const [tone, text] = status[d.status];
  const typ = d.header['typ'];
  const kid = d.header['kid'];

  const { body } = viewShell(host, {
    status: [badge(tone, text), badge('neutral', `alg ${d.alg}`), typ ? badge('neutral', `typ ${String(typ)}`) : null, kid ? badge('neutral', `kid ${String(kid)}`) : null],
  });

  const stringify = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const headerRows: KvRow[] = Object.entries(d.header).map(([name, value]) => ({ label: h('code', {}, name), value: stringify(value) }));
  const claimRows: KvRow[] = d.claims.map((r) => ({
    label: h('span', {}, h('code', {}, r.name), r.meaning ? h('span.jwt-meaning', {}, r.meaning) : null),
    value: stringify(r.value),
    note: r.warn || r.human ? h('span', {}, r.human ? h('span', {}, r.human) : null, r.warn ? h('span.jwt-warn', {}, r.warn) : null) : undefined,
    tone: r.warn ? 'warn' : undefined,
  }));

  body.append(
    note('warn', h('strong', {}, 'Decoded, not verified. '), `The signature (${d.alg}) cannot be checked without the issuer's key, which this tool never has or fetches. Treat every claim below as unverified.`),
    ...d.warnings.map((w) => note('warn', w)),
    h(
      'div.jwt-segments',
      {},
      h('span.jwt-h', { title: 'Header' }, d.segments[0]),
      h('span.jwt-dot', {}, '.'),
      h('span.jwt-p', { title: 'Payload' }, d.segments[1]),
      h('span.jwt-dot', {}, '.'),
      h('span.jwt-s', { title: 'Signature (not verified)' }, d.segments[2] || '(empty)'),
    ),
    section(h('span.jwt-h', {}, 'Header'), { actions: [copyButton('Copy JSON', () => JSON.stringify(d.header, null, 2))] }, kvTable(headerRows)),
    section(h('span.jwt-p', {}, 'Claims'), { actions: [copyButton('Copy JSON', () => JSON.stringify(d.payload, null, 2))] }, kvTable(claimRows)),
    section(
      h('span.jwt-s', {}, 'Signature'),
      { meta: 'shown as-is, never verified' },
      kvTable([{ label: 'signature', value: d.signature || 'empty', copy: d.signature ? d.signature : false }]),
    ),
  );
};
