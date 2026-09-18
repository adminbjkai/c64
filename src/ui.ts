/**
 * Tiny DOM helpers + shared UI bits (toast, clipboard, theme). Keeping these
 * hand-rolled is the whole point: no framework, no dependency.
 */

import { loadTheme, saveTheme, type Theme } from './store.js';
import { icon } from './icons.js';

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

/* ------------------------------------------------------------------- menu */

export interface MenuItem {
  label?: string;
  icon?: string;
  keys?: string;
  sep?: boolean;
  children?: MenuItem[];
  run?: () => void;
}

let openMenu: HTMLElement | null = null;

export function closeMenu(): void {
  openMenu?.remove();
  openMenu = null;
}

/**
 * A small popover menu anchored below `anchor`. One level of submenus.
 * Closes on selection, Escape, outside click or scroll. Arrow keys navigate.
 */
export function menu(anchor: HTMLElement, items: MenuItem[]): void {
  closeMenu();
  const el = h('div.menu', { role: 'menu' });
  const render = (list: MenuItem[], into: HTMLElement) => {
    for (const it of list) {
      if (it.sep) {
        into.append(h('div.menu-sep', { role: 'separator' }));
        continue;
      }
      const b = h<HTMLButtonElement>('button.menu-item', { type: 'button', role: 'menuitem' });
      if (it.icon) b.append(icon(it.icon, 14));
      b.append(h('span.menu-label', {}, it.label ?? ''));
      if (it.keys) b.append(h('kbd', {}, it.keys));
      if (it.children?.length) {
        b.append(icon('chevronRight', 12));
        const sub = h('div.menu.menu-sub', { role: 'menu', hidden: true });
        render(it.children, sub);
        const wrap = h('div.menu-has-sub', {}, b, sub);
        const show = () => {
          sub.hidden = false;
        };
        b.addEventListener('click', () => (sub.hidden = !sub.hidden));
        wrap.addEventListener('pointerenter', show);
        into.append(wrap);
      } else {
        b.addEventListener('click', () => {
          closeMenu();
          it.run?.();
        });
        into.append(b);
      }
    }
  };
  render(items, el);
  document.body.append(el);
  openMenu = el;
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let left = Math.min(r.left, innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + hgt > innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${top}px`;
  const first = el.querySelector<HTMLButtonElement>('button');
  first?.focus();
  const onKey = (e: KeyboardEvent) => {
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button:not([hidden])')).filter((b) => !b.closest('.menu-sub[hidden]'));
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      closeMenu();
      anchor.focus();
    } else if (e.key === 'ArrowDown') buttons[(idx + 1) % buttons.length]?.focus();
    else if (e.key === 'ArrowUp') buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    else return;
    e.preventDefault();
  };
  el.addEventListener('keydown', onKey);
  const away = (e: Event) => {
    if (openMenu !== el) return cleanup();
    if (e.type === 'pointerdown' && el.contains(e.target as Node)) return;
    closeMenu();
    cleanup();
  };
  const cleanup = () => {
    document.removeEventListener('pointerdown', away, true);
    window.removeEventListener('resize', away);
    window.removeEventListener('blur', away);
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
  });
}

