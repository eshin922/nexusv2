# R6.2 Scope Addendum — Foundational Attachment Library (Freight is First Consumer)

**To:** CC
**From:** CA (relayed from Edward)
**Re:** Slice closure plan update — `slice-r6-2-freight`
**Status:** Pre-commit-3 scope change · architectural framing revision

---

## Why this addendum

The P1 PDF slot lands as a non-functional affordance with the `upload · P2` phase chip. Edward's call: show-but-don't-support is bad UX. Promote upload to P1.

**But the broader call:** R6.2 isn't the only feature that needs file upload. Edward has identified future consumers including artwork, invoices, proofs, production specs, and more. Building upload as a freight-specific feature now would force re-implementation per consumer.

**Reframe:** R6.2 commit 3 builds a foundational **attachment library** with reusable infrastructure (table, storage, RLS, action primitives, lifecycle). **Freight forwarder PDF is the first consumer.** Future features wire their own associations against the same library — adding artwork to SKUs, invoices to vendors, proofs to production runs becomes a few hours per consumer, not a few days.

Gap 24 disposition is hereby revised. PDF upload promotes P2 → P1. Library shape replaces freight-specific shape.

---

## Library principles

These are the architectural commitments the library makes. Future consumers compose against these; CC carries them through:

1. **Attachments are a first-class resource.** Pure file metadata + storage reference. No entity-specific knowledge. One `attachments` table.
2. **Associations live in per-entity join tables.** Each entity type that wants attachments gets its own join table (e.g., `freight_leg_attachments`, `sku_attachments`, `invoice_attachments`). Type-safe FK on both sides. Role column captures attachment kind per entity.
3. **Storage is org-scoped, single bucket.** Path scheme `attachments/{org_id}/{attachment_id}.{ext}`. RLS uses path prefix for tenant isolation.
4. **Action layer exposes a generic primitive + entity-specific wrappers.** `uploadAttachment(file, associations)` is the library primitive. `attachForwarderPdf(legId, file)` is the freight-specific wrapper calling into it.
5. **Immutability is a consumer concern, not a library concern.** The library doesn't enforce "can this be replaced?" — each consumer's action layer does, based on its own state machine (e.g., Mark-Accepted for freight; differently for invoices).
6. **Orphan attachments are accepted as cleanup-later debt.** v1 has no cleanup job. Pattern 32 pre-production tolerance applies.

---

## Revised slice closure sequence

| Commit | Scope | Status |
|---|---|---|
| `2474043` | Additive schema (migration 0026) | ✓ landed |
| `f269195` | Incident artifacts (journal recovery) | ✓ landed |
| `5a5adc9` | Orphan cleanup | ✓ landed |
| `b7d943a` | Math layer + actions + Realtime + UI rebuild | ✓ landed |
| `5f664d1` | Modal portal fix + canonical fidelity | ✓ landed |
| **Commit 3 (new scope)** | **Attachment library + freight forwarder PDF as first consumer** | **Pending** |
| **Commit 4 (was commit 3)** | **Legacy `freight_inputs` cleanup** | **Pending** |

Commit 3 ships the library + freight integration. Commit 4 ships the legacy cleanup migration. Both land in one merge to main.

---

## Commit 3 scope — Attachment library + freight integration

### Schema

Migration `0027_attachment_library.sql` (drizzle-tracked):

```sql
-- The library: pure file metadata + storage reference
create table attachments (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  filename text not null,
  content_type text,
  size_bytes integer,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz default now(),
  org_id uuid not null references organizations(id)
);

create index attachments_org_id_idx on attachments(org_id);

-- Freight-specific association (first consumer)
create table freight_leg_attachments (
  freight_leg_id uuid not null references freight_legs(id) on delete cascade,
  attachment_id uuid not null references attachments(id),
  role text not null,   -- 'forwarder_quote' for v1; extensible for future roles
  attached_at timestamptz default now(),
  attached_by uuid references users(id),
  primary key (freight_leg_id, attachment_id, role)
);

create index freight_leg_attachments_attachment_id_idx 
  on freight_leg_attachments(attachment_id);

-- Enforce single forwarder_quote per leg at v1 (designable as multi later)
create unique index freight_leg_attachments_one_forwarder_quote
  on freight_leg_attachments(freight_leg_id)
  where role = 'forwarder_quote';
```

Manual SQL `drizzle/manual/0003_supabase_realtime_attachments.sql`:

```sql
alter publication supabase_realtime add table attachments;
alter publication supabase_realtime add table freight_leg_attachments;
```

(Single shared Supabase project — both environments get the publication update.)

**Note:** the `freight_legs.forwarder_quote_pdf_id` FK column anticipated in earlier dispositions is **not** created. The join table replaces that pattern. Cleaner shape; matches future entity types.

### Supabase Storage

Single private bucket: **`attachments`**.

**Path convention:** `attachments/{org_id}/{attachment_id}.{ext}`

The entity association lives in the database (join tables), not in the storage path. Storage stays clean; the association layer handles scoping.

**RLS policies:**

- INSERT — authenticated; `org_id` must match user's session org; storage path must be prefixed `attachments/{user's org_id}/`
- SELECT — authenticated; storage path prefix matches user's org_id
- DELETE — authenticated; storage path prefix matches user's org_id; consumer-level immutability enforced at action layer (see Mark-Accepted commitment below)
- UPDATE — none (attachments are write-once at storage layer)

### Action layer

**Generic library primitive** in `src/app/actions/attachments.ts`:

```typescript
async function uploadAttachment(input: {
  file: File,
  associations: Array<{
    entityType: 'freight_leg' | 'sku' | 'invoice' | /* future */,
    entityId: string,
    role: string
  }>
}): Promise<AttachmentRecord>
```

Flow:
1. Validate MIME + size (see Validation below)
2. Upload file to Storage at canonical path
3. INSERT row in `attachments`
4. For each association, INSERT row in the appropriate `*_attachments` join table
5. Return the full attachment record

Other library primitives:
- `getAttachment(attachmentId)` — returns metadata + signed URL for view
- `removeAttachment(attachmentId)` — deletes storage object + attachment row; blocked while any join row references it (FK constraint will block; surface as friendly error)

**Freight-specific wrappers** in `src/app/actions/freight.ts`:

```typescript
attachForwarderPdf(legId, file)   →  uploadAttachment with association { entityType: 'freight_leg', entityId: legId, role: 'forwarder_quote' }
replaceForwarderPdf(legId, file)  →  removes old join row, calls uploadAttachment, sets new join row
removeForwarderPdf(legId)         →  removes join row only (attachment row stays as orphan)
```

All three wrappers enforce Mark-Accepted immutability (see commitment below).

**Audit log entries (freight-specific for v1):**

- `freight_leg_pdf_attached` — diff_json: `{ attachment_id, filename, size_bytes }`
- `freight_leg_pdf_replaced` — diff_json: `{ from_attachment_id, to_attachment_id, from_filename, to_filename }`
- `freight_leg_pdf_removed` — diff_json: `{ from_attachment_id, from_filename }`

Generic library actions don't have their own audit trail in v1 — consumer-specific keys carry workflow context. Generic audit can layer on later if needed.

### UI

The PDF slot in `freight-drilldown.tsx` Add-Leg modal + per-leg display surface.

**Canonical fidelity reminder:** the populated-state shape comes from the canonical `data.js` fixture and screenshots — match it verbatim, do not paraphrase. Open `docs/design-prototypes/dist/.../freight-panel.jsx` to confirm exact markup, classnames, and CSS hooks. Pattern 30 verbatim applies — canonical JSX structure binds to canonical CSS rules.

**Empty state** (current canonical):
```
↑ ATTACH FORWARDER QUOTE PDF
```
Clicking opens a file picker (PDF only for v1 freight; library supports more).

**Populated state** (per canonical `data.js`):
```
PDF  sino-q3-lumen-2026.pdf
     uploaded 2026-05-08 · 84 KB · per-leg attachment    View    Replace
```

`View` opens the file via Storage signed URL (short-lived, e.g., 5 min). `Replace` triggers `replaceForwarderPdf`. Remove lives in the leg's `⋯` action menu.

**Drop the `UPLOAD · P2` phase chip** — it's now functional.

**Future library-consuming UI components:** consider extracting an `<AttachmentSlot />` primitive that any consumer can use. For v1, fold the slot UI into the freight panel directly; if a clean extraction surfaces during commit 3 work, do it. Otherwise extract in a later refactor when the second consumer arrives.

### Validation

**Library-level (generic primitive):**

- File size cap: **100 MB** baseline (configurable per-entity-role; freight forwarder PDFs cap at 25 MB unless Edward says otherwise)
- MIME allowlist (library default): PDFs (`application/pdf`), images (`image/png`, `image/jpeg`, `image/webp`), Adobe (`application/postscript`, `application/illustrator`, `application/vnd.adobe.photoshop`), Office formats (`.docx`, `.xlsx`, `.pptx`)
- Per-entity-role override: consumer wrappers can narrow the allowlist (e.g., `attachForwarderPdf` accepts PDF only; future `attachSkuArtwork` accepts PDF + Adobe + image formats)
- Surface: inline error chip + `ActionGuardError` per Gap 5 pattern

**Supabase plan check before implementation:** confirm the current plan supports 100 MB uploads. Default Supabase limit is 50 MB per file; paid plans go up to 5 GB. If we're on a tier that caps at 50, that's fine for freight v1 but flag the constraint for future-consumer planning (artwork files will exceed 50 MB).

---

## Mark-Accepted immutability commitment (freight-specific)

PDFs need to travel with the Mark-Accepted snapshot when Slot 8 (Mark-Accepted external writebacks) lands. **This slice doesn't implement snapshot wiring** — Slot 8 owns that.

What this slice commits for freight:

1. **`freight_leg_attachments` join row is serializable into the snapshot** — Slot 8 reads association data when it wires the snapshot
2. **Attachments are immutable post-accept** — `replaceForwarderPdf` and `removeForwarderPdf` block when the referenced leg's quote is in Mark-Accepted state (action guard, server-side)
3. **No deletion of referenced attachments** — FK constraint prevents `removeAttachment` while a join row references the attachment

**Other consumers** (artwork on SKUs, invoices, proofs) define their own immutability rules. The library doesn't enforce; each consumer's action wrappers do.

---

## Verify script extensions

- `realtime-readiness.ts` — add `attachments` + `freight_leg_attachments` to TABLES list
- `r6-2-commit2-sweep.ts` — no change; still useful as regression check
- New: `attachment-library.ts` — generic library smoke checks:
  - `attachments` table exists
  - Storage bucket `attachments` exists
  - RLS policies present (3 policies: INSERT / SELECT / DELETE)
  - `uploadAttachment` primitive works end-to-end against a test fixture
  - `removeAttachment` correctly blocked when a join row references it
- New: `freight-pdf-integration.ts` — freight-specific integration checks:
  - `freight_leg_attachments` table exists with correct shape
  - Unique index on `(freight_leg_id) WHERE role = 'forwarder_quote'` works
  - `attachForwarderPdf` wrapper composes with library primitive correctly
  - Mark-Accepted immutability guard blocks replace/remove on accepted quotes

---

## What's NOT changing

- Math contract, customs visibility rule, per-component markup, multi-leg, customer-arranges mode, modal centered popup, panel embedded in Setup, 5 Edward-locked CD decisions.
- Commit 4 (was commit 3) scope unchanged: `freight_inputs` DROP + `freight_mode` enum DROP + schema.ts cleanup + CLAUDE.md grep.
- Mark-Accepted snapshot wiring stays in Slot 8.

---

## Open questions for CC

If any of these have non-obvious answers, surface them in the chat before implementing — do not gap-fill:

1. **Supabase plan tier.** Confirm current plan supports 100 MB uploads (or 50 MB at minimum for freight v1). If at the 50 MB tier, surface the constraint for Edward's awareness — artwork at the next library consumer will require either a plan upgrade or per-file chunking.
2. **Bucket name conflict check.** Confirm `attachments` is not already taken by an existing bucket. If yes, propose alternative.
3. **RLS shape compatibility.** Confirm the org-scoped RLS via path prefix composes with existing RLS patterns in the repo. If existing tables use a different RLS shape (e.g., quote-scoped instead of org-scoped), align with the dominant pattern rather than introducing a new one.
4. **`<AttachmentSlot />` primitive extraction.** Extract during commit 3, or fold into freight UI now and extract on second consumer? Bias: fold for v1, extract on next consumer. Surface if you see strong reason to extract now.
5. **`organizations` table existence.** The schema references `org_id uuid references organizations(id)`. Confirm this table exists; if the codebase uses a different tenant-isolation pattern (e.g., `workspaces`, `accounts`), align with that. If no tenant table exists yet, **flag immediately** — that's a much bigger scope decision than a freight slice can answer.
6. **Replace storage cleanup behavior.** When a PDF is replaced, the new attachment row gets created. The old attachment row becomes orphan (no join row points to it). Two options for the old storage object: (a) delete immediately (storage cost cleanup; lose forensic recovery); (b) keep until a cleanup job runs. Bias: delete immediately. Confirm.
7. **Storage cleanup job placeholder.** Library accepts orphan attachments as cleanup-later debt. Add UX_BACKLOG entry for "periodic orphan-attachment cleanup job" — log it, don't implement.

---

## Effort estimate

Library shape is more substantial than freight-specific. Revised estimate: **2-3 days CC work.**

- Schema migration: ~30 min (table + indexes + manual SQL for publication)
- Storage bucket + RLS: ~2 hours (Supabase config + RLS policy SQL)
- Generic library actions (`uploadAttachment`, `getAttachment`, `removeAttachment`): ~3 hours
- Freight-specific wrappers (3 actions + Mark-Accepted guards): ~2 hours
- UI integration (slot empty + populated states, file picker, replace flow): ~4 hours
- Validation (size + MIME, per-entity-role overrides): ~2 hours
- Verify scripts (library + freight integration): ~2 hours
- Smoke + iteration: ~4 hours

If anything surfaces that takes longer than 3 days, surface it — possibly split commit 3 into 3a (library infra) + 3b (freight integration) if complexity warrants.

---

## Sequencing

1. CC answers the 7 open questions (some via repo inspection, some may need Edward disposition — surface what needs Edward)
2. Commit 3 implementation (library + freight integration in one cohesive commit, or 3a+3b if split needed)
3. Commit 3 smoke (file upload works end-to-end; populated state renders; replace/remove work; immutability guard blocks on Mark-Accepted state; library primitive callable from a synthetic future-consumer test)
4. Commit 4 lands as legacy `freight_inputs` cleanup (previous commit 3 scope unchanged)
5. Slice closes; ready for review + merge to main

Standing by. Ping when CC has answered the 7 questions and is ready to implement, or if any need Edward disposition.
