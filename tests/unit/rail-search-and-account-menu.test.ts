import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string => stripComments(src).replace(/\r\n/g, "\n");
const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

// ═══════════════════════════════════════════════════════════════════════
// Two rail controls that behaved wrongly in production:
//
//   - the search button was `disabled` and did nothing;
//   - the initials button signed the operator out on first click.
//
// Both are affordance defects rather than logic ones, so these assert the
// STRUCTURE that makes the affordance correct.
// ═══════════════════════════════════════════════════════════════════════

test("the rail's search is a real control, not a disabled stub", async () => {
  const rail = codeOnly(await read("src/components/rails/outer-rail.tsx"));
  assert.match(rail, /<CommandSearch \/>/, "the rail does not mount the search control");
  assert.doesNotMatch(rail, /coming soon/i, "a 'coming soon' stub is back in the rail");

  const search = codeOnly(await read("src/components/rails/command-search.tsx"));
  assert.doesNotMatch(
    search,
    /<button[^>]*\sdisabled/,
    "the search trigger is disabled — a disabled control gives no click feedback and reads as broken",
  );
});

test("deal search is read-only and excludes fixture projects", async () => {
  const src = codeOnly(await read("src/app/actions/project-search.ts"));
  for (const forbidden of [/\.insert\(/, /\.update\(/, /\.delete\(/, /revalidatePath/]) {
    assert.doesNotMatch(src, forbidden, `the search action reaches for ${forbidden}`);
  }
  assert.match(
    src,
    /eq\(projects\.isTest, false\)/,
    "search would return fixture projects the table deliberately hides",
  );
  assert.match(src, /ensureUser\(\)/, "the search action does not establish a caller");
});

test("search never reports an absence it has not established", async () => {
  const src = await read("src/components/rails/command-search.tsx");
  // "No deals match" is a RESULT. Rendering it while a request is in flight
  // states a fact the component does not have yet — the same class as a probe
  // that reports "missing" for a failed read.
  assert.match(
    src,
    /!pending && hits\.length === 0/,
    "the empty state is not gated on the request having completed",
  );
  // And a slow earlier response must not overwrite a newer one.
  assert.match(src, /seq\.current/, "there is no guard against out-of-order responses");
});

test("the account avatar opens a menu instead of signing out", async () => {
  const rail = codeOnly(await read("src/components/rails/outer-rail.tsx"));
  assert.match(rail, /<UserMenu\b/, "the rail does not mount the account menu");

  // The provider's control must wrap the MENU ITEM, never the avatar. The
  // regression this prevents: clicking your own initials to check which account
  // you are in, and losing the session finding out.
  assert.match(
    rail,
    /signOutItem=\{authentication\.ui\.renderSignOutControl\(/,
    "sign-out is not scoped to the menu item",
  );
  assert.doesNotMatch(
    rail,
    /renderSignOutControl\(\{[\s\S]{0,400}\{initials\}/,
    "the sign-out control still wraps the initials button itself",
  );

  const menu = codeOnly(await read("src/components/rails/user-menu.tsx"));
  // The menu renders the provider's control; it must not call sign-out itself,
  // which would bypass the redirect behaviour the provider exists to own.
  assert.doesNotMatch(menu, /signOut\(/, "the menu calls signOut directly");
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /Escape/, "the menu cannot be dismissed from the keyboard");
});
