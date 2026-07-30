import { assertRuntimeSafety } from "../../src/lib/config/runtime-config";

export default async function globalTeardown() {
  // Re-run the proof so teardown never evolves into an unguarded destructive
  // hook. Actual database/artifact teardown is owned by the guarded CLI.
  assertRuntimeSafety();
}
