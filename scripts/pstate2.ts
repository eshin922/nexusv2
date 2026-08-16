import postgres from "postgres";
const sqlc = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL!, { max: 1, prepare: false });
const Q = "4781e4bb-0597-4044-a1ea-3ffc8c3be35a";
const t = await sqlc`select label, sort_order, recommended from quote_tiers where quote_id = ${Q}::uuid order by sort_order`;
for (const r of t) console.log("  ", r.label, "sort", r.sort_order, "recommended =", r.recommended);
await sqlc.end(); process.exit(0);
