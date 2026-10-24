import { test } from "node:test";
import assert from "node:assert/strict";
import { createClock } from "./voice-harness/clock.mjs";

test("timers fire in time order, ties in creation order", () => {
  const c = createClock(1000);
  const out = [];
  c.setTimeout(() => out.push("b"), 20);
  c.setTimeout(() => out.push("a"), 10);
  c.setTimeout(() => out.push("c"), 20);
  c.runUntil(1015);
  assert.deepEqual(out, ["a"]);
  assert.equal(c.now(), 1015);
  c.runUntil(1100);
  assert.deepEqual(out, ["a", "b", "c"]);
});

test("intervals repeat and can be cleared from inside their callback", () => {
  const c = createClock(0);
  let n = 0;
  const id = c.setInterval(() => { n++; if (n === 3) c.clearInterval(id); }, 50);
  c.runUntil(1000);
  assert.equal(n, 3);
  assert.equal(c.pending(), 0);
});

test("a timer scheduled during runUntil fires in the same run if due", () => {
  const c = createClock(0);
  const out = [];
  c.setTimeout(() => { out.push(1); c.setTimeout(() => out.push(2), 0); }, 10);
  c.runUntil(50);
  assert.deepEqual(out, [1, 2]);
});

test("clearTimeout prevents firing; requestAnimationFrame fires after 16 ms", () => {
  const c = createClock(0);
  const out = [];
  const id = c.setTimeout(() => out.push("x"), 5);
  c.clearTimeout(id);
  c.requestAnimationFrame(ts => out.push(ts));
  c.runUntil(100);
  assert.deepEqual(out, [16]);
});
