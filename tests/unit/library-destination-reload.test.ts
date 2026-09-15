// Changing the item-group destination must RELOAD and return to page one.
//
// The destination filters nothing, so it is easy to think of it as inert. It
// is not: it decides what counts as attached, which decides the ORDER, which
// decides what is on each page. Two consequences follow, and both were wrong
// when `targetAssemblyId` was first threaded into the request:
//
//   * the request carried the new destination but nothing triggered a fetch,
//     so the list kept the previous group's ordering until some other change
//     happened to move it
//   * the offset was held, so an operator on page 4 saw a slice of an ordering
//     that no longer existed -- with the products the switch was meant to
//     surface now on page 1, unseen
//
// Asserted against the SOURCE's dependency arrays rather than by mounting the
// modal: the component needs a quote, a library, assemblies and five server
// actions to render at all, and a test that stubs all of it would be asserting
// against its own scaffolding. The dependency arrays are the mechanism -- the
// behaviour is measured on the deployed surface, where the real data is.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const modal = () =>
  readFileSync("src/components/library/library-browse-modal.tsx", "utf8");

/** The dependency array of the effect whose body contains `needle`. */
function depsOfEffectContaining(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at > 0, `no effect body contains ${JSON.stringify(needle)}`);
  const close = src.indexOf("}, [", at);
  assert.ok(close > 0, "effect has no dependency array");
  const end = src.indexOf("]", close);
  return src.slice(close + 3, end + 1);
}

test("switching the destination triggers a reload", () => {
  const deps = depsOfEffectContaining(modal(), "const result = await browse({");
  assert.match(
    deps,
    /targetAssemblyId/,
    "the destination travels in the request but does not trigger the fetch that sends it",
  );
  // The rest of the dependency set must survive: dropping one of these would
  // strand the list on a stale filter in exactly the same way.
  for (const dep of ["search", "sourceTypeFilter", "scopeFilter", "offset", "quoteId"]) {
    assert.match(deps, new RegExp(`\\b${dep}\\b`), `${dep} stopped triggering a reload`);
  }
});

test("and returns to page one", () => {
  const deps = depsOfEffectContaining(modal(), "setOffset(0);");
  assert.match(
    deps,
    /targetAssemblyId/,
    "the ordering changes under the operator while the offset is held",
  );
  for (const dep of ["search", "sourceTypeFilter", "scopeFilter"]) {
    assert.match(deps, new RegExp(`\\b${dep}\\b`), `${dep} stopped resetting the page`);
  }
});

test("the destination reaches the server on every browse call", () => {
  // One call site left without it would reload into the wrong ordering — and
  // only on the path that used it, which is the kind of gap that survives a
  // demo.
  const src = modal();
  const calls = [...src.matchAll(/await browse\(\{/g)];
  assert.ok(calls.length >= 4, `expected several browse call sites, saw ${calls.length}`);
  for (const call of calls) {
    // The call's argument object ends at the matching close; a short scan is
    // enough because these are all small literals.
    const tail = src.slice(call.index, call.index + 400);
    const end = tail.indexOf("});");
    const args = tail.slice(0, end === -1 ? 200 : end);
    assert.match(
      args,
      /targetAssemblyId/,
      `a browse call at index ${call.index} omits the destination:\n${args.slice(0, 160)}`,
    );
  }
});
