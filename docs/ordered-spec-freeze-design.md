# Ordered-item spec freeze — design

**Design only. Nothing implemented.** Written against the measured provider
capability in `docs/netsuite-file-cabinet-probe-findings.md`.

Governing disposition, already settled:

> An ordered item's historical spec must be frozen at SEND. The live
> `leaf_specs` row is not sufficient authority.

## Why the live row cannot serve

Established by trace, not assumed:

- **Item-level ownership already exists.** `leaf_specs.quote_id NOT NULL` is a
  quote-owned authority, copied from the Library template at attachment, with
  `leaf_specs_quote_owned_idx` making one-authority-per-`(quote, leaf)`
  structural. The Product Type and `spec_schema` are pinned onto it. There is no
  deal-level spec anywhere in the model.
- **But it is a single mutable row.** For quote-owned scope the versioning
  columns are inert: all 167 rows are `version_number = 1`, `is_current = false`,
  `effective_to = NULL`. The schema says why — *"quote-owned rows are siblings,
  not a version succession."*
- **Nothing freezes it.** No `assertDraft` / `assertNotFrozen` in
  `leaf-specs.ts` or `quote-spec-authority.ts`; `leaf_specs` is absent from the
  Pattern 52 freeze list; `quote_snapshot_lines` carries `quote_leaf_id` but no
  spec columns; `addendum-loader.ts` reads *current* values at render time.
- **`leaf_spec_version_pin` was never built.** It appears once in the tree — as
  a comment at `schema.ts:2593`. CLAUDE.md describes it as a live system event.

A measurement worth recording honestly: `updated_at > sent_at` counts 38-of-38
on sent quotes, which reads as "edited after send". It is not. Re-measured
against `created_at`, **`genuinely_edited` is 0** — those rows were *created*
after send, because the authority materialises lazily. The exposure is
structural, not yet realised: post-send editing is fully permitted and simply
has not happened.

## The freeze

New table, written inside the SEND transaction beside the commercial freeze.

```
quote_snapshot_leaf_specs
  id                      uuid pk
  quote_snapshot_id       uuid  -> quote_snapshots(id) on delete cascade
  quote_leaf_id           uuid                       -- the ORDERED ITEM
  source_leaf_spec_id     uuid                       -- provenance
  source_updated_at       timestamptz                -- provenance
  spec_values             jsonb  not null            -- frozen
  product_type_id         text                       -- frozen
  spec_schema             text                       -- the PINNED schema
  schema_derived_from_type text                      -- pin provenance
  content_hash            text   not null            -- revision identity
  created_at              timestamptz not null default now()

  unique (quote_snapshot_id, quote_leaf_id)
```

**Keyed to the snapshot, not the quote.** A quote can be sent more than once;
each send is a distinct offer and gets its own frozen row. Keying to the quote
would let revision N overwrite the spec that revision N-1 was ordered under.

**`content_hash` is the revision identity**, and must be deterministic:
canonical JSON of `spec_values` (keys sorted, no incidental whitespace) plus
`product_type_id` and `spec_schema`, SHA-256. Values alone are not enough — the
same values under a different schema are a different specification, which is the
whole reason the schema is pinned.

**Provenance is recorded, not relied upon.** `source_leaf_spec_id` and
`source_updated_at` say which live row this was taken from and when. They
explain the frozen row; they never resolve it.

## Materialise before freezing

`created_after_send = 38/38` on sent quotes means the quote-owned authority
frequently did not exist at send. **Freezing nothing because lazy materialisation
had not run would record an absence as a fact.**

So SEND calls `ensureQuoteSpecAuthority` for every ordered leaf **before** the
freeze, in the same transaction. The function already exists and is already
idempotent-by-construction (the unique index makes exclusivity structural); this
adds a call site, not a mechanism.

A leaf whose Product Type genuinely carries no schema freezes a row with an
explicit `spec_schema = 'no_schema'`. **That is an answer.** It must never be
conflated with `unmapped`, which is the absence of one — the distinction the
column already encodes.

## After the freeze

- The downstream packet reads `quote_snapshot_leaf_specs`. **Never
  `leaf_specs`.** A boundary test should assert the NetSuite tree does not
  import the live table, in the shape of the existing customer-view guard.
- `assertNotFrozen` guards the live spec writers, and `leaf_specs` joins the
  Pattern 52 freeze list — which it should have been on already.
- The customer PDF is pushed **as bytes**, re-read from
  `buildQuotePdfStoragePath(quoteId, sendUuid)` + bucket. **Never through
  `quotes.pdf_url`**, which expires in 30 days and is marked internal-only.

## The NetSuite packet — contingent, and honestly so

**The probe found File Cabinet blocked by role permission, not by API surface.**
So the packet design has one prerequisite and two branches, and it would be
dishonest to present either branch as decided.

**Prerequisite:** grant the integration role Documents and Files in the sandbox
and re-run both probe scripts. They will answer, in one pass, what could not be
measured: attachment mechanism, whether a line-level relationship exists at all,
size and content-type limits, and duplicate-upload behaviour.

**Branch A — File Cabinet available.** Upload the PDF and a per-item spec sheet
generated from the frozen rows; relate them to the Sales Order. Whether item
provenance rides a per-line custom field, a custom record, or a native
relationship **stays open until the re-run measures it.** Not committed to.

**Branch B — grant refused.** Header link-out to a durable Nexus URL for the
order packet. This is not novel in the account: `sales-orders.ts:184` already
writes `custbody_sharepoint_link` (mirroring `custbody_dps_accounting_files`)
with the deal folder URL, so an operator already reaches order documents from
the SO by exactly this route. Weaker — the artifact stays outside NetSuite and
depends on Nexus being reachable — and it should not be selected until the grant
has actually been attempted.

**Both branches need a durable, non-expiring Nexus route to the packet.**
`pdf_url` cannot be it. That route does not exist yet and is its own small piece
of work.

## Failure behaviour

**The Sales Order is authoritative and is never rolled back to fix an artifact.**
SO creation and artifact transfer cross a system boundary and cannot share a
transaction; pretending otherwise would trade a missing file for a missing order.

Artifact pushes are therefore **separately visible, idempotent and retryable** —
their own state per artifact per SO, so a partial attach is a legible state an
operator can resume, not a silence. This mirrors `netsuite_so_pushes`, which
already provides exactly this shape for the order itself and currently covers no
artifact.

## V1 acceptance, restated as checks

From a NetSuite Sales Order an operator can:

1. open the exact customer PDF for the accepted version — the bytes that were
   sent, not a re-render;
2. for each applicable ordered item, open the exact spec as ordered, resolved
   through `quote_snapshot_leaf_specs` and identified by `content_hash`;
3. do both after the live spec has since changed, and see the ordered values.

Underlying accounting and component detail is unaffected throughout: the freeze
adds a record and removes nothing, and the commercial line set already frozen at
SEND continues to carry the accounting projection regardless of what the customer
document showed.
