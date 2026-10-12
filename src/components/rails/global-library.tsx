"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { LibraryBrowseModal } from "@/components/library/library-browse-modal";
import type { LeafSpecEntryProductType } from "@/lib/leaf-spec-loader";
import type { LibraryPermissions } from "@/lib/permissions/library-product";

const OPEN_LIBRARY_EVENT = "nexus:open-product-library";

export function GlobalLibrary({ fullLeafTypes, permissions }: {
  fullLeafTypes: LeafSpecEntryProductType[];
  permissions: LibraryPermissions;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_LIBRARY_EVENT, show);
    return () => window.removeEventListener(OPEN_LIBRARY_EVENT, show);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("openLibrary") === "1") {
      setOpen(true);
      url.searchParams.delete("openLibrary");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, [pathname]);

  return <>
    <button type="button" title="Product Library" aria-label="Product Library"
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-3 hover:text-ink">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 2.5h4v11h-4zM6.5 3.5h3.5v10H6.5zM10 2.5h3.5v11H10z" />
        <path d="M3.5 10.5h2M7.25 10.5h2M10.75 10.5h2" />
      </svg>
    </button>
    {open && createPortal(
      <LibraryBrowseModal mode="browse" open={open} onClose={() => setOpen(false)}
        quoteId={null} projectId={null} assemblies={[]} fullLeafTypes={fullLeafTypes}
        permissions={permissions} />,
      document.body,
    )}
  </>;
}
