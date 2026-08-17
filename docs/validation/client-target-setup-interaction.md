# Client Target — proposed Setup interaction

**Status:** design proposal. No code written.
**Date:** 2026-08-17.
**Follows:** `client-target-identity-trace.md` (persistence direction approved).

Covers the five interactions asked for, and the placement question underneath
them: **where does a per-sellable-unit value live on a surface whose freed space
was per-tier?**

---

## 1 · The placement conflict, stated first

The disposition names *"Setup's former Price Adj area"* as the home. That area
was a **column in the Tiers table** — one value per tier, four cells.

Client Target is per **sellable unit × tier**. A column in the Tiers table can
hold exactly one sellable unit's worth of targets, so it works for a quote with
one Item Group and breaks the moment a quote has two, or an Item Group plus a
Direct Product — which the same disposition requires.

The two readings of "the former Price Adj area" therefore diverge:

- **literally**, a column in the Tiers table — cannot express the requirement;
- **as intent**, the authoring space Setup just freed — can.

**Proposed: the intent.** Client Target lives on the **sellable-unit row** in
the SKU tree, because that row *is* the unit of account. Reasons below; the
Tiers-table column is available if the firm would rather constrain the feature
to single-unit quotes, and that is a business call, not an engineering one.

---

## 2 · Why the sellable-unit row

The tree already distinguishes exactly the two things the model keys on:

| component | what it renders | keys to |
|---|---|---|
| `asy-row.tsx` | Item Group (finished good) | `assemblies.id` |
| `direct-product-row.tsx` | Direct Product | `quote_leaves.id`, `assembly_id IS NULL` |
| nested leaf rows inside an ASY | internal members | **nothing — no target affordance at all** |

So the affordance appears on precisely the rows that may carry a target, and is
**absent** from member rows. The write-boundary refusal is real and stays; this
means an operator never reaches it, because there is nothing to press. A
refusal you can trigger is a worse surface than one you cannot.

Mixed quotes need no special case: each top-level row owns its own target, and a
quote with three Item Groups and two Direct Products has five independent ones.

---

## 3 · The shape

**Common target: inline on the row.** A read↔edit cell in the row's right-hand
cluster, beside the completeness chip — the Pattern 29 read↔edit vocabulary
already canon on Setup.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▾ ⠿  ZZ-VAL-ASY   ZZ-VALIDATION assembly          2 products             │
│                                                                          │
│                        CLIENT TARGET   $5.00        [⚑ 2 of 2]  ⋯  Notes │
│                        all tiers                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

Unset renders `—` with the caption `not set`, not `$0.00`. Zero is a target
someone chose; absence is not.

**Tier-specific overrides: the row's Client Target drawer.** Opened from the
caption when it is a link, or from the row context menu. The ASY row already
has this exact pattern — `AsyNotesTrigger` + `AsyNotesDrawerPanel`, an inline
panel that expands beneath the row — so the Item Group case reuses an
established interaction. The Direct Product row has no drawer today and would
gain one of the same shape.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CLIENT TARGET · ZZ-VALIDATION assembly                            ✕     │
│  What the client said they need to pay. Internal — never quoted.         │
│                                                                          │
│  Common target        $5.00                    applies to every tier     │
│  ─────────────────────────────────────────────────────────────────────   │
│  Tier 1 · 1,000       $5.00   common                                     │
│  Tier 2 · 5,000       $4.60   TIER TARGET · REPLACES COMMON $5.00        │
│                               revert to common                           │
│  Tier 3 · 10,000      $5.00   common                                     │
│  Tier 4 · 20,000      $5.00   common                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

The register is deliberately the one operators have just been walked through on
Pricing: a headline value, per-tier rows that either **inherit** it or carry an
override that **REPLACES** it, and an explicit **revert**. Same precedence, same
words, same shape — `tier target ?? common target`.

---

## 4 · The five interactions

**a · Set one common target.** Click the row's Client Target cell, type, commit
on blur or Enter. Every tier inherits it. Caption reads `all tiers`.

**b · Override an individual tier.** Open the drawer, click that tier's cell,
type, commit. The row caption changes from `all tiers` to `3 tiers · 1 override`
so the exception is visible without opening the drawer. The tier's cell reads
`TIER TARGET · REPLACES COMMON $5.00`.

**c · Clear a tier override back to common.** `revert to common` on that tier's
cell — one press, no confirm, exactly as `REVERT TO QUOTE-WIDE` behaves on
Pricing. The cell returns to showing the inherited value muted.

**d · Clear the common target entirely.** Clear the row cell to empty.

  **Tier overrides survive.** A tier-specific target is its own decision and
  clearing a different one does not unmake it. The row then reads
  `1 of 4 tiers` and the drawer shows the three inheriting tiers as
  `no target` rather than as a number. This is the honest state and it needs no
  modal.

  The alternative — refusing to clear until overrides are cleared first — makes
  the operator undo work in an order the system chose, to reach a state the
  system could simply have represented.

  **Clearing everything** is `clear all targets` in the drawer footer, which
  removes the common row and every override. One deliberate act, named.

**e · Mixed quotes.** Nothing is global. Five sellable units means five rows,
five independent common targets, five drawers. No quote-level control exists to
be ambiguous about which unit it means.

---

## 5 · What the operator reads, and what they do not

Per the disposition, Setup states facts and no verdict:

- the value, and whether it is common or this tier's;
- how many tiers carry an override.

**No** competitive/uncompetitive language, on Setup or anywhere, until such a
term has a governed definition. Where a gap is shown — on Costs and Pricing,
not here — the wording is factual and directional:

```
$0.35 above client target
$0.20 below client target
at client target
```

Margin, target and floor policy stay a separate axis and are never combined
with this one into a single verdict.

**Setup shows no gap at all.** Base Sell is not knowable on Setup — costs have
not been entered — so a gap here would either be blank or wrong. Setup is where
the target is *authored*; Costs is the first surface that can compare it to
anything.

---

## 6 · Edge cases

| case | behaviour |
|---|---|
| quote has no tiers yet | the row cell still authors a common target; the drawer says `add tiers to set tier-specific targets` rather than rendering an empty list |
| a tier is deleted | its override goes with it — `tier_id` cascades. The common target is untouched |
| a sellable unit is deleted | its targets go with it — both FKs cascade |
| target set, then the Item Group's last member removed | the target stays on the Item Group. It is a statement about the finished good, not about its contents |
| non-draft quote | read-only, same `committable` gate as every other Setup writer |
| member leaf | no affordance, at all |

---

## 7 · Boundaries this design keeps

- Authoring a target writes **only** `quote_client_targets`. It creates or
  modifies no GPA, no tier adjustment, no lift, no direct price, no Final
  Quoted Sell.
- The target is **internal**. It does not reach `customer-view-resolver`, the
  PDF tree, or NetSuite — currently true by absence, and the customer-view
  boundary guard should be extended to name it so that absence is enforced
  rather than incidental.
- Costs and Pricing render it **read-only**. Neither authors it, so there is one
  writer and one authoring surface — the discipline just applied to tier price
  adjustment and to the recommended tier.

---

## 8 · The open decision

**Sellable-unit row (proposed)** — scales to mixed quotes; costs a new drawer on
the Direct Product row; moves the feature out of the literal space named.

**Tiers-table column (the literal reading)** — reuses the vacated column and is
marginally cheaper for the single-unit case; cannot express a mixed quote, so
it would need either a per-unit dimension added later (the same rework twice) or
an accepted limitation that Client Target applies to quotes with one sellable
unit.

Recommending the first. The second is legitimate if the firm's real quotes are
overwhelmingly single-unit and the constraint is acceptable — but that is a
statement about how the firm sells, which is not mine to make.
