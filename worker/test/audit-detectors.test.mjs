import { test } from "node:test";
import assert from "node:assert/strict";
import { AUDIT_CATEGORIES, parseSections } from "../src/audit-detectors.js";

test("AUDIT_CATEGORIES has 7 entries with id, label, scan, icon", () => {
  assert.equal(AUDIT_CATEGORIES.length, 7);
  for (const c of AUDIT_CATEGORIES) {
    assert.ok(c.id, "category needs id");
    assert.ok(c.label, "category needs label");
    assert.ok(["quick", "deep"].includes(c.scan), `bad scan: ${c.scan}`);
    assert.ok(c.icon, "category needs icon");
  }
  const ids = AUDIT_CATEGORIES.map(c => c.id);
  assert.deepEqual(ids, [
    "broken-characters", "format-violations", "date-inconsistencies",
    "duplicate-headers", "near-duplicates", "name-mismatches", "photo-issues",
  ]);
});

test("parseSections splits on ## headers", () => {
  const md = [
    "# Title",
    "",
    "## Karl Slade",
    "– Tags: church",
    "– Created: 2026-04-08",
    "",
    "## Sarah Chen",
    "– Tags: work",
  ].join("\n");
  const sections = parseSections(md);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].header, "Karl Slade");
  assert.equal(sections[0].headerLine, 3);
  assert.deepEqual(sections[0].bodyLines, ["– Tags: church", "– Created: 2026-04-08", ""]);
  assert.equal(sections[1].header, "Sarah Chen");
  assert.equal(sections[1].headerLine, 7);
});

test("parseSections handles empty file", () => {
  assert.deepEqual(parseSections(""), []);
  assert.deepEqual(parseSections("# Title only"), []);
});

import { detectBrokenCharacters } from "../src/audit-detectors.js";

test("detectBrokenCharacters flags em-dash and other non-standard leads", () => {
  const md = [
    "## Karl Slade",
    "𝄯 Tags: church",
    "— Status: open",
    "– Created: 2026-04-08",
  ].join("\n");
  const findings = detectBrokenCharacters("people.md", md);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].file, "people.md");
  assert.equal(findings[0].section, "Karl Slade");
  assert.equal(findings[0].lineNumber, 2);
  assert.equal(findings[0].codepoint, "U+1D12F");
  assert.equal(findings[1].lineNumber, 3);
  assert.equal(findings[1].codepoint, "U+2014");
});

test("detectBrokenCharacters does not flag valid en-dash or hyphen leads", () => {
  const md = [
    "## Karl Slade",
    "– Tags: church",
    "- Status: open",
    "– Created: 2026-04-08",
  ].join("\n");
  assert.deepEqual(detectBrokenCharacters("people.md", md), []);
});

test("detectBrokenCharacters ignores body past 10 non-blank lines or after ### subheading", () => {
  const md = [
    "## Karl Slade",
    "– Tags: church",
    "",
    "### Notes",
    "𝄯 this should not flag (after ###)",
  ].join("\n");
  assert.deepEqual(detectBrokenCharacters("people.md", md), []);
});

test("detectBrokenCharacters ignores lines that don't look like metadata at all", () => {
  const md = [
    "## Karl Slade",
    "Some prose paragraph here.",
    "Another sentence.",
  ].join("\n");
  assert.deepEqual(detectBrokenCharacters("people.md", md), []);
});

import { detectFormatViolations } from "../src/audit-detectors.js";

test("detectFormatViolations does NOT flag fragments without a date prefix", () => {
  // Fragments are intentionally permissive — How-To guides, contact lists, and
  // evergreen reference notes don't need a date in the title.
  const md = [
    "## 2026-04-08 – Performance Gap",
    "body",
    "",
    "## Important Work App Links",
    "body",
    "",
    "## How-To – View Currently Running Tests in TMD",
    "body",
  ].join("\n");
  assert.deepEqual(detectFormatViolations("fragments.md", md), []);
});

test("detectFormatViolations accepts permissive name shapes for people.md", () => {
  const md = [
    "## Karl Slade",          // OK: 2 caps
    "## Marcy",                // OK: 1 cap
    "## Karl Slade Jr.",       // OK: 3 tokens
    "## broken header",        // FAIL: lowercase
    "## 2026-01-01 – wrong",   // FAIL: dated header in people file
  ].join("\n");
  const f = detectFormatViolations("people.md", md);
  assert.equal(f.length, 2);
  assert.deepEqual(f.map(x => x.section), ["broken header", "2026-01-01 – wrong"]);
});

test("detectFormatViolations accepts accented uppercase initials", () => {
  const md = [
    "## María García",
    "## Élodie Bouchard",
    "## Björn Ericsson",
    "## José Hernández Smith",
  ].join("\n");
  assert.deepEqual(detectFormatViolations("people.md", md), []);
});

test("detectFormatViolations recognizes archive_ and deeparchive_ prefixes", () => {
  // archive_fragments still permissive (no date required); archive/deep loops still strict.
  assert.equal(detectFormatViolations("archive_fragments.md", "## Bad Header No Date\nbody").length, 0);
  assert.equal(detectFormatViolations("deeparchive_loops.md", "## Bad Header No Date\nbody").length, 1);
  assert.equal(detectFormatViolations("archive_people.md", "## Karl Slade\nbody").length, 0);
});

import { detectDateInconsistencies } from "../src/audit-detectors.js";

test("detectDateInconsistencies flags header vs Created mismatch >1 day", () => {
  const md = [
    "## 2026-04-08 – Foo",
    "– Created: 2026-04-15",
  ].join("\n");
  const f = detectDateInconsistencies("fragments.md", md, "2026-05-08");
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "header-vs-created");
});

test("detectDateInconsistencies tolerates 1-day late-night-write delta", () => {
  const md = [
    "## 2026-04-08 – Foo",
    "– Created: 2026-04-09",
  ].join("\n");
  assert.equal(detectDateInconsistencies("fragments.md", md, "2026-05-08").length, 0);
});

test("detectDateInconsistencies flags Open status with past Due in loops", () => {
  const md = [
    "## 2026-01-01 – Ship the thing",
    "– Status: Open",
    "– Due: 2026-02-01",
  ].join("\n");
  const f = detectDateInconsistencies("loops.md", md, "2026-05-08");
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "stale-due");
});

test("detectDateInconsistencies does not flag Open status with future Due", () => {
  const md = [
    "## 2026-01-01 – Plan",
    "– Status: Open",
    "– Due: 2026-12-31",
  ].join("\n");
  assert.equal(detectDateInconsistencies("loops.md", md, "2026-05-08").length, 0);
});

test("detectDateInconsistencies skips stale-due check for non-loop files", () => {
  const md = [
    "## 2026-01-01 – Foo",
    "– Status: Open",
    "– Due: 2020-01-01",
  ].join("\n");
  assert.equal(detectDateInconsistencies("fragments.md", md, "2026-05-08").length, 0);
});

import { signatureFor, normalizeHeader } from "../src/audit-detectors.js";

test("normalizeHeader lowercases, trims, collapses whitespace", () => {
  assert.equal(normalizeHeader("  Karl  Slade  "), "karl slade");
  assert.equal(normalizeHeader("2026-04-08 – Foo Bar"), "2026-04-08 – foo bar");
});

test("signatureFor builds stable strings per category", () => {
  assert.equal(
    signatureFor({ category: "broken-characters", file: "people.md", section: "Karl Slade", codepoint: "U+1D12F" }),
    "people.md:karl slade:U+1D12F",
  );
  assert.equal(
    signatureFor({ category: "format-violations", file: "fragments.md", section: "Important Links" }),
    "fragments.md:important links",
  );
  assert.equal(
    signatureFor({ category: "date-inconsistencies", file: "loops.md", section: "2026-01-01 – Ship", kind: "stale-due" }),
    "loops.md:2026-01-01 – ship:stale-due",
  );
  assert.equal(
    signatureFor({ category: "near-duplicates", pair: ["Ali Wilkinson", "Ali Reno"] }),
    "near-duplicates:ali reno|ali wilkinson",
  );
  assert.equal(
    signatureFor({ category: "name-mismatches", pair: ["Aviad Phillip", "Aviad Philipp"] }),
    "name-mismatches:aviad philipp|aviad phillip",
  );
});

test("signatureFor handles duplicate-headers", () => {
  assert.equal(
    signatureFor({ category: "duplicate-headers", file: "people.md", section: "Karl Slade" }),
    "people.md:karl slade:duplicate",
  );
});

import { pruneIgnored } from "../src/audit-detectors.js";

test("pruneIgnored drops signatures whose target section is gone", () => {
  const ignored = [
    { signature: "people.md:karl slade:U+1D12F", category: "broken-characters", addedAt: 1 },
    { signature: "people.md:gone person:U+1D12F", category: "broken-characters", addedAt: 2 },
    { signature: "near-duplicates:ali reno|ali wilkinson", category: "near-duplicates", addedAt: 3 },
  ];
  const existing = new Set(["people.md:karl slade", "people.md:ali wilkinson", "people.md:ali reno"]);
  const { kept, pruned } = pruneIgnored(ignored, existing);
  assert.equal(kept.length, 2);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].signature, "people.md:gone person:U+1D12F");
});

test("pruneIgnored keeps near-duplicate pairs only when BOTH sides still exist", () => {
  const ignored = [
    { signature: "near-duplicates:ali reno|ali wilkinson", category: "near-duplicates", addedAt: 1 },
  ];
  const existing = new Set(["people.md:ali reno"]);  // ali wilkinson missing
  const { kept, pruned } = pruneIgnored(ignored, existing);
  assert.equal(kept.length, 0);
  assert.equal(pruned.length, 1);
});

test("pruneIgnored: photo-issues ignored entries survive pruning", () => {
  const ignored = [
    { signature: "photo-ref::person-john-1.jpg", category: "photo-issues", addedAt: "2026-01-01" },
    { signature: "photo-orphan::person-old-2.jpg", category: "photo-issues", addedAt: "2026-01-01" },
  ];
  const fileObjs = [{ name: "people.md", content: "## John\n– Photo: person-john-1.jpg\n" }];
  const { kept } = pruneIgnored(ignored, new Set(), fileObjs);
  assert.equal(kept.length, 2, "both photo-issues entries should survive pruning");
});

// C1 regression: without fileObjs, photo-ref entries get pruned (alive defaults to false).
// All call sites in worker.js must pass fileObjs to avoid silently clearing photo-ref ignores.
test("pruneIgnored: photo-ref entries pruned when fileObjs omitted (two-arg form)", () => {
  const ignored = [
    { signature: "photo-ref::person-jane-1.jpg", category: "photo-issues", addedAt: "2026-01-01" },
    { signature: "photo-orphan::person-old-2.jpg", category: "photo-issues", addedAt: "2026-01-01" },
  ];
  const { kept, pruned } = pruneIgnored(ignored, new Set());  // no fileObjs
  assert.equal(kept.length, 1, "orphan survives (can't check R2)");
  assert.equal(pruned.length, 1, "photo-ref pruned when no fileObjs supplied");
  assert.equal(pruned[0].signature, "photo-ref::person-jane-1.jpg");
});

// I5 regression: liveness check must match ASCII-hyphen photo lines, not just en-dash.
test("pruneIgnored: photo-ref kept when content uses ASCII hyphen (- Photo:)", () => {
  const ignored = [
    { signature: "photo-ref::person-bob-1.jpg", category: "photo-issues", addedAt: "2026-01-01" },
  ];
  const fileObjs = [{ name: "people.md", content: "## Bob\n- Photo: person-bob-1.jpg\n" }];
  const { kept } = pruneIgnored(ignored, new Set(), fileObjs);
  assert.equal(kept.length, 1, "photo-ref survives when referenced with ASCII hyphen");
});

import { PHOTO_FN_PATTERN } from "../src/audit-detectors.js";
import { PHOTO_FILENAME_PATTERN } from "../src/worker.js";

// Pattern-sync: the upload-validation pattern (worker.js) and the audit liveness pattern
// (audit-detectors.js) must match the same filenames.
test("PHOTO_FN_PATTERN in audit-detectors matches PHOTO_FILENAME_PATTERN in worker", () => {
  assert.equal(
    PHOTO_FN_PATTERN.source,
    PHOTO_FILENAME_PATTERN.source,
    "audit-detectors.js and worker.js photo filename patterns must stay in sync"
  );
});

import { estimateDeepScanCost } from "../src/audit-detectors.js";

test("estimateDeepScanCost computes input + output and applies 1.5x ceiling", () => {
  // 30000 bytes total / 3 = 10000 input tokens
  // 100 records × 50 = 5000 output tokens
  // input = 10000 * 0.80 / 1e6 = 0.008
  // output = 5000 * 4.00 / 1e6 = 0.020
  // total = 0.028 ; ceiling = 0.042
  const r = estimateDeepScanCost({ totalBytes: 30000, recordCount: 100 });
  assert.equal(Math.round(r.estimate * 1000), 28); // 0.028
  assert.equal(Math.round(r.ceiling * 1000), 42);  // 0.042
  assert.equal(r.estimatedInputTokens, 10000);
  assert.equal(r.estimatedOutputTokens, 5000);
});

test("estimateDeepScanCost zero-records is harmless", () => {
  const r = estimateDeepScanCost({ totalBytes: 0, recordCount: 0 });
  assert.equal(r.estimate, 0);
  assert.equal(r.ceiling, 0);
});

import { detectDuplicateHeaders } from "../src/audit-detectors.js";

test("detectDuplicateHeaders emits one finding per occurrence with its own occurrenceIndex", () => {
  const md = [
    "## Karl Slade",
    "– Tags: church",
    "",
    "## Sarah Chen",
    "– Tags: work",
    "",
    "## Karl Slade",
    "– Tags: duplicate from a bad write",
  ].join("\n");
  const findings = detectDuplicateHeaders("people.md", md);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].file, "people.md");
  assert.equal(findings[0].section, "Karl Slade");
  assert.equal(findings[0].lineNumber, 1);
  assert.equal(findings[0].occurrenceIndex, 0);
  assert.equal(findings[0].copyNumber, 1);
  assert.equal(findings[0].totalCopies, 2);
  assert.equal(findings[1].lineNumber, 7);
  assert.equal(findings[1].occurrenceIndex, 1);
  assert.equal(findings[1].copyNumber, 2);
  assert.equal(findings[1].totalCopies, 2);
});

test("detectDuplicateHeaders emits three findings for three identical headers", () => {
  const md = ["## A", "body", "## A", "body", "## A", "body"].join("\n");
  const findings = detectDuplicateHeaders("people.md", md);
  assert.equal(findings.length, 3);
  assert.deepEqual(findings.map(f => f.occurrenceIndex), [0, 1, 2]);
  assert.deepEqual(findings.map(f => f.lineNumber), [1, 3, 5]);
  assert.equal(findings[0].totalCopies, 3);
});

test("detectDuplicateHeaders is case-insensitive and whitespace-tolerant", () => {
  const md = [
    "## Karl Slade",
    "## karl  slade ",
  ].join("\n");
  assert.equal(detectDuplicateHeaders("people.md", md).length, 2);
});

test("detectDuplicateHeaders returns nothing when all headers are unique", () => {
  const md = ["## A", "body", "## B", "body", "## C", "body"].join("\n");
  assert.deepEqual(detectDuplicateHeaders("people.md", md), []);
});

test("detectFormatViolations accepts both reflections forms (dated and timestamped)", () => {
  const md = [
    "## 2026-04-15 20:55",     // Form A — timestamped
    "body",
    "## 2026-04-16 – Hike",    // Form B — titled
    "body",
    "## broken header",        // FAIL: neither form
    "body",
  ].join("\n");
  const findings = detectFormatViolations("reflections.md", md);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].section, "broken header");
});

test("detectFormatViolations does NOT accept timestamped form for loops", () => {
  // Loops still require dated form. Fragments have no format check.
  assert.equal(detectFormatViolations("loops.md", "## 2026-04-15 20:55\nbody").length, 1);
});

import { detectNameMismatches } from "../src/audit-detectors.js";

test("detectNameMismatches flags edit-distance-1 typos across records", () => {
  const fileObjs = [
    { name: "people.md", content: "## Amanda Hodgin\n– Tags: work\n\nProduct Director at NICE." },
    { name: "archive_people.md", content: "## Joshua Brown\n– Tags: product, security, Amanda Hodgins" },
  ];
  const findings = detectNameMismatches(fileObjs);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "name-mismatches");
  assert.deepEqual(findings[0].matchedNames.map(n => n.toLowerCase()).sort(), ["amanda hodgin", "amanda hodgins"]);
  assert.deepEqual(findings[0].files.sort(), ["archive_people.md", "people.md"]);
});

test("detectNameMismatches flags edit-distance-2 typos (Phillip vs Philipp)", () => {
  const fileObjs = [
    { name: "people.md", content: "## Aviad Phillip\n– Role: engineer" },
    { name: "fragments.md", content: "## 2026-04-08 – Project notes\nMet with Aviad Philipp today." },
  ];
  const findings = detectNameMismatches(fileObjs);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].confidence, 0.85);
});

test("detectNameMismatches does NOT flag identical names (distance 0)", () => {
  const fileObjs = [
    { name: "people.md", content: "## Amanda Hodgin\n– Tags: work" },
    { name: "fragments.md", content: "## Notes\nMet Amanda Hodgin yesterday." },
  ];
  assert.deepEqual(detectNameMismatches(fileObjs), []);
});

test("detectNameMismatches does NOT flag names within the same record", () => {
  const fileObjs = [
    { name: "people.md", content: "## Amanda Hodgin\n– Tags: work\n\nAlso known as Amanda Hodgins in some old records." },
  ];
  assert.deepEqual(detectNameMismatches(fileObjs), []);
});

test("detectNameMismatches does NOT match too-different names (distance > 2)", () => {
  const fileObjs = [
    { name: "people.md", content: "## Amanda Hodgin\n– Tags: work" },
    { name: "fragments.md", content: "## Notes\nMet Aviad Phillip today." },
  ];
  assert.deepEqual(detectNameMismatches(fileObjs), []);
});

test("detectNameMismatches dedupes symmetric pairs", () => {
  // Each pair should appear at most once even though the name is in both files.
  const fileObjs = [
    { name: "people.md", content: "## Karl Slade\n– Tags: church\n\nKarl Slades is the manager. Karl Slade is the founder." },
    { name: "fragments.md", content: "## Notes\nKarl Slades again." },
  ];
  const findings = detectNameMismatches(fileObjs);
  assert.equal(findings.length, 1);
});

test("detectNameMismatches strips trailing possessives so 'David Arnold' = 'David Arnold's'", () => {
  const fileObjs = [
    { name: "people.md", content: "## David Arnold\n– Role: PM" },
    { name: "fragments.md", content: "## Meeting\nWe spoke with David Arnold's team." },
  ];
  assert.deepEqual(detectNameMismatches(fileObjs), []);
});

test("detectNameMismatches strips trailing periods so 'Steve Thurber' = 'Steve Thurber.'", () => {
  const fileObjs = [
    { name: "people.md", content: "## Steve Thurber\n– Role: VP" },
    { name: "fragments.md", content: "## Notes\nKickoff meeting with Steve Thurber. Then lunch." },
  ];
  assert.deepEqual(detectNameMismatches(fileObjs), []);
});

test("detectNameMismatches does NOT flag short-token coincidental collisions (Max Reno / Maya Reno)", () => {
  // Same surname but distance-2 difference in a 3- or 4-char first name —
  // very likely two different people, not a typo of one. Reject.
  const fileObjs = [
    { name: "people.md", content: "## Max Reno\n– Tags: family" },
    { name: "people.md", content: "## Maya Reno\n– Tags: family" },
  ];
  // (Use distinct files to avoid same-record-skip path)
  const fileObjs2 = [
    { name: "people.md", content: "## Max Reno\n– Tags: family" },
    { name: "fragments.md", content: "## Notes\nMaya Reno called." },
  ];
  assert.deepEqual(detectNameMismatches(fileObjs2), []);
});

test("detectNameMismatches still catches genuine surname typos (Phillip / Philipp)", () => {
  const fileObjs = [
    { name: "people.md", content: "## Aviad Phillip\n– Role: dev" },
    { name: "fragments.md", content: "## Notes\nMet with Aviad Philipp today." },
  ];
  const findings = detectNameMismatches(fileObjs);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].confidence, 0.85);
});

test("detectNameMismatches rejects pairs with different token counts", () => {
  // "Karl Slade" vs "Karl Slade Jr" — extra token, not a typo. Skip.
  const fileObjs = [
    { name: "people.md", content: "## Karl Slade\n– Tags: x" },
    { name: "fragments.md", content: "## Notes\nKarl Slade Jr was there." },
  ];
  assert.deepEqual(detectNameMismatches(fileObjs), []);
});

// ---- detectPhotoIssues -------------------------------------------------------

import { detectPhotoIssues } from "../src/audit-detectors.js";

function makeMockR2(existingKeys = []) {
  const keySet = new Set(existingKeys);
  return {
    head: async (key) => keySet.has(key) ? { key } : null,
    list: async ({ prefix } = {}) => ({
      objects: existingKeys
        .filter(k => !prefix || k.startsWith(prefix))
        .map(k => ({ key: k })),
    }),
  };
}

const PEOPLE_WITH_PHOTOS = `# people.md

## John Berry
– Tags: personal
– Photo: person-john-berry-1.jpg

## Maria Lopez
– Tags: work
`;

test("detectPhotoIssues: no R2 binding → empty findings", async () => {
  const fileObjs = [{ name: "people.md", content: PEOPLE_WITH_PHOTOS }];
  const findings = await detectPhotoIssues(fileObjs, null);
  assert.deepEqual(findings, []);
});

test("detectPhotoIssues: referenced photo exists in R2 → no broken-ref finding", async () => {
  const env = { DOWNLOADS: makeMockR2(["photos/person-john-berry-1.jpg"]) };
  const fileObjs = [{ name: "people.md", content: PEOPLE_WITH_PHOTOS }];
  const findings = await detectPhotoIssues(fileObjs, env);
  const broken = findings.filter(f => f.signature.startsWith("photo-ref::"));
  assert.equal(broken.length, 0);
});

test("detectPhotoIssues: referenced photo missing from R2 → broken-ref finding", async () => {
  const env = { DOWNLOADS: makeMockR2([]) }; // no objects in R2
  const fileObjs = [{ name: "people.md", content: PEOPLE_WITH_PHOTOS }];
  const findings = await detectPhotoIssues(fileObjs, env);
  const broken = findings.filter(f => f.signature.startsWith("photo-ref::"));
  assert.equal(broken.length, 1);
  assert.equal(broken[0].signature, "photo-ref::person-john-berry-1.jpg");
  assert.equal(broken[0].section, "John Berry");
  assert.equal(broken[0].file, "people.md");
});

test("detectPhotoIssues: R2 object with no MD reference → orphan finding", async () => {
  const env = { DOWNLOADS: makeMockR2(["photos/person-orphan-1.jpg"]) };
  const fileObjs = [{ name: "people.md", content: PEOPLE_WITH_PHOTOS }]; // no reference to orphan
  const findings = await detectPhotoIssues(fileObjs, env);
  const orphans = findings.filter(f => f.signature.startsWith("photo-orphan::"));
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].signature, "photo-orphan::person-orphan-1.jpg");
});

test("detectPhotoIssues: photo in archive people.md is checked", async () => {
  const archiveContent = `## Old Friend\n– Photo: person-old-friend-1.jpg\n`;
  const env = { DOWNLOADS: makeMockR2([]) };
  const fileObjs = [
    { name: "people.md", content: "" },
    { name: "archive_people.md", content: archiveContent },
  ];
  const findings = await detectPhotoIssues(fileObjs, env);
  const broken = findings.filter(f => f.signature.startsWith("photo-ref::"));
  assert.equal(broken.length, 1);
  assert.equal(broken[0].file, "archive_people.md");
});

test("detectPhotoIssues: photo referenced in archive but not in scope fileObjs is NOT an orphan", async () => {
  // When audit scope is "active", archived people are not in fileObjs.
  // Their photos must not be flagged as orphans — the allPeopleFileObjs param
  // provides the full cross-tier reference set for orphan detection.
  const archiveContent = `## Archived Person\n– Photo: person-archived-1.jpg\n`;
  const env = { DOWNLOADS: makeMockR2(["photos/person-archived-1.jpg"]) };
  const scopeFileObjs = [{ name: "people.md", content: "" }]; // active scope only
  const allPeopleFileObjs = [
    { name: "people.md", content: "" },
    { name: "archive_people.md", content: archiveContent },
  ];
  const findings = await detectPhotoIssues(scopeFileObjs, env, allPeopleFileObjs);
  const orphans = findings.filter(f => f.signature.startsWith("photo-orphan::"));
  assert.equal(orphans.length, 0, "archived person photo should not be flagged as orphan");
});

test("detectPhotoIssues: hyphen-prefixed Photo line is recognized (M9)", async () => {
  const content = `## Alex\n- Photo: person-alex-1.jpg\n`; // hyphen, not en-dash
  const env = { DOWNLOADS: makeMockR2([]) };
  const fileObjs = [{ name: "people.md", content }];
  const findings = await detectPhotoIssues(fileObjs, env);
  const broken = findings.filter(f => f.signature.startsWith("photo-ref::"));
  assert.equal(broken.length, 1, "hyphen-prefix photo line should be found as broken ref");
});

test("detectPhotoIssues: broken ref in reflections.md is detected", async () => {
  const content = `## 2026-07-04 — Sunset\n– Photo: reflection-sunset-1.jpg\n`;
  const env = { DOWNLOADS: makeMockR2([]) };
  const fileObjs = [{ name: "reflections.md", content }];
  const findings = await detectPhotoIssues(fileObjs, env);
  const broken = findings.filter(f => f.signature.startsWith("photo-ref::"));
  assert.equal(broken.length, 1, "should detect broken ref in reflections.md");
  assert.ok(broken[0].signature.includes("reflection-sunset-1.jpg"), "signature includes filename");
});

test("detectPhotoIssues: reflection photo not orphaned when referenced in allMemoryFileObjs", async () => {
  const content = `## 2026-07-04 — Sunset\n– Photo: reflection-sunset-1.jpg\n`;
  const env = { DOWNLOADS: makeMockR2(["photos/reflection-sunset-1.jpg"]) };
  const fileObjs = [{ name: "reflections.md", content }];
  const allMemoryFileObjs = [{ name: "reflections.md", content }];
  const findings = await detectPhotoIssues(fileObjs, env, allMemoryFileObjs);
  const orphans = findings.filter(f => f.signature.startsWith("photo-orphan::"));
  assert.equal(orphans.length, 0, "reflection photo should not be flagged as orphan");
});
