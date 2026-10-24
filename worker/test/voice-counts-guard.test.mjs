import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const file = (n) => new URL(`./voice-baselines/${n}`, import.meta.url);
const load = (n) => JSON.parse(readFileSync(file(n), "utf8"));

// Stage 2 may only ever REMOVE requests. Every scenario's /chat, /speak and
// /transcribe counts must stay at or below the frozen copy taken before the
// stage-2 app changes. A new scenario gets its frozen entry when it is first
// recorded, before the change it covers.
test("no voice scenario makes more requests than its frozen pre-stage-2 count", () => {
  assert.ok(existsSync(file("_request-counts.v1.9.1.json")), "frozen counts file missing");
  const now = load("_request-counts.json");
  const frozen = load("_request-counts.v1.9.1.json");
  for (const [name, paths] of Object.entries(now)) {
    assert.ok(name in frozen, `${name} has no frozen entry: add it to _request-counts.v1.9.1.json before changing app.js`);
    for (const [p, n] of Object.entries(paths)) {
      const was = frozen[name][p] || 0;
      assert.ok(n <= was, `${name}: ${p} went from ${was} to ${n}`);
    }
  }
});
