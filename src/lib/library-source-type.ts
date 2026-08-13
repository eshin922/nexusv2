/**
 * The sentinel for "HubSpot has not classified this product".
 *
 * WHY THIS IS ITS OWN MODULE. It is needed on both sides of the server/client
 * boundary — the loader turns it into `IS NULL`, the Library modal's chip
 * submits it — and every other home for it is `server-only`. Importing a
 * runtime value from a server-only module into a client component pulls that
 * whole module into the client graph and fails the build, so the constant lives
 * where neither side has to reach across.
 *
 * WHY A SENTINEL RATHER THAN AN EMPTY FILTER. Empty already means "no filter,
 * show everything". Unclassified is a real, selectable population — the
 * products HubSpot leaves null — and it needs a value distinguishable from
 * absence, or those records become reachable only by scrolling past everything
 * else.
 *
 * The double underscore keeps it outside the `hs_product_type` value space, so
 * it can never collide with a genuine HubSpot option.
 */
export const UNCLASSIFIED_SOURCE_TYPE = "__unclassified__";
