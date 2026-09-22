import { redirect } from "next/navigation";
import { COSTS_M3_PREVIEW_VALUE } from "@/lib/costs/m2-preview-switch";

/** Compatibility redirect for bookmarks created before Setup handed directly to Costs. */
export default async function SetupReviewCompatibilityRedirect({
  params,
}: {
  params: Promise<{ id: string; quoteId: string }>;
}) {
  const { id, quoteId } = await params;
  redirect(`/projects/${id}/quotes/${quoteId}/costs?preview=${COSTS_M3_PREVIEW_VALUE}`);
}
