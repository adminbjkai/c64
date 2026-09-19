/**
 * TOTP renderer: big current code (click to copy), a countdown bar that
 * ticks every second and asks the pane to re-run the mode when the period
 * rolls over, muted previous/next codes, and the otpauth URL.
 */

import { h } from '../ui.js';
import type { TotpData } from '../modes/totp.js';
import type { ViewRenderer } from './types.js';

export function groupCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

export const renderTotp: ViewRenderer = (host, raw, ctx) => {
  const d = raw as TotpData;
  const code = h('button.totp-code', { type: 'button', title: 'Copy code' }, groupCode(d.code));
  code.addEventListener('click', () => ctx.copy(d.code, 'code'));

  const remainingEl = h('span.totp-remaining', {}, `${d.remaining}s`);
  const fill = h('div.totp-ring-fill');
  const ring = h('div.totp-ring', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': d.period, 'aria-valuenow': d.remaining }, fill);
  const setProgress = (remaining: number) => {
    fill.style.width = `${Math.max(0, Math.min(100, (remaining / d.period) * 100))}%`;
    ring.classList.toggle('is-low', remaining <= 5);
    ring.setAttribute('aria-valuenow', String(remaining));
    remainingEl.textContent = `${remaining}s`;
  };
  setProgress(d.remaining);

  const copyUrl = h('button.btn.small', { type: 'button' }, 'Copy');
  copyUrl.addEventListener('click', () => ctx.copy(d.url, 'otpauth URL'));

  host.append(
    h('div.totp-head', {}, h('span.badge.muted', {}, d.mode.toUpperCase()), h('span.muted', {}, ` · ${d.algorithm} · ${d.digits} digits${d.mode === 'totp' ? ` · ${d.period} s` : ` · counter ${d.counter}`}${d.issuer ? ` · ${d.issuer}` : ''}${d.account ? ` (${d.account})` : ''}`)),
    code,
    h('div.totp-timer', { hidden: d.mode !== 'totp' }, ring, remainingEl),
    h(
      'div.totp-neighbours',
      {},
      h('span.totp-neighbour.muted', {}, `${d.mode === 'totp' ? 'previous' : 'counter − 1'}: `, h('code', {}, groupCode(d.prev))),
      h('span.totp-neighbour.muted', {}, `${d.mode === 'totp' ? 'next' : 'counter + 1'}: `, h('code', {}, groupCode(d.next))),
    ),
    h('div.totp-url', {}, h('code.totp-url-text', {}, d.url), copyUrl),
  );

  if (d.mode !== 'totp') return;
  // Count down from the reference time the mode used; re-run when the period rolls over.
  const startedAt = Date.now();
  let lastWindow = Math.floor(d.now / 1000 / d.period);
  const timer = setInterval(() => {
    const now = d.now + (Date.now() - startedAt);
    const win = Math.floor(now / 1000 / d.period);
    if (win !== lastWindow) {
      lastWindow = win;
      clearInterval(timer);
      ctx.setOption('tick', Date.now());
      return;
    }
    setProgress(d.period - (Math.floor(now / 1000) % d.period));
  }, 1000);
  return () => clearInterval(timer);
};
