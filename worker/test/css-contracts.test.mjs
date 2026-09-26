// Tier A: CSS contract tests — reads frontend/style.css and asserts rules that
// have regressed in production before. These are NOT visual tests; they verify
// that specific CSS declarations exist in the stylesheet so a future refactor
// or agent recommendation can't silently break them.
//
// Regressions guarded against:
//   - .conv-controls .invisible must use display:none, NOT visibility:hidden.
//     When visibility:hidden is used, discard+finish buttons take up flex space
//     even when "hidden", pushing mute to the far left and exit to the far right.
//     This has regressed three times. The rule must stay as display:none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, "../../frontend/style.css"), "utf8");

// Strip comments so we're testing actual declarations, not commented-out rules.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

test(".conv-controls .invisible uses display:none (not visibility:hidden)", () => {
  // The rule must exist — hidden conv buttons must collapse to zero width so
  // mute and exit stay grouped in the center of the controls row.
  const hasDisplayNone = /\.conv-controls\s+\.invisible\s*\{[^}]*display\s*:\s*none/.test(cssNoComments);
  assert.ok(
    hasDisplayNone,
    ".conv-controls .invisible must have display:none — " +
    "visibility:hidden leaves buttons in the flex row and pushes mute/exit to screen edges"
  );
});

test(".conv-controls .invisible does NOT use visibility:hidden", () => {
  // Negative guard: ensure no one added visibility:hidden back to this selector.
  const hasVisibilityHidden = /\.conv-controls\s+\.invisible\s*\{[^}]*visibility\s*:\s*hidden/.test(cssNoComments);
  assert.ok(
    !hasVisibilityHidden,
    ".conv-controls .invisible must NOT use visibility:hidden — use display:none instead"
  );
});

test(".invisible base rule exists", () => {
  // The base .invisible rule must exist (used for non-conv contexts where
  // visibility:hidden is correct to prevent layout reflow).
  const hasInvisible = /\.invisible\s*\{/.test(cssNoComments);
  assert.ok(hasInvisible, ".invisible CSS rule must be defined in style.css");
});

test(".conv-controls uses justify-content:center", () => {
  // Guard against accidentally changing to space-between, which would also
  // spread mute and exit to opposite edges when discard/finish are hidden.
  const hasCenterJustify = /\.conv-controls\s*\{[^}]*justify-content\s*:\s*center/.test(cssNoComments);
  assert.ok(
    hasCenterJustify,
    ".conv-controls must use justify-content:center — " +
    "space-between would spread buttons to screen edges when middle buttons are hidden"
  );
});

// ---- Flex items with an explicit min-height must not shrink ----------------
// A flex item defaults to min-height:auto, which is content-based and is the
// only thing stopping it being compressed below its own text. Setting an
// explicit min-height (for a 44px touch target, say) REPLACES that default and
// re-enables shrinking — so inside a capped, scrolling flex column the browser
// squashes tall rows and their text renders on top of the row beneath.
//
// This shipped in the loop checklist: short items looked fine, multi-line ones
// overlapped, which made it look intermittent. Both elements below live in
// capped flex columns (.edit-modal-checklist, .browse-list) and carry an
// explicit min-height, so both need flex-shrink: 0.
// Comments are stripped before matching. The first version of these tests did
// not, and passed against a CSS comment that happened to contain the words
// "flex-shrink: 0" — the very comment written to explain the declaration. It
// would have reported green with the real declaration deleted.

test(".checklist-item declares flex-shrink: 0", () => {
  const rule = cssNoComments.match(/\.checklist-item\s*\{[^}]*\}/);
  assert.ok(rule, ".checklist-item rule must exist");
  assert.match(rule[0], /flex-shrink:\s*0/,
    ".checklist-item sets an explicit min-height inside a capped flex column; " +
    "without flex-shrink: 0 the browser compresses multi-line rows and their " +
    "text overlaps the next row.");
});

test(".browse-item declares flex-shrink: 0", () => {
  const rule = cssNoComments.match(/\.browse-item\s*\{[^}]*\}/);
  assert.ok(rule, ".browse-item rule must exist");
  assert.match(rule[0], /flex-shrink:\s*0/,
    ".browse-item sets an explicit min-height inside the capped, scrolling " +
    ".browse-list; without flex-shrink: 0 a wrapping or expanded row can be " +
    "squashed below its content height.");
});

// v1.8.39 shipped .install-banner-btn at min-height: 34px and
// .install-banner-dismiss at ~18x14px (padding: 0 2px, font-size: 14px, no
// min-height/min-width at all), sitting immediately beside the Install
// button in a tight flex row with only `gap: 10px` between them. A user
// aiming for Install could land on the dismiss X instead — which writes a
// PERMANENT localStorage flag with, at the time, no way back short of
// clearing site data (which also drops the saved worker URL and biometric
// enrollment). Fixed in v1.8.40 by matching this app's 44x44 standard,
// used elsewhere at 10 other declaration sites.

test(".install-banner-btn meets the 44px touch-target minimum", () => {
  const rule = cssNoComments.match(/\.install-banner-btn\s*\{[^}]*\}/);
  assert.ok(rule, ".install-banner-btn rule must exist");
  assert.match(rule[0], /min-height:\s*44px/,
    ".install-banner-btn must be at least 44px tall, matching this app's " +
    "touch-target standard used elsewhere (see other 44px declarations in " +
    "this stylesheet) — a smaller Install button sitting next to the " +
    "dismiss X invites exactly the mistap this test guards against.");
});

test(".install-banner-dismiss meets the 44px touch-target minimum", () => {
  const rule = cssNoComments.match(/\.install-banner-dismiss\s*\{[^}]*\}/);
  assert.ok(rule, ".install-banner-dismiss rule must exist");
  assert.match(rule[0], /min-height:\s*44px/,
    ".install-banner-dismiss must be at least 44px tall — its click writes " +
    "a PERMANENT dismissal flag (INSTALL_DISMISSED_KEY), so an accidental " +
    "tap here is a one-way door for the user, not a cosmetic slip.");
  assert.match(rule[0], /min-width:\s*44px/,
    ".install-banner-dismiss must be at least 44px wide for the same reason.");
});
