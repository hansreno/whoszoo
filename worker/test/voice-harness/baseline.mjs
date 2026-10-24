import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { loadVoiceApp } from "./load.mjs";

const DIR = new URL("../voice-baselines/", import.meta.url);
const COUNTS = new URL("_request-counts.json", DIR);
const UPDATE_TRACES = process.argv.includes("--update-baselines");
const UPDATE_COUNTS = process.argv.includes("--update-counts");
// A missing trace or count entry is recorded only under an update flag; a plain
// `npm test` fails instead, so deleting a baseline can't quietly hide a regression.
const RECORDING = UPDATE_TRACES || UPDATE_COUNTS;
const missing = (what) => assert.fail(`no ${what}; run npm run voice-baselines and npm run voice-counts, then review the diff`);
mkdirSync(DIR, { recursive: true });
const counts = existsSync(COUNTS) ? JSON.parse(readFileSync(COUNTS, "utf8")) : {};
let countsDirty = false;
process.on("exit", () => { if (countsDirty) writeFileSync(COUNTS, JSON.stringify(counts, null, 2) + "\n"); });

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export function scenario(name, opts, run) {
  test(name, async () => {
    const app = await loadVoiceApp(opts);
    try {
      await run(app);
      assert.deepEqual(app.errors, [], "script errors");
      assert.deepEqual(app.unrouted, [], "unrouted requests");
      const file = new URL(`${name}.json`, DIR);
      if (!existsSync(file) && !RECORDING) missing(`voice-baselines/${name}.json`);
      if (UPDATE_TRACES || !existsSync(file)) writeFileSync(file, JSON.stringify(app.trace, null, 1) + "\n");
      else assert.deepEqual(app.trace, JSON.parse(readFileSync(file, "utf8")), `trace differs from voice-baselines/${name}.json`);
      const got = sorted(app.counts);
      if (!(name in counts) && !RECORDING) missing(`request count for ${name}`);
      if (UPDATE_COUNTS || !(name in counts)) { counts[name] = got; countsDirty = true; }
      else assert.deepEqual(got, counts[name], `request counts differ for ${name}`);
    } finally { app.close(); }
  });
}
