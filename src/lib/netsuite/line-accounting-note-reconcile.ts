import { matchPostedSpecLines, type FrozenLine, type PostedLine } from "./ordered-spec-matching";

export type FrozenNote = FrozenLine & { accountingNote: string | null };
export type PostedNote = PostedLine & {
  accountingNote: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
};
export type OrderRead = { lines: PostedNote[]; total: number | null };

export type LineAccountingNoteOutcome =
  | { status: "disabled" | "not_applicable"; reason: string }
  | { status: "succeeded" | "failed"; expected: number; verified: number; errors: string[] };

/**
 * Convergent, line-scoped transfer. A retry skips matching notes already on
 * the order. Product identities use the proven ordered-spec matcher, including
 * expanded Item Group members and repeated SKUs.
 */
export async function transferFrozenLineAccountingNotes(
  soId: string,
  frozen: FrozenNote[],
  read: (id: string) => Promise<OrderRead>,
  patch: (id: string, line: number, note: string) => Promise<void>,
): Promise<Exclude<LineAccountingNoteOutcome, { status: "disabled" | "not_applicable" }>> {
  const expected = frozen.filter((line) =>
    (line.lineKind === "direct_product" || line.lineKind === "item_group_member") &&
    !!line.accountingNote,
  );
  if (expected.length === 0) return { status: "succeeded", expected: 0, verified: 0, errors: [] };
  const before = await read(soId);
  const match = matchPostedSpecLines(before.lines, frozen);
  const errors = [...match.problems];
  for (const unplaced of match.unmatched) {
    if ((unplaced.frozen as FrozenNote).accountingNote) {
      errors.push(`Unmatched SKU ${unplaced.frozen.displaySku ?? "(no SKU)"}: ${unplaced.reason}`);
    }
  }
  if (errors.length > 0) {
    return { status: "failed", expected: expected.length, verified: 0, errors };
  }
  const keys = new Map<string, string>();
  for (const matched of match.matches) {
    const note = (matched.frozen as FrozenNote).accountingNote;
    if (!note) continue;
    keys.set(matched.posted.lineUniqueKey, note);
    if (matched.posted.accountingNote === note) continue;
    try {
      await patch(soId, matched.posted.line, note);
    } catch (error) {
      errors.push(`Line ${matched.posted.lineUniqueKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const after = await read(soId);
  const beforeKeys = before.lines.map((line) => line.lineUniqueKey).join(",");
  const afterKeys = after.lines.map((line) => line.lineUniqueKey).join(",");
  if (beforeKeys !== afterKeys) errors.push("Sales Order line identities changed");
  if (before.total !== after.total) errors.push("Sales Order total changed");
  const beforeByKey = new Map(before.lines.map((line) => [line.lineUniqueKey, line]));
  let verified = 0;
  for (const line of after.lines) {
    const earlier = beforeByKey.get(line.lineUniqueKey);
    if (earlier && (earlier.quantity !== line.quantity || earlier.rate !== line.rate || earlier.amount !== line.amount)) {
      errors.push(`Commercial values changed on line ${line.lineUniqueKey}`);
    }
    if (!keys.has(line.lineUniqueKey)) continue;
    if (line.accountingNote === keys.get(line.lineUniqueKey)) verified++;
    else errors.push(`Accounting note missing on line ${line.lineUniqueKey}`);
  }
  if (keys.size !== expected.length) errors.push("Not every frozen note matched a Sales Order line");
  return { status: errors.length === 0 && verified === expected.length ? "succeeded" : "failed",
    expected: expected.length, verified, errors };
}
