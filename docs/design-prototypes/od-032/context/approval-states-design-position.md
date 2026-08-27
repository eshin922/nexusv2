# Approval states — design position before Epic 2

**From:** CD · **Re:** §3 / §8 / §9 / §10 / §11 / §12 and the two commit models
**Status:** reconciliation at design time, as asked. No build — this settles the model the
controls will be designed against.

---

## 1 · The state list isn't incomplete. It's the wrong shape.

Adding *awaiting approval* and *approval rejected* to a list containing *compliant*, *below
floor*, *below target*, *overridden*, *lifted* and *approved* produces a list that will keep
feeling incomplete, because those are **two different things enumerated on one axis**.

> **A cell has a margin state and, independently, an approval state.**

*Below floor + awaiting approval* is a different cell from *below floor + rejected*, and both
differ from *below floor + nothing requested*. Enumerating the product gives you a
combinatorial list nobody can hold; enumerating the two axes gives you something small:

| Margin state | Approval state |
|---|---|
| above target | none required |
| below target *(reports, doesn't block)* | awaiting |
| below floor *(mandate breached)* | rejected |
| — corrected by lift | invalidated |
| — set directly | approved |

**Consequence for the interface, and it extends load-bearing item 20.** R11/R12 established
*colour encodes state, badges encode history*. That's now three channels, not two:

- **Colour** → margin state. Is this cell's price allowed on its own numbers?
- **Marker** → approval state. Is there a live permission question attached to it?
- **Badge** → history. Was it lifted, was it set directly?

Approval must **not** be folded into the colour ramp. A cell awaiting approval is still
below floor; painting it a fourth colour would say its margin changed when only its
permission status did.

## 2 · §3 and §12 don't conflict — they describe different lifespans

The apparent tension dissolves once control and state are separated, and the distinction is
worth stating because it is easy to build wrong:

- **The control is exception-driven.** "Request approval" appears only on a below-floor cell.
  §3 is right, and it matches how the surgical lift already behaves — if nothing breaches,
  the control does not exist on the page.
- **The state is durable.** *Awaiting*, *rejected* and *invalidated* persist across sessions
  and must be legible **without interaction**. They are not disclosure-on-demand.

So a durable approval state has to reach three places, not one: the **cell**, the **tier
rollup**, and — critically — the **banner verdict**. Item 23 says the banner and the grid
read one evaluation because the banner is what a PM trusts without checking. A quote with a
cell awaiting approval is **not sendable**, and the banner must say so from the same
evaluation, not from a second source.

## 3 · The load-bearing one: invalidation

You're right that §9 and §11 together imply it, and right that it's the state most likely to
surprise. Stating it plainly:

> **An approval is pinned to a price. The price is the output of a chain. When any input to
> that chain moves, the approved price is no longer the price — and the approval no longer
> covers anything.**

Silent invalidation would be the worst failure available to this page: permission granted,
cost moves, quote sends at a price nobody approved. It is also the exact failure mode the
traceability work exists to remove — a number whose authority comes from something that is
no longer true.

**The trace already knows what changed**, which makes the fix cheap and unusually good:

> ⊘ **Approval void.** Approved at **$2.87** by Edward on 30 Jul. **Packaging** rose $0.04 on
> 1 Aug (Verre Pacific re-quote, Ana Reyes) — the price is now **$2.92**. The approval
> covered $2.87. → *Request approval at $2.92*

Actor, date, the node that moved, and the route to act. That is the house rule applied to a
state rather than a value, and it needs no new data: the chain that produced the approved
price is the chain that can name the operand that changed.

**Invalidation must be automatic and loud.** Never a quiet reversion to "below floor" — the
PM would read that as *not yet requested* and re-request without knowing an approval had
existed and died.

## 4 · Two commit models — reconciled, not coexisting

This is the one I'd most want settled before Epic 2 builds, because discovering it later
means rebuilding Apply.

R12: stage → **Apply** → committed. Synchronous, session-scoped, one act.
Approval: request → **leaves the page** → returns minutes or days later. Asynchronous,
survives sessions, two acts by two people.

They look incompatible. They aren't, once you see that **an approval request is not a change
to the quote — it is a request for permission to make one.** So it never belongs in the
staged set. What is staged is the below-floor *price*; the approval is the gate that price
must pass.

That resolves the apparent deadlock (you can't request approval for a price you haven't
committed to, and you can't commit a below-floor price without approval):

> **Apply is one act with two outcomes, decided by content.**
> - Staged set is fully compliant → applies, done. Unchanged from R12.
> - Staged set contains a below-floor cell → **applies as pending and raises the approval
>   request in the same act.** The cell becomes *awaiting approval*, the price is persisted
>   but provisional, and the quote is not sendable.

This preserves load-bearing item 18 — **one Apply governs the whole page** — rather than
adding a second commit path beside it. The PM still takes one deliberate action; what
differs is what that action produces, and the Apply button should say which before it is
pressed (*"Apply 3 changes · 1 needs approval"*).

**Two rules that follow:**

1. **An approval request is never staged.** Staged things are discardable by leaving the
   page; a request that has gone to a person is not. Nothing that has left the building may
   sit in a session-scoped set.
2. **Returning to the computed baseline must withdraw outstanding requests**, not orphan
   them. R12 promises that removing every layer returns you exactly where you started; a
   pending request for a price that no longer exists breaks that promise.

## 5 · Answers received — and what they change

All four settled by CA/Edward. Two change the design materially.

### 5.1 · Scope is per QUOTE — the axis moves up a level

One approval state, on the quote. **Cells carry margin state only.**

So the three-channel scheme in §1 reduces at the cell and reappears at the banner:

| Surface | Channel | Carries |
|---|---|---|
| Cell | colour | margin state |
| Cell | badge | history — lifted, set directly |
| **Banner** | **verdict + marker** | **approval state, the approver's target, and the route** |

This is cleaner than what I was designing, and it lands the approval state on the surface
§2 already identified as the one a PM trusts without checking. The two-axis insight holds —
one axis simply isn't per-cell.

**The consequence to be deliberate about: the approver is authorising a SET, not a price.**
So the request must state its contents — how many cells, which SKUs, which tiers, what
margins — and **any change to that set invalidates**, not only a change to one price. Adding
a fourth below-floor cell to an approved set of three means the approver authorised
something that no longer exists.

Practically: the banner's awaiting state must show the set it sent, not a count. *"Sent 1
Aug · 3 cells below floor — RPL-200 T1 22.8%, GLW-30 T1 23.5%, GLW-50 T4 23.3%."* That is
also what makes an invalidation message legible when the set changes.

### 5.2 · Approval arrives from outside the product — design the honest waiting state

An Executive Approval role, requests to a Slack channel, authorised responses there approve.
**There is no in-app approve button, and the PM has no interactive affordance while waiting.**

The design consequence is a restraint rather than a feature: **do not invent an affordance to
fill the gap.** No "Check status", no disabled approve control, no progress indicator that
indicates nothing. A control that cannot do anything is worse than no control — it implies
the PM has a move when they do not.

What the waiting state should carry instead is fact and one real action:

> ⧗ **Awaiting executive approval** — sent 1 Aug 14:20 by Maya Okafor to `#pricing-approvals`.
> 3 cells below floor: RPL-200 · T1 (22.8%), GLW-30 · T1 (23.5%), GLW-50 · T4 (23.3%).
> Approval arrives in Slack; this page will reflect it.
> → *Withdraw request and keep editing*

**Withdraw is the route**, and it matters for item 24 — a verdict with no route is half a
fix, and "wait" is not a route. Withdrawing returns the quote to editable and is the only
PM-side move that exists, so it should be stated rather than left implicit.

**Editing while awaiting.** R12 is a playground and should stay one, so staging is still
allowed — but applying anything that changes the approved set must say so before it happens:
*"Applying will withdraw the pending approval request — the set it covers will have
changed."* Silent invalidation by the PM's own hand is the same failure as silent
invalidation by a cost change.

### 5.3 · Invalidation in either direction — confirmed

No conditional favourable-change rule. *"You approved 23%. It's no longer 23%. Ask again."*
Simpler to explain and simpler to trust, and it keeps the invalidation message uniform: one
sentence, one reason, one route.

### 5.4 · Rejection carries a target — and the mechanism already exists

This is the answer I didn't ask for and the most useful one. A rejection typically returns
*"work it better to X%"*, so the PM has a **concrete instruction, not a refusal**.

**Treat the approver's target exactly as the grid already treats the firm floor.**
`liftToFloor(sku, ti)` is already "the minimum lift that clears threshold T" —
`target = cost / (1 − T)`. The threshold is an argument, not a constant. So a rejection with
a target needs **no new mechanism at all**: it swaps the constant.

```
rejected with target 25%  →  every cell below 25% offers a lift to 25%
                             the banner's verdict counts against 25%, not the floor
                             "Lift all 3 to Edward's 25%" is the existing tier action
```

**One decision inside it, and I'd take the strict reading.** *"Work it to X"* could mean the
blended margin, the worst cell, or every cell. I'd treat X as a **temporary, higher floor —
a per-cell threshold** — because it is unambiguous, it is strictly stronger than the other
two readings, and clearing every cell to X guarantees blended ≥ X as well. A PM who
satisfies the strict reading cannot have under-delivered against the loose one.

The banner should name whose threshold is in force, because it changes what "below floor"
means on the page:

> ✕ **Rejected — work to 25%.** Edward, 1 Aug: *"margins too thin on the 30ml — work it
> better to 25%."* 3 cells are below 25%. The grid is now measuring against 25%, not the
> 20% firm floor.
> → *Lift all 3 to 25%*

**A rejected quote with a target is not a refusal state — it is a corrective state with a
higher bar**, and it should feel like the below-floor state does: actionable, with the
threshold named and the lift offered. ← LOAD-BEARING

### 5.5 · The state model, settled

**Per cell:** above target · below target · below floor · lifted · set directly.
**Per quote:** none required · awaiting · rejected-with-target · invalidated · approved.

Five and five, on two surfaces, with the approver's target acting as a substitutable
threshold rather than a sixth state.

---

## 6 · Three notes, answered

### 6.1 · Self-invalidation — promoted out of the footnote

Agreed, and you're right that it's the sharper case: cost drift arrives from elsewhere and
is nobody's fault; **self-invalidation is caused by the person it hurts, in the moment they
are acting.** It gets the full weight of the invalidation design.

**Pre-emptive, and earlier than the click.** A confirm at the moment of pressing Apply is
still late — the PM has already decided by then. The warning belongs in the **staging bar,
visible from the moment the offending change is staged**, because that is where the pending
set lives and where the decision is actually being formed:

> ⚠ **This set invalidates the approval request sent 1 Aug.** RPL-200 · T1 is in the set the
> approver is holding. Applying will withdraw the request and you will need to ask again.

And the Apply button carries it too, since a button that commits a consequence should name
it: *"Apply 2 changes · invalidates approval request."*

**The general rule this is an instance of:** a consequence that only appears in the confirm
dialog appears too late to change the decision. The confirm is where you *acknowledge* a
consequence; the working surface is where you *learn* it. ← LOAD-BEARING

### 6.2 · Withdrawn is history, not state — and visible history

**Decision: history.** A state must earn its existence by behaving differently, and
*withdrawn* does not: the quote is below floor, fully editable, every action available is
the one that was available before the request. A state whose behaviour is identical to
another state is not a state — it is a label on the same state.

But the ambiguity you name is real, so it is **visible** history, in the same slot the
invalidation notice uses:

> Below floor · **a request sent 1 Aug was withdrawn 2 Aug by Maya Okafor.** 3 cells below
> floor. → *Request approval*

The asymmetry with invalidation is deliberate and worth stating, because it explains why one
is a state and the other isn't:

| | Caused by | PM knows | Needs a route |
|---|---|---|---|
| **Invalidated** | something outside the PM's action | **no** — must be told | yes — re-request |
| **Withdrawn** | the PM, deliberately, just now | yes | no — they are already acting |

Invalidation is a state because the PM has to be *stopped and informed*. Withdrawal is
history because they already know — they did it.

### 6.3 · Two thresholds — X supersedes in colour; the floor stays as stated context

**Decision: supersede, with the firm floor named rather than rendered.**

The reason is a failure this project has already had. If both thresholds were live in the
colour ramp, a PM clearing to Edward's 25% would see red cells at 24% that are perfectly
fine by firm policy — **and no way to tell which red mattered.** That is exactly the
"trains the eye to ignore red" defect from R12's margin colouring, reintroduced by having
two meanings for one channel.

So, using the three channels already established:

- **Colour → the operative threshold.** X while rejected-with-target, the firm floor
  otherwise. One threshold, one meaning for red. Item 20 survives intact.
- **Stated context → the grid header names both**, once, rather than per cell:
  *"Measuring against Edward's 25% · firm floor 20%."* The PM has both numbers without the
  cells having to encode two.
- **Badge → history.** Cells that were *also* below the firm floor keep a quiet marker, so
  "which were originally the problem" survives — which matters exactly when X is later
  relaxed and the operative bar drops back.

That last point is the one your question was really about, and putting it in the badge
channel is what lets the answer be *supersede* without losing anything: **the stricter bar
governs what is actionable; the original bar is remembered, not rendered.**

### What R12 will need when Epic 2 builds

Small, and all of it reuses what exists:

1. `liftToFloor(sku, ti, flags)` → `liftTo(sku, ti, flags, threshold)`. One parameter; the
   arithmetic is unchanged (`cost / (1 − T)`).
2. `marginState(m)` takes the operative threshold rather than reading `firm` directly.
3. `evaluateCells` gains the operative threshold, so the banner verdict and the grid keep
   reading one evaluation — item 23 must survive the second threshold.
4. The staging bar gains the pre-emptive invalidation warning (§6.1).
5. The banner gains the quote-level approval channel: awaiting (with its set), rejected-with-
   target, invalidated, approved — plus withdrawn as visible history.
