import {
  AUDIT_CATEGORIES, parseSections, signatureFor, normalizeHeader, pruneIgnored,
  estimateDeepScanCost,
  detectBrokenCharacters, detectFormatViolations, detectDateInconsistencies, detectDuplicateHeaders,
  detectNameMismatches,
  detectPhotoIssues,
} from "./audit-detectors.js";
import { buildStaticPrompt, buildDynamicPrompt } from "./system-prompt.js";

// WhosWhoZoo Worker
// Reads/writes memory files from Cloudflare KV.
// Calls Claude API server-side for chat.

const WORKER_VERSION = "1.8.48";

const MEMORY_FILES = ["people.md", "reflections.md", "fragments.md", "loops.md"];
const ARCHIVE_FILES = ["archive_people.md", "archive_reflections.md", "archive_fragments.md", "archive_loops.md"];
const DEEPARCHIVE_FILES = ["deeparchive_people.md", "deeparchive_reflections.md", "deeparchive_fragments.md", "deeparchive_loops.md"];
const BACKUP_FILES = [...MEMORY_FILES, ...ARCHIVE_FILES, ...DEEPARCHIVE_FILES];
const ALLOWED_ORIGINS = ["https://whoszoo.pages.dev", "https://whoszoo-worker.hansreno.workers.dev"];

// Token rates per million (MTok) — update if Anthropic changes pricing
const RATES = {
  haiku:  { input: 1.00, output: 5.00, cacheWrite: 1.25, cacheRead: 0.10 },
  sonnet: { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
};

// KV keys that must never be served by read endpoints. Memory files
// (people.md, archive_*.md, deeparchive_*.md) are intentionally readable;
// these are operational state that has no business being fetched as if
// it were a memory file.
export const PROTECTED_KEYS = new Set([
  "auth_config", "webauthn_credential", "webauthn_challenge", "cost_log",
  "config_anthropic_api_key", "config_openai_api_key", "config_elevenlabs_api_key",
  "config_user_name",
  "audit_ignored", "audit_last_run",
  "archive_dismissed", "deep_dismissed", "_error_log",
  "login_log",
]);

// Endpoints the Access Key (WORKER_KEY) may authenticate on its own.
//
// The key is shown once at the end of setup and documented to users as a
// passphrase-recovery mechanism — nothing more. Before this existed it was
// accepted at the auth gate as a full session substitute on every endpoint,
// so a disclosed key granted silent, unlimited, unlogged read access to all
// memory. This set is what makes the documented promise true in code.
//
// Every path here manages the passphrase and nothing else. None of them can
// return memory content — `endpoint-logic.test.mjs` asserts that property
// directly, so adding a read endpoint here fails the suite.
//
// `/resetMemory` is deliberately NOT here even though it checks the key in its
// own handler. Listing it would let a key alone clear the gate, meaning a
// disclosed key could wipe every memory file with no session at all. Excluded,
// it requires session AND key — which is what the frontend already sends. A
// locked-out user is not stranded: `/initPassword` still takes the key alone,
// so the route out is reset the passphrase, log in, then reset memory if that
// is really what you want.
export const RECOVERY_PATHS = new Set([
  "/initPassword",
  "/changePassword",
]);

// `/initPassword` is also in the gate's `_authExempt` list, so the gate never
// actually evaluates it. It is listed above anyway: this set is the single
// authoritative answer to "what may the Access Key touch?", for readers,
// tests, and anyone auditing this later.
export function isRecoveryPath(method, path) {
  return method === "POST" && RECOVERY_PATHS.has(path);
}

// Actions that `POST /verifyPassphrase` will re-authenticate and log. Each one
// produces a complete, portable copy of every memory file, so each is gated on
// the passphrase and written to `login_log` under its own method name.
//
// This is an allowlist rather than a free-text field on purpose: the action
// string lands in `login_log`, and an unvalidated one would let any caller
// forge arbitrary-looking entries in the very record the user checks to see
// whether something happened.
export const REAUTH_ACTIONS = new Set(["export", "export-plain", "import"]);

// ---- Passphrase hashing ---------------------------------------------------
//
// `current` is what new and re-hashed passphrases use; `legacy` is what
// installs created before v1.8.31 used, and is the assumed value for any
// `auth_config` record written before the iteration count was stored.
//
// Grouped in an object, not three exported constants — the Workers runtime
// refuses to boot on an exported primitive (see AUTH_FAIL_LIMITS).
//
// 600k is OWASP's current figure for PBKDF2-HMAC-SHA256. Measured cost is
// ~104ms per derivation locally, so expect roughly double that at the edge:
// unnoticeable against a login's network round trip, and paid once per login.
// Minimum length when SETTING a passphrase. Raised from 8 to 12 in v1.8.31.
//
// This is checked only on /initPassword and /changePassword — the paths that
// write a passphrase. It is deliberately NOT checked on /auth, so an existing
// user with a shorter passphrase keeps logging in normally and is never locked
// out by the change; they adopt the new floor whenever they next set one.
//
// Length matters more here than the iteration count does: iterations are a
// constant multiplier on an attacker's cost, while each extra character is a
// multiplier on the search space itself.
const PASSPHRASE_MIN_LENGTH = 12;

// ⚠ 100,000 is a HARD CEILING imposed by the Cloudflare Workers runtime, not a
// choice. Asking for more throws at derive time:
//   "Pbkdf2 failed: iteration counts above 100000 are not supported
//    (requested 600000)."
// OWASP's figure for PBKDF2-HMAC-SHA256 is 600,000, and v1.8.31 raised
// `current` to that — which broke `/initPassword` and `/changePassword` in
// production (i.e. every new install and every passphrase change) until
// v1.8.33. Logging in kept working, because verification uses the cost stored
// on the record, which was still 100k.
//
// Nothing in the harness caught it. Node's Web Crypto has no such limit, so the
// local benchmark ran 600k happily; `wrangler dev` accepted it too, so even the
// end-to-end local migration test passed against a planted legacy record. Only
// the deployed runtime rejects it. If you ever raise this, verify against the
// DEPLOYED worker, not a local one.
//
// The `iterations` field on auth_config stays regardless: it costs nothing and
// means a future ceiling raise is a one-constant change with the lazy migration
// already built and tested.
export const PBKDF2 = {
  current: 100000,
  legacy: 100000,
};

// Normalizes a raw `auth_config` value into `{ hash, salt, iterations }`.
//
// Records written before v1.8.31 carry no `iterations` field, and MUST be read
// back as `legacy` — verifying an old hash at the new count fails every time,
// which locks the user out of their own memory. This defaulting is the entire
// migration safety net, so it is a pure function with its own tests rather
// than an inline `|| 100000` somewhere in a handler.
//
// Returns null for anything unparseable, which callers treat as "not
// initialized" rather than "wrong passphrase".
export function parseAuthConfig(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let cfg;
  try { cfg = JSON.parse(raw); } catch { return null; }
  if (!cfg || typeof cfg.hash !== "string" || typeof cfg.salt !== "string") return null;
  const iterations = Number.isInteger(cfg.iterations) && cfg.iterations > 0
    ? cfg.iterations
    : PBKDF2.legacy;
  return { hash: cfg.hash, salt: cfg.salt, iterations };
}

// True when a verified-good config should be transparently re-hashed at the
// current cost. Only ever upgrades: a record already at or above `current` is
// left alone, so a future reduction in the constant cannot silently weaken
// every install on next login.
export function needsRehash(cfg) {
  return Boolean(cfg) && Number.isInteger(cfg.iterations) && cfg.iterations < PBKDF2.current;
}

// login_log methods that represent a session actually being established.
// The session-start "last login" notice reads only these — export/import
// events are real and worth recording, but they happen inside a session that
// already exists, so treating one as "your last login" would be wrong.
export const SESSION_LOGIN_METHODS = new Set(["passphrase", "biometric", "setup", "recovery"]);

// ---- Failed-auth throttling -----------------------------------------------
//
// Failures are counted twice: once against the caller's own IP, and once
// globally. The split fixes a real problem with the single global counter this
// replaces — anyone who knew the worker URL could lock the owner out of their
// own app indefinitely by failing five logins every five minutes, without
// knowing anything about the passphrase. Per-IP counting means an attacker
// now only ever locks out themselves.
//
// The global counter survives as a deliberately loose backstop, because per-IP
// alone would hand a distributed attacker five fresh attempts per address. It
// is set far above anything a real person trips, so it cannot be used to grief
// the owner the way the old single counter could.
//
// Honest limit: KV has no atomic increment, so this is still read-modify-write
// and a burst of simultaneous requests can slip past the threshold before any
// of them observe the other's write. Closing that properly needs a Durable
// Object, which would mean a new binding in every existing install — a real
// migration for a self-hosted app. This change fixes the half that is
// exploitable with no prior access (the lockout DoS) and narrows the other,
// without requiring anyone to reinstall or re-authenticate.
// Grouped into one exported OBJECT deliberately. The Workers runtime treats
// every named export of the entrypoint module as a handler or Durable Object
// class, and rejects primitives outright — exporting these as three bare
// numbers throws "Incorrect type for map entry ... not of type 'function or
// ExportedHandler'" and the Worker fails to boot at all. Sets and functions
// pass the check (hence PROTECTED_KEYS and RECOVERY_PATHS above), numbers do
// not. Keep any future constant here inside an object, not beside it.
export const AUTH_FAIL_LIMITS = {
  ip: 5,
  global: 50,
  ttlSeconds: 300,
};

// Pure: given both counts, say whether this attempt should be refused and why.
// Returns null to allow, or "ip" | "global" — the reason is what lets the
// caller word the message honestly rather than blaming the wrong thing.
export function authLockoutReason(ipFailures, globalFailures) {
  const ip = Number.isFinite(ipFailures) ? ipFailures : 0;
  const global = Number.isFinite(globalFailures) ? globalFailures : 0;
  if (ip >= AUTH_FAIL_LIMITS.ip) return "ip";
  if (global >= AUTH_FAIL_LIMITS.global) return "global";
  return null;
}

// Photo filename grammar: person-<slug>-<n>.<ext>
// slug: person's name lowercased, spaces/punctuation → hyphens, consecutive hyphens collapsed.
// n: 1-indexed integer. ext: jpg | png | webp | gif.
export const PHOTO_FILENAME_PATTERN = /^(person|reflection|fragment|loop)-[a-z0-9-]+-\d+\.(jpg|png|webp|gif)$/;

// Returns a ready 503 Response if env.DOWNLOADS is not bound, otherwise null.
// Call at the entry of every photo endpoint.
function requireR2(env, cors, nocache) {
  if (!env.DOWNLOADS) return json({ ok: false, error: "r2_not_configured" }, 503, { ...cors, ...nocache });
  return null;
}

// KV-first key resolution: app-saved key takes precedence over env secret
async function resolveApiKey(env, name) {
  const kvVal = await env.MEMORY.get("config_" + name.toLowerCase());
  if (kvVal && kvVal.trim()) return kvVal.trim();
  return env[name] || null;
}

// runDeepScanDetectors — invokes Haiku once per category and returns merged findings.
// The fileObjs array is [{ name, content }] for files in scope.
// Deep-scan now splits the work:
//   • Name Mismatches — deterministic edit-distance pass in audit-detectors.js
//     (free, reproducible, doesn't hallucinate).
//   • Near-duplicates — Haiku, because semantic "same person/event" judgment
//     is the part that genuinely benefits from a model.
async function runDeepScanDetectors(env, fileObjs) {
  // Step 1 — deterministic name-mismatches. No API call.
  const nameFindings = detectNameMismatches(fileObjs);

  // Step 2 — Haiku for near-duplicates only.
  const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
  if (!anthropicKey) return { findings: nameFindings, usage: null, error: "ANTHROPIC_API_KEY not configured" };

  const catalog = [];
  for (const f of fileObjs) {
    for (const sec of parseSections(f.content)) {
      const preview = sec.bodyLines.join("\n").slice(0, 200);
      catalog.push({ file: f.name, header: sec.header, preview });
    }
  }
  if (catalog.length < 2) return { findings: nameFindings, usage: { input_tokens: 0, output_tokens: 0 } };

  const catalogText = catalog.map((s, i) => `<r id="${i}" file="${s.file}">## ${s.header}\n${s.preview}</r>`).join("\n\n");

  const prompt = `You are auditing a personal memory store for ONE integrity issue:
NEAR_DUPLICATES — two records that describe the same person OR the same event (e.g., two separate ## entries for the same coworker, or two journal entries about the same meeting).

Return XML ONLY in this exact shape (no prose, no markdown fences):
<findings>
  <pair type="near-duplicates" confidence="0.85">
    <a id="3"/><b id="17"/>
    <reason>Same person — both reference Acme Corp 2024 onboarding.</reason>
  </pair>
</findings>

Only emit pairs with confidence >= 0.7. Use ONLY the numeric ids that appear in the catalog below; do not invent records. If nothing qualifies, return <findings></findings>.

Records:
${catalogText}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: "You are a careful data integrity auditor. You return XML only. Do not invent records — only flag pairs from the supplied catalog.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return { findings: nameFindings, usage: null, error: `Haiku call failed: ${err.slice(0, 200)}` };
  }
  const data = await res.json();
  const xml = (data.content[0]?.text || "").trim();
  let dupFindings;
  try {
    dupFindings = parseDeepScanXml(xml, catalog);
  } catch (e) {
    return { findings: nameFindings, usage: null, error: e.message };
  }
  return { findings: [...nameFindings, ...dupFindings], usage: data.usage || null };
}

function parseDeepScanXml(xml, catalog) {
  if (!/<findings\b/.test(xml)) {
    throw new Error("Haiku returned malformed response");
  }
  const findings = [];
  const pairRe = /<pair\s+type="(near-duplicates)"\s+confidence="([\d.]+)"[^>]*>([\s\S]*?)<\/pair>/g;
  let m;
  while ((m = pairRe.exec(xml)) !== null) {
    const type = m[1];
    const conf = parseFloat(m[2]);
    const inner = m[3];
    const aMatch = inner.match(/<a\s+id="(\d+)"\s*\/>/);
    const bMatch = inner.match(/<b\s+id="(\d+)"\s*\/>/);
    const reasonMatch = inner.match(/<reason>([\s\S]*?)<\/reason>/);
    if (!aMatch || !bMatch) continue;
    const a = catalog[parseInt(aMatch[1], 10)];
    const b = catalog[parseInt(bMatch[1], 10)];
    if (!a || !b) continue;
    findings.push({
      category: type,
      pair: [a.header, b.header],
      files: [a.file, b.file],
      confidence: conf,
      reason: reasonMatch ? reasonMatch[1].trim() : "",
    });
  }
  return findings;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method.toUpperCase();

    const requestOrigin = request.headers.get("Origin") || "";
    const corsAllowed = ALLOWED_ORIGINS.includes(requestOrigin);
    // For unknown origins we omit the ACAO header entirely rather than
    // returning ALLOWED_ORIGINS[0] (which previously caused all unknown
    // origins to advertise whoszoo.pages.dev as the allowed origin —
    // confusing during misconfiguration debugging, and bad form generally).
    // Browsers reject the cross-origin call either way, but omitting the
    // header is the correct CORS contract.
    const cors = {
      ...(corsAllowed && { "Access-Control-Allow-Origin": requestOrigin }),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Worker-Key, X-Session-Token, X-Whisper-Language",
      // Response headers a cross-origin caller is allowed to READ. Same-origin
      // installs (every wizard deploy) can read any header without this, but
      // the frontend may be served from a different origin, and without the
      // expose list X-Resolved-Section is silently invisible there — the
      // subsection fallback would look like it simply didn't happen.
      "Access-Control-Expose-Headers": "X-Resolved-Section",
      "Vary": "Origin",
    };
    const nocache = {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, ...nocache } });
    }

    // Auth — exempt endpoints are the auth steps themselves
    const _authExempt = (
      (method === "POST" && (path === "/auth" || path === "/initPassword" || path === "/webauthn-challenge" || path === "/webauthn-auth")) ||
      (method === "GET" && (path === "/authStatus" || path === "/manifest.json"))
    );
    if (!_authExempt) {
      const headerKey = request.headers.get("X-Worker-Key");
      const sessionToken = request.headers.get("X-Session-Token");
      const keyMatches = Boolean(headerKey && env.WORKER_KEY && headerKey === env.WORKER_KEY);
      // The Access Key authenticates ONLY on recovery paths. Everywhere else a
      // valid session token is the sole accepted credential, so a leaked key
      // cannot silently read memory, spend API credit, or export the corpus —
      // it can only reset the passphrase, which is loud: it bumps token_epoch,
      // signs out every device, drops the biometric credential, and logs below.
      const keyOk = keyMatches && isRecoveryPath(method, path);
      const tokenOk = !keyOk && sessionToken
        ? await verifyToken(sessionToken, env).catch(() => false)
        : false;
      if (!keyOk && !tokenOk) {
        return new Response("Unauthorized", { status: 401, headers: { ...cors, ...nocache } });
      }
      // Record every Access Key acceptance. Before this, key-authenticated
      // requests left no trace at all. `appendLoginEvent` swallows its own
      // errors, so a KV failure degrades to "not logged", never to a 500.
      if (keyOk) await appendLoginEvent(env, request, "recovery");
    }

    try {
      // GET /manifest.json — dynamic PWA manifest; includes USER_NAME so each install
      // gets a distinct app name on the home screen (e.g. "WhosWhoZoo · Hans").
      if (method === "GET" && path === "/manifest.json") {
        const userName = env.USER_NAME ? env.USER_NAME.trim() : null;
        const name = userName ? `WhosWhoZoo · ${userName}` : "WhosWhoZoo";
        const manifest = {
          name,
          short_name: name,
          description: "Your private memory assistant for the people in your life.",
          start_url: "/",
          display: "standalone",
          background_color: "#0a0f1e",
          theme_color: "#0a0f1e",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        };
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store", ...cors },
        });
      }

      // GET /authStatus — public probe: tells the frontend whether this worker has
      // been initialized (auth_config exists in KV). A fresh install has no
      // auth_config yet, so the frontend should show the setup screen, not login.
      // Constant-ish delay below masks KV lookup latency so an external observer
      // can't reliably distinguish initialized vs uninitialized via timing.
      if (method === "GET" && path === "/authStatus") {
        const [raw] = await Promise.all([
          env.MEMORY.get("auth_config"),
          new Promise(r => setTimeout(r, 80)),
        ]);
        return json({ initialized: !!raw }, 200, { ...cors, "Cache-Control": "no-store" });
      }

      // POST /auth — verify passphrase, return session token
      if (method === "POST" && path === "/auth") {
        const body = await safeJson(request);
        if (!body?.password) return json({ ok: false, error: "Missing password" }, 400, { ...cors, ...nocache });
        const lockedOut = await checkAuthLockout(env, request, cors, nocache);
        if (lockedOut) return lockedOut;
        const raw = await env.MEMORY.get("auth_config");
        if (!raw) return json({ ok: false, error: "not_initialized" }, 404, { ...cors, ...nocache });
        const authCfg = parseAuthConfig(raw);
        if (!authCfg) return json({ ok: false, error: "not_initialized" }, 404, { ...cors, ...nocache });
        // Verify at whatever cost THIS record was written with — not the current
        // constant. Getting that backwards fails every existing login.
        const hash = await pbkdf2Hash(body.password, authCfg.salt, authCfg.iterations);
        if (hash !== authCfg.hash) {
          await recordAuthFailure(env, request);
          try { await appendLoginEvent(env, request, "failed"); } catch {}
          return json({ ok: false, error: "Invalid password" }, 401, { ...cors, ...nocache });
        }
        await clearAuthFailures(env, request);
        // Passphrase confirmed correct — transparently upgrade the stored hash.
        await upgradeHashIfNeeded(env, body.password, authCfg);
        const token = await issueToken(env);
        try { await appendLoginEvent(env, request, "passphrase"); } catch {}
        return json({ ok: true, token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }, 200, { ...cors, ...nocache });
      }

      // POST /initPassword — set initial passphrase (WORKER_KEY required; idempotent)
      if (method === "POST" && path === "/initPassword") {
        const headerKey = request.headers.get("X-Worker-Key");
        if (!headerKey || !env.WORKER_KEY || headerKey !== env.WORKER_KEY) {
          return json({ ok: false, error: "Access key incorrect — check the key from your setup." }, 401, { ...cors, ...nocache });
        }
        const body = await safeJson(request);
        if (!body?.password || body.password.length < PASSPHRASE_MIN_LENGTH) {
          return json({ ok: false, error: `Passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters` }, 400, { ...cors, ...nocache });
        }
        await writeAuthConfig(env, body.password);
        // Bump token epoch — all previously issued tokens (from old passphrase) are now invalid
        const prevEpoch = await env.MEMORY.get("token_epoch");
        await env.MEMORY.put("token_epoch", String((prevEpoch ? parseInt(prevEpoch) : 0) + 1));
        // Invalidate biometric enrollment — must re-enroll under new passphrase
        await env.MEMORY.delete("webauthn_credential");
        await env.MEMORY.delete("webauthn_challenge");
        // Clear any active rate-limit lockout so the new passphrase works
        // immediately — both this caller's own counter and the global backstop.
        await clearAuthFailures(env, request);
        // Write $1 default cost cap so it's active from day one, not only after Settings is opened
        const existingCap = await env.MEMORY.get("daily_cost_cap");
        if (!existingCap) await env.MEMORY.put("daily_cost_cap", "1");
        const token = await issueToken(env);
        try { await appendLoginEvent(env, request, "setup"); } catch {}
        return json({ ok: true, token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }, 200, { ...cors, ...nocache });
      }

      // POST /changePassword — update passphrase (session or WORKER_KEY; requires current password unless using WORKER_KEY)
      if (method === "POST" && path === "/changePassword") {
        const body = await safeJson(request);
        if (!body?.newPassword || body.newPassword.length < PASSPHRASE_MIN_LENGTH) {
          return json({ ok: false, error: `New passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters` }, 400, { ...cors, ...nocache });
        }
        const headerKey = request.headers.get("X-Worker-Key");
        const usingRecoveryKey = headerKey && env.WORKER_KEY && headerKey === env.WORKER_KEY;
        if (!usingRecoveryKey) {
          if (!body.currentPassword) return json({ ok: false, error: "Current passphrase required" }, 400, { ...cors, ...nocache });
          const raw = await env.MEMORY.get("auth_config");
          if (!raw) return json({ ok: false, error: "not_initialized" }, 404, { ...cors, ...nocache });
          const authCfg = parseAuthConfig(raw);
          if (!authCfg) return json({ ok: false, error: "not_initialized" }, 404, { ...cors, ...nocache });
          const currentHash = await pbkdf2Hash(body.currentPassword, authCfg.salt, authCfg.iterations);
          if (currentHash !== authCfg.hash) return json({ ok: false, error: "Current passphrase incorrect" }, 401, { ...cors, ...nocache });
        }
        // The new passphrase is always written at the current cost, so a change
        // doubles as a migration regardless of what the old record used.
        await writeAuthConfig(env, body.newPassword);
        // Bump token epoch — all previously issued session tokens are now invalid.
        const prevEpoch = await env.MEMORY.get("token_epoch");
        await env.MEMORY.put("token_epoch", String((prevEpoch ? parseInt(prevEpoch) : 0) + 1));
        // Security: rotating the passphrase invalidates biometric enrollment.
        // Banks, password managers, and most apps that pair biometric with a
        // password do this — once the passphrase changes, the old biometric
        // "I am the user" claim is no longer valid against the new credential
        // set. The user must re-enroll under the new passphrase.
        await env.MEMORY.delete("webauthn_credential");
        await env.MEMORY.delete("webauthn_challenge");
        const token = await issueToken(env);
        return json({ ok: true, token, expiresAt: Date.now() + 24 * 60 * 60 * 1000, biometricInvalidated: true }, 200, { ...cors, ...nocache });
      }

      // POST /verifyPassphrase — re-authenticate an already-signed-in session
      // before a sensitive action, and record that the action happened.
      //
      // Exists because /export, /export-plain and /import all produce a
      // complete, portable, re-importable copy of every memory file. An
      // unattended unlocked session could previously yield one in seconds,
      // and — since /export is entirely client-side — leave no trace at all.
      // The passphrase is the right factor here: it is the only secret that
      // lives solely in the user's head, whereas the Access Key is one we
      // actively tell people to screenshot.
      //
      // Not in _authExempt: this is a re-auth for an existing session, never
      // a way to obtain one. It issues no token.
      if (method === "POST" && path === "/verifyPassphrase") {
        const body = await safeJson(request);
        const action = typeof body?.action === "string" ? body.action : "";
        // Allowlisted so a caller cannot write arbitrary strings into login_log.
        if (!REAUTH_ACTIONS.has(action)) {
          return json({ ok: false, error: "Unknown action" }, 400, { ...cors, ...nocache });
        }
        if (!body?.password) return json({ ok: false, error: "Missing password" }, 400, { ...cors, ...nocache });
        // Shares /auth's lockout counter deliberately. With its own counter
        // this endpoint would be a softer brute-force oracle than /auth itself.
        const lockedOut = await checkAuthLockout(env, request, cors, nocache);
        if (lockedOut) return lockedOut;
        const raw = await env.MEMORY.get("auth_config");
        if (!raw) return json({ ok: false, error: "not_initialized" }, 404, { ...cors, ...nocache });
        const authCfg = parseAuthConfig(raw);
        if (!authCfg) return json({ ok: false, error: "not_initialized" }, 404, { ...cors, ...nocache });
        const hash = await pbkdf2Hash(body.password, authCfg.salt, authCfg.iterations);
        if (hash !== authCfg.hash) {
          await recordAuthFailure(env, request);
          try { await appendLoginEvent(env, request, "failed"); } catch {}
          return json({ ok: false, error: "Passphrase incorrect" }, 401, { ...cors, ...nocache });
        }
        await clearAuthFailures(env, request);
        await upgradeHashIfNeeded(env, body.password, authCfg);
        try { await appendLoginEvent(env, request, action); } catch {}
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // POST /webauthn-challenge — generate a challenge (no auth required)
      if (method === "POST" && path === "/webauthn-challenge") {
        const challenge = randomBase64url(32);
        await env.MEMORY.put("webauthn_challenge", challenge, { expirationTtl: 300 });
        return json({ ok: true, challenge }, 200, { ...cors, ...nocache });
      }

      // POST /webauthn-register — store credential public key (session required)
      if (method === "POST" && path === "/webauthn-register") {
        const body = await safeJson(request);
        if (!body?.credentialId || !body?.publicKey || !body?.clientDataJSON) {
          return json({ ok: false, error: "Missing fields" }, 400, { ...cors, ...nocache });
        }
        const storedChallenge = await env.MEMORY.get("webauthn_challenge");
        if (!storedChallenge) return json({ ok: false, error: "Challenge expired — try again" }, 400, { ...cors, ...nocache });
        const clientData = JSON.parse(new TextDecoder().decode(b64urlToBytes(body.clientDataJSON)));
        const origin = request.headers.get("Origin") || "";
        if (clientData.type !== "webauthn.create") return json({ ok: false, error: "Invalid type" }, 400, { ...cors, ...nocache });
        if (clientData.challenge.replace(/=/g,"") !== storedChallenge.replace(/=/g,"")) return json({ ok: false, error: "Challenge mismatch" }, 400, { ...cors, ...nocache });
        if (clientData.origin !== origin) return json({ ok: false, error: "Origin mismatch" }, 400, { ...cors, ...nocache });
        await env.MEMORY.delete("webauthn_challenge");
        await env.MEMORY.put("webauthn_credential", JSON.stringify({
          credentialId: body.credentialId,
          publicKey: body.publicKey,
          counter: 0
        }));
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // POST /webauthn-auth — verify assertion, issue session token (no auth required)
      if (method === "POST" && path === "/webauthn-auth") {
        const body = await safeJson(request);
        if (!body?.credentialId || !body?.authenticatorData || !body?.clientDataJSON || !body?.signature) {
          return json({ ok: false, error: "Missing fields" }, 400, { ...cors, ...nocache });
        }
        const credRaw = await env.MEMORY.get("webauthn_credential");
        if (!credRaw) return json({ ok: false, error: "Biometric not set up" }, 404, { ...cors, ...nocache });
        const cred = JSON.parse(credRaw);
        if (body.credentialId !== cred.credentialId) return json({ ok: false, error: "Unknown credential" }, 401, { ...cors, ...nocache });
        const storedChallenge = await env.MEMORY.get("webauthn_challenge");
        if (!storedChallenge) return json({ ok: false, error: "Challenge expired — try again" }, 400, { ...cors, ...nocache });
        await env.MEMORY.delete("webauthn_challenge");
        const clientDataBytes = b64urlToBytes(body.clientDataJSON);
        const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
        const origin = request.headers.get("Origin") || "";
        if (clientData.type !== "webauthn.get") return json({ ok: false, error: "Invalid type" }, 400, { ...cors, ...nocache });
        if (clientData.challenge.replace(/=/g,"") !== storedChallenge.replace(/=/g,"")) return json({ ok: false, error: "Challenge mismatch" }, 401, { ...cors, ...nocache });
        if (clientData.origin !== origin) return json({ ok: false, error: "Origin mismatch" }, 401, { ...cors, ...nocache });
        const authData = b64urlToBytes(body.authenticatorData);
        const rpId = new URL(origin).hostname;
        const expectedRpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
        if (!expectedRpIdHash.every((b, i) => b === authData[i])) return json({ ok: false, error: "RP ID mismatch" }, 401, { ...cors, ...nocache });
        if (!(authData[32] & 0x04)) return json({ ok: false, error: "User verification required" }, 401, { ...cors, ...nocache });
        const clientDataHash = await crypto.subtle.digest("SHA-256", clientDataBytes);
        const signedData = new Uint8Array(authData.length + clientDataHash.byteLength);
        signedData.set(authData);
        signedData.set(new Uint8Array(clientDataHash), authData.length);
        const publicKeyDer = Uint8Array.from(atob(cred.publicKey), c => c.charCodeAt(0));
        const cryptoKey = await crypto.subtle.importKey("spki", publicKeyDer, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        const rawSig = derToP1363(b64urlToBytes(body.signature));
        const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, rawSig, signedData);
        if (!valid) return json({ ok: false, error: "Signature invalid" }, 401, { ...cors, ...nocache });
        // WebAuthn replay-attack protection: the authenticator counter MUST
        // be strictly greater than the previously-stored counter. If the
        // new counter is equal-or-lower, this credential may have been
        // cloned (or the authenticator has been reset). Refuse and require
        // re-enrollment. Some authenticators report counter=0 permanently
        // (treated as "no counter"); in that case we accept anything when
        // the stored counter is also 0 — the protection just isn't usable.
        const newCounter = ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) >>> 0;
        const storedCounter = cred.counter | 0;
        if (newCounter !== 0 && newCounter <= storedCounter) {
          return json({ ok: false, error: "Authenticator counter regression — credential may be cloned. Please re-enroll fingerprint." }, 401, { ...cors, ...nocache });
        }
        cred.counter = newCounter;
        await env.MEMORY.put("webauthn_credential", JSON.stringify(cred));
        const token = await issueToken(env);
        try { await appendLoginEvent(env, request, "biometric"); } catch {}
        return json({ ok: true, token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }, 200, { ...cors, ...nocache });
      }

      // POST /webauthn-remove — delete stored credential (session required)
      if (method === "POST" && path === "/webauthn-remove") {
        await env.MEMORY.delete("webauthn_credential");
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      if (method === "GET" && path === "/healthz") {
        const [kvFiles, kvArchive, kvDeep] = await Promise.all([
          Promise.all(MEMORY_FILES.map(f => env.MEMORY.get(f).then(v => ({ file: f, ok: v !== null, bytes: v ? v.length : 0 })))),
          Promise.all(ARCHIVE_FILES.map(f => env.MEMORY.get(f).then(v => ({ file: f, bytes: v ? v.length : 0 })))),
          Promise.all(DEEPARCHIVE_FILES.map(f => env.MEMORY.get(f).then(v => ({ file: f, content: v || "" })))),
        ]);
        const totalBytes = kvFiles.reduce((sum, f) => sum + f.bytes, 0);
        const archiveBytes = kvArchive.reduce((sum, f) => sum + f.bytes, 0);
        const deepRecordCount = kvDeep.reduce((sum, f) => sum + parseH2Sections(f.content || "").length, 0);
        return json({ ok: true, files: kvFiles, totalBytes, archiveBytes, deepRecordCount }, 200, { ...cors, ...nocache });
      }
      // GET /getMemoryFile?filename=people.md[&section=Name]
      if (method === "GET" && path === "/getMemoryFile") {
        const filename = url.searchParams.get("filename");
        if (!filename) return json({ ok: false, error: "filename required" }, 400, { ...cors, ...nocache });
        if (PROTECTED_KEYS.has(filename)) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });
        if (!BACKUP_FILES.includes(filename)) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });
        const content = await env.MEMORY.get(filename);
        if (content === null) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });

        const section = url.searchParams.get("section");
        if (section) {
          const lines = content.replace(/\r\n/g, "\n").split("\n");
          const occRaw = url.searchParams.get("occurrenceIndex");
          const occurrenceIndex = occRaw !== null ? parseInt(occRaw, 10) : null;
          let span = findSectionSpan(lines, section, occurrenceIndex);
          // The caller may have named an interior (###) heading rather than an
          // addressable H2 — Claude's <sources> block cites the heading a fact
          // actually lives under, which for a record built from subsections is
          // the ###. Fall back to opening the H2 that contains it, and say so
          // in X-Resolved-Section so the client edits the right record.
          // READ PATH ONLY — see findSubsectionParent for why writes stay strict.
          let resolvedSection = null;
          if (!span) {
            const parent = findSubsectionParent(lines, section);
            if (parent) {
              const parentSpan = findSectionSpan(lines, parent);
              if (parentSpan) { span = parentSpan; resolvedSection = parent; }
            }
          }
          if (!span) return new Response(`Section not found: ${section}`, { status: 404, headers: { ...cors, ...nocache } });
          return new Response(lines.slice(span.iHeader, span.iEnd).join("\n"), {
            headers: {
              "Content-Type": "text/plain",
              // Header values are latin-1; section names are not (e.g. "José
              // García"), so percent-encode and decode on the client.
              ...(resolvedSection && { "X-Resolved-Section": encodeURIComponent(resolvedSection) }),
              ...cors,
              ...nocache,
            },
          });
        }

        return new Response(content, { headers: { "Content-Type": "text/plain", ...cors, ...nocache } });
      }

      // GET /searchMemoryFile?filename=people.md&q=...&limit=5&fuzzy=2
      if (method === "GET" && path === "/searchMemoryFile") {
        const filename = url.searchParams.get("filename") || "people.md";
        if (PROTECTED_KEYS.has(filename)) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });
        if (!BACKUP_FILES.includes(filename)) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });
        const q = url.searchParams.get("q");
        if (!q) return json({ ok: false, error: "q required" }, 400, { ...cors, ...nocache });
        const limit = Math.max(1, Math.min(25, Number(url.searchParams.get("limit") || 5)));
        const fuzzy = Math.max(0, Math.min(3, Number(url.searchParams.get("fuzzy") || 2)));
        const content = await env.MEMORY.get(filename);
        if (content === null) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });
        const results = searchMemoryFile(content, { q, limit, fuzzy });
        return json({ ok: true, results }, 200, { ...cors, ...nocache });
      }

      // POST /patchMemoryFile
      if (method === "POST" && path === "/patchMemoryFile") {
        const body = await safeJson(request);
        if (!body || !body.filename || !body.section) {
          return json({ ok: false, error: "filename and section required" }, 400, { ...cors, ...nocache });
        }
        const result = await patchMemoryFile(env, body);
        return json(result, result.ok ? 200 : 400, { ...cors, ...nocache });
      }

      // POST /insertSection
      if (method === "POST" && path === "/insertSection") {
        const body = await safeJson(request);
        if (!body || !body.filename || !body.section) {
          return json({ ok: false, error: "filename and section required" }, 400, { ...cors, ...nocache });
        }
        const result = await insertSection(env, body);
        return json(result, result.ok ? 200 : 400, { ...cors, ...nocache });
      }

      // GET /browseFile?filename=people.md — return all ## section titles (no Claude, no tokens)
      if (method === "GET" && path === "/browseFile") {
        const filename = url.searchParams.get("filename");
        if (!filename || PROTECTED_KEYS.has(filename) || !BACKUP_FILES.includes(filename)) return json({ ok: false, error: "Unknown file" }, 400, { ...cors, ...nocache });
        const content = await env.MEMORY.get(filename);
        if (!content) return json({ ok: true, headers: [] }, 200, { ...cors, ...nocache });
        const rawSections = parseH2Sections(content);
        const sections = rawSections.map(s => {
          const chars = s.lines.join("\n").length;
          return { title: s.name, tokLabel: chars > 0 ? fmtTok(chars) : null };
        });
        const headers = sections.map(s => s.title);
        return json({ ok: true, headers, sections }, 200, { ...cors, ...nocache });
      }

      // GET /findSections?query=xxx[&file=people.md][&titleOnly=true] — search section titles (and optionally content) across working memory files
      if (method === "GET" && path === "/findSections") {
        const query = (url.searchParams.get("query") || "").trim();
        if (!query) return json({ ok: false, error: "query required" }, 400, { ...cors, ...nocache });
        const fileFilter = url.searchParams.get("file") || null;
        const titleOnly = url.searchParams.get("titleOnly") === "true";
        const scope = url.searchParams.get("scope") || "live";
        const searchPool = scope === "archive" ? ARCHIVE_FILES
          : scope === "deep" ? DEEPARCHIVE_FILES
          : scope === "allarchived" ? [...ARCHIVE_FILES, ...DEEPARCHIVE_FILES]
          : scope === "all" ? [...MEMORY_FILES, ...ARCHIVE_FILES]
          : scope === "everything" ? [...MEMORY_FILES, ...ARCHIVE_FILES, ...DEEPARCHIVE_FILES]
          : MEMORY_FILES;
        const filesToSearch = fileFilter ? searchPool.filter(f => f === fileFilter) : searchPool;
        const terms = normKey(query).split(/\s+/).filter(Boolean);
        const titleResults = [];
        const contentResults = [];
        const fileContents = await Promise.all(filesToSearch.map(f => env.MEMORY.get(f).then(c => ({ file: f, content: c || "" }))));
        const occByFileSection = {};
        for (const { file, content } of fileContents) {
          const lines = content.replace(/\r\n/g, "\n").split("\n");
          let i = 0;
          while (i < lines.length) {
            const hm = String(lines[i] || "").match(/^\s*#{2}\s*(?:👤\s*)?(.+?)\s*$/);
            if (!hm) { i++; continue; }
            const title = hm[1];
            const titleNorm = normKey(title);
            let j = i + 1;
            while (j < lines.length && !/^\s*#{2}\s/.test(lines[j] || "")) j++;
            const sectionLines = lines.slice(i + 1, j);
            const preview = sectionLines.filter(l => l.trim()).slice(0, 3).join(" · ").replace(/#{1,3}\s*/g, "").trim();
            const occKey = `${file}|${normKey(title)}`;
            const entry = { file, section: title, preview: preview || "(empty)", occurrenceIndex: occByFileSection[occKey] || 0 };
            occByFileSection[occKey] = (occByFileSection[occKey] || 0) + 1;
            if (terms.every(t => termMatches(t, titleNorm))) {
              titleResults.push(entry);
            } else if (!titleOnly && terms.every(t => sectionLines.join(" ").toLowerCase().includes(t))) {
              contentResults.push(entry);
            }
            i = j;
          }
        }
        // Title matches first, then content matches (deduped by section name) — never discard content hits when title hits exist
        const titleKeys = new Set(titleResults.map(r => `${r.file}|${r.section}`));
        const combined = [...titleResults, ...contentResults.filter(r => !titleKeys.has(`${r.file}|${r.section}`))];
        return json({ ok: true, results: combined, fallback: false }, 200, { ...cors, ...nocache });
      }

      // POST /deleteSection — permanently remove a ## section from a memory file
      if (method === "POST" && path === "/deleteSection") {
        const body = await safeJson(request);
        if (!body || !body.filename || !body.section) {
          return json({ ok: false, error: "filename and section required" }, 400, { ...cors, ...nocache });
        }
        if (!MEMORY_FILES.includes(body.filename) && !ARCHIVE_FILES.includes(body.filename) && !DEEPARCHIVE_FILES.includes(body.filename)) {
          return json({ ok: false, error: "Cannot delete from system files" }, 400, { ...cors, ...nocache });
        }
        const content = await env.MEMORY.get(body.filename);
        if (!content) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });
        const lines = content.replace(/\r\n/g, "\n").split("\n");
        const occurrenceIndex = (typeof body.occurrenceIndex === "number") ? body.occurrenceIndex : null;
        const span = findSectionSpan(lines, body.section, occurrenceIndex);
        if (!span) return json({ ok: false, error: `Section not found: ${body.section}` }, 404, { ...cors, ...nocache });

        // Optimistic concurrency — section-level. Same pattern as
        // /replaceSection. Refuse the delete when the section's current
        // text differs from what the caller read.
        const sectionHash = String(body.sectionHash || "").trim();
        if (sectionHash) {
          const currentSection = lines.slice(span.iHeader, span.iEnd).join("\n");
          const currentHash = await sha256Hex(currentSection);
          if (currentHash.toLowerCase() !== sectionHash.toLowerCase()) {
            return json({ ok: false, conflict: true, error: "This record was changed in another tab. Reload to see the latest version." }, 409, { ...cors, ...nocache });
          }
        }

        const newContent = buildFileWithSectionReplaced(lines, span, []);
        await writeFile(env, body.filename, newContent);
        return json({ ok: true, filename: body.filename, section: body.section }, 200, { ...cors, ...nocache });
      }

      // POST /speak — convert text to speech
      // brittney/callum/hans → ElevenLabs; marin/onyx → OpenAI TTS
      if (method === "POST" && path === "/speak") {
        const body = await safeJson(request);
        if (!body || !body.text) {
          return json({ ok: false, error: "text required" }, 400, { ...cors, ...nocache });
        }

        const voiceKey = String(body.voice || "brittney").toLowerCase();
        const cleanText = stripMarkdownForSpeech(body.text);

        // brittney, callum, hans → ElevenLabs; marin, onyx → OpenAI TTS
        const ELEVENLABS_VOICES = {
          brittney: "kPzsL2i3teMYv0FxEYQ6",
          callum:   "N2lVS1w4EtoT3dr4eOWO",
        };
        // marin → gpt-4o-mini-tts; onyx → tts-1
        const OPENAI_VOICES = {
          marin: { voice: "marin", model: "gpt-4o-mini-tts" },
          onyx:  { voice: "onyx",  model: "tts-1" },
        };

        if (ELEVENLABS_VOICES[voiceKey]) {
          const elevenLabsKey = await resolveApiKey(env, "ELEVENLABS_API_KEY");
          if (!elevenLabsKey) {
            return json({ ok: false, error: "ELEVENLABS_API_KEY not configured" }, 500, { ...cors, ...nocache });
          }
          const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICES[voiceKey]}`, {
            method: "POST",
            headers: { "xi-api-key": elevenLabsKey, "Content-Type": "application/json" },
            body: JSON.stringify({ text: cleanText, model_id: "eleven_turbo_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
          });
          if (!ttsRes.ok) {
            const err = await ttsRes.text();
            return json({ ok: false, error: `ElevenLabs error: ${err}` }, 502, { ...cors, ...nocache });
          }
          const audioBuffer = await ttsRes.arrayBuffer();
          return new Response(audioBuffer, { status: 200, headers: { "Content-Type": "audio/mpeg", ...cors } });
        }

        // marin / onyx → OpenAI TTS
        const openaiKey = await resolveApiKey(env, "OPENAI_API_KEY");
        if (!openaiKey) {
          return json({ ok: false, error: "OPENAI_API_KEY not configured" }, 500, { ...cors, ...nocache });
        }
        const oai = OPENAI_VOICES[voiceKey] || OPENAI_VOICES.marin;
        const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: oai.model, input: cleanText, voice: oai.voice }),
        });
        if (!ttsRes.ok) {
          const err = await ttsRes.text();
          return json({ ok: false, error: `OpenAI TTS error: ${err}` }, 502, { ...cors, ...nocache });
        }
        // Pipe body directly — avoids buffering full audio in worker, reduces latency
        return new Response(ttsRes.body, { status: 200, headers: { "Content-Type": "audio/mpeg", ...cors } });
      }

      // POST /audit — Quick scan only. Body: { scope }.
      // scope: "active" | "archived" (default) | "all"
      if (method === "POST" && path === "/audit") {
        const body = await safeJson(request);
        const scope = body && body.scope ? String(body.scope) : "archived";
        const filesToLoad =
          scope === "active" ? MEMORY_FILES :
          scope === "all"    ? [...MEMORY_FILES, ...ARCHIVE_FILES, ...DEEPARCHIVE_FILES] :
                                [...MEMORY_FILES, ...ARCHIVE_FILES];
        const today = new Date().toISOString().slice(0, 10);
        const fileObjs = await Promise.all(filesToLoad.map(async f => ({
          name: f, content: (await env.MEMORY.get(f)) || "",
        })));

        // Run Quick detectors
        const quickFindings = [];
        for (const f of fileObjs) {
          for (const x of detectBrokenCharacters(f.name, f.content))    quickFindings.push({ ...x, category: "broken-characters" });
          for (const x of detectFormatViolations(f.name, f.content))    quickFindings.push({ ...x, category: "format-violations" });
          for (const x of detectDateInconsistencies(f.name, f.content, today)) quickFindings.push({ ...x, category: "date-inconsistencies" });
          for (const x of detectDuplicateHeaders(f.name, f.content))    quickFindings.push({ ...x, category: "duplicate-headers" });
        }

        // Auto-prune ghost ignored entries against current memory state
        const existingHeaders = new Set();
        for (const f of fileObjs) {
          for (const sec of parseSections(f.content)) {
            existingHeaders.add(`${f.name}:${normalizeHeader(sec.header)}`);
          }
        }
        const ignoredRaw = await env.MEMORY.get("audit_ignored");
        let ignored = []; try { ignored = ignoredRaw ? JSON.parse(ignoredRaw) : []; } catch {}
        const { kept, pruned } = pruneIgnored(ignored, existingHeaders, fileObjs);
        if (pruned.length) await env.MEMORY.put("audit_ignored", JSON.stringify(kept));
        const ignoredSigs = new Set(kept.map(e => e.signature));

        // Filter ignored, attach signatures
        const findings = quickFindings
          .map(f => ({ ...f, signature: signatureFor(f) }))
          .filter(f => !ignoredSigs.has(f.signature));

        // Last-audit metadata (read + bump)
        const lastRaw = await env.MEMORY.get("audit_last_run");
        let lastAudit = null; try { lastAudit = lastRaw ? JSON.parse(lastRaw) : null; } catch {}
        await env.MEMORY.put("audit_last_run", JSON.stringify({ at: Date.now(), findingCount: findings.length }));

        return json({
          ok: true,
          scope,
          findings,
          skipped: ["near-duplicates", "name-mismatches"],
          categories: AUDIT_CATEGORIES,
          lastAudit,
          prunedCount: pruned.length,
        }, 200, { ...cors, ...nocache });
      }

      // POST /auditIgnore — body: { signature, category }
      if (method === "POST" && path === "/auditIgnore") {
        const body = await safeJson(request);
        if (!body || !body.signature || !body.category) {
          return json({ ok: false, error: "signature and category required" }, 400, { ...cors, ...nocache });
        }
        if (typeof body.signature !== "string" || body.signature.length > 200) {
          return json({ ok: false, error: "signature must be a string under 200 chars" }, 400, { ...cors, ...nocache });
        }
        const validCategories = ["broken-characters", "format-violations", "date-inconsistencies", "near-duplicates", "name-mismatches", "duplicate-headers"];
        if (!validCategories.includes(body.category)) {
          return json({ ok: false, error: "invalid category" }, 400, { ...cors, ...nocache });
        }
        const raw = await env.MEMORY.get("audit_ignored");
        let arr = []; try { arr = raw ? JSON.parse(raw) : []; } catch {}
        if (!arr.some(e => e.signature === body.signature)) {
          if (arr.length >= 500) {
            return json({ ok: false, error: "ignored list at cap (500). Use /audit ignored to prune." }, 400, { ...cors, ...nocache });
          }
          arr.push({ signature: body.signature, category: body.category, addedAt: Date.now() });
          await env.MEMORY.put("audit_ignored", JSON.stringify(arr));
        }
        return json({ ok: true, count: arr.length }, 200, { ...cors, ...nocache });
      }

      // POST /auditUnignore — body: { signature }
      if (method === "POST" && path === "/auditUnignore") {
        const body = await safeJson(request);
        if (!body || !body.signature) {
          return json({ ok: false, error: "signature required" }, 400, { ...cors, ...nocache });
        }
        const raw = await env.MEMORY.get("audit_ignored");
        let arr = []; try { arr = raw ? JSON.parse(raw) : []; } catch {}
        const before = arr.length;
        arr = arr.filter(e => e.signature !== body.signature);
        if (arr.length !== before) await env.MEMORY.put("audit_ignored", JSON.stringify(arr));
        return json({ ok: true, removed: before - arr.length, count: arr.length }, 200, { ...cors, ...nocache });
      }

      // GET /auditIgnored — returns the ignored list (auto-prunes ghosts as a side effect)
      if (method === "GET" && path === "/auditIgnored") {
        const raw = await env.MEMORY.get("audit_ignored");
        let arr = []; try { arr = raw ? JSON.parse(raw) : []; } catch {}

        // Build existing-headers set + file content objects from all tiers (needed for photo-ref liveness)
        const all = [...MEMORY_FILES, ...ARCHIVE_FILES, ...DEEPARCHIVE_FILES];
        const existing = new Set();
        const allFileObjs = await Promise.all(all.map(async f => {
          const c = (await env.MEMORY.get(f)) || "";
          for (const sec of parseSections(c)) existing.add(`${f}:${normalizeHeader(sec.header)}`);
          return { name: f, content: c };
        }));
        const { kept, pruned } = pruneIgnored(arr, existing, allFileObjs);
        if (pruned.length) await env.MEMORY.put("audit_ignored", JSON.stringify(kept));

        return json({ ok: true, ignored: kept, prunedCount: pruned.length, categories: AUDIT_CATEGORIES }, 200, { ...cors, ...nocache });
      }

      // POST /auditPrune — explicit ghost prune (same logic GET /auditIgnored runs implicitly)
      if (method === "POST" && path === "/auditPrune") {
        const raw = await env.MEMORY.get("audit_ignored");
        let arr = []; try { arr = raw ? JSON.parse(raw) : []; } catch {}
        const all = [...MEMORY_FILES, ...ARCHIVE_FILES, ...DEEPARCHIVE_FILES];
        const existing = new Set();
        const allFileObjs = await Promise.all(all.map(async f => {
          const c = (await env.MEMORY.get(f)) || "";
          for (const sec of parseSections(c)) existing.add(`${f}:${normalizeHeader(sec.header)}`);
          return { name: f, content: c };
        }));
        const { kept, pruned } = pruneIgnored(arr, existing, allFileObjs);
        await env.MEMORY.put("audit_ignored", JSON.stringify(kept));
        return json({ ok: true, pruned: pruned.length, kept: kept.length }, 200, { ...cors, ...nocache });
      }

      // POST /auditEstimateCost — body: { scope }. Returns Deep-scan cost projection.
      if (method === "POST" && path === "/auditEstimateCost") {
        const body = await safeJson(request);
        const scope = body && body.scope ? String(body.scope) : "archived";
        const filesToLoad =
          scope === "active" ? MEMORY_FILES :
          scope === "all"    ? [...MEMORY_FILES, ...ARCHIVE_FILES, ...DEEPARCHIVE_FILES] :
                                [...MEMORY_FILES, ...ARCHIVE_FILES];
        let totalBytes = 0;
        let recordCount = 0;
        await Promise.all(filesToLoad.map(async f => {
          const c = (await env.MEMORY.get(f)) || "";
          totalBytes += new TextEncoder().encode(c).byteLength;
          recordCount += parseSections(c).length;
        }));
        const cost = estimateDeepScanCost({ totalBytes, recordCount });
        return json({
          ok: true, scope,
          recordCount, fileCount: filesToLoad.length,
          ...cost,
          warnLargeAudit: cost.ceiling > 0.10,
        }, 200, { ...cors, ...nocache });
      }

      // POST /auditDeep — Quick + Deep scan. Body: { scope }.
      if (method === "POST" && path === "/auditDeep") {
        const capResponse = await enforceCapOrReturn(env, cors, nocache);
        if (capResponse) return capResponse;
        try {
          const body = await safeJson(request);
          const scope = body && body.scope ? String(body.scope) : "archived";
          const filesToLoad =
            scope === "active" ? MEMORY_FILES :
            scope === "all"    ? [...MEMORY_FILES, ...ARCHIVE_FILES, ...DEEPARCHIVE_FILES] :
                                  [...MEMORY_FILES, ...ARCHIVE_FILES];
          const today = new Date().toISOString().slice(0, 10);
          const fileObjs = await Promise.all(filesToLoad.map(async f => ({
            name: f, content: (await env.MEMORY.get(f)) || "",
          })));

          // Quick findings
          const quickFindings = [];
          for (const f of fileObjs) {
            for (const x of detectBrokenCharacters(f.name, f.content))    quickFindings.push({ ...x, category: "broken-characters" });
            for (const x of detectFormatViolations(f.name, f.content))    quickFindings.push({ ...x, category: "format-violations" });
            for (const x of detectDateInconsistencies(f.name, f.content, today)) quickFindings.push({ ...x, category: "date-inconsistencies" });
            for (const x of detectDuplicateHeaders(f.name, f.content))    quickFindings.push({ ...x, category: "duplicate-headers" });
          }

          // Deep findings (deterministic name-mismatches + Haiku near-duplicates)
          const deep = await runDeepScanDetectors(env, fileObjs);
          if (deep.error) {
            return json({ ok: false, error: deep.error, partialFindings: deep.findings || [] }, 502, { ...cors, ...nocache });
          }
          if (deep.usage) {
            ctx.waitUntil(trackCost(env, today, "haiku", deep.usage));
          }

          // Load all 12 memory files for photo-ref liveness in pruneIgnored and orphan detection
          const ALL_MEMORY_FILES = [
            "people.md","reflections.md","fragments.md","loops.md",
            "archive_people.md","archive_reflections.md","archive_fragments.md","archive_loops.md",
            "deeparchive_people.md","deeparchive_reflections.md","deeparchive_fragments.md","deeparchive_loops.md"
          ];
          const allMemoryFileObjs = await Promise.all(
            ALL_MEMORY_FILES.map(async fn => ({ name: fn, content: (await env.MEMORY.get(fn)) || "" }))
          );

          // Auto-prune ghosts — pass full 12-file set so photo-ref entries survive across all tiers
          const existingHeaders = new Set();
          for (const f of allMemoryFileObjs) {
            for (const sec of parseSections(f.content)) existingHeaders.add(`${f.name}:${normalizeHeader(sec.header)}`);
          }
          const ignoredRaw = await env.MEMORY.get("audit_ignored");
          let ignored = []; try { ignored = ignoredRaw ? JSON.parse(ignoredRaw) : []; } catch {}
          const { kept, pruned } = pruneIgnored(ignored, existingHeaders, allMemoryFileObjs);
          if (pruned.length) await env.MEMORY.put("audit_ignored", JSON.stringify(kept));
          const ignoredSigs = new Set(kept.map(e => e.signature));

          // Photo issues (deterministic, requires R2) — skip the 12-file load if R2 not bound
          const photoFindings = env.DOWNLOADS
            ? await detectPhotoIssues(fileObjs, env, allMemoryFileObjs)
            : [];
          const findings = [...quickFindings, ...deep.findings, ...photoFindings]
            .map(f => ({ ...f, signature: signatureFor(f) }))
            .filter(f => !ignoredSigs.has(f.signature));

          await env.MEMORY.put("audit_last_run", JSON.stringify({ at: Date.now(), findingCount: findings.length }));

          return json({
            ok: true, scope,
            findings,
            skipped: [],
            categories: AUDIT_CATEGORIES,
            prunedCount: pruned.length,
            usage: deep.usage,
          }, 200, { ...cors, ...nocache });
        } catch (err) {
          // Surface the real error as JSON so the frontend can show it. Without
          // this catch, an uncaught throw causes Cloudflare to return its
          // default HTML error page, which the frontend's res.json() trips on.
          return json({
            ok: false,
            error: `Audit deep failed in worker: ${err.message || String(err)}`,
            stack: (err.stack || "").slice(0, 500),
          }, 500, { ...cors, ...nocache });
        }
      }

      // POST /analyzeArchive — return archive candidates for one or all memory files
      if (method === "POST" && path === "/analyzeArchive") {
        const capResponse = await enforceCapOrReturn(env, cors, nocache);
        if (capResponse) return capResponse;
        const body = await safeJson(request);
        const targetFile = body && body.file ? String(body.file) : null;
        const deep = body && body.deep === true;
        const context = body && body.context ? String(body.context).trim() : null;
        const filesToLoad = targetFile ? [targetFile] : MEMORY_FILES;
        const [files, dismissedRaw] = await Promise.all([
          Promise.all(filesToLoad.map(async f => ({ name: f, content: await env.MEMORY.get(f) }))),
          env.MEMORY.get("archive_dismissed"),
        ]);
        const dismissed = (() => { try { return dismissedRaw ? JSON.parse(dismissedRaw) : {}; } catch { return {}; } })();
        // Pre-filter: strip "– Memory: permanent" sections — never suggest them for archiving
        const validFiles = files
          .filter(f => f.content && f.content.trim().length > 10)
          .map(fileObj => {
            const lines = fileObj.content.replace(/\r\n/g, "\n").split("\n");
            const kept = [];
            let i = 0;
            while (i < lines.length) {
              if (/^\s*#{2}\s/.test(String(lines[i] || ""))) {
                let j = i + 1;
                while (j < lines.length && !/^\s*#{2}\s/.test(String(lines[j] || ""))) j++;
                const sectionLines = lines.slice(i, j);
                const isPermanent = sectionLines.some(l => /[–-]\s+Memory:\s+permanent/i.test(String(l)));
                if (!isPermanent) kept.push(...sectionLines);
                i = j;
              } else { kept.push(lines[i]); i++; }
            }
            return { ...fileObj, content: kept.join("\n") };
          })
          .filter(f => f.content && f.content.trim().length > 10);
        if (!validFiles.length) return json({ ok: true, candidates: [] }, 200, { ...cors, ...nocache });

        const dismissedLines = Object.entries(dismissed).flatMap(([file, sections]) => sections.map(s => `- ${file}: "${s}"`));
        const dismissedBlock = dismissedLines.length ? `\nNEVER suggest these (user has skipped them):\n${dismissedLines.join("\n")}\n` : "";
        const today = new Date().toISOString().split("T")[0];
        const depthNote = deep
          ? "Be thorough — apply every criterion below aggressively. Flag any person with no dated activity in 90+ days, any thin record with no active work, any closed loop, any old reflection. The user will review and decide — cast a wide net."
          : "Be conservative — only flag entries that clearly meet one of the criteria below with obvious evidence.";
        const contextNote = context ? `\nAdditional focus: ${context}` : "";
        const fileContext = validFiles.map(f => `<file name="${f.name}">\n${f.content}\n</file>`).join("\n\n");

        const analysisPrompt = `Today's date: ${today}. Analyze these memory files and identify entries that are candidates for archiving to long-term storage. ${depthNote}${contextNote}${dismissedBlock}

Criteria:
- PEOPLE: person has left the organization; OR no dated activity (1:1 notes, meetings, interactions) in the last 90 days compared to today; OR thin record (fewer than 10 lines total) with no active ongoing work or relationship; OR project-based contact from a completed project with no current touchpoints; OR one-time contact with no ongoing relationship
- LOOPS: Status field is Closed or Resolved
- REFLECTIONS: entry is older than 6 months and unlikely to be actively referenced
- FRAGMENTS: entry is clearly stale, outdated, or from a past context that no longer applies

Return ONLY a valid JSON array, no explanation, no markdown fences:
[
  { "file": "people.md", "sectionTitle": "Exact Section Title Here", "reason": "Brief reason" }
]
If no candidates found, return: []

Memory files:
${fileContext}`;

        const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
        if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500, { ...cors, ...nocache });
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, system: "You are analyzing a user's private personal memory files. Return only the JSON output requested. Do not reproduce, summarize, or comment on individual record contents beyond the required output fields.", messages: [{ role: "user", content: analysisPrompt }] }),
        });
        if (!claudeRes.ok) { const e = await claudeRes.text(); let m = "Analysis failed"; try { m = JSON.parse(e)?.error?.message || m; } catch {} return json({ ok: false, error: m }, 502, { ...cors, ...nocache }); }
        const claudeData = await claudeRes.json();
        ctx.waitUntil(trackCost(env, new Date().toISOString().slice(0, 10), "haiku", claudeData.usage || {}));
        let candidates = [];
        try {
          const raw = claudeData.content[0].text.trim();
          const match = raw.match(/\[[\s\S]*\]/);
          if (match) candidates = JSON.parse(match[0]);
        } catch {}
        return json({ ok: true, candidates }, 200, { ...cors, ...nocache });
      }

      // POST /analyzeDeep — return deep-archive candidates from the long-term archive tier
      // Sections flagged "– Memory: permanent" are pre-filtered and never suggested
      if (method === "POST" && path === "/analyzeDeep") {
        const capResponse = await enforceCapOrReturn(env, cors, nocache);
        if (capResponse) return capResponse;
        const body = await safeJson(request);
        const targetFile = body && body.file ? String(body.file) : null;
        const context = body && body.context ? String(body.context).trim() : null;
        const archiveFileMap = {
          "people": "archive_people.md",
          "reflections": "archive_reflections.md",
          "fragments": "archive_fragments.md",
          "loops": "archive_loops.md",
        };
        const filesToLoad = targetFile ? [archiveFileMap[targetFile] || targetFile] : ARCHIVE_FILES;
        const [files, dismissedRaw] = await Promise.all([
          Promise.all(filesToLoad.map(async f => ({ name: f, content: await env.MEMORY.get(f) }))),
          env.MEMORY.get("deep_dismissed"),
        ]);
        const dismissed = (() => { try { return dismissedRaw ? JSON.parse(dismissedRaw) : {}; } catch { return {}; } })();

        // Pre-filter: strip "– Memory: permanent" sections before Claude ever sees them
        const filteredFiles = files
          .filter(f => f.content && f.content.trim().length > 10)
          .map(fileObj => {
            const lines = fileObj.content.replace(/\r\n/g, "\n").split("\n");
            const kept = [];
            let i = 0;
            while (i < lines.length) {
              if (/^\s*#{2}\s/.test(String(lines[i] || ""))) {
                let j = i + 1;
                while (j < lines.length && !/^\s*#{2}\s/.test(String(lines[j] || ""))) j++;
                const sectionLines = lines.slice(i, j);
                const isPermanent = sectionLines.some(l => /[–-]\s+Memory:\s+permanent/i.test(String(l)));
                if (!isPermanent) kept.push(...sectionLines);
                i = j;
              } else {
                kept.push(lines[i]);
                i++;
              }
            }
            return { ...fileObj, content: kept.join("\n") };
          })
          .filter(f => f.content && f.content.trim().length > 10);

        if (!filteredFiles.length) return json({ ok: true, candidates: [] }, 200, { ...cors, ...nocache });

        const dismissedLines = Object.entries(dismissed).flatMap(([file, sections]) => sections.map(s => `- ${file}: "${s}"`));
        const dismissedBlock = dismissedLines.length ? `\nNEVER suggest these (user has skipped them):\n${dismissedLines.join("\n")}\n` : "";
        const today = new Date().toISOString().split("T")[0];
        const contextNote = context ? `\nAdditional focus: ${context}` : "";
        const fileContext = filteredFiles.map(f => `<file name="${f.name}">\n${f.content}\n</file>`).join("\n\n");

        const analysisPrompt = `Today's date: ${today}. These are long-term archive entries. Identify which ones should be moved to cold storage (rarely accessed, never auto-loaded).${contextNote}${dismissedBlock}

Criteria for cold storage (rarely accessed tier):
- PEOPLE: person was highly significant (mentor, close collaborator, key relationship) even if no longer active; OR the record contains rich history worth preserving
- LOOPS: loop was resolved and documents a significant decision, outcome, or lesson
- REFLECTIONS: entry captures a meaningful life moment, milestone, or turning point
- FRAGMENTS: contains reference information, hard-won knowledge, or historical context with lasting value

Do NOT suggest entries that are thin (fewer than 5 lines), routine, or low-significance.

Return ONLY a valid JSON array, no explanation, no markdown fences:
[
  { "file": "archive_people.md", "sectionTitle": "Exact Section Title Here", "reason": "Brief reason" }
]
If no candidates found, return: []

Archive files:
${fileContext}`;

        const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
        if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500, { ...cors, ...nocache });
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 4000, system: "You are analyzing a user's private personal memory files. Return only the JSON output requested. Do not reproduce, summarize, or comment on individual record contents beyond the required output fields.", messages: [{ role: "user", content: analysisPrompt }] }),
        });
        if (!claudeRes.ok) { const e = await claudeRes.text(); let m = "Analysis failed"; try { m = JSON.parse(e)?.error?.message || m; } catch {} return json({ ok: false, error: m }, 502, { ...cors, ...nocache }); }
        const claudeData = await claudeRes.json();
        ctx.waitUntil(trackCost(env, new Date().toISOString().slice(0, 10), "haiku", claudeData.usage || {}));
        let candidates = [];
        try {
          const raw = claudeData.content[0].text.trim();
          const match = raw.match(/\[[\s\S]*\]/);
          if (match) candidates = JSON.parse(match[0]);
        } catch {}
        return json({ ok: true, candidates }, 200, { ...cors, ...nocache });
      }

      // POST /deepDismiss — add sections to deep-review skipped list
      if (method === "POST" && path === "/deepDismiss") {
        const body = await safeJson(request);
        if (!body) return json({ ok: false, error: "body required" }, 400, { ...cors, ...nocache });
        const raw = await env.MEMORY.get("deep_dismissed");
        const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        // Prune stale entries for files touched by this dismiss call before adding new ones
        const touchedFiles = [...new Set((body.sections || []).map(s => s.file).filter(f => ARCHIVE_FILES.includes(f)))];
        for (const file of touchedFiles) {
          if (!dismissed[file]?.length) continue;
          const content = (await env.MEMORY.get(file)) || "";
          const existing = new Set(parseSections(content).map(s => s.header));
          dismissed[file] = dismissed[file].filter(s => existing.has(s));
          if (!dismissed[file].length) delete dismissed[file];
        }
        for (const s of (body.sections || [])) {
          if (!dismissed[s.file]) dismissed[s.file] = [];
          if (!dismissed[s.file].includes(s.sectionTitle)) dismissed[s.file].push(s.sectionTitle);
        }
        await env.MEMORY.put("deep_dismissed", JSON.stringify(dismissed));
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // GET /deepDismissed — return deep-review skipped list
      if (method === "GET" && path === "/deepDismissed") {
        const raw = await env.MEMORY.get("deep_dismissed");
        const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        return json({ ok: true, dismissed }, 200, { ...cors, ...nocache });
      }

      // POST /deepDismissedClear — clear deep-review skipped list (all or by file)
      if (method === "POST" && path === "/deepDismissedClear") {
        const body = await safeJson(request);
        const file = body && body.file ? String(body.file) : null;
        if (file) {
          const raw = await env.MEMORY.get("deep_dismissed");
          const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
          delete dismissed[file];
          await env.MEMORY.put("deep_dismissed", JSON.stringify(dismissed));
        } else {
          await env.MEMORY.put("deep_dismissed", JSON.stringify({}));
        }
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // GET /archiveDismissed — return skipped list
      if (method === "GET" && path === "/archiveDismissed") {
        const raw = await env.MEMORY.get("archive_dismissed");
        const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        return json({ ok: true, dismissed }, 200, { ...cors, ...nocache });
      }

      // POST /archiveDismiss — add sections to skipped list
      if (method === "POST" && path === "/archiveDismiss") {
        const body = await safeJson(request);
        if (!body) return json({ ok: false, error: "body required" }, 400, { ...cors, ...nocache });
        const raw = await env.MEMORY.get("archive_dismissed");
        const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        // Prune stale entries for files touched by this dismiss call before adding new ones
        const touchedFiles = [...new Set((body.sections || []).map(s => s.file).filter(f => MEMORY_FILES.includes(f)))];
        for (const file of touchedFiles) {
          if (!dismissed[file]?.length) continue;
          const content = (await env.MEMORY.get(file)) || "";
          const existing = new Set(parseSections(content).map(s => s.header));
          dismissed[file] = dismissed[file].filter(s => existing.has(s));
          if (!dismissed[file].length) delete dismissed[file];
        }
        for (const s of (body.sections || [])) {
          if (!dismissed[s.file]) dismissed[s.file] = [];
          if (!dismissed[s.file].includes(s.sectionTitle)) dismissed[s.file].push(s.sectionTitle);
        }
        await env.MEMORY.put("archive_dismissed", JSON.stringify(dismissed));
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // POST /archiveDismissedClear — clear skipped list (all or by file)
      if (method === "POST" && path === "/archiveDismissedClear") {
        const body = await safeJson(request);
        const file = body && body.file ? String(body.file) : null;
        if (file) {
          const raw = await env.MEMORY.get("archive_dismissed");
          const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
          delete dismissed[file];
          await env.MEMORY.put("archive_dismissed", JSON.stringify(dismissed));
        } else {
          await env.MEMORY.put("archive_dismissed", JSON.stringify({}));
        }
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // POST /archiveUndismiss — remove ONE entry from archive_dismissed.
      // Mirrors the per-row Un-ignore UX in /audit ignored.
      if (method === "POST" && path === "/archiveUndismiss") {
        const body = await safeJson(request);
        if (!body || !body.file || !body.section) {
          return json({ ok: false, error: "file and section required" }, 400, { ...cors, ...nocache });
        }
        const raw = await env.MEMORY.get("archive_dismissed");
        const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        if (Array.isArray(dismissed[body.file])) {
          const before = dismissed[body.file].length;
          dismissed[body.file] = dismissed[body.file].filter(s => s !== body.section);
          if (!dismissed[body.file].length) delete dismissed[body.file];
          await env.MEMORY.put("archive_dismissed", JSON.stringify(dismissed));
          return json({ ok: true, removed: before - (dismissed[body.file]?.length || 0) }, 200, { ...cors, ...nocache });
        }
        return json({ ok: true, removed: 0 }, 200, { ...cors, ...nocache });
      }

      // POST /deepUndismiss — remove ONE entry from deep_dismissed.
      if (method === "POST" && path === "/deepUndismiss") {
        const body = await safeJson(request);
        if (!body || !body.file || !body.section) {
          return json({ ok: false, error: "file and section required" }, 400, { ...cors, ...nocache });
        }
        const raw = await env.MEMORY.get("deep_dismissed");
        const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        if (Array.isArray(dismissed[body.file])) {
          const before = dismissed[body.file].length;
          dismissed[body.file] = dismissed[body.file].filter(s => s !== body.section);
          if (!dismissed[body.file].length) delete dismissed[body.file];
          await env.MEMORY.put("deep_dismissed", JSON.stringify(dismissed));
          return json({ ok: true, removed: before - (dismissed[body.file]?.length || 0) }, 200, { ...cors, ...nocache });
        }
        return json({ ok: true, removed: 0 }, 200, { ...cors, ...nocache });
      }

      // POST /archivePrune — drop ghost entries from archive_dismissed (sections
      // that no longer live in the corresponding active file). Mirrors /auditPrune.
      if (method === "POST" && path === "/archivePrune") {
        const raw = await env.MEMORY.get("archive_dismissed");
        const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        let prunedCount = 0;
        for (const file of Object.keys(dismissed)) {
          if (!MEMORY_FILES.includes(file)) { delete dismissed[file]; continue; }
          const content = (await env.MEMORY.get(file)) || "";
          const existing = new Set();
          for (const sec of parseSections(content)) existing.add(sec.header);
          const before = (dismissed[file] || []).length;
          dismissed[file] = (dismissed[file] || []).filter(s => existing.has(s));
          prunedCount += before - dismissed[file].length;
          if (!dismissed[file].length) delete dismissed[file];
        }
        await env.MEMORY.put("archive_dismissed", JSON.stringify(dismissed));
        return json({ ok: true, pruned: prunedCount }, 200, { ...cors, ...nocache });
      }

      // POST /deepPrune — same as /archivePrune but for deep_dismissed against archive files.
      if (method === "POST" && path === "/deepPrune") {
        const raw = await env.MEMORY.get("deep_dismissed");
        const dismissed = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        let prunedCount = 0;
        for (const file of Object.keys(dismissed)) {
          if (!ARCHIVE_FILES.includes(file)) { delete dismissed[file]; continue; }
          const content = (await env.MEMORY.get(file)) || "";
          const existing = new Set();
          for (const sec of parseSections(content)) existing.add(sec.header);
          const before = (dismissed[file] || []).length;
          dismissed[file] = (dismissed[file] || []).filter(s => existing.has(s));
          prunedCount += before - dismissed[file].length;
          if (!dismissed[file].length) delete dismissed[file];
        }
        await env.MEMORY.put("deep_dismissed", JSON.stringify(dismissed));
        return json({ ok: true, pruned: prunedCount }, 200, { ...cors, ...nocache });
      }

      // POST /moveToArchive — move sections from working memory to archive files
      // Optimistic concurrency: per-move sectionHash (optional) protects against
      // moving a stale record edited on another device. Destination name-collision
      // check (always on) prevents creating duplicates at the destination.
      if (method === "POST" && path === "/moveToArchive") {
        const body = await safeJson(request);
        const ARCHIVE_MAP = {
          "people.md": "archive_people.md",
          "reflections.md": "archive_reflections.md",
          "fragments.md": "archive_fragments.md",
          "loops.md": "archive_loops.md",
        };
        const results = [];
        for (const move of (body.moves || [])) {
          try {
            const archiveFile = ARCHIVE_MAP[move.sourceFile];
            if (!archiveFile) { results.push({ sectionTitle: move.sectionTitle, ok: false, error: "Unknown source file" }); continue; }
            const [sourceContent, archiveContent] = await Promise.all([
              env.MEMORY.get(move.sourceFile),
              env.MEMORY.get(archiveFile),
            ]);
            if (!sourceContent) { results.push({ sectionTitle: move.sectionTitle, ok: false, error: "Source file not found" }); continue; }
            const lines = sourceContent.replace(/\r\n/g, "\n").split("\n");
            const span = findSectionSpan(lines, move.sectionTitle);
            if (!span) { results.push({ sectionTitle: move.sectionTitle, ok: false, error: "Section not found" }); continue; }
            const sectionLines = lines.slice(span.iHeader, span.iEnd);
            // Source hash check — same pattern as /replaceSection and /deleteSection
            if (move.sectionHash) {
              const currentHash = await sha256Hex(sectionLines.join("\n"));
              if (currentHash.toLowerCase() !== String(move.sectionHash).toLowerCase()) {
                results.push({ sectionTitle: move.sectionTitle, ok: false, conflict: true, error: "This record was changed in another tab. Reload before moving." });
                continue;
              }
            }
            // Destination name-collision check
            const destLines = (archiveContent || "").replace(/\r\n/g, "\n").split("\n");
            if (findSectionSpan(destLines, move.sectionTitle)) {
              results.push({ sectionTitle: move.sectionTitle, ok: false, conflict: true, error: `A section called "${move.sectionTitle}" already exists in ${archiveFile}. Rename or merge before moving.` });
              continue;
            }
            const { newSrc, newDest } = buildTierMoveFiles(lines, span, archiveContent);
            // Write destination first — if this fails, source is untouched
            await env.MEMORY.put(archiveFile, newDest);
            // Verify destination write succeeded before deleting source
            const verify = await env.MEMORY.get(archiveFile);
            if (!verify || !verify.includes(move.sectionTitle)) {
              results.push({ sectionTitle: move.sectionTitle, ok: false, error: "Destination write could not be verified" });
              continue;
            }
            await env.MEMORY.put(move.sourceFile, newSrc);
            results.push({ sectionTitle: move.sectionTitle, ok: true });
          } catch (err) {
            results.push({ sectionTitle: move.sectionTitle, ok: false, error: String(err.message || err) });
          }
        }
        // If any per-move conflict, return 409 so callers can detect via status alone
        // Surface a top-level conflict flag + message when EVERY move failed
        // with a conflict — lets the frontend's handleConflict helper trigger
        // a reload banner uniformly (it checks data.conflict at top level).
        const allConflicted = results.length > 0 && results.every(r => r.conflict);
        const allOk = results.every(r => r.ok);
        const status = allConflicted ? 409 : 200;
        const responseBody = { ok: allOk, results };
        if (allConflicted) {
          responseBody.conflict = true;
          responseBody.error = results[0].error;
        }
        return json(responseBody, status, { ...cors, ...nocache });
      }

      // POST /moveToDeep — move a section from working memory or archive to deep archive
      // Safety: write destination first, verify, then delete source.
      // Optimistic concurrency: per-move sectionHash (optional) + destination
      // name-collision check (always). Same pattern as /moveToArchive.
      if (method === "POST" && path === "/moveToDeep") {
        const body = await safeJson(request);
        const DEEP_MAP = {
          "people.md":           "deeparchive_people.md",
          "reflections.md":      "deeparchive_reflections.md",
          "fragments.md":        "deeparchive_fragments.md",
          "loops.md":            "deeparchive_loops.md",
          "archive_people.md":   "deeparchive_people.md",
          "archive_reflections.md": "deeparchive_reflections.md",
          "archive_fragments.md":   "deeparchive_fragments.md",
          "archive_loops.md":       "deeparchive_loops.md",
        };
        const results = [];
        for (const move of (body.moves || [])) {
          try {
            const deepFile = DEEP_MAP[move.sourceFile];
            if (!deepFile) { results.push({ sectionTitle: move.sectionTitle, ok: false, error: "Unknown source file" }); continue; }
            const [sourceContent, deepContent] = await Promise.all([
              env.MEMORY.get(move.sourceFile),
              env.MEMORY.get(deepFile),
            ]);
            if (!sourceContent) { results.push({ sectionTitle: move.sectionTitle, ok: false, error: "Source file not found" }); continue; }
            const lines = sourceContent.replace(/\r\n/g, "\n").split("\n");
            const span = findSectionSpan(lines, move.sectionTitle);
            if (!span) { results.push({ sectionTitle: move.sectionTitle, ok: false, error: "Section not found" }); continue; }
            const sectionLines = lines.slice(span.iHeader, span.iEnd);
            // Source hash check
            if (move.sectionHash) {
              const currentHash = await sha256Hex(sectionLines.join("\n"));
              if (currentHash.toLowerCase() !== String(move.sectionHash).toLowerCase()) {
                results.push({ sectionTitle: move.sectionTitle, ok: false, conflict: true, error: "This record was changed in another tab. Reload before moving." });
                continue;
              }
            }
            // Destination name-collision check
            const destLines = (deepContent || "").replace(/\r\n/g, "\n").split("\n");
            if (findSectionSpan(destLines, move.sectionTitle)) {
              results.push({ sectionTitle: move.sectionTitle, ok: false, conflict: true, error: `A section called "${move.sectionTitle}" already exists in ${deepFile}. Rename or merge before moving.` });
              continue;
            }
            const { newSrc, newDest } = buildTierMoveFiles(lines, span, deepContent);
            // Write destination first — if this fails, source is untouched
            await env.MEMORY.put(deepFile, newDest);
            // Verify destination write succeeded before deleting source
            const verify = await env.MEMORY.get(deepFile);
            if (!verify || !verify.includes(move.sectionTitle)) {
              results.push({ sectionTitle: move.sectionTitle, ok: false, error: "Destination write could not be verified" });
              continue;
            }
            await env.MEMORY.put(move.sourceFile, newSrc);
            results.push({ sectionTitle: move.sectionTitle, ok: true, deepFile });
          } catch (err) {
            results.push({ sectionTitle: move.sectionTitle, ok: false, error: String(err.message || err) });
          }
        }
        // Surface a top-level conflict flag + message when EVERY move failed
        // with a conflict — lets the frontend's handleConflict helper trigger
        // a reload banner uniformly (it checks data.conflict at top level).
        const allConflicted = results.length > 0 && results.every(r => r.conflict);
        const allOk = results.every(r => r.ok);
        const status = allConflicted ? 409 : 200;
        const responseBody = { ok: allOk, results };
        if (allConflicted) {
          responseBody.conflict = true;
          responseBody.error = results[0].error;
        }
        return json(responseBody, status, { ...cors, ...nocache });
      }

      // POST /restoreFromArchive — move a section from an archive file back to its live counterpart
      // Optional sectionHash protects against stale-source race. Destination
      // name-collision check (always) prevents duplicates at the live file.
      if (method === "POST" && path === "/restoreFromArchive") {
        const body = await safeJson(request);
        if (!body || !body.filename || !body.section) {
          return json({ ok: false, error: "filename and section required" }, 400, { ...cors, ...nocache });
        }
        const RESTORE_MAP = {
          "archive_people.md": "people.md",
          "archive_reflections.md": "reflections.md",
          "archive_fragments.md": "fragments.md",
          "archive_loops.md": "loops.md",
        };
        const liveFile = RESTORE_MAP[body.filename];
        if (!liveFile) return json({ ok: false, error: "Not a valid archive file" }, 400, { ...cors, ...nocache });
        const [archiveContent, liveContent] = await Promise.all([
          env.MEMORY.get(body.filename),
          env.MEMORY.get(liveFile),
        ]);
        if (!archiveContent) return json({ ok: false, error: "Archive file not found" }, 404, { ...cors, ...nocache });
        const lines = archiveContent.replace(/\r\n/g, "\n").split("\n");
        const span = findSectionSpan(lines, body.section);
        if (!span) return json({ ok: false, error: `Section not found: ${body.section}` }, 404, { ...cors, ...nocache });
        const sectionLines = lines.slice(span.iHeader, span.iEnd);
        // Source hash check
        if (body.sectionHash) {
          const currentHash = await sha256Hex(sectionLines.join("\n"));
          if (currentHash.toLowerCase() !== String(body.sectionHash).toLowerCase()) {
            return json({ ok: false, conflict: true, error: "This record was changed in another tab. Reload before restoring." }, 409, { ...cors, ...nocache });
          }
        }
        // Destination name-collision check
        const destLines = (liveContent || "").replace(/\r\n/g, "\n").split("\n");
        if (findSectionSpan(destLines, body.section)) {
          return json({ ok: false, conflict: true, error: `A section called "${body.section}" already exists in ${liveFile}. Rename or merge before restoring.` }, 409, { ...cors, ...nocache });
        }
        const { newSrc: newArchive, newDest: newLive } = buildTierMoveFiles(lines, span, liveContent);
        // Write destination first — if this fails, source is untouched
        await env.MEMORY.put(liveFile, newLive);
        const verifyRestore = await env.MEMORY.get(liveFile);
        if (!verifyRestore || !verifyRestore.includes(body.section)) {
          return json({ ok: false, error: "Destination write could not be verified" }, 500, { ...cors, ...nocache });
        }
        await env.MEMORY.put(body.filename, newArchive);
        return json({ ok: true, filename: body.filename, section: body.section, restoredTo: liveFile }, 200, { ...cors, ...nocache });
      }

      // POST /restoreFromDeep — move a section from deep archive back to live memory (or archive)
      // Same optimistic concurrency model as /restoreFromArchive.
      if (method === "POST" && path === "/restoreFromDeep") {
        const body = await safeJson(request);
        if (!body || !body.filename || !body.section) {
          return json({ ok: false, error: "filename and section required" }, 400, { ...cors, ...nocache });
        }
        const DEEP_RESTORE_MAP = {
          "deeparchive_people.md":      "people.md",
          "deeparchive_reflections.md": "reflections.md",
          "deeparchive_fragments.md":   "fragments.md",
          "deeparchive_loops.md":       "loops.md",
        };
        const DEEP_TO_ARCHIVE_MAP = {
          "deeparchive_people.md":      "archive_people.md",
          "deeparchive_reflections.md": "archive_reflections.md",
          "deeparchive_fragments.md":   "archive_fragments.md",
          "deeparchive_loops.md":       "archive_loops.md",
        };
        const liveFile = body.toArchive ? DEEP_TO_ARCHIVE_MAP[body.filename] : DEEP_RESTORE_MAP[body.filename];
        if (!liveFile) return json({ ok: false, error: "Not a valid deep archive file" }, 400, { ...cors, ...nocache });
        const [deepContent, destContent] = await Promise.all([
          env.MEMORY.get(body.filename),
          env.MEMORY.get(liveFile),
        ]);
        if (!deepContent) return json({ ok: false, error: "Deep archive file not found" }, 404, { ...cors, ...nocache });
        const lines = deepContent.replace(/\r\n/g, "\n").split("\n");
        const span = findSectionSpan(lines, body.section);
        if (!span) return json({ ok: false, error: `Section not found: ${body.section}` }, 404, { ...cors, ...nocache });
        const sectionLines = lines.slice(span.iHeader, span.iEnd);
        // Source hash check
        if (body.sectionHash) {
          const currentHash = await sha256Hex(sectionLines.join("\n"));
          if (currentHash.toLowerCase() !== String(body.sectionHash).toLowerCase()) {
            return json({ ok: false, conflict: true, error: "This record was changed in another tab. Reload before restoring." }, 409, { ...cors, ...nocache });
          }
        }
        // Destination name-collision check
        const destLines = (destContent || "").replace(/\r\n/g, "\n").split("\n");
        if (findSectionSpan(destLines, body.section)) {
          return json({ ok: false, conflict: true, error: `A section called "${body.section}" already exists in ${liveFile}. Rename or merge before restoring.` }, 409, { ...cors, ...nocache });
        }
        const { newSrc: newDeep, newDest } = buildTierMoveFiles(lines, span, destContent);
        // Write destination first — if this fails, source is untouched
        await env.MEMORY.put(liveFile, newDest);
        const verifyRestore = await env.MEMORY.get(liveFile);
        if (!verifyRestore || !verifyRestore.includes(body.section)) {
          return json({ ok: false, error: "Destination write could not be verified" }, 500, { ...cors, ...nocache });
        }
        await env.MEMORY.put(body.filename, newDeep);
        return json({ ok: true, filename: body.filename, section: body.section, restoredTo: liveFile }, 200, { ...cors, ...nocache });
      }

      // POST /analyzeCompact — two modes:
      //   surface mode (no section): scan files, return candidates with scores only — no rewrite
      //   preview mode (section + level): generate rewrite for one specific record
      if (method === "POST" && path === "/analyzeCompact") {
        const capResponse = await enforceCapOrReturn(env, cors, nocache);
        if (capResponse) return capResponse;
        const body = await safeJson(request);
        const targetFile = body && body.file ? String(body.file) : null;
        const targetSection = body && body.section ? String(body.section).trim() : null;
        const level = body && body.level ? String(body.level) : "normal";
        if (targetFile && !MEMORY_FILES.includes(targetFile)) return json({ ok: false, error: "Unknown file" }, 400, cors);
        const filesToLoad = targetFile ? [targetFile] : MEMORY_FILES;
        const files = await Promise.all(filesToLoad.map(async f => ({ name: f, content: await env.MEMORY.get(f) })));
        let validFiles = files.filter(f => f.content && f.content.trim().length > 10);
        if (!validFiles.length) return json({ ok: true, candidates: [] }, 200, { ...cors, ...nocache });

        // ── SURFACE MODE: scan all files, return scored candidates (no rewrite) ──
        if (!targetSection) {
          const fileContext = validFiles.map(f => `<file name="${f.name}">\n${f.content}\n</file>`).join("\n\n");
          const surfacePrompt = `Analyze these memory files and identify ## records that are verbose and would benefit from compaction. Return a scored list only — do NOT produce rewritten content.

RULES:
- Flag records with verbosity score 6 or higher
- verbosityScore: 1-10 (10 = extremely verbose)
- tokenSavings: rough % reduction estimate if compacted

Return ONLY this XML format, one block per candidate:
<surface-candidate file="people.md" sectionTitle="Exact ## Title" verbosityScore="8" tokenSavings="30"/>

If no candidates: <surface-candidates-empty/>

Memory files:
${fileContext}`;

          const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
          if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500, { ...cors, ...nocache });
          const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 4000, system: "You are analyzing a user's private personal memory files. Return only the XML output requested.", messages: [{ role: "user", content: surfacePrompt }] }),
          });
          if (!claudeRes.ok) { const e = await claudeRes.text(); let m = "Analysis failed"; try { m = JSON.parse(e)?.error?.message || m; } catch {} return json({ ok: false, error: m }, 502, { ...cors, ...nocache }); }
          const claudeData = await claudeRes.json();
          ctx.waitUntil(trackCost(env, new Date().toISOString().slice(0, 10), "haiku", claudeData.usage || {}));
          let candidates = [];
          try {
            const raw = claudeData.content[0].text || "";
            const rx = /<surface-candidate\s+file="([^"]+)"\s+sectionTitle="([^"]+)"\s+verbosityScore="(\d+)"\s+tokenSavings="(\d+)"\s*\/>/g;
            let m;
            while ((m = rx.exec(raw)) !== null) {
              candidates.push({ file: m[1], sectionTitle: m[2], verbosityScore: parseInt(m[3], 10), tokenSavings: parseInt(m[4], 10) });
            }
          } catch {}
          candidates.sort((a, b) => b.verbosityScore - a.verbosityScore);
          return json({ ok: true, candidates, mode: "surface" }, 200, { ...cors, ...nocache });
        }

        // ── PREVIEW MODE: generate rewrite for one specific record at a given level ──
        let found = null;
        for (const fileObj of validFiles) {
          const lines = fileObj.content.replace(/\r\n/g, "\n").split("\n");
          const span = findSectionSpan(lines, targetSection);
          if (span) { found = { name: fileObj.name, content: lines.slice(span.iHeader, span.iEnd).join("\n") }; break; }
        }
        if (!found) return json({ ok: false, error: `Section not found: ${targetSection}` }, 404, { ...cors, ...nocache });
        const isJournalSection = found.name === "reflections.md";

        // Extract subsection headers for mandatory checklist
        const sectionLines = found.content.replace(/\r\n/g, "\n").split("\n");
        const h3headers = sectionLines.filter(l => /^###\s+/.test(l)).map(l => l.trim());
        const subsectionChecklist = h3headers.length > 0
          ? `\nMANDATORY SUBSECTIONS — your output MUST include ALL ${h3headers.length} of these ### headers in the same order:\n${h3headers.map((h, i) => `${i + 1}. ${h}`).join("\n")}\nCount your output's ### headers before responding. If any are missing, add them back.`
          : "";

        const levelInstructions = {
          normal: `COMPACTION LEVEL: NORMAL — Prose tightening only. Zero structural changes.
- Shorten verbose prose; remove filler words and restated context
- Do NOT merge subsections, collapse timeline entries, or drop any bullet lines
- Do NOT drop any facts, dates, names, or details — zero data loss
- Target: 15-25% reduction`,
          medium: `COMPACTION LEVEL: MEDIUM — Moderate restructuring.
- Tighten prose AND consolidate redundant content
- For accumulated dated entries: keep the 4 most recent verbatim, collapse older entries into ### Prior History (one bullet per key outcome)
- Drop routine filler and status that has since changed
- Preserve all significant facts, decisions, names, and dates
- Target: 30-50% reduction`,
          high: `COMPACTION LEVEL: HIGH — Aggressive compression. ⚠ REVIEW EVERY LINE BEFORE SAVING.
- Strip to essential facts only — one bullet per major event or decision
- Collapse all history into a single ### Prior History block
- Cut prose entirely where bullets suffice
- Keep names, key dates, roles, and relationship context — nothing else
- Target: 60-75% reduction`,
        };

        const previewPrompt = `Produce a compact rewrite of this memory record. Output ONLY content from the input — never add, invent, or import content from other records.

${levelInstructions[level] || levelInstructions.normal}
${subsectionChecklist}
${isJournalSection ? "\nJOURNAL ENTRY: This is a personal journal entry. Preserve the authentic voice, emotional tone, and personal details — tighten wordiness and remove filler but do NOT flatten the writing into dry bullet points." : ""}
RULES:
- First line MUST be the exact ## header: ## ${targetSection}
- Keep the – metadata field format (– Field: Value)
- Do NOT compact or alter checkbox task lines (– [ ] or – [x] bullets) — they are state data, not prose
- Never drop or alter "– Photo:" lines — they link sections to stored images.
- Every fact, date, name, and relationship in the input must appear in the output

Return ONLY this XML format — raw text inside the tag, no escaping:

<compact-candidate file="${found.name}" sectionTitle="${targetSection}" verbosityScore="8" tokenSavings="30" level="${level}">
## ${targetSection}
[compacted content here]
</compact-candidate>

If no compaction possible: <compact-candidates-empty/>

verbosityScore: 1-10 | tokenSavings: rough % estimate

Input record:
${found.content}`;

        const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
        if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500, { ...cors, ...nocache });
        const claudeRes2 = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, system: "You are analyzing a user's private personal memory files. Return only the XML output requested. Do not reproduce or import content from other records.", messages: [{ role: "user", content: previewPrompt }] }),
        });
        if (!claudeRes2.ok) { const e = await claudeRes2.text(); let m = "Preview generation failed"; try { m = JSON.parse(e)?.error?.message || m; } catch {} return json({ ok: false, error: m }, 502, { ...cors, ...nocache }); }
        const claudeData2 = await claudeRes2.json();
        ctx.waitUntil(trackCost(env, new Date().toISOString().slice(0, 10), "haiku", claudeData2.usage || {}));
        let candidates = [];
        try {
          const raw = claudeData2.content[0].text || "";
          const rx = /<compact-candidate\s+file="([^"]+)"\s+sectionTitle="([^"]+)"\s+verbosityScore="(\d+)"\s+tokenSavings="(\d+)"\s+level="([^"]*)">([\s\S]*?)<\/compact-candidate>/g;
          let m;
          while ((m = rx.exec(raw)) !== null) {
            candidates.push({ file: found.name, sectionTitle: targetSection, verbosityScore: parseInt(m[3], 10), tokenSavings: parseInt(m[4], 10), level: m[5], compactedText: m[6].replace(/^\n/, "").replace(/\n$/, "") });
          }
        } catch {}
        return json({ ok: true, candidates, mode: "preview" }, 200, { ...cors, ...nocache });
      }

      // POST /compactSection — replace a section with a compacted version
      if (method === "POST" && path === "/compactSection") {
        const body = await safeJson(request);
        if (!body || !body.filename || !body.sectionTitle || typeof body.compactedText !== "string") {
          return json({ ok: false, error: "filename, sectionTitle, and compactedText required" }, 400, { ...cors, ...nocache });
        }
        if (!MEMORY_FILES.includes(body.filename)) {
          return json({ ok: false, error: "Cannot compact archive or system files" }, 400, { ...cors, ...nocache });
        }
        const content = await env.MEMORY.get(body.filename);
        if (!content) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });
        // Staleness check — SHA-256 hash of section at analyze time must match
        // current content. Uses the same sha256Hex helper as the frontend's
        // _sha256Hex so both sides share one primitive (was previously a custom
        // 32-bit djb2 duplicated client + server, silent-failure-prone).
        const sectionHash = String(body.sectionHash || "").trim();
        if (sectionHash) {
          const lines = content.replace(/\r\n/g, "\n").split("\n");
          const span = findSectionSpan(lines, body.sectionTitle);
          const currentSection = span ? lines.slice(span.iHeader, span.iEnd).join("\n") : "";
          const currentHash = await sha256Hex(currentSection);
          if (currentHash.toLowerCase() !== sectionHash.toLowerCase()) {
            return json({ ok: false, conflict: true, error: "Record changed since review — please re-run compact to get fresh content." }, 409, { ...cors, ...nocache });
          }
        }
        const lines = content.replace(/\r\n/g, "\n").split("\n");
        const span = findSectionSpan(lines, body.sectionTitle);
        if (!span) return json({ ok: false, error: `Section not found: ${body.sectionTitle}` }, 404, { ...cors, ...nocache });
        const compactLines = body.compactedText.replace(/\r\n/g, "\n").trim().split("\n");
        const newContent = buildFileWithSectionReplaced(lines, span, compactLines);
        const before = content.length;
        const after = newContent.length;
        await env.MEMORY.put(body.filename, newContent);
        return json({ ok: true, before, after, saved: before - after }, 200, { ...cors, ...nocache });
      }

      // POST /replaceSection — replace a section with edited content (no size validation)
      if (method === "POST" && path === "/replaceSection") {
        const body = await safeJson(request);
        if (!body || !body.filename || !body.sectionTitle || typeof body.compactedText !== "string") {
          return json({ ok: false, error: "filename, sectionTitle, and compactedText required" }, 400, { ...cors, ...nocache });
        }
        if (!MEMORY_FILES.includes(body.filename) && !ARCHIVE_FILES.includes(body.filename) && !DEEPARCHIVE_FILES.includes(body.filename)) {
          return json({ ok: false, error: "Unknown file" }, 400, { ...cors, ...nocache });
        }
        const content = await env.MEMORY.get(body.filename);
        if (!content) return json({ ok: false, error: "File not found" }, 404, { ...cors, ...nocache });
        const lines = content.replace(/\r\n/g, "\n").split("\n");
        const span = findSectionSpan(lines, body.sectionTitle, typeof body.occurrenceIndex === "number" ? body.occurrenceIndex : undefined);
        if (!span) return json({ ok: false, error: `Section not found: ${body.sectionTitle}` }, 404, { ...cors, ...nocache });

        // Optimistic concurrency — section-level. If the caller passed a
        // sectionHash, refuse the write when the section's current text
        // differs from what they read. Section-level (vs file-level) so
        // unrelated section edits in the same file don't trip false-
        // positive conflicts. Same pattern as /compactSection.
        const sectionHash = String(body.sectionHash || "").trim();
        if (sectionHash) {
          const currentSection = lines.slice(span.iHeader, span.iEnd).join("\n");
          const currentHash = await sha256Hex(currentSection);
          if (currentHash.toLowerCase() !== sectionHash.toLowerCase()) {
            return json({ ok: false, conflict: true, error: "This record was changed in another tab. Reload to see the latest version." }, 409, { ...cors, ...nocache });
          }
        }

        // Detect rename + collision: if the new content's first header differs from the
        // section being replaced AND that new name already exists elsewhere in the file,
        // refuse to save (would create a duplicate-header that breaks future lookups).
        const compactLines = body.compactedText.replace(/\r\n/g, "\n").trim().split("\n");
        const newHeaderMatch = (compactLines[0] || "").match(/^\s*##\s*(?:👤\s*)?(.+?)\s*$/);
        if (newHeaderMatch) {
          const newName = newHeaderMatch[1].trim();
          if (normKey(newName) !== normKey(body.sectionTitle)) {
            // Build the file as it would look without the section we're replacing
            const linesWithoutOld = [...lines.slice(0, span.iHeader), ...lines.slice(span.iEnd)];
            const conflict = findSectionSpan(linesWithoutOld, newName);
            if (conflict) {
              return json({
                ok: false,
                error: `A record named "${newName}" already exists. Delete the existing one with /delete ${newName} first, or pick a different name.`,
              }, 409, { ...cors, ...nocache });
            }
          }
        }

        const newContent = buildFileWithSectionReplaced(lines, span, compactLines);
        await env.MEMORY.put(body.filename, newContent);
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // POST /resetMemory — wipe all 12 memory files to blank templates; optionally set new name
      if (method === "POST" && path === "/resetMemory") {
        const headerKey = request.headers.get("X-Worker-Key");
        const keyOk = headerKey && env.WORKER_KEY && headerKey === env.WORKER_KEY;
        if (!keyOk) return json({ ok: false, error: "Access key incorrect." }, 401, { ...cors, ...nocache });
        const body = await safeJson(request);
        const RESET_TEMPLATES = {
          "people.md":              "# people.md\nStructured records about people. Each entry uses ## Full Name with subsections (Summary, Timeline, etc.).\n\n---\n\n",
          "reflections.md":         "# reflections.md\nDated journal entries and personal reflections. Format: ## YYYY-MM-DD – Title, then prose body.\n\n---\n\n",
          "fragments.md":           "# fragments.md\nStandalone facts, URLs, reference notes, and how-to procedures. Format: ## YYYY-MM-DD – Title, then – Tags: tag1, tag2.\n\n---\n\n",
          "loops.md":               "# loops.md\nOpen tasks and follow-ups. Format: ## YYYY-MM-DD – Title, then – Status: Open, – Created: YYYY-MM-DD.\n\n---\n\n",
          "archive_people.md":          "# archive_people.md\nArchive tier — entries moved here from working memory.\n\n---\n\n",
          "archive_reflections.md":     "# archive_reflections.md\nArchive tier — entries moved here from working memory.\n\n---\n\n",
          "archive_fragments.md":       "# archive_fragments.md\nArchive tier — entries moved here from working memory.\n\n---\n\n",
          "archive_loops.md":           "# archive_loops.md\nArchive tier — closed loops moved here from working memory.\n\n---\n\n",
          "deeparchive_people.md":      "# deeparchive_people.md\nDeep archive — permanent long-term storage.\n\n---\n\n",
          "deeparchive_reflections.md": "# deeparchive_reflections.md\nDeep archive — permanent long-term storage.\n\n---\n\n",
          "deeparchive_fragments.md":   "# deeparchive_fragments.md\nDeep archive — permanent long-term storage.\n\n---\n\n",
          "deeparchive_loops.md":       "# deeparchive_loops.md\nDeep archive — permanent long-term storage.\n\n---\n\n",
        };
        await Promise.all(Object.entries(RESET_TEMPLATES).map(([f, c]) => env.MEMORY.put(f, c)));
        if (body && body.newName && body.newName.trim()) {
          await env.MEMORY.put("config_user_name", body.newName.trim());
        }
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // POST /transcribe — send audio blob to OpenAI Whisper, return transcript text
      if (method === "POST" && path === "/transcribe") {
        const openaiKey = await resolveApiKey(env, "OPENAI_API_KEY");
        if (!openaiKey) return json({ ok: false, error: "OpenAI API key not configured." }, 400, { ...cors, ...nocache });
        const audioBuffer = await request.arrayBuffer();
        if (!audioBuffer || audioBuffer.byteLength === 0)
          return json({ ok: false, error: "No audio received." }, 400, { ...cors, ...nocache });
        const contentType = request.headers.get("Content-Type") || "audio/webm";
        const ext = contentType.includes("mp4") || contentType.includes("m4a") ? "m4a"
                  : contentType.includes("ogg") ? "ogg"
                  : contentType.includes("wav") ? "wav" : "webm";
        const form = new FormData();
        form.append("file", new Blob([audioBuffer], { type: contentType }), `audio.${ext}`);
        form.append("model", "whisper-1");
        // Use the caller-supplied language (X-Whisper-Language header) so non-English
        // users get accurate transcription. Defaults to "en" which avoids the
        // well-known Whisper-1 silence hallucination ("MBC 뉴스 김재경입니다" etc.).
        const whisperLang = request.headers.get("X-Whisper-Language") || "en";
        form.append("language", whisperLang);
        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${openaiKey}` },
          body: form,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          return json({ ok: false, error: `Whisper error ${res.status}: ${errText.slice(0, 120)}` }, 502, { ...cors, ...nocache });
        }
        const data = await res.json().catch(() => ({}));
        // Filter known Whisper-1 hallucinations from silent or near-silent audio.
        // These phrases are produced when the model has no real speech to
        // transcribe but decides to "fill in" anyway. Returning empty text lets
        // the frontend's existing `if (!text)` branch bail cleanly with no chunk
        // created. Patterns are anchored to start-of-string so they don't match
        // legitimate speech that happens to mention them.
        const HALLUCINATIONS = [
          /^MBC.{0,4}뉴스/i,
          /^thanks?\s+for\s+watching/i,
          /^subtitles?\s+by\s/i,
          /^captions?\s+by\s/i,
          /^♪[\s♪]*$/,
          /^\[music\]$/i,
          /^you[.\s]*$/i,
        ];
        const transcript = (data.text || "").trim();
        const isHallucination = HALLUCINATIONS.some(re => re.test(transcript));
        return json({ ok: true, text: isHallucination ? "" : transcript }, 200, { ...cors, ...nocache });
      }

      // POST /putMemoryFile — replace entire file
      if (method === "POST" && path === "/putMemoryFile") {
        const body = await safeJson(request);
        if (!body || !body.filename || typeof body.content !== "string") {
          return json({ ok: false, error: "filename and content required" }, 400, { ...cors, ...nocache });
        }
        if (!BACKUP_FILES.includes(body.filename)) {
          return json({ ok: false, error: "Unknown file" }, 400, { ...cors, ...nocache });
        }
        // Content sanity check — refuse to overwrite a memory file with an
        // empty or trivially short blob. Real memory files always have at
        // least a top-level "# filename" header. Pristine post-install
        // templates lack ## sections (just the file header + description),
        // so we don't require ## here — only the file header AND a minimum
        // length that catches accidental wipe-by-empty-string AND
        // wipe-by-corrupted-import. The /reset endpoint is the correct
        // path for wiping; /putMemoryFile is for restore from a real backup.
        const trimmed = body.content.trim();
        if (trimmed.length < 30 || !/^#\s/m.test(trimmed)) {
          return json({ ok: false, error: "Refusing to write: content is empty or missing the required '# filename' header. Use /reset to wipe a file to its template." }, 400, { ...cors, ...nocache });
        }
        await env.MEMORY.put(body.filename, body.content);
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // GET /costs — return cost summary for today and last 7 days
      if (method === "GET" && path === "/costs") {
        const raw = await env.MEMORY.get("cost_log");
        const log = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
        const today = new URL(request.url).searchParams.get("date") || new Date().toISOString().split("T")[0];
        const days = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(today + "T12:00:00Z");
          d.setUTCDate(d.getUTCDate() - i);
          return d.toISOString().split("T")[0];
        });
        const dayCost = entry => {
          if (!entry) return 0;
          let total = 0;
          for (const [mk, r] of Object.entries(RATES)) {
            const m = entry[mk] || {};
            total += ((m.input || 0) * r.input + (m.output || 0) * r.output +
              (m.cacheWrite || 0) * r.cacheWrite + (m.cacheRead || 0) * r.cacheRead) / 1_000_000;
          }
          return total;
        };
        const todayEntry = log[today];
        let weekRequests = 0, weekCost = 0;
        const weekLog = days.map(d => {
          const entry = log[d];
          const cost = dayCost(entry);
          const requests = entry ? entry.requests : 0;
          weekRequests += requests;
          weekCost += cost;
          return requests > 0 ? { date: d, requests, cost: parseFloat(cost.toFixed(4)) } : null;
        }).filter(Boolean);
        return json({
          ok: true,
          today: { date: today, requests: todayEntry ? todayEntry.requests : 0, cost: parseFloat(dayCost(todayEntry).toFixed(4)) },
          week: { requests: weekRequests, cost: parseFloat(weekCost.toFixed(4)) },
          log: weekLog,
        }, 200, { ...cors, ...nocache });
      }

      // GET /dailyCostCap — return the current daily Anthropic spend cap in
      // dollars (0 = disabled). Frontend uses this to populate the Settings
      // dropdown when the panel opens. `isDefault` is true when no value has
      // ever been written; the frontend uses this to pick the $1 default
      // option AND save it so enforcement (which defaults to 0/disabled in
      // checkDailyCap) aligns with what the UI displays.
      if (method === "GET" && path === "/dailyCostCap") {
        const raw = await env.MEMORY.get("daily_cost_cap");
        const isDefault = raw === null;
        const cap = raw ? parseFloat(raw) : 0;
        return json({ ok: true, cap: Number.isFinite(cap) ? cap : 0, isDefault }, 200, { ...cors, ...nocache });
      }

      // POST /dailyCostCap — set the daily Anthropic spend cap in dollars.
      // Body: { cap: <number> }. cap=0 disables enforcement. Accepted
      // values are validated as non-negative finite numbers; anything else
      // is rejected so a malformed save can't silently disable the cap.
      if (method === "POST" && path === "/dailyCostCap") {
        const body = await safeJson(request);
        const cap = parseFloat(body?.cap);
        if (!Number.isFinite(cap) || cap < 0) {
          return json({ ok: false, error: "cap must be a non-negative number" }, 400, { ...cors, ...nocache });
        }
        await env.MEMORY.put("daily_cost_cap", String(cap));
        return json({ ok: true, cap }, 200, { ...cors, ...nocache });
      }

      // GET /loginLog — recent login events for security awareness (session required)
      if (method === "GET" && path === "/loginLog") {
        const raw = await env.MEMORY.get("login_log");
        const logins = (() => { try { return raw ? JSON.parse(raw) : []; } catch { return []; } })();
        return json({ ok: true, logins }, 200, { ...cors, ...nocache });
      }

      // GET /version — lightweight version check for debugging
      if (method === "GET" && path === "/version") {
        return json({ version: WORKER_VERSION, ok: true }, 200, { ...cors, ...nocache });
      }

      // POST /uploadPhoto — upload a photo for a person record to R2.
      // Body: { filename, imageBase64, mimeType }
      // filename must match PHOTO_FILENAME_PATTERN (bare name, no photos/ prefix).
      // The worker stores it under photos/<filename> in env.DOWNLOADS.
      if (method === "POST" && path === "/uploadPhoto") {
        const r2block = requireR2(env, cors, nocache);
        if (r2block) return r2block;
        const body = await safeJson(request);
        let { filename, imageBase64, mimeType } = body || {};
        // Normalize unicode: NFD decompose then strip combining diacritical marks so
        // accented names (e.g. "maría-lópez") become valid ASCII slugs.
        if (typeof filename === "string") {
          filename = filename.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        }
        if (!filename || !PHOTO_FILENAME_PATTERN.test(filename))
          return json({ ok: false, error: "invalid_filename" }, 400, { ...cors, ...nocache });
        const VALID_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
        if (!mimeType || !VALID_MIMES.has(mimeType))
          return json({ ok: false, error: "invalid_mime_type" }, 400, { ...cors, ...nocache });
        if (!imageBase64 || typeof imageBase64 !== "string")
          return json({ ok: false, error: "missing_image_data" }, 400, { ...cors, ...nocache });
        // ~15 MB binary limit (base64 is ~4/3× the binary size)
        if (imageBase64.length > 20_000_000) {
          return json({ ok: false, error: "image_too_large" }, 400, { ...cors, ...nocache });
        }
        // Auto-increment: find highest existing n for this person-slug and use n+1.
        // Skipped when body.skipIncrement is true (import restore — exact filename required).
        if (!body.skipIncrement) {
          const fnMatch = filename.match(/^((person|reflection|fragment|loop)-[a-z0-9-]+)-(\d+)\.([a-z]+)$/);
          if (fnMatch) {
            const [, slugPart, , , ext] = fnMatch;
            // List ALL photos for this slug regardless of extension
            const existing = await env.DOWNLOADS.list({ prefix: "photos/" + slugPart + "-" });
            let maxN = 0;
            for (const obj of (existing.objects || [])) {
              // Match any extension
              const m = obj.key.match(new RegExp("^photos/" + slugPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)\\.[a-z]+$"));
              if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
            }
            filename = `${slugPart}-${maxN + 1}.${ext}`;
          }
        }
        let binary;
        try { binary = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0)); }
        catch { return json({ ok: false, error: "invalid_base64" }, 400, { ...cors, ...nocache }); }
        await env.DOWNLOADS.put("photos/" + filename, binary, { httpMetadata: { contentType: mimeType } });
        return json({ ok: true, filename }, 200, { ...cors, ...nocache });
      }

      // GET /photo/:filename — proxy a stored photo from R2 to the authenticated client.
      // filename must match PHOTO_FILENAME_PATTERN (bare name, no photos/ prefix).
      if (method === "GET" && path.startsWith("/photo/")) {
        const filename = path.slice("/photo/".length);
        if (!PHOTO_FILENAME_PATTERN.test(filename))
          return json({ ok: false, error: "invalid_filename" }, 400, { ...cors });
        const r2block = requireR2(env, cors, nocache);
        if (r2block) return r2block;
        const obj = await env.DOWNLOADS.get("photos/" + filename);
        if (!obj) return json({ ok: false, error: "not_found" }, 404, { ...cors, ...nocache });
        return new Response(obj.body, {
          headers: {
            ...cors,
            "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
            "Cache-Control": "no-store",
          },
        });
      }

      // POST /deletePhoto — delete a photo from R2.
      // Body: { filename } — bare name, no photos/ prefix. Deleting a non-existent
      // file is a no-op (R2 delete is idempotent).
      if (method === "POST" && path === "/deletePhoto") {
        const r2block = requireR2(env, cors, nocache);
        if (r2block) return r2block;
        const body = await safeJson(request);
        const { filename } = body || {};
        if (!filename || !PHOTO_FILENAME_PATTERN.test(filename))
          return json({ ok: false, error: "invalid_filename" }, 400, { ...cors, ...nocache });
        await env.DOWNLOADS.delete("photos/" + filename);
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // GET /diagnostics — system health: memory sizes, cost log, error log, API keys
      if (method === "GET" && path === "/diagnostics") {
        const TOKEN_CAP = 180000;
        const [files, archiveFiles, deepArchiveFiles, costRaw, errRaw] = await Promise.all([
          Promise.all(MEMORY_FILES.map(async f => {
            const content = await env.MEMORY.get(f);
            const bytes = content ? content.length : 0;
            return { file: f, bytes, tokens: Math.round(bytes / 4) };
          })),
          Promise.all(ARCHIVE_FILES.map(async f => {
            const content = await env.MEMORY.get(f);
            const bytes = content ? content.length : 0;
            return { file: f, bytes, tokens: Math.round(bytes / 4) };
          })),
          Promise.all(DEEPARCHIVE_FILES.map(async f => {
            const content = await env.MEMORY.get(f);
            const bytes = content ? content.length : 0;
            return { file: f, bytes, tokens: Math.round(bytes / 4) };
          })),
          env.MEMORY.get("cost_log"),
          env.MEMORY.get("_error_log"),
        ]);
        const totalTokens = files.reduce((s, f) => s + f.tokens, 0);
        const archiveTokens = archiveFiles.reduce((s, f) => s + f.tokens, 0);
        const deepTokens = deepArchiveFiles.reduce((s, f) => s + f.tokens, 0);
        const costLog = (() => { try { return costRaw ? JSON.parse(costRaw) : {}; } catch { return {}; } })();
        const errors = (() => { try { return errRaw ? JSON.parse(errRaw) : []; } catch { return []; } })();
        const costDays = Object.keys(costLog).sort();
        return json({
          ok: true,
          memory: files.map(f => ({ ...f, pct: Math.round(f.tokens / TOKEN_CAP * 100) })),
          tokenBudget: { used: totalTokens, cap: TOKEN_CAP, pct: Math.round(totalTokens / TOKEN_CAP * 100) },
          archive: archiveFiles.map(f => ({ ...f, pct: Math.round(f.tokens / TOKEN_CAP * 100) })),
          archiveBudget: { tokens: archiveTokens, combinedPct: Math.round((totalTokens + archiveTokens) / TOKEN_CAP * 100) },
          deepArchive: deepArchiveFiles.map(f => ({ ...f, pct: Math.round(f.tokens / TOKEN_CAP * 100) })),
          deepArchiveBudget: { tokens: deepTokens },
          costLog: { entries: costDays.length, lastEntry: costDays[costDays.length - 1] || null, trackingErrors: errors.filter(e => e.fn === "trackCost").length },
          recentErrors: errors.slice(0, 5),
          keys: await (async () => {
            const keyNames = ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY"];
            const results = {};
            for (const name of keyNames) {
              const kvVal = await env.MEMORY.get("config_" + name.toLowerCase());
              const short = name.replace("_API_KEY", "").toLowerCase();
              if (kvVal && kvVal.trim()) results[short] = { configured: true, source: "app" };
              else if (env[name]) results[short] = { configured: true, source: "install" };
              else results[short] = { configured: false, source: "missing" };
            }
            return results;
          })(),
        }, 200, { ...cors, ...nocache });
      }

      // POST /polishText — clean up raw voice text with Claude Haiku (no memory loading)
      if (method === "POST" && path === "/polishText") {
        const capResponse = await enforceCapOrReturn(env, cors, nocache);
        if (capResponse) return capResponse;
        const body = await safeJson(request);
        if (!body || !body.text) {
          return json({ ok: false, error: "text required" }, 400, { ...cors, ...nocache });
        }
        const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
        if (!anthropicKey) {
          return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500, { ...cors, ...nocache });
        }
        // Ask Haiku for BOTH a 4-7 word summary (for the section header) and the
        // polished body. JSON output lets the frontend split them cleanly without
        // brittle string parsing.
        const prompt = `You are helping someone save a personal journal entry. They spoke or typed this — clean up spelling, grammar, and flow so it reads naturally. Then write a 4-7 word summary suitable for a section header (no quotes, no trailing punctuation, capitalized like a title).\n\nReturn ONLY a JSON object with this exact shape — no markdown fences, no commentary, no other text:\n{"summary": "Short title here", "body": "Polished entry text here."}\n\nRaw entry:\n${body.text}`;
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1200, messages: [{ role: "user", content: prompt }] }),
        });
        if (!claudeRes.ok) {
          const err = await claudeRes.text();
          return json({ ok: false, error: `Claude error: ${err}` }, 500, { ...cors, ...nocache });
        }
        const claudeData = await claudeRes.json();
        ctx.waitUntil(trackCost(env, new Date().toISOString().slice(0, 10), "haiku", claudeData.usage || {}));
        const raw = claudeData.content?.[0]?.text?.trim() || "";
        // Defensive parse: strip markdown fences Haiku occasionally adds, then
        // try JSON.parse. If parsing fails, fall back to using the raw text as
        // the body and the first sentence (≤ 60 chars) as the summary — so the
        // /journal flow still succeeds even when the model drifts.
        let summary = "", outBody = "";
        try {
          const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed.summary === "string" && typeof parsed.body === "string") {
            summary = parsed.summary.trim();
            outBody = parsed.body.trim();
          }
        } catch { /* fall through to fallback below */ }
        if (!outBody) {
          outBody = raw || body.text;
          const firstSentence = outBody.split(/[.!?\n]/, 1)[0].trim();
          summary = firstSentence.length > 60 ? firstSentence.slice(0, 57).trimEnd() + "…" : firstSentence;
        }
        return json({ ok: true, summary, body: outBody, text: outBody }, 200, { ...cors, ...nocache });
      }

      // POST /recall — semantic search over deep archive via Haiku (or Vectorize if bound)
      // If no query, returns all headings grouped by file for browsing
      if (method === "POST" && path === "/recall") {
        const body = await safeJson(request);

        // No-query path returns headings only (no Claude call) — no cap check needed.
        // With-query path does call Haiku, but we let it through the cap check below.

        // No-query: return all headings grouped by file
        if (!body || !body.query) {
          const deepFiles = await Promise.all(
            DEEPARCHIVE_FILES.map(async f => ({ name: f, content: await env.MEMORY.get(f) || "" }))
          );
          const groups = deepFiles.map(({ name, content }) => ({
            file: name,
            sections: parseH2Sections(content).map(s => s.name),
          })).filter(g => g.sections.length > 0);
          return json({ ok: true, browse: true, groups }, 200, { ...cors, ...nocache });
        }
        const maxResults = Math.min(body.maxResults || 5, 10);
        const today = new Date().toISOString().slice(0, 10);

        // TODO: Vectorize path — if (env.VECTORIZE) { ... }

        // Haiku fallback: load all deep archive headings, ask Haiku which match
        const deepFiles = await Promise.all(
          DEEPARCHIVE_FILES.map(async f => ({ name: f, content: await env.MEMORY.get(f) || "" }))
        );
        const headingLines = [];
        const headingIndex = []; // { file, section }
        for (const { name, content } of deepFiles) {
          const sections = parseH2Sections(content);
          for (const s of sections) {
            headingLines.push(`${name}: ${s.name}`);
            headingIndex.push({ file: name, section: s.name });
          }
        }
        if (headingIndex.length === 0) {
          return json({ ok: true, results: [], source: "haiku" }, 200, { ...cors, ...nocache });
        }
        const matchPrompt = `You are a search assistant. A user is searching their personal memory vault.

Query: "${body.query}"

Vault headings (format: filename: section title):
${headingLines.join("\n")}

Return a JSON array of the top ${maxResults} most relevant matches. Each item: {"file":"filename","section":"section title"}. If nothing is relevant return []. Return ONLY valid JSON, no explanation.`;

        const capResponse = await enforceCapOrReturn(env, cors, nocache);
        if (capResponse) return capResponse;
        const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
        if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500, { ...cors, ...nocache });
        const haikuRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: matchPrompt }] }),
        });
        if (!haikuRes.ok) { const e = await haikuRes.text(); let m = "Recall search failed"; try { m = JSON.parse(e)?.error?.message || m; } catch {} return json({ ok: false, error: m }, 502, { ...cors, ...nocache }); }
        const haikuData = await haikuRes.json();
        ctx.waitUntil(trackCost(env, today, "haiku", haikuData.usage || {}));

        let matches = [];
        try {
          const raw = haikuData.content?.[0]?.text?.trim() || "[]";
          const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
          matches = JSON.parse(jsonStr);
          if (!Array.isArray(matches)) matches = [];
        } catch { matches = []; }

        // Fetch full content for each match
        const results = [];
        for (const m of matches.slice(0, maxResults)) {
          const fileContent = deepFiles.find(f => f.name === m.file)?.content || "";
          const lines = fileContent.replace(/\r\n/g, "\n").split("\n");
          const span = findSectionSpan(lines, m.section);
          if (!span) continue;
          const sectionLines = lines.slice(span.iHeader, span.iEnd);
          const preview = sectionLines.filter(l => l.trim() && !/^\s*##/.test(l)).slice(0, 3).join(" · ").slice(0, 120);
          results.push({ file: m.file, section: m.section, preview, content: sectionLines.join("\n") });
        }
        return json({ ok: true, results, source: "haiku" }, 200, { ...cors, ...nocache });
      }

      // POST /attributeSources — identify which memory sections a chat reply drew from
      if (method === "POST" && path === "/attributeSources") {
        const capBlock = await enforceCapOrReturn(env, cors, nocache);
        if (capBlock) return capBlock;
        const body = await safeJson(request);
        if (!body || !body.replyText) return json({ ok: false, error: "replyText required" }, 400, { ...cors, ...nocache });

        const today = new Date().toISOString().slice(0, 10);
        const includeArchive = body.includeArchive === true;

        // Load live memory headings (+ archive if requested)
        const filesToLoad = includeArchive ? [...MEMORY_FILES, ...ARCHIVE_FILES] : MEMORY_FILES;
        const fileContents = await Promise.all(filesToLoad.map(async f => ({ name: f, content: await env.MEMORY.get(f) || "" })));

        const headingLines = [];
        const headingIndex = [];
        for (const { name, content } of fileContents) {
          for (const s of parseH2Sections(content)) {
            headingLines.push(`${name}: ${s.name}`);
            headingIndex.push({ file: name, section: s.name });
          }
        }
        if (headingIndex.length === 0) return json({ ok: true, sources: [] }, 200, { ...cors, ...nocache });

        const replySnippet = body.replyText.slice(0, 2000);
        const querySnippet = (body.queryText || "").slice(0, 300);
        const matchPrompt = `You are identifying which personal memory records were the SOURCE of an AI assistant's reply — meaning the records that actually CONTAINED the facts used to answer the question.

${querySnippet ? `Question asked:\n"""\n${querySnippet}\n"""\n\n` : ""}Reply given:
"""
${replySnippet}
"""

Memory section headings (format: filename: section title):
${headingLines.join("\n")}

Important: Return the sections that CONTAINED THE FACTS that answered the question — not every section whose name appears in the reply. For example, if the question asks about someone's family members, the primary source is likely that person's own record, not the individual records of each family member mentioned. A record that is only referenced by name in the reply, and contributed no fact of its own, should be left out.

In the other direction: the same fact is sometimes written into more than one record, and then more than one record is a genuine source. A grandchild's birth date, for instance, is commonly recorded in both the grandparent's record and the parent's record, so a reply that gives both the birth date and the grandparent relationship plausibly came from both. Return the extra record when the reply contains a distinct fact that record would separately hold — not merely because the same person is named in it. Most replies have one source record; prefer one over several unless a second record clearly holds part of the answer.

Return a JSON array ordered by relevance (most directly used first), max 6 items. If nothing matches return []. Each item: {"file":"filename","section":"section title"}. Return ONLY valid JSON, no explanation.`;

        const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
        if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500, { ...cors, ...nocache });
        const haikuRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, system: "You are analyzing a user's private personal memory files. Return only the JSON output requested.", messages: [{ role: "user", content: matchPrompt }] }),
        });
        if (!haikuRes.ok) { const e = await haikuRes.text(); let m = "Attribution failed"; try { m = JSON.parse(e)?.error?.message || m; } catch {} return json({ ok: false, error: m }, 502, { ...cors, ...nocache }); }
        const haikuData = await haikuRes.json();
        ctx.waitUntil(trackCost(env, today, "haiku", haikuData.usage || {}));

        let sources = [];
        try {
          const raw = haikuData.content?.[0]?.text?.trim() || "[]";
          const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
          sources = JSON.parse(jsonStr);
          if (!Array.isArray(sources)) sources = [];
        } catch { sources = []; }

        // Fetch preview snippets for each matched source
        const results = [];
        for (const m of sources.slice(0, 8)) {
          const fc = fileContents.find(f => f.name === m.file);
          if (!fc) continue;
          const lines = fc.content.replace(/\r\n/g, "\n").split("\n");
          const span = findSectionSpan(lines, m.section);
          if (!span) continue;
          const sectionLines = lines.slice(span.iHeader, span.iEnd);
          const preview = sectionLines.filter(l => l.trim() && !/^\s*##/.test(l)).slice(0, 3).join(" · ").slice(0, 120);
          results.push({ file: m.file, section: m.section, preview });
        }
        return json({ ok: true, sources: results }, 200, { ...cors, ...nocache });
      }

      // POST /chat — load all files, call Claude, return response
      if (method === "POST" && path === "/chat") {
        const capResponse = await enforceCapOrReturn(env, cors, nocache);
        if (capResponse) return capResponse;
        const body = await safeJson(request);
        if (!body || !Array.isArray(body.messages)) {
          return json({ ok: false, error: "messages array required" }, 400, { ...cors, ...nocache });
        }
        const brief = body.brief === true;
        const archive = body.archive === true;
        const anthropicKey = await resolveApiKey(env, "ANTHROPIC_API_KEY");
        if (!anthropicKey) {
          return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, 500, { ...cors, ...nocache });
        }

        // Load all memory files
        const files = await Promise.all(
          MEMORY_FILES.map(async f => ({ name: f, content: await env.MEMORY.get(f) }))
        );
        const missing = files.filter(f => f.content === null).map(f => f.name);
        if (missing.length > 0) {
          return json({ ok: false, error: `Memory files not found: ${missing.join(", ")}` }, 500, { ...cors, ...nocache });
        }

        let memoryContext = files.map(f =>
          `<memory_file name="${f.name}">\n${f.content}\n</memory_file>`
        ).join("\n\n");

        // Optionally load archive files
        const includeArchive = body.archive === true;
        if (includeArchive) {
          const archiveFiles = await Promise.all(
            ARCHIVE_FILES.map(async f => ({ name: f, content: await env.MEMORY.get(f) }))
          );
          const archiveContext = archiveFiles
            .filter(f => f.content && f.content.trim().length > 10)
            .map(f => `<memory_file name="${f.name}" tier="archive">\n${f.content}\n</memory_file>`)
            .join("\n\n");
          if (archiveContext) {
            memoryContext += "\n\n" + archiveContext;
          }
        }

        // Pre-flight token estimate — refuse early with a friendly error if the
        // combined system prompt + memory + history would exceed Claude's context
        // window. Without this, the user gets a raw 400 JSON blob from the
        // Anthropic API that's hard to act on. ~4 chars per token is the rough
        // industry estimate for English.
        // Images are excluded from the char count — base64 encodes a 3MB JPEG as
        // ~4M chars which would falsely read as ~1M tokens. Claude's actual vision
        // cost for a typical photo is ~2000 tokens, so we use that as a fixed substitute.
        const MAX_INPUT_TOKENS = 176000; // 200K Claude window - max_tokens(4K) - prompt template (~10K) - headroom
        const IMAGE_TOKEN_ESTIMATE = 1700; // tokens per attached image — API downsamples to ≤1568px, real cost ~1600 tokens
        let messagesChars = 0;
        for (const msg of (body.messages || [])) {
          if (typeof msg.content === "string") {
            messagesChars += msg.content.length;
          } else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === "text") messagesChars += (block.text || "").length;
              else if (block.type === "image") messagesChars += IMAGE_TOKEN_ESTIMATE * 4;
            }
          }
        }
        const estimatedInputTokens = Math.round((memoryContext.length + messagesChars) / 4);
        if (estimatedInputTokens > MAX_INPUT_TOKENS) {
          const advice = includeArchive
            ? "Either turn 📦 Archive OFF for this query, or run /deep-review to move older items to cold storage."
            : "Run /archive-review or /compact-review to reduce active memory.";
          return json({
            ok: false,
            error: "memory_overflow",
            detail: `Combined memory is too large for one turn — ~${Math.round(estimatedInputTokens / 1000)}K of ${Math.round(MAX_INPUT_TOKENS / 1000)}K available. ${advice}`,
          }, 413, { ...cors, ...nocache });
        }

        // Build list of ambiguous first names (appear more than once in people.md)
        const peopleFile = files.find(f => f.name === "people.md");
        const ambiguousNames = peopleFile ? findAmbiguousFirstNames(peopleFile.content) : [];

        const utcDate = new Date().toISOString().split("T")[0]; // UTC date for cost tracking (matches checkDailyCap)
        // Validate clientDate: must be a plausible YYYY-MM-DD within ±1 day of server UTC.
        // Rejects malformed values, extreme clock skew, and unusual locale overrides.
        const today = (() => {
          const cd = body.clientDate;
          if (!cd || !/^\d{4}-\d{2}-\d{2}$/.test(cd)) return utcDate;
          const diffMs = Math.abs(new Date(cd + "T12:00:00Z") - new Date(utcDate + "T12:00:00Z"));
          return diffMs <= 86400000 ? cd : utcDate;
        })();
        const yesterdayDate = new Date(today + "T12:00:00Z");
        yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
        const yesterday = yesterdayDate.toISOString().split("T")[0];

        // Static block — cached. Contains all instructions + memory files.
        // Does NOT include date or brief flag so cache survives day boundaries
        // and mode switches without busting.
        const userName = (await env.MEMORY.get("config_user_name")) || env.USER_NAME || "User";
        const staticPrompt = buildStaticPrompt({ userName, ambiguousNames, memoryContext });

        const dynamicPrompt = buildDynamicPrompt({ today, yesterday, brief });

        const MODEL_MAP = {
          haiku: "claude-haiku-4-5-20251001",
          sonnet: "claude-sonnet-5",
        };
        const modelKey = String(body.model || "haiku").toLowerCase();
        const model = MODEL_MAP[modelKey] || MODEL_MAP.haiku;

        const chatHeaders = {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
        };
        const chatSystem = [
          { type: "text", text: staticPrompt, cache_control: { type: "ephemeral" } },
          { type: "text", text: dynamicPrompt },
        ];

        let claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: chatHeaders,
          body: JSON.stringify({ model, max_tokens: 4096, stream: true, system: chatSystem, messages: body.messages }),
        });

        if (!claudeRes.ok) {
          const errText = await claudeRes.text();
          let errObj = {};
          try { errObj = JSON.parse(errText); } catch {}
          if (claudeRes.status === 429 || errObj?.error?.type === "rate_limit_error") {
            return json({ ok: false, error: "rate_limit" }, 429, { ...cors, ...nocache });
          }
          // Retry once on overloaded_error — no tokens were consumed so cap re-check is not
          // needed. Use stream: true so the Worker never buffers the full response body.
          if (errObj?.error?.type === "overloaded_error") {
            await new Promise(r => setTimeout(r, 2000));
            claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: chatHeaders,
              body: JSON.stringify({ model, max_tokens: 4096, stream: true, system: chatSystem, messages: body.messages }),
            });
            if (!claudeRes.ok) {
              return json({ ok: false, error: `Claude API error: ${await claudeRes.text()}` }, 502, { ...cors, ...nocache });
            }
            // Falls through to the SSE pipe below.
          } else {
            return json({ ok: false, error: `Claude API error: ${errText}` }, 502, { ...cors, ...nocache });
          }
        }

        // Stream Anthropic SSE → client SSE
        const enc = new TextEncoder();
        let fullText = "";
        let streamUsage = {};

        // Shared flag — whichever of start() or cancel() fires first tracks the cost;
        // the other skips. Prevents double-logging when Stop/lock fires mid-stream.
        let costTracked = false;
        const sseStream = new ReadableStream({
          async start(controller) {
            try {
              const reader = claudeRes.body.getReader();
              const dec = new TextDecoder();
              let buf = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                const blocks = buf.split("\n\n");
                buf = blocks.pop() ?? "";
                for (const block of blocks) {
                  const dataLine = block.split("\n").find(l => l.startsWith("data: "));
                  if (!dataLine) continue;
                  const raw = dataLine.slice(6);
                  if (raw === "[DONE]") continue;
                  let ev; try { ev = JSON.parse(raw); } catch { continue; }
                  if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                    const chunk = ev.delta.text || "";
                    fullText += chunk;
                    controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: "d", v: chunk })}\n\n`));
                  } else if (ev.type === "message_start" && ev.message?.usage) {
                    streamUsage.input_tokens = ev.message.usage.input_tokens ?? 0;
                    streamUsage.cache_creation_input_tokens = ev.message.usage.cache_creation_input_tokens ?? 0;
                    streamUsage.cache_read_input_tokens = ev.message.usage.cache_read_input_tokens ?? 0;
                  } else if (ev.type === "message_delta" && ev.usage) {
                    streamUsage.output_tokens = ev.usage.output_tokens ?? 0;
                  } else if (ev.type === "error") {
                    // Anthropic mid-stream error (e.g. overloaded_error) — forward to client
                    controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: "e", v: ev.error?.message || "Anthropic stream error" })}\n\n`));
                    return;
                  }
                }
              }
              if (!costTracked) { costTracked = true; ctx.waitUntil(trackCost(env, utcDate, modelKey, streamUsage)); }
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: "z", v: fullText, u: streamUsage })}\n\n`));
            } catch (err) {
              if (!costTracked) { costTracked = true; ctx.waitUntil(trackCost(env, utcDate, modelKey, streamUsage)); }
              try { controller.enqueue(enc.encode(`data: ${JSON.stringify({ t: "e", v: String(err?.message || "stream error") })}\n\n`)); } catch {}
            } finally {
              controller.close();
            }
          },
          cancel() {
            // Client disconnected (tab closed, abort, lock) — track partial cost only if start() hasn't already
            if (!costTracked) { costTracked = true; ctx.waitUntil(trackCost(env, utcDate, modelKey, streamUsage)); }
          },
        });

        return new Response(sseStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...cors },
        });
      }

      // POST /updateApiKey — write a third-party API key to KV (write-only, no read-back)
      if (method === "POST" && path === "/updateApiKey") {
        const ALLOWED_API_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY"];
        const body = await safeJson(request);
        if (!body || !ALLOWED_API_KEYS.includes(body.key)) {
          return json({ ok: false, error: "key must be one of: " + ALLOWED_API_KEYS.join(", ") }, 400, { ...cors, ...nocache });
        }
        if (!body.value || typeof body.value !== "string" || body.value.trim().length < 8) {
          return json({ ok: false, error: "value must be at least 8 characters" }, 400, { ...cors, ...nocache });
        }
        await env.MEMORY.put("config_" + body.key.toLowerCase(), body.value.trim());
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      // POST /clearApiKey — delete a KV override, falling back to the install-time env secret
      if (method === "POST" && path === "/clearApiKey") {
        const ALLOWED_API_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY"];
        const body = await safeJson(request);
        if (!body || !ALLOWED_API_KEYS.includes(body.key)) {
          return json({ ok: false, error: "key must be one of: " + ALLOWED_API_KEYS.join(", ") }, 400, { ...cors, ...nocache });
        }
        await env.MEMORY.delete("config_" + body.key.toLowerCase());
        return json({ ok: true }, 200, { ...cors, ...nocache });
      }

      return new Response("Not found", { status: 404, headers: { ...cors, ...nocache } });
    } catch (err) {
      return json({ ok: false, error: String(err?.message || err) }, 500, { ...cors, ...nocache });
    }
  },
};

// ---- Duplicate first name detection ----

function findAmbiguousFirstNames(peopleText) {
  const lines = peopleText.replace(/\r\n/g, "\n").split("\n");
  const firstNameMap = new Map();

  for (const line of lines) {
    const m = line.match(/^\s*##\s*(?:👤\s*)?(.+?)\s*$/);
    if (!m) continue;
    const fullName = m[1].trim();
    const firstName = fullName.split(/\s+/)[0].toLowerCase();
    if (!firstNameMap.has(firstName)) firstNameMap.set(firstName, []);
    firstNameMap.get(firstName).push(fullName);
  }

  const ambiguous = [];
  for (const [firstName, fullNames] of firstNameMap) {
    if (fullNames.length > 1) {
      ambiguous.push({ firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1), fullNames });
    }
  }
  return ambiguous;
}

// ---- KV helpers ----

async function readFile(env, filename) {
  const content = await env.MEMORY.get(filename);
  if (content === null) throw new Error(`File not found: ${filename}`);
  return content.replace(/\r\n/g, "\n");
}

async function writeFile(env, filename, content) {
  await env.MEMORY.put(filename, content);
}

// ---- TTS markdown stripper ----

function stripMarkdownForSpeech(text) {
  return String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")       // **bold**
    .replace(/__(.+?)__/g, "$1")            // __bold__
    .replace(/\*(.+?)\*/g, "$1")            // *italic*
    .replace(/_(.+?)_/g, "$1")              // _italic_
    .replace(/^#{1,6}\s+/gm, "")           // ### headers
    .replace(/`(.+?)`/g, "$1")             // `inline code`
    .replace(/^[-*_]{3,}\s*$/gm, "")       // --- horizontal rules
    .replace(/^–\s+/gm, "")               // – bullet markers
    .replace(/^[-*]\s+/gm, "")             // - or * bullet markers
    .replace(/\n{3,}/g, "\n\n")            // collapse excess blank lines
    .trim();
}

// ---- Crypto ----

export async function sha256Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---- Section finding ----

export function normKey(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim().toLowerCase();
}

// Edit distance for fuzzy name matching (handles phillip/philip, jon/john, etc.)
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Returns true if a search term matches a normalized title string.
// Exact substring first; for terms ≥ 5 chars, falls back to edit-distance ≤ 1
// against any individual word in the title (catches common name misspellings).
function termMatches(term, titleNorm) {
  if (titleNorm.includes(term)) return true;
  if (term.length >= 5) {
    return titleNorm.split(/\s+/).some(word => editDistance(term, word) <= 1);
  }
  return false;
}

// Returns a Set of line indices that are inside fenced code blocks (```...``` or ~~~...~~~).
// Used by section parsers so that ## lines inside code samples aren't treated as headers.
export function getFencedCodeLines(lines) {
  const inCode = new Set();
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = String(lines[i] || "").trim();
    if (/^(```|~~~)/.test(trimmed)) { inCode.add(i); inside = !inside; continue; }
    if (inside) inCode.add(i);
  }
  return inCode;
}

// Maps an interior heading (### and deeper) back to the H2 that contains it,
// returning that H2's title or null.
//
// findSectionSpan addresses `#`/`##` headings only, so a record organized with
// `###` subsections has interior headings the app cannot open. Claude's
// <sources> block cites the heading a fact actually lives under, which for such
// a record is the `###` - so the source chip dead-ended on "Section not found".
//
// Used ONLY by the GET /getMemoryFile read path. It must never back a write:
// /deleteSection, /replaceSection, /moveToArchive and /compactSection all
// resolve through findSectionSpan, and widening an interior heading to its
// parent's span there would delete or overwrite the ENTIRE parent record -
// turning a cosmetic dead link into silent data loss. worker-helpers.test.mjs
// pins that asymmetry with an explicit strictness guard.
export function findSubsectionParent(lines, name) {
  const want = normKey(name);
  const codeLines = getFencedCodeLines(lines);
  let currentH2 = null;
  for (let i = 0; i < lines.length; i++) {
    if (codeLines.has(i)) continue;
    // 👤 is the person emoji some headings carry, same as findSectionSpan.
    const m = String(lines[i] || "").match(/^\s*(#{1,6})\s+(?:👤\s*)?(.+?)\s*$/);
    if (!m) continue;
    const level = m[1].length;
    if (level <= 2) { currentH2 = level === 2 ? m[2] : null; continue; }
    if (normKey(m[2]) === want) return currentH2;
  }
  return null;
}

export function findSectionSpan(lines, section, occurrenceIndex) {
  const want = normKey(section);
  const codeLines = getFencedCodeLines(lines);
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    if (codeLines.has(i)) continue;
    const m = String(lines[i] || "").match(/^\s*(#{1,2})\s+(?:👤\s*)?(.+?)\s*$/);
    if (!m) continue;
    if (normKey(m[2]) === want) headers.push({ idx: i, level: m[1].length, rawTitle: m[2] });
  }
  if (!headers.length) return null;

  const nextEnd = (start) => {
    for (let j = start + 1; j < lines.length; j++) {
      if (codeLines.has(j)) continue;
      if (/^\s*#{1,2}\s+/.test(String(lines[j] || ""))) return j;
    }
    return lines.length;
  };

  // When multiple headers share the same normKey, use exact case-insensitive match as a
  // tiebreaker before falling back to scoring. This prevents "José García" and "Jose Garcia"
  // from silently colliding — the caller gets the section they actually named, not whichever
  // happened to have a larger body. Only applies when occurrenceIndex is not in use.
  if (headers.length > 1 && typeof occurrenceIndex !== "number") {
    const exact = headers.filter(h => h.rawTitle.toLowerCase() === section.toLowerCase());
    if (exact.length === 1) return { iHeader: exact[0].idx, iEnd: nextEnd(exact[0].idx) };
    if (exact.length === 0) return null; // Multiple normKey matches, none exact — refuse to guess
    // exact.length > 1: duplicate verbatim headings — fall through to scoring
  }

  // When a specific occurrence is requested, return that one by document order
  if (typeof occurrenceIndex === "number" && occurrenceIndex >= 0) {
    if (occurrenceIndex >= headers.length) return null;
    const h = headers[occurrenceIndex];
    return { iHeader: h.idx, iEnd: nextEnd(h.idx) };
  }

  const scored = [];
  for (const h of headers) {
    const iEnd = nextEnd(h.idx);
    const body = lines.slice(h.idx + 1, iEnd);
    const hasH3 = body.some(l => /^\s*#{3,}\s/.test(l));
    const score = (hasH3 ? 1000000 : 0) + body.length;
    scored.push({ iHeader: h.idx, iEnd, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // If the top two candidates share the same score, the match is ambiguous — refuse to guess
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored.length ? { iHeader: scored[0].iHeader, iEnd: scored[0].iEnd } : null;
}

// ---- Patch ----

async function patchMemoryFile(env, body) {
  const filename = String(body.filename || "").trim();
  const section = String(body.section || "").trim();
  const dryRun = body.dryRun === true;
  const prevHash = String(body.previousHash || "").trim();

  let ops = [];
  if (Array.isArray(body.ops)) {
    ops = body.ops;
  } else if (body.op) {
    const { op, ...rest } = body;
    ops = [{ op, ...rest }];
  } else {
    return { ok: false, error: "no operation provided (send ops:[...] with at least one op)" };
  }

  const T = await readFile(env, filename);
  const currentHash = await sha256Hex(T);
  if (prevHash && prevHash.toLowerCase() !== currentHash.toLowerCase()) {
    return { ok: false, conflict: true, currentHash, note: "File changed since your last read." };
  }

  const lines = T.split("\n");
  const span = findSectionSpan(lines, section);
  if (!span) {
    const wantNorm = normKey(section);
    const allHeaders = lines
      .map(ln => { const m = String(ln || "").match(/^\s*#{1,2}\s*(?:👤\s*)?(.+?)\s*$/); return m ? m[1] : null; })
      .filter(Boolean);
    const closest = allHeaders.find(h => normKey(h).includes(wantNorm) || wantNorm.includes(normKey(h)));
    const hint = closest ? ` Did you mean "${closest}"?` : "";
    return { ok: false, error: `Section not found: ${section}.${hint}` };
  }

  const { iHeader, iEnd } = span;
  const block = lines.slice(iHeader + 1, iEnd);
  const results = [];

  for (const raw of ops) {
    const kind = String(raw.op || "").toLowerCase();

    if (kind === "append-bullet") {
      const label = String(raw.subsection || "Timeline");
      const today = new Date().toISOString().split("T")[0];
      const date = String(raw.date || "").trim() || today;
      const text = String(raw.text || "").trim();
      if (!text) { results.push({ op: kind, ok: false, error: "text required" }); continue; }
      const bullet = `– **${date}**: ${text}`;
      const segs = splitH3Segments(block);
      const want = normKey(label);
      let found = segs.find(s => s.norm === want);
      if (!found) { found = { title: label, norm: want, lines: [`### ${label}`] }; segs.push(found); }
      if (!found.lines.includes(bullet)) found.lines = [...found.lines, bullet];
      rebuildBlock(block, segs);
      results.push({ op: kind, ok: true });
      continue;
    }

    if (kind === "append-lines") {
      const label = String(raw.subsection || "").trim();
      // Coerce lines: Claude sometimes sends a string instead of an array
      const rawLines = raw.lines;
      const linesToAdd = Array.isArray(rawLines)
        ? rawLines.map(String)
        : (typeof rawLines === "string" && rawLines.trim() ? [rawLines.trim()] : []);
      if (!label || !linesToAdd.length) { results.push({ op: kind, ok: false, error: "subsection and lines required" }); continue; }
      const segs = splitH3Segments(block);
      const want = normKey(label);
      let found = segs.find(s => s.norm === want);
      if (!found) { found = { title: label, norm: want, lines: [`### ${label}`] }; segs.push(found); }
      const bodySet = new Set(found.lines.slice(1));
      for (const ln of linesToAdd) bodySet.add(ln);
      found.lines = [found.lines[0], ...Array.from(bodySet)];
      rebuildBlock(block, segs);
      results.push({ op: kind, ok: true, added: linesToAdd.length });
      continue;
    }

    if (kind === "replace-subsection") {
      const label = String(raw.subsection || raw.oldText || "").trim();
      const text = String(raw.text !== undefined ? raw.text : (raw.newText !== undefined ? raw.newText : ""));
      const mergeMode = String(raw.mergeMode || "append").toLowerCase();
      if (!label) { results.push({ op: kind, ok: false, error: "subsection required" }); continue; }
      const segs = splitH3Segments(block);
      const want = normKey(label);
      let found = segs.find(s => s.norm === want);
      if (!found) { found = { title: label, norm: want, lines: [`### ${label}`] }; segs.push(found); }
      if (mergeMode === "replace") {
        // No filter(Boolean) — blank lines are intentional paragraph breaks in prose
        found.lines = [found.lines[0], ...text.replace(/\r\n/g, "\n").split("\n")];
      } else {
        const incoming = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
        const set = new Set(found.lines.slice(1));
        for (const ln of incoming) set.add(ln);
        found.lines = [found.lines[0], ...Array.from(set)];
      }
      rebuildBlock(block, segs);
      results.push({ op: kind, ok: true, mode: mergeMode });
      continue;
    }

    if (kind === "replace-bullet") {
      const oldText = String(raw.old || raw.oldText || "").trim();
      const newText = String(raw.new || raw.newText || "").trim();
      if (!oldText || !newText) { results.push({ op: kind, ok: false, error: "old and new required" }); continue; }
      const idx = block.findIndex(l => String(l).trim() === oldText);
      if (idx < 0) { results.push({ op: kind, ok: false, error: "bullet not found" }); continue; }
      block[idx] = newText;
      results.push({ op: kind, ok: true });
      continue;
    }

    if (kind === "delete-bullet") {
      const text = String(raw.text || "").trim();
      if (!text) { results.push({ op: kind, ok: false, error: "text required" }); continue; }
      const idx = block.findIndex(l => String(l).trim() === text);
      if (idx < 0) { results.push({ op: kind, ok: false, error: "bullet not found" }); continue; }
      block.splice(idx, 1);
      results.push({ op: kind, ok: true });
      continue;
    }

    if (kind === "set-field") {
      const field = String(raw.field || "").trim();
      const value = String(raw.value || "").trim();
      if (!field) { results.push({ op: kind, ok: false, error: "field required" }); continue; }
      const pattern = new RegExp(`^[–-]\\s+${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*.*$`, "i");
      const idx = block.findIndex(l => pattern.test(l));
      const newLine = `– ${field}: ${value}`;
      if (idx >= 0) {
        block[idx] = newLine;
      } else {
        // Insert after last metadata line (lines starting with – or -), but stop before any ### heading
        let lastMeta = -1;
        for (let i = 0; i < block.length; i++) {
          if (/^\s*###/.test(String(block[i] || ""))) break;
          if (/^[–-]\s+\w/.test(String(block[i] || ""))) lastMeta = i;
        }
        if (lastMeta >= 0) block.splice(lastMeta + 1, 0, newLine);
        else block.unshift(newLine);
      }
      results.push({ op: kind, ok: true, field, value });
      continue;
    }

    if (kind === "append-item") {
      const text = String(raw.text || "").trim();
      if (!text) { results.push({ op: kind, ok: false, error: "text required" }); continue; }
      const newLine = `– [ ] ${text}`;
      // Insert before the first ### heading so items stay in the flat body
      const firstH3 = block.findIndex(l => /^\s*###/.test(String(l || "")));
      if (firstH3 >= 0) block.splice(firstH3, 0, newLine);
      else block.push(newLine);
      results.push({ op: kind, ok: true });
      continue;
    }

    results.push({ op: kind, ok: false, error: "unknown op" });
  }

  const failedOps = results.filter(r => !r.ok);
  if (failedOps.length > 0) {
    return {
      ok: false,
      error: `${failedOps.length} op(s) failed — file not written: ${failedOps.map(f => `${f.op}: ${f.error}`).join("; ")}`,
      results,
    };
  }

  const newText = [...lines.slice(0, iHeader + 1), ...block, ...lines.slice(iEnd)].join("\n");
  if (!dryRun) await writeFile(env, filename, newText);

  return {
    ok: true,
    wrote: !dryRun,
    previousHash: currentHash,
    newHash: await sha256Hex(newText),
    results,
    sizes: { before: T.length, after: newText.length },
  };
}

// ---- Insert Section ----

async function insertSection(env, body) {
  const filename = String(body.filename || "").trim();
  const ifExists = String(body.ifExists || "error").toLowerCase();
  const prevHash = String(body.previousHash || "").trim();
  let sectionRaw = String(body.section || "").replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const _wasQuoted = sectionRaw.startsWith('"') && sectionRaw.endsWith('"');
  if (_wasQuoted) {
    sectionRaw = sectionRaw.slice(1, -1);
    sectionRaw = sectionRaw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
  }
  sectionRaw = sectionRaw.replace(/^\s*##\s+##\s+/, "## ").replace(/\s+$/, "") + "\n";

  const firstLine = sectionRaw.split("\n")[0].trim();
  const fileText = await readFile(env, filename);

  // Guard 1 — optimistic concurrency. When the caller passes the file's hash
  // at proposal time, refuse the write if the file changed since (another
  // tab inserted, or another in-flight save just landed). Mirrors patchMemoryFile.
  const currentHash = await sha256Hex(fileText);
  if (prevHash && prevHash.toLowerCase() !== currentHash.toLowerCase()) {
    return { ok: false, conflict: true, currentHash, error: "File changed since your last read. Refresh and try again." };
  }

  const lines = fileText.split("\n");
  const sectionTitle = firstLine.replace(/^#+\s*(?:👤\s*)?/, "").trim();
  const wantNorm = normKey(sectionTitle);
  const hasSameH2 = lines.some(ln => {
    const m = String(ln || "").match(/^\s*#{1,2}\s*(?:👤\s*)?(.+?)\s*$/);
    return m && normKey(m[1]) === wantNorm;
  });

  if (hasSameH2) {
    // For loops.md: if the conflicting section is closed, auto-reopen instead of erroring
    if (filename === "loops.md" && (ifExists === "error" || ifExists === "reopen")) {
      const existingSpan = findSectionSpan(lines, sectionTitle);
      if (existingSpan) {
        const existingBlock = lines.slice(existingSpan.iHeader + 1, existingSpan.iEnd);
        const isClosed = existingBlock.some(l => /^[–-]\s+Status:\s*(closed|resolved)/i.test(String(l || "")));
        if (isClosed) {
          // Build ops: reopen status, remove closed date, then append new [ ] items
          const closedLine = existingBlock.find(l => /^[–-]\s+Closed:\s*/i.test(String(l || "")));
          const ops = [{ op: "set-field", field: "Status", value: "Open" }];
          if (closedLine) ops.push({ op: "delete-bullet", text: String(closedLine).trim() });
          const newItemTexts = sectionRaw.split("\n")
            .filter(l => { const s = String(l || ""); return s.includes("[ ]") || s.includes("[]"); })
            .map(l => l.trim().replace(/^[-–—–]\s*\[[ ]*\]\s*/, "").trim())
            .filter(Boolean);
          for (const text of newItemTexts) ops.push({ op: "append-item", text });
          const result = await patchMemoryFile(env, { filename, section: sectionTitle, ops });
          return result.ok ? { ok: true, reopened: true } : result;
        }
      }
    }
    // Non-loops files: return richer error when conflicting section is closed
    if (ifExists === "error") {
      if (filename !== "loops.md") {
        const existingSpan = findSectionSpan(lines, sectionTitle);
        if (existingSpan) {
          const existingBlock = lines.slice(existingSpan.iHeader + 1, existingSpan.iEnd);
          const isClosed = existingBlock.some(l => /^[–-]\s+Status:\s*(closed|resolved)/i.test(String(l || "")));
          if (isClosed) return { ok: false, error: "exists_closed", existingSection: firstLine };
        }
      }
      return { ok: false, error: `Section already exists: ${firstLine}` };
    }
    if (ifExists === "skip") return { ok: true, skipped: true, reason: "Section already exists." };
  }

  const spacer = fileText.trim().length ? (fileText.endsWith("\n\n") ? "" : "\n") : "";
  const needsNL = fileText.length && !/\n$/.test(fileText);
  const newText = (needsNL ? fileText + "\n" : fileText) + spacer + sectionRaw;
  await writeFile(env, filename, newText);

  // Guard 2 — post-write verification. Re-read and count occurrences of the
  // new header. If KV's eventual consistency made the pre-check miss an
  // existing record (concurrent-write window), undo by writing back the
  // pre-state we still hold in memory. Best-effort safety net — guard 1 is
  // the primary defense.
  try {
    const verifyText = await readFile(env, filename);
    const verifyLines = verifyText.split("\n");
    let count = 0;
    for (const ln of verifyLines) {
      const m = String(ln || "").match(/^\s*#{1,2}\s*(?:👤\s*)?(.+?)\s*$/);
      if (m && normKey(m[1]) === wantNorm) count++;
    }
    if (count > 1) {
      await writeFile(env, filename, fileText);
      return { ok: false, error: `Duplicate detected after write — refused to create a second "${sectionTitle}". Reload memory and try again.` };
    }
  } catch {
    // Verification read failed — surface a soft warning but don't fail the write.
    return { ok: true, added: firstLine, verifyWarning: "Could not verify post-write state." };
  }

  return { ok: true, added: firstLine, newHash: await sha256Hex(newText) };
}

// ---- Search ----

function searchMemoryFile(fileText, { q, limit, fuzzy }) {
  const sections = parseH2Sections(fileText);
  const expanded = expandQuery(q);

  const scored = sections.map(sec => {
    const norm = normForSearch(sec.lines.join("\n"));
    let score = 0;
    const matched = new Set();
    for (const term of expanded) {
      if (hasWord(norm, term)) { score += 3; matched.add(term); }
      else if (norm.includes(term)) { score += 1; matched.add(term); }
      else if (fuzzy > 0 && fuzzyHit(norm, term, fuzzy)) { score += 1.5; matched.add(term); }
    }
    return { name: sec.name, score: Number(score.toFixed(3)), matches: Array.from(matched) };
  });

  return scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

function fmtTok(chars) {
  const tok = Math.round(chars / 4);
  if (tok >= 10000) return `~${Math.round(tok / 1000)}k tok`;
  if (tok >= 1000)  return `~${Math.round(tok / 100) / 10}k tok`;
  return `~${tok} tok`;
}

export function parseH2Sections(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const codeLines = getFencedCodeLines(lines);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (codeLines.has(i)) { i++; continue; }
    const m = lines[i].match(/^\s*##\s*(?:👤\s*)?(.+?)\s*$/);
    if (!m) { i++; continue; }
    const name = m[1].trim();
    const start = i++;
    while (i < lines.length && (codeLines.has(i) || !/^\s*##\s+/.test(lines[i]))) i++;
    out.push({ name, lines: lines.slice(start, i) });
  }
  return out;
}

// Replaces or removes a section in a split file and returns the normalized
// file content string. Pass an empty array to delete the section.
export function buildFileWithSectionReplaced(lines, span, replacementLines) {
  const newLines = [
    ...lines.slice(0, span.iHeader),
    ...replacementLines,
    ...lines.slice(span.iEnd),
  ];
  return newLines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// Moves a section from srcLines to destContent and returns the new file strings.
// Returns { newSrc, newDest, sectionLines }.
export function buildTierMoveFiles(srcLines, span, destContent) {
  const sectionLines = srcLines.slice(span.iHeader, span.iEnd);
  const remaining = [
    ...srcLines.slice(0, span.iHeader),
    ...srcLines.slice(span.iEnd),
  ];
  const newSrc = remaining.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const newDest = ((destContent || "").trim() + "\n\n" + sectionLines.join("\n")).trim() + "\n";
  return { newSrc, newDest, sectionLines };
}

function normForSearch(s) {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[_~>#()[\]\\*.,!?'"…–—:;\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function expandQuery(q) {
  return normForSearch(q).split(" ").filter(Boolean);
}

function hasWord(normText, term) {
  return new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(normText);
}

function fuzzyHit(normText, term, maxDist) {
  const words = normText.split(" ");
  const step = Math.max(1, Math.floor(words.length / 2000));
  for (let i = 0; i < words.length; i += step) {
    if (levenshtein(words[i], term) <= maxDist) return true;
  }
  return false;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return dp[b.length];
}

// ---- H3 segment helpers ----

function splitH3Segments(block) {
  const segs = [];
  let i = 0;
  while (i < block.length && !/^\s*#{3,}\s/.test(block[i] || "")) i++;
  segs._pre = block.slice(0, i); // preserve lines before first ### (Tags, Domain, Intent, etc.)
  while (i < block.length) {
    const m = String(block[i] || "").match(/^\s*#{3,}\s*(.+?)\s*$/);
    if (!m) { i++; continue; }
    const title = m[1]; const start = i++;
    while (i < block.length && !/^\s*#{3,}\s/.test(block[i] || "")) i++;
    segs.push({ title, norm: normKey(title), lines: block.slice(start, i) });
  }
  return segs;
}

function rebuildBlock(block, segs) {
  const rebuilt = [...(segs._pre || [])];
  if (rebuilt.length > 0 && segs.length > 0 && rebuilt[rebuilt.length - 1] !== "") rebuilt.push("");
  for (let i = 0; i < segs.length; i++) {
    if (i > 0 && rebuilt[rebuilt.length - 1] !== "") rebuilt.push("");
    rebuilt.push(...segs[i].lines);
  }
  block.length = 0;
  block.push(...rebuilt);
}

// ---- Auth helpers ----

function condenseUA(ua) {
  if (!ua) return "Unknown";
  const device = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : "Desktop";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  return browser ? `${device} · ${browser}` : device;
}

// Per-IP key is hashed so KV never stores a raw IP address. The global key
// keeps its original name so an in-flight lockout from the previous version
// still counts rather than silently resetting on deploy.
async function authFailureKeys(request) {
  const ip = request.headers.get("CF-Connecting-IP") || request.cf?.clientIp || "unknown";
  return {
    ipKey: `auth_failures_ip_${(await sha256Hex(ip)).slice(0, 32)}`,
    globalKey: "auth_failures",
  };
}

// Returns null to proceed, or a ready 429 Response. Fails OPEN on a KV error:
// a throttle that cannot read its own state must not become the thing that
// locks a legitimate user out of their own memory.
async function checkAuthLockout(env, request, cors, nocache) {
  let reason = null;
  try {
    const { ipKey, globalKey } = await authFailureKeys(request);
    const [ipRaw, globalRaw] = await Promise.all([
      env.MEMORY.get(ipKey),
      env.MEMORY.get(globalKey),
    ]);
    reason = authLockoutReason(
      ipRaw ? parseInt(ipRaw) : 0,
      globalRaw ? parseInt(globalRaw) : 0,
    );
  } catch {
    return null;
  }
  if (!reason) return null;
  const error = reason === "ip"
    ? "Too many failed attempts — try again in 5 minutes."
    : "Too many failed attempts across all devices — try again in 5 minutes.";
  return json({ ok: false, error }, 429, { ...cors, ...nocache });
}

async function recordAuthFailure(env, request) {
  try {
    const { ipKey, globalKey } = await authFailureKeys(request);
    const [ipRaw, globalRaw] = await Promise.all([
      env.MEMORY.get(ipKey),
      env.MEMORY.get(globalKey),
    ]);
    await Promise.all([
      env.MEMORY.put(ipKey, String((ipRaw ? parseInt(ipRaw) : 0) + 1), { expirationTtl: AUTH_FAIL_LIMITS.ttlSeconds }),
      env.MEMORY.put(globalKey, String((globalRaw ? parseInt(globalRaw) : 0) + 1), { expirationTtl: AUTH_FAIL_LIMITS.ttlSeconds }),
    ]);
  } catch { /* non-fatal — never turn a logging problem into a failed request */ }
}

// Clears this caller's counter and the global backstop. Used on successful
// auth and on passphrase reset, so a legitimate user is never left throttled.
async function clearAuthFailures(env, request) {
  try {
    const { ipKey, globalKey } = await authFailureKeys(request);
    await Promise.all([env.MEMORY.delete(ipKey), env.MEMORY.delete(globalKey)]);
  } catch { /* non-fatal */ }
}

async function appendLoginEvent(env, request, method) {
  try {
    const raw = await env.MEMORY.get("login_log");
    const log = (() => { try { return raw ? JSON.parse(raw) : []; } catch { return []; } })();
    const cf = request.cf || {};
    log.unshift({
      at: new Date().toISOString(),
      country: request.headers.get("CF-IPCountry") || cf.country || "??",
      city: String(cf.city || ""),
      region: String(cf.region || ""),
      ua: condenseUA(request.headers.get("User-Agent")),
      method,
    });
    if (log.length > 20) log.length = 20;
    await env.MEMORY.put("login_log", JSON.stringify(log));
  } catch { /* non-fatal — login succeeds even if logging fails */ }
}

function derToP1363(sig) {
  // Chrome/Android returns DER-encoded ECDSA sigs; WebCrypto wants IEEE P1363 (raw 64 bytes)
  // P1363 sigs are exactly 64 bytes and don't start with 0x30
  if (sig.length === 64 && sig[0] !== 0x30) return sig;
  // Parse DER: 0x30 totalLen 0x02 rLen r 0x02 sLen s
  let i = 2;
  i += 1; const rLen = sig[i++];
  const r = sig.slice(i, i + rLen); i += rLen;
  i += 1; const sLen = sig[i++];
  const s = sig.slice(i, i + sLen);
  const out = new Uint8Array(64);
  const rTrim = r[0] === 0 ? r.slice(1) : r;
  const sTrim = s[0] === 0 ? s.slice(1) : s;
  out.set(rTrim, 32 - rTrim.length);
  out.set(sTrim, 64 - sTrim.length);
  return out;
}

function randomBase64url(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, "=");
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function randomBase64(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}

// `iterations` is required, deliberately — there is no default. A caller that
// forgets it gets a loud TypeError rather than silently hashing at the wrong
// cost, which is the failure that locks users out: verifying an old hash at
// the new count, or writing a new hash recorded as the old count.
async function pbkdf2Hash(password, salt, iterations) {
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new TypeError(`pbkdf2Hash: iterations must be a positive integer, got ${iterations}`);
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" },
    keyMaterial, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

// Writes a passphrase record. The hash and the cost that produced it are
// always written together as one object — writing a new hash while leaving a
// stale `iterations` behind is the single mistake that locks out every user,
// so there is exactly one function that does this and every caller uses it.
async function writeAuthConfig(env, password) {
  const salt = randomBase64(16);
  const iterations = PBKDF2.current;
  const hash = await pbkdf2Hash(password, salt, iterations);
  await env.MEMORY.put("auth_config", JSON.stringify({ hash, salt, iterations }));
  return { hash, salt, iterations };
}

// Transparently re-hashes a just-verified passphrase at the current cost.
// Best-effort by contract: a KV failure here must never fail the login that
// already succeeded — the user simply stays on the old cost and migrates on a
// later sign-in. Called only after the passphrase has been confirmed correct.
async function upgradeHashIfNeeded(env, password, cfg) {
  if (!needsRehash(cfg)) return;
  try {
    await writeAuthConfig(env, password);
  } catch { /* non-fatal — migration retries on the next successful login */ }
}

async function hmacSign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function issueToken(env) {
  const epochRaw = await env.MEMORY.get("token_epoch");
  const epoch = epochRaw ? parseInt(epochRaw) : 0;
  const payload = btoa(JSON.stringify({ exp: Date.now() + 24 * 60 * 60 * 1000, epoch }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const sig = await hmacSign(payload, env.WORKER_KEY);
  return `${payload}.${sig}`;
}

async function verifyToken(token, env) {
  if (!token || typeof token !== "string") return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = await hmacSign(payload, env.WORKER_KEY);
  if (sig !== expectedSig) return false;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(atob(padded + "==".slice((padded.length % 4) || 4)));
    if (typeof data.exp !== "number" || data.exp <= Date.now()) return false;
    const epochRaw = await env.MEMORY.get("token_epoch");
    const currentEpoch = epochRaw ? parseInt(epochRaw) : 0;
    return data.epoch === currentEpoch;
  } catch { return false; }
}

// ---- Cost tracking ----

// Daily cost cap: read the configured cap from KV (0 = disabled), sum today's
// Anthropic spend from cost_log, return null if under the cap or an overrun
// object { spent, cap } if at-or-over. Called by every route that hits
// api.anthropic.com BEFORE making the network call.
//
// Today's spend is computed only from cost_log entries, which means there's
// a brief window after a call where the cost is in flight (trackCost runs
// via ctx.waitUntil after the response) and not yet counted. Acceptable —
// the cap is a runaway-protection floor, not a real-time precision tool.
// OpenAI TTS and ElevenLabs are not tracked in cost_log and are not capped
// here (their per-call cost is sub-cent; not a runaway risk).
async function checkDailyCap(env) {
  // Read cap. If the KV read throws, fail closed — we can't verify the spend
  // is under the cap, so we shouldn't let the call through. Same for malformed
  // cap values (NaN/Infinity).
  let cap;
  try {
    const capRaw = await env.MEMORY.get("daily_cost_cap");
    cap = capRaw ? parseFloat(capRaw) : 0;
    if (!Number.isFinite(cap) || cap < 0) {
      return { spent: 0, cap: 0, error: "cap_unreadable" };
    }
  } catch {
    return { spent: 0, cap: 0, error: "cap_read_failed" };
  }
  if (cap === 0) return null; // explicitly disabled by user
  // Read cost log. If the read throws or JSON is corrupt, fail closed.
  let log;
  try {
    const logRaw = await env.MEMORY.get("cost_log");
    if (!logRaw) return null; // no spending yet today; safe to proceed
    log = JSON.parse(logRaw);
  } catch {
    return { spent: 0, cap, error: "log_read_failed" };
  }
  const today = new Date().toISOString().slice(0, 10);
  const dayEntry = log[today];
  if (!dayEntry) return null;
  let spent = 0;
  for (const modelKey of Object.keys(RATES)) {
    const m = dayEntry[modelKey];
    if (!m) continue;
    const r = RATES[modelKey];
    spent += (
      (m.input || 0) * r.input +
      (m.output || 0) * r.output +
      (m.cacheWrite || 0) * r.cacheWrite +
      (m.cacheRead || 0) * r.cacheRead
    ) / 1_000_000;
  }
  if (spent >= cap) return { spent: Math.round(spent * 100) / 100, cap };
  return null;
}

// Convenience wrapper for route handlers: if cap is hit, returns a ready-
// to-return 402 Response; otherwise returns null and the caller proceeds
// with its normal flow. Keeps cap enforcement to two lines at each site.
async function enforceCapOrReturn(env, cors, nocache) {
  const overrun = await checkDailyCap(env);
  if (!overrun) return null;
  // Fail-closed errors from checkDailyCap (KV read failed, log JSON corrupt,
  // cap value malformed) surface as a 503 so the user can retry — distinct
  // from a real cap overrun which is a 402 with the actual spend/cap numbers.
  if (overrun.error) {
    return json({
      ok: false,
      error: "cap_check_failed",
      detail: `Couldn't verify daily spend against your cap (${overrun.error}). Retry — if this persists, check Settings → Daily spend cap or check your worker logs.`,
    }, 503, { ...cors, ...nocache });
  }
  return json({
    ok: false,
    error: "daily_cap_exceeded",
    spent: overrun.spent,
    cap: overrun.cap,
    detail: `Daily Claude spend ($${overrun.spent.toFixed(2)}) reached your cap ($${overrun.cap.toFixed(2)}). Raise or disable the cap in Settings → Daily spend cap.`,
  }, 402, { ...cors, ...nocache });
}

async function trackCost(env, date, modelKey, usage) {
  // CF KV has no atomic compare-and-swap, so concurrent calls from ctx.waitUntil can race
  // and one write can silently overwrite another. This is an accepted limitation — it only
  // matters at the daily cap boundary, and the single-user usage pattern makes concurrent
  // trackCost calls rare. The read-to-write window is kept as tight as possible: pruning
  // runs after the write, not between the read and write.
  try {
    const raw = await env.MEMORY.get("cost_log");
    const log = (() => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } })();
    const mk = RATES[modelKey] ? modelKey : "haiku";
    if (!log[date]) log[date] = { requests: 0, haiku: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, sonnet: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } };
    log[date].requests += 1;
    const m = log[date][mk];
    m.input      += usage.input_tokens || 0;
    m.output     += usage.output_tokens || 0;
    m.cacheWrite += usage.cache_creation_input_tokens || 0;
    m.cacheRead  += usage.cache_read_input_tokens || 0;
    await env.MEMORY.put("cost_log", JSON.stringify(log));
    // Prune entries older than 14 days — runs after the write so it doesn't widen the race window
    const cutoff = new Date(date + "T12:00:00Z");
    cutoff.setUTCDate(cutoff.getUTCDate() - 14);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const stale = Object.keys(log).filter(k => k < cutoffStr);
    if (stale.length) {
      for (const key of stale) delete log[key];
      await env.MEMORY.put("cost_log", JSON.stringify(log));
    }
  } catch (err) {
    // Log the failure so /diagnostics can surface it — never break chat
    try {
      const errRaw = await env.MEMORY.get("_error_log");
      const errors = (() => { try { return errRaw ? JSON.parse(errRaw) : []; } catch { return []; } })();
      errors.unshift({ ts: new Date().toISOString(), fn: "trackCost", msg: String(err?.message || err) });
      await env.MEMORY.put("_error_log", JSON.stringify(errors.slice(0, 20)));
    } catch {}
  }
}

// ---- Utils ----

async function safeJson(request) {
  const text = await request.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
