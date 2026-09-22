/**
 * The M2 shared read model for the Costs workspace.
 *
 * ONE record set, THREE presentations. Spreadsheet, By product and By module
 * all project this model; none of them reads the database, the engine, or each
 * other. That is the property the milestone exists to establish — three views
 * that cannot disagree about which owners exist, which rows they carry, or what
 * was stored in a cell, because there is one answer and they all read it.
 *
 * ── LIST MEMBERSHIP COMES FROM STORED FACTS, NEVER FROM ECONOMICS ─────────
 *
 * An uncosted charge produces NO economic output at all: `componentChargeEconomics`
 * drops a charge with no amount and `loadComponentCharges` inner-joins past it.
 * So a view that asked the engine "what is on this quote?" would render a quote
 * with a charge missing and nothing saying so — the same reasoning
 * `component-charges/readiness.ts` records for the readiness read, applied to
 * membership instead of completeness.
 *
 * The same holds one level up. A product with no priced row, a tier with no
 * cell, a group with no production amounts: each is real structure that the
 * economic output cannot mention. Membership is therefore built from the
 * instance and structure tables and only VALUES are read from the engine, by
 * the surface, node by node.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ────────────────────────────
 *
 * NO ARITHMETIC. Not a sum, not an extension, not a markup application, not a
 * per-unit derivation. Every number that reaches an operator is either a value
 * an operator stored, rendered as stored, or a value read from the engine's node
 * graph by the component that displays it. A tier-extended figure this model
 * could compute in one line is exactly the shape that put two "packaging totals"
 * 9% apart under one label, and the standing rule is that a display re-deriving
 * a governed quantity is correct the day it is written.
 *
 * NO MODE INFERENCE. Charge amounts that happen to be equal across tiers are
 * NOT collapsed into a shared amount. There is no stored shared-mode intent to
 * read — the writer accepts one charge, one tier, one cost — so a "same across
 * tiers" chip here would be this surface inventing a commercial fact from a
 * coincidence. Ten of the twelve product-owned charges measured on the
 * configured database carry unequal tier amounts; the two that are equal are
 * equal by history, not by intent. Shared behaviour is M4/M5 work with its own
 * state model.
 *
 * NO TYPE FILTERING AND NO DEFAULTS. Every stored instance crosses, including a
 * charge type with no supported path for its owner. Filtering would make the
 * preview quieter than the record, and the record is the thing under review.
 */

import {
  COMPONENT_CHARGE_LABELS,
  type ComponentChargeKey,
} from "@/lib/commercial-recovery/registry";
import type { ComponentChargeForCosts } from "@/lib/component-charges/read";
import type { ComponentChargeReadiness } from "@/lib/component-charges/readiness";
import { packagingMarkupCategory } from "./packaging-markup-authority";
import {
  DIRECT_SERVICE_LABELS,
  DIRECT_SERVICE_PRODUCTION_INPUT,
  type DirectServiceIdentity,
} from "@/lib/product-structure/direct-service";

// ─────────────────────────────── INPUT FACTS ───────────────────────────────
//
// Every field here is a column, not a computed quantity. The shapes mirror what
// the Costs page already loads so the page hands over what it has rather than
// running a second set of queries against the same rows.

export type OverviewTierFact = {
  id: string;
  label: string;
  qty: number | null;
};

export type OverviewAssemblyFact = {
  id: string;
  sku: string;
  name: string;
  position: number;
};

export type OverviewMemberFact = {
  /** `assembly_leaves.id` — the junction, and the assembly-tree identity. */
  assemblyLeafId: string;
  assemblyId: string;
  /** The GOVERNED cost-input identity every cost row carries (OD-017). */
  quoteLeafId: string;
  name: string;
  sku: string;
  /** Membership quantity, as stored. A real structural quantity, never display. */
  quantity: string | null;
  position: number;
  /** HubSpot's recorded `hs_product_type`, raw internal value. Source data. */
  productType: string | null;
};

export type OverviewDirectProductFact = {
  quoteLeafId: string;
  name: string;
  sku: string;
  quantity: string | null;
  position: number;
  productType: string | null;
};

export type OverviewDirectServiceFact = {
  quoteLeafId: string;
  name: string;
  serviceIdentity: DirectServiceIdentity;
  position: number;
  /** tierId → the amount stored in this service's ONE governed column. */
  amountsByTier: Record<string, string | null>;
};

/** One `assembly_leaf_inputs` row, as stored. */
export type OverviewPackagingRowFact = {
  id: string;
  /** Post-OD-017 this holds a `quote_leaves.id`, despite the legacy name. */
  quoteLeafId: string;
  tierId: string;
  lineGroupId: string;
  sortOrder: number;
  pricingVendorNameSnapshot: string | null;
  supplier: string | null;
  qtyPerSellableUnit: string | null;
  category: string | null;
  markupPct: string | null;
  markupPctSource: "category_default" | "manual_override" | null;
  inventoryEligible: boolean;
  notes: string | null;
  /** NULL means no cost stated. `"0"` means a stated zero. Never collapsed. */
  unitCost: string | null;
};

/** One `assembly_production_inputs` row owned by an Item Group. */
export type OverviewGroupProductionFact = {
  id: string;
  assemblyId: string;
  tierId: string;
  allocateServiceFeesToCost: boolean;
  fillingBlendingCost: string | null;
  cmAssemblyTotal: string | null;
  bulkRawCost: string | null;
  setupFeeTotal: string | null;
  /** Retired input, carried because historical rows still hold values in it. */
  toolingArtworkTotal: string | null;
  toolingTotal: string | null;
  artworkTotal: string | null;
  rdTotal: string | null;
  /**
   * BV-011 maps Testing and Other to different accounting destinations, so this
   * is its own column (migration 0083) and not a reuse of `otherServiceTotal`.
   * Carried here because a value in it is a real cost fact; omitting it would
   * make this preview quieter than the record.
   */
  testingMicrosTotal: string | null;
  otherServiceTotal: string | null;
  actualUnitsProduced: number | null;
};

export type CostsOverviewFacts = {
  tiers: readonly OverviewTierFact[];
  assemblies: readonly OverviewAssemblyFact[];
  members: readonly OverviewMemberFact[];
  directProducts: readonly OverviewDirectProductFact[];
  directServices: readonly OverviewDirectServiceFact[];
  packagingRows: readonly OverviewPackagingRowFact[];
  groupProductionRows: readonly OverviewGroupProductionFact[];
  componentCharges: readonly ComponentChargeForCosts[];
  chargeReadiness: readonly ComponentChargeReadiness[];
};

// ─────────────────────────────── OUTPUT MODEL ──────────────────────────────

export type OverviewOwnerKind =
  | "item_group"
  | "group_member"
  | "direct_product"
  | "direct_service";

/**
 * One recurring packaging line, with its per-tier cells.
 *
 * The cells are a MAP rather than an array aligned to tiers, because "this tier
 * has no row" and "this tier has a row with no cost" are different facts and an
 * aligned array has one slot for both.
 */
export type OverviewRecurringLine = {
  lineGroupId: string;
  sortOrder: number;
  /** The governed cost-input identity this line prices. */
  quoteLeafId: string;
  /**
   * The PRICE SOURCE: the awarded-at-quote HubSpot vendor snapshot, else the
   * free-text supplier. As stored.
   *
   * "Pricing vendor" is where the number came from. It is NOT a supplier award
   * — nothing here says this vendor will be purchased from. The two meanings
   * stay distinct, and the design's own hint says so: "source of pricing · not
   * the awarded supplier".
   */
  vendor: string | null;
  category: string | null;
  /** The stored LINE OVERRIDE only. Resolution is the engine's; see below. */
  storedMarkupPct: string | null;
  markupPctSource: "category_default" | "manual_override" | null;
  qtyPerSellableUnit: string | null;
  inventoryEligible: boolean;
  notes: string | null;
  cells: ReadonlyMap<string, { rowId: string; unitCost: string | null }>;
  /**
   * Line metadata that DISAGREES across this line's own tier rows.
   *
   * The writer denormalises vendor / category / markup / quantity across every
   * tier row of a line group, so they should never differ. When they do, the
   * first row in sort order supplies the displayed value — and the divergence is
   * named here rather than flattened silently, because a flattened conflict is
   * indistinguishable from agreement.
   */
  conflictingFields: readonly string[];
};

/** The Item Group production columns this model presents. */
export type GroupProductionField = keyof Omit<
  OverviewGroupProductionFact,
  "id" | "assemblyId" | "tierId" | "allocateServiceFeesToCost" | "actualUnitsProduced"
>;

export type OverviewProductionLine = {
  /**
   * The GOVERNED COLUMN this line reports, named.
   *
   * A plain string, not the Item Group column union, because a Direct Service
   * writes a column chosen by its own service identity through
   * `DIRECT_SERVICE_PRODUCTION_INPUT`. Typing this as the group's union would
   * have forced a service's line to borrow a group column name it does not
   * write — a provenance field stating the wrong provenance, which is worse
   * than not having one.
   */
  field: string;
  label: string;
  /** tierId → amount as stored. Absent key means no row for that tier. */
  amounts: ReadonlyMap<string, string | null>;
};

/**
 * A one-time charge instance.
 *
 * IDENTITY IS THE INSTANCE, never the type. Two Tooling charges on one
 * component are two entries here with two ids and whatever labels distinguish
 * them, because that is what the model supports and what the Recovery grain
 * exists to give back. A model keyed by type would make the second one
 * unreachable, which is the defect `readExistingComponentCharges` documents.
 */
export type OverviewCharge = {
  chargeInstanceId: string;
  chargeKey: string;
  /** The charge type's canonical label. */
  typeLabel: string;
  /** The operator's own label, where there is one. Never substituted. */
  ownLabel: string | null;
  toolingClassification: "mould_collar" | "cutting_die" | null;
  quoteLeafId: string;
  /**
   * tierId → the stored per-tier economics.
   *
   * ABSENT means no cost stated for that tier. A row exists if and only if an
   * operator stated a positive cost, so absence is unambiguous and is rendered
   * as unpriced — never as zero.
   */
  amounts: ReadonlyMap<string, { cost: string; recoveryAsk: string | null }>;
  /** From the readiness read, which asks the tables rather than the engine. */
  state: "none" | "partial" | "complete" | "unknown";
  missingTierLabels: readonly string[];
};

export type OverviewOwner = {
  /** Stable React key. Never an index. */
  key: string;
  kind: OverviewOwnerKind;
  /** The governed cost-input identity. NULL for an Item Group, which owns none. */
  quoteLeafId: string | null;
  /** Set for an Item Group and for its members. */
  assemblyId: string | null;
  name: string;
  sku: string;
  /** Recorded catalogue Product Type, raw stored value. NULL where unclassified. */
  productType: string | null;
  /** Membership / attachment quantity, as stored. */
  quantity: string | null;
  /** For a Direct Service: which governed service this is. */
  serviceIdentity: DirectServiceIdentity | null;
  members: readonly OverviewOwner[];
  recurringLines: readonly OverviewRecurringLine[];
  productionLines: readonly OverviewProductionLine[];
  charges: readonly OverviewCharge[];
};

/**
 * Something the record contains that this model cannot presently place.
 *
 * Reported rather than dropped. The bounded pass says a reader that lacks a
 * fact must state the gap precisely, and a gap that renders as an absence is
 * indistinguishable from a quote that genuinely has nothing — which is the one
 * failure a parity preview must not produce.
 */
export type OverviewGap = {
  code:
    | "charge_owner_not_in_quote_structure"
    | "charge_readiness_missing"
    | "packaging_row_owner_not_in_quote_structure"
    | "group_production_owner_not_in_quote_structure";
  detail: string;
  /** The identity that could not be placed, so it is findable. */
  subjectId: string;
};

export type CostsOverview = {
  tiers: readonly OverviewTierFact[];
  owners: readonly OverviewOwner[];
  /**
   * Charges whose causal owner is not in this quote's structure.
   *
   * Surfaced, not swallowed. This list is for a charge that DID arrive and
   * whose owner the structure queries did not return.
   *
   * A legacy `'@quote'` instance never arrives here at all, and that is NOT a
   * missing amount: such an instance stands for a PRODUCTION COLUMN, its amount
   * lives on that column, and `updateComponentChargeCost` refuses to price it
   * here for exactly that reason. The money is therefore already on this
   * surface, as the owning Item Group's production line. What is absent is the
   * legacy instance ROW as a separately listed charge — a representation
   * boundary, recorded in the M2 validation note rather than papered over with
   * a synthesised owner.
   */
  unplacedCharges: readonly OverviewCharge[];
  gaps: readonly OverviewGap[];
};

// ──────────────────────────────── LABELS ───────────────────────────────────

/**
 * The governed Item Group production inputs, named EXACTLY as the existing
 * Production module names them (`production-drilldown.tsx` `VIRTUAL_LINES`
 * plus its separately-rendered bulk raw row).
 *
 * ── WHY THE LABELS ARE COPIED RATHER THAN IMPROVED ───────────────────────
 *
 * This preview exists to be compared against the surface it previews. A row
 * this view calls "Filling / blending" and the module calls "Filling / blending
 * tier total" reads as a DIFFERENT ROW to anyone doing that comparison, and a
 * parity review that has to first establish which rows are the same rows is a
 * review that will miss the one that genuinely differs.
 *
 * Order follows the module's, including the legacy Tooling / artwork row, which
 * appears here under the same rule the module applies: only where it already
 * holds a value.
 *
 * NOTHING HERE IS RELABELLED A ONE-TIME CHARGE. Filling / blending and CM
 * assembly are services entered as per-tier line totals and bulk raw is a tier
 * total; calling any of them a one-time charge is the specific confusion the
 * data contract forbids, and several of these rows are `one_time_fee` in the
 * module's own kind vocabulary without being component-owned charge instances.
 */
const PRODUCTION_LINE_LABELS = [
  ["fillingBlendingCost", "Filling / blending tier total"],
  ["cmAssemblyTotal", "CM assembly tier total"],
  ["setupFeeTotal", "Setup fee total"],
  ["toolingArtworkTotal", "Tooling / artwork total"],
  ["toolingTotal", "Tooling total"],
  ["artworkTotal", "Artwork total"],
  ["rdTotal", "R&D fee total"],
  ["otherServiceTotal", "Other service fee total"],
  // NOT in the module's `VIRTUAL_LINES` — it has no operator row there yet.
  // Shown here where a value exists, because a stored cost that appears on
  // neither surface is a cost that has silently vanished. Recorded as a
  // coverage gap in the M2 note.
  ["testingMicrosTotal", "Testing / micros total"],
  ["bulkRawCost", "Bulk raw cost"],
] as const satisfies ReadonlyArray<readonly [GroupProductionField, string]>;

// ──────────────────────────────── BUILDER ──────────────────────────────────

export function buildCostsOverview(facts: CostsOverviewFacts): CostsOverview {
  const gaps: OverviewGap[] = [];

  const readinessByInstance = new Map(
    facts.chargeReadiness.map((r) => [r.chargeInstanceId, r]),
  );
  const productTypeByQuoteLeaf = new Map<string, string | null>([
    ...facts.members.map((member) => [member.quoteLeafId, member.productType] as const),
    ...facts.directProducts.map((product) => [product.quoteLeafId, product.productType] as const),
  ]);

  // Charges grouped by their CAUSAL owner. Order within an owner follows the
  // order the reader returned, so two instances of one type stay distinguishable
  // by position as well as by id even when neither carries a label.
  const chargesByOwner = new Map<string, OverviewCharge[]>();
  const allCharges: OverviewCharge[] = [];
  for (const c of facts.componentCharges) {
    const readiness = readinessByInstance.get(c.chargeInstanceId);
    if (!readiness) {
      gaps.push({
        code: "charge_readiness_missing",
        detail: `Charge ${c.chargeInstanceId} has no readiness entry; its completeness is reported as unknown rather than assumed complete.`,
        subjectId: c.chargeInstanceId,
      });
    }
    const charge: OverviewCharge = {
      chargeInstanceId: c.chargeInstanceId,
      chargeKey: c.chargeKey,
      typeLabel:
        COMPONENT_CHARGE_LABELS[c.chargeKey as ComponentChargeKey] ?? c.chargeKey,
      ownLabel: c.label,
      toolingClassification: c.toolingClassification,
      quoteLeafId: c.quoteLeafId,
      // Built from the stored tier rows only. A tier with no row is simply not
      // a key, which is what lets the surface say "unpriced" instead of "$0.00".
      amounts: new Map(
        c.amounts.map((a) => [
          a.tierId,
          { cost: a.cost, recoveryAsk: a.recoveryAsk },
        ]),
      ),
      state: readiness?.state ?? "unknown",
      missingTierLabels: readiness?.missingTierLabels ?? [],
    };
    allCharges.push(charge);
    const bucket = chargesByOwner.get(c.quoteLeafId);
    if (bucket) bucket.push(charge);
    else chargesByOwner.set(c.quoteLeafId, [charge]);
  }

  // Packaging lines grouped by OWNER AND `lineGroupId` — never by line group
  // alone. A line group belongs to one owner, so the two keys should always
  // agree; keying on the pair means that if they ever do not, the rows land in
  // two lines under two owners instead of being merged into one under whichever
  // owner's row was read first. A silent merge would move another component's
  // cost onto this one, which is precisely the misattribution totals cannot
  // detect (`packaging-row-identity.ts`).
  const linesByOwner = new Map<string, OverviewRecurringLine[]>();
  {
    type Entry = {
      line: OverviewRecurringLine;
      cells: Map<string, { rowId: string; unitCost: string | null }>;
      conflicts: Set<string>;
    };
    const byGroup = new Map<string, Entry>();
    const ordered = [...facts.packagingRows].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.lineGroupId.localeCompare(b.lineGroupId),
    );
    for (const row of ordered) {
      // `\u0000` cannot occur in a UUID, so the pair cannot collide.
      const key = `${row.quoteLeafId}\u0000${row.lineGroupId}`;
      let entry = byGroup.get(key);
      if (!entry) {
        const cells = new Map<string, { rowId: string; unitCost: string | null }>();
        const conflicts = new Set<string>();
        entry = {
          cells,
          conflicts,
          line: {
            lineGroupId: row.lineGroupId,
            sortOrder: row.sortOrder,
            quoteLeafId: row.quoteLeafId,
            vendor: row.pricingVendorNameSnapshot ?? row.supplier,
            // Match the costing adapter: Setup's HubSpot Product Type governs
            // the category; an old row category is used only when the product
            // truly has no type recorded.
            category: packagingMarkupCategory(
              productTypeByQuoteLeaf.get(row.quoteLeafId),
              row.category,
            ),
            storedMarkupPct: row.markupPct,
            markupPctSource: row.markupPctSource,
            qtyPerSellableUnit: row.qtyPerSellableUnit,
            inventoryEligible: row.inventoryEligible,
            notes: row.notes,
            cells,
            conflictingFields: [],
          },
        };
        byGroup.set(key, entry);
      } else {
        // Denormalised metadata that disagrees with the row that supplied the
        // displayed value. Named, not flattened.
        const l = entry.line;
        if ((row.pricingVendorNameSnapshot ?? row.supplier) !== l.vendor)
          entry.conflicts.add("pricing vendor");
        if (row.category !== l.category) entry.conflicts.add("markup category");
        if (row.markupPct !== l.storedMarkupPct) entry.conflicts.add("markup");
        if (row.qtyPerSellableUnit !== l.qtyPerSellableUnit)
          entry.conflicts.add("quantity per sellable unit");
      }
      entry.cells.set(row.tierId, { rowId: row.id, unitCost: row.unitCost });
    }
    for (const entry of byGroup.values()) {
      const line = { ...entry.line, conflictingFields: [...entry.conflicts] };
      const bucket = linesByOwner.get(line.quoteLeafId);
      if (bucket) bucket.push(line);
      else linesByOwner.set(line.quoteLeafId, [line]);
    }
    for (const lines of linesByOwner.values()) {
      lines.sort((a, b) => a.sortOrder - b.sortOrder);
    }
  }

  // Item Group production, per assembly. One entry per governed field that has
  // a stated amount at ANY tier — a field nobody has touched is not a row, and
  // inventing one would put eight empty lines under every group.
  const productionByAssembly = new Map<string, OverviewProductionLine[]>();
  {
    const byAssembly = new Map<string, OverviewGroupProductionFact[]>();
    for (const row of facts.groupProductionRows) {
      const bucket = byAssembly.get(row.assemblyId);
      if (bucket) bucket.push(row);
      else byAssembly.set(row.assemblyId, [row]);
    }
    for (const [assemblyId, rows] of byAssembly) {
      const lines: OverviewProductionLine[] = [];
      for (const [field, label] of PRODUCTION_LINE_LABELS) {
        const amounts = new Map<string, string | null>();
        let anyStated = false;
        for (const row of rows) {
          const value = row[field];
          amounts.set(row.tierId, value);
          if (value !== null) anyStated = true;
        }
        if (anyStated) lines.push({ field, label, amounts });
      }
      productionByAssembly.set(assemblyId, lines);
    }
  }

  // ── Owners, in the order the structure stores them ──────────────────────

  const membersByAssembly = new Map<string, OverviewMemberFact[]>();
  for (const m of facts.members) {
    const bucket = membersByAssembly.get(m.assemblyId);
    if (bucket) bucket.push(m);
    else membersByAssembly.set(m.assemblyId, [m]);
  }

  const owners: OverviewOwner[] = [];
  const placedLeafIds = new Set<string>();

  for (const assembly of [...facts.assemblies].sort((a, b) => a.position - b.position)) {
    const members = (membersByAssembly.get(assembly.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map<OverviewOwner>((m) => {
        placedLeafIds.add(m.quoteLeafId);
        return {
          key: `member:${m.assemblyLeafId}`,
          kind: "group_member",
          quoteLeafId: m.quoteLeafId,
          assemblyId: m.assemblyId,
          name: m.name,
          sku: m.sku,
          productType: m.productType,
          quantity: m.quantity,
          serviceIdentity: null,
          members: [],
          recurringLines: linesByOwner.get(m.quoteLeafId) ?? [],
          productionLines: [],
          charges: chargesByOwner.get(m.quoteLeafId) ?? [],
        };
      });
    owners.push({
      key: `group:${assembly.id}`,
      kind: "item_group",
      // An Item Group owns no cost row. Stated rather than coerced to a member's
      // identity, which is what put a group's economics on one of its components.
      quoteLeafId: null,
      assemblyId: assembly.id,
      name: assembly.name,
      sku: assembly.sku,
      productType: null,
      quantity: null,
      serviceIdentity: null,
      members,
      recurringLines: [],
      productionLines: productionByAssembly.get(assembly.id) ?? [],
      charges: [],
    });
  }

  for (const p of [...facts.directProducts].sort((a, b) => a.position - b.position)) {
    placedLeafIds.add(p.quoteLeafId);
    owners.push({
      key: `product:${p.quoteLeafId}`,
      kind: "direct_product",
      quoteLeafId: p.quoteLeafId,
      assemblyId: null,
      name: p.name,
      sku: p.sku,
      productType: p.productType,
      quantity: p.quantity,
      serviceIdentity: null,
      members: [],
      recurringLines: linesByOwner.get(p.quoteLeafId) ?? [],
      productionLines: [],
      charges: chargesByOwner.get(p.quoteLeafId) ?? [],
    });
  }

  for (const s of [...facts.directServices].sort((a, b) => a.position - b.position)) {
    placedLeafIds.add(s.quoteLeafId);
    // A service's economics are ONE governed column, presented as its own line
    // rather than borrowed from the Item Group production vocabulary.
    const amounts = new Map<string, string | null>(
      Object.entries(s.amountsByTier),
    );
    owners.push({
      key: `service:${s.quoteLeafId}`,
      kind: "direct_service",
      quoteLeafId: s.quoteLeafId,
      assemblyId: null,
      name: s.name,
      sku: "",
      productType: null,
      quantity: null,
      serviceIdentity: s.serviceIdentity,
      members: [],
      recurringLines: linesByOwner.get(s.quoteLeafId) ?? [],
      // ALWAYS present, priced or not. A governed service owns exactly one
      // input row whether or not anyone has costed it, and an unpriced service
      // that rendered as no row at all would be indistinguishable from a quote
      // that has no service — the same reasoning the readiness reader records
      // for uncosted charges. Blank per-tier cells state the truth.
      productionLines: [
        {
          // The service's ONE governed input, resolved from the service's own
          // identity — never from whichever column happens to hold a value,
          // which would accept an amount this service may not author.
          field: DIRECT_SERVICE_PRODUCTION_INPUT[s.serviceIdentity],
          label: `${DIRECT_SERVICE_LABELS[s.serviceIdentity]} · service line total`,
          amounts,
        },
      ],
      charges: chargesByOwner.get(s.quoteLeafId) ?? [],
    });
  }

  // ── What did not land anywhere ──────────────────────────────────────────

  const unplacedCharges = allCharges.filter(
    (c) => !placedLeafIds.has(c.quoteLeafId),
  );
  for (const c of unplacedCharges) {
    gaps.push({
      code: "charge_owner_not_in_quote_structure",
      detail: `Charge ${c.chargeInstanceId} (${c.typeLabel}) names owner ${c.quoteLeafId}, which the quote structure read did not return. Shown separately rather than dropped.`,
      subjectId: c.chargeInstanceId,
    });
  }
  for (const [ownerId, lines] of linesByOwner) {
    if (placedLeafIds.has(ownerId)) continue;
    gaps.push({
      code: "packaging_row_owner_not_in_quote_structure",
      detail: `${lines.length} packaging line(s) name owner ${ownerId}, which the quote structure read did not return.`,
      subjectId: ownerId,
    });
  }
  const knownAssemblies = new Set(facts.assemblies.map((a) => a.id));
  for (const assemblyId of productionByAssembly.keys()) {
    if (knownAssemblies.has(assemblyId)) continue;
    gaps.push({
      code: "group_production_owner_not_in_quote_structure",
      detail: `Production amounts name Item Group ${assemblyId}, which the quote structure read did not return.`,
      subjectId: assemblyId,
    });
  }

  return { tiers: facts.tiers, owners, unplacedCharges, gaps };
}

// ───────────────────────────── FLAT PROJECTION ─────────────────────────────

/**
 * Every owner in render order, with its depth.
 *
 * The Spreadsheet view needs one flat pass with the hierarchy expressed as
 * indentation; the By product picker needs the same order. Both read this, so
 * the two cannot present owners in different orders — which is the kind of
 * difference that reads as a missing record.
 */
export function flattenOwners(
  owners: readonly OverviewOwner[],
  depth = 0,
): Array<{ owner: OverviewOwner; depth: number }> {
  const out: Array<{ owner: OverviewOwner; depth: number }> = [];
  for (const owner of owners) {
    out.push({ owner, depth });
    out.push(...flattenOwners(owner.members, depth + 1));
  }
  return out;
}

/** Owners an operator can focus in the By product view — those with economics of their own. */
export function focusableOwners(
  owners: readonly OverviewOwner[],
): OverviewOwner[] {
  return flattenOwners(owners)
    .map((e) => e.owner)
    .filter((o) => o.kind !== "item_group" || o.productionLines.length > 0);
}

export function countRecurring(owner: OverviewOwner): number {
  return owner.recurringLines.length + owner.productionLines.length;
}

export function countOneTime(owner: OverviewOwner): number {
  return owner.charges.length;
}
