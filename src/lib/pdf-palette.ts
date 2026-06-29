import "server-only";

// Slice 11 Step 2 — Pattern-30 OKLCH → sRGB precompute for the
// customer-PDF render. react-pdf 4.5.x has no OKLCH color parser
// (per spike §1 portability table), so the canonical CD palette
// at `docs/design-prototypes/dist/Nexus Customer PDF Render/app/
// cpdf/styles.css:101-111` is precomputed once to sRGB hex here.
//
// **Name parity is non-negotiable** (brief §2.1): each `PP_*`
// const below mirrors the `--pp-*` CSS custom property name from
// CD's stylesheet so the audit traceability holds. If CD updates
// the palette, the diff lands in this file's source-of-truth
// scripts/compute-pdf-palette.mjs and the hex literals refresh
// from one re-run.
//
// **Pattern 45 boundary safe**: pure color constants; zero
// `CustomerView` reads, zero costing-surface imports. Allowed
// to live under `src/lib/pdf-*` per the inverse-sweep boundary
// plan (Step 1 boundary §2.3).
//
// **Source-of-truth re-derivation**: hex values produced by
// `node scripts/compute-pdf-palette.mjs` (Björn Ottosson OKLab
// transforms). The script preserves the canonical OKLCH inputs
// so a future palette refresh is a 1-minute re-run, not a manual
// recomputation.

// ────────────────────────────────────────────────────────────
// Canonical 11-token paged-artifact palette (styles.css:101-111)
// ────────────────────────────────────────────────────────────

/** `--pp-ink` · oklch(0.21 0.018 255) — body ink, masthead H1, totals. */
export const PP_INK = "#131921";

/** `--pp-ink-2` · oklch(0.36 0.016 255) — secondary ink (sub-labels). */
export const PP_INK_2 = "#383e46";

/** `--pp-ink-3` · oklch(0.52 0.014 255) — tertiary ink (captions). */
export const PP_INK_3 = "#646971";

/** `--pp-muted` · oklch(0.60 0.012 255) — muted labels (eyebrow). */
export const PP_MUTED = "#7b8187";

/** `--pp-rule` · oklch(0.86 0.010 90) — 1px hairline rules. */
export const PP_RULE = "#d3d1ca";

/** `--pp-rule-2` · oklch(0.74 0.012 90) — 1.5px stronger rules. */
export const PP_RULE_2 = "#aeaba2";

/** `--pp-strong` · oklch(0.21 0.018 255) — bottom strong rules (= --pp-ink). */
export const PP_STRONG = "#131921";

/** `--pp-rec-edge` · oklch(0.46 0.03 255) — recommended tier bracket / accent edge. */
export const PP_REC_EDGE = "#4d5969";

/** `--pp-rec-tint` · oklch(0.975 0.020 95) — recommended tier card tint. */
export const PP_REC_TINT = "#fbf7e8";

/** `--pp-star` · oklch(0.56 0.13 72) — ★ recommended marker glyph. */
export const PP_STAR = "#a26500";

/** `--pp-paper` · oklch(0.995 0.002 95) — sheet paper background. */
export const PP_PAPER = "#fefdfc";

// ────────────────────────────────────────────────────────────
// Inline oklch() colors scattered through .pp-* selectors
// ────────────────────────────────────────────────────────────
//
// styles.css:18 — page shadow stack inside-edge tint (computed
// from --pp-paper with `calc(l - 0.02)`).
/** `oklch(from var(--paper) calc(l - 0.02) c h)` shadow stack inside-edge. */
export const PP_SHADOW_INSIDE_EDGE = "#f7f7f5";

// styles.css:124-126 — pp-sheet box-shadow neutral blacks with
// alpha. react-pdf supports rgba() in StyleSheet values directly.
/** Box-shadow tier 1 (24px 50px). */
export const PP_SHADOW_BLACK_18 = "rgba(0, 0, 0, 0.18)";

/** Box-shadow tier 2 (24px 50px). */
export const PP_SHADOW_BLACK_30 = "rgba(0, 0, 0, 0.30)";

/** Box-shadow tier 3 (60px 110px). */
export const PP_SHADOW_BLACK_16 = "rgba(0, 0, 0, 0.16)";

// ────────────────────────────────────────────────────────────
// Convenience aggregate — for spreading into StyleSheet.create
// ────────────────────────────────────────────────────────────
//
// Components import either the named const (e.g. `PP_INK`) for
// targeted use OR the `PP` aggregate when consuming many tokens
// in one StyleSheet block.

export const PP = {
  ink: PP_INK,
  ink2: PP_INK_2,
  ink3: PP_INK_3,
  muted: PP_MUTED,
  rule: PP_RULE,
  rule2: PP_RULE_2,
  strong: PP_STRONG,
  recEdge: PP_REC_EDGE,
  recTint: PP_REC_TINT,
  star: PP_STAR,
  paper: PP_PAPER,
  shadowInsideEdge: PP_SHADOW_INSIDE_EDGE,
  shadowBlack18: PP_SHADOW_BLACK_18,
  shadowBlack30: PP_SHADOW_BLACK_30,
  shadowBlack16: PP_SHADOW_BLACK_16,
} as const;

export type PdfPalette = typeof PP;
