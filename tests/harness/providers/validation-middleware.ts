import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function validationMiddleware(req: NextRequest) {
  const identity = process.env.NEXUS_VALIDATION_IDENTITY ?? "pm";
  if (
    identity === "unauthorized" &&
    !req.nextUrl.pathname.startsWith("/sign-in")
  ) {
    return NextResponse.redirect(new URL("/sign-in?error=unauthorized", req.url));
  }
  return NextResponse.next();
}
