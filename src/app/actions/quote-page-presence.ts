"use server";

import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { quotePagePresence, quotes, users } from "@/db/schema";
import { ensureUser } from "@/lib/auth/ensure-user";
import { QUOTE_PRESENCE_TTL_MS, validQuotePageKey } from "@/lib/quote-page-presence";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function checkQuote(projectId: string, quoteId: string) {
  if (!UUID.test(projectId) || !UUID.test(quoteId)) throw new Error("Invalid quote address.");
  const [quote] = await db.select({ id: quotes.id }).from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.projectId, projectId))).limit(1);
  if (!quote) throw new Error("Quote not found.");
}

export async function heartbeatQuotePagePresence(input: {
  projectId: string; quoteId: string; pageKey: string; sessionId: string;
}): Promise<string[]> {
  const user = await ensureUser();
  if (!UUID.test(input.sessionId) || !validQuotePageKey(input.pageKey)) throw new Error("Invalid page presence.");
  await checkQuote(input.projectId, input.quoteId);
  const now = new Date();
  await db.delete(quotePagePresence).where(and(
    eq(quotePagePresence.quoteId, input.quoteId), lt(quotePagePresence.expiresAt, now),
  ));
  await db.insert(quotePagePresence).values({
    quoteId: input.quoteId, userId: user.id, sessionId: input.sessionId,
    pageKey: input.pageKey, expiresAt: new Date(now.getTime() + QUOTE_PRESENCE_TTL_MS),
  }).onConflictDoUpdate({
    target: [quotePagePresence.quoteId, quotePagePresence.userId, quotePagePresence.sessionId],
    set: { pageKey: input.pageKey, expiresAt: new Date(now.getTime() + QUOTE_PRESENCE_TTL_MS), updatedAt: now },
  });
  const rows = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(quotePagePresence).innerJoin(users, eq(quotePagePresence.userId, users.id))
    .where(and(
      eq(quotePagePresence.quoteId, input.quoteId),
      eq(quotePagePresence.pageKey, input.pageKey),
      gt(quotePagePresence.expiresAt, now),
      ne(quotePagePresence.userId, user.id),
    ));
  const byUser = new Map(rows.map((row) => [row.id, row.name?.trim() || row.email.split("@")[0]]));
  return [...byUser.values()].sort((a, b) => a.localeCompare(b));
}

export async function leaveQuotePagePresence(input: {
  projectId: string; quoteId: string; sessionId: string;
}): Promise<void> {
  const user = await ensureUser();
  if (!UUID.test(input.sessionId)) return;
  await checkQuote(input.projectId, input.quoteId);
  await db.delete(quotePagePresence).where(and(
    eq(quotePagePresence.quoteId, input.quoteId),
    eq(quotePagePresence.userId, user.id),
    eq(quotePagePresence.sessionId, input.sessionId),
  ));
}
