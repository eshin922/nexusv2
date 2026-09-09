/**
 * The customer-mapping panel's state, as a pure machine.
 *
 * ── WHY EVERY ASYNC RESULT CARRIES A TICKET ───────────────────────────────
 *
 * Three of the rules here are RACES, and they share one shape: work is started
 * against a panel, and by the time it finishes the panel may be showing
 * something else. Admitting the result then corrupts what the admin sees, and
 * what they are about to write:
 *
 *   · search A -> switch to B -> A's candidates render under B's heading, and
 *     "Use this customer" maps B to A's customer;
 *   · search A -> close -> REOPEN A -> the first response is still in flight
 *     and its company still matches, so a company check alone readmits it;
 *   · save A -> open B -> A resolves -> B's panel closes, or shows A's error.
 *
 * The second is why a `panelEpoch` exists rather than only a company id. Every
 * open and every close mints a new epoch, so a reopened panel is a DIFFERENT
 * session from the one whose work is still outstanding, even though it is the
 * same company.
 *
 * ── WHY THE EPOCH IS MINTED BY THE CALLER ─────────────────────────────────
 *
 * The component holds the counters in refs and passes the new value in. That
 * is not ceremony: the first version derived a ticket INSIDE a `setSession`
 * updater and read it back immediately, and React does not run updaters
 * synchronously — so the ticket was still null when the request would have
 * been issued, and clicking Search produced no request at all. Nothing in the
 * pure rules could have caught that, because the rules were never reached.
 *
 * Counters that must be readable at the instant of the click belong in a ref.
 * These functions therefore take the minted value rather than deriving it.
 */

export type SearchOutcome =
  | {
      state: "ok";
      candidates: readonly {
        netsuiteCustomerId: string;
        entityId: string | null;
        companyName: string | null;
        inactive: boolean;
      }[];
    }
  | { state: "unavailable"; detail: string };

/** Names the panel session and the search a response belongs to. */
export type SearchTicket = {
  epoch: number;
  seq: number;
  companyId: string;
  query: string;
};

/** Names the panel session a save was started from. */
export type SaveTicket = {
  epoch: number;
  companyId: string;
  netsuiteCustomerId: string;
};

export type SessionState = {
  openCompanyId: string | null;
  /** Bumped on every open and every close. Identifies THIS panel session. */
  panelEpoch: number;
  /** The most recently issued search. Monotonic; never reset. */
  searchSeq: number;
  query: string;
  results: { ticket: SearchTicket; outcome: SearchOutcome } | null;
  /**
   * A failure the admin must see WITHOUT the panel closing.
   *
   * An earlier version rendered this only when the panel was shut, so a failed
   * save produced no feedback at all: the admin clicked, nothing happened, and
   * the reason sat in a variable no branch displayed.
   */
  panelError: string | null;
  saving: boolean;
};

export const initialSession: SessionState = {
  openCompanyId: null,
  panelEpoch: 0,
  searchSeq: 0,
  query: "",
  results: null,
  panelError: null,
  saving: false,
};

/**
 * Open the panel for a company under a fresh epoch.
 *
 * Results are dropped rather than carried over, and any work outstanding from
 * a previous session — including a previous session on THIS company — can no
 * longer be admitted.
 */
export function openPanel(
  s: SessionState,
  companyId: string,
  query: string,
  epoch: number,
): SessionState {
  return {
    ...s,
    openCompanyId: companyId,
    panelEpoch: epoch,
    query,
    results: null,
    panelError: null,
    saving: false,
  };
}

export function closePanel(s: SessionState, epoch: number): SessionState {
  return {
    ...s,
    openCompanyId: null,
    panelEpoch: epoch,
    results: null,
    panelError: null,
    saving: false,
  };
}

export function setQuery(s: SessionState, query: string): SessionState {
  return { ...s, query };
}

/** Record that a search went out. The ticket was minted by the caller. */
export function noteSearchIssued(
  s: SessionState,
  ticket: SearchTicket,
): SessionState {
  return { ...s, searchSeq: ticket.seq, panelError: null };
}

/**
 * May this response be shown?
 *
 * Three conditions, none implied by the others: the company must still be the
 * open one, the panel session must be the one that asked, and this must be the
 * most recent search of it.
 */
export function shouldAcceptSearch(
  s: SessionState,
  ticket: SearchTicket,
): boolean {
  if (s.openCompanyId === null) return false;
  if (ticket.companyId !== s.openCompanyId) return false;
  if (ticket.epoch !== s.panelEpoch) return false;
  return ticket.seq === s.searchSeq;
}

/** Apply a response, or leave the state untouched when it is stale. */
export function receive(
  s: SessionState,
  ticket: SearchTicket,
  outcome: SearchOutcome,
): SessionState {
  if (!shouldAcceptSearch(s, ticket)) return s;
  return { ...s, results: { ticket, outcome } };
}

/**
 * The candidates safe to display right now.
 *
 * Re-checks ownership at READ time rather than trusting that only accepted
 * responses were ever stored. The two are the same today; they stop being the
 * same the moment anyone adds a second writer.
 */
export function visibleCandidates(s: SessionState): SearchOutcome | null {
  if (!s.results || s.openCompanyId === null) return null;
  if (s.results.ticket.companyId !== s.openCompanyId) return null;
  if (s.results.ticket.epoch !== s.panelEpoch) return null;
  return s.results.outcome;
}

/**
 * May this customer be mapped to this company right now?
 *
 * The last gate before a write that decides who gets invoiced.
 */
export function canChoose(
  s: SessionState,
  companyId: string,
  netsuiteCustomerId: string,
): boolean {
  if (s.saving) return false;
  if (s.openCompanyId !== companyId) return false;
  const outcome = visibleCandidates(s);
  if (!outcome || outcome.state !== "ok") return false;
  return outcome.candidates.some(
    (c) => c.netsuiteCustomerId === netsuiteCustomerId,
  );
}

/** Does this save result still belong to the panel on screen? */
export function shouldAcceptSaveResult(
  s: SessionState,
  ticket: SaveTicket,
): boolean {
  return (
    s.openCompanyId === ticket.companyId && s.panelEpoch === ticket.epoch
  );
}

export function beginSave(s: SessionState, ticket: SaveTicket): SessionState {
  if (!shouldAcceptSaveResult(s, ticket)) return s;
  return { ...s, saving: true, panelError: null };
}

/** A failure keeps the panel OPEN, with the reason where the click happened. */
export function saveFailed(
  s: SessionState,
  ticket: SaveTicket,
  detail: string,
): SessionState {
  if (!shouldAcceptSaveResult(s, ticket)) return s;
  return { ...s, saving: false, panelError: detail };
}

/**
 * Success closes the originating panel.
 *
 * If the admin has since moved to another company, this does nothing --
 * closing the panel they are now working in, because a different save
 * finished, is the same class of defect as showing them its error.
 *
 * -- WHY THIS DOES NOT MINT A NEW EPOCH ------------------------------------
 *
 * An earlier version took one, and the caller computed it as
 * `++epochRef.current` BEFORE calling. That bump was unconditional while the
 * acceptance below is not, so a stale completion that was correctly rejected
 * still advanced the counter -- leaving the ref ahead of `panelEpoch`. Every
 * subsequent search and save on the panel the admin was actually using then
 * minted a ticket that could never match, and was silently discarded. The
 * ownership check protected the state while the counter moved out from under
 * it.
 *
 * No epoch is needed. Clearing `openCompanyId` already refuses outstanding
 * work from this session, and the next `openPanel` mints a fresh epoch anyway.
 *
 * The general rule, and the reason the parameter is GONE rather than guarded:
 * ASYNC COMPLETIONS NEVER MINT EPOCHS. Only `openPanel` and `closePanel` do,
 * because only they are synchronous user actions whose ownership is not in
 * question.
 */
export function saveSucceeded(
  s: SessionState,
  ticket: SaveTicket,
): SessionState {
  if (!shouldAcceptSaveResult(s, ticket)) return s;
  return {
    ...s,
    saving: false,
    panelError: null,
    openCompanyId: null,
    results: null,
  };
}
