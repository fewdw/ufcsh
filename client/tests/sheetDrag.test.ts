import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { attachSheetDrag } from "../src/useSheetDrag.ts";

function sheet(t: TestContext, scrollTop = 0, wide = false) {
  class Surface extends EventTarget {
    style = { transition: "", transform: "" };
    scrollTop = 0;
    offsetHeight = 600;
    closest() { return this; }
    getBoundingClientRect() { return { top: 100, bottom: 700, left: 0, right: 390 }; }
  }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  Object.defineProperty(globalThis, "Element", { configurable: true, value: Surface });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    matchMedia: (query: string) => ({ matches: query.includes("min-width") && wide }),
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
  } });
  const node = new Surface();
  node.scrollTop = scrollTop;
  let closed = 0;
  let pull = 0;
  const cleanup = attachSheetDrag(node as unknown as HTMLElement, () => closed++, value => { pull = value; });
  t.after(() => {
    cleanup();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousElement) Object.defineProperty(globalThis, "Element", previousElement);
    else Reflect.deleteProperty(globalThis, "Element");
  });
  function touch(type: string, y: number, at: number, x = 100, count = 1, cancelable = true) {
    const event = new Event(type, { cancelable });
    Object.defineProperties(event, {
      touches: { value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })) },
      timeStamp: { value: at },
    });
    node.dispatchEvent(event);
    return event;
  }
  function click(detail = 1) {
    const event = new Event("click", { cancelable: true });
    Object.defineProperty(event, "detail", { value: detail });
    node.dispatchEvent(event);
    return event;
  }
  return { node, touch, click, cleanup, pull: () => pull, closed: () => closed, finish: () => {
    for (const callback of timers.values()) callback();
    timers.clear();
  } };
}

test("a downward pull scrolls to the top before dragging and dismissing in the same gesture", t => {
  const s = sheet(t, 100);
  s.touch("touchstart", 200, 0);
  assert.equal(s.touch("touchmove", 250, 100).defaultPrevented, true);
  assert.equal(s.node.scrollTop, 50);
  assert.equal(s.pull(), 0);
  s.touch("touchmove", 330, 200);
  assert.equal(s.node.scrollTop, 0);
  assert.equal(s.node.style.transform, "translateY(30px)");
  s.touch("touchmove", 440, 400);
  s.touch("touchend", 440, 600);
  assert.equal(s.node.style.transform, "translateY(600px)");
  assert.equal(s.click().defaultPrevented, true, "drag must not toggle a filter");
  assert.equal(s.click(0).defaultPrevented, false, "keyboard activation is preserved");
  s.finish();
  assert.equal(s.closed(), 1);
});

test("scrolling without reaching the top does not dismiss even on a fast swipe", t => {
  const s = sheet(t, 300);
  s.touch("touchstart", 200, 0);
  s.touch("touchmove", 400, 10);
  s.touch("touchend", 400, 20);
  assert.equal(s.node.scrollTop, 100);
  s.finish();
  assert.equal(s.closed(), 0);
  assert.equal(s.node.style.transform, "");
});

test("reversing a pull restores the sheet before scrolling the content", t => {
  const s = sheet(t);
  s.touch("touchstart", 200, 0);
  s.touch("touchmove", 300, 100);
  s.touch("touchmove", 240, 200);
  assert.equal(s.pull(), 40);
  assert.equal(s.node.scrollTop, 0);
  s.touch("touchmove", 180, 300);
  assert.equal(s.pull(), 0);
  assert.equal(s.node.scrollTop, 20);
  s.touch("touchend", 180, 400);
  s.finish();
  assert.equal(s.closed(), 0);
});

test("taps, upward scrolling and horizontal swipes keep their native behavior", t => {
  const s = sheet(t);
  s.touch("touchstart", 300, 0);
  s.touch("touchend", 300, 100);
  assert.equal(s.click().defaultPrevented, false);
  s.touch("touchstart", 300, 200);
  assert.equal(s.touch("touchmove", 250, 300).defaultPrevented, false);
  s.touch("touchend", 250, 400);
  s.touch("touchstart", 300, 500);
  assert.equal(s.touch("touchmove", 310, 600, 200).defaultPrevented, false);
  s.touch("touchend", 310, 700);
  s.finish();
  assert.equal(s.closed(), 0);
});

test("short pulls and canceled touches spring back; cleanup cancels pending dismissal", t => {
  const s = sheet(t);
  s.touch("touchstart", 200, 0);
  assert.equal(s.touch("touchmove", 204, 50).defaultPrevented, true, "reserve downward gestures before native scrolling takes over");
  s.touch("touchmove", 230, 200);
  s.touch("touchend", 230, 400);
  assert.equal(s.node.style.transform, "");
  s.touch("touchstart", 200, 500);
  s.touch("touchmove", 360, 600);
  s.touch("touchcancel", 360, 610);
  assert.equal(s.node.style.transform, "");
  s.finish();
  assert.equal(s.closed(), 0);
  s.touch("touchstart", 200, 700);
  s.touch("touchmove", 360, 800);
  s.touch("touchend", 360, 900);
  s.cleanup();
  s.finish();
  assert.equal(s.closed(), 0);
});

test("quick flicks dismiss at the top, but stale velocity does not", t => {
  const s = sheet(t);
  s.touch("touchstart", 200, 0);
  s.touch("touchmove", 230, 20);
  s.touch("touchend", 230, 200);
  s.finish();
  assert.equal(s.closed(), 0);
  s.touch("touchstart", 200, 300);
  s.touch("touchmove", 230, 320);
  s.touch("touchend", 230, 330);
  s.finish();
  assert.equal(s.closed(), 1);
});

test("wide screens ignore sheet drag gestures", t => {
  const s = sheet(t, 0, true);
  s.touch("touchstart", 200, 0);
  assert.equal(s.touch("touchmove", 400, 100).defaultPrevented, false);
  s.touch("touchend", 400, 200);
  s.finish();
  assert.equal(s.node.style.transform, "");
  assert.equal(s.closed(), 0);
});
