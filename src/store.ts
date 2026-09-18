/**
 * Persistence — localStorage only. Boards (layout + each pane's input, mode
 * and sizes) are saved locally so a refresh restores your work. Several
 * named boards can coexist; exactly one is current.
 *
 * Nothing here ever talks to the network; there is no sync, no sharing
 * beyond the explicit export / share-link actions the user triggers.
 */

import { sanitize, newId, type LayoutNode } from './layout.js';

const BOARDS_KEY = 'c64.boards.v1';
/** Pre-1.0 single-board key, migrated on first load. */
const LEGACY_BOARD_KEY = 'c64.board.v1';
const THEME_KEY = 'c64.theme';
const PREFS_KEY = 'c64.prefs.v1';

export type Theme = 'light' | 'dark';

export interface BoardRecord {
  id: string;
  name: string;
  root: LayoutNode;
  /** Epoch ms of the last save. */
  updated: number;
}

export interface BoardsFile {
  current: string;
  boards: BoardRecord[];
}

export interface Prefs {
  sidebar: 'open' | 'closed';
  fontSize: number;
  /** Which pane id is maximised, if any (per board it's simplest to keep global). */
  zoomed?: string;
}

const DEFAULT_PREFS: Prefs = { sidebar: 'open', fontSize: 13 };

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — the app keeps working in memory.
  }
}

/* --------------------------------------------------------------- boards */

function sanitizeRecord(r: unknown): BoardRecord | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Partial<BoardRecord>;
  const root = sanitize(o.root);
  if (!root) return null;
  return {
    id: typeof o.id === 'string' ? o.id : newId('b'),
    name: typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 80) : 'Untitled board',
    root,
    updated: typeof o.updated === 'number' ? o.updated : Date.now(),
  };
}

/** Load every board; migrates the pre-1.0 single board; never returns empty. */
export function loadBoards(): BoardsFile | null {
  const raw = read(BOARDS_KEY) as Partial<BoardsFile> | null;
  if (raw && Array.isArray(raw.boards)) {
    const boards = raw.boards.map(sanitizeRecord).filter((b): b is BoardRecord => b !== null);
    if (boards.length) {
      const current = boards.some((b) => b.id === raw.current) ? (raw.current as string) : boards[0]!.id;
      return { current, boards };
    }
  }
  const legacy = sanitize(read(LEGACY_BOARD_KEY));
  if (legacy) {
    const rec: BoardRecord = { id: newId('b'), name: 'My board', root: legacy, updated: Date.now() };
    const file = { current: rec.id, boards: [rec] };
    write(BOARDS_KEY, file);
    try {
      localStorage.removeItem(LEGACY_BOARD_KEY);
    } catch {
      /* ignore */
    }
    return file;
  }
  return null;
}

let timer: number | undefined;
let pendingFile: BoardsFile | null = null;

/** Debounced write. Typing in a pane saves at most a few times per second. */
export function saveBoards(file: BoardsFile, delayMs = 150): void {
  pendingFile = file;
  if (timer !== undefined) clearTimeout(timer);
  timer = window.setTimeout(() => saveBoardsNow(file), delayMs);
}

export function saveBoardsNow(file: BoardsFile = pendingFile ?? { current: '', boards: [] }): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  pendingFile = null;
  if (!file.boards.length) return;
  write(BOARDS_KEY, file);
}

/* ---------------------------------------------------------------- prefs */

export function loadPrefs(): Prefs {
  const raw = read(PREFS_KEY) as Partial<Prefs> | null;
  const p: Prefs = { ...DEFAULT_PREFS };
  if (raw && typeof raw === 'object') {
    if (raw.sidebar === 'closed') p.sidebar = 'closed';
    if (typeof raw.fontSize === 'number' && raw.fontSize >= 10 && raw.fontSize <= 22) p.fontSize = raw.fontSize;
    if (typeof raw.zoomed === 'string') p.zoomed = raw.zoomed;
  } else {
    // Pre-1.0 sidebar preference.
    try {
      if (localStorage.getItem('c64.sidebar') === 'closed') p.sidebar = 'closed';
    } catch {
      /* ignore */
    }
  }
  return p;
}

export function savePrefs(p: Prefs): void {
  write(PREFS_KEY, p);
}

/* ---------------------------------------------------------------- theme */

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
