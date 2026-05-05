#!/usr/bin/env node
// Extract un-bundled source from a CD bundled prototype HTML file.
//
// CD ships some rounds as bundled HTML with assets inside
// <script type="__bundler/manifest"> + <script type="__bundler/template">.
// The manifest is { uuid: { data: base64, compressed: bool } }; the
// template is the rendered HTML with asset references by uuid.
//
// This script extracts:
//   - the template HTML (rendered DOM + inline <style> blocks) → index.html
//   - each asset, decoded + ungzipped, content-sniffed for ext → <uuid>.{js,css,bin}
//
// Usage: node scripts/extract-r6-source.mjs [round]
//   round = "6" (default), "5", "4", or "3"

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const ROUND = process.argv[2] ?? "6";
const SRC = `docs/design-prototypes/dist/Nexus Round ${ROUND}.html`;
const OUT = `docs/design-prototypes/dist/source/round-${ROUND}`;

const html = readFileSync(SRC, "utf8");
const m1 = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
const m2 = html.match(/<script type="__bundler\/template">([\s\S]*?)<\/script>/);
if (!m1 || !m2) {
  console.error(`No manifest/template script tags found in ${SRC}`);
  process.exit(1);
}

const manifest = JSON.parse(m1[1]);
const template = JSON.parse(m2[1]);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/index.html`, template, "utf8");
console.log(`wrote ${OUT}/index.html (${template.length.toLocaleString()} bytes)`);

let jsCount = 0, binCount = 0;
for (const uuid of Object.keys(manifest)) {
  const entry = manifest[uuid];
  const bin = Buffer.from(entry.data, "base64");
  let bytes = bin;
  if (entry.compressed) {
    try { bytes = gunzipSync(bin); } catch { /* not gzip */ }
  }
  const sniff = bytes.slice(0, 200).toString("utf8");
  let ext = "bin";
  if (/(import |const |function |export |\/\*|\/\/|window\.)/.test(sniff)) {
    ext = "js"; jsCount++;
  } else {
    binCount++;
  }
  writeFileSync(`${OUT}/${uuid.slice(0, 8)}.${ext}`, bytes);
}
console.log(`extracted ${jsCount + binCount} assets (${jsCount} js, ${binCount} bin) to ${OUT}/`);
