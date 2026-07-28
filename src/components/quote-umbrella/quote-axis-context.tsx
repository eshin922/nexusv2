"use client";

// Slice 12 Step 5d — PDF axis state lifted to context.
//
// Before Step 5d, QuoteHost held pdfLayout / detailLevel / addendumOn
// as local React state and passed to PreviewToolbar (for toggles) +
// SendButton (for FormData at send time). That worked when Preview
// and Send were the same surface. Once Send moved to its own sub-tab
// (Step 5c), the two components can't share local state — they're
// sibling children of QuoteUmbrella, not a common parent.
//
// This context lifts the axis state to QuoteUmbrella (the shell)
// initialized from server-resolved values on view (page.tsx already
// derives them from searchParams, so deep-link initialization is
// preserved). Toggles on Preview update context; Send reads context
// at send time.
//
// URL sync trade-off:
//   - Chose context (not URL query params) to avoid RSC refetch on
//     every toggle. The costing bundle re-fetch in page.tsx is ~200-
//     500ms; toggling addendum should feel instant.
//   - Deep-link initialization via ?layout=X&detail=Y&addendum=Z
//     still works (page.tsx reads searchParams → seeds view.X).
//   - Downside: post-load toggles don't rewrite URL, so a PM's
//     current toggle state isn't shareable via URL after they've
//     interacted with the toggles. Acceptable v1; if it matters
//     later, we can add a debounced URL push.

import { createContext, useContext, useState } from "react";
import type {
  CustomerViewDetailLevel,
  CustomerViewPdfLayout,
} from "@/types/quote";

type QuoteAxisState = {
  pdfLayout: CustomerViewPdfLayout;
  detailLevel: CustomerViewDetailLevel;
  includeSpecAddendum: boolean;
  setPdfLayout: (v: CustomerViewPdfLayout) => void;
  setDetailLevel: (v: CustomerViewDetailLevel) => void;
  setIncludeSpecAddendum: (v: boolean) => void;
};

const Ctx = createContext<QuoteAxisState | null>(null);

export function QuoteAxisProvider({
  initialPdfLayout,
  initialDetailLevel,
  initialIncludeSpecAddendum,
  children,
}: {
  initialPdfLayout: CustomerViewPdfLayout;
  initialDetailLevel: CustomerViewDetailLevel;
  initialIncludeSpecAddendum: boolean;
  children: React.ReactNode;
}) {
  const [pdfLayout, setPdfLayout] =
    useState<CustomerViewPdfLayout>(initialPdfLayout);
  const [detailLevel, setDetailLevel] =
    useState<CustomerViewDetailLevel>(initialDetailLevel);
  const [includeSpecAddendum, setIncludeSpecAddendum] = useState<boolean>(
    initialIncludeSpecAddendum,
  );

  return (
    <Ctx.Provider
      value={{
        pdfLayout,
        detailLevel,
        includeSpecAddendum,
        setPdfLayout,
        setDetailLevel,
        setIncludeSpecAddendum,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useQuoteAxis(): QuoteAxisState {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useQuoteAxis called outside <QuoteAxisProvider>");
  }
  return v;
}
