import { redirect } from "next/navigation";

// Slice RI.4 — Cost Build unified into single page at /cost-build.
// /packaging, /production, /freight redirect for muscle-memory + any
// stale links. The production-section.tsx component in this directory
// is still consumed by the new <ProductionDrilldown> at /cost-build.
export default async function ProductionRedirect({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;
  redirect(`/projects/${id}/quotes/${quoteId}/cost-build?section=production`);
}
