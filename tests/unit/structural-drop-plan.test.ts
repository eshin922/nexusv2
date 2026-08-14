// Structural drag/drop — the insertion indicator's promise.
//
// THE CLAIM UNDER TEST, stated once:
//
//   The line the operator sees before release marks the position the mutation
//   will actually persist.
//
// That claim is only checkable because both sides call ONE function. So the
// falsification that matters is not "does the index look right" — it is
// "does the rendered anchor reconstruct the same list the server writes".
// A test that only asserted index arithmetic would pass while the line was
// drawn against the wrong row, which is the exact defect this replaces:
// feedback derived from what the pointer is over rather than from the result.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  indicatorAnchor,
  isNoOpDrop,
  orderAfterMove,
  resolveDropIndex,
  sameZone,
  type DropZone,
} from "../../src/lib/product-structure/drop-plan.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFile(path.join(root, p), "utf8");

const GROUP_A: DropZone = { kind: "group", assemblyId: "A" };
const GROUP_B: DropZone = { kind: "group", assemblyId: "B" };
const DIRECT: DropZone = { kind: "direct" };

/**
 * What the operator is shown, reconstructed from the anchor alone.
 *
 * Deliberately does NOT reuse `orderAfterMove` — it rebuilds the list from the
 * rendered cue, so agreement between this and the server's rule is evidence
 * rather than tautology.
 */
function listImpliedByIndicator(
  siblings: string[],
  movingId: string,
  index: number,
): string[] {
  const anchor = indicatorAnchor(siblings, movingId, index);
  const others = siblings.filter((id) => id !== movingId);
  if (anchor.overId === null) return [movingId];
  const at = others.indexOf(anchor.overId);
  const insertAt = anchor.edge === "before" ? at : at + 1;
  const out = others.slice();
  out.splice(insertAt, 0, movingId);
  return out;
}

/** What the server writes. */
function listPersisted(
  siblings: string[],
  movingId: string,
  index: number,
): string[] {
  return orderAfterMove(
    siblings.filter((id) => id !== movingId),
    movingId,
    index,
  );
}

// ── 1 · The indicator and the mutation agree, exhaustively ──────────────────

test("indicator and persisted order agree for every hover in a same-group reorder", () => {
  const siblings = ["p1", "p2", "p3", "p4"];
  for (const moving of siblings) {
    for (const over of siblings) {
      for (const edge of ["before", "after"] as const) {
        const index = resolveDropIndex({
          siblings,
          movingId: moving,
          overId: over,
          edge,
        });
        assert.deepEqual(
          listImpliedByIndicator(siblings, moving, index),
          listPersisted(siblings, moving, index),
          `disagreement moving ${moving} ${edge} ${over}`,
        );
      }
    }
  }
});

test("indicator and persisted order agree when the product arrives from elsewhere", () => {
  // Cross-home: the destination list does NOT contain the moving product.
  const destination = ["b1", "b2", "b3"];
  for (const over of destination) {
    for (const edge of ["before", "after"] as const) {
      const index = resolveDropIndex({
        siblings: destination,
        movingId: "incoming",
        overId: over,
        edge,
      });
      assert.deepEqual(
        listImpliedByIndicator(destination, "incoming", index),
        listPersisted(destination, "incoming", index),
      );
    }
  }
});

// ── 2 · The specific case a hover-anchored line gets wrong ──────────────────

test("dragging DOWN past one row lands after it, not before it", () => {
  // The regression this design exists to prevent. Hovering p3's lower half
  // while carrying p1: a naive line drawn "below the hovered row" happens to
  // agree here, but the INDEX must account for p1 vacating its own slot.
  const siblings = ["p1", "p2", "p3", "p4"];
  const index = resolveDropIndex({
    siblings,
    movingId: "p1",
    overId: "p3",
    edge: "after",
  });
  assert.equal(index, 2);
  assert.deepEqual(listPersisted(siblings, "p1", index), [
    "p2",
    "p3",
    "p1",
    "p4",
  ]);
  // And the line is drawn on p4's top edge — the row that will sit at index 2
  // once p1 is removed from its old slot.
  assert.deepEqual(indicatorAnchor(siblings, "p1", index), {
    overId: "p4",
    edge: "before",
  });
});

test("dragging UP is unaffected by the vacated slot", () => {
  const siblings = ["p1", "p2", "p3", "p4"];
  const index = resolveDropIndex({
    siblings,
    movingId: "p4",
    overId: "p2",
    edge: "before",
  });
  assert.equal(index, 1);
  assert.deepEqual(listPersisted(siblings, "p4", index), [
    "p1",
    "p4",
    "p2",
    "p3",
  ]);
});

// ── 3 · Invalid destination shows no indicator ──────────────────────────────

test("a drop that changes nothing is a no-op and shows no line", () => {
  const siblings = ["p1", "p2", "p3"];
  // Onto its own top edge.
  assert.equal(
    isNoOpDrop({
      plan: {
        zone: GROUP_A,
        index: resolveDropIndex({
          siblings,
          movingId: "p2",
          overId: "p2",
          edge: "before",
        }),
      },
      currentZone: GROUP_A,
      currentSiblings: siblings,
      movingId: "p2",
    }),
    true,
  );
  // Onto the far edge of its immediate predecessor — a different hover that
  // produces the same list. Compared by RESULT, so it is caught too.
  assert.equal(
    isNoOpDrop({
      plan: {
        zone: GROUP_A,
        index: resolveDropIndex({
          siblings,
          movingId: "p2",
          overId: "p1",
          edge: "after",
        }),
      },
      currentZone: GROUP_A,
      currentSiblings: siblings,
      movingId: "p2",
    }),
    true,
  );
});

test("the same index in a DIFFERENT home is never a no-op", () => {
  // Group A -> Group B at index 0 changes membership even when the index
  // matches, so it must stay a valid destination.
  assert.equal(
    isNoOpDrop({
      plan: { zone: GROUP_B, index: 0 },
      currentZone: GROUP_A,
      currentSiblings: ["p1", "p2"],
      movingId: "p1",
    }),
    false,
  );
  assert.equal(
    isNoOpDrop({
      plan: { zone: DIRECT, index: 0 },
      currentZone: GROUP_A,
      currentSiblings: ["p1", "p2"],
      movingId: "p1",
    }),
    false,
  );
});

test("a genuine reorder is not suppressed as a no-op", () => {
  assert.equal(
    isNoOpDrop({
      plan: { zone: GROUP_A, index: 2 },
      currentZone: GROUP_A,
      currentSiblings: ["p1", "p2", "p3"],
      movingId: "p1",
    }),
    false,
  );
});

// ── 4 · Destinations with nothing to anchor to ──────────────────────────────

test("an empty destination anchors to no row", () => {
  assert.deepEqual(indicatorAnchor([], "x", 0), {
    overId: null,
    edge: "before",
  });
  // A group holding only the product being dragged out of it is empty for
  // anchoring purposes — the product cannot be its own insertion reference.
  assert.deepEqual(indicatorAnchor(["x"], "x", 0), {
    overId: null,
    edge: "before",
  });
});

test("appending anchors to the last row's far edge", () => {
  assert.deepEqual(indicatorAnchor(["a", "b"], "x", 2), {
    overId: "b",
    edge: "after",
  });
  // Out-of-range indexes clamp rather than throw — a hover during a re-render
  // must never crash the drag.
  assert.deepEqual(indicatorAnchor(["a", "b"], "x", 99), {
    overId: "b",
    edge: "after",
  });
  assert.deepEqual(orderAfterMove(["a", "b"], "x", 99), ["a", "b", "x"]);
  assert.deepEqual(orderAfterMove(["a", "b"], "x", -5), ["x", "a", "b"]);
});

test("hovering a destination but no row appends", () => {
  assert.equal(
    resolveDropIndex({
      siblings: ["a", "b", "c"],
      movingId: "x",
      overId: null,
      edge: "after",
    }),
    3,
  );
});

// ── 5 · Zone identity ───────────────────────────────────────────────────────

test("zone comparison distinguishes direct from group and group from group", () => {
  assert.equal(sameZone(DIRECT, DIRECT), true);
  assert.equal(sameZone(GROUP_A, GROUP_A), true);
  assert.equal(sameZone(GROUP_A, GROUP_B), false);
  assert.equal(sameZone(GROUP_A, DIRECT), false);
  assert.equal(sameZone(DIRECT, GROUP_A), false);
});

// ── 6 · One rule, not two implementations ───────────────────────────────────

test("the mutation resolves order through the shared rule, not its own copy", async () => {
  const src = await read("src/lib/product-structure/structural-move.ts");
  assert.match(
    src,
    /import \{ orderAfterMove \} from "\.\/drop-plan\.ts"/,
    "structural-move must consume the shared ordering rule",
  );
  assert.match(
    src,
    /orderAfterMove\(others, movedQuoteLeafId, index\)/,
    "group placement must go through the shared rule",
  );
  // Dense renumbering is the precondition for the indicator being able to tell
  // the truth: writing one row's position leaves ties broken by created_at,
  // which no client can predict.
  assert.match(src, /async function placeInGroup/);
  assert.match(src, /async function placeInDirect/);
  assert.match(src, /async function compactGroup/);
});

test("the surface derives its line from the plan, not from the hovered row", async () => {
  const src = await read("src/components/assembly-tree/assembly-tree-body.tsx");
  assert.match(
    src,
    /indicatorAnchor\(siblingsFor\(plan\.zone\), movingLeafId, plan\.index\)/,
    "the anchor must be derived from the resulting index",
  );
  // The drop persists the planned index. A hardcoded position would silently
  // reinstate the defect while the indicator kept moving.
  assert.match(src, /fd\.set\("position", String\(target\.index\)\)/);
  assert.doesNotMatch(
    src,
    /fd\.set\("position", "0"\)/,
    "position must come from the plan",
  );
  // No indicator ⇒ nothing was promised ⇒ nothing is written.
  assert.match(src, /if \(!target\) return;/);
});

/**
 * Comments are prose ABOUT the code, not code. A sweep that cannot tell the two
 * apart matches its own rationale — this file's CSS says `no "drop here" copy`
 * in a comment explaining why there is none, and an unstripped filter reads that
 * as the very string it is excluding.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

test("drag feedback is transient — no permanent drop zones or overlay copy", async () => {
  const body = stripComments(
    await read("src/components/assembly-tree/assembly-tree-body.tsx"),
  );
  const cssRaw = await read("src/styles/r-a1v2-overrides.css");
  const css = stripComments(cssRaw);
  assert.doesNotMatch(body, /drop here/i);
  assert.doesNotMatch(css, /drop here/i);
  // Every feedback rule is conditioned on a drag-state class, so nothing is
  // rendered when no drag is in flight.
  for (const cls of [".a1v2-drag-proxy", ".drop-before", ".drop-after"]) {
    assert.ok(css.includes(cls), `${cls} must be defined`);
  }
  // The proxy is parked offscreen rather than hidden — a hidden element
  // snapshots empty and the operator carries nothing.
  assert.match(css, /\.a1v2-drag-proxy \{[^}]*position: fixed;[^}]*top: -1000px;/s);
});

// ── 7 · The row register both kinds share ───────────────────────────────────

test("Direct and member rows declare the same five-cell register", async () => {
  const css = await read("src/styles/r-a1v2-overrides.css");
  const direct = css.match(
    /\.a1v2-asy-row\.a1v2-direct-row \{[\s\S]*?grid-template-columns: ([^;]+);/,
  );
  const member = css.match(
    /\.a1v2-leaf-row \{\s*grid-template-columns: ([^;]+);/,
  );
  assert.ok(direct && member, "both templates must be declared");
  const directCols = direct[1].trim().split(/\s+/);
  const memberCols = member[1].trim().split(/\s+/);
  assert.equal(directCols.length, 5, `direct: ${direct[1]}`);
  assert.equal(memberCols.length, 5, `member: ${member[1]}`);
  // Identical downstream of the leading slot. That slot is the ONLY sanctioned
  // difference: it carries the member hierarchy gutter.
  assert.deepEqual(directCols.slice(1), memberCols.slice(1));
  assert.equal(directCols[0], "16px");
  assert.equal(memberCols[0], "60px");
});

test("the Direct row renders one cell per declared column", async () => {
  const src = await read("src/components/assembly-tree/direct-product-row.tsx");
  // The SKU was rendered TWICE — an Item Group `.sku-pill` and a member
  // `.leaf-sku` — which put seven children in a six-column grid and wrapped the
  // overflow onto a second line.
  assert.doesNotMatch(
    src,
    /className="sku-pill"/,
    "the Direct row must not also render the Item Group SKU pill",
  );
  assert.equal(src.match(/className="leaf-sku"/g)?.length, 1);
  // The grip SLOT is unconditional even when the grip is not, or every column
  // shifts left by one on a read-only surface.
  assert.match(src, /<span aria-hidden="true" \/>\s*\)\}/);
  // Readiness lives INSIDE the trailing cell, matching the member row.
  assert.match(
    src,
    /<div className="direct-actions"[^>]*>\s*\{?\s*\/\*[\s\S]*?\*\/\s*\}?\s*<CompletenessChip|<div className="direct-actions" ref=\{menuRef\}>\s*<CompletenessChip/,
  );
});

// ── 8 · One SKU register for one entity role ────────────────────────────────

test("Direct and member SKUs share ONE typography declaration, not two copies", async () => {
  const canonical = await read("src/styles/r-a1v2-setup.css");
  const overrides = await read("src/styles/r-a1v2-overrides.css");

  const decls = (src: string, selector: string) => {
    const i = src.indexOf(selector);
    assert.ok(i >= 0, `selector not found: ${selector}`);
    const block = src.slice(src.indexOf("{", i) + 1, src.indexOf("}", i));
    return block
      .split(";")
      .map((d) => d.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .sort();
  };

  const member = decls(canonical, ".a1v2-leaf-row .leaf-sku {");
  const shared = decls(overrides, ".a1v2-asy-row.a1v2-direct-row > .leaf-sku {");

  // Same entity role ⇒ same register. Family, size, colour and tracking all.
  assert.deepEqual(shared, member);
  assert.ok(shared.some((d) => d.startsWith("font-family: var(--mono)")));

  // The override must reach BOTH rows from one declaration. A root-only rule
  // holding the same values is a second variant, and two copies of one register
  // drift on the first edit to either.
  assert.match(
    overrides,
    /\.a1v2-leaf-row \.leaf-sku,\s*\n\.a1v2-asy-row\.a1v2-direct-row > \.leaf-sku \{/,
    "the member selector must be restated alongside the root one",
  );

  // The Item Group container keeps its own treatment — a container is a
  // different role, and this fix must not reach it.
  assert.match(overrides, /\.a1v2-asy-row\.a1v2-direct-row \.sku-pill \{/);
});

// ── 9 · Group -> Direct must be physically reachable ────────────────────────

test("root insertion lanes exist, and only during a drag", async () => {
  const body = await read("src/components/assembly-tree/assembly-tree-body.tsx");
  // The lane returns null with no move in flight, so no permanent drop chrome
  // enters the surface — the guard is the whole reason this is not a dropzone.
  assert.match(
    body,
    /function RootLane\(\{ index \}: \{ index: number \}\) \{\s*if \(!movingLeafId\) return null;/,
  );
  // A lane at every root slot, plus the tail. Blank container background is no
  // longer the only root target.
  assert.match(body, /<RootLane index=\{rootLaneIndexBefore\.tail\} \/>/);
  assert.match(body, /rootLaneIndexBefore\.map\.has\(product\.quoteLeafId\)/);
  // It proposes an EXACT index, so root placement is ordered rather than
  // "make it Direct somewhere".
  assert.match(body, /proposePlanAt\(\{ kind: "direct" \}, index\)/);
  // And it commits through the same proven primitive.
  assert.match(body, /onDrop=\{commitDrop\}/);
  // Comments explain WHY there is no "drop here" affordance, so the raw source
  // contains the string it is excluding. Third instance of this shape in one
  // slice: a filter that cannot tell code from prose about the code is
  // measuring the wrong thing.
  assert.doesNotMatch(stripComments(body), /drop here/i);
});

test("lane indices count non-moving rows, so one slot never has two lanes", async () => {
  const body = await read("src/components/assembly-tree/assembly-tree-body.tsx");
  // `resolveDropIndex` resolves against the list with the dragged row removed.
  // Emitting a lane before the moving row too would give two lanes one index,
  // and both would light for a single plan.
  assert.match(body, /if \(id === movingLeafId\) continue;/);

  // The arithmetic that guarantees it, exercised directly.
  const direct = ["a", "b", "c"];
  for (const moving of [...direct, "fromGroup"]) {
    const map = new Map<string, number>();
    let k = 0;
    for (const id of direct) {
      if (id === moving) continue;
      map.set(id, k);
      k += 1;
    }
    const indices = [...map.values(), k];
    assert.equal(new Set(indices).size, indices.length, `duplicate lane index moving ${moving}`);
    const others = direct.filter((d) => d !== moving);
    assert.equal(k, others.length, "tail lane must be the append slot");
    // Every reachable root index is offered — including the append slot.
    assert.deepEqual(indices.sort((x, y) => x - y), others.map((_, i) => i).concat(others.length));
  }
});

test("the root indicator has exactly one owner", async () => {
  const body = await read("src/components/assembly-tree/assembly-tree-body.tsx");
  // Row-anchored edges are suppressed for the direct zone. Both mechanisms
  // would match the same plan and paint two lines for one destination.
  assert.match(body, /if \(zone\.kind === "direct"\) return null;/);
  assert.match(body, /plan\?\.zone\.kind === "direct" && plan\.index === index/);
});

test("the lane reserves hit area without moving the rows around it", async () => {
  const css = await read("src/styles/r-a1v2-overrides.css");
  const block = css.slice(css.indexOf(".a1v2-root-lane {"));
  // 12px of target, given back to the layout — lanes appearing on dragstart
  // must not shift the rows the operator is aiming between.
  assert.match(block, /height: 12px;\s*\n\s*margin: -6px 0;/);
  // Lifted over the adjacent row edges, which is the band the operator aims at
  // when they mean "between these two".
  assert.match(block, /z-index: 2;/);
  assert.match(block, /\.a1v2-root-lane\.active::after \{\s*\n\s*background: var\(--accent\);/);
});
