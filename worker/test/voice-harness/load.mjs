// Loads the real frontend (index.html + locales.js + app.js) into jsdom with
// the virtual clock and fakes installed before any script runs. Never edit
// app.js to suit this file.
import { JSDOM, ResourceLoader, VirtualConsole } from "jsdom";
import { readFileSync } from "node:fs";
import { createClock } from "./clock.mjs";
import { installFakes } from "./fakes.mjs";

export const STEP_MS = 50; // part of every baseline: never change casually
const FRONTEND = new URL("../../../frontend/", import.meta.url);
const ORIGIN = "https://example.test";
export const UA = {
  android: "Mozilla/5.0 (Linux; Android 14; SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

class LocalOnly extends ResourceLoader {
  fetch(url) {
    const u = new URL(url);
    if (u.origin !== ORIGIN) return Promise.resolve(Buffer.from("")); // the jszip CDN script: never touch the network
    return Promise.resolve(readFileSync(new URL(u.pathname.replace(/^\//, ""), FRONTEND)));
  }
}

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

export async function loadVoiceApp({ device = "android", inputMode = "whisper", storage = {}, fakes = {}, omitScripts = [] } = {}) {
  const clock = createClock();
  const trace = [];
  const errors = [];
  let html = readFileSync(new URL("index.html", FRONTEND), "utf8");
  for (const s of omitScripts) html = html.replace(new RegExp(`\\s*<script src="${s}[^"]*"></script>`), "");
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { const m = String((e && (e.detail || e.message)) || e).slice(0, 300); errors.push(m); });
  let ctl;
  const dom = new JSDOM(html, {
    url: `${ORIGIN}/`,
    runScripts: "dangerously",
    resources: new LocalOnly({ userAgent: UA[device] }),
    virtualConsole: vc,
    beforeParse(window) {
      ctl = installFakes(window, { clock, trace, device, fakes });
      const seed = {
        whoszoo_config: JSON.stringify({ url: ORIGIN }),
        whoszoo_voice_input: inputMode,
        whoszoo_voice_privacy_seen: "1",
        ...storage,
      };
      for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v);
    },
  });
  const w = dom.window;
  await new Promise((r) => w.addEventListener("load", r));
  clock.runUntil(clock.now() + 500); // /authStatus probe resolves
  await flush();
  // A logged-in session without startSession(): the reply path checks `session`.
  w.eval('session = { token: "test-token", expiresAt: Date.now() + 86400000 }');

  const $ = (id) => w.document.getElementById(id);
  let last = {};
  let sysSeen = 0;
  const observe = () => {
    const ov = $("conv-overlay");
    const cur = {
      orb: $("conv-orb").className,
      label: $("conv-label").textContent,
      transcript: $("conv-transcript").textContent,
      toast: $("toast").classList.contains("hidden") ? "" : $("toast").textContent,
      overlay: ov.classList.contains("hidden") ? "hidden" : ov.classList.contains("conv-overlay--minimized") ? "minimized" : "open",
      mute: $("conv-mute").classList.contains("muted") ? "muted" : "live",
    };
    for (const k of Object.keys(cur)) if (cur[k] !== last[k]) ctl.rec("ui", { f: k, v: cur[k] });
    last = cur;
    const sys = w.document.querySelectorAll("#messages .message.system");
    for (let i = sysSeen; i < sys.length; i++) ctl.rec("system", { v: sys[i].textContent.slice(0, 160) });
    sysSeen = sys.length;
  };

  // Startup is done: clear what it recorded so counts start at zero.
  observe();
  trace.length = 0;
  for (const k of Object.keys(ctl.counts)) delete ctl.counts[k];
  last = {};
  observe();

  const advance = async (ms) => {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      clock.runUntil(Math.min(end, clock.now() + STEP_MS));
      await flush();
      observe();
    }
  };
  const pointer = (id, type) => {
    const E = w.PointerEvent || w.MouseEvent;
    const ev = new E(type, { bubbles: true, cancelable: true });
    if (!("pointerId" in ev) || ev.pointerId === undefined) Object.defineProperty(ev, "pointerId", { value: 1 });
    ctl.rec(type, { el: id });
    $(id).dispatchEvent(ev);
    ctl.rec(`${type}.end`, { el: id }); // anything recorded between the two ran in the same synchronous task
    observe();
  };

  const plain = (id, type) => {
    ctl.rec(type, { el: id });
    $(id).dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
    observe();
  };

  return {
    w, trace, errors, ctl,
    get counts() { return ctl.counts; },
    get unrouted() { return ctl.unrouted; },
    advance,
    down: (id) => pointer(id, "pointerdown"),
    up: (id) => pointer(id, "pointerup"),
    cancel: (id) => pointer(id, "pointercancel"),
    // A real tap: pointerdown, (touchstart on phones), pointerup, (touchend), click.
    // touchstart and click matter: the app counts only click/keydown/touchstart as
    // activity for the inactivity lock. down()/up() stay raw for long holds.
    async press(id, holdMs = 100) {
      pointer(id, "pointerdown");
      if (device !== "desktop") plain(id, "touchstart");
      await advance(holdMs);
      pointer(id, "pointerup");
      if (device !== "desktop") plain(id, "touchend");
      plain(id, "click");
      await advance(STEP_MS);
    },
    async click(id) { ctl.rec("click", { el: id }); $(id).click(); observe(); await advance(STEP_MS); },
    async say(ms, rms = 0.05) { ctl.setLevel(rms); await advance(ms); ctl.setLevel(0); },
    recognizer: (n) => ctl.recognizers[(n || ctl.recognizers.length) - 1],
    async setVisibility(v) { ctl.setVisibility(v); observe(); await advance(STEP_MS); },
    close: () => w.close(),
  };
}
