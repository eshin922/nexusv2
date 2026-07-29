import "server-only";
import type {
  HubSpotOperations,
  HubSpotStage,
} from "@/lib/integrations/hubspot-provider";

export type FakeHubSpotCall = {
  operation: string;
  input: Record<string, unknown>;
  at: string;
};

const calls: FakeHubSpotCall[] = [];
const dealStages = new Map<string, HubSpotStage>();
const dealAmounts = new Map<string, number>();

function scenario(): string {
  return process.env.NEXUS_FAKE_HUBSPOT_SCENARIO ?? "success";
}

function record(operation: string, input: Record<string, unknown>) {
  calls.push({ operation, input, at: new Date().toISOString() });
}

function fail(operation: string) {
  const selected = scenario();
  if (selected === "unauthorized") throw new Error("HubSpot fake unauthorized");
  if (selected === "timeout") throw new Error("HubSpot fake timeout");
  if (selected === "rate-limit") throw new Error("HubSpot fake rate limit");
  if (selected === "malformed") throw new Error("HubSpot fake malformed response");
  if (selected === `${operation}-fails`) {
    throw new Error(`HubSpot fake ${operation} failure`);
  }
}

export function readFakeHubSpotCalls(): readonly FakeHubSpotCall[] {
  return calls;
}

export function resetFakeHubSpot() {
  calls.length = 0;
  dealStages.clear();
  dealAmounts.clear();
}

export const fakeHubSpot: HubSpotOperations = {
  name: "fake-hubspot",
  kind: "isolated",
  async findOwnerByEmail(email) {
    record("owner-by-email", { email });
    fail("owner-by-email");
    if (scenario() === "not-found") return null;
    return {
      id: "validation_hs_owner_pm",
      firstName: "Validation",
      lastName: "Owner",
    };
  },
  async findOwnerById(ownerId) {
    record("owner-by-id", { ownerId });
    fail("owner-by-id");
    if (scenario() === "not-found") return null;
    return { name: "Validation Owner", email: "owner@nexus-validation.invalid" };
  },
  async listDealStages() {
    record("deal-stage-list", {});
    fail("deal-stage-list");
    return [
      { id: "validation_stage_sent", label: "Validation Sent" },
      { id: "validation_stage_accepted", label: "Validation Accepted" },
    ];
  },
  async getDealStage(dealId) {
    record("deal-stage-read", { dealId });
    fail("deal-stage-read");
    return (
      dealStages.get(dealId) ?? {
        id: "validation_stage_sent",
        label: "Validation Sent",
      }
    );
  },
  async updateDealStage(dealId, targetStage, options) {
    record("deal-stage-update", { dealId, targetStage, ...options });
    fail(options?.amount === undefined ? "stage-update" : "stage-and-amount-update");
    const stage = {
      id: targetStage.startsWith("validation_")
        ? targetStage
        : `validation_stage_${targetStage.toLowerCase().replace(/\W+/g, "_")}`,
      label: targetStage,
    };
    dealStages.set(dealId, stage);
    if (options?.amount !== undefined) dealAmounts.set(dealId, options.amount);
    return stage;
  },
  async updateDealAmount(dealId, amount) {
    record("amount-update", { dealId, amount });
    fail("amount-update");
    dealAmounts.set(dealId, amount);
  },
};
