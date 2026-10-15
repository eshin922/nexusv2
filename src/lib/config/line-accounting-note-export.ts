/** Explicit switch: the dedicated NetSuite line field must exist first. */
export const LINE_ACCOUNTING_NOTE_EXPORT_ENV = "NETSUITE_LINE_ACCOUNTING_NOTE_EXPORT";

export function isLineAccountingNoteExportEnabled(
  value: string | undefined = process.env[LINE_ACCOUNTING_NOTE_EXPORT_ENV],
): boolean {
  return value?.trim().toLowerCase() === "enabled";
}
