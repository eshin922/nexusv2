import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  groupForProject,
  rankTasks,
  tasksForQuote,
  visibleToViewer,
  type QuoteFacts,
  type Task,
  type Viewer,
} from "../../src/lib/organizer/tasks.ts";
import { TASK_KINDS, TASK_POLICY, TASK_RANK } from "../../src/lib/organizer/task-policy.ts";
import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string => stripComments(src).replace(/\r\n/g, "\n");

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

// ═══════════════════════════════════════════════════════════════════════
// THE ORGANIZER IS A PROJECTION
//
// It reads governed state and ranks it. The one rule that keeps it honest:
//
//   A task exists only when a REAL unresolved governed state exists, and
//   either the work is assigned to that user, or it is unassigned and their
//   capability permits it. CAPABILITY ALONE NEVER CREATES WORK.
//
// V1 adds a second condition of the same kind: the state's CURRENT VALIDITY
// must follow from durable persistence alone. Anything needing a costing read
// to know whether it is still true fails QUIET.
// ═══════════════════════════════════════════════════════════════════════

const NOW = new Date("2026-08-22T12:00:00Z");
const CREATOR = "user-creator";
const OTHER = "user-other";

const clean = (o: Partial<QuoteFacts> = {}): QuoteFacts => ({
  quoteId: "q1",
  projectId: "p1",
  scenarioLabel: "Primary",
  createdByUserId: CREATOR,
  status: "draft",
  sentAt: null,
  acceptedAt: null,
  validUntil: null,
  updatedAt: new Date("2026-08-20T00:00:00Z"),
  approvals: [],
  pushFailed: false,
  ...o,
});

const viewer = (o: Partial<Viewer> = {}): Viewer => ({
  userId: CREATOR,
  commercialApprover: false,
  role: "pm",
  ...o,
});

const withApproval = (o: Partial<QuoteFacts["approvals"][number]> = {}) =>
  clean({
    approvals: [
      { tierId: "t1", tierLabel: "50k", kind: "pending" as const, rejectionReason: null, ...o },
    ],
  });

/** A capability-owned task, built directly. No V1 kind produces one — see below. */
const capabilityTask = () =>
  ({
    kind: "approval_rejected",
    ownership: { kind: "capability", capability: "commercial_approver" },
  }) as unknown as Task;

// ── capability never creates work ─────────────────────────────────────────

test("a clean quote produces no tasks for anyone", () => {
  assert.deepEqual(tasksForQuote(clean(), NOW), []);
});

test("an approver with nothing pending has an empty queue", () => {
  const tasks = tasksForQuote(clean(), NOW);
  const seen = tasks.filter((t) => visibleToViewer(t, viewer({ commercialApprover: true })));
  assert.deepEqual(seen, [], "holding the approval capability conjured work");
});

test("capability filters visibility, and can never create it", () => {
  // Asserted against `visibleToViewer` directly, because no V1 kind is
  // capability-owned any more: `approval_decision` was the only one and it
  // fails quiet on freshness. The RULE still has to hold for the kinds that
  // return once a freshness signal exists, so it is tested rather than deleted.
  const task = capabilityTask();
  assert.equal(visibleToViewer(task, viewer({ commercialApprover: false })), false);
  assert.equal(visibleToViewer(task, viewer({ commercialApprover: true })), true);
});

// ── ownership ─────────────────────────────────────────────────────────────

test("quote-derived work belongs to that quote's creator, not to a role", () => {
  const [task] = tasksForQuote(clean({ pushFailed: true }), NOW);
  assert.equal(task.kind, "push_failed");
  assert.deepEqual(task.ownership, { kind: "assigned", userId: CREATOR });
  assert.equal(visibleToViewer(task, viewer({ userId: CREATOR })), true);
  assert.equal(
    visibleToViewer(task, viewer({ userId: OTHER, role: "admin", commercialApprover: true })),
    false,
    "another user's quote work reached someone merely because they hold roles",
  );
});

test("capability-owned work reaches every holder — there is no independence rule", () => {
  // Policy places NO self-approval or operator-independence requirement on
  // below-floor approvals, so the quote's own creator sees it too.
  const task = capabilityTask();
  assert.equal(visibleToViewer(task, viewer({ userId: CREATOR, commercialApprover: true })), true);
  assert.equal(visibleToViewer(task, viewer({ userId: OTHER, commercialApprover: true })), true);
});

test("a quote with no creator leaves its work unowned, visible to nobody", () => {
  const [task] = tasksForQuote(clean({ createdByUserId: null, pushFailed: true }), NOW);
  assert.deepEqual(task.ownership, { kind: "unowned" });
  for (const v of [
    viewer({ userId: CREATOR }),
    viewer({ userId: OTHER, role: "admin" }),
    viewer({ userId: OTHER, commercialApprover: true }),
  ]) {
    assert.equal(
      visibleToViewer(task, v),
      false,
      "unowned work was handed to a role — capability creating an assignment",
    );
  }
});

// ── approval freshness fails quiet ────────────────────────────────────────

test("fingerprint-gated approval states raise no task", () => {
  // `pending` and `approved` are decided by comparing a stored fingerprint
  // against CURRENT economics, which this surface cannot compute without the
  // costing bundle. Surfacing them anyway would instruct an operator to act on
  // a request Pricing may consider superseded — work the SEND gate refuses.
  for (const kind of ["pending", "approved", "superseded", "none"] as const) {
    assert.deepEqual(
      tasksForQuote(withApproval({ kind }), NOW),
      [],
      `${kind} raised a task despite unprovable freshness`,
    );
  }
});

test("a rejection survives, because it consults no fingerprint", () => {
  const rejected = tasksForQuote(
    withApproval({ kind: "rejected", rejectionReason: "margin too thin" }),
    NOW,
  );
  assert.deepEqual(
    rejected.map((t) => t.kind),
    ["approval_rejected"],
  );
  assert.match(rejected[0].reason, /margin too thin/);
});

test("the loader forces the fingerprint comparison to fail rather than faking it", async () => {
  const src = codeOnly(await read("src/lib/organizer/load.ts"));
  // Fail-quiet must come from the governed function's own precedence, not from
  // a second freshness rule implemented in the loader.
  assert.match(src, /FRESHNESS_UNPROVABLE/);
  assert.match(src, /currentFingerprint: FRESHNESS_UNPROVABLE/);
  assert.doesNotMatch(
    src,
    /currentFingerprint:\s*(req|request)\.stateFingerprint/,
    "the loader passes a request's own fingerprint, making the comparison trivially true",
  );
  assert.doesNotMatch(src, /fingerprintCommercialState/, "the loader computes a fingerprint itself");
});

// ── V1 carries only provable state ────────────────────────────────────────

test("the computed kinds are absent — deferred, not approximated", () => {
  for (const gone of [
    "pricing_blocked",
    "costs_unresolved_quote",
    "costs_unresolved_freight",
    "costs_unresolved_configuration",
  ]) {
    assert.equal(
      (TASK_KINDS as readonly string[]).includes(gone),
      false,
      `${gone} is back in the vocabulary`,
    );
  }
});

test("every fingerprint-gated kind is absent from the vocabulary", () => {
  for (const gone of [
    "approval_approved",
    "approval_decision",
    "approval_undelivered",
    "approval_stale",
  ]) {
    assert.equal((TASK_KINDS as readonly string[]).includes(gone), false, `${gone} is back`);
  }
});

test("the organizer reaches for no costing or unresolved-cost computation", async () => {
  // The merge blocker, asserted structurally. Serving the computed kinds live
  // measured 44.8s and ~344 queries against a pool of 3 on the default landing
  // route. A cheaper stand-in for a governed predicate is equally forbidden —
  // it would be a second implementation of a rule that already has one.
  for (const file of [
    "src/lib/organizer/tasks.ts",
    "src/lib/organizer/load.ts",
    "src/lib/organizer/task-policy.ts",
  ]) {
    const src = codeOnly(await read(file));
    for (const forbidden of [
      /getCostingBundle/,
      /loadUnresolvedQuoteCosts/,
      /evaluateProgression/,
      /computeQuoteCosting/,
      /blendedMarginStatus/,
      /floorMarginPct/,
    ]) {
      assert.doesNotMatch(src, forbidden, `${file} reaches for ${forbidden}`);
    }
  }
});

test("test records are filtered by column only — no name heuristics", async () => {
  const src = codeOnly(await read("src/lib/organizer/load.ts"));
  assert.match(src, /projects\.isTest/, "the is_test column filter is missing");
  for (const heuristic of [/ZZ-/, /ilike/i, /%test%/i, /SMOKE/, /DELETE-ME/, /dealName[^\n]*like/i]) {
    assert.doesNotMatch(src, heuristic, `a runtime name heuristic (${heuristic}) is back`);
  }
});

// ── dropped scenarios are history, not work ──────────────────────────────

test("dropped scenarios are excluded in the JOIN, so an all-dropped project survives", async () => {
  const src = codeOnly(await read("src/lib/organizer/load.ts"));
  // In the JOIN, not the WHERE. Filtering afterwards would drop the PROJECT
  // too, and "every scenario was dropped" would become indistinguishable from
  // "no quote yet".
  assert.match(
    src,
    /leftJoin\(\s*quotes,\s*and\(\s*eq\(quotes\.projectId, projects\.id\),\s*ne\(quotes\.scenarioStatus, "dropped"\)/,
    "dropped scenarios are not excluded in the join",
  );
  assert.match(src, /hasAnyQuotes/, "the all-dropped state cannot be distinguished");
});

test("the surface says all-dropped and no-quote differently", async () => {
  const src = await read("src/components/deal-organizer/organizer-surface.tsx");
  assert.match(src, /hasAnyQuotes \? "No active scenario" : "No quote yet"/);
});

// ── individual predicates ─────────────────────────────────────────────────

test("valid_until null yields no expiry task, not a fabricated date", () => {
  const sent = clean({
    status: "sent",
    sentAt: new Date("2026-08-21T12:00:00Z"),
    validUntil: null,
  });
  assert.deepEqual(
    tasksForQuote(sent, NOW).filter((t) => t.kind === "quote_expiring"),
    [],
  );
});

test("customer_responded does not exist, and no replacement predicate stands in", async () => {
  assert.equal((TASK_KINDS as readonly string[]).includes("customer_responded"), false);
  const src = codeOnly(await read("src/lib/organizer/tasks.ts"));
  assert.doesNotMatch(
    src,
    /customerResponseChannel|customer_response_channel/,
    "the organizer reads acceptance provenance as if it were unresolved state",
  );
});

test("the thresholds live in the policy layer, not in predicates", async () => {
  assert.equal(TASK_POLICY.approvalStaleAfterMs, 60 * 60 * 1000);
  assert.equal(TASK_POLICY.customerSilentAfterMs, 48 * 60 * 60 * 1000);
  assert.equal(TASK_POLICY.quoteExpiringWithinMs, 7 * 24 * 60 * 60 * 1000);

  const src = codeOnly(await read("src/lib/organizer/tasks.ts"));
  assert.doesNotMatch(
    src,
    /\b(3600000|172800000|604800000)\b/,
    "a threshold was inlined next to the predicate that uses it",
  );
});

// ── vocabulary and ranking ────────────────────────────────────────────────

test("the vocabulary is four kinds, and rank covers exactly them", () => {
  assert.equal(TASK_KINDS.length, 4);
  assert.deepEqual([...TASK_KINDS].sort(), Object.keys(TASK_RANK).sort());
  assert.equal(new Set(Object.values(TASK_RANK)).size, 4, "two kinds share a rank");
});

test("ranking is most-urgent-first, oldest-first on ties", () => {
  const mk = (kind: Task["kind"], iso: string): Task => ({
    kind,
    id: kind + iso,
    projectId: "p",
    quoteId: "q",
    scenarioLabel: "s",
    ownership: { kind: "assigned", userId: CREATOR },
    reason: "",
    cta: "",
    href: "",
    updatedAt: new Date(iso),
  });
  const ranked = rankTasks([
    mk("customer_silent", "2026-01-01"),
    mk("approval_rejected", "2026-06-01"),
    mk("push_failed", "2026-06-01"),
    mk("approval_rejected", "2026-01-01"),
  ]);
  // Asserted on stable values. An earlier version formatted dates with
  // getFullYear(), which renders in LOCAL time — `2026-01-01T00:00Z` reads as
  // 2025-12 in PDT — so the expectation disagreed with correct output purely
  // over timezone rendering.
  assert.deepEqual(
    ranked.map((t) => `${t.kind}@${t.updatedAt.toISOString().slice(0, 10)}`),
    [
      "approval_rejected@2026-01-01",
      "approval_rejected@2026-06-01",
      "push_failed@2026-06-01",
      "customer_silent@2026-01-01",
    ],
  );
});

test("there is exactly one ranking implementation", async () => {
  const load = codeOnly(await read("src/lib/organizer/load.ts"));
  assert.doesNotMatch(load, /sort\([^)]*TASK_RANK/, "the loader re-sorts by rank itself");
  assert.match(load, /rankTasks\(/, "the loader does not use the shared ranking");
});

// ── grouping ──────────────────────────────────────────────────────────────

test("the highest-ranked VISIBLE task decides the row's group", () => {
  assert.equal(
    groupForProject({ visibleTasks: [], anySent: true, anyUnaccepted: true }),
    "with_customer",
  );
  assert.equal(
    groupForProject({ visibleTasks: [], anySent: false, anyUnaccepted: false }),
    "no_action",
  );
  assert.equal(
    groupForProject({
      visibleTasks: [{ kind: "customer_silent" } as Task],
      anySent: true,
      anyUnaccepted: true,
    }),
    "needs_you",
  );
});

test("a multi-scenario project keeps every task, owned by its own creator", () => {
  const a = tasksForQuote(
    clean({ quoteId: "qa", scenarioLabel: "Primary", createdByUserId: CREATOR, pushFailed: true }),
    NOW,
  );
  const b = tasksForQuote(
    clean({ quoteId: "qb", scenarioLabel: "Alt 1", createdByUserId: OTHER, pushFailed: true }),
    NOW,
  );
  const all = [...a, ...b];
  assert.equal(all.length, 2, "the queue is not collapsed to one task per project");
  assert.deepEqual(
    all.map((t) => (t.ownership.kind === "assigned" ? t.ownership.userId : null)),
    [CREATOR, OTHER],
    "one project row may aggregate tasks owned by different people",
  );
  assert.equal(all.filter((t) => visibleToViewer(t, viewer({ userId: CREATOR }))).length, 1);
});

// ── theme coverage ────────────────────────────────────────────────────────

test("every tone token is defined in all three theme states", async () => {
  // ASSERTED BY SELECTOR CONTEXT, NOT BY COUNT.
  //
  // A count check passed while `[data-theme="dark"]` carried none of these and
  // the media query carried them twice: three occurrences, two contexts. The
  // instrument reported the right number for the wrong reason, and the defect it
  // was meant to catch — an explicit dark toggle rendering light chip fills on a
  // dark ground, the #348 class — sat underneath it.
  const css = await read("src/styles/r14-organizer.css");

  const contexts = new Map<string, Set<string>>();
  const stack: string[] = [];
  for (const raw of css.split(/\r?\n/)) {
    const line = raw.trim();
    const open = /^([^{}]+)\{$/.exec(line);
    if (open) {
      stack.push(open[1].trim());
      continue;
    }
    if (line === "}") {
      stack.pop();
      continue;
    }
    const token = /^(--r14-t(?:25|70|155|232|255|neutral)-(?:bg|fg)):/.exec(line);
    if (token) {
      const key = stack.join(" > ");
      const set = contexts.get(key) ?? new Set<string>();
      set.add(token[1]);
      contexts.set(key, set);
    }
  }

  const keys = [...contexts.keys()];
  const base = keys.find((k) => k === ".r14");
  const media = keys.find((k) => k.startsWith("@media") && k.includes("prefers-color-scheme"));
  const explicit = keys.find((k) => k.startsWith('[data-theme="dark"]'));

  assert.ok(base, "no base (light) definition block");
  assert.ok(media, "no prefers-color-scheme block — system-dark viewers get light fills");
  assert.ok(explicit, 'no [data-theme="dark"] block — the theme toggle would not repaint chips');

  for (const k of [base, media, explicit]) {
    assert.equal(
      contexts.get(k!)!.size,
      12,
      `${k} defines ${contexts.get(k!)!.size} of the 12 tone tokens`,
    );
  }
});

// ── the organizer writes nothing ──────────────────────────────────────────

test("the organizer is read-only and the task layer is pure", async () => {
  const tasks = codeOnly(await read("src/lib/organizer/tasks.ts"));
  for (const forbidden of [
    /from "@\/db"/,
    /\.insert\(/,
    /\.update\(/,
    /\.delete\(/,
    /Date\.now\(\)/,
    /new Date\(\)/,
  ]) {
    assert.doesNotMatch(tasks, forbidden, `the task layer reaches for ${forbidden}`);
  }
  const load = codeOnly(await read("src/lib/organizer/load.ts"));
  for (const forbidden of [/\.insert\(/, /\.update\(/, /\.delete\(/, /revalidatePath/, /revalidateTag/]) {
    assert.doesNotMatch(load, forbidden, `the loader reaches for ${forbidden}`);
  }
});
