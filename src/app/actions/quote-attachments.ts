"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, quoteAttachments, quotes } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import {
  ActionGuardError,
  ERR,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import {
  getSupabaseServer,
  QUOTE_ATTACHMENTS_BUCKET,
  buildAttachmentStoragePath,
} from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";

// canonical-scenario-create-flow Step 4 — quote attachment server
// actions.
//
// `addQuoteAttachment` — uploads a file to Supabase Storage bucket
// `quote-attachments` at path `{quoteId}/{uuid}-{filename}`, inserts
// `quote_attachments` row, emits `quote_attachment_added` audit row.
// File size capped at 25 MB; MIME types restricted to PDF / Word /
// Excel / images (PNG, JPEG, WebP) / plain text.
//
// `removeQuoteAttachment` — hard-deletes the Storage object + the
// quote_attachments row + emits `quote_attachment_removed` audit row
// with pre-delete snapshot (per CA Q7 disposition: hard delete +
// audit; customer-data hygiene).
//
// Pattern 45 boundary: this action layer lives OUTSIDE the
// customer-view boundary (src/components/pdf/ verifier doesn't
// touch action layer). PM-internal attachments NEVER cross into
// the PDF render tree.

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
]);

export async function addQuoteAttachment(
  formData: FormData,
): Promise<ActionResult<{ attachmentId: string }>> {
  return runAction(async () => {
    const quoteId = String(formData.get("quoteId") ?? "").trim();
    const file = formData.get("file");
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (!quoteId)
      throw new ActionGuardError(ERR.VALIDATION, "quoteId required");
    if (!(file instanceof File))
      throw new ActionGuardError(ERR.VALIDATION, "file required");

    // Size + MIME validation (defense in depth — client also validates).
    if (file.size > MAX_FILE_SIZE) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "File exceeds 25 MB limit.",
      );
    }
    if (!ALLOWED_MIME.has(file.type)) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Allowed: PDF, Word, Excel, images (PNG/JPG/WebP), plain text.",
      );
    }

    const user = await ensureUser();

    // Verify quote exists.
    const quoteRows = await db
      .select()
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (quoteRows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Quote not found");

    // Generate Storage path + upload.
    const uuid = randomUUID();
    const storagePath = buildAttachmentStoragePath(quoteId, uuid, file.name);

    const supabase = getSupabaseServer();
    const arrayBuffer = await file.arrayBuffer();
    const uploadResult = await supabase.storage
      .from(QUOTE_ATTACHMENTS_BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadResult.error) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Storage upload failed: ${uploadResult.error.message}`,
      );
    }

    // Insert quote_attachments row. storage_url is the Storage path
    // (resolved to a signed URL at read time, not stored as a public
    // URL since the bucket is private).
    const [row] = await db
      .insert(quoteAttachments)
      .values({
        quoteId,
        filename: file.name,
        storageUrl: storagePath,
        mimeType: file.type,
        fileSizeBytes: file.size,
        uploadedByUserId: user.id,
        notes,
      })
      .returning();

    // Audit per CLAUDE.md namespace (added below in this slice).
    await db.insert(auditLog).values({
      userId: user.id,
      entityType: "quote",
      entityId: quoteId,
      action: "quote_attachment_added",
      diffJson: {
        attachment_id: row.id,
        filename: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
        notes,
      },
    });

    // Revalidate Setup surface (attachment list affordance) +
    // project detail (attachment count chip).
    revalidatePath("/projects/[id]/quotes/[quoteId]/setup", "page");
    revalidatePath("/projects/[id]", "page");

    return { attachmentId: row.id };
  });
}

export async function removeQuoteAttachment(
  formData: FormData,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const attachmentId = String(formData.get("attachmentId") ?? "").trim();
    if (!attachmentId)
      throw new ActionGuardError(ERR.VALIDATION, "attachmentId required");

    const user = await ensureUser();

    // Load attachment + snapshot pre-delete for audit.
    const rows = await db
      .select()
      .from(quoteAttachments)
      .where(eq(quoteAttachments.id, attachmentId))
      .limit(1);
    if (rows.length === 0) return; // idempotent
    const attachment = rows[0];

    // Delete Storage object (idempotent — if already gone, no-op).
    const supabase = getSupabaseServer();
    const deleteResult = await supabase.storage
      .from(QUOTE_ATTACHMENTS_BUCKET)
      .remove([attachment.storageUrl]);
    if (deleteResult.error) {
      // Log but don't block — DB row removal is the canonical truth.
      console.warn(
        `[removeQuoteAttachment] Storage delete failed for ${attachment.storageUrl}: ${deleteResult.error.message}. Continuing with row delete.`,
      );
    }

    // Hard delete row.
    await db.delete(quoteAttachments).where(eq(quoteAttachments.id, attachmentId));

    // Audit with pre-delete snapshot.
    await db.insert(auditLog).values({
      userId: user.id,
      entityType: "quote",
      entityId: attachment.quoteId,
      action: "quote_attachment_removed",
      diffJson: {
        attachment_id: attachment.id,
        filename: attachment.filename,
        storage_url: attachment.storageUrl,
        mime_type: attachment.mimeType,
        file_size_bytes: attachment.fileSizeBytes,
        uploaded_by_user_id: attachment.uploadedByUserId,
        uploaded_at: attachment.uploadedAt.toISOString(),
        notes: attachment.notes,
      },
    });

    revalidatePath("/projects/[id]/quotes/[quoteId]/setup", "page");
    revalidatePath("/projects/[id]", "page");
  });
}

// canonical-scenario-create-flow Step 7 — signed URL for download.
// Storage bucket is private; clients request a short-lived signed
// URL when the PM clicks "download" on an attachment row. Server
// action uses the service-role-key Supabase client + Supabase
// Storage's createSignedUrl API.
export async function getQuoteAttachmentSignedUrl(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const attachmentId = String(formData.get("attachmentId") ?? "").trim();
    if (!attachmentId)
      throw new ActionGuardError(ERR.VALIDATION, "attachmentId required");

    // Permission gate: any authenticated user with access to the
    // parent quote. Scoping enforced upstream by Clerk + the page
    // routes; this action just ensures a signed-in user.
    await ensureUser();

    const rows = await db
      .select()
      .from(quoteAttachments)
      .where(eq(quoteAttachments.id, attachmentId))
      .limit(1);
    if (rows.length === 0)
      throw new ActionGuardError(ERR.NOT_FOUND, "Attachment not found");
    const attachment = rows[0];

    const supabase = getSupabaseServer();
    const signed = await supabase.storage
      .from(QUOTE_ATTACHMENTS_BUCKET)
      .createSignedUrl(attachment.storageUrl, 60 * 5); // 5 min TTL
    if (signed.error) {
      throw new ActionGuardError(
        ERR.VALIDATION,
        `Storage signed-URL generation failed: ${signed.error.message}`,
      );
    }
    if (!signed.data?.signedUrl)
      throw new ActionGuardError(
        ERR.VALIDATION,
        "Storage signed-URL response missing url",
      );

    return { url: signed.data.signedUrl };
  });
}
