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
    paddingTop: 56,
    paddingHorizontal: 64,
    paddingBottom: 88,
    flexDirection: "column",
  },
  // pp-sheet.continuation { padding-top: 64px }
  sheetContinuation: {
    paddingTop: 64,
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
    paddingBottom: 16,
    borderBottomWidth: 1.5,
    borderBottomColor: PP_STRONG,
    borderBottomStyle: "solid",
  },
  // .pp-masthead .v-id — implicit container; CD JSX uses className="v-id"
  vId: {
    flexDirection: "column",
  },
  vName: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 27,
    fontWeight: 500,
    letterSpacing: -0.54, // -0.02em × 27px
    color: PP_INK,
    lineHeight: 1.05,
  },
  vSub: {
    fontSize: 12,
    color: PP_INK_3,
    marginTop: 5,
    maxWidth: 336, // 42ch ≈ 8px × 42 (Newsreader @12px)
    lineHeight: 1.45,
  },
  vMeta: {
    textAlign: "right",
    flexShrink: 0,
    marginLeft: 28,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10,
    color: PP_INK_3,
    letterSpacing: 0.3, // 0.03em × 10px
    lineHeight: 1.85,
    flexDirection: "column",
    alignItems: "flex-end",
  },
  vMetaQnum: {
    fontSize: 16,
    color: PP_INK,
    letterSpacing: 0.32, // 0.02em × 16px
    marginBottom: 6,
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
    marginTop: 18,
  },
  party: {
    flex: 1,
    paddingRight: 24,
    flexDirection: "column",
  },
  partyLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 1.26, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 5,
  },
  pname: {
    fontSize: 16,
    fontWeight: 500,
    color: PP_INK,
    marginBottom: 2,
  },
  pline: {
    fontSize: 12,
    color: PP_INK_2,
    lineHeight: 1.5,
  },

  // ─────────────────────────────────────────────────────────────
  // Section heads — pp-eyebrow, pp-h2, pp-h3, pp-lede
  // styles.css:170-189
  // ─────────────────────────────────────────────────────────────
  eyebrow: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9.5,
    letterSpacing: 1.52, // 0.16em × 9.5px
    color: PP_MUTED,
    marginBottom: 6,
  },
  h2: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 18,
    fontWeight: 500,
    letterSpacing: -0.18, // -0.01em × 18px
    color: PP_INK,
    marginBottom: 4,
  },
  h3: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: -0.07, // -0.005em × 14px
    color: PP_INK,
    marginBottom: 6,
  },
  lede: {
    fontSize: 11.5,
    color: PP_INK_2,
    lineHeight: 1.55,
    maxWidth: 512, // 64ch ≈ 8 × 64
  },
  ledeEm: {
    fontStyle: "italic",
    color: PP_INK,
  },
  // .pp-section / .pp-section.tight — vertical spacers between blocks
  section: {
    marginTop: 26,
  },
  sectionTight: {
    marginTop: 16,
  },

  // ─────────────────────────────────────────────────────────────
  // Pricing table — pp-table, pp-thead, pp-tbody, pp-tr,
  // pp-c-prod, pp-c-num, pp-c-rec
  // styles.css:194-216, 220-221
  // ─────────────────────────────────────────────────────────────
  table: {
    flexDirection: "column",
    marginTop: 14,
  },
  thead: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: 1.5,
    borderBottomColor: PP_STRONG,
    borderBottomStyle: "solid",
    paddingBottom: 7,
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
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: PP_RULE,
    borderBottomStyle: "solid",
  },
  // .pp-c-prod { flex: 2.5 1 0; min-width: 0; padding-right: 14px }
  cProd: {
    flex: 2.5,
    minWidth: 0,
    paddingRight: 14,
    flexDirection: "column",
  },
  // .pp-c-num { flex: 1 1 0; min-width: 0; text-align: right;
  //   border-left: 1px solid transparent; border-right: 1px solid transparent;
  //   padding: 0 8px }
  cNum: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    borderLeftWidth: 1,
    borderLeftColor: "transparent",
    borderLeftStyle: "solid",
    borderRightWidth: 1,
    borderRightColor: "transparent",
    borderRightStyle: "solid",
    paddingHorizontal: 8,
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
    borderTopWidth: 1,
    borderTopColor: PP_REC_EDGE,
    borderTopStyle: "solid",
    paddingTop: 5,
  },

  // ─────────────────────────────────────────────────────────────
  // Header cell content — pp-th-lab, pp-th-sub, pp-th-rec, .star, .rec-word
  // styles.css:223-238
  // ─────────────────────────────────────────────────────────────
  thLab: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10,
    letterSpacing: 0.6, // 0.06em × 10px
    color: PP_INK,
    fontWeight: 500,
  },
  // .pp-c-prod .pp-th-lab { letter-spacing: 0.12em; text-transform:
  //   uppercase; font-size: 9px; color: var(--pp-muted) }
  thLabProd: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 1.08, // 0.12em × 9px
    color: PP_MUTED,
    fontWeight: 500,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  thSub: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8.5,
    letterSpacing: 0.34, // 0.04em × 8.5px
    color: PP_MUTED,
    marginTop: 3,
    fontWeight: 400,
  },
  // .pp-th-rec { display: inline-flex; align-items: center; gap: 4px;
  //   color: var(--pp-ink) }
  thRec: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    color: PP_INK,
  },
  // .pp-th-rec .star { color: var(--pp-star); font-size: 10px }
  thRecStar: {
    color: PP_STAR,
    fontSize: 10,
  },
  // .pp-th-sub .rec-word { color: var(--pp-star); letter-spacing: 0.10em }
  recWord: {
    color: PP_STAR,
    letterSpacing: 0.85, // 0.10em × 8.5px (sub-line context)
  },

  // ─────────────────────────────────────────────────────────────
  // Body cells — pp-prod-name, pp-prod-meta, .code, pp-prod-flat,
  // pp-price (variants: .dash, .req)
  // styles.css:241-257
  // ─────────────────────────────────────────────────────────────
  prodName: {
    fontSize: 13,
    fontWeight: 500,
    color: PP_INK,
    lineHeight: 1.25,
  },
  prodMeta: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9.5,
    color: PP_MUTED,
    letterSpacing: 0.19, // 0.02em × 9.5px
    marginTop: 3,
  },
  prodMetaCode: {
    color: PP_INK_3,
  },
  prodFlat: {
    fontStyle: "italic",
    fontSize: 10.5,
    color: PP_INK_3,
    marginTop: 3,
  },
  price: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 12.5,
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
    fontSize: 11,
    color: PP_MUTED,
  },
  tableFoot: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 0.36, // 0.04em × 9px
    color: PP_MUTED,
    marginTop: 8,
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
    fontSize: 10.5,
    fontStyle: "italic",
    color: PP_INK_3,
    marginTop: 2,
    marginBottom: 8,
  },
  chargeGroupLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8.5,
    letterSpacing: 1.02, // 0.12em × 8.5px
    color: PP_MUTED,
    marginTop: 12,
    marginBottom: 2,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  chargeRow: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: PP_RULE,
    borderBottomStyle: "solid",
  },
  cLabel: {
    flex: 1,
    paddingRight: 14,
    flexDirection: "column",
  },
  cLabelT: {
    fontSize: 12.5,
    color: PP_INK,
  },
  cLabelS: {
    fontSize: 10.5,
    fontStyle: "italic",
    color: PP_MUTED,
    marginTop: 2,
    lineHeight: 1.4,
  },
  cQty: {
    flexBasis: 130,
    flexShrink: 0,
    flexGrow: 0,
    textAlign: "right",
    paddingRight: 16,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9.5,
    color: PP_INK_3,
    letterSpacing: 0.19, // 0.02em × 9.5px
  },
  cAmt: {
    flexBasis: 96,
    flexShrink: 0,
    flexGrow: 0,
    textAlign: "right",
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 12.5,
    fontWeight: 500,
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
  },
  cAmtPer: {
    fontSize: 9,
    fontWeight: 400,
    color: PP_MUTED,
    marginLeft: 2,
  },

  // ─────────────────────────────────────────────────────────────
  // Terms block — pp-terms, pp-term, .label, .value
  // styles.css:290-301
  // ─────────────────────────────────────────────────────────────
  terms: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1.5,
    borderTopColor: PP_STRONG,
    borderTopStyle: "solid",
    paddingTop: 16,
    marginTop: 8,
  },
  term: {
    flexBasis: "50%",
    flexShrink: 0,
    flexGrow: 0,
    paddingRight: 24,
    paddingBottom: 16,
    flexDirection: "column",
  },
  termLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 1.26, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 4,
  },
  termValue: {
    fontSize: 12.5,
    color: PP_INK,
    lineHeight: 1.45,
  },

  // ─────────────────────────────────────────────────────────────
  // Notes — pp-notes, .label, p
  // styles.css:304-314
  // ─────────────────────────────────────────────────────────────
  notes: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: PP_NOTES_BG,
    borderLeftWidth: 3,
    borderLeftColor: PP_RULE_2,
    borderLeftStyle: "solid",
    flexDirection: "column",
  },
  notesLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 1.26, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 5,
  },
  notesP: {
    fontSize: 11,
    color: PP_INK_2,
    lineHeight: 1.55,
  },

  // ─────────────────────────────────────────────────────────────
  // How-to-accept — pp-accept, p
  // styles.css:317-318
  // ─────────────────────────────────────────────────────────────
  accept: {
    marginTop: 22,
  },
  acceptP: {
    fontSize: 11.5,
    color: PP_INK_2,
    lineHeight: 1.55,
    maxWidth: 512, // 64ch
  },

  // ─────────────────────────────────────────────────────────────
  // Running header (fixed; pages 2+) — pp-runhead, .l, .l strong, .r
  // styles.css:321-330
  // ─────────────────────────────────────────────────────────────
  // CD uses position:absolute + top:28; in react-pdf we use
  // `fixed` prop on the View. Match the inset values.
  runhead: {
    position: "absolute",
    top: 28,
    left: 64,
    right: 64,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: PP_RULE,
    borderBottomStyle: "solid",
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 0.54, // 0.06em × 9px
    color: PP_INK_3,
  },
  runheadL: {
    color: PP_INK_2,
  },
  runheadLStrong: {
    color: PP_INK,
    fontWeight: 500,
    letterSpacing: 0.9, // 0.10em × 9px
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  runheadR: {
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
    letterSpacing: 0.9, // 0.10em × 9px
    color: PP_MUTED,
  },

  // ─────────────────────────────────────────────────────────────
  // Footer (fixed; every page) — pp-footer, .l strong
  // styles.css:334-341
  // ─────────────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    left: 64,
    right: 64,
    bottom: 30,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: PP_RULE,
    borderTopStyle: "solid",
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8.5,
    letterSpacing: 0.425, // 0.05em × 8.5px
    color: PP_MUTED,
  },
  footerLStrong: {
    color: PP_INK_3,
    fontWeight: 500,
    letterSpacing: 0.85, // 0.10em × 8.5px
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },

  // ═════════════════════════════════════════════════════════════
  // ADDENDUM 1 — line totals · grand turnkey · turnkey-only
  // styles.css:347-485
  // ═════════════════════════════════════════════════════════════

  // ─── pp-linetotal · (.pp-c-rec .pp-linetotal) ─────────────────
  linetotal: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9.5,
    color: PP_MUTED,
    letterSpacing: 0.095, // 0.01em × 9.5px
    marginTop: 3,
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
    borderTopWidth: 1.5,
    borderTopColor: PP_STRONG,
    borderTopStyle: "solid",
    paddingTop: 11,
    marginTop: 2,
  },
  gLabel: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 14,
    fontWeight: 600,
    color: PP_INK,
    letterSpacing: -0.07, // -0.005em × 14px
  },
  gSub: {
    fontSize: 10,
    fontStyle: "italic",
    color: PP_MUTED,
    marginTop: 1,
  },
  // .pp-grand .pp-c-rec { border-bottom: 1px solid var(--pp-rec-edge);
  //   padding-bottom: 8px }
  grandCRec: {
    borderBottomWidth: 1,
    borderBottomColor: PP_REC_EDGE,
    borderBottomStyle: "solid",
    paddingBottom: 8,
  },
  grandNum: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 14,
    fontWeight: 600,
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
  },
  // .pp-grand-num.req — serif italic medium 12px ink-2
  grandNumReq: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontStyle: "italic",
    fontWeight: 500,
    fontSize: 12,
    color: PP_INK_2,
  },
  grandUnit: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10,
    color: PP_INK_3,
    letterSpacing: 0.1, // 0.01em × 10px
    marginTop: 4,
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
    fontSize: 10,
    color: PP_MUTED,
    marginRight: 3,
  },
  // .pp-grand-notes — flex column gap 3
  grandNotes: {
    marginTop: 9,
    flexDirection: "column",
    gap: 3,
  },
  grandNote: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 10.5,
    color: PP_INK_3,
    lineHeight: 1.45,
  },
  // .pp-grand-note .k — mono uppercase 8.5px muted with right margin 6
  grandNoteK: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8.5,
    letterSpacing: 0.85, // 0.10em × 8.5px
    color: PP_MUTED,
    marginRight: 6,
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
    marginTop: 6,
    flexDirection: "column",
  },
  // .pp-turnkey .pp-lede { margin-bottom: 18 }
  turnkeyLede: {
    marginBottom: 18,
  },

  // ─── tier_table turnkey-only → pp-tk-cards · pp-tk-card · .rec
  tkCards: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  tkCard: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: PP_RULE,
    borderStyle: "solid",
    borderRightWidth: 0,
    flexDirection: "column",
  },
  // .pp-tk-card:last-child { border-right-width: 1px }
  tkCardLast: {
    borderRightWidth: 1,
  },
  // .pp-tk-card.rec — lifted 1.5px border + tint + negative margin
  // negative margin -2 -1 + z-index stack: react-pdf renders in
  // source order; the -1/-2 inset matches CD's "lifted card"
  // optical effect.
  tkCardRec: {
    borderWidth: 1.5,
    borderColor: PP_REC_EDGE,
    borderStyle: "solid",
    backgroundColor: PP_REC_TINT,
    marginTop: -2,
    marginHorizontal: -1,
    marginBottom: -2,
  },
  // pp-tk-tier · .star
  tkTier: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 11,
    letterSpacing: 0.66, // 0.06em × 11px
    color: PP_INK,
    fontWeight: 500,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tkTierStar: {
    color: PP_STAR,
  },
  tkQty: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 0.36, // 0.04em × 9px
    color: PP_MUTED,
    marginTop: 3,
  },
  tkRecWord: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8,
    letterSpacing: 0.8, // 0.10em × 8px
    color: PP_STAR,
    marginTop: 5,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  tkTotal: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 24,
    fontWeight: 500,
    letterSpacing: -0.48, // -0.02em × 24px
    color: PP_INK,
    marginTop: 14,
    ...PDF_TABULAR_NUMS,
    lineHeight: 1.05,
  },
  // .pp-tk-card.rec .pp-tk-total { font-weight: 600 }
  tkTotalRec: {
    fontWeight: 600,
  },
  tkPerunit: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10,
    color: PP_INK_3,
    letterSpacing: 0.1, // 0.01em × 10px
    marginTop: 5,
    ...PDF_TABULAR_NUMS,
  },
  tkPerunitPer: {
    color: PP_MUTED,
  },
  // .pp-tk-total .from — serif italic 12px muted block element
  tkTotalFrom: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontStyle: "italic",
    fontSize: 12,
    fontWeight: 400,
    color: PP_MUTED,
  },
  // .pp-tk-total.req — italic medium 15px ink-2
  tkTotalReq: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 15,
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
    borderTopWidth: 1.5,
    borderTopColor: PP_STRONG,
    borderTopStyle: "solid",
    borderBottomWidth: 1.5,
    borderBottomColor: PP_STRONG,
    borderBottomStyle: "solid",
    paddingVertical: 20,
    marginTop: 4,
  },
  hMeta: {
    flexDirection: "column",
  },
  hLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 1.26, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 6,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  hTier: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 16,
    color: PP_INK,
  },
  hTierStar: {
    color: PP_STAR,
  },
  hQty: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10,
    color: PP_INK_3,
    marginTop: 3,
    letterSpacing: 0.3, // 0.03em × 10px
  },
  hNum: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 40,
    fontWeight: 600,
    letterSpacing: -1.2, // -0.03em × 40px
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
    lineHeight: 1,
  },
  hNumReq: {
    fontSize: 24,
    fontStyle: "italic",
    fontWeight: 500,
    color: PP_INK_2,
  },
  tkHeroUnit: {
    textAlign: "right",
    marginTop: 8,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 13,
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
    fontWeight: 500,
  },
  tkHeroUnitPer: {
    fontWeight: 400,
    color: PP_MUTED,
    fontSize: 10,
    letterSpacing: 0.2, // 0.02em × 10px
  },

  // ─── pp-tk-included · .label · pp-tk-scope · .code ·
  //   pp-tk-incl-list · pp-tk-incl · .tick · .out
  // styles.css:467-485
  tkIncluded: {
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: PP_TK_INCLUDED_BG,
    borderWidth: 1,
    borderColor: PP_RULE,
    borderStyle: "solid",
    flexDirection: "column",
  },
  tkIncludedLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 1.26, // 0.14em × 9px
    color: PP_MUTED,
    marginBottom: 8,
    // textTransform: 'uppercase' — JSX applies .toUpperCase()
  },
  tkScope: {
    fontSize: 12,
    color: PP_INK,
    lineHeight: 1.5,
  },
  tkScopeCode: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10.5,
    color: PP_INK_3,
  },
  tkInclList: {
    marginTop: 10,
    flexDirection: "column",
    gap: 5,
  },
  tkIncl: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 11,
    color: PP_INK_2,
    lineHeight: 1.4,
    flexDirection: "row",
    gap: 8,
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
