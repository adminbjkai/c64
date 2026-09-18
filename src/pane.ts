/**
 * PaneView — one tool instance. Structure (top → bottom):
 *
 *   ┌ title bar   : tool icon + name (a dropdown), description, Explain, split/close
 *   ├ options bar : Pretty | Raw segmented control, mode-specific options, layout toggle
 *   ├ INPUT panel : label, counters, Paste · Upload · Sample · Clear, the editor
 *   ├ seam        : draggable (horizontal when stacked, vertical when side-by-side)
 *   └ OUTPUT panel: label, status, Copy · Download, the result (text or rich view)
 *
 * An empty pane shows a tool picker under the editor instead of the output,
 * so a fresh pane is self-explanatory. A PaneView owns its DOM for the life
 * of the pane; the board re-parents it when the layout changes, so typing,
 * scroll and focus survive structural edits.
 */

import type { PaneNode } from './layout.js';
import { MODES, getMode, type ModeResult, type ToolMode } from './modes/index.js';
import { VIEWS, type ViewContext } from './views/index.js';
import { runMode } from './runner.js';
import { ExplainPanel } from './explain-ui.js';
import { icon } from './icons.js';
import { h, toast, copyText } from './ui.js';

/** What a pane needs from the board. Kept minimal so pane.ts stays decoupled. */
export interface BoardActions {
  addRight(paneId: string): void;
  addBelow(paneId: string): void;
  close(paneId: string): void;
  canClose(): boolean;
  /** Something in this pane's persisted state changed. */
  changed(): void;
}

const DEBOUNCE_MS = 180;
/** Seam can't be dragged past these so both editor and output stay usable. */
const SEAM_MIN = 0.1;
const SEAM_MAX = 0.9;

const CATEGORY_ORDER = ['JSON', 'Formats', 'Encoding', 'Text'] as const;

/** File extension for "Download output" per mode / state. */
function outputExtension(mode: ToolMode, pretty: boolean, options: Record<string, unknown>): string {
  switch (mode.id) {
    case 'json': case 'json-tree': case 'json-path': case 'json-graph': case 'jwt': return 'json';
    case 'xml': return 'xml';
    case 'yaml': return pretty ? 'yaml' : 'json';
    case 'csv': return 'csv';
    case 'css': return 'css';
    case 'convert': return typeof options['to'] === 'string' ? (options['to'] as string) : 'txt';
    default: return 'txt';
  }
}

/** Icon-and-label button used across the pane toolbars. */
function tbtn(iconName: string, label: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h<HTMLButtonElement>(`button.btn.tb${cls ? '.' + cls : ''}`, { type: 'button', title }, icon(iconName, 14), h('span', {}, label));
  b.addEventListener('click', onClick);
  return b;
}

export class PaneView {
  readonly el: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly output: HTMLPreElement;
  private readonly viewHost: HTMLElement;
  private readonly errorBox: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly notesEl: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly inputWrap: HTMLElement;
  private readonly outputWrap: HTMLElement;
  private readonly body: HTMLElement;
  private readonly seam: HTMLElement;
  private readonly controlsEl: HTMLElement;
  private readonly optionsBar: HTMLElement;
  private readonly prettySeg: HTMLElement;
  private readonly layoutBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly modeIcon: HTMLElement;
  private readonly descEl: HTMLElement;
  private readonly inputMeta: HTMLElement;
  private readonly outputLabel: HTMLElement;
  private readonly explain: ExplainPanel;
  private runTimer: number | undefined;
  private runSeq = 0;
  private viewCleanup: (() => void) | undefined;
  private lastResult: ModeResult = { output: '' };

  constructor(
    readonly node: PaneNode,
    private readonly board: BoardActions,
  ) {
    const s = node.state;

    // ---- title bar --------------------------------------------------------
    this.modeIcon = h('span.mode-icon');
    this.modeSelect = h<HTMLSelectElement>('select.mode-select', { 'aria-label': 'Tool', title: 'Switch tool (Alt+Shift+M)' });
    for (const cat of CATEGORY_ORDER) {
      const group = h<HTMLOptGroupElement>('optgroup', { label: cat });
      for (const m of MODES.filter((m) => m.category === cat)) group.append(h('option', { value: m.id }, m.label));
      this.modeSelect.append(group);
    }
    this.modeSelect.value = s.mode;
    this.modeSelect.addEventListener('change', () => this.setMode(this.modeSelect.value));
    this.descEl = h('span.mode-desc');

    this.layoutBtn = h<HTMLButtonElement>('button.btn.icon', { type: 'button' });
    this.layoutBtn.addEventListener('click', () => this.toggleLayout());
    const explainBtn = tbtn('bulb', 'Explain', 'What is this input? Local analysis, no server (Alt+Shift+E)', () => this.toggleExplain());
    const addRightBtn = h('button.btn.icon', { type: 'button', title: 'Add pane to the right (Alt+Shift+R)', 'aria-label': 'Add pane right' }, icon('splitRight'));
    addRightBtn.addEventListener('click', () => board.addRight(node.id));
    const addBelowBtn = h('button.btn.icon', { type: 'button', title: 'Add pane below (Alt+Shift+B)', 'aria-label': 'Add pane below' }, icon('splitDown'));
    addBelowBtn.addEventListener('click', () => board.addBelow(node.id));
    this.closeBtn = h<HTMLButtonElement>('button.btn.icon.close', { type: 'button', title: 'Close pane (Alt+Shift+W)', 'aria-label': 'Close pane' }, icon('close'));
    this.closeBtn.addEventListener('click', () => board.close(node.id));

    const title = h(
      'header.pane-title',
      {},
      h('label.mode-picker', {}, this.modeIcon, this.modeSelect),
      this.descEl,
      h('span.spacer'),
      explainBtn,
      this.layoutBtn,
      h('span.divider'),
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
    this.optionsBar = h('div.pane-options', {}, this.prettySeg, this.controlsEl);

    // ---- input panel --------------------------------------------------------
    this.textarea = h<HTMLTextAreaElement>('textarea.editor', {
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      wrap: 'off',
      'aria-label': 'Input',
      placeholder: 'Paste here, drop a file, or type…',
    });
    this.textarea.value = s.input;
    this.textarea.addEventListener('input', () => this.onInput());
    this.textarea.addEventListener('keydown', (e) => {
      // Tab inserts a literal tab instead of moving focus — it's an editor.
      if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        this.insertAtCursor('\t');
      }
    });

    const fileInput = h<HTMLInputElement>('input', { type: 'file', hidden: true, accept: '.txt,.json,.xml,.yaml,.yml,.csv,.tsv,.css,.b64,.jwt,text/*,application/json' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void this.loadFile(f);
      fileInput.value = '';
    });
    this.inputMeta = h('span.panel-meta');
    const inputHead = h(
      'div.panel-head',
      {},
      h('span.panel-label', {}, 'Input'),
      this.inputMeta,
      h('span.spacer'),
      tbtn('paste', 'Paste', 'Paste from clipboard', () => void this.pasteFromClipboard()),
      tbtn('upload', 'Upload', 'Open a local file — it never leaves your browser', () => fileInput.click()),
      tbtn('sparkle', 'Sample', 'Insert an example for this tool', () => this.insertSample()),
      tbtn('clear', 'Clear', 'Clear the input', () => this.clearInput()),
      fileInput,
    );
    this.inputWrap = h('div.panel.pane-input', {}, inputHead, this.textarea);

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
    const outputHead = h(
      'div.panel-head',
      {},
      this.outputLabel,
      this.statusEl,
      h('span.spacer'),
      tbtn('copy', 'Copy', 'Copy output (Alt+Shift+C)', () => void this.copyOutput()),
      tbtn('download', 'Download', 'Save the output as a file', () => this.downloadOutput()),
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
    this.el = h('section.pane', { 'data-pane-id': node.id, tabindex: '-1' }, title, this.optionsBar, this.body, this.explain.el);
    this.bindDrop();

    this.renderControls();
    this.applyLayout();
    this.applySeam();
    this.updatePrettyButton();
    this.updateEmptyState();
    this.updateInputMeta();
    this.runNow();
  }

  /* ---------------------------------------------------------- accessors */

  get mode(): ToolMode {
    return getMode(this.node.state.mode);
  }

  get outputText(): string {
    return this.lastResult.output;
  }

  focus(): void {
    this.textarea.focus();
  }

  /** Called by the board when the pane count changes: last pane can't close. */
  refreshCloseState(): void {
    const can = this.board.canClose();
    this.closeBtn.disabled = !can;
    this.closeBtn.title = can ? 'Close pane (Alt+Shift+W)' : 'The last pane cannot be closed';
  }

  /* ------------------------------------------------------------ actions */

  setMode(id: string): void {
    this.node.state.mode = id;
    this.modeSelect.value = id;
    this.renderControls();
    this.updateEmptyState();
    this.board.changed();
    this.runNow();
  }

  setInput(text: string): void {
    this.textarea.value = text;
    this.onInput();
  }

  insertSample(): void {
    this.setInput(this.mode.sample);
    this.textarea.focus();
    toast(`Sample ${this.mode.label} inserted`);
  }

  clearInput(): void {
    this.setInput('');
    this.textarea.focus();
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
  }

  toggleExplain(): void {
    this.explain.toggle();
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
    const a = h<HTMLAnchorElement>('a', { href: url, download: `c64-output.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return toast('Clipboard is empty');
      this.setInput(text);
      this.textarea.focus();
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
    const promise = runMode(s.mode, s.input, { pretty: s.pretty, options: s.options });
    // Large inputs go to the worker: show that something is happening only
    // if it takes noticeable time (spec: no spinners under ~50 ms).
    const slow = window.setTimeout(() => this.el.classList.add('is-busy'), 120);
    void promise.then((result) => {
      clearTimeout(slow);
      this.el.classList.remove('is-busy');
      if (seq !== this.runSeq) return; // a newer run superseded this one
      this.lastResult = result;
      this.renderResult(result);
    });
  }

  /* ---------------------------------------------------------- internals */

  private onInput(): void {
    this.node.state.input = this.textarea.value;
    this.updateEmptyState();
    this.updateInputMeta();
    this.board.changed();
    this.explain.refresh();
    if (this.runTimer !== undefined) clearTimeout(this.runTimer);
    this.runTimer = window.setTimeout(() => this.runNow(), DEBOUNCE_MS);
  }

  private insertAtCursor(text: string): void {
    const { selectionStart: a, selectionEnd: b } = this.textarea;
    this.textarea.setRangeText(text, a, b, 'end');
    this.onInput();
  }

  private async loadFile(f: File): Promise<void> {
    const text = await f.text();
    this.setInput(text);
    toast(`Loaded ${f.name} (${f.size.toLocaleString()} bytes) — stays in your browser`);
  }

  private setOption(key: string, value: unknown): void {
    this.node.state.options[key] = value;
    this.board.changed();
    this.runNow();
  }

  private updateInputMeta(): void {
    const t = this.node.state.input;
    if (!t) {
      this.inputMeta.textContent = '';
      return;
    }
    const lines = t.split('\n').length;
    this.inputMeta.textContent = `${t.length.toLocaleString()} chars · ${lines.toLocaleString()} line${lines === 1 ? '' : 's'}`;
  }

  private renderControls(): void {
    this.controlsEl.replaceChildren();
    const s = this.node.state;
    const m = this.mode;
    this.modeIcon.replaceChildren(icon(m.icon, 16));
    this.descEl.textContent = m.description;
    for (const c of m.controls) {
      switch (c.kind) {
        case 'select': {
          const sel = h<HTMLSelectElement>('select.control', { 'aria-label': c.label, title: c.label });
          for (const o of c.options) sel.append(h('option', { value: o.value }, o.label));
          sel.value = typeof s.options[c.key] === 'string' ? (s.options[c.key] as string) : c.default;
          sel.addEventListener('change', () => this.setOption(c.key, sel.value));
          this.controlsEl.append(h('label.control-wrap', {}, h('span.control-label', {}, c.label), sel));
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
          this.controlsEl.append(btn);
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
          this.controlsEl.append(h('label.control-wrap.grow', {}, h('span.control-label', {}, c.label), input));
          break;
        }
        case 'file':
          // The Input panel always has an Upload button now; mode-level file
          // controls are redundant and intentionally not rendered.
          break;
      }
    }
    this.prettySeg.hidden = !m.supportsPretty;
    this.optionsBar.hidden = !m.supportsPretty && m.controls.every((c) => c.kind === 'file');
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
    this.layoutBtn.replaceChildren(icon(side ? 'rows' : 'columns'));
    this.layoutBtn.title = side ? 'Stack input above output' : 'Put input and output side by side';
    this.layoutBtn.setAttribute('aria-label', this.layoutBtn.title);
  }

  private updateEmptyState(): void {
    const empty = this.node.state.input === '';
    this.body.classList.toggle('is-empty', empty);
    this.picker.hidden = !empty;
    const hint = this.picker.querySelector<HTMLElement>('.picker-hint');
    if (hint) hint.textContent = this.mode.emptyHint;
    for (const card of this.picker.querySelectorAll<HTMLElement>('.tool-card')) {
      card.classList.toggle('is-current', card.dataset['mode'] === this.node.state.mode);
    }
  }

  /** The "what do you want to do?" grid shown while the pane is empty. */
  private buildPicker(): HTMLElement {
    const grid = h('div.tool-grid');
    for (const cat of CATEGORY_ORDER) {
      const tools = MODES.filter((m) => m.category === cat);
      const section = h('section.tool-section', {}, h('h4', {}, cat));
      const cards = h('div.tool-cards');
      for (const m of tools) {
        const card = h('button.tool-card', { type: 'button', 'data-mode': m.id, title: `Switch this pane to ${m.label}` }, h('span.tool-icon', {}, icon(m.icon, 18)), h('span.tool-name', {}, m.label), h('span.tool-desc', {}, m.description));
        card.addEventListener('click', () => {
          this.setMode(m.id);
          this.textarea.focus();
        });
        cards.append(card);
      }
      section.append(cards);
      grid.append(section);
    }
    const sampleBtn = h('button.btn.primary', { type: 'button' }, icon('sparkle', 14), h('span', {}, 'Try a sample'));
    sampleBtn.addEventListener('click', () => this.insertSample());
    const hintRow = h('div.picker-top', {}, h('p.picker-hint'), sampleBtn);
    return h('div.picker', { hidden: true }, hintRow, h('p.picker-lead', {}, 'Or pick a tool for this pane'), grid);
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
      const cleanup = renderer(this.viewHost, r.view!.data, ctx);
      if (typeof cleanup === 'function') this.viewCleanup = cleanup;
      this.viewHost.hidden = false;
      this.output.hidden = true;
    } else {
      this.output.textContent = r.output;
      this.output.hidden = !!r.error;
      this.viewHost.hidden = true;
    }
    this.outputLabel.textContent = r.view && !r.error ? { 'json-tree': 'Tree', 'json-path': 'Tree & path', 'json-graph': 'Graph', jwt: 'Decoded token', table: 'Table' }[r.view.kind] ?? 'Output' : 'Output';

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
