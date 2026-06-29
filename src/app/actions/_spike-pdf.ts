"use server";

// Slice 11 Gate 0 — react-pdf viability smoke (THROWAWAY).
//
// Per cc-customer-pdf-library-spike-slice11.md §8 + Slice 11 brief §1.
// Verifies:
//   1. renderToBuffer round-trips in a Next.js 15 App Router server action
//      (resolves react-pdf issue #3074 ambiguity for THIS repo / version)
//   2. Newsreader + JetBrains Mono register from vendored TTFs
//   3. fontFeatureSettings: ['tnum'] applies to $1,234.56
//   4. Vercel preview deployment doesn't blow function-size budget
//
// Branch: spike/slice-11-react-pdf-smoke (delete after smoke passes).
// Trigger: src/app/_spike/page.tsx renders a form that POSTs to this action.

import path from "node:path";
import React from "react";
import {
  Document,
  Page,
  Text,
  Font,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

Font.register({
  family: "Newsreader",
  src: path.join(process.cwd(), "public/fonts/Newsreader-Regular.ttf"),
});
Font.register({
  family: "JetBrains Mono",
  src: path.join(process.cwd(), "public/fonts/JetBrainsMono-Regular.ttf"),
});

const styles = StyleSheet.create({
  page: { padding: 56, fontFamily: "Newsreader", fontSize: 14 },
  money: {
    fontFamily: "JetBrains Mono",
    fontSize: 12,
    marginTop: 12,
    // PR #2740 / spike §1 Q-J — `tnum` enables tabular-nums OpenType
    // feature. Belongs on the text-style, not Font.register (spike §8
    // recipe had it on register; that's not the runtime API shape).
    fontFeatureSettings: '"tnum"',
  },
});

const Doc = () =>
  React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "LETTER", style: styles.page },
      React.createElement(Text, null, "Spike test — Newsreader serif"),
      React.createElement(Text, { style: styles.money }, "$1,234.56"),
    ),
  );

export async function spikeRenderPdf(): Promise<{
  ok: boolean;
  size?: number;
  error?: string;
  preview?: string;
}> {
  try {
    const buffer = await renderToBuffer(Doc());
    return {
      ok: true,
      size: buffer.length,
      // First 4 bytes of a PDF are %PDF (0x25 0x50 0x44 0x46). Surface
      // the magic bytes as a sanity check that we got an actual PDF
      // back, not an error string crammed into a Buffer.
      preview: buffer.subarray(0, 8).toString("hex"),
    };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      error: `${err.name}: ${err.message}`,
    };
  }
}
