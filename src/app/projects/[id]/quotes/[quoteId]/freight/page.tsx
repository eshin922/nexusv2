import { redirect } from "next/navigation";

// Slice RI.4 — Costs unified into single page at /costs.
// /packaging, /production, /freight redirect for muscle-memory + any
// stale links. Slice R6.2 commit 2 retired the original line-row
// components (freight-line-row.tsx, customs-row.tsx, add-line-button.tsx)
// — the new <FreightDrilldown> at /costs is built against the
// multi-leg journey schema and renders legs + customs cluster inline.
export default async function FreightRedirect({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;
  redirect(`/projects/${id}/quotes/${quoteId}/costs?section=freight`);
}
