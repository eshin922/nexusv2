import {
  clerkClient,
  clerkMiddleware,
  createRouteMatcher,
} from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// `/api/certification-status` is public by design. It reports whether THIS
// runtime has certification suppression active — the gate that must be proven
// before any Accept against a real production HubSpot deal. Auth-gating it
// would make the check unanswerable from the runtime itself (the failure mode
// it exists to rule out), and it exposes only a boolean, a fixed banner and a
// fixed reason: no secrets, no configuration values, no customer data.
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/certification-status",
]);
const PRIMARY_DOMAIN = "@thedps.co";

function emailAllowed(email: string | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (normalized.endsWith(PRIMARY_DOMAIN)) return true;
  const extras = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return extras.includes(normalized);
}

export const productionMiddleware = clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId, sessionId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;

  if (emailAllowed(email)) return;

  if (sessionId) {
    try {
      await clerk.sessions.revokeSession(sessionId);
    } catch {
      // Best-effort revoke; the authorization check still rejects the request.
    }
  }

  const url = new URL("/sign-in", req.url);
  url.searchParams.set("error", "unauthorized");
  if (email) url.searchParams.set("email", email);
  return NextResponse.redirect(url);
});
