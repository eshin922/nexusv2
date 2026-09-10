# #557 — isolated application validation evidence

**Durable record of a bounded run. Not a merge authorisation, and not a
certification of production behaviour.**

Recorded 2026-09-09. The machine-readable verdicts sit beside this file; the
JSON is the record and this page is its index.

## Revisions the run was performed against

| role | revision |
|---|---|
| base | `main` @ `1e2a7239e18cfd2e3351505bbf155b0d3e97548b` |
| composed | **#558** `83f39c0b002627d76d77b6cf2d0a7e014d14a953` |
| composed | **#556** `fb71624a1a43022729114b6a943467dce847345f` |
| composed | **#557** `80535c1f4389d32453e8747ec4868896a37e09d8` |
| integration | `967eccd49f4a68aefd2203631c155dc648f2e0c6` |
| fixtures — three customer states | `a1c73a7b60cb5ea46b03f7b056e92bd42f95fdc2` |
| gap closure | `1bbe72cee01a669f12c63d50269edcc374e999bf` |

Composed with `--no-ff` so each PR's COMPLETE history is present, not its tip
alone. None of the three is exercisable on its own: #557 cannot seed without
#558, and renders a retired layout without #556.

## Verdicts

Four categories, kept apart because they establish different things and a
reader should not have to infer which is which.

| category | result | record |
|---|---|---|
| application behaviour (HTTP, rendered) | 13 PASS · 0 FAIL · 0 BLOCKED | `summary-application-admin-all.json` |
| application behaviour — frozen terms (own scenario) | 1 PASS | `summary-application-admin-frozen.json` |
| server actions (in-process, real action layer) | 6 PASS admin · 1 PASS pm-denial · 3 PASS send-refusal | `summary-actions-admin-success.json`, `summary-actions-pm-success.json` |
| browser (real Chrome, real clicks) | 6 PASS | `summary-browser-e1.json` |

Scenario isolation is enforced by reseeding between runs. The frozen check runs
alone: overriding the customer's CURRENT term legitimately changes what every
draft renders, so combining the two would make the draft expectations wrong for
a reason that is not a defect.

## The PDF assertion, and why it is exact

`includes("Net 30")` cannot express the case that matters most. An empty terms
field and a MISSING terms block read identically through a substring test, so a
document that never rendered the row would pass the unmapped check. The field
is delimited by its own label and the next, so it is read exactly and compared
for equality — including against the empty string.

| document | terms field | firm default anywhere in the document |
|---|---|---|
| mapped | `"Net 30"` | absent |
| unmapped | `""` | absent |
| alt-terms | `"Net 60"` | absent |

Discrimination confirmed: each value matches only its own expectation, and the
unmapped `""` does not match `"Net 30"`. The extraction decodes subset fonts
through each font's `/ToUnicode` CMap — react-pdf emits glyph ids, and a naive
inflate returns nothing, which is indistinguishable from an empty document.

## Artifact digests

The full artifacts — rendered HTML pages, generated PDFs, the browser
screenshot — are produced under `.artifacts/pr-557/`, which is gitignored. The
verdict records and the extracted PDF text are committed here, and the digests
below identify exactly which run produced them.

| file | sha256 (first 32) |
|---|---|
| `customer-alt.pdf.txt` | `4358e554ef24d9a46e1a19300c638e7b…` |
| `customer-mapped.pdf.txt` | `b7fc4ead2fc0069c5c7af32305e26c2b…` |
| `customer-unmapped.pdf.txt` | `44aab7ab563466f88b58c2eae08fe300…` |
| `pm-action-denial.json` | `20e2778d4e3164d79919be822ff00ddb…` |
| `send-refusal.json` | `b2b133441515970a0ba1feb954082e7d…` |
| `summary-actions-admin-success.json` | `01994c491b229810b2cc0a0a145858d7…` |
| `summary-actions-pm-success.json` | `449a4480de715d93f60525dc4fc2e45f…` |
| `summary-application-admin-all.json` | `d55a5d9b515cc82793b839fde1a80b8e…` |
| `summary-application-admin-frozen.json` | `c8009d24483c2cfff0a1499fb41a8db2…` |
| `summary-browser-e1.json` | `a83b65501504c9d8487436c72dc3d2a7…` |

Uncommitted artifacts, for reference, with sizes as produced:
`admin-customer-map.jpg` (47,413 B), `customer-{mapped,unmapped,alt}.pdf`
(36,441 / 36,726 / 36,698 B), `preview-{mapped,unmapped,alt,sent,after-mapping}.html`,
`so-receipt-{mapped,unmapped,alt,complete}.html`.

## Reproducing

```
npm run validation:db:start && npm run validation:db:reset && npm run validation:seed
npx cross-env NODE_OPTIONS=--max-old-space-size=8192 \
  node --env-file=.env.validation.local node_modules/next/dist/bin/next dev \
  --hostname 127.0.0.1 --port 3100          # NEXUS_VALIDATION_IDENTITY=admin|pm

node scripts/gate-1b/pr-557-checks.mjs                       # application
node ... scripts/gate-1b/pr-557-admin-checks.ts              # server actions
node ... scripts/gate-1b/pr-557-artifact-checks.ts           # projection
```

FAIL and BLOCKED both exit nonzero, so these are usable as gates. Reseed
between scenarios — the mapping flow mutates the state later checks depend on,
which is how an earlier run produced three failures that were contamination
rather than defects.

## What this does NOT establish

- **Production NetSuite.** Every NetSuite answer here came from the isolated
  fake. The run establishes how Nexus handles those answers, not whether they
  match what production would say.
- **The Dr. Squatch mapping**, which remains a separate, unapproved production
  data action.
- **The race without injected latency.** E1 used a 3s save delay; without it the
  save resolves before an operator could switch panels, so a green result would
  establish only that the race did not occur.
- **Merge readiness**, which is assessed separately against required CI.
