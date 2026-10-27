import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVoiceApp } from "./voice-harness/load.mjs";

// 2026-10-27: an answer about licence plates cited an invented group label,
// "Vehicle Details (Multiple Entries)". Nothing matched, so the user got a
// caution and no source cards at all. When EVERY citation fails, fall back to
// the content matcher (/attributeSources) and show what actually matches.
const VEHICLES = [{ file: "fragments.md", section: "Vehicles", preview: "Ridgeline 4X0EG · Civic U554YU" }];
const open = async (fakes) => {
  const app = await loadVoiceApp({ device: "desktop", inputMode: "auto", fakes });
  const msg = app.w.document.createElement("div");
  app.w.document.getElementById("messages").appendChild(msg);
  return { app, msg };
};
const showSources = async (app, msg, cited) => {
  app.w.__cited = cited;
  app.w.__msg = msg;
  app.w.eval(`appendSourcesFooter(__msg, "Honda Ridgeline: 4X0EG", "licence plates", __cited, true)`);
  msg.querySelector(".sources-link").click();
  await app.advance(1500);
};

test("an invented citation label falls back to the records that match the answer", async () => {
  const { app, msg } = await open({ routes: { "/getMemoryFile": "404" }, attributed: VEHICLES });
  try {
    await showSources(app, msg, [{ file: "fragments.md", section: "Vehicle Details (Multiple Entries)" }]);
    assert.equal(app.counts["/attributeSources"], 1, "the content matcher runs once");
    const cards = [...msg.querySelectorAll(".sources-results .delete-result-btn")].map(c => c.textContent);
    assert.equal(cards.length, 1);
    assert.match(cards[0], /Vehicles/);
    const notes = [...msg.querySelectorAll(".sources-zero")].map(n => n.textContent).join(" ");
    assert.match(notes, /isn't a record in your notes/);
    assert.match(notes, /Vehicle Details \(Multiple Entries\)/);
    assert.doesNotMatch(notes, /Treat what it said/, "real sources were found, so no blanket caution");
  } finally { app.close(); }
});

test("if the content matcher finds nothing either, the original caution stays", async () => {
  const { app, msg } = await open({ routes: { "/getMemoryFile": "404" }, attributed: [] });
  try {
    await showSources(app, msg, [{ file: "fragments.md", section: "Vehicle Details (Multiple Entries)" }]);
    const notes = [...msg.querySelectorAll(".sources-zero")].map(n => n.textContent).join(" ");
    assert.match(notes, /Cited by the answer but not found anywhere in your notes/);
  } finally { app.close(); }
});

test("a real citation is shown as before, with no extra content-matcher request", async () => {
  const { app, msg } = await open({});
  try {
    await showSources(app, msg, [{ file: "people.md", section: "Lily" }]);
    assert.equal(app.counts["/attributeSources"] || 0, 0);
    assert.equal(msg.querySelectorAll(".sources-results .delete-result-btn").length, 1);
  } finally { app.close(); }
});
