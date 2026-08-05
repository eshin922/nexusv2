# BV-009 — Freight Treatment

## Status

> ## ⚠️ RECONSTRUCTION — NOT RATIFIED
>
> **This document is not an approval record.** It is a provenance
> reconstruction assembled on 2026-08-04 from citations that already exist in
> the repository.
>
> **The original BV-009 has never existed as a document.** Verified against the
> complete history of every branch — see [Provenance](#provenance).
>
> The statements in [§Reconstructed contract](#reconstructed-contract) are
> quoted verbatim from documents that cite BV-009 as authority. **Nothing here
> is inferred, paraphrased, or filled in.** Where the citations are silent, this
> document is silent.
>
> **This document must be ratified, amended, or rejected by Edward before it is
> treated as business authority.** Tracked as
> [OD-001](../OPEN_DECISIONS.md).

---

## Why this document exists in an unratified state

BV-009 is cited as governing business authority in **eleven places across five
files**, including production code where it justifies a customer-facing
behaviour that has already shipped.

Leaving it absent had two costs. An engineer following a citation reached
nothing and could not tell whether the rule existed, was lost, or was never
written. And a business rule was being enforced in production with no
verifiable statement of what the rule was.

Creating it silently, as though it were the original, would have been worse —
it would have converted a reconstruction into apparent authority, which is the
exact failure this remediation exists to prevent.

So it is written, marked, and left explicitly unratified.

---

## Provenance

### The document never existed

| Probe | Result |
|---|---|
| `git log --all --diff-filter=A -- "*BV-009*"` | No file ever added, under any name variant |
| `git log --all --diff-filter=A -- docs/business-validation/*` | Exactly nine files ever created: BV-001, 003, 004, 005, 006, 007, 008, README, PRODUCTION_READINESS_REGISTER |
| `git log --all --grep="BV-009"` | No commit message reference |
| `git stash list` | Two stashes, neither related |

BV-002 is documented as intentionally unassigned. BV-009 is not — it is cited
as though it exists.

### When the identifier first appeared

| Commit | Timestamp | Subject |
|---|---|---|
| `6ff8a09` | 2026-08-03 **12:41:08** −0700 | `docs(phase-1): freeze quote integrity execution contract` |
| `cd35d57` | 2026-08-03 **13:12:09** −0700 | `fix(pdf): suppress bundled freight line` |

The identifier enters the repository already-cited, with no backing document.
**Thirty-one minutes later, production code changed on its authority.**

### Every citation

| Location | Line(s) |
|---|---|
| [`PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md`](../../PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md) | 81, 124, 235, 301, 317, 341, 347 |
| [`CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md) | 14 |
| [`PHASE-2-COSTS-WORKSPACE-MULTI-SKU.md`](../../PHASE-2-COSTS-WORKSPACE-MULTI-SKU.md) | 63 |
| [`PHASE-3-PRICING-WORKSPACE.md`](../../PHASE-3-PRICING-WORKSPACE.md) | 119 |
| [`src/lib/customer-view-resolver.ts`](../../src/lib/customer-view-resolver.ts#L368) | 368 — **production code** |

---

## Reconstructed contract

Every statement below is quoted verbatim from a document citing BV-009. The
source is given for each. **No statement has been added.**

### C1 · Pass-through is presentation, not pricing

> Pass-through is presentation, not pricing. Freight remains part of the
> commercial calculation and may carry markup. The flag controls only how the
> customer sees it.

— `PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md:124–127`, block-quoted there as the
statement of BV-009

Summarised in the same document's Business Authority table (line 81) as:
*"Pass-through is presentation, not pricing."*

### C2 · Nexus records; it does not allocate

> Nexus records Logistics' manually determined component freight cost; Nexus
> does not allocate or spread freight.

— `PHASE-2-COSTS-WORKSPACE-MULTI-SKU.md:63`, Business Authority table

This is the freight-specific instance of the governing principle in
[`NEXUS_IMPLEMENTATION_STANDARD.md` §1](../NEXUS_IMPLEMENTATION_STANDARD.md).

### C3 · The pricing engine is correct as built

> Any change to the pricing arithmetic. **BV-009 confirms the engine is
> correct.**

— `PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md:347`, listed as explicitly out of scope

> Any change to costing arithmetic. **BV-009 confirms the engine is correct.**

— `PHASE-3-PRICING-WORKSPACE.md:119`

**Consequence:** BV-009 is cited to place costing arithmetic *out of scope* for
two phases. If the reconstruction is wrong on this point, both phases were
scoped against a rule that may not exist.

### C4 · Freight is in the unit price; "not included" is false

> Per BV-009, freight is in the unit price. **"Not included" is false**, and it
> is the only user-visible incorrectness this phase touches.

— `PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md:301`

> **Per BV-009 the arithmetic is correct and the wording is wrong.**

— `PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md:235`

### C5 · Informational, not additive

Phase 1 posed the question directly: if freight is in the unit price *and*
shown as a line, what is the line for?

> - **Informational:** *"your unit price includes $0.35 of freight."* A
>   disclosure explaining part of the total. The total is unchanged.
> - **Additive:** the line is a charge, and the displayed unit price should
>   *exclude* freight, with the total adding them back.
>
> **The first is consistent with BV-009. The second reintroduces the divergence
> in the opposite direction.**

— `PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md:311–317`

The resolution recorded at line 341 is *"the only reading consistent with
BV-009."*

---

## What was implemented on this authority

`cd35d57` — *fix(pdf): suppress bundled freight line* —
[`src/lib/customer-view-resolver.ts:368`](../../src/lib/customer-view-resolver.ts#L368):

```ts
// BV-009: freight remains in commercial costing. When bundled into unit
// price it has no separate customer-facing line, avoiding double signaling.
const freightLines: [] = [];
```

When freight is bundled, the customer sees **no separate freight line**.
Freight is inside the unit price; a line as well would signal the cost twice.

This is live in the customer-facing projection.

---

## What this reconstruction does not cover

Stated explicitly so a reader does not mistake silence for scope.

- **Pass-through treatment's customer presentation.** C1 says the flag controls
  how the customer sees it; the citations never state what pass-through
  *renders*. Only the bundled case is evidenced.
- **Markup authority.** C1 says freight "may carry markup". Which markup, owned
  by whom, is not in the citations. Phase 2 line 64 treats freight markup as
  "one Quote-owned commercial value" — but attributes that to *Freight markup
  authority*, a separate row, not to BV-009.
- **Duty and tariff.** No citation places customs under BV-009.
- **Any statement about allocation beyond C2.**

If the original contract covered any of these, that coverage is **currently
unenforced**, because no document carries it.

---

## Ratification

| | |
|---|---|
| **Decision owner** | Edward |
| **Tracked as** | [OD-001](../OPEN_DECISIONS.md) |
| **Question** | Is the reconstruction an accurate and complete statement of what was approved as BV-009? |

**On ratification:** replace this status block with `**Approved governing
business contract.**`, note the ratification date, and record in
[`../AUTHORITY_TIMELINE.md`](../AUTHORITY_TIMELINE.md) that the document was
reconstructed rather than original. The reconstruction provenance stays — a
future reader should be able to tell that this document was rebuilt from
citations.

**On amendment:** add the missing statements, keeping the verbatim quotations
distinguishable from newly-supplied text.

**On rejection:** every citation listed above becomes suspect, including the
shipped PDF suppression, and each needs re-derivation from a real authority.
