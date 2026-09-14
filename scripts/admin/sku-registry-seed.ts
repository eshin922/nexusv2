/**
 * Register and seed governed SKU brand tokens.
 *
 *   npm run admin:sku-registry -- --register            (dry run)
 *   npm run admin:sku-registry -- --register --commit
 *   npm run admin:sku-registry -- --seed --netsuite <file>            (dry run)
 *   npm run admin:sku-registry -- --seed --netsuite <file> --commit
 *   npm run admin:sku-registry -- --show               (read back what is stored)
 *
 * ── WHY THIS EXISTS AS ONE PATH ──────────────────────────────────────────
 *
 * Migration 0125 created the registry and the counters EMPTY, and the two
 * writes it left undone are the two that decide identity: which namespaces
 * exist, and where each one starts counting. Neither has a UI, and neither
 * should be done with an ad-hoc UPDATE -- a counter written by hand carries
 * no record of what it was computed from, and a registry row written by hand
 * carries no record of who approved it. The CHECK constraints refuse the
 * incomplete versions of both; this script is what satisfies them honestly.
 *
 * Registration and seeding are SEPARATE phases because they are separate
 * decisions resting on separate evidence. Registering a token settles whose
 * namespace it is. Seeding settles where it starts, which depends on a
 * measurement of three live systems and is valid only while that measurement
 * is fresh. A token may sit registered-and-unseeded indefinitely: allocation
 * refuses on a NULL `next_number` independently of approval, so that state is
 * safe, and it is the designed one.
 *
 * ── THE FRESHNESS GATE IS MACHINE-ENFORCED ───────────────────────────────
 *
 * Nexus and HubSpot are measured BY THIS SCRIPT, in the same run that writes,
 * so they cannot be stale. NetSuite cannot be: its production catalog is not
 * reachable from the API credentials this repo holds, and the survey is taken
 * through an authenticated browser session. So it arrives as a file -- and a
 * file is exactly the thing that can be three weeks old and look fine.
 *
 * Hence: the file must name its account, must declare its own coverage, must
 * carry the moment it was measured, and is REFUSED past `--max-age-hours`.
 * The dated-snapshot rule is not a paragraph someone has to remember; it is a
 * condition of the write.
 *
 * A token missing from a COMPLETE survey means "surveyed, none found" and
 * seeds from Nexus and HubSpot alone. A token missing from a PARTIAL survey
 * means nothing at all -- which is why `complete: true` must be declared
 * rather than inferred from the file having rows in it.
 *
 * ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────
 *
 * Overwrite a registry row whose mapping differs from the approved list, or
 * re-seed a counter that already holds a number. Both are refusals, not
 * updates: a token that already means something else, or already counts from
 * somewhere else, is a contradiction for a person to resolve. Winning it
 * silently would renumber a live namespace.
 */
import postgres from "postgres";
import fs from "node:fs";

// ── the adjudicated list ─────────────────────────────────────────────────
//
// Approved by Edward, 2026-09-14, from the reconciliation in PR #579. The
// company id is the join; the label is how a person reads it and is NOT the
// identity. DPS, ES and WL are deliberately absent -- they are not customer
// namespaces and were left unregistered.
//
// MISTR maps to heymistr.com / 36909687931. A SECOND company record (MISTR /
// 48843403658) exists and is deliberately NOT merged or aliased here: which
// record is the customer is an open adjudication, and picking one quietly
// would settle it.
const APPROVED: { token: string; label: string; companyId: string }[] = [
  { token: "DRSQ", label: "Dr. Squatch", companyId: "10427807265" },
  { token: "EL", label: "Extract Labs", companyId: "19122235830" },
  { token: "FACE", label: "Facetory", companyId: "15340903790" },
  { token: "KIT", label: "Kitsch", companyId: "15532964962" },
  { token: "KUJU", label: "Kuju", companyId: "18233927554" },
  { token: "LEM", label: "Lemme", companyId: "11075059228" },
  { token: "LMER", label: "La Mer", companyId: "17952713000" },
  { token: "LOOV", label: "LOOV", companyId: "18603946796" },
  { token: "MOT", label: "Motivated", companyId: "17078076774" },
  { token: "MYTH", label: "Mythologie", companyId: "10427985012" },
  { token: "NEW", label: "New U Life", companyId: "18680822828" },
  { token: "OUT", label: "The Outset", companyId: "15341254760" },
  { token: "PCW", label: "Perfect Coffee Water", companyId: "19507987774" },
  { token: "REJ", label: "Rejuvica", companyId: "15931327282" },
  { token: "SPJ", label: "Smart Pressed Juice", companyId: "17493436983" },
  { token: "TUBE", label: "Bryght", companyId: "15122910741" },
  { token: "VOL", label: "Volta", companyId: "18363861820" },
  { token: "YUNI", label: "YUNI Beauty", companyId: "10427868808" },
  { token: "MISTR", label: "heymistr.com", companyId: "36909687931" },
];

/** Edward, edward@thedps.co. The approver of record for every row below. */
const APPROVER = "e60b5670-86d8-437b-9654-36a1284c7b19";

/** The production NetSuite account. A sandbox survey cannot seed this. */
const PRODUCTION_NETSUITE_ACCOUNT = "7924416";

/**
 * Where a namespace with nothing in it starts.
 *
 * `max(...) + 1` alone is right only for a namespace that already has items.
 * For a brand-new one every maximum is absent, so the rule yields 1 -- and
 * `DPS-MISTR-0001` is not what the convention produces. Every customer
 * namespace in the catalog begins at 1001, so a new one does too.
 *
 * Expressed as a FLOOR rather than a special case, because a floor can only
 * ever RAISE a seed and therefore cannot mint a collision: a namespace whose
 * only existing item is low still seeds above everything measured.
 */
const FIRST_NUMBER = 1001;

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const arg = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const doShow = has("--show");
const doRegister = has("--register");
const doSeed = has("--seed");
const commit = has("--commit");
const maxAgeHours = Number(arg("--max-age-hours") ?? 6);

if (!doShow && !doRegister && !doSeed) {
  console.error("Pass --show, --register and/or --seed. Add --commit to write; without it this is a dry run.");
  process.exit(1);
}

// DIRECT_URL by repo rule: session mode (:5432). Transaction mode is unsafe
// for this workload and is not used anywhere that writes.
const url = process.env.DIRECT_URL ?? "";
if (!url) {
  console.error("DIRECT_URL is not set.");
  process.exit(1);
}

const parseSku = (raw: string | null | undefined) => {
  const n = (raw ?? "").trim().toUpperCase();
  if (!n.startsWith("DPS-")) return null;
  const [, tok, third] = n.split("-");
  if (!/^[A-Z][A-Z0-9]*$/.test(tok ?? "") || !/^[0-9]+$/.test(third ?? "")) return null;
  return { token: tok as string, number: parseInt(third as string, 10) };
};

const sql = postgres(url, { max: 1, prepare: false });
const fail = async (msg: string): Promise<never> => {
  console.error("\nREFUSING: " + msg + "\n");
  await sql.end();
  process.exit(2);
};

console.log(commit ? "\n=== COMMIT ===\n" : "\n=== DRY RUN (no --commit; nothing will be written) ===\n");

// ── read-back ────────────────────────────────────────────────────────────
//
// Separate from the write on purpose. A phase that reports what it just did,
// from its own in-memory plan, cannot tell you the row landed. This re-reads.
if (doShow) {
  const rows = await sql<
    {
      token: string;
      customer_label: string;
      hubspot_company_id: string | null;
      status: string;
      approved_by: string | null;
      next_number: number | null;
    }[]
  >`
    select r.token, r.customer_label, r.hubspot_company_id, r.status,
           u.email as approved_by, c.next_number
      from sku_brand_registry r
      left join users u on u.id = r.approved_by_user_id
      left join sku_counters c on c.token = r.token
     order by r.token
  `;
  console.log("| token | customer | company id | status | approved by | counter |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.token} | ${r.customer_label} | ${r.hubspot_company_id ?? "—"} | ${r.status} | ` +
        `${r.approved_by ?? "—"} | ${r.next_number ?? "UNSEEDED"} |`,
    );
  }
  const [counts] = await sql<{ allocations: number }[]>`
    select count(*)::int as allocations from sku_allocations
  `;
  // What can actually issue a SKU today: approved AND seeded AND flagged on.
  // Any one of the three missing is a full stop, which is why all three print.
  const allocatable = rows.filter((r) => r.status === "approved" && r.next_number != null).length;
  console.log(
    `\n  ${rows.length} registry row(s), ${allocatable} approved-and-seeded, ` +
      `${counts?.allocations ?? 0} allocation(s), generation flag ` +
      `${process.env.SKU_GENERATION_ENABLED === "1" ? "ON" : "off"}\n`,
  );
}

// ── phase 1: registration ────────────────────────────────────────────────
if (doRegister) {
  const existing = await sql<
    { token: string; customer_label: string; hubspot_company_id: string | null; status: string }[]
  >`select token, customer_label, hubspot_company_id, status from sku_brand_registry`;
  const byToken = new Map(existing.map((r) => [r.token, r]));

  const toInsert: typeof APPROVED = [];
  const conflicts: string[] = [];
  let alreadyCorrect = 0;

  for (const a of APPROVED) {
    const cur = byToken.get(a.token);
    if (!cur) {
      toInsert.push(a);
      continue;
    }
    // A token that already exists and already says the same thing is done. One
    // that says something DIFFERENT is a contradiction, not an update.
    if (cur.hubspot_company_id !== a.companyId || cur.status !== "approved") {
      conflicts.push(
        `${a.token}: registry holds company=${cur.hubspot_company_id ?? "null"} status=${cur.status}; ` +
          `approved list says company=${a.companyId} status=approved`,
      );
    } else {
      alreadyCorrect++;
    }
  }

  console.log(`registry: ${existing.length} row(s) present, ${APPROVED.length} approved token(s) requested`);
  console.log(`  to insert      : ${toInsert.length}  (${toInsert.map((t) => t.token).join(", ") || "—"})`);
  console.log(`  already correct: ${alreadyCorrect}`);
  if (conflicts.length) {
    console.log("  CONFLICTS:");
    conflicts.forEach((c) => console.log("    " + c));
    await fail(
      `${conflicts.length} token(s) already mean something else. Resolve by hand; this will not overwrite a namespace.`,
    );
  }

  if (commit && toInsert.length) {
    await sql.begin(async (tx) => {
      for (const a of toInsert) {
        await tx`
          insert into sku_brand_registry
            (token, customer_label, hubspot_company_id, status, evidence,
             proposed_by_user_id, approved_by_user_id, approved_at, updated_at)
          values (
            ${a.token}, ${a.label}, ${a.companyId}, 'approved',
            ${sql.json({
              source: "three_way_reconciliation_pr_579",
              approved_by_email: "edward@thedps.co",
              approved_on: "2026-09-14",
              company_resolution: "HubSpot companies directory, matched from hs_folder_name",
              note:
                a.token === "MISTR"
                  ? "Second company record 48843403658 (MISTR) deliberately NOT merged or aliased."
                  : null,
            })},
            ${APPROVER}, ${APPROVER}, now(), now()
          )
        `;
      }
    });
    console.log(`  WROTE ${toInsert.length} registry row(s).`);
  }
  console.log("");
}

// ── phase 2: seeding ─────────────────────────────────────────────────────
if (doSeed) {
  const nsPath = arg("--netsuite");
  if (!nsPath) {
    await fail("--seed requires --netsuite <file>. A seed without a production NetSuite maximum is a guess.");
  }

  type NsSurvey = {
    accountId: string;
    environment?: string;
    complete: boolean;
    measuredAt: string;
    maxima: Record<string, number>;
    coverage?: unknown;
  };
  let ns: NsSurvey;
  try {
    ns = JSON.parse(fs.readFileSync(nsPath as string, "utf8")) as NsSurvey;
  } catch (e) {
    await fail(`could not read ${nsPath}: ${(e as Error).message}`);
    throw e;
  }

  if (ns.accountId !== PRODUCTION_NETSUITE_ACCOUNT) {
    await fail(
      `the survey names account ${ns.accountId}; production is ${PRODUCTION_NETSUITE_ACCOUNT}. ` +
        "A sandbox maximum cannot seed a production counter.",
    );
  }
  // `complete` is DECLARED, never inferred. A partial survey has rows in it
  // too, and inferring completeness from their presence is how a maximum taken
  // from part of a catalog becomes a colliding identifier.
  if (ns.complete !== true) {
    await fail(
      "the survey does not declare `complete: true`. A token absent from a partial survey means nothing, so no seed can be computed from it.",
    );
  }
  const ageMs = Date.now() - Date.parse(ns.measuredAt);
  if (!Number.isFinite(ageMs)) await fail(`the survey's measuredAt (${ns.measuredAt}) is not a readable timestamp.`);
  const ageHours = ageMs / 3_600_000;
  if (ageHours > maxAgeHours) {
    await fail(
      `the NetSuite survey is ${ageHours.toFixed(1)}h old (limit ${maxAgeHours}h). ` +
        "All three systems accept new items continuously; a seed from a stale snapshot can sit below an identifier created since. Re-survey.",
    );
  }
  if (ageHours < -0.1) await fail(`the survey's measuredAt is ${(-ageHours).toFixed(1)}h in the future.`);

  console.log(
    `NetSuite survey: account ${ns.accountId}, measured ${ns.measuredAt} (${ageHours.toFixed(2)}h ago), ` +
      `${Object.keys(ns.maxima).length} token(s)`,
  );

  // Nexus and HubSpot are measured HERE, in the run that writes.
  const nexus = new Map<string, number>();
  let leafRows = 0;
  for (const r of await sql<{ sku: string }[]>`select sku from leaves where sku is not null`) {
    leafRows++;
    const p = parseSku(r.sku);
    if (p) nexus.set(p.token, Math.max(nexus.get(p.token) ?? 0, p.number));
  }

  const hsToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!hsToken) await fail("HUBSPOT_ACCESS_TOKEN is not set; HubSpot cannot be measured.");
  const hubspot = new Map<string, number>();
  let products = 0;
  let pages = 0;
  let after: string | null = null;
  do {
    const u = new URL("https://api.hubapi.com/crm/v3/objects/products");
    u.searchParams.set("limit", "100");
    u.searchParams.set("properties", "hs_sku");
    if (after) u.searchParams.set("after", after);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${hsToken}` } });
    if (!res.ok) await fail(`HubSpot ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as {
      results?: { properties: { hs_sku?: string } }[];
      paging?: { next?: { after?: string } };
    };
    for (const pr of j.results ?? []) {
      products++;
      const p = parseSku(pr.properties.hs_sku);
      if (p) hubspot.set(p.token, Math.max(hubspot.get(p.token) ?? 0, p.number));
    }
    after = j.paging?.next?.after ?? null;
    pages++;
  } while (after && pages < 100);
  // Exhaustion is a CONDITION, not a hope. A paging loop that stops at its own
  // cap has surveyed a prefix of the catalog and cannot say so afterwards.
  if (after) {
    await fail("HubSpot paging did not exhaust within 100 pages; the maximum would be taken from a prefix of the catalog.");
  }

  console.log(`Nexus: ${leafRows} leaf SKU(s), ${nexus.size} token(s)`);
  console.log(`HubSpot: ${products} product(s) over ${pages} page(s), ${hubspot.size} token(s)`);
  console.log("");

  const registry = await sql<{ token: string; status: string }[]>`select token, status from sku_brand_registry`;
  const status = new Map(registry.map((r) => [r.token, r.status]));
  const notApproved = APPROVED.filter((a) => status.get(a.token) !== "approved");
  if (notApproved.length) {
    await fail(`not approved in the registry: ${notApproved.map((a) => a.token).join(", ")}. Register before seeding.`);
  }

  const counters = await sql<{ token: string; next_number: number | null }[]>`
    select token, next_number from sku_counters
  `;
  const seeded = new Map(counters.map((c) => [c.token, c.next_number]));

  const measuredAt = new Date().toISOString();
  const plan: { token: string; n: number | null; h: number | null; s: number | null; seed: number }[] = [];
  const alreadySeeded: string[] = [];

  for (const a of APPROVED) {
    const existing = seeded.get(a.token);
    if (existing != null) {
      alreadySeeded.push(`${a.token} (already at ${existing})`);
      continue;
    }
    const n = nexus.get(a.token) ?? null;
    const h = hubspot.get(a.token) ?? null;
    const s = ns.maxima[a.token] ?? null;
    plan.push({
      token: a.token,
      n,
      h,
      s,
      seed: Math.max(FIRST_NUMBER - 1, n ?? 0, h ?? 0, s ?? 0) + 1,
    });
  }

  console.log("| token | Nexus | HubSpot | NetSuite | seed (max+1) |");
  console.log("|---|---|---|---|---|");
  for (const p of plan) {
    console.log(`| ${p.token} | ${p.n ?? "—"} | ${p.h ?? "—"} | ${p.s ?? "—"} | **${p.seed}** |`);
  }
  if (alreadySeeded.length) {
    console.log("\n  SKIPPED, already seeded (re-seeding would renumber a live namespace):");
    alreadySeeded.forEach((t) => console.log("    " + t));
  }

  if (commit && plan.length) {
    await sql.begin(async (tx) => {
      for (const p of plan) {
        await tx`
          insert into sku_counters
            (token, next_number, seed_basis, seeded_by_user_id, seeded_at, updated_at)
          values (
            ${p.token}, ${p.seed},
            ${sql.json({
              rule: `max(${FIRST_NUMBER - 1}, nexus, hubspot, netsuite) + 1`,
              first_number_floor: FIRST_NUMBER,
              nexus: p.n,
              hubspot: p.h,
              netsuite: p.s,
              netsuite_account: ns.accountId,
              netsuite_measured_at: ns.measuredAt,
              netsuite_complete: ns.complete,
              nexus_hubspot_measured_at: measuredAt,
              nexus_leaf_rows: leafRows,
              hubspot_products: products,
              approved_on: "2026-09-14",
            })},
            ${APPROVER}, now(), now()
          )
        `;
      }
    });
    console.log(`\n  WROTE ${plan.length} counter(s).`);
  }
  console.log("");
}

await sql.end();
