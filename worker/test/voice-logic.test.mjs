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

const MA = (o) => VoiceLogic.muteActions({ mode: "whisper", phase: "listening", muted: true, transcribing: false, hasRecorder: true, hasStream: true, ...o });

test("muteActions, Whisper muting while listening: gate the track and restart the recorder", () => {
  assert.deepEqual(MA({}), ["gateTrack", "restartRecorder"]);
});
test("muteActions, Whisper muting while transcribing: cancel it and resume listening muted", () => {
  assert.deepEqual(MA({ phase: "thinking", transcribing: true, hasRecorder: false }), ["gateTrack", "cancelTranscription", "resumeListening"]);
});
test("muteActions, iPhone muting while transcribing (stream already released): no gate, still cancel and resume", () => {
  assert.deepEqual(MA({ phase: "thinking", transcribing: true, hasRecorder: false, hasStream: false }), ["cancelTranscription", "resumeListening"]);
});
test("muteActions, Whisper muting while thinking or speaking: gate only (the reply plays)", () => {
  assert.deepEqual(MA({ phase: "speaking", hasRecorder: false }), ["gateTrack"]);
  assert.deepEqual(MA({ phase: "thinking", hasRecorder: false, hasStream: false }), []);
});
test("muteActions, Whisper muting during Starting (no stream yet): nothing; the grant applies the gate", () => {
  assert.deepEqual(MA({ hasRecorder: false, hasStream: false }), []);
});
test("muteActions, Whisper unmuting while listening with a recorder: gate and restart", () => {
  assert.deepEqual(MA({ muted: false }), ["gateTrack", "restartRecorder"]);
});
test("muteActions, Whisper unmuting while listening without a recorder (iPhone after a turn): resume listening", () => {
  assert.deepEqual(MA({ muted: false, hasRecorder: false, hasStream: false }), ["resumeListening"]);
});
test("muteActions, Whisper unmuting while speaking: gate only", () => {
  assert.deepEqual(MA({ muted: false, phase: "speaking", hasRecorder: false }), ["gateTrack"]);
});
test("muteActions, Auto muting while listening: stop the recogniser", () => {
  assert.deepEqual(MA({ mode: "auto" }), ["stopRecognizer"]);
});
test("muteActions, Auto muting while thinking or speaking: nothing (the convListen gate covers the restart)", () => {
  assert.deepEqual(MA({ mode: "auto", phase: "speaking" }), []);
});
test("muteActions, Auto unmuting while listening: fresh recogniser", () => {
  assert.deepEqual(MA({ mode: "auto", muted: false }), ["startRecognizer"]);
});
test("muteActions, Auto unmuting while speaking: nothing", () => {
  assert.deepEqual(MA({ mode: "auto", muted: false, phase: "speaking" }), []);
});
test("orbClassFor dims the orb only while listening muted outside journal", () => {
  assert.equal(VoiceLogic.orbClassFor({ phase: "listening", journal: false, muted: true }), "conv-orb listening muted");
  assert.equal(VoiceLogic.orbClassFor({ phase: "speaking", journal: false, muted: true }), "conv-orb speaking");
  assert.equal(VoiceLogic.orbClassFor({ phase: "listening", journal: true, muted: true }), "conv-orb listening journal");
});
test("convLabelKeyFor shows the muted label while listening muted", () => {
  assert.equal(VoiceLogic.convLabelKeyFor({ phase: "listening", journal: false, muted: true, chunks: 0 }), "conv.label.muted-listening");
  assert.equal(VoiceLogic.convLabelKeyFor({ phase: "listening", journal: true, muted: true, chunks: 0 }), "conv.label.recording");
  assert.equal(VoiceLogic.convLabelKeyFor({ phase: "listening", journal: false, muted: false, chunks: 0 }), "conv.label.listening");
});

const MI = (o) => VoiceLogic.muteActions({ mode: "whisper", phase: "listening", muted: true, transcribing: false, hasRecorder: true, hasStream: true, releaseWhileMuted: true, ...o });
test("muteActions, iPhone muting while listening: release the mic and wait muted", () => {
  assert.deepEqual(MI({}), ["releaseMic", "waitMuted"]);
});
test("muteActions, iPhone muting while transcribing: cancel and wait muted, no re-acquire", () => {
  assert.deepEqual(MI({ phase: "thinking", transcribing: true, hasRecorder: false, hasStream: false }), ["cancelTranscription", "waitMuted"]);
});
test("muteActions, iPhone muting while speaking with a stream: release it", () => {
  assert.deepEqual(MI({ phase: "speaking", hasRecorder: false }), ["releaseMic"]);
});
test("muteActions, iPhone unmuting while waiting muted (no mic): resume listening in the tap", () => {
  assert.deepEqual(MI({ muted: false, hasRecorder: false, hasStream: false }), ["resumeListening"]);
});
