# Item Group → Sales Order · session handoff

**Written 2026-08-31.** Documentation only; this document changes no behaviour.

Its purpose is to make the next session restartable from **repository evidence**
rather than from reconstructing seven pull requests and a long conversation.
Everything asserted here was measured, and the measurement is named beside the
claim.

---

## ⚠ THE ONE THING THAT MUST NOT GO WRONG

**Do not merge #523 on its own.**

#523 is accepted and correct. But merging it alone moves the system from
**fail-closed** to **economically reconciled and structurally wrong**:

```
flat members + IGP + OTC = $66,556.00
```

satisfies REG-4 exactly while failing to represent the **Item Group the customer
accepted**. Four loose product lines and a group of four are the same arithmetic
and a different commercial statement, and the arithmetic cannot tell them apart.

> **REG-4 is necessary but not sufficient for Item Groups.** (Edward,
> 2026-08-31.) A sibling of the standing rule in `CLAUDE.md` — *"exact
> reconciliation is necessary but not sufficient"* — except that here what is
> misattributed is not value but **structure**.

Merge #523 **together with, or immediately before deploying**, the structural
Group-span implementation, so that **no operator-visible interval exists** in
which a structurally flat Item Group is considered ready to push.

Today, with #523 unmerged, an attempted push fails REG-4 with the $23,887.50
shortfall and refuses. That is the safe state, and it is safe by accident of
sequencing rather than by design — which is exactly why the cutover must be one
step.

---

## 0 · Current classification

> ### Order 1 is **NOT YET END-TO-END CERTIFIED.**

The project does not get credit for Order-1 certification until the staged order
completes the full lifecycle. **Intermediate gates and repairs are necessary
controls, not the acceptance result** — five defects found and repaired, a
governed destination created, master data mapped and REG-4 closing in a dry run
are all *preconditions*, and none of them is the pass.

### The acceptance criterion

**One operator-authored staged order must go end to end with no prohibited
intervention:**

```
Setup → Costs → Pricing → Recovery → Quote → Send → Accept
      → NetSuite sandbox push → actual SO readback → independent reconciliation
```

**Prohibited throughout — any one of these voids the certification:**

- backend population;
- direct SQL writes to business state;
- direct action shortcuts (calling server actions to advance lifecycle);
- REG-4 waiver or narrowing;
- manual repair of the accepted artifact;
- substituting false master-data identities merely to get through a gate.

Read-only database inspection for verification remains allowed, and is how most
of the evidence in this document was gathered.

### Final PASS for DPS-1072

The **actual NetSuite Sales Order** must prove economic *and* structural
fidelity:

- the Group span represents `TRN-SERUM-30`;
- Bottle ×1, Pump ×1, **Label ×2**, Carton ×1;
- member quantities and rates match the frozen accepted artifact;
- `IGP-0001` carries exactly **$23,887.50**;
- Tooling **$16,030** exactly once;
- R&D **$6,048** exactly once;
- Included Setup and Artwork **do not reappear**;
- total exactly **$66,556.00**;
- every expected Nexus fact appears in NetSuite **exactly once**;
- every Nexus-originated NetSuite line traces back to **exactly one** governed
  frozen fact;
- accepted-tier lifecycle fields reconcile after the push (see §3).

The last two are bidirectional provenance: nothing missing, nothing duplicated,
nothing invented. Until that SO exists and passes readback, the classification
at the top of this section stands, and **success must not be declared earlier.**

---

## 1 · Standing state

### Merged and deployed

| PR | What it did |
|---|---|
| **#520** | `LINE_KIND_RESOLUTION` — readiness resolves a line by SKU or by destination through one shared classification instead of a literal list |
| **#521** | BV-011 authority amendment: the seventeenth destination, `item_group_production`, deliberately outside the `otc_*` namespace |
| **#522** | The governed destination itself — type union, catalogue entry, `bv011_destination` enum, migration `0117` (additive, label appended) |

### Open and intentionally NOT merged

**#523** — the Item Group **commercial** line. See the warning above.

What it contains: `LINE_KIND_RESOLUTION.item_group` moves `by_sku →
by_destination`; a `LINE_KIND_DESTINATION` map (`item_group →
item_group_production`) beside the existing `SERVICE_IDENTITY_DESTINATION`;
readiness derives the destination in the same expression that already derives a
Direct Service's from its identity; and the accounting emitter's branch is
widened from `direct_service` to the **unit-priced** set so the line posts at
its own quantity and rate rather than as 1 × its amount.

---

## 2 · Live sandbox authority

Created and verified this session. All are permanent certification master data.

| Nexus SKU / destination | NetSuite code | internal ID | type |
|---|---|---|---|
| `TRN-PP-BOTTLE-30` | TRN-PP-BOTTLE-30 | **76155** | InvtPart |
| `TRN-PP-PUMP` | TRN-PP-PUMP | **76156** | InvtPart |
| `TRN-SP-LABEL` | TRN-SP-LABEL | **76157** | InvtPart |
| `TRN-SP-CARTON` | TRN-SP-CARTON | **76158** | InvtPart |
| `item_group_production` | **IGP-0001** | **76160** | NonInvtPart / Resale |

`IGP-0001` configuration, per Accounting disposition: subsidiary 2, income 218,
expense 212, **tax schedule 2 · Non Taxable** (an explicit disposition — do not
derive tax schedule in code from destination type or neighbouring items),
active.

Mapping is live and audited: `netsuite_destination_item_map` row
`item_group_production → IGP-0001 / 76160`, and an audit row
`destination_item_mapping_set` with `from: null → to: {IGP-0001, 76160}`,
`governed_item_type: non_inventory`.

**There is no NetSuite Group for `TRN-SERUM-30`, and one must not be created by
hand.** It must come from `findOrCreateItemGroup`, for the reason in §5.

---

## 3 · Order 1 lifecycle state

| | |
|---|---|
| quote | `ee3f0efc-e3ba-49e3-a02a-610449df86f4` |
| number | **DPS-1072** |
| version | **v2** |
| status | **accepted** |
| accepted tier | Tier 3 · `55ac5d1e-63d6-41ab-a055-706db6d9f86c` · 6,000/SKU |
| live snapshot | `59643330-a53c-41ab-87ab-9bb1cd929642` |
| NetSuite SO | **none** — `netsuite_so_id`, `netsuite_so_tranid`, `netsuite_pushed_at`, `netsuite_so_push_status` all NULL |
| project | `c9db8264-…` · TRAINING · Serum Launch · ZZ-VALIDATION customer, NetSuite 388800 |

**Do not revise, re-send or re-accept it.** The accepted artifact is the
authority and must reach NetSuite unchanged.

### Unresolved observation, carried

`customer_accepted_tier_id` is set; **`accepted_tier_id` remains NULL**
pre-push. The expectation is that the freeze transaction writes it at push
time, but that has never been observed because no push has succeeded.

**Verify it after a successful push. If it is still NULL, that is a
lifecycle-integrity finding, not intended behaviour.** Do not assume intent.

---

## 4 · Economic acceptance — frozen Tier-3 authority

```
member economics            $20,590.50
Item Group-owned economics  $23,887.50
separately elected OTC      $22,078.00
                            ──────────
total                       $66,556.00
```

Built from the frozen snapshot and resolved against live NetSuite (measured, not
projected):

```
item_group_member  76155  qty  6,000  rate 1.59848      9,590.88
item_group_member  76156  qty  6,000  rate 0.78387      4,703.22
item_group_member  76157  qty 12,000  rate 0.25440      3,052.80   ← Label ×2
item_group_member  76158  qty  6,000  rate 0.54060      3,243.60
item_group         76160  qty  6,000  rate 3.98125     23,887.50   ← IGP-0001
otc                 4077  qty      1  rate 16030.00    16,030.00   ← Tooling
otc                59157  qty      1  rate  6048.00     6,048.00   ← R&D
                                       emitted         66,556.00
                                       frozen total    66,556.00
```

**Label membership is ×2**: 6,000 finished units → 12,000 Label Set.

**Included Setup and Artwork recovery stays inside the $23,887.50** and must not
emit separately. `$6,265` of that amount is the `unitPriceRecovery` of
`project_setup` + `artwork_plate`. Emitting them again anywhere would
double-count; reallocating them into member rates would change what a component
rate means.

---

## 5 · NetSuite Group semantics — already proven, do not re-derive

Measured against real sandbox orders `SO2715` (362341) and `SO2716` (362441),
at the **database** level and not only through REST serialisation:

```
seq 1  Group      qty -1000   rate NULL      netamount NULL
seq 2  InvtPart   qty -1000   rate 0.5365    netamount  -536.50
seq 3  InvtPart   qty -1000   rate 1.8705    netamount -1870.50
seq 4  EndGroup   qty NULL    rate NULL      netamount -2407.00
seq 5  InvtPart   qty -1000   rate 3.6685    netamount -3668.50
                                             subtotal   6075.50
```

- A Group is a **span**: header → members → `EndGroup`.
- The **header carries a quantity and no sell value.** `rate` and `netamount`
  are NULL on it.
- **`EndGroup` rolls up the member amounts** (−2407.00 = −536.50 + −1870.50) and
  contributes no independent economics.
- The order **subtotal is the sum of the MEMBER amounts**; the header and
  `EndGroup` add nothing.
- **NetSuite does not expand membership.** Nexus emits each member line
  explicitly.
- `EndGroup` appears because `includeStartEndLines` defaults true — it is not
  sent by `item-groups.ts`, and was observed true on the Nexus-created group
  75954.

### Therefore: two Item Group identities, never conflated

| | resolution | priced? |
|---|---|---|
| **Structural** | frozen composition → composition hash → `findOrCreateItemGroup` → NetSuite Group | **no** — it opens a span |
| **Commercial** | `kind = item_group` → `item_group_production` → IGP-0001 | **yes** — carries the group's own economics |

Do not call the IGP line "the Group header" in code, comments or tests.

---

## 6 · `findOrCreateItemGroup` — traced contract

`src/lib/netsuite/composition-hash.ts` + `src/lib/netsuite/item-groups.ts`.

| property | value |
|---|---|
| hash inputs | `customerNetsuiteId` + `baseSku` + `members[{netsuiteItemId, quantity}]` |
| member ordering | sorted by internal id ascending — **sort-agnostic** |
| member identity | NetSuite **internal id**; duplicates throw |
| **qty/parent in the hash** | **yes** — *"1 bottle + 1 pump is structurally distinct from 2 bottles + 1 pump"*; positive integers only |
| external id | `nxs-grp-<sha256>` |
| already exists | Layer 2 SuiteQL by `externalId` → persist locally, **never re-create** |
| same composition twice | Layer 1 cache hit on `composition_hash` → reuse |
| create idempotency | `idempotencyKey: externalId` |
| subsidiary | `{ items: [{ id }] }` — a **collection**, not a reference |
| `includeStartEndLines` | not sent; NetSuite defaults it true |

So **Label ×2 and Label ×1 hash differently**, produce different external ids,
and therefore different Groups. That is the identity requirement, satisfied by
the existing contract with no change.

**`FindOrCreateInput` already takes caller-supplied composition and never reads
quote state — no input-boundary change is required.**

---

## 7 · Frozen composition is the only source

`quote_snapshot_artifacts.structure` already records qty-per-parent **and**
ordinal, so nothing needs deriving by division from transaction quantities:

```
TRN-PP-BOTTLE-30  quantity "1"  ordinal 0
TRN-PP-PUMP       quantity "1"  ordinal 1
TRN-SP-LABEL      quantity "2"  ordinal 2
TRN-SP-CARTON     quantity "1"  ordinal 3
groupSku          TRN-SERUM-30
```

**Do not reread live assembly membership or product-library composition during
push.** The accepted artifact is the authority; live structure is mutable and
may have moved since acceptance.

Resolve member NetSuite internal ids from the **frozen member SKUs** through the
existing `resolveNetsuiteItem`.

---

## 8 · Exact next implementation

**Start at the disabled block in `src/lib/netsuite/mark-complete.ts`:**

```
/* const itemGroupOutcomes … */  // ← intentionally not built
```

**Read and adjudicate every reason in that rationale before changing it.** It
cites the Assembly migration (a v1.1+ candidate proven via Probe 4), a possible
RESTlet path, and the `smoke:netsuite-item-groups` smoke that keeps the
primitives from rotting. Each is a claim about what was true when it was
written; check each against the authority now available rather than assuming the
disable is stale.

**Prefer enabling the machinery that already exists** — do not write a second
grouping system:

- `groupLines` / `emittedGroupLines`
- `groupMemberItemIds`
- `buildSalesOrderPayload({ groupLines, groupMemberItemIds })`
- member-rate **PATCH** behaviour after the group expands
  (`patchSalesOrderLine`, and the line-index caution at `client.ts:459`)
- post-grouping REG-4 (`checkPostGroupingReg4`, `reg4-post-grouping.ts`) —
  *"a grouped order reconciles on the EXPANDED member quantities"*

Populate `itemGroupDefinitions` from the frozen structure of §7, then call
`findOrCreateItemGroup` with that composition.

---

## 9 · Structural acceptance — prove before any push

1. frozen structure is the **sole** grouping source;
2. qty/parent participates in composition identity;
3. Label ×2 and ×1 produce **different** external ids;
4. the same frozen composition is **idempotently reused**;
5. frozen **ordinal** controls SO member ordering;
6. Group creation **cannot duplicate on retry**;
7. Group header and `EndGroup` carry **no independent sell**;
8. member quantities and rates remain the **frozen** values;
9. IGP economics stay **outside** the Group span;
10. post-grouping REG-4 still closes **exactly** at $66,556.00.

---

## 10 · Cutover and certification

Deploy **#523 and the grouping implementation as one governed cutover** (§0).

Only once both are live, push the existing accepted DPS-1072 — **without
revise, re-send or re-accept** — re-reading the certification safety gate
(`/api/certification-status`: HubSpot accept-sync SUPPRESSED, NetSuite sandbox,
write authorised) immediately before the push.

The actual NetSuite readback must certify **both**:

**Arithmetic fidelity** — $20,590.50 + $23,887.50 + $22,078.00 = $66,556.00.

**Structural fidelity** —

```
Group · TRN-SERUM-30 · qty 6,000
  → Bottle  · qty  6,000
  → Pump    · qty  6,000
  → Label   · qty 12,000
  → Carton  · qty  6,000
EndGroup
IGP-0001 · qty 6,000 · rate 3.98125 · $23,887.50
Tooling  · $16,030
R&D      · $6,048
```

with Included Setup and Artwork appearing **nowhere**.

**Provenance, both directions** — the check that distinguishes "the numbers add
up" from "the order is right":

- every expected Nexus fact appears in NetSuite **exactly once** (nothing
  dropped, nothing duplicated);
- every Nexus-originated NetSuite line traces back to **exactly one** governed
  frozen fact (nothing invented).

A short order that reconciles to its own short sum is the failure REG-4 exists
to catch, and it was caught here once already. A *structurally* wrong order that
reconciles is the failure this document exists to prevent.

Then re-check `accepted_tier_id` per §3, and only then may Order 1 be
reclassified from **not yet end-to-end certified** (§0).

---

## Appendix · defects found and repaired en route

Recorded because each is a live invariant the next session should not
re-discover the hard way.

| PR | Defect |
|---|---|
| **#514** | `as CommercialLine` hid **eight** missing fields on the Item Group line; `allocationByTier` reached the freeze as `undefined` and threw, so no quote containing an Item Group could be finalized at all |
| **#515** | Publication boundary — the customer document and the freeze rounded independently, so a stated tier total could differ from the sum of its own lines by a cent |
| **#516** | The quote number was minted **after** the artifact was rendered, so every finalized PDF carried a blank where its number belongs |
| **#517** | Cost recognition depended on recovery placement — an `unplaced` charge's cost vanished from tier economics entirely |
| **#520** | Readiness misclassified the Item Group line and gave a remediation that could not be followed |

Two of these (#514, #520) and the REG-4 shortfall all trace to the same origin:
**OD-028 (#497) introduced the `item_group` line kind without integrating it
into the surfaces that consume line kinds.** If a further consequence surfaces,
look there first.
