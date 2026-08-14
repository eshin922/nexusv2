/**
 * OW-2 · isolation — what exactly moved, before any baseline is refreshed.
 *
 * READ ONLY. Writes nothing, and does not touch the baseline.
 *
 * WHY THIS EXISTS. `verify:s7-preserved` reports the FIRST difference it finds
 * and then stops, which is right for a gate and useless as evidence for a
 * refresh: "skuRollups: length 4 -> 6" is compatible with two rows being added
 * AND a price moving inside one of the other four. A refresh justified by that
 * line alone would absorb both.
 *
 * So this proves the delta narrowly, and the ORDER matters — preservation is
 * established by this diff, never by the refresh that follows it. A refreshed
 * baseline is green by construction and therefore evidence of nothing.
 *
 * Same one-off shape as am-005-isolate.ts, kept as the artifact for the
 * disposition rather than run and discarded.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./canonical-digest.ts";
import { baselineEntryInBasket, basketPredicate } from "./basket.ts";
import { projectOntoBaseline } from "./projection.ts";

type Entry = { quote_id: string; status: string; label: string; digest: string };
const baseline = JSON.parse(
  readFileSync("docs/gate-1b/costing-baseline.json", "utf8"),
) as { globalDigest: string; capturedOver: number; entries: Entry[] };
const baselineDetail = JSON.parse(
  '{"_":' + readFileSync("docs/gate-1b/costing-baseline-detail.json", "utf8").trim() + "}",
)._ as Record<string, Record<string, unknown>>;

// Parameterised: the same isolation applies to any single-quote delta, and a
// hardcoded id would have meant a copy of this file per incident.
const SUSPECT = process.argv[2] ?? "2f29af72-805b-446c-866c-73e9b0991b1a";

/** EVERY difference, not the first — the whole point of this pass. */
function allDifferences(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) out.push(`${path}: ${a} -> ${b}`);
    return out;
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    if (canonical(a) !== canonical(b)) out.push(`${path}: ${canonical(a)} -> ${canonical(b)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: shape changed`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      allDifferences(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)]))
    allDifferences(ao[k], bo[k], path ? `${path}.${k}` : k, out);
  return out;
}

const quotes = (await db.execute(sql`
  select q.id::text as quote_id from quotes q where ${basketPredicate()} order by q.id
`)) as unknown as { quote_id: string }[];

const inBasket = baseline.entries.filter((e) => baselineEntryInBasket(e.label));
const baseByQuote = new Map(inBasket.map((e) => [e.quote_id, e]));

console.log("\nOW-2 isolation — pre-refresh diff\n");

let checks = 0;
let failures = 0;
function claim(ok: boolean, text: string, detail?: string) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);
  if (detail) console.log(`          ${detail}`);
}

// ---------------------------------------------------------------- 1 + 6
const changed: string[] = [];
const perQuoteDiffs = new Map<string, string[]>();
let current: Record<string, unknown> | null = null;

for (const q of quotes) {
  const base = baseByQuote.get(q.quote_id);
  if (!base) continue;
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) throw new Error(`bundle error on ${q.quote_id}: ${res.error.code}`);
  const c = res.data.costing;
  const payload = {
    quote: c.quote,
    firmSettings: c.firmSettings,
    tiers: c.tiers,
    skuRollups: c.skuRollups,
    quoteRollup: c.quoteRollup,
    quoteSummary: c.quoteSummary,
  };
  const projected = projectOntoBaseline(baselineDetail[q.quote_id], payload, []) as Record<
    string,
    unknown
  >;
  const digest = createHash("sha256").update(canonical(projected)).digest("hex").slice(0, 32);
  if (digest !== base.digest) {
    changed.push(q.quote_id);
    perQuoteDiffs.set(q.quote_id, allDifferences(baselineDetail[q.quote_id], projected));
  }
  if (q.quote_id === SUSPECT) current = projected;
}

claim(
  changed.length === 1 && changed[0] === SUSPECT,
  "the failing quote is the ONLY basket member whose projection changed",
  `changed: ${changed.length ? changed.join(", ") : "none"} · basket size ${baseByQuote.size}`,
);

// ------------------------------------------------------------------- 2
//
// `skuRollups` is compared POSITIONALLY by the gate, and Direct Products render
// FIRST, so inserting two at the head shifts every index and reports the whole
// array as moved. Those diffs are an artifact of ordering, not evidence of a
// value change — an instrument that cannot tell insertion from movement.
//
// Everything OUTSIDE skuRollups has no ordering hazard and is compared as-is;
// skuRollups is compared by `skuId` below. Both halves are required: this one
// would miss a moved rollup, that one would miss a moved quote total.
const baseSuspect = baselineDetail[SUSPECT];
const curSuspect = current as Record<string, unknown>;
const outsideRollups = Object.keys(baseSuspect)
  .filter((k) => k !== "skuRollups")
  .flatMap((k) => allDifferences(baseSuspect[k], curSuspect[k], k));

claim(
  outsideRollups.length === 0,
  "no quote-level value moved — tiers, quoteRollup, quoteSummary, firmSettings",
  outsideRollups.length
    ? outsideRollups.join("\n          ")
    : "compared field-by-field outside skuRollups",
);

// ------------------------------------------------------------------- 4
const baseRollups = (baselineDetail[SUSPECT].skuRollups ?? []) as Record<string, unknown>[];
const curRollups = ((current?.skuRollups ?? []) as Record<string, unknown>[]) ?? [];
const curById = new Map(curRollups.map((r) => [String(r.skuId), r]));

const movedInRetained: string[] = [];
for (const b of baseRollups) {
  const cur = curById.get(String(b.skuId));
  if (!cur) {
    movedInRetained.push(`${String(b.skuId)}: present at capture, absent now`);
    continue;
  }
  // Byte-for-byte over the captured key set, at full float precision.
  for (const d of allDifferences(b, projectOntoBaseline(b, cur, []), String(b.skuLabel)))
    movedInRetained.push(d);
}
claim(
  movedInRetained.length === 0,
  "every pre-existing rollup is identical to the prior baseline",
  movedInRetained.length
    ? movedInRetained.join("\n          ")
    : `${baseRollups.length} retained rollups compared field-by-field`,
);

// ------------------------------------------------------------------- 3
const addedIds = curRollups
  .map((r) => String(r.skuId))
  .filter((id) => !baseRollups.some((b) => String(b.skuId) === id));

const attaches = (await db.execute(sql`
  select a.created_at::text as at, a.entity_id as quote_leaf_id,
         a.diff_json->>'leaf_id' as leaf_id, u.email
    from audit_log a left join users u on u.id = a.user_id
   where a.action = 'quote_product_attach'
     and a.diff_json->>'quote_id' = ${SUSPECT}
   order by a.created_at
`)) as unknown as { at: string; quote_leaf_id: string; leaf_id: string; email: string }[];

const attachedLeafIds = new Set(attaches.map((a) => a.quote_leaf_id).filter(Boolean));
const addedSet = new Set(addedIds);
const correspond =
  attaches.length === 2 &&
  addedIds.length === 2 &&
  [...addedSet].every((id) => attachedLeafIds.has(id)) &&
  [...attachedLeafIds].every((id) => addedSet.has(id));

claim(
  correspond,
  "the two added rollups correspond exactly to the two operator-walk attach events",
  `added rollups: ${addedIds.join(", ") || "none"}\n          ` +
    `attach events: ${attaches.map((a) => `${a.quote_leaf_id} @ ${a.at} by ${a.email}`).join("\n                         ") || "none"}`,
);

// ------------------------------------------------------------------- 5
const GOVERNED =
  /cost|sell|price|freight|duty|tariff|margin|qty|quantity|markup|total|revenue|turnkey|amount|adj/i;
// Over the identity-matched diffs only. Screening the positional list would
// re-report the ordering artifact as a hundred moved prices — the same
// instrument error one layer up, and the more dangerous one, because here it
// would be read as grounds to REFUSE a refresh that is in fact justified.
const identityMatched = [
  ...outsideRollups,
  ...movedInRetained,
  ...[...perQuoteDiffs.entries()]
    .filter(([q]) => q !== SUSPECT)
    .flatMap(([, d]) => d),
];
const governedMoves = identityMatched.filter((d) => GOVERNED.test(d.split(":")[0]));
claim(
  governedMoves.length === 0,
  "no governed numeric value moved anywhere in the basket",
  governedMoves.length ? governedMoves.join("\n          ") : "cost/sell/freight/duty/tariff/margin/qty: none",
);

console.log(
  `\n  ${failures === 0 ? "ISOLATED" : "NOT ISOLATED"} — ${checks - failures}/${checks} claims hold.\n`,
);
if (failures > 0) {
  console.error("  The delta is NOT confined to the operator-walk attachment. Do not refresh.\n");
  process.exit(1);
}
console.log(
  "  The delta is a structural attachment of two Direct Products by the operator\n" +
    "  walk. No arithmetic moved. Preservation is established by THIS diff — the\n" +
    "  refresh that follows is green by construction and proves nothing.\n",
);
process.exit(0);
