/**
 * §0 confirmation — characterize the S-7 delta BEFORE refreshing the baseline.
 *
 * Answers four questions with evidence rather than with the verifier's summary:
 *   1. did ONLY 2f29af72 change?
 *   2. is the change membership/order only?
 *   3. did any commercial scalar move?
 *   4. was a product added or removed?
 *
 * Question 3 is the one that cannot be answered by the digest: a digest says
 * SOMETHING moved, never what. So every numeric leaf is compared as a MULTISET
 * — order-independent — because a pure reorder permutes values without changing
 * any of them, and a comparison that walks by index cannot tell that apart from
 * a value actually changing.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { basketPredicate } from "./basket.ts";
import { canonical } from "./canonical-digest.ts";

const baseline = JSON.parse(
  readFileSync("docs/gate-1b/costing-baseline-detail.json", "utf8"),
) as Record<string, unknown>;

/** Every numeric leaf, path-tagged, with array indices erased. */
function numerics(node: unknown, path: string, out: Map<string, number[]>) {
  if (typeof node === "number") {
    const k = path;
    (out.get(k) ?? out.set(k, []).get(k)!).push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) numerics(v, `${path}[]`, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>))
      numerics(v, path ? `${path}.${k}` : k, out);
  }
}

/**
 * A movement is only a MOVEMENT if it exceeds floating-point noise.
 *
 * IEEE-754 addition is not associative, so the same mathematical value
 * accumulated in a different row order differs in the last bit. A comparison
 * that treats 0.37550000000000006 and 0.3755 as different numbers reports a
 * commercial change where there is none — and that report is expensive,
 * because the honest response to it is to refresh a governed baseline.
 *
 * The threshold is RELATIVE and deliberately tiny: 1e-9 is ~1e7 times larger
 * than a double's epsilon at these magnitudes, and ~1e5 times smaller than the
 * smallest commercially meaningful movement (a hundredth of a cent). Nothing a
 * human would call a price change hides under it.
 */
const NOISE = 1e-9;
const isNoise = (x: number, y: number) =>
  x === y || Math.abs(x - y) <= NOISE * Math.max(1, Math.abs(x), Math.abs(y));

function multisetDiff(a: Map<string, number[]>, b: Map<string, number[]>) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  const moved: string[] = [];
  const noise: string[] = [];
  for (const k of keys) {
    const x = (a.get(k) ?? []).slice().sort((p, q) => p - q);
    const y = (b.get(k) ?? []).slice().sort((p, q) => p - q);
    if (x.length !== y.length) {
      moved.push(`${k}  n=${x.length}->${y.length}`);
      continue;
    }
    const diffs = x
      .map((v, i) => [v, y[i]] as const)
      .filter(([p, q]) => p !== q);
    if (diffs.length === 0) continue;
    if (diffs.every(([p, q]) => isNoise(p, q))) {
      const worst = diffs.reduce((m, [p, q]) => Math.max(m, Math.abs(p - q)), 0);
      noise.push(`${k}  max|delta|=${worst.toExponential(2)}`);
      continue;
    }
    const sample = diffs.find(([p, q]) => !isNoise(p, q))!;
    moved.push(`${k}  e.g. ${sample[0]} -> ${sample[1]}`);
  }
  return { moved, noise };
}

const basket = (await db.execute(sql`
  select q.id::text as quote_id, p.deal_name || ' / ' || q.scenario_label as label
    from quotes q join projects p on p.id = q.project_id
   where ${basketPredicate()} order by q.id
`)) as unknown as { quote_id: string; label: string }[];
let changed = 0;
console.log(`\n§0 confirmation — ${basket.length} basket quotes\n`);

for (const q of basket) {
  const before = baseline[q.quote_id];
  if (before === undefined) { console.log(`  NEW IN BASKET  ${q.quote_id}`); changed++; continue; }
  const res = await getCostingBundle(q.quote_id);
  if (!res.ok) { console.log(`  ERROR ${q.quote_id} ${res.error.code}`); continue; }
  const c = res.data.costing;
  const after = JSON.parse(canonical({
    quote: c.quote, firmSettings: c.firmSettings, tiers: c.tiers,
    skuRollups: c.skuRollups, quoteRollup: c.quoteRollup, quoteSummary: c.quoteSummary,
  }));
  if (canonical(before) === canonical(after)) continue;

  changed++;
  console.log(`  CHANGED  ${q.quote_id}  ${q.label ?? ""}`);

  const nb = new Map<string, number[]>(); numerics(before, "", nb);
  const na = new Map<string, number[]>(); numerics(after, "", na);
  const { moved, noise } = multisetDiff(nb, na);
  console.log(`    commercial scalars moved : ${moved.length === 0 ? "NONE — every numeric value present before is present after" : moved.length}`);
  for (const m of moved) console.log(`      ${m}`);
  // Reported SEPARATELY, never folded into the count above. Silently ignoring
  // them would hide a real determinism problem; counting them as movement
  // manufactures a commercial finding out of the last bit of a double.
  console.log(`    float-noise-only paths   : ${noise.length}`);
  for (const n of noise) console.log(`      ${n}`);

  const ids = (n: unknown): string[] => {
    const out: string[] = [];
    const walk = (x: unknown) => {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x && typeof x === "object") {
        const r = x as Record<string, unknown>;
        if (typeof r.canonicalQuoteLeafId === "string") out.push(r.canonicalQuoteLeafId);
        if (typeof r.quoteSkuId === "string") out.push(r.quoteSkuId);
        Object.values(r).forEach(walk);
      }
    };
    walk(n); return out.sort();
  };
  const ib = ids(before), ia = ids(after);
  const added = ia.filter((x) => !ib.includes(x));
  const removed = ib.filter((x) => !ia.includes(x));
  console.log(`    product identities       : before=${ib.length} after=${ia.length}`);
  console.log(`    added                    : ${added.length ? added.join(", ") : "none"}`);
  console.log(`    removed                  : ${removed.length ? removed.join(", ") : "none"}`);
  const sameSet = ib.length === ia.length && ib.every((v, i) => v === ia[i]);
  console.log(`    identity SET unchanged   : ${sameSet ? "yes — order/binding only" : "NO"}`);
}

console.log(`\n  quotes changed: ${changed}\n`);
process.exit(0);
