-- canonical-scenario-create-flow — Storage bucket + RLS policies
--
-- Pairs with drizzle/0031_canonical_scenario_create_schema.sql.
-- Apply AFTER the schema migration lands (storage policies don't
-- reference the new columns/table, but the slice ships them
-- together).
--
-- Bucket: quote-attachments
--   - Private bucket (not public)
--   - Authenticated users have read/insert/delete via policy
--   - File path convention: {quote_id}/{uuid}-{filename}
--   - File size + MIME validation enforced at action layer
--     (addQuoteAttachment server action; 25 MB cap; allowlist
--     of PDF / Word / Excel / images / plain text)
--
-- Idempotent: ON CONFLICT (id) DO NOTHING for the bucket insert;
-- IF NOT EXISTS guards on policy creates. Safe to re-run.
--
-- Per CLAUDE.md "Single Supabase project" — applying writes to
-- shared dev/prod. Edward authorization required (matches prior
-- manual SQL apply posture).

begin;

-- Create the bucket (private; not public).
insert into storage.buckets (id, name, public)
values ('quote-attachments', 'quote-attachments', false)
on conflict (id) do nothing;

-- RLS: authenticated users can read attachments in this bucket.
-- Drop existing policy (if any) before creating; Postgres has no
-- IF NOT EXISTS on CREATE POLICY pre-PG15.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can read quote attachments'
  ) then
    drop policy "Authenticated users can read quote attachments"
      on storage.objects;
  end if;
end $$;

create policy "Authenticated users can read quote attachments"
  on storage.objects for select
  using (auth.role() = 'authenticated' and bucket_id = 'quote-attachments');

-- RLS: authenticated users can upload (INSERT) to this bucket.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can upload quote attachments'
  ) then
    drop policy "Authenticated users can upload quote attachments"
      on storage.objects;
  end if;
end $$;

create policy "Authenticated users can upload quote attachments"
  on storage.objects for insert
  with check (auth.role() = 'authenticated' and bucket_id = 'quote-attachments');

-- RLS: authenticated users can delete attachments.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Authenticated users can delete quote attachments'
  ) then
    drop policy "Authenticated users can delete quote attachments"
      on storage.objects;
  end if;
end $$;

create policy "Authenticated users can delete quote attachments"
  on storage.objects for delete
  using (auth.role() = 'authenticated' and bucket_id = 'quote-attachments');

commit;
