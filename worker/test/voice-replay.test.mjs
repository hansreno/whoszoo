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
  assert.ok(app.trace.some(e => e.k === "ui" && e.f === "label" && /Muted — tap/.test(e.v)), "muted label shown");
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
  assert.deepEqual({ c: app.counts["/chat"] || 0, s: app.counts["/speak"] || 0 }, { c: 0, s: 0 }, "a muted, unanswered sentence is cancelled");
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
  // Every recorder must record from a live stream: iOS releases the stream after
  // each turn, so a later turn needs a fresh one, never the first tap's promise.
  for (const [i, e] of app.trace.entries()) {
    if (e.k !== "recorder.new") continue;
    const stopped = app.trace.slice(0, i).some(x => x.k === "track.stop" && x.stream === e.stream);
    assert.equal(stopped, false, `recorder at ${e.t} ms uses stream ${e.stream}, already stopped`);
  }
});

scenario("slow-mic-then-hard-stop-and-retap", { ...W, fakes: { gumDelayMs: 1500 } }, async (app) => {
  await app.press("conv-btn");           // mic still starting
  await app.press("conv-orb");           // hard stop
  await app.press("conv-orb");           // listen again while the first getUserMedia is pending
  await app.advance(3000);               // pins today's recorder count (race noted for stage 2)
  assert.equal(app.trace.filter(e => e.k === "recorder.new").length, 1, "one recorder: the stale mic grant must not start a second");
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
  const muteAt = app.trace.findIndex(e => e.k === "click" && e.el === "conv-mute");
  assert.equal(app.trace.slice(muteAt).filter(e => e.k === "recognizer.new").length, 0, "no recogniser starts while muted");
});

scenario("auto-mute-with-final-pending", A, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  app.recognizer().result("half a thought"); await app.advance(200);
  await app.click("conv-mute"); await app.advance(1500);
  const shown = app.trace.filter(e => e.k === "ui" && e.f === "transcript");
  assert.equal(shown[shown.length - 1].v, "Muted — not sent", "half-heard words that will never be sent say so");
  const muteAt = app.trace.findIndex(e => e.k === "click" && e.el === "conv-mute");
  assert.equal(app.trace.slice(muteAt).filter(e => e.k === "recognizer.new").length, 0, "no recogniser starts while muted");
});

scenario("auto-unmute-restarts-recognizer", A, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  await app.click("conv-mute"); await app.advance(300);
  await app.click("conv-mute"); await app.advance(300);
  const clicks = app.trace.map((e, i) => (e.k === "click" && e.el === "conv-mute" ? i : -1)).filter(i => i >= 0);
  assert.equal(app.trace.slice(clicks[0], clicks[1]).filter(e => e.k === "recognizer.new").length, 0, "no recogniser while muted");
  assert.equal(app.trace.slice(clicks[1]).filter(e => e.k === "recognizer.new").length, 1, "unmute starts one fresh recogniser");
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

// ---- Stage 2, part A: turn ownership (recorded on v1.9.1 first) ----
const PROPOSAL = { reply: "Saving that. <memory-write>{\"action\":\"append\",\"file\":\"people.md\",\"section\":\"Lily\",\"content\":\"- Likes horses\"}</memory-write>" };

scenario("stale-speak-decode-hard-stop-retap", { ...W, fakes: { decodeDelayMs: 800 } }, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await until(app, e => e.k === "fetch" && e.path === "/speak");
  await app.advance(300);                // /speak answered, decode in progress
  await app.press("conv-orb");           // hard stop
  await app.press("conv-orb");           // listen again before the old decode finishes
  await app.advance(4000);
  const afterRetap = app.trace.slice(app.trace.findLastIndex(e => e.k === "pointerdown" && e.el === "conv-orb"));
  assert.equal(afterRetap.filter(e => e.k === "tts.play").length, 0, "the stale reply must not start playing after the re-tap");
  assert.equal(afterRetap.filter(e => e.k === "recorder.new").length, 1, "exactly one recorder for the new turn");
});

scenario("slow-mic-rejected-after-retap", { ...W, fakes: { gumPlan: [{ delayMs: 1500, reject: true }, { delayMs: 100 }] } }, async (app) => {
  await app.press("conv-btn");           // first mic request, slow, eventually refused
  await app.press("conv-orb");           // hard stop
  await app.press("conv-orb");           // re-tap: granted quickly; the stale refusal lands later
  await app.advance(3000);
  const refusedAt = app.trace.find(e => e.k === "getUserMedia.rejected").t;
  const after = app.trace.filter(e => e.t >= refusedAt && e.k === "ui");
  assert.equal(after.filter(e => e.f === "toast" && /denied/i.test(e.v)).length, 0, "a stale refusal must not show a denied toast over the live turn");
  assert.equal(after.filter(e => e.f === "label" && !/Listening/.test(e.v)).length, 0, "a stale refusal must not reset the label of the live turn");
});

scenario("auto-lock-during-slow-mic", { ...W, storage: { whoszoo_timeout: "1" }, fakes: { gumPlan: [{ delayMs: 130000 }] } }, async (app) => {
  await app.press("conv-btn");
  await app.advance(200000);             // the 1-minute lock fires at ~120 s; the mic grant arrives at ~130 s
  assert.equal(app.trace.filter(e => e.k === "recorder.new").length, 0, "no recorder may start behind the lock screen");
  const granted = app.trace.find(e => e.k === "getUserMedia.resolved");
  assert.ok(!granted || app.trace.some(e => e.k === "track.stop" && e.t >= granted.t), "a mic granted after the lock is released");
});

scenario("auto-lock-during-transcribe", { ...W, storage: { whoszoo_timeout: "1" }, fakes: { latencyMs: { "/transcribe": 130000 } } }, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await app.advance(200000);             // the 1-minute lock fires at ~120 s; the transcript arrives at ~130 s
  assert.equal(app.counts["/chat"] || 0, 0, "a transcript arriving after the lock must not reach Claude");
  assert.ok(app.trace.some(e => e.k === "fetch.aborted" && e.path === "/transcribe"), "the lock aborts the transcription");
});

const PROPOSAL_INSERT = { reply: "Saving that. <memory-write>{\"action\":\"insertSection\",\"filename\":\"people.md\",\"section\":\"## Mia\\n- Friend from school\"}</memory-write>" };

scenario("whisper-write-proposal-saved", { ...W, fakes: PROPOSAL_INSERT }, async (app) => {
  await turn(app, 6000);
  await app.click("preview-confirm"); await app.advance(3000);
  assert.equal(app.trace.filter(e => e.k === "recognizer.new").length, 0, "Whisper mode must never start a SpeechRecognition");
  assert.ok(app.trace.filter(e => e.k === "recorder.new").length >= 2, "listening resumes with a recorder");
});

scenario("whisper-write-proposal-cancelled", { ...W, fakes: PROPOSAL }, async (app) => {
  await turn(app, 6000);
  await app.click("preview-reject"); await app.advance(3000);
  assert.equal(app.trace.filter(e => e.k === "recognizer.new").length, 0, "Whisper mode must never start a SpeechRecognition");
  assert.ok(app.trace.filter(e => e.k === "recorder.new").length >= 2, "listening resumes with a recorder");
});

// ---- Milestone A final-review fixes ----
scenario("iphone-exit-during-slow-mic", { ...IPH, fakes: { gumDelayMs: 1500 } }, async (app) => {
  await app.press("conv-btn"); await app.advance(200);
  await app.click("conv-exit"); await app.advance(5000);
  const granted = app.trace.find(e => e.k === "getUserMedia.resolved");
  assert.ok(granted, "the slow grant arrives after Exit");
  assert.ok(app.trace.some(e => e.k === "track.stop" && e.t >= granted.t), "a mic granted after Exit is released (iOS mic indicator goes off)");
});

scenario("whisper-cancel-proposal-while-ready-speech", { ...W, fakes: PROPOSAL_INSERT }, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await until(app, e => e.k === "tts.play");
  await app.click("preview-reject"); await app.advance(3000);
  const orbs = app.trace.filter(e => e.k === "ui" && e.f === "orb");
  assert.match(orbs[orbs.length - 1].v, /listening/, "after Cancel the app keeps listening; a finished old reply must not flip it to idle");
});

scenario("whisper-hard-stop-during-starting", { ...W, fakes: { gumDelayMs: 1500 } }, async (app) => {
  await app.press("conv-btn"); await app.advance(200);
  await app.press("conv-orb"); await app.advance(3000);
  assert.equal(app.w.document.getElementById("conv-label").classList.contains("conv-label--starting"), false, "the Starting pulse ends once the stale grant is dropped");
});

// ---- Stage 2, part B: mute (recorded on v1.9.2 first) ----
scenario("auto-mute-while-speaking-reply-ends", AND_AUTO, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  app.recognizer().result("Remind me about Lily"); await app.advance(1000);
  await until(app, e => e.k === "tts.play");
  await app.click("conv-mute"); await app.advance(5000);
  const muteAt = app.trace.findIndex(e => e.k === "click" && e.el === "conv-mute");
  assert.equal(app.trace.slice(muteAt).filter(e => e.k === "recognizer.new").length, 0, "no recogniser starts while muted");
});

scenario("auto-mute-then-no-speech", AND_AUTO, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  await app.click("conv-mute"); await app.advance(200);
  app.recognizer().error("no-speech"); await app.advance(1000);
  const muteAt = app.trace.findIndex(e => e.k === "click" && e.el === "conv-mute");
  assert.equal(app.trace.slice(muteAt).filter(e => e.k === "recognizer.new").length, 0, "no recogniser starts while muted");
});

scenario("auto-mute-then-onend", AND_AUTO, async (app) => {
  await app.press("conv-btn"); await app.advance(100);
  await app.click("conv-mute"); await app.advance(200);
  app.recognizer().end(); await app.advance(1000);
  const muteAt = app.trace.findIndex(e => e.k === "click" && e.el === "conv-mute");
  assert.equal(app.trace.slice(muteAt).filter(e => e.k === "recognizer.new").length, 0, "no recogniser starts while muted");
});

scenario("whisper-mute-while-speaking-reply-ends", W, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await until(app, e => e.k === "tts.play");
  await app.click("conv-mute"); await app.advance(5000);
});

scenario("whisper-unmute-after-muted-wait", W, async (app) => {
  await app.press("conv-btn"); await app.advance(300);
  await app.click("conv-mute"); await app.say(1500); await app.advance(2000);
  await app.click("conv-mute"); await app.advance(300); await app.say(1500); await app.advance(5000);
});

scenario("iphone-mute-while-transcribing", IPH, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await until(app, e => e.k === "fetch" && e.path === "/transcribe");
  await app.clickMarked("conv-mute"); await app.advance(5000);
  assert.equal(app.counts["/chat"] || 0, 0, "cancelled: nothing sent to Claude");
  const c = app.trace.findIndex(e => e.k === "click" && e.el === "conv-mute");
  const ce = app.trace.findIndex(e => e.k === "click.end" && e.el === "conv-mute");
  assert.ok(c >= 0 && ce > c);
  assert.equal(app.trace.slice(c).filter(e => e.k === "getUserMedia" || e.k === "recorder.new").length, 0, "iPhone: muted means the mic stays off (no indicator) until unmute");
  assert.ok(app.trace.some(e => e.k === "ui" && e.f === "transcript" && e.v === "Muted — not sent"), "the cancelled sentence says so");
  assert.ok(app.trace.some(e => e.k === "ui" && e.f === "label" && /Muted — tap/.test(e.v)), "waits on the muted label");
});

scenario("iphone-mute-thinking-reply-unmute", IPH, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await until(app, e => e.k === "fetch" && e.path === "/chat");
  await app.click("conv-mute"); await app.advance(5000);
  await app.clickMarked("conv-mute"); await app.advance(1000);
  const firstClick = app.trace.findIndex(e => e.k === "click" && e.el === "conv-mute");
  const lastClick = app.trace.findLastIndex(e => e.k === "click" && e.el === "conv-mute");
  assert.equal(app.trace.slice(firstClick, lastClick).filter(e => e.k === "getUserMedia" || e.k === "recorder.new").length, 0, "iPhone: no mic is opened after the reply while muted");
  const lastEnd = app.trace.findLastIndex(e => e.k === "click.end" && e.el === "conv-mute");
  assert.ok(app.trace.slice(lastClick, lastEnd).some(e => e.k === "getUserMedia"), "unmute opens the mic inside the tap (iOS gesture rule)");
  assert.ok(app.trace.slice(lastClick).some(e => e.k === "recorder.new"), "unmute after a turn on iPhone starts listening");
});

scenario("whisper-mute-during-starting", { ...W, fakes: { gumDelayMs: 1500 } }, async (app) => {
  await app.press("conv-btn"); await app.advance(200);   // "Starting..."
  await app.click("conv-mute"); await app.advance(3000);
});

// ---- iPhone: spoken reply that can't start on its own (v1.9.4) ----
// Observed on real iPhones (2026-10-24): thinking chimes play, the spoken reply
// is silent, no error shown. Modelled as: switching the audio session to
// "playback" interrupts the running context and a resume outside a tap fails.
const IOS_INTERRUPT = { ...IPH, fakes: { audioSession: true, audioSessionInterrupts: "playback", resumeBlocked: true } };
const tapBtn = (app) => app.w.document.getElementById("conv-tap-to-hear");
const reasonEl = (app) => app.w.document.getElementById("conv-audio-reason");

scenario("iphone-reply-audio-interrupted-tap-to-hear", IOS_INTERRUPT, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await app.advance(4000);
  assert.ok(tapBtn(app) && !tapBtn(app).classList.contains("hidden"), "a Tap-to-hear button appears when the reply can't start on its own");
  assert.match(reasonEl(app).textContent, /interrupted/, "the reason line names the failed step");
  const speakAt = app.trace.findIndex(e => e.k === "fetch" && e.path === "/speak");
  assert.equal(app.trace.slice(speakAt).filter(e => e.k === "recorder.new").length, 0, "it waits for the tap instead of listening over the reply");
  await app.clickMarked("conv-tap-to-hear");
  const c = app.trace.findIndex(e => e.k === "click" && e.el === "conv-tap-to-hear");
  const ce = app.trace.findIndex(e => e.k === "click.end" && e.el === "conv-tap-to-hear");
  assert.ok(app.trace.slice(c, ce).some(e => e.k === "audio.play"), "playback starts inside the tap (iOS gesture rule)");
  await app.advance(3000);
  assert.ok(app.trace.slice(ce).some(e => e.k === "recorder.new"), "after the reply plays, listening resumes");
  assert.ok(tapBtn(app).classList.contains("hidden"));
});

scenario("iphone-reply-decode-fails-tap-to-hear", { ...IPH, fakes: { decodeFails: true } }, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await app.advance(4000);
  assert.ok(tapBtn(app) && !tapBtn(app).classList.contains("hidden"), "a Tap-to-hear button appears when the audio can't be decoded");
  assert.match(reasonEl(app).textContent, /decode/i);
});

scenario("iphone-tap-to-hear-then-hard-stop", IOS_INTERRUPT, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await app.advance(4000);
  await app.press("conv-orb"); await app.advance(2000);
  assert.ok(tapBtn(app).classList.contains("hidden"), "a hard stop removes the offer");
  assert.equal(app.trace.filter(e => e.k === "audio.play").length, 0);
  assert.ok(reasonEl(app).classList.contains("hidden"), "the diagnostic line goes with it");
});

// Real iPhones (2026-10-24): the thinking chime was inaudible and only its tail
// was heard as the reply switched to the speaker — the session was still
// "play-and-record" (earpiece) during thinking. Switch to playback the moment
// the mic is released, before the chime starts.
scenario("iphone-thinking-chime-on-speaker", { ...IPH, fakes: { audioSession: true } }, async (app) => {
  await app.press("conv-btn"); await app.advance(300); await app.say(1500);
  await app.advance(4000);
  const thinkingAt = app.trace.findIndex(e => e.k === "ui" && e.f === "label" && /Thinking/.test(e.v));
  const types = app.trace.slice(0, thinkingAt).filter(e => e.k === "audioSession.type").map(e => e.v);
  assert.equal(types[types.length - 1], "playback", "the session is on the speaker (playback) before the thinking chime starts");
});

// Review 2026-10-25: since v1.9.2 the lock aborts an in-flight transcription,
// and a journal chunk aborted that way was dropped silently. Never lose dictation.
scenario("journal-whisper-lock-during-transcribe-keeps-recording", { ...W, storage: { whoszoo_timeout: "1" }, fakes: { latencyMs: { "/transcribe": 130000 } } }, async (app) => {
  await app.press("conv-btn", 900); await app.advance(200);   // hold → journal
  app.down("conv-orb"); await app.say(2000); app.up("conv-orb");
  await app.advance(200000);                                  // lock at ~120 s, mid-transcription
  assert.ok(app.trace.some(e => e.k === "system" && /couldn't be transcribed, so it has been kept/.test(e.v)), "the aborted journal chunk is kept for download");
});

// ---- Review follow-ups (v1.9.7) ----
// iPhone: muting releases the mic completely (no orange indicator); unmute is a
// tap, which is exactly where iOS allows getUserMedia.
scenario("iphone-mute-while-listening-releases-mic", IPH, async (app) => {
  await app.press("conv-btn"); await app.advance(300);
  await app.click("conv-mute"); await app.advance(2000);
  const muteAt = app.trace.findIndex(e => e.k === "click" && e.el === "conv-mute");
  assert.ok(app.trace.slice(muteAt).some(e => e.k === "track.stop"), "the mic track is stopped while muted");
  await app.clickMarked("conv-mute"); await app.advance(500);
  const c = app.trace.findLastIndex(e => e.k === "click" && e.el === "conv-mute");
  const ce = app.trace.findLastIndex(e => e.k === "click.end" && e.el === "conv-mute");
  assert.ok(app.trace.slice(c, ce).some(e => e.k === "getUserMedia"), "unmute re-opens the mic inside the tap");
  assert.ok(app.trace.slice(c).some(e => e.k === "recorder.new"), "and listens again");
});

// iPhone: leaving voice mode hands the audio session back (silent switch, other apps' audio).
scenario("iphone-exit-resets-audio-session", { ...IPH, fakes: { audioSession: true } }, async (app) => {
  await app.press("conv-btn"); await app.advance(300);
  await app.click("conv-exit"); await app.advance(300);
  const types = app.trace.filter(e => e.k === "audioSession.type").map(e => e.v);
  assert.equal(types[types.length - 1], "auto", "exit restores the default audio session");
});

scenario("iphone-lock-resets-audio-session", { ...IPH, storage: { whoszoo_timeout: "1" }, fakes: { audioSession: true } }, async (app) => {
  await app.press("conv-btn"); await app.advance(300);
  await app.advance(130000);
  const types = app.trace.filter(e => e.k === "audioSession.type").map(e => e.v);
  assert.equal(types[types.length - 1], "auto", "the lock restores the default audio session");
});

// Journal chunks recorded before an auto-lock are offered back after unlock.
scenario("journal-draft-offered-after-lock", { ...W, storage: { whoszoo_timeout: "1" } }, async (app) => {
  await app.press("conv-btn", 900); await app.advance(200);
  app.down("conv-orb"); await app.say(2000); app.up("conv-orb");
  await app.advance(3000);                       // chunk transcribed and saved as a draft
  await app.advance(130000);                     // auto-lock
  app.w.eval("offerJournalDraftRestore()");      // what both unlock paths now call on resume
  await app.advance(100);
  assert.ok(app.trace.some(e => e.k === "system" && /journal session from .* was interrupted/i.test(e.v)), "restore offered after the lock");
});

// ---- ElevenLabs runs out (v1.9.9): fall back to something that works ----
const BRITTNEY = { whoszoo_voice: "brittney" };
scenario("android-elevenlabs-credits-fallback-to-asteria", { ...W, storage: BRITTNEY, fakes: { routes: { "/speak": "fallback-credits" } } }, async (app) => {
  await turn(app, 5000);
  assert.ok(app.trace.some(e => e.k === "tts.play"), "the reply is still spoken (Asteria, via the worker)");
  assert.ok(app.trace.some(e => e.k === "system" && /ElevenLabs credits are used up/.test(e.v)), "says why, in the chat");
});

scenario("iphone-elevenlabs-and-cloudflare-both-out", { ...IPH, storage: BRITTNEY, fakes: { routes: { "/speak": "credits-exhausted" } } }, async (app) => {
  await turn(app, 5000);
  assert.equal(app.trace.filter(e => e.k === "browserVoice.speak").length, 0, "iPhone: no silent device-voice attempt");
  assert.ok(app.trace.some(e => e.k === "system" && /ElevenLabs credits are used up/.test(e.v)), "says why");
  const speakAt = app.trace.findIndex(e => e.k === "fetch" && e.path === "/speak");
  const nextRec = app.trace.findIndex((e, i) => i > speakAt && e.k === "recorder.new");
  assert.ok(nextRec > speakAt && app.trace[nextRec].t - app.trace[speakAt].t < 2000, "back to listening quickly, not after a minute");
});
