"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { evaluateChargeRecovery } from "@/app/actions/commercial-recovery-evaluate";
import { persistChargeRecoverySet } from "@/app/actions/commercial-recovery-persist";
import type { RecoveryChargeRow } from "@/lib/commercial-recovery/workspace-view";
import type { AuthoritativeProjection } from "./authoritative-projection";
import { runGoverned } from "@/lib/governed-action";

/** How long the draft waits before saving. Long enough that trying three
 *  placements in a row is one write; short enough that an operator who elects
 *  and immediately reaches for Finalize rarely waits on the flush. */
const SAVE_DEBOUNCE_MS = 600;

export type RecoveryElection = {
  chargeKey: string;
  /**
   * Present for a component-owned charge; absent for a legacy production
   * column, whose type IS its identity.
   *
   * A GROUP ACTION sends N of these, one per instance. There is no type-level
   * election to send — a group is ergonomics, not a grain.
   */
  chargeInstanceId?: string;
  mode: string;
};

/**
 * The ONE place a draft election is identified.
 *
 * The set is diffed, filtered and de-duplicated by this key, and a second
 * implementation of it would let two of those disagree — the same reason the
 * action layer routes both its evaluator and its writer through one former.
 */
export function electionKey(e: {
  chargeKey: string;
  chargeInstanceId?: string;
}): string {
  return e.chargeInstanceId ?? e.chargeKey;
}

/**
 * Why a proposal did not take.
 *
 * `refused` is the ENGINE's answer and its `message` is authoritative — the
 * election is wrong and changing it is the operator's next move. `unreachable`
 * means the engine never answered, so nothing is known about the election
 * itself and retrying is the next move. Collapsing the two into one string
 * would tell the operator to do one when they need the other.
 */
export type RecoveryProposalFailure = {
  kind: "refused" | "unreachable";
  message: string;
};

export type RecoveryDraftState =
  /** Everything on screen is stored. */
  | { status: "clean" }
  /** Evaluated and shown; the write has not landed yet. */
  | { status: "saving" }
  /**
   * Evaluated and shown, and the write FAILED. The projection stays — it is
   * the governed answer to what the operator asked — but nothing downstream of
   * an election may proceed until it is durable.
   */
  | { status: "unsaved"; message: string };

/**
 * Evaluate first, persist after.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────
 *
 * The election used to be written before anything could be evaluated, so the
 * operator waited on a database round trip and a full page render to learn what
 * their own click had done — 1994-4041ms on production, during which the
 * control looked like it had not worked. It was reported as broken, repeatedly.
 *
 * ── THE THREE STATES, AND WHY EACH IS DISTINCT ──────────────────────────
 *
 *   clean    what is on screen is what is stored.
 *   saving   the governed result is on screen; the write is still in flight.
 *            No commercial number will change when it lands — the evaluation
 *            and the persistence are the same election.
 *   unsaved  the write FAILED. The result stays visible, because it is a true
 *            answer to a real question, but it is not durable and the surface
 *            says so. Approval and Finalize are refused until it is.
 *
 * The distinction that matters is `saving` versus `unsaved`. Collapsing them
 * into one "not saved yet" would make a transient half-second look identical to
 * a write that will never land.
 *
 * ── ONE PROJECTION, BOTH SURFACES ───────────────────────────────────────
 *
 * `onAuthoritative` hands back the SAME object Card 1 and the customer document
 * both render from. They cannot disagree because there is only one of it —
 * which is the whole point: a faster surface that let one get ahead of the
 * other would rebuild the trust problem in a shorter timeframe.
 *
 * ── FLUSH IS A FACT, NOT A DELAY ────────────────────────────────────────
 *
 * `flush` cancels the timer, persists the exact current set, and reads it back.
 * "Wait for the debounce to settle" would wait on a clock rather than on
 * storage, and a write that failed while the clock ran still elapses.
 */
export function useRecoveryDraft(input: {
  quoteId: string;
  rows: readonly RecoveryChargeRow[];
  onAuthoritative: (p: AuthoritativeProjection) => void;
}) {
  const { quoteId, rows, onAuthoritative } = input;

  const [state, setState] = useState<RecoveryDraftState>({ status: "clean" });
  /** The set the operator has asked for. Null while nothing is proposed, in
   *  which case the stored set is authoritative and a flush is a no-op. */
  const proposed = useRef<RecoveryElection[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** The elections currently in force, from the governed rows. */
  const electedNow = useCallback(
    (): RecoveryElection[] =>
      rows
        .filter((r) => r.electedMode !== null)
        .map((r) => ({
          chargeKey: r.chargeKey,
          // Carried, so a component charge's election stays addressed to the
          // charge rather than to every charge of its type.
          ...(r.chargeInstanceId ? { chargeInstanceId: r.chargeInstanceId } : {}),
          mode: r.electedMode as string,
        })),
    [rows],
  );

  const save = useCallback(async (set: RecoveryElection[]) => {
    const seq = ++inFlight.current;
    const res = await runGoverned(() =>
      persistChargeRecoverySet({ quoteId, elections: set }),
    );
    // A stale answer must not clear a newer pending write, or a fast save
    // landing behind a slow one would report the quote clean while the later
    // election is still unwritten.
    if (seq !== inFlight.current) return false;
    if (res.kind !== "ok") {
      // `unsaved` for BOTH refusal and unreachable, and that is correct: the
      // elections are not known to be durable either way, and `unsaved` is the
      // state the finalize gate reads to refuse freezing an artifact built
      // from them. Only the sentence differs.
      setState({ status: "unsaved", message: res.message });
      return false;
    }
    if (!res.data.matchesRequested) {
      // The write returned, and the database does not hold what was asked for.
      // Reporting `clean` here would be the surface trusting its own request
      // over the read-back that exists to check it.
      setState({
        status: "unsaved",
        message: "The saved elections do not match what is on screen. Reload before continuing.",
      });
      return false;
    }
    proposed.current = null;
    setState({ status: "clean" });
    return true;
  }, [quoteId]);

  /**
   * Apply one election and show its governed consequence.
   *
   * Returns the error the ENGINE gave, if it refused. A refusal is not a save
   * failure: nothing was proposed, so nothing is pending.
   */
  const propose = useCallback(
    async (
      /**
       * One or more picks, applied as a SET.
       *
       * A single click sends one. A GROUP ACTION sends one per instance — N
       * governed writes composed into the same proposal, so the operator's one
       * gesture is still one evaluation and one save. `null` relinquishes.
       */
      picks: { chargeKey: string; chargeInstanceId?: string }[],
      mode: string | null,
    ): Promise<RecoveryProposalFailure | null> => {
      const base = proposed.current ?? electedNow();
      const touched = new Set(picks.map(electionKey));
      const next = base.filter((e) => !touched.has(electionKey(e)));
      if (mode !== null) {
        for (const pick of picks) {
          next.push({
            chargeKey: pick.chargeKey,
            ...(pick.chargeInstanceId
              ? { chargeInstanceId: pick.chargeInstanceId }
              : {}),
            mode,
          });
        }
      }

      // RECORDED BEFORE THE AWAIT, so a second click composes onto this one.
      //
      // It used to be set after the evaluation returned, and a click arriving
      // while the first was still in flight read `electedNow()` instead — the
      // rows, which still showed the pre-election state. The second proposal
      // then silently DROPPED the first.
      //
      // Measured on production: electing Artwork & plate and then Other service
      // 250ms apart left `artwork_plate` unchanged in the database. The
      // evaluation takes seconds, so the window is not a race an operator has
      // to be quick to hit — it is most of the interaction.
      const previous = proposed.current;
      proposed.current = next;
      setState({ status: "saving" });

      const res = await runGoverned(() =>
        evaluateChargeRecovery({ quoteId, elections: next }),
      );
      if (res.kind !== "ok") {
        // Refused, OR never evaluated at all. BOTH roll back.
        //
        // The rollback used to hang off the refusal branch alone, and
        // `proposed.current` is written BEFORE the await so that a second
        // click composes onto the first. A rejection therefore skipped it and
        // left a set recorded that the engine had never evaluated — which the
        // debounced `save` would then have persisted as though it had been
        // approved. An unevaluated election reaching the database is a
        // commercial-state mutation on failure, not a display defect.
        if (proposed.current === next) {
          proposed.current = previous;
          setState(previous === null ? { status: "clean" } : { status: "saving" });
        }
        return {
          kind: res.kind === "unreachable" ? "unreachable" : "refused",
          message: res.message,
        };
      }

      // A newer proposal landed while this evaluation was in flight; its answer
      // is the current one and this stale projection must not overwrite it.
      if (proposed.current !== next) return null;

      // The surface catches up NOW, before anything is written.
      onAuthoritative(res.data);

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void save(next);
      }, SAVE_DEBOUNCE_MS);
      return null;
    },
    [quoteId, electedNow, onAuthoritative, save],
  );

  /**
   * Persist the current set NOW and confirm it landed.
   *
   * Both gates call this unconditionally. With nothing proposed it is a no-op
   * that reports success, so the gates do not have to know whether a save is
   * pending — they only have to know the answer.
   */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const set = proposed.current;
    if (set === null) return state.status !== "unsaved";
    setState({ status: "saving" });
    return save(set);
  }, [save, state.status]);

  return { state, propose, flush };
}
