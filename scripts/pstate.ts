import postgres from "postgres";
const sqlc = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL!, { max: 1, prepare: false });
const Q = "4781e4bb-0597-4044-a1ea-3ffc8c3be35a";
const q = await sqlc`select project_id, global_price_adj_pct, status, scenario_label from quotes where id = ${Q}::uuid`;
const t = await sqlc`select id, label, tier_price_adj_pct from quote_tiers where quote_id = ${Q}::uuid order by sort_order`;
console.log("project:", q[0]?.project_id, "| global:", q[0]?.global_price_adj_pct, "| status:", q[0]?.status);
for (const r of t) console.log("  ", r.label, "=", r.tier_price_adj_pct, r.id);
await sqlc.end(); process.exit(0);
