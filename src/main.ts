/**
 * Entry point: apply theme, restore the board from localStorage (or start
 * with one empty JSON pane), build the tool sidebar, wire the top bar and
 * keyboard shortcuts.
 */

import { Board } from './board.js';
import { loadBoard, saveBoardNow } from './store.js';
import { installShortcuts, SHORTCUTS } from './shortcuts.js';
import { MODES } from './modes/index.js';
import { icon } from './icons.js';
import { applyTheme, currentTheme, toggleTheme, h, toast } from './ui.js';

applyTheme(currentTheme());

const host = document.getElementById('board')!;
const board = new Board(host, loadBoard());
installShortcuts(board);

// Flush a pending debounced save when the tab is hidden or closed.
addEventListener('pagehide', () => saveBoardNow(board.root));
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveBoardNow(board.root);
});

/* ---------------------------------------------------------------- sidebar */

const CATEGORIES = ['JSON', 'Formats', 'Encoding', 'Text'] as const;
const nav = document.getElementById('tool-nav')!;
const search = document.getElementById('tool-search') as HTMLInputElement;
document.getElementById('search-icon')!.append(icon('search', 14));

/** Switch the active pane to a tool (the sidebar's one job). */
function pickTool(id: string): void {
  const pane = board.active;
  if (!pane) return;
  pane.setMode(id);
  pane.focus();
  highlightActiveTool();
}

const navButtons = new Map<string, HTMLButtonElement>();
for (const cat of CATEGORIES) {
  const section = h('section.nav-section', {}, h('h4', {}, cat));
  for (const m of MODES.filter((m) => m.category === cat)) {
    const b = h<HTMLButtonElement>('button.nav-item', { type: 'button', 'data-mode': m.id, title: m.description }, icon(m.icon, 16), h('span', {}, m.label));
    b.addEventListener('click', () => pickTool(m.id));
    navButtons.set(m.id, b);
    section.append(b);
  }
  nav.append(section);
}

function highlightActiveTool(): void {
  const current = board.active?.node.state.mode;
  for (const [id, b] of navButtons) b.classList.toggle('is-active', id === current);
}
highlightActiveTool();
// Keep the sidebar highlight in sync with whichever pane/mode is active.
host.addEventListener('focusin', highlightActiveTool);
host.addEventListener('change', highlightActiveTool);
host.addEventListener('click', () => queueMicrotask(highlightActiveTool));

function filterTools(): void {
  const q = search.value.trim().toLowerCase();
  for (const section of nav.querySelectorAll<HTMLElement>('.nav-section')) {
    let visible = 0;
    for (const b of section.querySelectorAll<HTMLElement>('.nav-item')) {
      const m = MODES.find((x) => x.id === b.dataset['mode'])!;
      const hit = !q || `${m.label} ${m.description} ${m.category}`.toLowerCase().includes(q);
      b.hidden = !hit;
      if (hit) visible++;
    }
    section.hidden = visible === 0;
  }
}
search.addEventListener('input', filterTools);
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = nav.querySelector<HTMLButtonElement>('.nav-item:not([hidden])');
    if (first) pickTool(first.dataset['mode']!);
  } else if (e.key === 'Escape') {
    search.value = '';
    filterTools();
    board.active?.focus();
  }
});

// Collapsible sidebar (remembered per browser).
const sidebar = document.getElementById('sidebar')!;
const sidebarToggle = document.getElementById('sidebar-toggle')!;
sidebarToggle.append(icon('menu'));
function setSidebar(open: boolean): void {
  document.body.classList.toggle('sidebar-collapsed', !open);
  sidebarToggle.setAttribute('aria-expanded', String(open));
  try {
    localStorage.setItem('c64.sidebar', open ? 'open' : 'closed');
  } catch {
    /* ignore */
  }
}
let sidebarOpen = true;
try {
  sidebarOpen = localStorage.getItem('c64.sidebar') !== 'closed';
} catch {
  /* ignore */
}
setSidebar(sidebarOpen);
sidebarToggle.addEventListener('click', () => setSidebar(document.body.classList.contains('sidebar-collapsed')));
sidebar.addEventListener('transitionend', () => board.render());

/* ---------------------------------------------------------------- top bar */

const addRight = document.getElementById('add-right')!;
addRight.append(icon('splitRight', 14), h('span', {}, 'Pane right'));
addRight.addEventListener('click', () => board.active && board.add(board.active.node.id, 'row'));
const addBelow = document.getElementById('add-below')!;
addBelow.append(icon('splitDown', 14), h('span', {}, 'Pane below'));
addBelow.addEventListener('click', () => board.active && board.add(board.active.node.id, 'col'));

const themeToggle = document.getElementById('theme-toggle')!;
function paintThemeButton(): void {
  themeToggle.replaceChildren(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
}
paintThemeButton();
themeToggle.addEventListener('click', () => {
  toast(`Theme: ${toggleTheme()}`);
  paintThemeButton();
});
document.addEventListener('c64:theme', paintThemeButton);

const help = document.getElementById('help')!;
const helpToggle = document.getElementById('help-toggle')!;
helpToggle.append(icon('keyboard', 14), h('span', {}, 'Shortcuts'));
help.append(
  h('h2', {}, 'Keyboard shortcuts'),
  h(
    'dl',
    {},
    ...SHORTCUTS.flatMap((s) => [h('dt', {}, h('kbd', {}, s.keys)), h('dd', {}, s.label)]),
    h('dt', {}, h('kbd', {}, 'Tab / arrows')),
    h('dd', {}, 'Seams are focusable: Tab to one, then arrow keys resize it'),
    h('dt', {}, h('kbd', {}, '↑ ↓ ← → · c · p')),
    h('dd', {}, 'In a tree: move, expand/collapse, copy value, copy path'),
    h('dt', {}, h('kbd', {}, '+ − 0')),
    h('dd', {}, 'In a graph: zoom in / out / fit'),
  ),
);
helpToggle.addEventListener('click', () => {
  const open = help.toggleAttribute('hidden');
  helpToggle.setAttribute('aria-expanded', String(!open));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !help.hidden) help.hidden = true;
});
