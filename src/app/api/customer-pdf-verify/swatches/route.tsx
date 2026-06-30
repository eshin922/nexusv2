// Slice 11 Step 3 — TEMPORARY palette + font-weight verify PDF.
//
// Renders the 11 canonical PP_* sRGB tokens as labeled swatches
// (hex values inline for diff clarity) + Newsreader (400/500/600/italic)
// + JetBrains Mono (400/500/600) weight ladder. Edward visually
// compares against CD's DOM preview during Step-3 review.
//
// **REMOVE in pre-v1 cleanup PR.**

import React from "react";

import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToStream,
} from "@react-pdf/renderer";

import { PDF_FONT_FAMILY, PDF_TABULAR_NUMS, registerPdfFonts } from "@/lib/pdf-fonts";
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

registerPdfFonts();
// Silence "unused import" — Font.register lives inside registerPdfFonts.
void Font;

const SWATCHES: ReadonlyArray<{
  name: string;
  hex: string;
  oklch: string;
  role: string;
}> = [
  { name: "PP_INK",      hex: PP_INK,      oklch: "oklch(0.21 0.018 255)", role: "body ink, masthead H1, totals" },
  { name: "PP_INK_2",    hex: PP_INK_2,    oklch: "oklch(0.36 0.016 255)", role: "secondary ink (sub-labels)" },
  { name: "PP_INK_3",    hex: PP_INK_3,    oklch: "oklch(0.52 0.014 255)", role: "tertiary ink (captions)" },
  { name: "PP_MUTED",    hex: PP_MUTED,    oklch: "oklch(0.60 0.012 255)", role: "muted labels (eyebrow)" },
  { name: "PP_RULE",     hex: PP_RULE,     oklch: "oklch(0.86 0.010 90)",  role: "1px hairline rules" },
  { name: "PP_RULE_2",   hex: PP_RULE_2,   oklch: "oklch(0.74 0.012 90)",  role: "1.5px stronger rules" },
  { name: "PP_STRONG",   hex: PP_STRONG,   oklch: "oklch(0.21 0.018 255)", role: "bottom strong rules (= --pp-ink)" },
  { name: "PP_REC_EDGE", hex: PP_REC_EDGE, oklch: "oklch(0.46 0.03 255)",  role: "recommended bracket / accent edge" },
  { name: "PP_REC_TINT", hex: PP_REC_TINT, oklch: "oklch(0.975 0.020 95)", role: "recommended tier card tint" },
  { name: "PP_STAR",     hex: PP_STAR,     oklch: "oklch(0.56 0.13 72)",   role: "★ recommended marker glyph" },
  { name: "PP_PAPER",    hex: PP_PAPER,    oklch: "oklch(0.995 0.002 95)", role: "sheet paper background" },
];

const s = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT_FAMILY.serif,
    paddingTop: 56,
    paddingHorizontal: 64,
    paddingBottom: 56,
    backgroundColor: PP_PAPER,
    color: PP_INK,
    flexDirection: "column",
  },
  h1: {
    fontFamily: PDF_FONT_FAMILY.serif,
    fontSize: 22,
    fontWeight: 600,
    color: PP_INK,
    marginBottom: 4,
  },
  sub: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9.5,
    letterSpacing: 1.5,
    color: PP_MUTED,
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 9,
    letterSpacing: 1.26,
    color: PP_MUTED,
    marginTop: 24,
    marginBottom: 8,
  },
  swatchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: PP_RULE,
    borderBottomStyle: "solid",
  },
  swatchChip: {
    width: 56,
    height: 28,
    borderWidth: 0.5,
    borderColor: PP_RULE_2,
    borderStyle: "solid",
    marginRight: 14,
  },
  swatchName: {
    flexBasis: 110,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10,
    color: PP_INK,
    fontWeight: 500,
  },
  swatchHex: {
    flexBasis: 80,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10,
    color: PP_INK_3,
    ...PDF_TABULAR_NUMS,
  },
  swatchOklch: {
    flexBasis: 160,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 8.5,
    color: PP_MUTED,
  },
  swatchRole: {
    flex: 1,
    fontSize: 10,
    color: PP_INK_2,
    fontStyle: "italic",
  },
  fontRow: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: PP_RULE,
    borderBottomStyle: "solid",
  },
  fontLabel: {
    flexBasis: 200,
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 10,
    color: PP_INK_3,
  },
  fontSample: {
    flex: 1,
    color: PP_INK,
  },
  moneySample: {
    fontFamily: PDF_FONT_FAMILY.mono,
    fontSize: 13,
    color: PP_INK,
    ...PDF_TABULAR_NUMS,
  },
});

function SwatchesDoc() {
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <Text style={s.h1}>Slice 11 Step 3 — Palette + Font Verify</Text>
        <Text style={s.sub}>
          {"OKLCH → sRGB precompute · Pattern-30 traceability".toUpperCase()}
        </Text>

        {/* Palette section */}
        <Text style={s.sectionLabel}>
          {"11 canonical PP_* sRGB tokens".toUpperCase()}
        </Text>
        {SWATCHES.map((sw) => (
          <View key={sw.name} style={s.swatchRow}>
            <View style={[s.swatchChip, { backgroundColor: sw.hex }]} />
            <Text style={s.swatchName}>{sw.name}</Text>
            <Text style={s.swatchHex}>{sw.hex}</Text>
            <Text style={s.swatchOklch}>{sw.oklch}</Text>
            <Text style={s.swatchRole}>{sw.role}</Text>
          </View>
        ))}

        {/* Newsreader weight ladder */}
        <Text style={s.sectionLabel}>
          {"Newsreader variable-axis weight ladder".toUpperCase()}
        </Text>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>Newsreader 400 Roman</Text>
          <Text style={[s.fontSample, { fontFamily: PDF_FONT_FAMILY.serif, fontWeight: 400, fontSize: 14 }]}>
            The quick brown fox jumps over the lazy dog.
          </Text>
        </View>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>Newsreader 500 Medium</Text>
          <Text style={[s.fontSample, { fontFamily: PDF_FONT_FAMILY.serif, fontWeight: 500, fontSize: 14 }]}>
            The quick brown fox jumps over the lazy dog.
          </Text>
        </View>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>Newsreader 600 SemiBold</Text>
          <Text style={[s.fontSample, { fontFamily: PDF_FONT_FAMILY.serif, fontWeight: 600, fontSize: 14 }]}>
            The quick brown fox jumps over the lazy dog.
          </Text>
        </View>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>Newsreader 400 Italic</Text>
          <Text
            style={[
              s.fontSample,
              {
                fontFamily: PDF_FONT_FAMILY.serif,
                fontWeight: 400,
                fontStyle: "italic",
                fontSize: 14,
              },
            ]}
          >
            FOB Long Beach — landed in unit price.
          </Text>
        </View>

        {/* JetBrains Mono weight ladder */}
        <Text style={s.sectionLabel}>
          {"JetBrains Mono weight ladder + tabular figures".toUpperCase()}
        </Text>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>JetBrains Mono 400</Text>
          <Text style={[s.fontSample, { fontFamily: PDF_FONT_FAMILY.mono, fontWeight: 400, fontSize: 11 }]}>
            DPS-2418 · 2026-05-17
          </Text>
        </View>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>JetBrains Mono 500</Text>
          <Text style={[s.fontSample, { fontFamily: PDF_FONT_FAMILY.mono, fontWeight: 500, fontSize: 11 }]}>
            DPS-2418 · 2026-05-17
          </Text>
        </View>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>JetBrains Mono 600</Text>
          <Text style={[s.fontSample, { fontFamily: PDF_FONT_FAMILY.mono, fontWeight: 600, fontSize: 11 }]}>
            DPS-2418 · 2026-05-17
          </Text>
        </View>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>Money string · tabular</Text>
          <Text style={s.moneySample}>$1,234.56 · $48.50 · $9,600</Text>
        </View>

        {/* Star glyph check */}
        <Text style={s.sectionLabel}>
          {"Star glyph (U+2605) coverage check".toUpperCase()}
        </Text>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>Newsreader 400</Text>
          <Text
            style={[
              s.fontSample,
              { fontFamily: PDF_FONT_FAMILY.serif, color: PP_STAR, fontSize: 18 },
            ]}
          >
            ★ T2 (recommended)
          </Text>
        </View>
        <View style={s.fontRow}>
          <Text style={s.fontLabel}>JetBrains Mono 400</Text>
          <Text
            style={[
              s.fontSample,
              { fontFamily: PDF_FONT_FAMILY.mono, color: PP_STAR, fontSize: 14 },
            ]}
          >
            ★ T2
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function GET() {
  const stream = await renderToStream(<SwatchesDoc />);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
    },
  });
}
