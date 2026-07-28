// Slice 12 Step 8c-1 — resolver result types.
//
// Kept in a leaf module (no imports) so both the pure-format helper
// and the live SuiteQL resolver can share the discriminated shape
// without pulling each other's dependency graphs.

export type ResolveResult =
  | {
      status: "found";
      sku: string;
      netsuiteItemId: string;
      itemid: string;
      itemtype: string;
    }
  | {
      status: "not_found";
      sku: string;
    }
  | {
      status: "ambiguous";
      sku: string;
      matches: Array<{
        netsuiteItemId: string;
        itemid: string;
        itemtype: string;
      }>;
    };
