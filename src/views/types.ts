/**
 * Rich output renderers. A mode returns a serializable `ModeView` (kind +
 * data); the pane looks up the renderer for `kind` here and hands it a host
 * element. Renderers are the only place modes touch the DOM.
 */

export interface ViewContext {
  /** The pane's current input text (for offsets → selections). */
  input: string;
  options: Record<string, unknown>;
  /** Copy to clipboard with a toast naming what was copied. */
  copy(text: string, what: string): void;
  /** Select a [start, end) range of the input in the editor and scroll to it. */
  selectInEditor(start: number, end: number): void;
  /** Change a mode option (persisted) and re-run the mode. */
  setOption(key: string, value: unknown): void;
  /** Show a non-blocking toast. */
  toast(message: string): void;
}

/** Renders `data` into `host` (already emptied). May return a cleanup fn. */
export type ViewRenderer = (host: HTMLElement, data: unknown, ctx: ViewContext) => void | (() => void);
