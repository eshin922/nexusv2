# Slice 11 — Customer-PDF Library Spike (F1.1)

Author: CC
Date: 2026-06-29
Status: research deliverable; no implementation
Consumer: CA's Slice 11 implementation brief
Scope question: can `@react-pdf/renderer` render the customer-PDF
artifact server-side on Vercel against CD's committed design package
primitives — or does it fail / can't express something load-bearing?

---

## TL;DR

**Green light, with two pre-implementation mechanical conversions
and one 15-minute verification smoke.** CD explicitly authored the
design to react-pdf primitives (see
`docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/styles.css:3-9`
— "Authored within paged-PDF primitives (brief §3): flexbox composition
only — NO css grid, NO css `gap` inside the sheet"). The CSS file
labels its bottom half "everything below = react-pdf-portable"
(`styles.css:95-97`). Every load-bearing construct maps to a
supported react-pdf primitive. No structural blocker.

Two mechanical conversions are needed at Pattern 30 path-B adoption
time: precompute the 11 OKLCH palette tokens to hex/rgb (react-pdf
has no OKLCH parser) and flatten `--pp-*` CSS custom properties into
literal StyleSheet values. Both are mechanical, both touch only
the canonical CSS file at the conversion boundary.

One verification gate: render an empty `<Document>` from a Next.js
15 server action and confirm the buffer round-trips through Vercel
Fluid Compute. Multiple GH issues from early 2025 reported
`renderToBuffer` broken in Next.js 15 (#3074) on `@react-pdf/renderer
4.1.6`; current versions are `4.5.1` (April 2026) and Next.js 15 now
ships `@react-pdf/renderer` in its default `serverExternalPackages`
list, so the historical issue is plausibly resolved — but
unverified. Smoke before committing the library.

Recommendation confidence: **high** (the design was authored to
this library; the bundle fits Vercel's function size budget with
room to spare; the only outstanding question is the smoke, not
the architecture).

---

## 1. react-pdf primitive set vs CD's prototype constructs

### Primitive coverage

| react-pdf primitive | CD usage | Status |
| --- | --- | --- |
| `<Document>` | root `cpdf-doc` div wrapping all `Sheet`s | ✅ direct map |
| `<Page>` | each `Sheet` (`pdf-render.jsx:335-343`) → one Page | ✅ direct map; size: `LETTER` (8.5in × 11in) |
| `<View>` | every `<div>` in the `.pp-*` tree | ✅ direct map (1:1) |
| `<Text>` | every text-bearing element (`<span>`, `<p>`, `<strong>`, `<em>`) | ✅ direct map; inline `<Text>` children for nested styling |
| `<Image>` | none used in v1 (no vendor logo in `data.js`) | n/a — banked for v1.1 logo |
| `<Svg>` + `<Path>` | star glyph (`★` literal in JSX, `pdf-render.jsx:101, 216, 236, 451`) | ✅ replace literal `★` with `<Svg>`+`<Path>` for portability across PDF reader fonts (recommended) OR rely on Newsreader's glyph coverage (lower-effort fallback; verify in smoke) |
| `<Link>` | none used | n/a |
| `<Note>` | none used | n/a |
| `<Canvas>` | none used | n/a |

CD's authored vocabulary is `<div>`/`<span>`/`<p>`/`<strong>`/`<em>` —
all map cleanly to `<View>`/`<Text>`. The tree depth in
`pdf-render.jsx` is modest (max ~5 levels nested in `pp-tk-card`,
`pp-grand`, `pp-charge-row`).

### Layout properties — portability table

| CSS construct | react-pdf support | CD usage | Risk | Port note |
| --- | --- | --- | --- | --- |
| `display: flex` + `flex-direction` | ✅ | every `.pp-*` block | low | direct mapping |
| `display: grid` | ❌ NOT supported | NOT used (CD explicitly avoided per file header `styles.css:5`) | n/a | — |
| `gap` / `rowGap` / `columnGap` | ✅ supported in v4.x | `gap` used in 2 spots (`.pp-tk-incl-list`, `.pp-grand-notes`, `.pp-tk-incl`) | low | direct |
| `flex: 1 1 0` / `flex-basis: 50%` | ✅ | `.pp-c-prod` (`flex: 2.5 1 0`), `.pp-c-num` (`flex: 1 1 0`), `.pp-term` (`flex: 0 0 50%`), `.pp-tk-card` (`flex: 1 1 0`) | low | direct |
| `flex-wrap` | ✅ | `.pp-terms` uses `flex-wrap: wrap` for 2-col grid emulation | low | direct |
| `align-items: baseline` | ✅ | `.pp-tr`, `.pp-charge-row`, `.pp-grand`, `.pp-tk-hero` | low | direct |
| `position: relative` | ✅ | `.pp-sheet`, `.pp-tk-card.rec` | low | direct |
| `position: absolute` | ✅ | `.pp-runhead`, `.pp-footer` (used together with react-pdf's `fixed` prop) | low | the `position: absolute` here is the *web preview* expression; in react-pdf, set `fixed={true}` on the `<View>` and use `render={({ pageNumber, totalPages }) => ...}` for page numbers. CD documented this explicit mapping in `styles.css:5-8` |
| `position: fixed` | ❌ NOT supported | NOT used (CD used `absolute` + react-pdf `fixed` prop) | n/a | — |
| `wrap={false}` / `break-inside: avoid` | ✅ via `wrap={false}` prop | `.pp-charges` carries a comment hint `kept-together block (react-pdf wrap={false})` at `styles.css:265` | low | add `wrap={false}` prop on the View; CD pre-flagged the intent |
| `break` (forced page split) | ✅ via `break` prop | CD models page breaks by emitting separate `Sheet` components (`pdf-render.jsx:433, 492`) — one Sheet = one Page | low | each Sheet renders as its own `<Page>` element; no break prop needed |
| `<table>` `<tr>` `<td>` | n/a (would need flex emulation) | NOT used (CD already flex-emulated pricing table via `.pp-table`, `.pp-thead`, `.pp-tr`) | n/a | — |
| Margin / padding | ✅ supported (numeric only) | every block uses px-margin layout (CD explicitly chose margin over gap per `styles.css:5-6`) | low | numeric values only — no `auto` margin shorthand (use `marginHorizontal: 'auto'` or explicit values) |
| `border` / `borderColor` / `borderStyle` | ✅ | `.pp-thead`, `.pp-tr`, `.pp-c-rec`, `.pp-tk-card`, `.pp-grand`, etc. | low | direct |
| `borderRadius` | ✅ | NOT used in `.pp-*` artifact tree (only preview chrome `.cpdf-toolbar`) | n/a | — |
| `box-shadow` | ❌ NOT supported in PDF | `.pp-sheet` uses `box-shadow` for paper-on-desk web preview look | low | the box-shadow is preview chrome only; PDF doesn't need it (the paper *is* the page in print) — drop at port time |
| `box-sizing: border-box` | ✅ react-pdf is border-box by default | `.pp-sheet *` sets it | low | no-op port |

### Typography & color

| CSS construct | react-pdf support | CD usage | Risk | Port note |
| --- | --- | --- | --- | --- |
| `font-family: "Newsreader", Georgia, serif` | ✅ via `Font.register` | masthead, headings, lede, prices.req, etc. | medium | vendor Newsreader TTF (SIL OFL 1.1, Google Fonts) under `public/fonts/`; register at module load |
| `font-family: "JetBrains Mono", ui-monospace, monospace` | ✅ via `Font.register` | eyebrows, prices, codes, table heads, meta | medium | vendor JetBrains Mono TTF (Apache 2.0); register at module load |
| `font-size` | ✅ (numeric only — drop `px` suffix) | every block | low | mechanical conversion |
| `font-weight` numeric (400, 500, 600) | ✅ | masthead, headings, prices | low | register weight variants explicitly (Newsreader-Regular.ttf, Newsreader-Medium.ttf, Newsreader-SemiBold.ttf) |
| `font-style: italic` | ✅ | `.pp-lede em`, `.pp-charge-row .c-label .s`, `.pp-prod-flat`, `.pp-price.req`, `.pp-grand-num .from`, `.pp-tk-incl.out` | medium | register italic variants explicitly (Newsreader-Italic.ttf); use `fontStyle: 'italic'` |
| `letter-spacing` | ✅ as `letterSpacing` | every eyebrow, `qnum`, `code`, etc. | low | mechanical |
| `line-height` | ✅ as `lineHeight` | every paragraph block | low | direct |
| `text-transform: uppercase` | ✅ via `textTransform: 'uppercase'` | eyebrows, labels, footer chrome | low | direct |
| `font-variant-numeric: tabular-nums` | ⚠️ partial | `.pp-price`, `.pp-linetotal`, `.pp-grand-num`, `.pp-grand-unit`, `.pp-tk-total`, etc. (every monetary number) | medium | NOT a direct CSS property in react-pdf. Use `fontFeatureSettings: ['tnum']` at register time OR per-style. Confirmed supported via [PR #2740](https://github.com/diegomura/react-pdf/pull/2740) (merged into 3.x+); 4.5.1 should ship the feature. Verify in smoke. |
| `text-decoration: underline` + `text-underline-offset` | ✅ underline supported; offset partial | only used in preview chrome (`.cpdf-toolbar .layout-toggle button.active`) | n/a | — |
| `oklch(...)` color | ❌ NOT supported | 28 occurrences in CD's stylesheet (theme tokens via `var(--pp-ink)` etc., a few inline) | **medium** | precompute every OKLCH value to hex/rgb at canonical-CSS adoption time (Pattern 30). The `.pp-*` palette is a fixed 11-color print palette declared once at `styles.css:101-111` — one mechanical pass. CSS Color Module 4 specs define an OKLCH→sRGB algorithm; tools like `culori` or browser `getComputedStyle()` can convert. v1.1+ may move to a build-time CSS post-processor if more designs ship OKLCH. |
| `var(--pp-*)` CSS custom properties | ❌ NOT supported | every color reference in the `.pp-*` tree | **medium** | inline literal hex/rgb values into the react-pdf `StyleSheet.create({})` objects. Pattern 30 says "canonical CSS file pristine"; CC's StyleSheet objects are the react-pdf-side translation. Carry the upstream `--pp-*` name as a JS const for traceability (`const PP_INK = '#2e3340'; ...`). |
| Inline `oklch(from var(--internal) ...)` color-mix | ❌ NOT supported (only in preview `.cpdf-toolbar` chrome, not artifact) | preview-only | n/a | — |
| `font-feature-settings` | ✅ via Font.register fonts array | (implicit; needed for `tabular-nums`) | low | wire at register: `Font.register({ family: 'JetBrains Mono', fonts: [{ src: '...', fontFeatureSettings: 'tnum' }] })`. Note: per react-pdf docs the registration shape may differ; verify in smoke. |
| `::before` / `::after` pseudo-elements | ❌ NOT supported | `.cpdf-break::before/after` (page-break-marker dashes — preview chrome only) | n/a | — |
| `box-shadow` | ❌ NOT supported | `.pp-sheet` (preview chrome) | n/a | drop at port |

### Page chrome — running header + footer

CD's `.pp-runhead` and `.pp-footer` are `position: absolute` boxes
inside each `.pp-sheet`. In react-pdf, the equivalent is:

```tsx
<Page size="LETTER" style={styles.page}>
  {/* footer: fires on every page including the current */}
  <View fixed style={styles.footer} render={({ pageNumber, totalPages }) => (
    <View style={styles.footerInner}>
      <Text><Text style={styles.bold}>The DPS</Text> · {quoteNumber}</Text>
      <Text>Page {pageNumber} of {totalPages}</Text>
    </View>
  )} />

  {/* runhead: fires on every page EXCEPT the first (per CD's design — only continuation pages) */}
  <View fixed style={styles.runhead} render={({ pageNumber }) =>
    pageNumber > 1 ? (
      <View style={styles.runheadInner}>
        <Text><Text style={styles.bold}>The DPS</Text> · {quoteNumber}</Text>
        <Text>Quotation · continued</Text>
      </View>
    ) : null
  } />

  {/* flow content */}
  <Masthead /> {/* page 1 only — gated by JSX, not by react-pdf */}
  ...
</Page>
```

`fixed` is a direct match for `position: absolute`-on-every-page.
`render={({ pageNumber, totalPages }) => ...}` is the page-number
hook (matches CD's `Footer({page, pages})` prop shape exactly).

Note: react-pdf's `wrap` controls whether content flows across
page breaks; `<Page>` itself wraps its child flow naturally. CD's
choice of one `Sheet` per page (`pdf-render.jsx:347-509`) lifts
the page-break decision into the JSX layer, which is cleaner than
relying on auto-wrap heuristics — for the partial+overflow case
(`StatePartial`), `pageOne = set.slice(0, 4)` and `pageTwo =
set.slice(4)` explicit splits leave no room for surprise breaks.

### Risk roll-up

- **High-risk constructs:** none.
- **Medium-risk:** OKLCH → hex precompute (mechanical); font registration; `tabular-nums` via `fontFeatureSettings` (verify in smoke); italic font variants.
- **Low-risk:** everything else — flex composition, borders, margins, typography sizing, letter-spacing, line-height.

CD's design is the rare case where the prototype CSS file's
author note (`styles.css:1-12`) explicitly enumerates the
react-pdf constraints it observed. The portability work is
mechanical conversion, not architectural translation.

---

## 2. Server-side rendering on Vercel

### Library API options

`@react-pdf/renderer` exposes four Node APIs
([react-pdf.org/node](https://react-pdf.org/node)):

- `renderToFile(<Doc/>, '/path')` — writes to filesystem. Bad fit
  for serverless (read-only / ephemeral FS); we won't use.
- `renderToBuffer(<Doc/>)` — returns Node `Buffer`. Best fit for
  "render → upload to Storage → return URL" pattern.
- `renderToStream(<Doc/>)` — returns Stream. Best fit for "render
  → pipe to HTTP response" but Server Actions can't return
  streams directly to the client (per Next.js limitations); a
  Route Handler can.
- `renderToString(<Doc/>)` — returns string. Same buffer shape, weaker for binary.

Recommended path for Slice 11: `renderToBuffer` inside the
`sendQuote` server action, then upload buffer to Supabase
Storage, write the signed URL to `quotes.pdfUrl`. Server actions
return only the signed URL (small JSON), avoiding the binary-in-
server-action footgun.

### Next.js 15 compatibility

**Next.js 15 ships `@react-pdf/renderer` in its default
`serverExternalPackages` list** — confirmed in the current
serverExternalPackages docs page (`v16.2.9`, last updated
2025-12-05): the package is in the auto-opt-out list alongside
`@sparticuz/chromium`, `puppeteer`, `sharp`, `canvas`, etc. No
manual config needed in Next.js 15.

**However**, there is unresolved historical noise that needs
verification:

- [Issue #3074](https://github.com/diegomura/react-pdf/issues/3074)
  (opened Feb 12 2025, still open as of search date): reporter
  on `@react-pdf/renderer 4.1.6` + Next.js 15.1.6 sees
  `"PDFDocument is not a constructor"` on `renderToBuffer` from
  an App Router route handler. No comments / no resolution
  shown in the issue. Likely cause cited elsewhere:
  `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` React
  internal reference broke when React 19 reshuffled internals,
  and was patched in a subsequent react-pdf 4.x release.
- Current `@react-pdf/renderer` is **4.5.1** (released April
  2026 per npm metadata); peer dependency declares
  `react ^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`. React 19
  compatibility has been claimed since v4.1.0.

The reasonable read: the early-2025 issue probably no longer
reproduces against `@react-pdf/renderer@4.5.1 + next@^15.4`, but
this is **not verified**. See §8 for the proposed minimum smoke.

### Server Actions vs Route Handlers

Both shapes work in principle. Pattern choice:

- **Server Action** (`sendQuote` calls `renderToBuffer` directly):
  cleaner — quote send is a state-mutating action, sits
  naturally next to the HubSpot deal-stage push and the
  `quotes.pdfUrl` write. Action returns the signed URL; client
  redirects user to the quote-sent surface. Binary doesn't leave
  the server.
- **Route Handler** (`/api/quotes/[id]/pdf` returns the binary):
  better if there's a need to expose a public download URL the
  customer-receiving inbox can hit. Probably not v1 (PDF is sent
  to customer via PM's outbound email; customer doesn't hit our
  domain).

Recommendation: Server Action calls `renderToBuffer`,
streams-up to Supabase Storage, returns signed URL. Pattern
matches the current `sendQuote` shape; persistence is
auditable; resends produce a new file (versionable per quote
send).

### Vercel function runtime

- Default function runtime: Node.js (Fluid Compute by default
  per the prompt). react-pdf does NOT require a custom runtime,
  custom Lambda layer, or external binary — it's a pure-JS PDF
  generator (pdfkit + fontkit + yoga-layout + custom React
  reconciler).
- Default timeout: 300s. Customer PDF render against CD's
  design (~2 pages worst case) is sub-second in steady state;
  cold-start with font registration adds ~500ms-1s.
- Default memory: 1024 MB. A 2-page PDF render uses ~256-512 MB
  peak per reports from comparable workloads ([AWS Lambda
  Power Tuning guidance for PDF generation](https://medium.com/@Adekola_Olawale/debugging-cold-start-latency-in-serverless-aws-lambda-apps-fe4e97e52618)
  recommends 1024-2048 MB; 1024 sufficient).

---

## 3. Cold-start + memory characteristics

### Bundle size

`@react-pdf/renderer@4.5.1` per Bundlephobia (server-bundled, NOT
client):

- **Total minified:** 1,423,451 bytes (1.42 MB)
- **Gzipped:** 471,456 bytes (~460 KB)
- **Dependency count:** 13 direct, ~50 transitive

Heaviest sub-packages:

| Package | Size (approx) | What it does |
| --- | --- | --- |
| `@react-pdf/reconciler` | 1.20 MB | React reconciler fork (custom for PDF tree) |
| `@react-pdf/pdfkit` | 730 KB | PDF writer engine |
| `@react-pdf/layout` | 67 KB | Layout orchestration |
| `fontkit` | 463 KB | Font parsing (TTF/WOFF) |
| `yoga-layout` | 254 KB | Flexbox layout engine |
| `@react-pdf/render` | 68 KB | Output renderer |
| `brotli` | 90 KB | Font decompression |
| `hyphen` | 48 KB | Hyphenation tables |
| `@react-pdf/textkit` | 50 KB | Text shaping |
| `@react-pdf/image` | 49 KB | Image handling (not used in v1) |

### Vercel function size budget

- **Limit:** 250 MB unzipped (~50 MB compressed). Not configurable.
- **Current Nexus function size:** TBD; checked via
  `vercel inspect <deployment>`. Estimated low — Next.js base +
  Drizzle + postgres-js + Clerk + Supabase JS + HubSpot client
  + Zustand = ~25-40 MB compressed for a typical Nexus function.
- **react-pdf adds:** ~1.4 MB minified (~470 KB gzipped) + fonts
  (Newsreader Regular+Italic+Medium+SemiBold + JetBrains Mono
  Regular = ~1-1.5 MB vendored .ttf).
- **Net:** comfortable. Even with both fonts vendored, total
  function size stays well under the 50 MB compressed ceiling.

The cited "50 MB exceeded" issue ([wojtekmaj/react-pdf
#1504](https://github.com/wojtekmaj/react-pdf/issues/1504)) was
about a **different library** (`react-pdf` from `wojtekmaj/`,
which is the CLIENT-SIDE pdf.js wrapper for displaying existing
PDFs — wraps `pdfjs-dist` worker bundle, much heavier). NOT
related to `@react-pdf/renderer` from `diegomura/`.

### Cold start + memory profile (estimated)

- **Cold start library init:** 300-800ms (pdfkit + fontkit +
  yoga JS init + font file load).
- **First render after cold start:** +200-500ms (font shaping
  cache priming).
- **Steady-state render of 2-page PDF:** 100-300ms.
- **Peak memory during render:** 256-512 MB (well under 1024 MB
  default).
- **Per-PM call frequency:** low (PMs send quotes a few times
  per day total); cold starts will be the common case. Total
  user-visible latency: ~1-2s on cold, ~300-500ms on warm.

### Comparison: puppeteer + @sparticuz/chromium

If react-pdf failed (it won't, per §1 + §2), the fallback would
be puppeteer-core + `@sparticuz/chromium` rendering the DOM
preview tree to PDF via headless Chrome. Cost comparison:

| Dimension | react-pdf | puppeteer + @sparticuz/chromium |
| --- | --- | --- |
| Bundle size impact | ~1.4 MB | ~50 MB (chromium binary) — right at function-size ceiling |
| Cold start | 500ms-1s | 5-15 seconds |
| Memory peak | 256-512 MB | 512 MB - 1+ GB |
| Render fidelity | depends on flex emulation | full Chrome DOM (any CSS works) |
| OKLCH support | ❌ requires conversion | ✅ native |
| Font registration | per-style explicit | system fonts + web fonts work |
| Maintainability | predictable; CD designed to it | binary version drift risk |
| Vercel function size headroom | comfortable | tight |

react-pdf wins on every operational dimension except CSS
breadth — and CD's design was authored within react-pdf's CSS
constraints intentionally, so the breadth advantage of
puppeteer doesn't apply for *this* design.

---

## 4. Font registration strategy

### Fonts CD uses

- **Newsreader** — serif display, used for masthead, h2/h3,
  product names, lede, italic emphasis, "from" / "request"
  labels, hero turnkey numbers. **License: SIL OFL 1.1**
  ([Google Fonts](https://fonts.google.com/specimen/Newsreader)).
  Free to vendor.
- **JetBrains Mono** — monospace, used for eyebrows, prices,
  meta, codes, labels, table heads, footer chrome. **License:
  Apache 2.0 + SIL OFL 1.1**
  ([JetBrains.com](https://www.jetbrains.com/lp/mono/),
  [Google Fonts](https://fonts.google.com/specimen/JetBrains+Mono)).
  Free to vendor.

### Variants needed (per CD's stylesheet)

| Family | Weight | Style | Used at |
| --- | --- | --- | --- |
| Newsreader | 400 (Regular) | normal | `.pp-lede`, `.pp-tk-incl`, `.pp-grand-note`, `.pp-accept p`, `.pp-notes p` |
| Newsreader | 400 | italic | `.pp-lede em`, `.pp-prod-flat`, `.pp-price.req`, `.pp-grand-num .from`, `.pp-grand-num.req`, `.pp-tk-incl.out` |
| Newsreader | 500 (Medium) | normal | `.pp-masthead .v-name`, `.pp-parties .pname`, `.pp-h2`, `.pp-tk-tier`, `.pp-tk-total`, `.pp-tk-hero .h-tier` |
| Newsreader | 600 (SemiBold) | normal | `.pp-h3`, `.pp-grand .g-label`, `.pp-tk-card.rec .pp-tk-total`, `.pp-tk-hero .h-num` |
| JetBrains Mono | 400 | normal | `.pp-th-sub`, `.pp-prod-meta`, eyebrow, footer, runhead, charge-row qty/amt, terms label, etc. |
| JetBrains Mono | 500 (Medium) | normal | `.pp-masthead .v-meta strong`, `.pp-th-lab`, `.pp-charge-row .c-amt`, `.pp-tk-tier`, `.pp-tk-hero-unit`, `.pp-footer .l strong` |
| JetBrains Mono | 600 (SemiBold) | normal | `.pp-c-rec .pp-price`, `.pp-grand-num` |

7 variants total. Reasonable to vendor; total weight ~1-1.5 MB.

### Where to vendor

Pattern from existing Next.js + react-pdf projects: place TTF
files in `public/fonts/` (or `src/fonts/` if not publicly
accessible) and register at module load using absolute path:

```tsx
import path from 'node:path';
import { Font } from '@react-pdf/renderer';

const FONT_DIR = path.join(process.cwd(), 'public/fonts');

Font.register({
  family: 'Newsreader',
  fonts: [
    { src: path.join(FONT_DIR, 'Newsreader-Regular.ttf'), fontWeight: 400, fontStyle: 'normal' },
    { src: path.join(FONT_DIR, 'Newsreader-Italic.ttf'),  fontWeight: 400, fontStyle: 'italic' },
    { src: path.join(FONT_DIR, 'Newsreader-Medium.ttf'),  fontWeight: 500 },
    { src: path.join(FONT_DIR, 'Newsreader-SemiBold.ttf'), fontWeight: 600 },
  ],
});

Font.register({
  family: 'JetBrains Mono',
  fonts: [
    { src: path.join(FONT_DIR, 'JetBrainsMono-Regular.ttf'),  fontWeight: 400 },
    { src: path.join(FONT_DIR, 'JetBrainsMono-Medium.ttf'),   fontWeight: 500 },
    { src: path.join(FONT_DIR, 'JetBrainsMono-SemiBold.ttf'), fontWeight: 600 },
  ],
});
```

### Vercel function file access

When deploying to Vercel, files placed in `public/` are
**copied to the function bundle** (and also served as static
assets) by Next.js's tracing. `process.cwd()` at runtime is the
function bundle root. The Font.register absolute path pattern
above is the documented serverless-friendly approach
([react-pdf.org/fonts](https://react-pdf.org/fonts)).

Alternative: stash TTFs in `src/fonts/` (not publicly served).
Next.js's webpack tracing should follow imports and bundle the
files, but explicit `path.join(process.cwd(), ...)` is more
reliable.

### tabular-nums via fontFeatureSettings

React-pdf supports OpenType feature settings at registration
time per [PR #2740](https://github.com/diegomura/react-pdf/pull/2740)
(merged into 3.x; 4.x ships it):

```tsx
Font.register({
  family: 'JetBrains Mono',
  fonts: [{ src: '...', fontFeatureSettings: 'tnum' }],
});
```

Or at style time (less ergonomic across react-pdf versions):

```tsx
const moneyStyle = { fontFamily: 'JetBrains Mono', fontFeatureSettings: ['tnum'] };
```

**Verify in smoke** that the API shape is consistent in 4.5.1
— the PR title was about `addFontFeatureSettings`; the docs
page doesn't enumerate the property. CD's `.pp-price`,
`.pp-linetotal`, `.pp-grand-num`, `.pp-tk-total` etc. all rely
on tabular-nums for column alignment in monetary stacks; if
the feature is absent the digits will still align visually in
JetBrains Mono (it has equal-width digits by default in the
default `lnum` mode), so this is a low-risk verification.

---

## 5. PDF artifact persistence — surface for CA

Independent of react-pdf, the spike surfaces three persistence
shapes. CA dispositions in the Slice 11 implementation brief:

### Option A — Supabase Storage with signed URL (recommended for v1)

- `sendQuote` server action calls `renderToBuffer`
- Action uploads buffer to Supabase Storage bucket
  `quotes-pdfs/<quoteId>/<send-event-id>.pdf` via supabase-js
  service-role key
- Action writes the signed URL (long expiry, e.g., 365 days OR
  permanent public URL if the bucket is public) to
  `quotes.pdfUrl`
- Action returns signed URL to client; client redirects to
  Quote-Sent surface
- **Pros:** auditable (every send creates a new file; can read
  any historical version); resend is natural (new file, new
  URL, new audit row); URL is stable and PM-shareable;
  customer-facing email can link to it
- **Cons:** Storage cost (~$0.021/GB/month; 100KB PDF × 1000
  sends = ~100 MB = $0.002/month — trivial); requires
  Supabase Storage bucket setup + RLS posture decision (likely
  public bucket since these are sent to customers anyway, OR
  signed URLs with no auth)

### Option B — ephemeral mailto attachment (no persistence)

- `sendQuote` calls `renderToBuffer`
- Buffer attached directly to the outbound email (via Resend /
  SendGrid / Postmark)
- No `quotes.pdfUrl` write; PM has no link to the historical
  artifact
- **Pros:** lightweight; no Storage dependency; matches "PM
  attaches PDF" current Excel workflow
- **Cons:** no audit reproducibility (resending a quote
  re-renders against current data; if costing tree mutated
  between sends the customer-facing pdf differs from the prior
  version's record); PM can't re-download the exact PDF sent;
  email size limits constrain attachment

### Option C — render-on-demand from dynamic route

- `quotes.pdfUrl` points at `/api/quotes/[id]/pdf?send=<eventId>`
- Route handler reads quote snapshot (which the send event
  pinned) and renders fresh on every hit
- **Pros:** no Storage; URL is always live (no signed-URL
  expiry concern); minimal infra
- **Cons:** render cost on every download (PMs forward the
  link to customers; customer opens it 3 days later — cold
  start re-renders); requires a "send event" snapshot table
  (`quote_send_events` with `pinned_snapshot_json`) so the
  render is reproducible; the route handler still needs auth
  posture (signed query token? public?)

### Recommended: Option A

Audit-friendliness wins for v1. The Pattern 45 customer-view
boundary spec calls out PDF as the "render path we don't get
to apologize for after the fact"; persisting the exact bytes
each send makes that posture defensible. Resend produces a new
file under a new event id; old file remains for forensics.
Storage cost is trivial at Nexus scale.

CA dispositions final shape; this section surfaces the
trade-off space, not the answer.

---

## 6. Known issues / surprises (worth surfacing pre-build)

### Resolved or non-issues

- **Next.js + react-pdf bundling crashes (Next 14.0.x):**
  resolved in Next 14.1.1+. Nexus is on Next 15.x.
- **React 19 compatibility:** resolved in `@react-pdf/renderer`
  v4.1.0. Current 4.5.1.
- **`serverComponentsExternalPackages` config needed:**
  Next.js 15 stable ships `@react-pdf/renderer` in default
  `serverExternalPackages` list. No manual config required.

### Worth verifying (in smoke)

- **[Issue #3074](https://github.com/diegomura/react-pdf/issues/3074)
  "PDFDocument is not a constructor" on `renderToBuffer`:**
  reported Feb 2025 against `@react-pdf/renderer 4.1.6` +
  Next.js 15.1.6. Issue still open per most recent search;
  no resolution shown. Plausibly fixed in 4.5.1; verify by
  rendering an empty `<Document><Page /></Document>` from a
  server action against Vercel dev or preview.
- **`fontFeatureSettings: 'tnum'` API shape:** confirm it works
  at register-time AND/OR per-style. Affects every monetary
  column alignment in CD's design.

### Real constraints (mechanical conversions, not blockers)

- **OKLCH color values are not parseable by react-pdf.**
  Precompute to hex/rgb at Pattern 30 path-B adoption. CD's
  print palette (`styles.css:101-111`) is 11 fixed colors
  used everywhere; one mechanical pass produces the lookup
  table. CD also uses inline `oklch(0.97 0.010 90)` for
  `.pp-notes` and `oklch(0.975 0.008 90)` for `.pp-tk-included`
  backgrounds; precompute those too.
- **CSS custom properties (`--pp-*`) are not parseable by
  react-pdf.** Inline literal hex values into the
  `StyleSheet.create({})` objects. Pattern 30 nuance: the
  canonical `styles.css` file stays as-is (source of truth);
  CC's react-pdf StyleSheet objects are the layer that
  translates `var(--pp-ink)` → `'#2e3340'`. Carry token names
  as JS consts for traceability.
- **`box-shadow` not supported in PDF.** Only used on
  `.pp-sheet` for web preview "paper on desk" look. Drop at
  port.
- **`::before` / `::after` not supported.** Only used in
  preview chrome (`.cpdf-break::before/after`); not in the
  paged artifact tree. No port concern.
- **`auto` margin shorthand limited.** react-pdf accepts
  numeric values only; use `marginHorizontal: 'auto'` for
  horizontal centering or compute the value explicitly.

### Color-space sanity

react-pdf renders in sRGB/DeviceRGB. The print-fixed palette
CD declares (`styles.css:101-111`) is OKLCH for browser
authoring ergonomics but maps to specific sRGB values. The
precomputed table will be identical to what the PM-internal
DOM preview shows (modulo the browser's own OKLCH→sRGB
conversion, which is the same standard). No color-management
nightmare.

### Tab-spacing / tabular-nums quirk

If `fontFeatureSettings: 'tnum'` turns out to be unwired or
broken in 4.5.1, JetBrains Mono's default digit shapes are
already tabular (monospace; all glyphs equal-width including
digits). The Newsreader money figures (`.pp-tk-total`,
`.pp-tk-hero .h-num`) are larger display numerals — Newsreader
ships `tnum` as the default for Roman lining figures, per
its Google Fonts spec; falls back gracefully if `tnum` doesn't
apply.

### Page-break edge cases

CD's design avoids the engine page-break heuristics entirely:
each `Sheet` is one explicit page (`pdf-render.jsx:347, 388,
413, 435, 478, 494`). The `StatePartial` overflow case
manually splits SKU rows into `pageOne = set.slice(0, 4)` and
`pageTwo = set.slice(4)`. No auto-wrap logic needs to "do the
right thing." Lower risk than typical react-pdf integrations
that lean on auto-wrap + `wrap={false}` orchestration.

### Vercel build-trace gotcha

Next.js's webpack tracing usually follows `Font.register`
calls and includes referenced font files in the function
bundle. If tracing misses them (rare), the manual workaround
is to import the file as a side-effect:
`import '../public/fonts/Newsreader-Regular.ttf';` (with the
right webpack loader config). Verify at smoke time.

---

## 7. Recommendation

**Recommendation: Green light. Proceed to Slice 11
implementation with `@react-pdf/renderer@4.5.x`.**

Confidence: **high**. CD designed to react-pdf's primitives
explicitly and called out the constraint observance in the
source file header. Every load-bearing construct maps to a
supported primitive. The library is on Next.js 15's default
`serverExternalPackages` list. Bundle size impact (~1.4 MB
+ ~1.5 MB of vendored fonts) is comfortable within Vercel's
50 MB compressed function size budget. Cold-start and memory
profiles are well within the default Fluid Compute
configuration.

**Pre-implementation mechanical work** (all in CA's
implementation brief scope):

1. Precompute the 11 OKLCH palette tokens declared in
   `styles.css:101-111` to hex/rgb. Embed as JS consts in a
   companion module (`src/lib/pdf-palette.ts` or similar),
   maintaining `--pp-*` name parity for traceability.
2. Vendor the 7 font files (Newsreader R/I/Medium/SemiBold +
   JetBrains Mono R/Medium/SemiBold) into `public/fonts/`.
   Register at module load. Both fonts are open-licensed.
3. Translate `.pp-*` CSS rules into `StyleSheet.create({})`
   objects in TSX. Pattern 30 path-B variant: canonical
   `styles.css` stays as upstream source-of-truth; the
   StyleSheet objects are the react-pdf-side translation
   layer (the same way `r2-pricing.css` canonical lives
   alongside JSX consumers of `.r2-*` classes).

**Pre-implementation verification gate** (1 hour of work):

- Install `@react-pdf/renderer@^4.5.0` as a dev dependency in
  a throwaway branch.
- Add Newsreader-Regular.ttf + JetBrainsMono-Regular.ttf to
  `public/fonts/`.
- Add a smoke server action `src/app/actions/_spike-pdf.ts`
  that calls `renderToBuffer` against a minimal `<Document>`
  with both fonts and tabular-nums.
- Confirm the action returns a non-empty buffer in `next dev`
  AND in a Vercel preview deployment.
- Resolve issue #3074 ambiguity definitively.
- Confirm `fontFeatureSettings: 'tnum'` API shape works.
- Delete the spike branch; CA proceeds with implementation
  brief.

Estimated total spike cost: ~1 hour. Estimated total
implementation cost (assuming smoke green): mechanical port —
JSX file substitution + StyleSheet translation + palette
precompute, gated by CD's design source-of-truth. Cost
breakdown for the implementation phase belongs in CA's brief,
not this spike.

**Fallback path** (only triggered if the smoke surfaces a
hard blocker): puppeteer-core + `@sparticuz/chromium`
rendering the existing PM-internal `<PdfPage>` DOM preview
tree to PDF. Operational cost is materially worse (5-15s
cold start, ~50 MB function size budget consumed by chromium
binary, ~1+ GB memory peak) but the design fidelity is full
DOM. If the smoke surfaces structural react-pdf failure,
escalate to Edward + CA — don't silently switch libraries.

---

## 8. Minimum spike to verify viability

Proposed for Edward's disposition. The spike is small enough
that running it during Slice 11 §0 is reasonable; not running
it before commit risks discovering issue #3074 still
reproduces mid-implementation.

### Steps

1. Branch: `spike/slice-11-react-pdf-smoke` (throwaway).
2. `npm i -D @react-pdf/renderer@^4.5.0` (dev dep until Slice
   11 promotes it to runtime).
3. Add Newsreader-Regular.ttf + JetBrainsMono-Regular.ttf
   under `public/fonts/`.
4. Add `src/app/actions/_spike-pdf.ts`:
   ```ts
   "use server";
   import { Document, Page, Text, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
   import path from 'node:path';

   Font.register({
     family: 'Newsreader',
     src: path.join(process.cwd(), 'public/fonts/Newsreader-Regular.ttf'),
   });
   Font.register({
     family: 'JetBrains Mono',
     src: path.join(process.cwd(), 'public/fonts/JetBrainsMono-Regular.ttf'),
     fontFeatureSettings: 'tnum',
   });

   const styles = StyleSheet.create({
     page: { padding: 56, fontFamily: 'Newsreader' },
     money: { fontFamily: 'JetBrains Mono', fontSize: 12 },
   });

   const Doc = () => (
     <Document>
       <Page size="LETTER" style={styles.page}>
         <Text>Spike test — Newsreader serif</Text>
         <Text style={styles.money}>$1,234.56</Text>
       </Page>
     </Document>
   );

   export async function spikeRenderPdf() {
     const buffer = await renderToBuffer(<Doc />);
     return { ok: true, size: buffer.length };
   }
   ```
5. Add `src/app/_spike/page.tsx` that calls the action via a
   form submission and renders the returned size.
6. Run `npm run dev`; verify the form action returns a
   non-zero buffer size.
7. Deploy as Vercel preview; verify the same.
8. Inspect the PDF byte length is reasonable for a 1-page
   document with 2 lines (~5-15 KB).
9. Open the resulting PDF in a viewer; confirm fonts render
   and tabular-nums applies to the money.
10. If green, throw away the branch. CA's Slice 11 brief
    proceeds with confidence.
11. If red, file findings under `docs/cc-slice-11-spike-
    findings.md` and escalate to Edward + CA.

### What success looks like

- Buffer length > 1 KB returned from server action without
  exception.
- Vercel preview deployment renders without function timeout
  or memory error.
- PDF opens in Acrobat / Preview / Chrome with both fonts
  rendered correctly.
- Money string `$1,234.56` displays with tabular-aligned
  digits.

### What failure looks like

- "PDFDocument is not a constructor" (issue #3074
  reproduction) — file as the smoke's headline finding;
  block Slice 11 on resolution OR switch to puppeteer.
- Font registration silent-fails (rendered text uses
  fallback font) — file as smoke finding; may be a path
  resolution issue, requires diagnostic.
- Vercel function exceeds 50 MB compressed — unlikely but
  surface to Edward.

---

Standing by — CA's Slice 11 implementation brief consumes
this + the audit's portability table.

---

## Sources

- [@react-pdf/renderer npm registry metadata, v4.5.1](https://registry.npmjs.org/@react-pdf/renderer/latest) (unpacked size 292 KB; peer dep `react ^16.8.0 || ^17 || ^18 || ^19`)
- [Bundlephobia size data for @react-pdf/renderer@4.5.1](https://bundlephobia.com/package/@react-pdf/renderer) (1.42 MB minified, 471 KB gzipped, 13 direct deps)
- [Next.js serverExternalPackages docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — confirms `@react-pdf/renderer` in default opt-out list
- [react-pdf.org/styling](https://react-pdf.org/styling) — supported CSS properties
- [react-pdf.org/fonts](https://react-pdf.org/fonts) — Font.register API
- [react-pdf.org/components](https://react-pdf.org/components) — primitives + wrap/fixed/render props
- [react-pdf.org/node](https://react-pdf.org/node) — renderToBuffer / renderToStream / renderToFile / renderToString
- [react-pdf.org/compatibility](https://react-pdf.org/compatibility) — Node 18/20/21, React 16.8+, Next.js 14.1.1+
- [Issue #3074 — renderToBuffer broken on Next 15.1.6](https://github.com/diegomura/react-pdf/issues/3074) (open; unresolved)
- [Issue #2460 — renderToBuffer broken in Next 13+ App Router](https://github.com/diegomura/react-pdf/issues/2460) (historical)
- [Issue #3020 — Next 15 + React 19 README example out of date](https://github.com/diegomura/react-pdf/issues/3020)
- [PR #2740 — fontFeatureSettings support](https://github.com/diegomura/react-pdf/pull/2740) (merged)
- [Vercel function size limit kb article](https://vercel.com/kb/guide/troubleshooting-function-250mb-limit) (250 MB unzipped, ~50 MB compressed)
- [Google Fonts — Newsreader](https://fonts.google.com/specimen/Newsreader) (SIL OFL 1.1)
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (Apache 2.0)
- CD design source — `docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/pdf-render.jsx`
- CD design source — `docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/styles.css`
- CD design source — `docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/data.js`
- Nexus repo — `docs/IA-spec.md:461-463, 568-570` (react-pdf as intended library)
- Nexus repo — `src/components/pdf/pdf-page.tsx` (current PM-internal preview boundary)
- Nexus repo — `package.json` (no PDF library currently installed)
