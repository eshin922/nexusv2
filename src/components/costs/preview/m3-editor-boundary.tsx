"use client";

import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type M3EditorField from "./editable-fields";

const LazyM3EditorField = lazy(() => import("./editable-fields"));
type M3EditorProps = ComponentProps<typeof M3EditorField>;

/** Keep write actions out of the read-only M2 bundle and its test graph. */
export function M3Editor({ ...props }: M3EditorProps) {
  return (
    <Suspense fallback={<span className="cm2-edit-loading" aria-hidden="true" />}>
      <LazyM3EditorField {...props} />
    </Suspense>
  );
}
