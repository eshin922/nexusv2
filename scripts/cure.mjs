// `npm run cure` — the standard cure for dev-mode connection-leak +
// action-ID hash-drift symptoms (CLAUDE.md "Server action ID
// invalidation after refactors" + "Database client singleton").
//
// Steps:
//   1. Kill all other node processes (PID exclusion → this script
//      survives). Releases leaked Postgres connections held by
//      zombie dev servers.
//   2. Clear `.next` and `node_modules/.cache`. Forces fresh
//      compile + cache rebuild.
//   3. Start `next dev -p 3000` with inherited stdio. Script waits
//      until you Ctrl+C.
//
// Step 4 (close all browser tabs on :3000, open fresh) is YOUR job —
// can't automate the browser side.
//
// Cross-platform: Windows uses taskkill with /FI PID exclusion;
// Unix uses pkill with PID exclusion via xargs. The lightweight
// pattern below works for both without an OS-detection library.

import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { platform } from "node:os";

const myPid = process.pid;
const isWindows = platform() === "win32";

console.log(`→ Cure starting (script PID ${myPid})\n`);

// 1. Kill other node processes
console.log("→ Killing other node processes (zombie dev servers + verify scripts)...");
try {
  if (isWindows) {
    // /FI "PID ne <self>" excludes this script. /F forces.
    // Returns non-zero if no matching processes — caught + ignored.
    execSync(
      `taskkill /IM node.exe /F /FI "PID ne ${myPid}"`,
      { stdio: "inherit" },
    );
  } else {
    // pgrep node | grep -v <self> | xargs -r kill -9
    execSync(
      `pgrep -f node | grep -v '^${myPid}$' | xargs -r kill -9`,
      { stdio: "inherit", shell: "/bin/bash" },
    );
  }
} catch {
  // taskkill / pkill exits non-zero when nothing matched. Fine.
  console.log("  (no other node processes to kill — already clean)");
}

// 2. Brief pause for ports to free + connections to close at TCP layer
await new Promise((r) => setTimeout(r, 1500));

// 3. Clear caches
console.log("\n→ Clearing .next and node_modules/.cache...");
rmSync(".next", { recursive: true, force: true });
rmSync("node_modules/.cache", { recursive: true, force: true });

// 4. Start dev server, inherit stdio so the user sees the same log
//    they'd see from `npm run dev`.
console.log("\n→ Starting dev server on :3000...");
console.log("  ⚠ STEP 4: Close ALL browser tabs on localhost:3000, open fresh.\n");

const child = spawn(isWindows ? "npx.cmd" : "npx", ["next", "dev", "-p", "3000"], {
  stdio: "inherit",
});

// Forward signals so Ctrl+C kills the dev server cleanly
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

child.on("exit", (code) => process.exit(code ?? 0));
