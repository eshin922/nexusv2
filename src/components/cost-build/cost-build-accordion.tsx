"use client";

import { createContext, useCallback, useContext, useState } from "react";

// Slice RI.4 — Client-side accordion state holder for cost-build
// sections. Replaces URL-driven section toggle (was causing full
// server-rerender of all 11 queries on every section click → 8-16s
// lag per Edward smoke item (a)).
//
// Behavior:
//   - Single open section at a time (preserves Round 6 constraint;
//     Edward deferred multi-open as (b) to Designer/CA review)
//   - All drawer content stays mounted server-side; CSS hides/shows
//   - URL searchParam updated via window.history.replaceState (no
//     navigation; deep-link survives page refresh)
//   - Click on already-open section closes it
//
// Provides context: open section id + setter. Consumed by
// <SectionWithDrilldown> via useCostBuildAccordion().

type AccordionContext = {
  openId: string | null;
  setOpenId: (id: string | null) => void;
  projectId: string;
  quoteId: string;
};

const Ctx = createContext<AccordionContext | null>(null);

export function CostBuildAccordion({
  initialOpen,
  projectId,
  quoteId,
  children,
}: {
  initialOpen: string;
  projectId: string;
  quoteId: string;
  children: React.ReactNode;
}) {
  const [openId, setOpenIdState] = useState<string | null>(initialOpen);

  const setOpenId = useCallback(
    (id: string | null) => {
      setOpenIdState(id);
      // Update URL without triggering Next.js navigation (avoids
      // server re-render). Deep-link survives page refresh.
      if (typeof window !== "undefined") {
        const base = `/projects/${projectId}/quotes/${quoteId}/cost-build`;
        const url = id ? `${base}?section=${id}` : base;
        window.history.replaceState({}, "", url);
      }
    },
    [projectId, quoteId],
  );

  return (
    <Ctx.Provider value={{ openId, setOpenId, projectId, quoteId }}>
      <div className="r6-sections flex flex-col" style={{ gap: "14px" }}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useCostBuildAccordion() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useCostBuildAccordion must be used within <CostBuildAccordion>",
    );
  }
  return ctx;
}
