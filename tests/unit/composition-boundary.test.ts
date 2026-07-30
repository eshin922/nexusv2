import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const ALLOWED_RUNTIME_SELECTION_FILES = new Set([
  "src/instrumentation.ts",
  "src/lib/auth/middleware-composition.ts",
  "src/lib/config/runtime-config.ts",
  "src/lib/integrations/composition.ts",
  "src/lib/integrations/realtime-composition.tsx",
  "src/middleware.ts",
]);

function trackedSourceFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    {
    cwd: ROOT,
    encoding: "utf8",
    },
  )
    .split(/\r?\n/)
    .filter((file) => /\.(?:ts|tsx)$/.test(file));
}

test("validation-mode selection is confined to startup composition", () => {
  const violations: string[] = [];
  for (const file of trackedSourceFiles()) {
    if (ALLOWED_RUNTIME_SELECTION_FILES.has(file)) continue;
    const source = readFileSync(join(ROOT, file), "utf8");
    if (
      /NEXUS_ISOLATED_TEST|NEXUS_VALIDATION_IDENTITY|NEXUS_(?:AUTH|HUBSPOT|NETSUITE|ARTIFACT|REALTIME)_PROVIDER|assertRuntimeSafety\s*\(/.test(
        source,
      )
    ) {
      violations.push(relative(ROOT, join(ROOT, file)));
    }
  }
  assert.deepEqual(violations, []);
});

test("production source never imports test harness modules outside composition", () => {
  const violations: string[] = [];
  for (const file of trackedSourceFiles()) {
    if (
      file === "src/lib/integrations/composition.ts" ||
      file === "src/lib/integrations/realtime-composition.tsx" ||
      file === "src/lib/auth/middleware-composition.ts"
    ) {
      continue;
    }
    const source = readFileSync(join(ROOT, file), "utf8");
    if (/tests\/harness|tests\\harness/.test(source)) {
      violations.push(file);
    }
  }
  assert.deepEqual(violations, []);
});
