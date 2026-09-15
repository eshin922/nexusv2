"use server";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { skuAllocations, skuBrandRegistry, skuCounters } from "@/db/schema";
import { ActionGuardError, ERR, runAction, type ActionResult } from "@/lib/action-result";
import { requireAdminAction } from "@/lib/admin-guard";
import { getApplicationDependencies } from "@/lib/integrations/composition";
import { normalizeToken } from "@/lib/sku/format";

/**
 * Customer SKU codes — the maintainable half of the registry.
 *
 * ── WHAT SAVING A CODE DOES, AND WHAT IT DELIBERATELY DOES NOT ───────────
 *
 * Saving settles ONE question: which mnemonic belongs to which customer
 * record. It does not settle where that code starts counting, and it must not
 * appear to. The starting number depends on what identifiers already exist
 * across Nexus, HubSpot and production NetSuite, and a number chosen without
 * that check can sit below an identifier some product already carries --
 * which is a collision minted by the tool meant to prevent them.
 *
 * So a saved code lands APPROVED WITH NO COUNTER, and that is a real state
 * rather than a half-finished write: allocation refuses on a NULL
 * `next_number` independently of approval, so the code exists, is visible,
 * and cannot issue anything. The Settings list calls it "awaiting setup".
 *
 * Seeding remains its own operation, through `npm run admin:sku-registry`,
 * because it is the one that needs the inventory check.
 *
 * ── THE CODE IS TYPED, NEVER DERIVED ─────────────────────────────────────
 *
 * A person enters the mnemonic. Nothing here proposes one from a customer
 * name or a product name: a token is a permanent namespace, and deriving one
 * from whatever someone typed would make a typo permanent.
 */

export type CustomerSkuCode = {
  token: string;
  customerLabel: string;
  hubspotCompanyId: string | null;
  /** `ready` once the counter is seeded; until then the code cannot issue. */
  readiness: "ready" | "awaiting_setup";
  nextNumber: number | null;
  /**
   * How many identifiers have been issued under this code. Non-zero makes the
   * row permanent: the SKUs are out in catalogs and on quotes already sent.
   */
  issuedCount: number;
  approvedByEmail: string | null;
  approvedAt: Date | null;
};

/** Every code, with what it can do. Admin-only, like the rest of Settings. */
export async function listCustomerSkuCodes(): Promise<ActionResult<CustomerSkuCode[]>> {
  return runAction(async () => {
    await requireAdminAction();
    const rows = await db.execute<{
      token: string;
      customer_label: string;
      hubspot_company_id: string | null;
      next_number: number | null;
      issued_count: number;
      approved_by_email: string | null;
      approved_at: Date | null;
    }>(sql`
      select r.token,
             r.customer_label,
             r.hubspot_company_id,
             c.next_number,
             (select count(*)::int from sku_allocations a where a.token = r.token)
               as issued_count,
             u.email as approved_by_email,
             r.approved_at
        from sku_brand_registry r
        left join sku_counters c on c.token = r.token
        left join users u on u.id = r.approved_by_user_id
       where r.status = 'approved'
       order by r.customer_label asc
    `);

    return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
      token: r.token as string,
      customerLabel: r.customer_label as string,
      hubspotCompanyId: (r.hubspot_company_id as string | null) ?? null,
      readiness: r.next_number == null ? ("awaiting_setup" as const) : ("ready" as const),
      nextNumber: (r.next_number as number | null) ?? null,
      issuedCount: Number(r.issued_count ?? 0),
      approvedByEmail: (r.approved_by_email as string | null) ?? null,
      approvedAt: (r.approved_at as Date | null) ?? null,
    }));
  });
}

/** A HubSpot company, with whatever code it already has. */
export type SkuCustomerCandidate = {
  companyId: string;
  name: string;
  /** Present when this company already has a code. It must not get a second. */
  existingToken: string | null;
};

/**
 * Search the HubSpot company directory.
 *
 * Live rather than from the deals cache: the cache holds only companies that
 * already have a deal in Nexus, and a customer can need a code before their
 * first one lands. Resolving against the directory is also how the existing
 * 19 mappings were built, so the two agree about what a company id means.
 */
export async function searchSkuCustomers(
  query: string,
): Promise<ActionResult<SkuCustomerCandidate[]>> {
  return runAction(async () => {
    await requireAdminAction();
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    // Through the PROVIDER, not `@/lib/hubspot` directly. A direct import
    // would reach the real hub from the isolated environment too, which is
    // exactly what the composition boundary exists to prevent -- and a walk
    // that silently queries production HubSpot is not an isolated walk.
    const { hubspot } = await getApplicationDependencies();
    const companies = await hubspot.searchCustomers(trimmed, 25);
    if (companies.length === 0) return [];

    const taken = await db
      .select({
        token: skuBrandRegistry.token,
        companyId: skuBrandRegistry.hubspotCompanyId,
      })
      .from(skuBrandRegistry)
      .where(
        and(
          eq(skuBrandRegistry.status, "approved"),
          isNotNull(skuBrandRegistry.hubspotCompanyId),
        ),
      );
    const byCompany = new Map(taken.map((t) => [t.companyId as string, t.token]));

    return companies.map((c) => ({
      companyId: c.id,
      name: c.name,
      existingToken: byCompany.get(c.id) ?? null,
    }));
  });
}

/**
 * Save a customer's SKU code.
 *
 * Every refusal below is a DIFFERENT thing being wrong, and each says which.
 * A single "invalid code" would leave an operator guessing between a typo, a
 * code somebody else already holds, and a customer who already has one.
 */
export async function saveCustomerSkuCode(
  formData: FormData,
): Promise<ActionResult<{ token: string }>> {
  return runAction(async () => {
    const admin = await requireAdminAction();

    const companyId = String(formData.get("hubspotCompanyId") ?? "").trim();
    const customerLabel = String(formData.get("customerLabel") ?? "").trim();
    const raw = String(formData.get("token") ?? "").trim();

    if (!companyId) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Choose a customer. A code belongs to a customer record, not to a name.",
      );
    }
    if (!customerLabel) {
      throw new ActionGuardError(ERR.VALIDATION, "The customer has no name to record.");
    }

    // Normalized before validation, so `mistr` and `MISTR` are the same
    // proposal rather than two different ones that both look available.
    const token = normalizeToken(raw);
    if (!/^[A-Z][A-Z0-9]{1,11}$/.test(token)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `"${raw}" is not a usable code. Use 2 to 12 characters, letters and digits, starting with a letter — for example MISTR.`,
      );
    }

    await db.transaction(async (tx) => {
      // Taken by somebody else? The token is the primary key, so the insert
      // would fail anyway -- this exists to say WHO holds it, which is the
      // part an operator can act on.
      const [clash] = await tx
        .select({
          customerLabel: skuBrandRegistry.customerLabel,
          companyId: skuBrandRegistry.hubspotCompanyId,
        })
        .from(skuBrandRegistry)
        .where(eq(skuBrandRegistry.token, token))
        .limit(1);
      if (clash) {
        if (clash.companyId === companyId) {
          throw new ActionGuardError(
            ERR.VALIDATION,
            `${customerLabel} already has the code ${token}.`,
          );
        }
        throw new ActionGuardError(
          ERR.VALIDATION,
          `${token} already belongs to ${clash.customerLabel}. A code identifies one customer, so two cannot share it.`,
        );
      }

      // One code per customer. Without this a customer accumulates namespaces
      // and "which code is theirs" stops having an answer -- and the quote
      // path, which reads the first match, would start depending on row order.
      const [existing] = await tx
        .select({ token: skuBrandRegistry.token })
        .from(skuBrandRegistry)
        .where(
          and(
            eq(skuBrandRegistry.hubspotCompanyId, companyId),
            eq(skuBrandRegistry.status, "approved"),
          ),
        )
        .limit(1);
      if (existing) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `${customerLabel} already has the code ${existing.token}. Remove that one first if it is wrong; it can only be removed while it has issued nothing.`,
        );
      }

      // APPROVED, and deliberately WITHOUT a counter. The code is settled; its
      // starting number is not, and allocation refuses on the missing counter
      // independently of this row.
      await tx.insert(skuBrandRegistry).values({
        token,
        customerLabel,
        hubspotCompanyId: companyId,
        status: "approved",
        evidence: {
          source: "settings_sku_codes",
          entered_by_email: admin.email,
          entered_at: new Date().toISOString(),
          note: "Code entered in Settings. Counter deliberately unseeded: the starting number needs the three-system inventory check.",
        },
        proposedByUserId: admin.id,
        approvedByUserId: admin.id,
        approvedAt: new Date(),
      });
    });

    return { token };
  });
}

/**
 * Remove a code.
 *
 * Only ever while it has issued NOTHING. Once an identifier has been allocated
 * under a code, the code is in catalogs and on quotes that have been sent, and
 * removing the row would orphan every SKU that carries it. Existing product
 * SKUs are never touched by anything here -- this removes a mapping, and a
 * mapping with allocations behind it is not a mapping any more, it is history.
 */
export async function removeCustomerSkuCode(
  formData: FormData,
): Promise<ActionResult<{ token: string }>> {
  return runAction(async () => {
    await requireAdminAction();
    const token = normalizeToken(String(formData.get("token") ?? "").trim());
    if (!token) throw new ActionGuardError(ERR.VALIDATION, "Which code?");

    await db.transaction(async (tx) => {
      const [issued] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(skuAllocations)
        .where(eq(skuAllocations.token, token));
      if (Number(issued?.n ?? 0) > 0) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `${token} has already issued ${issued.n} SKU${issued.n === 1 ? "" : "s"}. Those identifiers are in the catalogs and on quotes, so the code stays.`,
        );
      }

      const [counter] = await tx
        .select({ nextNumber: skuCounters.nextNumber })
        .from(skuCounters)
        .where(eq(skuCounters.token, token))
        .limit(1);
      if (counter && counter.nextNumber != null) {
        throw new ActionGuardError(
          ERR.VALIDATION,
          `${token} has been seeded and is ready to issue. Removing a seeded code would discard the inventory check behind its starting number.`,
        );
      }

      // A counter row with nothing in it is removable with its code.
      if (counter) await tx.delete(skuCounters).where(eq(skuCounters.token, token));

      const deleted = await tx
        .delete(skuBrandRegistry)
        .where(eq(skuBrandRegistry.token, token))
        .returning({ token: skuBrandRegistry.token });
      if (deleted.length === 0) {
        throw new ActionGuardError(ERR.NOT_FOUND, `No code ${token}.`);
      }
    });

    return { token };
  });
}
