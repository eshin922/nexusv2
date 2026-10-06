/**
 * Match each POSTED Sales Order line to the FROZEN ordered line it carries.
 * Pure: no database, no provider. Stage 5 of the ordered-spec export.
 *
 * ── WHAT IS MATCHED ──────────────────────────────────────────────────────
 *
 * Spec-bearing frozen lines are `item_group_member` and `direct_product` —
 * the snapshot's own classification. `direct_service` and `otc` lines can
 * carry a `quote_leaf_id` (an OTC charge carries the product it was incurred
 * for), so `quote_leaf_id` presence is NOT the test.
 *
 * ── HOW, AND THE IDENTITY RULE ───────────────────────────────────────────
 *
 * The stored identity of a posted line is its `lineUniqueKey`. Never `line`
 * (a PATCH address that moves with structure) and never the SuiteQL id.
 *
 * Group members are matched INSIDE a group occurrence (`Group … EndGroup`),
 * by item id — the same rule as `so-structure.ts`, proven on SO2743 where one
 * Item Group appeared twice. A group occurrence is assigned to a frozen
 * assembly by its member item multiset. Only when two frozen assemblies have an
 * identical multiset does order decide (k-th occurrence ↔ k-th assembly by
 * first frozen position — the grouping plan's first-seen order), and such a
 * match is labelled `by_order` so the evidence says so.
 *
 * Ungrouped lines are matched by item id; a repeated item id among them is
 * matched in order and labelled `by_order`.
 *
 * Anything that cannot be matched unambiguously is a named PROBLEM, never a
 * guess. A wrong match would attach one product's specification to another
 * product's line — reconciling perfectly while being wrong.
 */

import { isSpecBearingLineKind } from "@/lib/ordered-spec-disposition";

export type PostedLine = {
  line: number;
  lineUniqueKey: string;
  itemId: string | null;
  itemType: string | null;
};

export type FrozenLine = {
  position: number;
  lineKind: "item_group" | "item_group_member" | "direct_product" | "direct_service" | "otc";
  owningAssemblyId: string | null;
  quoteLeafId: string | null;
  netsuiteItemId: string | null;
  displaySku: string | null;
};

export type LineMatch<P extends PostedLine = PostedLine> = {
  frozen: FrozenLine;
  posted: P;
  method: "unique" | "by_order";
};

export type MatchResult<P extends PostedLine = PostedLine> = {
  matches: LineMatch<P>[];
  /** Spec-bearing frozen lines that could not be matched, with why. */
  unmatched: Array<{ frozen: FrozenLine; reason: string }>;
  /** Order-level problems (structure the matcher cannot interpret). */
  problems: string[];
};

const SPEC_BEARING = { has: (k: FrozenLine["lineKind"]) => isSpecBearingLineKind(k) };

/** NetSuite line types that are structure or system, never ordered items. */
const NON_ITEM_TYPES = new Set([
  "EndGroup",
  "TaxGroup",
  "TaxItem",
  "ShipItem",
  "Discount",
  "Subtotal",
  "Markup",
  "Description",
  "Payment",
]);

export function isSpecBearingKind(kind: FrozenLine["lineKind"]): boolean {
  return SPEC_BEARING.has(kind);
}

type Occurrence<P extends PostedLine> = { headerItemId: string | null; members: P[] };

function partition<P extends PostedLine>(posted: P[]): { groups: Occurrence<P>[]; ungrouped: P[]; problems: string[] } {
  const groups: Occurrence<P>[] = [];
  const ungrouped: P[] = [];
  const problems: string[] = [];
  let open: Occurrence<P> | null = null;
  for (const l of posted) {
    const t = l.itemType ?? "";
    if (t === "Group") {
      if (open) problems.push(`group starting at line ${l.line} opened before the previous group ended`);
      open = { headerItemId: l.itemId, members: [] };
      groups.push(open);
      continue;
    }
    if (t === "EndGroup") {
      if (!open) problems.push(`EndGroup at line ${l.line} has no open group`);
      open = null;
      continue;
    }
    if (NON_ITEM_TYPES.has(t)) continue;
    (open ? open.members : ungrouped).push(l);
  }
  if (open) problems.push("a group is not terminated by an EndGroup line");
  return { groups, ungrouped, problems };
}

const key = (ids: Array<string | null>) =>
  ids.map((i) => i ?? "(null)").sort().join(",");

export function matchPostedSpecLines<P extends PostedLine>(posted: P[], frozen: FrozenLine[]): MatchResult<P> {
  const result: MatchResult<P> = { matches: [], unmatched: [], problems: [] };
  const { groups, ungrouped, problems } = partition(posted);
  result.problems.push(...problems);

  const keys = posted.map((l) => l.lineUniqueKey);
  if (new Set(keys).size !== keys.length) {
    result.problems.push("posted lineUniqueKeys are not distinct");
  }

  // ── frozen assemblies, in first-position order ──────────────────────────
  const byAssembly = new Map<string, FrozenLine[]>();
  for (const f of [...frozen].sort((a, b) => a.position - b.position)) {
    if (f.owningAssemblyId === null || f.lineKind === "item_group") continue;
    const b = byAssembly.get(f.owningAssemblyId);
    if (b) b.push(f);
    else byAssembly.set(f.owningAssemblyId, [f]);
  }
  const assemblies = [...byAssembly.entries()].map(([assemblyId, lines]) => ({
    assemblyId,
    lines,
    composition: key(lines.map((l) => l.netsuiteItemId)),
  }));

  const unmatchSpec = (lines: FrozenLine[], reason: string) => {
    for (const f of lines) if (SPEC_BEARING.has(f.lineKind)) result.unmatched.push({ frozen: f, reason });
  };

  // ── assign group occurrences to assemblies ──────────────────────────────
  const usedOccurrences = new Set<number>();
  const occurrenceCompositions = groups.map((g) => key(g.members.map((m) => m.itemId)));
  const assemblyCountByComposition = new Map<string, number>();
  for (const a of assemblies) {
    assemblyCountByComposition.set(a.composition, (assemblyCountByComposition.get(a.composition) ?? 0) + 1);
  }

  // An assembly can be POSTED FLAT: the grouping plan emits no Item Group when
  // grouping is not required or a grouping exception applies (observed on
  // SO2736 / SO2738, whose frozen lines are `item_group_member` while NetSuite
  // holds them ungrouped). The frozen line kind therefore does not say how a
  // line was posted. An assembly with no matching group occurrence joins the
  // ungrouped pool and is matched there, under the same counting rule.
  const postedFlat: FrozenLine[] = [];
  for (const a of assemblies) {
    if (a.lines.some((l) => l.netsuiteItemId === null)) {
      unmatchSpec(a.lines, "frozen group member has no recorded NetSuite item; cannot match by item");
      continue;
    }
    const idx = occurrenceCompositions.findIndex((c, i) => !usedOccurrences.has(i) && c === a.composition);
    if (idx === -1) {
      postedFlat.push(...a.lines);
      continue;
    }
    usedOccurrences.add(idx);
    const method: LineMatch<P>["method"] =
      (assemblyCountByComposition.get(a.composition) ?? 0) > 1 ? "by_order" : "unique";

    const occ = groups[idx];
    const memberCounts = new Map<string, number>();
    for (const m of occ.members) memberCounts.set(m.itemId ?? "", (memberCounts.get(m.itemId ?? "") ?? 0) + 1);
    for (const f of a.lines) {
      if (!SPEC_BEARING.has(f.lineKind)) continue;
      if ((memberCounts.get(f.netsuiteItemId!) ?? 0) > 1) {
        result.unmatched.push({ frozen: f, reason: "item appears more than once inside one group occurrence" });
        continue;
      }
      const posted = occ.members.find((m) => m.itemId === f.netsuiteItemId)!;
      result.matches.push({ frozen: f, posted, method });
    }
  }
  groups.forEach((g, i) => {
    if (!usedOccurrences.has(i)) {
      result.problems.push(`posted Item Group occurrence ${i + 1} (item ${g.headerItemId ?? "?"}) matches no frozen assembly`);
    }
  });

  // ── ungrouped lines ─────────────────────────────────────────────────────
  // Every frozen TOP-LEVEL line participates in the count (services and OTC
  // included), so a direct product sharing an item id with a charge cannot be
  // silently paired with the charge's posted line.
  const topLevel = [
    ...frozen.filter((f) => f.owningAssemblyId === null && f.lineKind !== "item_group"),
    ...postedFlat,
  ].sort((a, b) => a.position - b.position);
  const frozenByItem = new Map<string, FrozenLine[]>();
  for (const f of topLevel) {
    const k = f.netsuiteItemId ?? "(null)";
    const b = frozenByItem.get(k);
    if (b) b.push(f);
    else frozenByItem.set(k, [f]);
  }
  const postedByItem = new Map<string, P[]>();
  for (const p of ungrouped) {
    const k = p.itemId ?? "(null)";
    const b = postedByItem.get(k);
    if (b) b.push(p);
    else postedByItem.set(k, [p]);
  }
  for (const [item, fl] of frozenByItem) {
    const spec = fl.filter((f) => SPEC_BEARING.has(f.lineKind));
    if (spec.length === 0) continue;
    if (item === "(null)") {
      unmatchSpec(spec, "frozen line has no recorded NetSuite item; cannot match by item");
      continue;
    }
    const pl = postedByItem.get(item) ?? [];
    if (pl.length !== fl.length) {
      unmatchSpec(spec, `item ${item}: ${fl.length} frozen top-level line(s) but ${pl.length} posted ungrouped line(s)`);
      continue;
    }
    const method: LineMatch<P>["method"] = fl.length > 1 ? "by_order" : "unique";
    fl.forEach((f, i) => {
      if (SPEC_BEARING.has(f.lineKind)) result.matches.push({ frozen: f, posted: pl[i], method });
    });
  }

  return result;
}
