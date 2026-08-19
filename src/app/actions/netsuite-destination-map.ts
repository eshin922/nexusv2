"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { netsuiteDestinationItemMap } from "@/db/schema";
import { ERR, ActionGuardError, runAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { requireAdminAction } from "@/lib/admin-guard";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { writeAuditEntry } from "@/lib/audit";
import {
  BV011_DESTINATIONS,
  bv011ItemType,
  bv011Label,
  isPerLineDestination,
} from "@/lib/netsuite/bv011-destinations";
import type { Bv011Destination, Bv011ItemType } from "@/lib/netsuite/bv011-destinations";

/**
 * BV-011 destination → NetSuite item, the admin surface.
 *
 * Mirrors `netsuite-service-map.ts`, which it supersedes, and keeps that
 * module's dispositions verbatim: resolution happens at save and on an
 * explicit Verify, never blindly; a transient NetSuite failure is
 * INDETERMINATE and updates nothing.
 *
 * What changed is the KEY. The old table keyed on `service_identity`, which
 * conflated what a fee means with which record it posts to — and `rd_total`
 * plus the `formulation` Direct Service both mean `OTC - Formulation`, so that
 * needed two rows for one item, free to drift apart. Keyed on the destination
 * it is one row.
 *
 * Admins configure the NetSuite record. They cannot configure which
 * destination an input belongs to — that is BV-011's, fixed in
 * `bv011-destinations.ts`, and nothing here can edit it.
 */

const ADMIN_PATH = "/admin/netsuite";

export type DestinationMappingRow = {
  destination: Bv011Destination;
  label: string;
  /** What BV-011 requires the mapped record to BE. */
  governedItemType: Bv011ItemType;
  netsuiteItemCode: string | null;
  netsuiteInternalId: string | null;
  resolvedAt: string | null;
  /** True where the record is chosen per line, so a firm mapping is wrong by design. */
  perLine: boolean;
};

function requireDestination(raw: FormDataEntryValue | null): Bv011Destination {
  const v = String(raw ?? "").trim();
  const known = BV011_DESTINATIONS.find((d) => d.key === v);
  if (!known) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `"${v}" is not a governed BV-011 destination.`,
    );
  }
  if (isPerLineDestination(known.key)) {
    // Refused rather than accepted-and-ignored. `OTC - Other Service` has its
    // item chosen per line; storing a firm-wide record would create a default
    // that silently wins over the per-line selection.
    throw new ActionGuardError(
      ERR.VALIDATION,
      `${known.label} has no firm-wide NetSuite item by design — its item is chosen per line.`,
    );
  }
  return known.key;
}

/**
 * Read every governed destination, mapped or not.
 *
 * The unmapped ones are returned too: an admin needs to see what is missing,
 * and a projection blocks on exactly those.
 */
export async function listDestinationMappings(): Promise<
  ActionResult<{ rows: DestinationMappingRow[] }>
> {
  return runAction(async () => {
    await requireAdminAction();
    const stored = await db.select().from(netsuiteDestinationItemMap);
    const byKey = new Map(stored.map((r) => [r.destination, r] as const));

    const rows: DestinationMappingRow[] = BV011_DESTINATIONS.map((d) => {
      const m = byKey.get(d.key);
      return {
        destination: d.key,
        label: d.label,
        governedItemType: d.itemType,
        netsuiteItemCode: m?.netsuiteItemCode ?? null,
        netsuiteInternalId: m?.netsuiteInternalId ?? null,
        resolvedAt: m?.resolvedAt?.toISOString() ?? null,
        perLine: isPerLineDestination(d.key),
      };
    });
    return { rows };
  });
}

/**
 * Map a destination to a NetSuite item, resolving the entered code to its
 * authoritative internal id.
 *
 * Resolution happens HERE rather than at push for the reason the service map
 * already records: at push an operator is mid-completion on a real quote and
 * cannot fix a NetSuite catalog problem, whereas an admin here is already
 * doing catalog work and no quote is blocked.
 */
export async function saveDestinationMapping(
  formData: FormData,
): Promise<ActionResult<{ itemCode: string; internalId: string }>> {
  return runAction(async () => {
    const user = await requireAdminAction();
    const destination = requireDestination(formData.get("destination"));
    const itemCode = String(formData.get("netsuiteItemCode") ?? "").trim();
    if (!itemCode) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Enter the NetSuite item code for ${bv011Label(destination)}.`,
      );
    }

    const { netsuite } = await getApplicationDependencies();
    const resolution = await netsuite.resolveItem(itemCode);
    if (resolution.status === "not_found") {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `No active NetSuite item has the code "${itemCode}". Check the code in NetSuite — nothing was saved.`,
      );
    }
    if (resolution.status === "ambiguous") {
      // Never first-match. Ambiguity is a catalog problem an admin must
      // settle; picking one here would post the wrong item silently.
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${itemCode}" matches more than one NetSuite item (${resolution.matches
          .map((c) => `${c.itemid} · ${c.itemtype} · id ${c.netsuiteItemId}`)
          .join("; ")}). Use a code that identifies one item — nothing was saved.`,
      );
    }

    const prior = await db
      .select()
      .from(netsuiteDestinationItemMap)
      .where(eq(netsuiteDestinationItemMap.destination, destination))
      .limit(1);

    await db
      .insert(netsuiteDestinationItemMap)
      .values({
        destination,
        netsuiteItemCode: resolution.sku,
        netsuiteInternalId: resolution.netsuiteItemId,
        resolvedAt: new Date(),
        resolvedByUserId: user.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: netsuiteDestinationItemMap.destination,
        set: {
          netsuiteItemCode: resolution.sku,
          netsuiteInternalId: resolution.netsuiteItemId,
          resolvedAt: new Date(),
          resolvedByUserId: user.id,
          updatedAt: new Date(),
        },
      });

    // Named for the TRANSITION — a destination became mapped. How it was
    // resolved is mechanism and lives in diff_json.
    await writeAuditEntry({
      userId: user.id,
      entityType: "netsuite_destination_item_map",
      entityId: destination,
      action: "destination_item_mapping_set",
      diffJson: {
        destination,
        destination_label: bv011Label(destination),
        governed_item_type: bv011ItemType(destination),
        from: prior[0]
          ? {
              item_code: prior[0].netsuiteItemCode,
              internal_id: prior[0].netsuiteInternalId,
            }
          : null,
        to: { item_code: resolution.sku, internal_id: resolution.netsuiteItemId },
      },
    });

    revalidatePath(ADMIN_PATH);
    return { itemCode: resolution.sku, internalId: resolution.netsuiteItemId };
  });
}
