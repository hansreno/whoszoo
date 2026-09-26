// Tier A: source contracts for frontend/app.js.
//
// app.js is a plain browser script loaded via <script src> — it has no
// exports, so these tests CANNOT import and execute its logic the way
// worker-helpers.test.mjs executes worker.js's pure functions. Converting
// app.js to a module to make it importable would change its load semantics
// and the global-scope assumptions running through the whole file — far too
// much churn for the bugs these tests guard.
//
// So these assert against the SOURCE TEXT, the same compromise
// css-contracts.test.mjs makes for style.css. Know the limit: a passing test
// here proves the code still SAYS the right thing, not that it DOES the right
// thing at runtime. It catches deletion and refactor-drift, which is the
// actual failure mode these guard against. It would not catch a logic error
// introduced while keeping the matched text intact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(__dirname, "../../frontend/app.js"), "utf8");

// Strip comments so a test can't pass by matching prose that explains the
// code rather than the code itself — the exact way an earlier CSS contract
// test "passed" against its own explanatory comment.
const appCode = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Isolate the copy-conversation feature so these assertions can't be
// satisfied by an unrelated selector elsewhere in a 9000-line file.
//
// This spans transcriptMarker() AND the click handler, because the feature is
// implemented across both. An earlier version grabbed only the handler body
// and broke the moment the marker logic was factored into its own function —
// failing on correct code, purely because it was pinned to the shape of the
// implementation rather than to what it does. Keep the window wide enough
// that a reasonable refactor doesn't trip it.
function copyFeatureSource(src) {
  const start = src.indexOf("function transcriptMarker");
  const handlerStart = src.indexOf("copyChatBtn.addEventListener");
  if (handlerStart === -1) return null;
  const from = start === -1 || start > handlerStart ? handlerStart : start;
  const end = src.indexOf("\n});", handlerStart);
  return end === -1 ? null : src.slice(from, end);
}

// ---- Context resets must survive into a copied transcript ---------------
//
// The copy handler selected only ".message.user, .message.assistant,
// .message.system". The context-reset divider is created with class
// "context-divider" and is not a .message.* element, so a reset was
// structurally impossible to copy — a pasted transcript showed an unbroken
// conversation where the model had actually been given a fresh context.
// That is not a cosmetic gap: it actively misleads anyone debugging from a
// pasted transcript, which is exactly what it did during the investigation
// into the Jason Howes retrieval bug (2026-09-23).

test("copy-conversation handler exists and is findable", () => {
  assert.ok(copyFeatureSource(appCode), "copyChatBtn click handler not found in app.js");
});

test("copied transcripts include context-reset dividers", () => {
  const handler = copyFeatureSource(appCode);
  assert.match(
    handler,
    /\.context-divider/,
    "the copy handler's selector must include .context-divider — without it a " +
    "context reset cannot appear in a copied transcript, and a pasted transcript " +
    "reads as one continuous conversation when it was not."
  );
});

test("a copied context reset is marked distinctly, not labelled as a System message", () => {
  const handler = copyFeatureSource(appCode);
  // Without an explicit branch, a .context-divider falls through the
  // user/assistant role ternary to "System" and emits the concatenated
  // innerText of both its spans — which reads as if the app said something,
  // rather than as a boundary in the transcript.
  // Assert on the marker PUSH specifically, not on the string
  // "context-divider" appearing anywhere in the handler — the selector above
  // already contains that substring, so a looser pattern matches even with
  // this branch deleted. (It did: the first version of this test passed
  // against a handler with the branch removed, caught only by planting the
  // regression. Keep this assertion tied to something the selector cannot
  // satisfy on its own.)
  // Asserts the marker STRING exists, not how it is emitted — an earlier
  // version pinned `lines.push(...)` and failed the moment the marker moved
  // into a helper that returns instead of pushing. Correct code, broken test.
  // Pairing the literal with the classList check below still catches the real
  // regression (deleting the branch removes both).
  assert.match(
    handler,
    /["'`]-{2,}\s*Context Reset\s*-{2,}["'`]/,
    "an explicit reset marker string must exist; without it the divider falls " +
    "through the role ternary to \"System\" and emits its two spans " +
    "concatenated, reading as if the app had said something"
  );
  assert.match(
    handler,
    /classList\.contains\(\s*["'`]context-divider["'`]\s*\)/,
    "the marker must be gated on the element actually being the divider"
  );
});

// The divider was not the only element with this defect. Everything appended
// to messagesEl was audited (appendChild is the sole insertion route — the
// three messagesEl.innerHTML assignments are clears, not inserts), and two
// more non-.message elements were being dropped from copied transcripts for
// exactly the same structural reason:
//
//   .context-warning  "N exchanges in · consider resetting..."  — tells a
//                     reader the conversation was long enough to matter.
//   .archive-hint     "Search archive? / Search cold storage?"  — the app
//                     offering a wider search, which appears precisely when
//                     the model found nothing in active memory. That is the
//                     single most diagnostic thing on screen during a
//                     retrieval failure, and it was invisible in a paste.
//
// Both also carry <button> children, so their raw innerText concatenates the
// button label onto the body ("Reset (/r)5 exchanges in · ..."). Each needs
// its own marker rather than falling through to the role ternary.

test("copied transcripts include the context-length warning", () => {
  const handler = copyFeatureSource(appCode);
  assert.match(
    handler, /\.context-warning/,
    ".context-warning must be in the copy selector — a transcript that hides " +
    "it loses the fact that the conversation had grown long"
  );
});

test("copied transcripts include the archive / cold-storage offer", () => {
  const handler = copyFeatureSource(appCode);
  assert.match(
    handler, /\.archive-hint/,
    ".archive-hint must be in the copy selector — it appears exactly when the " +
    "model found nothing in active memory, which is the most diagnostic signal " +
    "available when investigating a retrieval failure"
  );
});

test("button labels are not glued onto the warning text", () => {
  const handler = copyFeatureSource(appCode);
  // .context-warning contains <button>Reset (/r)</button> followed by the
  // real text span. Copying el.innerText yields "Reset (/r)5 exchanges in…".
  // The handler must read the .context-warning-text span specifically.
  assert.match(
    handler, /context-warning-text/,
    "the warning's text span must be read directly so the Reset button label " +
    "is not concatenated onto the front of the line"
  );
});

// ---------------------------------------------------------------------------
// Auto-voice privacy notice (v1.8.43)
//
// Auto voice input transcribes via the browser's Web Speech Recognition API,
// which on Chrome/Edge streams the audio to Google and never touches the
// Worker. That is outside the boundary the rest of the product guarantees, so
// the first Auto voice session must let the user choose before any audio is
// captured. These pin the wiring, not the wording.
// ---------------------------------------------------------------------------

test("enterConvMode defers to the Auto-voice privacy notice before opening", () => {
  const i = appCode.indexOf("function enterConvMode");
  assert.notEqual(i, -1, "enterConvMode() must still exist");
  const body = appCode.slice(i, i + 600);
  assert.match(
    body, /if\s*\(\s*maybeShowVoicePrivacyNotice\(\)\s*\)\s*return/,
    "enterConvMode() must bail when the notice takes over the attempt — " +
    "otherwise voice mode opens and audio is captured before the user chooses"
  );
});

test("the notice never fires when audio already routes through the Worker", () => {
  const i = appCode.indexOf("function maybeShowVoicePrivacyNotice");
  assert.notEqual(i, -1, "maybeShowVoicePrivacyNotice() must still exist");
  const body = appCode.slice(i, appCode.indexOf("\n}", i));
  assert.match(
    body, /if\s*\(\s*useWhisper\(\)\s*\)\s*return false/,
    "Whisper mode (and therefore all of iOS) routes audio through the user's " +
    "own Worker, so there is nothing to disclose and no notice to show"
  );
  assert.match(
    body, new RegExp(String.raw`localStorage\.getItem\(VOICE_PRIVACY_KEY\)`),
    "the notice is once-only and must check its seen flag"
  );
});

test("choosing Whisper from the notice persists the choice", () => {
  const i = appCode.indexOf("function maybeShowVoicePrivacyNotice");
  const body = appCode.slice(i, appCode.indexOf("\n}\n", i));
  assert.match(
    body, new RegExp(String.raw`localStorage\.setItem\(VOICE_INPUT_KEY,\s*"whisper"\)`),
    "a one-tap switch that forgets itself next session is not a fix"
  );
});

test("journal mode cannot engage when conv mode declined to open", () => {
  // The 800ms long-press handler calls enterConvMode() then setJournalMode().
  // enterConvMode() has two early returns (no speech support; the privacy
  // notice), so the second call must be guarded or journal dictation starts
  // with convMode === false.
  const i = appCode.indexOf("convBtnJournalTimer = setTimeout");
  assert.notEqual(i, -1, "the long-press timer must still exist");
  const body = appCode.slice(i, i + 400);
  assert.match(
    body, /if\s*\(\s*convMode\s*&&\s*!journalDictating\s*\)\s*setJournalMode\(true\)/,
    "setJournalMode(true) must be gated on conv mode actually having opened"
  );
});

// ---------------------------------------------------------------------------
// Share the product, never this install (v1.8.45)
//
// Every user runs their own copy at their own address, so the one thing they
// can otherwise hand someone is their address bar -- the login page to their
// own memory. These pin the separation structurally, not by label.
// ---------------------------------------------------------------------------

function shareHandlerSource(src) {
  const i = src.indexOf(`getElementById("panel-share")`);
  if (i === -1) return null;
  const end = src.indexOf("\n});", i);
  return src.slice(i, end === -1 ? src.length : end);
}

test("the share handler never reads the user's own Worker URL", () => {
  const h = shareHandlerSource(appCode);
  assert.notEqual(h, null, "the panel-share handler must still exist");
  assert.doesNotMatch(
    h, /WORKER_URL|workerUrl/,
    "sharing must never reach for this install's address -- that is the login " +
    "page to the user's own memory, not the product"
  );
});

test("the shared URL is a hard-coded constant pointing at the product", () => {
  assert.match(
    appCode, /const SHARE_URL = "https:\/\/whoszoo\.app"/,
    "the destination must be fixed in source, so the wrong thing is impossible " +
    "rather than merely discouraged"
  );
});

test("the native share sheet is gated on the device, not on the API existing", () => {
  const h = shareHandlerSource(appCode);
  // Chrome on Windows implements navigator.share, so gating on the API alone
  // sends desktop users into the OS share sheet -- where a text-only share has
  // no "Copy link" -- and makes the clipboard path below unreachable there.
  assert.match(
    h, /navigator\.share\s*&&\s*isTouchPrimary\(\)/,
    "a native sheet only earns its place on a touch-primary device; on desktop " +
    "the clipboard is the useful target"
  );
  // The call site alone is not enough: an isTouchPrimary() that stopped
  // consulting the pointer type would satisfy the check above while sending
  // every desktop back into the share sheet.
  const i = appCode.indexOf("function isTouchPrimary");
  assert.notEqual(i, -1, "isTouchPrimary() must still exist");
  const body = appCode.slice(i, appCode.indexOf("\n}", i));
  assert.ok(
    body.includes("pointer: coarse"),
    "isTouchPrimary() must actually ask whether this is a touch-primary device"
  );
});

test("the shared message is composed here, not by the platform", () => {
  const h = shareHandlerSource(appCode);
  // The sentence, a blank line, then a bare link -- identical on every target.
  assert.match(
    h, /\$\{SHARE_URL\}/,
    "the handler must append SHARE_URL itself; locale strings carry no URL"
  );
  assert.doesNotMatch(
    h, /url:\s*SHARE_URL/,
    "passing share()'s separate `url` field hands layout back to the platform, " +
    "which composes text and url differently per OS and per target app"
  );
});

test("dismissing the native share sheet does not silently copy instead", () => {
  const h = shareHandlerSource(appCode);
  assert.match(
    h, /AbortError/,
    "AbortError means the user cancelled on purpose; falling through to the " +
    "clipboard would act against an explicit dismissal"
  );
});

test("the share message carries no URL of its own", () => {
  // navigator.share() composes `text` and `url` separately, so a link embedded
  // in the message would render twice in the share sheet.
  const locales = readFileSync(join(__dirname, "../../frontend/locales.js"), "utf8");
  // Line-based rather than a regex over quoted values: the escaping needed to
  // match a JS string literal is exactly the kind that gets mangled passing
  // through a shell, and this assertion is just as strong without it.
  const lines = locales.split(/\r?\n/).filter(l => l.includes(`"settings.share-message"`));
  assert.equal(lines.length, 4, "share-message must exist in all four locales");
  for (const line of lines) {
    assert.ok(
      !line.includes("http"),
      "the URL is appended by the handler; embedding it here duplicates it in " +
      "the native share sheet"
    );
  }
});

// ---------------------------------------------------------------------------
// Enter behaviour in the chat input (v1.8.48)
//
// A soft keyboard has no practical Shift key, so Enter-to-send left no way to
// type a second line on mobile at all -- the textarea's own auto-grow was
// unreachable on the platform this app is mobile-first for.
// ---------------------------------------------------------------------------

test("Enter inserts a newline on touch devices instead of sending", () => {
  const i = appCode.indexOf(`inputEl.addEventListener("keydown"`);
  assert.notEqual(i, -1, "the chat input's keydown handler must still exist");
  const handler = appCode.slice(i, i + 3000);
  // Plain string match, not a regex: the escaping a regex needs here is
  // exactly what gets mangled passing through a shell, and this is no weaker.
  assert.ok(
    handler.includes(`!e.shiftKey && !isTouchPrimary()`),
    "Enter must only send on a desktop; on a touch device it inserts a " +
    "newline and the send button is the only way to send"
  );
});
