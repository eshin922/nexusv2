/**
 * Whether Nexus writes ordered specifications to NetSuite after a Sales Order
 * push. Dependency-free so app code, scripts and tests evaluate one rule.
 *
 *   NETSUITE_ORDERED_SPEC_EXPORT=enabled   write
 *   NETSUITE_ORDERED_SPEC_EXPORT=disabled  never write
 *   unset / unrecognised                   write ONLY against a sandbox account
 *
 * FAIL-SAFE DEFAULT. Production NetSuite does not yet have
 * `customrecord_nx_ordered_spec` or `custcol_nx_ordered_spec` (they were built
 * in sandbox 7924416_SB2 on 2026-10-05). Production must be switched on
 * explicitly, after its customization exists and the sandbox end-to-end cases
 * pass — never by a missing variable.
 */
export const ORDERED_SPEC_EXPORT_ENV = "NETSUITE_ORDERED_SPEC_EXPORT";

export function isOrderedSpecExportEnabled(
  netsuiteEnv: "sandbox" | "production",
  value: string | undefined = process.env[ORDERED_SPEC_EXPORT_ENV],
): boolean {
  const v = value?.trim().toLowerCase();
  if (v === "enabled") return true;
  if (v === "disabled") return false;
  return netsuiteEnv === "sandbox";
}
