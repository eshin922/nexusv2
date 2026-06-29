// Slice 11 Step 2 — one-shot OKLCH → sRGB precompute for the
// customer-PDF palette. Run via:
//
//   node scripts/compute-pdf-palette.mjs
//
// Output: prints the 11-token palette + the 17 scattered inline
// oklch() occurrences as a TypeScript const block ready to paste
// into src/lib/pdf-palette.ts.
//
// react-pdf has no OKLCH parser (spike §1); this script computes
// the conversion ONCE so the runtime ships hex literals.

// OKLab math via Björn Ottosson's published transforms:
// https://bottosson.github.io/posts/oklab/
function oklchToSrgb(l, c, h, alpha = 1) {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b_ = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b_;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b_;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b_;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const lr = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const lg = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const lb = -0.0041960863 * L - 0.703418614 * M + 1.707614701 * S;
  const gamma = (x) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  const r = Math.max(0, Math.min(1, gamma(lr)));
  const g = Math.max(0, Math.min(1, gamma(lg)));
  const b = Math.max(0, Math.min(1, gamma(lb)));
  const to255 = (x) => Math.round(x * 255);
  const hex = (n) => n.toString(16).padStart(2, "0");
  if (alpha < 1) {
    return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${alpha})`;
  }
  return `#${hex(to255(r))}${hex(to255(g))}${hex(to255(b))}`;
}

// 11-token canonical palette per styles.css:101-111
const PALETTE = [
  ["--pp-ink",      0.21,  0.018, 255],
  ["--pp-ink-2",    0.36,  0.016, 255],
  ["--pp-ink-3",    0.52,  0.014, 255],
  ["--pp-muted",    0.60,  0.012, 255],
  ["--pp-rule",     0.86,  0.010, 90],
  ["--pp-rule-2",   0.74,  0.012, 90],
  ["--pp-strong",   0.21,  0.018, 255],
  ["--pp-rec-edge", 0.46,  0.03,  255],
  ["--pp-rec-tint", 0.975, 0.020, 95],
  ["--pp-star",     0.56,  0.13,  72],
  ["--pp-paper",    0.995, 0.002, 95],
];

console.log("// === Canonical 11-token palette (styles.css:101-111) ===");
for (const [name, l, c, h] of PALETTE) {
  console.log(`${name.padEnd(15)} = oklch(${l} ${c} ${h})  →  ${oklchToSrgb(l, c, h)}`);
}

// Inline oklch() scattered through styles.css (excluding the
// canonical 11). Note: the .cpdf-dn rules at L67-84 are
// designer-notes-on-screen styling, NOT inside .pp-sheet — they
// fall outside the paged-artifact palette and don't ship to PDF.
// Only inline oklch() inside .pp-* selectors needs porting.
console.log("\n// === Inline oklch() inside .pp-* selectors ===");

const INLINE = [
  // styles.css:18 — paper shadow inside-edge tint (inside .pp-sheet box-shadow stack)
  ["pp-sheet shadow tier 1 (`from var(--paper)` calc)", 0.995 - 0.02, 0.002, 95, "calc(l - 0.02)"],
  // styles.css:124-126 — pp-sheet box-shadow neutral blacks
  ["pp-sheet shadow black 0.18α", 0, 0, 0, 0.18],
  ["pp-sheet shadow black 0.30α", 0, 0, 0, 0.30],
  ["pp-sheet shadow black 0.16α", 0, 0, 0, 0.16],
];

for (const entry of INLINE) {
  const [label, l, c, h, alpha] = entry;
  if (typeof alpha === "string") {
    // calc() variant — show the resolved-l result
    console.log(`${label.padEnd(50)} l=${l} c=${c} h=${h}  →  ${oklchToSrgb(l, c, h)}`);
  } else if (typeof alpha === "number") {
    console.log(`${label.padEnd(50)} oklch(${l} ${c} ${h} / ${alpha})  →  ${oklchToSrgb(l, c, h, alpha)}`);
  }
}
