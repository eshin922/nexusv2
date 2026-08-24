// Slice 11 Step 3 — Pattern-30 verbatim translation of CD's `.pp-*`
// CSS register to react-pdf StyleSheet objects.
//
// Source: docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/
//         styles.css (61 .pp-* selectors)
//
// Class-name parity is non-negotiable: every `.pp-*` selector in CD's
// stylesheet has a corresponding key here. Naming: `.pp-foo-bar` →
// `fooBar` style key (drop `.pp-` prefix; camelCase the rest). Where
// a CD selector targets a descendant of a parent class (e.g.
// `.pp-masthead .v-name`), the key reads as the descendant slug
// (`vName`) — anyone diffing styles.css against this file should see
// the mapping immediately.
//
// Pattern 30 discipline: every value comes from CD's source —
// no JS-side improvements, no token swaps, no "while we're here"
// tweaks. Where CD shipped `gap: 4px`, this StyleSheet ships
// `gap: 4`. Where CD shipped `font-style: italic` on `<em>`
// children, the JSX nests `<Text style={styles.lede}><Text
// style={styles.ledeEm}>...</Text></Text>`.
//
// Mandatory mechanical substitutions per audit §4 + spike §1:
// - OKLCH → sRGB hex via `PP_*` consts from `@/lib/pdf-palette`
// - `text-transform: uppercase` → `.toUpperCase()` JSX-side (no
//   `textTransform` token in style here even though spike §1 says
//   "supported"; the per-call .toUpperCase() form is more grep-able
//   and matches the brief's literal direction)
// - `font-variant-numeric: tabular-nums` → spread `PDF_TABULAR_NUMS`
// - `var(--pp-*)` → JS const refs
// - `position: absolute` → react-pdf `fixed` prop on `<View>` (JSX-side)
// - `box-shadow` on `.pp-sheet` → DROPPED (preview chrome; PDF has
//   no box-shadow primitive)
// - `font-family: "Newsreader" / "JetBrains Mono"` → `PDF_FONT_FAMILY.*`
//
// Pattern 45 boundary safe: zero `CustomerView` reads, zero
// costing-surface imports.

import "server-only";

import { StyleSheet } from "@react-pdf/renderer";

import {
  PDF_FONT_FAMILY,
  PDF_TABULAR_NUMS,
} from "@/lib/pdf-fonts";
import {
  PP_INK,
  PP_INK_2,
  PP_INK_3,
  PP_MUTED,
  PP_PAPER,
  PP_REC_EDGE,
  PP_REC_TINT,
  PP_RULE,
  PP_RULE_2,
  PP_STAR,
  PP_STRONG,
} from "@/lib/pdf-palette";

// styles.css:306 — `.pp-notes` background; standalone oklch literal
// `oklch(0.97 0.010 90)` — precomputed.
const PP_NOTES_BG = "#f7f5f0";

// styles.css:469 — `.pp-tk-included` background; standalone oklch
// `oklch(0.975 0.008 90)` — precomputed.
const PP_TK_INCLUDED_BG = "#f9f7f1";

export const styles = StyleSheet.create({
  // ─────────────────────────────────────────────────────────────
  // Sheet · Page wrapper · pp-sheet, pp-sheet.continuation, pp-flow
  // styles.css:100-130
  // ─────────────────────────────────────────────────────────────
  // pp-sheet: 816×1056 page box; padding 56/64/88. Box-shadow stack
  // (lines 123-126) DROPPED — preview chrome on the prototype; PDF
  // has no box-shadow primitive (spike §1 + audit §4).
  sheet: {
    backgroundColor: PP_PAPER,
    color: PP_INK,
    fontFamily: PDF_FONT_FAMILY.serif,
    // Slice 11 Step 3 Fix 2 (CA 2026-06-30): use CD's continuation
    // padding (48pt; CD `styles.css:331 .pp-sheet.continuation`
    // padding-top: 64px → 48pt) UNIFORMLY across all pages, not just
    // continuations. react-pdf can't switch padding per page within
    // one `<Page>` element; using the larger value uniformly reserves
    // the runhead band (fires on pages 2+) without harming page 1
    // (6pt extra breathing on the masthead). `sheetContinuation`
    // removed — never applied; replaced by this uniform padding.
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 66,
    flexDirection: "column",
  },
  // pp-flow { flex: 1 0 auto }
  flow: {
    flexGrow: 1,
  },

  // ─────────────────────────────────────────────────────────────
  // Masthead — pp-masthead, .v-name, .v-sub, .v-meta, .qnum
  // styles.css:133-154
  // ─────────────────────────────────────────────────────────────
  masthead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1.25,
    borderBottomColor: PP_STRONG,
    borderBottomStyle: "solid",
  },
  // .pp-masthead .v-id — implicit container; CD JSX uses className="v-id"
  vId: {
    flexDirection: "column",
  },
  vName: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 20.25,
    fontWeight: 500,
    letterSpacing: -0.4, // -0.02em × 27px
    color: PP_INK,
    lineHeight: 1.05,
  },
  vSub: {
    fontSize: 9,
    color: PP_INK_3,
    marginTop: 3.75,
    maxWidth: 252, // 42ch ≈ 8px × 42 (Newsreader @12px)
    lineHeight: 1.45,
  },
  vMeta: {
    textAlign: "right",
    flexShrink: 0,
    marginLeft: 21,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.5,
    color: PP_INK_3,
    letterSpacing: 0.22, // 0.03em × 10px
    lineHeight: 1.85,
    flexDirection: "column",
    alignItems: "flex-end",
  },
  vMetaQnum: {
    fontSize: 12,
    color: PP_INK,
    letterSpacing: 0.24, // 0.02em × 16px
    marginBottom: 4.5,
  },
  // Nexus extension per Pattern 39 — project-title line rendered
  // under vMetaQnum. NOT in CD canonical. Italic serif, PP_INK_2,
  // small — sits between the numeric quote number and the mono
  // Issued/Valid-until lines without crowding the hierarchy CD
  // tuned. maxWidth caps at the .v-meta right column so a long
  // deal name wraps rather than overflowing the masthead.
  vMetaTitle: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontStyle: "italic",
    fontSize: 9,
    color: PP_INK_2,
    letterSpacing: -0.09, // -0.01em × 9pt
    lineHeight: 1.3,
    marginBottom: 5,
    maxWidth: 180,
    textAlign: "right",
  },
  vMetaLine: {
    // each meta row is a Text line inside .v-meta
  },
  vMetaStrong: {
    color: PP_INK_2,
    fontWeight: 500,
  },

  // ─────────────────────────────────────────────────────────────
  // Parties — pp-parties, .party, .label, .pname, .pline
  // styles.css:157-167
  // ─────────────────────────────────────────────────────────────
  parties: {
    flexDirection: "row",
    marginTop: 13.5,
  },
  party: {
    flex: 1,
    paddingRight: 18,
    flexDirection: "column",
  },
  partyLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.95, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 3.75,
  },
  pname: {
    fontSize: 12,
    fontWeight: 500,
    color: PP_INK,
    marginBottom: 1.5,
  },
  pline: {
    fontSize: 9,
    color: PP_INK_2,
    lineHeight: 1.5,
  },

  // ─────────────────────────────────────────────────────────────
  // Section heads — pp-eyebrow, pp-h2, pp-h3, pp-lede
  // styles.css:170-189
  // ─────────────────────────────────────────────────────────────
  eyebrow: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.25,
    letterSpacing: 1.14, // 0.16em × 9.5px
    color: PP_MUTED,
    marginBottom: 4.5,
  },
  h2: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 13.5,
    fontWeight: 500,
    letterSpacing: -0.13, // -0.01em × 18px
    color: PP_INK,
    marginBottom: 3,
  },
  h3: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: -0.05, // -0.005em × 14px
    color: PP_INK,
    marginBottom: 4.5,
  },
  lede: {
    fontSize: 8.75,
    color: PP_INK_2,
    lineHeight: 1.55,
    maxWidth: 384, // 64ch ≈ 8 × 64
  },
  ledeEm: {
    fontStyle: "italic",
    color: PP_INK,
  },
  // .pp-section / .pp-section.tight — vertical spacers between blocks
  section: {
    marginTop: 19.5,
  },
  sectionTight: {
    marginTop: 12,
  },

  // ─────────────────────────────────────────────────────────────
  // Pricing table — pp-table, pp-thead, pp-tbody, pp-tr,
  // pp-c-prod, pp-c-num, pp-c-rec
  // styles.css:194-216, 220-221
  // ─────────────────────────────────────────────────────────────
  table: {
    flexDirection: "column",
    marginTop: 10.5,
  },
  thead: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: 1.25,
    borderBottomColor: PP_STRONG,
    borderBottomStyle: "solid",
    paddingBottom: 5.25,
  },
  // .pp-thead.continued { border-top: none }
  theadContinued: {
    // no-op: thead has no border-top by default; explicit reset for fidelity
    borderTopWidth: 0,
  },
  tbody: {
    flexDirection: "column",
  },
  tr: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingVertical: 6.75,
    borderBottomWidth: 0.75,
    borderBottomColor: PP_RULE,
    borderBottomStyle: "solid",
  },
  // .pp-c-prod { flex: 2.5 1 0; min-width: 0; padding-right: 14px }
  cProd: {
    flex: 2.5,
    minWidth: 0,
    paddingRight: 10.5,
    flexDirection: "column",
  },
  // .pp-c-num { flex: 1 1 0; min-width: 0; text-align: right;
  //   border-left: 1px solid transparent; border-right: 1px solid transparent;
  //   padding: 0 8px }
  cNum: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    borderLeftWidth: 0.75,
    borderLeftColor: "transparent",
    borderLeftStyle: "solid",
    borderRightWidth: 0.75,
    borderRightColor: "transparent",
    borderRightStyle: "solid",
    paddingHorizontal: 6,
    flexDirection: "column",
    alignItems: "flex-end",
  },
  // .pp-thead .pp-c-num { align-self: flex-end }
  theadCNum: {
    alignSelf: "flex-end",
  },
  // .pp-c-rec — recommended column accent (border-left/right colored
  // + tint background). Combined with .pp-c-num via array spread.
  cRec: {
    borderLeftColor: PP_REC_EDGE,
    borderRightColor: PP_REC_EDGE,
    backgroundColor: PP_REC_TINT,
  },
  // .pp-thead .pp-c-rec { border-top: 1px solid var(--pp-rec-edge);
  //   padding-top: 5px }
  theadCRec: {
    borderTopWidth: 0.75,
    borderTopColor: PP_REC_EDGE,
    borderTopStyle: "solid",
    paddingTop: 3.75,
  },

  // ─────────────────────────────────────────────────────────────
  // Header cell content — pp-th-lab, pp-th-sub, pp-th-rec, .star, .rec-word
  // styles.css:223-238
  // ─────────────────────────────────────────────────────────────
  thLab: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.5,
    letterSpacing: 0.45, // 0.06em × 10px
    color: PP_INK,
    fontWeight: 500,
  },
  // .pp-c-prod .pp-th-lab { letter-spacing: 0.12em; text-transform:
  //   uppercase; font-size: 9px; color: var(--pp-muted) }
  thLabProd: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.81, // 0.12em × 9px
    color: PP_MUTED,
    fontWeight: 500,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  thSub: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.5,
    letterSpacing: 0.26, // 0.04em × 8.5px
    color: PP_MUTED,
    marginTop: 2.25,
    fontWeight: 400,
  },
  // .pp-th-rec { display: inline-flex; align-items: center; gap: 4px;
  //   color: var(--pp-ink) }
  thRec: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    color: PP_INK,
  },
  // .pp-th-rec .star { color: var(--pp-star); font-size: 10px }
  thRecStar: {
    color: PP_STAR,
    fontSize: 7.5,
  },
  // .pp-th-sub .rec-word { color: var(--pp-star); letter-spacing: 0.10em }
  recWord: {
    color: PP_STAR,
    letterSpacing: 0.64, // 0.10em × 8.5px (sub-line context)
  },

  // ─────────────────────────────────────────────────────────────
  // Body cells — pp-prod-name, pp-prod-meta, .code, pp-prod-flat,
  // pp-price (variants: .dash, .req)
  // styles.css:241-257
  // ─────────────────────────────────────────────────────────────
  prodName: {
    fontSize: 9.75,
    fontWeight: 500,
    color: PP_INK,
    lineHeight: 1.25,
  },
  prodMeta: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.25,
    color: PP_MUTED,
    letterSpacing: 0.14, // 0.02em × 9.5px
    marginTop: 2.25,
  },
  prodMetaCode: {
    color: PP_INK_3,
  },
  prodFlat: {
    fontStyle: "italic",
    fontSize: 8,
    color: PP_INK_3,
    marginTop: 2.25,
  },
  price: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9.5,
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
  },
  // .pp-c-rec .pp-price { font-weight: 600 }
  priceRec: {
    fontWeight: 600,
  },
  // .pp-price.dash { color: var(--pp-muted) }
  priceDash: {
    color: PP_MUTED,
  },
  // .pp-price.req — serif italic 11px muted, white-space: nowrap
  priceReq: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontStyle: "italic",
    fontSize: 8.25,
    color: PP_MUTED,
  },
  tableFoot: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.27, // 0.04em × 9px
    color: PP_MUTED,
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  // ─────────────────────────────────────────────────────────────
  // Charges block — pp-charges, pp-charge-sub, pp-charge-group-label,
  // pp-charge-row, .c-label .t / .s, .c-qty, .c-amt, .c-amt .per
  // styles.css:265-287
  // ─────────────────────────────────────────────────────────────
  // .pp-charges — kept-together container; wrap={false} on the View
  charges: {
    flexDirection: "column",
  },
  chargeSub: {
    fontSize: 8,
    fontStyle: "italic",
    color: PP_INK_3,
    marginTop: 1.5,
    marginBottom: 6,
  },
  chargeGroupLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.5,
    letterSpacing: 0.77, // 0.12em × 8.5px
    color: PP_MUTED,
    marginTop: 9,
    marginBottom: 1.5,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  chargeRow: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingVertical: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: PP_RULE,
    borderBottomStyle: "solid",
  },
  cLabel: {
    flex: 1,
    paddingRight: 10.5,
    flexDirection: "column",
  },
  cLabelT: {
    fontSize: 9.5,
    color: PP_INK,
  },
  cLabelS: {
    fontSize: 8,
    fontStyle: "italic",
    color: PP_MUTED,
    marginTop: 1.5,
    lineHeight: 1.4,
  },
  cQty: {
    flexBasis: 130,
    flexShrink: 0,
    flexGrow: 0,
    textAlign: "right",
    paddingRight: 12,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.25,
    color: PP_INK_3,
    letterSpacing: 0.14, // 0.02em × 9.5px
  },
  cAmt: {
    flexBasis: 96,
    flexShrink: 0,
    flexGrow: 0,
    textAlign: "right",
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9.5,
    fontWeight: 500,
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
  },
  cAmtPer: {
    fontSize: 6.75,
    fontWeight: 400,
    color: PP_MUTED,
    marginLeft: 1.5,
  },

  // ─────────────────────────────────────────────────────────────
  // Terms block — pp-terms, pp-term, .label, .value
  // styles.css:290-301
  // ─────────────────────────────────────────────────────────────
  terms: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1.25,
    borderTopColor: PP_STRONG,
    borderTopStyle: "solid",
    paddingTop: 12,
    marginTop: 6,
  },
  term: {
    flexBasis: "50%",
    flexShrink: 0,
    flexGrow: 0,
    paddingRight: 18,
    paddingBottom: 12,
    flexDirection: "column",
  },
  termLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.95, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 3,
  },
  termValue: {
    fontSize: 9.5,
    color: PP_INK,
    lineHeight: 1.45,
  },

  // ─────────────────────────────────────────────────────────────
  // Notes — pp-notes, .label, p
  // styles.css:304-314
  // ─────────────────────────────────────────────────────────────
  notes: {
    marginTop: 4.5,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: PP_NOTES_BG,
    borderLeftWidth: 2.25,
    borderLeftColor: PP_RULE_2,
    borderLeftStyle: "solid",
    flexDirection: "column",
  },
  notesLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.95, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 3.75,
  },
  notesP: {
    fontSize: 8.25,
    color: PP_INK_2,
    lineHeight: 1.55,
  },

  // ─────────────────────────────────────────────────────────────
  // How-to-accept — pp-accept, p
  // styles.css:317-318
  // ─────────────────────────────────────────────────────────────
  accept: {
    marginTop: 16.5,
  },
  acceptP: {
    fontSize: 8.75,
    color: PP_INK_2,
    lineHeight: 1.55,
    maxWidth: 384, // 64ch
  },

  // ─────────────────────────────────────────────────────────────
  // Running header (fixed; pages 2+) — pp-runhead, .l, .l strong, .r
  // styles.css:321-330
  // ─────────────────────────────────────────────────────────────
  // CD uses position:absolute + top:28; in react-pdf we use
  // `fixed` prop on the View. Match the inset values.
  runhead: {
    position: "absolute",
    top: 21,
    left: 48,
    right: 48,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: PP_RULE,
    borderBottomStyle: "solid",
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.41, // 0.06em × 9px
    color: PP_INK_3,
  },
  runheadL: {
    color: PP_INK_2,
  },
  runheadLStrong: {
    color: PP_INK,
    fontWeight: 500,
    letterSpacing: 0.68, // 0.10em × 9px
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  runheadR: {
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
    letterSpacing: 0.68, // 0.10em × 9px
    color: PP_MUTED,
  },

  // ─────────────────────────────────────────────────────────────
  // Footer (fixed; every page) — pp-footer, .l strong
  // styles.css:334-341
  // ─────────────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    left: 48,
    right: 48,
    bottom: 22.5,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: 7.5,
    borderTopWidth: 0.75,
    borderTopColor: PP_RULE,
    borderTopStyle: "solid",
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.5,
    letterSpacing: 0.32, // 0.05em × 8.5px
    color: PP_MUTED,
  },
  footerLStrong: {
    color: PP_INK_3,
    fontWeight: 500,
    letterSpacing: 0.64, // 0.10em × 8.5px
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },

  // ═════════════════════════════════════════════════════════════
  // ADDENDUM 1 — line totals · grand turnkey · turnkey-only
  // styles.css:347-485
  // ═════════════════════════════════════════════════════════════

  // ─── pp-linetotal · (.pp-c-rec .pp-linetotal) ─────────────────
  linetotal: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.25,
    color: PP_MUTED,
    letterSpacing: 0.07, // 0.01em × 9.5px
    marginTop: 2.25,
    ...PDF_TABULAR_NUMS,
  },
  // .pp-c-rec .pp-linetotal { color: var(--pp-ink-3) }
  linetotalRec: {
    color: PP_INK_3,
  },

  // ─── pp-grand · .g-label · .g-sub · (.pp-c-rec) ──────────────
  grand: {
    flexDirection: "row",
    alignItems: "baseline",
    borderTopWidth: 1.25,
    borderTopColor: PP_STRONG,
    borderTopStyle: "solid",
    paddingTop: 8.25,
    marginTop: 1.5,
  },
  gLabel: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 10.5,
    fontWeight: 600,
    color: PP_INK,
    letterSpacing: -0.05, // -0.005em × 14px
  },
  gSub: {
    fontSize: 7.5,
    fontStyle: "italic",
    color: PP_MUTED,
    marginTop: 0.75,
  },
  // .pp-grand .pp-c-rec { border-bottom: 1px solid var(--pp-rec-edge);
  //   padding-bottom: 8px }
  grandCRec: {
    borderBottomWidth: 0.75,
    borderBottomColor: PP_REC_EDGE,
    borderBottomStyle: "solid",
    paddingBottom: 6,
  },
  grandNum: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10.5,
    fontWeight: 600,
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
  },
  // .pp-grand-num.req — serif italic medium 12px ink-2
  grandNumReq: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontStyle: "italic",
    fontWeight: 500,
    fontSize: 9,
    color: PP_INK_2,
  },
  grandUnit: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.5,
    color: PP_INK_3,
    letterSpacing: 0.08, // 0.01em × 10px
    marginTop: 3,
    ...PDF_TABULAR_NUMS,
  },
  // .pp-c-rec .pp-grand-unit { color: var(--pp-ink-2) }
  grandUnitRec: {
    color: PP_INK_2,
  },
  // .pp-grand-unit .per { color: var(--pp-muted) }
  grandUnitPer: {
    color: PP_MUTED,
  },
  // .pp-grand-num .from — serif italic 400 10px muted
  grandNumFrom: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontStyle: "italic",
    fontWeight: 400,
    fontSize: 7.5,
    color: PP_MUTED,
    marginRight: 2.25,
  },
  // .pp-grand-notes — flex column gap 3
  grandNotes: {
    marginTop: 6.75,
    flexDirection: "column",
    gap: 2.25,
  },
  grandNote: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 8,
    color: PP_INK_3,
    lineHeight: 1.45,
  },
  // .pp-grand-note .k — mono uppercase 8.5px muted with right margin 6
  grandNoteK: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.5,
    letterSpacing: 0.64, // 0.10em × 8.5px
    color: PP_MUTED,
    marginRight: 4.5,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  grandNoteFreight: {
    color: PP_INK_2,
  },
  // .pp-grand-note .amt — mono ink-2
  grandNoteAmt: {
    fontFamily: PDF_FONT_FAMILY.mono,
    color: PP_INK_2,
  },

  // ─── Turnkey-only · pp-turnkey, .single ──────────────────────
  turnkey: {
    marginTop: 4.5,
    flexDirection: "column",
  },
  // .pp-turnkey .pp-lede { margin-bottom: 18 }
  turnkeyLede: {
    marginBottom: 13.5,
  },

  // ─── tier_table turnkey-only → pp-tk-cards · pp-tk-card · .rec
  tkCards: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  tkCard: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 13.5,
    borderWidth: 0.75,
    borderColor: PP_RULE,
    borderStyle: "solid",
    borderRightWidth: 0,
    flexDirection: "column",
  },
  // .pp-tk-card:last-child { border-right-width: 1px }
  tkCardLast: {
    borderRightWidth: 0.75,
  },
  // .pp-tk-card.rec — lifted 1.5px border + tint + negative margin
  // negative margin -2 -1 + z-index stack: react-pdf renders in
  // source order; the -1/-2 inset matches CD's "lifted card"
  // optical effect.
  //
  // Slice 11 matrix Fix 3 defensive (2026-07-27) — zeroed
  // `marginHorizontal: -0.75` (was CD's horizontal "lift" inset).
  // Cluster-1 smoke reproduces last-char rendering ("3" from
  // "$1,083" at 1000/5000, "3" from "$1,733" at 2000/8000) on the
  // NON-recommended tier card in tier_table × turnkey_only. Static
  // code inspection ruled out helper/index/slice/font paths. Best
  // remaining hypothesis: react-pdf's negative-margin flex-row
  // overlap draws the recommended card's tint background over the
  // non-recommended card's tkTotal text — but the horizontal
  // negative margin is the only overlap-inducing style. Trading
  // the ~1.5pt total "lift" width for correct rendering; vertical
  // lift (marginTop/marginBottom -1.5) preserved since it doesn't
  // touch sibling text bounds. If Cluster 1 persists post-fix,
  // the vertical margins go next.
  tkCardRec: {
    borderWidth: 1.25,
    borderColor: PP_REC_EDGE,
    borderStyle: "solid",
    backgroundColor: PP_REC_TINT,
    marginTop: -1.5,
    marginHorizontal: 0,
    marginBottom: -1.5,
  },
  // pp-tk-tier · .star
  tkTier: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8.25,
    letterSpacing: 0.5, // 0.06em × 11px
    color: PP_INK,
    fontWeight: 500,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  tkTierStar: {
    color: PP_STAR,
  },
  tkQty: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.27, // 0.04em × 9px
    color: PP_MUTED,
    marginTop: 2.25,
  },
  tkRecWord: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6,
    letterSpacing: 0.6, // 0.10em × 8px
    color: PP_STAR,
    marginTop: 3.75,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  tkTotal: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 18,
    fontWeight: 500,
    letterSpacing: -0.36, // -0.02em × 24px
    color: PP_INK,
    marginTop: 10.5,
    ...PDF_TABULAR_NUMS,
    lineHeight: 1.05,
  },
  // .pp-tk-card.rec .pp-tk-total { font-weight: 600 }
  tkTotalRec: {
    fontWeight: 600,
  },
  // The non-recommended weight, stated as its own entry rather than left
  // implicit in `tkTotal`.
  //
  // Computed style is unchanged -- `tkTotal` already sets 500. What changes is
  // that BOTH headline branches now pass react-pdf a two-element style array,
  // which is the only shape observed to render the full string in the deployed
  // runtime. See customer-pdf-turnkey-summary.tsx for the evidence.
  tkTotalStd: {
    fontWeight: 500,
  },
  tkPerunit: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.5,
    color: PP_INK_3,
    letterSpacing: 0.08, // 0.01em × 10px
    marginTop: 3.75,
    ...PDF_TABULAR_NUMS,
  },
  tkPerunitPer: {
    color: PP_MUTED,
  },
  // .pp-tk-total .from — serif italic 12px muted block element
  tkTotalFrom: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontStyle: "italic",
    fontSize: 9,
    fontWeight: 400,
    color: PP_MUTED,
  },
  // .pp-tk-total.req — italic medium 15px ink-2
  tkTotalReq: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 11.25,
    fontStyle: "italic",
    fontWeight: 500,
    color: PP_INK_2,
  },

  // ─── single_tier turnkey-only → pp-tk-hero, .h-meta, .h-label,
  //   .h-tier, .h-tier .star, .h-qty, .h-num, .h-num.req ───────
  tkHero: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    borderTopWidth: 1.25,
    borderTopColor: PP_STRONG,
    borderTopStyle: "solid",
    borderBottomWidth: 1.25,
    borderBottomColor: PP_STRONG,
    borderBottomStyle: "solid",
    paddingVertical: 15,
    marginTop: 3,
  },
  hMeta: {
    flexDirection: "column",
  },
  hLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.95, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 4.5,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  hTier: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 12,
    color: PP_INK,
  },
  hTierStar: {
    color: PP_STAR,
  },
  hQty: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 7.5,
    color: PP_INK_3,
    marginTop: 2.25,
    letterSpacing: 0.22, // 0.03em × 10px
  },
  hNum: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: -0.9, // -0.03em × 40px
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
    lineHeight: 1,
  },
  hNumReq: {
    fontSize: 18,
    fontStyle: "italic",
    fontWeight: 500,
    color: PP_INK_2,
  },
  tkHeroUnit: {
    textAlign: "right",
    marginTop: 6,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9.75,
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
    fontWeight: 500,
  },
  tkHeroUnitPer: {
    fontWeight: 400,
    color: PP_MUTED,
    fontSize: 7.5,
    letterSpacing: 0.15, // 0.02em × 10px
  },

  // ─── pp-tk-included · .label · pp-tk-scope · .code ·
  //   pp-tk-incl-list · pp-tk-incl · .tick · .out
  // styles.css:467-485
  tkIncluded: {
    marginTop: 15,
    paddingVertical: 10.5,
    paddingHorizontal: 13.5,
    backgroundColor: PP_TK_INCLUDED_BG,
    borderWidth: 0.75,
    borderColor: PP_RULE,
    borderStyle: "solid",
    flexDirection: "column",
  },
  tkIncludedLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 6.75,
    letterSpacing: 0.95, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 6,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  tkScope: {
    fontSize: 9,
    color: PP_INK,
    lineHeight: 1.5,
  },
  tkScopeCode: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8,
    color: PP_INK_3,
  },
  tkInclList: {
    marginTop: 7.5,
    flexDirection: "column",
    gap: 3.75,
  },
  tkIncl: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 8.25,
    color: PP_INK_2,
    lineHeight: 1.4,
    flexDirection: "row",
    gap: 6,
  },
  tkInclTick: {
    color: PP_INK_3,
    flexShrink: 0,
  },
  // .pp-tk-incl.out — italic ink-3 with muted tick
  tkInclOut: {
    color: PP_INK_3,
    fontStyle: "italic",
  },
  tkInclOutTick: {
    color: PP_MUTED,
  },
});
