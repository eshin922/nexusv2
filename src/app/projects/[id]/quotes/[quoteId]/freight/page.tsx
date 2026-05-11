import { redirect } from "next/navigation";

// Slice RI.4 — Cost Build unified into single page at /cost-build.
// /packaging, /production, /freight redirect for muscle-memory + any
// stale links. The line-row components in this directory
// (freight-line-row.tsx, customs-row.tsx, add-line-button.tsx) are
// still consumed by the new <FreightDrilldown> at /cost-build.
export default async function FreightRedirect({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;
  redirect(`/projects/${id}/quotes/${quoteId}/cost-build?section=freight`);
}
