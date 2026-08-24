/**
 * Glyph-truncation certification for the customer PDF.
 *
 * Counts the glyphs actually DRAWN for every money-shaped text run in a PDF and
 * flags any that is missing its leading currency symbol.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * `formatMoney`'s only return is `(rounded < 0 ? "-$" : "$") + digits`. Every
 * money string it produces begins with a currency symbol, without exception.
 * So a drawn run that looks like money and has NO leading symbol was not
 * produced that way — it was drawn short.
 *
 * That is the whole test, and it is what makes it sound: it does not need to
 * know the correct total, only that the producer cannot emit what is on the
 * page. A test that checked the AMOUNTS would need a second source of truth and
 * would then be asserting agreement between two constructions rather than
 * catching a render defect.
 *
 * ── WHY IT TAKES A FILE RATHER THAN RENDERING ───────────────────────────
 *
 * The defect has never reproduced locally — it is a deployed-runtime font
 * behaviour. A local render cannot express the failure, so a local pass would
 * be a green measurement from an instrument that cannot go red. Certify the
 * artifact the operator would actually receive:
 *
 *   1. open the quote's Customer View while signed in
 *   2. save the PDF the preview is showing
 *   3. node scripts/gate-1b/pdf-glyph-truncation-certify.mjs <file.pdf>
 *
 * Exit 0 = every money run carries its symbol. Exit 1 = at least one is short.
 *
 * Read-only. No network, no database.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const path = process.argv[2];
if (!path) {
  console.error("usage: pdf-glyph-truncation-certify.mjs <file.pdf>");
  process.exit(2);
}

const raw = readFileSync(path);
const latin = raw.toString("latin1");

// ── inflate every stream ────────────────────────────────────────────────
//
// The EOL before `endstream` is not part of the stream data. Including it makes
// every inflate throw, which reads as "no text in this PDF" — an instrument
// reporting zero because it cannot report anything else. Both counts are
// printed below so that failure mode stays visible.
const streams = [];
let found = 0;
const re = /stream\r?\n/g;
let m;
while ((m = re.exec(latin))) {
  found++;
  const start = m.index + m[0].length;
  let end = latin.indexOf("endstream", start);
  if (end < 0) continue;
  while (end > start && (raw[end - 1] === 0x0a || raw[end - 1] === 0x0d)) end--;
  try {
    streams.push(inflateSync(raw.subarray(start, end)).toString("latin1"));
  } catch {
    /* not a flate stream */
  }
}

// ── ToUnicode CMaps, so glyph indices become characters ─────────────────
const maps = [];
for (const t of streams) {
  if (!/beginbfchar|beginbfrange/.test(t)) continue;
  const map = new Map();
  for (const b of t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))
      map.set(p[1].toLowerCase(), String.fromCharCode(parseInt(p[2].slice(0, 4), 16)));
  for (const b of t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(p[1], 16);
      const hi = parseInt(p[2], 16);
      const dst = parseInt(p[3].slice(0, 4), 16);
      for (let g = lo; g <= hi && g - lo < 1024; g++)
        map.set(g.toString(16).padStart(4, "0"), String.fromCharCode(dst + (g - lo)));
    }
  if (map.size) maps.push(map);
}

// ── every drawn run, decoded by whichever CMap resolves it whole ────────
const decode = (hex, map) => {
  let out = "";
  let missing = 0;
  for (let i = 0; i < hex.length; i += 4) {
    const c = map.get(hex.slice(i, i + 4));
    if (c === undefined) missing++;
    else out += c;
  }
  return { out, missing };
};

const runs = [];
for (const t of streams) {
  if (!/TJ|Tj/.test(t)) continue;
  for (const mm of t.matchAll(/\[((?:[^\]])*)\]\s*TJ|\(((?:\\.|[^()\\])*)\)\s*Tj/g)) {
    const hex = mm[1]
      ? [...mm[1].matchAll(/<([0-9A-Fa-f]+)>/g)].map((z) => z[1].toLowerCase()).join("")
      : null;
    if (!hex) continue;
    let best = null;
    for (const map of maps) {
      const d = decode(hex, map);
      if (d.missing === 0 && (best === null || d.out.length > best.length)) best = d.out;
    }
    if (best !== null) runs.push({ text: best, glyphs: hex.length / 4 });
  }
}

const NOTHING_DECODED =
  "INDETERMINATE -- nothing decoded. That is this script failing, not the PDF passing.";
const NO_MONEY_FOUND =
  "INDETERMINATE -- no money-shaped runs found at all. The document may not carry " +
  "any, or the decoder may be splitting them; either way this is not evidence that " +
  "the money on the page is whole.";

// ── the assertion ───────────────────────────────────────
//
// Money-shaped: digits with a decimal tail, optionally with thousands
// separators. If such a run does not begin with a currency symbol, the producer
// could not have made it.
//
// Trimmed: react-pdf runs routinely carry trailing space from the layout.
const t = (r) => r.text.trim();
const MONEY_TAIL = /^[0-9,]+[.][0-9]{2}$/;
const MONEY_WHOLE = /^-?[$][0-9,]+[.][0-9]{2}$/;
const short = runs.filter((r) => MONEY_TAIL.test(t(r)));
const whole = runs.filter((r) => MONEY_WHOLE.test(t(r)));

console.log(`streams found      : ${found}`);
console.log(`streams inflated   : ${streams.length}`);
console.log(`ToUnicode CMaps    : ${maps.length}`);
console.log(`decoded text runs  : ${runs.length}`);
console.log(`money runs, whole  : ${whole.length}`);
for (const r of whole) console.log(`   OK    ${t(r).padStart(14)}  (${r.glyphs} glyphs)`);
console.log(`money runs, short  : ${short.length}`);
for (const r of short)
  console.log(`   SHORT ${t(r).padStart(14)}  (${r.glyphs} glyphs, no currency symbol)`);

if (streams.length === 0 || runs.length === 0) {
  console.error(NOTHING_DECODED);
  process.exit(2);
}

// A pass over zero money runs is not a pass.
//
// This fired on the first real run: 106 runs decoded, 0 money runs of EITHER
// kind, and the script reported PASS. It had found nothing and said everything
// was fine -- a filter that cannot match the thing it certifies proves nothing,
// which is the same defect this whole investigation keeps turning up.
if (whole.length + short.length === 0) {
  console.error(NO_MONEY_FOUND);
  process.exit(2);
}

if (short.length) {
  console.error(`FAIL -- ${short.length} money run(s) drawn without a currency symbol.`);
  process.exit(1);
}
console.log("PASS -- every money run carries its currency symbol.");
