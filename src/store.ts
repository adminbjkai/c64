/**
 * Persistence — localStorage only. The board (layout + each pane's input,
 * mode and sizes) is saved locally so a refresh restores your work.
 *
 * Nothing here ever talks to the network; there is no sync, no sharing.
 */

import { sanitize, type LayoutNode } from './layout.js';

const BOARD_KEY = 'c64.board.v1';
const THEME_KEY = 'c64.theme';

export type Theme = 'light' | 'dark';

export function loadBoard(): LayoutNode | null {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch {
    return null; // corrupt or unavailable storage → start fresh
  }
}

let timer: number | undefined;

/** Debounced write. Typing in a pane saves at most a few times per second. */
export function saveBoard(root: LayoutNode, delayMs = 150): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = window.setTimeout(() => saveBoardNow(root), delayMs);
}

export function saveBoardNow(root: LayoutNode): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(root));
  } catch {
    // Quota exceeded or storage disabled — the app keeps working in memory.
  }
}

export function loadTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}
