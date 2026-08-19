import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quotes, netsuiteServiceItemMap } from "@/db/schema";
const [q] = await db.select().from(quotes).where(eq(quotes.id,"430b5ce4-975b-4262-8247-aee668f287a8"));
console.log("quote status:", q.status, "| soId:", q.netsuiteSoId, "| tranid:", q.netsuiteSoTranid, "| push:", q.netsuiteSoPushStatus);
console.log("\n── netsuite_service_item_map rows ──");
const rows = await db.select().from(netsuiteServiceItemMap);
console.table(rows.map(r=>({ ...r })));
process.exit(0);
