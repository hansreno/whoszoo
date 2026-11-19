import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVoiceApp } from "./voice-harness/load.mjs";

// v1.9.12: screen timeout / power button during voice mode (2026-11-18 report:
// after unlocking, the mic still heard but the reply no longer came from the
// phone's speaker). Voice mode keeps the screen on; turning the screen off
// stops the turn cleanly whatever phase it was in, releases the mic, and the
// next orb tap starts over with a fresh mic and a fresh audio player.

const after = (app, mark) => app.trace.slice(mark);
const has = (entries, k, extra = {}) => entries.some((e) => e.k === k && Object.entries(extra).every(([a, b]) => e[a] === b));
async function until(app, pred, maxMs = 15000) {
  for (let waited = 0; waited < maxMs; waited += 50) {
    if (app.trace.some(pred)) return;
    await app.advance(50);
  }
  throw new Error("condition never met");
}
const orb = (app) => app.w.document.getElementById("conv-orb").className;

test("voice mode keeps the screen on and lets it go on exit", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { wakeLock: true } });
  try {
    await app.press("conv-btn"); await app.advance(300);
    assert.ok(has(app.trace, "wakeLock.request", { type: "screen" }));
    const m = app.trace.length;
    await app.click("conv-exit");
    assert.ok(has(after(app, m), "wakeLock.release"));
  } finally { app.close(); }
});

test("the screen lock is asked for again when the page comes back in voice mode", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { wakeLock: true } });
  try {
    await app.press("conv-btn"); await app.advance(300);
    await app.setVisibility("hidden");
    const m = app.trace.length;
    await app.setVisibility("visible"); await app.advance(100);
    assert.ok(has(after(app, m), "wakeLock.request"));
  } finally { app.close(); }
});

test("no wake lock API: voice mode still works", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    await app.press("conv-btn"); await app.advance(300);
    await app.say(1500); await app.advance(5000);
    assert.ok(has(app.trace, "tts.play"));
    assert.deepEqual(app.errors, []);
  } finally { app.close(); }
});

test("screen off while thinking (Android): reply cancelled, mic released, nothing plays or listens until a tap", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { latencyMs: { "/chat": 2000 } } });
  try {
    await app.press("conv-btn"); await app.advance(300);
    await app.say(1500);
    await until(app, (e) => e.k === "fetch" && e.path === "/chat");
    const m = app.trace.length;
    await app.setVisibility("hidden"); await app.advance(6000);
    const a = after(app, m);
    assert.ok(has(a, "fetch.aborted", { path: "/chat" }), "the /chat request is cancelled");
    assert.ok(has(a, "track.stop"), "the mic is released");
    assert.ok(!has(a, "tts.play") && !has(a, "browserVoice.speak"), "nothing is spoken with the screen off");
    assert.ok(!has(a, "getUserMedia") && !has(a, "recorder.start"), "it does not listen with the screen off");
    assert.match(orb(app), /paused/);
    // Unlock: still waiting for a tap, then a fresh mic and a fresh audio player.
    await app.setVisibility("visible"); await app.advance(2000);
    assert.ok(!has(after(app, m), "getUserMedia"));
    const t = app.trace.length;
    await app.press("conv-orb"); await app.advance(300);
    assert.ok(has(after(app, t), "audioContext.new"), "a fresh audio player is made inside the tap");
    assert.ok(has(after(app, t), "getUserMedia"), "a fresh mic is opened");
  } finally { app.close(); }
});

test("screen off while the reply is playing (Android): playback stops and the mic is released", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    await app.press("conv-btn"); await app.advance(300);
    await app.say(1500);
    await until(app, (e) => e.k === "tts.play");
    const m = app.trace.length;
    await app.setVisibility("hidden"); await app.advance(4000);
    const a = after(app, m);
    assert.ok(has(a, "tts.stop"));
    assert.ok(has(a, "track.stop"));
    assert.ok(!has(a, "recorder.start"));
    assert.match(orb(app), /paused/);
  } finally { app.close(); }
});

test("screen off in Auto mode: the recogniser stops and is not restarted while the screen is off", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "auto" });
  try {
    await app.press("conv-btn"); await app.advance(300);
    const m = app.trace.length;
    await app.setVisibility("hidden");
    app.recognizer().end(); // Chrome ends recognition when the page is hidden
    await app.advance(3000);
    const a = after(app, m);
    assert.ok(!has(a, "recognizer.start"), "no restart with the screen off");
    assert.match(orb(app), /paused/);
  } finally { app.close(); }
});

test("screen off mid-sentence (iPhone): mic released and the audio goes back to the loudspeaker", async () => {
  const app = await loadVoiceApp({ device: "iphone", inputMode: "whisper", fakes: { audioSession: true } });
  try {
    await app.press("conv-btn"); await app.advance(300);
    await app.say(400);
    const m = app.trace.length;
    await app.setVisibility("hidden"); await app.advance(1000);
    const a = after(app, m);
    assert.ok(has(a, "track.stop"));
    assert.ok(has(a, "audioSession.type", { v: "playback" }));
    assert.ok(!has(a, "fetch"), "the half sentence is not sent");
  } finally { app.close(); }
});

test("a Bluetooth change between turns releases the open mic at once (Android)", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    await app.press("conv-btn"); await app.advance(300);
    await app.say(1500);
    await until(app, (e) => e.k === "tts.play");
    const m = app.trace.length;
    app.ctl.deviceChange(); await app.advance(100);
    assert.ok(has(after(app, m), "track.stop"), "the old mic is let go so the phone can re-route");
    await app.advance(3000);
    assert.ok(has(after(app, m), "getUserMedia"), "the next turn opens a fresh mic");
  } finally { app.close(); }
});

test("a Bluetooth change while recording keeps the sentence, then the next turn opens a fresh mic", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    await app.press("conv-btn"); await app.advance(300);
    const m = app.trace.length;
    app.ctl.setLevel(0.05); await app.advance(300);
    app.ctl.deviceChange(); await app.advance(300);
    assert.ok(!has(after(app, m), "track.stop"), "the sentence in progress is not cut off");
    app.ctl.setLevel(0);
    await until(app, (e) => e.k === "tts.play");
    const t = app.trace.length;
    await app.advance(3000);
    assert.ok(has(after(app, t), "getUserMedia"), "the next turn does not reuse the old mic");
  } finally { app.close(); }
});

test("the v1.9.11 mic diagnostic line is gone", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    assert.equal(app.w.document.getElementById("conv-mic-info"), null);
  } finally { app.close(); }
});
