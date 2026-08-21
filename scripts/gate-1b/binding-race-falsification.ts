/**
 * #327 — LIVE proof of the binding's refusal paths. Every write ROLLED BACK.
 *
 * The source-level tests assert the refusals are written. These assert they
 * REFUSE, by running `bindPendingUser` against a real database with real rows
 * and real constraints. A refusal that has never been observed refusing is a
 * claim about code, not about behaviour.
 *
 * The whole scenario runs inside one transaction that always rolls back, so
 * nothing persists — including the pending rows it fabricates.
 *
 * THE CENTRAL QUESTION: after a row has been observed owning the address, can
 * ANY path still return `no_pending_row`? That outcome sends the caller off to
 * provision a second record for a person who demonstrably has one.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { bindPendingUser } from "@/lib/auth/pending-binding";

const DOMAIN = "@thedps.co";
const A = "user_race_falsify_A";
const B = "user_race_falsify_B";

type Result = { name: string; got: string; want: string; ok: boolean };

async function main() {
  const results: Result[] = [];
  const record = (name: string, got: string, want: string) =>
    results.push({ name, got, want, ok: got === want });

  try {
    await db.transaction(async (tx) => {
      const mk = async (local: string) => {
        const [row] = await tx
          .insert(users)
          .values({
            email: `${local}${DOMAIN}`,
            name: local,
            role: "logistics",
            clerkUserId: null,
            bindingState: "pending_first_sign_in" as const,
          })
          .returning();
        return row;
      };

      // ── 1 · the happy path, so the harness can express success ──────────
      const one = await mk("race-falsify-one");
      const bound = await bindPendingUser(
        { clerkUserId: A, email: one.email },
        tx,
      );
      record("CONTROL — pending row binds", bound.kind, "bound");
      if (bound.kind === "bound") {
        record("CONTROL — durable id unchanged", bound.user.id, one.id);
        record("CONTROL — role preserved", bound.user.role, "logistics");
        record(
          "CONTROL — commercial_approver untouched",
          String(bound.user.commercialApprover),
          "false",
        );
      }

      // ── 2 · THE CORRECTION: the row is now bound to A. A DIFFERENT
      //        identity presenting the same address must REFUSE, never
      //        fall through to provisioning.
      const second = await bindPendingUser(
        { clerkUserId: B, email: one.email },
        tx,
      );
      record(
        "a second identity for a bound address refuses",
        second.kind === "refused" ? second.refusal.code : second.kind,
        "email_already_bound",
      );

      // ── 3 · the same identity again resolves without re-binding ─────────
      const again = await bindPendingUser(
        { clerkUserId: A, email: one.email },
        tx,
      );
      record(
        "an already-bound identity refuses rather than re-binding",
        again.kind === "refused" ? again.refusal.code : again.kind,
        "clerk_id_already_bound",
      );

      // ── 4 · a row claimed by ANOTHER identity between observation and
      //        write. Simulated by binding a pending row to B and then
      //        asking to bind it to A — the state change the race handler
      //        must classify as a refusal, not as "nobody is provisioned".
      const two = await mk("race-falsify-two");
      await tx
        .update(users)
        .set({ clerkUserId: B, bindingState: "bound" })
        .where(eq(users.id, two.id));
      const claimed = await bindPendingUser(
        { clerkUserId: "user_race_falsify_C", email: two.email },
        tx,
      );
      record(
        "a row claimed by another identity refuses",
        claimed.kind === "refused" ? claimed.refusal.code : claimed.kind,
        "email_already_bound",
      );

      // ── 5 · a genuinely unknown address DOES fall through ───────────────
      //        The one permitted fall-through. Without this the suite could
      //        pass by refusing everything.
      const unknown = await bindPendingUser(
        { clerkUserId: "user_race_falsify_D", email: `nobody-here${DOMAIN}` },
        tx,
      );
      record("an unrostered address falls through", unknown.kind, "no_pending_row");

      // ── 6 · a non-corporate identity refuses before touching the DB ─────
      const foreign = await bindPendingUser(
        { clerkUserId: "user_race_falsify_E", email: "contractor@example.com" },
        tx,
      );
      record(
        "a non-corporate identity refuses",
        foreign.kind === "refused" ? foreign.refusal.code : foreign.kind,
        "non_corporate_identity",
      );

      throw new Error("__rollback__");
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== "__rollback__") {
      console.error("HARNESS FAILED:", msg);
      process.exit(1);
    }
  }

  console.log("BINDING REFUSAL PATHS — live, rolled back\n");
  for (const r of results) {
    console.log(
      `  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(52)} ${r.ok ? r.got : `got ${r.got}, want ${r.want}`}`,
    );
  }

  const residue = (await db.execute(
    sql.raw(`select count(*)::int n from public.users where email like '%race-falsify%'`),
  )) as unknown as Array<{ n: number }>;
  const total = (await db.execute(
    sql.raw(`select count(*)::int n from public.users`),
  )) as unknown as Array<{ n: number }>;
  console.log(`\nresidue rows: ${residue[0].n}   total users: ${total[0].n}`);

  const failed = results.filter((r) => !r.ok).length;
  const fellThrough = results.some(
    (r) => r.name.includes("bound address") && r.got === "no_pending_row",
  );
  console.log(
    `\nVERDICT: ${
      failed === 0 && residue[0].n === 0
        ? "every refusal observed refusing, the one permitted fall-through observed falling through, nothing persisted."
        : `${failed} failure(s)${fellThrough ? " INCLUDING A FALL-THROUGH TO PROVISIONING" : ""}.`
    }`,
  );
  process.exit(failed === 0 && residue[0].n === 0 ? 0 : 1);
}

void main();
