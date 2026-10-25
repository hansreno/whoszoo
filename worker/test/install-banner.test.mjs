import { test } from "node:test";
import assert from "node:assert/strict";
import { loadVoiceApp } from "./voice-harness/load.mjs";

// iPhone has no install prompt (no beforeinstallprompt in WebKit), so the app
// shows the manual Share → Add to Home Screen steps in the same banner.
const open = async (device, storage = {}) => {
  const app = await loadVoiceApp({ device, inputMode: "whisper", storage });
  app.w.document.getElementById("chat-screen").classList.remove("hidden");
  return app;
};
const banner = (app) => app.w.document.querySelector(".install-banner");

test("iPhone browser tab: the install banner shows the Share → Add to Home Screen steps, with no Install button", async () => {
  const app = await open("iphone");
  try {
    app.w.eval("showInstallBanner()");
    const b = banner(app);
    assert.ok(b, "banner shown on iPhone");
    assert.match(b.textContent, /Add to Home Screen/);
    assert.equal(b.querySelector(".install-banner-btn"), null, "no Install button (iOS can't prompt)");
  } finally { app.close(); }
});

test("iPhone: ✕ remembers the dismissal and the banner stays away", async () => {
  const app = await open("iphone");
  try {
    app.w.eval("showInstallBanner()");
    banner(app).querySelector(".install-banner-dismiss").click();
    assert.equal(banner(app), null);
    app.w.eval("showInstallBanner()");
    assert.equal(banner(app), null, "dismissed for good");
  } finally { app.close(); }
});

test("iPhone home-screen app (navigator.standalone): no banner", async () => {
  const app = await open("iphone");
  try {
    Object.defineProperty(app.w.navigator, "standalone", { configurable: true, value: true });
    app.w.eval("showInstallBanner()");
    assert.equal(banner(app), null);
  } finally { app.close(); }
});

test("Android without a beforeinstallprompt event: still no banner (unchanged)", async () => {
  const app = await open("android");
  try {
    app.w.eval("showInstallBanner()");
    assert.equal(banner(app), null);
  } finally { app.close(); }
});

test("iPhone: Settings → Install to home screen is visible and shows the steps", async () => {
  const app = await open("iphone");
  try {
    app.w.eval("refreshInstallRow()");
    const row = app.w.document.getElementById("panel-install");
    assert.notEqual(row.style.display, "none", "row visible on iPhone");
    row.click();
    await app.advance(100);
    assert.ok(app.w.document.getElementById("toast").classList.contains("toast-long"), "a wrapping, longer-lived toast (a one-line toast is clipped on a phone)");
    assert.match(app.w.document.getElementById("toast")?.textContent || app.w.document.body.textContent, /Add to Home Screen/);
  } finally { app.close(); }
});
