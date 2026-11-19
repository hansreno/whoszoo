import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRANSFER_LIMITS,
  validateTransferPayload,
  saveTransfer,
  peekTransfer,
  claimTransfer,
  PROTECTED_KEYS,
  isRecoveryPath,
} from "../src/worker.js";

// v1.9.13: /transfer — one pending conversation in KV (pending_transfer), 12 h TTL.

function fakeEnv() {
  const store = new Map();
  const opts = new Map();
  return {
    store, opts,
    MEMORY: {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v, o) { store.set(k, v); opts.set(k, o); },
      async delete(k) { store.delete(k); opts.delete(k); },
    },
  };
}

function payload(over = {}) {
  return {
    messages: [
      { role: "user", content: "Who is Kelsey?" },
      { role: "assistant", content: "That's Kelsey Hanna, Senior UI/UX." },
    ],
    screen: [
      { kind: "user", text: "Who is Kelsey?" },
      { kind: "assistant", text: "That's Kelsey Hanna, Senior UI/UX." },
    ],
    contextTokens: 1200,
    historyTokens: 300,
    archiveMode: 0,
    attachments: [],
    fromLabel: "computer",
    fromDeviceId: "dev-a",
    ...over,
  };
}

test("save then peek returns metadata only", async () => {
  const env = fakeEnv();
  const s = await saveTransfer(env, payload(), 1000);
  assert.equal(s.status, 200);
  assert.equal(s.body.ok, true);
  const p = await peekTransfer(env);
  assert.equal(p.status, 200);
  assert.equal(p.body.pending, true);
  assert.equal(p.body.fromLabel, "computer");
  assert.equal(p.body.fromDeviceId, "dev-a");
  assert.equal(p.body.sentAt, 1000);
  assert.ok(!("messages" in p.body));
  assert.ok(!("screen" in p.body));
});

test("save stores with a 12-hour expiry", async () => {
  const env = fakeEnv();
  await saveTransfer(env, payload());
  assert.equal(env.opts.get("pending_transfer").expirationTtl, 43200);
});

test("a second save replaces the first", async () => {
  const env = fakeEnv();
  await saveTransfer(env, payload({ fromDeviceId: "first" }));
  await saveTransfer(env, payload({ fromDeviceId: "second" }));
  const c = await claimTransfer(env);
  assert.equal(c.body.transfer.fromDeviceId, "second");
});

test("claim returns the payload and deletes it", async () => {
  const env = fakeEnv();
  await saveTransfer(env, payload());
  const c = await claimTransfer(env);
  assert.equal(c.status, 200);
  assert.equal(c.body.ok, true);
  assert.equal(c.body.transfer.messages.length, 2);
  assert.equal(c.body.transfer.screen[1].text, "That's Kelsey Hanna, Senior UI/UX.");
  const again = await claimTransfer(env);
  assert.equal(again.status, 404);
  assert.deepEqual(again.body, { ok: false, error: "none_pending" });
  assert.equal((await peekTransfer(env)).body.pending, false);
});

test("image and document blocks are replaced with text", async () => {
  const env = fakeEnv();
  const messages = [
    { role: "user", content: [
      { type: "text", text: "Who is this?" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBBB" } },
    ] },
    { role: "assistant", content: "That's Greg." },
  ];
  await saveTransfer(env, payload({ messages }));
  const c = await claimTransfer(env);
  const json = JSON.stringify(c.body.transfer);
  assert.ok(!json.includes("source"));
  assert.ok(!json.includes("AAAA") && !json.includes("BBBB"));
  const blocks = c.body.transfer.messages[0].content;
  assert.equal(blocks[1].text, "[Photo attached on the other device — not transferred]");
  assert.equal(blocks[2].text, "[File attached on the other device — not transferred]");
});

test("invalid payloads are rejected", async () => {
  const bad = [
    (p) => { delete p.messages; return p; },
    (p) => { p.messages = [{ role: "system", content: "x" }]; return p; },
    (p) => { p.screen = [{ kind: "button", text: "x" }]; return p; },
    (p) => { p.archiveMode = 2; return p; },
    (p) => { p.fromLabel = "watch"; return p; },
    (p) => { p.fromDeviceId = ""; return p; },
  ];
  for (const mutate of bad) {
    const env = fakeEnv();
    const r = await saveTransfer(env, mutate(payload()));
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { ok: false, error: "invalid_payload" });
    assert.equal(env.store.size, 0);
  }
  assert.equal(validateTransferPayload(null).ok, false);
  assert.equal(validateTransferPayload(payload()).ok, true);
});

test("oversized payloads are rejected", async () => {
  const env = fakeEnv();
  const r = await saveTransfer(env, payload({ screen: [{ kind: "assistant", text: "x".repeat(2_000_001) }] }));
  assert.equal(r.status, 413);
  assert.deepEqual(r.body, { ok: false, error: "transfer_too_large" });
  assert.equal(env.store.size, 0);
});

test("pending_transfer is protected", () => {
  assert.ok(PROTECTED_KEYS.has("pending_transfer"));
});

test("transfer paths are not recovery paths", () => {
  assert.equal(isRecoveryPath("POST", "/transfer"), false);
  assert.equal(isRecoveryPath("GET", "/transfer"), false);
  assert.equal(isRecoveryPath("POST", "/transferClaim"), false);
});

test("TRANSFER_LIMITS is an object", () => {
  assert.equal(typeof TRANSFER_LIMITS, "object");
  assert.equal(TRANSFER_LIMITS.ttlSeconds, 43200);
  assert.equal(TRANSFER_LIMITS.maxBytes, 2000000);
});

test("reset and passphrase routes delete the pending transfer", () => {
  const src = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
  for (const route of ["/initPassword", "/changePassword", "/resetMemory"]) {
    const start = src.indexOf(`path === "${route}") {`);
    assert.ok(start > 0, `${route} handler found`);
    const end = src.indexOf("return json({ ok: true", start);
    assert.ok(end > start, `${route} success return found`);
    assert.ok(src.slice(start, end).includes(`MEMORY.delete("pending_transfer")`), `${route} deletes pending_transfer`);
  }
});

test("unparseable stored value counts as not pending", async () => {
  const env = fakeEnv();
  env.store.set("pending_transfer", "{not json");
  assert.equal((await peekTransfer(env)).body.pending, false);
});

test("empty text blocks are dropped so later /chat calls never fail", async () => {
  const env = fakeEnv();
  const messages = [
    { role: "user", content: [{ type: "text", text: "" }, { type: "image", source: { data: "QQ==" } }] },
    { role: "user", content: [{ type: "text", text: "  " }] },
    { role: "assistant", content: "" },
  ];
  await saveTransfer(env, payload({ messages }));
  const out = (await claimTransfer(env)).body.transfer.messages;
  for (const m of out) {
    if (typeof m.content === "string") assert.ok(m.content.trim().length > 0, JSON.stringify(m));
    else {
      assert.ok(m.content.length > 0, JSON.stringify(m));
      assert.ok(m.content.every((b) => b.text.trim().length > 0), JSON.stringify(m));
    }
  }
  assert.equal(out[0].content.length, 1, "only the photo note remains");
});

test("screen items keep the records an answer cited", async () => {
  const env = fakeEnv();
  const screen = [
    { kind: "user", text: "Who is Travis?" },
    { kind: "assistant", text: "Travis Dom is the Director of Infrastructure.", sources: [{ file: "people.md", section: "Travis Dom" }], query: "Who is Travis?", verify: true },
    { kind: "assistant", text: "No citation here.", sources: null, query: "And Greg?" },
  ];
  await saveTransfer(env, payload({ screen }));
  const out = (await claimTransfer(env)).body.transfer.screen;
  assert.deepEqual(out[1].sources, [{ file: "people.md", section: "Travis Dom" }]);
  assert.equal(out[1].query, "Who is Travis?");
  assert.equal(out[1].verify, true);
  assert.ok("sources" in out[2] && out[2].sources === null);
  assert.ok(!("sources" in out[0]), "items without a sources footer stay without one");
});

test("malformed cited sources are rejected", async () => {
  for (const bad of ["people.md", [{ file: 1, section: "x" }], [{ file: "people.md" }]]) {
    const env = fakeEnv();
    const r = await saveTransfer(env, payload({ screen: [{ kind: "assistant", text: "x", sources: bad }] }));
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});
