/**
 * Data URL renderer: a card with MIME, size, detected type, image
 * dimensions (read from an <img> built from the data URL — same-document
 * data, allowed by the img-src CSP), an image preview, and Download /
 * Copy data URL actions.
 */

import { h } from '../ui.js';
import type { DataUrlData } from '../modes/data-url.js';
import type { ViewRenderer } from './types.js';
import { formatBytes } from '../modes/types.js';
import { viewShell, cardList, kvTable, badge, muted, copyButton, type KvRow } from './ui.js';

export const renderDataUrl: ViewRenderer = (host, raw) => {
  const d = raw as DataUrlData;
  const rows: KvRow[] = [
    { label: 'MIME', value: d.mediaType },
    { label: 'Size', value: `${formatBytes(d.size)} (${d.size.toLocaleString('en-US')} bytes)`, copy: String(d.size) },
    { label: 'Encoding', value: d.base64 ? 'base64' : 'percent-encoded', copy: false },
  ];
  if (d.detected) {
    rows.push({
      label: 'Detected',
      value: `${d.detected.label} (${d.detected.mime})`,
      copy: d.detected.mime,
      note: badge(d.mismatch ? 'warn' : 'ok', d.mismatch ? 'mismatch' : 'matches'),
      tone: d.mismatch ? 'warn' : undefined,
    });
  }
  const dims = h('span', {}, '…');
  if (d.isImage) rows.push({ label: 'Dimensions', value: dims, copy: false });

  const download = h<HTMLAnchorElement>('a.btn.small', { href: d.dataUrl, download: d.filename }, 'Download');
  const parts: (Node | null)[] = [kvTable(rows)];
  if (d.isImage) {
    const img = h<HTMLImageElement>('img.du-preview', { src: d.dataUrl, alt: d.filename });
    img.addEventListener('load', () => {
      dims.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    });
    img.addEventListener('error', () => {
      dims.textContent = 'not decodable as an image';
    });
    parts.push(h('div.du-preview-wrap', {}, img));
  } else if (d.text !== null) {
    parts.push(h('pre.du-text', {}, d.text));
  }

  const { body } = viewShell(host);
  body.append(
    cardList([
      {
        title: h('code', {}, d.mime),
        meta: [badge('neutral', d.direction === 'decode' ? 'decoded' : 'encoded'), muted(formatBytes(d.size))],
        actions: [download, copyButton('Copy data URL', () => d.dataUrl)],
        body: parts,
      },
    ]),
  );
};
