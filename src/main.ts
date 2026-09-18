/**
 * Entry point: apply theme and prefs, restore the current board (or start
 * with one empty JSON pane), build the sidebar, top bar, status bar, command
 * palette and keyboard shortcuts, and register the offline service worker.
 */

import { Board } from './board.js';
import { loadBoards, saveBoards, saveBoardsNow, loadPrefs, savePrefs, type BoardsFile, type BoardRecord } from './store.js';
import { installShortcuts, buildShortcuts } from './shortcuts.js';
import { MODES, CATEGORIES } from './modes/index.js';
import { icon } from './icons.js';
import { applyTheme, currentTheme, toggleTheme, h, toast, menu, copyText } from './ui.js';
import { Palette, type Command } from './palette.js';
import { createPane, newId, sanitize, type LayoutNode } from './layout.js';
import { VERSION } from './version.js';

applyTheme(currentTheme());
const prefs = loadPrefs();
document.documentElement.style.setProperty('--content-size', `${prefs.fontSize}px`);

/* ------------------------------------------------------------------ boards */

let file: BoardsFile = loadBoards() ?? { current: '', boards: [] };
if (!file.boards.length) {
  const rec: BoardRecord = { id: newId('b'), name: 'My board', root: createPane(), updated: Date.now() };
  file = { current: rec.id, boards: [rec] };
}
const currentRecord = (): BoardRecord => file.boards.find((b) => b.id === file.current) ?? file.boards[0]!;

const host = document.getElementById('board')!;
// The Board constructor fires events before `board` is assigned; ignore those.
let ready = false;
const board = new Board(host, currentRecord().root, {
  changed() {
    if (!ready) return;
    const rec = currentRecord();
    rec.root = board.root;
    rec.updated = Date.now();
    saveBoards(file);
  },
  focusChanged() {
    if (!ready) return;
    highlightActiveTool();
    paintStatus();
  },
});
ready = true;
// The board may have sanitised the tree — keep the record pointing at the live one.
currentRecord().root = board.root;

// Flush a pending debounced save when the tab is hidden or closed.
addEventListener('pagehide', () => saveBoardsNow(file));
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveBoardsNow(file);
});

function switchBoard(id: string): void {
  const rec = file.boards.find((b) => b.id === id);
  if (!rec || rec.id === file.current) return;
  saveBoardsNow(file);
  file.current = rec.id;
  board.load(rec.root);
  rec.root = board.root;
  saveBoardsNow(file);
  paintBoardName();
  toast(`Board: ${rec.name}`);
}

function newBoard(name?: string, root?: LayoutNode): void {
  const rec: BoardRecord = { id: newId('b'), name: (name ?? `Board ${file.boards.length + 1}`).slice(0, 80), root: root ?? createPane(), updated: Date.now() };
  file.boards.push(rec);
  switchBoard(rec.id);
}

function renameBoard(): void {
  const rec = currentRecord();
  const name = prompt('Board name', rec.name);
  if (name === null || !name.trim()) return;
  rec.name = name.trim().slice(0, 80);
  saveBoardsNow(file);
  paintBoardName();
}

function duplicateBoard(): void {
  const rec = currentRecord();
  const copy = sanitize(JSON.parse(JSON.stringify(rec.root)));
  newBoard(`${rec.name} (copy)`, copy ?? createPane());
}

function deleteBoard(): void {
  const rec = currentRecord();
  if (file.boards.length === 1) {
    if (!confirm(`Clear “${rec.name}”? This removes every pane and its input.`)) return;
    rec.root = createPane();
    board.load(rec.root);
    rec.root = board.root;
    saveBoardsNow(file);
    return;
  }
  if (!confirm(`Delete board “${rec.name}” and everything in it?`)) return;
  file.boards = file.boards.filter((b) => b.id !== rec.id);
  file.current = '';
  switchBoard(file.boards[0]!.id);
  toast('Board deleted');
}

function exportBoard(): void {
  const rec = currentRecord();
  const payload = { app: 'c64', version: VERSION, exported: new Date().toISOString(), board: { name: rec.name, root: board.root } };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h<HTMLAnchorElement>('a', { href: url, download: `${rec.name.replace(/[^\w.-]+/g, '_') || 'board'}.c64.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Board exported');
}

function importBoardFromText(text: string, sourceName = 'import'): void {
  try {
    const parsed = JSON.parse(text) as { board?: { name?: string; root?: unknown }; root?: unknown };
    const root = sanitize(parsed.board?.root ?? parsed.root ?? parsed);
    if (!root) throw new Error('no panes found');
    newBoard(typeof parsed.board?.name === 'string' ? parsed.board.name : sourceName.replace(/\.c64\.json$|\.json$/i, ''), root);
    toast('Board imported as a new board');
  } catch (e) {
    toast(`Could not import: ${(e as Error).message}`);
  }
}

const importInput = h<HTMLInputElement>('input', { type: 'file', accept: '.json,application/json', hidden: true });
document.body.append(importInput);
importInput.addEventListener('change', async () => {
  const f = importInput.files?.[0];
  importInput.value = '';
  if (f) importBoardFromText(await f.text(), f.name);
});

/* -------------------------------------------------------------- share link */
// The board is compressed and put in the URL *fragment*, which browsers never
// send to the server. Opening the link imports it as a new board.

async function shareLink(): Promise<void> {
  try {
    const rec = currentRecord();
    const json = JSON.stringify({ name: rec.name, root: board.root });
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `${location.origin}${location.pathname}#b=${b64}`;
    if (url.length > 60_000) {
      toast('Board is too large for a link — use Export instead');
      return;
    }
    toast((await copyText(url)) ? `Share link copied (${(url.length / 1024).toFixed(1)} KB, lives only in the URL)` : 'Could not copy the link');
  } catch (e) {
    toast(`Could not build a link: ${(e as Error).message}`);
  }
}

async function importFromHash(): Promise<void> {
  const m = /[#&]b=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  try {
    const b64 = m[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const text = await new Response(stream).text();
    importBoardFromText(text, 'Shared board');
  } catch {
    toast('That share link could not be read');
  }
}
void importFromHash();

/* ----------------------------------------------------------------- sidebar */

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
  // Make the switch visible: flash the pane's title bar, bring it into view,
  // and name the target pane when there is more than one to confuse.
  const bar = pane.el.querySelector<HTMLElement>('.pane-title');
  if (bar) {
    bar.classList.remove('flash');
    void bar.offsetWidth;
    bar.classList.add('flash');
    setTimeout(() => bar.classList.remove('flash'), 600);
  }
  pane.el.scrollIntoView({ block: 'nearest' });
  if (board.panes.length >= 2) toast(`${board.titleOf(pane.node.id)} → ${pane.mode.label}`);
  if (matchMedia('(max-width: 900px)').matches) setSidebar(false);
}

const navButtons = new Map<string, HTMLButtonElement>();
for (const cat of CATEGORIES) {
  const tools = MODES.filter((m) => m.category === cat);
  if (!tools.length) continue;
  const section = h('section.nav-section', {}, h('h4', {}, cat));
  for (const m of tools) {
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
host.addEventListener('change', highlightActiveTool);
host.addEventListener('click', () => queueMicrotask(highlightActiveTool));

function filterTools(): void {
  const q = search.value.trim().toLowerCase();
  for (const section of nav.querySelectorAll<HTMLElement>('.nav-section')) {
    let visible = 0;
    for (const b of section.querySelectorAll<HTMLElement>('.nav-item')) {
      const m = MODES.find((x) => x.id === b.dataset['mode'])!;
      const hit = !q || `${m.label} ${m.description} ${m.category} ${(m.keywords ?? []).join(' ')}`.toLowerCase().includes(q);
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
    search.value = '';
    filterTools();
  } else if (e.key === 'Escape') {
    search.value = '';
    filterTools();
    board.active?.focus();
  }
});

// Collapsible sidebar (remembered per browser). On narrow screens it is a drawer.
const sidebar = document.getElementById('sidebar')!;
const sidebarToggle = document.getElementById('sidebar-toggle')!;
const scrim = document.getElementById('scrim')!;
sidebarToggle.append(icon('menu'));
function setSidebar(open: boolean): void {
  document.body.classList.toggle('sidebar-collapsed', !open);
  sidebarToggle.setAttribute('aria-expanded', String(open));
  prefs.sidebar = open ? 'open' : 'closed';
  savePrefs(prefs);
}
setSidebar(prefs.sidebar !== 'closed' && !matchMedia('(max-width: 900px)').matches);
sidebarToggle.addEventListener('click', () => setSidebar(document.body.classList.contains('sidebar-collapsed')));
scrim.addEventListener('click', () => setSidebar(false));
sidebar.addEventListener('transitionend', () => board.render());

/* ----------------------------------------------------------------- top bar */

const boardBtn = document.getElementById('board-menu')!;
function paintBoardName(): void {
  boardBtn.replaceChildren(icon('folder', 14), h('span.board-name', {}, currentRecord().name), icon('chevronDown', 12));
  document.title = `${currentRecord().name} — c64`;
}
paintBoardName();
boardBtn.addEventListener('click', () => {
  menu(boardBtn, [
    ...file.boards.map((b) => ({ icon: b.id === file.current ? 'check' : 'folder', label: b.name, run: () => switchBoard(b.id) })),
    { sep: true },
    { icon: 'plus', label: 'New board', run: () => newBoard() },
    { icon: 'edit', label: 'Rename board…', run: renameBoard },
    { icon: 'duplicate', label: 'Duplicate board', run: duplicateBoard },
    { icon: 'trash', label: file.boards.length > 1 ? 'Delete board…' : 'Clear board…', run: deleteBoard },
    { sep: true },
    { icon: 'download', label: 'Export board as JSON', run: exportBoard },
    { icon: 'upload', label: 'Import board from JSON…', run: () => importInput.click() },
    { icon: 'share', label: 'Copy share link', run: () => void shareLink() },
  ]);
});

const addRight = document.getElementById('add-right')!;
addRight.append(icon('splitRight', 14), h('span', {}, 'Pane right'));
addRight.addEventListener('click', () => board.active && board.add(board.active.node.id, 'row'));
const addBelow = document.getElementById('add-below')!;
addBelow.append(icon('splitDown', 14), h('span', {}, 'Pane below'));
addBelow.addEventListener('click', () => board.active && board.add(board.active.node.id, 'col'));

const paletteBtn = document.getElementById('palette-toggle')!;
paletteBtn.append(icon('command', 14), h('span', {}, 'Commands'), h('kbd', {}, navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'));
paletteBtn.addEventListener('click', () => palette.open());

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

/* --------------------------------------------------------------- help panel */

const help = document.getElementById('help')!;
const helpToggle = document.getElementById('help-toggle')!;
helpToggle.append(icon('keyboard', 14), h('span', {}, 'Shortcuts'));
const helpClose = h('button.btn.icon', { type: 'button', 'aria-label': 'Close' }, icon('close'));
helpClose.addEventListener('click', () => toggleHelp(false));
function toggleHelp(force?: boolean): void {
  const open = force ?? help.hidden;
  help.hidden = !open;
  helpToggle.setAttribute('aria-expanded', String(open));
}
helpToggle.addEventListener('click', () => toggleHelp());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !help.hidden) toggleHelp(false);
});

/* ------------------------------------------------------------- shortcuts */

const shortcuts = buildShortcuts({
  openPalette: () => palette.toggle(),
  toggleHelp: () => toggleHelp(),
  focusSearch: () => {
    if (document.body.classList.contains('sidebar-collapsed')) setSidebar(true);
    search.focus();
    search.select();
  },
});
installShortcuts(board, shortcuts);

const groups = ['Panes', 'Editing', 'Workspace'] as const;
help.append(
  h('header.help-head', {}, h('h2', {}, 'Keyboard shortcuts'), h('span.spacer'), helpClose),
  ...groups.map((g) =>
    h('section.help-group', {}, h('h3', {}, g), h('dl', {}, ...shortcuts.filter((s) => s.group === g).flatMap((s) => [h('dt', {}, h('kbd', {}, s.keys)), h('dd', {}, s.label)]))),
  ),
  h(
    'section.help-group',
    {},
    h('h3', {}, 'Inside a pane'),
    h(
      'dl',
      {},
      h('dt', {}, h('kbd', {}, 'Tab / arrows')),
      h('dd', {}, 'Seams are focusable: Tab to one, then arrow keys resize it (Shift = bigger steps); double-click resets'),
      h('dt', {}, h('kbd', {}, '↑ ↓ ← → · c · p')),
      h('dd', {}, 'In a tree: move, expand/collapse, copy value, copy path'),
      h('dt', {}, h('kbd', {}, '+ − 0')),
      h('dd', {}, 'In a graph: zoom in / out / fit'),
      h('dt', {}, h('kbd', {}, 'Double-click name')),
      h('dd', {}, 'Rename the pane'),
    ),
  ),
);

/* --------------------------------------------------------------- palette */

const palette = new Palette((): Command[] => {
  const active = board.active;
  const cmds: Command[] = [];
  for (const m of MODES) {
    cmds.push({ id: `mode:${m.id}`, group: 'Switch tool', label: m.label, hint: m.category, icon: m.icon, keywords: `${m.description} ${(m.keywords ?? []).join(' ')}`, run: () => pickTool(m.id) });
  }
  for (const s of shortcuts) {
    if (s.keys.includes('K') && s.group === 'Workspace') continue;
    cmds.push({ id: `key:${s.keys}`, group: s.group === 'Workspace' ? 'Workspace' : 'Pane', label: s.label, keys: s.keys, icon: s.group === 'Panes' ? 'splitRight' : s.group === 'Editing' ? 'edit' : 'settings', run: () => s.run(board, new KeyboardEvent('keydown')) });
  }
  if (active) {
    cmds.push({ id: 'pane:rename', group: 'Pane', label: 'Rename pane…', icon: 'edit', run: () => board.rename(active.node.id) });
    for (const p of board.panes) {
      if (p !== active) cmds.push({ id: `link:${p.node.id}`, group: 'Pane', label: `Read input from ${board.titleOf(p.node.id, true)}`, icon: 'pipe', run: () => board.link(active.node.id, p.node.id) });
    }
    if (active.node.state.sourceId) cmds.push({ id: 'pane:unlink', group: 'Pane', label: 'Unlink input', icon: 'close', run: () => board.link(active.node.id, null) });
  }
  for (const p of board.panes) cmds.push({ id: `focus:${p.node.id}`, group: 'Go to pane', label: board.titleOf(p.node.id, true), icon: 'chevronRight', hint: p.node.state.input ? `${p.node.state.input.length.toLocaleString()} chars` : 'empty', run: () => board.focusPane(p.node.id) });
  for (const b of file.boards) cmds.push({ id: `board:${b.id}`, group: 'Boards', label: b.name, icon: b.id === file.current ? 'check' : 'folder', hint: b.id === file.current ? 'current' : undefined, run: () => switchBoard(b.id) });
  cmds.push(
    { id: 'board:new', group: 'Boards', label: 'New board', icon: 'plus', run: () => newBoard() },
    { id: 'board:rename', group: 'Boards', label: 'Rename board…', icon: 'edit', run: renameBoard },
    { id: 'board:duplicate', group: 'Boards', label: 'Duplicate board', icon: 'duplicate', run: duplicateBoard },
    { id: 'board:delete', group: 'Boards', label: file.boards.length > 1 ? 'Delete board…' : 'Clear board…', icon: 'trash', run: deleteBoard },
    { id: 'board:export', group: 'Boards', label: 'Export board as JSON', icon: 'download', run: exportBoard },
    { id: 'board:import', group: 'Boards', label: 'Import board from JSON…', icon: 'upload', run: () => importInput.click() },
    { id: 'board:share', group: 'Boards', label: 'Copy share link', icon: 'share', run: () => void shareLink() },
    { id: 'ws:font+', group: 'Workspace', label: 'Bigger content text', icon: 'arrowUp', run: () => setFontSize(prefs.fontSize + 1) },
    { id: 'ws:font-', group: 'Workspace', label: 'Smaller content text', icon: 'arrowDown', run: () => setFontSize(prefs.fontSize - 1) },
    { id: 'ws:sidebar', group: 'Workspace', label: document.body.classList.contains('sidebar-collapsed') ? 'Show sidebar' : 'Hide sidebar', icon: 'menu', run: () => setSidebar(document.body.classList.contains('sidebar-collapsed')) },
    { id: 'ws:about', group: 'Workspace', label: `About c64 v${VERSION}`, icon: 'info', run: () => window.open('https://github.com/adminbjkai/c64', '_blank', 'noopener') },
  );
  return cmds;
});

function setFontSize(px: number): void {
  prefs.fontSize = Math.min(22, Math.max(10, px));
  document.documentElement.style.setProperty('--content-size', `${prefs.fontSize}px`);
  savePrefs(prefs);
  toast(`Content text: ${prefs.fontSize}px`);
}

/* ------------------------------------------------------------ status bar */

const status = document.getElementById('statusbar')!;
const statusPanes = h('span.status-item');
const statusActive = h('span.status-item.status-active');
const statusRight = h('span.status-item.muted', {}, `v${VERSION}`);
const repoLink = h<HTMLAnchorElement>('a.status-item', { href: 'https://github.com/adminbjkai/c64', target: '_blank', rel: 'noopener', title: 'Source on GitHub' }, icon('github', 13), h('span', {}, 'GitHub'));
status.append(
  h('span.status-item.local-badge', { title: 'All parsing and formatting happens in this tab. No request ever carries your content.' }, h('span.dot', { 'aria-hidden': 'true' }), 'Runs entirely in your browser'),
  statusPanes,
  statusActive,
  h('span.spacer'),
  repoLink,
  statusRight,
);
function paintStatus(): void {
  const n = board.panes.length;
  statusPanes.textContent = `${n} pane${n === 1 ? '' : 's'}${board.zoomed ? ' · maximised' : ''}`;
  const a = board.active;
  if (a) {
    const r = a.result;
    statusActive.textContent = `${board.titleOf(a.node.id, true)}${r.status ? ' — ' + r.status : ''}`;
    statusActive.classList.toggle('is-error', !!r.error);
  }
}
paintStatus();
host.addEventListener('input', () => setTimeout(paintStatus, DEBOUNCE_STATUS));
host.addEventListener('change', () => setTimeout(paintStatus, DEBOUNCE_STATUS));
host.addEventListener('click', () => setTimeout(paintStatus, DEBOUNCE_STATUS));
const DEBOUNCE_STATUS = 250;
setInterval(paintStatus, 1500);

/* --------------------------------------------------------- service worker */
// Offline support: caches the app shell after the first visit. It never
// caches or sends user content — there are no such requests to intercept.

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline caching is a nicety, not a requirement */
    });
  });
}
