/**
 * CRC-32 (IEEE 802.3, polynomial 0xEDB88320, reflected, init/xorout 0xFFFFFFFF)
 * — the variant used by zip, gzip, PNG and `cksum -o3`. Table-driven.
 */

let TABLE: Uint32Array | null = null;

function table(): Uint32Array {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}

/** Returns the CRC as an unsigned 32-bit number. */
export function crc32(data: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (t[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Big-endian 4-byte representation, so it hex/base64-encodes like a digest. */
export function crc32Bytes(data: Uint8Array): Uint8Array {
  const v = crc32(data);
  return Uint8Array.from([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}
