# Production / OTC — what remains open after BV-012, BV-013 and Stage 3 A

**Status:** bring-forward. Decides nothing.
**Requested by:** Edward, 2026-08-18 (return to the Production/OTC workstream).
**Source:** the 18 decisions in
[`production-otc-decision-inventory.md`](production-otc-decision-inventory.md)
(#284), less everything since settled, plus what the intervening slices added.

---

## Closed since #284 — do not re-open

| # | Decision | Settled by |
|---|---|---|
| **A2** | Governed markup for Bulk Raw | **BV-013.** `Production`, 40%. The `Raw ingredients → Other → 30%` fallthrough it described is gone. |
| **D1** | Markup per destination, per item type, or one rate | **BV-013.** One `Production` rate for every Production economic. |
| **D2** | Governed markup vocabulary | **BV-013.** `Production` is the authority; `Manufacturing`, `Tooling`, `R&D` and the rest survive as display/non-Production classification. Step 4 disposition: retire nothing. |
| **F4** *(half)* | Do OTC lines join the Item Group's `composition_hash` | **BV-012 Amendment 1 §5.** They do not. The **structural** half of F4 is still open — see below. |
| **C1** *(half)* | Allocation uniform across OTC | **BV-012 Amendment 1 §5.** Allocation does not apply to **Direct Services**. The Item-Group-OTC half is still open. |
| — | What makes a library entry a service; may it be a group member; which Production input each service exposes | **BV-012 §5.f + Stage 3 A.** Closed vocabulary, declarative attachment prohibition, one governed input per identity. |
| — | Ownership of Production economics | **BV-012 + Stage 3 A.** Item Group or Direct Service, XOR, enforced by the database. |

---

## Still open, and what each one blocks

Ordered by what has to be answered before anything else can be.

### 1 · F2 — where are allocation-OFF fees billed? 💰 🏗 **HIGHEST STAKES, AND LIVE**

Unchanged by BV-013 and still the gate. With allocation OFF the fees leave
`requiredSellPerUnit`, therefore `totalRevenue`, therefore the SO amount — while
the customer PDF folds them into the grand total. **The customer is shown a
total the Sales Order does not carry.**

BV-013 did not touch this: it changed the RATE applied to production economics,
not which of them reach the SO. If anything the stakes rose slightly, because
the rate moved 30% → 40% and the allocation-OFF gap scales with it.

**Blocks F1 and C1 both.** It decides whether OTC is an addition to the SO or a
separate billing path, and nothing downstream can be built on a guess about
which.

### 2 · F1 — do OTC destinations become SO lines? 🏗

Today every SO line is a leaf line; production reaches NetSuite embedded in
`requiredSellPerUnit`. Adding OTC lines changes the SO's shape, and REG-4
requires lines to sum exactly to the accepted commercial total.

**Now also constrains Direct Services**, which #293 deliberately blocked from
projecting at all. That block is removed by the slice that answers this — and
by nothing else.

### 3 · F4 — are OTC lines inside or outside the Item Group? 🏗

The `composition_hash` half is settled; the structural half is not. An OTC line
attributed to an Item Group is a group member; one attributed to the quote is
not. Determines the grouping plan's shape.

### 4 · F3 — do the 16 accounting items exist in NetSuite, and who creates them? 🏗

Partly answered in shape but not in substance. #293 built the mapping mechanism
for the **five Direct Service identities** — Settings-owned, resolve-on-save,
blocks on missing. The **other eleven BV-011 destinations have no mapping and
no owner**, and the same design would extend to them cleanly.

Open as an operations question: who creates the NetSuite items, and against
what item type.

### 5 · C1 — does allocation stay uniform across Item Group OTC? 💰

One boolean over four fees today, and quote-wide by V1 disposition. BV-011
spreads OTC across both item types. Per-destination allocation changes unit
cost and therefore sell.

### 6 · C2 — may an Inventory-Item OTC be allocated into unit cost? 💰 🏗

Tooling, Customs and Freight/Duties/Tariffs are Inventory Items in BV-011.
Whether an inventory item's cost may be amortised into another item's unit
cost is an accounting question, not a UI one.

### 7 · C3 — does quote-wide allocation authoring survive C1?

The V1 scope disposition was taken on the uniform model. If allocation becomes
per-destination, "set once for the quote" stops expressing it — and that
authoring surface shipped in #277.

### 8 · B1–B4 — the input/destination gaps 💰 🏗

- **B1** which of the unrepresented destinations get inputs in V1. **Reduced by
  one:** `Testing / Micros` now has a column (migration `0083`), added for
  Direct Services and deliberately **not** surfaced on Item Groups — whether an
  Item Group authors Testing separately is exactly this decision.
- **B2** is `toolingArtworkTotal` split — one input, two BV-011 destinations.
- **B3** what distinguishes `OTC - Customs` from `OTC - Freight, Duties, Tariffs`.
- **B4** are Cartons a re-map or a new input.

### 9 · A1 — does `cmAssemblyTotal` mean `OTC - Packout`? 

A naming question with an accounting answer. Note Stage 3 A already asserts the
equivalence for **Direct Services**: `packout_assembly → cmAssemblyTotal`. If
A1 resolves otherwise, that mapping constant is where it lands.

### 10 · E1–E3 — customer presentation

**E1** which destinations are customer-visible and under what labels; **E2**
grouped or itemised. **E3** remains BV-009's, still unratified.

Presentation rather than accounting, but E1/E2 interact with F2: what the
customer sees and what the SO carries have to be the same decision or the
divergence in F2 recurs under a different name.

---

## Added since #284, not in the original 18

| | | |
|---|---|---|
| **Direct Service SO projection** | 🏗 | #293 blocks it deliberately. Removed only by the slice that certifies it. Depends on F1. |
| **Per-use `Other Service` mapping** | 🏗 | Designed and dispositioned (per line, frozen with the accepted state); **not built**. |
| **Item Group Testing input** | 💰 | The column exists and is unsurfaced. Part of B1. |

---

## What I would settle first, and why

**F2, alone, before anything else is designed.** Every other NetSuite decision
inherits its answer: F1 cannot be specified without knowing whether OTC is an SO
addition or a separate billing path; F4's grouping shape follows F1; C1–C3
change meaning depending on whether allocation-OFF fees are billed at all.

It is also the only one of the eighteen that is **already affecting real
quotes** rather than describing future work — and it is a customer-facing
divergence, which makes leaving it undecided a different kind of cost from
leaving the others undecided.
