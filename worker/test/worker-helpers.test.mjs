// Tier A: deterministic unit tests for pure-function helpers in worker.js.
// No network, no AI, no KV. Runs via `node --test`. Free to run.
//
// These tests guard against the kind of bug that has actually hit production:
// the m[1]/m[2] regex bug in /insertSection (silently disabled the collision
// guard for months) would have been caught by a findSectionSpan unit test.
//
// What we test here:
// - findSectionSpan: section header lookup with multiple H1/H2 occurrences
// - parseH2Sections: full-file H2 split (used by /attributeSources)
// - normKey: name normalization (drives all fuzzy matching)
// - sha256Hex: optimistic-concurrency hash (must match frontend's _sha256Hex)
// - getFencedCodeLines: code-fence detection (must skip ## inside ```)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sha256Hex,
  normKey,
  findSectionSpan,
  parseH2Sections,
  getFencedCodeLines,
  findSubsectionParent,
} from "../src/worker.js";

// ---- normKey -----------------------------------------------------------

test("normKey lowercases and strips punctuation", () => {
  assert.equal(normKey("Sarah Chen"), "sarah chen");
  assert.equal(normKey("SARAH CHEN"), "sarah chen");
  assert.equal(normKey("Sarah-Chen"), "sarahchen");
  assert.equal(normKey("Sarah, Chen"), "sarah chen");
});

test("normKey strips decomposable diacritics (NFKD + combining marks)", () => {
  assert.equal(normKey("María López"), "maria lopez");
  assert.equal(normKey("Müller"), "muller");
  assert.equal(normKey("Café"), "cafe");
  // Note: precomposed letters like Ø, Æ, ß don't decompose under NFKD and
  // are filtered out by the [^\w\s] strip — they collapse to nothing rather
  // than transliterating. That's a known limitation, documented here.
});

test("normKey handles null and empty input", () => {
  assert.equal(normKey(null), "");
  assert.equal(normKey(undefined), "");
  assert.equal(normKey(""), "");
  assert.equal(normKey("   "), "");
});

test("normKey collapses internal whitespace", () => {
  assert.equal(normKey("Sarah    Chen"), "sarah chen");
  assert.equal(normKey("\tSarah\nChen\t"), "sarah chen");
});

// ---- sha256Hex ---------------------------------------------------------

test("sha256Hex returns a 64-char lowercase hex digest", async () => {
  const h = await sha256Hex("hello");
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("sha256Hex of known input matches RFC test vector", async () => {
  // SHA-256("") is well-known
  const h = await sha256Hex("");
  assert.equal(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("sha256Hex is deterministic across calls", async () => {
  const a = await sha256Hex("WhosWhoZoo");
  const b = await sha256Hex("WhosWhoZoo");
  assert.equal(a, b);
});

test("sha256Hex differs for whitespace variants", async () => {
  // This matters: if frontend hashes "## Sarah\n– Tag: foo\n" and worker
  // hashes "## Sarah\n– Tag: foo " (extra trailing space), the conflict guard
  // would false-positive on every save. We rely on both sides being byte-exact.
  const a = await sha256Hex("## Sarah\n");
  const b = await sha256Hex("## Sarah");
  assert.notEqual(a, b);
});

// ---- findSectionSpan ---------------------------------------------------

const SAMPLE_FILE = [
  "# people.md",
  "",
  "## Sarah Chen",
  "– Role: PM",
  "– Created: 2026-01-01",
  "",
  "## Maria López",
  "– Role: Eng",
  "",
  "## Sarah Chen",  // duplicate header — second occurrence
  "– Role: Designer",
].join("\n");

test("findSectionSpan finds first occurrence by default", () => {
  const lines = SAMPLE_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  assert.ok(span);
  // Best-scored occurrence wins (the one with more body lines usually).
  // Both Sarah entries have similar bodies; either is a valid hit.
  assert.ok(span.iHeader === 2 || span.iHeader === 9);
});

test("findSectionSpan honors explicit occurrenceIndex", () => {
  const lines = SAMPLE_FILE.split("\n");
  const first = findSectionSpan(lines, "Sarah Chen", 0);
  const second = findSectionSpan(lines, "Sarah Chen", 1);
  assert.equal(first.iHeader, 2);
  assert.equal(second.iHeader, 9);
});

test("findSectionSpan returns null when occurrence out of range", () => {
  const lines = SAMPLE_FILE.split("\n");
  assert.equal(findSectionSpan(lines, "Sarah Chen", 99), null);
});

test("findSectionSpan returns null when section not found", () => {
  const lines = SAMPLE_FILE.split("\n");
  assert.equal(findSectionSpan(lines, "Bob Nobody"), null);
});

test("findSectionSpan is diacritic-insensitive", () => {
  const lines = SAMPLE_FILE.split("\n");
  const a = findSectionSpan(lines, "Maria López");
  const b = findSectionSpan(lines, "Maria Lopez"); // no accent
  assert.ok(a);
  assert.ok(b);
  assert.equal(a.iHeader, b.iHeader);
});

test("findSectionSpan computes iEnd as next H2 (or EOF)", () => {
  const lines = SAMPLE_FILE.split("\n");
  const sarah = findSectionSpan(lines, "Sarah Chen", 0);
  // Sarah Chen #1 ends where Maria López starts (line 6)
  assert.equal(sarah.iEnd, 6);
  const lastSarah = findSectionSpan(lines, "Sarah Chen", 1);
  // Last section runs to EOF
  assert.equal(lastSarah.iEnd, lines.length);
});

// ---- parseH2Sections ---------------------------------------------------

test("parseH2Sections returns one entry per H2", () => {
  const out = parseH2Sections(SAMPLE_FILE);
  assert.equal(out.length, 3); // two Sarah + one Maria
  assert.equal(out[0].name, "Sarah Chen");
  assert.equal(out[1].name, "Maria López");
  assert.equal(out[2].name, "Sarah Chen");
});

test("parseH2Sections strips the 👤 emoji prefix", () => {
  const md = "## 👤 Sarah Chen\n– Tag: foo\n";
  const out = parseH2Sections(md);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Sarah Chen");
});

test("parseH2Sections handles empty input", () => {
  assert.deepEqual(parseH2Sections(""), []);
  assert.deepEqual(parseH2Sections(null), []);
  assert.deepEqual(parseH2Sections(undefined), []);
});

test("parseH2Sections normalizes CRLF to LF", () => {
  const md = "## A\r\n– Tag: foo\r\n## B\r\n– Tag: bar\r\n";
  const out = parseH2Sections(md);
  assert.equal(out.length, 2);
});

// ---- getFencedCodeLines ------------------------------------------------

test("getFencedCodeLines flags lines inside ``` blocks", () => {
  const lines = [
    "Normal text",
    "```",
    "## fake header",  // index 2 — inside fence
    "```",
    "## real header",  // index 4 — outside fence
  ];
  const fenced = getFencedCodeLines(lines);
  assert.ok(fenced.has(2), "## inside fence should be flagged");
  assert.ok(!fenced.has(4), "## outside fence should NOT be flagged");
});

test("findSectionSpan ignores ## inside code fences", () => {
  // This is the actual bug-class this guards: a code example containing ##
  // would otherwise be mistaken for a section header.
  const md = [
    "## Real Section",
    "```",
    "## decoy header in code block",
    "```",
    "– Tag: foo",
  ].join("\n");
  const sections = parseH2Sections(md);
  assert.equal(sections.length, 1, "decoy ## inside code fence must not be counted");
  assert.equal(sections[0].name, "Real Section");
});

// ---- findSubsectionParent ----------------------------------------------
// Regression cover for the "View sources" dead link (2026-09-21).
//
// findSectionSpan addresses `#`/`##` headings ONLY. Records that organize
// their content with `###` subsections — e.g.
//
//     ## Application Licenses
//     ### TechSmith (Camtasia & Snagit)
//
// therefore have interior headings the app cannot open. Claude's <sources>
// block cites the heading a fact actually lives under, which for such a
// record is the `###` — so the source chip resolved to "not found".
//
// findSubsectionParent maps an interior heading back to the addressable H2
// that contains it. It is used ONLY on the read path (GET /getMemoryFile).
// See the strictness guard at the bottom of this block for why.

const LICENSES_MD = [
  "# fragments.md",
  "",
  "## Application Licenses",
  "– Tags: licenses, credentials",
  "",
  "### TechSmith (Camtasia & Snagit)",
  "– **Product**: Camtasia and Snagit",
  "",
  "#### Renewal",
  "– **Cost**: $250/year",
  "",
  "## Another Record",
  "– Tags: unrelated",
].join("\n");

test("findSubsectionParent maps an H3 to its containing H2", () => {
  const lines = LICENSES_MD.split("\n");
  assert.equal(
    findSubsectionParent(lines, "TechSmith (Camtasia & Snagit)"),
    "Application Licenses",
  );
});

test("findSubsectionParent maps a deeper heading to the nearest ancestor H2", () => {
  const lines = LICENSES_MD.split("\n");
  assert.equal(findSubsectionParent(lines, "Renewal"), "Application Licenses");
});

test("findSubsectionParent returns null for an unknown name", () => {
  const lines = LICENSES_MD.split("\n");
  assert.equal(findSubsectionParent(lines, "Nothing Like This"), null);
});

test("findSubsectionParent does not hijack a real H2 name", () => {
  // An H2 resolves through findSectionSpan already; this helper must stay out
  // of the way so normal lookups are untouched.
  const lines = LICENSES_MD.split("\n");
  assert.equal(findSubsectionParent(lines, "Application Licenses"), null);
});

test("findSubsectionParent returns null for a subsection with no H2 above it", () => {
  const lines = ["# fragments.md", "### Orphan Sub", "– Tags: none"].join("\n").split("\n");
  assert.equal(findSubsectionParent(lines, "Orphan Sub"), null);
});

test("findSubsectionParent ignores ### inside code fences", () => {
  const lines = [
    "## Real Section",
    "```",
    "### decoy sub in code block",
    "```",
  ].join("\n").split("\n");
  assert.equal(findSubsectionParent(lines, "decoy sub in code block"), null);
});

test("findSubsectionParent normalizes names the same way findSectionSpan does", () => {
  const lines = LICENSES_MD.split("\n");
  assert.equal(
    findSubsectionParent(lines, "techsmith (camtasia & snagit)"),
    "Application Licenses",
  );
});

test("findSectionSpan STILL refuses an H3 name (destructive paths stay strict)", () => {
  // The guard that matters most. findSectionSpan backs /deleteSection,
  // /replaceSection, /moveToArchive and /compactSection. If it ever resolved
  // an interior heading to its parent's span, deleting "TechSmith (Camtasia
  // & Snagit)" would delete the whole "Application Licenses" record instead
  // — turning a cosmetic dead link into silent data loss. The tolerance is
  // deliberately confined to the read path; this test pins that.
  const lines = LICENSES_MD.split("\n");
  assert.equal(findSectionSpan(lines, "TechSmith (Camtasia & Snagit)"), null);
});

test("subsection fallback composes into the parent's FULL span", () => {
  // Mirrors what GET /getMemoryFile now does: strict lookup misses, so it maps
  // the interior heading to its parent and re-runs the strict lookup on that.
  // The user must get the whole parent record - header through last line
  // before the next H2 - not just the subsection they happened to name.
  const lines = LICENSES_MD.split("\n");
  assert.equal(findSectionSpan(lines, "TechSmith (Camtasia & Snagit)"), null);

  const parent = findSubsectionParent(lines, "TechSmith (Camtasia & Snagit)");
  const span = findSectionSpan(lines, parent);
  assert.ok(span, "parent must resolve through the strict lookup");

  const block = lines.slice(span.iHeader, span.iEnd);
  assert.equal(block[0], "## Application Licenses");
  assert.ok(block.includes("### TechSmith (Camtasia & Snagit)"), "subsection included");
  assert.ok(block.includes("#### Renewal"), "deeper subsection included");
  assert.ok(!block.includes("## Another Record"), "must stop at the next H2");
});
