// A Slack link points at production, wherever the sender was running.
//
// This failed silently in production, which is why it is pinned. Two
// freight-handoff notifications reached the logistics channel carrying
// `http://localhost:3000` links, because the delivery ran from a machine whose
// `.env.local` sets `NEXT_PUBLIC_APP_URL` to localhost. Nothing errored: the
// message arrived, read correctly, and its button went nowhere. The env var
// did exactly what it was configured to do.
//
// The origin is a property of the DESTINATION — a real person in the firm's
// workspace, who has to go to the real app — not of whatever environment
// happened to compose the message.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * The file with its comments removed.
 *
 * The first version of this test matched raw text and failed on the comment
 * that EXPLAINS the fix, which names both the banned variable and localhost.
 * An instrument that cannot tell prose from code would have forced the
 * explanation out of the file to stay green — so it strips the prose instead.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const SENDERS = [
  "src/lib/slack/deliver-freight-handoff.ts",
  "src/lib/slack/deliver-approval.ts",
];

test("the link origin is not read from the environment", () => {
  for (const file of SENDERS) {
    const src = code(file);
    for (const banned of ["NEXT_PUBLIC_APP_URL", "VERCEL_URL"]) {
      assert.doesNotMatch(
        src,
        new RegExp(banned),
        `${file} derives its Slack link from ${banned}, so the link depends on where the sender ran`,
      );
    }
    assert.doesNotMatch(
      src,
      /localhost/,
      `${file} can compose a localhost link into a message sent to the firm's workspace`,
    );
  }
});

test("both senders compose links through the one helper", () => {
  for (const file of SENDERS) {
    assert.match(
      read(file),
      /from "\.\/app-url"/,
      `${file} builds its own link origin instead of using the shared one`,
    );
  }
});

test("the helper yields an absolute production URL", async () => {
  const { slackLink } = await import("../../src/lib/slack/app-url.ts");

  assert.equal(
    slackLink("/projects/p1/quotes/q1/costs"),
    "https://nexus.thedps.co/projects/p1/quotes/q1/costs",
  );
  // A caller that forgets the leading slash must not produce
  // `https://nexus.thedps.coprojects/...`, which is a different host.
  assert.equal(slackLink("projects/p1"), "https://nexus.thedps.co/projects/p1");
  assert.match(slackLink("/x"), /^https:\/\//, "a Slack link must be absolute and https");
});

test("and ignores the environment even when it is set", async () => {
  // The precise circumstance that produced the defect: an environment that
  // names a different origin. The helper must be unmoved by it, so this sets
  // the variable rather than trusting that nothing reads it.
  const prior = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  try {
    const { slackLink } = await import("../../src/lib/slack/app-url.ts");
    assert.equal(
      slackLink("/projects/p1/quotes/q1/costs"),
      "https://nexus.thedps.co/projects/p1/quotes/q1/costs",
    );
  } finally {
    if (prior === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prior;
  }
});
