import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVoiceApp } from "./voice-harness/load.mjs";

// /diagnostics renders the worker's voiceUsage summary as plain lines.
test("diagnostics shows today's estimated voice allowance and the reset time", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    const lines = app.w.eval(`voiceUsageLines({ units: 4711, limit: 10000, pct: 47, speak: 25, transcribe: 22, limitHitAt: null, resetsInMinutes: 305 })`);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /about 4,711 of 10,000 free units \(47%\)/);
    assert.match(lines[0], /25 spoken replies, 22 transcriptions/);
    assert.match(lines[0], /resets in 5 h 5 min \(estimate\)/);
  } finally { app.close(); }
});

test("diagnostics warns when the free voice allowance ran out today", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    const lines = app.w.eval(`voiceUsageLines({ units: 10050, limit: 10000, pct: 101, speak: 1, transcribe: 1, limitHitAt: "2026-10-25T15:42:00.000Z", resetsInMinutes: 60 })`);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /1 spoken reply, 1 transcription/);
    assert.match(lines[1], /Free voice allowance used up at .* — voice is back after the reset/);
  } finally { app.close(); }
});
