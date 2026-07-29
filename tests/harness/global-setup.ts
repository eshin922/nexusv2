import { assertRuntimeSafety } from "../../src/lib/config/runtime-config";

export default async function globalSetup() {
  const runtime = assertRuntimeSafety();
  if (runtime.mode !== "isolated") {
    throw new Error("[playwright] isolated runtime proof failed");
  }
  for (const [name, provider] of Object.entries(runtime.providers)) {
    if (provider !== "isolated") {
      throw new Error(`[playwright] ${name} provider is not isolated`);
    }
  }
}
