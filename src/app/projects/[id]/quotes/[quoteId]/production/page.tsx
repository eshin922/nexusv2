import { redirect } from "next/navigation";

// Slice RI.4 — Costs unified into single page at /costs.
// /packaging, /production, /freight redirect for muscle-memory + any
// stale links. The production-section.tsx component in this directory
// is still consumed by the new <ProductionDrilldown> at /costs.
export default async function ProductionRedirect({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;
  redirect(`/projects/${id}/quotes/${quoteId}/costs?section=production`);
}
