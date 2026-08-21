import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

/** Comments stripped AND line endings normalized — see #334 for why. */
const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// THE NEXUS ENTRANCE IS /sign-in — AND THERE IS NO SECOND DOOR
//
// Clerk's hosted Account Portal is the instance default for BOTH
// post-sign-out navigation and unauthenticated protected-route redirects.
// Neither is a Nexus surface, and neither offers Continue with The DPS.
//
// The defect that made this visible was logout. The one that had been
// invisible for longer is `redirectToSignIn()`, which every unauthenticated
// visit to a protected route already traversed.
// ═══════════════════════════════════════════════════════════════════════

const MIDDLEWARE = () =>
  readFile(new URL("../../src/lib/auth/production-middleware.ts", import.meta.url), "utf8");
const PROVIDER = () =>
  readFile(
    new URL("../../src/lib/auth/clerk-authentication-provider.tsx", import.meta.url),
    "utf8",
  );
const SIGN_OUT_RUNTIME = () =>
  readFile(new URL("../../node_modules/@clerk/clerk-react/dist/index.mjs", import.meta.url), "utf8");

// ── unauthenticated protected route -> Nexus, not the Account Portal ──────

test("middleware states its own sign-in URL", async () => {
  const src = codeOnly(await MIDDLEWARE());
  assert.match(src, /const SIGN_IN_URL = "\/sign-in"/);
  assert.match(
    src,
    /\{ signInUrl: SIGN_IN_URL \}/,
    "redirectToSignIn() resolves the MIDDLEWARE option; the ClerkProvider prop " +
      "is client-side and never reaches it",
  );
});

test("the sign-in destination is not left to an environment variable", async () => {
  const src = codeOnly(await MIDDLEWARE());
  assert.doesNotMatch(
    src,
    /NEXT_PUBLIC_CLERK_SIGN_IN_URL/,
    "an env var is invisible at the call site and drifts per environment — " +
      "which is how the hosted portal reached production unnoticed",
  );
});

test("no Nexus code routes anyone to the hosted Account Portal", async () => {
  for (const src of [codeOnly(await MIDDLEWARE()), codeOnly(await PROVIDER())]) {
    assert.doesNotMatch(src, /accounts\.thedps\.co/);
  }
});

// ── sign-out -> Nexus splash ──────────────────────────────────────────────

test("the provider sets both routing props, for different reasons", async () => {
  const src = codeOnly(await PROVIDER());
  assert.match(src, /<ClerkProvider[\s\S]*?signInUrl="\/sign-in"/);
  assert.match(src, /<ClerkProvider[\s\S]*?afterSignOutUrl="\/sign-in"/);
});

test("the sign-out button override is REQUIRED by the installed runtime", async () => {
  // Not a preference, and not kept because it typechecks. @clerk/clerk-react
  // destructures `const { redirectUrl = "/" } = props` and always forwards it
  // to clerk.signOut() — so the button SHADOWS the provider's afterSignOutUrl
  // with its own default rather than deferring to it.
  //
  // Asserted against the runtime itself so that if a future Clerk version makes
  // the button defer, this fails and the duplicate can be removed on evidence.
  const runtime = await SIGN_OUT_RUNTIME();
  assert.match(
    runtime,
    /const \{ redirectUrl = "\/", signOutOptions, \.\.\.rest \} = props/,
    "installed SignOutButton no longer defaults redirectUrl — re-evaluate " +
      "whether the app-side override is still needed",
  );
  const src = codeOnly(await PROVIDER());
  assert.match(src, /<SignOutButton redirectUrl="\/sign-in">/);
});

// ── the paths that must keep working ──────────────────────────────────────

test("the unauthorized-email branch still reaches /sign-in?error=unauthorized", async () => {
  const src = codeOnly(await MIDDLEWARE());
  assert.match(src, /new URL\(SIGN_IN_URL, req\.url\)/);
  assert.match(src, /url\.searchParams\.set\("error", "unauthorized"\)/);
  assert.match(src, /NextResponse\.redirect\(url\)/);
});

test("/sso-callback and /sign-in remain public — no redirect loop", async () => {
  const src = codeOnly(await MIDDLEWARE());
  const matcher = src.slice(src.indexOf("createRouteMatcher("), src.indexOf("]);"));
  // /sign-in public is what stops middleware bouncing its own destination.
  assert.match(matcher, /"\/sign-in\(\.\*\)"/, "the sign-in route must be public");
  // /sso-callback public is what stops the SSO return leg being redirected
  // before the session it is creating exists.
  assert.match(matcher, /"\/sso-callback\(\.\*\)"/);
});

test("the public-route check runs before the session check", async () => {
  const src = codeOnly(await MIDDLEWARE());
  const pub = src.indexOf("if (isPublicRoute(req)) return;");
  const redirect = src.indexOf("redirectToSignIn()");
  assert.ok(pub > 0 && redirect > 0);
  assert.ok(
    pub < redirect,
    "reversed, /sign-in would redirect to itself — an infinite loop presenting " +
      "as a broken identity provider",
  );
});
