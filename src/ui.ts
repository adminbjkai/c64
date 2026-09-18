/**
 * Tiny DOM helpers + shared UI bits (toast, clipboard, theme). Keeping these
 * hand-rolled is the whole point: no framework, no dependency.
 */

import { loadTheme, saveTheme, type Theme } from './store.js';

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** `h('button.primary', { onclick }, 'Save')` — a minimal element builder. */
export function h<T extends HTMLElement = HTMLElement>(
  spec: string,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): T {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag!) as T;
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/* ------------------------------------------------------------------ toast */

let toastEl: HTMLElement | null = null;
let toastTimer: number | undefined;

/** Subtle, non-blocking confirmation at the bottom of the screen. */
export function toast(message: string, ms = 1400): void {
  if (!toastEl) {
    toastEl = h('div.toast', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('show');
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), ms);
}

/* -------------------------------------------------------------- clipboard */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts / older browsers.
    const ta = h<HTMLTextAreaElement>('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/* ------------------------------------------------------------------ theme */

export function currentTheme(): Theme {
  const stored = loadTheme();
  if (stored) return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  saveTheme(next);
  applyTheme(next);
  return next;
}

/** Cmd on macOS, Ctrl elsewhere — for displaying shortcut hints. */
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';
