// Spec fields save when the operator LEAVES them, never while typing.
//
// The bug this replaces: a 500ms debounce fired mid-entry, and the sync effect
// listed `pending` in its dependencies, so every completed save wrote the RSC
// snapshot back over the input. Typing "129.1 x 92" then ".3 x 13.5" produced
// "129.1 x 923 x 13.5" -- the "." was typed while the request was in flight,
// the reset reverted the field, and the next character landed on the reverted
// text. The caret jumped with it, and the corrupted value persisted.
//
// Committing on blur removes the interleaving entirely: nothing is sent while
// there is still typing to interrupt.
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { deferred, flush, mount } from "../support/mount.tsx";
import {
  SpecCell,
  flushPendingSpecEdits,
} from "../../src/components/spec-entry/spec-panel.tsx";

type SaveResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

const OK: SaveResult = { ok: true, data: undefined };
const field = { key: "pp_size", label: "Size", wide: false } as never;

function view(over: {
  initialValue?: string;
  save?: (fd: FormData) => Promise<SaveResult>;
}) {
  return (
    <SpecCell
      field={field}
      scope={{ library: true }}
      leafId="leaf-1"
      initialValue={over.initialValue ?? ""}
      readOnly={false}
      save={over.save ?? (async () => OK)}
    />
  );
}

type M = Awaited<ReturnType<typeof mount>>;
const input = (m: M) =>
  m.container.querySelector("input, textarea") as HTMLInputElement;

async function typeInto(m: M, text: string) {
  for (const ch of text) await m.type("input, textarea", input(m).value + ch);
}

async function blur(m: M) {
  // React delegates `onBlur` from `focusout`, which bubbles. A plain `blur`
  // event never reaches its listener.
  input(m).dispatchEvent(new Event("focusout", { bubbles: true }));
  await flush();
}

test("typing sends nothing", async () => {
  // The whole point. A dimension is entered in pieces with pauses, and none
  // of those pauses is a decision to save.
  const sent: string[] = [];
  const m = await mount(
    view({
      save: async (fd) => {
        sent.push(String(fd.get("value")));
        return OK;
      },
    }),
  );
  await typeInto(m, "129.1 x 92.3 x 13.5");
  await new Promise((r) => setTimeout(r, 900)); // longer than any old debounce
  await flush();
  assert.deepEqual(sent, [], "a save was issued while the operator was typing");
  assert.equal(input(m).value, "129.1 x 92.3 x 13.5");
  await m.unmount();
});

test("leaving the field saves it once, with the whole value", async () => {
  const sent: string[] = [];
  const m = await mount(
    view({
      save: async (fd) => {
        sent.push(String(fd.get("value")));
        return OK;
      },
    }),
  );
  await typeInto(m, "129.1 x 92.3 x 13.5");
  await blur(m);
  assert.deepEqual(sent, ["129.1 x 92.3 x 13.5"]);
  await m.unmount();
});

test("leaving an unchanged field sends nothing", async () => {
  const sent: string[] = [];
  const m = await mount(
    view({
      initialValue: "unchanged",
      save: async (fd) => {
        sent.push(String(fd.get("value")));
        return OK;
      },
    }),
  );
  await blur(m);
  await blur(m);
  assert.deepEqual(sent, []);
  await m.unmount();
});

test("Done saves the field the operator is still inside", async () => {
  // Closing is how they say they are finished. A field under the cursor has
  // not blurred, and the close must not race the write it would trigger.
  const sent: string[] = [];
  const m = await mount(
    view({
      save: async (fd) => {
        sent.push(String(fd.get("value")));
        return OK;
      },
    }),
  );
  await typeInto(m, "129.1 x 92.3 x 13.5");
  flushPendingSpecEdits();
  await flush();
  assert.deepEqual(sent, ["129.1 x 92.3 x 13.5"]);
  await m.unmount();
});

test("a save in flight never writes its snapshot back over the input", async () => {
  const gate = deferred<SaveResult>();
  const m = await mount(view({ save: async () => gate.promise }));
  await typeInto(m, "129.1");
  await blur(m);
  // The operator comes back and keeps typing while the request is out.
  await typeInto(m, " x 92.3");
  gate.resolve(OK);
  await flush();
  assert.equal(input(m).value, "129.1 x 92.3");
  await m.unmount();
});

test("an external change IS adopted when nothing is uncommitted", async () => {
  const m = await mount(view({ initialValue: "first" }));
  assert.equal(input(m).value, "first");
  await m.update(view({ initialValue: "second" }));
  assert.equal(input(m).value, "second");
  await m.unmount();
});

test("an external change is NOT adopted over uncommitted typing", async () => {
  const m = await mount(view({ initialValue: "first" }));
  await typeInto(m, "!");
  await m.update(view({ initialValue: "second" }));
  assert.equal(input(m).value, "first!", "uncommitted typing was overwritten");
  await m.unmount();
});

test("the input is never disabled while saving", async () => {
  // Pattern 47: disabling on the saving frame drops focus.
  const gate = deferred<SaveResult>();
  const m = await mount(view({ save: async () => gate.promise }));
  await typeInto(m, "129.1");
  await blur(m);
  assert.equal(input(m).disabled, false);
  gate.resolve(OK);
  await flush();
  await m.unmount();
});
