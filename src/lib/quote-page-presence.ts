const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PAGE = new RegExp(`^(?:overview|setup|setup/review|costs|pricing|quote|packaging|production|freight|leaves/${UUID}/specs)$`, "i");
export const QUOTE_PRESENCE_TTL_MS = 35_000;
export const QUOTE_PRESENCE_POLL_MS = 10_000;
export const QUOTE_PRESENCE_IDLE_MS = 120_000;

export function validQuotePageKey(value: string): boolean {
  return PAGE.test(value);
}

export function quotePageKey(pathname: string, projectId: string, quoteId: string): string | null {
  const prefix = `/projects/${projectId}/quotes/${quoteId}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  const suffix = pathname.slice(prefix.length).replace(/^\/+|\/+$/g, "") || "overview";
  return validQuotePageKey(suffix) ? suffix : null;
}
