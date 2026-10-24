import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const VoiceLogic = createRequire(import.meta.url)("../../frontend/voice-logic.js");

const R = (transcript, isFinal) => ({ transcript, isFinal });

test("pttApplyResults appends finals, advances the index, and returns interim text", () => {
  const out = VoiceLogic.pttApplyResults({ sessionFinal: "", sessionFinalIdx: 0 }, [R(" hello ", true), R("wor", false)], 500, 300);
  assert.deepEqual(out, { sessionFinal: "hello", sessionFinalIdx: 1, interim: "wor" });
});

test("pttApplyResults: the echo guard drops early finals but still advances the index", () => {
  const out = VoiceLogic.pttApplyResults({ sessionFinal: "", sessionFinalIdx: 0 }, [R("echo", true)], 120, 300);
  assert.deepEqual(out, { sessionFinal: "", sessionFinalIdx: 1, interim: "" });
});

test("pttApplyResults starts from sessionFinalIdx and joins with single spaces", () => {
  const out = VoiceLogic.pttApplyResults({ sessionFinal: "a", sessionFinalIdx: 1 }, [R("a", true), R("b", true)], 999, 0);
  assert.equal(out.sessionFinal, "a b");
});

test("pttJoin joins hold text and session text with one space only when both exist", () => {
  assert.equal(VoiceLogic.pttJoin("", "x"), "x");
  assert.equal(VoiceLogic.pttJoin("h", ""), "h");
  assert.equal(VoiceLogic.pttJoin("h", "x"), "h x");
});

test("VoiceLogic exposes a version string", () => {
  assert.equal(typeof VoiceLogic.version, "string");
});

test("pending finals: trims, skips empty and muted text, merges with single spaces", () => {
  const p = VoiceLogic.createPendingFinals();
  assert.equal(p.add("  Remind me ", false), true);
  assert.equal(p.add("", false), false);
  assert.equal(p.add("dropped", true), false);
  assert.equal(p.add("about   Lily", false), true);
  assert.equal(p.merged(), "Remind me about Lily");
});

test("pending finals: the timer dispatches once, then ignores (the latch)", () => {
  const p = VoiceLogic.createPendingFinals();
  p.add("hi", false);
  assert.deepEqual(p.onTimer(false), { action: "dispatch", text: "hi" });
  assert.equal(p.dispatched, true);
  assert.equal(p.size, 0);
  assert.deepEqual(p.onTimer(false), { action: "ignore" });
});

test("pending finals: muted or empty at timer time clears without dispatching", () => {
  const p = VoiceLogic.createPendingFinals();
  p.add("hi", false);
  assert.deepEqual(p.onTimer(true), { action: "clear" });
  assert.equal(p.size, 0);
  assert.equal(p.dispatched, false);
  assert.deepEqual(VoiceLogic.createPendingFinals().onTimer(false), { action: "clear" });
});

test("pending finals: flush on recogniser end only with text, not dispatched, not muted", () => {
  const p = VoiceLogic.createPendingFinals();
  assert.equal(p.shouldFlushOnEnd(false), false);
  p.add("x", false);
  assert.equal(p.shouldFlushOnEnd(true), false);
  assert.equal(p.shouldFlushOnEnd(false), true);
});

test("orbClassFor matches setConvState's class string", () => {
  assert.equal(VoiceLogic.orbClassFor({ phase: "listening", journal: false }), "conv-orb listening");
  assert.equal(VoiceLogic.orbClassFor({ phase: "paused", journal: true }), "conv-orb paused journal");
});

test("convLabelKeyFor returns today's keys for every phase", () => {
  const k = (phase, journal = false, muted = false, chunks = 0) => VoiceLogic.convLabelKeyFor({ phase, journal, muted, chunks });
  assert.equal(k("idle"), "conv.label.idle");
  assert.equal(k("listening"), "conv.label.listening");
  assert.equal(k("listening", true), "conv.label.recording");
  assert.equal(k("thinking"), "conv.label.thinking");
  assert.equal(k("speaking"), "conv.label.speaking");
  assert.equal(k("paused"), "conv.label.paused");
  assert.equal(k("paused", true, false, 0), "conv.label.hold-to-record");
  assert.equal(k("paused", true, false, 2), "conv.label.chunks-ready");
  assert.equal(k("captured", false, true), "conv.label.muted");
  assert.equal(k("captured"), "conv.label.captured");
  assert.equal(k("nonsense"), "");
});
