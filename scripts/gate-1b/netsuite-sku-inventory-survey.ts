/**
 * NetSuite item-identifier survey, for SKU counter seeding.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────
 *
 * A counter must seed ABOVE the highest number already in use, in every
 * system that holds one. Nexus and HubSpot have been surveyed. NetSuite has
 * not — and until it is, any seed is a guess that could mint an identifier
 * some item already carries.
 *
 * READ ONLY. One SuiteQL SELECT, no writes of any kind. SuiteQL has no DML,
 * and the transport classifier treats this path as a read.
 *
 *   npm run survey:netsuite-skus
 *
 * ── IT REPORTS WHICH ACCOUNT IT ASKED ────────────────────────────────────
 *
 * A sandbox answer is not a production answer, and the whole reason this
 * survey exists is that the sandbox one was mistaken for it once. So the
 * account and its sandbox status are printed first, and `--require-production`
 * refuses to run at all against a sandbox.
 */
import { describeNetsuiteTarget, suiteQL } from "../../src/lib/netsuite/client.ts";

// `NetsuiteTargetFacts` deliberately does NOT carry the account id -- it
// reports what the guard concluded, not the credentials. The id is read from
// the environment here purely to name which account was asked, because a
// survey that cannot say which system answered it settles nothing.
const accountId = process.env.NETSUITE_ACCOUNT_ID ?? "(unset)";

const requireProduction = process.argv.includes("--require-production");

const target = describeNetsuiteTarget();
console.log("NetSuite target");
console.log("  account      :", accountId);
console.log("  environment  :", target.environment);
console.log("  is sandbox   :", target.accountIsSandbox);

if (target.accountIsSandbox) {
  console.log("");
  if (requireProduction) {
    console.log("REFUSING: --require-production was passed and this is a SANDBOX account.");
    console.log("A sandbox inventory cannot seed a production counter.");
    process.exit(2);
  }
  console.log("NOTE: this is a SANDBOX account. Its numbers say nothing about");
  console.log("production, and a seed derived from them would be a guess.");
  console.log("Running anyway to prove the survey mechanism; the RESULT is not");
  console.log("usable for seeding.");
}

// Every item identifier, whatever its type. `itemid` is the display name
// NetSuite shows and the field a DPS- identifier would live in.
//
// PAGED to exhaustion. A single page would silently survey only the first
// slice, and a maximum taken from part of the catalog is exactly the kind of
// seed that mints a colliding identifier -- the survey would report a number
// and be wrong in the one direction that matters.
const rows: { itemid: string; itemtype: string }[] = [];
let offset = 0;
for (let page = 0; page < 200; page++) {
  const res = await suiteQL<{ itemid: string; itemtype: string }>(
    `SELECT itemid, itemtype FROM item WHERE itemid LIKE 'DPS-%'`,
    { limit: 1000, offset },
  );
  rows.push(...res.items);
  if (!res.hasMore) break;
  offset += res.items.length;
  if (res.items.length === 0) break;
}

console.log("");
console.log(`DPS- items returned: ${rows.length}`);

const byToken = new Map<string, number>();
for (const r of rows) {
  const n = (r.itemid ?? "").trim().toUpperCase();
  const [, token, third] = n.split("-");
  if (!/^[A-Z][A-Z0-9]*$/.test(token ?? "")) continue;
  if (!/^[0-9]+$/.test(third ?? "")) continue;
  const v = parseInt(third, 10);
  byToken.set(token, Math.max(byToken.get(token) ?? 0, v));
}

console.log(`tokens with a numeric series: ${byToken.size}`);
console.log("");
console.log("| token | highest in NetSuite |");
console.log("|---|---|");
[...byToken.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .forEach(([t, max]) => console.log(`| \`${t}\` | ${max} |`));

console.log("");
console.log("A final seed is max(Nexus, HubSpot, NetSuite) + 1 per token.");
console.log("This survey supplies only the third of those three.");
