"use client";

// Pricing Reframe v1 — shared client state for the top-band components.
//
// Steps 8 + 9 introduce two pieces of cross-component state that
// the existing CostingStore doesn't track:
//
//   - applyingTierIds:  Set<tierId> — tiers currently in-flight on
//                       an apply action. Drives TierComplianceBlock's
//                       row tint (`applying` class) + APPLYING…
//                       chip; drives SuggestionEngine button-disable
//                       state.
//   - lastApply:        { tierIds, deltaPpByTier, optionLabel } | null
//                       — last successful apply summary. Drives
//                       ApplyToast render + TierComplianceBlock's
//                       row tint (`changed` class) + delta chip.
//                       Persists until next apply (per brief §4.6
//                       "persist-until-next-action; no fade-out
//                       timer"); cleared when a new apply starts.
//
// Context is the right shape (not Zustand) — state is page-scoped,
// not shared across surfaces, not persisted across navigations.
// Plain React Context keeps it simple.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LastApplySummary = {
  tierIds: string[];
  deltaPpByTier: Record<string, number>;
  optionLabel: string;
  auditRef: string | null;
};

type ReframeState = {
  applyingTierIds: ReadonlySet<string>;
  lastApply: LastApplySummary | null;
  // Bug #3 fix: error toast surfaces failed apply at the same level
  // as the success toast. Ephemeral; cleared on next beginApply or
  // explicit dismiss.
  lastApplyError: string | null;
  beginApply: (tierIds: string[]) => void;
  finishApply: (summary: LastApplySummary) => void;
  failApply: (message: string) => void;
  abortApply: () => void;
};

const Ctx = createContext<ReframeState | null>(null);

export function ReframeStateProvider({ children }: { children: ReactNode }) {
  const [applyingTierIds, setApplyingTierIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [lastApply, setLastApply] = useState<LastApplySummary | null>(null);
  const [lastApplyError, setLastApplyError] = useState<string | null>(null);

  const beginApply = useCallback((tierIds: string[]) => {
    setApplyingTierIds(new Set(tierIds));
    // Clear both toasts when a new apply starts (persist-until-next-
    // action; new action begins → prior surface clears).
    setLastApply(null);
    setLastApplyError(null);
  }, []);

  const finishApply = useCallback((summary: LastApplySummary) => {
    setApplyingTierIds(new Set());
    setLastApply(summary);
    setLastApplyError(null);
  }, []);

  const failApply = useCallback((message: string) => {
    setApplyingTierIds(new Set());
    setLastApply(null);
    setLastApplyError(message);
  }, []);

  const abortApply = useCallback(() => {
    setApplyingTierIds(new Set());
  }, []);

  const value = useMemo<ReframeState>(
    () => ({
      applyingTierIds,
      lastApply,
      lastApplyError,
      beginApply,
      finishApply,
      failApply,
      abortApply,
    }),
    [
      applyingTierIds,
      lastApply,
      lastApplyError,
      beginApply,
      finishApply,
      failApply,
      abortApply,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReframeState(): ReframeState {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useReframeState must be used inside <ReframeStateProvider>",
    );
  }
  return v;
}
