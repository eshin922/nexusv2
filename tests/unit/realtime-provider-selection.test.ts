import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mountsProductionRealtime } from "../../src/lib/integrations/realtime-provider-selection.ts";

test("isolated composition does not mount the production Supabase realtime client", () => {
  assert.equal(mountsProductionRealtime("isolated"), false);
  assert.equal(mountsProductionRealtime("production"), true);

  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const composition = readFileSync(
    "src/lib/integrations/realtime-composition.tsx",
    "utf8",
  );
  assert.match(layout, /RealtimeCompositionProvider/);
  assert.doesNotMatch(layout, /GlobalRealtimeProvider/);
  assert.match(
    composition,
    /if \(!mountsProductionRealtime\(runtime\.providers\.realtime\)\) \{\s*return null;/,
  );
});
