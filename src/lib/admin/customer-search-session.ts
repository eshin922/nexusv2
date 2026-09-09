/**
 * The customer-mapping panel's state, as a pure machine.
 *
 * ── WHY THIS IS NOT JUST `useState` IN THE COMPONENT ──────────────────────
 *
 * Two of the three things this governs are RACES, and a race that lives only
 * inside a component is a race nothing can test. The first draft of the panel
 * held `candidates` in component state and wrote to it from an async handler,
 * which produces a real corruption path:
 *
 *   admin opens company A -> searches -> switches to company B while the
 *   response is still in flight -> A's candidates render under B's heading ->
 *   "Use this customer" maps B to A's customer.
 *
 * Nothing about that looks wrong on screen. The list is populated, the names
 * are real, and the mapping decides who gets invoiced.
 *
 * So every response carries a TICKET naming the company and the sequence it
 * was issued under, and a response is admitted only if both still hold. The
 * rule is one predicate, `shouldAccept`, and it is exercised directly.
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

/** Names the company and the search a response belongs to. */
export type SearchTicket = {
  seq: number;
  companyId: string;
  query: string;
};

export type SessionState = {
  /** The company whose panel is open, or null when the panel is closed. */
  openCompanyId: string | null;
  query: string;
  /** Monotonic. Every issued search takes the next value; never reset. */
  issued: number;
  /** The displayed response, tagged with the ticket that produced it. */
  results: { ticket: SearchTicket; outcome: SearchOutcome } | null;
  /**
   * A failure the admin must see WITHOUT the panel closing.
   *
   * The first draft set a message and rendered it only when the panel was
   * shut, so a failed save produced no visible feedback at all: the admin
   * clicked, nothing happened, and the reason sat in a variable no branch
   * displayed. Errors belong where the action was taken.
   */
  panelError: string | null;
  saving: boolean;
};

export const initialSession: SessionState = {
  openCompanyId: null,
  query: "",
  issued: 0,
  results: null,
  panelError: null,
  saving: false,
};

/**
 * Open the panel for a company.
 *
 * Results are dropped rather than carried over. `issued` is NOT reset — it is
 * the thing in-flight responses are compared against, so restarting it would
 * let a stale response match a later ticket by coincidence.
 */
export function openPanel(
  s: SessionState,
  companyId: string,
  query: string,
): SessionState {
  return {
    ...s,
    openCompanyId: companyId,
    query,
    results: null,
    panelError: null,
    saving: false,
  };
}

export function closePanel(s: SessionState): SessionState {
  return { ...s, openCompanyId: null, results: null, panelError: null, saving: false };
}

export function setQuery(s: SessionState, query: string): SessionState {
  return { ...s, query };
}

/** Take the next sequence number and hand back the ticket to quote on return. */
export function issueSearch(s: SessionState): {
  state: SessionState;
  ticket: SearchTicket;
} {
  const seq = s.issued + 1;
  const ticket: SearchTicket = {
    seq,
    companyId: s.openCompanyId ?? "",
    query: s.query,
  };
  return { state: { ...s, issued: seq, panelError: null }, ticket };
}

/**
 * May this response be shown?
 *
 * Both conditions are load-bearing and neither implies the other. The sequence
 * check discards a response superseded by a later search of the SAME company;
 * the company check discards one whose company is no longer open — including
 * the case where the admin closed the panel entirely.
 */
export function shouldAccept(s: SessionState, ticket: SearchTicket): boolean {
  if (s.openCompanyId === null) return false;
  if (ticket.companyId !== s.openCompanyId) return false;
  return ticket.seq === s.issued;
}

/** Apply a response, or leave the state untouched when it is stale. */
export function receive(
  s: SessionState,
  ticket: SearchTicket,
  outcome: SearchOutcome,
): SessionState {
  if (!shouldAccept(s, ticket)) return s;
  return { ...s, results: { ticket, outcome } };
}

/**
 * The candidates safe to display right now.
 *
 * Re-checks ownership at READ time rather than trusting that only accepted
 * responses were ever stored. The two are the same today; they stop being the
 * same the moment anyone adds a second writer.
 */
export function visibleCandidates(
  s: SessionState,
): SearchOutcome | null {
  if (!s.results || s.openCompanyId === null) return null;
  if (s.results.ticket.companyId !== s.openCompanyId) return null;
  return s.results.outcome;
}

/**
 * May this customer be mapped to this company right now?
 *
 * The last gate before a write that decides who gets invoiced. It refuses a
 * candidate that did not come from the open company's own search, which is
 * precisely what a mid-flight company switch would otherwise leave on screen.
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

export function beginSave(s: SessionState): SessionState {
  return { ...s, saving: true, panelError: null };
}

/** A failure keeps the panel OPEN, with the reason where the click happened. */
export function saveFailed(s: SessionState, detail: string): SessionState {
  return { ...s, saving: false, panelError: detail };
}

export function saveSucceeded(s: SessionState): SessionState {
  return { ...s, saving: false, panelError: null, openCompanyId: null, results: null };
}
