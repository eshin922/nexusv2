export type HubSpotStage = { id: string; label: string };
export type HubSpotOwnerByEmail = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};
export type HubSpotOwnerById = {
  name: string | null;
  email: string | null;
};
export type HubSpotVendor = {
  id: string;
  name: string;
};
export type HubSpotProductCreateInput = {
  name: string;
  hs_sku?: string;
  description?: string;
  hs_images?: string;
  hs_url?: string;
  hubspot_owner_id?: string;
  price?: string;
  hs_cost_of_goods_sold?: string;
  markup?: string;
  hs_product_type?: string;
  tax_schedule?: string;
  fsc_claim_type?: string;
  fsc_status?: string;
  fsc_supplier_verified?: string;
};
export type HubSpotProductCreateResult = {
  id: string;
  hs_sku: string | null;
  name: string;
  price: string | null;
  submittedProperties: Record<string, string>;
  responseBody: Record<string, unknown>;
};
export type HubSpotProductRaw = {
  id: string;
  archived: boolean;
  properties: Record<string, string | null>;
};
export type HubSpotProductPage = {
  results: HubSpotProductRaw[];
  nextAfter: string | null;
};

const HUBSPOT_PRODUCT_PRICE = /^\d+(?:\.\d+)?$/;

/**
 * HubSpot Product catalog price contract. Missing and blank prices become the
 * technical catalog prerequisite 0.00; an explicitly supplied nonnegative
 * decimal is preserved. This value is not a Nexus quote or transaction rate.
 */
export function canonicalizeHubSpotProductPrice(
  price: string | null | undefined,
): string {
  const value = String(price ?? "").trim();
  if (value === "") return "0.00";
  if (!HUBSPOT_PRODUCT_PRICE.test(value) || !Number.isFinite(Number(value))) {
    throw new Error("HubSpot Product price must be a nonnegative decimal number.");
  }
  return Number(value) === 0 ? "0.00" : value;
}

export function normalizeHubSpotProductCreateInput(
  input: HubSpotProductCreateInput,
): HubSpotProductCreateInput & { price: string } {
  return {
    ...input,
    price: canonicalizeHubSpotProductPrice(input.price),
  };
}

/**
 * An UPDATE is not a create that happens to carry an id.
 *
 * ── THREE STATES, NOT TWO ─────────────────────────────────────────────────
 *
 * A create describes a whole product, so "absent" can safely mean "empty".
 * An update describes a CHANGE, and absent has to mean something different
 * from empty or the contract cannot express leaving a field alone:
 *
 *   undefined — UNTOUCHED. Omitted from the request; HubSpot keeps its value.
 *   null      — CLEARED, deliberately. Sent as "", which is how HubSpot
 *               unsets a property. An operator who empties the URL field
 *               means it, and the request has to say so.
 *   string    — set to this value.
 *
 * Reusing the create input collapsed the first two: its mapper drops empty
 * strings, so "leave the URL alone" and "clear the URL" both became omission.
 * Whichever way that was read, one of them was wrong, and the operator got no
 * signal either way.
 *
 * ── NO PRICE DEFAULT ──────────────────────────────────────────────────────
 *
 * `price` is absent from this type on purpose. `canonicalizeHubSpotProductPrice`
 * turns an absent price into "0.00", which is correct for a create -- a new
 * product needs a price and zero is the honest default. On an update it would
 * have written 0.00 over whatever the product's price actually was, on EVERY
 * edit, as a side effect of renaming a product. The edit surface does not
 * author price, so it must not transmit one.
 */
export type HubSpotProductUpdateInput = {
  name?: string;
  hs_sku?: string | null;
  hs_url?: string | null;
  hs_cost_of_goods_sold?: string | null;
  hs_product_type?: string | null;
  description?: string | null;
};

/**
 * The wire form of an update: only the fields the caller actually addressed.
 *
 * Returns the property bag rather than a typed object because that IS the
 * distinction being preserved -- a key's PRESENCE carries the intent, and a
 * typed shape with optional members would lose it again at the boundary.
 */
export function toHubSpotProductUpdateProperties(
  input: HubSpotProductUpdateInput,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue; // untouched
    if (value === null) {
      out[key] = ""; // cleared, explicitly
      continue;
    }
    out[key] = String(value).trim();
  }
  return out;
}

/**
 * What HubSpot currently holds for a product, read back by id.
 *
 * Exists so an UNCERTAIN write can be adjudicated instead of guessed. A
 * timeout does not tell you whether the request applied, and reporting
 * "nothing was changed" on the strength of a thrown error is a claim about
 * a remote system nobody checked.
 */
export type HubSpotProductSnapshot = {
  id: string;
  archived: boolean;
  properties: Record<string, string | null>;
};

/**
 * Whether a failed write COULD have taken effect.
 *
 *   "rejected"  — HubSpot answered and refused. Nothing applied, and saying so
 *                 is a fact rather than an assumption.
 *   "uncertain" — no answer, or an answer that does not settle it: a timeout,
 *                 a dropped connection, a 5xx. The request may well have been
 *                 applied before the failure. This MUST NOT be reported as
 *                 "nothing was changed" -- that is a claim about a remote
 *                 system nobody asked.
 *
 * Lives here rather than beside the HubSpot client so a caller can adjudicate
 * an outcome without importing the client itself.
 */
export type HubspotWriteOutcome = "rejected" | "uncertain";

/**
 * Default to UNCERTAIN. An unrecognised failure is one we cannot adjudicate,
 * and the safe reading of "I do not know" is not "nothing happened".
 *
 * 408 and 429 sit with the uncertain group deliberately: a timeout says
 * nothing about the server side, and a throttle can be returned before or
 * after the write depending on where it was applied.
 */
export function classifyHubspotWriteOutcome(
  status: number | null,
): HubspotWriteOutcome {
  if (status === null) return "uncertain";
  if (status === 408 || status === 429) return "uncertain";
  if (status >= 400 && status < 500) return "rejected";
  return "uncertain";
}

/** The verdict an error carries, or one derived from its status. */
export function hubspotWriteOutcomeOf(err: unknown): HubspotWriteOutcome {
  const carried = (err as { outcome?: unknown })?.outcome;
  if (carried === "rejected" || carried === "uncertain") return carried;
  const raw = (err as { status?: unknown; code?: unknown }) ?? {};
  const status =
    typeof raw.status === "number"
      ? raw.status
      : typeof raw.code === "number"
        ? raw.code
        : null;
  return classifyHubspotWriteOutcome(status);
}

/**
 * Did the values we sent actually land?
 *
 * Compares the SUBMITTED properties against what HubSpot now holds, field by
 * field, because that is the only question a reconciliation can answer. A
 * cleared field ("" submitted) must read back absent or empty; anything else
 * must match exactly.
 *
 * Deliberately strict: a partial match is NOT a landing. Treating one as a
 * success would record Nexus as synchronised against a product that holds
 * some other combination of old and new values.
 */
export function hubspotUpdateLanded(
  snapshot: HubSpotProductSnapshot,
  input: HubSpotProductUpdateInput,
): boolean {
  const submitted = toHubSpotProductUpdateProperties(input);
  for (const [key, value] of Object.entries(submitted)) {
    const held = snapshot.properties[key] ?? null;
    if (value === "") {
      if (held !== null && held !== "") return false;
      continue;
    }
    if (held !== value) return false;
  }
  return true;
}

export interface HubSpotOperations {
  readonly name: string;
  readonly kind: "production" | "isolated";
  findOwnerByEmail(email: string): Promise<HubSpotOwnerByEmail | null>;
  findOwnerById(ownerId: string): Promise<HubSpotOwnerById | null>;
  searchVendors(query: string, limit?: number): Promise<HubSpotVendor[]>;
  /**
   * Company lookup for the SKU-code selector.
   *
   * Separate from `searchVendors` because it asks a different question:
   * vendors are filtered to `type = VENDOR`, and a customer search that
   * inherited that filter would return nothing while looking like it had
   * searched.
   */
  searchCustomers(query: string, limit?: number): Promise<HubSpotVendor[]>;
  resolveVendor(companyId: string): Promise<HubSpotVendor | null>;
  createProduct(
    input: HubSpotProductCreateInput,
  ): Promise<HubSpotProductCreateResult>;
  /**
   * Update an EXISTING product in place.
   *
   * Takes the HubSpot id, because the whole point is that no second product
   * is created. A create-on-edit would fork catalog identity: the leaf would
   * point at one record while quotes, Sales Orders and the operator's memory
   * pointed at another.
   */
  updateProduct(
    hubspotProductId: string,
    input: HubSpotProductUpdateInput,
  ): Promise<HubSpotProductCreateResult>;
  /**
   * Read one product back by id, for reconciling an uncertain write.
   *
   * Returns null only for an AUTHORITATIVE absence (HubSpot answered, and the
   * product is not there). A failed read throws, because "I could not ask" and
   * "the answer is no" are different facts and a caller that cannot tell them
   * apart will report the second when it only established the first.
   */
  getProduct(hubspotProductId: string): Promise<HubSpotProductSnapshot | null>;
  listProducts(opts?: {
    after?: string;
    limit?: number;
    includeArchived?: boolean;
  }): Promise<HubSpotProductPage>;
  /**
   * The governed `hs_product_type` option set.
   *
   * OD-023 again, in a second place. `loadHubspotProductTypeOptions` called
   * `getProductsClient()` directly, so the vocabulary was fetched from real
   * HubSpot no matter what the runtime had composed. In the isolated harness
   * that throws for want of a token -- which made `createLeaf` unrunnable
   * there, and is exactly why the defect survived: the walk that would have
   * caught it could not execute.
   *
   * A boundary one caller can route around is a boundary for the others only.
   */
  listProductTypeOptions(): Promise<
    { label: string; value: string; displayOrder: number }[]
  >;
  listDealStages(): Promise<HubSpotStage[]>;
  getDealStage(dealId: string): Promise<HubSpotStage>;
  updateDealStage(
    dealId: string,
    targetStage: string,
    options?: { amount?: number },
  ): Promise<HubSpotStage>;
  updateDealAmount(dealId: string, amount: number): Promise<void>;
}
