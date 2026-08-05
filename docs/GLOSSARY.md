# Glossary

Vocabulary used throughout this repository that a new reader cannot decode from
context. Recorded because the terms appear in hundreds of documents, commit
messages, and code comments without ever being defined.

---

## People and roles

| Term | Meaning |
|---|---|
| **Edward** | Edward Shin. Solo developer and product owner of Nexus, at The DPS. **The decision owner for every business disposition** unless a document names someone else. Where a document says "Edward's call" or "per Edward," that is final business authority (tier 1). |
| **Operator** | A DPS staff member who uses Nexus to do their job — PM, Logistics, Purchasing, Accounting. **Not** a developer. "Operator review" means a real operator working the real surface with real data. Under [`NEXUS_IMPLEMENTATION_STANDARD.md` §2](NEXUS_IMPLEMENTATION_STANDARD.md) their findings are **tier 2 authority**, above the design bundle. |
| **PM** | Project Manager. The primary Nexus user — builds quotes, enters costs, negotiates pricing, sends to customers. Most UI copy is written for a PM. |
| **CA** | *Claude Architect.* An AI advisory role that authors briefs, phase specifications, and business-validation analysis. **Does not write production code.** Documents authored by CA are scope and analysis, not implementation. |
| **CC** | *Claude Code.* The AI implementation role. Executes directives, writes production code, runs verification. Files prefixed `cc-` are its communications. |
| **CD** | *Claude Designer.* The AI design role. Produces the numbered design rounds (R1–R12) and the design bundles in [`design-authority/`](design-authority/). |
| **Codex** | A second AI implementation agent used for continuity during a period when the primary implementation agent was unavailable (2026-07 → 2026-08). Responsible for much of the Phase 2 freight worksheet implementation. Its commits are in the mainline history and are not distinguished by convention. |

**Why the AI roles are recorded rather than elided:** the repository contains
roughly sixty `cc-comm-*` files, dozens of CA-authored specifications, and
design bundles credited to CD. A reader who cannot decode the prefixes cannot
tell an advisory document from a binding one. The distinction matters —
**CA-authored briefs are scope contracts, not fidelity contracts**, and CC
communications are historical execution records, not authority.

---

## Project structure

| Term | Meaning |
|---|---|
| **Phase** | The current unit of work — four independently deployable phases, each with its own governing authority and reversibility position. Introduced 2026-08-03. See [`../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md). |
| **Slice** | The **superseded** unit of work — numbered vertical increments, Slices 1–17, used 2026-04 → 2026-07. Where you find slice numbering, read it as historical. See [`AUTHORITY_TIMELINE.md`](AUTHORITY_TIMELINE.md) Era 1. |
| **Slice 13** | Confusingly, **not an implementation slice.** It is the production go-live workstream — parity audit, cutover, training, shadow mode. Tracked in [`slice-13/`](slice-13/). It governs **launch**, not implementation, and runs alongside the phases. |
| **R-round** | A CD design round, numbered R1–R12. Rounds ship prototypes, designer notes, and data-source maps. Later rounds may supersede earlier ones or compose with them — the bundle's `BUNDLE.md` says which. |
| **BV-nnn** | A Business Validation document — an approved business contract. See [`business-validation/`](business-validation/). BV-002 is intentionally unassigned; **BV-009 was cited before it was written and never existed** — see [OD-001](OPEN_DECISIONS.md). |
| **OD-nnn** | An entry in [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) — a question the repository cannot answer for itself. |
| **PB-nnn** | An entry in [`production-bugs/PRODUCTION_BUG_REGISTER.md`](production-bugs/PRODUCTION_BUG_REGISTER.md) — a verified production defect. Closes only with permanent regression evidence. |
| **Pattern nn** | A banked convention in [`../CLAUDE.md`](../CLAUDE.md) — tier 4 platform authority. Patterns are numbered and cited by number in commit messages. |
| **§0.5** | The pre-approval schema/code verification gate. A brief's references are verified against the actual schema *before* approval. See [`../CLAUDE.md`](../CLAUDE.md); the catch ledger records 80 catches across 16 slices. |

---

## Domain

| Term | Meaning |
|---|---|
| **Quote** | The commercial artifact sent to a customer. Has a lifecycle: draft → sent → accepted → complete. A **sent quote is immutable.** |
| **Scenario** | A named alternative version of a quote within a project ("Alt 1", "Alt 2"). In v1, scenarios are denormalized onto `quotes` via `scenario_label`, not a separate table. |
| **Revision** | An in-place new version of the *same* quote. Preserves quote identity. |
| **Clone** | A *separate* quote created from an existing one. New identity, independent lifecycle. |
| **ASY / Assembly** | A composite product that holds child components. Owned by Setup. |
| **LEAF** | A terminal product with no children. Usually anchored to a HubSpot product. Owned by Setup. |
| **Tier** | A quantity break on a quote (e.g. 10k / 25k / 50k units). Pricing and cost are computed per tier. |
| **Turnkey** | The all-in per-unit price a customer pays. |
| **Pass-through / Bundled** | Freight `treatment`. **Presentation, not pricing** — freight is in the commercial calculation either way; the flag controls only what the customer sees. See [BV-009](business-validation/BV-009-freight-treatment.md) ⚠️. |
| **Floor / Target margin** | Two thresholds. **Target** reports when missed. **Floor** is a mandate — below it requires a governed exception (Phase 4). |
| **Pin** | An immutable snapshot of commercial settings taken when a quote is sent, so a sent quote resolves thresholds from its pin rather than live `firm_settings`. Phase 1. |
| **Worksheet** | The Freight business model — Subcategory → Destination Candidates → Quantity Breaks. Mirrors the Straight Forwarding workbook Logistics actually uses. |
| **Straight Forwarding workbook** | The external artifact Logistics uses to determine freight cost. **The external authority for Freight** — Nexus records its determinations rather than re-deriving them. |
| **Item Group** | A NetSuite construct grouping line items on a Sales Order. The only intended Accounting-visible behavioral change in the Nexus rollout. |

---

## Systems

| Term | Meaning |
|---|---|
| **HubSpot** | CRM. Source of deals, companies, and the product catalog. Nexus reads with one token and writes with a separate write-enabled token, so accidental writes are structurally impossible on read paths. |
| **NetSuite** | ERP. **The accounting authority** after a Sales Order is created. NetSuite-derived values never become new commercial authority in Nexus. |
| **Supabase** | Postgres host plus Realtime. **One project serves both dev and production** — a migration applied locally applies to production. |
| **Clerk** | Authentication. |
| **The harness** | The isolated validation subsystem — Docker Postgres, fake providers, deny-by-default networking, deterministic fixtures. Its merge gate is required before merge. See [`validation/`](validation/). |
