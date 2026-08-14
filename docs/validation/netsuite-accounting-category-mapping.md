# Nexus → NetSuite category-mapping contract

**Status:** authoritative business input recorded 2026-08-14. Implementation
AUTHORIZED for the resolved set; three categories explicitly unresolved.

**Slice boundary.** This is a separate V1 Accounting/NetSuite slice. It does NOT
fold into #265/#266 and does not wait for their visual acceptance — the two can
proceed in parallel.

---

## 1 · The mapping, as supplied by Accounting

Recorded verbatim. This document is the authority; the projection is built from
it, not from anything inferred at the surface.

### Finished-good component / item — UNRESOLVED

| Nexus category | Projection | NetSuite item |
|---|---|---|
| Filling / Blending | finished-good component/item | **UNRESOLVED** |
| CM Assembly / Pack-out | finished-good component/item | **UNRESOLVED** |
| Bulk Raw | finished-good component/item | **UNRESOLVED** |

### OTC / service — RESOLVED to a name, pending internal Item ID

| Nexus category | NetSuite item |
|---|---|
| Freight, Duties, Tariffs | `OTC - Freight, Duties, Tariffs` |
| Customs | `OTC - Customs` |
| Setup | `OTC - Setup` |
| Artwork | `OTC - Artwork` |
| Tooling | `OTC - Tooling` |
| R&D / Formulation | `OTC - Formulation` |
| Testing / Micros | `OTC - Testing` |
| Other Service | `OTC - Other Service` |
| Emboss/Deboss/Foil/Cutting Die | `OTC - Dies` |
| Printing Plates | `OTC - Print Plates` |
| Samples/PPS | `OTC - Samples` |
| Processing Fee | `OTC - Processing Fee` |
| Cartons | `OTC - Cartons` |

---

## 2 · Governing constraints

**Do not implement from display-name inference.** The projection pins to stable
NetSuite internal Item IDs. A display name is a label an admin can edit; keying
a governed financial projection to it means an unrelated rename silently
reprojects the Sales Order. Resolving the internal IDs for the named OTC SKUs is
therefore implementation work in this slice, not a prerequisite handed over from
Accounting.

**The three unresolved categories are represented explicitly as unresolved.**
Not inferred, not temporarily mapped to a neighbouring category, not given an
OTC item as a placeholder. A placeholder that projects successfully is
indistinguishable from a real mapping at the point it reaches Accounting, which
is the wrong place to discover it.

**Fail closed.** A NetSuite push that encounters an unresolved mapping refuses,
with an operator-readable readiness/refusal stating that the Accounting mapping
is pending for the named category. It does not push a partial order and it does
not substitute.

**The resolved set is not blocked by the unresolved set.** Wire what is
unambiguous now; add the remaining three when Accounting returns them, with
targeted certification for those cases only.

---

## 3 · Open business questions

Neither blocks wiring the mappings whose behaviour is already unambiguous —
unless the implementation turns out to actually depend on one, in which case
that dependency is surfaced rather than assumed away.

1. **`Cartons → OTC - Cartons`** — confirm this is intentionally an OTC/service
   projection. Cartons read as a physical good, so the OTC treatment is worth
   confirming rather than inferring; if it is deliberate, the confirmation is
   what stops a future reader "correcting" it.
2. **Repeated charges within one category** — do they remain separate SO lines,
   or consolidate by category? This one MAY be load-bearing: it determines
   whether the projection is a per-charge map or a per-category aggregation, and
   those are different functions. Resolve before building the projection shape
   for any category that can legitimately occur more than once.

---

## 4 · Definition of done

- Governed deterministic projection, pinned to internal Item IDs.
- Unresolved categories modelled as a first-class state, with a fail-closed push
  and operator-readable refusal copy.
- Resulting Sales Order lines certified against NetSuite — not asserted from the
  payload. The payload is what we sent; the certification is what NetSuite made
  of it, and the two have diverged before (Item Group member rates).
- Targeted certification re-run per category as the remaining three land.
