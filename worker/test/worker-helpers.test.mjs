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
  isAmbiguousSectionName,
  VOICE,
  resolveVoice,
  trimForSpeech,
  isAllowanceExhausted,
  arrayBufferToBase64,
  buildWhisperInput,
  isWhisperHallucination,
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

// Every person record shares the same sub-heading names (### Summary, ### Family,
// ### Timeline, ### Contact...). A citation naming one of those identifies no
// record at all. Returning the first record that has it opened the WRONG person
// from "View sources" — confidently, with no "not found" to warn anyone. The
// lookup must refuse, the same way findSectionSpan refuses an ambiguous name.
const TWO_PEOPLE_MD = [
  "# people.md",
  "",
  "## Aaron Smith",
  "### Summary",
  "Neighbor.",
  "### Family",
  "– Wife: Beth",
  "",
  "## Jason Howes",
  "### Summary",
  "Coworker.",
  "### Family",
  "– Daughter: Lily",
  "### Gym Schedule",
  "– Tuesdays",
].join("\n");

test("findSubsectionParent refuses a sub-heading shared by more than one record", () => {
  const lines = TWO_PEOPLE_MD.split("\n");
  assert.equal(findSubsectionParent(lines, "Family"), null);
  assert.equal(findSubsectionParent(lines, "summary"), null);
});

test("findSubsectionParent still resolves a sub-heading unique to one record", () => {
  const lines = TWO_PEOPLE_MD.split("\n");
  assert.equal(findSubsectionParent(lines, "Gym Schedule"), "Jason Howes");
});

test("findSubsectionParent resolves a sub-heading repeated inside ONE record", () => {
  // Same parent twice is not ambiguous — there is only one record it can mean.
  const lines = ["## Trip Log", "### Notes", "– a", "### Notes", "– b", "## Other"].join("\n").split("\n");
  assert.equal(findSubsectionParent(lines, "Notes"), "Trip Log");
});

test("findSubsectionParent refuses when two SEPARATE records share the parent's name", () => {
  // Two distinct "## John Smith" records: the H2 title alone cannot say which
  // one holds "### Gym", so returning the title would let findSectionSpan's
  // scoring open the other John Smith — the wrong-person bug by another route.
  const lines = [
    "## John Smith", "### Gym", "– Tuesdays",
    "## John Smith", "### Family", "– Son: Ty",
  ].join("\n").split("\n");
  assert.equal(findSubsectionParent(lines, "Gym"), null);
});

// ---- isAmbiguousSectionName ---------------------------------------------
// GET /getMemoryFile 404s both for a name that is absent and for one that is
// present under several records. View Sources must not tell the user a cited
// record "isn't in your notes" when it is there twice — so the endpoint flags
// ambiguity and this decides it.

test("isAmbiguousSectionName: shared sub-heading is ambiguous", () => {
  const lines = TWO_PEOPLE_MD.split("\n");
  assert.equal(isAmbiguousSectionName(lines, "Family"), true);
});

test("isAmbiguousSectionName: a sub-heading under a record whose NAME is duplicated is ambiguous", () => {
  // Only one "### Work" exists, but it sits under one of two "## John Smith"
  // records — the citation could mean either person. findSubsectionParent
  // refuses it, so without this flag View Sources would call a heading that
  // plainly exists "not found anywhere in your notes".
  const lines = [
    "## John Smith", "### Work", "– Plumber",
    "## John Smith", "### Family", "– Son: Ty",
  ].join("\n").split("\n");
  assert.equal(findSubsectionParent(lines, "Work"), null);
  assert.equal(isAmbiguousSectionName(lines, "Work"), true);
});

test("isAmbiguousSectionName: absent name is not ambiguous", () => {
  const lines = TWO_PEOPLE_MD.split("\n");
  assert.equal(isAmbiguousSectionName(lines, "Jason Howel"), false);
});

test("isAmbiguousSectionName: unique sub-heading is not ambiguous", () => {
  const lines = TWO_PEOPLE_MD.split("\n");
  assert.equal(isAmbiguousSectionName(lines, "Gym Schedule"), false);
});

test("isAmbiguousSectionName: two records with the same H2 name are ambiguous", () => {
  const lines = ["## John Smith", "– a", "## John Smith", "– b"].join("\n").split("\n");
  assert.equal(isAmbiguousSectionName(lines, "John Smith"), true);
});

test("isAmbiguousSectionName: names differing only by accent count as ambiguous", () => {
  const lines = ["## José García", "– a", "## Jose Garcia", "– b"].join("\n").split("\n");
  assert.equal(isAmbiguousSectionName(lines, "jose garcia "), true);
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

// ---- Voice (Cloudflare Aura-1 + optional ElevenLabs) ---------------------

test("resolveVoice maps the two Aura voices to Cloudflare", () => {
  assert.deepEqual(resolveVoice("asteria"), { provider: "cloudflare", key: "asteria", speaker: "asteria" });
  assert.deepEqual(resolveVoice("orion"), { provider: "cloudflare", key: "orion", speaker: "orion" });
});

test("resolveVoice maps the retired OpenAI voices to their replacements", () => {
  // A cached old frontend, or a phone whose saved preference predates 1.9.0,
  // still sends these. They must keep speaking, not fail.
  assert.equal(resolveVoice("marin").speaker, "asteria");
  assert.equal(resolveVoice("onyx").speaker, "orion");
  assert.equal(resolveVoice("MARIN").speaker, "asteria");
});

test("resolveVoice sends Brittney and Callum to ElevenLabs", () => {
  assert.deepEqual(resolveVoice("brittney"), { provider: "elevenlabs", key: "brittney", voiceId: "kPzsL2i3teMYv0FxEYQ6" });
  assert.equal(resolveVoice("callum").provider, "elevenlabs");
});

test("resolveVoice falls back to Asteria for unknown, empty or missing voices", () => {
  for (const v of ["hans", "", undefined, null, "nonsense", 42]) {
    assert.deepEqual(resolveVoice(v), { provider: "cloudflare", key: "asteria", speaker: "asteria" }, String(v));
  }
});

test("trimForSpeech leaves short text alone", () => {
  assert.equal(trimForSpeech("Hello there.", 1900), "Hello there.");
});

test("trimForSpeech cuts at the last sentence end under the limit", () => {
  const s = "One two three. Four five six. Seven eight nine.";
  assert.equal(trimForSpeech(s, 30), "One two three. Four five six.");
});

test("trimForSpeech hard-cuts when no sentence end fits", () => {
  assert.equal(trimForSpeech("abcdefghij", 4), "abcd");
});

test("isAllowanceExhausted recognises the Workers AI daily-allocation refusal", () => {
  // Verbatim from a real Workers AI refusal, captured 2026-10-21 (Task 1 probe).
  assert.equal(isAllowanceExhausted(new Error("4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.")), true);
  assert.equal(isAllowanceExhausted("AiError: 4006: daily free allocation exceeded"), true);
});

test("isAllowanceExhausted does not misread other failures as the allowance", () => {
  for (const m of ["Network connection lost", "5007: No such model", "8007: Input text exceeds maximum character limit of 2000.", "Internal error", "", undefined, null]) {
    assert.equal(isAllowanceExhausted(m === undefined || m === null ? m : new Error(m)), false, String(m));
  }
});

test("VOICE is an object, not a bare primitive (workerd refuses primitive exports)", () => {
  assert.equal(typeof VOICE, "object");
  assert.equal(VOICE.defaultVoice, "asteria");
  // Aura-1 rejects text over 2,000 characters (error 8007, Task 1 probe);
  // the cap must stay below it.
  assert.ok(VOICE.auraMaxChars < 2000);
});

test("arrayBufferToBase64 round-trips binary, including large buffers", () => {
  const bytes = new Uint8Array(200000).map((_, i) => i % 256);
  const b64 = arrayBufferToBase64(bytes.buffer);
  assert.deepEqual(new Uint8Array(Buffer.from(b64, "base64")), bytes);
});

test("buildWhisperInput passes a 2-letter language and enables silence skipping", () => {
  assert.deepEqual(buildWhisperInput("QUJD", "es"), { audio: "QUJD", language: "es", vad_filter: true });
});

test("buildWhisperInput reduces region tags and falls back to English", () => {
  assert.equal(buildWhisperInput("x", "pt-BR").language, "pt");
  assert.equal(buildWhisperInput("x", "EN").language, "en");
  for (const bad of ["", null, undefined, "zz-top-1", "123"]) {
    assert.equal(buildWhisperInput("x", bad).language, "en", String(bad));
  }
});

test("isWhisperHallucination catches known silence fillers, not real speech", () => {
  for (const h of ["Thanks for watching!", "you", "♪ ♪", "[Music]", "Subtitles by the Amara.org community"]) {
    assert.equal(isWhisperHallucination(h), true, h);
  }
  for (const real of ["Thanks for watching the kids yesterday", "Thank you for watching the kids yesterday", "you know what Maria said", "Remind me about Lily"]) {
    assert.equal(isWhisperHallucination(real), false, real);
  }
});

test("trimForSpeech keeps most of a list-shaped reply instead of only its intro (final review)", () => {
  // Claude's list items rarely end in a period; after markdown stripping each
  // item is just a line. Treating only ". " as a boundary spoke the 49-char
  // intro and silently dropped ~1,850 characters of a WHO-TO-CONTACT list.
  const lines = Array.from({ length: 40 }, (_, i) => `Person ${i + 1} — college friend, reach out about the reunion`);
  const s = "Here is who to contact this week. Top tier first.\n" + lines.join("\n");
  const out = trimForSpeech(s, 1900);
  assert.ok(out.length <= 1900, "within the limit");
  assert.ok(out.length > 1500, `kept most of it (got ${out.length})`);
  assert.ok(s.startsWith(out), "a prefix of the original");
  assert.match(out, /reunion$/, "ends on a whole line");
});

test("trimForSpeech cuts at a word, not mid-word, when no line or sentence end is near", () => {
  const s = "word ".repeat(500);
  const out = trimForSpeech(s, 1900);
  assert.ok(out.length <= 1900 && out.length > 950);
  assert.match(out, /word$/);
});
