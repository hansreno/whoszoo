// Scriptable fakes for every browser API voice mode touches. Each call is
// recorded into `trace`. The fidelity defaults in `cfg` model real browsers;
// change them only per scenario, and never to make a scenario pass.
export function installFakes(window, opts) {
  const { clock, trace, device } = opts;
  const t0 = clock.now();
  const rec = (k, d = {}) => trace.push({ t: clock.now() - t0, k, ...d });
  const cfg = {
    recognitionStopAsyncMs: 40,  // Chrome: stop() → onend arrives later
    abortSyncOnEnd: true,        // Chrome: abort() → onend synchronously (the PTT code relies on this)
    recorderStopAsyncMs: 10,     // MediaRecorder.stop() → dataavailable + onstop arrive later
    gumDelayMs: 0,               // getUserMedia resolve delay
    gumPlan: [],                 // per-call [{ delayMs, reject }]; empty → { delayMs: gumDelayMs }
    latencyMs: {},               // path -> response delay (default 200 ms)
    decodeDelayMs: 0,            // decodeAudioData resolve delay
    audioContextState: "running",
    speechSynthesis: device === "iphone" ? "noop" : "plays", // iOS ignores speak() outside a gesture
    transcript: "Remind me about Lily",
    reply: "Lily turns seven next Saturday.",
    routes: {},                  // path -> "ok" | "429" | "503" | "error" | "hang"
    ...(opts.fakes || {}),
  };
  const counts = {};
  const unrouted = [];
  const recognizers = [];
  let level = 0;

  // ---- clock ----
  for (const k of ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"]) {
    window[k] = clock[k];
  }
  const RealDate = window.Date;
  window.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.now()); else super(...a); }
    static now() { return clock.now(); }
  };
  Object.defineProperty(window.performance, "now", { configurable: true, value: () => clock.now() - t0 });

  // ---- small gaps in jsdom ----
  if (!window.TextDecoder) window.TextDecoder = TextDecoder;
  if (!window.TextEncoder) window.TextEncoder = TextEncoder;
  let blobSeq = 0;
  window.URL.createObjectURL = () => `blob:fake/${++blobSeq}`;
  window.URL.revokeObjectURL = () => {};
  window.Element.prototype.setPointerCapture = function () {};
  window.Element.prototype.releasePointerCapture = function () {};
  window.Element.prototype.hasPointerCapture = function () { return false; };
  window.Element.prototype.scrollIntoView = function () {};
  window.scrollTo = () => {};
  window.HTMLMediaElement.prototype.play = function () { rec("media.play"); return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () {};
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  Object.defineProperty(window.navigator, "vibrate", { configurable: true, value: () => true });
  let vis = "visible";
  Object.defineProperty(window.document, "visibilityState", { configurable: true, get: () => vis });
  Object.defineProperty(window.document, "hidden", { configurable: true, get: () => vis === "hidden" });

  // ---- microphone ----
  let streamSeq = 0;
  const makeStream = () => {
    const id = ++streamSeq;
    let enabled = true;
    const track = {
      kind: "audio", muted: false, readyState: "live", onended: null,
      stop() { if (this.readyState === "live") { this.readyState = "ended"; rec("track.stop", { stream: id }); } },
    };
    Object.defineProperty(track, "enabled", {
      get: () => enabled,
      set: (v) => { if (enabled !== !!v) { enabled = !!v; rec("track.enabled", { stream: id, value: enabled }); } },
    });
    return { id, getTracks: () => [track], getAudioTracks: () => [track] };
  };
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia() {
        rec("getUserMedia");
        const step = cfg.gumPlan.length ? cfg.gumPlan.shift() : { delayMs: cfg.gumDelayMs };
        return new Promise((res, rej) => clock.setTimeout(() => {
          if (step.reject) {
            rec("getUserMedia.rejected");
            const e = new Error("Permission denied"); e.name = "NotAllowedError";
            return rej(e);
          }
          const s = makeStream();
          rec("getUserMedia.resolved", { stream: s.id });
          res(s);
        }, step.delayMs || 0));
      },
    },
  });

  window.MediaRecorder = class {
    static isTypeSupported(t) { return device === "iphone" ? t === "audio/mp4" : t === "audio/webm"; }
    constructor(stream, o = {}) {
      this.stream = stream; this.mimeType = o.mimeType || ""; this.state = "inactive";
      this.ondataavailable = null; this.onstop = null; this._timer = null;
      rec("recorder.new", { stream: stream.id });
    }
    start(slice) {
      this.state = "recording"; rec("recorder.start");
      if (slice) this._timer = clock.setInterval(() => this._emit(), slice);
    }
    _emit() {
      if (this.ondataavailable) this.ondataavailable({ data: new window.Blob([new Uint8Array(800)], { type: this.mimeType || "audio/webm" }) });
    }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive"; clock.clearInterval(this._timer); rec("recorder.stop");
      clock.setTimeout(() => { this._emit(); if (this.onstop) this.onstop(); }, cfg.recorderStopAsyncMs);
    }
  };

  // ---- audio output and the silence detector ----
  let ctxSeq = 0;
  class FakeAudioContext {
    constructor() { this.id = ++ctxSeq; this.state = cfg.audioContextState; this.destination = {}; rec("audioContext.new", { ctx: this.id }); }
    get currentTime() { return (clock.now() - t0) / 1000; }
    resume() { rec("audioContext.resume", { ctx: this.id }); if (this.state !== "closed") this.state = "running"; return Promise.resolve(); }
    close() { rec("audioContext.close", { ctx: this.id }); this.state = "closed"; return Promise.resolve(); }
    // A disabled or stopped track delivers silence, as in a real browser.
    createAnalyser() { return { fftSize: 1024, _stream: null, getFloatTimeDomainData(buf) { const tr = this._stream && this._stream.getTracks()[0]; buf.fill(tr && (!tr.enabled || tr.readyState !== "live") ? 0 : level); } }; }
    createMediaStreamSource(stream) { return { connect(node) { if (node) node._stream = stream; return node; } }; }
    createOscillator() {
      // A real oscillator fires onended at its stop() time; the mic-on chime
      // closes its short-lived AudioContext from there.
      const p = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
      const ctx = this;
      const osc = { type: "sine", frequency: p, onended: null, connect(n) { return n; }, start() {},
        stop(at) { clock.setTimeout(() => { if (osc.onended) osc.onended(); }, Math.max(0, ((at || 0) - ctx.currentTime) * 1000)); } };
      return osc;
    }
    createGain() {
      const p = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
      return { gain: p, connect(n) { return n; } };
    }
    decodeAudioData() {
      if (!cfg.decodeDelayMs) return Promise.resolve({ duration: 1.5 });
      return new Promise((r) => clock.setTimeout(() => r({ duration: 1.5 }), cfg.decodeDelayMs));
    }
    createBufferSource() {
      const ctx = this;
      return {
        buffer: null, onended: null, _t: null, connect() {}, disconnect() {},
        start() { rec("tts.play", { ctx: ctx.id }); this._t = clock.setTimeout(() => { if (this.onended) this.onended(); }, ((this.buffer && this.buffer.duration) || 1) * 1000); },
        stop() { rec("tts.stop"); clock.clearTimeout(this._t); },
      };
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;

  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.onend = null; this.onerror = null; } };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak(u) { rec("browserVoice.speak", { chars: u.text.length }); if (cfg.speechSynthesis === "plays") clock.setTimeout(() => { if (u.onend) u.onend(); }, 1000); },
      cancel() { rec("browserVoice.cancel"); },
    },
  });

  // ---- browser speech recognition (Auto mode) ----
  class FakeRecognition {
    constructor() {
      this.id = recognizers.length + 1; recognizers.push(this);
      this.lang = ""; this.interimResults = false; this.continuous = false;
      this.onresult = null; this.onend = null; this.onerror = null;
      this._results = []; this._active = false;
      rec("recognizer.new", { r: this.id });
    }
    start() { this._active = true; rec("recognizer.start", { r: this.id }); }
    stop() {
      if (!this._active) return;
      this._active = false; rec("recognizer.stop", { r: this.id });
      clock.setTimeout(() => { if (this.onend) this.onend(); }, cfg.recognitionStopAsyncMs);
    }
    abort() {
      const was = this._active; this._active = false; rec("recognizer.abort", { r: this.id });
      if (was && cfg.abortSyncOnEnd && this.onend) this.onend();
    }
    // scenario helpers
    result(text, isFinal = true) {
      const r = [{ transcript: text }]; r.isFinal = isFinal;
      this._results.push(r);
      const ev = { resultIndex: this._results.length - 1, results: this._results.slice() };
      if (!isFinal) this._results.pop();
      if (this.onresult) this.onresult(ev);
    }
    end() { this._active = false; if (this.onend) this.onend(); }
    error(code) { this._active = false; if (this.onerror) this.onerror({ error: code }); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;

  // ---- network ----
  const abortErr = () => new window.DOMException("The operation was aborted.", "AbortError");
  const respond = (status, body, type = "application/json") => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : null) },
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => (body instanceof ArrayBuffer ? body : new ArrayBuffer(0)),
    blob: async () => new window.Blob([body instanceof ArrayBuffer ? new Uint8Array(body) : ""], { type }),
  });
  const chatStream = (text, signal) => {
    const enc = new TextEncoder();
    const third = Math.ceil(text.length / 3);
    const events = [0, 1, 2].map(i => text.slice(i * third, (i + 1) * third)).filter(Boolean)
      .map(v => `data: ${JSON.stringify({ t: "d", v })}\n\n`);
    events.push(`data: ${JSON.stringify({ t: "z", v: text, u: { input_tokens: 10, output_tokens: 5 } })}\n\n`);
    let i = 0;
    const r = respond(200, "", "text/event-stream");
    r.body = {
      getReader: () => ({
        read: () => new Promise((res, rej) => {
          if (signal && signal.aborted) return rej(abortErr());
          if (i >= events.length) return res({ done: true, value: undefined });
          const chunk = events[i++];
          clock.setTimeout(() => (signal && signal.aborted ? rej(abortErr()) : res({ done: false, value: enc.encode(chunk) })), 100);
        }),
        cancel() { return Promise.resolve(); },
        releaseLock() {},
      }),
    };
    return r;
  };
  window.fetch = (input, init = {}) => {
    const path = new URL(typeof input === "string" ? input : input.url, "https://example.test").pathname;
    counts[path] = (counts[path] || 0) + 1;
    const mode = cfg.routes[path] || "ok";
    rec("fetch", { path, mode });
    const signal = init.signal;
    return new Promise((res, rej) => {
      if (signal) {
        if (signal.aborted) return rej(abortErr());
        signal.addEventListener("abort", () => { rec("fetch.aborted", { path }); rej(abortErr()); });
      }
      const later = (fn) => clock.setTimeout(fn, cfg.latencyMs[path] ?? 200);
      if (mode === "hang") return;
      if (mode === "error") return later(() => rej(new TypeError("Failed to fetch")));
      if (mode === "429") return later(() => res(respond(429, { ok: false, error: "voice_allowance_exhausted" })));
      if (mode === "503") return later(() => res(respond(503, { ok: false, error: "ai_not_configured" })));
      switch (path) {
        case "/authStatus": return later(() => res(respond(200, { initialized: true })));
        case "/transcribe": return later(() => res(respond(200, { ok: true, text: cfg.transcript })));
        case "/speak": return later(() => res(respond(200, new ArrayBuffer(2000), "audio/mpeg")));
        case "/chat": return later(() => res(chatStream(cfg.reply, signal)));
        case "/getMemoryFile": return later(() => res(respond(200, "## Lily\n- Daughter of Maria\n", "text/plain")));
        case "/patchMemoryFile":
        case "/insertSection":
        case "/replaceSection": return later(() => res(respond(200, { ok: true, hash: "h1" })));
        default:
          unrouted.push(path); rec("fetch.unrouted", { path });
          return later(() => rej(new Error(`unrouted request: ${path}`)));
      }
    });
  };

  return {
    cfg, counts, unrouted, recognizers, rec,
    setLevel(v) { level = v; rec("level", { v }); },
    setVisibility(v) { vis = v; rec("visibility", { v }); window.document.dispatchEvent(new window.Event("visibilitychange")); },
  };
}
