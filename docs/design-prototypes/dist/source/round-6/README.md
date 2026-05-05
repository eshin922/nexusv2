# Round 6 — extracted source

CD shipped Round 6 as a self-contained bundled HTML file
(`../../Nexus Round 6.html`). Unlike Rounds 1, 2, and 2.5 — which
were also shipped with un-bundled source under `source/round-N/` —
no un-bundled source was provided for Round 6. The bundle uses a
custom format (`<script type="__bundler/manifest">` + base64-gzipped
asset chunks) that is opaque to grep / Read / Glob.

This directory contains the extracted source, recovered programmatically
from the bundle's manifest + template. The HTML/CSS in `index.html` is
the rendered DOM + inline `<style>` blocks; the `.jsx` files are the
build's individual modules. **Pretend this is what CD shipped — it's
bit-identical to what the bundle renders at runtime.**

## Layout

```
round-6/
├── index.html                 ← rendered HTML + inline CSS (READ THIS for visual fidelity)
├── cost-build-page.jsx        ← page composition (entry point)
├── cost-stack-header.jsx      ← cost stack header per-tier columns
├── section-summary-row.jsx    ← collapsed section row anatomy
├── packaging-drawer.jsx       ← Packaging drilldown
├── production-drawer.jsx      ← Production drilldown
├── freight-drawer.jsx         ← Freight drilldown
├── bulk-raw-drawer.jsx        ← Bulk Raw drilldown + mode selector
├── nav-rail.jsx               ← Two-tier nav rail (RI.2 reference)
├── cost-build-data.jsx        ← Round 6 fixtures
├── bulk-raw-data.jsx          ← Round 6.1 Bulk Raw fixtures
├── round-4-data.js            ← carry-over Round 4 fixtures
├── tweaks-panel.jsx           ← shared in-design tweak controls
├── _runtime.js                ← React + supporting libs (don't read)
└── _unidentified.js           ← unidentified module (likely shared util)
```

## Why this matters for Designer

R6 actual CSS classes are **unprefixed** (`.chip`, `.stack`, `.cell`,
`.sku-row`, `.section-row`, etc.) — NOT the `r6-` synthetic prefix
the implementation codebase invented during the RI.4 scaffold pass.
Any audit citing "R6 source" must read this directory directly, not
infer from `dist/docs/r6-designer-notes.md` alone (those are prose
commitments, not pixel-level styling).

## How this was extracted

`scripts/extract-r6-source.mjs` decodes the bundle's manifest into
this directory. Re-run if the bundle is updated:

```
node scripts/extract-r6-source.mjs
```

When CD ships an un-bundled source/round-6/ proper, this directory
gets replaced and the script becomes obsolete.

## Future rounds (5+)

Rounds 3, 4, 5 use the same bundler format and are similarly opaque
to grep. If/when they need to be audited, run the same extraction
pattern (the script is parametric on round number).
