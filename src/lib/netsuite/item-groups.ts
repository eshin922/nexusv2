import "server-only";
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { netsuiteItemGroups } from "@/db/schema";
import {
  SYSTEM_ACTORS,
  writeAuditEntry,
  writeAuditEntryReturningId,
  writeSystemAuditEntry,
} from "@/lib/audit";
import {
  computeCompositionHash,
  externalIdForHash,
  type CompositionHashInput,
} from "./composition-hash";
import { generateGroupDescription } from "./description-generator";
import {
  createRecord,
  nsRequest,
  suiteQL,
  type NetsuiteConfig,
} from "./client";
import { NetsuiteError } from "./errors";

// Slice 12 Step 8c-1 — Item Group find-or-create.
//
// Three-layer lookup per CA §4A + Amendment A:
//   1. Local cache (netsuite_item_groups by composition_hash) — fast path.
//   2. SuiteQL by externalId — belt against local-cache miss + a prior
//      partial-write where NetSuite has the group but our cache lost
//      the row (network partition mid-persist). Self-healing sync.
//   3. REST POST create — the actual creation path.
//
// CHECK-before-write at every layer (CLAUDE.md #145 from_stage
// poisoning precedent). Constraints (unique on composition_hash +
// unique on netsuite_external_id) are belt-and-suspenders; the CHECK
// is the real prevention.
//
// The description is WRITE-ONCE. On cache miss + SuiteQL hit, we
// persist the group locally but do NOT overwrite the NetSuite-side
// description (which may carry Aisha's manual edits).

export interface FindOrCreateInput {
  hashInput: CompositionHashInput;
  // Members enriched with sku + name for the description text.
  members: Array<{
    netsuiteItemId: string;
    quantity: number;
    sku: string;
    name: string;
  }>;
  // Provenance for first-create only. quoteId is nullable to support
  // sandbox smoke tests + ad-hoc admin flows; production callers
  // always pass a real quote id.
  /**
   * The subsidiary the Sales Order and the member Items live under. REQUIRED:
   * NetSuite refuses members whose subsidiaries are not contained by the
   * group's. Supplied by the caller from governed authority.
   */
  subsidiaryId: string;
  customerDisplay: string;
  dealName: string;
  hubspotDealId: string;
  quoteId: string | null;
  userId: string | null;
}

export interface FindOrCreateResult {
  compositionHash: string;
  netsuiteExternalId: string;
  netsuiteInternalId: string;
  itemidDisplay: string;
  outcome: "cache_hit" | "external_id_hit" | "created";
}

/**
 * Find or create the NetSuite Item Group matching the given
 * composition. Returns the group's identity + the outcome branch that
 * fired (for audit + smoke reporting).
 */
export async function findOrCreateItemGroup(
  input: FindOrCreateInput,
  opts?: { config?: NetsuiteConfig },
): Promise<FindOrCreateResult> {
  const compositionHash = computeCompositionHash(input.hashInput);
  const externalId = externalIdForHash(compositionHash);

  // ---------- Layer 1: local cache ----------
  const cacheHit = await db
    .select()
    .from(netsuiteItemGroups)
    .where(eq(netsuiteItemGroups.compositionHash, compositionHash))
    .limit(1);

  if (cacheHit.length > 0) {
    const row = cacheHit[0];
    // Touch last_synced_at so we know the row is being actively used
    // (may inform future cache-eviction / re-verification policies).
    await db
      .update(netsuiteItemGroups)
      .set({ lastSyncedAt: new Date() })
      .where(eq(netsuiteItemGroups.compositionHash, compositionHash));

    await writeAudit({
      action: "netsuite_item_group_reused",
      compositionHash,
      quoteId: input.quoteId,
      userId: input.userId,
      diff: {
        outcome: "cache_hit",
        netsuite_external_id: row.netsuiteExternalId,
        netsuite_internal_id: row.netsuiteInternalId,
        itemid_display: row.itemidDisplay,
      },
    });

    return {
      compositionHash,
      netsuiteExternalId: row.netsuiteExternalId,
      netsuiteInternalId: row.netsuiteInternalId,
      itemidDisplay: row.itemidDisplay,
      outcome: "cache_hit",
    };
  }

  // ---------- Layer 2: SuiteQL by externalId (self-healing) ----------
  // If NetSuite already has the group but our local cache lost the row
  // (partition mid-persist during an earlier push), the externalId
  // still points at it. Persist locally, do NOT re-create.
  const suiteQLResult = await suiteQL<{ id: string; itemid: string }>(
    `SELECT id, itemid FROM item WHERE externalid = '${externalId.replace(/'/g, "''")}' AND itemtype = 'Group'`,
    { config: opts?.config },
  );

  if (suiteQLResult.items.length > 0) {
    const nsRow = suiteQLResult.items[0];
    // Persist locally. Description column left NULL because we don't
    // trust NetSuite's current description to be Nexus-authored (may
    // carry an Aisha manual edit). The description we WOULD have
    // generated is not re-written on reuse per policy.
    await db.insert(netsuiteItemGroups).values({
      compositionHash,
      netsuiteExternalId: externalId,
      netsuiteInternalId: nsRow.id,
      customerNetsuiteId: input.hashInput.customerNetsuiteId,
      baseSku: input.hashInput.baseSku,
      itemidDisplay: nsRow.itemid,
      description: null,
      firstUsedByQuoteId: input.quoteId,
      firstUsedByUserId: input.userId,
      firstUsedByDealId: input.hubspotDealId,
    });

    await writeAudit({
      action: "netsuite_item_group_reused",
      compositionHash,
      quoteId: input.quoteId,
      userId: input.userId,
      diff: {
        outcome: "external_id_hit",
        netsuite_external_id: externalId,
        netsuite_internal_id: nsRow.id,
        itemid_display: nsRow.itemid,
        note: "cache-miss recovery — NetSuite had the group; local cache re-populated",
      },
    });

    return {
      compositionHash,
      netsuiteExternalId: externalId,
      netsuiteInternalId: nsRow.id,
      itemidDisplay: nsRow.itemid,
      outcome: "external_id_hit",
    };
  }

  // ---------- Layer 3: REST POST create ----------
  const itemidDisplay = await pickAvailableDisplayName(
    input.hashInput.customerNetsuiteId,
    input.hashInput.baseSku,
  );

  const description = generateGroupDescription({
    customerDisplay: input.customerDisplay,
    dealName: input.dealName,
    baseSku: input.hashInput.baseSku,
    hubspotDealId: input.hubspotDealId,
    members: input.members.map((m) => ({
      sku: m.sku,
      name: m.name,
      quantity: m.quantity,
    })),
  });

  // REST record shape for Item Group create — verified via sandbox
  // probe on existing group 57232 (2026-07-28). Field names differ
  // from what SuiteScript / SOAP would use:
  //   - member (singular), not memberList
  //   - member.items[] — the members collection
  //   - member.items[N].item.id — the referenced item's internal id
  //   - quantity: per-assembly-unit (matches composition-hash inputs);
  //     defaults to 1 if omitted
  // POST returns 204 No Content with Location header carrying the new
  // internal id — createRecord() already handles this shape.
  const body: Record<string, unknown> = {
    itemId: itemidDisplay,
    externalId,
    description,
    // Step 2 (2026-08-12) — corrects the Probe-7-era gap. Without this,
    // NetSuite refuses the members outright:
    //
    //   "You may not add members to a group/kit/assembly unless the
    //    subsidiaries for those members completely contain the subsidiaries
    //    of the group/kit/assembly."
    //
    // Observed live on the manual Group A save, so this is a measured
    // constraint. Sourced from the SAME governed subsidiary authority the
    // Sales Order uses — never hardcoded, or the primitive would only work
    // inside the Case B fixture.
    // FINDING (disposable sandbox probe, 2026-08-12): on `itemGroup` this is a
    // COLLECTION, not a reference. `{ id }` is rejected INVALID_VALUE —
    // "Invalid value for the resource or sub-resource field 'subsidiary'".
    // Item records are multi-subsidiary under OneWorld, which the UI shows as
    // a multi-select list. The Sales Order header takes `{ id }`; the item
    // group does not, and the two shapes are not interchangeable.
    subsidiary: { items: [{ id: input.subsidiaryId }] },
    member: {
      items: input.members.map((m) => ({
        item: { id: m.netsuiteItemId },
        quantity: m.quantity,
      })),
    },
  };

  const created = await createRecord({
    recordType: "itemGroup",
    body,
    config: opts?.config,
    idempotencyKey: externalId,
  });

  await db.insert(netsuiteItemGroups).values({
    compositionHash,
    netsuiteExternalId: externalId,
    netsuiteInternalId: created.internalId,
    customerNetsuiteId: input.hashInput.customerNetsuiteId,
    baseSku: input.hashInput.baseSku,
    itemidDisplay,
    description,
    firstUsedByQuoteId: input.quoteId,
    firstUsedByUserId: input.userId,
    firstUsedByDealId: input.hubspotDealId,
  });

  await writeAudit({
    action: "netsuite_item_group_created",
    compositionHash,
    quoteId: input.quoteId,
    userId: input.userId,
    diff: {
      outcome: "created",
      netsuite_external_id: externalId,
      netsuite_internal_id: created.internalId,
      itemid_display: itemidDisplay,
      description,
      member_count: input.members.length,
      hubspot_deal_id: input.hubspotDealId,
    },
  });

  return {
    compositionHash,
    netsuiteExternalId: externalId,
    netsuiteInternalId: created.internalId,
    itemidDisplay,
    outcome: "created",
  };
}

/**
 * Pick a `<base_sku>-G[N]` display name that doesn't collide with any
 * existing NetSuite Item Group. Scans local cache (for this customer +
 * base) AND SuiteQL against NetSuite (for cross-customer occupancy in
 * Era A/B legacy names). First free slot wins:
 *   -G → -G2 → -G3 → …
 *
 * Not perfectly race-free — if two markComplete flows run
 * simultaneously for different customers with the same base SKU,
 * they could both pick -G4 and the second create fails at NetSuite
 * on unique-itemId. That's fine: caller retries; the retry re-scans
 * and picks -G5.
 */
async function pickAvailableDisplayName(
  customerNetsuiteId: string,
  baseSku: string,
): Promise<string> {
  const localPrefix = `${baseSku}-G`;

  // Local cache — any prior use of a -G / -Gn slot for this base
  // (any customer, since the itemid namespace is global in NetSuite).
  const localHits = await db
    .select({ itemidDisplay: netsuiteItemGroups.itemidDisplay })
    .from(netsuiteItemGroups)
    .where(like(netsuiteItemGroups.baseSku, baseSku));
  const localSuffixes = new Set(
    localHits
      .map((r) => extractSuffix(r.itemidDisplay, baseSku))
      .filter((s): s is number => s !== null),
  );

  // NetSuite — scan for any Item Group whose itemid starts with
  // "<base>-G". Covers Era A -G1..G5 legacy variants + any group
  // created outside Nexus.
  const escapedBase = baseSku.replace(/'/g, "''");
  const nsResult = await suiteQL<{ itemid: string }>(
    `SELECT itemid FROM item WHERE itemtype = 'Group' AND itemid LIKE '${escapedBase}-G%'`,
  );
  const nsSuffixes = new Set(
    nsResult.items
      .map((r) => extractSuffix(r.itemid, baseSku))
      .filter((s): s is number => s !== null),
  );

  const taken = new Set<number>([...localSuffixes, ...nsSuffixes]);
  // Slot 1 = "-G" (no number); slot N (N≥2) = "-GN".
  for (let n = 1; n < 1000; n++) {
    if (!taken.has(n)) {
      return n === 1 ? `${baseSku}-G` : `${baseSku}-G${n}`;
    }
  }
  throw new Error(
    `[item-groups] Cannot find available display name for ${baseSku} — 1000 slots exhausted`,
  );
}

/**
 * Extract the numeric suffix from a display name matching `<base>-G[N]`.
 * Returns 1 for bare `-G`, N for `-GN`, null if the name doesn't match.
 */
function extractSuffix(itemid: string, baseSku: string): number | null {
  const prefix = `${baseSku}-G`;
  if (!itemid.startsWith(prefix)) return null;
  const rest = itemid.slice(prefix.length);
  if (rest === "") return 1;                    // bare "-G"
  if (!/^\d+$/.test(rest)) return null;         // "-G-something-else" doesn't count
  const n = parseInt(rest, 10);
  return Number.isFinite(n) && n >= 2 ? n : null;
}

// ---------- audit ----------

interface AuditArgs {
  action: "netsuite_item_group_created" | "netsuite_item_group_reused";
  compositionHash: string;
  quoteId: string | null;
  userId: string | null;
  diff: Record<string, unknown>;
}

async function writeAudit(args: AuditArgs): Promise<void> {
  // The first explicit system actor — Gate 1A actor model.
  //
  // `AuditArgs.userId` is `string | null` per CALL, not per code path: the same
  // Item Group push runs both operator-initiated and unattended. So the branch
  // is on whether a person actually acted, which is what the trace needs to
  // report, rather than on which module happens to execute the write.
  //
  // An operator-triggered push is a HUMAN event even though a machine performed
  // it. The distinction the model draws is accountability, not mechanism.
  //
  // An unattended push is a SYSTEM event and terminates as one, explicitly.
  // Previously this wrote a bare null actor — a row that a trace could not
  // distinguish from a human event whose actor had gone missing. It now says
  // which it is.
  const shared = {
    entityType: "netsuite_item_group",
    entityId: args.compositionHash,
    action: args.action,
    diffJson: { ...args.diff, quote_id: args.quoteId },
  };

  if (args.userId !== null) {
    await writeAuditEntry({ ...shared, userId: args.userId });
    return;
  }
  await writeSystemAuditEntry({ ...shared, systemActor: SYSTEM_ACTORS.netsuiteIntegration });
}

/**
 * Read an Item Group's CURRENT membership from NetSuite.
 *
 * Step 2 reuse safety. `nxs-grp-<hash>` proves the group was created for a
 * composition once; it does not prove it still has that composition, because
 * an administrator can change members afterwards without the external id
 * changing. Callers verify this against the frozen plan
 * (`verifyReusedGroupMembership`) and refuse before Sales Order CREATE.
 *
 * Read-only.
 */
export async function readItemGroupMembers(
  groupInternalId: string,
): Promise<Array<{ netsuiteItemId: string; quantity: number }>> {
  const escaped = groupInternalId.replace(/'/g, "''");
  const result = await suiteQL<{ item: string; quantity: string | null }>(
    `SELECT gm.item AS item, gm.quantity AS quantity
       FROM itemMember gm
      WHERE gm.parentitem = '${escaped}'`,
  );
  return result.items.map((r) => ({
    netsuiteItemId: String(r.item),
    quantity: Number(r.quantity ?? 0),
  }));
}

/**
 * Read a Sales Order's item lines from the REST sub-resource — the ONLY
 * authoritative source for the PATCH address.
 *
 * PROVEN ON A DISPOSABLE SANDBOX ORDER (SO 361241, 2026-08-12, since deleted):
 *
 *   SuiteQL id/seq | itemtype  | REST array pos | REST self href
 *   ---------------+-----------+----------------+----------------
 *   0              | mainline  | (absent)       | (absent)
 *   1              | Group     | [0]            | /item/1
 *   2              | InvtPart  | [1]            | /item/2
 *   3              | InvtPart  | [2]            | /item/3
 *   4              | EndGroup  | [3]            | /item/4
 *   5              | TaxGroup  | (absent)       | (absent)
 *
 * REST ARRAY POSITION IS OFF BY ONE from the address, because the collection
 * omits the mainline and system rows. Patching by array position would have
 * hit the Group header instead of the first member — succeeding silently
 * against the wrong line.
 *
 * SuiteQL ids are unusable as addresses for a second reason: after a single
 * member PATCH the TaxGroup row's id moved 5 → 6 while the commercial lines
 * kept theirs. They are not stable across mutation.
 *
 * So the address is the element's own `line`, read per line from
 * `/salesOrder/{id}/item/{n}`. That single GET returns address AND structure
 * AND data together — `line`, `item.id`, `quantity`, `rate`, `amount`,
 * `itemType` (Group / InvtPart / EndGroup) and Item-derived `class` — so no
 * cross-source correlation is required, and none is performed.
 */
export async function readSalesOrderLines(soId: string): Promise<
  Array<{
    line: number;
    itemId: string | null;
    itemType: string | null;
    quantity: number | null;
    rate: number | null;
    amount: number | null;
    classId: string | null;
  }>
> {
  const collection = await nsRequest<{
    items?: Array<{ links?: Array<{ href?: string }> }>;
  }>({
    method: "GET",
    path: `/record/v1/salesOrder/${encodeURIComponent(soId)}/item`,
  });

  // Addresses come from each element's OWN self href, never from its position.
  const addresses: number[] = [];
  for (const el of collection.items ?? []) {
    const href = el.links?.find((l) => l.href)?.href ?? "";
    const m = /\/item\/(\d+)\s*$/.exec(href);
    if (m) addresses.push(Number(m[1]));
  }

  const lines: Array<{
    line: number;
    itemId: string | null;
    itemType: string | null;
    quantity: number | null;
    rate: number | null;
    amount: number | null;
    classId: string | null;
  }> = [];

  for (const address of addresses) {
    const l = await nsRequest<Record<string, unknown>>({
      method: "GET",
      path: `/record/v1/salesOrder/${encodeURIComponent(soId)}/item/${address}`,
    });
    const item = l.item as { id?: unknown } | undefined;
    const itemType = l.itemType as { id?: unknown; refName?: unknown } | string | undefined;
    const cls = l.class as { id?: unknown } | undefined;
    lines.push({
      // Prefer the element's own `line`; fall back to the href it was fetched
      // by. Both were observed identical, and neither is an array position.
      line: typeof l.line === "number" ? l.line : address,
      itemId: item?.id != null ? String(item.id) : null,
      itemType:
        typeof itemType === "string"
          ? itemType
          : itemType?.id != null
            ? String(itemType.id)
            : itemType?.refName != null
              ? String(itemType.refName)
              : null,
      quantity: typeof l.quantity === "number" ? l.quantity : null,
      rate: typeof l.rate === "number" ? l.rate : null,
      amount: typeof l.amount === "number" ? l.amount : null,
      classId: cls?.id != null ? String(cls.id) : null,
    });
  }
  return lines;
}
