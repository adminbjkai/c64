/**
 * Percent-encoding helpers for the URL mode. Implements:
 *  - `component`: encodeURIComponent semantics (everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is escaped)
 *  - `uri`: encodeURI semantics (reserved characters ; / ? : @ & = + $ , # are kept)
 *  - `form`: application/x-www-form-urlencoded (space → "+", "!'()~" escaped)
 * Decoding is done by hand so a malformed "%" sequence can be reported with
 * its 0-based offset; the bytes of each contiguous %XX run are decoded as
 * UTF-8 (strict), so invalid byte sequences are reported too.
 */

export type PercentFlavour = 'component' | 'uri' | 'form';

export class PercentError extends Error {
  constructor(message: string, public offset: number, public hint: string) {
    super(message);
    this.name = 'PercentError';
  }
}

const RESERVED = ';/?:@&=+$,#';

export function percentEncode(text: string, flavour: PercentFlavour): string {
  if (flavour === 'uri') return encodeURI(text);
  const enc = encodeURIComponent(text);
  if (flavour === 'component') return enc;
  return enc.replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+');
}

const HEX = /^[0-9A-Fa-f]{2}$/;

export function percentDecode(text: string, flavour: PercentFlavour): string {
  const out: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '+' && flavour === 'form') {
      out.push(' ');
      i++;
      continue;
    }
    if (ch !== '%') {
      out.push(ch);
      i++;
      continue;
    }
    // Collect a contiguous run of %XX sequences and decode them together.
    const start = i;
    const bytes: number[] = [];
    const raw: string[] = [];
    while (i < text.length && text[i] === '%') {
      const hex = text.slice(i + 1, i + 3);
      if (!HEX.test(hex)) {
        throw new PercentError(
          `Malformed percent-encoding "${text.slice(i, i + 3)}"`,
          i,
          'Each "%" must be followed by exactly two hex digits (0-9, A-F). To keep a literal percent sign, write it as %25.',
        );
      }
      bytes.push(parseInt(hex, 16));
      raw.push(text.slice(i, i + 3));
      i += 3;
    }
    if (flavour === 'uri') {
      // encodeURI never escapes reserved characters, so decodeURI leaves them alone.
      let s = '';
      let pending: number[] = [];
      let pendingRaw: string[] = [];
      const flush = () => {
        if (pending.length) s += decodeBytes(pending, start);
        pending = [];
        pendingRaw = [];
      };
      bytes.forEach((b, k) => {
        if (b < 128 && RESERVED.includes(String.fromCharCode(b))) {
          flush();
          s += raw[k];
        } else {
          pending.push(b);
          pendingRaw.push(raw[k]!);
        }
      });
      flush();
      out.push(s);
    } else {
      out.push(decodeBytes(bytes, start));
    }
  }
  return out.join('');

  function decodeBytes(bytes: number[], offset: number): string {
    try {
      return decoder.decode(Uint8Array.from(bytes));
    } catch {
      throw new PercentError('Percent-encoded bytes are not valid UTF-8', offset, 'The %XX bytes here do not form a valid UTF-8 character. The text may have been encoded with a different charset (e.g. Latin-1).');
    }
  }
}

/** Heuristic: does the text look percent-encoded (or form-encoded with "+")? */
export function looksPercentEncoded(text: string, flavour: PercentFlavour): boolean {
  if (/%[0-9A-Fa-f]{2}/.test(text)) return true;
  return flavour === 'form' && text.includes('+');
}
