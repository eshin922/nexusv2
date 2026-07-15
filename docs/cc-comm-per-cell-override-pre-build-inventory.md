# Per-cell override slice — pre-build inventory (§0.5)

**To:** CA + Edward
**From:** CC
**Re:** §3 admin-override existence check + §5 data-model check +
sequencing input on §10
**Status:** report; no code written; awaiting disposition

---

## TL;DR

- **§5 data-model** — **infrastructure already exists.** `assembly_leaf_
  overrides` table + `updateAssemblyLeafOverride` server action shipped
  in Slice 11.5 (NEW-model successor to Slice 9.3's original
  `quote_sku_tiers.sell_price_override`). Cloned by FR-12
  `cloneQuoteGraph`. No new table, no new migration needed for the
  core override storage — this slice is mostly a UI + validation +
  admin-override extension.
- **§3 admin-override** — **DOES NOT EXIST.** `request_override` is
  a documented v1 no-op placeholder in the classifier; the workflow
  was banked v1.1+ per code comments. This slice must build the
  new mechanism.
- **§5 snapshot-on-send** — **NOT WIRED.** `sendQuote` snapshots the
  Slice-11 fleet (pdf_layout, detail_level, include_spec_addendum)
  but does not freeze override values. Because overrides are
  draft-only edits (guarded via `assertDraft` on the shared quote
  loader), a sent quote can't be re-overridden, but the read path
  isn't snapshotted — if a schema-level "reproduce sent-quote's
  historical price" property is desired, that's a new invariant this
  slice must add.
- **§10 sequencing** — CC opinion: **finish Slice 11 through Step 8
  first** (CA's lean). The broken-promise window narrows the moment
  Step 8 closes; Step 7's Pattern 45 boundary sweep is directly
  adjacent to this slice's Pricing-surface tree and could catch
  interactions. Detail below.

---

## §1 · What already exists

### Data model — `assembly_leaf_overrides` (schema.ts:1878-1902)

```
assembly_leaf_overrides
  assembly_leaf_id  uuid  NOT NULL  FK → assembly_leaves.id  cascade
  tier_id           uuid  NOT NULL  FK → quote_tiers.id       cascade
  sell_price_override  numeric(10,4)  NOT NULL
  created_at, updated_at
  PRIMARY KEY (assembly_leaf_id, tier_id)
  INDEX assembly_leaf_overrides_tier_id_idx (tier_id)
```

Sparse table (row exists ⟹ override is set). Leaf-only invariant
enforced structurally (FK to assembly_leaves — no assembly-level
overrides possible). Direct semantic analog of Slice 9.3's original
`quote_sku_tiers.sell_price_override`, migrated in Slice 11.5.

### Read path — CostingStore `cellOverrides` slice

Reconcile pipe surfaces overrides via `selectCellOverride(skuId,
tierId)` (`src/lib/costing-store.ts`). Downstream: math layer
(`computeQuoteCosting` in `costing.ts` reads `input.cellOverrides`),
warnings engine (`src/app/actions/warnings.ts` projects from
bundle.data), audit projections. Full realtime subscription
membership per Slice 11.5.1 MIG-8 (channel: `structure`).

### Write path — `updateAssemblyLeafOverride` (costing.ts:817-)

```ts
updateAssemblyLeafOverride(FormData { quoteSkuId, tierId, sellPriceOverride })
```

- Draft-only via shared `quoteForAssemblyLeaf` loader
- Set/clear via value-or-null pattern
- INSERT / UPDATE / DELETE (lazy row)
- Audit action: `assembly_leaf_sell_override_updated`
- No-op guard (unchanged value returns without an audit row)
- Positive-value guard (v > 0; clear via null, not zero)
- Realtime propagates via publication membership

### Snapshot in FR-12 clone — `cloneQuoteGraph` (quotes.ts:1992-)

Cloned along with `assembly_leaf_inputs`, `assembly_leaf_targets`,
`assembly_production_inputs`, `freight_leg_tiers`, `freight_
customer_arranges_meta`.

### Where the UI is missing

Grep for `updateAssemblyLeafOverride` / `sellPriceOverride` in
`*.tsx`: **zero callers.** No UI wire currently invokes the
override write path. The action is fully-scaffolded but
unreachable from PMs.

`request_override` in `pricing-surface-shell.tsx` onActivate
comment: "v1 ships as no-op placeholders. Admin-override workflow
+ tighten-to-target automation banked v1.1+."

---

## §2 · What this slice needs to build

Reframed from CA's brief now that the inventory is known:

| Brief item | State | Slice work |
|---|---|---|
| Data model | ✅ exists | none |
| Migration | ✅ n/a | none |
| Read path (store slice) | ✅ exists | wire consumers |
| Write action | ✅ exists | wire callers |
| FR-12 clone | ✅ exists | none |
| Audit shape | ✅ exists | none |
| **UI — inline per-cell dual field (price + margin)** | ❌ | **build** |
| **Focus-scroll from manual-only banner** | ❌ | **build** |
| **Floor validation (soft-warn / hard-block)** | ⚠ partial | **extend action** |
| **Admin-override authorization** | ❌ | **build** |
| Snapshot-on-send freeze | ⚠ effectively via draft-lock | see §3 |
| Overridden-cell visual marker | ❌ | **build** |
| Recompute → manual-only state resolution | ✅ auto via reconcile | verify |

Net scope: primarily a **UI + validation + new admin-authorization
mechanism** slice. Not "data model · migration · snapshot · audit
· UI · validation · recompute" as the brief framed — three of
those are already in place. The framing overestimates the size;
actual scope is tighter.

---

## §3 · §3 admin-override — no existing mechanism

Confirmed. Two code sites document this explicitly:

- `src/lib/pricing-classifier.ts` (action-kind comment for
  `override_unavailable`): the code emits an inert card when
  `!policy.allow_override` fires; there is no "yes, override" path.
- `src/components/pricing-surface/pricing-surface-shell.tsx`
  onActivate comment: `"request_override · tighten_to_target — v1
  ships as no-op placeholders. Admin-override workflow +
  tighten-to-target automation banked v1.1+."`

The scenario-actions-menu (drop-scenario workflow) has a **text
mention** of admin override — `"Sent + accepted quotes can't be
dropped from the menu — that requires admin override."` — but no
UI or action mechanism backs the claim; it's copy-only.

**Implication for §3:** this slice must build the admin-authorization
mechanism from scratch. Sub-scope:

- New action: `authorizeSubFloorOverride({ quoteSkuId, tierId,
  sellPriceOverride, adminUserId, reason })`
- Admin gate: `requireAdminAction()` at the top (existing helper —
  `src/lib/admin-guard.ts`)
- Audit action name: propose `assembly_leaf_sell_override_admin_
  authorized` (per Slice 9.2 namespace convention — distinct action
  because the semantic intent is different: sub-floor authorization
  is a different business event than a normal override set)
- Diff_json shape: `{ from: prev, to: parsedValue, floor_pct,
  resulting_margin_pct, reason, source: "admin_sub_floor_
  authorization" }`
- UI flow: PM hits floor block → clicks "Request admin override" →
  form (or modal) captures reason → routes to admin (email
  notification? in-app inbox? — need Edward's call on delivery
  channel)
- Admin review UI: separate — where does the admin see pending
  authorization requests? Same question as delivery channel.

Two sub-open-questions for Edward:

1. **Where does the admin see the request?** Options:
   (a) Email link (fastest, no new UI) — admin clicks a signed link
       and lands on a review page
   (b) In-app admin panel (heavier — new nav surface, new route)
   (c) Slack DM (requires Slack app integration — probably
       excessive for v1)
   Recommend (a) for this slice. Bank (b) as v1.1+ if request
   volume grows.
2. **Does the admin authorize the specific price, or approve
   "PM can proceed at their discretion"?** The brief §3 says
   "admin authorizes a sub-floor price" — implying the specific
   price is stored. Confirming.

Also, **who is admin?** `users.role === 'admin'`. That's the
existing model — see `src/lib/admin-guard.ts`.

---

## §4 · Snapshot-on-send

Not currently a hard invariant. Overrides can only be set on
draft quotes (`assertDraft` at the loader). Once a quote transitions
to sent, no code path can rewrite overrides on that quote.

**But:** the storage isn't versioned. If, hypothetically, someone
adds a "clone from sent quote" or "reopen quote for edit" path
in a future slice, that path could rewrite override values on the
sent quote — and the sent quote's PDF would silently reflect the
new price. Slice 11's `pdf_url` snapshot pointer partially
mitigates (the frozen PDF is served regardless of DB state) but
the DB record would still drift.

Two disposition paths:

- **(a) Trust the draft-lock** (current shape) — invariant is
  behavioral, not schema-enforced. Reproducibility of sent-quote
  prices depends on no future code path violating the lock. This
  is the simplest option and aligns with Pattern 32 pre-prod
  tolerance ("don't engineer around hypothetical edge cases").
- **(b) Snapshot at send** — add a `sent_at`-versioned copy or an
  `effective_until` column so history is queryable. Costlier;
  probably not v1 justified.

Recommend (a) with an explicit CLAUDE.md bank of the invariant:
"assembly_leaf_overrides values are draft-locked; any future code
path that mutates them on non-draft quotes breaks the reproducibility
contract."

---

## §5 · Sequencing — CC input on §10

Two open threads:

- **Slice 11 Step 7** (Pattern 45 boundary sweep + inverse import
  guard) — reads the customer-facing tree and enforces
  costing-import bans. Runs against `src/components/pdf/*`,
  `src/components/quote/*`. Does NOT touch pricing surface.
  Estimated 1–2 dev sessions.
- **Slice 11 Step 8** (CB smoke matrix + close-out banks) — smoke
  the full customer-view render tree against the sample quote +
  Scenario B + accepted/sent state matrix. Also 1–2 sessions.
- **Per-cell override slice** — UI wire + admin-override mechanism
  + floor validation + focus-scroll. Estimated 2–3 sessions
  (smaller than the brief framed because §5 data model already
  exists).

**Broken-promise window:** the `suggestion_manual_only` banner
says "set a per-cell sell price override" but the affordance
doesn't exist. Window opens now; closes when this slice ships.

**CC lean matches CA's:** finish Slice 11 through Step 8 first.
Rationale:

1. Step 7's Pattern 45 boundary is adjacent code — landing it
   before extending pricing UI reduces the risk of leaking pricing
   internals into the customer-facing tree via a UI wire that
   crosses a boundary.
2. Step 8's smoke matrix will catch regressions from the Slice 11
   work in isolation before the per-cell override slice adds new
   moving parts to the pricing tree.
3. The broken-promise window is bounded by copy honesty, not by
   user harm — the banner tells PMs which cell needs attention +
   points at three recovery paths (Costs adjustment, cell
   override, admin override); Costs adjustment IS a real path,
   and admin override doesn't exist yet either. So there's one
   real recovery path (Costs) available today. PMs aren't stuck.

**If Edward wants the broken-promise window closed sooner**, the
tiny-stopgap CA declined earlier — the message that says "adjust
cost inputs on Costs" without mentioning the override — is a
1-line copy edit. Bankable if Edward wants it as a bridge.
Otherwise, ship the full slice after Slice 11 Step 8.

---

## §6 · Open questions summarized (for Edward disposition)

1. **§3 delivery channel for admin authorization request** — email
   link (recommend), in-app panel, or Slack? CC leans email link
   for v1 speed.
2. **§3 authorization granularity** — admin authorizes the
   specific price (per brief §3), or approves PM discretion?
   Confirm specific-price per brief.
3. **§4 sent-quote reproducibility** — (a) trust draft-lock
   invariant + bank in CLAUDE.md (recommend); (b) snapshot at
   send (more work, less v1 justified).
4. **§10 sequencing** — CC leans finish Slice 11 through Step 8
   first, then this slice. If broken-promise window unacceptable,
   ship a 1-line copy stopgap as a bridge.
5. **UI real-estate** — the brief says "inline in the per-SKU
   breakdown, at the cell (SKU × tier) level." Existing per-SKU
   breakdown has "SHOW BREAKDOWN" expansion — does the override
   dual-field live there, or does it need its own expansion
   surface? Need to align with CD on the visual grammar. Might
   need a small R-round design (Pattern 34-candidate) before
   building, or CC can extend the existing breakdown grammar
   with CA disposition.

---

Awaiting disposition on Q1–Q5 above. No code will be written on
this slice until §3 questions are answered.

Separately: PR #118 (stranded fixes recovery — pdf-axis clone +
production toggle) is still open and independent — can merge
whenever ready.
