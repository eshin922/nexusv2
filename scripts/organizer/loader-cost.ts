import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadOrganizer } from "@/lib/organizer/load";

// Count every SQL round trip the loader makes.
let queries = 0;
const orig = (db as any).execute?.bind(db);
const ed = (await db.select().from(users).where(eq(users.email, "edward@thedps.co")))[0];
if (!ed) { console.log("NO_ED"); process.exit(1); }

const t = Date.now();
const data = await loadOrganizer({ userId: ed.id, commercialApprover: ed.commercialApprover, role: ed.role });
const ms = Date.now() - t;

console.log(`ELAPSED_MS ${ms}`);
console.log(`PROJECTS ${data.projects.length}  HIDDEN_TEST ${data.hiddenTestProjectCount}  UNOWNED_TASKS ${data.unownedTaskCount}`);
console.log(`NEEDS_YOU_TASKS ${data.needsYou.length}  NEEDS_YOU_DEALS ${data.projects.filter(p=>p.group==="needs_you").length}`);
// `needsYou[0]` is `undefined` on an empty queue while `nextMove` is `null`,
// so the identity is asserted against the same coalesce the loader applies.
console.log(`NEXT_MOVE_IS_NEEDSYOU0 ${data.nextMove === (data.needsYou[0] ?? null)}`);
console.log(`HAS_ANY_QUOTES_FALSE ${data.projects.filter(p=>!p.hasAnyQuotes).length}`);
console.log("GROUPS", JSON.stringify(data.projects.reduce((a: any, p) => (a[p.group]=(a[p.group]??0)+1, a), {})));
console.log("TASK_KINDS_PRESENT", JSON.stringify(data.needsYou.reduce((a: any, t) => (a[t.kind]=(a[t.kind]??0)+1, a), {})));
console.log("TOP_5:");
for (const t of data.needsYou.slice(0,5)) console.log(`   ${t.kind.padEnd(22)} ${t.reason}`);
process.exit(0);
