import { db } from "@/db";
import { quotes, projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCostingBundle } from "@/app/actions/costing";
import { loadUnresolvedQuoteCosts } from "@/lib/quote-cost-completeness";

const drafts = await db.select({ id: quotes.id }).from(quotes)
  .innerJoin(projects, eq(projects.id, quotes.projectId))
  .where(and(eq(projects.isTest, false), eq(quotes.status, "draft")));

console.log(`DRAFTS ${drafts.length}`);
let t = Date.now();
for (const d of drafts) await getCostingBundle(d.id);
const bundleMs = Date.now() - t;
t = Date.now();
for (const d of drafts) await loadUnresolvedQuoteCosts(d.id);
const unresolvedMs = Date.now() - t;
console.log(`SEQUENTIAL_BUNDLE_MS ${bundleMs}  (${Math.round(bundleMs/drafts.length)}/quote)`);
console.log(`SEQUENTIAL_UNRESOLVED_MS ${unresolvedMs}  (${Math.round(unresolvedMs/drafts.length)}/quote)`);
console.log(`TOTAL_IF_LIVE_MS ${bundleMs + unresolvedMs}`);
process.exit(0);
