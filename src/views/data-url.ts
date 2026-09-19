/**
 * Data URL renderer: a card with MIME, size, detected type, image
 * dimensions (read from an <img> built from the data URL — same-document
 * data, allowed by the img-src CSP), an image preview, and Download /
 * Copy data URL buttons.
 */

import { h } from '../ui.js';
import type { DataUrlData } from '../modes/data-url.js';
import type { ViewRenderer } from './types.js';
import { formatBytes } from '../modes/types.js';

export const renderDataUrl: ViewRenderer = (host, raw, ctx) => {
  const d = raw as DataUrlData;
  const body = h('tbody');
  const row = (label: string, value: string | Node, copyValue?: string): void => {
    const actions = h('td.du-actions');
    if (copyValue !== undefined) {
      const b = h('button.btn.small', { type: 'button' }, 'Copy');
      b.addEventListener('click', () => ctx.copy(copyValue, label));
      actions.append(b);
    }
    body.append(h('tr', {}, h('td.du-label', {}, label), h('td.du-value', {}, typeof value === 'string' ? h('code', {}, value) : value), actions));
  };
  row('MIME', d.mediaType, d.mediaType);
  row('size', `${formatBytes(d.size)} (${d.size.toLocaleString('en-US')} bytes)`);
  row('encoding', d.base64 ? 'base64' : 'percent-encoded');
  if (d.detected) {
    row('detected', h('span', {}, h('code', {}, `${d.detected.label} (${d.detected.mime})`), ' ', h(`span.badge.${d.mismatch ? 'warn' : 'ok'}`, {}, d.mismatch ? 'mismatch' : 'matches')));
  }
  const dimsCell = h('code', {}, '…');
  if (d.isImage) row('dimensions', dimsCell);

  const copyUrl = h('button.btn.small', { type: 'button' }, 'Copy data URL');
  copyUrl.addEventListener('click', () => ctx.copy(d.dataUrl, 'data URL'));
  const download = h<HTMLAnchorElement>('a.btn.small.du-download', { href: d.dataUrl, download: d.filename }, 'Download');

  const card = h(
    'section.du-card',
    {},
    h('header.du-head', {}, h('span.badge', {}, d.direction === 'decode' ? 'decoded' : 'encoded'), h('code.du-mime', {}, d.mime), h('span.muted', {}, ` · ${formatBytes(d.size)}`)),
    h('div.table-wrap', {}, h('table.csv-table.du-table', {}, body)),
    h('div.du-actions-bar', {}, download, copyUrl),
  );

  if (d.isImage) {
    const img = h<HTMLImageElement>('img.du-preview', { src: d.dataUrl, alt: d.filename, style: 'max-width:320px;max-height:320px' });
    img.addEventListener('load', () => {
      dimsCell.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    });
    img.addEventListener('error', () => {
      dimsCell.textContent = 'not decodable as an image';
    });
    card.append(h('div.du-preview-wrap', {}, img));
  } else if (d.text !== null) {
    card.append(h('pre.du-text', {}, d.text));
  }
  host.append(card);
};
