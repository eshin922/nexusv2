import "server-only";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  belowFloorApprovalRequests,
  belowFloorAuthorizations,
  projects,
  quotes,
  quoteTiers,
} from "@/db/schema";
import {
  projectApprovalTierState,
  type ApprovalRequestRow,
  type AuthorizationRow,
} from "@/lib/below-floor-approval-state";
import {
  groupForProject,
  rankTasks,
  tasksForQuote,
  visibleToViewer,
  type ApprovalFacts,
  type ProjectGroup,
  type QuoteFacts,
  type Task,
  type Viewer,
} from "./tasks";

/**
 * The Deal Organizer's server loader. READS ONLY — no mutation, no revalidation.
 *
 * ── FIXED QUERY COUNT, BY CONSTRUCTION ───────────────────────────────────
 *
 * Five queries for the whole page, regardless of how many projects or quotes
 * exist. Nothing here is per-quote.
 *
 * The first draft of this file was per-quote: it called `getCostingBundle` and
 * `loadUnresolvedQuoteCosts` for every draft, to serve `pricing_blocked` and
 * the unresolved-cost kinds. Measured against live data that was 44.8s and ~344
 * queries against a `max: 3` pool — on the default landing route. Those four
 * kinds are deferred (see `task-policy.ts`), and the read path they required
 * went with them. `docs/organizer-read-model-proposal.md` is how they come back.
 *
 * The rule this leaves behind: **if a task kind needs a computation, it does
 * not belong in this loader.** A cheaper approximation of a governed predicate
 * is not an option — it would be a second implementation of a rule that already
 * has one (Pattern 50), wrong in the direction that tells an operator a quote is
 * fine when the SEND gate will refuse it.
 *
 * ── WHAT IT COMPOSES ─────────────────────────────────────────────────────
 *
 *   `projectApprovalTierState` — this tier's approval state, from persisted
 *                                request and authorization rows
 *   `tasksForQuote`            — which governed unresolved states exist
 *   `rankTasks` / `groupForProject`
 *
 * No commercial question is answered by code in this file.
 *
 * ── ONE FINGERPRINT CAVEAT, STATED ───────────────────────────────────────
 *
 * `projectApprovalTierState` normally takes the fingerprint of CURRENT
 * economics, so an approval whose numbers have moved reports as `superseded`.
 * Computing that needs the costing bundle, which is exactly what this loader
 * must not do. It therefore passes the request's OWN fingerprint, which answers
 * the narrower question "was this decided, and is it live?" and cannot answer
 * "does it still match today's numbers".
 *
 * The consequence is bounded and one-directional: a stale-but-undecided
 * approval may appear here as `pending` rather than `superseded`. It cannot
 * make an unapproved quote look approved, and it changes NOTHING about
 * authority — Pricing and the SEND gate both re-decide from the bundle. Named
 * here rather than left as a silent difference between two call sites of the
 * same function.
 */

export interface OrganizerProject {
  projectId: string;
  dealName: string;
  clientName: string | null;
  dealStage: string | null;
  group: ProjectGroup;
  /** Every task the project raises — retained whole, per the one-row rule. */
  allTasks: Task[];
  /** Ranked, filtered to what this viewer may act on. */
  visibleTasks: Task[];
  /** `visibleTasks[0]`, by construction. */
  topTask: Task | null;
  /** Most recently updated quote on the project, for the Latest-quote column. */
  latestQuote: { quoteId: string; scenarioLabel: string; versionNumber: number; status: string; updatedAt: Date } | null;
}

export interface OrganizerData {
  projects: OrganizerProject[];
  /** Every visible task across every project, ranked once. */
  needsYou: Task[];
  /**
   * IDENTICALLY `needsYou[0]` — the same array element, not a recomputation and
   * not a second ranking. A test asserts the identity so they cannot drift.
   */
  nextMove: Task | null;
  /** Fixture projects excluded by `is_test`. Reported in the footer, per spec. */
  hiddenTestProjectCount: number;
  /**
   * Tasks belonging to a quote with no `created_by_user_id` and no covering
   * capability. Visible to nobody by design; counted so the gap is legible
   * rather than silent.
   */
  unownedTaskCount: number;
}

export async function loadOrganizer(
  viewer: Viewer,
  now = new Date(),
): Promise<OrganizerData> {
  const [rows, hiddenRows] = await Promise.all([
    db
      .select({
        projectId: projects.id,
        dealName: projects.dealName,
        clientName: projects.clientName,
        dealStage: projects.dealStage,
        quoteId: quotes.id,
        scenarioLabel: quotes.scenarioLabel,
        createdByUserId: quotes.createdByUserId,
        versionNumber: quotes.versionNumber,
        status: quotes.status,
        sentAt: quotes.sentAt,
        acceptedAt: quotes.acceptedAt,
        validUntil: quotes.validUntil,
        updatedAt: quotes.updatedAt,
        pushStatus: quotes.netsuiteSoPushStatus,
      })
      .from(projects)
      .leftJoin(quotes, eq(quotes.projectId, projects.id))
      // The ONLY test-record filter: a column, set once by migration 0097.
      // Never a name, prefix, substring, `ZZ-`, `%test%` or HubSpot-linkage
      // match at runtime.
      .where(eq(projects.isTest, false)),
    db.select({ id: projects.id }).from(projects).where(eq(projects.isTest, true)),
  ]);

  const quoteIds = rows.flatMap((r) => (r.quoteId ? [r.quoteId] : []));

  // Approval state for EVERY quote in two queries, not two per quote.
  const [requests, authorizations, tierRows] =
    quoteIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          db
            .select({
              quoteId: belowFloorApprovalRequests.quoteId,
              id: belowFloorApprovalRequests.id,
              tierId: belowFloorApprovalRequests.tierId,
              quoteVersionNumber: belowFloorApprovalRequests.quoteVersionNumber,
              status: belowFloorApprovalRequests.status,
              stateFingerprint: belowFloorApprovalRequests.stateFingerprint,
              requestedAt: belowFloorApprovalRequests.requestedAt,
              decidedAt: belowFloorApprovalRequests.decidedAt,
              decisionReason: belowFloorApprovalRequests.decisionReason,
              deliveryStatus: belowFloorApprovalRequests.deliveryStatus,
              authorizationId: belowFloorApprovalRequests.authorizationId,
            })
            .from(belowFloorApprovalRequests)
            .where(inArray(belowFloorApprovalRequests.quoteId, quoteIds)),
          db
            .select({
              quoteId: belowFloorAuthorizations.quoteId,
              id: belowFloorAuthorizations.id,
              tierId: belowFloorAuthorizations.tierId,
              quoteVersionNumber: belowFloorAuthorizations.quoteVersionNumber,
              stateFingerprint: belowFloorAuthorizations.stateFingerprint,
              invalidatedAt: belowFloorAuthorizations.invalidatedAt,
            })
            .from(belowFloorAuthorizations)
            .where(inArray(belowFloorAuthorizations.quoteId, quoteIds)),
          db
            .select({ quoteId: quoteTiers.quoteId, id: quoteTiers.id, label: quoteTiers.label })
            .from(quoteTiers)
            .where(inArray(quoteTiers.quoteId, quoteIds)),
        ]);

  const groupBy = <T extends { quoteId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of list) m.set(r.quoteId, [...(m.get(r.quoteId) ?? []), r]);
    return m;
  };
  const requestsByQuote = groupBy(requests);
  const authsByQuote = groupBy(authorizations);
  const tiersByQuote = groupBy(tierRows);

  const facts: QuoteFacts[] = [];
  for (const r of rows) {
    // A project with no quotes still gets a ROW (built from `meta` below); it
    // just raises no tasks. The LEFT JOIN also widens every quote column to
    // nullable, so the narrowing is done once, explicitly, rather than with a
    // non-null assertion per field — an assertion would be a claim about join
    // shape that the type system is specifically declining to make.
    const { quoteId, scenarioLabel, versionNumber, updatedAt, status } = r;
    if (
      quoteId === null ||
      scenarioLabel === null ||
      versionNumber === null ||
      updatedAt === null ||
      status === null
    ) {
      continue;
    }

    const labelById = new Map(
      (tiersByQuote.get(quoteId) ?? []).map((t) => [t.id, t.label]),
    );
    const quoteRequests = (requestsByQuote.get(quoteId) ?? []) as ApprovalRequestRow[];
    const quoteAuths = (authsByQuote.get(quoteId) ?? []) as AuthorizationRow[];

    // One state per tier that has an approval row. Tiers with no approval
    // history produce nothing — `kind: "none"` is not a task.
    const approvals: ApprovalFacts[] = [];
    const seen = new Set<string>();
    for (const req of quoteRequests) {
      if (seen.has(req.tierId)) continue;
      seen.add(req.tierId);

      const state = projectApprovalTierState({
        tierId: req.tierId,
        quoteVersionNumber: versionNumber,
        // The request's own fingerprint — see the caveat in the header.
        currentFingerprint: req.stateFingerprint,
        requests: quoteRequests,
        authorizations: quoteAuths,
      });

      const tierLabel = labelById.get(req.tierId) ?? "A tier";
      if (state.kind === "pending") {
        approvals.push({
          tierId: req.tierId,
          tierLabel,
          kind: "pending",
          requestedAt: state.requestedAt,
          delivered: state.delivered,
          rejectionReason: null,
        });
      } else if (state.kind === "approved") {
        approvals.push({
          tierId: req.tierId,
          tierLabel,
          kind: "approved",
          requestedAt: null,
          delivered: true,
          rejectionReason: null,
        });
      } else if (state.kind === "rejected") {
        approvals.push({
          tierId: req.tierId,
          tierLabel,
          kind: "rejected",
          requestedAt: null,
          delivered: true,
          rejectionReason: state.reason,
        });
      }
    }

    facts.push({
      quoteId,
      projectId: r.projectId,
      scenarioLabel,
      createdByUserId: r.createdByUserId,
      status,
      sentAt: r.sentAt,
      acceptedAt: r.acceptedAt,
      validUntil: r.validUntil ? new Date(r.validUntil) : null,
      updatedAt,
      approvals,
      pushFailed: r.pushStatus === "failed",
    });
  }

  // ── project rows ────────────────────────────────────────────────────────
  const meta = new Map(
    rows.map((r) => [
      r.projectId,
      { dealName: r.dealName, clientName: r.clientName, dealStage: r.dealStage },
    ]),
  );
  const factsByProject = new Map<string, QuoteFacts[]>();
  for (const f of facts) {
    factsByProject.set(f.projectId, [...(factsByProject.get(f.projectId) ?? []), f]);
  }
  const versionByQuote = new Map(
    rows.flatMap((r) => (r.quoteId && r.versionNumber !== null ? [[r.quoteId, r.versionNumber] as const] : [])),
  );

  let unownedTaskCount = 0;
  const out: OrganizerProject[] = [];
  for (const [projectId, m] of meta) {
    const qs = factsByProject.get(projectId) ?? [];
    const allTasks = rankTasks(qs.flatMap((f) => tasksForQuote(f, now)));
    const visibleTasks = allTasks.filter((t) => visibleToViewer(t, viewer));
    unownedTaskCount += allTasks.filter((t) => t.ownership.kind === "unowned").length;

    const latest = [...qs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;

    out.push({
      projectId,
      dealName: m.dealName,
      clientName: m.clientName,
      dealStage: m.dealStage,
      group: groupForProject({
        visibleTasks,
        anySent: qs.some((f) => f.sentAt !== null),
        anyUnaccepted: qs.some((f) => f.sentAt !== null && f.acceptedAt === null),
      }),
      // The whole queue stays on the row. Grouping reads the top of it; it does
      // not discard the rest.
      allTasks,
      visibleTasks,
      topTask: visibleTasks[0] ?? null,
      latestQuote: latest
        ? {
            quoteId: latest.quoteId,
            scenarioLabel: latest.scenarioLabel,
            versionNumber: versionByQuote.get(latest.quoteId) ?? 1,
            status: latest.status,
            updatedAt: latest.updatedAt,
          }
        : null,
    });
  }

  const needsYou = rankTasks(out.flatMap((p) => p.visibleTasks));

  return {
    projects: out,
    needsYou,
    // The SAME element. Any other expression here is a second engine.
    nextMove: needsYou[0] ?? null,
    hiddenTestProjectCount: hiddenRows.length,
    unownedTaskCount,
  };
}
