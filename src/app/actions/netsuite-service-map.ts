"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { netsuiteServiceItemMap } from "@/db/schema";
import { writeAuditEntry } from "@/lib/audit";
import { requireAdminAction } from "@/lib/admin-guard";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import {
  FIXED_SERVICE_IDENTITIES,
  isFixedServiceIdentity,
  loadServiceItemMappings,
  validateServiceItemMappings,
  type FixedServiceIdentity,
  type MappingVerdict,
} from "@/lib/netsuite/service-item-map";
import {
  DIRECT_SERVICE_LABELS,
  type DirectServiceIdentity,
} from "@/lib/product-structure/direct-service";

/**
 * Admin actions for the Direct Service → NetSuite item mapping.
 *
 * Design: `docs/direct-service-netsuite-mapping-design.md`.
 *
 * Both writers are admin-gated. This is firm-level routing configuration that
 * decides which NetSuite record every future Sales Order line for a service
 * points at — the same class of authority as markup defaults, and gated the
 * same way.
 */

const ADMIN_PATH = "/admin/netsuite";

/** One row for the Settings table: stored state plus its live verdict. */
export type ServiceMappingRow = {
  serviceIdentity: FixedServiceIdentity;
  label: string;
  netsuiteItemCode: string | null;
  netsuiteInternalId: string | null;
  resolvedAt: string | null;
  /** `null` when no live check was requested — the caller sees stored state only. */
  verdict: MappingVerdict | null;
};

/**
 * Read the four mappings.
 *
 * `live` defaults to FALSE, deliberately. Stored state is a DB read and safe
 * anywhere; the live check is a NetSuite round trip and belongs only where a
 * network dependency is already accepted. Making the cheap read the default
 * means a new caller has to ASK for the expensive one.
 */
export async function listServiceItemMappings(
  live = false,
): Promise<ActionResult<{ rows: ServiceMappingRow[] }>> {
  return runAction(async () => {
    await requireAdminAction();
    const stored = await loadServiceItemMappings();

    // Through the port, per OD-023 — the isolated harness must be able to
    // answer this without reaching production NetSuite.
    const { netsuite } = await getApplicationDependencies();
    const verdicts = live
      ? await validateServiceItemMappings(
          netsuite,
          [...stored.values()].map((m) => ({
            serviceIdentity: m.serviceIdentity,
            netsuiteInternalId: m.netsuiteInternalId,
          })),
        )
      : null;

    const rows: ServiceMappingRow[] = FIXED_SERVICE_IDENTITIES.map((id) => {
      const m = stored.get(id);
      return {
        serviceIdentity: id,
        label: DIRECT_SERVICE_LABELS[id],
        netsuiteItemCode: m?.netsuiteItemCode ?? null,
        netsuiteInternalId: m?.netsuiteInternalId ?? null,
        resolvedAt: m?.resolvedAt.toISOString() ?? null,
        verdict: verdicts?.get(id) ?? null,
      };
    });
    return { rows };
  });
}

function requireFixedIdentity(raw: unknown): FixedServiceIdentity {
  if (typeof raw !== "string") {
    throw new ActionGuardError(ERR.VALIDATION, "Service identity is required.");
  }
  // Narrowed through the governed enum first, so an unknown string cannot
  // reach the fixed-set check and be reported as "not a fixed identity" when
  // it is not an identity at all.
  const known = (
    Object.keys(DIRECT_SERVICE_LABELS) as DirectServiceIdentity[]
  ).find((k) => k === raw);
  if (!known) {
    throw new ActionGuardError(
      ERR.VALIDATION,
      `Unknown service identity: ${raw}`,
    );
  }
  if (!isFixedServiceIdentity(known)) {
    // The one case worth its own sentence. `other_service` is refused here
    // AND by a schema CHECK; this is the message, that is the enforcement.
    throw new ActionGuardError(
      ERR.VALIDATION,
      "Other Service has no firm-wide NetSuite item. It is the catch-all and carries no single accounting meaning, so its item is selected per service line on the quote.",
    );
  }
  return known;
}

/**
 * Map a service identity to a NetSuite item, resolving the entered item code
 * to its authoritative internal id.
 *
 * ── WHY RESOLUTION HAPPENS HERE ───────────────────────────────────────────
 *
 * `resolveNetsuiteItem` already refuses `not_found` and `ambiguous`, and those
 * refusals are correct. What was wrong was WHEN an admin met them: at push
 * time an operator is mid-completion on a real quote and cannot fix a NetSuite
 * catalog problem. Here, an admin is already doing catalog work and no quote
 * is blocked.
 *
 * The existing resolver is reused rather than a second lookup written. Two
 * lookups would be two answers to "which item is this", which is the
 * divergence Pattern 58 warns about.
 */
export async function saveServiceItemMapping(
  formData: FormData,
): Promise<ActionResult<{ itemCode: string; internalId: string }>> {
  return runAction(async () => {
    const user = await requireAdminAction();
    const identity = requireFixedIdentity(formData.get("serviceIdentity"));
    const itemCode = String(formData.get("netsuiteItemCode") ?? "").trim();
    if (!itemCode) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Enter the NetSuite item code (SKU) for this service.",
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
      // settle; picking one here would push the wrong item silently.
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${itemCode}" matches more than one NetSuite item (${resolution.matches
          .map((c) => `${c.itemid} · ${c.itemtype} · id ${c.netsuiteItemId}`)
          .join("; ")}). Use a code that identifies one item — nothing was saved.`,
      );
    }

    const prior = await db
      .select()
      .from(netsuiteServiceItemMap)
      .where(eq(netsuiteServiceItemMap.serviceIdentity, identity))
      .limit(1);

    await db
      .insert(netsuiteServiceItemMap)
      .values({
        serviceIdentity: identity,
        netsuiteItemCode: resolution.sku,
        netsuiteInternalId: resolution.netsuiteItemId,
        resolvedAt: new Date(),
        resolvedByUserId: user.id,
      })
      .onConflictDoUpdate({
        target: netsuiteServiceItemMap.serviceIdentity,
        set: {
          netsuiteItemCode: resolution.sku,
          netsuiteInternalId: resolution.netsuiteItemId,
          resolvedAt: new Date(),
          resolvedByUserId: user.id,
        },
      });

    // Named for the TRANSITION, not the mechanism — a service identity became
    // mapped. Whether that happened via SuiteQL or anything else is
    // mechanism, and lives in diff_json.
    await writeAuditEntry({
      userId: user.id,
      entityType: "netsuite_service_item_map",
      entityId: identity,
      action: "service_item_mapping_set",
      diffJson: {
        service_identity: identity,
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

/**
 * Re-confirm a stored mapping against NetSuite.
 *
 * Explicit, per the disposition: resolution happens at save, and otherwise
 * only when an admin asks. Nothing re-runs it blindly.
 *
 * An indeterminate result updates NOTHING — not `resolved_at`, not the audit
 * log. A failed read is not a confirmation, and stamping it as one would
 * convert "we could not check" into "we checked and it was fine", which is the
 * exact rewrite the three-valued state exists to prevent.
 */
export async function verifyServiceItemMapping(
  serviceIdentity: string,
): Promise<ActionResult<{ verdict: MappingVerdict }>> {
  return runAction(async () => {
    const user = await requireAdminAction();
    const identity = requireFixedIdentity(serviceIdentity);

    const stored = await loadServiceItemMappings();
    const mapping = stored.get(identity);
    if (!mapping) {
      throw new ActionGuardError(
        ERR.NOT_FOUND,
        `${DIRECT_SERVICE_LABELS[identity]} is not mapped yet — there is nothing to verify.`,
      );
    }

    const { netsuite } = await getApplicationDependencies();
    const verdicts = await validateServiceItemMappings(netsuite, [
      { serviceIdentity: identity, netsuiteInternalId: mapping.netsuiteInternalId },
    ]);
    const verdict = verdicts.get(identity) ?? {
      state: "indeterminate" as const,
      reason: "no verdict returned",
    };

    if (verdict.state === "usable") {
      await db
        .update(netsuiteServiceItemMap)
        .set({ resolvedAt: new Date() })
        .where(eq(netsuiteServiceItemMap.serviceIdentity, identity));
      await writeAuditEntry({
        userId: user.id,
        entityType: "netsuite_service_item_map",
        entityId: identity,
        action: "service_item_mapping_verified",
        diffJson: {
          service_identity: identity,
          internal_id: mapping.netsuiteInternalId,
          item_code: verdict.itemCode,
        },
      });
    }

    revalidatePath(ADMIN_PATH);
    return { verdict };
  });
}
