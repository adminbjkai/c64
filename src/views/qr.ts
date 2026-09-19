/**
 * QR renderer: the code drawn as an inline <svg> built with createElementNS,
 * Download SVG / PNG and Copy SVG in the bar, details and the copyable
 * payload underneath.
 */

import { h } from '../ui.js';
import type { QrData } from '../modes/qr-code.js';
import type { ViewRenderer } from './types.js';
import { viewShell, section, kvTable, copyable, copyButton, plural } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildSvg(d: QrData): SVGSVGElement {
  const margin = 4;
  const dim = d.size + margin * 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`);
  svg.setAttribute('width', String(d.px));
  svg.setAttribute('height', String(d.px));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(dim));
  bg.setAttribute('height', String(dim));
  bg.setAttribute('fill', d.light);
  svg.append(bg);
  const path = document.createElementNS(SVG_NS, 'path');
  let dAttr = '';
  for (let y = 0; y < d.size; y++) {
    const row = d.modules[y] as boolean[];
    for (let x = 0; x < d.size; x++) if (row[x]) dAttr += `M${x + margin} ${y + margin}h1v1h-1z`;
  }
  path.setAttribute('d', dAttr);
  path.setAttribute('fill', d.dark);
  svg.append(path);
  return svg;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h<HTMLAnchorElement>('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const renderQr: ViewRenderer = (host, raw, ctx) => {
  const d = raw as QrData;

  const dlSvg = h('button.btn.small', { type: 'button' }, 'Download SVG');
  dlSvg.addEventListener('click', () => download(new Blob([d.svg], { type: 'image/svg+xml' }), 'qr-code.svg'));

  const dlPng = h('button.btn.small', { type: 'button' }, 'Download PNG');
  dlPng.addEventListener('click', () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = d.px;
      canvas.height = d.px;
      const g = canvas.getContext('2d');
      if (!g) {
        ctx.toast('Canvas is not available');
        return;
      }
      g.drawImage(img, 0, 0, d.px, d.px);
      canvas.toBlob((blob) => {
        if (blob) download(blob, 'qr-code.png');
        else ctx.toast('PNG export failed');
      }, 'image/png');
    };
    img.onerror = () => ctx.toast('PNG export failed');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(d.svg);
  });

  const { body } = viewShell(host, { actions: [dlSvg, dlPng, copyButton('Copy SVG', () => d.svg)] });
  body.append(
    h('div.qr-figure', {}, buildSvg(d)),
    section(
      'Details',
      {},
      kvTable([
        { label: 'Version', value: String(d.version), copy: false },
        { label: 'Size', value: `${d.size} × ${d.size} modules`, copy: false },
        { label: 'Error correction', value: d.ecc, copy: false },
        { label: 'Mask', value: String(d.mask), copy: false },
        { label: 'Mode', value: d.mode, copy: false },
        { label: 'Encoded', value: plural(d.bytes, 'byte'), copy: false },
      ]),
    ),
    section('Payload', {}, h('div.qr-payload', {}, copyable(d.payload, { label: 'payload' }))),
  );
};
