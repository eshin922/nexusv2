"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  userPinnedProjects,
  userProjectVisits,
} from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";

// Slice RI.1/RI.2 — workspace state actions for the outer rail's
// Pinned + Recent sections. Pins persist per user; visits update on
// project surface mounts to drive the Recent MRU list.

export async function pinProject(
  formData: FormData,
): Promise<ActionResult<{ projectId: string }>> {
  return runAction(async () => {
    const projectId = String(formData.get("projectId") ?? "").trim();
    if (!projectId)
      throw new ActionGuardError(ERR.VALIDATION, "projectId required");

    const user = await ensureUser();

    // INSERT … ON CONFLICT DO NOTHING — pin is idempotent. pin_order
    // defaults to (current max + 1) so newly-pinned items append to
    // the end of the user's pin list. Compute via a sub-select.
    await db.execute(sql`
      INSERT INTO user_pinned_projects (user_id, project_id, pin_order)
      VALUES (
        ${user.id},
        ${projectId},
        COALESCE(
          (SELECT MAX(pin_order) + 1 FROM user_pinned_projects WHERE user_id = ${user.id}),
          0
        )
      )
      ON CONFLICT (user_id, project_id) DO NOTHING
    `);

    revalidatePath("/", "layout"); // outer rail rendered in layout — invalidate

    return { projectId };
  });
}

export async function unpinProject(
  formData: FormData,
): Promise<ActionResult<{ projectId: string }>> {
  return runAction(async () => {
    const projectId = String(formData.get("projectId") ?? "").trim();
    if (!projectId)
      throw new ActionGuardError(ERR.VALIDATION, "projectId required");

    const user = await ensureUser();

    await db
      .delete(userPinnedProjects)
      .where(
        and(
          eq(userPinnedProjects.userId, user.id),
          eq(userPinnedProjects.projectId, projectId),
        ),
      );

    revalidatePath("/", "layout");

    return { projectId };
  });
}

// Record a project visit for the Recent MRU section. Idempotent
// (UPSERT on composite PK; updates last_visited_at on conflict).
// Called from project surfaces' server components so every
// navigation refreshes MRU ordering.
export async function recordProjectVisit(projectId: string): Promise<void> {
  if (!projectId) return; // defensive — never throw on this background op

  try {
    const user = await ensureUser();
    await db.execute(sql`
      INSERT INTO user_project_visits (user_id, project_id, last_visited_at)
      VALUES (${user.id}, ${projectId}, now())
      ON CONFLICT (user_id, project_id) DO UPDATE
      SET last_visited_at = excluded.last_visited_at
    `);
  } catch (e) {
    // Visit recording is a side effect; never crash a page render
    // on its failure. Log silently and move on.
    console.error("recordProjectVisit failed:", e);
  }
}
