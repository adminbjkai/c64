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
 * The command palette is the one exception (⌘/Ctrl+K) because that binding
 * is what people expect.
 */

import type { Board } from './board.js';
import { toggleTheme, toast, MOD } from './ui.js';

export interface Shortcut {
  keys: string;
  label: string;
  /** Group for the help panel. */
  group: 'Panes' | 'Editing' | 'Workspace';
  match: (e: KeyboardEvent) => boolean;
  run: (board: Board, e: KeyboardEvent) => void;
}

/** Hooks into the shell (main.ts) for shortcuts that are not pane-scoped. */
export interface ShellActions {
  openPalette(): void;
  toggleHelp(): void;
  focusSearch(): void;
}

const mod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
const altShift = (e: KeyboardEvent, code: string) => e.altKey && e.shiftKey && !mod(e) && e.code === code;

export function buildShortcuts(shell: ShellActions): Shortcut[] {
  return [
    { keys: `${MOD}+K`, label: 'Command palette: tools, actions, boards', group: 'Workspace', match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.code === 'KeyK', run: () => shell.openPalette() },
    { keys: `${MOD}+Enter`, label: 'Format now (skip the debounce)', group: 'Editing', match: (e) => mod(e) && e.key === 'Enter', run: (b) => b.active?.runNow() },
    { keys: 'Alt+Shift+R', label: 'Add pane to the right', group: 'Panes', match: (e) => altShift(e, 'KeyR'), run: (b) => b.active && b.add(b.active.node.id, 'row') },
    { keys: 'Alt+Shift+B', label: 'Add pane below', group: 'Panes', match: (e) => altShift(e, 'KeyB'), run: (b) => b.active && b.add(b.active.node.id, 'col') },
    { keys: 'Alt+Shift+D', label: 'Duplicate pane', group: 'Panes', match: (e) => altShift(e, 'KeyD'), run: (b) => b.active && b.duplicate(b.active.node.id) },
    { keys: 'Alt+Shift+W', label: 'Close pane (the last one always stays)', group: 'Panes', match: (e) => altShift(e, 'KeyW'), run: (b) => b.active && b.close(b.active.node.id) },
    { keys: 'Alt+Shift+Z', label: 'Reopen the last closed pane', group: 'Panes', match: (e) => altShift(e, 'KeyZ'), run: (b) => b.undoClose() },
    { keys: 'Alt+Shift+Enter', label: 'Maximise / restore the active pane', group: 'Panes', match: (e) => altShift(e, 'Enter'), run: (b) => b.toggleZoom() },
    { keys: 'Alt+Shift+] / [', label: 'Focus next / previous pane', group: 'Panes', match: (e) => altShift(e, 'BracketRight') || altShift(e, 'BracketLeft'), run: (b, e) => b.focusRelative(e.code === 'BracketRight' ? 1 : -1) },
    { keys: 'Alt+Shift+N', label: 'Send output on to a new linked pane', group: 'Panes', match: (e) => altShift(e, 'KeyN'), run: (b) => b.active && b.addPiped(b.active.node.id) },
    { keys: 'Alt+Shift+L', label: 'Toggle stacked / side-by-side layout', group: 'Panes', match: (e) => altShift(e, 'KeyL'), run: (b) => b.active?.toggleLayout() },
    { keys: 'Alt+Shift+C', label: 'Copy output', group: 'Editing', match: (e) => altShift(e, 'KeyC'), run: (b) => void b.active?.copyOutput() },
    { keys: 'Alt+Shift+P', label: 'Toggle Raw / Pretty', group: 'Editing', match: (e) => altShift(e, 'KeyP'), run: (b) => b.active?.togglePretty() },
    { keys: 'Alt+Shift+F', label: 'Find in output', group: 'Editing', match: (e) => altShift(e, 'KeyF'), run: (b) => b.active?.toggleFind() },
    { keys: 'Alt+Shift+O', label: 'Wrap / unwrap long lines', group: 'Editing', match: (e) => altShift(e, 'KeyO'), run: (b) => b.active?.toggleWrap() },
    { keys: 'Alt+Shift+E', label: 'Explain this input (local helper)', group: 'Editing', match: (e) => altShift(e, 'KeyE'), run: (b) => b.active?.toggleExplain() },
    { keys: 'Alt+Shift+M', label: 'Focus the tool selector', group: 'Editing', match: (e) => altShift(e, 'KeyM'), run: (b) => b.active?.el.querySelector<HTMLSelectElement>('.mode-select')?.focus() },
    { keys: 'Alt+Shift+K', label: 'Search tools in the sidebar', group: 'Workspace', match: (e) => altShift(e, 'KeyK'), run: () => shell.focusSearch() },
    { keys: 'Alt+Shift+T', label: 'Toggle dark / light theme', group: 'Workspace', match: (e) => altShift(e, 'KeyT'), run: () => { toast(`Theme: ${toggleTheme()}`); document.dispatchEvent(new CustomEvent('c64:theme')); } },
    { keys: 'Alt+Shift+/', label: 'Show this shortcut list', group: 'Workspace', match: (e) => altShift(e, 'Slash'), run: () => shell.toggleHelp() },
  ];
}

export function installShortcuts(board: Board, shortcuts: Shortcut[]): void {
  document.addEventListener('keydown', (e) => {
    for (const s of shortcuts) {
      if (s.match(e)) {
        e.preventDefault();
        s.run(board, e);
        return;
      }
    }
  });
}
