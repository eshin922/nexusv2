# Finding · the governed margin counts revenue the document cannot bill

**Status: INVESTIGATED. Recommendation below awaits disposition.**
**No formula changed. No code changed.**

Raised as a parked item during #416/#417; investigated 2026-08-25 on Edward's
direction to establish the consumers before touching anything.

## The mechanism, traced

Two subsystems answer "is this charge billed?" from different places, and they
disagree for exactly one shape of charge.

**The engine** (`commercial-recovery/construct.ts:467`) counts any non-absorbed
placement as revenue:

```ts
revenueContribution: placement === "absorbed" ? 0 : e.recoverableSell,
```

**The customer document** (`commercial-projection.ts`) keys one-time lines per
ASSEMBLY — `otc:${assemblyId}:${field}` — and skips a charge with no assembly:

```ts
if (!assemblyId) continue;   // a Direct Service's production is its own unit line
```

A Direct Service leaf has no parent assembly. Place its charge `separate_line`
and the engine adds `recoverableSell` to `totalRevenue`, while the document
emits no line and the customer is asked for nothing. `blendedMarginPct` is then
`(totalRevenue − totalCost) / totalRevenue` over a numerator and denominator
that both include money nobody will pay, so the margin reads HIGHER than the
quote's real economics.

This is the Pattern 50 shape — two compliance bases for one question — and the
intersection is its own state rather than either side's default.

## Live exposure: none, today

Measured rather than assumed. The whole estate contains **two** `separate_line`
elections:

| Quote | Status | Charge | Unbillable placements |
|---|---|---|---|
| `4781e4bb` ZZ-VALIDATION-pricing-authority | draft | `tooling` | **0** |
| `52bd0077` ZZ-VALIDATION-tier-propagation | accepted | `project_setup` | **0** |

`findUnbillablePlacements` returns empty for both, and their margins are
identical whether computed on total or billable-only revenue. The instances
originally recorded on `4781e4bb` ($1,727.60 / $3,283.00 / $172.20 / $1,727.60)
have since been resolved.

So the defect is **latent, not live**:

- creating a new one is refused (`DIRECT_SERVICE_NOT_SEPARATELY_BILLABLE`, #416)
- any surviving pre-refusal state is surfaced in the Finalize pre-flight (#417)
- the send gate refuses the state outright
  (`requireNoUnbillableRecoveryToSend`)

Nothing is mispriced in production right now. What remains is that IF such a
state exists — by an unmigrated row, a future write path, or a route the
refusal does not cover — the margin displays as if it were sound.

## The sharper problem: one page, two claims about the same money

The Pricing surface's Price Build ALREADY separates it. `detail-zone.tsx:546`
renders a band labelled:

> **Not billable** · invalid placement · excluded from the totals above

That is true of the Price Build totals — the engine emits `unbillable-recovery`
as its own graph node, "summed into nothing". It is **not** true of the margin
verdict on the same surface, which is computed from `totalRevenue` with the
amount included.

So an operator can read, in one view, that the money is excluded and a margin
that includes it. That inconsistency exists today, independently of whatever is
decided below.

## Consumers of the affected values

`blendedMarginPct` / `blendedMarginStatus`, classified by what they do with it.
The distinction matters: a display reading high is a misinformed operator, a
GATE reading high is an unsound decision.

**Gates — decide whether an action may proceed**

- `lib/below-floor-send-gate.ts` — refuses the send
- `lib/below-floor-authorization.ts`, `actions/below-floor-authorization.ts`,
  `actions/below-floor-approval-request.ts` — authorization records
- `actions/quotes.ts` — the acceptance verdict guard, and `sendQuote`
- `lib/netsuite/mark-complete.ts` — completion

**Displays — operator-facing verdicts**

- Pricing: `verdict-band.tsx`, `pricing-classifier-context.tsx`,
  `pricing-surface-shell.tsx`, `lines-requiring-review.tsx`,
  `request-override-modal.tsx`
- Costs: `cost-stack-header.tsx`
- Quote umbrella: `tab-send-to-client.tsx`, `tab-mark-accepted.tsx`,
  `tab-sales-order.tsx`
- Mark-accepted family: `margin-verdict.tsx`, `mark-accepted-*.tsx`,
  `override-modal.tsx`
- Card 1 / rail: `customer-view-rail.tsx`, `card-commercial-recovery.tsx`
- Admin: `firm-settings-form.tsx`

**Engines — derive further decisions**

- `lib/pricing-suggestions.ts`, `lib/pricing-progression.ts`
- `lib/commercial-recovery/resolve.ts`, `workspace-loader.ts`
- `lib/below-floor-projection.ts`

**Who can currently SEE that a placement is unbillable:** only the Quote
umbrella tree (`customer-view-resolver` → `quote/page.tsx` → rail, preview tab)
and the send gate. The Pricing surface reaches the `unbillable-recovery` graph
NODE for its Price Build band, but the margin verdict path does not consult it,
and no gate other than the send gate does.

## Recommendation

**Show the margin as UNRESOLVED while an unbillable placement exists. Do not
change the governed revenue basis.**

Reasoning, in the order that decided it:

1. **The state is commercially invalid, not merely mispriced.** The quote cannot
   be sent. Publishing any margin for it — even an arithmetically better one —
   invites an operator to act on a number describing a quote that does not
   exist in a sendable form.

2. **Re-basing would produce a plausible verdict for an unsendable quote**,
   which is worse than an obviously absent one. A margin recomputed on billable
   revenue would read as ordinary — possibly still above floor — and nothing on
   the surface would say the quote is unresolved. That is the failure this
   project keeps naming: a correct-looking number in a place that implies a
   different claim.

3. **Re-basing moves governed values for a state that should never reach their
   consumers.** `totalRevenue` feeds the HubSpot deal amount
   (`tierTurnkeyAmount`) and the acceptance unit price. Changing the basis
   changes those for quotes that are refused before they get there — so it buys
   nothing where it matters and adds risk where it does not.

4. **UNRESOLVED must be its own status, not a reuse of the existing two.**
   `UNAVAILABLE` and `COST_WITHOUT_REVENUE` both mean *the ratio is undefined —
   there is no revenue to divide by*. Here the ratio is perfectly computable;
   what is wrong is the BASIS. Folding this into either would assert something
   false about the arithmetic, and the existing doc comment on
   `QuoteMarginStatus` is explicit that consumers must not treat its members as
   interchangeable.

**What the operator still needs.** "What would my margin be once I fix this?" is
a real question, and the billable-only figure answers it — but it belongs beside
the REMEDIATION, not in the verdict slot. The verdict says unresolved; the fix
affordance can say what resolving it yields.

**Scope if adopted.** A new `QuoteMarginStatus` member; the gates already refuse
independently, so they need no behavioural change — only the display paths and
the classifier learn the state. Deliberately bounded away from the downstream
NetSuite work; `verify:netsuite-isolation` is unaffected either way, since none
of this is an input to the projection.

## Independent of the decision

The `detail-zone` copy ("excluded from the totals above") and the margin verdict
on the same surface disagree about the same money today. Whichever way the above
is dispositioned, that inconsistency is worth closing — either the verdict stops
including it, or the copy stops claiming it is excluded from everything.
