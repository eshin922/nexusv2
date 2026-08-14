"use client";

import { useState } from "react";
import { CreateItemGroupModal } from "@/components/item-group/create-item-group-modal";

// B-1 repair — the setup surface's second peer structural action.
//
// It reaches Item Group creation DIRECTLY. It does not open the Library first,
// and it must never be gated on an Item Group already existing: the Library
// requires a destination, so it cannot be the entry point for creating that
// destination. That inversion is exactly the dead end B-1 recorded — on a quote
// with zero groups the operator was sent to a Library that could add nothing
// and told, in an inert caption, to create a group somewhere else.

export function CreateItemGroupTrigger({
  quoteId,
  editable,
  itemGroupCategories,
}: {
  quoteId: string;
  editable: boolean;
  itemGroupCategories: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="a1v2-btn primary sm"
        onClick={() => setOpen(true)}
        disabled={!editable}
        aria-disabled={!editable}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          !editable
            ? "Quote is not draft — editing disabled"
            : "Group several products that are sold together"
        }
      >
        + Create Item Group
      </button>
      <CreateItemGroupModal
        quoteId={quoteId}
        open={open}
        onClose={() => setOpen(false)}
        itemGroupCategories={itemGroupCategories}
      />
    </>
  );
}
