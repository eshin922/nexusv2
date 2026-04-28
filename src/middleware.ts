import {
  clerkClient,
  clerkMiddleware,
  createRouteMatcher,
} from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)"]);

const PRIMARY_DOMAIN = "@thedps.co";

function emailAllowed(email: string | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (e.endsWith(PRIMARY_DOMAIN)) return true;
  const extras = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extras.includes(e);
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId, sessionId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();

  const c = await clerkClient();
  const user = await c.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;

  if (emailAllowed(email)) return;

  if (sessionId) {
    try {
      await c.sessions.revokeSession(sessionId);
    } catch {
      // Best-effort revoke; cookies become inert on next request even without it
    }
  }

  const url = new URL("/sign-in", req.url);
  url.searchParams.set("error", "unauthorized");
  if (email) url.searchParams.set("email", email);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
