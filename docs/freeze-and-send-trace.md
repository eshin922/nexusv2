# Freeze & send — tracing it onto the certified SEND path

**Disposition, Edward 2026-08-24.** Freeze & send is the Design Authority's
canonical final act and supersedes Continue to Send. It must invoke the existing
certified send path, not become a second implementation, and must not duplicate
the pricing gates.

**This is a trace, not an implementation.** Nothing below is built.

---

## 1 · What the certified path already is

`sendQuote` (`src/app/actions/quotes.ts:1433`) is the whole act. Its body, in
order:

| step | what |
|---|---|
| validate | `quoteId` present; `assertDraft(quote)` |
| structure | at least one tier; `hasSendableCommercialStructure` |
| context | project row; firm settings row |
| **gate** | `requireResolvedQuoteCosts(quoteId)` |
| **gate** | `requireBelowFloorAuthorizedToSend({ quoteId, quoteVersionNumber })` |
| pin | `prepareQuoteCommercialPin` → canonical `quote_leaves.id` |
| snapshot | freight component costs, commercial pin, `floorMarginPct` |
| artifact | render + upload the PDF |
| status | `status = 'sent'`, `sent_at`, customer-facing quote number |
| audit | `quote_sent` |
| feed | origin `quote_review_events` row (`event_type = 'sent'`) |

**Both pricing gates are already inside it**, and deliberately placed before any
external artifact — the comment says why: *"a refusal must leave no PDF, no
snapshot, no pin, no audit and no status change."*

So Freeze & send does not need to check the floor. It needs to **call this and
render what it throws.**

## 2 · The cutover

`send-quote-flow.tsx:90` is the only call site. It assembles four fields:

```
quoteId · pdfLayout · detailLevel · includeSpecAddendum
```

All four are already in the rail: `pdfLayout` and `detailLevel` are Card 2 state
with live setters; `includeSpecAddendum` is a `CustomerView` field. So the
footer can build the identical `FormData` today.

The cutover is therefore:

1. the footer's primary action calls `sendQuote` with those four fields;
2. it renders `result.error.message` verbatim on refusal (the messages are
   governed prose — the below-floor one names every failing tier);
3. `tab-send-to-client.tsx` is retired **after** (1) and (2) are certified, per
   the lifecycle trace's forced ordering.

**Prove the single caller after cutover**, per the disposition:

```
grep -rn "sendQuote" src/components/   # expect exactly one call site
```

## 3 · The finding — the footer and the gate disagree

**The footer invents a refusal the boundary does not have.**

```
customer-view-rail.tsx:79
  blocked = rollups.some(t => t.blendedMarginPct < governed.floorMarginPct - 1e-6)

below-floor-send-gate.ts:59-93
  belowFloor = rollup.filter(r => r.blendedMarginStatus === "BELOW_FLOOR")
  if (belowFloor.length === 0) return;            // ordinary path
  ...for each: evaluateBelowFloorAuthorization({ authorizations, scope,
        currentFingerprint: fingerprintCommercialState({...}) })
  refuse only where a verdict is not ok
```

The gate permits a below-floor send **when a current, un-invalidated
authorization exists for that tier and version, fingerprinted against the
economics being sent.** The footer has no concept of an authorization at all.

So for a below-floor quote that **has been approved**:

- the boundary would allow the send;
- the footer renders `Request pricing approval` and leaves the button disabled.

The operator is blocked by the surface from an act the firm has already
authorized, with nothing on screen saying why — which is also a Pattern 47(f)
failure: a disabled control whose cause is not communicated.

This is Pattern 50 exactly: two subsystems answering one compliance question on
different bases, and the intersection — below floor **and** authorized — being
silently consumed by the surface's default.

**It is latent today** only because the button is inert. Wiring it without
fixing this converts a cosmetic divergence into a real refusal.

### The repair, stated before implementation

The footer must not compute floor compliance. It must **project the same
verdict the gate produces** — sendable / refused-with-reason — from one
authority. Concretely: a read-side projection sharing
`evaluateBelowFloorAuthorization` and `fingerprintCommercialState`, so surface
and boundary cannot diverge by construction rather than by care.

`fingerprintCommercialState` remains the single authority for authorization
survival, per the G3 disposition. Nothing here changes it.

## 4 · What Freeze & send must additionally freeze

The disposition names five things. Three exist; two do not:

| required at checkpoint 1 | status |
|---|---|
| existing SEND/freeze state | **exists** — commercial pin, freight snapshot, floor pin, PDF, quote number |
| commercial recovery / instructions | **exists** — frozen instruction projection is certified |
| exact customer artifact | **exists** — PDF rendered and uploaded in-transaction |
| Customer Presentation profile | **does not exist** — G4 |
| Accounting Handoff incl. authored instruction | **does not exist** — G4 / Card 3 |

So Freeze & send cannot be *complete* before G4, but it can be *wired* now: the
act, its gates and its refusals are all certified. The two missing freezes are
additive columns written in the same transaction once G4 lands.

That matches the disposition's own sequencing — Freeze & send, then Card 3/G4 —
and means the wiring step does not wait on the schema.

## 5 · What must not happen

- **No second send implementation.** One action, one transaction.
- **No gate duplicated in Customer View.** The footer renders the boundary's
  refusal; it does not re-derive it. §3 is a case of that rule already being
  broken in the read direction.
- **No navigation shortcut to the retired Send tab.** The act happens in place.
- **`· not wired yet` comes off only after** an end-to-end browser certification
  on a deployed build: edit → recovery/presentation state → Freeze & send →
  frozen snapshot and instructions → customer artifact → downstream state.
  Until then the admin gate stays and `FUNCTIONAL_FIDELITY` stays PENDING.

## 6 · Open question

**Does Freeze & send keep a confirmation step?**

Picking a recovery treatment is immediate, and correctly so — the document is
beside the control and re-renders. Freezing is different in kind: it is the
irreversible-in-practice release of a customer artifact, assigns the
customer-facing quote number, and moves `status` to `sent`.

`send-quote-flow.tsx` has a confirm modal today (Slice 11 Step 8 replaced
`window.confirm` with an in-DOM one). The registered authority describes the
footer as "the act" and does not describe a modal.

Recommendation: **keep a confirmation**, because the reversibility argument that
removed the recovery-pick confirmation does not transfer — there the artifact
was the confirmation, here the artifact is the consequence. But it is a
divergence from the authority's silence and should be dispositioned rather than
assumed.
