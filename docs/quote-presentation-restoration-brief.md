# Quote Presentation — authority-fidelity restoration

**Implementation brief.** Authored 2026-08-24 after the reconciliation in
[`quote-presentation-authority-reconciliation.md`](quote-presentation-authority-reconciliation.md)
and Edward's R5 disposition.

This is a **restoration**, not a redesign. Everything in §4 is already specified
by the authority; the work is to implement what was specified and was not.

---

## §0 · Fidelity Discipline (read before every step)

This brief is a **scope contract**, not a fidelity contract.

**Product authority lives in:**
- [`quote-presentation-profile-brief.md`](quote-presentation-profile-brief.md) —
  the governing interaction model, registered at
  [`design-authority/MANIFEST.md`](design-authority/MANIFEST.md) under
  *Registered document authorities*.

**Before implementing each step:**
1. Read the authority section named in the step. Not this brief's paraphrase.
2. Implement what it specifies, including its vocabulary.
3. Manifest both layers per Pattern 27 (structural + polish).

**And the rule this slice exists because nobody applied:**

> **No registered authority for a surface is a BLOCKER, not a licence to invent
> one.** If the manifest lists nothing governing a surface you are about to
> build, stop and ask. "No authority exists yet" and "an authority exists and is
> unregistered" are indistinguishable from inside the code, and only the first
> permits inventing.

Recorded as MANIFEST rule 7. The Quote Presentation authority was absent from
that file for three days while Quote Presentation was implemented from the
recovery-engine model instead.

---

## §1 · R5 disposition — Edward, 2026-08-24

The Layer-2 boundary is **preserved, not superseded**.

> `fee_presentation` remains a Layer-2, revenue-neutral presentation decision.
> **If a control can change customer economics, it is not a Quote Presentation
> control.**

Three concerns, kept separate:

| | owns | may change the customer total? |
|---|---|---|
| **Commercial recovery** | how much DPS intends to recover, and the governed economic treatment; legacy → governed conversion and its measured `$X → $Y` confirmation | **yes** — and is subject to pricing / margin / approval controls |
| **Quote Presentation** | how already-established economics *appear*; fold vs itemize | **never** |
| **Accounting** | the frozen combination of both, plus an explicit instruction about what is embedded versus separately invoiceable | — |

**Consequence for this slice.** The recovery election is economically
substantive, so it is **removed from Quote Presentation** — not restyled, not
relocated within it.

---

## §2 · Where the economic recovery control belongs

Traced before moving it, per Edward's instruction not to silently delete a
certified capability.

**The Pricing authority already owns this control.** From
`design-authority/r12-pricing-workspace/docs/r10-designer-notes.md` (lineage to
the selected R12):

> `allocate_service_fees_to_cost` is a live toggle. Switch it off and the
> allocated-services operand **disappears from the chain entirely** —
> production cost becomes COGS alone, and a note states that one-time fees now
> bill as separate fixed charges rather than entering the per-unit price. The
> chain's *shape* changes, not just its numbers.

That is the same operator decision the recovery election governs, on the surface
the authority puts it on. And the recovery workstream's own boundary document
already said the election was meant to *replace* that toggle:

> "once the recovery workspace is certified, the boolean must **not** reappear
> as a separate commercial choice" — `commercial-sell-construction-boundary.md`

So the destination is **the Pricing workspace**, and the recovery election is
the governed successor to the toggle the Pricing authority shows there.

### The timing problem, stated rather than worked around

Phase 3 Pricing is **not started** and is blocked on Phase 2 operator
acceptance (`r12-pricing-workspace/BUNDLE.md`). So the registered destination
exists in authority and not in shipped code.

**What is removed, and what is not:**

| | disposition |
|---|---|
| `RecoveryCard`, its rail placement, its prop chain | **removed** from Quote Presentation |
| sell constructor, charge economics, pricing precedence | **kept** — certified, and load-bearing for every quote |
| `setChargeRecovery`, refusals, audit, draft-lock | **kept** — the action boundary is unchanged |
| `previewChargeRecovery` + `measureRecoveryImpact` | **kept** — the `$X → $Y` confirmation Pricing will need |
| `buildRecoveryWorkspace` read model | **kept** — the read model is surface-agnostic |
| SEND freeze + `quote_snapshot_recovery_instructions` | **kept and live** — legacy instructions keep recording from day one |
| `allocate_service_fees_to_cost` | **unchanged** — the boundary doc's "must not reappear" is unreachable until Pricing ships, so the toggle stays as it is today |

**Net effect: the capability becomes dormant, not deleted.** No operator path
exists between now and Phase 3 — which is the honest consequence of the
disposition, and is preferable to leaving an economic control on a surface the
authority says must not carry one. Every headless certification stands
(`gate1b:recovery-impact-certify`, `frozen-instruction-certify`,
`frozen-instruction-contrast`, `recovery-persistence-walk`,
`send-freeze-verify`), so Phase 3 inherits a proven engine and a proven action
boundary rather than a rebuild.

**Recorded so it cannot be lost:** Phase 3's brief must pick up the recovery
election as the successor to the `allocate_service_fees_to_cost` toggle. Without
that line, a future implementer reads the R10 note, ships the toggle, and the
governed election stays dormant permanently.

---

## §3 · What Walk A's result now means

Walk A passed on production against 52bd0077 and restored it byte-for-byte. It
is evidence for **the engine, the action boundary, the measured-impact
confirmation and the persistence/restoration chain** — all of which survive this
slice unchanged.

It is **not** evidence for the operator surface, which is being removed. It will
not be cited as such.

---

## §4 · Restoration scope

Each step names the authority section it implements.

### Step 1 · Remove the recovery card from Quote Presentation
*(§1 disposition)*

Delete the `RecoveryCard` render, its props through `QuoteUmbrella` →
`TabPreviewQuote`, and the `recoveryWorkspaceVisible` dark flag it was gated by.
The read model and resolver output stay — they are consumed by nothing on this
surface afterwards, which is the point.

### Step 2 · Document dominant
*(authority: Interaction model — "Document dominant")*

The PDF occupies the primary column at full height;
`clamp(816px, 100%, 1200px)` replaces the 880px cap. 816px is Letter at 96dpi
and the floor below which the document re-compresses.

### Step 3 · One Presentation panel beside the document
*(authority: Interaction model — "One Presentation panel")*

Grouped as the reader of the PDF experiences it: *Structure* (Itemized/Turnkey,
tiers, featured tier) · *Disclosure* (fee presentation, on-request lines,
addendum) · *Voice* (customer-facing notes). The existing R3 rail vocabulary
(`.macc-preview-rail` / `.macc-side-rail`, `1fr 380px`, sticky) is the house
precedent and should be reused rather than reinvented.

**Governed figures render locked** — read-only register, lock affordance, and a
route to the surface that owns them. **Nothing in this panel is an input to
economics.**

### Step 4 · Accounting zone
*(authority: Interaction model — "Accounting instructions in their own zone")*

Below the existing BOUNDARY GUARD rule, in the *not shown to the customer*
register the surface already has. Presents the instruction the SEND freeze
already produces.

### Step 5 · F4 — remove the PURE / PASS-THROUGH / PARTIAL switcher
*(authority: Interaction model — "Remove the PURE / PASS-THROUGH / PARTIAL
switcher (F4)")*

**Determined, per Edward's "report first if this changes behaviour":** it does
not. On the Quote surface `subState` is local state initialised to `"pure"`,
passed to `PreviewToolbar`, which renders three buttons whose only effect is to
set it back. It feeds no iframe parameter and no render branch —
`quote-host.tsx:101` calls it a cosmetic no-op and that is accurate. It is also
already invisible in production: `showStateSwitcher = dev === "1" ||
NODE_ENV !== "production"`.

So removing it **restores specified behaviour and changes none**.

**Scoped to the Quote surface only.** `mark-accepted-host.tsx` shares the
`showStateSwitcher` prop name but its `subState` genuinely drives four render
branches (`good` / `awaitingMark` / `bothGates` / `pending`). Removing it there
*would* change behaviour and is out of scope.

### Not in this slice

The authority's Layer-2 schema (`quote_presentation_profiles`,
`quote_accounting_instructions`, `fee_presentation`, `featured_tier_id`) is
unbuilt, so F1–F3 remain live: presentation state still has no draft home, and
an operator still loses all three axes on reload. Restoring the *layout* does
not fix that, and pretending otherwise would be the same altitude error in a
new place. It needs its own slice against the authority's schema section.

---

## §4.5 · Gate state

Recorded here rather than left in conversation, because "the tests are green"
is the sentence that would otherwise become "it is approved".

```
STRUCTURAL_FIDELITY: VERIFIED     tests + verify:ci
VISUAL_FIDELITY:     PENDING      awaiting operator inspection
```

**These are different properties and only one of them is automated.** The
structural checks assert that the authority's requirements are implemented —
the clamp is present, the panel groups exist, no economic input reaches the
panel, F4 is gone. None of them can see whether the surface an operator opens
is right. That judgement is Edward's, and the flag stays until he makes it.

`tests/unit/recovery-workspace.test.ts` asserts the coupling: while this file
says `VISUAL_FIDELITY: PENDING`, the `presentationRestored` gate must still
exist. Removing the flag without moving this line fails the suite — so the two
cannot drift apart silently, which is the only failure mode worth automating
here.

**Before the flag comes off:**

1. restored/admin path — the fidelity fixes landed as intended
2. legacy path via `?legacy=1` — the existing PM experience is intact,
   specifically Edit-notes and the old control row
3. Edward's own visual inspection of the restored layout

## §5 · Exit

Surface stays dark until the restored version is back for operator review. No
Walk A continuation, no flag removal, no S-7 recapture until then.
