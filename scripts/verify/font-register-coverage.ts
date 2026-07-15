// Slice 11 Step 7 — Font.register coverage verifier.
//
// Prebuild gate that catches the failure mode banked in the Slice 11
// close-out (§0.5 catch #77): react-pdf StyleSheet entries declaring
// `fontFamily` + `fontStyle: "italic"` (or any weight/style not
// covered by Font.register) fail silently at TypeScript, boundary,
// and prebuild — and then throw at first render of the offending
// style ("Font family X, font weight W, font style S wasn't found").
//
// The failure that motivated this verifier: `rowValueEmpty` on the
// customer-PDF addendum requested JetBrains Mono italic; Font.register
// only had non-italic variants; first empty-spec render on the
// preview route crashed with HTTP 500. Cost: post-push hotfix
// (`e1d75b7`) vendoring `JetBrainsMono-Italic.ttf` + register update.
// Preventable at prebuild-time with a cheap grep-shape verifier.
//
// **How it works.**
//
// 1. Parse `src/lib/pdf-fonts.ts`:
//    - Extract `PDF_FONT_FAMILY` alias → literal family name mapping.
//    - Extract `Font.register({family, fonts: [{fontWeight, fontStyle}]})`
//      calls. Build the SET of registered (family, weight, style) tuples.
//      Missing weight defaults to 400; missing style defaults to "normal".
//
// 2. Parse `src/components/pdf/customer-pdf-styles.ts` +
//    `src/components/pdf/customer-pdf-addendum-styles.ts`
//    (the two StyleSheet.create files):
//    - For each named entry `key: { ... }`, extract fontFamily +
//      fontWeight + fontStyle set explicitly WITHIN that entry.
//    - Resolve family aliases (`PDF_FONT_FAMILY.serif` → "Newsreader"
//      etc.) via the mapping from step 1.
//    - Skip entries where fontFamily is absent (may inherit from
//      parent — a runtime concern beyond this verifier's scope).
//
// 3. For each style entry that names a family AND at least one of
//    weight/style, check the registered set:
//    - If a weight is set, verify a matching (family, weight, *)
//      exists.
//    - If a style is set (non-"normal"), verify a matching
//      (family, *, style) exists.
//    - If both are set, verify the exact (family, weight, style)
//      tuple.
//
// 4. Fail the build on any style entry whose required combination
//    is not covered by Font.register.
//
// **Trade-offs.**
//
// - Text-based, not AST. Robust to react-pdf's simple StyleSheet
//   object shape; not designed for arbitrary computed values or
//   dynamic spreads. If future style code introduces dynamic
//   fontFamily/style/weight (unusual for print PDFs), swap to a
//   ts-morph parser.
// - Skips entries without explicit fontFamily — inheritance from
//   parent style is fine at runtime (registered families cover the
//   inherited styles); the verifier can't statically trace parent
//   context, so this is a deliberate false-negative floor. #77's
//   shape (fontFamily + fontStyle on the SAME entry) is fully
//   covered.
//
// Failure mode: process.exit(1) with the offending style entry +
// missing register tuple.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FONTS_FILE = join(ROOT, "src", "lib", "pdf-fonts.ts");
const STYLE_FILES: readonly string[] = [
  join(ROOT, "src", "components", "pdf", "customer-pdf-styles.ts"),
  join(ROOT, "src", "components", "pdf", "customer-pdf-addendum-styles.ts"),
];

// ── Pattern helpers ───────────────────────────────────────────────

type FontStyle = "normal" | "italic";
type RegisterKey = string; // `${family}::${weight}::${style}`

function toKey(family: string, weight: number, style: FontStyle): RegisterKey {
  return `${family}::${weight}::${style}`;
}

// Extract the balanced { ... } block starting at position `open`.
// Returns [contentInsideBraces, indexAfterClosingBrace].
//
// Skips over string literals (`"..."`, `'...'`, `` `...` ``), line
// comments (`// ...`), and block comments (`/* ... */`) so braces
// or backticks embedded in comments/strings don't fool the depth
// counter. Critical because our source files carry Pattern-30
// comment references to CSS class names like `\`.pp-*\``, which
// contain backticks; without comment-skipping the state machine
// entered "string mode" on a backtick inside a comment and stayed
// there for the rest of the file.
function readBraceBlock(
  src: string,
  open: number,
): { body: string; end: number } | null {
  if (src[open] !== "{") return null;
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  let escape = false;
  let i = open;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (escape) {
      escape = false;
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === inString) inString = null;
      i++;
      continue;
    }
    // Line comment
    if (ch === "/" && next === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    // Block comment
    if (ch === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close < 0 ? src.length : close + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
    }
    i++;
  }
  return null;
}

// ── Step 1a. Alias table (PDF_FONT_FAMILY) ────────────────────────

function extractFontFamilyAliases(source: string): Map<string, string> {
  const aliases = new Map<string, string>();
  // Match `export const PDF_FONT_FAMILY = {` then read the block.
  const re = /export\s+const\s+PDF_FONT_FAMILY\s*=\s*\{/;
  const m = re.exec(source);
  if (!m) return aliases;
  const open = m.index + m[0].length - 1;
  const block = readBraceBlock(source, open);
  if (!block) return aliases;
  // Entries: `key: "value"`
  const entryRe = /(\w+)\s*:\s*"([^"]+)"/g;
  let em: RegExpExecArray | null;
  while ((em = entryRe.exec(block.body)) !== null) {
    aliases.set(`PDF_FONT_FAMILY.${em[1]}`, em[2]);
  }
  return aliases;
}

// ── Step 1b. Font.register set ─────────────────────────────────────

function extractRegisteredFonts(source: string): Set<RegisterKey> {
  const registered = new Set<RegisterKey>();
  const re = /Font\.register\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const openBrace = m.index + m[0].length - 1;
    const call = readBraceBlock(source, openBrace);
    if (!call) continue;
    // family name (string literal)
    const familyMatch = /family\s*:\s*"([^"]+)"/.exec(call.body);
    if (!familyMatch) continue;
    const family = familyMatch[1];
    // fonts: [ { ... }, { ... } ]  — extract each { ... } inside the array
    const fontsIdx = call.body.search(/fonts\s*:\s*\[/);
    if (fontsIdx < 0) continue;
    // Scan `{` blocks within the fonts array.
    let cursor = fontsIdx;
    while (cursor < call.body.length) {
      const nextOpen = call.body.indexOf("{", cursor);
      if (nextOpen < 0) break;
      // Ensure we're still within the fonts array — stop if the
      // enclosing `]` closes.
      const nextClose = call.body.indexOf("]", cursor);
      if (nextClose >= 0 && nextClose < nextOpen) break;
      const entry = readBraceBlock(call.body, nextOpen);
      if (!entry) break;
      const weightM = /fontWeight\s*:\s*(\d+)/.exec(entry.body);
      const styleM = /fontStyle\s*:\s*"([^"]+)"/.exec(entry.body);
      const weight = weightM ? parseInt(weightM[1], 10) : 400;
      const style = (styleM ? styleM[1] : "normal") as FontStyle;
      registered.add(toKey(family, weight, style));
      cursor = entry.end;
    }
  }
  return registered;
}

// ── Step 2. StyleSheet entry extraction ───────────────────────────

type StyleEntry = {
  file: string;
  name: string;
  fontFamilyRaw: string; // as written: alias or literal
  fontFamilyResolved: string | null; // resolved via alias table
  fontWeight: number | null;
  fontStyle: FontStyle | null;
  line: number;
};

function extractStyleEntries(
  source: string,
  file: string,
  aliases: Map<string, string>,
): StyleEntry[] {
  const entries: StyleEntry[] = [];
  // Find every StyleSheet.create({ ... }) block.
  const createRe = /StyleSheet\.create\s*\(\s*\{/g;
  let cm: RegExpExecArray | null;
  while ((cm = createRe.exec(source)) !== null) {
    const openBrace = cm.index + cm[0].length - 1;
    const outer = readBraceBlock(source, openBrace);
    if (!outer) continue;
    // Iterate named entries: `<key>: {`
    const outerAbsBase = openBrace + 1;
    const keyRe = /(\w+)\s*:\s*\{/g;
    let km: RegExpExecArray | null;
    while ((km = keyRe.exec(outer.body)) !== null) {
      const keyOpen = km.index + km[0].length - 1;
      const entry = readBraceBlock(outer.body, keyOpen);
      if (!entry) continue;
      // Only shallow inspect the entry body for font* keys. Nested
      // objects (@media queries etc.) are rare in react-pdf; skip
      // them via a top-level scan.
      const familyM = /fontFamily\s*:\s*([^,\n}]+)/.exec(entry.body);
      const weightM = /fontWeight\s*:\s*(\d+)/.exec(entry.body);
      const styleM = /fontStyle\s*:\s*"([^"]+)"/.exec(entry.body);
      if (!familyM && !weightM && !styleM) continue;

      let familyRaw: string | null = null;
      let familyResolved: string | null = null;
      if (familyM) {
        familyRaw = familyM[1].trim().replace(/["']/g, "").trim();
        // Try alias first, then treat as literal.
        familyResolved =
          aliases.get(familyRaw) ??
          (familyM[1].includes('"') || familyM[1].includes("'")
            ? familyRaw
            : null);
      }

      const absPos = outerAbsBase + km.index;
      const line = source.slice(0, absPos).split(/\r?\n/).length;

      entries.push({
        file,
        name: km[1],
        fontFamilyRaw: familyRaw ?? "(inherited)",
        fontFamilyResolved: familyResolved,
        fontWeight: weightM ? parseInt(weightM[1], 10) : null,
        fontStyle: styleM ? ((styleM[1] as FontStyle) ?? null) : null,
        line,
      });
    }
  }
  return entries;
}

// ── Step 3. Cross-reference ───────────────────────────────────────

if (!existsSync(FONTS_FILE)) {
  console.log(
    `[font-register-coverage] ${FONTS_FILE} does not exist — nothing to verify.`,
  );
  process.exit(0);
}

const fontsSrc = readFileSync(FONTS_FILE, "utf-8");
const aliases = extractFontFamilyAliases(fontsSrc);
const registered = extractRegisteredFonts(fontsSrc);

if (registered.size === 0) {
  console.error(
    "[font-register-coverage] no Font.register calls detected in pdf-fonts.ts — verifier cannot proceed.",
  );
  process.exit(1);
}

type Violation = {
  entry: StyleEntry;
  reason: string;
};

const violations: Violation[] = [];

for (const styleFile of STYLE_FILES) {
  if (!existsSync(styleFile)) continue;
  const src = readFileSync(styleFile, "utf-8");
  const entries = extractStyleEntries(src, styleFile, aliases);
  for (const e of entries) {
    // Only check entries with EXPLICIT family — inheritance is a
    // false-positive floor (see file header rationale).
    if (!e.fontFamilyResolved) continue;
    const family = e.fontFamilyResolved;

    // For each combination shape, verify a matching register exists.
    const weight = e.fontWeight ?? 400;
    const style: FontStyle = e.fontStyle ?? "normal";

    if (e.fontWeight != null && e.fontStyle != null) {
      // Exact triplet
      if (!registered.has(toKey(family, weight, style))) {
        violations.push({
          entry: e,
          reason: `no Font.register match for ${family} · fontWeight ${weight} · fontStyle "${style}"`,
        });
      }
    } else if (e.fontStyle != null) {
      // Family + style; weight defaults to 400 unless a matching
      // (family, *, style) exists at any weight.
      let anyWeight = false;
      for (const key of registered) {
        const [f, w, s] = key.split("::");
        void w;
        if (f === family && s === style) {
          anyWeight = true;
          break;
        }
      }
      if (!anyWeight) {
        violations.push({
          entry: e,
          reason: `no Font.register match for ${family} · fontStyle "${style}" (at any weight)`,
        });
      }
    } else if (e.fontWeight != null) {
      // Family + weight; verify at least one variant at that weight
      let anyStyle = false;
      for (const key of registered) {
        const [f, w] = key.split("::");
        if (f === family && parseInt(w, 10) === weight) {
          anyStyle = true;
          break;
        }
      }
      if (!anyStyle) {
        violations.push({
          entry: e,
          reason: `no Font.register match for ${family} · fontWeight ${weight}`,
        });
      }
    }
    // Family only, no weight or style — considered fine (register
    // set covers the default weight/style variants).
  }
}

if (violations.length > 0) {
  console.error(
    `\n[font-register-coverage] FONT COVERAGE VIOLATION — StyleSheet entries request font variants not registered in pdf-fonts.ts.\n`,
  );
  for (const v of violations) {
    const relFile = v.entry.file.replace(ROOT + "\\", "").replace(ROOT + "/", "").split("\\").join("/");
    console.error(`  ${relFile}:${v.entry.line}  entry \`${v.entry.name}\``);
    console.error(`    ${v.reason}`);
    console.error();
  }
  console.error(
    "Fix: vendor the missing font file under `public/fonts/` and add a\n" +
      "matching Font.register entry in `src/lib/pdf-fonts.ts`. See CLAUDE.md\n" +
      "Pattern 22 §0.5 ledger #77 for the reference incident.",
  );
  process.exit(1);
}

console.log(
  `[font-register-coverage] OK — ${registered.size} Font.register variants cover every StyleSheet fontFamily/style/weight combination across ${STYLE_FILES.length} style file(s).`,
);
