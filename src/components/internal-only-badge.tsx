// Slice 6.5+ convention badge — anywhere customs/CBM/duty/tariff or
// other internal-only data is rendered. See CLAUDE.md "Customs /
// landed-cost data" for the full convention.
export function InternalOnlyBadge({
  className = "",
  short = false,
}: {
  className?: string;
  short?: boolean;
}) {
  return (
    <span
      className={`inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900 ${className}`}
    >
      {short ? "Internal" : "Internal — not shown to customer"}
    </span>
  );
}
