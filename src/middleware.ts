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
  // `mp4|webm` sit alongside png/svg/woff2 for the same reason those do: they
  // are static brand assets, not routes. Without them the sign-in hero video
  // is matched by the auth middleware and answered with a 307 to /sign-in, so
  // the element never receives a media stream and the panel silently falls back
  // to its poster. Nothing about WHO may reach a route changes here — only
  // which file extensions are recognised as assets.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|mp4|webm|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
