# F1/F4 — `markComplete` commercial cutover · handover

Written 2026-08-19 at the boundary before the cutover commit. Everything the
cutover needs exists, is independently falsified, and is green. What remains is
threading it into `markComplete` and then certifying against a real sandbox
Sales Order.

**Branch:** `feat/f1-f4-so-projection`, seven commits ahead of `main`.
**State:** suite 1753/1753 · `tsc --noEmit` clean · `verify:ci` 0 failures ·
#293's Direct Service projection block untouched.

---

## 1 · What the cutover is

`markComplete` builds its Sales Order from a LIVE costing bundle fetched at push
time. Every commercial figure on the order is therefore recomputed after the
customer accepted, and reproduces the accepted quote only because draft-lock
stops cost edits and the commercial pin holds the rate. That is a convention.

The cutover replaces the commercial source with the frozen accepted-tier matrix
that #300 introduced. It changes nothing else — not the Item Group convention,
not `awaiting_rates`, not the convergence gate, not the member PATCH.

**It also fixes a live under-billing defect.** No OTC or Direct Service line is
emitted today at all, so a quote with separately billed fees posts an order
short by exactly those fees. On the CERT-300 quote that is $140 / $700 / $1,400
by tier.

---

## 2 · The exact sites, with current line numbers

`src/lib/netsuite/mark-complete.ts`, 1,760 lines.

| line | today | after |
|---|---|---|
| 225 | `const bundle = await getCostingBundle(quoteId)` | retained — still needed for `unitCost` and the tree, NOT for commercial values |
| 230 | `tierRollup = …quoteRollup.find(…)` | retained for `unitCost` only |
| **306** | `currentAmount = Number(tierRollup.totalRevenue.toFixed(2))` | **frozen `tier_commercial_total`** |
| **691** | `leafRollups = bundle.data.costing.skuRollups.filter(…)` | **iterate the frozen order's lines** |
| **738** | `effectiveQty = (tierRow.qty ?? 0) * qtyPerParent` | **frozen `quantity`** (which now IS exactly this) |
| **740** | `lineRate = Number(perTierRollup.requiredSellPerUnit)` | **frozen `unit_rate`** |
| 750-753 | `unitCost: perTierRollup.contributionCostPerUnit` | **unchanged** — see §4 |
| 812 | `buildSalesOrderPayload(soPayloadInput)` | unchanged, fed frozen values |
| 818 | `buildGroupingPlan({ … lines: planLines })` | unchanged, fed frozen values |
| 1328 | `runRateConvergence({ … })` | unchanged mechanics; rates originate frozen |

New work, not a replacement of anything:

- append the quantity-1 accounting lines (OTC + Direct Service) to the payload
- run `checkPostGroupingReg4` **before** the POST
- call `recordPostingProvenance` **after** a successful POST

---

## 3 · The modules to thread in

All on the branch, all falsified.

| module | contract |
|---|---|
| `frozen-sales-order.ts` | `buildFrozenSalesOrder(quoteId, { exec?, resolveSku })` → the COMPLETE order or `{ blockers, reg4 }`. Runs readiness (incl. provisional refusal), link A, product SKU resolution, emission, link B. Makes no NetSuite write. |
| `projection-readiness.ts` | `assessProjectionReadiness(quoteId, exec?)` → verdict **plus** resolved quantity-1 lines, from one pass |
| `accounting-line-emitter.ts` | `emitAccountingLines(resolved)` → quantity-1 lines, amounts carried, no arithmetic |
| `reg4.ts` | `checkLinkA`, `checkLinkB`, `exactRateTimesQuantity` |
| `reg4-post-grouping.ts` | `checkPostGroupingReg4({ groups, flatLines, frozenAcceptedTotal })` — reproduces NetSuite's expansion |
| `frozen-order-assembly.ts` | `checkStructureAgreement({ frozenLines, liveMembers, tierQty })` |
| `posting-provenance.ts` | `recordPostingProvenance(exec, posted)`, `findProvenanceDisagreements` |
| `frozen-cents.ts` | `centsFromFrozen` — BigInt, no float |

Suggested order inside `markComplete`:

1. `buildFrozenSalesOrder` early, right after the accepted tier is known
   (`effectiveAcceptedTierId`, line 175). Refuse on blockers — this is where the
   provisional refusal lands, before anything is built.
2. `checkStructureAgreement` against the live tree. Refuse on disagreement.
3. Build `lines` / `directLines` / `planLines` from the frozen order, taking
   grouping identity and `unitCost` from the live tree.
4. `currentAmount` from `frozenOrder.totalCents`.
5. Grouping, payload, POST — unchanged.
6. `checkPostGroupingReg4` immediately before the POST, using the group
   quantities and the rates that will actually be PATCHed.
7. After a successful POST and convergence, `recordPostingProvenance`.

---

## 4 · Boundaries that must hold

Settled by Edward; do not re-litigate them mid-build.

- **Frozen governs**: quantity, sell rate, line amount, OTC and Direct Service
  economics, accepted commercial total.
- **Live structure governs only** how an already-frozen line is grouped: Item
  Group membership, group SKU/name, qty-per-parent.
- **`unitCost` stays live.** It feeds `custcol_dps_unit_cost`, an accounting
  cost-reporting basis. It must not influence a sell rate, an SO amount, REG-4,
  or any customer-commercial figure. Historical cost-basis reproducibility, if
  ever wanted, is a SEPARATE governed snapshot — do not widen #300 into one.
- **Item Group convention preserved.** Header/member mechanics, the member-rate
  PATCH, `awaiting_rates`, the convergence gate: all as certified. Do not
  flatten members.
- **OD-006**: Item Group OTC sits inside its owning group's SO structure,
  retains `owning_assembly_id`, stays a separate quantity-1 line, and does not
  enter `composition_hash`. Direct Service stays top-level.
- **#293 comes out LAST**, only after the complete sandbox walk is green.

---

## 5 · A trap worth knowing before you start

`quote_snapshot_line_tiers.quantity` USED to hold the tier's quantity on every
line. Commit `b84ff34` corrected it to the line's own — tier order quantity ×
qty-per-parent for a product, 1 for a one-time charge.

**CERT-300's existing snapshot still carries the old, wrong value** and is
deliberately left that way as historical evidence (Edward's instruction). Its
Setup lines say `quantity = 1000` for a $140 charge, so `quantity × rate` reads
$140,000 and REG-4 will refuse it.

That is correct behaviour, not a bug to work around. **The walk re-sends the
certification quote through the corrected path**, and the new snapshot becomes
the current certification artifact. Do not point the walk at the old snapshot
and do not patch it.

---

## 6 · The sandbox certification walk

Authorized by Edward. Real NetSuite sandbox Sales Order, **permanent
ZZ-VALIDATION lineage only** — that is what the infrastructure was built for.

| | |
|---|---|
| project | `d9dc519a-9965-4dd2-8b4a-f48cf2bf5a7a` · ZZ-VALIDATION — Nexus Certification Lineage |
| CERT-300 quote | `97d25286-2c42-4a72-8979-89f1a5c2cf26` — re-send for a corrected matrix |
| CERT-302 quote | `7d4983a7-14e8-4fd1-866a-48d261c10afd` — draft, Tooling/Artwork fixture, restored |
| NetSuite | sandbox `7924416-SB2`, customer `388800`, Terms "50% Deposit/balance at shipment" |
| HubSpot | company `57628110136`, deal `64142757296` |

The order must contain a mapped Direct Service, a mapped Item Group OTC, and a
per-line Other Service selection — so `OTC - Formulation`, `OTC - Setup` and
whatever else the fixture reaches will need mappings in Settings → NetSuite
first. Only `OTC - Filling` is mapped today.

Prove:

1. frozen accepted-tier matrix → complete SO
2. Item Group structure preserved (header + expanded members, not flattened)
3. member rates reproduce frozen amounts after PATCH
4. Direct Service and OTC post to the correct mapped items
5. `netsuite_item_id` provenance records what actually posted
6. complete SO total equals the frozen accepted commercial total exactly
7. no live costing value contributes to a commercial amount
8. a deliberately provisional accepted tier refuses **before** POST

Retain both the sandbox SO and the new frozen snapshot as certification
evidence. Then remove #293, and Accounting UAT can be prepared.

---

## 7 · Working notes that saved time here

- **Preview auth**: each Vercel deployment URL is a separate Clerk domain. Use
  the stable branch alias
  `nexusv2-git-<branch>-eshin922s-projects.vercel.app` and have Edward sign in
  once; it survives pushes. A new branch means a new sign-in.
- **Governed commands only** for any number that appears in a report:
  `npm run test:unit`, `npx tsc --noEmit` — run BOTH after the last edit, since
  `--experimental-strip-types` erases types and a green suite proves nothing
  about compilation.
- **Baseline on `main` first.** `gate1b:verify-preserved` fails 8× on unmodified
  `main` (HARNESS-1 — benign draft drift). To prove a change moves no economics:
  `git checkout main` → `gate1b:capture-baseline` → copy the two JSON files
  aside → return to the branch → restore them → verify → `git checkout --
  docs/gate-1b/`. Do NOT rebaseline in a feature slice, and do not use
  `git stash` for this — on a clean tree it is a no-op and the later `pop` takes
  someone else's stash.
- **Falsify every guarantee.** Five instrument faults surfaced this slice, all
  by deliberately breaking the code rather than by tests passing: a `rate × qty`
  recomputation that value tests could not see, a one-cent tolerance no test
  exercised, and three "must not appear" greps that tripped on the comment
  documenting the absence. There is now a `codeOnly()` helper in
  `reg4-frozen-reconciliation.test.ts` for the last class. Restore with `md5sum`
  after each falsification.
- **Heredocs**: multi-line TypeScript through `bash <<'EOF'` fails
  unpredictably. Write patch scripts to the scratchpad and run them, or use the
  Write tool.
