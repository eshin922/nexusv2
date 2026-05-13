import { Eyebrow } from "./eyebrow";
import { Breadcrumb } from "./breadcrumb";
import { shouldShowBreadcrumb } from "@/lib/nav/surface-meta";
import type { SurfaceKey } from "@/lib/nav/surface-routes";

// Slice RI.9 step 11 audit fix (HIGH-2 helper reachability).
//
// Before this slice, `shouldShowBreadcrumb` and `shouldShowRail`
// were exported from `surface-meta.ts` and documented as the XOR
// enforcement points, but no production code called them. Each
// page hand-picked between <Eyebrow> and <Breadcrumb> at import
// time — dead-code helpers lying about an invariant.
//
// `<SurfaceChrome>` wires `shouldShowBreadcrumb(surfaceKey)` into
// the page-head chrome decision. Pages pass surfaceKey + segments
// + an optional Breadcrumb-specific `target` (Customer view's
// path-context); the component renders the right primitive.
//
// Used in tandem with `<NavShell>` (rail XOR enforcement):
//   - NavShell decides rail visibility on `shouldShowRail`
//   - SurfaceChrome decides eyebrow vs breadcrumb on `shouldShowBreadcrumb`
//   - Both helpers read the same SURFACE_META.railVisible field
//   - One config flip → both layers update
//
// Pages that currently import Eyebrow/Breadcrumb directly continue
// to work — this is an additive primitive. Migrate progressively
// where the surface-key context is naturally available.

export function SurfaceChrome({
  surfaceKey,
  segments,
  breadcrumbTarget,
  projectId,
  quoteId,
}: {
  surfaceKey: SurfaceKey;
  /** Eyebrow segments (only used when surface renders an eyebrow). */
  segments: React.ReactNode[];
  /**
   * Breadcrumb target (only used when surface renders a breadcrumb).
   * Required when shouldShowBreadcrumb(surfaceKey) === true.
   */
  breadcrumbTarget?: SurfaceKey;
  /** Required for breadcrumb path resolution. */
  projectId?: string;
  quoteId?: string;
}) {
  if (shouldShowBreadcrumb(surfaceKey)) {
    if (!breadcrumbTarget || !projectId || !quoteId) {
      throw new Error(
        `<SurfaceChrome surface="${surfaceKey}"> renders a breadcrumb but ` +
          `breadcrumbTarget / projectId / quoteId weren't supplied.`,
      );
    }
    return (
      <Breadcrumb
        target={breadcrumbTarget}
        projectId={projectId}
        quoteId={quoteId}
      />
    );
  }
  return <Eyebrow segments={segments} />;
}
