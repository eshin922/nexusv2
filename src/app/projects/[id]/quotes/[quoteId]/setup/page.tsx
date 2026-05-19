// Phase A.1 v2 impl-2 polish — /setup route alias (Bug #G).
//
// Sibling surfaces (Costs, Pricing, Quote, Mark-Accepted) all use
// suffix folders; Setup was the only surface served from the bare
// quote URL. PMs typing `/setup` got a 404. This re-export gives
// PMs the suffix-consistent URL without breaking the existing bare
// URL (which existing nav patterns still use as the default Setup
// destination).
//
// Both URLs render the same page component. Future cleanup may
// consolidate to /setup-only once nav patterns + bookmarks have
// settled; deferred to avoid breaking external links in v1.

export { default } from "../page";
