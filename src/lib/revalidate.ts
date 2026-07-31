import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Revalidate every page in the quote tree. Call from any action that
 * mutates tier or SKU structure (or anything else that might affect what's
 * rendered on a sibling cost-input page). Edits scoped to a single
 * sub-page should still revalidate just that path.
 *
 * As future cost-input slices add new sub-pages, append them here.
 */
export function revalidateQuoteTree(projectId: string, quoteId: string) {
  const base = `/projects/${projectId}/quotes/${quoteId}`;
  revalidatePath(base);
  revalidatePath(`${base}/packaging`);
  revalidatePath(`${base}/production`); // Slice 6
  revalidatePath(`${base}/freight`); // Slice 7
  revalidatePath(`${base}/pricing`); // Slice 8
  revalidatePath(`${base}/costs`); // Slice RI.4
  revalidatePath(`${base}/quote`); // Slice RI.6 (snapshot reads)
  revalidatePath(`${base}/mark-accepted`); // Slice RI.6 (sub-state derivation)
}

/**
 * Lifecycle mutations also change the organizer projection and project
 * activity feed. Keep these invalidations separate from revalidateQuoteTree:
 * per-cell costing autosaves must never remount project/home surfaces and
 * cancel a sibling cell's pending debounce.
 */
export function revalidateQuoteLifecycleSurfaces(
  projectId: string,
  quoteId: string,
) {
  revalidateQuoteTree(projectId, quoteId);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}
