// Phase A.1 v2 impl-2 polish — /setup route alias (Bug #G).
//
// Sibling surfaces (Costs, Pricing, Quote, Mark-Accepted) all use
// suffix folders; Setup was the only surface served from the bare
// quote URL. PMs typing `/setup` got a 404. This re-export gives
// PMs the suffix-consistent URL while keeping the existing bare URL
// available for bookmarks and older links.
//
// Both URLs render the same page component. All new navigation should
// use /setup; the bare URL remains a compatibility alias.

export { default } from "../page";
