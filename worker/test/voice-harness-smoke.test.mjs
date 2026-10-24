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

test("fakes: gumPlan entries are consumed per getUserMedia call and can reject", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { gumPlan: [{ delayMs: 100 }, { delayMs: 50, reject: true }] } });
  try {
    const md = app.w.navigator.mediaDevices;
    const first = md.getUserMedia({ audio: true });
    const second = md.getUserMedia({ audio: true }).then(() => "resolved", (e) => e.name);
    await app.advance(200);
    assert.ok(await first);
    assert.equal(await second, "NotAllowedError");
    assert.ok(app.trace.some(e => e.k === "getUserMedia.rejected"));
  } finally { app.close(); }
});

test("fakes: latencyMs delays a routed request", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { latencyMs: { "/transcribe": 1000 } } });
  try {
    let done = false;
    app.w.fetch("https://example.test/transcribe", { method: "POST" }).then(() => { done = true; });
    await app.advance(600);
    assert.equal(done, false, "still pending at 600 ms");
    await app.advance(500);
    assert.equal(done, true, "resolved by 1100 ms");
  } finally { app.close(); }
});

test("fakes: write endpoints answer ok", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    let res = null;
    app.w.fetch("https://example.test/patchMemoryFile", { method: "POST" }).then((r) => { res = r; }, () => {});
    await app.advance(400);
    assert.deepEqual(app.unrouted, []);
    assert.ok(res && res.ok);
  } finally { app.close(); }
});

test("clickMarked records click.end after everything the click ran synchronously", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    await app.clickMarked("conv-btn");
    const i = app.trace.findIndex(e => e.k === "click");
    const j = app.trace.findIndex(e => e.k === "click.end");
    assert.ok(i >= 0 && j > i);
  } finally { app.close(); }
});

test("fakes: a disabled (muted) mic track reads as silence, like a real browser", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    const md = app.w.navigator.mediaDevices;
    const p = md.getUserMedia({ audio: true });
    await app.advance(50);
    const stream = await p;
    const ctx = new app.w.AudioContext();
    const an = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(4);
    app.ctl.setLevel(0.5);
    an.getFloatTimeDomainData(buf);
    assert.equal(buf[0], 0.5, "live track hears the level");
    stream.getTracks()[0].enabled = false;
    an.getFloatTimeDomainData(buf);
    assert.equal(buf[0], 0, "disabled track is silent");
  } finally { app.close(); }
});
