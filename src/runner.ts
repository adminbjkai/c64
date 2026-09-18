/**
 * Runs a mode either synchronously (small inputs — instant, no round trip)
 * or in a Web Worker (large inputs — keeps the UI thread free while a
 * multi-MB payload is parsed). Either way nothing leaves the page: the
 * worker is a same-origin module script and only ever talks to this tab.
 *
 * Results are `ModeResult`s, which are plain data (Maps included) and cross
 * the worker boundary via structured clone.
 */

import { getMode, type ModeResult, type RunContext } from './modes/index.js';

/** Inputs at or above this many characters go to the worker. */
export const WORKER_THRESHOLD = 150_000;

interface Pending {
  resolve: (r: ModeResult) => void;
}

let worker: Worker | null | undefined; // undefined = not tried yet, null = unavailable
const pending = new Map<number, Pending>();
let seq = 0;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<{ id: number; result: ModeResult }>) => {
      const p = pending.get(e.data.id);
      if (p) {
        pending.delete(e.data.id);
        p.resolve(e.data.result);
      }
    });
    worker.addEventListener('error', () => {
      // If the worker dies, fail the in-flight requests over to the main thread.
      for (const [, p] of pending) p.resolve({ output: '', error: { message: 'Background parser crashed — retried on the main thread.' } });
      pending.clear();
      worker = null;
    });
  } catch {
    worker = null;
  }
  return worker;
}

const unexpected = (e: unknown): ModeResult => ({ output: '', error: { message: `Unexpected error: ${(e as Error).message}` }, status: 'Error' });

/** Run a mode on the calling thread, normalising sync/async and thrown errors. */
export async function runModeLocal(modeId: string, input: string, ctx: RunContext): Promise<ModeResult> {
  try {
    return await getMode(modeId).run(input, ctx);
  } catch (e) {
    return unexpected(e);
  }
}

/**
 * Run a mode. Small inputs run on this thread (a microtask away), large
 * ones in the worker.
 */
export function runMode(modeId: string, input: string, ctx: RunContext): Promise<ModeResult> {
  if (input.length < WORKER_THRESHOLD || typeof Worker === 'undefined') {
    return runModeLocal(modeId, input, ctx);
  }
  const w = getWorker();
  if (!w) return runModeLocal(modeId, input, ctx);
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    w.postMessage({ id, modeId, input, ctx });
  });
}
