# CP — Customer Quote presentation workspace · Data-source map

Every element on the surface traced to its source, so it can be wired without guessing.
Two source classes matter here and must not be confused:

**Source legend:** `GOVERNED` = computed/approved upstream in Pricing; read-only on this
surface · `PRESENT` = presentation parameter, per-quote, no economic effect ·
`DOWNSTREAM` = internal instruction that travels to invoicing · `CUSTOMER` = printed on the
PDF verbatim · `DERIVED` = composed at render from the above · `PREVIEW` = prototype chrome,
not production.

---

## Top bar

| Element | Source | Field | Note |
|---|---|---|---|
| `Lumen Beauty Co. / Present quote` | GOVERNED | `customer.name` | breadcrumb |
| `Q-2419 · v1` | GOVERNED | `quote.number`, `quote.version` | |
| `PRICING APPROVED` chip | GOVERNED | `quote.pricing_status` | mirrors R12's SENDABLE verdict; **not** re-evaluated here |
| presence / operator | GOVERNED | `session.user` | |

## Preview rail

| Element | Source | Field | Note |
|---|---|---|---|
| `WHAT THE CUSTOMER WILL SEE` chip | PREVIEW | — | internal-violet frame marker; the one internal token in the pane |
| configuration summary line | DERIVED | `pdf_layout` + `detail_level` + `include.addendum` | one sentence, always current |
| `N page PDF` | DERIVED | `1 + (include.addendum ? 1 : 0)` | live; also quoted in the send footer |
| zoom `−` / `%` / `+` | PREVIEW | operator-local | not persisted to the quote |
| delivery strip (sent state) | GOVERNED | `quote.sent_at`, `quote.sent_to`, `quote.version` | replaces a toast; states the v2 rule |

## The document (customer tree — boundary guard applies)

Unchanged contract from `cd-customer-pdf-render-data-source-map.md`. Only the fields this
surface can influence are listed.

| Element | Source | Field | Note |
|---|---|---|---|
| masthead, parties, issue/validity | CUSTOMER | `vendor.*`, `customer.*`, `quote.issued_date`, `quote.valid_until` | |
| quote number | DERIVED | `quote.number` + `draft` suffix while unsent | the `· draft` suffix is the only difference between preview and sent artifact |
| tier columns | PRESENT | `pdf_layout` → 3 columns or 1 | `single_tier` uses `presented_tier` |
| unit price / extended per cell | GOVERNED | `sku.tier_prices[i]`, `tier.quantity` | sell-derived only |
| `Turnkey total` row | GOVERNED | Σ(sell × qty) + `fees_total` | **identical in every presentation** |
| turnkey cards (turnkey-only) | GOVERNED | same figures, different shape | `detail_level = turnkey_only` |
| one-time fee lines | PRESENT | `include.fees` · `service_fees[]` | itemized shape only |
| fee-fold sentence | DERIVED | `fees_total` | renders **when the itemization is off** — the disclosure survives the toggle |
| commercial terms block | PRESENT | `include.terms` · `quote.payment_terms`, `lead_time`, `incoterms` | |
| `Notes` block | CUSTOMER | `quote.customer_facing_note` + `include.note` | printed verbatim |
| `How to accept` | CUSTOMER | fixed copy | never suppressible |
| spec addendum page | PRESENT | `include.addendum` · `sku.spec_fields[]` | +1 page |
| running foot `Page 1 of N` | DERIVED | page count | |

## Governed pricing band (read-only)

| Element | Source | Field | Note |
|---|---|---|---|
| per-tier total | GOVERNED | Σ(sell × qty) + `fees_total` | same expression as the PDF's total row — **one computation, two renders** |
| per-unit figure | GOVERNED | total ÷ `tier.quantity` | blended all-in |
| provenance line | GOVERNED | `quote.approved_by`, `approved_at` | links to Pricing |
| lock glyph / dashed rule | — | — | treatment, load-bearing (§3 of the notes) |

## Presentation band

| Element | Source | Field | Note |
|---|---|---|---|
| `Tier table` / `Single tier` | PRESENT | `quote.pdf_layout` | default `tier_table` |
| tier picker | PRESENT | `quote.presented_tier` | **renders only when `pdf_layout = single_tier`**; picking also sets the layout |
| `Itemized` / `Turnkey only` | PRESENT | `quote.detail_level` | orthogonal to `pdf_layout` |

## Included in the PDF

Each row: switch + consequence meta + explicit `Show` / `Hide`.

| Row | Field | Off behaviour |
|---|---|---|
| One-time fee breakdown | `include.fees` | **collapses to one sentence** — never erases the charge |
| Specification addendum | `include.addendum` | pricing-only PDF; page count drops to 1 |
| Commercial terms block | `include.terms` | omitted — terms sent separately |
| Customer-facing note | `include.note` | note text **retained**, not printed |
| `N of 4` counter | DERIVED | count of true flags | |

## Customer-facing note

| Element | Source | Field | Note |
|---|---|---|---|
| textarea | CUSTOMER | `quote.customer_facing_note` | 400-char cap; live counter |
| placement helper | — | — | states where it prints |

## Downstream · Accounting (internal only — never in the customer tree)

| Element | Source | Field | Note |
|---|---|---|---|
| `INTERNAL ONLY` chip + scope line | — | — | internal-violet register |
| Invoice on | DOWNSTREAM | `accounting.invoice_trigger` | `shipment` \| `po` \| `milestone` |
| Deposit | DERIVED | `quote.deposit_pct` × presented total | resolves against the tier being sent |
| Bill to | DOWNSTREAM | `accounting.ap_contact` | |
| Freight billing | DOWNSTREAM | `accounting.freight_billing` | `landed` \| `at cost, separate` |
| Instruction to Accounting | DOWNSTREAM | `accounting.instruction` | free text; travels on acceptance |

## Send footer

| Element | Source | Field | Note |
|---|---|---|---|
| state chip | GOVERNED | `quote.sent_at` | `DRAFT · NOT SENT` \| `SENT` |
| recipient | GOVERNED | `customer.contact_email` | |
| readiness line 1 | GOVERNED | `quote.approved_by/at` | reports; does not re-evaluate |
| readiness line 2 | DERIVED | `pdf_layout` + `presented_tier` | presentation is never invalid, only stated |
| readiness line 3 | DERIVED | `include.note` ∧ note non-empty | soft — reports, does not block |
| readiness line 4 | DERIVED | `accounting.instruction` non-empty | soft |
| `Send to customer` | — | action | emits PDF + files the Accounting instruction |
| `⤓ PDF` | — | action | download only, no send record |
| foot sentence | DERIVED | page count | *"Pricing is untouched"* is a claim the invariant guarantees |

## Forbidden on this surface's customer pane — asserted absent

Nothing in the document tree reads: `margin_pct` · `markup_pct` · cost stack or any cost
component · supplier names · `duty_pct` · `tariff_pct` · CBM · `version_number` ·
`scenario_label` · lifts, direct prices, or staged adjustments. Build-time assertion on the
customer subtree, per the standing guard — not a runtime check.

## Writes

| Field | Written by | When |
|---|---|---|
| `pdf_layout`, `presented_tier`, `detail_level`, `include.*` | this surface | on change (presentation is cheap and reversible; no staging) |
| `customer_facing_note` | this surface | on change |
| `accounting.*` | this surface | on change |
| `sent_at`, `sent_to`, sent snapshot | this surface | on Send — freezes all of the above onto the version |
| anything priced | **never** | — |
