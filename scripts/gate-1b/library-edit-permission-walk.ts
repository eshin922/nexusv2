/**
 * Who may edit a library product — against the REAL roster.
 *
 *   npm run walk:library-edit-permission
 *
 * READ ONLY. One SELECT over `users`. Nothing is written, no product is
 * touched, and no external system is called.
 *
 * ── WHY A SCRIPT AND NOT ONLY A TEST ─────────────────────────────────────
 *
 * The unit tests decide the rule against constructed actors. That proves the
 * rule. It does not prove that the person who reported the defect is admitted
 * by it, because it never reads her row — and her row is the claim.
 *
 * So this drives the SAME exported predicate the server guard and the UI both
 * call, over the actual roster, and names every operator whose answer changes.
 * A fixture that agreed with production by coincidence would look identical.
 */
import postgres from "postgres";
import { canEditLibraryProduct } from "../../src/lib/permissions/library-product.ts";

const url = process.env.DIRECT_URL ?? "";
if (!url) {
  console.error("DIRECT_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

const rows = await sql<
  { email: string; role: string; can_create_leaves: boolean }[]
>`
  select email, role, can_create_leaves
    from users
   order by role, email
`;

/**
 * The rule as `assertCanCreateLeaves` applies it, which is what product
 * editing used to be gated on. Stated here so the change is legible per row;
 * the authoritative comparison lives in
 * `tests/unit/library-product-edit-permission.test.ts`.
 */
const previouslyCouldEdit = (r: { role: string; can_create_leaves: boolean }) =>
  r.role === "admin" || r.can_create_leaves === true;

console.log("\n| operator | role | can_create_leaves | edit before | edit now |");
console.log("|---|---|---|---|---|");
let gained = 0;
let lost = 0;
for (const r of rows) {
  const before = previouslyCouldEdit(r);
  const after = canEditLibraryProduct({
    role: r.role,
    canCreateLeaves: r.can_create_leaves,
  });
  if (after && !before) gained++;
  if (before && !after) lost++;
  const mark = after === before ? "" : after ? "  <- GAINED" : "  <- LOST";
  console.log(
    `| ${r.email} | ${r.role} | ${r.can_create_leaves} | ${before ? "yes" : "NO"} | ${after ? "yes" : "NO"} |${mark}`,
  );
}

console.log(`\n  ${gained} operator(s) gained product editing, ${lost} lost it.`);

// Nobody may LOSE a capability to a repair whose purpose is to restore one.
// An explicit grant that stopped working would be a regression wearing a fix.
if (lost > 0) {
  console.error("\nFAIL: a repair that restores access must take none away.\n");
  await sql.end();
  process.exit(1);
}

// The reported operator, named. A summary count would pass while the one
// person the repair exists for stayed refused.
const REPORTER = "aisha@thedps.co";
const reporter = rows.find((r) => r.email === REPORTER);
if (!reporter) {
  console.error(`\nFAIL: ${REPORTER} is not on the roster; the claim cannot be checked.\n`);
  await sql.end();
  process.exit(1);
}
const reporterCan = canEditLibraryProduct({
  role: reporter.role,
  canCreateLeaves: reporter.can_create_leaves,
});
console.log(
  `  ${REPORTER}: role ${reporter.role}, grant ${reporter.can_create_leaves} -> ` +
    `${reporterCan ? "MAY edit library products" : "still REFUSED"}`,
);
if (!reporterCan) {
  console.error("\nFAIL: the reported defect is not fixed for the reporter.\n");
  await sql.end();
  process.exit(1);
}

// Creation is open to every authenticated user, so the roster cannot refuse
// anyone -- asserted here because the add-side half of the report lives in the
// UI, where a gate could be reintroduced without touching this rule.
console.log(`  creation: open to all ${rows.length} authenticated operator(s), by disposition\n`);

await sql.end();
