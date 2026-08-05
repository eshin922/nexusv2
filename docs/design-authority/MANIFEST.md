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

---

## Relationship to `docs/design-prototypes/`

`docs/design-prototypes/` holds the historical CD rounds 1–9 and their
extraction source. It is **historical context**, not governing authority.

The distinction: a prototype in `design-prototypes/` records what was explored
at a point in time. A bundle in `design-authority/` is currently binding on an
unshipped or in-progress phase. When a design-authority bundle is fully shipped
and its phase closed, it stays here — the record of what was built against
remains authority for interpreting the result.
