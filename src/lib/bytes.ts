/**
 * Small byte helpers shared by the hash / hex / uuid modes: hex and base64
 * rendering of Uint8Array, UTF-8 encode/decode with an "invalid" flag.
 */

export function toHex(data: Uint8Array, upper = false): string {
  let s = '';
  for (let i = 0; i < data.length; i++) s += (data[i] as number).toString(16).padStart(2, '0');
  return upper ? s.toUpperCase() : s;
}

export function bytesToBase64(data: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i] as number);
  return btoa(bin);
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Decodes UTF-8 leniently; `invalid` is true if any replacement was needed. */
export function utf8Decode(data: Uint8Array): { text: string; invalid: boolean } {
  let invalid = false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    invalid = true;
  }
  return { text: new TextDecoder('utf-8').decode(data), invalid };
}
