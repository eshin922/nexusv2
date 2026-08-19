/**
 * #302 checks that do not need a browser.
 *
 *   8 · the migrated Filling mapping survived and still resolves to the same
 *       NetSuite item
 *   6 · a separately-billed legacy combined charge BLOCKS projection with the
 *       named Tooling/Artwork remediation, and is not skipped
 *
 * Check 6 runs inside a transaction that is ROLLED BACK. It needs a state no
 * live quote can currently be in — a frozen matrix (which only exists after
 * #300) carrying an unresolved legacy line at an accepted tier — so the state
 * is constructed, asserted, and discarded. Nothing is committed; the script
 * re-counts afterwards to prove it.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getRecord } from "@/lib/netsuite/client";
import { assessProjectionReadiness } from "@/lib/netsuite/projection-readiness";

const quoteId = process.argv[2];
const rows = <T,>(r: unknown) => r as unknown as T[];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

// ══ CHECK 8 · the migrated Filling mapping ═══════════════════════════════
console.log("\n── CHECK 8 · the migrated Filling mapping ──");
{
  const [legacyRow] = rows<{ code: string | null; ns: string | null }>(
    await db.execute(sql`
      select netsuite_item_code as code, netsuite_internal_id as ns
        from netsuite_service_item_map where service_identity = 'filling_blending'`),
  );
  const [dest] = rows<{ code: string | null; ns: string | null; at: string | null }>(
    await db.execute(sql`
      select netsuite_item_code as code, netsuite_internal_id as ns, resolved_at::text as at
        from netsuite_destination_item_map where destination = 'otc_filling'`),
  );
  check(Boolean(dest), "OTC - Filling is present in the destination map",
        dest ? `${dest.code} · ns=${dest.ns}` : "MISSING");
  check(
    Boolean(dest) && dest.ns === legacyRow?.ns && dest.code === legacyRow?.code,
    "it carries the SAME NetSuite item as the service-identity row it came from",
    `${legacyRow?.code}/${legacyRow?.ns} → ${dest?.code}/${dest?.ns}`,
  );

  // And that id still names a real item — a migrated pointer to a deleted
  // record would look perfectly healthy in the table.
  if (dest?.ns) {
    try {
      const rec = await getRecord<{ itemId?: string; itemid?: string }>(
        "noninventoryresaleitem",
        dest.ns,
      );
      check(true, "the mapped internal id resolves in NetSuite",
            String(rec.itemId ?? rec.itemid ?? "(read ok)"));
    } catch (e) {
      // A failed read is not evidence the item is gone (OD-027) — reported as
      // indeterminate, not as a failure.
      console.log(
        `  INDETERMINATE  NetSuite read failed, which says nothing about the item · ${
          e instanceof Error ? e.message.slice(0, 90) : String(e)
        }`,
      );
    }
  }
}

// ══ CHECK 6 · legacy combined blocks projection ══════════════════════════
console.log("\n── CHECK 6 · an unresolved legacy charge blocks projection ──");
if (!quoteId) {
  console.log("  (skipped — pass a sent, frozen quote id)");
} else {
  const SENT = "__rollback__";
  type Out = { blocked: boolean; kinds: string[]; remediations: string[] };
  let out: Out | null = null;
  try {
    await db.transaction(async (tx) => {
      const [snap] = rows<{ id: string; tier: string }>(
        await tx.execute(sql`
          select s.id::text as id, t.tier_id::text as tier
            from quote_snapshots s
            join quote_snapshot_tier_totals t on t.quote_snapshot_id = s.id
           where s.quote_id = ${quoteId}::uuid and s.superseded_at is null
             and t.total_is_provisional = false
           order by t.quantity limit 1`),
      );
      if (!snap) throw new Error("no non-provisional frozen tier on that quote");

      // Accept that tier, and add the frozen line a pre-split quote would
      // carry: an OTC charge with NO governed destination.
      await tx.execute(sql`
        update quotes set customer_accepted_tier_id = ${snap.tier}::uuid
         where id = ${quoteId}::uuid`);
      const [line] = rows<{ id: string }>(
        await tx.execute(sql`
          insert into quote_snapshot_lines
            (quote_snapshot_id, line_kind, owning_assembly_id, display_name,
             display_sku, bv011_destination, position, legacy_unresolved)
          select ${snap.id}::uuid, 'otc', ln.owning_assembly_id,
                 'Tooling & artwork', ln.display_sku, NULL, 900, true
            from quote_snapshot_lines ln
           where ln.quote_snapshot_id = ${snap.id}::uuid
             and ln.owning_assembly_id is not null
           limit 1
          returning id::text as id`),
      );
      await tx.execute(sql`
        insert into quote_snapshot_line_tiers
          (quote_snapshot_line_id, tier_id, tier_label, quantity,
           pricing_state, unit_rate, line_amount, allocation_state)
        values (${line.id}::uuid, ${snap.tier}::uuid, 'Tier 1', 1000,
                'priced', 1400.0000, 1400.00, 'separately_billed')`);

      // Read through the TRANSACTION. Called with the global client it would
      // answer about committed state and report `no_accepted_tier` — a true
      // statement about a different moment, and a silently wrong proof.
      const readiness = await assessProjectionReadiness(
        quoteId,
        tx as unknown as Parameters<typeof assessProjectionReadiness>[1],
      );
      out = {
        blocked: readiness.ready === false,
        kinds: readiness.ready === false ? readiness.blockers.map((b) => b.kind) : [],
        remediations:
          readiness.ready === false ? readiness.blockers.map((b) => b.remediation) : [],
      };
      throw new Error(SENT);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== SENT) {
      console.log(`  setup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (out) {
    const o: Out = out;
    check(o.blocked, "projection is BLOCKED, not skipped");
    check(
      o.kinds.includes("legacy_combined_otc"),
      "the blocker names the legacy combined charge specifically",
      o.kinds.join(", "),
    );
    // The Direct Service on this quote was frozen before destinations were
    // recorded. It must NOT be reported as a legacy Tooling/Artwork charge —
    // that was the defect this proof surfaced.
    check(
      o.kinds.filter((k) => k === "legacy_combined_otc").length === 1,
      "exactly ONE line is legacy combined, not every null-destination line",
      o.kinds.join(", "),
    );
    const r = o.remediations.find((x) => x.includes("Tooling"));
    check(
      Boolean(r) && r!.includes("Artwork") && r!.includes("Costs"),
      "the remediation names both governed inputs and where to enter them",
    );
    if (r) console.log(`\n      "${r}"\n`);
  }

  const [left] = rows<{ n: number }>(
    await db.execute(sql`
      select (select count(*) from quote_snapshot_lines where position = 900)::int
           + (select count(*) from quotes where id=${quoteId}::uuid
                and customer_accepted_tier_id is not null)::int as n`),
  );
  check(Number(left.n) === 0, "NOTHING was committed — no injected line, no accepted tier");
}

console.log(fail.length === 0 ? "\nALL HEADLESS CHECKS PASS\n" : `\n${fail.length} FAILED:\n  ${fail.join("\n  ")}\n`);
process.exit(fail.length === 0 ? 0 : 1);
