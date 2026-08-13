# OD-022 — `detail_level` operator-governance debt

**Registered 2026-08-13.** Two findings, both established by evidence during the
Order B Accounting review. **Neither reopens the certified Item Group
machinery**, which is unaffected: grouping behaviour itself is governed,
validated, and untouched by either finding.

**Do not repair inside Accounting Order B.**

---

## Finding 1 — presented as customer configuration, also acts as ERP grouping authority

`quotes.detail_level` is a **presentation axis in the UI** and an **ERP grouping
authority in the runtime**.

**What the operator is shown.** The only control is the `Detail:` select at
`src/components/quote/quote-host.tsx:196` (`Itemized` / `Turnkey only`), on Quote
umbrella sub-tab 1 · Preview Quote. Its row reads, verbatim:

```
Detail:  [Itemized ▾]        Include spec addendum · pricing-only PDF
```

and it renders **directly beneath** the customer-boundary notice:

> BOUNDARY GUARD · CUSTOMER VIEW — Nothing below this line is in the customer's
> tree…

A full text-node sweep of the rendered page found **no** mention of Item Group,
grouping, projection, NetSuite or Sales Order attached to the control — only the
sub-tab label `Sales Order` and a generic step-5 warning.

**What the runtime does with it.**

- `src/lib/netsuite/grouping-plan.ts:159` — `applicability = input.detailLevel ?? "itemized"`
- `src/lib/netsuite/mark-complete.ts:418-427` — `itemized` → do **not** group;
  `turnkey_only` → grouping **is required**; read from the send-time snapshot.

**Statement of record:**

> The operator can reach the state, but the UI presents it as a
> customer-presentation choice while the current runtime also uses it as ERP
> grouping authority.

The intended V1 Product Structure model separates presentation from grouping;
this coupling is the gap between the two.

---

## Finding 2 — the draft control appears persistent but is session-transient

> The draft Detail control appears persistent but is session-transient. A PM may
> select `Turnkey only`, reload, and silently return to the default `Itemized`
> state before Send.

**Mechanism.** The control writes only React context (`quote-axis-context.tsx`,
`useState`). It writes neither the database nor the URL — the latter a documented
trade-off to avoid an RSC refetch per toggle. `quotes.detail_level` has exactly
two writers: `sendQuote` (`quotes.ts:1890`) and the copy-scenario carry-forward
(`quotes.ts:3220`).

**Observed on Order B.** Selecting `Turnkey only` through the real UI changed the
control and re-rendered the preview, while `quotes.detail_level` stayed `NULL`
with `updated_at` unmoved and no audit event. After reload the control read
`Itemized` again.

**Why the two findings compound.** Either alone is tolerable. Together:

- the loss is **silent** — the control reads `Itemized` with nothing indicating a
  prior choice was discarded;
- the default is **not neutral** — `NULL` resolves to `itemized`, so a lost
  selection actively produces the flat-line shape;
- and because of Finding 1, the consequence is **not confined to the PDF**: it
  changes the eventual Sales Order structure.

The resulting quote is still **commercially reconciled** — same totals, same
margin, same turnkey value — so no totals-based check can detect it. Same
detection blind spot as COSTS-RENDER-1 and the standing rule *"exact
reconciliation is necessary but not sufficient"*: correct arithmetic, wrong
structure.

**Blast radius.** A PM who selects `Turnkey only`, navigates away or reloads,
returns and sends, ships an `itemized` quote and — on Complete — an ungrouped
Sales Order, with no signal at any point.

---

## Mitigation available today

`?detail=turnkey_only` on the Quote/Preview route seeds the axis server-side
through the same resolver `sendQuote` reads, and **survives reload** because the
URL carries it. It is an operator-reachable application route, not a hidden
action or a direct write. This is the mechanism used for the Order B artifact
(`order-b-send-accept-certification-record.md`).

It is a workaround, not a fix: it depends on the operator knowing to construct
the URL.

---

## Not in scope of these findings

- The Item Group machinery itself — certified and unaffected.
- Send-time freeze semantics — proven correct on Order B: `turnkey_only` froze to
  `quotes.detail_level`, to the `quote_snapshots` row, and to the `quote_sent`
  audit payload, and rendered from durable state with an empty query string.
- Adding a draft-time writer for `detail_level`. The Send-time-snapshot lifecycle
  is intentional; any repair must respect it rather than convert the column to
  ordinary draft state.

---

## Cross-references

- `docs/validation/order-b-step-3-detail-level-reachability.md` — the reachability
  trace and the persistence protocol that surfaced Finding 2.
- `docs/validation/order-b-send-accept-certification-record.md` — proof that the
  Send-time freeze is correct.
- `docs/validation/costs-render-1-packaging-row-identity.md` — sibling
  "reconciles perfectly while structurally wrong" defect class.
