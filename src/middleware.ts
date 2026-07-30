import type { NextFetchEvent, NextRequest } from "next/server";
import { composedMiddleware } from "@/lib/auth/middleware-composition";

export default async function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const handler = await composedMiddleware;
  return handler(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
