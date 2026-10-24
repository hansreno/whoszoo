// Small pure decisions for voice mode — no DOM, audio, network or timers.
// Loaded as a classic script before app.js (globalThis.VoiceLogic) and by the
// tests through require(). Keep `version` equal to APP_VERSION in app.js; an
// asset test enforces it, and app.js disables voice if they ever disagree.
(function (root) {
  "use strict";

  // Journal PTT: fold one recogniser onresult into the per-session text. Mobile
  // Chrome replays ~300 ms of the previous session's tail as an instant final,
  // so finals inside the echo guard are dropped — but the index still advances.
  function pttApplyResults(s, results, elapsed, echoGuardMs) {
    let sessionFinal = s.sessionFinal;
    let sessionFinalIdx = s.sessionFinalIdx;
    for (let i = sessionFinalIdx; i < results.length; i++) {
      if (results[i].isFinal) {
        if (elapsed >= echoGuardMs) sessionFinal += (sessionFinal ? " " : "") + results[i].transcript.trim();
        sessionFinalIdx = i + 1;
      }
    }
    let interim = "";
    for (let i = sessionFinalIdx; i < results.length; i++) interim += results[i].transcript;
    return { sessionFinal, sessionFinalIdx, interim };
  }

  function pttJoin(holdText, sessionFinal) {
    return holdText + (holdText && sessionFinal ? " " : "") + sessionFinal;
  }

  // Auto mode: Chrome stamps segments final at confidence boundaries, so finals
  // are accumulated and sent after a debounce. `dispatched` latches so a queued
  // post-stop() result can never send a second message.
  function createPendingFinals() {
    let items = [];
    let dispatched = false;
    const merged = () => items.join(" ").replace(/\s+/g, " ").trim();
    return {
      get dispatched() { return dispatched; },
      get size() { return items.length; },
      add(text, muted) {
        const t = String(text == null ? "" : text).trim();
        if (!t || muted) return false;
        items.push(t);
        return true;
      },
      merged,
      onTimer(muted) {
        if (dispatched) return { action: "ignore" };
        if (!items.length || muted) { items = []; return { action: "clear" }; }
        dispatched = true;
        const text = merged();
        items = [];
        return { action: "dispatch", text };
      },
      shouldFlushOnEnd(muted) { return items.length > 0 && !dispatched && !muted; },
    };
  }

  // The orb's class and the label under it, as functions of state. Returns
  // locale keys so app.js still translates with t().
  function orbClassFor({ phase, journal }) {
    return `conv-orb ${phase}${journal ? " journal" : ""}`;
  }

  function convLabelKeyFor({ phase, journal, muted, chunks }) {
    switch (phase) {
      case "idle": return "conv.label.idle";
      case "listening": return journal ? "conv.label.recording" : "conv.label.listening";
      case "thinking": return "conv.label.thinking";
      case "speaking": return "conv.label.speaking";
      case "paused": return journal ? (chunks === 0 ? "conv.label.hold-to-record" : "conv.label.chunks-ready") : "conv.label.paused";
      case "captured": return muted ? "conv.label.muted" : "conv.label.captured";
      default: return "";
    }
  }

  const api = { version: "1.9.2", pttApplyResults, pttJoin, createPendingFinals, orbClassFor, convLabelKeyFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VoiceLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
