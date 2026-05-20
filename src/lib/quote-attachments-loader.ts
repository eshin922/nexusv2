import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { quoteAttachments, users } from "@/db/schema";

// canonical-scenario-create-flow Step 7 — quote attachments loader.
// Returns the list for the Setup-surface attachment-list modal +
// project detail card chip count.

export type QuoteAttachmentRow = {
  id: string;
  filename: string;
  storageUrl: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  uploadedByName: string | null;
  uploadedByEmail: string;
  uploadedAt: Date;
  notes: string | null;
};

export async function loadQuoteAttachments(
  quoteId: string,
): Promise<QuoteAttachmentRow[]> {
  const rows = await db
    .select({
      id: quoteAttachments.id,
      filename: quoteAttachments.filename,
      storageUrl: quoteAttachments.storageUrl,
      mimeType: quoteAttachments.mimeType,
      fileSizeBytes: quoteAttachments.fileSizeBytes,
      uploadedByName: users.name,
      uploadedByEmail: users.email,
      uploadedAt: quoteAttachments.uploadedAt,
      notes: quoteAttachments.notes,
    })
    .from(quoteAttachments)
    .innerJoin(users, eq(users.id, quoteAttachments.uploadedByUserId))
    .where(eq(quoteAttachments.quoteId, quoteId))
    .orderBy(asc(quoteAttachments.uploadedAt));
  return rows;
}
