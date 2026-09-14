/**
 * SKU formatting. Deliberately free of any database or server import, so the
 * shape of an identifier can be reasoned about -- and tested -- without
 * standing up a connection to decide what a string looks like.
 */

export function normalizeToken(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * `DPS-<TOKEN>-<NUMBER>`.
 *
 * Padded to four digits because the live catalog is padded (`DPS-BOTTLE-0001`),
 * and an unpadded `DPS-X-1` would be a different string for the same intent.
 * Padding is a MINIMUM width, never a cap: truncating at four would start
 * minting collisions the moment a brand passed 9999.
 */
export function formatSku(token: string, n: number): string {
  return `DPS-${normalizeToken(token)}-${String(n).padStart(4, "0")}`;
}
