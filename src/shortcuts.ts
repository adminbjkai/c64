/**
 * Keyboard shortcuts — every core action has one.
 *
 * Matching uses `event.code` (physical key) rather than `event.key`, because
 * on macOS Alt+Shift+<letter> produces a symbol in `key` (e.g. "Â") while
 * `code` stays "KeyR". We preventDefault so that symbol never lands in the
 * editor.
 *
 * Alt+Shift was chosen over Cmd/Ctrl+Shift because the latter collides with
 * text-selection shortcuts inside a textarea and with browser tab shortcuts.
 */

import type { Board } from './board.js';
import { toggleTheme, toast, MOD } from './ui.js';

export interface Shortcut {
  keys: string;
  label: string;
  match: (e: KeyboardEvent) => boolean;
  run: (board: Board, e: KeyboardEvent) => void;
}

const mod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
const altShift = (e: KeyboardEvent, code: string) => e.altKey && e.shiftKey && !mod(e) && e.code === code;

export const SHORTCUTS: Shortcut[] = [
  {
    keys: `${MOD}+Enter`,
    label: 'Format now (skip the debounce)',
    match: (e) => mod(e) && e.key === 'Enter',
    run: (b) => b.active?.runNow(),
  },
  {
    keys: 'Alt+Shift+R',
    label: 'Add pane to the right',
    match: (e) => altShift(e, 'KeyR'),
    run: (b) => b.active && b.add(b.active.node.id, 'row'),
  },
  {
    keys: 'Alt+Shift+B',
    label: 'Add pane below',
    match: (e) => altShift(e, 'KeyB'),
    run: (b) => b.active && b.add(b.active.node.id, 'col'),
  },
  {
    keys: 'Alt+Shift+W',
    label: 'Close pane',
    match: (e) => altShift(e, 'KeyW'),
    run: (b) => b.active && b.close(b.active.node.id),
  },
  {
    keys: 'Alt+Shift+C',
    label: 'Copy output',
    match: (e) => altShift(e, 'KeyC'),
    run: (b) => void b.active?.copyOutput(),
  },
  {
    keys: 'Alt+Shift+P',
    label: 'Toggle Raw / Pretty',
    match: (e) => altShift(e, 'KeyP'),
    run: (b) => b.active?.togglePretty(),
  },
  {
    keys: 'Alt+Shift+E',
    label: 'Explain this input (local helper)',
    match: (e) => altShift(e, 'KeyE'),
    run: (b) => b.active?.toggleExplain(),
  },
  {
    keys: 'Alt+Shift+L',
    label: 'Toggle stacked / side-by-side layout',
    match: (e) => altShift(e, 'KeyL'),
    run: (b) => b.active?.toggleLayout(),
  },
  {
    keys: 'Alt+Shift+K',
    label: 'Search tools',
    match: (e) => altShift(e, 'KeyK'),
    run: () => document.getElementById('tool-search')?.focus(),
  },
  {
    keys: 'Alt+Shift+M',
    label: 'Focus the mode selector',
    match: (e) => altShift(e, 'KeyM'),
    run: (b) => b.active?.el.querySelector<HTMLSelectElement>('.mode-select')?.focus(),
  },
  {
    keys: 'Alt+Shift+] / [',
    label: 'Focus next / previous pane',
    match: (e) => altShift(e, 'BracketRight') || altShift(e, 'BracketLeft'),
    run: (b, e) => b.focusRelative(e.code === 'BracketRight' ? 1 : -1),
  },
  {
    keys: 'Alt+Shift+T',
    label: 'Toggle dark / light theme',
    match: (e) => altShift(e, 'KeyT'),
    run: () => {
      toast(`Theme: ${toggleTheme()}`);
      document.dispatchEvent(new CustomEvent('c64:theme'));
    },
  },
  {
    keys: 'Alt+Shift+/',
    label: 'Show this shortcut list',
    match: (e) => altShift(e, 'Slash'),
    run: () => document.getElementById('help-toggle')?.click(),
  },
];

export function installShortcuts(board: Board): void {
  document.addEventListener('keydown', (e) => {
    for (const s of SHORTCUTS) {
      if (s.match(e)) {
        e.preventDefault();
        s.run(board, e);
        return;
      }
    }
  });
}
