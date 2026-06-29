import "server-only";

import path from "node:path";
import { Font } from "@react-pdf/renderer";

// Slice 11 Step 2 — Pattern-30 font registration for the
// customer-PDF render. Per brief §2.2:
//
//   - Vendor 7 variants (Newsreader R/Italic/Medium/SemiBold +
//     JetBrains Mono R/Medium/SemiBold)
//   - Register at module load (idempotent — re-imports no-op)
//   - Wire `fontFeatureSettings: ['tnum']` on the money styles
//     (Q-J — applied at StyleSheet level, NOT here per the spike
//     correction)
//
// **Physical files vendored under `public/fonts/`:**
//
//   Newsreader-Regular.ttf   — variable Roman   (opsz, wght axes)
//   Newsreader-Italic.ttf    — variable Italic  (opsz, wght axes)
//   JetBrainsMono-Regular.ttf  — static 400
//   JetBrainsMono-Medium.ttf   — static 500
//   JetBrainsMono-SemiBold.ttf — static 600
//
// Newsreader ships from Google Fonts as variable-only (no static
// instances); react-pdf 4.5.x uses fontkit under the hood and
// handles variable-font weight axis selection per Font.register
// call. Each weight binds to the same physical file with a
// different fontWeight — the renderer extracts the weight slice
// at render. 4 files → 7 register slots, all 4MB total
// (comfortable within Vercel's 50MB compressed function-size
// budget per spike §3).
//
// **Licensing:** Newsreader is SIL OFL 1.1; JetBrains Mono is
// Apache 2.0. Both compatible with proprietary distribution.
//
// **Pattern 45 boundary safe:** zero `CustomerView` reads,
// zero costing-surface imports. Allowed under `src/lib/pdf-*`
// per the inverse-sweep boundary plan (Step 1 boundary §2.3).
//
// **Idempotency:** Font.register on the same family+weight+style
// no-ops on re-call per react-pdf semantics. This module's
// top-level `registerPdfFonts()` is safe to call multiple times;
// production calls it from `renderToBuffer` callers (the action
// + route handlers) once per cold start.

const FONT_DIR = path.join(process.cwd(), "public/fonts");

const NEWSREADER_REGULAR = path.join(FONT_DIR, "Newsreader-Regular.ttf");
const NEWSREADER_ITALIC = path.join(FONT_DIR, "Newsreader-Italic.ttf");
const JETBRAINS_REGULAR = path.join(FONT_DIR, "JetBrainsMono-Regular.ttf");
const JETBRAINS_MEDIUM = path.join(FONT_DIR, "JetBrainsMono-Medium.ttf");
const JETBRAINS_SEMIBOLD = path.join(FONT_DIR, "JetBrainsMono-SemiBold.ttf");

let registered = false;

/**
 * Register the customer-PDF font set with react-pdf. Idempotent —
 * safe to call repeatedly; only the first call performs the
 * registration. Call from any code path that invokes
 * `renderToBuffer` / `renderToStream` (action handlers, route
 * handlers).
 */
export function registerPdfFonts(): void {
  if (registered) return;

  // Newsreader · variable Roman (registers at three weights from
  // one physical file). fontkit picks the appropriate weight axis
  // value per Font.register call.
  Font.register({
    family: "Newsreader",
    fonts: [
      { src: NEWSREADER_REGULAR, fontWeight: 400 },
      { src: NEWSREADER_REGULAR, fontWeight: 500 },
      { src: NEWSREADER_REGULAR, fontWeight: 600 },
      { src: NEWSREADER_ITALIC, fontWeight: 400, fontStyle: "italic" },
    ],
  });

  // JetBrains Mono · static instances per weight. Used for money
  // strings (`fontFeatureSettings: '"tnum"'` applied at the
  // StyleSheet text level per brief §2.2 + spike Q-J).
  Font.register({
    family: "JetBrains Mono",
    fonts: [
      { src: JETBRAINS_REGULAR, fontWeight: 400 },
      { src: JETBRAINS_MEDIUM, fontWeight: 500 },
      { src: JETBRAINS_SEMIBOLD, fontWeight: 600 },
    ],
  });

  registered = true;
}

/**
 * Font family names exposed as consts so consumers don't string-
 * literal them at call sites. Use these in `StyleSheet.create({})`
 * `fontFamily` properties.
 */
export const PDF_FONT_FAMILY = {
  /** Newsreader · serif body + display. Weight via `fontWeight: 400 | 500 | 600`. */
  serif: "Newsreader",
  /** JetBrains Mono · money + tabular figures. Weight via `fontWeight: 400 | 500 | 600`. */
  mono: "JetBrains Mono",
} as const;

/**
 * Style fragment to apply to any text that needs tabular figures
 * (money strings, tier qty headers, etc.). Brief §2.2 + Q-J:
 * `fontFeatureSettings` belongs on the StyleSheet text style,
 * not on Font.register (spike-recipe correction).
 *
 * Spread into a StyleSheet.create entry:
 *
 *   const styles = StyleSheet.create({
 *     money: {
 *       fontFamily: PDF_FONT_FAMILY.mono,
 *       fontSize: 12,
 *       ...PDF_TABULAR_NUMS,
 *     },
 *   });
 *
 * Graceful fallback: JetBrains Mono ships tabular figures by
 * default, so this feature is belt-and-suspenders — but applying
 * it explicitly makes the intent grep-able and survives a future
 * font swap.
 */
export const PDF_TABULAR_NUMS = {
  fontFeatureSettings: '"tnum"',
} as const;
