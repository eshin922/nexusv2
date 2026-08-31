"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { installLifecycleTrace, trace } from "@/lib/diagnostics/lifecycle-trace";

/**
 * Mount/unmount probes for the lifecycle trace. Temporary — see
 * `src/lib/diagnostics/lifecycle-trace.ts` for what this is diagnosing.
 *
 * Two probes rather than one, because the distinction they draw is the point:
 * the SHELL probe sits in the root layout and the PAGE probe sits on a
 * particular page. If the page probe remounts while the shell probe does not,
 * the page was replaced beneath a stable shell. If both remount with the same
 * document id, React remounted the tree. If the document id changes, the
 * browser reloaded and neither probe's "remount" means what it looks like.
 */

/** Root-layout probe. Installs the listeners and records shell lifecycle. */
export function LifecycleTraceShell() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const first = useRef(true);

  useEffect(() => {
    installLifecycleTrace();
    trace("shell:mount");
    return () => trace("shell:unmount");
  }, []);

  // Route identity as React sees it. A change here without a `document:load`
  // is a client navigation; a change WITH one is a document replacement.
  useEffect(() => {
    trace(first.current ? "route:initial" : "route:change", {
      search: searchParams.toString(),
    });
    first.current = false;
  }, [pathname, searchParams]);

  return null;
}

/**
 * Page-level probe. `name` identifies which page, so a Costs remount is
 * distinguishable from a Pricing one in the dump.
 */
export function LifecycleTracePage({ name }: { name: string }) {
  useEffect(() => {
    trace("page:mount", { name });
    return () => trace("page:unmount", { name });
  }, [name]);

  return null;
}
