import assert from "node:assert/strict";
import { scenario } from "./voice-harness/baseline.mjs";

// Whisper, Android: tap, speak 1.5 s, silence → transcribe → chat → speak.
scenario("whisper-android-turn", { device: "android", inputMode: "whisper" }, async (app) => {
  await app.press("conv-btn");
  await app.advance(300);
  await app.say(1500);
  await app.advance(5000);
  assert.deepEqual(
    { t: app.counts["/transcribe"], c: app.counts["/chat"], s: app.counts["/speak"] },
    { t: 1, c: 1, s: 1 },
    "one turn = one transcription, one Claude request, one spoken reply",
  );
});

const W = { device: "android", inputMode: "whisper" };
const A = { device: "desktop", inputMode: "auto" };
const AND_AUTO = { device: "android", inputMode: "auto" };
const IPH = { device: "iphone", inputMode: "whisper" };
// Advance until the trace contains a matching entry, so a scenario acts in the
// state its name promises instead of at a guessed time.
const until = async (app, pred, maxMs = 5000) => {
  for (let t = 0; t <= maxMs; t += 50) { if (app.trace.some(pred)) return; await app.advance(50); }
  throw new Error("scenario precondition never reached");
};
const turn = async (app, ms = 5000) => { await app.press("conv-btn"); await app.advance(300); await app.say(1500); await app.advance(ms); };

scenario("whisper-mute-while-listening", W, async (app) => {
  await app.press("conv-btn"); await app.advance(300);
  await app.say(800);
  await app.click("conv-mute"); await app.advance(2000);
  await app.click("conv-mute"); await app.advance(500);
});

scenario("whisper-mute-at-silence-cutoff", W, async (app) => {
  // Mute at the same instant the silence window stops the recorder: today this
  // drops the turn (the recorder is restarted before its onstop runs).
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await app.advance(1000);
  await app.click("conv-mute"); await app.advance(5000);
});

scenario("whisper-mute-while-transcribing", W, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await until(app, e => e.k === "fetch" && e.path === "/transcribe");
  await app.click("conv-mute"); await app.advance(5000);
});

scenario("whisper-hard-stop-while-thinking", W, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await app.advance(1300);   // /transcribe done, /chat streaming
  await app.press("conv-orb"); await app.advance(3000);
});

scenario("whisper-hard-stop-while-speaking", W, async (app) => {
  await turn(app, 2300);     // reply is playing
  await app.press("conv-orb"); await app.advance(2000);
});

scenario("whisper-exit-mid-reply", W, async (app) => {
  await turn(app, 2300);
  await app.click("conv-exit"); await app.advance(1000);
});

scenario("allowance-on-speak-android", { ...W, fakes: { routes: { "/speak": "429" } } }, async (app) => { await turn(app, 6000); });
scenario("allowance-on-speak-iphone", { ...IPH, fakes: { routes: { "/speak": "429" } } }, async (app) => { await turn(app, 6000); });
scenario("ai-not-configured-on-speak", { ...W, fakes: { routes: { "/speak": "503" } } }, async (app) => { await turn(app, 6000); });

scenario("allowance-on-transcribe-twice", { ...W, fakes: { routes: { "/transcribe": "429" } } }, async (app) => {
  await turn(app, 2000);
  await app.press("conv-orb"); await app.advance(300); await app.say(1500); await app.advance(2000);
});

scenario("iphone-turn", IPH, async (app) => {
  await turn(app, 6000);
  // The mic pre-acquire must happen inside the pointerdown task (iOS user-activation rule).
  const d = app.trace.findIndex(e => e.k === "pointerdown" && e.el === "conv-btn");
  const de = app.trace.findIndex((e, i) => i > d && e.k === "pointerdown.end");
  assert.ok(app.trace.slice(d, de).some(e => e.k === "getUserMedia"), "getUserMedia inside pointerdown");
});

scenario("slow-mic-then-hard-stop-and-retap", { ...W, fakes: { gumDelayMs: 1500 } }, async (app) => {
  await app.press("conv-btn");           // mic still starting
  await app.press("conv-orb");           // hard stop
  await app.press("conv-orb");           // listen again while the first getUserMedia is pending
  await app.advance(3000);               // pins today's recorder count (race noted for stage 2)
});

scenario("auto-turn-two-finals", A, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  app.recognizer().result("Remind me"); await app.advance(300);
  app.recognizer().result("about Lily"); await app.advance(6000);
  assert.deepEqual({ c: app.counts["/chat"], t: app.counts["/transcribe"] || 0 }, { c: 1, t: 0 });
});

scenario("auto-no-speech-restart", AND_AUTO, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  app.recognizer().error("no-speech"); await app.advance(500);
});

scenario("auto-mute-then-speak", A, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  await app.click("conv-mute");
  app.recognizer().result("this should be dropped"); await app.advance(1500);
});

scenario("auto-mute-with-final-pending", A, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  app.recognizer().result("half a thought"); await app.advance(200);
  await app.click("conv-mute"); await app.advance(1500);
});

scenario("auto-unmute-restarts-recognizer", A, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  await app.click("conv-mute"); await app.advance(300);
  await app.click("conv-mute"); await app.advance(300);
});

scenario("auto-recognizer-ends-with-final-pending", A, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  app.recognizer().result("Remind me about Lily"); await app.advance(100);
  app.recognizer().end(); await app.advance(6000);
});

scenario("journal-whisper-hold-and-chunk", W, async (app) => {
  await app.press("conv-btn", 900);      // hold → journal
  await app.advance(200);
  app.down("conv-orb"); await app.say(2000); app.up("conv-orb");
  await app.advance(1000);
});

scenario("journal-whisper-finish", W, async (app) => {
  await app.press("conv-btn", 900); await app.advance(200);
  app.down("conv-orb"); await app.say(2000); app.up("conv-orb"); await app.advance(1000);
  await app.click("conv-finish"); await app.advance(3000);
});

scenario("journal-transcribe-refused-keeps-recording", { ...W, fakes: { routes: { "/transcribe": "429" } } }, async (app) => {
  await app.press("conv-btn", 900); await app.advance(200);
  app.down("conv-orb"); await app.say(2000); app.up("conv-orb"); await app.advance(1000);
});

scenario("journal-auto-ptt-cancel-keeps-hold", AND_AUTO, async (app) => {
  await app.press("conv-btn", 900); await app.advance(200);
  app.down("conv-orb"); await app.advance(700);
  app.recognizer().result("first part"); await app.advance(100);
  app.cancel("conv-orb"); await app.advance(300);
  app.recognizer().result("second part"); await app.advance(300);
  await app.press("conv-orb"); await app.advance(500);
});

// Re-pressing the orb while the previous PTT recogniser is still live: the new
// session must replace pttToken BEFORE abort(), whose onend fires synchronously.
scenario("journal-auto-ptt-repress-aborts-live-recognizer", AND_AUTO, async (app) => {
  await app.press("conv-btn", 900); await app.advance(200);
  app.down("conv-orb"); await app.advance(700);
  app.recognizer().result("first part"); await app.advance(100);
  app.cancel("conv-orb"); await app.advance(300);
  app.down("conv-orb"); await app.advance(700);
  app.recognizer().result("second part"); await app.advance(100);
  app.up("conv-orb"); await app.advance(500);
});

scenario("journal-auto-ptt-restart-mid-hold", AND_AUTO, async (app) => {
  await app.press("conv-btn", 900); await app.advance(200);
  app.down("conv-orb"); await app.advance(700);
  app.recognizer().result("before the pause"); await app.advance(100);
  app.recognizer().end(); await app.advance(600);      // mid-hold restart, past the echo guard
  app.recognizer().result("after the pause"); await app.advance(400);
  app.up("conv-orb"); await app.advance(500);
});

scenario("journal-auto-ptt-error-then-end", AND_AUTO, async (app) => {
  await app.press("conv-btn", 900); await app.advance(200);
  app.down("conv-orb"); await app.advance(700);
  app.recognizer().result("some words"); await app.advance(100);
  app.up("conv-orb");
  app.recognizer().error("network"); app.recognizer().end();   // onStop can run twice today
  await app.advance(500);
});

scenario("journal-still-there-path", AND_AUTO, async (app) => {
  // Synthetic: pins the request count of fireStillThere(), which would send a real /chat.
  // Reading the code, it looks unreachable: convListen() resets noSpeechCount to 0 on every
  // restart, and the no-speech error restarts it. The baseline records what really happens.
  await app.press("conv-btn"); await app.advance(100);
  app.w.eval("journalDictating = true");
  for (let i = 0; i < 3; i++) { app.recognizer().error("no-speech"); await app.advance(200); }
  await app.advance(4000);
});

scenario("backgrounded-while-listening", W, async (app) => {
  await app.press("conv-btn"); await app.advance(300);
  await app.setVisibility("hidden"); await app.advance(500);
});

scenario("auto-lock-mid-session", { ...W, storage: { whoszoo_timeout: "1" } }, async (app) => {
  await app.press("conv-btn"); await app.advance(300);
  await app.advance(125000);
});

scenario("write-proposal-in-conversation", { ...W, fakes: { reply: "Saving that. <memory-write>{\"action\":\"append\",\"file\":\"people.md\",\"section\":\"Lily\",\"content\":\"- Likes horses\"}</memory-write>" } }, async (app) => {
  await turn(app, 6000);
});

scenario("journal-auto-ptt-echo-guard", AND_AUTO, async (app) => {
  // A final arriving within 300 ms of a PTT session starting is treated as the
  // previous session's echo on phones: dropped, but its index still advances.
  await app.press("conv-btn", 900); await app.advance(200);
  app.down("conv-orb"); await app.advance(300);
  app.recognizer().result("echo of the last session"); await app.advance(600);
  app.recognizer().result("real words"); await app.advance(200);
  app.up("conv-orb"); await app.advance(500);
});

scenario("voice-logic-missing-app-still-starts", { ...W, omitScripts: ["voice-logic.js"] }, async (app) => {
  await app.press("conv-btn"); await app.advance(500);
  assert.equal(app.w.document.getElementById("conv-overlay").classList.contains("hidden"), true, "voice stays closed");
  assert.equal(app.counts["/transcribe"] || 0, 0);
});
