# #557 — proposed application checks

**Status: PROPOSED. Requires Edward's approval before any run.**
Author: CC, 2026-09-09.

Restoring the harness (#558) and certifying #557 are separate outcomes. #558
made these checks *possible*; nothing below is claimed as done.

## The exact revisions to test, and why they cannot be separated

| | revision | why it must be in |
|---|---|---|
| base | `main` @ `1e2a723` | |
| + | **#558** `83f39c0` | without it the harness cannot seed at all |
| + | **#556** `fb71624` | #557's quote-host chrome sits on the legacy-branch removal; without it the notice renders inside a layout no operator receives |
| + | **#557** `80535c1` | the change under test |

Composed in that order onto a throwaway integration branch —
`verify/customer-terms-authority` — which is **built for the run and never
merged**. Its only purpose is to make the four-way combination observable in
one place, because none of the three PRs can be exercised alone:

- #557 alone cannot seed (needs #558) and renders the retired layout (needs
  #556);
- #558 alone has no customer-mapping route — the `/admin/netsuite-customer-map`
  404 in the #558 evidence is exactly this, and is expected;
- #556 alone has neither.

Each PR still merges on its own review. The integration branch is a
measurement fixture, not a merge path.

## Fixture work these checks require

Harness-only. No production change, no schema change.

1. **A second HubSpot company with NO `netsuite_customer_map` row**, carrying
   its own project and draft quote. Today `world.ts` seeds one company
   (`validation_hs_company_<runId>`) and maps it, and BOTH fixture families —
   the base world and the operator worksheets — point at it. So every seeded
   quote resolves `governed`, and the unmapped half of this change is not
   representable. Without this the checks cannot fail in the direction that
   matters.
2. **A third company mapped to a customer whose fake terms differ**, so "each
   customer keeps its own term" is distinguishable from "one value is printed
   everywhere". Optional but cheap, and it is the assertion the original defect
   was about.

## An assertion trap, named before it is written

The seeded firm default is **`Validation Net 30`**. The fake governed term is
**`Net 30`**. The second is a SUBSTRING of the first.

So `body.includes("Net 30")` passes whether the page printed the governed term
or the unverified firm default — a check that cannot express the failure it
exists to exclude. **Every terms assertion compares the exact rendered string**,
and the provisional case asserts the em-dash plus the absence of the firm
default, not merely the presence of something.

Changing one of the two fixture strings so they no longer overlap would also
work and is the cheaper guard. Recommended.

## A · Mapped and unmapped terms, preview and PDF

| | check | expected |
|---|---|---|
| A1 | mapped draft, preview | terms line is exactly the governed term; no unverified notice |
| A2 | unmapped draft, preview | terms line is `—`; operator notice present, reason `no_lineage`; the firm default appears NOWHERE as a term |
| A3 | both, customer PDF route | mapped carries the governed term; unmapped carries an empty terms value — the artifact never asserts an unauthorised commitment |
| A4 | sent quote | renders its frozen snapshot unchanged, regardless of the customer's current record |
| A5 | two mapped customers with different terms | each prints its own; neither prints the firm default |

A3 is the one that matters most: it is the customer-facing artifact, and it is
the surface the first pass of this work missed entirely because the projection
sits on the composition seam rather than in the render tree.

## B · Admin mapping search and save

| | check | expected |
|---|---|---|
| B1 | admin opens the page | unmapped company sorted first; mapped row shows internal id and verified date |
| B2 | search matching two candidates | both listed with entity id and active state; nothing auto-selected; the multi-match sentence shown |
| B3 | save a chosen candidate | row written, `verified_at` set, audit `netsuite_customer_map_created`, list reflects it |
| B4 | re-open the previously unmapped quote | preview now shows the governed term, and the operator notice is gone |
| B5 | save when the fake cannot read the customer (`customer-missing`) | refused; NO row written; no `verified_at` stamped on anything |

**B4 is the check worth having.** It closes the loop the defect opened — an
unmapped customer that an operator can map, after which the quote prints a
governed term — and it is the only one that proves the two halves of #557 are
connected rather than merely both present.

## C · PM access restrictions

| | check | expected |
|---|---|---|
| C1 | PM requests `/admin/netsuite-customer-map` | redirected, not rendered |
| C2 | PM invokes the mapping actions directly | `FORBIDDEN`; no row written |
| C3 | admin, same routes and actions | permitted |

C2 is separate from C1 deliberately: the page guard and the action guard are
different boundaries, and a saved page DOM carries action ids. C3 is what makes
C1 and C2 evidence of a RULE rather than of a broken page.

## D · Outage and error recovery

Driven by `NEXUS_FAKE_NETSUITE_SCENARIO`, which already exists.

| | scenario | expected |
|---|---|---|
| D1 | `search-unavailable` | panel says the search could not run; visibly distinct from "ran and matched nothing"; never presented as the customer being absent |
| D2 | `customer-missing` at save | error rendered INSIDE the panel; panel stays open; retry issues a second request and can succeed |
| D3 | `customer-terms-read-fails` on a MAPPED quote | preview shows the transient copy (`netsuite_unavailable`), NOT the unmapped copy — an admin must not be sent to create a mapping that already exists |
| D4 | Send on an unmapped quote | fails closed, with the operator sentence naming what to do |

D3 and D4 are the two that protect real decisions: one prevents a duplicate
customer being created, the other is the finalization guard #557 was required
to preserve.

## E · Cross-panel races

Already covered by the 14 mounted cases, which are the AUTHORITATIVE evidence:
they drive the real component deterministically, and the reported search defect
was found there and nowhere else.

At integration level, repeat only the one that touches the server under real
latency:

| | check | expected |
|---|---|---|
| E1 | save A, switch to B, let A resolve | B's panel stays open AND B can still search and save |

Browser-level race checks are timing-dependent, so E1 is **corroboration, not
primary evidence**. If it disagrees with the mounted tests, the mounted tests
are more likely right and the disagreement is itself the finding.

## What a green run would and would not establish

**Would:** that the mapped and unmapped paths render correctly across preview,
PDF and Sales Order tab; that an operator can close a mapping gap end to end;
that the access rules hold in both directions; that failure and outage paths
stay distinguishable; that the finalization guard holds.

**Would NOT:** anything about production NetSuite — the harness NetSuite is a
fake, and these checks exercise Nexus's handling of its answers, not NetSuite's
answers. Nor anything about the DRSQ mapping, which stays a separate,
unapproved production data action. Nor the real preview origin.

Stated because a green population reads as broader than its dimensions, and the
gap between "the fake said Net 30 and we printed Net 30" and "this customer's
governed terms are correct" is exactly where that misreading would land.
