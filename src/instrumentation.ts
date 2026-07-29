import { assertRuntimeSafety } from "@/lib/config/runtime-config";
import { installServerOutboundGuard } from "@/lib/network/server-outbound-guard";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const safety = assertRuntimeSafety();
    installServerOutboundGuard(safety);
  }
}

