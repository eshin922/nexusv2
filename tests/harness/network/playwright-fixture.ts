import { test as base, expect } from "@playwright/test";

export type NetworkLedgerEntry = {
  url: string;
  resourceType: string;
  blocked: boolean;
};

function isAllowed(url: string): boolean {
  if (/^(?:about:|blob:|data:)/.test(url)) return true;
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export const test = base.extend<{ networkLedger: NetworkLedgerEntry[] }>({
  networkLedger: async ({ page }, use, testInfo) => {
    const ledger: NetworkLedgerEntry[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      const allowed = isAllowed(request.url());
      ledger.push({
        url: request.url(),
        resourceType: request.resourceType(),
        blocked: !allowed,
      });
      if (allowed) await route.continue();
      else await route.abort("blockedbyclient");
    });
    page.on("websocket", (socket) => {
      ledger.push({
        url: socket.url(),
        resourceType: "websocket",
        blocked: !isAllowed(socket.url()),
      });
    });

    await use(ledger);

    await testInfo.attach("network-ledger.json", {
      body: Buffer.from(JSON.stringify(ledger, null, 2)),
      contentType: "application/json",
    });
    expect(
      ledger.filter((entry) => entry.blocked),
      "unexpected outbound browser network requests",
    ).toEqual([]);
  },
});

export { expect };
