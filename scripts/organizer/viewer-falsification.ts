import { db } from "@/db";
import { users } from "@/db/schema";
import { loadOrganizer } from "@/lib/organizer/load";

const all = await db.select().from(users);
for (const u of all) {
  const d = await loadOrganizer({ userId: u.id, commercialApprover: u.commercialApprover, role: u.role });
  const kinds = d.needsYou.reduce((a: any, t) => (a[t.kind] = (a[t.kind] ?? 0) + 1, a), {});
  if (d.needsYou.length === 0) continue;
  console.log(`${(u.email ?? "?").padEnd(30)} approver=${String(u.commercialApprover).padEnd(5)} tasks=${String(d.needsYou.length).padStart(3)} deals=${String(d.projects.filter(p=>p.group==="needs_you").length).padStart(2)}  ${JSON.stringify(kinds)}`);
}
console.log("--- users with an empty queue ---");
for (const u of all) {
  const d = await loadOrganizer({ userId: u.id, commercialApprover: u.commercialApprover, role: u.role });
  if (d.needsYou.length === 0) console.log(`  ${u.email} (approver=${u.commercialApprover})`);
}
process.exit(0);
