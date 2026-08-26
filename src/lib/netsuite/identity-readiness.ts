import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  quoteSnapshotLineTiers,
  quoteSnapshotLines,
  quoteSnapshots,
  quotes,
} from "@/db/schema";
import { resolveNetsuiteItem } from "./item-resolver";

/**
 * Can the accepted tier's frozen product lines resolve to NetSuite items —
 * asked BEFORE the operator clicks the irreversible Send.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * `product_sku_missing` and `product_item_unresolved` are first-class
 * projection blockers (`projection-readiness.ts`), but they are only EMITTED
 * inside `buildFrozenSalesOrder` — at send time. So the Sales Order step could
 * read "ready to send" while the send could not possibly succeed, and the
 * operator discovered it by pressing the one button labelled irreversible.
 *
 * That was a deliberate trade, recorded in `sales-order-preflight.ts`:
 * SKU resolution is "~N SuiteQL calls per quote ... If PMs need a pre-flight
 * verify surface, that's a follow-up." This is that follow-up.
 *
 * Both refusals were hit in sequence during the #428 Part B certification —
 * first the missing SKU, then, once the SKU existed, the unresolved item. Two
 * separate discoveries, both made by clicking Send.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────
 *
 * READINESS VISIBILITY ONLY. It predicts refusals; it does not repair them.
 * It creates no SKU, no NetSuite item, and no mapping, and it is not the
 * authority on whether a send may proceed — `buildFrozenSalesOrder` remains
 * the guard, and its refusal is still the thing that stops a bad push. This
 * only stops the surface from CLAIMING readiness it cannot have.
 *
 * Being advisory is what makes a read failure safe: a NetSuite outage degrades
 * this to "cannot tell", never to a false "ready" and never to a false block.
 *
 * ── COST ────────────────────────────────────────────────────────────────
 *
 * `product_sku_missing` is a DB read and free. `product_item_unresolved` costs
 * one SuiteQL call per DISTINCT unresolved-so-far SKU (`resolveNetsuiteItems`
 * is serial by design — SuiteQL throttles concurrency hard), so a 10-member
 * assembly adds ~2s to the render.
 *
 * That is a bad trade on an autosaving surface and a good one here: the Sales
 * Order tab is visited once per quote, to make an irreversible decision, and
 * the alternative is spending the same time discovering the failure after the
 * click. De-duplicating the SKU set keeps the call count at distinct products
 * rather than lines.
 */

export type IdentityBlocker =
  | {
      kind: "product_sku_missing";
      displayName: string;
      remediation: string;
    }
  | {
      kind: "product_item_unresolved";
      displayName: string;
      sku: string;
      remediation: string;
    };

export type IdentityReadiness = {
  /** `unknown` when NetSuite could not be reached — never conflated with `ok`. */
  status: "ok" | "blocked" | "unknown";
  blockers: IdentityBlocker[];
  /** Populated only when status is `unknown`. */
  unknownReason: string | null;
};

export async function loadIdentityReadiness(
  quoteId: string,
): Promise<IdentityReadiness> {
  const [quote] = await db
    .select({ acceptedTierId: quotes.customerAcceptedTierId })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote?.acceptedTierId) {
    // No accepted tier is its own blocker upstream; nothing to say here.
    return { status: "ok", blockers: [], unknownReason: null };
  }

  const [snapshot] = await db
    .select({ id: quoteSnapshots.id })
    .from(quoteSnapshots)
    .where(
      and(
        eq(quoteSnapshots.quoteId, quoteId),
        isNull(quoteSnapshots.supersededAt),
      ),
    )
    .limit(1);
  if (!snapshot) return { status: "ok", blockers: [], unknownReason: null };

  const lines = await db
    .select({
      kind: quoteSnapshotLines.lineKind,
      sku: quoteSnapshotLines.displaySku,
      displayName: quoteSnapshotLines.displayName,
    })
    .from(quoteSnapshotLines)
    .innerJoin(
      quoteSnapshotLineTiers,
      eq(quoteSnapshotLineTiers.quoteSnapshotLineId, quoteSnapshotLines.id),
    )
    .where(
      and(
        eq(quoteSnapshotLines.quoteSnapshotId, snapshot.id),
        eq(quoteSnapshotLineTiers.tierId, quote.acceptedTierId),
        eq(quoteSnapshotLineTiers.pricingState, "priced"),
      ),
    )
    .orderBy(quoteSnapshotLines.position);

  const blockers: IdentityBlocker[] = [];
  const toResolve = new Map<string, string>(); // sku -> first display name

  for (const row of lines) {
    // Same line-kind scope as buildFrozenSalesOrder: only lines that become
    // SKU-matched product lines. Service and OTC lines resolve by a different
    // mechanism and are not this check's business.
    if (row.kind !== "item_group_member" && row.kind !== "direct_product") continue;

    const sku = (row.sku ?? "").trim();
    if (sku === "") {
      blockers.push({
        kind: "product_sku_missing",
        displayName: row.displayName,
        remediation: `"${row.displayName}" was frozen without a SKU, so its NetSuite item cannot be matched. Give the product a SKU, then revise and re-send.`,
      });
      continue;
    }
    if (!toResolve.has(sku)) toResolve.set(sku, row.displayName);
  }

  for (const [sku, displayName] of toResolve) {
    try {
      const resolution = await resolveNetsuiteItem(sku);
      if (resolution.status === "found") continue;
      blockers.push({
        kind: "product_item_unresolved",
        displayName,
        sku,
        remediation:
          resolution.status === "ambiguous"
            ? `"${sku}" matches more than one NetSuite item. Settle the ambiguity in NetSuite rather than letting the push pick one.`
            : `No active NetSuite item has the code "${sku}".`,
      });
    } catch (e) {
      // A read failure is NOT evidence of absence. Report that the question
      // could not be answered, and let the send guard remain the authority.
      return {
        status: "unknown",
        blockers: [],
        unknownReason:
          e instanceof Error
            ? `NetSuite item lookup failed: ${e.message}`
            : "NetSuite item lookup failed.",
      };
    }
  }

  return {
    status: blockers.length > 0 ? "blocked" : "ok",
    blockers,
    unknownReason: null,
  };
}
