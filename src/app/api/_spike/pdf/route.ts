// Slice 11 Gate 0 — react-pdf smoke binary serve (THROWAWAY).
//
// Streams the rendered PDF as application/pdf so the smoke walker
// can open it in a viewer to confirm Newsreader + JetBrains Mono
// render and tabular-nums applies. Pair with /_spike (which calls
// the action + reports buffer metadata) for the full smoke.
//
// Branch: spike/slice-11-react-pdf-smoke (delete after pass).

import { NextResponse } from "next/server";
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

export async function GET() {
  try {
    const buffer = await renderToBuffer(Doc());
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="slice-11-spike.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json(
      { ok: false, error: `${err.name}: ${err.message}` },
      { status: 500 },
    );
  }
}
