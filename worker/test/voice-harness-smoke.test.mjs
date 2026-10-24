import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVoiceApp } from "./voice-harness/load.mjs";

test("the real app loads in jsdom without errors and reaches the login screen", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    assert.deepEqual(app.errors, [], "no script errors during load");
    assert.deepEqual(app.unrouted, [], "no unrouted requests during load");
    assert.equal(app.w.eval("typeof enterConvMode"), "function");
  } finally { app.close(); }
});

test("tapping the conversation button opens conversation mode and asks for the mic (Whisper, Android)", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    await app.press("conv-btn", 100);
    await app.advance(300);
    assert.equal(app.w.document.getElementById("conv-overlay").classList.contains("hidden"), false);
    assert.ok(app.trace.some(e => e.k === "getUserMedia"), "mic requested");
    assert.ok(app.trace.some(e => e.k === "recorder.start"), "recorder started");
    assert.deepEqual(app.errors, []);
  } finally { app.close(); }
});
