// Preload shim: no-op Next's cache revalidation from verification scripts.
//
// `revalidatePath` / `revalidateTag` require Next's static-generation store,
// which exists only inside a request or render. A verification script calls the
// REAL server actions on purpose — that is the point, since re-implementing
// them would prove only that the re-implementation agrees with itself — and
// those actions legitimately revalidate at the end of their work.
//
// Cache invalidation is a UI-freshness concern with no bearing on any invariant
// under test here: nothing this shim disables reads or writes a row. Stubbing
// it is narrower than the alternative of threading a fake store through the
// action layer, and far narrower than duplicating the actions.
//
// Usage: node --require ./scripts/smoke/shim-next-cache.cjs …
//
// Affects only the current Node process. Production and dev resolve
// `next/cache` normally.
const Module = require("node:module");
const origLoad = Module._load;

const noopCache = {
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn) => fn,
  unstable_noStore: () => {},
};

Module._load = function (request, parent, isMain) {
  if (request === "next/cache") return noopCache;
  return origLoad.call(this, request, parent, isMain);
};
