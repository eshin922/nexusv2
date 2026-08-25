# Customer View — fidelity reconciliation matrix

**Sources.** The operator inventory (Edward, 2026-08-25) cross-checked against
the registered authority at `docs/design-authority/customer-view/` and against
the code. Where the two differ, the registered authority governs and the
difference is named rather than resolved silently.

**Classifications**, used exactly:

- **RESTORE** — existing DA capability missing or incomplete → V1 restoration
- **REPAIR** — existing capability regressed → V1 repair
- **NO WORK** — quote-specific or intentional governed difference
- **DEFER** — genuinely new functionality
- **CONFLICT** — surfaced, not chosen

**Scope constraint:** no new V1 functionality.

---

## §1 · Conflicts — read first

Four. Each is a case where doing what the inventory says would either add V1
functionality or contradict a recorded disposition.

### C-1 · Card 3 "Bill to" has no governed source

| | |
|---|---|
| authority | Card 3 · Commercial agreement · "Bill to" |
| Nexus source | **none** |
| evidence | `customer-view-resolver.ts:370-376` hardcodes `contact/role/email/address: null`. No `bill_to`, `billing_address` or company-address column exists in `schema.ts` — the grep returns nothing across projects, deals and the HubSpot cache. |

The `CustomerViewCustomer` type has an `address` field, but nothing ever
populates it. So this is not an incomplete wiring of an existing fact; there is
no fact.

The inventory says Card 3 is "existing V1 authority, not a request to invent
new functionality." For the Accounting instruction that is true. For **Bill to**
it is not: sourcing a billing address means choosing an owner (HubSpot company
record? a new quote column? firm settings?), which is new V1 functionality and
the scope constraint forbids it.

**Proposed: DEFER**, with the DA element recorded as unbuilt rather than
dropped. Needs your disposition.

### C-2 · Card 3 "Deposit treatment" is a different deposit

| | |
|---|---|
| authority | Card 3 · Commercial agreement · "Deposit" |
| Nexus source | `depositStatus` enum, `schema.ts:338` |
| evidence | Its own comment: *"deposit lifecycle for cost sections (packaging, production, bulk_raw)"* — a **supplier-side** payment lifecycle on cost inputs. |

Nexus has no customer-facing deposit term. Wiring the supplier-side enum into a
customer-facing commercial agreement would state something about the customer's
obligations from data describing what DPS owes its suppliers — the same class
of error as reading a rollup as a governed fact.

**Proposed: DEFER.** A customer deposit term is new V1 functionality. Needs
your disposition.

### C-3 · Card 1 freight / duty-tariff controls vs the class rule

| | |
|---|---|
| authority | Card 1 shows recovery controls for freight and duty |
| Nexus | `container_freight` and `duty_tariffs` are `grain: "landed"`, `available: ["included","separate"]`, with `absorbed` refused on **policy** ("freight must be recovered", "statutory pass-through") and `separate` refused as **unwired** (`LANDED_SEPARATE_UNWIRED`) |

The one-time-fee class rule (2026-08-24) deliberately did **not** extend to
landed charges, and the registry says why: a rule that leaked into them would
permit absorbing a statutory pass-through.

The inventory asks to "reconcile against actual V1 ownership; do not invent
duplicates if another governed surface already owns them." Freight *is* owned
elsewhere — the Costs surface owns freight legs and customs. So the question is
whether Card 1 should show freight/duty rows at all.

**No conflict on the refusals** — they are correct and the class rule
deliberately excludes them. **Open question on presence:** whether the rows
should render at all when the Costs surface owns the input.

**Proposed: NO WORK on the refusals; disposition needed on row presence.**

### C-4 · "Governance vocabulary as primary operator language"

| | |
|---|---|
| inventory | elections must be distinguishable from inherited "without making engineering/governance vocabulary the primary operator language" |
| current | the policy caption reads `policy: in unit price / separate · cost governed · elected` |

`elected` / `inherited` / `placed more than one way` are governance words, but
they sit in a secondary mono caption beneath the treatment buttons, which are
the primary language. Whether that satisfies the constraint is a judgement
about the DA's register, not a fact in the code.

**Proposed: NO WORK, flagged for your read** at Gate B, when the caption's
visual weight is set against the authority.

---

## §2 · Card 0 — Governed

| authority element | Nexus source | current | class | action |
|---|---|---|---|---|
| Goods sell · recommended tier | `quoteRollup[recommended]` | reads the recommended tier; **null when none** | NO WORK | — |
| Charges at cost | same rollup | same | NO WORK | — |
| Approved recovery | same rollup | same | NO WORK | — |
| No fallback when no recommendation | — | `const rec = recId ? (rollups.find(...) ?? null) : null` — renders "No recommended tier" | NO WORK | — |
| Margin floor / target | `firm_settings` | rendered | NO WORK | — |
| Locked / owned-elsewhere treatment | DA | dashed sunken card, lock glyph, `PRICING`/`COSTS`/`POLICY` source tags | NO WORK | — |

**Card 0 is complete.** The "do not invent a fallback tier" property was a
repair already made and is the current behaviour.

---

## §3 · Card 1 — Commercial recovery

| authority element | current | class | action |
|---|---|---|---|
| Full one-time charge population | 7 one-time charges present | NO WORK | — |
| All three treatments per class rule | granted by `grain`; no per-charge prohibitions remain | NO WORK | — |
| Absorbed gated on a real invariant | refused by `ABSORB_COST_UNCONSUMED` — `absorbedCost` is read by nothing | NO WORK | invariant is real; opening it is separate work |
| Tooling / Artwork distinguishable from legacy combined | `1 (tooling + artwork)` vs `1 (tooling)` | NO WORK | fixed 2026-08-24 |
| Effective treatment selected when inherited | `row.effectiveMode === opt.mode` | NO WORK | fixed |
| Elected vs inherited distinguishable | `· elected` / `· inherited` caption | NO WORK | see C-4 |
| Restore inherited treatment | shipped, election-only | NO WORK | — |
| Margin after recovery · all governed tiers | all tiers, `not shown` suffix where hidden | NO WORK | — |
| No second floor gate | Card 1 has none; the send boundary owns it | NO WORK | — |
| Freight / duty rows | see C-3 | CONFLICT | disposition |
| In-flight acknowledgement | `saving…`, held until the engine answers | NO WORK | — |

**Card 1 is functionally complete** apart from C-3. Its remaining exposure is
latency (~1.6s settle), which is an open blocker but not a fidelity item.

---

## §4 · Card 2 — Customer presentation

Materially incomplete, as the inventory says. The card currently renders Shape
and Tier layout and a paragraph stating the rest is absent.

| authority element | Nexus source | current | class | action |
|---|---|---|---|---|
| Shape · Itemized / Turnkey | `quotes.detail_level` | **live control**, wired to the axis | NO WORK | — |
| — its explanatory treatment | DA | missing | RESTORE | copy + register from DA |
| Tier layout · table / single | `quotes.pdf_layout` | live control | NO WORK | — |
| **Tiers shown** — per-tier visibility | **none** | absent | RESTORE | `presentation_profile_tier` (G4 §3) |
| **Recommended tier** control | `quote_tiers.recommended` | absent from Card 2 | RESTORE | authors the existing governed fact; **not** duplicated into the profile (G4 C3) |
| **Itemize included charges** | **none** | absent | RESTORE | `include_fee_lines`; revenue-neutral (G4 C1) |
| **Commercial terms inclusion** | **none** | absent | RESTORE | `include_terms` |
| **Specification addendum** | `quotes.include_spec_addendum` | live via toolbar, absent from Card 2 | RESTORE | surface the existing fact in the card |
| **Customer note inclusion** | **none** | absent | RESTORE | `include_note`; note text retained when off |
| **Note editor + char limit/count** | `quotes.customer_facing_notes` | editor exists elsewhere; not in Card 2, no counter | RESTORE | max 400 per G4 §3 |

All RESTORE, none DEFER: every item either has a governed source already or is
covered by the dispositioned `presentation_profile` shape. **No new V1
functionality is introduced** — the profile was dispositioned on 2026-08-24.

**Consistent with the G4 disposition throughout:** recommendation stays a quote
fact; visibility/itemisation/layout are presentation facts; fee itemisation is
revenue-neutral; a revision inherits the profile transactionally.

---

## §5 · Card 3 — Accounting handoff

| authority element | Nexus source | current | class | action |
|---|---|---|---|---|
| **Commercial agreement · read-only** | | partially built | | |
| — recovery treatment + amount by charge | frozen instruction projection | **rendered** | NO WORK | — |
| — payment terms | `firm_settings` / `payment_terms_snapshot` | absent from Card 3 | RESTORE | already on `CustomerView.quote` |
| — Incoterms | `incoterms_default` / `incoterms_snapshot` | absent from Card 3 | RESTORE | already on the projection |
| — deposit treatment | see C-2 | absent | CONFLICT → DEFER | no customer-facing source |
| — Bill to | see C-1 | absent | CONFLICT → DEFER | no source at all |
| — source / provenance | frozen-instruction `treatmentSource` | `THIS QUOTE` tags rendered | NO WORK | — |
| **Customer received · derived** | | absent | | |
| — Shape · Tiers shown · Recommended · In-unit-price · Separate · Absorbed · Fees · Terms · Addendum · Note | presentation profile + recovery construction | absent | RESTORE | a projection of the frozen profile; **no authored prose for derivable facts** |
| **Instruction to Accounting · authored** | **none** | absent | RESTORE | new column on the versioned profile; freeze at checkpoint; flows to Order Packet |

The authored instruction is the one Card 3 element that is genuinely authored
rather than derived, and the DA is explicit that it exists because some
Accounting direction cannot be safely inferred. It needs a column, a freeze
entry and an Order-Packet read — **restoration of a DA capability, not new
NetSuite functionality**, since the Order Packet consumes it rather than Nexus
performing anything new in NetSuite.

---

## §6 · Customer document / live renderer

| element | current | class | action |
|---|---|---|---|
| HTML ↔ PDF semantic parity | **13/13 VERIFIED** (`e53ba4b`) | NO WORK | — |
| Unpriced explanatory footnote | PDF only | RESTORE | bounded item; required before swap |
| T&Cs sourced Admin Settings → `tcsSnapshot` | correct both sides | NO WORK | repaired 2026-08-25 |
| T&Cs content not in `presentation_profile` | content in firm settings / snapshot; only the include decision is a profile field | NO WORK | — |
| Visual transcription of the customer document | **not started** — the live renderer is deliberately raw | RESTORE | Gate B |
| — sheet, header, typography, tier table, recommended treatment, product rows, totals, fees, terms, T&Cs, notes, spacing, flow | absent | RESTORE | transcription, not redesign |

---

## §7 · Finalize footer

| element | current | class | action |
|---|---|---|---|
| Freeze & send as the single final action | present, inert | RESTORE | wire to `sendQuote` |
| Continue to Send superseded | structurally removed from the restored branch | NO WORK | `f96786d` |
| No second Send-shaped action | one act only | NO WORK | — |
| Readiness reflects real requirements | floor check + shape + delivery caption only | REPAIR | must include recovery / presentation / Accounting readiness |
| `· not wired yet` removed | present | RESTORE | after end-to-end certification |
| Reuse the certified send transaction | `sendQuote` untouched | NO WORK | one implementation |
| Below-floor uses the same authorization authority | **the footer derives its own** | **REPAIR** | see below |

### The footer's below-floor check disagrees with the send boundary

```
customer-view-rail.tsx:79   blocked = rollups.some(t => t.blendedMarginPct < floor - 1e-6)
below-floor-send-gate.ts    below-floor tiers are PERMITTED when a current,
                            un-invalidated authorization exists for that tier
                            and version, fingerprinted against the economics
                            being sent
```

A below-floor quote that has been **authorised** would be refused by the footer
and permitted by the boundary. Latent only because the button is inert.

**REPAIR** — the footer must project the gate's verdict through the same
`evaluateBelowFloorAuthorization` and `fingerprintCommercialState`. Pattern 50.

---

## §8 · Quote workflow

| element | current | class | action |
|---|---|---|---|
| QUOTE → ACCEPTANCE → SALES ORDER | five stages | RESTORE | after the prerequisites below |
| `quotes.status='sent'` preserved | unchanged | NO WORK | enum must not move |
| Freeze & send is the sole `sendQuote` path | `send-quote-flow.tsx` is currently the only caller | RESTORE | prerequisite to retiring Send |
| PM review capability moves to Acceptance | `add-entry.tsx` is the only author of `quote_review_events` | RESTORE | drop-and-replace |
| `?tab=send` → Quote, `?tab=review` → Acceptance | `parseSubTabParam` falls through to `preview` | REPAIR | explicit mapping |
| Status enum / audit model unchanged | already transition-named | NO WORK | — |

Full trace: `docs/quote-lifecycle-three-stage-trace.md`.

---

## §9 · DA elements the inventory did not list

Cross-check additions.

| element | current | class |
|---|---|---|
| Card 1 in-flight acknowledgement | shipped | NO WORK |
| Rail never stacks; narrows within 380–560 | shipped | NO WORK |
| Picking elects immediately, no confirmation | shipped | NO WORK |
| Card 0 lock glyph + `not editable here` | shipped | NO WORK |
| Preview toolbar (layout/detail/addendum) | shipped, outside the cards | NO WORK |
| Version picker above the workspace | shipped | NO WORK |
| Download PDF / Download + mail draft | shipped | NO WORK |
| `draft-marked artifact` caption | shipped | NO WORK |

---

## §10 · Totals

| class | count |
|---|---|
| RESTORE | 19 |
| REPAIR | 3 |
| NO WORK | 27 |
| DEFER | 2 (both conflicts) |
| CONFLICT needing disposition | 4 |

**No item classified DEFER except the two with no governed source.** The scope
constraint holds: every RESTORE is an existing DA capability with a source
already in Nexus or covered by the dispositioned presentation profile.

## §11 · Proposed execution order

Restoration and transcription together where they overlap, rather than
one-finding passes:

1. **G4 persistence** — `presentation_profile` + `presentation_profile_tier`,
   revision inheritance, freeze-list entry. Unblocks Cards 2 and 3.
2. **Card 2 + Card 3 derived section together** — both read the profile; the
   second is a projection of the first.
3. **Card 3 authored instruction** — column, freeze, Order-Packet read.
4. **Footer repair + Freeze & send wiring** — shared authorization verdict and
   readiness in one pass.
5. **Gate B visual transcription + the unpriced footnote** — one pass over the
   document, then the iframe swap.
6. **Lifecycle collapse** — last, since it depends on 4.
