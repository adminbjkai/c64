/**
 * PaneView — one tool instance. Structure (top → bottom):
 *
 *   ┌ title bar   : pane name, tool dropdown, description, Explain, ⋯ menu
 *   │               (+ maximise / split / close icons on multi-pane boards)
 *   ├ options bar : Pretty | Raw, up to three options (rest behind "Options ▾"), primary action
 *   ├ INPUT panel : label, link / detect chips, counters, Paste · Upload · Clear, gutter + editor
 *   ├ seam        : draggable (horizontal when stacked, vertical when side-by-side)
 *   └ OUTPUT panel: label, status, Copy · Send on · ⋯ (Find, Download), the result (text or rich view)
 *
 * New panes start in the Auto detect pseudo-tool: the editor fills the pane
 * with a row of start chips under it, and the first recognisable paste
 * switches the pane to the right tool (see `detect()`). A PaneView owns its
 * DOM for the life of the pane; the board re-parents it when the layout
 * changes, so typing, scroll and focus survive structural edits.
 */

import type { PaneNode } from './layout.js';
import { MODES, CATEGORIES, getMode, type ModeResult, type ToolMode } from './modes/index.js';
import { VIEWS, type ViewContext } from './views/index.js';
import { runMode } from './runner.js';
import { ExplainPanel } from './explain-ui.js';
import { explain, detectMode, detectedName } from './explain.js';
import { icon } from './icons.js';
import { highlightInto } from './highlight.js';
import { h, toast, copyText, menu, type MenuItem } from './ui.js';

/** What a pane needs from the board. Kept minimal so pane.ts stays decoupled. */
export interface BoardActions {
  addRight(paneId: string): void;
  addBelow(paneId: string): void;
  close(paneId: string): void;
  duplicate(paneId: string): void;
  swap(paneId: string, delta: 1 | -1): void;
  zoom(paneId: string): void;
  isZoomed(paneId: string): boolean;
  canClose(): boolean;
  /** Something in this pane's persisted state changed. */
  changed(): void;
  /** This pane produced new output text (pipes listen to this). */
  outputChanged(paneId: string, text: string): void;
  otherPanes(paneId: string): { id: string; title: string }[];
  link(paneId: string, sourceId: string | null): void;
  /** Open a new pane to the right that keeps reading this pane's output. */
  sendOn(paneId: string): void;
  titleOf(paneId: string): string;
  rename(paneId: string): void;
}

const DEBOUNCE_MS = 180;
/** Auto detect only looks at inputs this long (or shorter ones with a structural hint). */
const DETECT_MIN_CHARS = 12;
const DETECT_MAX_CHARS = 200_000;
/** Start chips under the editor of an empty Auto pane. */
const START_CHIPS: [string, string][] = [['json', 'JSON'], ['base64', 'Base64'], ['jwt', 'JWT'], ['diff', 'Diff'], ['yaml', 'YAML'], ['convert', 'Convert']];
/** Seam can't be dragged past these so both editor and output stay usable. */
const SEAM_MIN = 0.1;
const SEAM_MAX = 0.9;
/** Above this many lines the gutter stops (cheap text measurement only). */
const GUTTER_MAX_LINES = 20_000;
const FIND_MAX_MARKS = 2_000;

/** File extension for "Download output" per mode / state. */
function outputExtension(mode: ToolMode, pretty: boolean, options: Record<string, unknown>): string {
  switch (mode.id) {
    case 'json': case 'json-tree': case 'json-path': case 'json-graph': case 'jwt': case 'query-string': return 'json';
    case 'xml': return 'xml';
    case 'yaml': return pretty ? 'yaml' : 'json';
    case 'csv': return 'csv';
    case 'css': return 'css';
    case 'html': case 'markdown': return 'html';
    case 'sql': return 'sql';
    case 'json-to-types': return { typescript: 'ts', zod: 'ts', python: 'py', go: 'go', jsonschema: 'json' }[String(options['target'] ?? 'typescript')] ?? 'txt';
    case 'convert': return typeof options['to'] === 'string' ? (options['to'] as string) : 'txt';
    default: return 'txt';
  }
}

/** Label of the primary action button for a tool (and its current options). */
export function primaryLabel(mode: ToolMode, options: Record<string, unknown>): string {
  const dir = typeof options['direction'] === 'string' ? options['direction'] : 'auto';
  switch (mode.id) {
    case 'json': return 'Format JSON';
    case 'xml': return 'Format XML';
    case 'yaml': return 'Format YAML';
    case 'sql': return 'Format SQL';
    case 'css': return 'Format CSS';
    case 'html': return 'Format HTML';
    case 'minify': return 'Format';
    case 'base64': return dir === 'decode' ? 'Decode Base64' : dir === 'encode' ? 'Encode Base64' : 'Decode / Encode';
    case 'jwt': return 'Decode JWT';
    case 'url': return dir === 'encode' ? 'Encode URL' : 'Decode URL';
    case 'hex': case 'base-n': case 'gzip': case 'data-url': case 'html-entities': case 'escape':
    case 'convert': case 'toml': case 'query-string': case 'json-to-types': case 'html-to-markdown': case 'json-flatten': case 'json-sort': case 'case':
      return 'Convert';
    case 'json-patch': return 'Apply patch';
    case 'json-schema': return 'Validate';
    case 'json-diff': case 'xml-diff': case 'yaml-diff': case 'diff': case 'list-compare': return 'Compare';
    case 'json-tree': case 'json-path': return 'Show tree';
    case 'json-graph': return 'Draw graph';
    case 'json-table': case 'csv': return 'Show table';
    case 'auto': return 'Detect & run';
    default: return 'Run';
  }
}

/** Icon-and-label button used across the pane toolbars. */
function tbtn(iconName: string, label: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h<HTMLButtonElement>(`button.btn.tb${cls ? '.' + cls : ''}`, { type: 'button', title, 'aria-label': label }, icon(iconName, 14), h('span', {}, label));
  b.addEventListener('click', onClick);
  return b;
}

function ibtn(iconName: string, title: string, onClick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  const b = h<HTMLButtonElement>(`button.btn.icon${cls ? '.' + cls : ''}`, { type: 'button', title, 'aria-label': title }, icon(iconName));
  b.addEventListener('click', onClick);
  return b;
}

export class PaneView {
  readonly el: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly textareaB: HTMLTextAreaElement;
  private readonly gutter: HTMLElement;
  private readonly gutterB: HTMLElement;
  private readonly editorsEl: HTMLElement;
  private readonly labelA: HTMLElement;
  private readonly labelB: HTMLElement;
  private readonly swapBtn: HTMLButtonElement;
  private readonly infoPanel: HTMLElement;
  /** Which editor the Paste / Upload buttons target (the last one focused). */
  private target: 'a' | 'b' = 'a';
  private readonly output: HTMLPreElement;
  private readonly viewHost: HTMLElement;
  private readonly errorBox: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly notesEl: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly inputWrap: HTMLElement;
  private readonly outputWrap: HTMLElement;
  private readonly body: HTMLElement;
  private readonly seam: HTMLElement;
  private readonly controlsEl: HTMLElement;
  private readonly controlsExtra: HTMLElement;
  private readonly optionsMore: HTMLButtonElement;
  private optionsOpen = false;
  private readonly runBtn: HTMLButtonElement;
  private readonly optionsBar: HTMLElement;
  private readonly prettySeg: HTMLElement;
  private readonly zoomBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly detectChip: HTMLButtonElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly modeIcon: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly descEl: HTMLElement;
  private readonly inputMeta: HTMLElement;
  private readonly linkChip: HTMLElement;
  private readonly outputLabel: HTMLElement;
  private readonly findBox: HTMLElement;
  private readonly findInput: HTMLInputElement;
  private readonly findCount: HTMLElement;
  private readonly explain: ExplainPanel;
  private runTimer: number | undefined;
  private runSeq = 0;
  private viewCleanup: (() => void) | undefined;
  private lastResult: ModeResult = { output: '' };
  private findIndex = 0;
  /** Option keys written by auto-detect; removed again on Clear or a manual tool pick. */
  private detectedOptionKeys: string[] = [];

  constructor(
    readonly node: PaneNode,
    private readonly board: BoardActions,
  ) {
    const s = node.state;

    // ---- title bar --------------------------------------------------------
    this.titleEl = h('button.pane-name', { type: 'button', title: 'Rename this pane (double-click)' });
    this.titleEl.addEventListener('dblclick', () => board.rename(node.id));
    this.titleEl.addEventListener('click', () => this.textarea.focus());
    this.modeIcon = h('span.mode-icon');
    this.modeSelect = h<HTMLSelectElement>('select.mode-select', { 'aria-label': 'Tool', title: 'Switch tool (Alt+Shift+M)' });
    for (const cat of CATEGORIES) {
      const group = h<HTMLOptGroupElement>('optgroup', { label: cat });
      for (const m of MODES.filter((m) => m.category === cat)) group.append(h('option', { value: m.id }, m.label));
      if (group.childElementCount) this.modeSelect.append(group);
    }
    this.modeSelect.value = s.mode;
    this.modeSelect.addEventListener('change', () => this.setMode(this.modeSelect.value));
    this.descEl = h('span.mode-desc');

    // Maximise / split / close live in the ⋯ menu; on multi-pane boards the
    // board sets data-panes="many" and CSS shows them as icons too (.multi).
    this.zoomBtn = ibtn('maximize', 'Maximise this pane (Alt+Shift+Enter)', () => board.zoom(node.id), 'zoom-btn.multi');
    const explainBtn = tbtn('bulb', 'Explain', 'What is this input? Local analysis, no server (Alt+Shift+E)', () => this.toggleExplain());
    const moreBtn = ibtn('settings', 'Pane menu: layout, maximise, split, close…', (e) => this.openMenu(e.currentTarget as HTMLElement), 'more-btn');
    const addRightBtn = ibtn('splitRight', 'Add pane to the right (Alt+Shift+R)', () => board.addRight(node.id), 'multi');
    const addBelowBtn = ibtn('splitDown', 'Add pane below (Alt+Shift+B)', () => board.addBelow(node.id), 'multi');
    this.closeBtn = ibtn('close', 'Close pane (Alt+Shift+W)', () => board.close(node.id), 'close.multi');

    const title = h(
      'header.pane-title',
      {},
      this.titleEl,
      h('label.mode-picker', {}, this.modeIcon, this.modeSelect, icon('chevronDown', 12)),
      this.descEl,
      h('span.spacer'),
      explainBtn,
      moreBtn,
      h('span.divider.multi'),
      this.zoomBtn,
      addRightBtn,
      addBelowBtn,
      this.closeBtn,
    );

    // ---- options bar --------------------------------------------------------
    this.prettySeg = h('div.segmented', { role: 'group', 'aria-label': 'Output style' });
    for (const [val, label, tip] of [
      [true, 'Pretty', 'Formatted / structured output (Alt+Shift+P toggles)'],
      [false, 'Raw', 'Minified / literal output (Alt+Shift+P toggles)'],
    ] as const) {
      const b = h('button', { type: 'button', title: tip, 'data-pretty': String(val) }, label);
      b.addEventListener('click', () => {
        if (this.node.state.pretty !== val) this.togglePretty();
      });
      this.prettySeg.append(b);
    }
    this.controlsEl = h('div.mode-controls');
    this.controlsExtra = h('div.mode-controls.mode-controls-extra', { hidden: true });
    this.optionsMore = h<HTMLButtonElement>('button.btn.small.options-more', { type: 'button', 'aria-expanded': 'false', title: 'More options for this tool' }, h('span', {}, 'Options'), icon('chevronDown', 12));
    this.optionsMore.addEventListener('click', () => this.toggleOptions());
    this.runBtn = h<HTMLButtonElement>('button.btn.primary.run-btn', { type: 'button', title: 'Run now (⌘/Ctrl+Enter) · Shift+click runs and copies the output' });
    this.runBtn.addEventListener('click', (e) => this.runPrimary(e.shiftKey));
    this.optionsBar = h('div.pane-options', {}, h('div.options-row', {}, this.prettySeg, this.controlsEl, this.optionsMore, h('span.spacer'), this.runBtn), this.controlsExtra);

    // ---- input panel --------------------------------------------------------
    const makeEditor = (which: 'a' | 'b'): [HTMLTextAreaElement, HTMLElement] => {
      const ta = h<HTMLTextAreaElement>('textarea.editor', {
        spellcheck: 'false',
        autocapitalize: 'off',
        autocomplete: 'off',
        wrap: 'off',
        'aria-label': which === 'a' ? 'Input' : 'Second input',
        placeholder: this.placeholderFor(which),
      });
      const gutter = h('div.gutter', { 'aria-hidden': 'true' });
      ta.value = which === 'a' ? s.input : (s.inputB ?? '');
      ta.addEventListener('input', () => this.onInput());
      ta.addEventListener('focus', () => (this.target = which));
      ta.addEventListener('scroll', () => (gutter.style.transform = `translateY(${-ta.scrollTop}px)`));
      ta.addEventListener('keydown', (e) => {
        // Tab inserts a literal tab instead of moving focus — it's an editor.
        if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          const { selectionStart: a, selectionEnd: b } = ta;
          ta.setRangeText('\t', a, b, 'end');
          this.onInput();
        }
      });
      return [ta, gutter];
    };
    [this.textarea, this.gutter] = makeEditor('a');
    [this.textareaB, this.gutterB] = makeEditor('b');
    this.swapBtn = tbtn('swapAb', 'Swap', 'Swap the two inputs', () => this.swapInputs());
    this.swapBtn.hidden = true;
    this.labelA = h('span.editor-label', {}, 'A');
    this.labelB = h('span.editor-label', {}, 'B');

    const fileInput = h<HTMLInputElement>('input', { type: 'file', hidden: true, accept: '.txt,.json,.xml,.yaml,.yml,.csv,.tsv,.css,.html,.htm,.md,.sql,.b64,.jwt,.log,text/*,application/json' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void this.loadFile(f);
      fileInput.value = '';
    });
    this.fileInput = fileInput;
    this.inputMeta = h('span.panel-meta');
    this.linkChip = h('button.chip.link-chip', { type: 'button', hidden: true, title: 'Input is piped from another pane — click to unlink' });
    this.linkChip.addEventListener('click', () => board.link(node.id, null));
    this.detectChip = h<HTMLButtonElement>('button.chip.detect-chip', { type: 'button', hidden: true, title: 'Auto detect chose this tool — click to pick another' });
    this.detectChip.addEventListener('click', () => document.dispatchEvent(new CustomEvent('c64:palette')));
    const inputHead = h(
      'div.panel-head',
      {},
      h('span.panel-label', {}, 'Input'),
      this.linkChip,
      this.detectChip,
      this.inputMeta,
      h('span.spacer'),
      this.swapBtn,
      tbtn('paste', 'Paste', 'Paste from clipboard', () => void this.pasteFromClipboard()),
      tbtn('upload', 'Upload', 'Open a local file — it never leaves your browser', () => fileInput.click()),
      tbtn('clear', 'Clear', 'Clear the input and return to Auto detect', () => this.clearInput()),
      fileInput,
    );
    this.editorsEl = h(
      'div.editors',
      {},
      h('div.editor-wrap', {}, this.labelA, this.gutter, this.textarea),
      h('div.editor-wrap.editor-b', {}, this.labelB, this.gutterB, this.textareaB),
    );
    this.inputWrap = h('div.panel.pane-input', {}, inputHead, this.editorsEl);

    // ---- seam --------------------------------------------------------------
    this.seam = h('div.seam.seam-inner', {
      role: 'separator',
      'aria-label': 'Resize input and output',
      tabindex: '0',
      title: 'Drag to resize · arrow keys nudge · double-click to reset',
    });
    this.bindInnerSeam(this.seam);

    // ---- output panel --------------------------------------------------------
    this.output = h<HTMLPreElement>('pre.output', { tabindex: '0', 'aria-label': 'Output' });
    this.viewHost = h('div.view-host', { hidden: true });
    this.errorBox = h('div.error', { role: 'alert', hidden: true });
    this.errorBox.addEventListener('click', () => this.jumpToError());
    this.notesEl = h('div.notes', { hidden: true });
    this.statusEl = h('span.panel-meta.status');
    this.outputLabel = h('span.panel-label', {}, 'Output');
    this.findInput = h<HTMLInputElement>('input.find-input', { type: 'search', placeholder: 'Find in output…', 'aria-label': 'Find in output', spellcheck: 'false' });
    this.findCount = h('span.find-count');
    this.findInput.addEventListener('input', () => this.applyFind(0));
    this.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.applyFind(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        this.toggleFind(false);
        this.output.focus();
      }
    });
    const findClose = ibtn('close', 'Close find', () => this.toggleFind(false));
    this.findBox = h('div.find-box', { hidden: true }, icon('find', 13), this.findInput, this.findCount, findClose);
    const outputHead = h(
      'div.panel-head',
      {},
      this.outputLabel,
      this.statusEl,
      h('span.spacer'),
      this.findBox,
      tbtn('copy', 'Copy', 'Copy output (Alt+Shift+C)', () => void this.copyOutput()),
      tbtn('pipe', 'Send on', 'Open a new pane that keeps reading this output (a pipe)', () => this.sendOn()),
      ibtn('settings', 'More output actions: find, download', (e) =>
        menu(e.currentTarget as HTMLElement, [
          { icon: 'find', label: 'Find in output', keys: 'Alt+Shift+F', run: () => this.toggleFind(true) },
          { icon: 'download', label: 'Download output', run: () => this.downloadOutput() },
        ]),
      'output-more'),
    );
    this.outputWrap = h('div.panel.pane-output', {}, outputHead, this.errorBox, this.notesEl, this.output, this.viewHost);

    // ---- empty-state picker ---------------------------------------------------
    this.picker = this.buildPicker();

    this.body = h('div.pane-body', {}, this.inputWrap, this.seam, this.outputWrap, this.picker);
    this.explain = new ExplainPanel({
      getInput: () => this.node.state.input,
      apply: (mode, opts) => {
        if (opts) Object.assign(this.node.state.options, opts);
        this.setMode(mode);
        this.textarea.focus();
      },
    });
    this.infoPanel = h('aside.tool-info', { hidden: true, role: 'dialog', 'aria-label': 'About this tool' });
    this.el = h('section.pane', { 'data-pane-id': node.id, tabindex: '-1', role: 'region' }, title, this.optionsBar, this.body, this.explain.el, this.infoPanel);
    this.bindDrop();

    this.renderControls();
    this.applyDual();
    this.applyLayout();
    this.applySeam();
    this.applyWrap();
    this.updatePrettyButton();
    this.updateEmptyState();
    this.updateInputMeta();
    this.refreshLink();
    this.refreshDetectChip();
    this.runNow();
  }

  private placeholderFor(which: 'a' | 'b'): string {
    if (which === 'b') return 'Paste here, drop a file, or type…';
    if (this.node.state.sourceId) return 'Waiting for output from the linked pane…';
    return this.node.state.mode === 'auto'
      ? 'Paste anything — JSON, JWT, Base64, XML, YAML, CSV, a URL…\nc64 detects the format and picks the tool. Drop a file or press Ctrl+V.'
      : 'Paste here, drop a file, or type…';
  }

  /* ---------------------------------------------------------- accessors */

  get mode(): ToolMode {
    return getMode(this.node.state.mode);
  }

  /** True when the current tool takes two inputs (A / B editors). */
  get dual(): boolean {
    return this.mode.inputs === 2;
  }

  /** Show or hide the second editor to match the current tool. */
  private applyDual(): void {
    const dual = this.dual;
    this.editorsEl.classList.toggle('is-dual', dual);
    const [a, b] = this.mode.inputLabels ?? ['A', 'B'];
    this.labelA.textContent = a;
    this.labelB.textContent = b;
    this.labelA.hidden = !dual;
    this.labelB.hidden = !dual;
    this.textareaB.value = dual ? (this.node.state.inputB ?? '') : this.textareaB.value;
    this.textareaB.setAttribute('aria-label', dual ? `Input ${b}` : 'Second input');
    this.textarea.setAttribute('aria-label', dual ? `Input ${a}` : 'Input');
    this.swapBtn.hidden = !dual;
    if (!dual) this.target = 'a';
    this.renderGutter();
    if (!this.infoPanel.hidden) this.renderInfo();
  }

  get outputText(): string {
    return this.lastResult.output;
  }

  get result(): ModeResult {
    return this.lastResult;
  }

  focus(): void {
    this.textarea.focus({ preventScroll: true });
  }

  /** Called by the board when structure changes: close state, zoom icon, title. */
  refreshChrome(): void {
    const can = this.board.canClose();
    this.closeBtn.disabled = !can;
    this.closeBtn.title = can ? 'Close pane (Alt+Shift+W)' : 'The last pane cannot be closed';
    const zoomed = this.board.isZoomed(this.node.id);
    this.zoomBtn.replaceChildren(icon(zoomed ? 'minimize' : 'maximize'));
    this.zoomBtn.title = zoomed ? 'Restore all panes (Alt+Shift+Enter)' : 'Maximise this pane (Alt+Shift+Enter)';
    this.zoomBtn.setAttribute('aria-label', this.zoomBtn.title);
    this.zoomBtn.hidden = !can && !zoomed;
  }

  setTitle(text: string): void {
    this.titleEl.textContent = text;
    this.el.setAttribute('aria-label', text);
  }

  /** Reflect the pipe state (chip + read-only editor). */
  refreshLink(): void {
    const src = this.node.state.sourceId;
    this.linkChip.hidden = !src;
    this.textarea.readOnly = !!src;
    this.textarea.placeholder = this.placeholderFor('a');
    if (src) this.linkChip.replaceChildren(icon('pipe', 12), h('span', {}, `from ${this.board.titleOf(src)}`), icon('close', 11));
  }

  /** "Detected JSON · change" chip in the input head while Auto's choice stands. */
  private refreshDetectChip(): void {
    const on = this.node.state.detected === true && this.node.state.mode !== 'auto';
    this.detectChip.hidden = !on;
    if (on) this.detectChip.replaceChildren(icon('sparkle', 12), h('span', {}, `Detected ${detectedName(this.node.state.mode) ?? this.mode.label} · change`));
  }

  destroy(): void {
    if (this.runTimer !== undefined) clearTimeout(this.runTimer);
    this.viewCleanup?.();
    this.el.remove();
  }

  /* ------------------------------------------------------------ actions */

  /**
   * Switch tool. A manual choice (sidebar, select, chips, palette, Explain)
   * clears `detected`; Auto detect passes `detected: true` so the chip shows.
   */
  setMode(id: string, opts: { detected?: boolean } = {}): void {
    if (opts.detected !== true) this.forgetDetectedOptions();
    this.node.state.mode = id;
    this.node.state.detected = opts.detected === true ? true : undefined;
    this.modeSelect.value = id;
    this.renderControls();
    this.applyDual();
    this.updateInputMeta();
    this.updateEmptyState();
    this.refreshDetectChip();
    this.textarea.placeholder = this.placeholderFor('a');
    this.board.changed();
    this.runNow();
  }

  setInput(text: string, which: 'a' | 'b' = 'a'): void {
    const ta = which === 'b' ? this.textareaB : this.textarea;
    if (ta.value === text) return;
    ta.value = text;
    this.onInput();
  }

  insertSample(): void {
    if (this.node.state.sourceId) this.board.link(this.node.id, null);
    if (this.mode.sampleOptions) {
      Object.assign(this.node.state.options, this.mode.sampleOptions);
      this.renderControls();
    }
    this.setInput(this.mode.sample);
    if (this.dual) this.setInput(this.mode.sampleB ?? '', 'b');
    this.textarea.focus();
    toast(`Sample ${this.mode.label} inserted`);
  }

  /** Empty the editor(s) and return the pane to Auto detect. */
  clearInput(): void {
    if (this.node.state.sourceId) this.board.link(this.node.id, null);
    this.setInput('');
    if (this.dual) this.setInput('', 'b');
    if (this.node.state.mode !== 'auto') this.setMode('auto');
    this.textarea.focus();
  }

  /** Primary action button: run now and flash the output; Shift copies it too. */
  runPrimary(copy = false): void {
    this.runNow();
    const out = this.outputWrap;
    out.classList.remove('flash');
    void out.offsetWidth;
    out.classList.add('flash');
    setTimeout(() => out.classList.remove('flash'), 300);
    if (copy) setTimeout(() => void this.copyOutput(), 0);
  }

  private toggleOptions(force?: boolean): void {
    this.optionsOpen = force ?? !this.optionsOpen;
    this.controlsExtra.hidden = !this.optionsOpen;
    this.optionsMore.setAttribute('aria-expanded', String(this.optionsOpen));
    this.optionsMore.classList.toggle('is-open', this.optionsOpen);
  }

  togglePretty(): void {
    this.node.state.pretty = !this.node.state.pretty;
    this.updatePrettyButton();
    this.board.changed();
    this.runNow();
  }

  toggleLayout(): void {
    this.node.state.layout = this.node.state.layout === 'side' ? 'stacked' : 'side';
    this.applyLayout();
    this.board.changed();
    toast(this.node.state.layout === 'side' ? 'Input beside output' : 'Input above output');
  }

  toggleWrap(): void {
    this.node.state.wrap = !this.node.state.wrap;
    this.applyWrap();
    this.board.changed();
    toast(this.node.state.wrap ? 'Wrapping long lines' : 'Long lines scroll');
  }

  /** Two-input tools: exchange A and B. */
  swapInputs(): void {
    if (!this.dual) return;
    const a = this.textarea.value;
    this.textarea.value = this.textareaB.value;
    this.textareaB.value = a;
    this.onInput();
    toast('Inputs swapped');
  }

  toggleInfo(force?: boolean): void {
    const open = force ?? this.infoPanel.hidden;
    this.infoPanel.hidden = !open;
    if (open) {
      this.renderInfo();
      this.infoPanel.querySelector<HTMLElement>('button')?.focus();
    }
  }

  /** The "?" panel: what the tool does, its options, keywords and a docs link. */
  private renderInfo(): void {
    const m = this.mode;
    const s = this.node.state;
    const close = ibtn('close', 'Close', () => this.toggleInfo(false));
    const optionValue = (c: (typeof m.controls)[number]): string => {
      const v = s.options[c.key];
      if (c.kind === 'toggle') return (typeof v === 'boolean' ? v : c.default) ? 'on' : 'off';
      if (c.kind === 'select') return c.options.find((o) => o.value === (typeof v === 'string' ? v : c.default))?.label ?? String(c.default);
      return typeof v === 'string' && v ? v : c.default || '—';
    };
    const rows = m.controls.map((c) => h('tr', {}, h('td', {}, c.label), h('td', {}, h('code', {}, optionValue(c)))));
    const sample = h('button.btn.small', { type: 'button' }, icon('sparkle', 12), h('span', {}, 'Try the sample'));
    sample.addEventListener('click', () => this.insertSample());
    const docs = h<HTMLAnchorElement>('a.btn.small', { href: `https://github.com/adminbjkai/c64/blob/main/docs/modes.md#${m.category.toLowerCase().replace(/[^a-z]+/g, '-')}`, target: '_blank', rel: 'noopener' }, icon('external', 12), h('span', {}, 'Docs'));
    this.infoPanel.replaceChildren(
      h('div.explain-title', {}, icon(m.icon, 14), h('strong', {}, m.label), h('span.muted', {}, ` · ${m.category}`), h('span.spacer'), close),
      h(
        'div.explain-body',
        {},
        h('p.info-desc', {}, m.description),
        h('p.muted', {}, m.emptyHint),
        m.inputs === 2 ? h('p.muted', {}, `Takes two inputs: ${(m.inputLabels ?? ['A', 'B']).join(' and ')}.`) : null,
        rows.length ? h('table.info-options', {}, h('tbody', {}, ...rows)) : h('p.muted', {}, 'This tool has no options.'),
        m.supportsPretty ? h('p.muted', {}, 'Pretty shows the formatted result, Raw the minified or literal one.') : null,
        m.keywords?.length ? h('p.info-keywords', {}, ...m.keywords.map((k) => h('span.badge', {}, k))) : null,
        h('div.explain-suggestions', {}, sample, docs),
        h('p.muted.info-foot', {}, 'Runs entirely in this tab. Nothing you paste is sent anywhere.'),
      ),
    );
  }

  toggleExplain(): void {
    this.explain.toggle();
  }

  toggleFind(force?: boolean): void {
    const open = force ?? this.findBox.hidden;
    this.findBox.hidden = !open;
    if (open) {
      this.findInput.focus();
      this.findInput.select();
    } else {
      this.findInput.value = '';
      this.applyFind(0);
    }
  }

  sendOn(): void {
    this.board.sendOn(this.node.id);
  }

  async copyOutput(): Promise<void> {
    const text = this.outputText;
    if (!text) {
      toast('Nothing to copy yet');
      return;
    }
    toast((await copyText(text)) ? 'Output copied' : 'Copy failed — select the output and copy manually');
  }

  downloadOutput(): void {
    const text = this.outputText;
    if (!text) {
      toast('Nothing to download yet');
      return;
    }
    const s = this.node.state;
    const ext = outputExtension(this.mode, s.pretty, s.options);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h<HTMLAnchorElement>('a', { href: url, download: `c64-${this.mode.id}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return toast('Clipboard is empty');
      if (this.node.state.sourceId && this.target === 'a') this.board.link(this.node.id, null);
      this.setInput(text, this.dual ? this.target : 'a');
      (this.dual && this.target === 'b' ? this.textareaB : this.textarea).focus();
    } catch {
      toast('Clipboard access was blocked — press ⌘/Ctrl+V in the editor instead');
      this.textarea.focus();
    }
  }

  /** Run immediately, cancelling any pending debounced run ("Format now"). */
  runNow(): void {
    if (this.runTimer !== undefined) clearTimeout(this.runTimer);
    this.runTimer = undefined;
    const s = this.node.state;
    const seq = ++this.runSeq;
    const promise = runMode(s.mode, s.input, { pretty: s.pretty, options: s.options, ...(this.dual ? { inputB: s.inputB ?? '' } : {}) });
    // Large inputs go to the worker: show that something is happening only
    // if it takes noticeable time (no spinner flashes for instant runs).
    const slow = window.setTimeout(() => this.el.classList.add('is-busy'), 120);
    void promise.then((result) => {
      clearTimeout(slow);
      this.el.classList.remove('is-busy');
      if (seq !== this.runSeq) return; // a newer run superseded this one
      const changed = result.output !== this.lastResult.output;
      this.lastResult = result;
      this.renderResult(result);
      if (changed) this.board.outputChanged(this.node.id, result.output);
    });
  }

  /* ---------------------------------------------------------- internals */

  private openMenu(anchor: HTMLElement): void {
    const s = this.node.state;
    const others = this.board.otherPanes(this.node.id);
    const side = s.layout === 'side';
    const zoomed = this.board.isZoomed(this.node.id);
    const items: MenuItem[] = [
      { icon: 'help', label: 'About this tool', run: () => this.toggleInfo(true) },
      { icon: 'sparkle', label: `Try a ${this.mode.label} sample`, run: () => this.insertSample() },
      { sep: true },
      { icon: side ? 'rows' : 'columns', label: side ? 'Stack input above output' : 'Put input beside output', keys: 'Alt+Shift+L', run: () => this.toggleLayout() },
      { icon: zoomed ? 'minimize' : 'maximize', label: zoomed ? 'Restore all panes' : 'Maximise pane', keys: 'Alt+Shift+Enter', run: () => this.board.zoom(this.node.id) },
      { icon: 'wrap', label: s.wrap ? 'Stop wrapping lines' : 'Wrap long lines', keys: 'Alt+Shift+O', run: () => this.toggleWrap() },
      { sep: true },
      { icon: 'splitRight', label: 'Add pane to the right', keys: 'Alt+Shift+R', run: () => this.board.addRight(this.node.id) },
      { icon: 'splitDown', label: 'Add pane below', keys: 'Alt+Shift+B', run: () => this.board.addBelow(this.node.id) },
      { icon: 'duplicate', label: 'Duplicate pane', keys: 'Alt+Shift+D', run: () => this.board.duplicate(this.node.id) },
      { icon: 'edit', label: 'Rename pane…', run: () => this.board.rename(this.node.id) },
      { sep: true },
      { icon: 'pipe', label: 'Send output to a new pane', keys: 'Alt+Shift+N', run: () => this.sendOn() },
      ...(others.length
        ? [{ icon: 'pipe', label: 'Read input from…', children: others.map((o) => ({ label: o.title, run: () => this.board.link(this.node.id, o.id) })) }]
        : []),
      ...(s.sourceId ? [{ icon: 'close', label: 'Unlink input', run: () => this.board.link(this.node.id, null) }] : []),
      { sep: true },
      { icon: 'arrowLeft', label: 'Swap with previous pane', run: () => this.board.swap(this.node.id, -1) },
      { icon: 'arrowRight', label: 'Swap with next pane', run: () => this.board.swap(this.node.id, 1) },
      { sep: true },
      ...(this.board.canClose() ? [{ icon: 'close', label: 'Close pane', keys: 'Alt+Shift+W', run: () => this.board.close(this.node.id) }] : []),
    ];
    menu(anchor, items);
  }

  private onInput(): void {
    this.node.state.input = this.textarea.value;
    if (this.dual) this.node.state.inputB = this.textareaB.value || undefined;
    this.updateEmptyState();
    this.updateInputMeta();
    this.renderGutter();
    this.board.changed();
    this.explain.refresh();
    if ((this.node.state.mode === 'auto' || this.node.state.detected) && this.detect()) return; // setMode ran it
    if (this.runTimer !== undefined) clearTimeout(this.runTimer);
    this.runTimer = window.setTimeout(() => this.runNow(), DEBOUNCE_MS);
  }

  /** Drop the options auto-detect wrote so they never leak into a manual pick. */
  private forgetDetectedOptions(): void {
    for (const k of this.detectedOptionKeys) delete this.node.state.options[k];
    this.detectedOptionKeys = [];
  }

  /**
   * Auto detect: once the input is non-trivial, ask the Explain heuristics
   * what it is and switch to the matching tool (keeping `detected` so the
   * chip shows). While the pane is still in a detected (not manually chosen)
   * tool, typing more may change the verdict — e.g. a JWT looks like Base64
   * for its first characters. Returns true when the pane switched.
   */
  private detect(): boolean {
    const text = this.node.state.input.trim();
    if (text.length > DETECT_MAX_CHARS) return false;
    if (text.length < DETECT_MIN_CHARS && !(text.length >= 4 && /[{[<.%=]/.test(text))) return false;
    let d: ReturnType<typeof detectMode>;
    try {
      d = detectMode(explain(text));
    } catch {
      return false;
    }
    if (!d) return false;
    if (this.node.state.detected && d.mode === this.node.state.mode) return false;
    this.forgetDetectedOptions();
    if (d.options) {
      Object.assign(this.node.state.options, d.options);
      this.detectedOptionKeys = Object.keys(d.options);
    }
    this.setMode(d.mode, { detected: true });
    return true;
  }

  private insertAtCursor(text: string): void {
    const { selectionStart: a, selectionEnd: b } = this.textarea;
    this.textarea.setRangeText(text, a, b, 'end');
    this.onInput();
  }

  private async loadFile(f: File): Promise<void> {
    if (this.node.state.sourceId && this.target === 'a') this.board.link(this.node.id, null);
    const binary = f.type ? !/^text\/|json|xml|yaml|javascript|csv|sql|svg/i.test(f.type) : /\.(png|jpe?g|gif|webp|pdf|zip|gz|woff2?|mp3|mp4|ico|bin)$/i.test(f.name);
    if (binary || this.node.state.mode === 'data-url') {
      // Binary files become a data URL so the Data URL tool can inspect them.
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(f);
      });
      if (this.node.state.mode !== 'data-url' && MODES.some((m) => m.id === 'data-url')) this.setMode('data-url');
      this.setInput(url, this.dual ? this.target : 'a');
      toast(`Loaded ${f.name} (${f.size.toLocaleString()} bytes) as a data URL — stays in your browser`);
      return;
    }
    const text = await f.text();
    this.setInput(text, this.dual ? this.target : 'a');
    toast(`Loaded ${f.name} (${f.size.toLocaleString()} bytes) — stays in your browser`);
  }

  private setOption(key: string, value: unknown): void {
    this.node.state.options[key] = value;
    this.runBtn.textContent = primaryLabel(this.mode, this.node.state.options);
    this.board.changed();
    this.runNow();
  }

  private updateInputMeta(): void {
    const describe = (t: string) => {
      const lines = t.split('\n').length;
      return `${t.length.toLocaleString()} chars · ${lines.toLocaleString()} line${lines === 1 ? '' : 's'}`;
    };
    const a = this.node.state.input;
    const b = this.dual ? (this.node.state.inputB ?? '') : '';
    if (!a && !b) {
      this.inputMeta.textContent = '';
      return;
    }
    this.inputMeta.textContent = this.dual ? `A ${describe(a)} · B ${describe(b)}` : describe(a);
  }

  /* ---------------------------------------------------------------- gutter */

  private renderGutter(): void {
    this.renderOneGutter(this.gutter, this.textarea);
    if (this.dual) this.renderOneGutter(this.gutterB, this.textareaB);
  }

  private renderOneGutter(gutter: HTMLElement, ta: HTMLTextAreaElement): void {
    if (this.node.state.wrap) {
      gutter.hidden = true;
      return;
    }
    const text = ta.value;
    let n = 1;
    for (let i = 0; i < text.length && n <= GUTTER_MAX_LINES; i++) if (text.charCodeAt(i) === 10) n++;
    if (n > GUTTER_MAX_LINES) {
      gutter.hidden = true;
      return;
    }
    gutter.hidden = false;
    const current = gutter.childElementCount;
    if (current < n) {
      const frag = document.createDocumentFragment();
      for (let i = current + 1; i <= n; i++) frag.append(h('span', {}, String(i)));
      gutter.append(frag);
    } else {
      while (gutter.childElementCount > n) gutter.lastElementChild!.remove();
    }
    gutter.style.transform = `translateY(${-ta.scrollTop}px)`;
  }

  private applyWrap(): void {
    const wrap = this.node.state.wrap === true;
    this.textarea.wrap = wrap ? 'soft' : 'off';
    this.textareaB.wrap = wrap ? 'soft' : 'off';
    this.el.classList.toggle('is-wrap', wrap);
    this.renderGutter();
  }

  /* ---------------------------------------------------------------- find */

  private applyFind(step: number): void {
    const q = this.findInput.value;
    const text = this.lastResult.output;
    if (!q || !text || this.output.hidden) {
      this.paintOutput(text);
      this.findCount.textContent = q && !this.output.hidden ? '0' : '';
      return;
    }
    const lower = text.toLowerCase();
    const needle = q.toLowerCase();
    const hits: number[] = [];
    let i = lower.indexOf(needle);
    while (i !== -1 && hits.length < FIND_MAX_MARKS) {
      hits.push(i);
      i = lower.indexOf(needle, i + needle.length);
    }
    if (!hits.length) {
      this.paintOutput(text);
      this.findCount.textContent = '0';
      return;
    }
    this.findIndex = ((this.findIndex + step) % hits.length + hits.length) % hits.length;
    const frag = document.createDocumentFragment();
    let pos = 0;
    let currentMark: HTMLElement | null = null;
    hits.forEach((at, idx) => {
      frag.append(text.slice(pos, at));
      const m = h('mark', { class: idx === this.findIndex ? 'is-current' : undefined }, text.slice(at, at + q.length));
      if (idx === this.findIndex) currentMark = m;
      frag.append(m);
      pos = at + q.length;
    });
    frag.append(text.slice(pos));
    this.output.replaceChildren(frag);
    this.findCount.textContent = `${this.findIndex + 1}/${hits.length}${hits.length >= FIND_MAX_MARKS ? '+' : ''}`;
    (currentMark as HTMLElement | null)?.scrollIntoView({ block: 'center' });
  }

  /* ------------------------------------------------------------ controls */

  private renderControls(): void {
    this.controlsEl.replaceChildren();
    this.controlsExtra.replaceChildren();
    const s = this.node.state;
    const m = this.mode;
    this.modeIcon.replaceChildren(icon(m.icon, 16));
    this.descEl.textContent = m.description;
    // The first three options stay on the row; the rest fold behind "Options ▾".
    m.controls.forEach((c, i) => {
      const into = i < 3 ? this.controlsEl : this.controlsExtra;
      switch (c.kind) {
        case 'select': {
          const sel = h<HTMLSelectElement>('select.control', { 'aria-label': c.label, title: c.label });
          for (const o of c.options) sel.append(h('option', { value: o.value }, o.label));
          sel.value = typeof s.options[c.key] === 'string' ? (s.options[c.key] as string) : c.default;
          if (sel.value !== (s.options[c.key] ?? c.default)) sel.value = c.default;
          sel.addEventListener('change', () => this.setOption(c.key, sel.value));
          into.append(h('label.control-wrap', {}, h('span.control-label', {}, c.label), sel));
          break;
        }
        case 'toggle': {
          const on = typeof s.options[c.key] === 'boolean' ? (s.options[c.key] as boolean) : c.default;
          const btn = h('button.btn.toggle', { type: 'button', 'aria-pressed': String(on) }, icon('check', 12), h('span', {}, c.label));
          btn.addEventListener('click', () => {
            const next = btn.getAttribute('aria-pressed') !== 'true';
            btn.setAttribute('aria-pressed', String(next));
            this.setOption(c.key, next);
          });
          into.append(btn);
          break;
        }
        case 'text': {
          const input = h<HTMLInputElement>('input.control.text', {
            type: 'text',
            'aria-label': c.label,
            title: c.label,
            placeholder: c.placeholder,
            spellcheck: 'false',
          });
          input.value = typeof s.options[c.key] === 'string' ? (s.options[c.key] as string) : c.default;
          let t: number | undefined;
          input.addEventListener('input', () => {
            if (t !== undefined) clearTimeout(t);
            t = window.setTimeout(() => this.setOption(c.key, input.value), DEBOUNCE_MS);
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              if (t !== undefined) clearTimeout(t);
              this.setOption(c.key, input.value);
            }
          });
          into.append(h('label.control-wrap.grow', {}, h('span.control-label', {}, c.label), input));
          break;
        }
      }
    });
    this.prettySeg.hidden = !m.supportsPretty;
    this.optionsMore.hidden = m.controls.length <= 3;
    if (m.controls.length <= 3) this.toggleOptions(false);
    this.runBtn.textContent = primaryLabel(m, s.options);
  }

  private updatePrettyButton(): void {
    const pretty = this.node.state.pretty;
    for (const b of this.prettySeg.querySelectorAll<HTMLButtonElement>('button')) {
      b.setAttribute('aria-pressed', String((b.dataset['pretty'] === 'true') === pretty));
    }
  }

  private applyLayout(): void {
    const side = this.node.state.layout === 'side';
    this.body.classList.toggle('is-side', side);
    this.seam.setAttribute('aria-orientation', side ? 'vertical' : 'horizontal');
  }

  private updateEmptyState(): void {
    const empty = this.node.state.input === '' && !(this.dual && this.node.state.inputB);
    const auto = this.node.state.mode === 'auto';
    this.body.classList.toggle('is-empty', empty);
    this.picker.hidden = !empty;
    const chips = this.picker.querySelector<HTMLElement>('.start-chips');
    const ready = this.picker.querySelector<HTMLElement>('.picker-ready');
    if (chips) chips.hidden = !auto;
    if (ready) ready.hidden = auto;
    const hint = this.picker.querySelector<HTMLElement>('.picker-hint');
    if (hint) hint.textContent = this.mode.emptyHint;
  }

  /**
   * Empty-state strip under the editor. Two faces, one at a time:
   *   .start-chips  — Auto detect: a row of common tools + "All N tools ›";
   *   .picker-ready — any other tool: its hint and a "Try a sample" button.
   */
  private buildPicker(): HTMLElement {
    const chips = h('div.start-chips', { hidden: true });
    for (const [id, label] of START_CHIPS) {
      if (!MODES.some((m) => m.id === id)) continue;
      const chip = h('button.start-chip', { type: 'button', title: `Switch this pane to ${getMode(id).label}` }, label);
      chip.addEventListener('click', () => {
        this.setMode(id);
        this.textarea.focus();
      });
      chips.append(chip);
    }
    const all = h('button.start-chip.start-all', { type: 'button', title: 'Open the command palette (⌘/Ctrl+K)' }, `All ${MODES.length} tools ›`);
    all.addEventListener('click', () => document.dispatchEvent(new CustomEvent('c64:palette')));
    chips.append(all);

    const sampleBtn = h('button.btn.primary', { type: 'button' }, icon('sparkle', 14), h('span', {}, 'Try a sample'));
    sampleBtn.addEventListener('click', () => this.insertSample());
    const ready = h('div.picker-ready', { hidden: true }, h('p.picker-hint'), sampleBtn);
    return h('div.picker', { hidden: true }, chips, ready);
  }

  private renderResult(r: ModeResult): void {
    this.statusEl.textContent = r.status ?? '';
    this.statusEl.classList.toggle('is-error', !!r.error);

    // Tear down the previous rich view, if any.
    this.viewCleanup?.();
    this.viewCleanup = undefined;
    this.viewHost.replaceChildren();

    const renderer = r.view ? VIEWS[r.view.kind] : undefined;
    if (renderer && !r.error) {
      const ctx: ViewContext = {
        input: this.node.state.input,
        options: this.node.state.options,
        copy: (text, what) => void copyText(text).then((ok) => toast(ok ? `Copied ${what}` : 'Copy failed')),
        selectInEditor: (start, end) => this.selectInEditor(start, end),
        setOption: (key, value) => this.setOption(key, value),
        toast,
      };
      try {
        const cleanup = renderer(this.viewHost, r.view!.data, ctx);
        if (typeof cleanup === 'function') this.viewCleanup = cleanup;
        this.viewHost.hidden = false;
        this.output.hidden = true;
      } catch (e) {
        this.viewHost.hidden = true;
        this.output.hidden = false;
        this.paintOutput(r.output);
        r = { ...r, notes: [...(r.notes ?? []), `The rich view failed to render (${(e as Error).message}); showing text instead.`] };
      }
    } else {
      this.paintOutput(r.output);
      this.output.hidden = !!r.error;
      this.viewHost.hidden = true;
      if (this.findInput.value) this.applyFind(0);
    }
    const labels: Record<string, string> = {
      'json-tree': 'Tree', 'json-path': 'Tree & path', 'json-graph': 'Graph', jwt: 'Decoded token', table: 'Table',
      url: 'URL breakdown', 'case-all': 'All cases', hash: 'Digests', basen: 'Bases', timestamp: 'Dates', uuid: 'Decoded ids',
      diff: 'Differences', regex: 'Matches', markdown: 'Preview', stats: 'Statistics', cron: 'Schedule', color: 'Colors',
      'struct-diff': 'Differences', 'list-compare': 'Sets', 'schema-errors': 'Validation', qr: 'QR code', totp: 'One-time code',
      units: 'Conversions', subnet: 'Subnets', 'data-url': 'File', chmod: 'Permissions',
    };
    this.outputLabel.textContent = r.view && !r.error ? labels[r.view.kind] ?? 'Output' : 'Output';

    if (r.error) {
      const where = r.error.line ? ` — line ${r.error.line}, col ${r.error.col}` : '';
      this.errorBox.replaceChildren(h('strong', {}, r.error.message + where));
      if (r.error.hint) this.errorBox.append(h('span.hint', {}, r.error.hint));
      if (r.error.line) this.errorBox.append(h('span.jump', {}, 'Click to jump to it'));
      this.errorBox.hidden = false;
    } else {
      this.errorBox.hidden = true;
    }

    if (r.notes?.length) {
      this.notesEl.replaceChildren(...r.notes.map((n) => h('div', {}, n)));
      this.notesEl.hidden = false;
    } else {
      this.notesEl.hidden = true;
    }
  }

  /** Render text output with syntax colours for the mode's declared language. */
  private paintOutput(text: string): void {
    const m = this.mode;
    const s = this.node.state;
    const placeholder = text === '' && s.input.trim() === '' && !(this.dual && s.inputB);
    this.output.classList.toggle('is-placeholder', placeholder);
    if (placeholder) {
      this.output.textContent = 'Result appears here as you type.';
      return;
    }
    const lang = typeof m.outputLanguage === 'function' ? m.outputLanguage({ pretty: s.pretty, options: s.options }) : m.outputLanguage;
    highlightInto(this.output, text, lang);
  }

  /** Select a range in the editor and scroll it into view. */
  private selectInEditor(start: number, end: number): void {
    const ta = this.textarea;
    ta.setSelectionRange(start, end);
    const line = ta.value.slice(0, start).split('\n').length;
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (line - 3) * lineHeight);
    // Flash the editor so the selection is noticeable even when unfocused.
    this.inputWrap.classList.remove('flash');
    void this.inputWrap.offsetWidth;
    this.inputWrap.classList.add('flash');
    ta.focus({ preventScroll: true });
  }

  /** Put the caret at the error's line/col and focus the editor. */
  private jumpToError(): void {
    const e = this.lastResult.error;
    if (!e?.line) return;
    const lines = this.textarea.value.split('\n');
    let off = 0;
    for (let i = 0; i < e.line - 1 && i < lines.length; i++) off += lines[i]!.length + 1;
    off += Math.max(0, (e.col ?? 1) - 1);
    this.selectInEditor(off, off);
  }

  /* ---------------------------------------------------------- drag & drop */

  private bindDrop(): void {
    let depth = 0;
    this.el.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      this.el.classList.add('is-dropping');
    });
    this.el.addEventListener('dragleave', () => {
      if (--depth <= 0) {
        depth = 0;
        this.el.classList.remove('is-dropping');
      }
    });
    this.el.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    this.el.addEventListener('drop', (e) => {
      depth = 0;
      this.el.classList.remove('is-dropping');
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      void this.loadFile(f);
    });
  }

  /* --------------------------------------------------------- inner seam */

  private applySeam(): void {
    const f = this.node.state.seam;
    this.inputWrap.style.flexGrow = String(f);
    this.outputWrap.style.flexGrow = String(1 - f);
  }

  private setSeam(f: number): void {
    this.node.state.seam = Math.min(SEAM_MAX, Math.max(SEAM_MIN, f));
    this.applySeam();
  }

  private bindInnerSeam(seam: HTMLElement): void {
    seam.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      seam.setPointerCapture(e.pointerId);
      const side = this.node.state.layout === 'side';
      const rect = this.body.getBoundingClientRect();
      const seamPx = side ? seam.offsetWidth : seam.offsetHeight;
      const usable = (side ? rect.width : rect.height) - seamPx;
      document.body.classList.add('dragging', side ? 'dragging-row' : 'dragging-col');
      const move = (ev: PointerEvent) => {
        const pos = side ? ev.clientX - rect.left : ev.clientY - rect.top;
        this.setSeam((pos - seamPx / 2) / usable);
      };
      const up = () => {
        seam.removeEventListener('pointermove', move);
        seam.removeEventListener('pointerup', up);
        seam.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging', 'dragging-row', 'dragging-col');
        this.board.changed();
      };
      seam.addEventListener('pointermove', move);
      seam.addEventListener('pointerup', up);
      seam.addEventListener('pointercancel', up);
    });
    seam.addEventListener('dblclick', () => {
      this.setSeam(0.5);
      this.board.changed();
    });
    seam.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.03;
      const side = this.node.state.layout === 'side';
      const dec = side ? 'ArrowLeft' : 'ArrowUp';
      const inc = side ? 'ArrowRight' : 'ArrowDown';
      if (e.key === dec) this.setSeam(this.node.state.seam - step);
      else if (e.key === inc) this.setSeam(this.node.state.seam + step);
      else if (e.key === 'Home') this.setSeam(SEAM_MIN);
      else if (e.key === 'End') this.setSeam(SEAM_MAX);
      else return;
      e.preventDefault();
      this.board.changed();
    });
  }
}
