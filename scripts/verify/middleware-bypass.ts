/**
 * The static-asset bypass, probed against a running server. READ-ONLY.
 *
 * `mp4|webm` were added to the middleware's extension exclusion so the sign-in
 * hero video is served rather than answered with a 307 to /sign-in. That is an
 * asset-classification change, and the way such a change goes wrong is by
 * quietly becoming a route exemption.
 *
 * The unit tests assert the matcher's SHAPE. This asserts what a server
 * actually does with it, which is a different claim and the one that matters.
 *
 * Usage:  node … middleware-bypass.ts [baseUrl]     (default http://localhost:3000)
 */

const BASE = process.argv[2] ?? "http://localhost:3000";

type Row = { name: string; got: string; want: string };
const results: Row[] = [];
const rec = (name: string, got: unknown, want: unknown) =>
  results.push({ name, got: String(got), want: String(want) });

async function status(path: string): Promise<number> {
  const res = await fetch(BASE + path, { redirect: "manual" });
  return res.status;
}

async function main() {
  // ── CONTROL ────────────────────────────────────────────────────────────
  // A protected route MUST redirect. Without this, every "asset served" below
  // could equally mean the middleware is not running at all — which is exactly
  // what a broken matcher looks like, and it would read as success.
  const control = await status("/admin/users");
  rec("CONTROL · a protected route redirects", control, 307);
  if (control !== 307) {
    report();
    return;
  }

  // ── 1 · the media is served as an asset ────────────────────────────────
  rec("hero video bypasses auth", await status("/media/nexus-hero-loop.mp4"), 200);
  rec("poster bypasses auth", await status("/media/nexus-hero-poster.jpg"), 200);

  // ── 2 · application routes still require auth ──────────────────────────
  for (const path of ["/", "/admin", "/projects"]) {
    rec(`protected · ${path}`, await status(path), 307);
  }

  // ── 3 · an extension-shaped route cannot reach data ────────────────────
  //
  // These DO bypass the middleware — that is what an extension-based matcher
  // means, and it was true of `.png` long before `.mp4` joined the list. What
  // matters is that they cannot RENDER: Clerk refuses when `auth()` is called
  // without `clerkMiddleware()` having run, so the route errors instead of
  // serving. Fail-closed, and asserted rather than assumed.
  //
  // 404 is equally acceptable — it means no route matched at all.
  for (const path of ["/admin/users.mp4", "/admin.png", "/projects/x.webm"]) {
    const s = await status(path);
    rec(`extension-shaped · ${path} does not serve`, s === 500 || s === 404, true);
  }

  // The API matcher is the reason this is not an authorization change: it
  // catches /api regardless of extension.
  rec("API is matched despite the extension", await status("/api/quotes.mp4"), 307);

  // ── 4 · the auth entry points are unchanged ────────────────────────────
  rec("/sign-in still public", await status("/sign-in"), 200);
  rec("/sso-callback still public", await status("/sso-callback"), 200);

  report();
}

function report() {
  console.log(`\nMIDDLEWARE STATIC-ASSET BYPASS — ${BASE}\n`);
  let failed = 0;
  for (const r of results) {
    const ok = r.got === r.want;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${r.name.padEnd(52)} ${ok ? r.got : `got ${r.got}, want ${r.want}`}`,
    );
  }
  console.log(
    `\n${failed === 0 ? "The bypass classifies assets and exempts no route." : `${failed} failure(s).`}`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
