import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { netsuiteServiceItemMap } from "@/db/schema";
import {
  FIXED_SERVICE_IDENTITIES,
  isFixedServiceIdentity,
  type FixedServiceIdentity,
  type StoredServiceMapping,
} from "./service-item-map-rules";

/**
 * The database half of the Direct Service item mapping. The rules — which
 * identities are firm-mappable, and how a verdict is read — live in
 * `service-item-map-rules.ts`, which imports neither the database nor the
 * NetSuite client so that the parts most worth testing can be tested.
 */

export * from "./service-item-map-rules";

/** Stored state only — no network. Safe on a render path. */
export async function loadServiceItemMappings(): Promise<
  Map<FixedServiceIdentity, StoredServiceMapping>
> {
  const rows = await db
    .select()
    .from(netsuiteServiceItemMap)
    .where(
      inArray(netsuiteServiceItemMap.serviceIdentity, [
        ...FIXED_SERVICE_IDENTITIES,
      ]),
    );
  const out = new Map<FixedServiceIdentity, StoredServiceMapping>();
  for (const r of rows) {
    // The schema CHECK guarantees this, but the enum type is wider than the
    // four, so narrow rather than cast.
    if (!isFixedServiceIdentity(r.serviceIdentity)) continue;
    out.set(r.serviceIdentity, {
      serviceIdentity: r.serviceIdentity,
      netsuiteItemCode: r.netsuiteItemCode,
      netsuiteInternalId: r.netsuiteInternalId,
      resolvedAt: r.resolvedAt,
    });
  }
  return out;
}

