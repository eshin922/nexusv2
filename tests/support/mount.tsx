/**
 * Mount a client component in jsdom, for tests that must establish what the
 * COMPONENT does rather than what its rules would do if invoked.
 *
 * The distinction earned its place: a search handler once minted its ticket
 * inside a `setSession` updater and read the variable back on the next line.
 * React does not run updaters synchronously, so the ticket was null, the
 * handler returned early, and clicking Search issued no request at all. Every
 * pure-rules test passed — the rules were never reached.
 *
 * Kept deliberately small. No testing-library: `act`, `createRoot` and
 * `querySelector` cover what these tests need, and a thin harness is one fewer
 * thing whose behaviour has to be understood when a test disagrees with the
 * component.
 */
import { JSDOM } from "jsdom";
import { act } from "react";
import type { ReactElement } from "react";

export type Mounted = {
  container: HTMLElement;
  /** Re-render with new children, awaiting effects. */
  update: (el: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
  find: (selector: string) => Element | null;
  findAll: (selector: string) => Element[];
  byTestId: (id: string) => Element | null;
  /** Click, flushing React work the click schedules. */
  click: (selector: string) => Promise<void>;
  type: (selector: string, value: string) => Promise<void>;
  text: () => string;
};

let dom: JSDOM | null = null;

function installDom() {
  if (dom) return;
  const built = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const w = built.window as unknown as Window & typeof globalThis;
  const g = globalThis as Record<string, unknown>;
  // `navigator` is an accessor on the Node 22 global, so a plain assignment
  // throws. Everything here goes through defineProperty for that reason.
  const put = (key: string, value: unknown) => {
    Object.defineProperty(g, key, {
      value,
      configurable: true,
      writable: true,
    });
  };
  put("window", w);
  put("document", w.document);
  put("navigator", w.navigator);
  g.HTMLElement = w.HTMLElement;
  g.Element = w.Element;
  g.Node = w.Node;
  g.Event = w.Event;
  g.MouseEvent = w.MouseEvent;
  g.KeyboardEvent = w.KeyboardEvent;
  g.getComputedStyle = w.getComputedStyle.bind(w);
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  // React reads this to decide whether `act` is expected.
  g.IS_REACT_ACT_ENVIRONMENT = true;
  // Last: a half-installed DOM must not look installed to the next caller.
  dom = built;
}

export async function mount(el: ReactElement): Promise<Mounted> {
  installDom();
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(el);
  });

  const find = (sel: string) => container.querySelector(sel);
  const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

  return {
    container,
    find,
    findAll: (sel: string) => Array.from(container.querySelectorAll(sel)),
    byTestId,
    async update(next: ReactElement) {
      await act(async () => {
        root.render(next);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    async click(sel: string) {
      const node = container.querySelector(sel);
      if (!node) throw new Error(`click: no element matches ${sel}`);
      await act(async () => {
        (node as HTMLElement).dispatchEvent(
          new window.MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
    },
    async type(sel: string, value: string) {
      const node = container.querySelector(sel) as HTMLInputElement | null;
      if (!node) throw new Error(`type: no element matches ${sel}`);
      await act(async () => {
        // React 19 tracks the value on the DOM node; bypass its tracker so the
        // synthetic onChange actually fires.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(node, value);
        node.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    },
    text: () => container.textContent ?? "",
  };
}

/** Let queued microtasks and React work settle. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** A promise with an externally controlled resolution, for racing tests. */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
