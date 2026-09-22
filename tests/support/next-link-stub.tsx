/**
 * `next/link` for mounted tests.
 *
 * Next ships `link.js`, not `link`, so Node's resolver cannot load the
 * specifier production uses. The same gap the loader already bridges for
 * `next/navigation` and `next/cache`.
 *
 * A PLAIN ANCHOR, deliberately. What a mounted test asks of a link is where it
 * points; client-side prefetch and route interception are Next's behaviour, not
 * the component's, and a stub that pretended to have them would be asserting
 * the framework rather than the surface.
 */
import React from "react";

export default function Link({
  href,
  children,
  ...rest
}: {
  href: string;
  children?: React.ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return React.createElement("a", { href, ...rest }, children);
}
