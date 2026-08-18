/**
 * The admin sections — ONE list, consumed by both the left nav and the index.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * There were two lists: `NAV` in `layout.tsx` and `SECTIONS` in `page.tsx`.
 * They had already drifted before anything was added to either — the nav
 * offered Users and Audit log, the index did not — so the two surfaces
 * disagreed about what the admin area even contains.
 *
 * That drift is also what let the NetSuite section ship reachable from the
 * index and invisible in the nav: adding it to one list looked complete,
 * because nothing connected the two. A missing nav entry produces no error,
 * no failing test, and no broken page. It produces a section the operator
 * simply never finds.
 *
 * One list makes the omission unrepresentable rather than merely unlikely.
 *
 * Two descriptions per section, deliberately: the nav wants a terse subtitle
 * under a 224px label, the index wants a sentence explaining what the section
 * decides. Collapsing them would make one of the two surfaces read badly, and
 * "share the data" does not require "share the copy".
 */
export type AdminSection = {
  href: string;
  label: string;
  /** Terse subtitle for the left nav. */
  nav: string;
  /** Fuller sentence for the index card. */
  index: string;
};

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    href: "/admin/firm-settings",
    label: "Firm settings",
    nav: "Margin policy + customer-facing defaults",
    index:
      "Target margin and floor margin policy. Drives the GOOD / BELOW_TARGET / BELOW_FLOOR thresholds on every quote's Pricing.",
  },
  {
    href: "/admin/markup-defaults",
    label: "Markup defaults",
    nav: "Per-category markup percentages",
    index:
      "Per-category markup percentages applied to packaging, production, and freight cost components.",
  },
  {
    href: "/admin/netsuite",
    label: "NetSuite",
    nav: "Direct Service item mappings",
    index:
      "Integration settings. Direct Service item mappings decide which NetSuite record each service becomes on a Sales Order.",
  },
  {
    href: "/admin/users",
    label: "Users",
    nav: "Manual phone entry for PreparedBy",
    index:
      "User records and the manual phone entry that PreparedBy reads on the customer-facing quote.",
  },
  {
    href: "/admin/audit-log",
    label: "Audit log",
    nav: "Append-only write history",
    index:
      "Append-only history of every governed write, by actor, entity, and change.",
  },
];
