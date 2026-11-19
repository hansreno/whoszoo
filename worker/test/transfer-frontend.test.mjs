import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadVoiceApp } from "./voice-harness/load.mjs";

// v1.9.13: /transfer — send the conversation (screen + Claude's history) to
// another device, and pick it up there from a card after unlocking.

const after = (app, mark) => app.trace.slice(mark);
const has = (entries, k, extra = {}) => entries.some((e) => e.k === k && Object.entries(extra).every(([a, b]) => e[a] === b));
const bodies = (app) => app.trace.filter((e) => e.k === "fetch.body" && e.path === "/transfer").map((e) => e.body);
const systemTexts = (app) => [...app.w.document.querySelectorAll("#messages .message.system")].map((el) => el.textContent);
const bubbleCount = (app) => app.w.document.querySelectorAll("#messages .message").length;

function seedConversation(app) {
  app.w.eval(`
    messages = [
      { role: "user", content: "Who is Kelsey?" },
      { role: "assistant", content: "That's Kelsey Hanna, Senior UI/UX." },
    ];
    appendMessage("user", "Who is Kelsey?");
    appendMessage("assistant", "That's Kelsey Hanna, Senior UI/UX.");
  `);
}

async function typeAndSend(app, text) {
  app.w.document.getElementById("input").value = text;
  await app.click("send-btn");
  await app.advance(1000);
}

test("/transfer sends the screen and the history", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    seedConversation(app);
    app.w.eval(`appendMessage("system", "Found 2 records")`);
    const before = bubbleCount(app);
    await typeAndSend(app, "/transfer");
    const [body] = bodies(app);
    assert.ok(body, "a /transfer POST was made");
    assert.ok(body.screen.some((s) => s.kind === "system" && s.text === "Found 2 records"));
    assert.ok(body.screen.some((s) => s.kind === "assistant" && s.text === "That's Kelsey Hanna, Senior UI/UX."));
    assert.equal(body.messages.length, 2);
    assert.equal(body.fromLabel, "phone");
    assert.equal(typeof body.fromDeviceId, "string");
    assert.equal(bubbleCount(app), before + 2, "only the echoed command and the confirmation are added");
    assert.match(systemTexts(app).at(-1), /Sent\. Open WhosWhoZoo/);
    assert.equal(app.w.eval("messages.length"), 2, "the sending device keeps its copy");
  } finally { app.close(); }
});

test("bubbles from before a context reset are sent", async () => {
  const app = await loadVoiceApp({ device: "desktop", inputMode: "auto" });
  try {
    seedConversation(app);
    app.w.eval(`resetContext(); messages = [{ role: "user", content: "And Greg?" }, { role: "assistant", content: "Greg Tanner works in Finance." }]; appendMessage("user", "And Greg?"); appendMessage("assistant", "Greg Tanner works in Finance.");`);
    await typeAndSend(app, "/transfer");
    const [body] = bodies(app);
    const kinds = body.screen.map((s) => s.kind);
    assert.ok(body.screen.some((s) => s.text === "That's Kelsey Hanna, Senior UI/UX."), "pre-reset text is on screen");
    assert.ok(kinds.includes("divider"));
    assert.ok(kinds.indexOf("divider") < body.screen.findIndex((s) => s.text === "And Greg?"));
    assert.equal(body.messages.length, 2, "history holds only post-reset turns");
    assert.equal(body.fromLabel, "computer");
  } finally { app.close(); }
});

test("buttons, sources and images are not captured", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    seedConversation(app);
    app.w.eval(`
      const el = appendMessage("assistant", "Here is Greg.");
      const b = document.createElement("button"); b.textContent = "View sources"; el.appendChild(b);
      const img = document.createElement("img"); img.alt = "photo of Greg"; el.appendChild(img);
    `);
    await typeAndSend(app, "/transfer");
    const [body] = bodies(app);
    const greg = body.screen.find((s) => s.text.startsWith("Here is Greg."));
    assert.equal(greg.text, "Here is Greg.");
    assert.ok(!JSON.stringify(body.screen).includes("View sources"));
  } finally { app.close(); }
});

test("image data never leaves the device", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    app.w.eval(`
      messages = [
        { role: "user", content: [{ type: "text", text: "Who is this?" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJDREVGRw==" } }] },
        { role: "assistant", content: "That's Greg." },
      ];
      appendMessage("assistant", "That's Greg.");
    `);
    await typeAndSend(app, "/transfer");
    const json = JSON.stringify(bodies(app)[0]);
    assert.ok(!json.includes("QUJDREVGRw=="));
    assert.ok(!json.includes('"source"'));
    assert.ok(json.includes("Photo attached on the other device"));
    assert.equal(app.w.eval("messages[0].content[1].type"), "image", "the local history is not changed");
  } finally { app.close(); }
});

test("an empty conversation sends nothing", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    app.w.eval(`messagesEl.innerHTML = ""; messages = [];`);
    const m = app.trace.length;
    await typeAndSend(app, "/transfer");
    assert.ok(!has(after(app, m), "fetch", { path: "/transfer" }));
    assert.match(systemTexts(app).at(-1), /Nothing to transfer/);
  } finally { app.close(); }
});

test("/transfer in a dead spot says it couldn't send and changes nothing", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { routes: { "/transfer": "error" } } });
  try {
    seedConversation(app);
    const before = bubbleCount(app);
    await typeAndSend(app, "/transfer");
    assert.match(systemTexts(app).at(-1), /Couldn't send/);
    assert.equal(bubbleCount(app), before + 2);
    assert.equal(app.w.eval("messages.length"), 2);
  } finally { app.close(); }
});

test("/transfer of a conversation that is too long says so", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { routes: { "/transfer": "413" } } });
  try {
    seedConversation(app);
    await typeAndSend(app, "/transfer");
    assert.match(systemTexts(app).at(-1), /too long to transfer/);
  } finally { app.close(); }
});

test("/transfer is listed in the command menu as free", () => {
  const app = readFileSync(new URL("../../frontend/app.js", import.meta.url), "utf8");
  assert.match(app, /\{ cmd: "\/transfer",\s+desc: t\("cmd\.desc\.transfer"\) \}/);
});

// ---- Picking up ----

const card = (app) => app.w.document.getElementById("transfer-card");
function pending(app, over = {}) {
  const now = app.w.eval("Date.now()");
  app.ctl.cfg.transferPending = { ok: true, pending: true, fromLabel: "computer", fromDeviceId: "other", sentAt: now - 12 * 60000, ...over };
  return app.ctl.cfg.transferPending;
}
function waiting(app, over = {}) {
  const meta = pending(app);
  app.ctl.cfg.transferPayload = {
    messages: [{ role: "user", content: "Who is Kelsey?" }, { role: "assistant", content: "That's Kelsey Hanna." }],
    screen: [
      { kind: "system", text: "Found 2 records" },
      { kind: "divider", text: "" },
      { kind: "user", text: "Who is Kelsey?" },
      { kind: "assistant", text: "That's Kelsey Hanna." },
    ],
    contextTokens: 5000, historyTokens: 400, archiveMode: 0, attachments: [],
    fromLabel: "computer", fromDeviceId: "other", sentAt: meta.sentAt,
    ...over,
  };
}
async function foreground(app) {
  await app.setVisibility("hidden");
  await app.setVisibility("visible");
  await app.advance(1000);
}

test("the card appears when the app comes back to the foreground", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    pending(app);
    await foreground(app);
    assert.ok(card(app), "card shown");
    assert.match(card(app).textContent, /Conversation from your computer · 12 min ago/);
  } finally { app.close(); }
});

test("the card appears after unlocking a locked session", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    seedConversation(app);
    pending(app);
    app.w.eval("lockApp()");
    await app.advance(100);
    const m = app.trace.length;
    app.w.document.getElementById("login-passphrase").value = "correct horse battery";
    await app.click("login-btn");
    await app.advance(1500);
    assert.ok(has(after(app, m), "fetch", { path: "/transfer" }));
    assert.ok(card(app), "card shown after unlock");
  } finally { app.close(); }
});

test("no card for a transfer sent from this device", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    pending(app, { fromDeviceId: app.w.eval("transferDeviceId()") });
    await foreground(app);
    assert.equal(card(app), null);
  } finally { app.close(); }
});

test("no card in voice mode", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    pending(app);
    await app.press("conv-btn"); await app.advance(300);
    const m = app.trace.length;
    await foreground(app);
    assert.ok(!has(after(app, m), "fetch", { path: "/transfer" }));
    assert.equal(card(app), null);
  } finally { app.close(); }
});

test("Open replaces the conversation with the transferred one", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    app.w.eval(`messages = [1,2,3,4].map(i => ({ role: i % 2 ? "user" : "assistant", content: "old " + i })); appendMessage("user", "old");`);
    waiting(app);
    await foreground(app);
    await app.click("transfer-open");
    await app.advance(1000);
    const doc = app.w.document;
    const texts = [...doc.querySelectorAll("#messages .message")].map((el) => el.textContent);
    assert.ok(!texts.includes("old"));
    const order = ["Found 2 records", "Who is Kelsey?", "That's Kelsey Hanna."].map((s) => texts.indexOf(s));
    assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], JSON.stringify(texts));
    assert.equal(doc.querySelectorAll("#messages .context-divider").length, 1);
    assert.match(texts.at(-1), /Continued from your computer · sent 12 min ago/);
    assert.equal(app.w.eval("messages.length"), 2);
    assert.equal(app.w.eval("_contextTokens"), 5000);
    assert.equal(doc.querySelectorAll("#messages .message button").length, 0);
    assert.equal(card(app), null);
  } finally { app.close(); }
});

test("Open applies the archive setting", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    app.w.eval("archiveMode = 0");
    waiting(app, { archiveMode: 1 });
    await foreground(app);
    await app.click("transfer-open");
    await app.advance(1000);
    assert.equal(app.w.eval("archiveMode"), 1);
  } finally { app.close(); }
});

test("Open renders stored text as text, never as markup", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    const evil = "<img src=x onerror=alert(1)>";
    waiting(app, { screen: [{ kind: "assistant", text: evil }] });
    await foreground(app);
    await app.click("transfer-open");
    await app.advance(1000);
    const doc = app.w.document;
    assert.equal(doc.querySelectorAll("#messages img").length, 0);
    assert.ok([...doc.querySelectorAll("#messages .message.assistant")].some((el) => el.textContent === evil));
  } finally { app.close(); }
});

test("Not now keeps it waiting and doesn't ask again for the same transfer", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    const meta = pending(app);
    await foreground(app);
    const m = app.trace.length;
    await app.click("transfer-not-now");
    assert.equal(card(app), null);
    assert.ok(!has(after(app, m), "fetch", { path: "/transferClaim" }));
    await foreground(app);
    assert.equal(card(app), null, "same transfer: no card again");
    pending(app, { sentAt: meta.sentAt + 60000 });
    await foreground(app);
    assert.ok(card(app), "a newer transfer shows the card again");
  } finally { app.close(); }
});

test("Open after it was picked up elsewhere says so and keeps the chat", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    seedConversation(app);
    pending(app);
    app.ctl.cfg.transferPayload = null;
    await foreground(app);
    await app.click("transfer-open");
    await app.advance(1000);
    assert.equal(card(app), null);
    assert.match(systemTexts(app).at(-1), /isn't waiting any more/);
    assert.ok([...app.w.document.querySelectorAll("#messages .message")].some((el) => el.textContent === "Who is Kelsey?"));
    assert.equal(app.w.eval("messages.length"), 2);
  } finally { app.close(); }
});

test("an expired session shows no card and no message", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { routes: { "/transfer": "401" } } });
  try {
    const before = systemTexts(app).length;
    await foreground(app);
    assert.equal(card(app), null);
    assert.equal(systemTexts(app).length, before);
    assert.deepEqual(app.errors, []);
  } finally { app.close(); }
});

test("no card while a reply is still streaming", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    pending(app);
    app.w.eval(`stopBtn.classList.remove("hidden")`);
    const m = app.trace.length;
    await foreground(app);
    assert.ok(!has(after(app, m), "fetch", { path: "/transfer" }));
    assert.equal(card(app), null);
  } finally { app.close(); }
});

test("every unlock path checks for a transfer", () => {
  const src = readFileSync(new URL("../../frontend/app.js", import.meta.url), "utf8");
  const start = src.indexOf("async function startSession(");
  const brief = src.indexOf("checkDailyBrief();", start);
  assert.ok(start > 0 && brief > start);
  assert.ok(src.slice(brief, brief + 200).includes("checkPendingTransfer()"), "startSession checks right after the daily brief");
  const resumes = [...src.matchAll(/if \(isResume\) \{([\s\S]*?)\} else \{/g)];
  assert.equal(resumes.length, 2, "two resume branches");
  for (const r of resumes) assert.ok(r[1].includes("checkPendingTransfer()"), "resume branch checks");
});

// ---- Voice mode ----

async function until(app, pred, maxMs = 15000) {
  for (let waited = 0; waited < maxMs; waited += 50) {
    if (app.trace.some(pred)) return;
    await app.advance(50);
  }
  throw new Error("condition never met");
}

test("the voice-mode button sends without interrupting listening", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    await app.press("conv-btn"); await app.advance(300);
    await app.say(1500);
    await until(app, (e) => e.k === "tts.play");
    const p = app.trace.length;
    await until(app, (e) => app.trace.indexOf(e) >= p && e.k === "recorder.start");
    const m = app.trace.length;
    await app.click("conv-transfer-btn");
    await app.advance(1000);
    const a = after(app, m);
    const body = bodies(app).at(-1);
    assert.ok(body && body.messages.length >= 2, "the conversation was sent");
    for (const k of ["track.stop", "recorder.stop", "getUserMedia"]) assert.ok(!has(a, k), `no ${k}`);
    for (const path of ["/chat", "/speak", "/transcribe"]) assert.ok(!has(a, "fetch", { path }), `no ${path}`);
    assert.ok(a.some((e) => e.k === "ui" && e.f === "toast" && /Sent\. Open WhosWhoZoo/.test(e.v)), "toast shown");
    assert.ok(!app.w.document.getElementById("conv-overlay").classList.contains("hidden"), "still in voice mode");
  } finally { app.close(); }
});

test("the transfer survives leaving voice mode with Token Saver on", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    await app.press("conv-btn"); await app.advance(300);
    await app.say(1500);
    await until(app, (e) => e.k === "tts.play");
    await app.advance(3000);
    await app.click("conv-transfer-btn");
    await app.advance(1000);
    const sent = bodies(app).length;
    assert.equal(sent, 1);
    await app.click("conv-exit");
    await app.advance(500);
    assert.equal(app.w.eval("messages.length"), 0, "Token Saver cleared the history on exit");
    assert.equal(bodies(app).length, sent, "nothing more is sent; the copy is already on the Worker");
  } finally { app.close(); }
});

// ---- Pre-deploy review fixes ----

test("Open is ignored while a reply is still streaming", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    seedConversation(app);
    waiting(app);
    await foreground(app);
    app.w.eval(`stopBtn.classList.remove("hidden")`);
    const m = app.trace.length;
    await app.click("transfer-open");
    await app.advance(1000);
    assert.ok(!has(after(app, m), "fetch", { path: "/transferClaim" }), "not claimed mid-reply");
    assert.ok(card(app), "card stays so it can be opened afterwards");
    assert.equal(app.w.eval("messages.length"), 2);
  } finally { app.close(); }
});

test("no card while a memory update is waiting, and Open refuses then too", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    pending(app);
    app.w.eval(`pendingWrite = { action: "insertSection", filename: "people.md" }`);
    let m = app.trace.length;
    await foreground(app);
    assert.ok(!has(after(app, m), "fetch", { path: "/transfer" }));
    assert.equal(card(app), null);
    app.w.eval(`pendingWrite = null`);
    waiting(app);
    await foreground(app);
    assert.ok(card(app));
    app.w.eval(`pendingWrite = { action: "insertSection", filename: "people.md" }`);
    m = app.trace.length;
    await app.click("transfer-open");
    await app.advance(1000);
    assert.ok(!has(after(app, m), "fetch", { path: "/transferClaim" }));
  } finally { app.close(); }
});

test("a photo-only message never sends an empty text block", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    app.w.eval(`
      messages = [
        { role: "user", content: [{ type: "text", text: "" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "QQ==" } }] },
        { role: "assistant", content: "Nice photo." },
      ];
      appendMessage("assistant", "Nice photo.");
    `);
    await typeAndSend(app, "/transfer");
    const blocks = bodies(app)[0].messages[0].content;
    assert.ok(blocks.every((b) => b.type === "text" && b.text.trim().length > 0), JSON.stringify(blocks));
  } finally { app.close(); }
});

test("Not now is remembered for the rest of the browser session", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    pending(app);
    await foreground(app);
    await app.click("transfer-not-now");
    app.w.eval("_transferDismissedAt = null"); // as after a page reload
    await foreground(app);
    assert.equal(card(app), null);
  } finally { app.close(); }
});

test("the card doesn't scroll the chat when reading further up", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    app.w.eval(`
      Object.defineProperty(messagesEl, "scrollHeight", { configurable: true, get: () => 5000 });
      Object.defineProperty(messagesEl, "clientHeight", { configurable: true, get: () => 600 });
      messagesEl.scrollTop = 1000;
    `);
    pending(app);
    await foreground(app);
    assert.ok(card(app));
    assert.equal(app.w.eval("messagesEl.scrollTop"), 1000);
  } finally { app.close(); }
});

// ---- Final review fixes ----

test("Open in a dead spot says it couldn't open and keeps the card", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper", fakes: { routes: { "/transferClaim": "error" } } });
  try {
    seedConversation(app);
    waiting(app);
    await foreground(app);
    await app.click("transfer-open");
    await app.advance(1000);
    assert.match(systemTexts(app).at(-1), /Couldn.t open/);
    assert.ok(!/isn.t waiting any more/.test(systemTexts(app).at(-1)));
    assert.ok(card(app), "card kept so Open can be tried again");
    assert.equal(app.w.document.getElementById("transfer-open").disabled, false);
    assert.equal(app.w.eval("messages.length"), 2);
  } finally { app.close(); }
});

test("Open clears a leftover which-person prompt from the old conversation", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    app.w.eval(`pendingDisambig = { options: ["Jason H", "Jason W"], query: "Who is Jason?" }`);
    waiting(app);
    await foreground(app);
    await app.click("transfer-open");
    await app.advance(1000);
    assert.equal(app.w.eval("pendingDisambig"), null);
  } finally { app.close(); }
});

// ---- Context Reset checks for a waiting transfer (app left open on screen) ----

test("/r shows a waiting transfer straight away", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    seedConversation(app);
    pending(app);
    await typeAndSend(app, "/r");
    assert.ok(card(app), "card shown after /r");
  } finally { app.close(); }
});

test("the Reset button in the long-chat warning shows a waiting transfer", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    seedConversation(app);
    pending(app);
    app.w.eval("appendContextWarning()");
    app.w.document.querySelector(".context-reset-btn").click();
    await app.advance(1000);
    assert.ok(card(app));
  } finally { app.close(); }
});

test("↺ in voice mode offers a waiting transfer when voice mode ends", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    pending(app);
    await app.press("conv-btn"); await app.advance(300);
    const m = app.trace.length;
    await app.click("conv-reset-ctx");
    await app.advance(500);
    assert.ok(!has(after(app, m), "fetch", { path: "/transfer" }), "no check while in voice mode");
    await app.click("conv-exit");
    await app.advance(1000);
    assert.ok(card(app), "card shown after leaving voice mode");
  } finally { app.close(); }
});

test("leaving voice mode without pressing ↺ doesn't check", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    pending(app);
    await app.press("conv-btn"); await app.advance(300);
    const m = app.trace.length;
    await app.click("conv-exit");
    await app.advance(1000);
    assert.ok(!has(after(app, m), "fetch", { path: "/transfer" }));
  } finally { app.close(); }
});

test("a quick tap on ↺ (clear chat) shows a waiting transfer", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    seedConversation(app);
    pending(app);
    await app.press("cls-btn", 100);
    await app.advance(1000);
    assert.match(systemTexts(app).join("|"), /Chat cleared/);
    assert.ok(card(app), "card shown after clearing the chat");
  } finally { app.close(); }
});

// ---- View sources travels with each answer ----

test("/transfer sends the records each answer cited", async () => {
  const app = await loadVoiceApp({ device: "desktop", inputMode: "auto" });
  try {
    app.w.eval(`
      messages = [{ role: "user", content: "Who is Travis?" }, { role: "assistant", content: "Travis Dom is the Director of Infrastructure." }];
      appendMessage("user", "Who is Travis?");
      const el = appendMessage("assistant", "Travis Dom is the Director of Infrastructure.");
      appendSourcesFooter(el, "Travis Dom is the Director of Infrastructure.", "Who is Travis?", [{ file: "people.md", section: "Travis Dom" }]);
    `);
    await typeAndSend(app, "/transfer");
    const item = bodies(app)[0].screen.find((s) => s.kind === "assistant");
    assert.equal(item.text, "Travis Dom is the Director of Infrastructure.");
    assert.deepEqual(item.sources, [{ file: "people.md", section: "Travis Dom" }]);
    assert.equal(item.query, "Who is Travis?");
    const userItem = bodies(app)[0].screen.find((s) => s.kind === "user");
    assert.ok(!("sources" in userItem));
  } finally { app.close(); }
});

test("View sources works on a transferred answer", async () => {
  const app = await loadVoiceApp({ device: "android", inputMode: "whisper" });
  try {
    waiting(app, { screen: [
      { kind: "user", text: "Who is Lily?" },
      { kind: "assistant", text: "Lily is Maria's daughter.", sources: [{ file: "people.md", section: "Lily" }], query: "Who is Lily?", verify: true },
    ] });
    await foreground(app);
    await app.click("transfer-open");
    await app.advance(1000);
    const doc = app.w.document;
    const link = doc.querySelector("#messages .message.assistant .sources-link");
    assert.ok(link, "View sources is there");
    const m = app.trace.length;
    link.click();
    await app.advance(2000);
    assert.ok(has(after(app, m), "fetch", { path: "/getMemoryFile" }), "it looks the record up in this device's memory");
    assert.ok(doc.querySelector("#messages .sources-results"), "the record card is shown");
  } finally { app.close(); }
});
