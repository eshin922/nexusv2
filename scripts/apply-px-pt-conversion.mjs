// Slice 11 Step 3/3b fix pass — px→pt conversion for customer-PDF
// StyleSheets.
//
// Per CC Comm "Slice 11 Step 3/3b fix pass" Fix 1: CD's source styles
// are HTML/CSS in px @ 96dpi; react-pdf renders in pt @ 72dpi.
// 1 px = 0.75 pt. The agent copied CSS px values directly to
// react-pdf StyleSheet values, leaving every dimension 33% too large.
// This script applies the global 0.75 multiplier to every dimensional
// property in the two customer-PDF StyleSheet files, preserving CD's
// proportions exactly.
//
// Run via:  node scripts/apply-px-pt-conversion.mjs
//
// Idempotent? NO — running it twice will scale again. Run once,
// review, commit.
//
// Fields TRANSFORMED (multiply by 0.75):
//   fontSize, padding, paddingTop, paddingBottom, paddingLeft,
//   paddingRight, paddingVertical, paddingHorizontal,
//   margin, marginTop, marginBottom, marginLeft, marginRight,
//   marginVertical, marginHorizontal,
//   gap, rowGap, columnGap,
//   width, height, minWidth, minHeight, maxWidth, maxHeight,
//   borderWidth, borderTopWidth, borderBottomWidth, borderLeftWidth,
//   borderRightWidth, borderRadius,
//   borderTopLeftRadius, borderTopRightRadius,
//   borderBottomLeftRadius, borderBottomRightRadius,
//   top, bottom, left, right (absolute positioning offsets)
//
// Fields PRESERVED (no conversion):
//   lineHeight       — CSS unitless multiplier; dimensionless
//   letterSpacing    — CSS em-based; relative to fontSize
//   opacity          — 0..1 ratio
//   flex, flexGrow, flexShrink — flex weights; dimensionless
//   flexBasis        — usually 0 or a fractional; not dimensional
//   zIndex           — integer stacking; no unit
//   fontWeight       — 100..900; weight
//   color, backgroundColor, borderColor — colors
//   fontFamily, fontStyle, textTransform, textAlign — non-numeric
//   position, alignItems, justifyContent, flexDirection — non-numeric
//   borderStyle      — keyword
//   fontFeatureSettings — OpenType string
//
// Negative values: preserved (e.g., marginTop: -2 → marginTop: -1.5).
//
// Numbers preserved when value is 0 (0 × 0.75 = 0 anyway; cleaner to
// keep the literal 0).

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "src/components/pdf/customer-pdf-styles.ts",
  "src/components/pdf/customer-pdf-addendum-styles.ts",
];

const TRANSFORM_FIELDS = new Set([
  "fontSize",
  "padding",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingVertical",
  "paddingHorizontal",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginVertical",
  "marginHorizontal",
  "gap",
  "rowGap",
  "columnGap",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "borderWidth",
  "borderTopWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRightWidth",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "top",
  "bottom",
  "left",
  "right",
]);

const PT_PER_PX = 0.75;

// Round to 0.25 increments — finer than visually perceptible at
// realistic font sizes; preserves CD's proportions without leaving
// floating-point noise like 0.375 in source.
function ptize(px) {
  if (px === 0) return 0;
  const pt = px * PT_PER_PX;
  return Math.round(pt * 4) / 4;
}

let totalConverted = 0;

for (const file of FILES) {
  if (!existsSync(file)) {
    console.log(`· ${file}: not present on this branch — skipped`);
    continue;
  }
  const src = readFileSync(file, "utf8");
  let converted = 0;

  // Match `propName: NUMBER,` or `propName: NUMBER\n` (no trailing
  // comma). NUMBER can be integer, decimal, or negative.
  // Captures: 1 = leading whitespace, 2 = propName, 3 = number value
  const out = src.replace(
    /^(\s*)([a-zA-Z]+):\s*(-?\d+(?:\.\d+)?)([,\s])/gm,
    (match, ws, prop, numStr, trailing) => {
      if (!TRANSFORM_FIELDS.has(prop)) return match;
      const num = parseFloat(numStr);
      const next = ptize(num);
      converted++;
      return `${ws}${prop}: ${next}${trailing}`;
    },
  );

  writeFileSync(file, out);
  console.log(`✓ ${file}: ${converted} dimensions converted`);
  totalConverted += converted;
}

console.log(`\nTotal: ${totalConverted} dimensional values converted (× ${PT_PER_PX})`);
