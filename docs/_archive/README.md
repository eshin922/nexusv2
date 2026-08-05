# Archive

Documents here describe **superseded models**. They are retained as history and
are **not valid implementation references**.

## Why archive rather than delete

A deleted document leaves a dangling citation and no explanation. Someone
following an old reference — from a commit message, a code comment, or another
document — arrives at nothing and cannot tell whether the rule was abandoned,
moved, or lost. That ambiguity is the exact failure BV-009 demonstrates: see
[`../business-validation/BV-009-freight-treatment.md`](../business-validation/BV-009-freight-treatment.md).

A deleted document also loses the record of what was *rejected*. Knowing which
approaches were tried and failed is what prevents re-proposing them.

## Why archive rather than mark in place

Marking in place is the default, and most superseded documents stay where they
are with a header — see [`../AUTHORITY_MAP.md`](../AUTHORITY_MAP.md).

A document is moved here when it is **actively contradictory**: when following
it would produce work that violates a current governing rule. Stale is
tolerable in place. Contradictory is not — the physical move is a second signal
for a reader who skims past headers.

## Contents

| Document | Superseded by | Why it is contradictory, not merely stale |
|---|---|---|
| [`CUSTOMS_AND_FREIGHT.md`](CUSTOMS_AND_FREIGHT.md) | Freight worksheet model, Phase 2, 2026-08 | Documents CBM-proportional freight allocation. An implementer following it would allocate freight across components, violating [Standard §1 and §5](../NEXUS_IMPLEMENTATION_STANDARD.md) |

## Rules

- Every archived document carries a header block naming its supersession date,
  what replaced it, and what would go wrong if it were followed.
- Archived documents are **not edited** beyond that header. Their content stays
  as it was.
- Archiving is recorded in [`../AUTHORITY_MAP.md`](../AUTHORITY_MAP.md) and, if
  it reflects a change in method or business model, in
  [`../AUTHORITY_TIMELINE.md`](../AUTHORITY_TIMELINE.md).
