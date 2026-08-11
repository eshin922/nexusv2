# OD-004 · Item Group applicability datum — opening analysis

**Track B, first item.** Opened 2026-08-11 immediately after the Track A merge
disposition, per the board's sequencing rule: OD-004 is *an input, not a
measurement*, so the NetSuite walk cannot be scheduled before it exists.

**Owner: Accounting / Operations.** Nothing here decides it. This establishes
what the estate can and cannot supply, so the decision is taken against facts
rather than against an assumed shape.

**Three findings below change the question OD-004 is currently asking.** They
should be read before any datum is designed, and certainly before a NetSuite
administrator's time is booked.

---

## Finding 1 — one of the three options is not reachable by Nexus today

OD-004 asks which datum selects between **detailed items**, **Item Group**, and
**finished-good Assembly**. But the Item Group branch is closed at the API, and
has been since a CA disposition on 2026-07-28 following an exhaustive REST and
SOAP probe:

> NetSuite's SO validator refuses Item Group lines at CREATE via **both** REST
> and SOAP — identical `USER_ERROR "Please enter a value for Amount"`. The UI's
> `record.create` uses SuiteScript's `N/record` with different interactive-save
> semantics; that is why the manual flow works and the API path is closed.
>
> — `src/lib/netsuite/mark-complete.ts`, STEP 5, *"DELIBERATELY NOT INVOKED"*

So today the grouping is performed **manually in the NetSuite UI after the
push**, and that step is marked mandatory for anything invoiced — because the
group is what makes the customer's invoice show one turnkey line instead of
exposing freight, customs and setup separately.

**Why this changes the question.** As written, OD-004 asks Accounting to choose
between three paths, one of which Nexus cannot take. Either:

| reading | what OD-004 becomes |
|---|---|
| **(a) Item Group is not a Nexus decision at all** | It is a manual post-push wrap performed on every invoiced order. OD-004 collapses to a **two-way** datum: detailed items vs finished-good Assembly. Simplest, and matches what actually happens today |
| **(b) OD-004 stays three-way** | Then it is **gated on reopening the Item Group path** — Assembly migration or a RESTlet — which UX_BACKLOG carries as v1.1+. A datum decided now would select a branch that cannot execute |

**This is Accounting's call, not engineering's**, because it turns on whether the
manual wrap is acceptable as standing procedure or is itself the thing being
retired.

### Consequence for REG-4, which is the reason to raise it now

The board requires the walk to show that *"applicable completion creates or
reuses one deterministic group, uses it once, and preserves the accepted
commercial total."* **Nexus cannot create-and-use a group on a Sales Order via
the API**, so a walk scheduled today cannot produce that evidence. The walk needs
a NetSuite administrator — a person whose time has to be booked — and would
arrive unable to answer one of the four blockers it exists to close.

---

## Finding 2 — the datum most of the codebase reaches for does not exist

`cost_category` appears throughout the schema commentary as the field that
distinguishes a formulation from a kit from a finished-good bundle:

> *"Whether an assembly represents a 'formulation', 'kit', 'gift set', or
> finished-goods bundle is captured by `cost_category` (Slice 9), **not** by
> `sku_role`."* — `src/db/schema.ts` §Assembly rules

**It is a comment, not a column.** Verified against the live schema: there is no
`cost_category`, and no column matching `%categor%`, `%item_group%` or
`%turnkey%` on `assemblies`, `leaves` or `quotes`. It has been a Slice 9 /
HubSpot `hs_product_type` deferral throughout, and Slice 9 shipped without it.

This is the Pattern 22 shape applied to an open decision rather than a brief: the
question assumes a datum whose existence has never been checked.

### What does exist

`product_types` — 17 rows, deliberately split by role:

| prefix | count | examples |
|---|---|---|
| `asy_*` | 9 | Skincare · Supplement (oral) · Color cosmetics · Beverage · Pet care |
| `leaf_*` | 8 | Primary packaging · Secondary packaging · Service / labor · Soft goods |

The `asy_*` set classifies **what the finished product is**. The `leaf_*` set
classifies **what role a component plays**. Neither was designed to answer *"does
this order ship as detailed items, a group, or an assembly"* — that is a
**fulfilment/invoicing** question, and product type is a **merchandising**
classification. They may correlate; correlation is not the datum.

---

## Finding 3 — the leaf-level classification is effectively unpopulated

Measured on the shared database, 2026-08-11:

| table | rows | carrying `product_type_id` | |
|---|---|---|---|
| `assemblies` | 50 | **42** | 84 % |
| `leaves` | 1077 | **26** | **2.4 %** |

A datum keyed on assembly product type would read a mostly-populated field. **A
datum keyed on leaf product type would read NULL 97.6 % of the time.**

This is a data-readiness input, separate from the decision itself — but it
determines whether a chosen datum can be applied to existing quotes on day one or
requires a backfill campaign across a thousand library rows first. If the answer
is "backfill," that work belongs on the board with an owner, not discovered
during the walk.

### Also worth stating plainly

- `netsuite_item_groups`: **0 rows in production.** The find-or-create path has
  never executed outside the sandbox smoke.
- `netsuite_so_pushes`: **1 row.** One Sales Order has been pushed from Nexus.

The Item Group machinery is real, tested against sandbox, and has never been used
against production. That is consistent with Finding 1 rather than surprising.

---

## What Accounting / Operations must decide

1. **Is Item Group a Nexus decision, or a standing manual post-push step?**
   (Finding 1.) This determines whether OD-004 is two-way or three-way, and
   whether Track B's walk can close REG-4 at all as currently specified.

2. **What business value determines the path?** Given `cost_category` does not
   exist, the realistic candidates are:
   - **an existing HubSpot field** — needs naming, then verifying it is populated;
   - **assembly `product_type_id`** — exists, 84 % populated, but is a
     merchandising classification being asked a fulfilment question;
   - **a new explicit column** — honest, and requires an owner, a default for 50
     existing assemblies, and a rule for who sets it per quote;
   - **the deal's own commercial shape** (turnkey vs component sale), if that is
     already recorded somewhere Accounting trusts.

3. **If the datum reads a leaf-level field, who backfills 1051 leaves, and when?**
   (Finding 3.)

**The standing constraint applies whatever is chosen:** a `$0.00` upstream
catalogue price can satisfy NetSuite validation but **must never become the
commercial transaction price.**

---

## Recommendation on sequencing — engineering's view, not a decision

**Do not book the NetSuite administrator yet.** The walk is the expensive,
person-dependent step, and Finding 1 means it would currently arrive unable to
answer REG-4. Settling question 1 first costs a conversation; discovering it
mid-walk costs the walk.

OD-005, REG-3, P1-011 and SPEC-020 are all measurements that the same walk can
still produce, so the walk is not wasted — but its scope should be agreed with
Finding 1 settled, so it is booked once for what it can actually prove.
