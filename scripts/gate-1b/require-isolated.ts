/**
 * Refuse to run outside the isolated validation runtime.
 *
 * ── WHY THIS IS A SIDE-EFFECT IMPORT, AND WHY IT MUST BE FIRST ────────────
 *
 * The check scripts that import this call REAL actions: `saveCustomerMapping`
 * writes a customer mapping, `sendQuote` allocates a quote number and publishes
 * a document. Those are correct against the throwaway validation database and
 * unacceptable anywhere else, and nothing about how a script is LAUNCHED makes
 * that distinction enforceable -- an env file can be omitted, a shell can carry
 * yesterday's exports, and `--env-file` does not override an already-set
 * variable. The permitted environment has to be asserted, not inferred.
 *
 * ESM evaluates a module's dependencies in the order their imports are
 * declared, so `import "./require-isolated.ts";` written FIRST runs before
 * `@/db` is evaluated -- which matters, because evaluating `@/db` opens a
 * connection pool. Refusing after that point would already have connected to
 * whatever `DATABASE_URL` names.
 *
 * Placing this import anywhere but first is a silent downgrade: the guard
 * still throws, but only after the thing it exists to prevent has begun.
 */
import {
  assertRuntimeSafety,
  PROVIDER_KIND_ENV,
  VALIDATION_DATABASE_MARKER,
} from "@/lib/config/runtime-config";

function refuse(detail: string): never {
  throw new Error(
    `[gate-1b] refusing to run outside the isolated validation runtime.\n` +
      `  ${detail}\n` +
      `  These checks invoke real mapping and publication actions. Run them with\n` +
      `  --env-file=.env.validation.local against the containerised validation\n` +
      `  database, never against a shared or production environment.`,
  );
}

const safety = assertRuntimeSafety();

if (safety.mode !== "isolated") {
  refuse(
    `runtime mode is "${safety.mode}" — the isolated marker is absent or off.`,
  );
}

// Every provider, not merely the one a given check happens to touch. A script
// that only reads NetSuite today can grow a HubSpot write tomorrow, and the
// guard should not have to be revisited for that to stay safe.
for (const name of Object.keys(PROVIDER_KIND_ENV) as Array<
  keyof typeof PROVIDER_KIND_ENV
>) {
  if (safety.providers[name] !== "isolated") {
    refuse(
      `provider "${name}" is "${safety.providers[name]}" (${PROVIDER_KIND_ENV[name]}).`,
    );
  }
}

// `assertRuntimeSafety` already enforces this in isolated mode. Restated so a
// refusal names the database, which is what a reader needs in order to see
// what was about to be written to.
if (!safety.database?.name.includes(VALIDATION_DATABASE_MARKER)) {
  refuse(
    `database "${safety.database?.name ?? "<unknown>"}" does not carry the ` +
      `"${VALIDATION_DATABASE_MARKER}" marker.`,
  );
}

console.log(
  `[gate-1b] isolated runtime confirmed · db=${safety.database.name} · providers=${Object.values(
    safety.providers,
  ).join(",")}`,
);
