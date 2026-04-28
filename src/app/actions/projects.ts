"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLog, projects, users } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import { getDeal, HubspotError } from "@/lib/hubspot";

const VALID_CATEGORIES = [
  "packaging",
  "turnkey",
  "soft_goods",
  "secondary",
  "other",
] as const;
type ProjectCategoryValue = (typeof VALID_CATEGORIES)[number];

type Diff = Record<string, { from: unknown; to: unknown }>;

function diffOf<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Diff {
  const d: Diff = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (before[k] !== after[k]) {
      d[String(k)] = { from: before[k], to: after[k] };
    }
  }
  return d;
}

async function logAudit(args: {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  diffJson?: object;
}) {
  await db.insert(auditLog).values({
    userId: args.userId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    diffJson: args.diffJson ?? {},
  });
}

async function resolveSalesRepUserId(ownerEmail: string | null): Promise<string | null> {
  if (!ownerEmail) return null;
  const match = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ownerEmail))
    .limit(1);
  return match[0]?.id ?? null;
}

export async function importDeal(formData: FormData) {
  const dealId = String(formData.get("dealId") ?? "").trim();
  if (!dealId) throw new Error("dealId required");

  const user = await ensureUser();

  // Idempotent find-or-create
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.hubspotDealId, dealId))
    .limit(1);
  if (existing.length > 0) redirect(`/projects/${existing[0].id}`);

  const deal = await getDeal(dealId);
  if (!deal) throw new HubspotError(`Deal ${dealId} not found in HubSpot`);

  const salesRepUserId = await resolveSalesRepUserId(deal.ownerEmail);

  const inserted = await db
    .insert(projects)
    .values({
      hubspotDealId: dealId,
      hubspotOwnerId: deal.hubspotOwnerId,
      dealName: deal.name,
      clientName: deal.clientName,
      salesRepUserId,
      pmUserId: null,
      projectCategory: "packaging",
      status: "active",
      dealStage: deal.stageId || null,
      lastHubspotRefreshAt: new Date(),
      importedByUserId: user.id,
    })
    .returning({ id: projects.id });

  const project = inserted[0];

  await logAudit({
    userId: user.id,
    entityType: "project",
    entityId: project.id,
    action: "created",
    diffJson: { deal_id: dealId },
  });

  redirect(`/projects/${project.id}`);
}

export async function refreshFromHubspot(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) throw new Error("projectId required");

  const user = await ensureUser();

  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (rows.length === 0) throw new Error("Project not found");
  const project = rows[0];

  const deal = await getDeal(project.hubspotDealId);
  if (!deal)
    throw new HubspotError(
      `Deal ${project.hubspotDealId} no longer exists in HubSpot`,
    );

  const salesRepUserId = await resolveSalesRepUserId(deal.ownerEmail);

  const before = {
    deal_name: project.dealName,
    client_name: project.clientName,
    deal_stage: project.dealStage,
    hubspot_owner_id: project.hubspotOwnerId,
    sales_rep_user_id: project.salesRepUserId,
  };
  const after = {
    deal_name: deal.name,
    client_name: deal.clientName,
    deal_stage: deal.stageId || null,
    hubspot_owner_id: deal.hubspotOwnerId,
    sales_rep_user_id: salesRepUserId,
  };
  const diff = diffOf(before, after);

  await db
    .update(projects)
    .set({
      dealName: deal.name,
      clientName: deal.clientName,
      dealStage: deal.stageId || null,
      hubspotOwnerId: deal.hubspotOwnerId,
      salesRepUserId,
      lastHubspotRefreshAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  await logAudit({
    userId: user.id,
    entityType: "project",
    entityId: projectId,
    action: "refreshed",
    diffJson: diff,
  });

  revalidatePath(`/projects/${projectId}`);
}

export async function updateProjectCategory(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  if (!projectId) throw new Error("projectId required");
  if (!VALID_CATEGORIES.includes(category as ProjectCategoryValue))
    throw new Error("Invalid category");

  const user = await ensureUser();

  const rows = await db
    .select({
      projectCategory: projects.projectCategory,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (rows.length === 0) throw new Error("Project not found");
  const before = rows[0].projectCategory;
  if (before === category) return;

  await db
    .update(projects)
    .set({
      projectCategory: category as ProjectCategoryValue,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  await logAudit({
    userId: user.id,
    entityType: "project",
    entityId: projectId,
    action: "category_changed",
    diffJson: { project_category: { from: before, to: category } },
  });

  revalidatePath(`/projects/${projectId}`);
}

export async function archiveProject(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) throw new Error("projectId required");

  const user = await ensureUser();

  const rows = await db
    .select({ status: projects.status })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (rows.length === 0) throw new Error("Project not found");
  if (rows[0].status === "archived") redirect("/");

  await db
    .update(projects)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  await logAudit({
    userId: user.id,
    entityType: "project",
    entityId: projectId,
    action: "archived",
    diffJson: { status: { from: "active", to: "archived" } },
  });

  redirect("/");
}
