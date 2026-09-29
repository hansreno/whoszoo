import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBulletText, findBulletIndex, bulletsInBlock, bulletMiss } from "../src/worker.js";

// The real record that exposed this: a model tried to replace the Mother bullet and
// failed three times identically, because matching was byte-exact and the error said
// nothing about what was actually there.
const FAMILY = [
  "### Family",
  "- Mother: remarried 4 years ago",
  "- Four step-siblings (from mother's remarriage)",
  "- Father: lives downtown SLC; relationship somewhat estranged",
];

test("exact text still matches", () => {
  assert.equal(findBulletIndex(FAMILY, "- Mother: remarried 4 years ago").idx, 1);
});

test("en-dash against a hyphen in the file", () => {
  assert.equal(findBulletIndex(FAMILY, "– Mother: remarried 4 years ago").idx, 1);
});

test("a missing leading dash", () => {
  assert.equal(findBulletIndex(FAMILY, "Mother: remarried 4 years ago").idx, 1);
});

test("trailing punctuation and capitalisation", () => {
  assert.equal(findBulletIndex(FAMILY, "- Mother: Remarried 4 years ago.").idx, 1);
});

test("collapsed whitespace", () => {
  assert.equal(findBulletIndex(FAMILY, "-   Mother:   remarried 4 years ago").idx, 1);
});

test("different content still misses — only formatting is forgiven", () => {
  const r = findBulletIndex(FAMILY, "- Mother: remarried in 2022");
  assert.equal(r.idx, -1);
  assert.equal(r.reason, "missing");
});

test("ambiguity refuses rather than guessing", () => {
  const block = ["- Tennis", "– tennis.", "- Piano"];
  const r = findBulletIndex(block, "Tennis");
  assert.equal(r.idx, -1);
  assert.equal(r.reason, "ambiguous");
});

test("an exact match wins over a normalised one", () => {
  // Index 2 is byte-exact; index 0 would also normalise to the same thing.
  const block = ["- report.", "- unrelated", "- report"];
  assert.equal(findBulletIndex(block, "- report").idx, 2);
});

test("empty input is rejected, not matched", () => {
  assert.equal(findBulletIndex(FAMILY, "   ").reason, "empty");
});

test("normalizeBulletText strips markers, case, spacing and trailing punctuation", () => {
  assert.equal(normalizeBulletText("—  Mother:  Remarried 4 Years Ago."), "mother: remarried 4 years ago");
  assert.equal(normalizeBulletText("* thing"), "thing");
  assert.equal(normalizeBulletText(null), "");
});

test("bulletsInBlock lists bullets and skips headings", () => {
  const got = bulletsInBlock(FAMILY);
  assert.equal(got.length, 3);
  assert.ok(!got.some(b => b.startsWith("###")));
});

test("the failure message carries what was sought and what was present", () => {
  const msg = bulletMiss("- Mother: remarried in 2022", "missing", FAMILY);
  assert.ok(msg.includes("remarried in 2022"), "names what was sought");
  assert.ok(msg.includes("remarried 4 years ago"), "names what was actually there");
});

test("an ambiguous failure says so rather than reporting it missing", () => {
  const msg = bulletMiss("Tennis", "ambiguous", ["- Tennis", "– tennis."]);
  assert.ok(/ambiguous/i.test(msg));
});
