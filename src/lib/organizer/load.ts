import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";

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
import { loadHubspotStageCatalog } from "@/lib/hubspot-stage-label";
import { presentHubspotStage } from "@/lib/crm-presentation";
import { projectGlyphFor } from "@/lib/workspace-queries";
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
 * Six database queries for the whole page, regardless of how many projects or
 * quotes exist — three in each of two batches — plus one HubSpot stage-catalog
 * call served from a per-instance cache. Nothing here is per-quote.
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
 * ── APPROVAL FRESHNESS FAILS QUIET, STRUCTURALLY ─────────────────────────
 *
 * `projectApprovalTierState` decides `approved` and `pending` by comparing a
 * stored `stateFingerprint` against the fingerprint of CURRENT economics. That
 * fingerprint comes from the costing bundle — the read this loader must not
 * make — and no durable substitute exists: `invalidated_at` is read in six
 * places across the codebase and written by none.
 *
 * An earlier draft passed the request's OWN fingerprint, which made the
 * comparison trivially true and could report `pending` for a request Pricing
 * considers superseded — a positive "Review approval" instruction to do work
 * the SEND gate will refuse.
 *
 * So this passes a sentinel that CANNOT equal any real fingerprint. The
 * function's own precedence then does the rest: `approved` cannot be reached,
 * `pending` collapses to `superseded`, and neither raises a task. Fail-quiet is
 * a consequence of the governed function's existing logic rather than a second
 * freshness rule implemented here.
 *
 * `rejected` still surfaces, because that branch consults no fingerprint — it
 * reads a terminal `status` and `decided_at`, which are durable and final.
 *
 * Authority is untouched either way: Pricing and the SEND gate both re-decide
 * from the bundle.
 */

/**
 * Not a fingerprint. `fingerprintCommercialState` returns a hash of the tier's
 * revenue, cost and blended margin, so no real value can collide with this —
 * which is the point: every fingerprint comparison inside
 * `projectApprovalTierState` is forced to fail, and the states that depend on
 * one fall through to `superseded` instead of being asserted.
 */
const FRESHNESS_UNPROVABLE = "organizer:current-fingerprint-unavailable";

export interface OrganizerProject {
  projectId: string;
  dealName: string;
  clientName: string | null;
  dealStage: string | null;
  /** Deterministic letter + hue, from the same hash the outer rail uses. */
  glyph: { letter: string; hue: number };
  group: ProjectGroup;
  /** Every task the project raises — retained whole, per the one-row rule. */
  allTasks: Task[];
  /** Ranked, filtered to what this viewer may act on. */
  visibleTasks: Task[];
  /** `visibleTasks[0]`, by construction. */
  topTask: Task | null;
  /**
   * Most recently updated NON-DROPPED quote, for the Latest-quote column.
   * Null both when the project has no quotes and when every scenario on it was
   * dropped — `hasAnyQuotes` separates those two.
   */
  latestQuote: { quoteId: string; scenarioLabel: string; versionNumber: number; status: string; updatedAt: Date } | null;
  /** True when the project has quotes at all, including dropped ones. */
  hasAnyQuotes: boolean;
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
  const [rows, hiddenRows, anyQuoteRows, stageCatalog] = await Promise.all([
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
      // DROPPED SCENARIOS ARE EXCLUDED IN THE JOIN, not filtered afterwards.
      //
      // A dropped scenario is superseded history: it must not become a row's
      // "latest quote" and must not raise tasks. Putting the condition in the
      // JOIN rather than the WHERE is what keeps a project whose scenarios are
      // ALL dropped in the result — with every quote column null — so it can be
      // told apart from a project with no quotes at all. `hasAnyQuotes` below
      // carries that distinction to the row.
      //
      // Three live quotes in real projects are dropped today, so this is not
      // hypothetical.
      .leftJoin(
        quotes,
        and(eq(quotes.projectId, projects.id), ne(quotes.scenarioStatus, "dropped")),
      )
      // The ONLY test-record filter: a column, set once by migration 0097.
      // Never a name, prefix, substring, `ZZ-`, `%test%` or HubSpot-linkage
      // match at runtime.
      .where(eq(projects.isTest, false)),
    db.select({ id: projects.id }).from(projects).where(eq(projects.isTest, true)),
    // Which projects have ANY quote, dropped or not — so "every scenario was
    // dropped" reads differently from "no quote yet".
    db
      .selectDistinct({ projectId: quotes.projectId })
      .from(quotes)
      .innerJoin(projects, eq(projects.id, quotes.projectId))
      .where(eq(projects.isTest, false)),
    // HUBSPOT STAGE LABELS. `projects.deal_stage` stores HubSpot's INTERNAL ID
    // ("195274339"), because labels are editable in HubSpot's UI and the
    // runtime key has to be stable. Rendering that id to an operator is a
    // defect — it is an internal identity, and it is what the first deploy of
    // this surface did.
    //
    // `presentHubspotStage` is the existing resolver (the project detail page
    // uses it) and fails closed to a readable unknown-stage label rather than
    // leaking the id. `loadHubspotStageCatalog` is NOT a database query: it is
    // one HubSpot pipelines call per Node instance lifetime, served from the
    // same warm cache `markAccepted` and `getDealStage` already use, and it
    // returns [] rather than throwing if HubSpot is unreachable.
    loadHubspotStageCatalog(),
  ]);
  const projectsWithAnyQuote = new Set(anyQuoteRows.map((r) => r.projectId));

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
        // Cannot match — see FRESHNESS_UNPROVABLE.
        currentFingerprint: FRESHNESS_UNPROVABLE,
        requests: quoteRequests,
        authorizations: quoteAuths,
      });

      // Only `rejected` is actionable from durable state. `approved` and
      // `pending` cannot be reached under the sentinel, and `superseded` /
      // `none` were never tasks — so this is the single mapping, not a filter
      // applied after the fact.
      if (state.kind === "rejected") {
        approvals.push({
          tierId: req.tierId,
          tierLabel: labelById.get(req.tierId) ?? "A tier",
          kind: "rejected",
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
      {
        dealName: r.dealName,
        clientName: r.clientName,
        dealStage: presentHubspotStage(r.dealStage, stageCatalog),
      },
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
      glyph: projectGlyphFor(projectId, m.clientName ?? m.dealName),
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
      hasAnyQuotes: projectsWithAnyQuote.has(projectId),
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
