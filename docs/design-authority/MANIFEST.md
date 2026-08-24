# Design Authority Manifest

**Status:** Governing. This directory is the authoritative home of every
executable design specification in the project.

Design bundles are **tier 3** authority under
[`../NEXUS_IMPLEMENTATION_STANDARD.md` §2](../NEXUS_IMPLEMENTATION_STANDARD.md).
They are outranked by approved business dispositions (tier 1) and by
operator-reviewed corrections (tier 2), and they outrank existing Nexus
platform conventions (tier 4).

---

## Why this directory exists

Until 2026-08-04 the governing design source for two phases of work consisted
of two untracked ZIP files at the repository root, plus extractions inside
`.artifacts/` — a directory matched by `.gitignore` line 8 and shared with
disposable Next.js build caches.

The consequences were concrete:

- The authority could never be committed, even deliberately, without a
  `.gitignore` change nobody knew was needed
- A routine `.artifacts/` cleanup would have destroyed the tier-3 authority for
  Phase 2 and Phase 3 simultaneously
- `approval-states-design-position.md` — Phase 4's state-model authority, cited
  by name in the Cross-Phase authority map — existed *only* inside that
  disposable directory
- Two separate extractions of the same bundle existed with no mechanism to
  detect divergence between them

A design bundle that can be lost by a cache sweep is not authority. It is a
convenience copy.

---

## What is tracked here, and why each part

| Path | Purpose |
|---|---|
| `_intake/*.zip` | The original archives **exactly as received**. Never edited, never regenerated. The court of last resort if an extracted file is ever questioned. |
| `_intake/SHA256SUMS` | Proves an intake archive has not been swapped or altered. |
| `<bundle>/` | The extracted source: the JSX, CSS, data, and design documents that implementers read. |
| `<bundle>/SHA256SUMS` | Proves the extracted source still matches what was approved. |
| `<bundle>/BUNDLE.md` | The authority record: scope, selected variant, approved deviations, operator-review status, supersession history. |

### Why checksums are here

Not ceremony. Under source-first implementation (standard §9) the extracted
files *are* the specification. A silently edited "canonical" file corrupts the
authority itself, and the corruption would be invisible — the implementation
would match the source, and both would be wrong.

To verify a bundle:

```bash
cd docs/design-authority/<bundle> && sha256sum -c SHA256SUMS
```

A mismatch is not a merge conflict to resolve. It means either the source was
edited in place — which is prohibited — or a new bundle version arrived and was
not recorded as a supersession. Both require a disposition before any
implementation continues.

### Why the original ZIPs are retained

An extraction is a derived artifact. If an extracted file is ever disputed —
"was this always like this?" — the intake archive settles it. Retaining ~134 KB
permanently is cheap relative to being unable to answer that question.

---

## Registered bundles

| Bundle | Governs | Selected variant | Operator review | Record |
|---|---|---|---|---|
| **`freight-1a`** | Phase 2 — Costs Workspace, Freight section | **Option A** | Reviewed; findings open | [BUNDLE.md](freight-1a/BUNDLE.md) |
| **`r12-pricing-workspace`** | Phase 3 — Pricing Workspace; Phase 4 — approval state model | R12 (R10, R11 are lineage) | Not yet implemented | [BUNDLE.md](r12-pricing-workspace/BUNDLE.md) |
| **`customer-view`** | **Quote Presentation / Customer View** — two-pane workspace, four-card rail, finalize footer | `design/Nexus Customer View.dc.html` (reference of record) | Registered 2026-08-24; **implementation not started against it** | [BUNDLE.md](customer-view/BUNDLE.md) |

### `customer-view` — registered two days late, and what that cost

Received 22 August as `nexuscustomerview.zip` and left **untracked at the repository root**
until 24 August — the state this file's opening section describes as the reason the
directory exists.

In those two days Quote Presentation was designed, built, reviewed, reconciled against a
*different* authority, and shipped to production behind a flag, none of it consulting this
bundle. The reconciliation read
[`../quote-presentation-profile-brief.md`](../quote-presentation-profile-brief.md) as
governing the whole rail and removed Commercial recovery from the surface. That brief
describes **Card 2 of four**. The removal was wrong; the deleted card was closer to the real
authority than what replaced it.

Rule 7 below was written from the first instance of this. This is the second, and it is why
rule 6 says an omission here is not a filing error.

**Tier-1 dispositions recorded against this bundle** (full text in its
[BUNDLE.md](customer-view/BUNDLE.md)):

- **D1** — Commercial recovery applies at charge grain to **every governed recoverable
  charge**, superseding `authority-model.md` §1a's freight-only limit. §1a is not otherwise
  weakened, and `refusalFor` still decides which modes are permitted per charge.
- **D2** — the primary action is **`Freeze & send`**, over §4's `Finalize presentation`.
- **D3** — a control may move economics, be governed by Pricing, and live on this surface.
  *"Not a presentation control"* means *not in Card 2* — not *not on the workspace*.
- **D5** — `Approved recovery` **is** the existing governed `recoverableSell`. Card 0
  translates a governed fact into the authority's vocabulary; it does not mint a second
  record. Unknown recovery stays unavailable, never `$0`.
- **D6** — `fingerprintCommercialState` remains the **single** authority for whether an
  approval survives. `setChargeRecovery` warns and predicts; it does not invalidate.
- **D7** — the customer PDF **iframe stays**. The reference of record's page stack and zoom
  stepper are visual intent, not authorization for a second rendering authority.
- **D4** — the bundle's named supersessions apply: the internal ribbon, the `Send as:` pair,
  the boundary-guard paragraph, the old `Detail:` / addendum placement, and the 880px preview
  constraint. Legacy chrome is not preserved merely because it predates the bundle.

## Registered document authorities

Not every governing specification arrives as a bundle. A **design return** is
authored in-repo and governs without shipping JSX or CSS. It is authority on
exactly the same terms and is registered on the same terms — the shape differs,
the standing does not.

| Document | Governs | Approved | Operator review | SHA-256 |
|---|---|---|---|---|
| [`../quote-presentation-profile-brief.md`](../quote-presentation-profile-brief.md) | **Quote Presentation / Customer View** — interaction model, presentation-profile state, SEND freeze boundary, Accounting handoff | PR #326, merged 2026-08-24 | Reviewed 2026-08-24; R5 dispositioned, see below | `86cc8020…4682` |

**R5 disposition — SUPERSEDED 2026-08-24**, the same day, by the `customer-view`
bundle above. It was decided against an incomplete authority: the brief below
describes **Card 2** of a four-card rail, and reading it as governing the whole
surface is what removed Commercial recovery from a workspace the real authority
places it on. See [`customer-view/BUNDLE.md`](customer-view/BUNDLE.md) D1 and D3.

The Layer-2 rule it states remains true **of Card 2**, which is what it was
always about. Retained as the record of what was decided, and why it was wrong:

> `fee_presentation` remains a Layer-2, revenue-neutral presentation decision.
> **If a control can change customer economics, it is not a Quote Presentation
> control.**

~~The commercial recovery election … must be removed from Quote Presentation.~~
**Wrong, and superseded.** Recovery is governed by Pricing *and* elected on this
surface; those are different questions and the bundle answers both. Costs and
Pricing own the governed cost, the recoverable amount, margin policy and
approvals; Customer View owns the bounded election among allowed treatments;
Accounting consumes the frozen result of both. The three concerns are
separate and stay separate: recovery determines *how much* and under what
governed treatment; presentation determines *how that already-established
economics appears*; Accounting consumes the frozen combination of both plus an
explicit instruction about what is embedded versus separately invoiceable.

Full trace: [`../quote-presentation-authority-reconciliation.md`](../quote-presentation-authority-reconciliation.md).

**Why no `_intake` archive or `SHA256SUMS` file.** Those exist to prove an
*extracted* artifact still matches an archive received from outside the
repository. A design return has no outside archive — git history is its
provenance — so the checksum is recorded inline above instead. A mismatch
against `sha256sum docs/quote-presentation-profile-brief.md` means the same
thing it means for a bundle: the authority was edited in place, or a new
version arrived unrecorded. Both require a disposition before implementation
continues.

---

## Rules for this directory

1. **Extracted source is never edited in place.** Local adaptation lives in
   Nexus stylesheets and components, never in the bundle.
2. **A bundle is never partially replaced.** A new version arrives whole, gets
   its own checksums, and its predecessor is marked superseded in `BUNDLE.md`
   with the date and reason. Supersession history is never deleted.
3. **Approved deviations are recorded in `BUNDLE.md`,** not in commit messages,
   not in briefs, not in conversation. An undocumented departure from the
   bundle is drift, not deviation.
4. **Unselected variants are not authority.** Where a bundle ships styles for
   design alternatives that were not chosen, `BUNDLE.md` names the selected
   variant explicitly. Assembling an unselected variant is a fidelity error in
   the opposite direction.
5. **Adding a bundle means adding a `BUNDLE.md` and `SHA256SUMS`.** A bundle
   without an authority record cannot be relied on, because nobody can tell
   what it governs or what was already dispositioned against it.

6. **This file must list EVERY governing specification, bundle or document.**
   It says above that it is the authoritative home of every executable design
   specification. An implementer who checks it is making the correct check, so
   an omission here is not a filing error — it converts the correct check into
   a wrong answer.

   The Quote Presentation authority was absent from this table for three days
   while Quote Presentation was implemented. The implementer checked, found
   `freight-1a` and `r12-pricing-workspace`, concluded no bundle governed the
   surface, and built it from the engine model instead. Nothing overruled the
   authority; it was never reachable.

7. **No registered authority for a surface is a BLOCKER, not a licence to
   invent one.** When work reaches an operator-facing surface and this file
   lists nothing governing it, the correct next action is to **stop and ask**,
   because the two possibilities are indistinguishable from inside the code:

   - no design authority exists yet — and the surface needs one before it is
     built; or
   - one exists and is unregistered, unmerged, or somewhere nobody thought to
     look — which is what happened here.

   Inventing a surface is only correct under the first, and an implementer
   cannot tell which they are in. Pattern 30's standing protocol says the same
   thing one level down: a brief with no `§0 · Fidelity Discipline` section
   must be flagged **before** implementation, not built around.

---

## Relationship to `docs/design-prototypes/`

`docs/design-prototypes/` holds the historical CD rounds 1–9 and their
extraction source. It is **historical context**, not governing authority.

The distinction: a prototype in `design-prototypes/` records what was explored
at a point in time. A bundle in `design-authority/` is currently binding on an
unshipped or in-progress phase. When a design-authority bundle is fully shipped
and its phase closed, it stays here — the record of what was built against
remains authority for interpreting the result.
