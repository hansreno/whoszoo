// Tier A: endpoint-logic tests — pure-function coverage for the business logic
// behind /replaceSection, /deleteSection, /getMemoryFile (PROTECTED_KEYS guard),
// and tier-move operations (/moveToArchive, /moveToDeep, /restoreFromArchive,
// /restoreFromDeep). No network, no KV, no AI. Runs via `node --test`. Free.
//
// These tests exist because the endpoints listed above had zero coverage even
// though they handle every user-initiated write and all memory graduation.
// The pure functions extracted here are the exact code the handlers call.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTECTED_KEYS,
  RECOVERY_PATHS,
  isRecoveryPath,
  REAUTH_ACTIONS,
  SESSION_LOGIN_METHODS,
  AUTH_FAIL_LIMITS,
  authLockoutReason,
  PBKDF2,
  parseAuthConfig,
  needsRehash,
  PHOTO_FILENAME_PATTERN,
  buildFileWithSectionReplaced,
  buildTierMoveFiles,
  findSectionSpan,
  sha256Hex,
} from "../src/worker.js";

// ---- PROTECTED_KEYS -------------------------------------------------------
// /getMemoryFile checks PROTECTED_KEYS.has(filename) before serving content.
// These tests are a regression guard: if someone adds a new config key to the
// worker without adding it to PROTECTED_KEYS, that key would be readable by
// any authenticated session — a secrets leak.

test("PROTECTED_KEYS blocks all auth and credential keys", () => {
  for (const k of ["auth_config", "webauthn_credential", "webauthn_challenge"]) {
    assert.ok(PROTECTED_KEYS.has(k), `PROTECTED_KEYS must include "${k}"`);
  }
});

test("PROTECTED_KEYS blocks all API key KV overrides", () => {
  for (const k of ["config_anthropic_api_key", "config_openai_api_key", "config_elevenlabs_api_key"]) {
    assert.ok(PROTECTED_KEYS.has(k), `PROTECTED_KEYS must include "${k}"`);
  }
});

test("PROTECTED_KEYS blocks audit and cost state", () => {
  for (const k of ["cost_log", "audit_ignored", "audit_last_run"]) {
    assert.ok(PROTECTED_KEYS.has(k), `PROTECTED_KEYS must include "${k}"`);
  }
});

test("PROTECTED_KEYS does NOT block readable memory files", () => {
  const readable = [
    "people.md", "reflections.md", "fragments.md", "loops.md",
    "archive_people.md", "archive_reflections.md", "archive_fragments.md", "archive_loops.md",
    "deeparchive_people.md", "deeparchive_reflections.md",
  ];
  for (const f of readable) {
    assert.ok(!PROTECTED_KEYS.has(f), `Memory file "${f}" must NOT be in PROTECTED_KEYS`);
  }
});

// ---- buildFileWithSectionReplaced -----------------------------------------
// Used by /replaceSection (new content), /deleteSection (empty), and
// /compactSection (compacted content).

const TWO_SECTION_FILE = [
  "# people.md",
  "",
  "## Sarah Chen",
  "– Role: PM",
  "– Created: 2026-01-01",
  "",
  "## Bob Smith",
  "– Role: Eng",
  "– Created: 2026-02-01",
].join("\n");

test("buildFileWithSectionReplaced replaces content in a section", () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const result = buildFileWithSectionReplaced(lines, span, ["## Sarah Chen", "– Role: Director"]);
  assert.ok(result.includes("– Role: Director"), "replacement content must appear");
  assert.ok(!result.includes("– Role: PM"), "old content must be gone");
  assert.ok(result.includes("## Bob Smith"), "other sections must be preserved");
});

test("buildFileWithSectionReplaced with empty replacement deletes the section", () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const result = buildFileWithSectionReplaced(lines, span, []);
  assert.ok(!result.includes("Sarah Chen"), "deleted section must be gone");
  assert.ok(result.includes("## Bob Smith"), "other sections must remain");
});

test("buildFileWithSectionReplaced collapses 3+ blank lines to at most 2", () => {
  const file = ["## Alice", "– Tag: foo", "", "", "", "", "## Bob", "– Tag: bar"].join("\n");
  const lines = file.split("\n");
  const span = findSectionSpan(lines, "Alice");
  const result = buildFileWithSectionReplaced(lines, span, ["## Alice", "– Tag: baz"]);
  assert.ok(!/\n{3,}/.test(result), "result must not contain 3+ consecutive newlines");
});

test("buildFileWithSectionReplaced handles deleting the last section in a file", () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Bob Smith");
  const result = buildFileWithSectionReplaced(lines, span, []);
  assert.ok(!result.includes("Bob Smith"), "last section must be gone after delete");
  assert.ok(result.includes("## Sarah Chen"), "first section must remain");
});

test("buildFileWithSectionReplaced always ends with exactly one trailing newline", () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const result = buildFileWithSectionReplaced(lines, span, ["## Sarah Chen", "– Role: VP"]);
  assert.ok(result.endsWith("\n"), "must end with newline");
  assert.ok(!result.endsWith("\n\n"), "must not end with double newline");
});

test("buildFileWithSectionReplaced output has no CRLF after handler-level normalization", () => {
  // Handlers always call content.replace(/\r\n/g, "\n") before splitting.
  // This test mirrors that: normalize first, then verify the function's output is clean.
  const crlf = TWO_SECTION_FILE.replace(/\n/g, "\r\n");
  const lines = crlf.replace(/\r\n/g, "\n").split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const result = buildFileWithSectionReplaced(lines, span, ["## Sarah Chen", "– Role: VP"]);
  assert.ok(!result.includes("\r\n"), "output must not contain CRLF sequences");
});

// ---- buildTierMoveFiles ---------------------------------------------------
// Used by /moveToArchive, /moveToDeep, /restoreFromArchive, /restoreFromDeep.
// The "write destination first, then delete source" safety pattern relies on
// both outputs being correct.

test("buildTierMoveFiles removes the moved section from the source", () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const { newSrc } = buildTierMoveFiles(lines, span, null);
  assert.ok(!newSrc.includes("Sarah Chen"), "moved section must be removed from source");
  assert.ok(newSrc.includes("## Bob Smith"), "other sections must remain in source");
});

test("buildTierMoveFiles appends the section to an empty destination", () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const { newDest } = buildTierMoveFiles(lines, span, null);
  assert.ok(newDest.includes("## Sarah Chen"), "section header must appear in destination");
  assert.ok(newDest.includes("– Role: PM"), "section body must appear in destination");
});

test("buildTierMoveFiles appends to existing destination content", () => {
  const existing = "# archive_people.md\n\n## Old Person\n– Tag: legacy\n";
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const { newDest } = buildTierMoveFiles(lines, span, existing);
  assert.ok(newDest.includes("## Old Person"), "existing destination section must be preserved");
  assert.ok(newDest.includes("## Sarah Chen"), "moved section must appear in destination");
});

test("buildTierMoveFiles: section is in dest and NOT in src", () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const { newSrc, newDest } = buildTierMoveFiles(lines, span, null);
  assert.ok(newDest.includes("Sarah Chen"), "section must be in destination");
  assert.ok(!newSrc.includes("Sarah Chen"), "section must not remain in source");
});

test("buildTierMoveFiles both outputs end with exactly one trailing newline", () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const { newSrc, newDest } = buildTierMoveFiles(lines, span, "## Existing\n– Tag: old\n");
  assert.ok(newSrc.endsWith("\n") && !newSrc.endsWith("\n\n"), "source must end with single newline");
  assert.ok(newDest.endsWith("\n") && !newDest.endsWith("\n\n"), "dest must end with single newline");
});

test("buildTierMoveFiles moving the last section leaves a clean source", () => {
  const single = "# people.md\n\n## Only Person\n– Tag: sole\n";
  const lines = single.split("\n");
  const span = findSectionSpan(lines, "Only Person");
  const { newSrc } = buildTierMoveFiles(lines, span, null);
  assert.ok(!newSrc.includes("Only Person"), "section must be gone from source");
  assert.ok(newSrc.endsWith("\n"), "source must still end with newline");
  assert.ok(!/\n{3,}/.test(newSrc), "source must not have 3+ blank lines after move");
});

// ---- 409 conflict guard pattern ------------------------------------------
// /replaceSection, /deleteSection, /moveToArchive, /moveToDeep etc. all check:
//   sha256Hex(lines.slice(span.iHeader, span.iEnd).join("\n")) === body.sectionHash
// If the hashes differ, the endpoint returns 409. These tests verify the hash
// is stable and sensitive to mutations — the same check that caught the silent
// m[1]/m[2] regex bug that disabled the collision guard for months.

test("section hash is deterministic across calls", async () => {
  const lines = TWO_SECTION_FILE.split("\n");
  const span = findSectionSpan(lines, "Sarah Chen");
  const section = lines.slice(span.iHeader, span.iEnd).join("\n");
  const h1 = await sha256Hex(section);
  const h2 = await sha256Hex(section);
  assert.equal(h1, h2, "hash must be identical across calls");
});

test("section hash differs when a field value changes (edit detected → 409)", async () => {
  const original = "## Sarah Chen\n– Role: PM\n– Created: 2026-01-01";
  const modified  = "## Sarah Chen\n– Role: Director\n– Created: 2026-01-01";
  const h1 = await sha256Hex(original);
  const h2 = await sha256Hex(modified);
  assert.notEqual(h1, h2, "changed content must produce a different hash");
});

test("section hash differs when a single character is added (no false negatives)", async () => {
  const base = "## Sarah Chen\n– Role: PM";
  const h1 = await sha256Hex(base);
  const h2 = await sha256Hex(base + "x");
  assert.notEqual(h1, h2, "single-char change must produce a different hash");
});

// ---- PHOTO_FILENAME_PATTERN -----------------------------------------------

test("PHOTO_FILENAME_PATTERN accepts valid photo filenames", () => {
  const valid = [
    "person-john-berry-1.jpg",
    "person-john-berry-2.png",
    "person-maria-lopez-1.webp",
    "person-maria-lopez-3.gif",
    "person-a-b-c-10.jpg",
  ];
  for (const f of valid) {
    assert.ok(PHOTO_FILENAME_PATTERN.test(f), `should accept "${f}"`);
  }
  // New prefixes now valid
  assert.ok(PHOTO_FILENAME_PATTERN.test("reflection-sunset-at-the-pier-1.jpg"), "reflection prefix valid");
  assert.ok(PHOTO_FILENAME_PATTERN.test("fragment-business-card-2.png"), "fragment prefix valid");
  assert.ok(PHOTO_FILENAME_PATTERN.test("loop-costco-run-1.webp"), "loop prefix valid");
  assert.ok(PHOTO_FILENAME_PATTERN.test("reflection-2026-07-04-sunset-1.jpg"), "dated reflection slug valid");
});

test("PHOTO_FILENAME_PATTERN rejects invalid photo filenames", () => {
  const invalid = [
    "person-john-berry-1.exe",     // wrong extension
    "photos/person-john-1.jpg",    // path prefix not allowed
    "person-John-Berry-1.jpg",     // uppercase not allowed
    "person-john berry-1.jpg",     // spaces not allowed
    "person--1.jpg",               // empty slug
    "john-berry-1.jpg",            // missing person- prefix
    "../etc/passwd",               // path traversal
    "",
  ];
  for (const f of invalid) {
    assert.ok(!PHOTO_FILENAME_PATTERN.test(f), `should reject "${f}"`);
  }
  // Wrong prefixes still rejected
  assert.ok(!PHOTO_FILENAME_PATTERN.test("note-sunset-1.jpg"), "unknown prefix rejected");
  assert.ok(!PHOTO_FILENAME_PATTERN.test("people-john-1.jpg"), "plural people prefix rejected");
  assert.ok(!PHOTO_FILENAME_PATTERN.test("loops-costco-1.jpg"), "plural loops prefix rejected");
});

// ---- RECOVERY_PATHS (Access Key scope) ------------------------------------
// The Access Key (WORKER_KEY) is documented to users as a passphrase-recovery
// mechanism. RECOVERY_PATHS is what enforces that promise: it is the complete
// list of endpoints the key may authenticate on its own. These tests are a
// regression guard — widening the set without deliberate thought fails here.

test("RECOVERY_PATHS contains exactly the two passphrase endpoints", () => {
  assert.deepEqual(
    [...RECOVERY_PATHS].sort(),
    ["/changePassword", "/initPassword"]
  );
});

test("isRecoveryPath accepts every recovery path on POST", () => {
  for (const p of ["/initPassword", "/changePassword"]) {
    assert.equal(isRecoveryPath("POST", p), true, `${p} must be a recovery path`);
  }
});

// /resetMemory checks the Access Key in its own handler, so listing it in
// RECOVERY_PATHS would let a key alone clear the gate — meaning a disclosed key
// could wipe every memory file with no session at all. Excluded, it requires
// session AND key, which is what the frontend already sends.
//
// /verifyAccessKey is listed too even though the endpoint was deleted in
// v1.8.30: if anyone ever reinstates it, it must come back outside this set.
test("resetMemory requires a session, not just the Access Key", () => {
  for (const p of ["/resetMemory", "/verifyAccessKey"]) {
    assert.equal(isRecoveryPath("POST", p), false,
      `${p} must NOT be reachable with the Access Key alone`);
  }
});

test("isRecoveryPath rejects endpoints that read or mutate memory", () => {
  const NOT_RECOVERY = [
    "/chat", "/getMemoryFile", "/searchMemoryFile", "/browseFile", "/recall",
    "/findSections", "/patchMemoryFile", "/insertSection", "/replaceSection",
    "/deleteSection", "/moveToArchive", "/export", "/loginLog", "/diagnostics",
    "/updateApiKey", "/clearApiKey", "/uploadPhoto", "/healthz",
  ];
  for (const p of NOT_RECOVERY) {
    assert.equal(isRecoveryPath("POST", p), false, `${p} must NOT be reachable with the Access Key`);
  }
});

test("isRecoveryPath is method-sensitive", () => {
  assert.equal(isRecoveryPath("GET", "/resetMemory"), false);
  assert.equal(isRecoveryPath("GET", "/initPassword"), false);
  assert.equal(isRecoveryPath("OPTIONS", "/initPassword"), false);
});

test("isRecoveryPath rejects malformed input without throwing", () => {
  assert.equal(isRecoveryPath("POST", ""), false);
  assert.equal(isRecoveryPath("", "/initPassword"), false);
  assert.equal(isRecoveryPath("POST", "/initPassword/extra"), false);
});

// This is the invariant that actually encodes the security goal. The test
// above pins today's strings; this one fails even if someone updates that
// list in the same commit, because it asserts the *property* we care about:
// nothing the Access Key can reach is able to return memory content.
test("no recovery path is a memory-read endpoint", () => {
  const READ_ENDPOINTS = [
    "/getMemoryFile", "/searchMemoryFile", "/browseFile",
    "/recall", "/findSections", "/export",
  ];
  for (const p of READ_ENDPOINTS) {
    assert.ok(!RECOVERY_PATHS.has(p), `Access Key must never reach the read endpoint ${p}`);
  }
});

// ---- REAUTH_ACTIONS / SESSION_LOGIN_METHODS -------------------------------
// POST /verifyPassphrase re-authenticates an existing session before an action
// that produces a complete, portable copy of every memory file, and writes the
// action name into login_log. The allowlist is the guard: the action string is
// attacker-controllable, and login_log is the record the user checks to decide
// whether something happened to their data.

test("REAUTH_ACTIONS contains exactly the three bulk-copy actions", () => {
  assert.deepEqual([...REAUTH_ACTIONS].sort(), ["export", "export-plain", "import"]);
});

test("REAUTH_ACTIONS rejects anything not on the allowlist", () => {
  for (const bad of ["", "chat", "passphrase", "failed", "setup", "recovery", "../export", "EXPORT"]) {
    assert.ok(!REAUTH_ACTIONS.has(bad), `"${bad}" must not be an accepted re-auth action`);
  }
});

// A re-auth action must never be able to impersonate a session-establishing
// login. If these sets ever overlapped, an export could be written into
// login_log as though it were a sign-in — and would then be picked up by the
// session-start "last login" notice, disguising the very event the notice
// exists to reveal.
test("re-auth actions and session login methods never overlap", () => {
  for (const a of REAUTH_ACTIONS) {
    assert.ok(!SESSION_LOGIN_METHODS.has(a),
      `"${a}" must not count as a session login`);
  }
});

test("SESSION_LOGIN_METHODS covers every method that establishes access", () => {
  assert.deepEqual([...SESSION_LOGIN_METHODS].sort(),
    ["biometric", "passphrase", "recovery", "setup"]);
});

test("SESSION_LOGIN_METHODS excludes failed attempts", () => {
  assert.ok(!SESSION_LOGIN_METHODS.has("failed"),
    "a failed attempt is not a login and must never show as one");
});

// ---- authLockoutReason (failed-auth throttling) ---------------------------
// Failures count per-IP and globally. The per-IP counter is what stops an
// attacker locking the owner out of their own app: before this, one global
// counter meant anyone who knew the worker URL could burn five attempts every
// five minutes forever, with no knowledge of the passphrase. The global
// counter remains only as a loose backstop against a distributed attack.

test("authLockoutReason allows a caller under both limits", () => {
  assert.equal(authLockoutReason(0, 0), null);
  assert.equal(authLockoutReason(AUTH_FAIL_LIMITS.ip - 1, AUTH_FAIL_LIMITS.global - 1), null);
});

test("authLockoutReason blocks on the per-IP limit", () => {
  assert.equal(authLockoutReason(AUTH_FAIL_LIMITS.ip, 0), "ip");
  assert.equal(authLockoutReason(AUTH_FAIL_LIMITS.ip + 10, 0), "ip");
});

test("authLockoutReason blocks on the global backstop", () => {
  assert.equal(authLockoutReason(0, AUTH_FAIL_LIMITS.global), "global");
});

test("per-IP limit is reported ahead of the global one", () => {
  // Both tripped: the caller's own failures are the accurate explanation,
  // and the message differs, so the order is user-visible.
  assert.equal(authLockoutReason(AUTH_FAIL_LIMITS.ip, AUTH_FAIL_LIMITS.global), "ip");
});

// This is the regression guard for the lockout-DoS. If the global threshold
// were ever lowered to the per-IP one, a single stranger could again lock the
// owner out of their own memory without knowing anything about the passphrase.
test("global backstop is far looser than the per-IP limit", () => {
  assert.ok(AUTH_FAIL_LIMITS.global > AUTH_FAIL_LIMITS.ip * 5,
    "global limit must stay well above the per-IP limit, or it becomes a griefing vector again");
  // A legitimate user fumbling their own passphrase must never trip it.
  assert.equal(authLockoutReason(0, AUTH_FAIL_LIMITS.ip), null);
});

test("authLockoutReason treats missing or malformed counts as zero", () => {
  for (const bad of [undefined, null, NaN, "lots"]) {
    assert.equal(authLockoutReason(bad, bad), null,
      "an unreadable counter must not lock a legitimate user out");
  }
});

// ---- Entrypoint export shape ----------------------------------------------
// The Workers runtime treats every named export of the entrypoint module as a
// handler or Durable Object class and refuses to boot if one is a primitive:
//   "Incorrect type for map entry 'X': the provided value is not of type
//    'function or ExportedHandler'"
// That is a total outage, not a degraded feature, and nothing else in the
// harness catches it — `node --check` passes, every unit test passes, and the
// failure only appears when a real Workers runtime starts. This test stands in
// for that. Group constants into an exported object instead of exporting them
// individually (see AUTH_FAIL_LIMITS).
test("no entrypoint export is a bare primitive", async () => {
  const mod = await import("../src/worker.js");
  const offenders = Object.entries(mod)
    .filter(([, v]) => v === null || (typeof v !== "function" && typeof v !== "object"))
    .map(([k, v]) => `${k} (${typeof v})`);
  assert.deepEqual(offenders, [],
    `these exports would stop the Worker from booting: ${offenders.join(", ")}`);
});

// ---- Passphrase hash migration (v1.8.31) ----------------------------------
// auth_config gained an `iterations` field so the cost can be raised without
// locking anyone out. The whole safety of that rests on one rule: a hash is
// ALWAYS verified at the cost that produced it, never at the current constant.
// Get it backwards and every pre-existing user is locked out of their own
// memory on the next login, recoverable only via the Access Key.

test("records written before the field existed are read as legacy cost", () => {
  const cfg = parseAuthConfig(JSON.stringify({ hash: "h", salt: "s" }));
  assert.equal(cfg.iterations, PBKDF2.legacy,
    "a record with no iterations field MUST verify at the old cost, or every existing login fails");
});

test("records carrying an explicit cost are read back unchanged", () => {
  const cfg = parseAuthConfig(JSON.stringify({ hash: "h", salt: "s", iterations: 600000 }));
  assert.equal(cfg.iterations, 600000);
});

test("parseAuthConfig rejects unusable records rather than guessing", () => {
  for (const bad of [null, undefined, "", "not json", "{}", JSON.stringify({ hash: "h" }),
                     JSON.stringify({ salt: "s" }), JSON.stringify({ hash: 1, salt: 2 })]) {
    assert.equal(parseAuthConfig(bad), null, `${JSON.stringify(bad)} must parse as null`);
  }
});

test("a nonsensical iterations value falls back to legacy, never to zero", () => {
  // A zero or negative count would make PBKDF2 throw at verify time, turning a
  // corrupt record into a hard lockout instead of a recoverable failure.
  for (const bad of [0, -1, 1.5, "600000", null]) {
    const cfg = parseAuthConfig(JSON.stringify({ hash: "h", salt: "s", iterations: bad }));
    assert.equal(cfg.iterations, PBKDF2.legacy, `iterations=${bad} must fall back to legacy`);
  }
});

test("needsRehash leaves records already at the current cost alone", () => {
  assert.equal(needsRehash({ iterations: PBKDF2.current }), false);
});

// Written against an explicit lower number rather than PBKDF2.legacy, because
// `current` and `legacy` are equal while the Workers ceiling pins both at
// 100,000 — so a record "at legacy" needs no upgrade today. This keeps the
// migration path itself covered for whenever the ceiling is raised.
test("needsRehash upgrades any record stored below the current cost", () => {
  assert.equal(needsRehash({ iterations: PBKDF2.current - 50000 }), true);
  assert.equal(needsRehash({ iterations: 1 }), true);
});

// Guards against a future reduction of the constant silently re-hashing every
// install DOWN to a weaker cost on next login.
test("needsRehash never downgrades a stronger record", () => {
  assert.equal(needsRehash({ iterations: PBKDF2.current + 100000 }), false);
});

test("needsRehash tolerates garbage without claiming an upgrade is needed", () => {
  for (const bad of [null, undefined, {}, { iterations: "many" }]) {
    assert.equal(needsRehash(bad), false);
  }
});

// The Cloudflare Workers runtime refuses any PBKDF2 derivation above 100,000
// iterations — "iteration counts above 100000 are not supported". v1.8.31 set
// `current` to OWASP's recommended 600,000 and broke /initPassword and
// /changePassword in production: every new install and every passphrase change
// threw. Logging in still worked, because verification uses the cost stored on
// the record, so the breakage was invisible until someone changed a passphrase.
//
// Nothing else in the harness can catch this. Node's Web Crypto has no such
// limit, and neither does `wrangler dev` — the local end-to-end migration test
// against a planted legacy record passed at 600k. Only the deployed runtime
// rejects it. This assertion is the cheap stand-in for that.
test("PBKDF2 iterations stay within the Workers runtime ceiling", () => {
  const WORKERS_MAX_ITERATIONS = 100000;
  assert.ok(PBKDF2.current <= WORKERS_MAX_ITERATIONS,
    `PBKDF2.current is ${PBKDF2.current}; the Workers runtime rejects anything ` +
    `above ${WORKERS_MAX_ITERATIONS}, which breaks /initPassword and /changePassword ` +
    `in production while logins keep working. Verify against a DEPLOYED worker ` +
    `before raising this.`);
  assert.ok(PBKDF2.legacy <= WORKERS_MAX_ITERATIONS);
  assert.ok(PBKDF2.current >= PBKDF2.legacy, "never store weaker than existing records");
});
