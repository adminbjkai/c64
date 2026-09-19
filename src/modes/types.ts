/**
 * The contract every pane tool implements. A mode is a pure function from
 * (input, pane settings) to an output string plus diagnostics — no DOM, so
 * modes are trivially unit-testable and run unchanged inside the Web Worker.
 *
 * Modes that need a richer display than text (tree, graph, table, JWT) return
 * a serializable `view` descriptor; the matching renderer in src/views/ turns
 * it into DOM on the main thread. `output` is still filled with a plain-text
 * equivalent so Copy always has something sensible to copy.
 */

export type OutputLanguage = 'json' | 'xml' | 'html' | 'yaml' | 'css' | 'sql' | 'toml' | 'markdown' | 'typescript' | 'python' | 'go';

export interface Diagnostic {
  message: string;
  /** 1-based, when the parser can pinpoint the problem. */
  line?: number;
  col?: number;
  /** Plain-English suggestion, e.g. "did you leave a trailing comma?" */
  hint?: string;
}

/** A structured result rendered by src/views/<kind>.ts. Must survive structured clone. */
export interface ModeView {
  kind: string;
  data: unknown;
}

export interface ModeResult {
  output: string;
  /** Set when the input could not be processed; output then holds "" or a partial. */
  error?: Diagnostic;
  /** Things that were tolerated/auto-fixed, shown as a soft notice. */
  notes?: string[];
  /** Short status line, e.g. "Valid JSON · 3 keys · 1.2 KB". */
  status?: string;
  /** Rich display instead of the plain <pre> output. */
  view?: ModeView;
}

/** A header control the pane renders for a mode-specific option. */
export type ModeControl =
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[]; default: string }
  | { kind: 'toggle'; key: string; label: string; default: boolean }
  | { kind: 'text'; key: string; label: string; placeholder: string; default: string };

export interface RunContext {
  pretty: boolean;
  options: Record<string, unknown>;
  /** Second input, present only for modes that declare `inputs: 2`. */
  inputB?: string;
}

/** Sidebar / picker sections, in display order. */
export const CATEGORIES = ['Start', 'JSON', 'Formats', 'Compare', 'Encoding', 'Text', 'Web', 'Crypto & IDs', 'Generators', 'Developer'] as const;
export type ToolCategory = (typeof CATEGORIES)[number];

export interface ToolMode {
  id: string;
  label: string;
  /** One sentence shown on tool cards and under the pane title. */
  description: string;
  category: ToolCategory;
  /** Icon id from src/icons.ts. */
  icon: string;
  /** Extra search terms for the sidebar filter and command palette. */
  keywords?: string[];
  /** One-line hint shown in an empty pane. */
  emptyHint: string;
  /**
   * Compare-style tools take two texts. The pane then shows two editors
   * (A and B) and passes the second one as `ctx.inputB`.
   */
  inputs?: 1 | 2;
  /** Labels for the two editors, default ["A", "B"]. */
  inputLabels?: [string, string];
  /** Sample input the "Sample" button inserts. */
  sample: string;
  /** Sample for the second editor of a two-input tool. */
  sampleB?: string;
  /** Options the "Sample" button sets alongside the sample (e.g. a regex pattern). */
  sampleOptions?: Record<string, unknown>;
  controls: ModeControl[];
  /** Whether the Raw/Pretty toggle changes anything for this mode. */
  supportsPretty: boolean;
  /**
   * Language used to syntax-highlight the text output, or a function of the
   * run context when it depends on options / Pretty. Omit for plain text.
   */
  outputLanguage?: OutputLanguage | ((ctx: RunContext) => OutputLanguage | undefined);
  /**
   * Pure transform. May return a Promise when the work is inherently async
   * (e.g. WebCrypto digests); the runner and worker await either form.
   */
  run(input: string, ctx: RunContext): ModeResult | Promise<ModeResult>;
}

/** Turn any thrown parser error (ours carry line/col/hint) into a Diagnostic. */
export function toDiagnostic(e: unknown): Diagnostic {
  const err = e as { message?: string; line?: number; col?: number; hint?: string };
  return {
    message: err?.message ?? String(e),
    line: typeof err?.line === 'number' ? err.line : undefined,
    col: typeof err?.col === 'number' ? err.col : undefined,
    hint: typeof err?.hint === 'string' ? err.hint : undefined,
  };
}

/** Standard "failed" result with a status line derived from the diagnostic. */
export function failure(what: string, e: unknown): ModeResult {
  const d = toDiagnostic(e);
  return {
    output: '',
    error: d,
    status: d.line ? `Invalid ${what} · line ${d.line}, col ${d.col}` : `Invalid ${what}`,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
