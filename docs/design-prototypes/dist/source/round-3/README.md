# Round 3 — extracted source

Bundler extraction via `scripts/extract-r6-source.mjs 3`. CD did not
ship un-bundled `source/round-3/`; this directory recovers it
programmatically (same pattern as round-6 from RI.4).

## Layout

```
round-3/
├── index.html              ← rendered HTML + inline CSS (READ THIS for visual fidelity)
├── customer-view.jsx       ← Customer view (PDF preview) — three states (pure / passThrough / bundled)
├── mark-accepted-flow.jsx  ← Mark-Accepted flow — six states (GOOD, bothGates, overrideRequest, etc.)
├── round-3-data.js         ← R3 fixtures (reuses Round 2 schema shapes)
├── tweaks-panel.jsx        ← shared in-design tweak controls
├── _runtime.js             ← React (don't read)
└── _react-dom.js           ← React DOM (don't read)
```

## Why this matters for RI.6

R3 designs:
1. **PM-internal Customer-view preview surface** (the full PM-facing
   page that PMs review before sending). This same component tree
   becomes the customer PDF per CR-13's customer-view boundary guard
   convention — the PM-internal preview chrome (sidebar, header, send
   button, download button) lives OUTSIDE the `<PdfPage>` and is not
   included in the PDF render. Boundary guard is structural, not
   visual rhetoric — build pipeline asserts the import boundary.
2. **Mark-Accepted writeback flow shells** — the surfaces that wrap
   the eventual Slice 12 HubSpot writeback action. RI.6 ships shells;
   Slice 12 wires the actual writeback mechanism.

Future audits against R3 must read this directory directly; the prose
`dist/docs/round-3-designer-notes.md` + `round-3-data-source-map.md`
are supplemental, not substitutes for the rendered source.
