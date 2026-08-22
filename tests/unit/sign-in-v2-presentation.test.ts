import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

const PAGE = () => read("src/app/sign-in/[[...sign-in]]/page.tsx");
const LOOP = () => read("src/components/auth/hero-loop.tsx");
const CTA = () => read("src/components/auth/continue-with-dps.tsx");

// ═══════════════════════════════════════════════════════════════════════
// SIGN-IN v2 IS A PRESENTATION SLICE
//
// The authentication path is already certified. The risk in a cosmetic rewrite
// of the page that hosts it is not that the visuals are wrong — it is that the
// auth call is edited in passing, or that a media feature quietly changes what
// the page does. So the first assertions here are about what did NOT change.
// ═══════════════════════════════════════════════════════════════════════

// ── the certified auth path is untouched ─────────────────────────────────

test("the SSO call keeps every certified parameter", async () => {
  const src = codeOnly(await CTA());
  assert.match(src, /authenticateWithRedirect\(/);
  assert.match(src, /strategy: "enterprise_sso"/);
  assert.match(src, /oidcPrompt: "select_account"/);
  assert.match(src, /sso-callback/);
});

test("the page hosts exactly one sign-in action", async () => {
  // One CTA is a certified property, not a layout preference: a second entry
  // point would be a second auth path nobody certified.
  const src = codeOnly(await PAGE());
  const mounts = src.match(/<ContinueWithDps/g) ?? [];
  assert.equal(mounts.length, 1);
});

test("the presentation slice introduces no auth surface of its own", async () => {
  for (const f of [
    "src/components/auth/hero-loop.tsx",
    "src/components/auth/nexus-mark.tsx",
  ]) {
    const src = codeOnly(await read(f));
    for (const forbidden of [
      /signIn/,
      /useAuth/,
      /clerk/i,
      /authenticateWithRedirect/,
      /redirectUrl/,
    ]) {
      assert.doesNotMatch(src, forbidden, `${f} reaches into auth`);
    }
  }
});

// ── the media rules that are correctness, not taste ──────────────────────

test("muted is forced as a PROPERTY, not left to the attribute", async () => {
  // React drops the `muted` attribute during hydration, so a video muted in the
  // server HTML can arrive unmuted in the DOM. The failure mode is audible.
  const src = codeOnly(await LOOP());
  assert.match(src, /v\.muted = true;/);
  assert.match(src, /v\.volume = 0;/);
  assert.match(src, /v\.setAttribute\("muted", ""\)/);
});

test("no video element exists below the panel breakpoint", async () => {
  // A hidden <video> still fetches and decodes. The gate must be on the
  // ELEMENTS, not on visibility, or a phone pays for an asset it cannot see.
  const src = codeOnly(await LOOP());
  assert.match(src, /PANEL_MIN_WIDTH = 860/);
  assert.match(src, /window\.innerWidth >= PANEL_MIN_WIDTH/);
  assert.match(src, /if \(!enabled\) \{/, "the early return must precede any <video>");
  const earlyReturn = src.indexOf("if (!enabled) {");
  const firstVideo = src.indexOf("<video");
  assert.ok(earlyReturn > -1 && earlyReturn < firstVideo, "videos render after the gate");
});

test("reduced motion removes the videos rather than pausing them", async () => {
  const src = codeOnly(await LOOP());
  assert.match(src, /prefers-reduced-motion: reduce/);
  // The same gate as the breakpoint, so reduced motion yields the poster and
  // nothing that could begin playing.
  assert.match(src, /motionOk && window\.innerWidth >= PANEL_MIN_WIDTH/);
});

test("the crossfade constants match the handoff", async () => {
  const src = codeOnly(await LOOP());
  assert.match(src, /FADE_SECONDS = 0\.9/);
  assert.match(src, /FRONT_OPACITY = 0\.9/);
  assert.match(src, /duration - v\.currentTime <= FADE_SECONDS/);
});

test("the video is decorative and out of the tab order", async () => {
  const src = codeOnly(await LOOP());
  const videoCount = (src.match(/<video/g) ?? []).length;
  assert.equal(videoCount, 2, "two copies, for the crossfade");
  assert.equal((src.match(/aria-hidden/g) ?? []).length >= 2, true);
  assert.equal((src.match(/tabIndex=\{-1\}/g) ?? []).length, 2);
});

// ── the scrim is directional, and that is load-bearing ───────────────────

test("the scrim keeps its gradient rather than becoming a flat overlay", async () => {
  // Near-opaque behind the copy, 10% at the right edge. Flattened, it either
  // washes out the render or puts the headline on an unpredictable ground.
  const src = codeOnly(await PAGE());
  assert.match(src, /linear-gradient\(100deg/);
  for (const stop of ["0.94) 0%", "0.80) 34%", "0.30) 62%", "0.10) 100%"]) {
    assert.ok(src.includes(stop), `scrim lost its ${stop} stop`);
  }
});

test("grid and glow were dimmed for the video", async () => {
  const src = codeOnly(await PAGE());
  assert.match(src, /0\.035\) 1px/, "grid should be 0.035");
  assert.doesNotMatch(src, /0\.045\) 1px/, "grid still at the pre-video value");
  assert.match(src, /255 \/ 0\.14\), transparent 62%/, "glow should be 0.14");
});

// ── exactly two mark placements ──────────────────────────────────────────

test("the mark appears in exactly two places, at the handoff's sizes", async () => {
  const src = codeOnly(await PAGE());
  const marks = src.match(/<NexusMark size=\{(\d+)\}/g) ?? [];
  assert.equal(marks.length, 2, "no other logo lockups");
  assert.ok(src.includes("<NexusMark size={30}"), "30px beside the wordmark");
  assert.ok(src.includes("<NexusMark size={32}"), "32px in the tile");
  assert.match(src, /borderRadius: 13/);
  assert.match(src, /width: 52,\s*\n\s*height: 52,/);
});

test("the mark inherits colour instead of shipping two coloured copies", async () => {
  const src = codeOnly(await read("src/components/auth/nexus-mark.tsx"));
  assert.match(src, /stroke="currentColor"/);
  assert.match(src, /fill="currentColor"/);
  assert.doesNotMatch(src, /url\(#/, "gradient fills do not resolve through <use>");
});

// ── assets present and within budget ─────────────────────────────────────

test("the media the page references actually exists, and is small enough", async () => {
  const video = await stat(new URL("../../public/media/nexus-hero-loop.mp4", import.meta.url));
  const poster = await stat(new URL("../../public/media/nexus-hero-poster.jpg", import.meta.url));
  assert.ok(video.size < 3 * 1024 * 1024, `video is ${(video.size / 1048576).toFixed(2)}MB, over the 3MB target`);
  assert.ok(poster.size > 0);
  await stat(new URL("../../public/brand/dps-secondary-white.png", import.meta.url));
});

test("the DPS lockup is used, not the text it replaced", async () => {
  const src = codeOnly(await PAGE());
  assert.match(src, /brand\/dps-secondary-white\.png/);
  assert.match(src, /alt="The DPS"/);
});

// ═══════════════════════════════════════════════════════════════════════
// THE MIDDLEWARE EXCEPTION
//
// `mp4|webm` were added to the static-asset extension bypass so the hero video
// is served instead of answered with a 307 to /sign-in. That is an asset
// CLASSIFICATION change, and these tests exist to keep it one — the failure
// mode of a bypass list is that it quietly grows into a hole.
//
// Live behaviour is proven separately by `scripts/verify/middleware-bypass.ts`,
// which probes a running server. These assert the shape that makes the live
// result hold, and are the half that survives into CI.
// ═══════════════════════════════════════════════════════════════════════

const MIDDLEWARE = () => read("src/middleware.ts");

/** The extension alternation, extracted once so every test reads the same thing. */
async function extensionGroup(): Promise<string[]> {
  const src = await MIDDLEWARE();
  // Anchored on the alternation's real terminator. A lazy `[^)]+` stops at the
  // first `)` - which is inside `js(?!on)` - and silently returns three of the
  // fourteen extensions, so every assertion below would pass or fail for the
  // wrong reason. Found while writing these: the first version did exactly that.
  const OPEN = "(?:";
  const open = src.indexOf(OPEN, src.indexOf("matcher:"));
  const close = src.indexOf(")).*)", open);
  assert.ok(open > -1 && close > open, "could not find the extension alternation");
  return src.slice(open + OPEN.length, close).split("|");
}


test("mp4 and webm are classified as assets, beside the ones already there", async () => {
  const exts = await extensionGroup();
  assert.ok(exts.includes("mp4"));
  assert.ok(exts.includes("webm"));
  // The company they keep is the argument: these are the same KIND of thing.
  for (const kept of ["png", "svg", "woff2?", "webp", "ico"]) {
    assert.ok(exts.includes(kept), `${kept} should still be an asset`);
  }
});

test("the bypass admits extensions only — never a path", async () => {
  // The hole this forecloses: a token containing `/` or a wildcard would stop
  // being an extension and start being a route exemption.
  for (const ext of await extensionGroup()) {
    assert.doesNotMatch(ext, /[/*+{}[\]]/, `"${ext}" is not an extension`);
    assert.match(ext, /^[a-z0-9?():!.|\-]+$/i, `"${ext}" is not extension-shaped`);
  }
});

test("API routes are matched regardless of extension", async () => {
  // The second matcher entry is what stops `/api/anything.mp4` from inheriting
  // the asset bypass. Without it the exception WOULD be an authorization change.
  const src = codeOnly(await MIDDLEWARE());
  assert.match(src, /"\/\(api\|trpc\)\(\.\*\)"/);
});

test("no route is exempted by path, and the handler is unchanged", async () => {
  const src = codeOnly(await MIDDLEWARE());
  // Exactly two matcher entries — the asset-excluding catch-all and the API one.
  const entries = src.slice(src.indexOf("matcher:")).match(/"/g) ?? [];
  assert.equal(entries.length, 4, "a third matcher entry appeared");
  // /sign-in and /sso-callback are NOT special-cased here: they are public by
  // the composition's own rules, and adding them to the matcher config would
  // move that decision somewhere it can drift from the composition.
  assert.doesNotMatch(src, /sign-in/);
  assert.doesNotMatch(src, /sso-callback/);
  assert.match(src, /composedMiddleware/, "the handler must be untouched");
});

test("protected pages carry their own guard, so the bypass is not the only boundary", async () => {
  // Defense in depth, and the reason an extension-shaped URL cannot reach data:
  // the page itself establishes identity. Verified rather than assumed, because
  // it is what makes the bypass safe.
  for (const [f, guard] of [
    ["src/app/admin/users/page.tsx", /requireAdminPage\(\)/],
    ["src/app/orders/[snapshotId]/documents/page.tsx", /ensureUser\(\)/],
  ] as const) {
    const src = codeOnly(await read(f));
    assert.match(src, guard, `${f} does not establish identity itself`);
  }
});
