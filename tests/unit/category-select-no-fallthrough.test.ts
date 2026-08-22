import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string => stripComments(src).replace(/\r\n/g, "\n");
const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

// ═══════════════════════════════════════════════════════════════════════
// A `<select>` whose `defaultValue` matches no `<option>` silently selects the
// FIRST one. For project category that means an unrecognised value renders as
// "Packaging" — not a display bug but a FALSE CLAIM about the project, on the
// page an operator reads to learn what the project is.
//
// This is the atomic half of the `unclassified` enum change, and it is a merge
// blocker for any commit introducing that value.
// ═══════════════════════════════════════════════════════════════════════

test("an unrecognised category cannot fall through to the first option", async () => {
  const src = codeOnly(await read("src/app/projects/[id]/category-select.tsx"));

  // The guard must be computed from the option list itself, not a hardcoded
  // list of "known bad" values — a second list would drift from the first.
  assert.match(
    src,
    /const isKnown = CATEGORIES\.some\(\(c\) => c\.value === value\)/,
    "there is no membership check against the rendered option list",
  );

  // An explicit option is rendered for the unrecognised value, so the browser
  // has something truthful to select.
  assert.match(
    src,
    /!isKnown && \(\s*<option value=\{value\} disabled>/,
    "no explicit option is rendered for an unrecognised value",
  );

  // Disabled, so it displays the state without offering a value the database
  // would reject while the enum has not shipped.
  assert.match(src, /<option value=\{value\} disabled>/);
});

test("the fallback names the state rather than guessing at it", async () => {
  const src = await read("src/app/projects/[id]/category-select.tsx");
  assert.match(src, /UNKNOWN_LABEL = "Unclassified/);
  // It must not silently borrow a real category's label.
  for (const real of ["Packaging", "Turnkey", "Soft Goods", "Secondary"]) {
    assert.doesNotMatch(
      src,
      new RegExp(`UNKNOWN_LABEL\\s*=\\s*"${real}`),
      `the unknown-state label impersonates the real category "${real}"`,
    );
  }
});

test("the enum and its rendering stay atomic", async () => {
  // If `unclassified` ever reaches the DB enum, the option list and the write
  // validator must know about it too. Asserted from BOTH sides so the pairing
  // cannot be half-shipped in either direction.
  const schema = await read("src/db/schema.ts");
  const enumHasIt = /projectCategory = pgEnum\([\s\S]{0,220}unclassified/.test(schema);

  const select = await read("src/app/projects/[id]/category-select.tsx");
  const validator = await read("src/app/actions/projects.ts");

  if (enumHasIt) {
    assert.match(
      select,
      /value: "unclassified"/,
      "the enum has `unclassified` but the picker cannot render it as a choice",
    );
    assert.match(
      validator,
      /"unclassified"/,
      "the enum has `unclassified` but VALID_CATEGORIES rejects it",
    );
  } else {
    // Not yet in the enum — the picker must not offer a value the DB refuses.
    assert.doesNotMatch(
      select,
      /value: "unclassified"/,
      "the picker offers `unclassified` before the enum accepts it",
    );
  }
});
