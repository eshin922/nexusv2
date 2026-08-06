/**
 * Gate 1A step 1 — record the missing display name on the work account.
 *
 * Sets users.name on e60b5670 to "Ed Shin" so the backfill snapshots a sourced
 * identity rather than the never-empty fallback. Disposition, 2026-08-06: the
 * two accounts are distinct technical identities and stay distinct through
 * actor_user_id; the human behind them is one person, and "Ed Shin" is already
 * the established display identity on the primary account — the least
 * interpretive normalization available.
 *
 * The accounts are NOT merged and no history is rewritten. After this, the
 * trail shows one name reached through two snapshot ids, which is what
 * actually happened.
 *
 * Deliberately writes NO audit row. This is a profile correction, not an
 * audited business action, and a row here would alter the very counts and
 * digests the backfill proof requires unchanged.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

const TARGET_ID_PREFIX = "e60b5670";
const NAME = "Ed Shin";

const [before] = await db
  .select({ id: users.id, name: users.name, email: users.email })
  .from(users)
  .where(eq(users.email, "edward@thedps.co"))
  .limit(1);

if (!before) throw new Error("target user not found by email");
if (!before.id.startsWith(TARGET_ID_PREFIX)) {
  throw new Error(`expected user ${TARGET_ID_PREFIX}…, found ${before.id}`);
}
if ((before.name ?? "").trim() !== "") {
  console.log(`already named "${before.name}" — nothing to do`);
  process.exit(0);
}

await db.update(users).set({ name: NAME }).where(eq(users.id, before.id));

const [after] = await db
  .select({ id: users.id, name: users.name, email: users.email })
  .from(users)
  .where(eq(users.id, before.id))
  .limit(1);

console.log(`  ${after.id}  ${after.email}`);
console.log(`  name: ${before.name === null ? "(null)" : `"${before.name}"`} -> "${after.name}"`);
process.exit(0);
