# Un-bundled prototype source — Rounds 1, 2, 2.5

These are the working files that compiled into the standalone HTML bundles in `dist/`. Provided so the AI Designer agent can read prototype DOM/component shape directly when auditing build PRs against earlier-round surfaces.

## Layout

```
source/
├── round-1/                Initial concept exploration
│   ├── Nexus Quoting Flow.html    ← entry point (open this)
│   ├── styles.css                 ← shared base tokens + components
│   ├── tweaks-panel.jsx           ← in-design tweak controls (shared)
│   └── app/
│       ├── data.js                ← fixtures
│       ├── shell.jsx              ← top-level state-strip + tweak wiring
│       ├── project.jsx            ← Project surface
│       ├── setup.jsx              ← Quote Setup surface
│       ├── build.jsx              ← Cost Build surface
│       ├── costing.jsx            ← Costing Workspace surface
│       └── notes.jsx              ← in-page designer notes panel
│
├── round-2/                Cost Build & Costing Sheet (refined)
│   ├── Nexus Round 2.html         ← entry point
│   ├── tweaks-panel.jsx           ← shared
│   └── app/r2/
│       ├── styles.css             ← R2-scoped overrides on top of base
│       ├── data.js                ← R2 fixtures (cost lines, tiers, scenarios)
│       ├── shell.jsx              ← state-strip + page router
│       ├── build.jsx              ← Cost Build (PM input) surface
│       ├── costing.jsx            ← Costing Sheet (margin verdict) surface
│       ├── notes.jsx              ← designer notes
│       └── datamap.jsx            ← in-page data-source map
│
└── round-2.5/              Multi-tier mechanics
    ├── Nexus Round 2.5.html       ← entry point — JSX is INLINE in this file
    ├── tweaks-panel.jsx           ← shared
    └── app/r2/
        └── styles.css             ← reused from R2 base
```

## Notes per round

### Round 1 — initial concepts

Four surfaces wired into a state-strip: **Project · Quote Setup · Cost Input · Costing Workspace**. Each surface in its own `.jsx` file under `app/`. Tweaks live in `tweaks-panel.jsx` and persist via the standard `__edit_mode_set_keys` protocol. Designer notes are in-page (`notes.jsx`) — read those for the rationale layer; they capture intent that didn't make it into a separate `.md`.

### Round 2 — Cost Build & Costing Sheet

Refined the two core surfaces. **`build.jsx`** is the PM-facing cost-input surface (3 stages: empty / partial / tunable). **`costing.jsx`** is the margin-verdict surface (3 scenarios). The cost-stack waterfall and per-cell sell calculations live in `costing.jsx`; the breakdown row is rendered there too.

`datamap.jsx` is the in-page data-source map — read it for the field-by-field provenance (what comes from HubSpot vs. firm policy vs. PM input). Designer notes in `notes.jsx`.

### Round 2.5 — multi-tier mechanics

**JSX is inline** in `Nexus Round 2.5.html` (one big `<script type="text/babel">` block at the bottom). I didn't split it out because the surface is a single page. CSS for the tier-spread sparkline is also inline at the top of the file under `<style>` — the rest comes from `app/r2/styles.css`.

The two big mechanics here:
- **Apply-to-all** (60% case) — single price applied to every tier.
- **Supplier-quote-sheet** (40% case) — per-tier prices entered as a small grid; sparkline visualizes the spread.

Plus a **mark-as-flat** affordance and **null discipline** (empty cells must stay empty, not coerce to zero).

## Running locally

These are plain HTML + JSX-via-Babel — no build step. Open the entry-point `.html` in a browser, or serve the `source/round-N/` directory with any static server (`python -m http.server`, `npx serve`, etc).

The bundled equivalents in `dist/Nexus Round 1.html` / `Round 2.html` / `Round 2.5.html` are these same files run through an inliner; nothing changes semantically.

## Conventions to know when reading

- **Tweak defaults** are declared in a `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` block in the entry HTML. The host rewrites that JSON when the user changes a tweak; treat it as the canonical "what state am I in" descriptor.
- **State strips** at the top of each surface let you walk every state without touching tweaks. Read the `state` constant and the surrounding switch in `shell.jsx` (R1) / per-page jsx (R2).
- **Data fixtures** are deliberately stable across runs — line IDs, tier IDs, scenario IDs are referenced by tests / audits / the data-source map. Don't expect them to be random.
- **Color tokens** all live in the base `styles.css` as `--ink / --paper / --rule / --accent` etc. R2's `app/r2/styles.css` extends but doesn't replace.

## What's deliberately NOT here

- Fonts (already loaded from Google Fonts via the entry HTML)
- React/Babel CDN scripts (already in the entry HTML; no build needed)
- The bundled `.html` outputs (those are in `../`, alongside the index)

If anything's missing or a path doesn't resolve, that's a bug — flag it and I'll re-ship.
