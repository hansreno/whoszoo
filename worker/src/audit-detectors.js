// Pure detectors and metadata for the memory audit feature.
// Mostly pure and binding-free — safe to unit-test with `node --test`.
// Exception: detectPhotoIssues(fileObjs, env) takes an optional R2 env for R2 access.

export const AUDIT_CATEGORIES = [
  { id: "broken-characters",   label: "Broken Characters",   scan: "quick", icon: "✨" },
  { id: "format-violations",   label: "Format Violations",   scan: "quick", icon: "📁" },
  { id: "date-inconsistencies",label: "Date Inconsistencies",scan: "quick", icon: "📅" },
  { id: "duplicate-headers",   label: "Duplicate Headers",   scan: "quick", icon: "🔂" },
  { id: "near-duplicates",     label: "Near-duplicates",     scan: "deep",  icon: "🔁" },
  { id: "name-mismatches",     label: "Name Mismatches",     scan: "deep",  icon: "🔍" },
  { id: "photo-issues",        label: "Photo Issues",        scan: "deep",  icon: "📷" },
];

// Parses a markdown string into top-level (## ) sections.
// Returns: [{ header, headerLine, bodyLines, startLine, endLine }]
// Line numbers are 1-based to match human/editor convention.
export function parseSections(md) {
  if (!md || typeof md !== "string") return [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!m) { i++; continue; }
    const header = m[1].trim();
    const headerLine = i + 1;
    const startLine = headerLine;
    let j = i + 1;
    while (j < lines.length && !/^##\s+/.test(lines[j])) j++;
    const bodyLines = lines.slice(i + 1, j);
    sections.push({ header, headerLine, bodyLines, startLine, endLine: j });
    i = j;
  }
  return sections;
}

// Returns findings of shape:
//   { file, section, lineNumber, codepoint, snippet }
export function detectBrokenCharacters(file, md) {
  const findings = [];
  const sections = parseSections(md);
  for (const sec of sections) {
    let nonBlankSeen = 0;
    for (let k = 0; k < sec.bodyLines.length && nonBlankSeen < 10; k++) {
      const line = sec.bodyLines[k];
      if (/^###\s+/.test(line)) break;
      if (!line.trim()) continue;
      nonBlankSeen++;
      // Looks-like-metadata heuristic: <singleChar><space><Word>: <value>
      // Use Unicode flag (u) to properly handle surrogate pairs and multi-byte characters
      const looksMeta = /^\S\s+[A-Za-z][A-Za-z ]{0,30}:\s+\S/u.test(line);
      if (!looksMeta) continue;
      // Get the first character (properly handling Unicode)
      const lead = [...line][0];
      if (lead === "–" || lead === "-") continue;
      const code = lead.codePointAt(0);
      const codepoint = "U+" + code.toString(16).toUpperCase().padStart(4, "0");
      findings.push({
        file,
        section: sec.header,
        lineNumber: sec.headerLine + 1 + k,
        codepoint,
        snippet: line.slice(0, 60),
      });
    }
  }
  return findings;
}

// Maps a filename (live, archive, deeparchive) to its expected header style.
function fileFamily(file) {
  const base = file.replace(/^archive_/, "").replace(/^deeparchive_/, "");
  if (base === "people.md") return "person";
  if (base === "reflections.md") return "reflection";
  if (base === "loops.md") return "dated";
  if (base === "fragments.md") return "fragment"; // any non-empty header is valid
  return null;
}

const DATED_HEADER_RE       = /^\d{4}-\d{2}-\d{2}\s+[—–-]\s+\S/;
const TIMESTAMPED_HEADER_RE = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(\s+[—–-]\s+\S.*)?$/; // reflections: YYYY-MM-DD HH:MM with optional em/en/hyphen dash + title
const PERSON_HEADER_RE      = /^\p{Lu}[\p{L}'`.-]*(?:\s+\p{Lu}[\p{L}'`.-]*){0,2}$/u;

// Returns findings of shape:
//   { file, section, lineNumber, expected }
export function detectFormatViolations(file, md) {
  const family = fileFamily(file);
  if (!family) return [];
  // Fragments are reference notes, contact info, how-to guides, URLs — date is
  // optional. parseSections already requires non-empty headers, so any section
  // that exists in fragments.md is valid by definition.
  if (family === "fragment") return [];
  const findings = [];
  for (const sec of parseSections(md)) {
    let valid;
    let expected;
    if (family === "person") {
      valid = PERSON_HEADER_RE.test(sec.header);
      expected = "First Last";
    } else if (family === "reflection") {
      valid = DATED_HEADER_RE.test(sec.header) || TIMESTAMPED_HEADER_RE.test(sec.header);
      expected = "YYYY-MM-DD — Title  OR  YYYY-MM-DD HH:MM  OR  YYYY-MM-DD HH:MM — Title";
    } else {
      valid = DATED_HEADER_RE.test(sec.header);
      expected = "YYYY-MM-DD – Title";
    }
    if (!valid) {
      findings.push({ file, section: sec.header, lineNumber: sec.headerLine, expected });
    }
  }
  return findings;
}

function dateDiffDays(a, b) {
  const ms = Math.abs(new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z"));
  return ms / 86400000;
}

export function detectDateInconsistencies(file, md, todayISO) {
  const today = todayISO || new Date().toISOString().slice(0, 10);
  const isLoops = /(^|_)loops\.md$/.test(file);
  const findings = [];
  for (const sec of parseSections(md)) {
    const headerDateMatch = sec.header.match(/^(\d{4}-\d{2}-\d{2})/);
    const meta = sec.bodyLines.slice(0, 10);
    const createdLine = meta.find(l => /^[-–]\s+Created:\s+\d{4}-\d{2}-\d{2}/i.test(l));
    if (headerDateMatch && createdLine) {
      const created = createdLine.match(/(\d{4}-\d{2}-\d{2})/)[1];
      if (dateDiffDays(headerDateMatch[1], created) > 1) {
        findings.push({ file, section: sec.header, kind: "header-vs-created", headerDate: headerDateMatch[1], createdDate: created });
      }
    }
    if (isLoops) {
      const status = meta.find(l => /^[-–]\s+Status:\s+/i.test(l));
      const due = meta.find(l => /^[-–]\s+Due:\s+\d{4}-\d{2}-\d{2}/i.test(l));
      if (status && /Status:\s+Open/i.test(status) && due) {
        const dueDate = due.match(/(\d{4}-\d{2}-\d{2})/)[1];
        if (dueDate < today) {
          findings.push({ file, section: sec.header, kind: "stale-due", dueDate });
        }
      }
    }
  }
  return findings;
}

// Detects exact-match duplicate ## headers within a single file.
// Emits ONE finding per occurrence (not per group) so each duplicate card has
// its own occurrenceIndex and Open button can target a specific instance.
// All findings within a duplicate group share the same signature, so ignoring
// one hides all of them on subsequent runs (intentional — the user is saying
// "this duplicate pair is fine, don't show it").
// Returns: [{ file, section, lineNumber, occurrenceIndex, copyNumber, totalCopies }]
export function detectDuplicateHeaders(file, md) {
  const groups = new Map(); // norm -> { canonical, occurrences: [{ headerLine, occurrenceIndex }] }
  let perFileOccurrence = new Map(); // norm -> running counter
  for (const sec of parseSections(md)) {
    const norm = normalizeHeader(sec.header);
    if (!groups.has(norm)) groups.set(norm, { canonical: sec.header, occurrences: [] });
    const occurrenceIndex = perFileOccurrence.get(norm) || 0;
    perFileOccurrence.set(norm, occurrenceIndex + 1);
    groups.get(norm).occurrences.push({ headerLine: sec.headerLine, occurrenceIndex });
  }
  const findings = [];
  for (const { canonical, occurrences } of groups.values()) {
    if (occurrences.length >= 2) {
      occurrences.forEach((occ, i) => {
        findings.push({
          file,
          section: canonical,
          lineNumber: occ.headerLine,
          occurrenceIndex: occ.occurrenceIndex,
          copyNumber: i + 1,
          totalCopies: occurrences.length,
        });
      });
    }
  }
  return findings;
}

// Lowercase and trim header strings, collapsing whitespace.
export function normalizeHeader(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Build stable ignore-state keys from finding objects.
// Used to persist which audit items the user has dismissed.
export function signatureFor(f) {
  switch (f.category) {
    case "broken-characters":
      return `${f.file}:${normalizeHeader(f.section)}:${f.codepoint}`;
    case "format-violations":
      return `${f.file}:${normalizeHeader(f.section)}`;
    case "date-inconsistencies":
      return `${f.file}:${normalizeHeader(f.section)}:${f.kind}`;
    case "duplicate-headers":
      return `${f.file}:${normalizeHeader(f.section)}:duplicate`;
    case "photo-issues":
      // signature is pre-computed by detectPhotoIssues (photo-ref:: or photo-orphan::)
      return f.signature;
    case "near-duplicates":
    case "name-mismatches": {
      // Prefer matchedNames for name-mismatches (deterministic detector emits
      // these) so ignoring "Amanda Hodgin/Hodgins" hides the pair everywhere
      // it appears, not just at the first reported location.
      const source = (f.category === "name-mismatches" && Array.isArray(f.matchedNames) && f.matchedNames.length === 2)
        ? f.matchedNames
        : f.pair;
      const [a, b] = source.map(normalizeHeader).sort();
      return `${f.category}:${a}|${b}`;
    }
    default:
      throw new Error(`Unknown category: ${f.category}`);
  }
}

// existing: Set of `${file}:${normalizedHeader}` strings — built by the caller from current memory state.
// For pair-based categories the caller stores entries for ALL files where each name appears;
// pruneIgnored requires every name in the pair to match at least one such entry.
// fileObjs: optional array of { name, content } — used to prune photo-ref:: entries whose
// referenced filename no longer appears in any people file's content.
export function pruneIgnored(ignored, existing, fileObjs = []) {
  const kept = [];
  const pruned = [];
  const headerExists = (norm) => {
    for (const k of existing) { if (k.endsWith(":" + norm)) return true; }
    return false;
  };
  for (const entry of ignored) {
    const sig = entry.signature;
    let alive = false;
    if (entry.category === "near-duplicates" || entry.category === "name-mismatches") {
      const m = sig.match(/^[a-z-]+:(.+)\|(.+)$/);
      if (m) alive = headerExists(m[1]) && headerExists(m[2]);
    } else if (entry.category === "photo-issues") {
      if (sig.startsWith("photo-orphan::")) {
        alive = true; // can't check R2; orphan won't recur after deletion
      } else if (sig.startsWith("photo-ref::")) {
        const fn = sig.slice("photo-ref::".length);
        alive = (fileObjs || []).some(f => f.content && (f.content.includes(`– Photo: ${fn}`) || f.content.includes(`- Photo: ${fn}`)));
      } else {
        alive = false;
      }
    } else {
      const fileSec = sig.split(":").slice(0, 2).join(":");
      alive = existing.has(fileSec);
    }
    (alive ? kept : pruned).push(entry);
  }
  return { kept, pruned };
}

const HAIKU_INPUT_PER_MTOK  = 0.80;
const HAIKU_OUTPUT_PER_MTOK = 4.00;

export function estimateDeepScanCost({ totalBytes, recordCount }) {
  const estimatedInputTokens  = Math.ceil(totalBytes / 3);
  const estimatedOutputTokens = recordCount * 50;
  const inputCost  = estimatedInputTokens  * HAIKU_INPUT_PER_MTOK  / 1_000_000;
  const outputCost = estimatedOutputTokens * HAIKU_OUTPUT_PER_MTOK / 1_000_000;
  const estimate = inputCost + outputCost;
  const ceiling  = estimate * 1.5;
  return { estimate, ceiling, estimatedInputTokens, estimatedOutputTokens, inputCost, outputCost };
}

// Levenshtein with an early-out for length-mismatched inputs (any length
// difference > 2 cannot have edit distance ≤ 2, so we skip the DP).
function _editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Match 2- or 3-token capitalized names (Amanda Hodgin, Karl Slade Jr).
// Each token must start with an uppercase letter (Unicode-aware) and have
// at least 3 characters total — filters out short noise like "Mr." or "If".
// Separator is horizontal whitespace ONLY ([ \t]+) so we never glue a header
// like "## Notes" to the first capitalized word of its body.
const NAME_TOKEN_RE = /\p{Lu}[\p{L}'`.-]{2,}(?:[ \t]+\p{Lu}[\p{L}'`.-]{2,}){1,2}/gu;

// Strip trailing possessives ('s, '), full stops, and other terminal
// punctuation so "David Arnold's" and "David Arnold." both canonicalize
// to "David Arnold". Without this, every name at the end of a sentence
// gets flagged as a "typo" of itself.
function _cleanName(s) {
  return String(s)
    .replace(/[’']s?$/u, "")
    .replace(/[.,:;!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Token-level mismatch check. Requires:
//   - same token count (so "Amanda Hodgin" vs "Amanda Hodgin Smith" is rejected)
//   - exactly one differing token (so the rest of the name matches identically)
//   - the differing token has edit distance 1-2
//   - distance 2 requires both differing tokens ≥ 5 chars (avoids
//     "Max Reno" vs "Maya Reno" — coincidental short-name collisions)
//   - distance 1 requires both differing tokens ≥ 4 chars
// Returns { dist, mismatchIdx } or null.
function _tokenLevelMismatch(canonicalA, canonicalB) {
  const ta = canonicalA.split(" ");
  const tb = canonicalB.split(" ");
  if (ta.length !== tb.length) return null;
  let mismatchIdx = -1;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] !== tb[i]) {
      if (mismatchIdx !== -1) return null;
      mismatchIdx = i;
    }
  }
  if (mismatchIdx === -1) return null; // identical, not a mismatch
  const a = ta[mismatchIdx], b = tb[mismatchIdx];
  const dist = _editDistance(a, b);
  if (dist < 1 || dist > 2) return null;
  if (dist === 2 && (a.length < 5 || b.length < 5)) return null;
  if (dist === 1 && (a.length < 4 || b.length < 4)) return null;
  return { dist, mismatchIdx };
}

// Detects edit-distance 1-2 typos in proper-noun names across records.
// Compares multi-word capitalized names (filters single-word noise) and
// requires the two occurrences to live in DIFFERENT records.
//
// Input: Array of { name: filename, content } for all files in scope.
// Output: [{ category, pair, files, matchedNames, lineNumbers, reason, confidence }]
//
// Replaces the previous Haiku-driven name-mismatch step. Deterministic,
// free, and reproducible — the same memory state always yields the same
// findings.
export function detectNameMismatches(fileObjs) {
  // Step 1 — collect occurrences of every capitalized multi-word name.
  // Keyed by the lower-cased canonical form so case variants collapse.
  const occurrences = new Map();
  for (const f of fileObjs) {
    for (const sec of parseSections(f.content)) {
      const fullText = `## ${sec.header}\n${sec.bodyLines.join("\n")}`;
      const seenInThisSection = new Set();
      const re = new RegExp(NAME_TOKEN_RE.source, NAME_TOKEN_RE.flags);
      let m;
      while ((m = re.exec(fullText)) !== null) {
        const display = _cleanName(m[0]);
        // After cleaning, ensure we still have at least 2 capitalized tokens —
        // otherwise the original was likely "Word." or "Word's" with one real
        // token and trailing punctuation we just stripped.
        if (display.split(/\s+/).filter(Boolean).length < 2) continue;
        const canonical = display.toLowerCase();
        if (seenInThisSection.has(canonical)) continue;
        seenInThisSection.add(canonical);
        if (!occurrences.has(canonical)) occurrences.set(canonical, []);
        occurrences.get(canonical).push({
          file: f.name,
          section: sec.header,
          headerLine: sec.headerLine,
          displayName: display,
        });
      }
    }
  }

  // Step 2 — compare every unique name to every other unique name.
  const names = Array.from(occurrences.keys());
  const findings = [];
  const seenPairs = new Set();

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const info = _tokenLevelMismatch(names[i], names[j]);
      if (!info) continue;

      // Find first cross-record occurrence (same name in same record is fine,
      // we only want to flag when a typo appears in DIFFERENT records).
      const occA = occurrences.get(names[i]);
      const occB = occurrences.get(names[j]);
      let bestA = null, bestB = null;
      outer: for (const oa of occA) {
        for (const ob of occB) {
          if (oa.file === ob.file && oa.section === ob.section) continue;
          bestA = oa; bestB = ob;
          break outer;
        }
      }
      if (!bestA) continue;

      // Dedup by sorted display-name pair so symmetric matches collapse.
      const pairKey = [bestA.displayName, bestB.displayName]
        .map(s => s.toLowerCase()).sort().join("|");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      findings.push({
        category: "name-mismatches",
        pair: [bestA.section, bestB.section],
        files: [bestA.file, bestB.file],
        matchedNames: [bestA.displayName, bestB.displayName],
        lineNumbers: [bestA.headerLine, bestB.headerLine],
        reason: `${bestA.displayName} vs ${bestB.displayName} — edit distance ${info.dist}, likely typo`,
        confidence: info.dist === 1 ? 0.95 : 0.85,
      });
    }
  }

  return findings;
}

// Photo filename pattern — mirrors PHOTO_FILENAME_PATTERN in worker.js.
// Duplicated here because audit-detectors.js has no access to worker.js exports.
// Used by detectPhotoIssues to skip non-conforming R2 keys in orphan detection.
export const PHOTO_FN_PATTERN = /^(person|reflection|fragment|loop)-[a-z0-9-]+-\d+\.(jpg|png|webp|gif)$/;
const _PHOTO_FN_PATTERN = PHOTO_FN_PATTERN;

// Async detector — requires env.DOWNLOADS (R2 binding).
// Returns [] immediately when env or env.DOWNLOADS is not available.
// Emits two types of findings:
//   photo-ref::filename — referenced in markdown but not found in R2
//   photo-orphan::filename — stored in R2 but not referenced in any memory file
//
// allMemoryFileObjs (optional) — all 12 memory files regardless of audit scope.
// Used for orphan detection only: a photo referenced by any archived record is NOT
// an orphan, even when the audit scope is "active" and archive files aren't in
// fileObjs. When omitted, falls back to fileObjs (all-scope audits are unaffected).
export async function detectPhotoIssues(fileObjs, env, allMemoryFileObjs) {
  if (!env || !env.DOWNLOADS) return [];

  const allFiles = allMemoryFileObjs || fileObjs;

  // Build allRefs for ORPHAN detection — covers all tiers and all file types to
  // avoid false positives when audit scope is narrower than the full memory set.
  const allRefs = new Set();
  for (const f of (allFiles || [])) {
    for (const sec of parseSections(f.content)) {
      const body = sec.bodyLines.join("\n");
      for (const m of body.matchAll(/^[–-] Photo: (.+)$/gm)) {
        allRefs.add(m[1].trim());
      }
    }
  }

  // Collect scope-limited Photo: references from fileObjs for BROKEN-REF detection.
  // Only files within the audit scope are checked — broken refs in archived files
  // are only surfaced when the user audits that tier.
  const refs = new Map(); // filename → { sectionHeader, file }
  for (const f of (fileObjs || [])) {
    for (const sec of parseSections(f.content)) {
      const body = sec.bodyLines.join("\n");
      for (const m of body.matchAll(/^[–-] Photo: (.+)$/gm)) {
        const photoFilename = m[1].trim();
        if (!refs.has(photoFilename)) refs.set(photoFilename, { sectionHeader: sec.header, file: f.name });
      }
    }
  }

  const findings = [];

  // Finding type 1: broken references — in markdown, missing from R2
  const brokenFindings = await Promise.all(
    [...refs.entries()].map(async ([filename, { sectionHeader, file }]) => {
      try {
        const obj = await env.DOWNLOADS.head("photos/" + filename);
        if (!obj) {
          return {
            file, section: sectionHeader, lineNumber: null,
            reason: `"– Photo: ${filename}" in section "${sectionHeader}" — file not found in R2`,
            signature: `photo-ref::${filename}`,
            category: "photo-issues",
          };
        }
      } catch {
        return {
          file, section: sectionHeader, lineNumber: null,
          reason: `"– Photo: ${filename}" in section "${sectionHeader}" — file not found in R2`,
          signature: `photo-ref::${filename}`,
          category: "photo-issues",
        };
      }
      return null;
    })
  );
  findings.push(...brokenFindings.filter(Boolean));

  // Finding type 2: orphaned R2 objects — in R2, no matching markdown reference
  try {
    const listed = await env.DOWNLOADS.list({ prefix: "photos/" });
    // If >1000 photos exist, list() is truncated; orphan detection may be incomplete.
    for (const obj of (listed.objects || [])) {
      const filename = obj.key.slice("photos/".length);
      if (!_PHOTO_FN_PATTERN.test(filename)) continue; // skip non-conforming keys
      if (!allRefs.has(filename)) {
        findings.push({
          file: null, section: null, lineNumber: null,
          reason: `"${filename}" in R2 has no matching record`,
          signature: `photo-orphan::${filename}`,
          category: "photo-issues",
          deletePhotoFilename: filename,
        });
      }
    }
  } catch {}

  return findings;
}
