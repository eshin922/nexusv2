"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureUser } from "@/lib/auth/ensure-user";
import type { SurfaceKey } from "@/lib/nav/surface-routes";

// Slice RI.9 §3.7 + §6 step 9 — `user_surface_visits` write path.
//
// Records LAST surface a user touched per (project, quote). Mirror
// of `recordProjectVisit` (workspace.ts:83) — idempotent UPSERT,
// silent failure. Called from every quote-scoped page server-side.
//
// Read path lives in `home-queries.ts` (`getResumeContext`) — single
// row per user via `ORDER BY visited_at DESC LIMIT 1`.
//
// Visit recording is a SIDE EFFECT. Never throw; never crash a page
// render on its failure. The cost of a missed visit is "Resume card
// is one surface behind"; the cost of a thrown error is "page 500s."
// Heavy-handed try/catch is the correct posture here.

export async function recordSurfaceVisit({
  projectId,
  quoteId,
  surfaceKey,
}: {
  projectId: string;
  quoteId: string;
  surfaceKey: SurfaceKey;
}): Promise<void> {
  if (!projectId || !quoteId) return; // defensive

  try {
    const user = await ensureUser();
    await db.execute(sql`
      INSERT INTO user_surface_visits (user_id, project_id, quote_id, surface_key, visited_at)
      VALUES (${user.id}, ${projectId}, ${quoteId}, ${surfaceKey}, now())
      ON CONFLICT (user_id, project_id, quote_id, surface_key) DO UPDATE
      SET visited_at = excluded.visited_at
    `);
  } catch (e) {
    // Background op; never crash the page on its failure.
    console.error("recordSurfaceVisit failed:", e);
  }
}
