# Markup policy boundary — where retroactive repricing is prevented

**Traced 2026-08-17 against `a8d017e`.** Requested before implementing
[BV-013](../business-validation/BV-013-production-markup-authority.md).

**Reports only.**

---

## Headline

**The boundary already exists, is already correct, and already covers markup.**

Nothing needs designing. `resolveCommercialSettingsForLifecycle`
(`src/lib/commercial-settings-contract.ts:12`) is three lines and is exactly
the recommended policy:

```ts
if (args.status === "draft") return { ...args.live, source: "live" };
if (args.pinned)             return { ...args.pinned, source: "pinned" };
return { ...args.live, source: "legacy_live" };
```

- **Draft** → live policy. Adopts a new Production default, as recommended.
- **Non-draft with a pin** → pinned policy. Does not reprice when Firm Settings
  change, as required.
- **Non-draft without a pin** → live, and **already named `legacy_live`** rather
  than silently treated as live.

The exposure is not the mechanism. It is the population that predates it.

---

## 1. What is already built

| Component | What it does |
|---|---|
| `quote_commercial_settings_pins` | One active pin per quote, written atomically with each send snapshot, superseded on revision. Carries `target_margin_pct`, `floor_margin_pct`, `freight_markup_pct` |
| `quote_commercial_markup_pins` | Per-send markup resolution at `(pin, quote_leaf, tier, category)`, with the `chosen_rung` recorded |
| `resolveQuoteCommercialSettings` | Collapses pins to `Record<category, pct>` and throws on same-category disagreement |
| `resolveCommercialSettingsForLifecycle` | The three-line boundary above |
| `costing.ts:745`, `:1333`, `:1627` | **The costing engine consumes it.** Every bundle read resolves policy through this boundary |

**The markup pin already covers Production and Raw.** Measured across all pin
rows, eight categories are present — 36 rows each:

`Freight 0.20` · `Manufacturing 0.30` · `Other 0.30` · `Primary 0.45` ·
`Raw ingredients 0.30` · `Secondary 0.50` · `Soft Goods 0.35` · `Tooling 0.20`

`Raw ingredients` is pinned at `0.3000` — the *resolved outcome* of today's
`→ Other` fallback, recorded as a value with its rung. A pinned quote therefore
already keeps 30% for raw regardless of what happens to the fallback ladder.

**`Production` needs no new pin plumbing.** `prepareQuoteCommercialPin`
enumerates `markup_defaults` rows, so the category is pinned automatically from
the moment the row exists.

---

## 2. The actual exposure — quotes with no pin

| status | unpinned | pinned |
|---|---|---|
| sent | **12** | 2 |
| accepted | **1** | 2 |
| complete | **1** | 7 |

**14 non-draft quotes resolve `legacy_live`** and would move with any firm
policy change. They predate the pin mechanism; they are not a defect in it.

---

## 3. Correction to the impact figures in the migration trace

The earlier report said "sent quotes reprice." That is true of the three
measured, but the framing was wrong and would have led to the wrong fix.

**Sent-ness is not what determines exposure. Pinned-ness is.**

All three sent quotes in the impact table — the `SAMPLE — Aurora Botanica`
scenarios — carry **zero active pins**, so they resolve `legacy_live`. That is
why they moved. A *pinned* sent quote would not have moved, and none appeared
in the affected set.

The measured figures stand — `+$132,240.00` sent, `+$54,583.60` draft — but
they should be read as:

- **draft (6 quotes, +$54,583.60)** — intended. Drafts adopt current policy.
- **`legacy_live` (3 quotes, +$132,240.00)** — the whole exposure, and it
  disappears entirely if those quotes are pinned before the rate changes.

There is no repricing risk attributable to pinned quotes, at any status.

---

## 4. The smallest correct action

Not a new boundary. **Backfill pins for the 14 unpinned non-draft quotes at
today's resolved rates, before `Production` changes value.**

That uses the existing writer and the existing schema, adds no code path, and
reduces the migration's non-draft repricing to zero by construction rather than
by a status special-case. After it, every non-draft quote resolves `pinned` and
the three-line boundary does the rest.

**Do not special-case the SAMPLE quotes.** The action is general: pin every
unpinned non-draft quote.

Two properties a backfill has to satisfy, both stated because they are the ways
it could go quietly wrong:

1. **It must pin the resolved value AND the rung**, as the live writer does.
   A pin recording `Raw ingredients 0.30` without recording that the rung was
   `Other` loses the fact that no `Raw ingredients` row ever existed — which is
   the evidence a future reader needs to understand the number.
2. **It must run before the `Production` row is created or `Manufacturing`
   changes.** Backfilling after would pin the new rate onto old quotes, which
   is the retroactive reprice with extra steps.

---

## 5. Open questions this does NOT settle

- **Is a `legacy_live` quote's current displayed economics the correct thing to
  freeze?** Backfilling pins today's rates, which preserves what those quotes
  display *now*. Whether that equals what they displayed *when sent* is not
  knowable from a pin that was never written — no record of the rates in force
  at their send time exists.
- **Should `legacy_live` remain reachable at all**, or become a refusal once
  the backfill has run? Leaving it reachable means a future unpinned non-draft
  quote silently resolves live again.
- Neither is required to implement BV-013 safely, provided the backfill runs
  first.
