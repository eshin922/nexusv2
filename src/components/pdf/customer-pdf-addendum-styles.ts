// Slice 11 Step 3b — Pattern-30 verbatim translation of CD's `.a1v2-*`
// addendum CSS register to react-pdf StyleSheet objects.
//
// Source: docs/design-prototypes/dist/qw_a1v2.jsx `AddendumPage`
// (L1019-1089) + src/styles/r-a1v2-setup.css lines 658+ (the
// addendum-specific section starting at `.a1v2-pdf-paper`).
//
// Class-name parity is non-negotiable per Pattern 30: every `.a1v2-*`
// addendum selector in the upstream CSS has a corresponding key
// here. Naming: `.a1v2-foo-bar` → `fooBar` style key (drop the
// `.a1v2-` prefix; camelCase the rest). Where the upstream CSS
// targets a descendant (e.g. `.a1v2-addendum-header .title`), the
// key reads as the descendant slug (`headerTitle`) so anyone diffing
// the upstream against this file sees the mapping immediately.
//
// Mandatory mechanical substitutions per brief Step 3b:
//   - OKLCH → sRGB hex via the precomputed A1V2_* consts below
//     (Björn Ottosson OKLab transforms; same script as
//     scripts/compute-pdf-palette.mjs)
//   - `text-transform: uppercase` → `.toUpperCase()` JSX-side
//   - `display: grid; grid-template-columns: ...` → flex layouts
//     (react-pdf has no CSS Grid support per spike §1)
//   - `box-shadow` on `.a1v2-pdf-paper` → DROPPED (PDF has no
//     box-shadow primitive; matches the pricing pages drop)
//   - `border` + `border-radius` on `.a1v2-pdf-paper` → DROPPED
//     (the prototype's border + radius emulate the "paper" look in
//     DOM preview; in a real PDF the paper IS the page).
//   - `.a1v2-pdf-paper + .a1v2-pdf-paper::before { content: "page
//     break" }` → DROPPED (REVIEW chrome per brief substitution #10)
//   - `font-style: italic` → `fontStyle: 'italic'` at the Text style
//     (uses the Newsreader Italic variant from registerPdfFonts())
//   - `font-family: var(--display|ui)` → PDF_FONT_FAMILY.serif
//     (Newsreader). `var(--ui)` (Instrument Sans) is mapped to
//     Newsreader per brief: "we are NOT vendoring a third font
//     family for v1." This is the only color/font substitution
//     allowed beyond mechanical primitive port.
//   - `font-family: var(--mono)` → PDF_FONT_FAMILY.mono (JetBrains Mono)
//
// Pattern 45 boundary safe: zero `CustomerView` reads, zero
// costing-surface imports.
//
// Color decision (per brief judgment call): A1V2_* colors live
// INLINE here rather than extending pdf-palette.ts (PP_*). The
// pricing palette and the addendum palette derive from DIFFERENT
// design-token sources (PP_* mirrors CD's standalone customer-PDF
// styles.css; A1V2_* mirrors the project's design-tokens.css light
// theme used by the addendum). Co-locating addendum colors with the
// addendum styles keeps the two registers separate, avoids
// polluting the PP_ namespace, and keeps the verbatim port
// self-contained.

import "server-only";

import { StyleSheet } from "@react-pdf/renderer";

import { PDF_FONT_FAMILY } from "@/lib/pdf-fonts";

// ────────────────────────────────────────────────────────────
// Precomputed OKLCH → sRGB (light-theme tokens from
// src/styles/design-tokens.css :root + addendum-specific inline
// literals from r-a1v2-setup.css). One-shot derivation —
// re-run via scripts/compute-pdf-palette.mjs if tokens shift.
// ────────────────────────────────────────────────────────────

/** `--paper` · oklch(0.985 0.006 85) — page background. */
const A1V2_PAPER = "#fcfaf6";
/** `--paper-2` · oklch(0.965 0.008 85) — leaf-block background. */
const A1V2_PAPER_2 = "#f6f3ed";
/** `--rule` · oklch(0.88 0.012 85) — 1px hairline rules. */
const A1V2_RULE = "#dbd7cf";
/** `--rule-2` · oklch(0.82 0.014 85) — stronger rules (asy-head). */
const A1V2_RULE_2 = "#c8c4ba";
/** `--ink` · oklch(0.20 0.02 255) — body ink, addendum title, val. */
const A1V2_INK = "#10171f";
/** `--ink-3` · oklch(0.52 0.015 255) — subtitle ink + addendum-header meta. */
const A1V2_INK_3 = "#636a72";
/** `--ink-4` · oklch(0.68 0.012 255) — captions / labels / empty-val ink. */
const A1V2_INK_4 = "#9399a0";
/** `--accent-ink` · oklch(0.30 0.12 255) — sku tag + type-tag text. */
const A1V2_ACCENT_INK = "#002a67";
/** `oklch(from var(--accent) l c h / 0.12)` — sku tag + type-tag background. */
const A1V2_ACCENT_TINT = "rgba(0, 75, 151, 0.12)";
/** `--bad` · oklch(0.55 0.18 25) — "untyped" type-tag color. */
const A1V2_BAD = "#c53637";
/** `--bad-soft` · oklch(0.95 0.04 25) — "untyped" type-tag background. */
const A1V2_BAD_SOFT = "#ffe5e1";

export const a1v2Colors = {
  paper: A1V2_PAPER,
  paper2: A1V2_PAPER_2,
  rule: A1V2_RULE,
  rule2: A1V2_RULE_2,
  ink: A1V2_INK,
  ink3: A1V2_INK_3,
  ink4: A1V2_INK_4,
  accentInk: A1V2_ACCENT_INK,
  accentTint: A1V2_ACCENT_TINT,
  bad: A1V2_BAD,
  badSoft: A1V2_BAD_SOFT,
} as const;

export const addendumStyles = StyleSheet.create({
  // ─────────────────────────────────────────────────────────────
  // Page wrapper — `.a1v2-pdf-paper` (r-a1v2-setup.css:694-702)
  // ─────────────────────────────────────────────────────────────
  // Source: padding 36/40/48, background paper, font-family display.
  // border + border-radius + box-shadow dropped per substitution
  // table above (preview chrome; PDF has no equivalent primitive).
  // Pseudo-element page-break marker (`::before "page break"`) is
  // REVIEW chrome — also dropped (mandatory sub #10).
  page: {
    backgroundColor: A1V2_PAPER,
    color: A1V2_INK,
    fontFamily: PDF_FONT_FAMILY.serif,
    paddingTop: 27,
    paddingHorizontal: 30,
    paddingBottom: 36,
    flexDirection: "column",
  },
  // The flowing content region inside the page padding.
  flow: {
    flexGrow: 1,
  },

  // ─────────────────────────────────────────────────────────────
  // Addendum header — `.a1v2-addendum-header` (CSS L718-730)
  // ─────────────────────────────────────────────────────────────
  // Source: padding-bottom 14, border-bottom 2px ink, margin-bottom
  // 22, display grid 1fr auto. Grid → flex row with title flex 1
  // and meta auto. Two children spaced with the gap.
  header: {
    paddingBottom: 10.5,
    borderBottomWidth: 1.5,
    borderBottomColor: A1V2_INK,
    borderBottomStyle: "solid",
    marginBottom: 16.5,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  headerL: {
    flex: 1,
    flexDirection: "column",
  },
  // CSS gap: 18px → marginLeft on the right-hand child.
  headerR: {
    marginLeft: 13.5,
    flexDirection: "column",
  },
  // `.a1v2-addendum-header .title` — display 22 / weight 500 / -0.015em
  headerTitle: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontWeight: 500,
    fontSize: 16.5,
    letterSpacing: -0.33, // -0.015em × 22px
    color: A1V2_INK,
    marginBottom: 3,
  },
  // Subtitle (inline-styled in source L1026: ui font, 11.5, ink-3)
  // var(--ui) → Newsreader per brief substitution rule.
  headerSubtitle: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 8.75,
    color: A1V2_INK_3,
  },
  // `.a1v2-addendum-header .meta` — mono 10.5, ink-3, 0.06em, upper
  headerMeta: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8,
    color: A1V2_INK_3,
    letterSpacing: 0.63, // 0.06em × 10.5px
    // text-transform: uppercase → .toUpperCase() JSX-side
  },

  // ─────────────────────────────────────────────────────────────
  // Per-ASY block — `.a1v2-addendum-asy` (CSS L731-750)
  // ─────────────────────────────────────────────────────────────
  asy: {
    marginBottom: 16.5,
  },
  // `.asy-head` — flex row baseline, gap 10, mb 14, pb 8, border-bottom
  // 1px rule-2. Grid → flex; sku + name on left, meta margin-left auto.
  asyHead: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 10.5,
    paddingBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: A1V2_RULE_2,
    borderBottomStyle: "solid",
  },
  // `.asy-head .sku` — mono 11, accent-ink, 0.06em, accent-tint bg,
  // padding 3/8, radius 4.
  asyHeadSku: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8.25,
    color: A1V2_ACCENT_INK,
    letterSpacing: 0.66, // 0.06em × 11px
    backgroundColor: A1V2_ACCENT_TINT,
    paddingVertical: 2.25,
    paddingHorizontal: 6,
    borderRadius: 3,
  },
  // `.asy-head .name` — display 16, weight 500, ink, -0.005em.
  asyHeadName: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontWeight: 500,
    fontSize: 12,
    color: A1V2_INK,
    letterSpacing: -0.08, // -0.005em × 16px
    marginLeft: 7.5, // CSS gap: 10px between siblings
  },
  // `.asy-head .meta` — mono 10, ink-4, 0.04em, margin-left auto.
  asyHeadMeta: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.5,
    color: A1V2_INK_4,
    letterSpacing: 0.4, // 0.04em × 10px
    marginLeft: "auto",
    // text-transform — not explicit on this selector; matches CSS
    // (only the addendum-header .meta is uppercased).
  },

  // ─────────────────────────────────────────────────────────────
  // Leaf block — `.a1v2-leaf-block` (CSS L751-794)
  // ─────────────────────────────────────────────────────────────
  // `.a1v2-leaf-block` — paper-2 bg, 1px rule border, radius 8,
  // padding 14, margin-bottom 12.
  leafBlock: {
    backgroundColor: A1V2_PAPER_2,
    borderWidth: 0.75,
    borderColor: A1V2_RULE,
    borderStyle: "solid",
    borderRadius: 6,
    padding: 10.5,
    marginBottom: 9,
  },
  // `.a1v2-leaf-block.placeholder` — same bg, dashed border instead.
  leafBlockPlaceholder: {
    backgroundColor: A1V2_PAPER_2,
    borderWidth: 0.75,
    borderColor: A1V2_RULE,
    borderStyle: "dashed",
    borderRadius: 6,
    padding: 10.5,
    marginBottom: 9,
  },
  // `.a1v2-leaf-block .leaf-block-head` — flex row center, gap 10,
  // mb 10, pb 8, border-bottom 1px rule.
  leafBlockHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 7.5,
    paddingBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: A1V2_RULE,
    borderBottomStyle: "solid",
  },
  // `.leaf-block-head .name` — ui 12.5, ink, weight 500.
  // var(--ui) → Newsreader per brief substitution.
  leafBlockHeadName: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 9.5,
    color: A1V2_INK,
    fontWeight: 500,
  },
  // `.leaf-block-head .type-tag` — mono 9, accent-ink, 0.08em,
  // accent-tint bg, padding 2/6, radius 3, uppercase.
  leafBlockHeadTypeTag: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    color: A1V2_ACCENT_INK,
    letterSpacing: 0.72, // 0.08em × 9px
    backgroundColor: A1V2_ACCENT_TINT,
    paddingVertical: 1.5,
    paddingHorizontal: 4.5,
    borderRadius: 2.25,
    marginLeft: 7.5, // CSS gap: 10px to the name on its left
    // text-transform: uppercase → .toUpperCase() JSX-side
  },
  // Variant override for the "untyped" tag: inline-styled in source
  // L1045 with `color: var(--bad); background: var(--bad-soft)`.
  leafBlockHeadTypeTagUntyped: {
    color: A1V2_BAD,
    backgroundColor: A1V2_BAD_SOFT,
  },

  // ─────────────────────────────────────────────────────────────
  // Spec-field grid — `.pp-sp-grid` + `.section .row` (CSS L771-786)
  // ─────────────────────────────────────────────────────────────
  // `.a1v2-leaf-block .pp-sp-grid` — grid 1fr 1fr, gap 14. Currently
  // there's only ONE `.section` child per leaf, so single-column
  // flex serves both branches of the impl-6 useWideGrid switch
  // identically. Honoring the structure (wrapper present) but
  // collapsing to single column matches both prototype branches'
  // observable output.
  ppSpGrid: {
    flexDirection: "column",
  },
  // `.section` — column of h5 + rows.
  section: {
    flexDirection: "column",
  },
  // `.section h5` — mono 9, 0.12em, ink-4, mb 6, weight 500.
  sectionTitle: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 1.08, // 0.12em × 9px
    color: A1V2_INK_4,
    marginBottom: 4.5,
    fontWeight: 500,
    // text-transform: uppercase → .toUpperCase() JSX-side
  },
  // `.section .row` — grid 100px 1fr, gap 10, padding 4/0,
  // border-bottom 1px rule, ui 11, line-height 1.35.
  row: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: A1V2_RULE,
    borderBottomStyle: "solid",
    fontFamily: PDF_FONT_FAMILY.serif, // var(--ui) → Newsreader
    fontSize: 8.25,
    lineHeight: 1.35,
  },
  // `:last-child { border-bottom: none }` — react-pdf can't express
  // pseudo-classes; consumers conditionally apply rowLast on the
  // last row instead.
  rowLast: {
    borderBottomWidth: 0,
  },
  // `.row .lbl` — color ink-4. Fixed width 100 per grid-template.
  rowLabel: {
    width: 75,
    color: A1V2_INK_4,
  },
  // `.row .val` — color ink. Flex 1 to fill remainder. CSS gap: 10
  // approximated as marginLeft on the val element.
  rowValue: {
    flex: 1,
    color: A1V2_INK,
    marginLeft: 7.5,
  },
  // `.row .val.empty` — ink-4, italic, mono.
  rowValueEmpty: {
    color: A1V2_INK_4,
    fontStyle: "italic",
    fontFamily: PDF_FONT_FAMILY.mono,
  },

  // ─────────────────────────────────────────────────────────────
  // Placeholder message — `.a1v2-leaf-block.placeholder
  // .placeholder-msg` (CSS L790-794)
  // ─────────────────────────────────────────────────────────────
  // text-align center, padding 14/0, mono 10.5, ink-4, 0.04em,
  // uppercase. Goes inside leafBlockPlaceholder.
  placeholderMsg: {
    textAlign: "center",
    paddingVertical: 10.5,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8,
    color: A1V2_INK_4,
    letterSpacing: 0.42, // 0.04em × 10.5px
    // text-transform: uppercase → .toUpperCase() JSX-side
  },

  // ─────────────────────────────────────────────────────────────
  // Page footer — `.a1v2-pdf-paper .pdf-pagenum` (CSS L711-715)
  // ─────────────────────────────────────────────────────────────
  // position: absolute; bottom 18; right 24; mono 9.5, ink-4,
  // 0.06em, uppercase. In react-pdf, the fixed View positions at
  // bottom via padding offset on the Page, then absolute via
  // flex layout. Use bottom/right via `position: 'absolute'` +
  // explicit coordinates on a fixed View.
  pageFooter: {
    position: "absolute",
    bottom: 13.5,
    right: 18,
    flexDirection: "row",
  },
  pageFooterText: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.25,
    color: A1V2_INK_4,
    letterSpacing: 0.57, // 0.06em × 9.5px
    // text-transform: uppercase → .toUpperCase() JSX-side
  },
});
