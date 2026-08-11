# OD-004 · minimum decision set

**Track B, item 1.** Nothing built. NetSuite administrator not booked.

**The reframe, in one line:** OD-004 asks for a single "applicability datum," but
grouping is two questions, and only one of them is open.

| | question | status |
|---|---|---|
| **Q1** | **Which** lines group together | **Answered.** Structural, already governed, deterministic. No new datum |
| **Q2** | **Whether** an order groups at all | **Open — and the evidence contradicts itself.** This is the real OD-004 |

Prior framing (`cost_category` deciding *"detailed items vs Item Group vs
Assembly"*) treats both as one question and answers it with a merchandising
field. That is why it has never closed.

---

## Q1 — which lines group together. Already answered.

Nexus emits **one Sales Order line per LEAF**, because assemblies do not exist as
NetSuite items — only leaves resolve by SKU match
(`mark-complete.ts`, "FLAT LINES per leaf"). Every emitted line already knows the
assembly it came from (`treeLeaf.assembly`).

**The grouping boundary is the assembly.** A group is the set of leaf lines under
one assembly. That is structural data Nexus owns, present at line-build time,
with no NULLs and no classification involved.

And the identity is already deterministic. `composition_hash` =
SHA-256 over `customerNetsuiteId` + `baseSku` + sorted `members` — sort-agnostic,
so the same composition always produces the same group, and the existing
three-layer find-or-create (local cache → SuiteQL by externalId → create) already
prevents duplicates.

**Consequence: there is no "which lines" datum to invent, at any level.** This
eliminates the leaf-level backfill from consideration entirely — it was never
required to answer this.

---

## Q2 — whether an order groups at all. The real question, with a contradiction.

Two governed sources disagree, and both are load-bearing.

**Source 1 — the code says grouping is universal.**

> *"Aisha's wrap step remains **MANDATORY for anything invoiced**. Flat lines from
> Nexus would expose those components on any customer-facing document."*
> — `mark-complete.ts` STEP 5

Read literally: every invoiced order is grouped, there is no applicability
choice, and **OD-004 needs no datum at all for V1**.

**Source 2 — a governed enum says presentation varies per quote.**

`quotes.detail_level` — PG enum `["itemized", "turnkey_only"]`, where
`turnkey_only` *"drops SKU rows for an all-in figure"*
(`customer-pdf-types.ts`). It is snapshotted at send (`detail_level_snapshot`,
Pattern 52 freeze-list), so it records what the customer was actually shown when
they agreed.

Production population:

| | live `quotes` | snapshots (what customers received) |
|---|---|---|
| `itemized` | 9 | 8 |
| `turnkey_only` | 2 | 1 |
| NULL (→ `itemized`) | 51 | — |

Read literally: **most quotes were sold itemized**, so wrapping them into single
turnkey lines would show the customer an invoice shaped unlike their quote.

### The two cannot both describe the same rule

Either grouping is universal and independent of how the quote was presented, or
it follows the presentation the customer agreed to. **Accounting must say which.**
Nothing in the codebase resolves it, and production cannot: **1** Sales Order has
ever been pushed and **0** Item Groups exist in production.

I lean toward Source 2 — an invoice contradicting the quote's shape is a
commercial problem, and `detail_level` is already frozen at send precisely
because it records a customer-facing commitment. **But that is my inference, not
evidence**, and it is exactly the kind of inference that should not be built on
without Accounting confirming it.

### Merchandising vs fulfilment, stated explicitly

| axis | field | what it answers | population |
|---|---|---|---|
| **Merchandising** | `product_types` (`asy_skincare`, `leaf_primary_packaging`, …) | *What is this product?* | assemblies 42/50; leaves 26/1077 |
| **Commercial presentation** | `quotes.detail_level` | *What did the customer agree to see?* | 11 of 62 set; NULL → `itemized` |
| **Fulfilment / accounting** | — | *How does the order document group?* | **does not exist** |

`cost_category` was a merchandising-shaped answer. Skincare-vs-supplement does
not determine whether an invoice shows one line or five — the same product sells
turnkey to one customer and itemized to another. **This is why OD-004 stalled:
the question was pointed at the wrong axis.**

---

## Decision A — ownership of NetSuite grouping

**A1 (Nexus creates/reuses the Item Group) is not available in V1.** The SO
validator refuses Item Group lines at CREATE via **both** REST and SOAP —
identical `USER_ERROR "Please enter a value for Amount"` — per the exhaustive
probe and CA disposition of 2026-07-28. The UI succeeds because SuiteScript
`N/record` has different interactive-save semantics.

**If A1 is mandatory for V1, Track B contains an external-platform capability
blocker, not a Nexus defect.** No amount of Nexus work closes it. The routes out
are NetSuite-side: a RESTlet wrapping `N/record`, or migration to Assemblies
(proven to work at REST via Probe 4; DPS already has 9 in the catalogue). Both
are v1.1+ scope today.

### Recommended: A2 — Nexus emits, Accounting wraps

**What Nexus must emit and preserve for the manual step to be controlled,
repeatable and auditable.** Six items; five already exist.

| # | what | exists today? |
|---|---|---|
| 1 | **Group membership** — which SO lines belong to which group, by assembly | ✅ structural (`treeLeaf.assembly`); **not currently emitted** |
| 2 | **Group identity** — `composition_hash` + `externalId`, so the same composition is never wrapped twice under two names | ✅ `composition-hash.ts`, deterministic and sort-agnostic |
| 3 | **Member rates** — each leaf's `requiredSellPerUnit` × effective qty | ✅ already on every pushed line |
| 4 | **Turnkey unit price** — the per-unit figure the wrapped line must display | ✅ derivable from the accepted tier rollup |
| 5 | **The invariant** — Σ member amounts = accepted tier `totalRevenue`, which holds *by construction* today | ✅ stated in `mark-complete.ts` |
| 6 | **Confirmation the wrap happened**, recorded against the quote | ❌ **absent — the one real gap** |

**Item 6 is the V1 control gap in A2.** Today, after push, Nexus has no record of
whether the manual grouping occurred. "Grouping performed" is unverifiable, so a
missed wrap surfaces on a customer's invoice rather than in the system. That is
the same shape as the Track A finding: a mandatory step with no evidence it was
taken.

Item 1 is a small emission (the group plan already exists implicitly). Item 6 is
a decision about whether Accounting confirms back into Nexus.

---

## Decision C — where classification lives, if anything new is needed

**Only if Q2 resolves to "it varies."** If it resolves to "universal," no new
datum exists to place.

Smallest viable authorities, compared:

| authority | rows to govern | population | fit |
|---|---|---|---|
| **`quotes.detail_level`** (reuse) | 0 new — exists | 11 set, 51 NULL→`itemized` | **Best.** Already governed, already frozen at send, already the customer-facing commitment. Cost is confirming the semantic, not building |
| **New quote-level column** | 62 quotes | — | Honest if `detail_level` is genuinely a *PDF* axis and Accounting wants grouping decided separately. Needs an owner, a default, and a per-quote rule |
| **Assembly-level** (`assemblies`, 50 rows) | 50 | 84 % typed | Viable if grouping varies *within* one quote. No evidence yet that it does |
| ~~Leaf-level~~ | ~~1077~~ | ~~2.4 %~~ | **Excluded.** Q1 removes the need, and a 1051-row backfill was never justified |

---

## The five returns

**1 · Minimum data to execute the grouping decision**

- *Which lines:* the assembly boundary — **exists, deterministic, no gap.**
- *Whether to group:* **one bit, at quote level.** Either already carried by
  `detail_level` or requiring one new quote-level value. Not per-leaf, not
  per-product-type.
- *To execute the wrap:* group identity, membership, member rates, turnkey unit
  price — **all four exist.**

**2 · Where it exists today**

Everything except two things: the **whether** bit (contested between two
sources), and **confirmation the wrap occurred** (nowhere).

**3 · True business gaps vs naming/schema drift**

| | |
|---|---|
| **Naming / schema drift** | `cost_category` — never existed, wrong axis anyway. The leaf `product_type_id` 2.4 % figure — real, but **irrelevant** once Q1 is answered structurally |
| **True business gaps** | **(i)** Does grouping follow quote presentation or apply universally? **(ii)** Must Accounting confirm the wrap back into Nexus? Both are decisions, not missing fields |

**4 · Recommended V1 disposition**

> **OD-004 closes as: A2, with grouping determined at quote level, and no new
> classification datum in V1.**
>
> Contingent on Accounting answering Q2. If "universal," OD-004 closes with
> *no datum* — the applicability question dissolves. If "follows the quote,"
> it closes on `detail_level`, which is already governed and frozen at send.
>
> Either way, **no leaf backfill, no `cost_category`, no new taxonomy.**
>
> Separately recommended: close the item-6 audit gap, since A2 makes a manual
> step load-bearing for customer-facing correctness.

**5 · Exact REG-4 change if grouping is manual post-push**

Current wording requires evidence Nexus cannot produce:

> *"Applicable completion creates **or reuses one deterministic group**, uses it
> once, and preserves the accepted commercial total."*

Nexus cannot create-or-use a group on a Sales Order via any supported path, so
this is unprovable by any walk while A1 remains closed. Proposed replacement:

> **REG-4 (revised).** Applicable completion pushes Sales Order lines whose
> amounts **sum exactly to the accepted commercial total**, and emits a
> **deterministic grouping plan** — group `externalId` derived from
> `composition_hash`, its member lines, member rates, and the turnkey unit price
> — sufficient for NetSuite Ops to perform the grouping without re-deriving any
> commercial figure. The walk records the plan emitted, the grouping performed,
> and a read-back proving the invoiced total equals the accepted total.
>
> **Item Group creation by Nexus is out of V1 scope** — an external-platform
> capability limitation (REST and SOAP both refuse at CREATE), carried as v1.1+
> via RESTlet or Assembly migration.

This keeps REG-4's real commitment — *the accepted commercial total survives the
handoff* — and drops only the mechanism Nexus cannot perform.

---

## What is needed to proceed

**One answer: Q2.** Does grouping follow the quote's agreed presentation, or
apply to everything invoiced?

Everything else follows. Until it is answered, the NetSuite administrator stays
unbooked — as instructed, and because the walk's scope depends on this answer.
