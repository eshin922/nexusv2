/**
 * Publication-claim concurrency proof — REAL overlap, REAL row locks.
 *
 * ── WHY NOT A UNIT TEST ─────────────────────────────────────────────────
 *
 * The property under test is that PostgreSQL serialises two `UPDATE`s racing
 * for one row. A mock cannot demonstrate that; it can only demonstrate that
 * the mock was written to agree. A sequential double-click cannot either,
 * because the second call starts after the first has finished and never
 * overlaps the window that matters. So this runs two genuinely concurrent
 * connections and lets the database decide.
 *
 * ── WHY A SCRATCH SCHEMA ────────────────────────────────────────────────
 *
 * The real `quotes` table holds live commercial records, and a concurrency
 * probe must be free to create, claim and abandon rows. It therefore builds a
 * throwaway schema containing only the columns the claim touches, plus its own
 * `quote_number_seq`, and points each connection's `search_path` at it. The
 * SQL under test is unmodified: `claimPublication` and
 * `releasePublicationClaim` are imported from the application, not restated
 * here, so what is proven is the shipped statement and not a copy of it.
 *
 * The schema is dropped in a `finally`. The governed `public.quote_number_seq`
 * is never reached.
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import * as schema from "@/db/schema";

import {
  claimPublication,
  releasePublicationClaim,
  PUBLICATION_CLAIM_LEASE_SECONDS,
} from "@/lib/publication-claim";

const SCHEMA = `claim_probe_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!URL) throw new Error("no database URL");

const clients: postgres.Sql[] = [];
function connect() {
  const c = postgres(URL!, {
    max: 1,
    prepare: false,
    connection: { search_path: `${SCHEMA},public` },
  });
  clients.push(c);
  // WITH THE SCHEMA. A bare `drizzle(c)` types as an empty-schema database and
  // will not satisfy the application's own executor type — which is the point
  // of passing these into the shipped functions rather than reimplementing them.
  return drizzle(c, { schema });
}

const admin = postgres(URL, { max: 1, prepare: false });
clients.push(admin);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

try {
  await admin.unsafe(`CREATE SCHEMA ${SCHEMA}`);
  await admin.unsafe(`CREATE SEQUENCE ${SCHEMA}.quote_number_seq START 5000`);
  await admin.unsafe(`
    CREATE TABLE ${SCHEMA}.quotes (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      quote_number text,
      publication_claim_token text,
      publication_claimed_at timestamptz
    )`);

  const a = connect();
  const b = connect();

  const newQuote = async (init: {
    status?: string;
    quoteNumber?: string | null;
    token?: string | null;
    claimedAt?: string | null;
  } = {}) => {
    const id = randomUUID();
    await admin.unsafe(
      `INSERT INTO ${SCHEMA}.quotes
         (id, status, quote_number, publication_claim_token, publication_claimed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        init.status ?? "draft",
        init.quoteNumber ?? null,
        init.token ?? null,
        init.claimedAt ?? null,
      ] as never,
    );
    return id;
  };

  const row = async (id: string) =>
    (
      await admin.unsafe(
        `SELECT quote_number, publication_claim_token, publication_claimed_at, status
           FROM ${SCHEMA}.quotes WHERE id = $1`,
        [id] as never,
      )
    )[0] as unknown as {
      quote_number: string | null;
      publication_claim_token: string | null;
      publication_claimed_at: Date | null;
      status: string;
    };

  const seq = async () =>
    Number(
      (
        (await admin.unsafe(
          `SELECT last_value, is_called FROM ${SCHEMA}.quote_number_seq`,
        )) as unknown as Array<{ last_value: string; is_called: boolean }>
      )[0].last_value,
    );

  // ── 1 · TWO OVERLAPPING FINALIZES ──────────────────────────────────────
  console.log("\n1 · two Finalize calls overlapping on one draft");
  {
    const id = await newQuote();
    const seqBefore = await seq();

    // Fired together, resolved together. Neither waits for the other to
    // finish, so both are inside the claim window at the same time.
    const [r1, r2] = await Promise.all([
      claimPublication(a, { quoteId: id, quoteNumberPrefix: "PRB" }),
      claimPublication(b, { quoteId: id, quoteNumberPrefix: "PRB" }),
    ]);

    const winners = [r1, r2].filter((r) => r.kind === "acquired");
    const losers = [r1, r2].filter((r) => r.kind !== "acquired");
    check("exactly one claim owner", winners.length === 1, `${winners.length} acquired`);
    check("the loser is told it is held", losers.length === 1 && losers[0].kind === "held",
      losers.map((l) => l.kind).join(","));

    const after = await row(id);
    // ASSIGNED, not consumed. The sequence delta is NOT the property: a losing
    // claimant may evaluate `nextval` in its SET expression before its WHERE
    // fails, and PostgreSQL does not roll that back — so the sequence can
    // advance by two while exactly one number is assigned. That is a gap, and
    // gaps are accepted; two numbers on one quote would not be. Asserting the
    // delta made this control flaky in exactly the direction that hid what it
    // was for.
    check(
      "exactly one quote number is ASSIGNED",
      after.quote_number !== null &&
        winners[0].kind === "acquired" &&
        after.quote_number === winners[0].quoteNumber,
      `stored ${after.quote_number}`,
    );
    console.log(
      `        (sequence ${seqBefore} → ${await seq()}; a losing claimant may ` +
        `consume a value without receiving one — gaps are accepted)`,
    );
    check(
      "the stored claim belongs to the winner",
      winners[0].kind === "acquired" && after.publication_claim_token === winners[0].token,
    );
    check(
      "the stored number is the winner's",
      winners[0].kind === "acquired" && after.quote_number === winners[0].quoteNumber,
      `${after.quote_number}`,
    );
  }

  // ── 2 · THE LOSER CANNOT CLEAR THE WINNER'S CLAIM ──────────────────────
  console.log("\n2 · a loser cannot release a claim it does not own");
  {
    const id = await newQuote();
    const win = await claimPublication(a, { quoteId: id, quoteNumberPrefix: "PRB" });
    if (win.kind !== "acquired") throw new Error("setup: expected to acquire");

    // A loser holds no token. The nearest thing it could do is guess one.
    await releasePublicationClaim(b, { quoteId: id, token: randomUUID() });
    const after = await row(id);
    check("the winner's claim survives a foreign release",
      after.publication_claim_token === win.token);
  }

  // ── 3 · A LATE FINISHER CANNOT CLEAR A NEWER CLAIM ─────────────────────
  console.log("\n3 · stale-owner cleanup cannot clear a subsequently acquired claim");
  {
    const id = await newQuote();
    const first = await claimPublication(a, { quoteId: id, quoteNumberPrefix: "PRB" });
    if (first.kind !== "acquired") throw new Error("setup");

    // The first publisher's claim ages out and a second legitimately takes it.
    await admin.unsafe(
      `UPDATE ${SCHEMA}.quotes
          SET publication_claimed_at = now() - make_interval(secs => $2)
        WHERE id = $1`,
      [id, PUBLICATION_CLAIM_LEASE_SECONDS + 60] as never,
    );
    const second = await claimPublication(b, { quoteId: id, quoteNumberPrefix: "PRB" });
    check("an expired claim can be taken over", second.kind === "acquired", second.kind);

    // NOW the first publisher finally fails and runs its release.
    await releasePublicationClaim(a, { quoteId: id, token: first.token });
    const after = await row(id);
    check(
      "the late finisher did not clear the newer claim",
      second.kind === "acquired" && after.publication_claim_token === second.token,
    );
    check(
      "and no second number was minted for the takeover",
      after.quote_number === first.quoteNumber,
      `${after.quote_number}`,
    );
  }

  // ── 4 · RETRY AFTER A FAILED PUBLICATION ───────────────────────────────
  console.log("\n4 · retry after a controlled failure reuses the number");
  {
    const id = await newQuote();
    const first = await claimPublication(a, { quoteId: id, quoteNumberPrefix: "PRB" });
    if (first.kind !== "acquired") throw new Error("setup");
    const seqAfterFirst = await seq();

    // The publication fails; sendQuote's catch releases this caller's claim.
    await releasePublicationClaim(a, { quoteId: id, token: first.token });
    const between = await row(id);
    check("the claim is released", between.publication_claim_token === null);
    check("the number is RETAINED", between.quote_number === first.quoteNumber);
    check("and the quote is still a draft", between.status === "draft");

    // The operator retries immediately — no lease wait.
    const retry = await claimPublication(a, { quoteId: id, quoteNumberPrefix: "PRB" });
    check("retry reacquires immediately", retry.kind === "acquired", retry.kind);
    check(
      "retry reuses the same number",
      retry.kind === "acquired" && retry.quoteNumber === first.quoteNumber,
    );
    check("nextval was NOT invoked again", (await seq()) === seqAfterFirst,
      `seq ${seqAfterFirst} → ${await seq()}`);
  }

  // ── 5 · REVISE-IN-PLACE ────────────────────────────────────────────────
  console.log("\n5 · revise-in-place returns to draft and republishes on its number");
  {
    const id = await newQuote({ quoteNumber: "PRB-4242", status: "draft" });
    const seqBefore = await seq();
    const again = await claimPublication(a, { quoteId: id, quoteNumberPrefix: "PRB" });
    check("a numbered, unclaimed draft can be published", again.kind === "acquired", again.kind);
    check(
      "on its governed number",
      again.kind === "acquired" && again.quoteNumber === "PRB-4242",
    );
    check("without touching the sequence", (await seq()) === seqBefore);
  }

  // ── 6 · A PUBLISHED QUOTE IS NOT PUBLISHABLE ───────────────────────────
  console.log("\n6 · a sent quote refuses a claim, and says why");
  {
    const id = await newQuote({ status: "sent", quoteNumber: "PRB-9" });
    const r = await claimPublication(a, { quoteId: id, quoteNumberPrefix: "PRB" });
    check("refused as not publishable", r.kind === "not_publishable", r.kind);
    check("distinct from 'held'", r.kind !== "held");
  }

  // ── 7 · SUCCESS LEAVES NO CLAIM ────────────────────────────────────────
  console.log("\n7 · a successful publication leaves the claim NULL");
  {
    const id = await newQuote();
    const win = await claimPublication(a, { quoteId: id, quoteNumberPrefix: "PRB" });
    if (win.kind !== "acquired") throw new Error("setup");
    // What sendQuote's transaction does on success.
    await a.execute(
      sql.raw(`UPDATE quotes SET status = 'sent',
                 publication_claim_token = NULL, publication_claimed_at = NULL
                WHERE id = '${id}'`),
    );
    const after = await row(id);
    check("claim token cleared", after.publication_claim_token === null);
    check("claimed-at cleared", after.publication_claimed_at === null);
    check("number retained", after.quote_number === win.quoteNumber);
  }

  console.log(
    `\n${failures === 0 ? "ALL PROPERTIES HOLD" : `${failures} PROPERT${failures === 1 ? "Y" : "IES"} FAILED`}`,
  );
} finally {
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await Promise.all(clients.map((c) => c.end({ timeout: 5 })));
}

process.exit(failures === 0 ? 0 : 1);
