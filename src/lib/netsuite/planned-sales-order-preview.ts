import "server-only";

/**
 * The planned Sales Order structure, for the OPERATOR PREVIEW.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────
 *
 * The Sales Order tab has to show what pressing Send will create. It used to
 * build that list from `view.skus` — the CUSTOMER DOCUMENT — with every line at
 * the tier quantity, under the words "Everything below goes to NetSuite exactly
 * as shown". For a `turnkey_only` order that is false: the send path emits Item
 * Group headers and NetSuite expands the members, so O3's ×2 components post at
 * 2,400 while the operator approved a screen showing 1,200.
 *
 * This loads the SAME structure the send path builds, through the SAME
 * `buildPlannedSalesOrder`. The receipt renders `planned.rows` and computes
 * nothing of its own.
 *
 * ── IT MUST NOT WRITE, AND IT DOES NOT ──────────────────────────────────
 *
 * Opening a tab must not create master data. `findOrCreateItemGroup` POSTs a
 * new Item Group when a composition has not been seen, so it is not called here
 * and is asserted absent. The Group is named by its deterministic external id —
 * derivable from the frozen composition — and the provider-assigned INTERNAL id
 * is simply not known before Send. It is left unresolved rather than invented.
 *
 * Reads are permitted and necessary: `buildFrozenSalesOrder` resolves SKUs
 * through SuiteQL, which the accepted-state page already does for
 * `loadIdentityReadiness`. The prohibition is on CREATE and UPDATE.
 *
 * ── THE RESIDUAL, NAMED ─────────────────────────────────────────────────
 *
 * The STRUCTURE has one producer: `buildPlannedSalesOrder`, shared with
 * `markComplete`, asserted by test. The INPUT ASSEMBLY — resolving the customer,
 * the accepted snapshot, the live tree and the per-leaf costs — is performed
 * here as well as there, because `markComplete`'s copy is ~560 lines interleaved
 * with push-only guards and lifting it wholesale inside a receipt change would
 * be an unannounced refactor of the irreversible path.
 *
 * That duplication is a real drift risk and it is not pretended away:
 * `scripts/gate-1b/so-preview-agreement.ts` builds BOTH and compares the
 * resulting structure row for row. Two assemblies that diverge are caught by a
 * control rather than by a customer. Collapsing them into one loader is the
 * right follow-up and belongs in its own change.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteSnapshots,
  quoteTiers,
  quotes,
  assemblyProductionInputs,
} from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import { loadAssemblyTree } from "@/lib/assembly-tree";
import { resolveNetsuiteCustomer } from "@/lib/netsuite/customer-map";
import { resolveNetsuiteItem } from "@/lib/netsuite/item-resolver";
import { buildFrozenSalesOrder, type FrozenSalesOrderLine } from "@/lib/netsuite/frozen-sales-order";
import { OTC_COLUMN_DESTINATION, type OtcColumn } from "@/lib/netsuite/bv011-destinations";
import {
  buildPlannedSalesOrder,
  type LiveStructureEntry,
  type PlannedSalesOrder,
} from "@/lib/netsuite/planned-sales-order";

export type SalesOrderPreview =
  | { status: "ok"; planned: PlannedSalesOrder }
  /** Why the structure cannot be shown. The tab says so rather than guessing. */
  | { status: "unavailable"; reason: string };

export async function loadSalesOrderPreview(
  quoteId: string,
): Promise<SalesOrderPreview> {
  try {
    const [quote] = await db
      .select({
        id: quotes.id,
        status: quotes.status,
        acceptedTierId: quotes.acceptedTierId,
        customerAcceptedTierId: quotes.customerAcceptedTierId,
        projectId: quotes.projectId,
      })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!quote) return { status: "unavailable", reason: "Quote not found." };

    const tierId = quote.acceptedTierId ?? quote.customerAcceptedTierId;
    if (!tierId) {
      return { status: "unavailable", reason: "No tier has been accepted yet." };
    }

    const [snapshot] = await db
      .select({ detailLevel: quoteSnapshots.detailLevel })
      .from(quoteSnapshots)
      .where(and(eq(quoteSnapshots.quoteId, quoteId), isNull(quoteSnapshots.supersededAt)))
      .orderBy(desc(quoteSnapshots.effectiveFrom))
      .limit(1);
    if (!snapshot) {
      return { status: "unavailable", reason: "This quote has no current frozen matrix." };
    }

    const [tierRow] = await db
      .select({ qty: quoteTiers.qty })
      .from(quoteTiers)
      .where(eq(quoteTiers.id, tierId))
      .limit(1);

    // The customer's NetSuite identity — a READ. Without it the composition
    // hash cannot be derived, and a preview that invented one would name a
    // Group the send path would not resolve.
    const bundle = await getCostingBundle(quoteId);
    if (!bundle.ok) {
      return { status: "unavailable", reason: "The costing bundle could not be read." };
    }
    const projectRow: any = (bundle.data as any).quote ?? {};
    const companyId =
      projectRow.hubspotAssociatedCompanyId ?? (await companyIdForQuote(quoteId));
    if (!companyId) {
      return { status: "unavailable", reason: "This quote's deal has no associated company." };
    }
    const customer = await resolveNetsuiteCustomer(companyId);
    if (customer.status !== "found" || !customer.netsuiteCustomerId) {
      return {
        status: "unavailable",
        reason: "This customer is not mapped to a NetSuite account yet.",
      };
    }

    // SKU resolution — a READ, memoised, exactly as the send path does it.
    const memo = new Map<string, Awaited<ReturnType<typeof resolveNetsuiteItem>>>();
    const resolveSku = async (sku: string) => {
      const hit = memo.get(sku);
      if (hit) return hit;
      const fresh = await resolveNetsuiteItem(sku);
      memo.set(sku, fresh);
      return fresh;
    };

    const frozenOrder = await buildFrozenSalesOrder(quoteId, { resolveSku } as never);
    if (!frozenOrder.ok) {
      // The refusal's OWN words, not a generic sentence. The operator has to
      // know which line blocks the order, and the blockers already say.
      const detail = [
        ...frozenOrder.blockers.map((b) => b.remediation ?? b.kind),
        ...frozenOrder.reg4.map((f) => f.detail),
      ]
        .filter(Boolean)
        .join(" ");
      return {
        status: "unavailable",
        reason:
          "The accepted column does not yet produce a postable order." +
          (detail ? ` ${detail}` : ""),
      };
    }

    // The LIVE structure, keyed by the canonical `quote_leaves.id`. Services are
    // excluded: a Direct Service is not product structure and is never a group
    // member.
    const tree = await loadAssemblyTree(quoteId);
    if (!tree) {
      return { status: "unavailable", reason: "This quote has no product structure." };
    }
    const directProductsOnly = tree.directProducts.filter(
      (d: any) => d.commercialKind !== "service",
    );
    const liveByLeafId = new Map<string, LiveStructureEntry>();
    for (const leafRollup of (bundle.data as any).costing.skuRollups) {
      if (leafRollup.skuRole !== "leaf") continue;
      const treeLeaf =
        tree.assemblies
          .flatMap((a: any) =>
            a.children
              .filter((c: any) => c.commercialKind !== "service")
              .map((c: any) => ({ assembly: a, child: c })),
          )
          .find(({ child }: any) => child.quoteLeafId === leafRollup.skuId) ??
        directProductsOnly
          .filter((d: any) => d.quoteLeafId === leafRollup.skuId)
          .map((d: any) => ({ assembly: null, child: d }))[0];
      if (!treeLeaf?.child.sku) continue;
      const perTier = leafRollup.perTier.find((pt: any) => pt.tierId === tierId);
      if (!perTier) continue;
      liveByLeafId.set(leafRollup.skuId, {
        child: { sku: treeLeaf.child.sku, name: treeLeaf.child.name ?? null },
        assembly: treeLeaf.assembly ? { name: treeLeaf.assembly.name } : null,
        assemblyId: treeLeaf.assembly?.id ?? null,
        assemblySku: treeLeaf.assembly?.sku ?? null,
        assemblyName: treeLeaf.assembly?.name ?? null,
        qtyPerParent: Math.max(1, Math.round(leafRollup.qtyPerParent ?? 1)),
        unitCost:
          perTier.contributionCostPerUnit != null
            ? Number(perTier.contributionCostPerUnit)
            : null,
      });
    }

    // OTC cost, by assembly — the reporting basis, resolved through the
    // governed destination map rather than by naming a column.
    const otcRows = await db
      .select()
      .from(assemblyProductionInputs)
      .where(eq(assemblyProductionInputs.tierId, tierId));
    const otcByAssembly = new Map(otcRows.map((r: any) => [r.assemblyId, r]));
    const accountingCostFor = (line: FrozenSalesOrderLine): number | null => {
      if (line.kind !== "otc" || line.destination === null) return null;
      const column = (Object.keys(OTC_COLUMN_DESTINATION) as OtcColumn[]).find(
        (c) => OTC_COLUMN_DESTINATION[c] === line.destination,
      );
      if (!column || !line.owningAssemblyId) return null;
      const row = otcByAssembly.get(line.owningAssemblyId);
      const raw = row ? (row as Record<string, string | null>)[column] : null;
      return raw === null || raw === undefined || raw === "" ? null : Number(raw);
    };

    const planned = buildPlannedSalesOrder({
      detailLevel: snapshot.detailLevel ?? null,
      customerNetsuiteId: customer.netsuiteCustomerId,
      tierQty: tierRow?.qty ?? null,
      frozenLines: frozenOrder.lines,
      liveByLeafId,
      accountingCostFor,
    });

    return { status: "ok", planned };
  } catch (e: any) {
    if (process.env.SO_PREVIEW_DEBUG) console.error(e);
    // A preview must never take the tab down. It says it cannot show the
    // structure, which is more useful than a blank screen and more honest than
    // a structure assembled from something else.
    return {
      status: "unavailable",
      reason: `The planned structure could not be built: ${e?.message ?? "unknown error"}`,
    };
  }
}

/** The deal's associated company, when the bundle does not carry it. */
async function companyIdForQuote(quoteId: string): Promise<string | null> {
  const rows = await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import("drizzle-orm")).sql`
      select c.associated_company_id
        from quotes q
        join projects p on p.id = q.project_id
        join hubspot_deals_cache c on c.deal_id = p.hubspot_deal_id
       where q.id = ${quoteId}
       limit 1` as never,
  );
  const row: any = (rows as any)[0];
  return row?.associated_company_id ?? null;
}
