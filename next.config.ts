import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Slice RI.8 surface naming canon — 301 redirects from old surface
  // URLs to the renamed canonical paths. Same precedent as F-4's
  // /packaging /production /freight redirects to /cost-build during
  // RI.4 (now /costs after this rename). External bookmarks /
  // copy-pasted links / browser history all keep working.
  //
  // Mark Accepted + Setup keep their URLs (no rename needed). Old
  // /cost-build, /costing, /customer-view permanent-redirect to
  // /costs, /pricing, /quote.
  async redirects() {
    return [
      {
        source: "/projects/:projectId/quotes/:quoteId/cost-build",
        destination: "/projects/:projectId/quotes/:quoteId/costs",
        permanent: true,
      },
      {
        source: "/projects/:projectId/quotes/:quoteId/cost-build/:path*",
        destination: "/projects/:projectId/quotes/:quoteId/costs/:path*",
        permanent: true,
      },
      {
        source: "/projects/:projectId/quotes/:quoteId/costing",
        destination: "/projects/:projectId/quotes/:quoteId/pricing",
        permanent: true,
      },
      {
        source: "/projects/:projectId/quotes/:quoteId/costing/:path*",
        destination: "/projects/:projectId/quotes/:quoteId/pricing/:path*",
        permanent: true,
      },
      {
        source: "/projects/:projectId/quotes/:quoteId/customer-view",
        destination: "/projects/:projectId/quotes/:quoteId/quote",
        permanent: true,
      },
      {
        source: "/projects/:projectId/quotes/:quoteId/customer-view/:path*",
        destination: "/projects/:projectId/quotes/:quoteId/quote/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
