// WhosZoo — Frontend App v1.8.49
const APP_VERSION = "1.8.49";

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const CONFIG_KEY       = "whoszoo_config";
const SESSION_KEY      = "whoszoo_session";
const JOURNAL_DRAFT_KEY = "whoszoo_journal_draft";
const TIMEOUT_KEY      = "whoszoo_timeout";
const WEBAUTHN_KEY      = "whoszoo_webauthn_cred";
const WEBAUTHN_SKIP_KEY = "whoszoo_webauthn_skip";
const VOICE_INPUT_KEY   = "whoszoo_voice_input";
const VOICE_PRIVACY_KEY = "whoszoo_voice_privacy_seen";
const TOKEN_SAVER_KEY   = "whoszoo_token_saver";
const WHISPER_LANG_KEY  = "whoszoo_whisper_lang";
const LANG_KEY          = "whoszoo_lang";

// Mirrors PASSPHRASE_MIN_LENGTH in worker.js. The worker enforces it; this is
// only so the user gets an instant message instead of a round trip. Checked
// solely when SETTING a passphrase — never on login, so an existing user with
// a shorter one is never blocked from their own app.
const PASSPHRASE_MIN_LENGTH = 12;

function helpUrl(from) {
  const lang = localStorage.getItem(LANG_KEY) || "en";
  const file = lang === "en" ? "help.html" : `help.${lang}.html`;
  return `${file}?from=${from}&v=${APP_VERSION}`;
}

// ---- WebAuthn helpers ----
function waB64urlToBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, "=");
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
function waBytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function waBytesToB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
const _savedTimeout = parseInt(localStorage.getItem(TIMEOUT_KEY) ?? "30", 10);
let inactivityMs = _savedTimeout === 0 ? Infinity : _savedTimeout * 60 * 1000;

let config  = { url: "" };
let session = null; // { token, expiresAt } — lives in sessionStorage, cleared on tab close
let _lastActivity = Date.now();
let messages = [];
let pendingWrite = null;
let writeQueue = [];      // remaining writes when a response proposes multiple
let writeQueueTotal = 0;  // total in current batch (for "X of Y" display)
let pendingDisambig = null; // { options: [...], query: "..." }

// ---- Conversation mode state ----
let convMode = false;
let convAudio = null;         // currently playing Audio object (HTMLMediaElement path)
let convAudioSource = null;   // currently playing AudioBufferSourceNode (AudioContext path)
let convRecognition = null;   // active recognition instance
let convState = "idle";       // idle | listening | thinking | speaking | paused
let convMuted = false;        // mic muted (audio unaffected)
let whisperTranscribeAbort = null; // AbortController for in-flight /transcribe fetch — only aborted on exit/hard-stop, NOT on mute
let journalDictating = false; // true when in a multi-turn journal dictation in conv mode
let noSpeechCount = 0;        // consecutive no-speech events while journalDictating
let convDoSend = null;        // set by convListen, called by orb tap in captured state
let convListenGen = 0;        // incremented each convListen() call; guards stale onend/onerror
const cmdHistory = [];        // terminal-style input history
let cmdHistoryIdx = -1;       // current position walking history; -1 = live input
let cmdHistoryDraft = "";     // saves in-progress text when walking back
let journalChunks = [];       // accumulated chunk texts — isolated from the chat messages array

let pendingAttachments = []; // array of { type, mimeType, base64, dataUrl, name } or { type:'text', text, name } — max 5
let _lastSentImage = null;    // { base64, mimeType } — captured before clearAttachment()
// "<file>::<section>" → { file, section, filenames } for every record in an
// active memory file that has photos. Keyed by file AND section because
// section headers collide across files far more easily than person names do
// (a dated "## 2026-08-30" can legitimately exist in both reflections.md and
// loops.md); the section name is kept in the value for chat-text matching.
let _recordsWithPhotos = new Map();
const _photoKey = (file, section) => `${file}::${section}`;

// Central mutators so the four call sites that keep this cache in sync after a
// photo add/delete can't drift apart on key shape.
function setRecordPhotos(file, section, filenames) {
  if (!file || !section) return;
  if (filenames.length) _recordsWithPhotos.set(_photoKey(file, section), { file, section, filenames });
  else _recordsWithPhotos.delete(_photoKey(file, section));
}
function addRecordPhoto(file, section, filename) {
  if (!file || !section) return;
  const existing = _recordsWithPhotos.get(_photoKey(file, section));
  const filenames = existing ? existing.filenames : [];
  if (!filenames.includes(filename)) setRecordPhotos(file, section, [...filenames, filename]);
}
let pendingRecallContext = null; // { section, file, content } — vault record injected into next chat
let attachmentsInHistory = []; // { name, type } of attachments already sent — stays until /cls
let dragCounter = 0;
let modelPref = localStorage.getItem("whoszoo_model") || "haiku";
let voicePref = localStorage.getItem("whoszoo_voice") || "marin";
const VOICES = ["brittney", "marin", "callum", "onyx"];
// archiveMode: 0=off, 1=archive tier on
// Migration: old "true"→1, "false"/"null"→0, "2"→1 (deep mode removed in v1.3.0)
const _rawArchive = localStorage.getItem("whoszoo_archive");
let archiveMode = (_rawArchive === "1" || _rawArchive === "2" || _rawArchive === "true") ? 1 : 0;
if (_rawArchive === "true" || _rawArchive === "false" || _rawArchive === "2") localStorage.setItem("whoszoo_archive", String(archiveMode));

// ---- Elements ----
const dropOverlay         = document.getElementById("drop-overlay");
const attachmentPreview   = document.getElementById("attachment-preview");
const attachBtn           = document.getElementById("attach-btn");
const stopBtn             = document.getElementById("stop-btn");
const fileInput           = document.getElementById("file-input");
const settingsScreen  = document.getElementById("settings-screen");
const loadingScreen   = document.getElementById("loading-screen");
const chatScreen      = document.getElementById("chat-screen");

// Keep all screens above the virtual keyboard on mobile
if (window.visualViewport) {
  const _onVV = () => {
    const h = window.visualViewport.height + 'px';
    const t = window.visualViewport.offsetTop + 'px';
    [settingsScreen, loadingScreen, chatScreen].forEach(s => { s.style.height = h; s.style.top = t; });
    // Cap textarea to 30% of visible viewport so keyboard never pushes it off-screen
    inputEl.style.maxHeight = Math.round(window.visualViewport.height * 0.30) + 'px';
  };
  window.visualViewport.addEventListener('resize', _onVV);
  window.visualViewport.addEventListener('scroll', _onVV);
}
const loadingText     = document.getElementById("loading-text");
const messagesEl      = document.getElementById("messages");
const inputEl         = document.getElementById("input");
const sendBtn         = document.getElementById("send-btn");
const settingsBtn     = document.getElementById("settings-btn");
const clsBtn          = document.getElementById("cls-btn");
const copyChatBtn     = document.getElementById("copy-chat-btn");
const settingsUrl             = document.getElementById("settings-url");
const settingsKey             = document.getElementById("settings-key");
const settingsSave            = document.getElementById("settings-save");
const setupForm               = document.getElementById("setup-form");
const loginForm               = document.getElementById("login-form");
const setupPassphraseEl       = document.getElementById("setup-passphrase");
const setupPassphraseConfirm  = document.getElementById("setup-passphrase-confirm");
const loginPassphraseEl       = document.getElementById("login-passphrase");
const loginBtn                = document.getElementById("login-btn");
const loginForgotBtn          = document.getElementById("login-forgot-btn");
const loginBiometricBtn       = document.getElementById("login-biometric-btn");
const settingsPanel           = document.getElementById("settings-panel");
const panelUrl                = document.getElementById("panel-url");
const panelSaveUrl            = document.getElementById("panel-save-url");
const panelChangePassphrase   = document.getElementById("panel-change-passphrase");
const panelSignout            = document.getElementById("panel-signout");
const panelMain               = document.getElementById("panel-main");
const cpForm                  = document.getElementById("panel-change-passphrase-form");
const cpCurrent               = document.getElementById("cp-current");
const cpNew                   = document.getElementById("cp-new");
const cpConfirm               = document.getElementById("cp-confirm");
const cpSave                  = document.getElementById("cp-save");
const cpCancel                = document.getElementById("cp-cancel");
const previewOverlay  = document.getElementById("preview-overlay");
const previewSummary  = document.getElementById("preview-summary");
const previewContent  = document.getElementById("preview-content");
const previewConfirm  = document.getElementById("preview-confirm");
const previewReject   = document.getElementById("preview-reject");
const toast           = document.getElementById("toast");
const convOverlay     = document.getElementById("conv-overlay");
const convCtxPct      = document.getElementById("conv-ctx-pct");
const convResetCtxBtn = document.getElementById("conv-reset-ctx");
const convOrb         = document.getElementById("conv-orb");
const convLabel       = document.getElementById("conv-label");
const convExit        = document.getElementById("conv-exit");
const convMuteBtn     = document.getElementById("conv-mute");
const convDiscardBtn    = document.getElementById("conv-discard");
const convFinishBtn     = document.getElementById("conv-finish");
const convTranscriptEl  = document.getElementById("conv-transcript");
const convBtn         = document.getElementById("conv-btn");
const journalBadge       = document.getElementById("journal-mode-badge");
const journalChunkListEl = document.getElementById("journal-chunk-list");
const journalExitDialog  = document.getElementById("journal-exit-dialog");
const convContent        = document.getElementById("conv-content");
const modelBtn        = document.getElementById("model-btn");
const cacheBadge      = document.getElementById("cache-badge");
const voiceBtn        = document.getElementById("conv-voice-btn");
const archiveBtn      = document.getElementById("archive-btn");
const convArchiveBtn  = document.getElementById("conv-archive-btn");
const chatHeader      = document.querySelector(".chat-header");
const cmdSuggestions  = document.getElementById("cmd-suggestions");

const COMMANDS = [
  { cmd: "/archive ",              desc: t("cmd.desc.archive") },
  { cmd: "/archive-review",        desc: t("cmd.desc.archive-review"), cost: "haiku" },
  { cmd: "/archive-review ignored",desc: t("cmd.desc.archive-review-ignored") },
  { cmd: "/deep ",                 desc: t("cmd.desc.deep") },
  { cmd: "/deep-review",           desc: t("cmd.desc.deep-review"), cost: "haiku" },
  { cmd: "/deep-review ignored",   desc: t("cmd.desc.deep-review-ignored") },
  { cmd: "/audit",                 desc: t("cmd.desc.audit") },
  { cmd: "/audit deep",            desc: t("cmd.desc.audit-deep"), cost: "haiku" },
  { cmd: "/audit ignored",         desc: t("cmd.desc.audit-ignored") },
  { cmd: "/restore ",              desc: t("cmd.desc.restore") },
  { cmd: "/cls",                   desc: t("cmd.desc.cls") },
  { cmd: "/compact ",              desc: t("cmd.desc.compact"), cost: "haiku" },
  // /compact-review takes an optional file arg with a finite set of valid
  // values. Same pattern as /browse — explicit entries collapse the
  // "which file?" decision into an arrow-key choice.
  { cmd: "/compact-review",             desc: t("cmd.desc.compact-review"), cost: "haiku" },
  { cmd: "/compact-review people",      desc: t("cmd.desc.compact-review-people"), cost: "haiku" },
  { cmd: "/compact-review loops",       desc: t("cmd.desc.compact-review-loops"), cost: "haiku" },
  { cmd: "/compact-review fragments",   desc: t("cmd.desc.compact-review-fragments"), cost: "haiku" },
  { cmd: "/compact-review reflections", desc: t("cmd.desc.compact-review-reflections"), cost: "haiku" },
  // /browse has a finite set of valid second-args (4 files × 3 tiers). Listed
  // explicitly so the autocomplete dropdown becomes a "menu" the user can
  // arrow-key through instead of a free-form text command. Also keeps Claude
  // out of the loop entirely — /browse is always handled client-side.
  { cmd: "/browse people",              desc: t("cmd.desc.browse-people") },
  { cmd: "/browse loops",               desc: t("cmd.desc.browse-loops") },
  { cmd: "/browse fragments",           desc: t("cmd.desc.browse-fragments") },
  { cmd: "/browse reflections",         desc: t("cmd.desc.browse-reflections") },
  { cmd: "/browse archive people",      desc: t("cmd.desc.browse-archive-people") },
  { cmd: "/browse archive loops",       desc: t("cmd.desc.browse-archive-loops") },
  { cmd: "/browse archive fragments",   desc: t("cmd.desc.browse-archive-fragments") },
  { cmd: "/browse archive reflections", desc: t("cmd.desc.browse-archive-reflections") },
  { cmd: "/browse cold people",         desc: t("cmd.desc.browse-cold-people") },
  { cmd: "/browse cold loops",          desc: t("cmd.desc.browse-cold-loops") },
  { cmd: "/browse cold fragments",      desc: t("cmd.desc.browse-cold-fragments") },
  { cmd: "/browse cold reflections",    desc: t("cmd.desc.browse-cold-reflections") },
  { cmd: "/costs",           desc: t("cmd.desc.costs") },
  { cmd: "/delete ",         desc: t("cmd.desc.delete") },
  { cmd: "/diagnostics",     desc: t("cmd.desc.diagnostics") },
  { cmd: "/security",        desc: t("cmd.desc.security") },
  { cmd: "/edit ",           desc: t("cmd.desc.edit") },
  { cmd: "/export",          desc: t("cmd.desc.export") },
  { cmd: "/export-plain",    desc: t("cmd.desc.export-plain") },
  { cmd: "/help",            desc: t("cmd.desc.help") },
  { cmd: "/import",          desc: t("cmd.desc.import") },
  { cmd: "/import-contacts", desc: t("cmd.desc.import-contacts") },
  { cmd: "/journal ",        desc: t("cmd.desc.journal"), cost: "chat" },
  { cmd: "/journal-flush",   desc: t("cmd.desc.journal-flush") },
  { cmd: "/memory-game",     desc: t("cmd.desc.memory-game"), cost: "chat" },
  { cmd: "/mnemonic ",       desc: t("cmd.desc.mnemonic"), cost: "chat" },
  { cmd: "/l",               desc: t("cmd.desc.l") },
  { cmd: "/r",               desc: t("cmd.desc.r") },
  { cmd: "/recall ",         desc: t("cmd.desc.recall") },
  { cmd: "/references ",     desc: t("cmd.desc.references") },
  { cmd: "/reset",           desc: t("cmd.desc.reset") },
];
const COST_INDICATOR = { haiku: ["¢", "cost-haiku"], chat: ["$", "cost-chat"] };
const archiveModal    = document.getElementById("archive-modal");
const archiveModalBody= document.getElementById("archive-modal-body");
const archiveConfirm  = document.getElementById("archive-modal-confirm");
const archiveCancel   = document.getElementById("archive-modal-cancel");
const archiveClose    = document.getElementById("archive-modal-close");
const deepModal       = document.getElementById("deep-modal");
const deepModalBody   = document.getElementById("deep-modal-body");
const deepConfirm     = document.getElementById("deep-modal-confirm");
const deepCancel      = document.getElementById("deep-modal-cancel");
const deepClose       = document.getElementById("deep-modal-close");
const compactModal    = document.getElementById("compact-modal");
const compactModalBody= document.getElementById("compact-modal-body");
const compactConfirm  = document.getElementById("compact-modal-confirm");
const compactCancel   = document.getElementById("compact-modal-cancel");
const compactClose    = document.getElementById("compact-modal-close");
const editModal       = document.getElementById("edit-modal");
const editModalSectionName = document.getElementById("edit-modal-section-name");
const editModalTierBadge   = document.getElementById("edit-modal-tier-badge");
const editModalTa          = document.getElementById("edit-modal-ta");
const editModalFindbar    = document.getElementById("edit-modal-findbar");
const editModalFindLabel  = document.getElementById("edit-modal-find-label");
const editModalFindPrev   = document.getElementById("edit-modal-find-prev");
const editModalFindNext   = document.getElementById("edit-modal-find-next");
const editModalError      = document.getElementById("edit-modal-error");
const editModalClose  = document.getElementById("edit-modal-close");
const editModalCancel = document.getElementById("edit-modal-cancel");
const editModalSave   = document.getElementById("edit-modal-save");
const editModalDelete = document.getElementById("edit-modal-delete");
const editModalMoveBtn1 = document.getElementById("edit-modal-move-btn1");
const editModalMoveBtn2 = document.getElementById("edit-modal-move-btn2");
const editModalCloseLoopBtn = document.getElementById("edit-modal-close-loop-btn");
const editModalReopenBtn    = document.getElementById("edit-modal-reopen-btn");
const editModalChecklist    = document.getElementById("edit-modal-checklist");
const editModalConfirmStrip   = document.getElementById("edit-modal-confirm-strip");
const editModalConfirmLabel   = document.getElementById("edit-modal-confirm-label");
const editModalConfirmCancel  = document.getElementById("edit-modal-confirm-cancel");
const editModalConfirmMove    = document.getElementById("edit-modal-confirm-move");
const deleteModal        = document.getElementById("delete-modal");
const deleteModalTarget  = document.getElementById("delete-modal-target");
const deleteModalContent = document.getElementById("delete-modal-content");
const deleteModalInput   = document.getElementById("delete-modal-input");
const deleteModalCancel  = document.getElementById("delete-modal-cancel");
const deleteModalConfirm = document.getElementById("delete-modal-confirm");
let deleteModalPending   = null; // { filename, section }
let currentEditTarget    = null; // { filename, section, occurrenceIndex }
const importFileInput    = document.getElementById("import-file-input");
const exportModal        = document.getElementById("export-modal");
const exportPwEl         = document.getElementById("export-pw");
const exportPw2El        = document.getElementById("export-pw2");
const exportModalErrorEl = document.getElementById("export-modal-error");
const exportModalConfirm = document.getElementById("export-modal-confirm");
const exportModalCancel  = document.getElementById("export-modal-cancel");
const importModal        = document.getElementById("import-modal");
const importPhase1       = document.getElementById("import-phase1");
const importPhase2       = document.getElementById("import-phase2");
const importFilenameEl   = document.getElementById("import-filename");
const importPwEl         = document.getElementById("import-pw");
const importModalErrorEl = document.getElementById("import-modal-error");
const importModalDecrypt = document.getElementById("import-modal-decrypt");
const importModalCancel  = document.getElementById("import-modal-cancel");
const importSummaryEl    = document.getElementById("import-summary");
const importConfirmInput = document.getElementById("import-confirm-input");
const importModalError2  = document.getElementById("import-modal-error2");
const importModalConfirmBtn = document.getElementById("import-modal-confirm");
const importModalCancel2 = document.getElementById("import-modal-cancel2");
const importModalBack    = document.getElementById("import-modal-back");
let importPendingPayload = null;
const accessKeyGateModal   = document.getElementById("access-key-gate-modal");
const accessKeyGateInput   = document.getElementById("access-key-gate-input");
const accessKeyGateError   = document.getElementById("access-key-gate-error");
const accessKeyGateConfirm = document.getElementById("access-key-gate-confirm");
const accessKeyGateCancel  = document.getElementById("access-key-gate-cancel");
let accessKeyGateCallback  = null;
const exportZipModal     = document.getElementById("export-zip-modal");
const exportZipInput     = document.getElementById("export-zip-input");
const exportZipError     = document.getElementById("export-zip-error");
const exportZipConfirm   = document.getElementById("export-zip-confirm");
const exportZipCancel    = document.getElementById("export-zip-cancel");
const resetModal         = document.getElementById("reset-modal");
const resetAccessKey     = document.getElementById("reset-access-key");
const resetConfirmWord   = document.getElementById("reset-confirm-word");
const resetNewName       = document.getElementById("reset-new-name");
const resetError         = document.getElementById("reset-error");
const resetConfirmBtn    = document.getElementById("reset-confirm");
const resetCancelBtn     = document.getElementById("reset-cancel");
const contextAttachBar   = document.getElementById("context-attach-bar");
const contextAttachNames = document.getElementById("context-attach-names");

// Vault context clear button
document.getElementById("vault-context-clear").addEventListener("click", () => {
  pendingRecallContext = null;
  updateVaultBar();
  updateMemoryBadge(_workingBytes); // drop the vault-tokens line from the badge tooltip
  appendMessage("system", t("chat.cold-storage-cleared"));
});

// ---- Command Autocomplete ----
let cmdActiveIdx = -1;

function updateCmdSuggestions() {
  const val = inputEl.value;
  if (!val.startsWith("/")) { hideCmdSuggestions(); return; }
  const lower = val.toLowerCase();
  const matches = COMMANDS.filter(c => c.cmd.startsWith(lower)).sort((a, b) => a.cmd.localeCompare(b.cmd));
  if (matches.length === 0 || (matches.length === 1 && matches[0].cmd === val)) {
    hideCmdSuggestions(); return;
  }
  cmdActiveIdx = -1;
  cmdSuggestions.innerHTML = "";
  matches.forEach(item => {
    const div = document.createElement("div");
    div.className = "cmd-suggestion";
    const matched = item.cmd.slice(0, val.length);
    const rest = item.cmd.slice(val.length);
    const [costChar, costClass] = COST_INDICATOR[item.cost] || ["", ""];
    const costSpan = costChar ? ` <span class="cmd-cost ${costClass}">${costChar}</span>` : "";
    div.innerHTML = `<strong>${matched}</strong>${rest} <span class="cmd-desc">${item.desc}</span>${costSpan}`;
    div.addEventListener("mousedown", e => {
      e.preventDefault();
      inputEl.value = item.cmd;
      hideCmdSuggestions();
      inputEl.focus();
    });
    cmdSuggestions.appendChild(div);
  });
  cmdSuggestions.classList.remove("hidden");
}

function hideCmdSuggestions() {
  cmdSuggestions.classList.add("hidden");
  cmdSuggestions.innerHTML = "";
  cmdActiveIdx = -1;
}

function updateActiveItem() {
  const items = cmdSuggestions.querySelectorAll(".cmd-suggestion");
  items.forEach((el, i) => el.classList.toggle("active", i === cmdActiveIdx));
  if (cmdActiveIdx >= 0 && items[cmdActiveIdx]) {
    items[cmdActiveIdx].scrollIntoView({ block: "nearest" });
  }
}

// ---- Memory Health Check ----
// ---- Memory health teaching ladder ----
// Reads diagnostics output and decides what to teach based on combined %
// (active + archive vs Claude's budget) and which "track" the user is in
// (track is determined by archive size — early phase doesn't yet introduce
// cold storage; established users get the cold-storage lever).
//
// Threshold table:                 Track A vs B based on archive size:
//   < 50%  silent                    < 20% of cap  → Track A (early phase)
//   70-85% info  📦                   20-40%        → Track AB (transition)
//   85-95% warn  ⚠                    >= 40%        → Track B (established)
//   >= 95% urgent 🚨
function _memoryHealth(d) {
  const cap          = d.tokenBudget.cap;
  const activeTokens = d.tokenBudget.used;
  const archiveTokens = (d.archiveBudget && d.archiveBudget.tokens) || 0;
  const combinedPct  = Math.round((activeTokens + archiveTokens) / cap * 100);
  const archivePct   = Math.round(archiveTokens / cap * 100);
  const activeK   = Math.round(activeTokens / 1000);
  const archiveK  = Math.round(archiveTokens / 1000);

  let tier;
  if (combinedPct >= 95) tier = "urgent";
  else if (combinedPct >= 85) tier = "warn";
  else if (combinedPct >= 70) tier = "info";
  else tier = "ok";

  let track;
  if (archivePct < 20) track = "A";
  else if (archivePct < 40) track = "AB";
  else track = "B";

  return { tier, track, combinedPct, activeTokens, archiveTokens, activeK, archiveK, cap };
}

function _firstTimeIntro(h) {
  const stat = `**${h.activeK}K active + ${h.archiveK}K archive · ${h.combinedPct}% of Claude's budget combined.**`;
  if (h.track === "A") {
    return [
      `📦 Your memory is starting to fill up — ${stat}`,
      "",
      "WhosWhoZoo's memory has three tiers — now's a good moment to meet the second one.",
      "",
      "  • Active — what's loaded into every chat",
      "  • Archive — older records, loaded only when 📦 Archive is ON",
      "  • Cold storage — searchable forever, never auto-loaded (we'll come back to this when you need it)",
      "",
      "When active fills up, you have a few ways to free space:",
      "",
      "  • /archive-review — AI suggests records to move into archive",
      "  • /compact-review — AI suggests verbose records you can tighten in place",
      "  • /browse people (or any file) — see all records sorted by size",
      "  • Open any record with /edit [name] and tap → Archive to move it manually",
      "",
      "No rush. Run any of these when you have five minutes.",
    ].join("\n");
  }
  if (h.track === "AB") {
    return [
      `📦 Your memory is filling up — ${stat}`,
      "",
      "You've started archiving (good — that's the second tier). Now's a good moment to meet the third:",
      "",
      "  • Active + Archive — what you already know",
      "  • **Cold storage** — kept forever, searchable via /recall, never auto-loaded. Unlimited size.",
      "",
      "Two paths from here:",
      "",
      "  • /archive-review — move more active records into archive",
      "  • /deep-review — move older archive records into cold storage",
      "",
      "To inspect what you have: /browse archive people shows archived people sorted by size. From any /edit [name] modal, the → Cold button moves a record directly. They stay yours — /recall [name or topic] finds anything in cold storage instantly.",
    ].join("\n");
  }
  // Track B
  return [
    `📦 You've got a substantial archive — ${stat}`,
    "",
    "You've been archiving regularly. The third tier is what unblocks long-term growth:",
    "",
    "**Cold storage** — records you keep but never auto-load. Searchable via /recall [name or topic]. **Unlimited.**",
    "",
    "Three ways to start:",
    "",
    "  • /deep-review — AI surfaces archive records to move",
    "  • /browse archive people — see archived records sorted by size; pick the heaviest",
    "  • /edit [name] → tap → Cold to move one directly",
    "",
    "Nothing is deleted. /recall brings it back; /restore [name] undoes a move.",
  ].join("\n");
}

function _repeatNudge(h) {
  const stat = `${h.combinedPct}% combined (${h.activeK}K active + ${h.archiveK}K archive)`;
  // Tier 70-85
  if (h.tier === "info") {
    if (h.track === "A")  return `📦 Memory at ${stat}. /archive-review to surface candidates, or /browse to see records by size.`;
    if (h.track === "AB") return `📦 Memory at ${stat}. /archive-review for active → archive, or /deep-review to start moving archive → cold storage.`;
    return                       `📦 Memory at ${stat}. /deep-review to move older archive items to cold storage. /browse archive to see them by size.`;
  }
  // Tier 85-95
  if (h.tier === "warn") {
    if (h.track === "A")  return `⚠ Memory at ${stat}. Active is filling up — /archive-review or /compact-review to free space.`;
    if (h.track === "AB") return `⚠ Memory at ${stat}. /archive-review and /deep-review both help. /restore [name] if you move something by mistake.`;
    return                       `⚠ Memory at ${stat}. Run /deep-review soon — combined is close to Claude's limit. /browse archive shows what's biggest.`;
  }
  // Tier 95+
  if (h.track === "A")  return `🚨 Memory at ${stat}. About to hit Claude's context limit. Run /archive-review to move records to archive now.`;
  if (h.track === "AB") return `🚨 Memory at ${stat}. Turning Archive ON will exceed Claude's context window. Run /archive-review and /deep-review now.`;
  return                       `🚨 Memory at ${stat}. Turning Archive ON will exceed Claude's context window — your message will fail. Run /deep-review now.`;
}

async function checkDailyBrief() {
  try {
    const today = new Date().toLocaleDateString("en-CA");
    const todayMs = new Date(today).getTime();
    const weekMs = todayMs + 7 * 24 * 60 * 60 * 1000;

    const res = await api("/getMemoryFile?filename=loops.md", "GET");
    if (!res.ok) return;
    const text = await res.text();
    const lines = text.split("\n");

    // Parse loop sections — use FIRST status occurrence (canonical)
    const loops = [];
    let cur = null, inNextSteps = false;
    const flush = () => {
      if (!cur) return;
      const st = (cur.status || "").toLowerCase();
      if (st === "closed" || st === "resolved") { cur = null; inNextSteps = false; return; }
      loops.push(cur);
      cur = null; inNextSteps = false;
    };
    for (const line of lines) {
      const hm = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s+[-–]\s+(.+)/);
      if (hm) {
        flush();
        cur = { fullTitle: hm[1] + " – " + hm[2].trim(), title: hm[2].trim(), date: hm[1], status: "", due: "", totalItems: 0, doneItems: 0 };
        inNextSteps = false;
        continue;
      }
      if (!cur) continue;
      // Track ### subsections — enter/exit Next Steps
      if (/^###\s+Next Steps/i.test(line)) { inNextSteps = true; continue; }
      if (/^###/.test(line)) { inNextSteps = false; continue; }
      const sm = line.match(/^[-–]\s+Status:\s*(.+)/i);
      if (sm && !cur.status) { cur.status = sm[1].trim(); continue; } // first occurrence only
      const dm = line.match(/^[-–]\s+Due:\s*(\d{4}-\d{2}-\d{2})/i);
      if (dm) { cur.due = dm[1].trim(); continue; }
      // New checkbox format (flat body)
      if (/^[-–]\s+\[x\]/i.test(line)) { cur.totalItems++; cur.doneItems++; continue; }
      if (/^[-–]\s+\[ \]/.test(line)) { cur.totalItems++; continue; }
      // Old format: plain bullets inside ### Next Steps count as unchecked items
      if (inNextSteps && /^[-–]\s+\S/.test(line) && !/^[-–]\s+\w+:/i.test(line)) { cur.totalItems++; }
    }
    flush();

    // Categorise: overdue/today/week by due date, OR has unchecked items, OR recently created
    const overdue = [], dueToday = [], dueWeek = [], hasItems = [], recent = [];
    for (const lp of loops) {
      let placed = false;
      if (lp.due) {
        const dueMs = new Date(lp.due).getTime();
        if (!isNaN(dueMs)) {
          if (dueMs < todayMs)      { overdue.push(lp);  placed = true; }
          else if (dueMs === todayMs){ dueToday.push(lp); placed = true; }
          else if (dueMs <= weekMs)  { dueWeek.push(lp);  placed = true; }
          // due date > 1 week away — fall through to hasItems/recent check
        }
      }
      if (!placed) {
        if (lp.totalItems > 0 && lp.doneItems < lp.totalItems) {
          hasItems.push(lp);
        } else {
          recent.push(lp); // any open loop with no due date and no items
        }
      }
    }

    const allEntries = [...overdue, ...dueToday, ...dueWeek, ...hasItems, ...recent];
    if (!allEntries.length) return;

    // Build tappable brief element
    const wrapper = document.createElement("div");
    wrapper.className = "message system";

    const header = document.createElement("div");
    const parts = [];
    if (overdue.length)  parts.push(t("brief.part-overdue",    { n: overdue.length }));
    if (dueToday.length) parts.push(t("brief.part-due-today",  { n: dueToday.length }));
    if (dueWeek.length)  parts.push(t("brief.part-due-week",   { n: dueWeek.length }));
    if (hasItems.length) parts.push(t("brief.part-open-tasks", { n: hasItems.length }));
    if (recent.length)   parts.push(t("brief.part-new",        { n: recent.length }));
    header.textContent = t("brief.header", { summary: parts.join(", ") });
    header.style.cssText = "margin-bottom:8px;font-size:13px;";
    wrapper.appendChild(header);

    const list = document.createElement("div");
    list.className = "delete-results-list";

    const addRow = (lp, badge) => {
      const row = document.createElement("div");
      row.className = "delete-result-btn";
      row.tabIndex = 0;
      const nameSpan = document.createElement("span");
      nameSpan.className = "delete-result-name";
      nameSpan.textContent = lp.title;
      const previewSpan = document.createElement("span");
      previewSpan.className = "delete-result-preview";
      let hint = badge;
      if (lp.totalItems > 0) hint += (hint ? " · " : "") + `${lp.doneItems}/${lp.totalItems} done`;
      previewSpan.textContent = hint;
      row.appendChild(nameSpan);
      row.appendChild(previewSpan);
      const openModal = async () => {
        try {
          const r = await api(`/getMemoryFile?filename=loops.md&section=${encodeURIComponent(lp.fullTitle)}`, "GET");
          if (!r.ok) { showToast(t("brief.toast-load-failed")); return; }
          const content = await r.text();
          showEditModal(lp.fullTitle, "loops.md", content, null);
        } catch { showToast(t("brief.toast-open-failed")); }
      };
      row.addEventListener("click", openModal);
      row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openModal(); });
      list.appendChild(row);
    };

    overdue.forEach(lp  => addRow(lp, t("brief.badge-overdue",    { date: lp.due })));
    dueToday.forEach(lp => addRow(lp, t("brief.badge-due-today")));
    dueWeek.forEach(lp  => addRow(lp, t("brief.badge-due-date",   { date: lp.due })));
    hasItems.forEach(lp => addRow(lp, t("brief.badge-open-tasks")));
    recent.forEach(lp   => addRow(lp, t("brief.badge-new")));

    wrapper.appendChild(list);

    const hint = document.createElement("div");
    hint.style.cssText = "font-size:12px;color:var(--text-dim);margin-top:6px;";
    hint.textContent = t("brief.hint");
    wrapper.appendChild(hint);

    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch {}
}

async function checkMemoryHealth() {
  try {
    const res = await api("/diagnostics", "GET");
    const d = await res.json();
    if (!d.ok) return;
    const h = _memoryHealth(d);
    if (h.tier === "ok") {
      // Reset the intro flag once user drops below 50% so a future re-introduction
      // can fire if they grow again later.
      if (h.combinedPct < 50) localStorage.removeItem("whoszoo_lifecycle_intro_seen");
      return;
    }
    const seen = localStorage.getItem("whoszoo_lifecycle_intro_seen");
    if (!seen) {
      appendMessage("system", _firstTimeIntro(h));
      localStorage.setItem("whoszoo_lifecycle_intro_seen", "1");
    } else {
      appendMessage("system", _repeatNudge(h));
    }
  } catch { /* silent — background check */ }
}

// ---- Installer link card visibility (login + setup screens only) ----
function _showInstallerDownloads(visible) {
  const dlEl = document.getElementById('installer-downloads');
  if (dlEl) dlEl.classList.toggle('hidden', !visible);
}

// ---- Init ----
function init() {
  applyLocale();
  // Sync language dropdown to saved pref
  const langSelect = document.getElementById("panel-language");
  if (langSelect) langSelect.value = localStorage.getItem(LANG_KEY) || "en";
  const whisperLangSelect = document.getElementById("panel-whisper-lang");
  if (whisperLangSelect) whisperLangSelect.value = localStorage.getItem(WHISPER_LANG_KEY) || "en";
  const savedConfig  = localStorage.getItem(CONFIG_KEY);
  const savedSession = sessionStorage.getItem(SESSION_KEY);

  if (savedConfig) {
    const parsed = JSON.parse(savedConfig);
    config = { url: parsed.url || "" };
    // Drop legacy key from storage if it's still there
    if (parsed.key) localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: config.url }));
  } else {
    // No saved config — default to this origin so an already-initialized worker shows
    // the login screen instead of setup on new browsers / incognito sessions.
    config.url = window.location.origin;
  }

  if (savedSession) {
    try {
      const s = JSON.parse(savedSession);
      if (s.token && s.expiresAt > Date.now()) {
        session = s;
        startSession();
        return;
      }
    } catch {}
  }

  // If we have a URL, optimistically show login (the common case for returning users)
  // and probe /authStatus in the background. If the worker hasn't been initialized
  // yet (fresh install — auth_config doesn't exist in KV), swap to setup screen.
  // No URL at all = unambiguous setup screen.
  if (config.url) {
    showLoginScreen();
    fetch(config.url + "/authStatus", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || d.initialized !== false) return;
        // Don't clobber the user's in-progress typing. If they've started entering
        // a passphrase before the probe resolved, leave the login screen up — the
        // doLogin handler already routes "not_initialized" responses to the setup
        // screen, so they're not stuck.
        if (loginPassphraseEl && loginPassphraseEl.value.length > 0) return;
        showSetupScreen(config.url);
      })
      .catch(() => { /* network blip — leave login screen up; user gets a clearer error if they try to unlock */ });
  } else {
    showSetupScreen();
  }
}

function show(screen) {
  [settingsScreen, loadingScreen, chatScreen].forEach(s => s.classList.add("hidden"));
  screen.classList.remove("hidden");
}

function showSetupScreen(url = "", key = "", mode = "setup") {
  document.getElementById("settings-subtitle").textContent = mode === "recovery"
    ? t("setup.subtitle-recovery")
    : t("setup.subtitle-new");
  setupForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  document.getElementById("settings-help-link").classList.remove("hidden");
  _showInstallerDownloads(true);
  settingsUrl.value = url || window.location.origin;
  settingsKey.value = key;
  setupPassphraseEl.value = "";
  setupPassphraseConfirm.value = "";
  show(settingsScreen);
}

function showLoginScreen() {
  // First-time visitors (no saved config) and returning users both land here when
  // there's a worker URL set. Saved config = returning user; no saved config =
  // someone who clicked a shared link and may not realize this is a personal app.
  const isReturning = !!localStorage.getItem(CONFIG_KEY);
  document.getElementById("settings-subtitle").textContent = isReturning
    ? t("login.subtitle-returning")
    : t("login.subtitle-new-visitor");
  setupForm.classList.add("hidden");
  loginForm.classList.remove("hidden");
  settingsPanel.classList.add("hidden");
  document.getElementById("settings-help-link").classList.remove("hidden");
  _showInstallerDownloads(true);
  loginPassphraseEl.value = "";
  show(settingsScreen);
  const credId = localStorage.getItem(WEBAUTHN_KEY);
  if (credId && window.PublicKeyCredential && config.url) {
    loginBiometricBtn.classList.remove("hidden");
    triggerBiometricUnlock(credId);
  } else {
    loginBiometricBtn.classList.add("hidden");
    setTimeout(() => loginPassphraseEl.focus(), 100);
  }
}

async function triggerBiometricUnlock(credId) {
  if (_loginInProgress) return;
  if (session) return; // stale event fired after a completed login
  _loginInProgress = true;
  try {
    const chalRes = await fetch(config.url + "/webauthn-challenge", { method: "POST", headers: { "Content-Type": "application/json" } });
    const { challenge } = await chalRes.json();
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: waB64urlToBytes(challenge),
        rpId: window.location.hostname,
        allowCredentials: [{ id: waB64urlToBytes(credId), type: "public-key" }],
        userVerification: "required",
        timeout: 60000
      }
    });
    const body = {
      credentialId: waBytesToB64url(new Uint8Array(assertion.rawId)),
      authenticatorData: waBytesToB64url(new Uint8Array(assertion.response.authenticatorData)),
      clientDataJSON:    waBytesToB64url(new Uint8Array(assertion.response.clientDataJSON)),
      signature:         waBytesToB64url(new Uint8Array(assertion.response.signature))
    };
    const res = await fetch(config.url + "/webauthn-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Biometric auth failed");
    saveSession(data.token, data.expiresAt);
    show(chatScreen);
    inputEl.focus();
    const isResume = sessionStorage.getItem("whoszoo_resume") === "1" && messages.length > 0;
    sessionStorage.removeItem("whoszoo_resume");
    if (isResume) {
      _lastActivity = Date.now();
    } else {
      startSession(true);
    }
  } catch (err) {
    if (err.name === "NotAllowedError") {
      // User cancelled or OS timed out — keep button visible for retry.
      return;
    }
    // Other errors (network blip, transient WebAuthn failure, post-timeout-lock
    // edge cases on iOS Safari) — surface the error but KEEP the button visible
    // so the user can tap it again. Hiding it strands the user on passphrase
    // entry even though they've already enrolled biometrics. Hans hit this on
    // mobile after the inactivity timeout fired.
    showToast(err.message || "Biometric failed — try again or enter your passphrase.");
    setTimeout(() => loginPassphraseEl.focus(), 100);
  } finally {
    _loginInProgress = false;
  }
}

function lockApp() {
  session = null;
  _loginInProgress = false;
  _sessionStarting = false;
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.setItem("whoszoo_resume", "1"); // unlock resumes this conversation
  // Abort any in-flight stream/TTS and fully tear down conv mode so memory
  // content isn't read aloud and the mic isn't live over the lock screen.
  if (convChatAbort)  { convChatAbort.abort();  convChatAbort  = null; }
  if (convSpeakAbort) { convSpeakAbort.abort(); convSpeakAbort = null; }
  if (convMode) {
    stopConvAudio();
    stopThinkingSound();
    if (thinkingAudioCtx) { try { thinkingAudioCtx.close(); } catch {} thinkingAudioCtx = null; }
    stopConvRecognition();
    stopSilenceDetection(true);
    if (whisperRecorder) { try { whisperRecorder.stop(); } catch {} whisperRecorder = null; whisperChunks = []; }
    if (whisperStream)   { try { whisperStream.getTracks().forEach(t => t.stop()); } catch {} whisperStream = null; }
    convMode = false;
    journalDictating = false;
  }
  // Cancel any pending write proposal so it doesn't silently disappear
  if (pendingWrite) {
    pendingWrite = null;
    writeQueue = [];
    writeQueueTotal = 0;
    appendMessage("system", "A pending memory update was cancelled by the inactivity lock. Ask again after unlocking.");
  }
  // Hide all overlays so memory content isn't visible over the lock screen
  closeEditModal();
  previewOverlay.classList.add("hidden");
  deleteModal.classList.add("hidden");
  convOverlay.classList.add("hidden");
  closeLightbox();
  // Restore send/stop button state (finally block in sendMessage may not run if
  // the abort propagates before sendMessage gets a chance to reach it)
  stopBtn.classList.add("hidden");
  sendBtn.classList.remove("hidden");
  // Remove any stale thinking indicators
  messagesEl.querySelectorAll(".message.thinking").forEach(el => el.remove());
  showLoginScreen();
  // _contextTokens/_historyTokens/_messages left intact — restored on resume
}

function saveSession(token, expiresAt) {
  session = { token, expiresAt };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

// ---- Inactivity timer ----
["click", "keydown", "touchstart"].forEach(e =>
  document.addEventListener(e, () => { _lastActivity = Date.now(); }, { passive: true })
);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && session && Date.now() - _lastActivity > inactivityMs) lockApp();
});
setInterval(() => {
  if (session && Date.now() - _lastActivity > inactivityMs) lockApp();
}, 60_000);

// ---- Back-button intercept ----
// Mobile system back / browser back was yanking the user clean out of the app
// when they were signed in. Push one history entry at boot so the FIRST back
// press is captured by popstate; if the user is signed in, ask to confirm
// sign-out. If they cancel, re-push the entry so the next back can be caught
// again. If session is already null (user already on login screen), let the
// normal back proceed.
history.pushState({ app: "whoszoo" }, "");
window.addEventListener("popstate", () => {
  if (!session) return; // already logged out — normal back behavior
  if (confirm("Sign out of WhosWhoZoo?")) {
    lockApp();
    // After lockApp, leave the consumed state alone — a second back-press
    // should now exit the app cleanly since the user explicitly chose to leave.
  } else {
    history.pushState({ app: "whoszoo" }, "");
  }
});

// ---- Setup (first time / recovery) ----
settingsSave.addEventListener("click", async () => {
  const url        = settingsUrl.value.trim().replace(/\/$/, "");
  const key        = settingsKey.value.trim();
  const passphrase = setupPassphraseEl.value;
  const confirm    = setupPassphraseConfirm.value;
  if (!url || !key) { showToast(t("toast.fill-worker-key")); return; }
  if (!passphrase || passphrase.length < PASSPHRASE_MIN_LENGTH) { showToast(t("toast.passphrase-too-short")); return; }
  if (passphrase !== confirm) { showToast(t("toast.passphrase-mismatch")); return; }

  settingsSave.disabled = true;
  settingsSave.textContent = t("setup.btn-setup-loading");
  try {
    const res = await fetch(url + "/initPassword", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Worker-Key": key },
      body: JSON.stringify({ password: passphrase }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Setup failed");
    config = { url };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    saveSession(data.token, data.expiresAt);
    startSession();
  } catch (err) {
    showToast(err.message === "Failed to fetch" ? t("toast.worker-fetch-failed") : err.message);
  } finally {
    settingsSave.disabled = false;
    settingsSave.textContent = t("setup.btn-setup");
  }
});

// ---- Login (returning user) ----
loginBtn.addEventListener("click", doLogin);
loginPassphraseEl.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
loginBiometricBtn.addEventListener("click", () => {
  const credId = localStorage.getItem(WEBAUTHN_KEY);
  if (credId) triggerBiometricUnlock(credId);
});

let _loginInProgress = false;
async function doLogin() {
  const passphrase = loginPassphraseEl.value;
  if (!passphrase) { showToast(t("toast.enter-passphrase")); return; }
  if (_loginInProgress) return;
  if (session) return; // stale event fired after a completed login
  _loginInProgress = true;
  loginBtn.disabled = true;
  loginBtn.textContent = t("login.btn-unlock-loading");
  try {
    const res = await fetch(config.url + "/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passphrase }),
    });
    const data = await res.json();
    if (!data.ok) {
      if (data.error === "not_initialized") {
        showToast(t("toast.no-passphrase-set"));
        showSetupScreen(config.url);
      } else if (res.status === 429) {
        showToast(data.error || "Too many failed attempts — try again in 5 minutes.", 6000);
      } else {
        showToast(t("toast.incorrect-passphrase"));
      }
      return;
    }
    saveSession(data.token, data.expiresAt);
    if (window.PublicKeyCredential && !localStorage.getItem(WEBAUTHN_KEY) && !localStorage.getItem(WEBAUTHN_SKIP_KEY)) {
      sessionStorage.setItem("whoszoo_offer_biometric", "1");
    }
    show(chatScreen);
    inputEl.focus();
    const isResume = sessionStorage.getItem("whoszoo_resume") === "1" && messages.length > 0;
    sessionStorage.removeItem("whoszoo_resume");
    if (isResume) {
      // Conversation is still in memory — just restore activity timer
      _lastActivity = Date.now();
    } else {
      startSession(true);
    }
  } catch { showToast(t("toast.connection-failed")); }
  finally {
    loginBtn.disabled = false;
    loginBtn.textContent = t("login.btn-unlock");
    _loginInProgress = false;
  }
}

loginForgotBtn.addEventListener("click", () => showSetupScreen(config.url, "", "recovery"));

// ---- Logged-in Settings Panel ----
const panelAdvancedToggle = document.getElementById("panel-advanced-toggle");
const panelAdvanced       = document.getElementById("panel-advanced");
const panelAdvancedCaret  = document.getElementById("panel-advanced-caret");
const panelTimeout        = document.getElementById("panel-timeout");
const panelVoiceInput     = document.getElementById("panel-voice-input");
const panelCostCap        = document.getElementById("panel-cost-cap");
const panelTokenSaver     = document.getElementById("panel-token-saver");

const apikeyRows = [
  { key: "ANTHROPIC_API_KEY", input: document.getElementById("apikey-anthropic"),    save: document.getElementById("apikey-anthropic-save"),    status: document.getElementById("apikey-anthropic-status"),    clear: document.getElementById("apikey-anthropic-clear") },
  { key: "OPENAI_API_KEY",    input: document.getElementById("apikey-openai"),        save: document.getElementById("apikey-openai-save"),        status: document.getElementById("apikey-openai-status"),        clear: document.getElementById("apikey-openai-clear") },
  { key: "ELEVENLABS_API_KEY",input: document.getElementById("apikey-elevenlabs"),    save: document.getElementById("apikey-elevenlabs-save"),    status: document.getElementById("apikey-elevenlabs-status"),    clear: document.getElementById("apikey-elevenlabs-clear") },
];

panelTimeout.value = String(_savedTimeout);
panelTimeout.addEventListener("change", () => {
  const mins = parseInt(panelTimeout.value, 10);
  localStorage.setItem(TIMEOUT_KEY, String(mins));
  inactivityMs = mins === 0 ? Infinity : mins * 60 * 1000;
  showToast(mins === 0 ? t("toast.autolock-disabled") : t("toast.autolock-set", { label: panelTimeout.options[panelTimeout.selectedIndex].text }));
});

let voiceInputPref = localStorage.getItem(VOICE_INPUT_KEY) || "auto";
panelVoiceInput.addEventListener("change", () => {
  voiceInputPref = panelVoiceInput.value;
  localStorage.setItem(VOICE_INPUT_KEY, voiceInputPref);
  const label = t(voiceInputPref === "whisper" ? "settings.opt-whisper" : "settings.opt-auto");
  showToast(t("toast.voice-input-set", { label }));
  // Re-evaluate conv button availability with new pref
  const canVoice = hasSpeechRecognition() || useWhisper();
  convBtn.style.opacity  = canVoice ? "" : "0.35";
  convBtn.style.cursor   = canVoice ? "" : "not-allowed";
  convBtn.title          = canVoice ? "" : "Voice not supported in this browser";
});

panelAdvancedToggle.addEventListener("click", () => {
  const open = !panelAdvanced.classList.contains("hidden");
  panelAdvanced.classList.toggle("hidden", open);
  panelAdvancedCaret.classList.toggle("open", !open);
  if (!open) panelUrl.value = config.url;
});

// API Keys section is collapsed by default — mirrors the Advanced pattern.
// Most users never touch their keys after setup; keeping the section closed
// shortens the main Settings scroll on mobile significantly.
const panelApikeysToggle = document.getElementById("panel-apikeys-toggle");
const panelApikeys       = document.getElementById("panel-apikeys");
const panelApikeysCaret  = document.getElementById("panel-apikeys-caret");
panelApikeysToggle.addEventListener("click", () => {
  const open = !panelApikeys.classList.contains("hidden");
  panelApikeys.classList.toggle("hidden", open);
  panelApikeysCaret.classList.toggle("open", !open);
});

// ---- Whisper language selector ----
document.getElementById("panel-whisper-lang")?.addEventListener("change", (e) => {
  localStorage.setItem(WHISPER_LANG_KEY, e.target.value);
});

// ---- Language selector ----
document.getElementById("panel-language")?.addEventListener("change", (e) => {
  const lang = e.target.value;
  localStorage.setItem(LANG_KEY, lang);
  // Reload so locales.js picks up the new language on next load.
  // locales.js reads localStorage at parse time, so a full reload is the
  // simplest way to re-apply without reinitializing every translated element.
  location.reload();
});

function showSettingsPanel() {
  document.getElementById("settings-subtitle").textContent = t("settings.title");
  setupForm.classList.add("hidden");
  loginForm.classList.add("hidden");
  panelVoiceInput.value = voiceInputPref;
  settingsPanel.classList.remove("hidden");
  panelMain.classList.remove("hidden");
  // Links to the public update notes. Built as an element rather than innerHTML so the
  // version string can never be interpreted as markup, and so the strict app CSP is not
  // relied on as the only thing standing between a constant and injection.
  const verEl = document.getElementById("app-version-display");
  verEl.textContent = "";
  const verLink = document.createElement("a");
  verLink.href = "https://whoszoo.app/update-notes";
  verLink.target = "_blank";
  verLink.rel = "noopener";
  verLink.style.color = "inherit";
  verLink.textContent = "WhosZoo v" + APP_VERSION;
  verEl.appendChild(verLink);
  cpForm.classList.add("hidden");
  panelAdvanced.classList.add("hidden");
  panelAdvancedCaret.classList.remove("open");
  document.getElementById("settings-help-link").classList.add("hidden");
  _showInstallerDownloads(false);
  refreshInstallRow();
  const biometricBtn = document.getElementById("panel-biometric");
  biometricBtn.classList.remove("settings-action-row-unavailable");
  if (!window.PublicKeyCredential) {
    biometricBtn.style.display = "";
    biometricBtn.classList.add("settings-action-row-unavailable");
    biometricBtn.innerHTML = `${t("settings.fingerprint-unavailable")} <span class="settings-action-chevron">${t("settings.fingerprint-unavailable-badge")}</span>`;
  } else if (!localStorage.getItem(WEBAUTHN_KEY)) {
    biometricBtn.style.display = "";
    biometricBtn.innerHTML = `${t("settings.fingerprint-setup")} <span class="settings-action-chevron">→</span>`;
  } else {
    biometricBtn.style.display = "";
    biometricBtn.innerHTML = `${t("settings.fingerprint-unavailable")} <span class="settings-action-chevron">${t("settings.fingerprint-remove-badge")}</span>`;
  }
  panelChangePassphrase.innerHTML = `${t("settings.btn-change-passphrase")} <span class="settings-action-chevron">→</span>`;
  const helpAnchor = document.querySelector("#panel-main > a.settings-action-row");
  if (helpAnchor) helpAnchor.href = helpUrl("settings");
  for (const row of apikeyRows) { row.input.value = ""; row.status.textContent = ""; }
  loadApiKeyStatus();
  loadDailyCostCap();
  show(settingsScreen);
}

// Read the current daily-spend cap from the worker and populate the dropdown.
// Stored server-side (not localStorage) so all devices see the same cap.
// On first read (data.isDefault), pick $1 in the dropdown AND save it
// immediately so enforcement (which defaults to 0/disabled) aligns with what
// the UI displays. Without this write, the user would see "$1/day" but the
// worker would treat the cap as disabled until they explicitly interacted.
async function loadDailyCostCap() {
  if (!panelCostCap) return;
  try {
    const res = await api("/dailyCostCap", "GET");
    const data = await res.json();
    if (!data.ok) return;
    if (data.isDefault) {
      panelCostCap.value = "1";
      try { await api("/dailyCostCap", "POST", { cap: 1 }); } catch {}
      return;
    }
    const cap = data.cap;
    const opt = panelCostCap.querySelector(`option[value="${cap}"]`);
    panelCostCap.value = opt ? String(cap) : "1"; // fall back to $1 if value isn't in the preset list
  } catch { /* keep dropdown default */ }
}

panelCostCap?.addEventListener("change", async () => {
  const cap = parseFloat(panelCostCap.value);
  try {
    const res = await api("/dailyCostCap", "POST", { cap });
    const data = await res.json();
    if (!data.ok) { showToast(t("toast.cap-save-failed", { error: data.error || "unknown error" })); return; }
    showToast(cap === 0 ? t("toast.cap-disabled") : t("toast.cap-set", { n: cap }));
  } catch (err) {
    showToast(t("toast.cap-save-failed", { error: err.message }));
  }
});

// ---- Token Saver ----
function tokenSaverEnabled() {
  return localStorage.getItem(TOKEN_SAVER_KEY) !== "off";
}
panelTokenSaver.value = tokenSaverEnabled() ? "on" : "off";
panelTokenSaver.addEventListener("change", () => {
  localStorage.setItem(TOKEN_SAVER_KEY, panelTokenSaver.value);
});

// ---- API Key Management ----
let _apikeyStatusTimers = {};

function setApiKeyStatus(row, msg, isError) {
  row.status.textContent = msg;
  row.status.style.color = isError ? "var(--red)" : "var(--text-dim)";
  clearTimeout(_apikeyStatusTimers[row.key]);
  _apikeyStatusTimers[row.key] = setTimeout(() => { row.status.textContent = ""; }, 4000);
}

async function loadApiKeyStatus() {
  try {
    const res = await api("/diagnostics", "GET");
    if (!res.ok) return;
    const data = await res.json();
    const keys = data.keys || {};
    const nameMap = { ANTHROPIC_API_KEY: "anthropic", OPENAI_API_KEY: "openai", ELEVENLABS_API_KEY: "elevenlabs" };
    for (const row of apikeyRows) {
      const info = keys[nameMap[row.key]];
      const hasOverride = info?.source === "app";
      row.clear.classList.toggle("hidden", !hasOverride);
      if (info && !hasOverride) {
        row.status.textContent = info.configured ? t("settings.apikey-source-setup") : t("settings.apikey-not-configured");
        row.status.style.color = info.configured ? "var(--text-dim)" : "var(--red)";
      } else if (hasOverride) {
        row.status.textContent = t("settings.apikey-source-app");
        row.status.style.color = "var(--text-dim)";
      }
    }
  } catch {}
}

for (const row of apikeyRows) {
  row.save.addEventListener("click", async () => {
    const value = row.input.value.trim();
    if (!value) { setApiKeyStatus(row, t("settings.apikey-enter-value"), true); return; }
    row.save.disabled = true;
    row.save.textContent = t("settings.apikey-btn-save-loading");
    try {
      const res = await api("/updateApiKey", "POST", { key: row.key, value });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Save failed");
      row.input.value = "";
      setApiKeyStatus(row, t("settings.apikey-saved"), false);
      row.clear.classList.remove("hidden");
    } catch (err) {
      setApiKeyStatus(row, err.message || "Save failed.", true);
    } finally {
      row.save.disabled = false;
      row.save.textContent = t("settings.apikey-btn-save");
    }
  });

  row.clear.addEventListener("click", async () => {
    row.clear.disabled = true;
    row.clear.textContent = t("settings.apikey-btn-clear-loading");
    try {
      const res = await api("/clearApiKey", "POST", { key: row.key });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Clear failed");
      row.clear.classList.add("hidden");
      setApiKeyStatus(row, t("settings.apikey-cleared"), false);
    } catch (err) {
      setApiKeyStatus(row, err.message || "Clear failed.", true);
    } finally {
      row.clear.disabled = false;
      row.clear.textContent = t("settings.apikey-btn-clear");
    }
  });
}

document.getElementById("panel-biometric").addEventListener("click", async () => {
  if (localStorage.getItem(WEBAUTHN_KEY)) {
    await removeBiometric();
  } else {
    localStorage.removeItem(WEBAUTHN_SKIP_KEY);
    await setupBiometric();
  }
});

async function setupBiometric() {
  const btn = document.getElementById("panel-biometric");
  btn.disabled = true;
  btn.innerHTML = `${t("settings.fingerprint-setup-loading")} <span class="settings-action-chevron"></span>`;
  try {
    const chalRes = await api("/webauthn-challenge", "POST", {});
    const { challenge } = await chalRes.json();
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: waB64urlToBytes(challenge),
        rp: { name: "WhosWhoZoo", id: window.location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "user", displayName: "WhosWhoZoo" },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60000,
        attestation: "none"
      }
    });
    const publicKeyDer = credential.response.getPublicKey();
    if (!publicKeyDer) throw new Error("Could not read public key from device.");
    const res = await api("/webauthn-register", "POST", {
      credentialId:  waBytesToB64url(new Uint8Array(credential.rawId)),
      clientDataJSON: waBytesToB64url(new Uint8Array(credential.response.clientDataJSON)),
      publicKey:     waBytesToB64(new Uint8Array(publicKeyDer))
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Registration failed");
    localStorage.setItem(WEBAUTHN_KEY, waBytesToB64url(new Uint8Array(credential.rawId)));
    showToast(t("toast.fingerprint-enabled"));
    showSettingsPanel();
  } catch (err) {
    if (err.name !== "NotAllowedError") showToast(err.message || "Setup failed.");
    showSettingsPanel();
  }
}

async function removeBiometric() {
  try {
    await api("/webauthn-remove", "POST", {});
    localStorage.removeItem(WEBAUTHN_KEY);
    showToast(t("toast.fingerprint-removed"));
    showSettingsPanel();
  } catch {
    showToast(t("toast.fingerprint-remove-failed"));
  }
}

panelSaveUrl.addEventListener("click", async () => {
  const url = panelUrl.value.trim().replace(/\/$/, "");
  if (!url) { showToast(t("toast.url-empty")); return; }
  panelSaveUrl.disabled = true;
  panelSaveUrl.textContent = t("settings.btn-test-save-loading");
  try {
    await fetch(url + "/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  } catch {
    panelSaveUrl.disabled = false;
    panelSaveUrl.textContent = t("settings.btn-test-save");
    showToast(t("toast.url-unreachable"));
    return;
  }
  config = { url };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  panelSaveUrl.disabled = false;
  panelSaveUrl.textContent = t("settings.btn-test-save");
  showToast(t("toast.worker-url-saved"));
  show(chatScreen);
  settingsPanel.classList.add("hidden");
});

panelChangePassphrase.addEventListener("click", () => {
  panelMain.classList.add("hidden");
  cpForm.classList.remove("hidden");
  document.getElementById("settings-subtitle").textContent = t("settings.btn-change-passphrase");
  cpCurrent.value = "";
  cpNew.value = "";
  cpConfirm.value = "";
  setTimeout(() => cpCurrent.focus(), 100);
});

cpCancel.addEventListener("click", () => {
  cpForm.classList.add("hidden");
  panelMain.classList.remove("hidden");
  document.getElementById("settings-subtitle").textContent = "Settings";
});

cpSave.addEventListener("click", doChangePassphrase);
cpNew.addEventListener("keydown", e => { if (e.key === "Enter") cpConfirm.focus(); });
cpConfirm.addEventListener("keydown", e => { if (e.key === "Enter") doChangePassphrase(); });

async function doChangePassphrase() {
  const current = cpCurrent.value;
  const newPass = cpNew.value;
  const confirm = cpConfirm.value;
  if (!current) { showToast(t("toast.current-passphrase-required")); return; }
  if (!newPass || newPass.length < PASSPHRASE_MIN_LENGTH) { showToast(t("toast.new-passphrase-too-short")); return; }
  if (newPass !== confirm) { showToast(t("toast.new-passphrase-mismatch")); return; }

  cpSave.disabled = true;
  cpSave.textContent = "Updating…";
  try {
    const res = await api("/changePassword", "POST", { currentPassword: current, newPassword: newPass });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Update failed");
    saveSession(data.token, data.expiresAt);
    // Server invalidates webauthn_credential on password change — clear the
    // local hint so the login screen and settings panel reflect the new state.
    const hadBiometric = !!localStorage.getItem(WEBAUTHN_KEY);
    if (hadBiometric) {
      localStorage.removeItem(WEBAUTHN_KEY);
      const biometricBtn = document.getElementById("panel-biometric");
      if (biometricBtn && window.PublicKeyCredential) {
        biometricBtn.style.display = "";
        biometricBtn.innerHTML = `${t("settings.fingerprint-setup")} <span class="settings-action-chevron">→</span>`;
      }
    }
    cpForm.classList.add("hidden");
    panelMain.classList.remove("hidden");
    document.getElementById("settings-subtitle").textContent = "Settings";
    showToast(hadBiometric
      ? "Passphrase updated. Fingerprint unlock was removed — re-enroll if you want it back."
      : "Passphrase updated.");
  } catch (err) {
    showToast(err.message);
  } finally {
    cpSave.disabled = false;
    cpSave.textContent = "Update passphrase";
  }
}

document.getElementById("panel-back-btn").addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
  show(chatScreen);
});

panelSignout.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
  lockApp();
  sessionStorage.removeItem("whoszoo_resume"); // intentional sign-out — don't resume
});

// cls-btn: tap = /cls (clear chat + context, hard reset), long-press 600ms = /r
// (drop conversation history, keep visible chat, soft reset). Both fire from
// the same button so the user has one mental model: "this is the reset button."
// The pressing class shows a left-to-right fill animation as the long-press
// counts down — visible feedback that something is happening.
let _clsLongPressTimer = null;
let _clsLongPressFired = false;

clsBtn.addEventListener("pointerdown", e => {
  if (e.button !== 0 && e.pointerType !== "touch") return;
  _clsLongPressFired = false;
  clsBtn.classList.add("pressing");
  _clsLongPressTimer = setTimeout(() => {
    _clsLongPressFired = true;
    clsBtn.classList.remove("pressing");
    if (navigator.vibrate) try { navigator.vibrate(15); } catch {} // mobile haptic
    sendMessage("/r", false, true);
    inputEl.focus();
  }, 600);
});

const _clsCancelLongPress = () => {
  if (_clsLongPressTimer) { clearTimeout(_clsLongPressTimer); _clsLongPressTimer = null; }
  clsBtn.classList.remove("pressing");
};
clsBtn.addEventListener("pointerup", _clsCancelLongPress);
clsBtn.addEventListener("pointerleave", _clsCancelLongPress);
clsBtn.addEventListener("pointercancel", _clsCancelLongPress);

clsBtn.addEventListener("click", e => {
  // Suppress the click that fires after a long-press completes.
  if (_clsLongPressFired) {
    _clsLongPressFired = false;
    e.preventDefault();
    return;
  }
  sendMessage("/cls", false, true);
  inputEl.focus();
});

// Three things get appended to the message list that are NOT .message.*
// elements, and all three were silently absent from copied transcripts. Each
// is app state rather than something anyone said, so each gets a marker line
// instead of a "Role: text" line. Their raw innerText is also unusable —
// every one of them carries <button> children whose labels concatenate onto
// the body ("Reset (/r)5 exchanges in · consider resetting..."), so the real
// text is pulled from a specific child where one exists.
//
// Left in English on purpose: "You"/"WhosWhoZoo"/"System" below are hardcoded
// too, so localizing only these would be the inconsistent choice.
function transcriptMarker(el) {
  if (el.classList.contains("context-divider")) return "--- Context Reset ---";
  if (el.classList.contains("context-warning")) {
    const txt = el.querySelector(".context-warning-text")?.innerText.trim();
    return `--- ${txt || "Context warning"} ---`;
  }
  if (el.classList.contains("archive-hint")) {
    // Either one or two buttons, depending on whether archive, cold storage,
    // or both were offered — join rather than lose which was on screen.
    const opts = [...el.querySelectorAll("button")].map(b => b.innerText.trim()).filter(Boolean);
    return `--- App offered: ${opts.join(" / ") || "a wider search"} ---`;
  }
  return null;
}

copyChatBtn.addEventListener("click", () => {
  // The three non-.message elements are in this selector so app state survives
  // into the transcript. Omitting them made a context reset structurally
  // impossible to copy — a pasted transcript read as one unbroken conversation
  // even though Claude had been handed a fresh context partway through — and
  // hid the archive/cold-storage offer, which appears precisely when the model
  // found nothing in active memory. Both actively mislead anyone debugging
  // from a paste; the reset did exactly that during the 2026-09-23
  // investigation into a record the model claimed not to find.
  // querySelectorAll returns document order no matter what order the selectors
  // are written in, so each lands in the right position on its own.
  const bubbles = messagesEl.querySelectorAll(
    ".message.user, .message.assistant, .message.system, .context-divider, .context-warning, .archive-hint"
  );
  if (!bubbles.length) { showToast(t("toast.nothing-to-copy")); return; }
  const lines = [];
  bubbles.forEach(el => {
    const marker = transcriptMarker(el);
    if (marker) { lines.push(marker); return; }
    const role = el.classList.contains("user") ? "You" : el.classList.contains("assistant") ? "WhosWhoZoo" : "System";
    const text = el.innerText.trim();
    if (text) lines.push(`${role}: ${text}`);
  });
  navigator.clipboard.writeText(lines.join("\n\n")).then(() => showToast(t("toast.conversation-copied"))).catch(() => showToast(t("toast.copy-failed")));
});

settingsBtn.addEventListener("click", () => {
  if (session) showSettingsPanel();
  else showSetupScreen(config.url);
});

// ---- Session Start ----
// Scans every active memory file, not just people.md — photos have always been
// supported on reflections/fragments/loops end-to-end (upload, the edit-modal
// strip, /audit deep), but this cache only ever held people, so those records'
// photos never appeared as inline chat thumbnails. Archive/deep-archive tiers
// are deliberately excluded: chips are a "Claude just mentioned this record"
// affordance, and graduated records aren't in the live working set.
async function scanRecordPhotos() {
  _recordsWithPhotos = new Map();
  const files = ["people.md", "reflections.md", "fragments.md", "loops.md"];
  await Promise.all(files.map(async (file) => {
    try {
      const res = await api(`/getMemoryFile?filename=${encodeURIComponent(file)}`, "GET");
      if (!res.ok) return;
      const text = await res.text();
      const parts = text.split(/\n(?=## )/);
      for (const part of parts) {
        if (!part.startsWith("## ")) continue;
        const nameMatch = part.match(/^## (.+)/);
        if (!nameMatch) continue;
        const filenames = [...part.matchAll(/\n[–-] Photo: (.+)/g)].map(m => m[1].trim());
        setRecordPhotos(file, nameMatch[1].trim(), filenames);
      }
    } catch {}
  }));
}

let _sessionStarting = false;
async function startSession(skipLoading = false) {
  if (_sessionStarting) return;
  _sessionStarting = true;
  if (!hasSpeechRecognition() && !useWhisper()) {
    convBtn.style.opacity = "0.35";
    convBtn.style.cursor = "not-allowed";
    convBtn.title = t("tooltip.voice-unsupported");
  }
  if (!skipLoading) {
    show(loadingScreen);
    loadingText.textContent = "Starting up...";
  }
  const readyBadge = document.getElementById("ready-badge");
  readyBadge.textContent = "Loading...";
  readyBadge.classList.remove("hidden");
  try {
    const res = await api("/healthz", "GET", null, true);
    if (res.status === 401) throw new Error("__auth__");
    const data = await res.json();
    if (!data.ok) throw new Error("Health check failed");
    const missing = data.files.filter(f => !f.ok).map(f => f.file);
    if (missing.length > 0) throw new Error(`Missing files: ${missing.join(", ")}`);
    if (data.totalBytes) {
      _archiveBytes = data.archiveBytes || 0;
      updateMemoryBadge(data.totalBytes);
    }
    updateDeepRecordBadge(data.deepRecordCount || 0);
    if (!skipLoading) {
      loadingText.textContent = "Ready.";
      await sleep(400);
      messages = [];
      messagesEl.innerHTML = "";
      _contextTokens = 0;
  _historyTokens = 0;
      show(chatScreen);
    } else {
      messages = [];
      messagesEl.innerHTML = "";
      _contextTokens = 0;
  _historyTokens = 0;
    }
    document.getElementById("ready-badge").classList.add("hidden");
    // Offer biometric setup after first passphrase login
    if (sessionStorage.getItem("whoszoo_offer_biometric")) {
      sessionStorage.removeItem("whoszoo_offer_biometric");
      const offerMsg = appendMessage("system", "Enable fingerprint unlock to sign in without typing your passphrase next time.");
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;margin-top:10px;";
      // Match the journal-restore banner sizing: padding 12px 16px / font 15px
      // brings both inline chat banners up to a ~44px tap target, consistent
      // with every other primary/secondary button across the app. flex:1 +
      // width:auto overrides .btn-primary/.btn-secondary's width:100% so they
      // share the row proportionally instead of one stomping the other.
      const enableBtn = document.createElement("button");
      enableBtn.className = "btn-primary";
      enableBtn.style.cssText = "flex:1;width:auto;padding:12px 16px;font-size:15px;";
      enableBtn.textContent = "Enable fingerprint";
      const skipBtn = document.createElement("button");
      skipBtn.className = "btn-secondary";
      skipBtn.style.cssText = "flex:1;width:auto;padding:12px 16px;font-size:15px;";
      skipBtn.textContent = "Not now";
      enableBtn.onclick = () => { offerMsg.remove(); setupBiometric(); };
      skipBtn.onclick = () => { offerMsg.remove(); localStorage.setItem(WEBAUTHN_SKIP_KEY, "1"); };
      row.append(enableBtn, skipBtn);
      offerMsg.append(row);
    }

    // Offer to restore a suspended journal session
    const rawDraft = sessionStorage.getItem(JOURNAL_DRAFT_KEY);
    if (rawDraft) {
      try {
        const draft = JSON.parse(rawDraft);
        const ageMin = Math.round((Date.now() - draft.savedAt) / 60000);
        const draftChunks = draft.chunks || (draft.messages || []).filter(m => m && m.role === "user").map(m => m.content);
        if (draftChunks.length && ageMin < 60) {
          const notice = appendMessage("system", `A journal session from ${ageMin} minute${ageMin !== 1 ? "s" : ""} ago was interrupted. Restore it?`);
          const row = document.createElement("div");
          row.style.cssText = "display:flex;gap:10px;margin-top:10px;";
          // .btn-primary / .btn-secondary both have width:100% (built for the
          // login form). Override with width:auto and flex:2/flex:1 so they
          // share the row proportionally — same pattern as the Edit Record
          // footer. Without this, Restore fills the row and Discard wraps to
          // two lines ("Disca / rd").
          const yes = document.createElement("button");
          yes.className = "btn-primary";
          yes.style.cssText = "flex:2;width:auto;font-size:15px;padding:12px 16px;";
          yes.textContent = "Restore session";
          const no = document.createElement("button");
          no.className = "btn-secondary";
          no.style.cssText = "flex:1;width:auto;font-size:15px;padding:12px 16px;white-space:nowrap;";
          no.textContent = "Discard";
          yes.addEventListener("click", () => { journalChunks = draftChunks.slice(); journalDictating = true; clearJournalDraft(); notice.remove(); appendMessage("system", "Journal session restored — open conversation mode to continue."); });
          no.addEventListener("click", () => { clearJournalDraft(); notice.remove(); });
          row.append(yes, no);
          notice.appendChild(row);
        }
      } catch { sessionStorage.removeItem(JOURNAL_DRAFT_KEY); }
    }
    shouldShowWelcomeCard().then(show => { if (show) showWelcomeCard(); });
    // Only offered once the user is actually in — beforeinstallprompt often
    // fires while the login screen is still up, and prompting someone who
    // hasn't signed in yet is noise.
    showInstallBanner();
    inputEl.focus();
    checkMemoryHealth();
    checkDailyBrief();
    scanRecordPhotos(); // fire-and-forget; chips appear after photos load
    // Show previous login for passive security awareness
    (async () => {
      try {
        const llRes = await api("/loginLog", "GET");
        const llData = await llRes.json();
        const all = llData.ok ? llData.logins : [];
        // Only session-establishing methods count as "a login". An export or
        // import happens inside a session that already exists, so showing one
        // as your last login would hide the very event worth noticing.
        const SESSION_METHODS = ["passphrase", "biometric", "setup", "recovery"];
        const realLogins = all.filter(l => SESSION_METHODS.includes(l.method));
        if (realLogins.length >= 2) {
          const prev = realLogins[1];
          const loc = [prev.city, prev.region, prev.country].filter(Boolean).join(", ");
          const parts = [t("chat.last-login", { time: _relativeTimeFrom(new Date(prev.at).getTime()) })];
          if (loc) parts.push(loc);
          if (prev.ua) parts.push(prev.ua);
          appendMessage("system", parts.join(" · "));
        }
        // Surface any bulk-copy action that happened since the previous login.
        // This is the point of logging exports at all: an export run by someone
        // else at an unattended desk occurs *during* your own session, so it
        // would never show up as a login — you would only find it by going to
        // look. Entries newer than your previous login are the suspicious ones.
        if (realLogins.length >= 2) {
          const sinceAt = new Date(realLogins[1].at).getTime();
          const bulk = all.filter(l =>
            ["export", "export-plain", "import"].includes(l.method) &&
            new Date(l.at).getTime() > sinceAt);
          if (bulk.length) {
            const names = bulk.map(b => t(`security.method.${b.method}`)).join(", ");
            appendMessage("system", t("chat.bulk-since-login", { count: bulk.length, actions: names }));
          }
        }
      } catch {}
    })();
  } catch (err) {
    if (err.message === "__auth__") {
      loadingText.textContent = "Session expired. Tap to sign in again.";
      loadingScreen.addEventListener("click", () => lockApp(), { once: true });
    } else {
      // Surface the actual error so we don't have to guess what failed.
      const msg = (err && err.message) ? err.message : String(err);
      loadingText.textContent = `Could not load memories: ${msg}. Tap to retry.`;
      loadingScreen.addEventListener("click", startSession, { once: true });
    }
  } finally {
    _sessionStarting = false;
  }
}

// ---- Chat Mode ----
sendBtn.addEventListener("click", sendMessage);

// Long-press send button → history picker
let historyPressTimer = null;
let historyPicker = null;
let historyOutsideHandler = null;
function showHistoryPicker() {
  if (cmdHistory.length === 0) return;
  historyPicker = document.createElement("div");
  historyPicker.className = "history-picker";
  const title = document.createElement("div");
  title.className = "history-picker-title";
  title.textContent = "Recent";
  historyPicker.appendChild(title);
  cmdHistory.slice(0, 8).forEach((entry, i) => {
    const btn = document.createElement("button");
    btn.className = "history-picker-item";
    btn.textContent = entry;
    btn.addEventListener("click", () => {
      inputEl.value = entry;
      inputEl.style.height = "auto";
      inputEl.style.height = inputEl.scrollHeight + "px";
      cmdHistoryIdx = i;
      closeHistoryPicker();
      inputEl.focus();
    });
    historyPicker.appendChild(btn);
  });
  sendBtn.parentElement.style.position = "relative";
  sendBtn.parentElement.appendChild(historyPicker);
  // Outside-click closer: a document-level pointerdown that closes the picker
  // if the tap landed anywhere outside it. Was previously a transparent
  // backdrop element at z:199, but the picker is trapped inside .chat-screen's
  // stacking context (.screen has position:fixed → new stacking context), so
  // the backdrop ended up *on top of* the picker even though the picker's
  // z-index was higher locally. Every click hit the backdrop and closed the
  // picker before the item received the event. A document listener bypasses
  // the stacking problem entirely. The setTimeout defers attachment so the
  // long-press pointerdown that OPENS the picker doesn't immediately fire
  // the close handler on its own pointerup.
  setTimeout(() => {
    historyOutsideHandler = (e) => {
      if (!historyPicker) return;
      if (historyPicker.contains(e.target)) return;
      closeHistoryPicker();
    };
    document.addEventListener("pointerdown", historyOutsideHandler, true);
  }, 0);
}
function closeHistoryPicker() {
  if (historyPicker) { historyPicker.remove(); historyPicker = null; }
  if (historyOutsideHandler) {
    document.removeEventListener("pointerdown", historyOutsideHandler, true);
    historyOutsideHandler = null;
  }
}
sendBtn.addEventListener("pointerdown", e => {
  historyPressTimer = setTimeout(() => { historyPressTimer = null; showHistoryPicker(); }, 500);
});
sendBtn.addEventListener("pointerup", () => { clearTimeout(historyPressTimer); historyPressTimer = null; });
sendBtn.addEventListener("pointerleave", () => { clearTimeout(historyPressTimer); historyPressTimer = null; });
sendBtn.addEventListener("contextmenu", e => e.preventDefault());

inputEl.addEventListener("keydown", e => {
  // Autocomplete navigation
  if (!cmdSuggestions.classList.contains("hidden")) {
    const items = cmdSuggestions.querySelectorAll(".cmd-suggestion");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      cmdActiveIdx = Math.min(cmdActiveIdx + 1, items.length - 1);
      updateActiveItem(); return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      cmdActiveIdx = Math.max(cmdActiveIdx - 1, -1);
      updateActiveItem(); return;
    }
    if (e.key === "Tab" || (e.key === "Enter" && cmdActiveIdx >= 0)) {
      e.preventDefault();
      const lower = inputEl.value.toLowerCase();
      const matches = COMMANDS.filter(c => c.cmd.startsWith(lower)).sort((a, b) => a.cmd.localeCompare(b.cmd));
      const idx = cmdActiveIdx >= 0 ? cmdActiveIdx : 0;
      if (matches[idx]) {
        inputEl.value = matches[idx].cmd;
        inputEl.dispatchEvent(new Event("input"));
      }
      hideCmdSuggestions(); return;
    }
    if (e.key === "Escape") { hideCmdSuggestions(); return; }
    if (e.key === "Enter" && cmdActiveIdx < 0) { hideCmdSuggestions(); }
  }
  // Enter sends on a desktop (Shift+Enter for a newline). On a touch device
  // Enter inserts a newline and the send button is the only way to send: a
  // soft keyboard has no practical Shift key, so Enter-to-send left NO way to
  // type a second line at all. The textarea and its auto-grow below were
  // therefore unreachable on the platform this app is mobile-first for.
  // Matches the convention of every mobile chat app.
  //
  // (pointer: coarse) asks about the PRIMARY pointer, so a touchscreen laptop
  // with a mouse still counts as a desktop and keeps Enter-to-send.
  if (e.key === "Enter" && !e.shiftKey && !isTouchPrimary()) { e.preventDefault(); sendMessage(); }
  // Terminal-style history navigation — only when suggestions hidden and input is single-line
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && cmdSuggestions.classList.contains("hidden") && !inputEl.value.includes("\n")) {
    if (cmdHistory.length === 0) return;
    e.preventDefault();
    if (e.key === "ArrowUp") {
      if (cmdHistoryIdx === -1) cmdHistoryDraft = inputEl.value;
      cmdHistoryIdx = Math.min(cmdHistoryIdx + 1, cmdHistory.length - 1);
    } else {
      cmdHistoryIdx = Math.max(cmdHistoryIdx - 1, -1);
    }
    inputEl.value = cmdHistoryIdx === -1 ? cmdHistoryDraft : cmdHistory[cmdHistoryIdx];
    inputEl.style.height = "auto";
    inputEl.style.height = inputEl.scrollHeight + "px";
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  }
});
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = inputEl.scrollHeight + "px";
  inputEl.scrollTop = inputEl.scrollHeight;
  updateCmdSuggestions();
});

// Consume an SSE stream from /chat, rendering text chunks as they arrive.
// Returns { fullText, usage, replyEl, error, aborted }.
async function consumeChatStream(res, thinkingEl) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let replyEl = null;
  let fullText = "";
  let usage = {};
  let streamError = null;
  let aborted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        const dataLine = block.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) continue;
        let ev; try { ev = JSON.parse(dataLine.slice(6)); } catch { continue; }

        if (ev.t === "d") {
          fullText += ev.v;
          // Strip partial opening tag at chunk boundary to avoid flash of "<memory-wr".
          // The function_call/tool_call/invoke cuts handle Claude's occasional drift to
          // XML-tool-call envelopes instead of <memory-write> (see parseResponse's own
          // comment) — without these, a whole turn's raw JSON streams visibly into the
          // chat bubble character-by-character before parseResponse ever gets a chance
          // to hide it at stream end, which is exactly what a real user report described
          // ("it gives me json script") and is needlessly alarming even though the write
          // proposal itself still parses correctly once the stream completes.
          const displayText = fullText
            .split("<memory-write>")[0]
            .split("<disambiguation>")[0]
            .split("<sources>")[0]
            .split("<compact-request>")[0]
            .split("<function_call")[0]
            .split("<tool_call")[0]
            .split("<invoke")[0]
            // Same envelope, but seen in production with the opening "<"
            // missing, which none of the tag cuts above catch.
            .split(/\binvoke\s+name\s*=/i)[0]
            .replace(/<[^>]*$/, "")
            .trimEnd();
          if (displayText) {
            if (!replyEl) {
              thinkingEl.remove();
              replyEl = document.createElement("div");
              replyEl.className = "message assistant";
              messagesEl.appendChild(replyEl);
            }
            replyEl.textContent = displayText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        } else if (ev.t === "z") {
          fullText = ev.v;
          usage = ev.u || {};
        } else if (ev.t === "e") {
          streamError = ev.v || "Stream error";
        }
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      aborted = true;
    } else {
      streamError = err.message || "Stream interrupted";
    }
    // Clean up partial rendering so the DOM and messages[] don't desync
    if (replyEl) { replyEl.remove(); replyEl = null; }
  }

  // #2: t:"e" events also leave partial bubble — clean up here too
  if (streamError && replyEl) { replyEl.remove(); replyEl = null; }

  return { fullText, usage, replyEl, error: streamError, aborted };
}

async function sendMessage(text, brief = false, silent = false) {
  let userText = typeof text === "string" ? text : inputEl.value.trim();
  if (!userText && !pendingAttachments.length) return;
  if (userText && (cmdHistory.length === 0 || cmdHistory[0] !== userText)) cmdHistory.unshift(userText);
  if (cmdHistory.length > 50) cmdHistory.length = 50;
  cmdHistoryIdx = -1;
  cmdHistoryDraft = "";

  // /cls — clear chat history without reloading memory
  if (userText.trim().toLowerCase() === "/cls" || userText.trim().toLowerCase() === "cls") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    messages = [];
    _contextTokens = 0;
  _historyTokens = 0;
    attachmentsInHistory = [];
    pendingRecallContext = null;
    updateContextAttachBar();
    updateVaultBar();
    updateMemoryBadge(_workingBytes);
    messagesEl.innerHTML = "";
    appendMessage("system", t("chat.cleared"));
    return;
  }

  // /l — lock app immediately
  if (userText.trim().toLowerCase() === "/l") {
    lockApp();
    return;
  }

  // /r — reset context only (chat log stays visible)
  if (userText.trim().toLowerCase() === "/r") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    resetContext();
    return;
  }

  // Echo slash commands into chat history (except /cls, /r, silent badge invocations)
  if (userText.trim().startsWith("/") && !brief && !silent) {
    appendMessage("user", userText.trim());
  }

  // /diagnostics — system health check
  if (userText.trim().toLowerCase() === "/diagnostics") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    hideCmdSuggestions();
    try {
      const res = await api("/diagnostics", "GET");
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "Failed");
      const bar = n => "█".repeat(Math.round(n / 5)) + "░".repeat(20 - Math.round(n / 5)) + ` ${n}%`;
      const lines = [
        "System Diagnostics",
        "",
        "Memory files:",
      ];
      for (const f of d.memory) {
        const kb = (f.bytes / 1024).toFixed(1);
        lines.push(`  ${f.file.padEnd(18)} ${String(f.tokens).padStart(6)} tokens  (${kb} KB)`);
      }
      lines.push(`  ${"TOTAL".padEnd(18)} ${String(d.tokenBudget.used).padStart(6)} tokens  / ${d.tokenBudget.cap.toLocaleString()} cap`);
      lines.push(`  Context window used: ${bar(d.tokenBudget.pct)}`);
      if (d.archive && d.archiveBudget) {
        const hasArchive = d.archive.some(f => f.bytes > 0);
        lines.push("");
        lines.push("Archive files (loaded only when 📦 is on):");
        if (hasArchive) {
          for (const f of d.archive) {
            if (f.bytes > 0) {
              const kb = (f.bytes / 1024).toFixed(1);
              lines.push(`  ${f.file.padEnd(22)} ${String(f.tokens).padStart(6)} tokens  (${kb} KB)`);
            }
          }
          lines.push(`  ${"ARCHIVE TOTAL".padEnd(22)} ${String(d.archiveBudget.tokens).padStart(6)} tokens`);
          lines.push(`  If archive enabled:  ${bar(d.archiveBudget.combinedPct)}`);
        } else {
          lines.push("  (empty — nothing archived yet)");
        }
      }
      if (d.deepArchive && d.deepArchiveBudget) {
        const hasDeep = d.deepArchive.some(f => f.bytes > 0);
        lines.push("");
        lines.push("Cold storage files (use /recall to search):");
        if (hasDeep) {
          for (const f of d.deepArchive) {
            if (f.bytes > 0) {
              const kb = (f.bytes / 1024).toFixed(1);
              lines.push(`  ${f.file.padEnd(26)} ${String(f.tokens).padStart(6)} tokens  (${kb} KB)`);
            }
          }
          lines.push(`  ${"DEEP TOTAL".padEnd(26)} ${String(d.deepArchiveBudget.tokens).padStart(6)} tokens`);
        } else {
          lines.push("  (empty — nothing in cold storage yet)");
        }
      }
      // Track-aware suggestions section — only when at least one threshold crossed
      const _h = _memoryHealth(d);
      if (_h.tier !== "ok") {
        lines.push("");
        lines.push("💡 Suggestions");
        lines.push("");
        if (_h.track === "A") {
          // Single-file detection: if one active file dominates, point at it specifically
          const dominant = d.memory.find(f => f.pct >= 70);
          if (dominant) {
            const fileBase = dominant.file.replace(".md", "");
            lines.push(`  Active is large (${dominant.file} at ${dominant.pct}% of budget alone)`);
            lines.push(`    → /compact-review ${fileBase}  — shrink the largest records`);
            lines.push(`    → /browse ${fileBase}  — see all records sorted by size`);
            lines.push("");
          }
          lines.push(`  Combined is rising (${_h.combinedPct}% with archive)`);
          lines.push(`    → /archive-review  — AI surfaces candidates to archive`);
          lines.push(`    → /edit [name] then tap → Archive  — move one record manually`);
        } else if (_h.track === "AB") {
          lines.push(`  Both tiers are growing (${_h.activeK}K active + ${_h.archiveK}K archive · ${_h.combinedPct}% combined)`);
          lines.push(`    → /archive-review  — move records active → archive`);
          lines.push(`    → /deep-review  — move records archive → cold storage`);
          lines.push(`    → /browse archive people  — see archived records by size`);
          lines.push("");
          lines.push(`  Curious about cold storage?`);
          lines.push(`    → /recall [name or topic]  — search cold storage from chat`);
        } else {
          lines.push(`  Combined memory at ${_h.combinedPct}% — Claude's window is limited`);
          lines.push(`    → /deep-review  — AI surfaces archive records to move down`);
          lines.push(`    → /browse archive  — see archived records sorted by size`);
          lines.push(`    → /edit [name] then tap → Cold  — move one record manually`);
          lines.push(`    → /restore [name]  — pull something back if you change your mind`);
        }
      }

      lines.push("");
      lines.push("Cost log:");
      lines.push(`  Days tracked: ${d.costLog.entries}   Last entry: ${d.costLog.lastEntry || "none"}`);
      if (d.costLog.trackingErrors > 0) lines.push(`  ⚠ Tracking errors logged: ${d.costLog.trackingErrors}`);
      else lines.push("  Tracking: OK");
      lines.push("");
      lines.push("API keys:");
      const keyFmt = (label, ok, desc, hint) => {
        const left = `  ${label}  ${ok ? "✓" : "✗ MISSING"}  ${desc.padEnd(36)}`;
        return hint ? left + " ·  " + hint : left.trimEnd();
      };
      lines.push(keyFmt("Anthropic:  ", d.keys.anthropic,  "Claude AI (chat + memory analysis)", d.keys.anthropicHint));
      lines.push(keyFmt("ElevenLabs: ", d.keys.elevenlabs, "Brittney + Callum voices",           d.keys.elevenLabsHint));
      lines.push(keyFmt("OpenAI:     ", d.keys.openai,     "Marin + Onyx voices",                d.keys.openaiHint));
      if (d.recentErrors.length > 0) {
        lines.push("");
        lines.push(`Recent errors (${d.recentErrors.length}):`);
        for (const e of d.recentErrors) lines.push(`  ${e.ts.slice(0, 19).replace("T", " ")}  [${e.fn}]  ${e.msg}`);
      }
      // Append today's cost inline
      try {
        const cRes = await api("/costs?date=" + new Date().toLocaleDateString("en-CA"), "GET");
        const cData = await cRes.json();
        if (cData.ok) {
          lines.push("");
          lines.push(`Today's spend: $${cData.today.cost.toFixed(3)}  (${cData.today.requests} requests) · Week: $${cData.week.cost.toFixed(3)}  — /costs for full breakdown`);
        }
      } catch {}
      lines.push("");
      lines.push(`WhosWhoZoo v${APP_VERSION} · Built by Hans Reno`);
      lines.push("Stack: Cloudflare Workers · KV · Claude API · ElevenLabs · OpenAI TTS");
      appendMessage("system", lines.join("\n"));
    } catch (err) {
      appendMessage("system", `Diagnostics failed: ${err.message}`);
    }
    return;
  }

  // /security — recent login history
  if (userText.trim().toLowerCase() === "/security") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    try {
      const res = await api("/loginLog", "GET");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "failed");
      const lines = ["Login history:"];
      if (!data.logins.length) {
        lines.push("  No login history recorded yet.");
      } else {
        for (const e of data.logins) {
          const dt = new Date(e.at);
          const dateStr = dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
          const loc = [e.city, e.region, e.country].filter(Boolean).join(", ");
          // t() falls back to the key itself when a key is missing, so compare
          // against the key to detect that and show the raw method instead of
          // a literal "security.method.whatever" in the log.
          const _mKey = `security.method.${e.method}`;
          const _mLabel = t(_mKey);
          const methodLabel = _mLabel === _mKey ? e.method : _mLabel;
          lines.push(`  ${dateStr}  ·  ${loc || "unknown location"}  ·  ${e.ua}  ·  ${methodLabel}`);
        }
        lines.push("");
        lines.push(`${data.logins.length} session${data.logins.length !== 1 ? "s" : ""} (up to 20 stored). Location from Cloudflare geolocation.`);
      }
      appendMessage("system", lines.join("\n"));
    } catch (err) {
      appendMessage("system", `Could not load login history: ${err.message}`);
    }
    return;
  }

  // /export — download encrypted backup — requires passphrase confirmation.
  // The export password entered in the modal below is chosen at export time,
  // so it protects the file afterwards but gates nothing: whoever runs the
  // export picks it. The passphrase check is what actually gates the export.
  if (userText.trim().toLowerCase() === "/export") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    showReauthGate("export", () => {
      exportPwEl.value = "";
      exportPw2El.value = "";
      exportModalErrorEl.classList.add("hidden");
      exportModal.classList.remove("hidden");
      setTimeout(() => exportPwEl.focus(), 50);
    });
    return;
  }

  // /export-plain — download plain-text zip (unencrypted) — requires passphrase
  if (userText.trim().toLowerCase() === "/export-plain") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    showReauthGate("export-plain", () => {
      exportZipInput.value = "";
      exportZipConfirm.disabled = true;
      exportZipError.classList.add("hidden");
      exportZipModal.classList.remove("hidden");
      setTimeout(() => exportZipInput.focus(), 50);
    });
    return;
  }

  // /import-contacts — import from .vcf (vCard) or .csv
  if (userText.trim().toLowerCase() === "/import-contacts") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    document.getElementById("import-contacts-input").value = "";
    document.getElementById("import-contacts-input").click();
    return;
  }

  // /import — restore from encrypted backup — requires passphrase
  if (userText.trim().toLowerCase() === "/import") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    dismissWelcomeCard();
    showReauthGate("import", () => {
      importFileInput.value = "";
      importFileInput.click();
    });
    return;
  }

  // /reset — wipe all memory files to blank templates
  if (userText.trim().toLowerCase() === "/reset") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    resetAccessKey.value = "";
    resetConfirmWord.value = "";
    resetNewName.value = "";
    resetError.classList.add("hidden");
    resetConfirmBtn.disabled = true;
    resetConfirmBtn.textContent = "Reset Memory";
    resetModal.classList.remove("hidden");
    setTimeout(() => resetAccessKey.focus(), 50);
    return;
  }

  // /help — list available commands
  if (userText.trim().toLowerCase() === "/help" || userText.trim().toLowerCase() === "help") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const helpMsg = appendMessage("system", [
      "Type / to see all commands with descriptions.",
      "",
      "Most useful:",
      "  /edit [query]       — browse & edit records (free)",
      "  /references [topic] — search across all memory",
      "  /archive [query]    — move a record to the filing cabinet",
      "  /recall [query]     — browse or search cold storage",
      "  /costs              — see your API spend",
      "  /cls                — clear chat",
      "",
      "Claude only answers from your memory files — no internet access.",
    ].join("\n"));
    const helpLink = document.createElement("a");
    helpLink.href = helpUrl("app");
    helpLink.textContent = "Full command reference & cost guide →";
    helpLink.style.cssText = "display:block;margin-top:8px;color:#a78bfa;font-size:0.85em;";
    helpMsg.appendChild(helpLink);
    return;
  }

  // /mnemonic [name[: custom text]?]
  const mnemonicMatch = userText.trim().match(/^\/?mnemonic(?:\s+(.+))?$/i);
  if (mnemonicMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    hideCmdSuggestions();
    const raw = mnemonicMatch[1] ? mnemonicMatch[1].trim() : null;
    let msg;
    if (!raw) {
      msg = "I'd like to create a mnemonic for someone. Please ask me who.";
    } else {
      const colonIdx = raw.indexOf(":");
      if (colonIdx !== -1) {
        const name = raw.slice(0, colonIdx).trim();
        const text = raw.slice(colonIdx + 1).trim();
        msg = `Save this as ${name}'s mnemonic exactly as written: "${text}"`;
      } else {
        msg = `Create mnemonic options for ${raw}`;
      }
    }
    await sendMessage(msg);
    return;
  }

  // /memory-game
  if (userText.trim().match(/^\/?memory-game$/i)) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    hideCmdSuggestions();
    const _gameHints = [
      "Start with someone from the second half of my people list.",
      "Lead with a relationship question, not a name-recall question.",
      "Pick someone whose entry has a lot of detail and start with a specific fact question.",
      "Start with a timeline question — ask about a recent interaction.",
      "Begin with someone I might not think of immediately — not the most prominent person.",
      "Lead with a context question: ask where or how I met someone.",
      "Start with someone whose Mnemonic subsection you can use for the first question.",
    ];
    const _gameHint = _gameHints[Math.floor(Math.random() * _gameHints.length)];
    await sendMessage(`Let's play a memory game. Start quizzing me on the people in my memory. ${_gameHint}`);
    return;
  }

  // /costs — show cost summary
  if (userText.trim().toLowerCase() === "/costs") {
    inputEl.value = "";
    inputEl.style.height = "auto";
    hideCmdSuggestions();
    try {
      const res = await api("/costs?date=" + new Date().toLocaleDateString("en-CA"), "GET");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed");
      const fmt = n => `$${n.toFixed(3)}`;
      const lines = [
        `Today (${data.today.date}):   ${data.today.requests} requests · ${fmt(data.today.cost)}`,
        `This week:   ${data.week.requests} requests · ${fmt(data.week.cost)}`,
      ];
      if (data.log.length > 1) {
        lines.push("");
        for (const d of data.log) {
          const label = d.date === data.today.date ? "today     " : d.date;
          lines.push(`  ${label}  ${String(d.requests).padStart(3)} req · ${fmt(d.cost)}`);
        }
      }
      lines.push("", "Claude API costs only. Voice/TTS (ElevenLabs or OpenAI) is billed separately by your provider.");
      appendMessage("system", lines.join("\n"));
    } catch (err) {
      appendMessage("system", `Could not load costs: ${err.message}`);
    }
    return;
  }

  // /audit [scope?] | /audit deep [scope?] | /audit ignored
  const auditMatch = userText.trim().match(/^\/?audit(?:\s+(deep|ignored|active|archived|all))?(?:\s+(active|archived|all))?$/i);
  if (auditMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    hideCmdSuggestions();
    const arg1 = (auditMatch[1] || "").toLowerCase();
    const arg2 = (auditMatch[2] || "").toLowerCase();
    if (arg1 === "ignored") {
      runAuditIgnored();
      return;
    }
    // When no explicit scope is given, the audit respects the Archive toggle:
    // toggle OFF → "active" only; toggle ON → "archived" (active + archive).
    // This keeps the audit consistent with what the user can SEE in the toggle.
    // Explicit flags (active / archived / all) override the toggle.
    const defaultScope = archiveMode > 0 ? "archived" : "active";
    if (arg1 === "deep") {
      const scope = arg2 || defaultScope;
      runAuditDeepWithConfirmation(scope);
      return;
    }
    const scope = (arg1 && ["active","archived","all"].includes(arg1)) ? arg1 : defaultScope;
    runAuditQuick(scope);
    return;
  }

  // /archive-review ignored — view dismissed archive-review candidates
  // (subcommand form, mirrors /audit ignored). The old /archive-ignored
  // command stays as a silent alias below for back-compat.
  if (userText.trim().match(/^\/?archive-review\s+ignored$/i)) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    runReviewIgnoredList({
      title: "Archive ignored",
      listEndpoint: "/archiveDismissed",
      undismissEndpoint: "/archiveUndismiss",
      pruneEndpoint: "/archivePrune",
      emptyHint: "Nothing dismissed yet. Use /archive-review and tap Skip on any candidate to add it here.",
    });
    return;
  }

  // /archive-review [file?] [deep?] [context?]
  const archiveReviewMatch = userText.trim().match(/^\/?archive-review(?:\s+(people|loops|reflections|fragments))?(?:\s+(deep))?(?:\s+(.+))?$/i);
  if (archiveReviewMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const fileArg = archiveReviewMatch[1];
    const isDeep = !!archiveReviewMatch[2];
    const context = archiveReviewMatch[3] || null;
    const fileMap = { people: "people.md", loops: "loops.md", reflections: "reflections.md", fragments: "fragments.md" };
    const targetFile = fileArg ? fileMap[fileArg.toLowerCase()] : null;
    const label = [targetFile || "all memory files", isDeep ? "deep" : "", context ? `"${context}"` : ""].filter(Boolean).join(" · ");
    appendMessage("system", `Analyzing ${label}...`);
    runArchiveReview(targetFile, isDeep, context);
    return;
  }

  // /deep-review ignored — view dismissed deep-review candidates (subcommand form).
  if (userText.trim().match(/^\/?deep-review\s+ignored$/i)) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    runReviewIgnoredList({
      title: "Deep-archive ignored",
      listEndpoint: "/deepDismissed",
      undismissEndpoint: "/deepUndismiss",
      pruneEndpoint: "/deepPrune",
      emptyHint: "Nothing dismissed yet. Use /deep-review and tap Skip on any candidate to add it here.",
    });
    return;
  }

  // /deep-review [file?] [context?] — AI suggests candidates for deep archive from long-term tier
  const deepReviewMatch = userText.trim().match(/^\/?deep-review(?:\s+(people|loops|reflections|fragments))?(?:\s+(.+))?$/i);
  if (deepReviewMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const fileArg = deepReviewMatch[1];
    const context = deepReviewMatch[2] || null;
    const label = [fileArg ? `archive_${fileArg}` : "all archive files", context ? `"${context}"` : ""].filter(Boolean).join(" · ");
    appendMessage("system", `Analyzing ${label} for cold storage candidates...`);
    runDeepReview(fileArg || null, context);
    return;
  }

  // /restore [query] [active?] — restore a record from archive or deep archive back to active memory
  // Searches both archive and deep archive tiers
  const restoreMatch = userText.trim().match(/^\/?restore\s+(.+?)(\s+active)?$/i);
  if (restoreMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const query = restoreMatch[1].trim();
    appendMessage("system", `Searching all archived tiers for "${query}"...`);
    try {
      const qp = `/findSections?query=${encodeURIComponent(query)}&titleOnly=true&scope=allarchived`;
      const res = await api(qp, "GET");
      const data = await res.json();
      if (!data.ok || !data.results.length) {
        appendMessage("system", `No archived heading matches "${query}". Try /references ${query} to search content.`);
        return;
      }
      const msgEl = appendMessage("system", `Found ${data.results.length} match${data.results.length !== 1 ? "es" : ""} for "${query}". Tap one to restore to active memory:`);
      const listEl = document.createElement("div");
      listEl.className = "delete-results-list";
      data.results.forEach(r => {
        const isDeep = r.file.startsWith("deeparchive_");
        const item = document.createElement("div");
        item.className = "delete-result-btn restore-result-item";
        item.setAttribute("tabindex", "0");
        item.setAttribute("role", "button");
        item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.click(); } });
        const tierLabel = isDeep ? "DEEP" : "ARCHIVE";
        item.innerHTML = `<span class="delete-result-file">${escapeHtml(r.file)} <span style="font-size:0.75em;opacity:0.7">[${tierLabel}]</span></span> › <span class="delete-result-section">${escapeHtml(r.section)}</span><span class="delete-result-preview">${escapeHtml(r.preview)}</span>`;
        item.addEventListener("click", async () => {
          if (item.classList.contains("delete-result-done") || item.querySelector(".archive-expand")) return;
          const liveFileMap = {
            "archive_people.md": "people.md", "archive_loops.md": "loops.md",
            "archive_reflections.md": "reflections.md", "archive_fragments.md": "fragments.md",
            "deeparchive_people.md": "people.md", "deeparchive_loops.md": "loops.md",
            "deeparchive_reflections.md": "reflections.md", "deeparchive_fragments.md": "fragments.md",
          };
          const destFile = liveFileMap[r.file] || r.file;
          const expand = document.createElement("div");
          expand.className = "archive-expand";
          expand.innerHTML = `<div class="archive-expand-content">Loading...</div><div class="archive-confirm-row"><span class="archive-confirm-label">Restore to ${destFile}?</span><button class="archive-yes-btn">Restore</button><button class="archive-no-btn">Cancel</button></div>`;
          item.appendChild(expand);
          try {
            const cr = await api(`/getMemoryFile?filename=${encodeURIComponent(r.file)}&section=${encodeURIComponent(r.section)}`, "GET");
            expand.querySelector(".archive-expand-content").textContent = cr.ok ? await cr.text() : "Could not load content.";
          } catch {
            expand.querySelector(".archive-expand-content").textContent = "Could not load content.";
          }
          expand.querySelector(".archive-yes-btn").addEventListener("click", async (e) => {
            e.stopPropagation();
            expand.remove();
            try {
              const endpoint = isDeep ? "/restoreFromDeep" : "/restoreFromArchive";
              const payload = { filename: r.file, section: r.section };
              const res = await api(endpoint, "POST", payload);
              const d = await res.json();
              if (d.ok) {
                const fromTier = isDeep ? "cold storage" : "archive";
                appendMessage("system", `Restored "${r.section}" from ${fromTier} → ${d.restoredTo}. It is now in your active memory and will be included in all chats.`);
                item.classList.add("delete-result-done");
                if (isDeep) refreshDeepBadge();
              } else {
                appendMessage("system", `Restore failed: ${d.error || "unknown error"}`);
              }
            } catch (err) {
              appendMessage("system", `Restore failed: ${err.message}`);
            }
          });
          expand.querySelector(".archive-no-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            expand.remove();
          });
          expand.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); expand.remove(); } });
        });
        listEl.appendChild(item);
      });
      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Search failed: ${err.message}`);
    }
    return;
  }

  // /archive [file?] [query] — fuzzy search then archive a specific record
  const archiveSectionMatch = userText.trim().match(/^\/?archive\s+(?:(people|loops|reflections|fragments)\s+)?(.+)/i);
  if (archiveSectionMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const fileMap = { people: "people.md", loops: "loops.md", reflections: "reflections.md", fragments: "fragments.md" };
    const fileArg = archiveSectionMatch[1];
    const query = archiveSectionMatch[2].trim();
    const targetFile = fileArg ? fileMap[fileArg.toLowerCase()] : null;
    appendMessage("system", `Searching for "${query}"...`);
    try {
      const qp = `/findSections?query=${encodeURIComponent(query)}&titleOnly=true${targetFile ? `&file=${encodeURIComponent(targetFile)}` : ""}`;
      const res = await api(qp, "GET");
      const data = await res.json();
      if (!data.ok || !data.results.length) {
        appendMessage("system", `No record heading matches "${query}". For content search try /references ${query} · for criteria-based review try /archive-review fragments deep ${query}`);
        return;
      }
      const fallbackNote = data.fallback ? " (no heading match — showing content matches)" : "";
      const msgEl = appendMessage("system", `Found ${data.results.length} match${data.results.length !== 1 ? "es" : ""} for "${query}"${fallbackNote}. Tap one to archive:`);
      const listEl = document.createElement("div");
      listEl.className = "delete-results-list";
      data.results.forEach(r => {
        const item = document.createElement("div");
        item.className = "delete-result-btn archive-result-item";
        item.setAttribute("tabindex", "0");
        item.setAttribute("role", "button");
        item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.click(); } });
        item.innerHTML = `<span class="delete-result-file">${escapeHtml(r.file)}</span> › <span class="delete-result-section">${escapeHtml(r.section)}</span><span class="delete-result-preview">${escapeHtml(r.preview)}</span>`;
        item.addEventListener("click", async () => {
          if (item.classList.contains("delete-result-done") || item.querySelector(".archive-expand")) return;
          // Load full record content then show inline confirm
          const expand = document.createElement("div");
          expand.className = "archive-expand";
          expand.innerHTML = `<div class="archive-expand-content">Loading...</div><div class="archive-confirm-row"><span class="archive-confirm-label">Move to archive_${escapeHtml(r.file.replace('.md',''))}?</span><button class="archive-yes-btn">Archive</button><button class="archive-no-btn">Cancel</button></div>`;
          item.appendChild(expand);
          // Load content
          try {
            const cr = await api(`/getMemoryFile?filename=${encodeURIComponent(r.file)}&section=${encodeURIComponent(r.section)}`, "GET");
            expand.querySelector(".archive-expand-content").textContent = cr.ok ? await cr.text() : "Could not load content.";
          } catch {
            expand.querySelector(".archive-expand-content").textContent = "Could not load content.";
          }
          expand.querySelector(".archive-yes-btn").addEventListener("click", async (e) => {
            e.stopPropagation();
            expand.remove();
            try {
              const res = await api("/moveToArchive", "POST", { moves: [{ sourceFile: r.file, sectionTitle: r.section }] });
              const d = await res.json();
              const result = d.results && d.results[0];
              if (result && result.ok) {
                appendMessage("system", `Archived "${r.section}" from ${r.file}.`);
                item.classList.add("delete-result-done");
              } else {
                appendMessage("system", `Archive failed: ${result?.error || "unknown error"}`);
              }
            } catch (err) {
              appendMessage("system", `Archive failed: ${err.message}`);
            }
          });
          expand.querySelector(".archive-no-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            expand.remove();
          });
          expand.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); expand.remove(); } });
        });
        listEl.appendChild(item);
      });
      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Search failed: ${err.message}`);
    }
    return;
  }

  // /deep [file?] [query] — move a record to deep archive (permanent tier)
  // Searches live memory AND archive files
  const deepSectionMatch = userText.trim().match(/^\/?deep\s+(?:(people|loops|reflections|fragments)\s+)?(.+)/i);
  if (deepSectionMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const fileMap = { people: "people.md", loops: "loops.md", reflections: "reflections.md", fragments: "fragments.md" };
    const fileArg = deepSectionMatch[1];
    const query = deepSectionMatch[2].trim();
    const targetFile = fileArg ? fileMap[fileArg.toLowerCase()] : null;
    appendMessage("system", `Searching for "${query}" in all tiers...`);
    try {
      const qp = `/findSections?query=${encodeURIComponent(query)}&titleOnly=true&scope=all${targetFile ? `&file=${encodeURIComponent(targetFile)}` : ""}`;
      const res = await api(qp, "GET");
      const data = await res.json();
      if (!data.ok || !data.results.length) {
        appendMessage("system", `No record heading matches "${query}". Try /references ${query} to search content.`);
        return;
      }
      const msgEl = appendMessage("system", `Found ${data.results.length} match${data.results.length !== 1 ? "es" : ""} for "${query}". Tap one to move to cold storage:`);
      const listEl = document.createElement("div");
      listEl.className = "delete-results-list";
      data.results.forEach(r => {
        const item = document.createElement("div");
        item.className = "delete-result-btn archive-result-item";
        item.setAttribute("tabindex", "0");
        item.setAttribute("role", "button");
        item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.click(); } });
        item.innerHTML = `<span class="delete-result-file">${escapeHtml(r.file)}</span> › <span class="delete-result-section">${escapeHtml(r.section)}</span><span class="delete-result-preview">${escapeHtml(r.preview)}</span>`;
        item.addEventListener("click", async () => {
          if (item.classList.contains("delete-result-done") || item.querySelector(".archive-expand")) return;
          const expand = document.createElement("div");
          expand.className = "archive-expand";
          expand.innerHTML = `<div class="archive-expand-content">Loading...</div><div class="archive-confirm-row"><span class="archive-confirm-label">Move to cold storage?</span><button class="archive-yes-btn">Move to Cold Storage</button><button class="archive-no-btn">Cancel</button></div>`;
          item.appendChild(expand);
          try {
            const cr = await api(`/getMemoryFile?filename=${encodeURIComponent(r.file)}&section=${encodeURIComponent(r.section)}`, "GET");
            expand.querySelector(".archive-expand-content").textContent = cr.ok ? await cr.text() : "Could not load content.";
          } catch {
            expand.querySelector(".archive-expand-content").textContent = "Could not load content.";
          }
          expand.querySelector(".archive-yes-btn").addEventListener("click", async (e) => {
            e.stopPropagation();
            expand.remove();
            try {
              const res = await api("/moveToDeep", "POST", { moves: [{ sourceFile: r.file, sectionTitle: r.section }] });
              const d = await res.json();
              const result = d.results && d.results[0];
              if (result && result.ok) {
                const deepCountNow = parseInt(document.getElementById("deep-record-count")?.textContent || "0", 10) || 0;
                const tutorial = deepCountNow === 0 ? " Use /recall to find it or /restore to bring it back. The 🔐 badge in the header shows your cold storage count and browses all records when tapped." : "";
                appendMessage("system", `Moved "${r.section}" to cold storage.${tutorial}`);
                item.classList.add("delete-result-done");
                refreshDeepBadge();
              } else {
                appendMessage("system", `Move failed: ${result?.error || "unknown error"}`);
              }
            } catch (err) {
              appendMessage("system", `Move failed: ${err.message}`);
            }
          });
          expand.querySelector(".archive-no-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            expand.remove();
          });
          expand.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); expand.remove(); } });
        });
        listEl.appendChild(item);
      });
      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Search failed: ${err.message}`);
    }
    return;
  }

  // /browse [cold|archive?] [file] — list all section headers from one memory file (no tokens)
  const browseMatch = userText.trim().match(/^\/?browse\s+(cold\s+|archive\s+)?(people|loops|reflections|fragments)$/i);
  if (browseMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    hideCmdSuggestions();
    const tier = browseMatch[1] ? browseMatch[1].trim().toLowerCase() : "active";
    const fileType = browseMatch[2].toLowerCase();
    const fileMap = {
      active:  { people: "people.md",            loops: "loops.md",            reflections: "reflections.md",            fragments: "fragments.md" },
      archive: { people: "archive_people.md",     loops: "archive_loops.md",    reflections: "archive_reflections.md",    fragments: "archive_fragments.md" },
      cold:    { people: "deeparchive_people.md", loops: "deeparchive_loops.md",reflections: "deeparchive_reflections.md",fragments: "deeparchive_fragments.md" },
    };
    const filename = fileMap[tier][fileType];
    const tierLabel = tier === "active" ? "ACTIVE" : tier === "archive" ? "ARCHIVE" : "COLD STORAGE";
    const msgEl = appendMessage("system", `Browsing ${tierLabel} › ${fileType}…`);
    try {
      const res = await api(`/browseFile?filename=${encodeURIComponent(filename)}`, "GET");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Browse failed");
      const items = data.sections || data.headers.map(h => ({ title: h, tokLabel: null }));
      if (!items.length) { msgEl.textContent = `${tierLabel} › ${fileType} is empty.`; return; }
      msgEl.textContent = `${tierLabel} › ${fileType} — ${items.length} record${items.length !== 1 ? "s" : ""}`;

      const listEl = document.createElement("div");
      listEl.className = "browse-list";

      const liveFileMap = {
        "archive_people.md": "people.md", "archive_loops.md": "loops.md",
        "archive_reflections.md": "reflections.md", "archive_fragments.md": "fragments.md",
        "deeparchive_people.md": "people.md", "deeparchive_loops.md": "loops.md",
        "deeparchive_reflections.md": "reflections.md", "deeparchive_fragments.md": "fragments.md",
      };

      const hasTok = items.some(it => it.tokLabel);
      const parseTokLabel = label => {
        if (!label) return 0;
        const m = label.match(/~([\d.]+)(k)?/);
        if (!m) return 0;
        return m[2] ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
      };

      const builtItems = items.map(({ title: sectionTitle, tokLabel }) => {
        const item = document.createElement("div");
        item.className = "browse-item";
        item.setAttribute("tabindex", "0");
        item.setAttribute("role", "button");

        const nameEl = document.createElement("span");
        nameEl.className = "browse-item-name";
        nameEl.textContent = sectionTitle;
        item.appendChild(nameEl);

        const tierBadge = document.createElement("span");
        tierBadge.className = "browse-item-tier";
        tierBadge.textContent = tierLabel;
        item.appendChild(tierBadge);

        if (tokLabel) {
          const tokEl = document.createElement("span");
          tokEl.className = "browse-item-tok";
          tokEl.textContent = tokLabel;
          item.appendChild(tokEl);
        }

        item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.click(); } });

        item.addEventListener("click", async () => {
          if (item.querySelector(".browse-expand")) return;

          if (tier === "active" || tier === "archive") {
            // Load content and open edit modal
            try {
              const cr = await api(`/getMemoryFile?filename=${encodeURIComponent(filename)}&section=${encodeURIComponent(sectionTitle)}`, "GET");
              if (!cr.ok) { appendMessage("system", "Could not load record."); return; }
              const content = await cr.text();
              showEditModal(sectionTitle, filename, content, null);
            } catch (err) {
              appendMessage("system", `Load failed: ${err.message}`);
            }
          } else {
            // Cold storage — show restore buttons inline
            if (item.classList.contains("browse-done")) return;
            const destFile = liveFileMap[filename] || filename;
            const expand = document.createElement("div");
            expand.className = "browse-expand archive-expand";
            expand.innerHTML = `<div class="archive-expand-content">Loading…</div><div class="archive-confirm-row"><span class="archive-confirm-label">Restore "${escapeHtml(sectionTitle)}" to ${escapeHtml(destFile)}?</span><button class="archive-yes-btn">→ Active</button><button class="archive-yes-btn browse-archive-btn">→ Archive</button><button class="archive-no-btn">Cancel</button></div>`;
            item.appendChild(expand);
            try {
              const cr = await api(`/getMemoryFile?filename=${encodeURIComponent(filename)}&section=${encodeURIComponent(sectionTitle)}`, "GET");
              expand.querySelector(".archive-expand-content").textContent = cr.ok ? await cr.text() : "Could not load.";
            } catch { expand.querySelector(".archive-expand-content").textContent = "Could not load."; }

            expand.querySelectorAll(".archive-yes-btn").forEach(btn => {
              btn.addEventListener("click", async e => {
                e.stopPropagation();
                const toArchive = btn.classList.contains("browse-archive-btn");
                expand.remove();
                try {
                  const res = await api("/restoreFromDeep", "POST", { filename, section: sectionTitle, toArchive });
                  const d = await res.json();
                  if (d.ok) {
                    appendMessage("system", `Restored "${sectionTitle}" → ${toArchive ? "archive" : "active memory"}.`);
                    item.classList.add("browse-done");
                    item.style.opacity = "0.4";
                    refreshDeepBadge();
                  } else {
                    appendMessage("system", `Restore failed: ${d.error}`);
                  }
                } catch (err) { appendMessage("system", `Restore failed: ${err.message}`); }
              });
            });
            expand.querySelector(".archive-no-btn").addEventListener("click", e => { e.stopPropagation(); expand.remove(); });
            expand.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); expand.remove(); } });
          }
        });

        return { el: item, sortName: sectionTitle.toLowerCase(), sortTok: parseTokLabel(tokLabel) };
      });

      // Sort header
      let browseSort = { col: null, dir: null };
      const nameHeaderEl = document.createElement("span");
      nameHeaderEl.className = "browse-header-col";
      nameHeaderEl.title = t("tooltip.sort-name");
      const tokHeaderEl = hasTok ? document.createElement("span") : null;
      if (tokHeaderEl) { tokHeaderEl.className = "browse-header-col browse-header-tok-col"; tokHeaderEl.title = t("tooltip.sort-size"); }

      const applyBrowseSort = () => {
        const sorted = browseSort.col === "name"
          ? [...builtItems].sort((a, b) => browseSort.dir === "asc" ? a.sortName.localeCompare(b.sortName) : b.sortName.localeCompare(a.sortName))
          : browseSort.col === "tok"
            ? [...builtItems].sort((a, b) => browseSort.dir === "asc" ? a.sortTok - b.sortTok : b.sortTok - a.sortTok)
            : [...builtItems];
        builtItems.forEach(({ el }) => el.remove());
        sorted.forEach(({ el }) => listEl.appendChild(el));
        nameHeaderEl.textContent = "Name" + (browseSort.col === "name" ? (browseSort.dir === "asc" ? " ▲" : " ▼") : "");
        if (tokHeaderEl) tokHeaderEl.textContent = "Size" + (browseSort.col === "tok" ? (browseSort.dir === "asc" ? " ▲" : " ▼") : "");
      };

      const cycleSort = col => {
        browseSort = browseSort.col !== col ? { col, dir: "asc" }
          : browseSort.dir === "asc" ? { col, dir: "desc" }
          : { col: null, dir: null };
        applyBrowseSort();
      };

      const headerEl = document.createElement("div");
      headerEl.className = "browse-header";
      nameHeaderEl.textContent = "Name";
      nameHeaderEl.addEventListener("click", () => cycleSort("name"));
      headerEl.appendChild(nameHeaderEl);
      if (tokHeaderEl) {
        tokHeaderEl.textContent = "Size";
        tokHeaderEl.addEventListener("click", () => cycleSort("tok"));
        headerEl.appendChild(tokHeaderEl);
      }
      listEl.appendChild(headerEl);
      builtItems.forEach(({ el }) => listEl.appendChild(el));

      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Browse failed: ${err.message}`);
    }
    return;
  }

  // Malformed /browse intercept: input starts with /browse but didn't match the
  // valid grammar above. Show usage and DO NOT fall through to /chat — Claude
  // shouldn't be asked to interpret a half-typed command. Input is preserved
  // (selected) so the user can correct in place instead of retyping.
  if (/^\/?browse(\s|$)/i.test(userText.trim())) {
    hideCmdSuggestions();
    inputEl.focus();
    inputEl.select();
    appendMessage(
      "system",
      "Usage: /browse [archive|cold] <people|loops|fragments|reflections>\n\n" +
      "Examples: /browse people · /browse archive loops · /browse cold fragments\n\n" +
      "Tip: type /browse and use ↑/↓ arrows to pick from the list."
    );
    return;
  }

  // /compact-review [file?] — surface verbose records (no level flag; level chosen per-record in modal)
  const compactReviewMatch = userText.trim().match(/^\/?compact-review(?:\s+(people|loops|reflections|fragments))?$/i);
  if (compactReviewMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const fileMap = { people: "people.md", loops: "loops.md", reflections: "reflections.md", fragments: "fragments.md" };
    const fileArg = compactReviewMatch[1];
    const targetFile = fileArg ? fileMap[fileArg.toLowerCase()] : null;
    appendMessage("system", `Scanning ${targetFile || "all memory files"} for verbose records...`);
    runCompactReview(targetFile);
    return;
  }

  // /compact [file?] [query] — fuzzy search then open compact modal for that record
  const compactSectionMatch = userText.trim().match(/^\/?compact\s+(?:(people|loops|reflections|fragments)\s+)?(.+)/i);
  if (compactSectionMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const fileMap = { people: "people.md", loops: "loops.md", reflections: "reflections.md", fragments: "fragments.md" };
    const fileArg = compactSectionMatch[1];
    const query = compactSectionMatch[2].trim();
    const targetFile = fileArg ? fileMap[fileArg.toLowerCase()] : null;
    appendMessage("system", `Searching for "${query}"...`);
    try {
      const qp = `/findSections?query=${encodeURIComponent(query)}&titleOnly=true${targetFile ? `&file=${encodeURIComponent(targetFile)}` : ""}`;
      const res = await api(qp, "GET");
      const data = await res.json();
      if (!data.ok || !data.results.length) {
        appendMessage("system", `No record heading matches "${query}". Try /references ${query} to search record content.`);
        return;
      }
      const fallbackNote = data.fallback ? " (no heading match — showing content matches)" : "";
      if (data.results.length === 1) {
        showCompactModal([{ file: data.results[0].file, sectionTitle: data.results[0].section, verbosityScore: null, tokenSavings: null }]);
        return;
      }
      const msgEl = appendMessage("system", `Found ${data.results.length} matches for "${query}"${fallbackNote}. Tap one to compact:`);
      const listEl = document.createElement("div");
      listEl.className = "delete-results-list";
      data.results.forEach(r => {
        const btn = document.createElement("button");
        btn.className = "delete-result-btn";
        btn.innerHTML = `<span class="delete-result-file">${escapeHtml(r.file)}</span> › <span class="delete-result-section">${escapeHtml(r.section)}</span><span class="delete-result-preview">${escapeHtml(r.preview)}</span>`;
        btn.addEventListener("click", () => {
          showCompactModal([{ file: r.file, sectionTitle: r.section, verbosityScore: null, tokenSavings: null }]);
        });
        listEl.appendChild(btn);
      });
      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Search failed: ${err.message}`);
    }
    return;
  }

  // /edit [file?] [query] — fuzzy search then open editor
  const editSectionMatch = userText.trim().match(/^\/?edit\s+(?:(people|loops|reflections|fragments)\s+)?(.+)/i);
  if (editSectionMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const fileMap = { people: "people.md", loops: "loops.md", reflections: "reflections.md", fragments: "fragments.md" };
    const fileArg = editSectionMatch[1];
    const query = editSectionMatch[2].trim();
    const targetFile = fileArg ? fileMap[fileArg.toLowerCase()] : null;
    appendMessage("system", `Searching for "${query}"${archiveMode === 1 ? " (including archive)" : ""}...`);
    try {
      const qp = `/findSections?query=${encodeURIComponent(query)}&titleOnly=true${targetFile ? `&file=${encodeURIComponent(targetFile)}` : ""}${archiveMode === 1 ? "&scope=all" : ""}`;
      const res = await api(qp, "GET");
      const data = await res.json();
      if (!data.ok || !data.results.length) {
        const archiveHint = !archiveMode ? " · enable 📦 Archive to include older records, or use /recall to search cold storage" : "";
        appendMessage("system", `No record heading matches "${query}". Try /references ${query} to search record content.${archiveHint}`);
        return;
      }
      const fallbackNote = data.fallback ? " (no heading match — showing content matches)" : "";
      if (data.results.length === 1) {
        runEditSection(data.results[0].file, data.results[0].section, null, data.results[0].occurrenceIndex);
        return;
      }
      // Multiple matches — show tappable list
      const msgEl = appendMessage("system", `Found ${data.results.length} matches for "${query}"${fallbackNote}. Tap one to edit:`);
      const listEl = document.createElement("div");
      listEl.className = "delete-results-list";
      data.results.forEach(r => {
        const btn = document.createElement("button");
        btn.className = "delete-result-btn";
        btn.innerHTML = `<span class="delete-result-file">${escapeHtml(r.file)}</span> › <span class="delete-result-section">${escapeHtml(r.section)}</span><span class="delete-result-preview">${escapeHtml(r.preview)}</span>`;
        btn.addEventListener("click", () => {
          runEditSection(r.file, r.section, null, r.occurrenceIndex);
        });
        listEl.appendChild(btn);
      });
      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Search failed: ${err.message}`);
    }
    return;
  }

  // /delete [query] — search and permanently delete a section
  const deleteMatch = userText.trim().match(/^\/?delete\s+(.+)/i);
  if (deleteMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const query = deleteMatch[1].trim();
    appendMessage("system", `Searching for "${query}"${archiveMode ? " (including archive)" : ""}...`);
    try {
      const res = await api(`/findSections?query=${encodeURIComponent(query)}&titleOnly=true${archiveMode ? "&scope=all" : ""}`, "GET");
      const data = await res.json();
      if (!data.ok || !data.results.length) {
        const archiveHint = !archiveMode ? " · enable 📦 Archive to include older records, or use /recall to search cold storage" : "";
        appendMessage("system", `No record heading matches "${query}". Try /references ${query} to search record content.${archiveHint}`);
        return;
      }
      const fallbackNote = data.fallback ? " (no heading match — showing content matches)" : "";
      if (data.results.length === 1) {
        showDeleteModal(data.results[0].file, data.results[0].section, null, false, data.results[0].occurrenceIndex);
        return;
      }
      // Multiple matches — show numbered list
      const msgEl = appendMessage("system", `Found ${data.results.length} matches for "${query}"${fallbackNote}. Tap one to delete:`);
      const listEl = document.createElement("div");
      listEl.className = "delete-results-list";
      data.results.forEach(r => {
        const btn = document.createElement("button");
        btn.className = "delete-result-btn delete-hover";
        btn.innerHTML = `<span class="delete-result-file">${escapeHtml(r.file)}</span> › <span class="delete-result-section">${escapeHtml(r.section)}</span><span class="delete-result-preview">${escapeHtml(r.preview)}</span>`;
        btn.addEventListener("click", () => {
          showDeleteModal(r.file, r.section, btn, false, r.occurrenceIndex);
        });
        listEl.appendChild(btn);
      });
      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Search failed: ${err.message}`);
    }
    return;
  }

  // /references [query] — find all records that mention a person or topic (content search)
  const referencesMatch = userText.trim().match(/^\/?references\s+(.+)/i);
  if (referencesMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const query = referencesMatch[1].trim();
    appendMessage("system", `Searching all records for references to "${query}"${archiveMode ? " (including archive)" : ""}...`);
    try {
      const res = await api(`/findSections?query=${encodeURIComponent(query)}${archiveMode ? "&scope=all" : ""}`, "GET");
      const data = await res.json();
      if (!data.ok || !data.results.length) {
        const archiveHint = !archiveMode ? " · enable 📦 Archive to include older records, or use /recall to search cold storage" : "";
        appendMessage("system", `No records mention "${query}".${archiveHint}`);
        return;
      }
      const msgEl = appendMessage("system", `Found ${data.results.length} record${data.results.length !== 1 ? "s" : ""} mentioning "${query}":`);
      const listEl = document.createElement("div");
      listEl.className = "delete-results-list";
      data.results.forEach(r => {
        const btn = document.createElement("button");
        btn.className = "delete-result-btn";
        btn.innerHTML = `<span class="delete-result-file">${escapeHtml(r.file)}</span> › <span class="delete-result-section">${escapeHtml(r.section)}</span><span class="delete-result-preview">${highlightKeyword(r.preview, query)}</span>`;
        btn.addEventListener("click", () => { runEditSection(r.file, r.section, query, r.occurrenceIndex); });
        listEl.appendChild(btn);
      });
      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Search failed: ${err.message}`);
    }
    return;
  }

  // /recall [query] — search cold storage by name or topic
  const recallMatch = userText.trim().match(/^\/?recall(?:\s+(.+))?$/i);
  if (recallMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    const query = recallMatch[1] ? recallMatch[1].trim() : null;

    // Open the cold-storage expand on a host element (the visible row).
    // Shared by the search-result list (buildRecallItem) and the browse-style
    // sortable list rendered for the cold-storage pill click. The expand is
    // appended directly to hostEl, so hostEl MUST be visible for the user to
    // see it (don't pass a hidden stub).
    async function openColdRecord(r, hostEl) {
      if (hostEl.querySelector(".archive-expand")) return;
      let content = r.content;
      if (!content) {
        try {
          hostEl.style.opacity = "0.5";
          const res = await api(`/getMemoryFile?filename=${encodeURIComponent(r.file)}&section=${encodeURIComponent(r.section)}`, "GET");
          content = res.ok ? await res.text() : "(Could not load record content.)";
        } catch { content = "(Could not load record content.)"; }
        finally { hostEl.style.opacity = ""; }
      }
      const expand = document.createElement("div");
      expand.className = "archive-expand";
      // Button order matches the Edit Record modal pattern:
      //   destructive on the left (Delete) → neutral middle (Cancel) →
      //   tier-mover (Restore dropdown + button) → primary save (Save) →
      //   secondary primary (Use in chat) on the right.
      // .archive-no-btn (Cancel) gets margin-left:auto via CSS so Delete
      // sits alone on the left and everything else clusters right.
      expand.innerHTML = `<textarea class="archive-expand-textarea" spellcheck="false"></textarea><div class="archive-confirm-row vault-action-row"><button class="recall-delete-btn btn-ghost">Delete</button><button class="archive-no-btn">Cancel</button><select class="vault-restore-select"><option value="active">Restore to active</option><option value="archive">Restore to archive</option></select><button class="archive-yes-btn">Restore</button><button class="vault-save-btn" disabled>Save</button><button class="vault-context-btn">Use in chat</button></div>`;
      const ta       = expand.querySelector(".archive-expand-textarea");
      const saveBtn  = expand.querySelector(".vault-save-btn");
      ta.value = content;
      ta.dataset.originalContent = content;
      ta.dataset.openHash = await _sha256Hex(content);
      // Auto-grow up to a cap so short records don't waste vertical space and
      // long ones become scrollable rather than pushing buttons off-screen.
      const autosize = () => {
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 260) + "px";
      };
      requestAnimationFrame(autosize);
      ta.addEventListener("input", () => {
        autosize();
        saveBtn.disabled = ta.value === ta.dataset.originalContent;
      });
      hostEl.appendChild(expand);
      expand.querySelector(".archive-yes-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        const dest = expand.querySelector(".vault-restore-select").value;
        const restorePayload = { filename: r.file, section: r.section, toArchive: dest === "archive" };
        if (!r.file || !r.section) { appendMessage("system", `Restore failed: missing file (${r.file}) or section (${r.section})`); return; }
        try {
          const res = await api("/restoreFromDeep", "POST", restorePayload);
          const data = await res.json();
          if (!data.ok) { appendMessage("system", `Restore failed: ${data.error}`); return; }
          expand.remove();
          hostEl.classList.add("delete-result-done");
          const destLabel = dest === "archive" ? "archive" : "active memory";
          appendMessage("system", `"${r.section}" restored to ${destLabel}.`);
          refreshDeepBadge();
        } catch (err) { appendMessage("system", `Restore failed: ${err.message}`); }
      });
      // Save edits back to the deep-archive file. Uses /replaceSection so
      // header changes are validated for collision (same path Edit Record uses).
      saveBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newText = ta.value.trim();
        if (!newText) { appendMessage("system", "Save failed: record cannot be empty."); return; }
        saveBtn.disabled = true;
        const prevLabel = saveBtn.textContent;
        saveBtn.textContent = "Saving…";
        try {
          const sectionHash = ta.dataset.openHash || "";
          const res = await api("/replaceSection", "POST", { filename: r.file, sectionTitle: r.section, compactedText: newText, ...(sectionHash ? { sectionHash } : {}), ...(typeof r.occurrenceIndex === "number" ? { occurrenceIndex: r.occurrenceIndex } : {}) });
          const data = await res.json();
          if (await handleConflict(res, data, {
            container: expand,
            onReload: async () => {
              try {
                const rr = await api(`/getMemoryFile?filename=${encodeURIComponent(r.file)}&section=${encodeURIComponent(r.section)}`, "GET");
                if (!rr.ok) { appendMessage("system", "Reload failed — could not fetch fresh content."); return; }
                const fresh = await rr.text();
                ta.value = fresh;
                ta.dataset.openHash = await _sha256Hex(fresh);
              } catch (e) {
                appendMessage("system", `Reload failed: ${e.message}`);
              }
            },
          })) {
            saveBtn.disabled = false;
            saveBtn.textContent = prevLabel;
            return;
          }
          if (!data.ok) {
            appendMessage("system", `Save failed: ${data.error || "unknown error"}`);
            saveBtn.disabled = false;
            saveBtn.textContent = prevLabel;
            return;
          }
          // Reset the dirty baseline so Save re-disables until the next edit.
          ta.dataset.originalContent = ta.value;
          content = ta.value; // so Use in chat (below) picks up edits
          saveBtn.textContent = "Saved";
          setTimeout(() => { if (saveBtn.isConnected) saveBtn.textContent = prevLabel; }, 1200);
        } catch (err) {
          appendMessage("system", `Save failed: ${err.message}`);
          saveBtn.disabled = false;
          saveBtn.textContent = prevLabel;
        }
      });
      expand.querySelector(".vault-context-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        // Use the current textarea value so unsaved edits are reflected in
        // the chat-loaded context. Matches what the user is looking at.
        const useContent = ta.value;
        expand.remove();
        pendingRecallContext = { section: r.section, file: r.file, content: useContent };
        updateVaultBar();
        updateMemoryBadge(_workingBytes);
        appendMessage("system", `🔐 "${r.section}" loaded from cold storage — stays in chat until you tap clear.`);
      });
      // Delete from cold storage — uses the standard delete-confirm modal,
      // which surfaces the "no restore path" warning automatically since
      // the file starts with deeparchive_. After delete, the deleteModalConfirm
      // handler refreshes the deep badge and marks hostEl visually done.
      expand.querySelector(".recall-delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        expand.remove();
        showDeleteModal(r.file, r.section, hostEl, false, null);
      });
      expand.querySelector(".archive-no-btn").addEventListener("click", (e) => { e.stopPropagation(); expand.remove(); });
      expand.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); expand.remove(); } });
    }

    // Build a search-result row for /recall [query] mode.
    function buildRecallItem(r, listEl) {
      const item = document.createElement("div");
      item.className = "delete-result-btn restore-result-item";
      item.setAttribute("tabindex", "0");
      item.setAttribute("role", "button");
      item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.click(); } });
      const fileDisplay = r.file.replace("deeparchive_", "").replace(".md", "").replace(/_/g, " ");
      const fileLabel = `<span class="delete-result-file">${escapeHtml(fileDisplay)} <span style="font-size:0.75em;opacity:0.7">[cold storage]</span></span>`;
      item.innerHTML = `${fileLabel} › <span class="delete-result-section">${escapeHtml(r.section)}</span>${r.preview ? `<span class="delete-result-preview">${escapeHtml(r.preview)}</span>` : ""}`;
      item.addEventListener("click", () => openColdRecord(r, item));
      listEl.appendChild(item);
    }

    if (!query) {
      // Browse mode: render a /browse-style multi-section sortable view.
      // One sortable list per file (People / Loops / Reflections / Fragments)
      // with token sizes, click-to-expand showing the full record + Use in
      // chat / Restore / Delete. Mirrors the look of /browse cold per-file
      // but stacks all four sections in one chat message.
      appendMessage("system", "Loading cold storage contents...");
      try {
        const files = ["deeparchive_people.md", "deeparchive_loops.md", "deeparchive_reflections.md", "deeparchive_fragments.md"];
        const labels = {
          "deeparchive_people.md":      "People",
          "deeparchive_loops.md":       "Loops",
          "deeparchive_reflections.md": "Reflections",
          "deeparchive_fragments.md":   "Fragments",
        };
        const responses = await Promise.all(files.map(f =>
          api(`/browseFile?filename=${encodeURIComponent(f)}`, "GET")
            .then(r => r.json())
            .catch(() => ({ ok: false, sections: [] }))
        ));
        const total = responses.reduce((s, r) => s + (r.sections?.length || 0), 0);
        if (total === 0) {
          appendMessage("system", "Cold storage is empty. Use /deep or /deep-review to move records here.");
          return;
        }
        const msgEl = appendMessage("system", `Cold Storage — ${total} record${total !== 1 ? "s" : ""}`);

        const parseTokLabel = label => {
          if (!label) return 0;
          const m = label.match(/~([\d.]+)(k)?/);
          if (!m) return 0;
          return m[2] ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
        };

        files.forEach((file, idx) => {
          const items = responses[idx].sections || [];
          if (items.length === 0) return;

          // Section header showing the file label + count.
          const groupHeader = document.createElement("div");
          groupHeader.className = "browse-group-header";
          groupHeader.textContent = `${labels[file]} — ${items.length} record${items.length !== 1 ? "s" : ""}`;
          msgEl.appendChild(groupHeader);

          // Browse-style list with Name / Size sort header.
          const listEl = document.createElement("div");
          listEl.className = "browse-list";
          msgEl.appendChild(listEl);

          const hasTok = items.some(it => it.tokLabel);
          const builtItems = items.map(({ title: sectionTitle, tokLabel }) => {
            const row = document.createElement("div");
            row.className = "browse-item";
            row.setAttribute("tabindex", "0");
            row.setAttribute("role", "button");

            const nameEl = document.createElement("span");
            nameEl.className = "browse-item-name";
            nameEl.textContent = sectionTitle;
            row.appendChild(nameEl);

            const tierBadge = document.createElement("span");
            tierBadge.className = "browse-item-tier";
            tierBadge.textContent = "COLD";
            row.appendChild(tierBadge);

            if (tokLabel) {
              const tokEl = document.createElement("span");
              tokEl.className = "browse-item-tok";
              tokEl.textContent = tokLabel;
              row.appendChild(tokEl);
            }

            row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); } });

            // Click → expand directly on this row using the shared helper.
            row.addEventListener("click", () => {
              openColdRecord({ file, section: sectionTitle, preview: "", content: null }, row);
            });

            return { el: row, sortName: sectionTitle.toLowerCase(), sortTok: parseTokLabel(tokLabel) };
          });

          // Sort header (per-section state).
          let sortState = { col: null, dir: null };
          const headerEl = document.createElement("div");
          headerEl.className = "browse-header";
          const nameHeaderEl = document.createElement("span");
          nameHeaderEl.className = "browse-header-col browse-header-name-col";
          nameHeaderEl.title = t("tooltip.sort-name");
          const tokHeaderEl = hasTok ? document.createElement("span") : null;
          if (tokHeaderEl) { tokHeaderEl.className = "browse-header-col browse-header-tok-col"; tokHeaderEl.title = t("tooltip.sort-size"); }

          const applySort = () => {
            const sorted = sortState.col === "name"
              ? [...builtItems].sort((a, b) => sortState.dir === "asc" ? a.sortName.localeCompare(b.sortName) : b.sortName.localeCompare(a.sortName))
              : sortState.col === "tok"
                ? [...builtItems].sort((a, b) => sortState.dir === "asc" ? a.sortTok - b.sortTok : b.sortTok - a.sortTok)
                : [...builtItems];
            builtItems.forEach(({ el }) => el.remove());
            sorted.forEach(({ el }) => listEl.appendChild(el));
            nameHeaderEl.textContent = "Name" + (sortState.col === "name" ? (sortState.dir === "asc" ? " ▲" : " ▼") : "");
            if (tokHeaderEl) tokHeaderEl.textContent = "Size" + (sortState.col === "tok" ? (sortState.dir === "asc" ? " ▲" : " ▼") : "");
          };
          const cycleSort = col => {
            sortState = sortState.col !== col ? { col, dir: "asc" }
              : sortState.dir === "asc" ? { col, dir: "desc" }
              : { col: null, dir: null };
            applySort();
          };

          nameHeaderEl.textContent = "Name";
          nameHeaderEl.addEventListener("click", () => cycleSort("name"));
          headerEl.appendChild(nameHeaderEl);
          if (tokHeaderEl) {
            tokHeaderEl.textContent = "Size";
            tokHeaderEl.addEventListener("click", () => cycleSort("tok"));
            headerEl.appendChild(tokHeaderEl);
          }
          listEl.appendChild(headerEl);
          builtItems.forEach(({ el }) => listEl.appendChild(el));
        });

        const hint = document.createElement("div");
        hint.style.cssText = "font-size:0.75em;opacity:0.5;padding:6px 2px 2px";
        hint.textContent = "Tip: type /recall [name] to search cold storage by content";
        msgEl.appendChild(hint);
      } catch (err) {
        appendMessage("system", `Cold storage browse failed: ${err.message}`);
      }
      return;
    }

    // Search mode
    appendMessage("system", `Searching cold storage for "${query}"...`);
    try {
      const res = await api("/recall", "POST", { query, maxResults: 5 });
      const data = await res.json();
      if (!data.ok || !data.results || !data.results.length) {
        appendMessage("system", `No cold storage records match "${query}". Try /references ${query} to search active and archive memory.`);
        return;
      }
      const msgEl = appendMessage("system", `Found ${data.results.length} cold storage record${data.results.length !== 1 ? "s" : ""} matching "${query}". Tap one to preview:`);
      const listEl = document.createElement("div");
      listEl.className = "delete-results-list";
      data.results.forEach(r => buildRecallItem(r, listEl));
      msgEl.appendChild(listEl);
    } catch (err) {
      appendMessage("system", `Cold storage search failed: ${err.message}`);
    }
    return;
  }

  // /archive-ignored — inline list of sections dismissed from /archive-review,
  // mirroring the /audit ignored UX (per-row Un-ignore + Prune ghosts footer).
  if (userText.trim().match(/^\/?archive-ignored$/i)) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    runReviewIgnoredList({
      title: "Archive ignored",
      listEndpoint: "/archiveDismissed",
      undismissEndpoint: "/archiveUndismiss",
      pruneEndpoint: "/archivePrune",
      emptyHint: "Nothing dismissed yet. Use /archive-review and tap Skip on any candidate to add it here.",
    });
    return;
  }

  // /deep-ignored — same UX as /archive-ignored, scoped to /deep-review dismissals.
  if (userText.trim().match(/^\/?deep-ignored$/i)) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    runReviewIgnoredList({
      title: "Deep-archive ignored",
      listEndpoint: "/deepDismissed",
      undismissEndpoint: "/deepUndismiss",
      pruneEndpoint: "/deepPrune",
      emptyHint: "Nothing dismissed yet. Use /deep-review and tap Skip on any candidate to add it here.",
    });
    return;
  }

  // /journal-flush [days] — move journal entries older than N days to archive_reflections.md
  const flushMatch = userText.trim().match(/^\/?journal-flush(?:\s+(\d+))?$/i);
  if (flushMatch) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    hideCmdSuggestions();
    const days = flushMatch[1] ? parseInt(flushMatch[1], 10) : 60;
    // Normalize cutoff to UTC midnight to avoid timezone drift
    const cutoffUTC = new Date();
    cutoffUTC.setUTCHours(0, 0, 0, 0);
    cutoffUTC.setUTCDate(cutoffUTC.getUTCDate() - days);
    try {
      const res = await api("/getMemoryFile?filename=reflections.md", "GET");
      if (!res.ok) throw new Error("Could not load reflections.md");
      const text = await res.text();
      const lines = text.split("\n");
      // All dated ## sections in reflections.md are journal entries — no Type tag needed
      const aged = [];
      for (const line of lines) {
        const m = line.match(/^##\s+(\d{4}-\d{2}-\d{2})(.*)/);
        if (!m) continue;
        const title = (m[1] + m[2]).trim();
        if (new Date(m[1]) < cutoffUTC) aged.push(title);
      }
      if (!aged.length) {
        appendMessage("system", `No journal entries older than ${days} days found in reflections.md.`);
        return;
      }
      // Extract full section blocks for zip export
      // Use trim() on both sides to guard against trailing-whitespace mismatch
      const titleSet = new Set(aged.map(t => t.trim()));
      const agedBlocks = [];
      let si = 0;
      while (si < lines.length) {
        const hm = lines[si].match(/^##\s+(.+)/);
        if (hm && titleSet.has(hm[1].trim())) {
          const block = [lines[si++]];
          while (si < lines.length && !/^##\s+/.test(lines[si])) block.push(lines[si++]);
          agedBlocks.push(block.join("\n").trim());
        } else { si++; }
      }
      const doMove = async (btnRow) => {
        btnRow.remove();
        appendMessage("system", `Moving ${aged.length} entr${aged.length !== 1 ? "ies" : "y"} to archive_reflections.md...`);
        try {
          const moves = aged.map(t => ({ sourceFile: "reflections.md", sectionTitle: t }));
          const mvRes = await api("/moveToArchive", "POST", { moves });
          const mvData = await mvRes.json();
          const succeeded = mvData.results.filter(r => r.ok).length;
          const failed = mvData.results.filter(r => !r.ok);
          let msg = `Archived ${succeeded} entr${succeeded !== 1 ? "ies" : "y"} to archive_reflections.md.`;
          if (failed.length) msg += `\n⚠ ${failed.length} failed: ${failed.map(f => f.sectionTitle).join(", ")}`;
          appendMessage("system", msg);
        } catch (err) {
          appendMessage("system", `Flush failed: ${err.message}`);
        }
      };
      // Build a readable label for each entry: timestamp + first non-metadata content line
      const entryLabels = agedBlocks.map((block, i) => {
        const blockLines = block.split("\n");
        const firstContent = blockLines.find(l => l.trim() && !l.startsWith("##") && !l.match(/^[-–]\s*\w+:/));
        const preview = firstContent ? ` — ${firstContent.trim().slice(0, 60)}${firstContent.trim().length > 60 ? "…" : ""}` : "";
        return `  · ${aged[i]}${preview}`;
      });
      const msgEl = appendMessage("system", `${aged.length} journal entr${aged.length !== 1 ? "ies" : "y"} older than ${days} days — move all to archive?\n\nEntries that will be moved:\n${entryLabels.join("\n")}`);
      const btnRow = document.createElement("div");
      btnRow.className = "delete-results-list";
      const dlMoveBtn = document.createElement("button");
      dlMoveBtn.className = "btn-archive-confirm";
      dlMoveBtn.textContent = "Download zip + Move";
      dlMoveBtn.addEventListener("click", async () => {
        const dateStr = new Date().toISOString().split("T")[0];
        const zipContent = `# Journal Archive — ${dateStr}\n\nExported from WhosWhoZoo before archiving.\n\n---\n\n` + agedBlocks.join("\n\n---\n\n");
        const zip = new JSZip();
        zip.file(`journal-archive-${dateStr}.md`, zipContent);
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `journal-archive-${dateStr}.zip`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        await doMove(btnRow);
      });
      const moveBtn = document.createElement("button");
      moveBtn.className = "btn-archive-confirm";
      moveBtn.textContent = `Move ${aged.length} to archive`;
      moveBtn.addEventListener("click", () => doMove(btnRow));
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn-secondary";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => { btnRow.remove(); appendMessage("system", "Cancelled."); });
      btnRow.appendChild(dlMoveBtn);
      btnRow.appendChild(moveBtn);
      btnRow.appendChild(cancelBtn);
      msgEl.appendChild(btnRow);
    } catch (err) {
      appendMessage("system", `Flush failed: ${err.message}`);
    }
    return;
  }

  // /journal <entry> — polish with Claude, preview, then save to reflections.md
  const journalMatch = userText.trim().match(/^\/?journal\s+([\s\S]+)/i);
  if (!brief && (journalMatch || /^\/?journal$/i.test(userText.trim()))) {
    inputEl.value = "";
    inputEl.style.height = "auto";
    hideCmdSuggestions();
    const entryText = journalMatch ? journalMatch[1].trim() : null;
    if (!entryText) {
      appendMessage("system", 'Usage: /journal <your entry>\n\nOr hold the orb in conversation mode to start a voice journal session.');
      return;
    }
    const thinking = appendMessage("thinking", "Polishing entry...");
    try {
      const res = await api("/polishText", "POST", { text: entryText });
      const data = await res.json();
      thinking.remove();
      if (!data.ok) throw new Error(data.error || "Failed to polish");
      const now = new Date();
      const dateStr = now.toISOString().split("T")[0];
      const timeStr = now.toTimeString().slice(0, 5);
      // /polishText now returns {summary, body}. Build the header with the
      // summary so journal entries are glanceable in /browse reflections
      // and /audit listings. Fall back to date-only if summary came back
      // empty for any reason — defensive against future endpoint drift.
      const polishedBody = data.body || data.text || "";
      const headerSummary = (data.summary || "").trim();
      const header = headerSummary
        ? `## ${dateStr} ${timeStr} – ${headerSummary}`
        : `## ${dateStr} ${timeStr}`;
      const proposal = {
        action: "insertSection",
        filename: "reflections.md",
        section: `${header}\n\n${polishedBody}\n`,
        summary: headerSummary
          ? `Journal entry · ${headerSummary}`
          : `Journal entry · ${dateStr} ${timeStr}`,
      };
      writeQueue = [];
      writeQueueTotal = 0;
      pendingWrite = proposal;
      showPreview(proposal);
    } catch (err) {
      thinking.remove();
      appendMessage("system", `Couldn't polish entry: ${err.message}`);
    }
    return;
  }

  if (pendingAttachments.length && !userText) {
    showToast(t("toast.attach-add-instructions"));
    inputEl.focus();
    return;
  }

  // Catch-all: any input starting with /word that didn't match a command
  // handler above. Prevents typos like /brwose or /audi t from falling
  // through to /chat and burning a Claude round-trip on a half-typed
  // command. The user gets a usage hint and a pointer back to the
  // autocomplete menu. Skipped in conv mode (voice transcripts rarely
  // start with "/word" and the user can't see autocomplete there anyway).
  // CRITICAL: do NOT clear inputEl here. Users sometimes paste content
  // starting with "/" (Unix paths, code snippets, regexes); clearing
  // would destroy their text irreversibly. Leave the input intact and
  // select it so they can hit backspace once or type to replace.
  if (!brief && /^\//.test(userText.trim())) {
    const trimmed = userText.trim();
    const typed = trimmed.split(/\s/)[0];
    const isBare = typed === "/";
    hideCmdSuggestions();
    inputEl.focus();
    inputEl.select();
    appendMessage(
      "system",
      isBare
        ? "Looks like you started typing a command. Type more characters and use ↑/↓ to pick from the menu, or /help for the full list."
        : `Unknown command: ${typed}\n\nType / and use ↑/↓ arrows to pick from the menu, or /help for the full list. If you meant to send "${typed}" as text, remove the leading slash.`
    );
    return;
  }

  // Number shortcut for disambiguation
  if (pendingDisambig && /^\d+$/.test(userText.trim())) {
    const idx = parseInt(userText.trim()) - 1;
    if (idx >= 0 && idx < pendingDisambig.options.length) {
      const chosenName = pendingDisambig.options[idx];
      const originalQuery = pendingDisambig.query;
      pendingDisambig = null;
      userText = `${originalQuery} — specifically ${chosenName}`;
    }
  } else {
    pendingDisambig = null;
  }

  if (typeof text !== "string") {
    inputEl.value = "";
    inputEl.style.height = "auto";
  }

  if (!userText.trim().startsWith("/") || brief || silent) {
    appendMessage("user", userText);
  }

  // Build message content — plain string or multi-modal array
  let messageContent = userText;
  // _lastSentImage is NOT pre-cleared here. It's replaced below if a new image is in this turn,
  // or kept as-is if this is a disambiguation reply with no image. Cleared at line 3467 after use.
  if (pendingAttachments.length) {
    appendAttachmentThumbs(pendingAttachments);
    // If any attachment is non-text, build a blocks array
    const hasMedia = pendingAttachments.some(a => a.type !== "text");
    if (hasMedia) {
      const blocks = [{ type: "text", text: userText }];
      for (const att of pendingAttachments) {
        if (att.type === "text") {
          blocks[0].text += `\n\n[Attached file: ${att.name}]\n${att.text}`;
        } else if (att.type === "image") {
          blocks.push({ type: "image", source: { type: "base64", media_type: att.mimeType, data: att.base64 } });
        } else {
          blocks.push({ type: "document", source: { type: "base64", media_type: att.mimeType, data: att.base64 } });
        }
      }
      messageContent = blocks;
    } else {
      // All text files — inline them
      let extra = "";
      for (const att of pendingAttachments) extra += `\n\n[Attached file: ${att.name}]\n${att.text}`;
      messageContent = userText + extra;
    }
    for (const att of pendingAttachments) attachmentsInHistory.push({ name: att.name, type: att.type });
    updateContextAttachBar();
    // Capture last image before clearing — needed for addPhoto write proposals
    const imgAtt = pendingAttachments.find(a => a.type === "image");
    _lastSentImage = imgAtt ? { base64: imgAtt.base64, mimeType: imgAtt.mimeType } : _lastSentImage;
    clearAttachment();
  } else if (!pendingDisambig) {
    // No attachment this turn and no disambiguation in progress — expire any stale image stash
    // so it can't silently attach to a future addPhoto proposal the user didn't intend
    _lastSentImage = null;
  }

  // Prepend vault recall context if loaded
  if (pendingRecallContext) {
    const vaultPrefix = `[COLD STORAGE RECORD: ${pendingRecallContext.section} from ${pendingRecallContext.file}]\n${pendingRecallContext.content}\n\n---\n`;
    messageContent = typeof messageContent === "string"
      ? vaultPrefix + messageContent
      : [{ type: "text", text: vaultPrefix }, ...(Array.isArray(messageContent) ? messageContent : [{ type: "text", text: messageContent }])];
  }

  if (convChatAbort) return; // already a request in flight — ignore duplicate send

  messages.push({ role: "user", content: messageContent });

  const thinking = appendMessage("thinking", "Thinking...");
  sendBtn.classList.add("hidden");
  stopBtn.classList.remove("hidden");

  try {
    convChatAbort = new AbortController();
    let data;
    let _streamedReplyEl = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await api("/chat", "POST", { messages, brief, clientDate: new Date().toLocaleDateString("en-CA"), model: modelPref, archive: archiveMode >= 1 }, true, convChatAbort?.signal);
      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        const sr = await consumeChatStream(res, thinking);
        if (sr.aborted) {
          // User stopped or lock fired — pop the user message and exit cleanly
          if (messages.length > 0 && messages[messages.length - 1]?.role === "user") messages.pop();
          return;
        }
        if (sr.error) throw new Error(sr.error);
        // Gate all post-stream work on session still being valid (lock may have fired)
        if (!session) {
          if (messages.length > 0 && messages[messages.length - 1]?.role === "user") messages.pop();
          return;
        }
        _streamedReplyEl = sr.replyEl;
        data = { ok: true, message: sr.fullText, usage: sr.usage };
        break;
      }
      data = await res.json();
      if (data.ok || data.error !== "rate_limit") break;
      // Rate limited — wait and retry silently
      if (convMode) setConvState("thinking");
      await sleep(3000 * (attempt + 1));
      if (!convChatAbort) { // Stop was clicked during retry sleep
        if (messages.length > 0 && messages[messages.length - 1]?.role === "user") messages.pop();
        return;
      }
    }
    convChatAbort = null;
    if (!_streamedReplyEl) thinking.remove();
    if (!data.ok) {
      if (data.error === "rate_limit") throw new Error("Rate limit hit — wait a moment and try again.");
      if (data.error === "memory_overflow") throw new Error(data.detail || "Combined memory exceeds Claude's context window — turn 📦 Archive OFF or run /deep-review to move older items to cold storage.");
      if (data.error === "daily_cap_exceeded") throw new Error(data.detail || `Daily Claude spend reached your cap. Raise or disable the cap in Settings → Daily spend cap.`);
      if (data.error === "cap_check_failed") throw new Error(data.detail || "Couldn't verify your daily spend cap. Retry — if this persists, check your worker logs.");
      throw new Error(data.error || "Chat failed");
    }

    // Update cache status badge and live context indicator
    if (data.usage) {
      const cacheRead = data.usage.cache_read_input_tokens || 0;
      const cacheWrite = data.usage.cache_creation_input_tokens || 0;
      if (cacheRead > 0) {
        cacheBadge.textContent = "💾 cached";
        cacheBadge.className = "cache-badge hit";
        cacheBadge.title = t("tooltip.cache-hit");
        cacheBadge.classList.remove("hidden");
      } else if (cacheWrite > 0) {
        cacheBadge.textContent = "⚡ new session";
        cacheBadge.className = "cache-badge miss";
        cacheBadge.title = t("tooltip.cache-miss");
        cacheBadge.classList.remove("hidden");
      }
      // If both are 0, leave hidden — no useful data to show

      // Update context badge: total = non-cached input + cached reads/writes
      // (Anthropic returns cache tokens separately from input_tokens)
      const totalInput = (data.usage.input_tokens || 0)
        + (data.usage.cache_read_input_tokens || 0)
        + (data.usage.cache_creation_input_tokens || 0);
      if (totalInput > 0) {
        _contextTokens = totalInput;
        // Derive the history portion of this turn so the badge can keep using it
        // as a stable estimate when memory bytes change (archive toggle, edits).
        const memBytesNow = archiveMode === 1 ? _workingBytes + _archiveBytes : _workingBytes;
        const memTokensNow = Math.round(memBytesNow / 4);
        _historyTokens = Math.max(0, totalInput - memTokensNow);
        updateMemoryBadge(_workingBytes);
      }
    }

    const { text: replyText, writeProposals, disambiguation, compactRequest, sources } = parseResponse(data.message);
    let replyEl = _streamedReplyEl || null;
    if (replyText && !replyEl) {
      replyEl = appendMessage("assistant", replyText);
      if (!disambiguation && writeProposals.length === 0) appendSourcesFooter(replyEl, replyText, userText, sources);
    } else if (replyEl) {
      if (replyText) {
        // Re-render with link detection and <memory-write> stripped
        replyEl.textContent = "";
        renderWithLinks(replyEl, replyText);
        if (!disambiguation && writeProposals.length === 0) appendSourcesFooter(replyEl, replyText, userText, sources);
      } else {
        // Write-only response — nothing to display, remove the streaming element
        replyEl.remove();
        replyEl = null;
      }
    }
    if (replyText) messages.push({ role: "assistant", content: replyText });
    if (replyEl && replyText) appendPhotoChips(replyEl, replyText);

    if (_journalFinishPending) {
      _journalFinishPending = false;
      if (writeProposals.length === 0) {
        appendMessage("system", "Journal entry wasn't saved — Claude didn't generate a write proposal. Try /journal to start a new entry, or type more detail into the chat and ask it to save.");
      }
    }

    // Warn every 5 exchanges (10 messages) that context is getting long
    if (!convMode && messages.length > 0 && messages.length % 10 === 0) {
      appendContextWarning();
    }

    // Auto-suggest archive search if nothing found and archive not already on
    const notFound = /I don't see anything about|don't have anything on|not in your memory|nothing.*memory files/i.test(replyText);
    if (notFound && !convMode) {
      const hint = document.createElement("div");
      hint.className = "archive-hint";
      if (archiveMode === 0) {
        hint.innerHTML = `<button class="archive-hint-btn">📦 Search archive?</button><button class="archive-hint-btn recall-hint-btn">🔐 Search cold storage?</button>`;
        hint.querySelector(".archive-hint-btn").addEventListener("click", () => {
          hint.remove();
          archiveMode = 1;
          localStorage.setItem("whoszoo_archive", "1");
          updateArchiveBtn();
          const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
          if (lastUserMsg) sendMessage(typeof lastUserMsg.content === "string" ? lastUserMsg.content : lastUserMsg.content[0]?.text || "");
        });
        hint.querySelector(".recall-hint-btn").addEventListener("click", () => {
          hint.remove();
          const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
          const q = lastUserMsg ? (typeof lastUserMsg.content === "string" ? lastUserMsg.content : lastUserMsg.content[0]?.text || "") : "";
          inputEl.value = `/recall ${q}`;
          inputEl.dispatchEvent(new Event("input"));
          sendMessage(`/recall ${q}`);
        });
      } else {
        hint.innerHTML = `<button class="archive-hint-btn recall-hint-btn">🔐 Search cold storage?</button>`;
        hint.querySelector(".recall-hint-btn").addEventListener("click", () => {
          hint.remove();
          const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
          const q = lastUserMsg ? (typeof lastUserMsg.content === "string" ? lastUserMsg.content : lastUserMsg.content[0]?.text || "") : "";
          inputEl.value = `/recall ${q}`;
          inputEl.dispatchEvent(new Event("input"));
          sendMessage(`/recall ${q}`);
        });
      }
      messagesEl.appendChild(hint);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (disambiguation) {
      pendingDisambig = disambiguation;
      if (!convMode) showDisambigButtons(disambiguation);
    }

    if (compactRequest) {
      const crFile = compactRequest.file || null;
      const crSection = compactRequest.section || null;
      if (crSection) {
        appendMessage("system", `Analyzing "${crSection}" for verbosity...`);
        runCompactSection(crFile, crSection);
      }
    }

    if (writeProposals.length > 0) {
      const validWrites = writeProposals.filter(p => !p._parseError);
      // Attach captured image to addPhoto proposals, then clear the stash.
      // Only the first addPhoto in a turn gets the image — multiple addPhoto
      // proposals from one send cannot be reliably matched to distinct images.
      let addPhotoCount = 0;
      for (const p of validWrites) {
        if (p.action === "addPhoto" && _lastSentImage) {
          addPhotoCount++;
          if (addPhotoCount === 1) {
            p._imageData = _lastSentImage.base64;
            p._imageMimeType = _lastSentImage.mimeType;
          } else {
            p._multiPhotoWarning = true; // prompt user to retry one at a time
          }
        }
      }
      _lastSentImage = null;
      const parseErrorCount = writeProposals.length - validWrites.length;
      if (validWrites.length === 0) {
        appendMessage("system", "⚠ A memory update was proposed but the response was cut off before it could be parsed. Nothing was saved. Try asking again.");
      } else {
        if (parseErrorCount > 0) {
          appendMessage("system", `⚠ ${parseErrorCount} of ${writeProposals.length} proposed update(s) could not be parsed and were skipped.`);
        }
        writeQueueTotal = validWrites.length;
        writeQueue = validWrites.slice(1);
        pendingWrite = validWrites[0];
        showPreview(pendingWrite);
        setJournalMode(false);
        noSpeechCount = 0;
        if (convMode) {
          stopConvRecognition();
          setConvState("paused");
          convOverlay.classList.add("conv-overlay--minimized");
          const speakMsg = writeQueueTotal > 1
            ? `${writeQueueTotal} memory updates ready — reviewing 1 of ${writeQueueTotal}. Tap Save or tell me what to change.`
            : "Memory update ready — tap Save or tell me what to change.";
          await speakText(speakMsg);
        }
      }
    } else if (convMode && !compactRequest) {
      await speakText(replyText, brief);
    }
  } catch (err) {
    convChatAbort = null;
    thinking.remove();
    _journalFinishPending = false;
    // If we pushed the user message but got no assistant reply, pop it so the
    // next retry doesn't send a doubled user turn to Claude
    if (messages.length > 0 && messages[messages.length - 1]?.role === "user") {
      messages.pop();
    }
    if (err.name === "AbortError") return; // user hard-stopped; state already set by hardStopConv/exitConvMode
    if (!convMode) {
      const errMsg = appendMessage("assistant", "Sorry, something went wrong.");
      if (err.message) {
        let displayErr = err.message;
        try { const p = JSON.parse(err.message.replace(/^Claude API error:\s*/, "")); if (p?.error?.message) displayErr = p.error.message; } catch {}
        appendMessage("system", `Error: ${displayErr}`);
      }
      const retryLink = document.createElement("a");
      retryLink.href = "#";
      retryLink.textContent = "Try again →";
      retryLink.style.cssText = "display:block;margin-top:6px;color:#a78bfa;font-size:0.85em;";
      retryLink.addEventListener("click", e => { e.preventDefault(); retryLink.closest(".message").remove(); sendMessage(userText, brief); });
      errMsg.appendChild(retryLink);
    }
    if (convMode) setConvState("idle");
    showToast(err.message);
  } finally {
    sendBtn.classList.remove("hidden");
    stopBtn.classList.add("hidden");
  }
}

// SHA-256 hex digest via Web Crypto. Used as an optimistic-concurrency token
// for /insertSection so the worker can reject a stale write.
async function _sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Detects an optimistic-concurrency conflict response (HTTP 409 with
// { conflict: true, error }) from any of /replaceSection, /deleteSection,
// /compactSection, /patchMemoryFile, or /insertSection. Renders a banner
// inside the provided container with a Reload button that calls the
// supplied onReload callback (which is responsible for re-fetching fresh
// content and re-rendering whatever editor surface is open). Returns
// true if it handled a conflict, false otherwise — so the caller can
// short-circuit its normal success-or-error path with one if-check.
async function handleConflict(response, data, opts) {
  if (response.ok || !data || !data.conflict) return false;
  const container = opts && opts.container ? opts.container : document.body;
  // Reuse any existing banner inside the same container — don't stack.
  const existing = container.querySelector(":scope > .conflict-banner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.className = "conflict-banner";
  banner.setAttribute("role", "alert");
  banner.setAttribute("aria-live", "assertive");
  const text = document.createElement("span");
  text.className = "conflict-banner-text";
  text.textContent = `⚠ ${data.error || "This record was changed in another tab."}`;
  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.className = "conflict-banner-reload";
  reloadBtn.textContent = "Reload record";
  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "conflict-banner-dismiss";
  dismissBtn.textContent = "Dismiss";
  reloadBtn.addEventListener("click", async () => {
    reloadBtn.disabled = true;
    dismissBtn.disabled = true;
    try {
      if (opts && typeof opts.onReload === "function") await opts.onReload();
    } finally {
      banner.remove();
    }
  });
  dismissBtn.addEventListener("click", () => banner.remove());
  banner.append(text, reloadBtn, dismissBtn);
  container.prepend(banner);
  return true;
}

// Claude occasionally wraps a memory write in a tool-call envelope instead of
// emitting <memory-write>. The exact shape has been malformed a DIFFERENT way
// each time it's turned up in production:
//   1. <invoke name="memory_write">…</invoke>            (underscore)
//   2. <function_call><invoke name="memory-write">…</function_calls>
//                                                        (hyphen + plural close)
//   3. <function_call>\ninvoke name="memory_write">…     (opening "<" missing)
// Each was previously patched by widening a regex, and each time a new shape
// appeared that the widened regex still missed — with real cost, since a miss
// means the write silently doesn't happen and the raw JSON leaks into the chat.
//
// So this anchors on the one thing every variant has in common and that no
// ordinary prose contains: the name="memory_write" marker. From there it takes
// the balanced JSON object that follows and the envelope tags around it,
// without needing the surrounding markup to be well-formed at all.
//
// Returns { body, start, stop } — body is the JSON text, [start, stop) is the
// span to hide from the visible reply — or null if there's no marker.
function extractEnvelopeWrite(raw) {
  const marker = /name\s*=\s*["']?memory[-_]?write["']?/i.exec(raw);
  if (!marker) return null;

  const braceStart = raw.indexOf("{", marker.index + marker[0].length);
  if (braceStart === -1) return null;

  // String-aware brace matching: a brace inside a JSON string value (e.g. a
  // note containing "{") must not terminate the object early.
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = braceStart; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { end = i + 1; break; }
  }
  // Never balanced means the response really was cut off mid-write. Hand back
  // the partial anyway so the caller reports a parse error the user can act on,
  // rather than the proposal disappearing with no explanation.
  const bodyEnd = end === -1 ? raw.length : end;

  // Widen the hidden span back to the outermost envelope tag near the marker,
  // so an outer <function_call> doesn't survive as visible junk.
  let start = marker.index;
  for (const m of raw.slice(0, marker.index).matchAll(/<\/?(?:function_calls?|tool_calls?|invoke)\b/gi)) {
    if (marker.index - m.index <= 200) { start = m.index; break; }
  }
  // Variant 3 above: with the "<" missing there is no tag to match, leaving a
  // bare "invoke" token immediately before the marker.
  if (start === marker.index) {
    const bare = /(?:^|\n)[ \t]*(?:<\s*)?(?:invoke|function_calls?|tool_calls?)[ \t]*$/i.exec(raw.slice(0, marker.index));
    if (bare) start = bare.index + bare[0].search(/\S/);
  }

  // Swallow any trailing close tags so no orphan (e.g. </function_call>)
  // survives after the JSON is removed.
  let stop = bodyEnd;
  const tail = /^\s*(?:<\/?(?:function_calls?|tool_calls?|invoke)\s*\/?>\s*)+/i.exec(raw.slice(stop));
  if (tail) stop += tail[0].length;

  return { body: raw.slice(braceStart, bodyEnd), start, stop };
}

// ---- Parse Claude response ----
function parseResponse(raw) {
  let text = raw;
  let writeProposals = [];
  let disambiguation = null;

  // Defensive parser: collect ALL <memory-write> blocks in the response.
  // Claude occasionally drifts to underscores or to a tool-call envelope; the
  // envelope case is handled by extractEnvelopeWrite() above, which anchors on
  // the name="memory_write" marker rather than trying to match the (repeatedly
  // malformed) surrounding tags. Only one envelope write is recovered per
  // response — the canonical <memory-write> path stays the multi-block one.
  const rawBlockBodies = [];
  let envelopeSpan = null;
  for (const m of raw.matchAll(/<memory-write>([\s\S]*?)<\/memory-write>/g)) rawBlockBodies.push(m[1]);
  if (rawBlockBodies.length === 0)
    for (const m of raw.matchAll(/<memory_write>([\s\S]*?)<\/memory_write>/g)) rawBlockBodies.push(m[1]);
  if (rawBlockBodies.length === 0) {
    const envelope = extractEnvelopeWrite(raw);
    if (envelope) {
      rawBlockBodies.push(envelope.body);
      envelopeSpan = envelope;
    }
  }
  if (rawBlockBodies.length > 0) {
    // The envelope path cuts an exact character span (computed from the raw
    // text) rather than re-matching tags, so nothing depends on the markup
    // being well-formed. `text` still equals `raw` here whenever envelopeSpan
    // is set, because the two canonical replacements below only fire when
    // their own tags matched — and if they had, we'd never have looked for an
    // envelope in the first place.
    text = envelopeSpan
      ? (raw.slice(0, envelopeSpan.start) + raw.slice(envelopeSpan.stop)).trim()
      : text
          .replace(/<memory-write>[\s\S]*?<\/memory-write>/g, "")
          .replace(/<memory_write>[\s\S]*?<\/memory_write>/g, "")
          .trim();
    for (const rawBody of rawBlockBodies) {
      let body = rawBody.trim();
      const paramMatch = body.match(/<parameter[^>]*>([\s\S]*?)<\/parameter>/);
      if (paramMatch) body = paramMatch[1].trim();
      const codeFence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeFence) body = codeFence[1].trim();
      const jsonExtract = body.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonExtract) body = jsonExtract[1].trim();
      try { writeProposals.push(JSON.parse(body)); }
      catch { writeProposals.push({ _parseError: true }); }
    }
  }

  const disambigMatch = raw.match(/<disambiguation>([\s\S]*?)<\/disambiguation>/);
  if (disambigMatch) {
    text = text.replace(/<disambiguation>[\s\S]*?<\/disambiguation>/, "").trim();
    try { disambiguation = JSON.parse(disambigMatch[1].trim()); } catch {}
  }

  let compactRequest = null;
  const compactMatch = raw.match(/<compact-request>([\s\S]*?)<\/compact-request>/);
  if (compactMatch) {
    text = text.replace(/<compact-request>[\s\S]*?<\/compact-request>/, "").trim();
    try { compactRequest = JSON.parse(compactMatch[1].trim()); } catch {}
  }

  let sources = null;
  const sourcesMatch = raw.match(/<sources>([\s\S]*?)<\/sources>/);
  if (sourcesMatch) {
    text = text.replace(/<sources>[\s\S]*?<\/sources>/, "").trim();
    try {
      const parsed = JSON.parse(sourcesMatch[1].trim());
      if (Array.isArray(parsed)) sources = parsed;
    } catch {}
  }

  return { text, writeProposals, disambiguation, compactRequest, sources };
}

// ---- Disambiguation buttons ----
function showDisambigButtons(disambiguation) {
  const el = document.createElement("div");
  el.className = "message assistant disambig-buttons";
  disambiguation.options.forEach((name, i) => {
    const btn = document.createElement("button");
    btn.className = "disambig-btn";
    btn.textContent = `${i + 1}. ${name}`;
    btn.addEventListener("click", () => {
      el.remove();
      pendingDisambig = null;
      const query = `${disambiguation.query} — specifically ${name}`;
      sendMessage(query, false);
    });
    el.appendChild(btn);
  });
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---- Context Warning ----
function appendContextWarning() {
  const exchanges = messages.length / 2;
  const el = document.createElement("div");
  el.className = "context-warning";
  el.innerHTML = `<button class="context-reset-btn">Reset (/r)</button><span class="context-warning-text">${exchanges} exchanges in · consider resetting to reduce token usage and costs.</span>`;
  el.querySelector(".context-reset-btn").addEventListener("click", () => resetContext());
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function resetContext(silent = false) {
  messages = [];
  _contextTokens = 0;
  _historyTokens = 0;
  pendingRecallContext = null;
  updateVaultBar();
  updateMemoryBadge(_workingBytes);
  if (!silent) {
    const divider = document.createElement("div");
    divider.className = "context-divider";
    divider.innerHTML = `<span class="context-divider-label">✓ Context Reset</span><span class="context-divider-text">Claude only sees messages below this point.</span>`;
    messagesEl.appendChild(divider);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// ---- Sources footer ----
function appendSourcesFooter(msgEl, replyText, queryText = "", precomputedSources = null) {
  const bar = document.createElement("div");
  bar.className = "sources-bar";
  const btn = document.createElement("button");
  btn.className = "sources-link";
  btn.textContent = "🔗 View sources";

  function renderSources(sourceList) {
    btn.remove();
    if (!sourceList || sourceList.length === 0) {
      const zero = document.createElement("div");
      zero.className = "sources-zero";
      zero.textContent = "No specific records were used for this response.";
      bar.appendChild(zero);
      return;
    }
    const listEl = document.createElement("div");
    listEl.className = "sources-results";
    sourceList.forEach(r => {
      const card = document.createElement("button");
      card.className = "delete-result-btn";
      const fileLabel = r.file.replace("archive_", "").replace(".md", "").toUpperCase();
      card.innerHTML = `<span class="delete-result-file">${escapeHtml(fileLabel)}</span> › <span class="delete-result-section">${escapeHtml(r.section)}</span>${r.preview ? `<span class="delete-result-preview">${escapeHtml(r.preview)}</span>` : ""}`;
      card.addEventListener("click", () => runEditSection(r.file, r.section));
      listEl.appendChild(card);
    });
    bar.appendChild(listEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  btn.addEventListener("click", async () => {
    if (precomputedSources !== null) {
      renderSources(precomputedSources);
      return;
    }
    // Fallback: ask Haiku (only fires if Claude omitted the <sources> tag)
    btn.disabled = true;
    btn.textContent = "🔗 Finding sources…";
    try {
      const res = await api("/attributeSources", "POST", { replyText, queryText, includeArchive: archiveMode >= 1 });
      const data = await res.json();
      renderSources(data.ok ? (data.sources || []) : []);
    } catch {
      btn.disabled = false;
      btn.textContent = "🔗 View sources";
    }
  }, { once: true });

  bar.appendChild(btn);
  msgEl.appendChild(bar);
}

function appendPhotoChips(msgEl, text) {
  if (!_recordsWithPhotos.size) return;
  for (const { section: name, filenames } of _recordsWithPhotos.values()) {
    if (!filenames.length) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let re;
    try {
      re = new RegExp("(?<![\\p{L}\\p{N}])" + escaped + "(?![\\p{L}\\p{N}])", "u");
    } catch {
      // Fallback for Safari < 16.4 which doesn't support Unicode property lookbehind
      re = new RegExp("(?:^|[^\\w])" + escaped + "(?:[^\\w]|$)");
    }
    if (!re.test(text)) continue;
    // Label which record these photos belong to. Without it the strip renders
    // directly under the sources card and reads as belonging to whatever that
    // card names — so a photo of John Berry, matched because the reply happens
    // to mention him, looks like it belongs to an unrelated cited record. The
    // record name was previously only in img.alt, which a browser shows solely
    // when the image FAILS to load: invisible exactly when things work.
    const label = document.createElement("div");
    label.className = "photo-inline-label";
    label.textContent = name;
    msgEl.appendChild(label);
    const strip = document.createElement("div");
    strip.className = "photo-inline-strip";
    for (let i = 0; i < filenames.length; i++) {
      const wrap = document.createElement("div");
      wrap.className = "photo-thumb-wrap";
      const img = document.createElement("img");
      img.alt = name;
      const fn = filenames[i];
      const capturedIdx = i;
      fetchPhotoObjectUrl(fn).then(url => { if (url) img.src = url; });
      wrap.addEventListener("click", () => openLightbox(filenames, capturedIdx));
      wrap.appendChild(img);
      strip.appendChild(wrap);
    }
    msgEl.appendChild(strip);
  }
}

// ---- First-run welcome card ----
let _welcomeCardEl = null;

function dismissWelcomeCard() {
  if (!_welcomeCardEl) return;
  localStorage.setItem("whoszoo_welcomed", "1");
  _welcomeCardEl.remove();
  _welcomeCardEl = null;
}

function showWelcomeCard() {
  if (_welcomeCardEl) return;
  const card = document.createElement("div");
  card.className = "welcome-card";

  const dismiss = document.createElement("button");
  dismiss.className = "welcome-card-dismiss";
  dismiss.textContent = "✕";
  dismiss.title = t("tooltip.dismiss");
  dismiss.addEventListener("click", dismissWelcomeCard);
  card.appendChild(dismiss);

  const titleEl = document.createElement("div");
  titleEl.className = "welcome-card-title";
  titleEl.textContent = "Who's in your zoo?";
  card.appendChild(titleEl);

  const subEl = document.createElement("div");
  subEl.className = "welcome-card-sub";
  subEl.textContent = "Tell me about the people in your life — then ask me anything about them.";
  card.appendChild(subEl);

  [
    ['💬', 'I just met [Name] at [place], they work at [company]'],
    ['✏ ', 'Add a fragment: [something quick to remember]'],
    ['💬', 'What do I know about [Name]?'],
  ].forEach(([emoji, text]) => {
    const btn = document.createElement("button");
    btn.className = "welcome-starter";
    btn.textContent = `${emoji} ${text}`;
    btn.addEventListener("click", () => {
      inputEl.value = text;
      inputEl.focus();
      inputEl.dispatchEvent(new Event("input"));
    });
    card.appendChild(btn);
  });

  _welcomeCardEl = card;
  const inputBar = document.querySelector(".input-bar");
  const inputRow = inputBar.querySelector(".input-row");
  inputBar.insertBefore(card, inputRow);
}

// ---- Install prompt (Chromium only, by design) ----
//
// Chromium fires `beforeinstallprompt` when the page meets its installability
// bar (manifest + icons + HTTPS + a registered service worker with a fetch
// handler — see frontend/sw.js, which exists solely to satisfy that last one).
// Capturing the event lets us offer installing inside the app instead of
// leaving it buried in the browser's ⋮ menu.
//
// There is deliberately no iOS/Safari path: WebKit has no equivalent API, so
// a prompt simply cannot be triggered there. Anything claiming to be an
// install prompt on Safari is a hand-written "tap Share → Add to Home Screen"
// overlay. We decided not to build one, so on Safari nothing shows at all.
const INSTALL_DISMISSED_KEY = "whoszoo_install_dismissed";
let _installPromptEvent = null;
let _installBannerEl = null;

function appIsInstalled() {
  // display-mode covers Chromium on desktop and Android; navigator.standalone
  // is the iOS equivalent. We never prompt on iOS, but someone who added it to
  // their home screen there must still never be nagged.
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {}
  return window.navigator.standalone === true;
}

function dismissInstallBanner(remember) {
  if (remember) { try { localStorage.setItem(INSTALL_DISMISSED_KEY, "1"); } catch {} }
  if (_installBannerEl) { _installBannerEl.remove(); _installBannerEl = null; }
}

function showInstallBanner() {
  if (_installBannerEl) return;
  // No stashed event means Chromium either hasn't fired yet or considers the
  // app ineligible (or this isn't Chromium at all). Nothing to offer.
  if (!_installPromptEvent) return;
  if (appIsInstalled()) return;
  if (chatScreen.classList.contains("hidden")) return;
  try { if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return; } catch {}

  const bar = document.createElement("div");
  bar.className = "install-banner";

  const textEl = document.createElement("span");
  textEl.className = "install-banner-text";
  textEl.textContent = t("install.banner");
  bar.appendChild(textEl);

  const btn = document.createElement("button");
  btn.className = "install-banner-btn";
  btn.textContent = t("install.btn");
  btn.addEventListener("click", async () => {
    const evt = _installPromptEvent;
    if (!evt) { dismissInstallBanner(false); return; }
    // prompt() is single-use — the stashed event cannot be replayed, so drop
    // the reference before awaiting, whatever the user decides.
    _installPromptEvent = null;
    btn.disabled = true;
    try {
      evt.prompt();
      await evt.userChoice;
    } catch {}
    // On acceptance the `appinstalled` listener records it; on dismissal we
    // deliberately do NOT remember, since they engaged rather than refused.
    dismissInstallBanner(false);
  });
  bar.appendChild(btn);

  const close = document.createElement("button");
  close.className = "install-banner-dismiss";
  close.textContent = "✕";
  close.title = t("tooltip.dismiss");
  // Explicit ✕ is a real refusal, so remember it and stop asking.
  close.addEventListener("click", () => dismissInstallBanner(true));
  bar.appendChild(close);

  _installBannerEl = bar;
  const inputBar = document.querySelector(".input-bar");
  const inputRow = inputBar.querySelector(".input-row");
  inputBar.insertBefore(bar, inputRow);
}

// Settings > "Install to home screen" — the recovery path for the banner
// above. The banner shows once and remembers an explicit dismissal
// (INSTALL_DISMISSED_KEY); without a way back in, a mistap on the tiny
// original dismiss button (fixed in v1.8.42, but the flag itself is
// permanent by design) or genuine indifference followed by a change of
// mind left no route back except clearing site data, which also drops the
// saved worker URL and biometric enrollment. This row is that route.
//
// beforeinstallprompt fires on every qualifying page load, not just once
// ever, so _installPromptEvent is normally populated again well before the
// user could navigate to Settings — reloading is enough to make this
// button work again even right after a dismissal.
function refreshInstallRow() {
  const row = document.getElementById("panel-install");
  if (!row) return;
  row.classList.remove("settings-action-row-unavailable");
  if (isIOS()) {
    // Nothing to offer: WebKit has no install-prompt API at all, and
    // Help & docs already has the manual Share -> Add to Home Screen steps.
    row.style.display = "none";
    return;
  }
  if (appIsInstalled()) {
    row.style.display = "";
    row.classList.add("settings-action-row-unavailable");
    row.innerHTML = `${t("settings.btn-install")} <span class="settings-action-chevron">${t("settings.install-done-badge")}</span>`;
    return;
  }
  // Shown even when _installPromptEvent isn't populated yet (Chromium simply
  // hasn't fired it this page load) so the row isn't hidden right when it's
  // most likely to be needed, straight after a dismissal.
  row.style.display = "";
  row.innerHTML = `${t("settings.btn-install")} <span class="settings-action-chevron">→</span>`;
}

document.getElementById("panel-install").addEventListener("click", async () => {
  try { localStorage.removeItem(INSTALL_DISMISSED_KEY); } catch {}
  const evt = _installPromptEvent;
  if (!evt) {
    // Most likely cause: this page load hasn't received beforeinstallprompt
    // yet, or already consumed it earlier in this same session. The
    // dismissed flag is cleared either way, so a reload retries cleanly.
    showToast(t("settings.install-retry"));
    return;
  }
  _installPromptEvent = null;
  try {
    evt.prompt();
    await evt.userChoice;
  } catch {}
  dismissInstallBanner(false);
  refreshInstallRow();
});

// ---- Share the product (NOT this install) ----
//
// The URL is a hard-coded constant and this handler never reads WORKER_URL.
// That is deliberate and load-bearing: every user runs their own copy at their
// own address, so the one thing they can otherwise pass along is their address
// bar -- the login page to their own memory. Keeping the two apart structurally
// is why the wrong thing can't happen, rather than relying on the label alone.
//
// navigator.share() gets the native sheet on mobile (one tap into Messages or
// WhatsApp, which is the whole point of this feature); everything else falls
// back to the clipboard. The toast names whoszoo.app so the user can see WHAT
// was shared, which is the other half of keeping "share the product" and
// "share my app" from blurring together.
const SHARE_URL = "https://whoszoo.app";

// "Does navigator.share exist" is the WRONG question, and answering it that way
// shipped a bad desktop experience in v1.8.46. Chrome on Windows implements the
// API, so desktop users were sent into the OS share sheet -- which, for a
// text-only share (no `url` field), drops "Copy link" entirely and offers Teams,
// Outlook and Copilot instead. Worse, the clipboard path below was unreachable
// there, so its toast could never fire on a desktop at all.
//
// On a desktop the clipboard IS the useful target: one click and the message is
// ready to paste. A native sheet only earns its place where it means one tap
// into Messages or WhatsApp. (pointer: coarse) asks that actual question --
// is this a touch-primary device -- instead of sniffing the user agent.
//
// Fails to false, i.e. to the clipboard, which is the safe answer either way.
function isTouchPrimary() {
  try { return window.matchMedia("(pointer: coarse)").matches; }
  catch { return false; }
}

document.getElementById("panel-share").addEventListener("click", async () => {
  // One text blob, deliberately NOT share()'s separate `url` field. The
  // platform composes text and url however it likes and that varies by OS and
  // by target app, so the message would arrive shaped differently depending on
  // where it was sent. Composing it here means it reads the same everywhere:
  // one sentence, a blank line, a bare link. The cost is the rich link-preview
  // card some targets build from a `url`, which is a fair trade -- nearly every
  // target auto-linkifies a bare URL on its own line anyway.
  //
  // The URL still lives only in SHARE_URL and never in a locale string, so
  // there remains exactly one place it can point, across all four languages.
  const message = `${t("settings.share-message")}\n\n${SHARE_URL}`;
  if (navigator.share && isTouchPrimary()) {
    try {
      await navigator.share({ title: "WhosWhoZoo", text: message });
      return;
    } catch (err) {
      // AbortError = the user dismissed the sheet on purpose; copying behind
      // their back would be the wrong response. Any other failure (no
      // permission, unsupported target) falls through to the clipboard.
      if (err && err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(message);
    showToast(t("settings.share-copied"));
  } catch {
    showToast(t("settings.share-failed"));
  }
});

window.addEventListener("beforeinstallprompt", (e) => {
  // Suppress Chromium's own mini-infobar so ours is the only offer shown.
  e.preventDefault();
  _installPromptEvent = e;
  // May fire before or after login; showInstallBanner() bails when the chat
  // screen isn't up, and startSession() calls it again once it is.
  showInstallBanner();
});

window.addEventListener("appinstalled", () => {
  _installPromptEvent = null;
  dismissInstallBanner(true);
  refreshInstallRow();
});

// Registering is what makes the install prompt possible at all. It caches
// nothing (see frontend/sw.js). Failure is non-fatal by design — an
// unsupported browser or a CSP that forbids worker-src should cost the user
// the install banner and nothing else.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

async function shouldShowWelcomeCard() {
  if (localStorage.getItem("whoszoo_welcomed")) return false;
  // Treat the old intro flag as "welcomed" so existing users don't see the card
  if (localStorage.getItem("whoszoo_intro_seen")) {
    localStorage.setItem("whoszoo_welcomed", "1");
    return false;
  }
  try {
    const res = await api("/getMemoryFile?filename=people.md", "GET");
    if (!res.ok) return true;
    const text = await res.text();
    const sectionCount = (text.match(/^## /gm) || []).length;
    return sectionCount < 2;
  } catch {
    return false;
  }
}

// ---- Messages UI ----

function appendMessage(role, text) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  renderWithLinks(el, text);
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function renderWithLinks(el, rawText) {
  // Step 1: extract [label](url) markdown links → replace with null-byte placeholders
  const mdLinks = [];
  let text = rawText.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => {
    const idx = mdLinks.length;
    mdLinks.push({ label, url: url.replace(/[.,;:!?)>\]]+$/, "") });
    return `\x00L${idx}\x00`;
  });

  // Step 2: strip bold/italic markdown (safe now — URLs already extracted)
  text = text
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/\*([\s\S]+?)\*/g, "$1")
    .replace(/__([\s\S]+?)__/g, "$1");

  // Step 3: scan for placeholders and bare URLs, build segments
  const segments = [];
  let lastIdx = 0;
  const re = /\x00L(\d+)\x00|(https?:\/\/[^\s<>"'\x00]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) segments.push({ type: "text", content: text.slice(lastIdx, m.index) });
    if (m[1] !== undefined) {
      segments.push({ type: "link", ...mdLinks[parseInt(m[1])] });
    } else {
      const url = m[2].replace(/[*.,;:!?)>\]]+$/, "");
      segments.push({ type: "link", label: url, url });
    }
    lastIdx = m.index + m[0].length;
    re.lastIndex = lastIdx;
  }
  if (lastIdx < text.length) segments.push({ type: "text", content: text.slice(lastIdx) });

  // Step 4: build DOM
  for (const seg of segments) {
    if (seg.type === "text") {
      el.appendChild(document.createTextNode(seg.content));
    } else {
      const a = document.createElement("a");
      a.href = seg.url;
      a.textContent = seg.label;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      el.appendChild(a);
    }
  }
}

// ---- Preview Panel ----
function showPreview(proposal) {
  // Capture the file hash NOW (at show time) so the conflict guard covers the
  // window between Claude reading memory and the user tapping Save — not just
  // the milliseconds before the POST fires.
  // addPhoto proposals target an image filename, not a memory file — skip the fetch.
  if (proposal.action !== "addPhoto") {
    proposal._hashPromise = (async () => {
      try {
        const r = await api(`/getMemoryFile?filename=${encodeURIComponent(proposal.filename || "")}`, "GET");
        if (r.ok) return await _sha256Hex(await r.text());
      } catch {}
      return null;
    })();
  }

  const titleEl = document.querySelector(".preview-title");
  const file = proposal.filename || "";
  const section = proposal.section || "";
  const currentIdx = writeQueueTotal - writeQueue.length;
  const countStr = writeQueueTotal > 1 ? `  ·  ${currentIdx} of ${writeQueueTotal}` : "";
  if (proposal.action === "insertSection") {
    const isReopen = proposal.ifExists === "reopen";
    titleEl.textContent = isReopen ? `REOPEN LOOP → ${file}${countStr}` : `NEW RECORD → ${file}${countStr}`;
    titleEl.className = "preview-title preview-title-new";
  } else {
    titleEl.textContent = `UPDATE → ${file} › ${section}${countStr}`;
    titleEl.className = "preview-title preview-title-update";
  }

  previewSummary.textContent = proposal.summary || "Proposed memory change";
  previewContent.textContent = "";
  previewContent.className = "preview-content preview-content-edit";

  if (proposal.action === "insertSection") {
    const ta = makeEditTextarea(proposal.section || "", "section", null);
    previewContent.appendChild(ta);
    ta.focus();
  } else if (proposal.action === "patchMemoryFile" && Array.isArray(proposal.ops)) {
    proposal.ops.forEach((op, i) => {
      const kind = op.op || "";
      const lbl = document.createElement("div");
      lbl.className = "preview-edit-label";
      let content = "";
      if (kind === "append-bullet") {
        lbl.textContent = `→ ${op.subsection || "Timeline"}`;
        content = `– **${op.date || ""}**: ${op.text || ""}`;
      } else if (kind === "append-lines") {
        lbl.textContent = `→ ${op.subsection || ""}`;
        content = (op.lines || []).join("\n");
      } else if (kind === "replace-subsection") {
        lbl.textContent = `→ ${op.subsection || ""} (replace)`;
        content = op.text || "";
      } else if (kind === "replace-bullet") {
        lbl.textContent = `→ replace bullet`;
        content = op.new || "";
      } else if (kind === "set-field") {
        lbl.textContent = `→ ${op.field}`;
        content = op.value || "";
      } else if (kind === "delete-bullet") {
        lbl.textContent = `✕ delete bullet`;
        content = op.text || "";
      } else if (kind === "append-item") {
        lbl.textContent = `+ add item`;
        content = op.text || "";
      } else {
        lbl.textContent = kind;
        content = JSON.stringify(op);
      }
      previewContent.appendChild(lbl);
      previewContent.appendChild(makeEditTextarea(content, kind, i));
    });
    const first = previewContent.querySelector("textarea");
    if (first) first.focus();
  } else if (proposal.action === "addPhoto") {
    titleEl.textContent = `ADD PHOTO → ${proposal.sectionName || proposal.personName || ""}${countStr}`;
    titleEl.className = "preview-title preview-title-new";
    if (proposal._imageData) {
      const img = document.createElement("img");
      img.src = `data:${proposal._imageMimeType || "image/jpeg"};base64,${proposal._imageData}`;
      img.style.cssText = "max-width:100%; max-height:220px; border-radius:8px; display:block; margin:0 auto;";
      previewContent.appendChild(img);
    } else {
      const note = document.createElement("p");
      note.style.cssText = "color:var(--text-dim); text-align:center; padding:16px;";
      note.textContent = "Photo preview not available.";
      previewContent.appendChild(note);
    }
  }

  previewOverlay.classList.remove("hidden");
}

function renderProposalText(proposal) {
  if (proposal.action === "insertSection") {
    return (proposal.section || "").trim();
  }
  if (proposal.action === "patchMemoryFile" && Array.isArray(proposal.ops)) {
    const lines = [];
    for (const op of proposal.ops) {
      const kind = op.op || "";
      const clean = s => String(s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*\*/g, "");
      if (kind === "append-bullet") {
        lines.push(`+ ${op.subsection || "Timeline"}: ${op.date || ""}: ${clean(op.text)}`);
      } else if (kind === "append-lines") {
        lines.push(`+ ${op.subsection || ""}:`);
        lines.push(...(op.lines || []).map(clean));
      } else if (kind === "replace-subsection") {
        lines.push(`↻ [${op.subsection || op.oldText || ""}]`);
        lines.push(clean(op.text || op.newText));
      } else if (kind === "replace-bullet") {
        lines.push(`was: ${clean(op.old || op.oldText)}`);
        lines.push(`now: ${clean(op.new || op.newText)}`);
      } else if (kind === "set-field") {
        lines.push(`${op.field}: ${op.value}`);
      } else if (kind === "delete-bullet") {
        lines.push(`✕ ${clean(op.text)}`);
      } else if (kind === "append-item") {
        lines.push(`+ ${clean(op.text)}`);
      } else {
        lines.push(JSON.stringify(op));
      }
    }
    return lines.join("\n");
  }
  return JSON.stringify(proposal, null, 2);
}

function makeEditTextarea(value, field, opIndex) {
  const ta = document.createElement("textarea");
  ta.className = "preview-edit-textarea";
  ta.value = value;
  if (opIndex !== null) ta.dataset.opIndex = opIndex;
  ta.dataset.field = field;
  ta.rows = Math.max(2, (value.match(/\n/g) || []).length + 2);
  return ta;
}

function collectEdits(proposal) {
  if (proposal.action === "insertSection") {
    const ta = previewContent.querySelector('[data-field="section"]');
    if (ta) proposal.section = ta.value.trim();
    return proposal;
  }
  if (proposal.action === "patchMemoryFile") {
    previewContent.querySelectorAll("[data-op-index]").forEach(ta => {
      const i = parseInt(ta.dataset.opIndex);
      const kind = ta.dataset.field;
      const op = proposal.ops[i];
      if (!op) return;
      const val = ta.value;
      if (kind === "append-bullet") {
        const m = val.match(/^–\s*\*\*(.+?)\*\*:\s*([\s\S]*)$/);
        if (m) { op.date = m[1].trim(); op.text = m[2].trim(); }
        else op.text = val.trim();
      } else if (kind === "append-lines") {
        op.lines = val.split("\n").filter(Boolean);
      } else if (kind === "replace-subsection") {
        op.text = val;
      } else if (kind === "replace-bullet") {
        op.new = val.trim();
      } else if (kind === "set-field") {
        op.value = val.trim();
      } else if (kind === "delete-bullet") {
        op.text = val.trim();
      } else if (kind === "append-item") {
        op.text = val.trim();
      }
    });
  }
  return proposal;
}

previewConfirm.addEventListener("click", async () => {
  if (!pendingWrite) return;

  // Shared queue-advance logic — used by addPhoto branch (early exits) and the
  // normal completion path at the bottom so both always advance the write queue.
  const advanceQueue = async () => {
    if (writeQueue.length > 0) {
      pendingWrite = writeQueue.shift();
      showPreview(pendingWrite);
      if (convMode) await speakText(`Saved. Next update — ${writeQueueTotal - writeQueue.length} of ${writeQueueTotal}. Tap Save or tell me what to change.`);
      return;
    }
    writeQueueTotal = 0;
    if (convMode) convListen();
  };

  pendingWrite = collectEdits(pendingWrite);
  const savedSummary = renderProposalText(pendingWrite);
  const savedFile = pendingWrite.filename;
  // For insertSection, .section is the full markdown body; extract just the heading.
  // For patchMemoryFile, .section is already the heading string.
  const rawHeading = pendingWrite.action === "insertSection"
    ? pendingWrite.section.split('\n')[0].replace(/^#+\s*/, '').trim()
    : pendingWrite.section;
  const savedSection = rawHeading || null; // null = skip sources footer if heading extraction failed
  previewOverlay.classList.add("hidden");
  convOverlay.classList.remove("conv-overlay--minimized");
  clearJournalDraft();
  try {
    let res;
    // Use the hash captured when the proposal was shown — covers the full
    // window between Claude reading memory and the user tapping Save.
    let capturedHash = await (pendingWrite._hashPromise || Promise.resolve(null));
    if (!capturedHash && pendingWrite.action !== "addPhoto") {
      try {
        const r = await api(`/getMemoryFile?filename=${encodeURIComponent(pendingWrite.filename || "")}`, "GET");
        if (r.ok) capturedHash = await _sha256Hex(await r.text());
      } catch {}
    }
    if (pendingWrite.action === "addPhoto") {
      previewOverlay.classList.add("hidden");
      if (pendingWrite._multiPhotoWarning) {
        appendMessage("system", t("chat.photo-one-at-a-time"));
        pendingWrite = null;
        await advanceQueue();
        return;
      }
      if (!pendingWrite._imageData) {
        appendMessage("system", t("chat.photo-data-unavailable"));
        pendingWrite = null;
        await advanceQueue();
        return;
      }
      try {
        const upRes = await api("/uploadPhoto", "POST", {
          filename: pendingWrite.filename,
          imageBase64: pendingWrite._imageData,
          mimeType: pendingWrite._imageMimeType || "image/jpeg",
        });
        const upData = await upRes.json();
        if (!upData.ok) {
          if (upData.error === "r2_not_configured") {
            appendMessage("system", t("chat.photo-r2-required"));
          } else {
            appendMessage("system", t("chat.photo-upload-failed", { error: upData.error }));
          }
          pendingWrite = null;
          await advanceQueue();
          return;
        }
        const confirmedFilename = upData.filename;
        const targetFile = pendingWrite.file || "people.md";
        const targetSection = pendingWrite.sectionName || pendingWrite.personName;
        let fileHash = null;
        try {
          const hr = await api(`/getMemoryFile?filename=${encodeURIComponent(targetFile)}`, "GET");
          if (hr.ok) fileHash = await _sha256Hex(await hr.text());
        } catch {}
        const mdRes = await api("/patchMemoryFile", "POST", {
          filename: targetFile,
          section: targetSection,
          ops: [{ op: "append-lines", subsection: "Photos", lines: [`– Photo: ${confirmedFilename}`] }],
          ...(fileHash ? { previousHash: fileHash } : {}),
        });
        const mdData = await mdRes.json();
        if (!mdData.ok) {
          appendMessage("system", t("chat.photo-saved-partial", { name: targetSection, error: mdData.error, filename: confirmedFilename }));
        } else {
          const confirmEl = appendMessage("system", t("chat.photo-added", { name: targetSection }) + " ");
          const confirmLink = document.createElement("a");
          confirmLink.textContent = "View record →";
          confirmLink.href = "#";
          confirmLink.style.cssText = "color:var(--accent);text-decoration:underline;cursor:pointer;";
          confirmLink.addEventListener("click", async e => {
            e.preventDefault();
            try {
              const r = await api(`/getMemoryFile?filename=${encodeURIComponent(targetFile)}&section=${encodeURIComponent(targetSection)}`, "GET");
              if (r.ok) showEditModal(targetSection, targetFile, await r.text());
              else showToast("Could not open record.");
            } catch { showToast("Could not open record."); }
          });
          confirmEl.appendChild(confirmLink);
          addRecordPhoto(targetFile, targetSection, confirmedFilename);
          // Strip image block from message history — saves tokens on every subsequent turn
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "user" && Array.isArray(msg.content)) {
              if (msg.content.some(b => b.type === "image")) {
                msg.content = msg.content.filter(b => b.type !== "image");
                if (msg.content.length === 1 && msg.content[0].type === "text") {
                  messages[i] = { role: "user", content: msg.content[0].text };
                }
                break;
              }
            }
          }
          attachmentsInHistory = attachmentsInHistory.filter(a => a.type !== "image");
          updateContextAttachBar();
        }
      } catch (err) {
        appendMessage("system", t("chat.photo-save-failed", { error: err.message }));
      }
      pendingWrite = null;
      await advanceQueue();
      return;
    }
    if (pendingWrite.action !== "insertSection" && pendingWrite.action !== "patchMemoryFile") {
      appendMessage("system", `⚠ Unrecognized write action "${pendingWrite.action || "(none)"}" — nothing was saved. Ask again.`);
      pendingWrite = null;
      return;
    }
    if (pendingWrite.action === "insertSection") {
      res = await api("/insertSection", "POST", {
        filename: pendingWrite.filename,
        section: pendingWrite.section,
        ifExists: pendingWrite.ifExists || "error",
        ...(capturedHash ? { previousHash: capturedHash } : {}),
      });
    } else if (pendingWrite.action === "patchMemoryFile") {
      res = await api("/patchMemoryFile", "POST", {
        filename: pendingWrite.filename,
        section: pendingWrite.section,
        ops: pendingWrite.ops,
        ...(capturedHash ? { previousHash: capturedHash } : {}),
      });
    }
    const data = await res.json();
    if (!data.ok) {
      if (data.error === "exists_closed") {
        const e = new Error("exists_closed");
        e.existsClosedSection = data.existingSection || "";
        e.existsClosedFile = pendingWrite.filename;
        throw e;
      }
      throw new Error(data.error || "Write failed");
    }

    const opWarnStr = data.opWarnings?.length
      ? ` · ⚠ Op warnings: ${data.opWarnings.join("; ")}`
      : "";

    // Read-back verification — confirm the data is actually in KV
    let confirmMsg = "Saved.";
    try {
      const verRes = await api(`/getMemoryFile?filename=${encodeURIComponent(pendingWrite.filename)}`, "GET", null);
      if (verRes.ok) {
        const verText = await verRes.text();
        const heading = savedSection ? `## ${savedSection}` : null;
        const verified = !heading || verText.includes(heading);
        confirmMsg = data.reopened
          ? `Reopened and updated — ${pendingWrite.filename} ✓${opWarnStr}\n\n${savedSummary}`
          : verified
            ? `Saved confirmed — ${pendingWrite.filename} ✓${opWarnStr}\n\n${savedSummary}`
            : `Saved — ${pendingWrite.filename} (write landed but section not yet visible in read-back)`;
      } else {
        confirmMsg = `Saved — ${pendingWrite.filename} (could not verify write, check your connection)`;
      }
    } catch {
      confirmMsg = "Saved · could not verify KV read-back";
    }

    const confirmEl = appendMessage("assistant", confirmMsg);
    if (savedSection) appendSourcesFooter(confirmEl, "", "", [{ file: savedFile, section: savedSection }]);
    dismissWelcomeCard();
    // Do not push save confirmations to messages — Claude reloads KV fresh on every
    // /chat request, so the history assertion is redundant and can become stale or
    // misleading if verification fails or if a subsequent write changes the same field.
    if (convMode) await speakText("Saved and verified.");
  } catch (err) {
    if (err.message === "exists_closed" && err.existsClosedSection) {
      const sectionTitle = err.existsClosedSection.replace(/^#+\s*(?:👤\s*)?/, "").trim();
      const file = err.existsClosedFile;
      const msgEl = appendMessage("assistant",
        `A closed loop named "${sectionTitle}" already exists. You can open it to reopen or review it, or ask me to create a new list with a different name.`);
      const btn = document.createElement("button");
      btn.className = "source-btn";
      btn.style.marginTop = "8px";
      btn.textContent = "Open existing loop →";
      btn.addEventListener("click", async () => {
        try {
          const r = await api(`/getMemoryFile?filename=${encodeURIComponent(file)}&section=${encodeURIComponent(sectionTitle)}`, "GET");
          if (!r.ok) { showToast(t("brief.toast-load-failed")); return; }
          const content = await r.text();
          showEditModal(sectionTitle, file, content, null);
        } catch { showToast(t("brief.toast-open-failed")); }
      });
      msgEl.appendChild(btn);
    } else {
      const isNotFound = err.message && err.message.toLowerCase().includes("section not found");
      const notFoundName = isNotFound ? err.message.replace(/section not found:?\s*/i, "").trim() : null;
      const msg = isNotFound
        ? `Couldn't save: ${err.message}\n\nAsk me to create a new record for ${notFoundName || "this person"} first, then I can add to it.`
        : `Couldn't save: ${err.message}`;
      appendMessage("assistant", msg);
      showToast(err.message);
    }
  }
  pendingWrite = null;
  await advanceQueue();
});

previewReject.addEventListener("click", () => {
  const wasInsert = pendingWrite && pendingWrite.action === "insertSection";
  const hadMore = writeQueue.length > 0;
  previewOverlay.classList.add("hidden");
  convOverlay.classList.remove("conv-overlay--minimized");
  pendingWrite = null;
  writeQueue = [];
  writeQueueTotal = 0;
  appendMessage("system", hadMore ? "Cancelled — nothing saved. Remaining proposed updates also discarded." : "Cancelled — nothing saved.");
  if (wasInsert) messages.push({ role: "user", content: "The record was not saved. If I ask you to re-propose it, start fresh with insertSection — do not patch." });
  messagesEl.scrollTop = messagesEl.scrollHeight;
  if (convMode) convListen();
});

previewOverlay.addEventListener("click", e => {
  if (false && e.target === previewOverlay) { // disabled: outside-tap cancel was too easy to trigger accidentally
    const hadMore = writeQueue.length > 0;
    previewOverlay.classList.add("hidden");
    convOverlay.classList.remove("conv-overlay--minimized");
    pendingWrite = null;
    writeQueue = [];
    writeQueueTotal = 0;
    appendMessage("system", hadMore ? "Cancelled — nothing saved. Remaining proposed updates also discarded." : "Cancelled — nothing saved.");
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (convMode) convListen();
  }
});

// ---- Chat Mode Voice (mic button) ----

// ---- Model toggle ----
function updateModelBtn() {
  modelBtn.textContent = modelPref === "sonnet" ? "Sonnet" : "Haiku";
  modelBtn.className = `model-btn ${modelPref === "sonnet" ? "sonnet" : "haiku"}`;
  modelBtn.title = modelPref === "sonnet"
    ? t("tooltip.model-sonnet")
    : t("tooltip.model-haiku");
}
modelBtn.addEventListener("click", () => {
  modelPref = modelPref === "haiku" ? "sonnet" : "haiku";
  localStorage.setItem("whoszoo_model", modelPref);
  updateModelBtn();
  showToast(t(modelPref === "sonnet" ? "toast.model-sonnet" : "toast.model-haiku"));
});
updateModelBtn();

// ---- Voice toggle ----
function updateVoiceBtn() {
  const labels = { brittney: "Brittney", marin: "Marin", callum: "Callum", onyx: "Onyx" };
  voiceBtn.textContent = "🎙 " + (labels[voicePref] || "Brittney");
}
voiceBtn.addEventListener("click", () => {
  const idx = VOICES.indexOf(voicePref);
  voicePref = VOICES[(idx + 1) % VOICES.length];
  localStorage.setItem("whoszoo_voice", voicePref);
  updateVoiceBtn();
  showToast(t("toast.voice-switched", { name: voicePref.charAt(0).toUpperCase() + voicePref.slice(1) }));
});
updateVoiceBtn();

// ---- Archive toggle (three-state: 0=off, 1=archive, 2=archive+deep) ----
function updateArchiveBtn() {
  const label = archiveMode === 1 ? t("archive.label.on") : t("archive.label.off");
  const cls   = archiveMode === 1 ? "archive-btn active" : "archive-btn";
  const tip   = archiveMode === 1 ? t("archive.tip.on") : t("archive.tip.off");
  archiveBtn.textContent = label;
  archiveBtn.className   = cls;
  archiveBtn.title       = tip;
  if (convArchiveBtn) {
    convArchiveBtn.textContent = label;
    convArchiveBtn.className   = cls;
    convArchiveBtn.title       = tip;
  }
}
function _toggleArchive() {
  archiveMode = archiveMode === 1 ? 0 : 1;
  localStorage.setItem("whoszoo_archive", String(archiveMode));
  updateArchiveBtn();
  updateMemoryBadge(_workingBytes);
  showToast(t(archiveMode === 1 ? "toast.archive-on" : "toast.archive-off"));
}
archiveBtn.addEventListener("click", _toggleArchive);
if (convArchiveBtn) convArchiveBtn.addEventListener("click", _toggleArchive);
updateArchiveBtn();

// ---- Audit ----
async function runAuditQuick(scope) {
  appendMessage("system", `Running Quick audit on ${scope}...`);
  try {
    const res = await api("/audit", "POST", { scope });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Audit failed");
    renderAuditFindings(data, "quick");
  } catch (err) {
    appendMessage("assistant", `Audit failed: ${err.message}`);
  }
}

async function runAuditDeepWithConfirmation(scope) {
  let estimate;
  try {
    const res = await api("/auditEstimateCost", "POST", { scope });
    estimate = await res.json();
    if (!estimate.ok) throw new Error(estimate.error || "Cost estimate failed");
  } catch (err) {
    appendMessage("assistant", `Could not estimate cost: ${err.message}`);
    return;
  }

  const fmt = n => "$" + n.toFixed(n >= 0.01 ? 2 : 4);
  const lines = [
    `⚡ Run Deep scan?`,
    ``,
    `Scope: ${scope} · ${estimate.recordCount} records across ${estimate.fileCount} files`,
    `Estimated cost: ${fmt(estimate.estimate)} (cap: ${fmt(estimate.ceiling)})`,
    ``,
    `Adds Near-duplicates (Haiku-judged) and Name Mismatches (free, deterministic) on top of the Quick scan findings.`,
  ];
  if (estimate.warnLargeAudit) {
    lines.push("");
    lines.push(`⚠ This is a large audit. Consider running /audit deep archived first to clean active+archive before scanning cold storage with /audit deep all.`);
  }
  const msgEl = appendMessage("system", lines.join("\n"));

  const btnRow = document.createElement("div");
  btnRow.className = "delete-results-list";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-ghost";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    btnRow.remove();
    appendMessage("system", "Deep scan cancelled — no API call made.");
  });
  const runBtn = document.createElement("button");
  runBtn.className = "btn-archive-confirm";
  runBtn.textContent = "Run Deep scan";
  runBtn.addEventListener("click", async () => {
    btnRow.remove();
    appendMessage("system", `Running Deep scan on ${scope}...`);
    try {
      const res = await api("/auditDeep", "POST", { scope });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Deep scan failed");
      renderAuditFindings(data, "deep");
    } catch (err) {
      appendMessage("assistant", `Deep scan failed: ${err.message}`);
    }
  });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(runBtn);
  msgEl.appendChild(btnRow);
}

async function runAuditIgnored() {
  let data;
  try {
    const res = await api("/auditIgnored", "GET");
    data = await res.json();
    if (!data.ok) throw new Error(data.error || "Could not load ignored list");
  } catch (err) {
    appendMessage("assistant", `Failed to load ignored list: ${err.message}`);
    return;
  }
  const total = data.ignored.length;
  const msgEl = appendMessage("system", `Audit ignored (${total} entr${total !== 1 ? "ies" : "y"})${data.prunedCount ? ` · auto-pruned ${data.prunedCount} ghost entries` : ""}`);

  if (total === 0) {
    appendMessage("system", "Nothing dismissed yet. Use /audit, then tap Ignore on any finding to add it here.");
    return;
  }

  const container = document.createElement("div");
  container.className = "audit-ignored-list";
  msgEl.appendChild(container);

  // Group by category, then render each entry with Un-ignore button
  const byCat = {};
  for (const e of data.ignored) (byCat[e.category] = byCat[e.category] || []).push(e);
  for (const cat of (data.categories || [])) {
    const items = byCat[cat.id] || [];
    if (items.length === 0) continue;
    const head = document.createElement("div");
    head.className = "audit-ignored-cat";
    head.textContent = `${cat.icon} ${cat.label} (${items.length})`;
    container.appendChild(head);
    for (const entry of items) {
      const row = document.createElement("div");
      row.className = "audit-ignored-row";
      const label = document.createElement("span");
      label.className = "audit-ignored-label";
      label.textContent = _humanizeIgnoredSignature(entry);
      row.appendChild(label);
      const aged = document.createElement("span");
      aged.className = "audit-ignored-age";
      aged.textContent = t("chat.audit-ignored-time", { time: _relativeTimeFrom(entry.addedAt) });
      row.appendChild(aged);
      const btn = document.createElement("button");
      btn.className = "btn-archive-confirm";
      btn.textContent = "Un-ignore";
      btn.addEventListener("click", async () => {
        try {
          await api("/auditUnignore", "POST", { signature: entry.signature });
          row.classList.add("audit-ignored-removed");
          btn.disabled = true; btn.textContent = "Removed";
        } catch (e) { appendMessage("assistant", `Could not un-ignore: ${e.message}`); }
      });
      row.appendChild(btn);
      container.appendChild(row);
    }
  }

  // Manual prune button
  const footer = document.createElement("div");
  footer.className = "audit-footer";
  const pruneBtn = document.createElement("button");
  pruneBtn.className = "btn-ghost";
  pruneBtn.textContent = "Prune ghosts";
  pruneBtn.addEventListener("click", async () => {
    try {
      const res = await api("/auditPrune", "POST", {});
      const d = await res.json();
      appendMessage("system", `Pruned ${d.pruned} ghost entries · ${d.kept} remaining.`);
    } catch (e) { appendMessage("assistant", `Prune failed: ${e.message}`); }
  });
  footer.appendChild(pruneBtn);
  container.appendChild(footer);
}

function _humanizeIgnoredSignature(entry) {
  if (entry.category === "near-duplicates" || entry.category === "name-mismatches") {
    const m = entry.signature.match(/^[a-z-]+:(.+)\|(.+)$/);
    if (m) return `${m[1]} / ${m[2]}`;
  }
  // file:section[:extra]
  const parts = entry.signature.split(":");
  if (parts.length >= 2) return `${parts[0]} → ${parts[1]}`;
  return entry.signature;
}

// Shared inline-chat renderer for /archive-ignored and /deep-ignored.
// Same look-and-feel as /audit ignored: grouped rows, per-row Un-ignore,
// Prune ghosts footer button. Old "clear" / "clear file" subcommands are
// retired in favor of this per-row + manual prune approach.
async function runReviewIgnoredList({ title, listEndpoint, undismissEndpoint, pruneEndpoint, emptyHint }) {
  let dismissed;
  try {
    const res = await api(listEndpoint, "GET");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Could not load ignored list");
    dismissed = data.dismissed || {};
  } catch (err) {
    appendMessage("assistant", `Failed to load ${title.toLowerCase()}: ${err.message}`);
    return;
  }
  const entries = Object.entries(dismissed).filter(([, v]) => Array.isArray(v) && v.length > 0);
  const total = entries.reduce((sum, [, v]) => sum + v.length, 0);
  const msgEl = appendMessage("system", `${title} (${total} entr${total !== 1 ? "ies" : "y"})`);

  if (total === 0) {
    appendMessage("system", emptyHint);
    return;
  }

  const container = document.createElement("div");
  container.className = "audit-ignored-list";
  msgEl.appendChild(container);

  for (const [file, sections] of entries) {
    const head = document.createElement("div");
    head.className = "audit-ignored-cat";
    head.textContent = `${file.replace(".md", "").toUpperCase()} (${sections.length})`;
    container.appendChild(head);
    for (const section of sections) {
      const row = document.createElement("div");
      row.className = "audit-ignored-row";
      const label = document.createElement("span");
      label.className = "audit-ignored-label";
      label.textContent = section;
      row.appendChild(label);
      const spacer = document.createElement("span");
      spacer.className = "audit-ignored-age";
      row.appendChild(spacer);
      const btn = document.createElement("button");
      btn.className = "btn-archive-confirm";
      btn.textContent = "Un-ignore";
      btn.addEventListener("click", async () => {
        try {
          await api(undismissEndpoint, "POST", { file, section });
          row.classList.add("audit-ignored-removed");
          btn.disabled = true; btn.textContent = "Removed";
        } catch (e) { appendMessage("assistant", `Could not un-ignore: ${e.message}`); }
      });
      row.appendChild(btn);
      container.appendChild(row);
    }
  }

  // Manual prune ghosts button — same UX as /audit ignored.
  const footer = document.createElement("div");
  footer.className = "audit-footer";
  const pruneBtn = document.createElement("button");
  pruneBtn.className = "btn-ghost";
  pruneBtn.textContent = "Prune ghosts";
  pruneBtn.addEventListener("click", async () => {
    try {
      const res = await api(pruneEndpoint, "POST", {});
      const d = await res.json();
      appendMessage("system", `Pruned ${d.pruned || 0} ghost entries.`);
    } catch (e) { appendMessage("assistant", `Prune failed: ${e.message}`); }
  });
  footer.appendChild(pruneBtn);
  container.appendChild(footer);
}

function renderAuditFindings(data, mode) {
  const total = data.findings.length;
  const lastAuditLine = data.lastAudit
    ? `Last audit: ${_relativeTimeFrom(data.lastAudit.at)}`
    : "First audit on this memory.";
  const headerText = mode === "deep"
    ? `Memory audit (Deep scan) — ${total} finding${total !== 1 ? "s" : ""} · scope: ${data.scope}`
    : `Memory audit (Quick scan, free) — ${total} finding${total !== 1 ? "s" : ""} · scope: ${data.scope}`;

  const msgEl = appendMessage("system", `${headerText}\n${lastAuditLine}`);
  const container = document.createElement("div");
  container.className = "audit-results";
  msgEl.appendChild(container);

  // Group by category in AUDIT_CATEGORIES order (worker returns the canonical list)
  const byCat = {};
  for (const f of data.findings) {
    (byCat[f.category] = byCat[f.category] || []).push(f);
  }

  for (const cat of (data.categories || [])) {
    const items = byCat[cat.id] || [];
    const skipped = (data.skipped || []).includes(cat.id);
    const group = document.createElement("div");
    group.className = "audit-cat";
    if (items.length === 0 && !skipped) group.classList.add("audit-cat-empty");

    const head = document.createElement("button");
    head.className = "audit-cat-head";
    head.type = "button";
    const chev = document.createElement("span");
    chev.className = "audit-cat-chev";
    chev.textContent = (items.length > 0) ? "▼" : "▶";
    head.appendChild(chev);
    const labelText = skipped
      ? `${cat.icon} ${cat.label} (skipped — Deep scan only)`
      : `${cat.icon} ${cat.label} (${items.length})`;
    const label = document.createElement("span");
    label.textContent = " " + labelText;
    head.appendChild(label);
    group.appendChild(head);

    const body = document.createElement("div");
    body.className = "audit-cat-body";
    if (items.length === 0) body.style.display = "none";
    for (const f of items) body.appendChild(_renderAuditCard(f));
    group.appendChild(body);

    head.addEventListener("click", () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "";
      chev.textContent = open ? "▶" : "▼";
    });
    container.appendChild(group);
  }

  // Footer: offer Deep scan upgrade if we just ran Quick
  if (mode === "quick") {
    const footer = document.createElement("div");
    footer.className = "audit-footer";
    const btn = document.createElement("button");
    btn.className = "btn-archive-confirm";
    btn.textContent = "Run Deep scan (estimate cost)";
    btn.addEventListener("click", () => runAuditDeepWithConfirmation(data.scope));
    footer.appendChild(btn);
    container.appendChild(footer);
  }
}

function _renderAuditCard(f) {
  const card = document.createElement("div");
  card.className = "audit-card";
  const headLine = document.createElement("div");
  headLine.className = "audit-card-head";
  if (f.category === "near-duplicates" || f.category === "name-mismatches") {
    // Prefer matchedNames when present (deterministic name-mismatches detector
    // exposes the actual typo'd token; falls back to section headers otherwise).
    const labels = (Array.isArray(f.matchedNames) && f.matchedNames.length === 2) ? f.matchedNames : f.pair;
    const a = labels?.[0] || "?", b = labels?.[1] || "?";
    headLine.textContent = `${a} ⟷ ${b}`;
  } else if (f.category === "duplicate-headers") {
    const copy = (f.copyNumber && f.totalCopies) ? `  (copy ${f.copyNumber} of ${f.totalCopies})` : "";
    const loc = f.lineNumber ? ` — line ${f.lineNumber}` : "";
    headLine.textContent = `${f.file} → ${f.section || ""}${loc}${copy}`;
  } else if (f.category === "format-violations") {
    headLine.textContent = `${f.file} → heading: "${f.section || ""}"`;
  } else {
    const loc = f.lineNumber ? ` — line ${f.lineNumber}` : "";
    headLine.textContent = `${f.file} → ${f.section || ""}${loc}`;
  }
  card.appendChild(headLine);

  const detail = document.createElement("div");
  detail.className = "audit-card-detail";
  if (f.snippet)   detail.textContent = `"${f.snippet}"`;
  else if (f.expected) detail.textContent = `Expected: ${f.expected}`;
  else if (f.kind === "header-vs-created") detail.textContent = `Header date ${f.headerDate} ≠ Created ${f.createdDate}`;
  else if (f.kind === "stale-due") detail.textContent = `Open status with past Due (${f.dueDate})`;
  else if (f.category === "duplicate-headers") detail.textContent = "Same header appears in this file more than once. Open each copy and merge or delete.";
  else if (f.reason) detail.textContent = f.reason;
  if (detail.textContent) card.appendChild(detail);

  const row = document.createElement("div");
  row.className = "audit-card-actions";

  // For pair-based findings (near-duplicates, name-mismatches) emit ONE Open
  // button per record so the user can jump to either side of the pair.
  const isPair = (f.category === "near-duplicates" || f.category === "name-mismatches");
  const openButtons = [];
  if (isPair && Array.isArray(f.pair) && Array.isArray(f.files)) {
    const truncate = s => (s && s.length > 38) ? s.slice(0, 36) + "…" : (s || "?");
    for (let i = 0; i < f.pair.length; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Open: ${truncate(f.pair[i])}`;
      // Teal outline — navigation/primary action of the audit card.
      // Paired against the ghost-gray Ignore for clear visual hierarchy.
      btn.className = "archive-view-btn";
      btn.title = `${f.files[i]} → ${f.pair[i]}`;
      btn.addEventListener("click", () => {
        if (typeof runEditSection === "function") runEditSection(f.files[i], f.pair[i], null, null);
      });
      row.appendChild(btn);
      openButtons.push(btn);
    }
  } else if (f.category === "photo-issues" && f.deletePhotoFilename) {
    // Orphaned R2 object — show Delete button instead of Open
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete from R2";
    delBtn.className = "archive-view-btn";
    delBtn.addEventListener("click", async () => {
      delBtn.disabled = true;
      delBtn.textContent = "Deleting…";
      try {
        const r = await api("/deletePhoto", "POST", { filename: f.deletePhotoFilename });
        const d = await r.json();
        if (d.ok) {
          card.classList.add("audit-card-ignored");
          delBtn.textContent = "Deleted";
        } else {
          delBtn.textContent = "Delete from R2";
          delBtn.disabled = false;
          showToast("Delete failed: " + (d.error || "unknown"));
        }
      } catch (err) {
        delBtn.textContent = "Delete from R2";
        delBtn.disabled = false;
        showToast("Delete failed: " + err.message);
      }
    });
    row.appendChild(delBtn);
    openButtons.push(delBtn);
  } else {
    const openBtn = document.createElement("button");
    openBtn.textContent = f.category === "photo-issues" ? "Open record" : "Open";
    openBtn.className = "archive-view-btn";
    openBtn.addEventListener("click", () => _openAuditTarget(f));
    row.appendChild(openBtn);
    openButtons.push(openBtn);
  }

  const ignoreBtn = document.createElement("button");
  ignoreBtn.textContent = "Ignore";
  ignoreBtn.className = "btn-ghost";
  ignoreBtn.title = t("tooltip.audit-ignore");
  ignoreBtn.addEventListener("click", async () => {
    try {
      await api("/auditIgnore", "POST", { signature: f.signature, category: f.category });
      card.classList.add("audit-card-ignored");
      openButtons.forEach(b => b.disabled = true);
      ignoreBtn.disabled = true;
      ignoreBtn.textContent = "Ignored";
    } catch (e) {
      appendMessage("assistant", `Could not save ignore: ${e.message}`);
    }
  });
  row.appendChild(ignoreBtn);
  card.appendChild(row);
  return card;
}

function _openAuditTarget(f) {
  // For pair-based categories, open record A; if user wants B they can re-open from list.
  const file = f.file || (f.files && f.files[0]);
  const section = f.section || (f.pair && f.pair[0]);
  // duplicate-headers carries a per-occurrence index so the worker can disambiguate
  // between two records with the same header. Other categories don't need it.
  const occurrenceIndex = (typeof f.occurrenceIndex === "number") ? f.occurrenceIndex : null;
  if (!file || !section) {
    appendMessage("system", "Cannot open — missing file/section reference.");
    return;
  }
  if (typeof runEditSection === "function") runEditSection(file, section, null, occurrenceIndex);
  else appendMessage("system", `Open ${file} → ${section} manually.`);
}

function _relativeTimeFrom(ts) {
  const ms = Date.now() - ts;
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return days === 1 ? t("time.days-ago-one") : t("time.days-ago-many", { n: days });
  const hrs = Math.floor(ms / 3600000);
  if (hrs >= 1) return hrs === 1 ? t("time.hours-ago-one") : t("time.hours-ago-many", { n: hrs });
  return t("time.just-now");
}

// ---- Archive Review ----
async function runArchiveReview(targetFile, deep = false, context = null) {
  try {
    const payload = {};
    if (targetFile) payload.file = targetFile;
    if (deep) payload.deep = true;
    if (context) payload.context = context;
    const res = await api("/analyzeArchive", "POST", payload);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Analysis failed");
    if (!data.candidates || data.candidates.length === 0) {
      appendMessage("system", "No archive candidates found.");
      return;
    }
    showArchiveModal(data.candidates);
  } catch (err) {
    appendMessage("assistant", `Archive review failed: ${err.message}`);
  }
}

function showArchiveModal(candidates) {
  const byFile = {};
  for (const c of candidates) {
    if (!byFile[c.file]) byFile[c.file] = [];
    byFile[c.file].push(c);
  }
  const total = candidates.length;
  archiveModalBody.innerHTML = `<p class="archive-modal-count">${total} candidate${total !== 1 ? "s" : ""} found — scroll to review all before selecting</p>`;
  for (const [file, items] of Object.entries(byFile)) {
    const group = document.createElement("div");
    group.className = "archive-group";
    const hdr = document.createElement("div");
    hdr.className = "archive-group-header";
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    const label = document.createElement("span");
    label.textContent = file.replace(".md", "").toUpperCase() + ` — select all ${items.length}`;
    hdr.appendChild(selectAll);
    hdr.appendChild(label);
    group.appendChild(hdr);
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "archive-item";
      const itemLabel = document.createElement("label");
      itemLabel.className = "archive-item-label";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.dataset.file = item.file;
      chk.dataset.section = item.sectionTitle;
      chk.className = "archive-chk";
      const txt = document.createElement("span");
      txt.innerHTML = `<strong>${escapeHtml(item.sectionTitle)}</strong><span class="archive-reason">${escapeHtml(item.reason)}</span>`;
      itemLabel.appendChild(chk);
      itemLabel.appendChild(txt);
      const viewBtn = document.createElement("button");
      viewBtn.className = "archive-view-btn";
      viewBtn.textContent = "View";
      const previewArea = document.createElement("div");
      previewArea.className = "archive-preview-area";
      const previewPre = document.createElement("pre");
      previewPre.className = "archive-preview-text";
      previewPre.textContent = "Loading...";
      previewArea.appendChild(previewPre);
      viewBtn.addEventListener("click", async () => {
        const isOpen = previewArea.classList.contains("open");
        if (isOpen) {
          previewArea.classList.remove("open");
          viewBtn.textContent = "View";
          return;
        }
        if (!previewArea.dataset.loaded) {
          viewBtn.textContent = "...";
          viewBtn.disabled = true;
          try {
            const res = await api(`/getMemoryFile?filename=${encodeURIComponent(item.file)}&section=${encodeURIComponent(item.sectionTitle)}`, "GET");
            previewPre.textContent = res.ok ? await res.text() : "Could not load.";
          } catch {
            previewPre.textContent = "Could not load.";
          }
          previewArea.dataset.loaded = "1";
          viewBtn.disabled = false;
        }
        previewArea.classList.add("open");
        viewBtn.textContent = "Hide";
      });

      const skipBtn = document.createElement("button");
      skipBtn.className = "archive-skip-btn";
      skipBtn.textContent = "Skip";
      skipBtn.title = t("tooltip.skip-suggest");
      skipBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await api("/archiveDismiss", "POST", { sections: [{ file: item.file, sectionTitle: item.sectionTitle }] });
        row.remove();
        previewArea.remove();
        updateArchiveConfirmBtn();
        const remaining = group.querySelectorAll(".archive-item").length;
        if (remaining === 0) group.remove();
        const totalRemaining = archiveModalBody.querySelectorAll(".archive-item").length;
        const countEl = archiveModalBody.querySelector(".archive-modal-count");
        if (countEl) countEl.textContent = `${totalRemaining} candidate${totalRemaining !== 1 ? "s" : ""} — scroll to review all before selecting`;
      });
      row.appendChild(itemLabel);
      row.appendChild(viewBtn);
      row.appendChild(skipBtn);
      group.appendChild(row);
      group.appendChild(previewArea);
      chk.addEventListener("change", updateArchiveConfirmBtn);
    }
    selectAll.addEventListener("change", () => {
      group.querySelectorAll(".archive-chk").forEach(c => { c.checked = selectAll.checked; });
      updateArchiveConfirmBtn();
    });
    archiveModalBody.appendChild(group);
  }
  updateArchiveConfirmBtn();
  archiveModal.classList.remove("hidden");
}

function updateArchiveConfirmBtn() {
  const count = archiveModalBody.querySelectorAll(".archive-chk:checked").length;
  archiveConfirm.textContent = `Archive Selected (${count})`;
  archiveConfirm.disabled = count === 0;
}

archiveClose.addEventListener("click", () => archiveModal.classList.add("hidden"));
archiveCancel.addEventListener("click", () => archiveModal.classList.add("hidden"));
archiveConfirm.addEventListener("click", async () => {
  const checked = archiveModalBody.querySelectorAll(".archive-chk:checked");
  const moves = Array.from(checked).map(c => ({ sourceFile: c.dataset.file, sectionTitle: c.dataset.section }));
  archiveModal.classList.add("hidden");
  appendMessage("system", `Archiving ${moves.length} item${moves.length !== 1 ? "s" : ""}...`);
  try {
    const res = await api("/moveToArchive", "POST", { moves });
    const data = await res.json();
    const succeeded = data.results.filter(r => r.ok).map(r => r.sectionTitle);
    const failed = data.results.filter(r => !r.ok).map(r => `${r.sectionTitle} (${r.error})`);
    let msg = `Archived: ${succeeded.join(", ")}`;
    if (failed.length) msg += `\n⚠ Failed: ${failed.join(", ")}`;
    appendMessage("system", msg);
  } catch (err) {
    appendMessage("assistant", `Archive failed: ${err.message}`);
  }
});

// ---- Deep Archive Review ----
async function runDeepReview(fileArg = null, context = null) {
  try {
    const payload = {};
    if (fileArg) payload.file = fileArg;
    if (context) payload.context = context;
    const res = await api("/analyzeDeep", "POST", payload);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Analysis failed");
    if (!data.candidates || data.candidates.length === 0) {
      appendMessage("system", "No cold storage candidates found.");
      return;
    }
    showDeepModal(data.candidates);
  } catch (err) {
    appendMessage("assistant", `Deep review failed: ${err.message}`);
  }
}

function showDeepModal(candidates) {
  const byFile = {};
  for (const c of candidates) {
    if (!byFile[c.file]) byFile[c.file] = [];
    byFile[c.file].push(c);
  }
  const total = candidates.length;
  deepModalBody.innerHTML = `<p class="archive-modal-count">${total} candidate${total !== 1 ? "s" : ""} found — scroll to review all before selecting</p>`;
  for (const [file, items] of Object.entries(byFile)) {
    const group = document.createElement("div");
    group.className = "archive-group";
    const hdr = document.createElement("div");
    hdr.className = "archive-group-header";
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    const label = document.createElement("span");
    label.textContent = file.replace(".md", "").toUpperCase() + ` — select all ${items.length}`;
    hdr.appendChild(selectAll);
    hdr.appendChild(label);
    group.appendChild(hdr);
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "archive-item";
      const itemLabel = document.createElement("label");
      itemLabel.className = "archive-item-label";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.dataset.file = item.file;
      chk.dataset.section = item.sectionTitle;
      chk.className = "deep-chk";
      const txt = document.createElement("span");
      txt.innerHTML = `<strong>${escapeHtml(item.sectionTitle)}</strong><span class="archive-reason">${escapeHtml(item.reason)}</span>`;
      itemLabel.appendChild(chk);
      itemLabel.appendChild(txt);
      const viewBtn = document.createElement("button");
      viewBtn.className = "archive-view-btn";
      viewBtn.textContent = "View";
      const previewArea = document.createElement("div");
      previewArea.className = "archive-preview-area";
      const previewPre = document.createElement("pre");
      previewPre.className = "archive-preview-text";
      previewPre.textContent = "Loading...";
      previewArea.appendChild(previewPre);
      viewBtn.addEventListener("click", async () => {
        const isOpen = previewArea.classList.contains("open");
        if (isOpen) { previewArea.classList.remove("open"); viewBtn.textContent = "View"; return; }
        if (!previewArea.dataset.loaded) {
          viewBtn.textContent = "...";
          viewBtn.disabled = true;
          try {
            const res = await api(`/getMemoryFile?filename=${encodeURIComponent(item.file)}&section=${encodeURIComponent(item.sectionTitle)}`, "GET");
            previewPre.textContent = res.ok ? await res.text() : "Could not load.";
          } catch { previewPre.textContent = "Could not load."; }
          previewArea.dataset.loaded = "1";
          viewBtn.disabled = false;
        }
        previewArea.classList.add("open");
        viewBtn.textContent = "Hide";
      });
      const skipBtn = document.createElement("button");
      skipBtn.className = "archive-skip-btn";
      skipBtn.textContent = "Skip";
      skipBtn.title = t("tooltip.skip-suggest");
      skipBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await api("/deepDismiss", "POST", { sections: [{ file: item.file, sectionTitle: item.sectionTitle }] });
        row.remove();
        previewArea.remove();
        updateDeepConfirmBtn();
        const remaining = group.querySelectorAll(".archive-item").length;
        if (remaining === 0) group.remove();
        const totalRemaining = deepModalBody.querySelectorAll(".archive-item").length;
        const countEl = deepModalBody.querySelector(".archive-modal-count");
        if (countEl) countEl.textContent = `${totalRemaining} candidate${totalRemaining !== 1 ? "s" : ""} — scroll to review all before selecting`;
      });
      row.appendChild(itemLabel);
      row.appendChild(viewBtn);
      row.appendChild(skipBtn);
      group.appendChild(row);
      group.appendChild(previewArea);
      chk.addEventListener("change", updateDeepConfirmBtn);
    }
    selectAll.addEventListener("change", () => {
      group.querySelectorAll(".deep-chk").forEach(c => { c.checked = selectAll.checked; });
      updateDeepConfirmBtn();
    });
    deepModalBody.appendChild(group);
  }
  updateDeepConfirmBtn();
  deepModal.classList.remove("hidden");
}

function updateDeepConfirmBtn() {
  const count = deepModalBody.querySelectorAll(".deep-chk:checked").length;
  deepConfirm.textContent = `Move to Cold Storage (${count})`;
  deepConfirm.disabled = count === 0;
}

deepClose.addEventListener("click", () => deepModal.classList.add("hidden"));
deepCancel.addEventListener("click", () => deepModal.classList.add("hidden"));
deepConfirm.addEventListener("click", async () => {
  const checked = deepModalBody.querySelectorAll(".deep-chk:checked");
  const moves = Array.from(checked).map(c => ({ sourceFile: c.dataset.file, sectionTitle: c.dataset.section }));
  const deepCountBefore = parseInt(document.getElementById("deep-record-count")?.textContent || "0", 10) || 0;
  deepModal.classList.add("hidden");
  appendMessage("system", `Moving ${moves.length} item${moves.length !== 1 ? "s" : ""} to cold storage...`);
  try {
    const res = await api("/moveToDeep", "POST", { moves });
    const data = await res.json();
    const succeeded = data.results.filter(r => r.ok).map(r => r.sectionTitle);
    const failed = data.results.filter(r => !r.ok);
    const tutorial = deepCountBefore === 0 ? " Use /recall to find them or /restore to bring any back. The 🔐 badge in the header shows your cold storage count and browses all records when tapped." : "";
    let msg = succeeded.length
      ? `Moved to cold storage: ${succeeded.join(", ")}.${tutorial}`
      : "";
    if (failed.length) {
      const hasVerifyFail = failed.some(r => r.error && r.error.includes("verified"));
      const failNames = failed.map(r => r.sectionTitle).join(", ");
      msg += `\n⚠ ${failNames} was not moved — nothing was changed or lost. This is a temporary storage hiccup (Cloudflare KV occasionally lags on a write verify). Run /deep again and select it — it will go through.`;
      if (!hasVerifyFail) msg += ` Error detail: ${failed.map(r => r.error).join(", ")}`;
    }
    appendMessage("system", msg.trim());
    if (succeeded.length) refreshDeepBadge();
  } catch (err) {
    appendMessage("assistant", `Deep archive move failed: ${err.message}`);
  }
});

// ---- Compact Validation ----
// allowHeaderChange: true for manual Edit Record (user can rename the section);
// false for Compact preview (AI-generated content must preserve the header).
function validateCompactEdit(compactedText, sectionTitle, beforeText, allowHeaderChange = false) {
  if (!compactedText.trim()) return "Cannot save empty content.";
  const firstLine = compactedText.trim().split("\n")[0];
  if (!/^##\s+\S/.test(firstLine)) return `First line must be the ## header with a name — e.g. "## ${sectionTitle}"`;
  if (!allowHeaderChange) {
    const norm = s => s.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const expectedNorm = norm(sectionTitle);
    const actualNorm = norm(firstLine.replace(/^##\s+/, ""));
    if (!actualNorm.includes(expectedNorm) && !expectedNorm.includes(actualNorm)) {
      return `Header changed — keep "## ${sectionTitle}" as the first line`;
    }
  }
  if (beforeText && beforeText !== "Loading..." && beforeText !== "Could not load original.") {
    if (compactedText.trim().length < beforeText.length * 0.08) {
      return "Content looks too short — may have been accidentally cleared";
    }
  }
  return null;
}

// ---- Compact Review ----
async function runCompactReview(targetFile) {
  try {
    const payload = {};
    if (targetFile) payload.file = targetFile;
    const res = await api("/analyzeCompact", "POST", payload);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Analysis failed");
    if (!data.candidates || data.candidates.length === 0) {
      appendMessage("system", "No verbose records found — memory looks tight.");
      return;
    }
    showCompactModal(data.candidates);
  } catch (err) {
    appendMessage("assistant", `Compact review failed: ${err.message}`);
  }
}

// Compact staleness check uses SHA-256 (via _sha256Hex above) on both sides.
// Previously this was a custom 32-bit djb2 hash duplicated client + server —
// silent-failure trap if either side drifted to a different algorithm. Using
// SHA-256 ties the staleness check to a single shared primitive with full
// collision resistance.

function showCompactModal(candidates) {
  const byFile = {};
  for (const c of candidates) {
    if (!byFile[c.file]) byFile[c.file] = [];
    byFile[c.file].push(c);
  }
  const total = candidates.length;
  compactModalBody.innerHTML = `<p class="compact-modal-count">${total} verbose record${total !== 1 ? "s" : ""} found — tap Load on each to choose a compaction level</p>`;
  let previewsLoaded = 0;
  const tallyEl = document.createElement("p");
  tallyEl.className = "compact-preview-tally hidden";
  compactModalBody.appendChild(tallyEl);

  for (const [file, items] of Object.entries(byFile)) {
    const group = document.createElement("div");
    group.className = "compact-group";

    const hdr = document.createElement("div");
    hdr.className = "compact-group-header";
    const label = document.createElement("span");
    label.textContent = file.replace(".md", "").toUpperCase();
    hdr.appendChild(label);
    group.appendChild(hdr);

    for (const item of items) {
      const itemEl = document.createElement("div");
      itemEl.className = "compact-item";

      // ── Card header row ──
      const row = document.createElement("div");
      row.className = "compact-item-row";

      const itemLabel = document.createElement("label");
      itemLabel.className = "compact-item-label";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "compact-chk";
      chk.dataset.file = item.file;
      chk.dataset.section = item.sectionTitle;
      chk.dataset.sectionHash = "";
      chk.disabled = true; // enabled only after Preview loaded
      const titleSpan = document.createElement("span");
      titleSpan.textContent = item.sectionTitle;
      itemLabel.appendChild(chk);
      itemLabel.appendChild(titleSpan);

      const badgeWrap = document.createElement("span");
      badgeWrap.className = "compact-badge-wrap";
      if (item.verbosityScore) {
        const scoreBadge = document.createElement("span");
        scoreBadge.className = "compact-score-badge";
        scoreBadge.textContent = `${item.verbosityScore}/10`;
        badgeWrap.appendChild(scoreBadge);
      }
      const savingsBadge = document.createElement("span");
      savingsBadge.className = "compact-savings-badge";
      if (item.tokenSavings) {
        savingsBadge.textContent = `~${item.tokenSavings}% smaller`;
        badgeWrap.appendChild(savingsBadge);
      }

      const previewBtn = document.createElement("button");
      previewBtn.className = "compact-edit-btn";
      previewBtn.textContent = "Load";

      const skipBtn = document.createElement("button");
      skipBtn.className = "compact-skip-btn";
      skipBtn.textContent = "Skip";

      row.appendChild(itemLabel);
      row.appendChild(badgeWrap);
      row.appendChild(previewBtn);
      row.appendChild(skipBtn);

      // ── Expandable preview panel ──
      const panel = document.createElement("div");
      panel.className = "compact-text-area";

      // Level chips
      const levelRow = document.createElement("div");
      levelRow.className = "compact-level-row";
      const levelLabel = document.createElement("span");
      levelLabel.className = "compact-level-label";
      levelLabel.textContent = "Compaction level:";
      levelRow.appendChild(levelLabel);
      const levels = ["normal", "medium", "high"];
      const levelWarnings = {
        medium: "Older timeline entries will be collapsed into summaries. Review carefully.",
        high: "⚠ Aggressive — strips to essentials only. Review every line before saving.",
      };
      let selectedLevel = "normal";
      const chips = {};
      levels.forEach(lv => {
        const chip = document.createElement("button");
        chip.className = "compact-level-chip" + (lv === "normal" ? " active" : "");
        chip.textContent = lv.charAt(0).toUpperCase() + lv.slice(1);
        chip.dataset.level = lv;
        chip.addEventListener("click", () => {
          selectedLevel = lv;
          levels.forEach(l => chips[l].classList.toggle("active", l === lv));
          warnEl.textContent = levelWarnings[lv] || "";
          warnEl.className = "compact-level-warn" + (lv === "medium" ? " warn-medium" : lv === "high" ? " warn-high" : "");
          fetchPreview();
        });
        chips[lv] = chip;
        levelRow.appendChild(chip);
      });

      const warnEl = document.createElement("div");
      warnEl.className = "compact-level-warn";

      // Before/After
      const beforeLabel = document.createElement("div");
      beforeLabel.className = "compact-section-label";
      beforeLabel.textContent = "BEFORE";
      const beforePre = document.createElement("pre");
      beforePre.className = "compact-before-text";
      beforePre.textContent = "";

      const afterLabel = document.createElement("div");
      afterLabel.className = "compact-section-label compact-after-label";
      afterLabel.textContent = "AFTER — edit below";
      const ta = document.createElement("textarea");
      ta.rows = 4;
      ta.addEventListener("input", () => {
        ta.classList.remove("compact-ta-error");
        if (validationErr) validationErr.classList.remove("visible");
      });

      const validationErr = document.createElement("div");
      validationErr.className = "compact-validation-error";

      panel.appendChild(levelRow);
      panel.appendChild(warnEl);
      panel.appendChild(beforeLabel);
      panel.appendChild(beforePre);
      panel.appendChild(afterLabel);
      panel.appendChild(ta);
      panel.appendChild(validationErr);

      // Fetch preview from server at selected level
      const fetchPreview = async () => {
        previewBtn.textContent = panel.classList.contains("open") ? "▲ ..." : "...";
        previewBtn.disabled = true;
        chk.disabled = true;
        chk.checked = false;
        updateCompactConfirmBtn();
        ta.value = "";
        beforePre.textContent = "Loading...";
        try {
          const res = await api("/analyzeCompact", "POST", { section: item.sectionTitle, file: item.file, level: selectedLevel });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || "Preview failed");
          // Load live Before content for staleness hash
          const beforeRes = await api(`/getMemoryFile?filename=${encodeURIComponent(item.file)}&section=${encodeURIComponent(item.sectionTitle)}`, "GET");
          const beforeText = beforeRes.ok ? await beforeRes.text() : "Could not load original.";
          beforePre.textContent = beforeText;
          if (beforeRes.ok) chk.dataset.sectionHash = await _sha256Hex(beforeText);
          if (data.candidates && data.candidates.length > 0) {
            const c = data.candidates[0];
            ta.value = c.compactedText || "";
            ta.rows = Math.max(4, ta.value.split("\n").length + 1);
            if (c.tokenSavings) {
              savingsBadge.textContent = `~${c.tokenSavings}% smaller`;
              if (!savingsBadge.parentNode) badgeWrap.appendChild(savingsBadge);
            }
            chk.disabled = false;
            updateCompactConfirmBtn();
            previewsLoaded++;
            tallyEl.textContent = previewsLoaded === 1
              ? t("compact.tally-one", { cost: (previewsLoaded * 0.5).toFixed(1) })
              : t("compact.tally-many", { n: previewsLoaded, cost: (previewsLoaded * 0.5).toFixed(1) });
            tallyEl.classList.remove("hidden");
          } else {
            ta.value = "";
            beforePre.textContent += "\n\n(No compaction needed at this level)";
          }
        } catch (err) {
          beforePre.textContent = `Error: ${err.message}`;
          ta.value = "";
        }
        previewBtn.textContent = "▲ Collapse";
        previewBtn.disabled = false;
      };

      previewBtn.addEventListener("click", () => {
        if (panel.classList.contains("open")) {
          panel.classList.remove("open");
          previewBtn.textContent = "Load";
        } else {
          panel.classList.add("open");
          previewBtn.textContent = "▲ Collapse";
        }
      });

      skipBtn.addEventListener("click", () => {
        itemEl.remove();
        updateCompactConfirmBtn();
        const remaining = group.querySelectorAll(".compact-item").length;
        if (remaining === 0) group.remove();
        const totalRemaining = compactModalBody.querySelectorAll(".compact-item").length;
        const countEl = compactModalBody.querySelector(".compact-modal-count");
        if (countEl) countEl.textContent = `${totalRemaining} verbose record${totalRemaining !== 1 ? "s" : ""} found — tap Load on each to choose a compaction level`;
      });

      chk.addEventListener("change", updateCompactConfirmBtn);

      itemEl.appendChild(row);
      itemEl.appendChild(panel);
      group.appendChild(itemEl);
    }

    compactModalBody.appendChild(group);
  }

  updateCompactConfirmBtn();
  compactModal.classList.remove("hidden");
}

function updateCompactConfirmBtn() {
  const count = compactModalBody.querySelectorAll(".compact-chk:checked:not(:disabled)").length;
  compactConfirm.textContent = `Compact Selected (${count})`;
  compactConfirm.disabled = count === 0;
}

compactClose.addEventListener("click", () => compactModal.classList.add("hidden"));
compactCancel.addEventListener("click", () => compactModal.classList.add("hidden"));
compactConfirm.addEventListener("click", async () => {
  const checked = compactModalBody.querySelectorAll(".compact-chk:checked");

  // Validate all checked items before saving anything
  const items = [];
  let hasErrors = false;
  for (const chk of Array.from(checked)) {
    const itemEl = chk.closest(".compact-item");
    const ta = itemEl ? itemEl.querySelector("textarea") : null;
    const errEl = itemEl ? itemEl.querySelector(".compact-validation-error") : null;
    const beforePre = itemEl ? itemEl.querySelector(".compact-before-text") : null;
    if (!ta) continue;
    const compactedText = ta.value.trim();
    const error = validateCompactEdit(compactedText, chk.dataset.section, beforePre ? beforePre.textContent : null);
    if (error) {
      ta.classList.add("compact-ta-error");
      if (errEl) { errEl.textContent = error; errEl.classList.add("visible"); }
      // Open the edit panel so the error is visible
      const textArea = ta.closest(".compact-text-area");
      if (textArea && !textArea.classList.contains("open")) textArea.classList.add("open");
      hasErrors = true;
    } else {
      ta.classList.remove("compact-ta-error");
      if (errEl) errEl.classList.remove("visible");
      items.push({ filename: chk.dataset.file, sectionTitle: chk.dataset.section, compactedText, sectionHash: chk.dataset.sectionHash || undefined });
    }
  }
  if (hasErrors) return; // stay open, let user fix

  compactModal.classList.add("hidden");
  appendMessage("system", `Compacting ${items.length} section${items.length !== 1 ? "s" : ""}...`);

  let totalSaved = 0;
  const succeeded = [];
  const failed = [];

  for (const item of items) {
    try {
      const res = await api("/compactSection", "POST", item);
      const data = await res.json();
      if (data.ok) {
        totalSaved += (data.saved || 0);
        succeeded.push(item.sectionTitle);
      } else {
        failed.push(`${item.sectionTitle} (${data.error})`);
      }
    } catch (err) {
      failed.push(`${item.sectionTitle} (${err.message})`);
    }
  }

  const savedKb = (totalSaved / 1024).toFixed(1);
  let msg = `Compacted: ${succeeded.join(", ")} · ${savedKb} KB saved from working memory`;
  if (failed.length) msg += `\n⚠ Failed: ${failed.join(", ")}`;
  appendMessage("system", msg);
});

// ---- Delete Section ----
async function showDeleteModal(filename, section, sourceBtn = null, requireTitle = false, occurrenceIndex = null) {
  const confirmWord = requireTitle ? section.trim().toLowerCase() : "delete";
  deleteModalPending = { filename, section, btn: sourceBtn, confirmWord, occurrenceIndex };
  // Capture this pending reference so async fetch results (below) can be
  // discarded if the user opens a different delete modal before our fetch
  // resolves. Identity comparison avoids cross-contamination of openHash.
  const myPending = deleteModalPending;
  deleteModalTarget.textContent = `${filename} › ${section}`;
  deleteModalContent.textContent = "Loading...";
  deleteModalInput.value = "";
  deleteModalInput.placeholder = requireTitle ? `Type "${section}" to confirm` : 'Type "delete" to confirm';
  deleteModalConfirm.disabled = true;
  // Show archive warning when deleting from an archive file
  const archiveWarning = deleteModal.querySelector(".delete-archive-warning");
  if (filename.startsWith("archive_") || filename.startsWith("deeparchive_")) {
    const isDeep = filename.startsWith("deeparchive_");
    const warnText = isDeep ? "⚠ Cold storage record — no restore path if deleted" : "⚠ Archived record — no restore path if deleted";
    if (!archiveWarning) {
      const warn = document.createElement("div");
      warn.className = "delete-modal-warning delete-archive-warning";
      warn.textContent = warnText;
      deleteModalTarget.insertAdjacentElement("afterend", warn);
    } else {
      archiveWarning.textContent = warnText;
    }
  } else if (archiveWarning) {
    archiveWarning.remove();
  }
  deleteModal.classList.remove("hidden");
  try {
    const occQs = occurrenceIndex !== null ? `&occurrenceIndex=${occurrenceIndex}` : "";
    const res = await api(`/getMemoryFile?filename=${encodeURIComponent(filename)}&section=${encodeURIComponent(section)}${occQs}`, "GET");
    if (res.ok) {
      const text = await res.text();
      deleteModalContent.textContent = text;
      // Stash the section's open-time SHA-256 on the pending state so the
      // confirm click can send it as sectionHash for optimistic concurrency.
      const hash = await _sha256Hex(text);
      // Only stamp openHash if the pending object is still OURS — guards
      // against modal-A/modal-B cross-contamination if the user opens a
      // second delete modal before our async fetch resolves.
      if (deleteModalPending === myPending) deleteModalPending.openHash = hash;
    } else {
      deleteModalContent.textContent = "Could not load content.";
    }
  } catch {
    deleteModalContent.textContent = "Could not load content.";
  }
}

deleteModalInput.addEventListener("input", () => {
  deleteModalConfirm.disabled = deleteModalInput.value.trim().toLowerCase() !== (deleteModalPending?.confirmWord || "delete");
});

function closeDeleteModal() {
  deleteModal.classList.add("hidden");
  deleteModalPending = null;
  deleteModalInput.value = "";
  // Re-enable input — it may have been frozen if the user dismissed
  // the modal while the /deleteSection api call was still in flight.
  // Without this, the next open would have a permanently-disabled input
  // and the user couldn't type the confirm word.
  deleteModalInput.disabled = false;
  deleteModalConfirm.disabled = true;
}

deleteModalCancel.addEventListener("click", closeDeleteModal);
deleteModal.addEventListener("click", e => { if (e.target === deleteModal) closeDeleteModal(); });

deleteModalConfirm.addEventListener("click", async () => {
  if (!deleteModalPending) return;
  const { filename, section, btn, occurrenceIndex, openHash } = deleteModalPending;
  // Disable the confirm button + freeze input but KEEP the modal visible
  // until we know the api call's outcome. Modal needs to stay rendered so
  // the conflict banner has a visible container; we hide it only on
  // success or on a non-conflict error below.
  deleteModalConfirm.disabled = true;
  deleteModalInput.disabled = true;
  try {
    const sectionHash = openHash || "";
    const res = await api("/deleteSection", "POST", { filename, section, ...(occurrenceIndex !== null ? { occurrenceIndex } : {}), ...(sectionHash ? { sectionHash } : {}) });
    const data = await res.json();
    if (await handleConflict(res, data, {
      container: deleteModal.querySelector(".delete-modal-inner") || deleteModal,
      onReload: async () => {
        // Re-open the modal with fresh content. showDeleteModal resets all
        // state (Loading… placeholder, confirm-disabled, input cleared,
        // re-fetches content) so the user sees the latest version and can
        // decide whether to proceed.
        await showDeleteModal(filename, section, btn, false, occurrenceIndex);
      },
    })) {
      // Re-enable input in case the user dismisses the banner instead of
      // reloading — they can edit the confirm word and re-confirm against
      // the same (now stale) sectionHash, which the worker will 409 again.
      // Reload is the right path; this is back-compat.
      deleteModalInput.disabled = false;
      return;
    }
    // Past the conflict check — proceed with normal success/error path.
    // Hide the modal and null pending NOW so the rest of the handler
    // doesn't see stale state if the user clicks again.
    deleteModal.classList.add("hidden");
    deleteModalPending = null;
    deleteModalInput.value = "";
    deleteModalInput.disabled = false;
    if (data.ok) {
      appendMessage("system", `Deleted: "${section}" from ${filename}.`);
      if (btn) {
        btn.classList.add("delete-result-done");
        btn.disabled = true;
      }
      // Cold storage delete shifts the deep-record count — refresh the 🔐 badge.
      if (filename.startsWith("deeparchive_")) refreshDeepBadge();
    } else {
      appendMessage("system", `Delete failed: ${data.error}`);
    }
  } catch (err) {
    appendMessage("system", `Delete failed: ${err.message}`);
    // Mirror the success-path cleanup so a thrown api error doesn't leave
    // the modal stuck visible with confirm + input frozen. Without this,
    // the user is locked into the modal with no way to retry except
    // clicking Cancel/backdrop (which then hits N1, now fixed).
    deleteModal.classList.add("hidden");
    deleteModalPending = null;
    deleteModalInput.value = "";
    deleteModalInput.disabled = false;
    deleteModalConfirm.disabled = true;
  }
});

// ---- Keyword highlight helper ----
function highlightKeyword(text, keyword) {
  const safe = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!keyword) return safe;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

// ---- Edit Section ----
async function runEditSection(file, sectionName, keyword, occurrenceIndex) {
  const activeFiles = ["people.md", "reflections.md", "fragments.md", "loops.md"];
  const archiveFiles = ["archive_people.md", "archive_reflections.md", "archive_fragments.md", "archive_loops.md"];
  const filesToSearch = file ? [file] : (archiveMode ? [...activeFiles, ...archiveFiles] : activeFiles);
  for (const f of filesToSearch) {
    try {
      const occQs = (occurrenceIndex !== null && occurrenceIndex !== undefined) ? `&occurrenceIndex=${occurrenceIndex}` : "";
      const res = await api(`/getMemoryFile?filename=${encodeURIComponent(f)}&section=${encodeURIComponent(sectionName)}${occQs}`, "GET");
      if (res.ok) {
        const text = await res.text();
        // Set when the worker matched an interior (###) heading and opened the
        // H2 record containing it instead — see findSubsectionParent in
        // worker.js. Percent-encoded because header values are latin-1.
        const resolvedRaw = res.headers.get("X-Resolved-Section");
        const resolved = resolvedRaw ? decodeURIComponent(resolvedRaw) : null;
        if (text && !text.startsWith("Section not found")) {
          // Pass occurrenceIndex through to showEditModal so currentEditTarget
          // (used by the Delete-record button) carries the correct instance
          // when the file has duplicate-named sections.
          //
          // On a resolved subsection, edit the PARENT: that is the addressable
          // record, and it is what Save and Delete will target — carrying the
          // ### name here would make Delete-record fail or aim at the wrong
          // thing. The requested name becomes the highlight keyword so the user
          // still lands on the subsection they clicked. occurrenceIndex counted
          // interior headings, so it does not apply to the parent.
          showEditModal(
            resolved || sectionName,
            f,
            text,
            resolved ? sectionName : keyword,
            resolved ? null : (occurrenceIndex !== undefined ? occurrenceIndex : null),
          );
          return;
        }
      }
    } catch {}
  }
  appendMessage("system", `"${sectionName}" not found.`);
}

// ---- Find bar state ----
let _findMatches = [];
let _findIndex = 0;
let _tierMovePending = null;

function findAllMatches(text, keyword) {
  const matches = [];
  if (!keyword) return matches;
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  let i = 0;
  while ((i = lower.indexOf(kw, i)) !== -1) {
    matches.push(i);
    i += kw.length;
  }
  return matches;
}

function scrollTaToMatch(idx, keyword) {
  const content = editModalTa.value;
  const linesBefore = content.slice(0, idx).split("\n").length - 1;
  const lineHeight = parseFloat(getComputedStyle(editModalTa).lineHeight) || 20;
  editModalTa.scrollTop = Math.max(0, (linesBefore - 2) * lineHeight);
  editModalTa.focus();
  editModalTa.setSelectionRange(idx, idx + keyword.length);
}

function updateFindLabel() {
  if (!_findMatches.length) {
    editModalFindLabel.textContent = "No matches";
  } else {
    editModalFindLabel.textContent = `${_findIndex + 1} of ${_findMatches.length} · "${editModalTa.dataset.highlightKeyword}"`;
  }
}

editModalFindNext.addEventListener("click", () => {
  if (!_findMatches.length) return;
  _findIndex = (_findIndex + 1) % _findMatches.length;
  scrollTaToMatch(_findMatches[_findIndex], editModalTa.dataset.highlightKeyword);
  updateFindLabel();
});

editModalFindPrev.addEventListener("click", () => {
  if (!_findMatches.length) return;
  _findIndex = (_findIndex - 1 + _findMatches.length) % _findMatches.length;
  scrollTaToMatch(_findMatches[_findIndex], editModalTa.dataset.highlightKeyword);
  updateFindLabel();
});

function buildChecklistPanel(content, sectionTitle, file) {
  editModalChecklist.innerHTML = "";
  if (file !== "loops.md") { editModalChecklist.classList.add("hidden"); return; }

  const lines = content.split("\n");
  const items = [];
  let inNextSteps = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^###\s+Next Steps/i.test(line)) { inNextSteps = true; continue; }
    if (/^###/.test(line)) { inNextSteps = false; continue; }
    const cm = line.match(/^[-–]\s+(\[[ x]\])\s+(.+)/i);
    if (cm) {
      items.push({ lineText: line, label: cm[2].trim(), checked: cm[1].toLowerCase() === "[x]", isLegacy: false });
      continue;
    }
    if (inNextSteps && /^[-–]\s+\S/.test(line) && !/^[-–]\s+\w+:/i.test(line)) {
      items.push({ lineText: line, label: line.replace(/^[-–]\s+/, "").trim(), checked: false, isLegacy: true });
    }
  }

  if (!items.length) { editModalChecklist.classList.add("hidden"); return; }
  editModalChecklist.classList.remove("hidden");

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "checklist-item" + (item.checked ? " done" : "");
    const box = document.createElement("span");
    box.className = "checklist-box";
    box.textContent = item.checked ? "✓" : "";
    const lbl = document.createElement("span");
    lbl.className = "checklist-label";
    lbl.textContent = item.label;
    row.appendChild(box);
    row.appendChild(lbl);

    row.addEventListener("click", async () => {
      if (row.dataset.busy || editModalChecklist.dataset.panelBusy) return;
      editModalChecklist.dataset.panelBusy = "1"; // panel-level lock prevents racing taps
      row.dataset.busy = "1";
      row.classList.add("saving");

      const prevChecked = item.checked;
      const prevLine = item.lineText;
      const prevLegacy = item.isLegacy;
      const newLine = prevLegacy
        ? "– [x] " + item.label
        : prevChecked
          ? prevLine.replace(/\[x\]/i, "[ ]")
          : prevLine.replace("[ ]", "[x]");

      // Optimistic update
      item.checked = prevLegacy ? true : !prevChecked;
      item.isLegacy = false;
      item.lineText = newLine;
      row.className = "checklist-item" + (item.checked ? " done" : "") + " saving";
      box.textContent = item.checked ? "✓" : "";

      try {
        const res = await api("/patchMemoryFile", "POST", {
          filename: file,
          section: sectionTitle,
          ops: [{ op: "replace-bullet", old: prevLine, new: newLine }],
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Update failed");

        // Update textarea in-place so unsaved edits are preserved
        editModalTa.value = editModalTa.value.replace(prevLine, newLine);
        editModalTa.dataset.originalContent = editModalTa.dataset.originalContent.replace(prevLine, newLine);
        editModalTa.dataset.openHash = await _sha256Hex(editModalTa.value);
      } catch (err) {
        // Revert
        item.checked = prevChecked;
        item.isLegacy = prevLegacy;
        item.lineText = prevLine;
        row.className = "checklist-item" + (prevChecked ? " done" : "");
        box.textContent = prevChecked ? "✓" : "";
        showToast("Couldn't update: " + err.message);
      }
      row.classList.remove("saving");
      delete row.dataset.busy;
      delete editModalChecklist.dataset.panelBusy;
    });

    editModalChecklist.appendChild(row);
  }
}

// ---- Photo strip (edit modal) ----

const photoStripEl = document.getElementById("edit-modal-photo-strip");
const photoLightbox = document.getElementById("photo-lightbox");
const photoLightboxImg = document.getElementById("photo-lightbox-img");
const photoLightboxPrev = document.getElementById("photo-lightbox-prev");
const photoLightboxNext = document.getElementById("photo-lightbox-next");
let _lightboxFilenames = [];
let _lightboxIndex = 0;
let _lightboxObjectUrls = {};  // cache: filename → objectUrl string
let _photoFetchInFlight = {}; // in-flight promise dedupe: filename → Promise<string>

async function fetchPhotoObjectUrl(filename) {
  if (_lightboxObjectUrls[filename]) return _lightboxObjectUrls[filename];
  if (_photoFetchInFlight[filename]) return _photoFetchInFlight[filename];
  const p = (async () => {
    try {
      const r = await api("/photo/" + encodeURIComponent(filename) + "?_t=" + Date.now(), "GET");
      if (!r.ok) return "";
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      _lightboxObjectUrls[filename] = url;
      return url;
    } catch { return ""; }
    finally { delete _photoFetchInFlight[filename]; }
  })();
  _photoFetchInFlight[filename] = p;
  return p;
}

function openLightbox(filenames, index) {
  _lightboxFilenames = filenames;
  _lightboxIndex = index;
  fetchPhotoObjectUrl(filenames[index]).then(url => { if (url) photoLightboxImg.src = url; });
  photoLightboxPrev.classList.toggle("hidden", filenames.length <= 1);
  photoLightboxNext.classList.toggle("hidden", filenames.length <= 1);
  photoLightbox.classList.remove("hidden");
}

function closeLightbox() {
  photoLightbox.classList.add("hidden");
  photoLightboxImg.src = "";
  // Do NOT revoke URLs here — the photo strip (also inside the edit modal) is
  // still open and shares the same _lightboxObjectUrls cache. Revocation happens
  // in closeEditModal() when the edit modal is fully dismissed.
}

function closeEditModal() {
  editModal.classList.add("hidden");
  currentEditTarget = null;
  for (const url of Object.values(_lightboxObjectUrls)) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  _lightboxObjectUrls = {};
}

document.getElementById("photo-lightbox").addEventListener("click", e => {
  if (e.target === photoLightbox || e.target.classList.contains("photo-lightbox-backdrop")) closeLightbox();
});

photoLightboxPrev.addEventListener("click", e => {
  e.stopPropagation();
  _lightboxIndex = (_lightboxIndex - 1 + _lightboxFilenames.length) % _lightboxFilenames.length;
  fetchPhotoObjectUrl(_lightboxFilenames[_lightboxIndex]).then(url => { if (url) photoLightboxImg.src = url; });
});

photoLightboxNext.addEventListener("click", e => {
  e.stopPropagation();
  _lightboxIndex = (_lightboxIndex + 1) % _lightboxFilenames.length;
  fetchPhotoObjectUrl(_lightboxFilenames[_lightboxIndex]).then(url => { if (url) photoLightboxImg.src = url; });
});

// Tap on image closes lightbox
photoLightboxImg.addEventListener("click", closeLightbox);

// Keyboard: Escape closes, arrows navigate
document.addEventListener("keydown", e => {
  if (photoLightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") { closeLightbox(); return; }
  if (e.key === "ArrowLeft" && _lightboxFilenames.length > 1) {
    _lightboxIndex = (_lightboxIndex - 1 + _lightboxFilenames.length) % _lightboxFilenames.length;
    const snapIdx = _lightboxIndex;
    fetchPhotoObjectUrl(_lightboxFilenames[snapIdx]).then(url => { if (url && _lightboxIndex === snapIdx) photoLightboxImg.src = url; });
  }
  if (e.key === "ArrowRight" && _lightboxFilenames.length > 1) {
    _lightboxIndex = (_lightboxIndex + 1) % _lightboxFilenames.length;
    const snapIdx = _lightboxIndex;
    fetchPhotoObjectUrl(_lightboxFilenames[snapIdx]).then(url => { if (url && _lightboxIndex === snapIdx) photoLightboxImg.src = url; });
  }
});

function makePhotoThumb(filename, photoLine, file, section) {
  const wrap = document.createElement("div");
  wrap.className = "photo-thumb-wrap";

  const img = document.createElement("img");
  img.alt = filename;
  img.loading = "lazy";
  fetchPhotoObjectUrl(filename).then(url => { if (url) img.src = url; });
  wrap.appendChild(img);

  const delBtn = document.createElement("button");
  delBtn.className = "photo-thumb-delete";
  delBtn.textContent = "✕";
  delBtn.title = "Delete photo";
  delBtn.addEventListener("click", async e => {
    e.stopPropagation();
    if (delBtn.dataset.busy) return;
    delBtn.dataset.busy = "1";
    try {
      // KV patch first — if this fails, the R2 binary is still intact (recoverable)
      const pr = await api("/patchMemoryFile", "POST", {
        filename: file,
        section: section,
        ops: [{ op: "delete-bullet", text: photoLine }],
        ...(editModalTa.dataset.openHash ? { sectionHash: editModalTa.dataset.openHash } : {}),
      });
      const pd = await pr.json();
      if (!pd.ok) throw new Error(pd.error || "Could not remove photo reference");
      // R2 delete after KV patch succeeds — a stranded orphan is recoverable via /audit deep;
      // a deleted binary with the ref intact leaves a permanently broken thumbnail.
      const dr = await api("/deletePhoto", "POST", { filename });
      const dd = await dr.json();
      if (!dd.ok && dd.error !== "not_found") {
        showToast(`Photo reference removed but R2 delete failed (${dd.error}). Run /audit deep to clean up.`);
      }
      // Remove the photo line from the textarea using the exact matched text (handles both – and -)
      const linePattern = photoLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const newContent = editModalTa.value
        .replace(new RegExp(linePattern + "\\n"), "")
        .replace(new RegExp(linePattern), "");
      editModalTa.value = newContent;
      editModalTa.dataset.originalContent = editModalTa.dataset.originalContent
        .replace(new RegExp(linePattern + "\\n"), "")
        .replace(new RegExp(linePattern), "");
      // Fetch the section fresh so openHash matches what KV actually wrote
      try {
        const fr = await api(`/getMemoryFile?filename=${encodeURIComponent(file)}&section=${encodeURIComponent(section)}`, "GET");
        const freshContent = fr.ok ? await fr.text() : newContent;
        editModalTa.dataset.openHash = await _sha256Hex(freshContent);
      } catch {
        editModalTa.dataset.openHash = await _sha256Hex(newContent);
      }
      // Revoke cached objectUrl for this photo
      if (_lightboxObjectUrls[filename]) {
        try { URL.revokeObjectURL(_lightboxObjectUrls[filename]); } catch {}
        delete _lightboxObjectUrls[filename];
      }
      // Keep the inline-chip cache in sync for whichever record this was
      setRecordPhotos(file, section, [...newContent.matchAll(/[–-] Photo: (.+)/g)].map(m => m[1].trim()));
      renderPhotoStrip(file, newContent, section);
    } catch (err) {
      showToast(t("toast.photo-delete-failed", { error: err.message }));
    }
    delete delBtn.dataset.busy;
  });
  wrap.appendChild(delBtn);

  return wrap;
}

function renderPhotoStrip(file, content, section) {
  photoStripEl.innerHTML = "";
  photoStripEl.classList.remove("hidden");
  // Capture both the filename and the exact line text so delete-bullet sends the right dash char
  const photoMatches = [...content.matchAll(/^([–-] Photo: (.+))$/gm)];
  const photoLines = photoMatches.map(m => ({ filename: m[2].trim(), line: m[1].trim() }));

  const addTile = document.createElement("div");
  addTile.className = "photo-add-tile";
  addTile.title = t("photo.strip.add");
  addTile.textContent = photoLines.length === 0 ? `📎 ${t("photo.strip.add")}` : "+";
  addTile.addEventListener("click", () => {
    if (photoStripEl.dataset.photoStripBusy) return;
    const input = document.getElementById("edit-modal-photo-input");
    input.dataset.targetFile = file;
    input.dataset.targetSection = section;
    input.value = ""; // reset so the same file can be re-picked
    input.click();
  });

  if (photoLines.length === 0) {
    photoStripEl.appendChild(addTile);
  } else {
    const label = document.createElement("div");
    label.className = "photo-strip-label";
    label.textContent = t("photo.strip.label", { n: photoLines.length });
    photoStripEl.appendChild(label);
    const row = document.createElement("div");
    row.className = "photo-strip-row";
    const filenames = photoLines.map(p => p.filename);
    for (let i = 0; i < photoLines.length; i++) {
      const thumb = makePhotoThumb(photoLines[i].filename, photoLines[i].line, file, section);
      thumb.addEventListener("click", () => openLightbox(filenames, i));
      row.appendChild(thumb);
    }
    row.appendChild(addTile);
    photoStripEl.appendChild(row);
  }
}

// Insert a "– Photo: <filename>" line into a section's ### Photos block,
// creating the block if it doesn't exist yet.
function _applyPhotoLine(text, photoLine) {
  const photosHeadingRe = /^### Photos\s*$/m;
  if (photosHeadingRe.test(text)) {
    // Append after the last existing – Photo: line (matches worker's append-lines behavior)
    const lines = text.split("\n");
    let lastPhotoIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^[–-] Photo: /.test(lines[i])) lastPhotoIdx = i;
    }
    if (lastPhotoIdx >= 0) {
      lines.splice(lastPhotoIdx + 1, 0, photoLine);
      return lines.join("\n");
    }
    return text.replace(photosHeadingRe, m => m + "\n" + photoLine);
  } else {
    return text.trimEnd() + "\n### Photos\n" + photoLine + "\n";
  }
}

document.getElementById("edit-modal-photo-input").addEventListener("change", async function () {
  const file = this.files[0];
  if (!file) return;
  const targetFile = this.dataset.targetFile;
  const targetSection = this.dataset.targetSection;
  const strip = document.getElementById("edit-modal-photo-strip");

  // Reject non-images (accept includes pdf/text to force the Camera action sheet on Android)
  if (!file.type.startsWith("image/")) {
    showToast("Please select an image file.");
    return;
  }
  // HEIC passes the image/ check but isn't a supported format
  if (file.type === "image/heic" || file.type === "image/heif") {
    showToast("HEIC photos aren't supported — retake as JPEG or convert first.");
    return;
  }

  // Client-side size guard (worker caps at ~15 MB binary, catch it early)
  if (file.size > 10 * 1024 * 1024) {
    showToast("Photo too large — maximum 10 MB.");
    return;
  }

  // Derive a proposed filename: prefix-slug-1.ext
  // Use MIME type for the extension — file.name may say .heic even when iOS
  // auto-converted to JPEG, which would fail the server's pattern check.
  const _mimeToExt = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const _nameExt = (file.name.split(".").pop() || "").toLowerCase().replace("jpeg", "jpg");
  const ext = _mimeToExt[file.type] || (["jpg","png","webp","gif"].includes(_nameExt) ? _nameExt : "jpg");
  // Use .includes() so archived tiers (e.g. archive_people.md) get the right prefix
  const prefix = targetFile.includes("people") ? "person"
    : targetFile.includes("reflection") ? "reflection"
    : targetFile.includes("fragment") ? "fragment"
    : "loop";
  const slug = (targetSection
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")) || "record"; // fallback for non-Latin names
  const proposedFilename = `${prefix}-${slug}-1.${ext}`;

  // Prevent concurrent uploads
  if (strip.dataset.photoStripBusy) return;
  strip.dataset.photoStripBusy = "1";

  // Spinner placeholder — insert before the "+" add tile inside the thumb row (or strip if empty)
  const spinner = document.createElement("div");
  spinner.className = "photo-thumb-loading";
  spinner.textContent = "⏳";
  const thumbRow = strip.querySelector(".photo-strip-row") || strip;
  thumbRow.insertBefore(spinner, thumbRow.lastChild);

  try {
    // Read file as base64
    const imageBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Upload to R2
    const upRes = await api("/uploadPhoto", "POST", {
      filename: proposedFilename,
      imageBase64,
      mimeType: file.type || "image/jpeg",
    });
    const upData = await upRes.json();
    if (!upData.ok) {
      showToast(upData.error === "r2_not_configured"
        ? "Photo storage (R2) is not configured on your worker."
        : "Upload failed: " + (upData.error || "unknown error"));
      spinner.remove();
      return;
    }
    const confirmedFilename = upData.filename || proposedFilename;

    // Add "– Photo: filename" to section in KV via append-lines
    // Pass sectionHash so concurrent edits from another device still trigger a 409
    const patchRes = await api("/patchMemoryFile", "POST", {
      filename: targetFile,
      section: targetSection,
      ops: [{ op: "append-lines", subsection: "Photos", lines: `– Photo: ${confirmedFilename}` }],
      ...(editModalTa.dataset.openHash ? { sectionHash: editModalTa.dataset.openHash } : {}),
    });
    const patchData = await patchRes.json();
    if (!patchData.ok) {
      showToast("Could not save photo reference: " + (patchData.error || "unknown error"));
      // R2 upload succeeded but KV write failed — remove the orphaned object
      await api("/deletePhoto", "POST", { filename: confirmedFilename }).catch(() => {});
      spinner.remove();
      return;
    }

    // In-place update of textarea and originalContent so Save doesn't clobber the new line
    const photoLine = `– Photo: ${confirmedFilename}`;
    const newVal = _applyPhotoLine(editModalTa.value, photoLine);
    editModalTa.value = newVal;
    editModalTa.dataset.originalContent = _applyPhotoLine(editModalTa.dataset.originalContent, photoLine);

    // Refresh openHash against what KV actually wrote (same pattern as photo delete fix)
    try {
      const fr = await api(`/getMemoryFile?filename=${encodeURIComponent(targetFile)}&section=${encodeURIComponent(targetSection)}`, "GET");
      const freshContent = fr.ok ? await fr.text() : newVal;
      editModalTa.dataset.openHash = await _sha256Hex(freshContent);
    } catch {
      editModalTa.dataset.openHash = await _sha256Hex(newVal);
    }

    // Keep the inline-chip cache in sync for whichever record this was
    addRecordPhoto(targetFile, targetSection, confirmedFilename);

    // Re-render the strip with the new thumbnail
    spinner.remove();
    renderPhotoStrip(targetFile, newVal, targetSection);

  } catch (err) {
    showToast("Photo attach failed: " + err.message);
    spinner.remove();
  } finally {
    delete strip.dataset.photoStripBusy;
  }
});

async function showEditModal(sectionTitle, file, content, keyword, occurrenceIndex = null) {
  // Set the delete-target every time the modal opens — every entry path
  // (runEditSection, /browse click, audit Open button) flows through here.
  currentEditTarget = { filename: file, section: sectionTitle, occurrenceIndex };
  editModalSectionName.textContent = `${file.replace(".md", "").toUpperCase()} › ${sectionTitle}`;
  const tier = file.startsWith("deeparchive_") ? "cold" : file.startsWith("archive_") ? "archive" : "active";
  editModalTierBadge.textContent = tier === "cold" ? "Cold Storage" : tier === "archive" ? "Archive" : "Active";
  editModalTierBadge.className = `edit-modal-tier-badge tier-${tier}`;
  editModalTa.value = content;
  editModalTa.dataset.originalContent = content;
  // Section hash captured at MODAL-OPEN time, not at save time. Save-time
  // hashing would defeat the purpose (we'd hash whatever the file currently
  // is, which may already include another tab's write). This hash is the
  // baseline against which the worker checks "did this section change
  // since the user started looking at it?"
  editModalTa.dataset.openHash = await _sha256Hex(content);
  editModalTa.rows = Math.max(10, content.split("\n").length + 2);
  editModalTa.dataset.file = file;
  editModalTa.dataset.section = sectionTitle;
  editModalTa.dataset.highlightKeyword = keyword || "";
  buildChecklistPanel(content, sectionTitle, file);
  renderPhotoStrip(file, content, sectionTitle);
  resetTierButtons(tier);
  editModalTa.style.background = "";
  editModalTa.classList.remove("compact-ta-error");
  editModalError.classList.remove("visible");
  editModalError.textContent = "";
  // Set up find bar
  if (keyword) {
    _findMatches = findAllMatches(content, keyword);
    _findIndex = 0;
    updateFindLabel();
    editModalFindbar.classList.remove("hidden");
  } else {
    _findMatches = [];
    editModalFindbar.classList.add("hidden");
  }
  editModal.classList.remove("hidden");
  setTimeout(() => {
    const modalBody = editModal.querySelector(".edit-modal-body");
    if (modalBody) modalBody.scrollTop = 0;
    if (keyword && _findMatches.length) {
      // Keyword search: focus and scroll to the first match
      editModalTa.focus();
      scrollTaToMatch(_findMatches[0], keyword);
    }
    // No unconditional focus — on mobile this pops the keyboard immediately,
    // pushing the photo strip and checklist out of view before the user can see them.
  }, 50);
}



editModalClose.addEventListener("click", () => { closeEditModal(); });
editModalCancel.addEventListener("click", () => { closeEditModal(); });
editModalDelete.addEventListener("click", () => {
  if (!currentEditTarget) return;
  const target = currentEditTarget; // capture before closeEditModal clears it
  closeEditModal();
  showDeleteModal(target.filename, target.section, null, false, target.occurrenceIndex);
});
editModalTa.addEventListener("input", () => {
  editModalTa.classList.remove("compact-ta-error");
  editModalError.classList.remove("visible");
  // Keep find bar match count in sync as content changes
  const kw = editModalTa.dataset.highlightKeyword;
  if (kw) {
    _findMatches = findAllMatches(editModalTa.value, kw);
    _findIndex = Math.min(_findIndex, Math.max(0, _findMatches.length - 1));
    updateFindLabel();
  }
});
editModalSave.addEventListener("click", async () => {
  const compactedText = editModalTa.value.trim();
  const sectionTitle = editModalTa.dataset.section;
  const filename = editModalTa.dataset.file;
  const error = validateCompactEdit(compactedText, sectionTitle, null, /* allowHeaderChange */ true);
  if (error) {
    editModalTa.classList.add("compact-ta-error");
    editModalError.textContent = error;
    editModalError.classList.add("visible");
    return;
  }
  editModalSave.disabled = true;
  editModalSave.textContent = "Saving...";
  try {
    const sectionHash = editModalTa.dataset.openHash || "";
    const occIdx = currentEditTarget?.occurrenceIndex;
    const res = await api("/replaceSection", "POST", { filename, sectionTitle, compactedText, ...(sectionHash ? { sectionHash } : {}), ...(typeof occIdx === "number" ? { occurrenceIndex: occIdx } : {}) });
    const data = await res.json();
    // Optimistic-concurrency conflict path. Banner shows reload-and-retry;
    // on Reload we re-fetch the section and refresh the editor so the user
    // sees the other tab's writes and can retry.
    if (await handleConflict(res, data, {
      container: editModal.querySelector(".edit-modal-inner") || editModal,
      onReload: async () => {
        try {
          const r = await api(`/getMemoryFile?filename=${encodeURIComponent(filename)}&section=${encodeURIComponent(sectionTitle)}`, "GET");
          if (!r.ok) { editModalError.textContent = "Reload failed."; editModalError.classList.add("visible"); return; }
          const fresh = await r.text();
          editModalTa.value = fresh;
          editModalTa.dataset.originalContent = fresh;
          editModalTa.dataset.openHash = await _sha256Hex(fresh);
          editModalTa.classList.remove("compact-ta-error");
          editModalError.classList.remove("visible");
        } catch (e) {
          editModalError.textContent = `Reload failed: ${e.message}`;
          editModalError.classList.add("visible");
        }
      },
    })) {
      editModalSave.disabled = false;
      editModalSave.textContent = "Save";
      return;
    }
    if (data.ok) {
      closeEditModal();
      appendMessage("system", `"${sectionTitle}" saved.`);
    } else {
      editModalTa.classList.add("compact-ta-error");
      editModalError.textContent = data.error || "Save failed.";
      editModalError.classList.add("visible");
    }
  } catch (err) {
    editModalError.textContent = err.message;
    editModalError.classList.add("visible");
  } finally {
    editModalSave.disabled = false;
    editModalSave.textContent = "Save";
  }
});

// ---- Edit Modal tier-move buttons ----
const TIER_BTN_CONFIGS = {
  active:  [{ target: "archive", label: "→ Archive" }, { target: "cold",    label: "→ Cold"    }],
  archive: [{ target: "active",  label: "→ Active"  }, { target: "cold",    label: "→ Cold"    }],
  cold:    [{ target: "active",  label: "→ Active"  }, { target: "archive", label: "→ Archive" }],
};
const TIER_LABELS = { active: "Active", archive: "Archive", cold: "Cold Storage" };

function resetTierButtons(tier) {
  _tierMovePending = null;
  editModalMoveBtn1.classList.remove("active");
  editModalMoveBtn2.classList.remove("active");
  editModalConfirmStrip.classList.add("hidden");
  editModalConfirmMove.disabled = false;
  if (!tier) {
    const f = editModalTa.dataset.file || "";
    tier = f.startsWith("deeparchive_") ? "cold" : f.startsWith("archive_") ? "archive" : "active";
  }
  const [c1, c2] = TIER_BTN_CONFIGS[tier] || TIER_BTN_CONFIGS.active;
  editModalMoveBtn1.textContent = c1.label;
  editModalMoveBtn1.dataset.target = c1.target;
  editModalMoveBtn2.textContent = c2.label;
  editModalMoveBtn2.dataset.target = c2.target;
  editModalMoveBtn1.disabled = false;
  editModalMoveBtn2.disabled = false;
  // Show ✓ Close Loop / ↩ Reopen based on loop status
  const file = editModalTa.dataset.file || "";
  const isLoop = file === "loops.md";
  const content = editModalTa.value || "";
  const alreadyClosed = /^[-–]\s+Status:\s*(Closed|Resolved)/im.test(content);
  editModalCloseLoopBtn.classList.toggle("hidden", !isLoop || alreadyClosed);
  editModalReopenBtn.classList.toggle("hidden", !isLoop || !alreadyClosed);
}

editModalCloseLoopBtn.addEventListener("click", async () => {
  const file = editModalTa.dataset.file || "";
  const section = editModalTa.dataset.section || "";
  if (!file || !section) return;
  editModalCloseLoopBtn.disabled = true;
  editModalCloseLoopBtn.textContent = "Closing…";
  try {
    const today = new Date().toLocaleDateString("en-CA");
    const res = await api("/patchMemoryFile", "POST", {
      filename: file,
      section,
      ops: [
        { op: "set-field", field: "Status", value: "Closed" },
        { op: "set-field", field: "Closed", value: today },
      ],
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Close failed");
    showToast("Loop closed ✓");
    editModalCloseLoopBtn.classList.add("hidden");
    // Refresh textarea + openHash + originalContent so subsequent Save/Archive don't 409
    const updated = await api(`/getMemoryFile?filename=${encodeURIComponent(file)}&section=${encodeURIComponent(section)}`, "GET");
    if (updated.ok) {
      const fresh = await updated.text();
      editModalTa.value = fresh;
      editModalTa.dataset.originalContent = fresh;
      editModalTa.dataset.openHash = await _sha256Hex(fresh);
      resetTierButtons();
    }
  } catch (err) {
    showToast(`Couldn't close: ${err.message}`);
  } finally {
    editModalCloseLoopBtn.disabled = false;
    editModalCloseLoopBtn.textContent = "✓ Close Loop";
  }
});

editModalReopenBtn.addEventListener("click", async () => {
  const file = editModalTa.dataset.file || "";
  const section = editModalTa.dataset.section || "";
  if (!file || !section) return;
  editModalReopenBtn.disabled = true;
  editModalReopenBtn.textContent = "Reopening…";
  try {
    const res = await api("/patchMemoryFile", "POST", {
      filename: file,
      section,
      ops: [
        { op: "set-field", field: "Status", value: "Open" },
        { op: "delete-bullet", text: (editModalTa.value.match(/^[-–]\s+Closed:\s*.+$/m) || [""])[0].trim() },
      ].filter(op => op.op !== "delete-bullet" || op.text),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Reopen failed");
    const fresh = await api(`/getMemoryFile?filename=${encodeURIComponent(file)}&section=${encodeURIComponent(section)}`, "GET");
    if (fresh.ok) {
      const updated = await fresh.text();
      editModalTa.value = updated;
      editModalTa.dataset.originalContent = updated;
      editModalTa.dataset.openHash = await _sha256Hex(updated);
      buildChecklistPanel(updated, section, file);
      resetTierButtons();
    }
    showToast("Loop reopened");
  } catch (err) {
    showToast(`Couldn't reopen: ${err.message}`);
  } finally {
    editModalReopenBtn.disabled = false;
    editModalReopenBtn.textContent = "↩ Reopen";
  }
});

function onTierMoveBtnClick(btn) {
  const target = btn.dataset.target;
  editModalMoveBtn1.classList.remove("active");
  editModalMoveBtn2.classList.remove("active");
  btn.classList.add("active");
  _tierMovePending = target;
  editModalConfirmLabel.textContent = `Move to ${TIER_LABELS[target]}?`;
  editModalConfirmStrip.classList.remove("hidden");
  // On a small screen the strip can appear below the fold of the modal — scroll
  // it into view so the user knows the tap registered and Move/Cancel are next.
  editModalConfirmStrip.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function handleTierMove(targetTier) {
  const file    = editModalTa.dataset.file;
  const section = editModalTa.dataset.section;
  const isDirty = editModalTa.value.trim() !== (editModalTa.dataset.originalContent || "").trim();

  editModalMoveBtn1.disabled = true;
  editModalMoveBtn2.disabled = true;
  editModalConfirmMove.disabled = true;
  editModalSave.disabled = true;
  editModalError.classList.remove("visible");

  try {
    if (isDirty) {
      const err = validateCompactEdit(editModalTa.value.trim(), section, null, /* allowHeaderChange */ true);
      if (err) {
        editModalTa.classList.add("compact-ta-error");
        editModalError.textContent = err;
        editModalError.classList.add("visible");
        return;
      }
      const tierMoveHash = editModalTa.dataset.openHash || "";
      const tierOccIdx = currentEditTarget?.occurrenceIndex;
      const saveRes = await api("/replaceSection", "POST", { filename: file, sectionTitle: section, compactedText: editModalTa.value.trim(), ...(tierMoveHash ? { sectionHash: tierMoveHash } : {}), ...(typeof tierOccIdx === "number" ? { occurrenceIndex: tierOccIdx } : {}) });
      const saveData = await saveRes.json();
      if (await handleConflict(saveRes, saveData, {
        container: editModal.querySelector(".edit-modal-inner") || editModal,
        onReload: async () => {
          try {
            const r = await api(`/getMemoryFile?filename=${encodeURIComponent(file)}&section=${encodeURIComponent(section)}`, "GET");
            if (!r.ok) { editModalError.textContent = "Reload failed."; editModalError.classList.add("visible"); return; }
            const fresh = await r.text();
            editModalTa.value = fresh;
            editModalTa.dataset.originalContent = fresh;
            editModalTa.dataset.openHash = await _sha256Hex(fresh);
            editModalTa.classList.remove("compact-ta-error");
            editModalError.classList.remove("visible");
          } catch (e) {
            editModalError.textContent = `Reload failed: ${e.message}`;
            editModalError.classList.add("visible");
          }
        },
      })) {
        editModalMoveBtn1.disabled = false;
        editModalMoveBtn2.disabled = false;
        editModalConfirmMove.disabled = false;
        editModalSave.disabled = false;
        return;
      }
      if (!saveData.ok) {
        editModalTa.classList.add("compact-ta-error");
        editModalError.textContent = saveData.error || "Save failed before move.";
        editModalError.classList.add("visible");
        return;
      }
      // Refresh openHash after save so the following tier-move passes the
      // hash of the just-saved content (worker normalizes CRLF + trims, so
      // we mirror that to compute the expected post-save hash).
      editModalTa.dataset.openHash = await _sha256Hex(editModalTa.value.replace(/\r\n/g, "\n").trim());
    }

    const currentTier = file.startsWith("deeparchive_") ? "cold" : file.startsWith("archive_") ? "archive" : "active";
    let moveOk = false, moveError = "Move failed.";
    let moveData = null;
    let moveRes = null;
    // sectionHash for optimistic concurrency on the source side. Always available
    // here because the edit modal sets openHash on open and refreshes it on save.
    const moveSectionHash = editModalTa.dataset.openHash || "";

    if (currentTier === "active" && targetTier === "archive") {
      moveRes = await api("/moveToArchive", "POST", { moves: [{ sourceFile: file, sectionTitle: section, ...(moveSectionHash ? { sectionHash: moveSectionHash } : {}) }] });
      moveData = await moveRes.json();
      moveOk = moveData.results?.[0]?.ok;
      moveError = moveData.results?.[0]?.error || moveError;
    } else if ((currentTier === "active" || currentTier === "archive") && targetTier === "cold") {
      moveRes = await api("/moveToDeep", "POST", { moves: [{ sourceFile: file, sectionTitle: section, ...(moveSectionHash ? { sectionHash: moveSectionHash } : {}) }] });
      moveData = await moveRes.json();
      moveOk = moveData.results?.[0]?.ok;
      moveError = moveData.results?.[0]?.error || moveError;
    } else if (currentTier === "archive" && targetTier === "active") {
      moveRes = await api("/restoreFromArchive", "POST", { filename: file, section, ...(moveSectionHash ? { sectionHash: moveSectionHash } : {}) });
      moveData = await moveRes.json();
      moveOk = moveData.ok;
      moveError = moveData.error || moveError;
    } else if (currentTier === "cold" && targetTier === "active") {
      moveRes = await api("/restoreFromDeep", "POST", { filename: file, section, toArchive: false, ...(moveSectionHash ? { sectionHash: moveSectionHash } : {}) });
      moveData = await moveRes.json();
      moveOk = moveData.ok;
      moveError = moveData.error || moveError;
    } else if (currentTier === "cold" && targetTier === "archive") {
      moveRes = await api("/restoreFromDeep", "POST", { filename: file, section, toArchive: true, ...(moveSectionHash ? { sectionHash: moveSectionHash } : {}) });
      moveData = await moveRes.json();
      moveOk = moveData.ok;
      moveError = moveData.error || moveError;
    } else {
      moveError = "Unsupported tier transition.";
    }

    if (moveOk) {
      closeEditModal();
      appendMessage("system", `"${section}" moved to ${TIER_LABELS[targetTier]}.`);
    } else if (moveRes && moveData && await handleConflict(moveRes, moveData, {
      container: editModal.querySelector(".edit-modal-inner") || editModal,
      onReload: async () => {
        try {
          const r = await api(`/getMemoryFile?filename=${encodeURIComponent(file)}&section=${encodeURIComponent(section)}`, "GET");
          if (!r.ok) { editModalError.textContent = "Reload failed."; editModalError.classList.add("visible"); return; }
          const fresh = await r.text();
          editModalTa.value = fresh;
          editModalTa.dataset.originalContent = fresh;
          editModalTa.dataset.openHash = await _sha256Hex(fresh);
          editModalTa.classList.remove("compact-ta-error");
          editModalError.classList.remove("visible");
        } catch (e) {
          editModalError.textContent = `Reload failed: ${e.message}`;
          editModalError.classList.add("visible");
        }
      },
    })) {
      // Conflict banner is shown; reload button is in user's hands. Don't surface
      // a duplicate inline error message.
    } else {
      editModalError.textContent = moveError;
      editModalError.classList.add("visible");
    }
  } catch (err) {
    editModalError.textContent = err.message || "Move failed.";
    editModalError.classList.add("visible");
  } finally {
    editModalSave.disabled = false;
    resetTierButtons();
  }
}

editModalMoveBtn1.addEventListener("click", () => onTierMoveBtnClick(editModalMoveBtn1));
editModalMoveBtn2.addEventListener("click", () => onTierMoveBtnClick(editModalMoveBtn2));
editModalConfirmCancel.addEventListener("click", () => resetTierButtons());
editModalConfirmMove.addEventListener("click", () => {
  if (_tierMovePending) handleTierMove(_tierMovePending);
});

// ---- Conversation Mode ----
// ---- Conversation Mode Entry ----
// Short tap  (<800ms): open overlay + start listening immediately
// Long press (≥800ms): open overlay + journal mode idle ("Hold to record")
// Restored journal session (journalDictating): just open, no new cycle
// Re-entry while already in conv mode: un-minimize only
//
// The overlay does NOT open at pointerdown — opening early causes users to
// see the overlay and release before 800ms, making journal mode unreachable.
// The AudioContext IS created at pointerdown (iOS needs the gesture context).
let convBtnJournalTimer = null;

convBtn.addEventListener("pointerdown", e => {
  if (!hasSpeechRecognition() && !useWhisper()) return;
  e.preventDefault();
  try { convBtn.setPointerCapture(e.pointerId); } catch {}

  if (convMode) {
    // Re-entry — just un-minimize; no timer needed
    convOverlay.classList.remove("hidden");
    convOverlay.classList.remove("conv-overlay--minimized");
    return;
  }

  // Create/bless AudioContext NOW in the gesture — iOS requires this even
  // though the overlay doesn't open until pointerup or the 800ms timer.
  if (!thinkingAudioCtx || thinkingAudioCtx.state === 'closed') {
    try { thinkingAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (thinkingAudioCtx && thinkingAudioCtx.state === 'suspended') {
    thinkingAudioCtx.resume().catch(() => {});
  }

  // On iOS: pre-acquire the mic stream right now, in this gesture (pointerdown).
  // iOS Safari does NOT reliably trigger the permission dialog from pointerup,
  // so the first getUserMedia call must happen here. The stream is stored in
  // _iosMicPreAcquire and consumed by startWhisperPTT() on pointerup.
  if (isIOS() && !convMode) {
    _iosMicPreAcquire = navigator.mediaDevices.getUserMedia({ audio: true });
    _iosMicPreAcquire.then(s => {
      // If resolved before startWhisperPTT runs, pre-set whisperStream so the
      // activeTracks check finds it and skips the second getUserMedia call.
      if (!whisperStream) {
        whisperStream = s;
        s.getTracks().forEach(t => {
          t.enabled = false; // paused until startWhisperPTT enables it
          t.onended = () => { if (whisperStream === s) whisperStream = null; };
        });
      } else {
        s.getTracks().forEach(t => t.stop()); // already have a stream; discard
      }
    }).catch(() => {});
  }

  convBtnJournalTimer = setTimeout(() => {
    convBtnJournalTimer = null;
    // Long press confirmed — open and go straight to journal idle.
    // enterConvMode() can decline to open (no speech support, or the one-time
    // Auto-voice privacy notice), so journal mode must not engage unless it did.
    enterConvMode();
    if (convMode && !journalDictating) setJournalMode(true);
  }, 800);
});

convBtn.addEventListener("pointerup", e => {
  e.preventDefault();
  if (convMode && !convBtnJournalTimer) return; // re-entry or long press already handled
  if (!convBtnJournalTimer) return; // nothing pending

  // Short tap — cancel journal timer, open overlay and start listening
  clearTimeout(convBtnJournalTimer);
  convBtnJournalTimer = null;

  if (document.activeElement && document.activeElement.blur) {
    try { document.activeElement.blur(); } catch {}
  }
  // Re-bless on pointerup — most trusted activation gesture on iOS
  if (thinkingAudioCtx && thinkingAudioCtx.state !== "running") {
    thinkingAudioCtx.resume().catch(() => {});
  }
  enterConvMode();
  if (!journalDictating) {
    if (useWhisper()) { orbPttActive = true; startWhisperPTT(); }
    else convListen();
  }
});

convBtn.addEventListener("pointercancel", () => {
  // pointercancel: overlay was never opened, so cancel timer and release pre-acquired stream
  if (convBtnJournalTimer) { clearTimeout(convBtnJournalTimer); convBtnJournalTimer = null; }
  const preAcquire = _iosMicPreAcquire;
  _iosMicPreAcquire = null;
  if (preAcquire) {
    preAcquire.then(s => {
      if (s && whisperStream === s && !convMode) { s.getTracks().forEach(t => t.stop()); whisperStream = null; }
    }).catch(() => {});
  }
});

convBtn.addEventListener("contextmenu", e => e.preventDefault());

// Keyboard accessibility — Tab+Enter/Space
convBtn.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  if (!convMode) {
    enterConvMode();
    if (!journalDictating) {
      if (useWhisper()) { orbPttActive = true; startWhisperPTT(); }
      else convListen();
    }
  }
});
convExit.addEventListener("click", () => {
  if (journalDictating && journalChunks.length > 0) confirmJournalExit();
  else exitConvMode();
});
convResetCtxBtn.addEventListener("click", () => {
  resetContext(true);
  showToast(t("toast.context-reset"));
});
convMuteBtn.addEventListener("click", toggleMute);

function enterConvMode() {
  if (!hasSpeechRecognition() && !useWhisper()) return;
  // First Auto-mode voice session: let the user choose where their audio goes
  // before any is captured. Returns true only when it took over this attempt.
  if (maybeShowVoicePrivacyNotice()) return;
  // Create the session AudioContext HERE, inside a real user-gesture handler.
  // iOS only unlocks AudioContexts created during user activation — gestures
  // that happen later (orb pointerdown, toggleMute) re-bless the same context.
  if (!thinkingAudioCtx || thinkingAudioCtx.state === 'closed') {
    try { thinkingAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (thinkingAudioCtx && thinkingAudioCtx.state === 'suspended') {
    thinkingAudioCtx.resume().catch(() => {});
  }
  if (typeof navigator !== 'undefined' && navigator.audioSession) {
    try { navigator.audioSession.type = 'playback'; } catch {}
  }
  convMode = true;
  convMuted = false;
  _convChimePlayed = false; // fresh session — first listen will chime once
  convMuteBtn.classList.remove("muted");
  convMuteBtn.textContent = "🎤";
  convDiscardBtn.classList.add("invisible");
  convOverlay.classList.remove("hidden");
  if (journalDictating) {
    // Restored session — re-apply journal UI
    convContent.classList.add("journal-mode");
    journalChunkListEl.classList.remove("hidden");
    journalBadge.classList.add("visible");
    convFinishBtn.classList.remove("invisible");
    convFinishBtn.disabled = journalChunks.length === 0;
    convMuteBtn.classList.add("invisible");
    convDiscardBtn.classList.remove("invisible");
    convDiscardBtn.disabled = journalChunks.length === 0;
    renderChunkList();
    setConvState("paused");
    convLabel.textContent = journalChunks.length === 0
      ? t("conv.label.hold-to-record")
      : t("conv.label.chunks-ready");
  } else {
    setConvState("idle");
    if (useWhisper()) convLabel.textContent = t("conv.label.idle");
  }
}

function clearAutoSend() {
  // no-op — kept for call-site symmetry
}

function exitConvMode() {
  clearAutoSend();
  if (convChatAbort)  { convChatAbort.abort();  convChatAbort  = null; }
  if (convSpeakAbort) { convSpeakAbort.abort(); convSpeakAbort = null; }
  whisperResultGen++;
  // Cancel in-flight /transcribe fetch so token billing stops on exit.
  if (whisperTranscribeAbort) {
    try { whisperTranscribeAbort.abort(); } catch {}
    whisperTranscribeAbort = null;
  }
  convMode = false;
  convMuted = false;
  _convChimePlayed = false; // defensive: re-arm the activation chime for the next session
  journalDictating = false;
  journalChunks = [];
  noSpeechCount = 0;
  stopThinkingSound();
  if (thinkingAudioCtx) { try { thinkingAudioCtx.close(); } catch {} thinkingAudioCtx = null; }
  stopConvAudio();
  stopConvRecognition();
  orbPttActive = false;
  if (orbPressTimer)       { clearTimeout(orbPressTimer);       orbPressTimer       = null; }
  if (orbJournalTimer)    { clearTimeout(orbJournalTimer);    orbJournalTimer     = null; }
  if (_streamIdleTimer)   { clearTimeout(_streamIdleTimer);   _streamIdleTimer    = null; }
  if (convBtnJournalTimer){ clearTimeout(convBtnJournalTimer); convBtnJournalTimer = null; }
  stopSilenceDetection(true); // recorder is being torn down — close the AudioContext
  if (whisperRecorder) {
    try { whisperRecorder.stop(); } catch {}
    whisperRecorder = null; whisperChunks = [];
  }
  if (whisperStream) {
    try { whisperStream.getTracks().forEach(t => t.stop()); } catch {}
    whisperStream = null;
  }
  convOverlay.classList.remove("conv-overlay--minimized");
  convOverlay.style.height = "";
  convContent.classList.remove("journal-mode");
  journalChunkListEl.classList.add("hidden");
  journalChunkListEl.innerHTML = "";
  journalExitDialog.classList.add("hidden");
  journalBadge.classList.remove("visible");
  convDiscardBtn.disabled = true;
  convDiscardBtn.classList.add("invisible");
  convFinishBtn.classList.add("invisible");
  convMuteBtn.classList.remove("invisible");
  convOverlay.classList.add("hidden");
  setConvState("idle");
  if (tokenSaverEnabled()) resetContext();
}

function confirmJournalExit() {
  stopConvRecognition();
  stopConvAudio();
  setConvState("paused");
  const n = journalChunks.length;
  document.querySelector(".journal-exit-msg").textContent = n === 0
    ? t("conv.exit-msg-default")
    : n === 1
    ? t("conv.exit-msg-one")
    : t("conv.exit-msg-many", { n });
  journalExitDialog.classList.remove("hidden");
}

document.getElementById("journal-exit-cancel").addEventListener("click", () => {
  journalExitDialog.classList.add("hidden");
  if (convMode && journalDictating) {
    setConvState("paused");
    convLabel.textContent = journalChunks.length === 0
      ? t("conv.label.hold-to-record")
      : journalChunks.length === 1
      ? t("conv.chunks-resume-one")
      : t("conv.chunks-resume-many", { n: journalChunks.length });
  } else if (convMode) {
    convListen();
  }
});

document.getElementById("journal-exit-confirm").addEventListener("click", () => {
  journalExitDialog.classList.add("hidden");
  clearJournalDraft();
  exitConvMode();
});

function saveJournalDraft() {
  if (!journalDictating || !journalChunks.length) return;
  try {
    sessionStorage.setItem(JOURNAL_DRAFT_KEY, JSON.stringify({ chunks: journalChunks.slice(), savedAt: Date.now() }));
  } catch { /* quota — ignore */ }
}

function clearJournalDraft() {
  sessionStorage.removeItem(JOURNAL_DRAFT_KEY);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (journalDictating) saveJournalDraft();
    // Stop listening when app backgrounds — prevents giant silent blobs being
    // sent to Whisper and keeps the recording indicator from staying lit.
    // Journal mode is excluded since the draft was saved above.
    if (convMode && whisperRecorder && !journalDictating) hardStopConv();
  }
});

// Mute is a pure mic gate — like covering the microphone with your finger.
// Future audio frames are silenced; nothing in flight is touched. Captured
// chunks continue through VAD/transcribe, in-flight /transcribe completes,
// Claude reply continues, TTS keeps playing. Only the NEXT utterance is
// blocked. See docs/conv-mode-requirements.md Rule 1.
function toggleMute() {
  convMuted = !convMuted;
  convMuteBtn.classList.toggle("muted", convMuted);
  // Re-bless the session AudioContext on every user gesture (iOS policy)
  if (thinkingAudioCtx && thinkingAudioCtx.state !== 'running') {
    thinkingAudioCtx.resume().catch(() => {});
  }
  if (useWhisper()) {
    if (!whisperStream) return;
    // Flip the WebRTC track gate.
    whisperStream.getTracks().forEach(t => { t.enabled = !convMuted; });
    // Restart the recorder on BOTH edges while actively listening in chat mode:
    // - Mute edge: discards pre-mute speech + resets VAD latch so silence timer
    //   can't auto-send the buffered audio 900ms later (the primary leak path).
    // - Unmute edge: discards accumulated silent chunks so Whisper never sees a
    //   large silent prefix; also gives a fresh WebM header for the new recording.
    // Rule 1 (revised): mute = retroactive drop of the current utterance.
    // In-flight turns whose silence timeout already elapsed are NOT cancelled —
    // that speech is "done" and bumping whisperResultGen would cancel randomly
    // based on network timing. Journal PTT is excluded (user controls stop explicitly).
    if (whisperRecorder && !journalDictating && convState === "listening") {
      restartWhisperRecorder();
    }
  } else {
    // Auto mode: restart recognition on unmute so Chrome's buffered speech
    // from while muted is discarded — deterministic drop, matches Whisper behavior.
    if (!convMuted && convState === "listening") convListen();
  }
}

// Orb interaction — PTT in journal mode, tap elsewhere
let orbPressTimer       = null;
let orbJournalTimer     = null;
let _streamIdleTimer    = null;
let orbPttActive        = false;
let orbPttHoldStart     = 0;
let orbPressedFromState = null;        // state at pointerdown — drives tap vs hard-stop in handleOrbTap (auto mode only; Whisper mode never calls handleOrbTap)
let whisperRecorder     = null;
let whisperStream       = null;   // persistent mic stream — held open across turns to avoid per-turn getUserMedia latency
let whisperChunks       = [];
let _iosMicPreAcquire   = null;   // Promise<MediaStream> — pre-acquired at pointerdown on iOS (pointerup is not trusted for getUserMedia)
let whisperResultGen    = 0;           // increment to cancel any in-flight handleWhisperResult
let convChatAbort  = null;             // AbortController for in-flight /chat fetch
let convSpeakAbort = null;             // AbortController for in-flight /speak fetch

// Hard stop: cancel everything in conv mode → paused state
function hardStopConv() {
  if (convChatAbort)  { convChatAbort.abort();  convChatAbort  = null; }
  if (convSpeakAbort) { convSpeakAbort.abort(); convSpeakAbort = null; }
  if (whisperTranscribeAbort) {
    try { whisperTranscribeAbort.abort(); } catch {}
    whisperTranscribeAbort = null;
  }
  whisperResultGen++;
  convListenGen++;  // invalidate any pending onend/onerror so recognition doesn't auto-restart
  if (orbPressTimer)   { clearTimeout(orbPressTimer);   orbPressTimer   = null; }
  if (orbJournalTimer) { clearTimeout(orbJournalTimer); orbJournalTimer = null; }
  orbPttActive = false;
  stopThinkingSound();
  stopConvAudio();
  stopConvRecognition();
  stopSilenceDetection(true); // recorder is being torn down — close the AudioContext
  if (whisperRecorder) {
    // Keep whisperStream alive — user is pausing, not exiting; stream released in exitConvMode
    try { whisperRecorder.stop(); } catch {}
    whisperRecorder = null; whisperChunks = [];
  }
  // Release the mic after 60s in paused state — keeps recording indicator from
  // staying lit indefinitely. startWhisperPTT will re-acquire if needed.
  clearTimeout(_streamIdleTimer);
  _streamIdleTimer = setTimeout(() => {
    if (convState === "paused" && whisperStream && !whisperRecorder) {
      try { whisperStream.getTracks().forEach(t => t.stop()); } catch {}
      whisperStream = null;
    }
  }, 60000);
  setConvState("paused");
}

convOrb.addEventListener("pointerdown", e => {
  e.preventDefault();
  convOrb.setPointerCapture(e.pointerId);
  orbPttHoldStart = Date.now();
  // Re-bless session AudioContext on every orb tap (iOS may have suspended it
  // during the mic-teardown between turns)
  if (thinkingAudioCtx && thinkingAudioCtx.state !== 'running') {
    thinkingAudioCtx.resume().catch(() => {});
  }
  if (useWhisper()) {
    if (journalDictating) {
      // Journal PTT — start recording on hold
      orbPttActive = true;
      startWhisperPTT();
      return;
    }
    // Any active state → hard stop → paused; start journal timer in case user holds
    if (convState !== "idle" && convState !== "paused") {
      hardStopConv();
      orbJournalTimer = setTimeout(async () => {
        orbJournalTimer = null;
        hardStopConv();
        setJournalMode(true);
        orbPttActive = true;
        await startWhisperPTT();
      }, 800);
      return;
    }
    // Paused/idle → start active listening + 800ms journal timer
    hardStopConv(); // belt & suspenders clean slate
    orbPttActive = true;
    startWhisperPTT();
    orbJournalTimer = setTimeout(async () => {
      orbJournalTimer = null;
      hardStopConv(); // discard the chat recording, stop everything
      setJournalMode(true);
      orbPttActive = true;
      await startWhisperPTT();
    }, 800);
    return;
  }
  if (journalDictating) {
    // PTT — start recording after short threshold to avoid accidental taps
    orbPressTimer = setTimeout(() => {
      orbPressTimer = null;
      orbPttActive = true;
      convPttListen();
    }, 200);
  } else {
    // Auto mode — capture state now; hard stop any active state immediately
    orbPressedFromState = convState;
    if (convState !== "idle" && convState !== "paused") hardStopConv();
    // 800ms timer for journal entry
    orbPressTimer = setTimeout(() => {
      orbPressTimer = null;
      hardStopConv(); // ensure clean slate
      setJournalMode(true);
      orbPttActive = true;
      convPttListen();
    }, 800);
  }
});

convOrb.addEventListener("pointerup", e => {
  e.preventDefault();
  if (useWhisper()) {
    if (journalDictating) {
      // Journal PTT — stop recording on release, process as chunk
      if (orbPttActive) {
        orbPttActive = false;
        if (whisperRecorder) stopWhisperRecorder().then(handleWhisperResult);
      }
      return;
    }
    // Chat mode — release before 800ms: cancel journal timer, silence detection keeps running
    if (orbJournalTimer) { clearTimeout(orbJournalTimer); orbJournalTimer = null; }
    return;
  }
  if (journalDictating) {
    if (orbPressTimer) {
      // Released before 200ms threshold — too short, ignore
      clearTimeout(orbPressTimer);
      orbPressTimer = null;
      return;
    }
    if (orbPttActive) {
      orbPttActive = false;
      if (pttRecognition) {
        convPttStop(); // triggers onend → processPttChunk
      } else {
        processPttChunk(); // recognition already stopped mid-hold
      }
    }
  } else {
    // Auto mode — short press = tap
    if (orbPressTimer) {
      clearTimeout(orbPressTimer);
      orbPressTimer = null;
      handleOrbTap();
    }
  }
});

// pointerleave removed — setPointerCapture guarantees pointerup fires even when finger drifts;
// pointerleave was firing spuriously on Android Chrome and causing mid-hold exits.

convOrb.addEventListener("contextmenu", e => e.preventDefault());

convOrb.addEventListener("pointercancel", e => {
  // Android fires pointercancel after long holds despite setPointerCapture/touch-action:none.
  if (journalDictating && orbPttActive) {
    if (useWhisper()) {
      // Whisper: treat cancel as release — stop recorder and process chunk
      orbPttActive = false;
      if (whisperRecorder) stopWhisperRecorder().then(handleWhisperResult);
    }
    // Auto mode: cancel does NOT mean the user released — keep orbPttActive true so the
    // recognition restart loop continues uninterrupted. Chunk commits on next orb tap.
    return;
  }
  hardStopConv();
});

function handleOrbTap() {
  if (journalDictating) return;
  const wasActive = orbPressedFromState && orbPressedFromState !== "idle" && orbPressedFromState !== "paused";
  orbPressedFromState = null;
  if (wasActive) {
    // Was in active state — hard stop already fired on pointerdown, stay paused
    return;
  }
  // Was paused/idle — start listening (mute flag stays as-is; it's a mic gate, not a block)
  convListen();
}

let thinkingAudioCtx = null;
let thinkingNodes = null;

function startThinkingSound() {
  try {
    // Reuse the session context created in enterConvMode() — never create a new
    // one here, which would be outside a user gesture and would leak on iOS.
    if (!thinkingAudioCtx || thinkingAudioCtx.state === 'closed') {
      thinkingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    thinkingNodes = { ctx: thinkingAudioCtx, stopped: false };
    // Playful repeating three-note chime: C5, E5, G5
    const notes = [523.25, 659.25, 783.99];
    let step = 0;
    function playChime() {
      if (thinkingNodes?.stopped) return;
      const ctx = thinkingAudioCtx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(notes[step % notes.length], now);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.12, now + 0.04);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
      step++;
      thinkingNodes.timer = setTimeout(playChime, 480);
    }
    playChime();
  } catch {}
}

function stopThinkingSound() {
  if (!thinkingNodes) return;
  try {
    clearTimeout(thinkingNodes.timer);
    thinkingNodes.stopped = true;
    // Don't close thinkingAudioCtx here — speakText() reuses it on iOS so the
    // gesture-unlocked context stays live through the full think→speak cycle.
    // Closed in exitConvMode() instead.
  } catch {}
  thinkingNodes = null;
}

function setConvState(state) {
  convState = state;
  convOrb.className = `conv-orb ${state}${journalDictating ? " journal" : ""}`;
  const labels = {
    idle: t("conv.label.idle"),
    listening: journalDictating ? t("conv.label.recording") : t("conv.label.listening"),
    thinking: t("conv.label.thinking"),
    speaking: t("conv.label.speaking"),
    paused: journalDictating ? (journalChunks.length === 0 ? t("conv.label.hold-to-record") : t("conv.label.chunks-ready")) : t("conv.label.paused"),
    captured: convMuted ? t("conv.label.muted") : t("conv.label.captured"),
  };
  convLabel.textContent = labels[state] || "";
  // Note: transcript is NOT wiped on every transition. It's wiped only when a
  // fresh listening cycle begins (top of convListen and startWhisperPTT) so the
  // user can see "what was heard" persist through thinking → speaking → next listen.
  if (state === "thinking") startThinkingSound();
  else stopThinkingSound();
}

// Mic-on chime — short ascending tone played ONCE per conv-mode session
// when the first active listening starts. Subsequent listening cycles within
// the same conv-mode session don't re-chime (per Siri/Google Assistant
// pattern; chime fatigue kills the feature otherwise). Reset on enter/exit.
let _convChimePlayed = false;
function playListenChime() {
  // Short-lived AudioContext (open → beep → close in onended) avoids any
  // iOS Safari simultaneous-context cap proximity. ~200ms total lifetime.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    // Ascending sine A4 → C#5: bright, friendly, "ready"
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(554.37, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
    osc.onended = () => { try { ctx.close(); } catch {} };
  } catch {}
}

function setJournalMode(on) {
  journalDictating = on;
  journalBadge.classList.toggle("visible", on);
  convFinishBtn.classList.toggle("invisible", !on);
  convMuteBtn.classList.toggle("invisible", on);
  convContent.classList.toggle("journal-mode", on);
  journalChunkListEl.classList.toggle("hidden", !on);
  // Wipe the conv-mode transcript on entry — otherwise leftover text from the
  // previous chat turn bleeds through under the journal chunk editor.
  if (on) convTranscriptEl.textContent = "";
  if (on) {
    // Mute is a conv-mode concept — journal is its own thing. Reset mute on
    // journal entry so the user starts each journal session clean.
    convMuted = false;
    convMuteBtn.classList.remove("muted");
    journalChunks = [];
    journalChunkListEl.innerHTML = "";
    convFinishBtn.disabled = true;
    convListenGen++; // invalidate any pending convListen onerror/onend callbacks
    stopConvRecognition();
    convDiscardBtn.classList.remove("invisible");
    convDiscardBtn.disabled = true;
    setConvState("paused");
    convLabel.textContent = t("conv.label.hold-to-record");
  } else {
    journalChunks = [];
    journalChunkListEl.innerHTML = "";
    convDiscardBtn.classList.add("invisible");
    convOverlay.style.height = "";
  }
  updateJournalChunkCount();
}

function updateJournalChunkCount() {
  if (journalDictating) {
    convFinishBtn.disabled = journalChunks.length === 0;
  }
}

function fireStillThere() {
  convLabel.textContent = "Still there? Checking in...";
  sendMessage("still there?", true);
}

function convListen() {
  if (!convMode) return;
  stopConvRecognition();
  convDiscardBtn.disabled = true;
  noSpeechCount = 0;
  const myGen = ++convListenGen;

  // Fresh listening cycle — wipe the previous "what was heard" text so the
  // new utterance starts on a blank canvas.
  convTranscriptEl.textContent = "";

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  convRecognition = new SR();
  convRecognition.lang = "en-US";
  // interimResults stays FALSE. Setting it to true caused Chrome (especially
  // Android) to end the recognition session mid-utterance after the first
  // confident segment, which orphaned pending finals waiting on the debounce
  // timer — recognition.onend → convListen() restart → gen bumped → old
  // timer's dispatch fails its gen check → the user's text vanished and no
  // /chat fired. Mute confirmation comes from the amplified mute button
  // styling + the mic-on chime, not from live interim transcript display.
  convRecognition.interimResults = false;
  convRecognition.continuous = true;

  setConvState("listening");

  // Chime once per conv-mode session on the first active listen — confirms
  // the mic is open. Subsequent cycles in the same session don't re-chime.
  if (!_convChimePlayed && !journalDictating) {
    _convChimePlayed = true;
    playListenChime();
  }

  // Auto-mode dispatch design (with interimResults=true):
  //
  // Chrome's recognition engine finalizes segments at confidence boundaries —
  // "tell me" can get stamped isFinal at the natural pause before "about cohen"
  // even though the user is mid-thought. Sending immediately on first final
  // truncates real utterances. Whisper mode gets around this with a 1500ms
  // silence detector; auto mode never had an equivalent.
  //
  // Solution: accumulate finals into pendingFinals and debounce the dispatch.
  // Each new final resets a 500ms timer; only when 500ms elapses with no new
  // finals do we send the joined text. This gives Chrome's "eager finalize"
  // behavior room to be wrong (subsequent finals append seamlessly) while
  // still feeling responsive on short utterances.
  //
  // The `dispatched` latch protects against post-stop() queue drains (the
  // "how" + "how old is Marcy" double-dispatch bug); once we send, any further
  // finals from this recognition object are ignored.
  let dispatched = false;
  let pendingFinals = [];
  let pendingTimer = null;
  // 700ms is the empirical sweet spot: long enough to bridge typical
  // mid-sentence pauses ("tell me [pause] about cohen"), short enough that
  // a single-word answer ("yes", "save it") doesn't feel sluggish. Whisper
  // mode uses 1500ms silence detection; we run faster here because Auto
  // already has the browser's per-segment finalization doing some of the work.
  const SEND_DEBOUNCE_MS = 700;

  const dispatchPending = () => {
    pendingTimer = null;
    if (!convMode || convListenGen !== myGen || dispatched) return;
    if (!pendingFinals.length || convMuted) { pendingFinals = []; return; }
    dispatched = true;
    const text = pendingFinals.join(" ").replace(/\s+/g, " ").trim();
    pendingFinals = [];
    convTranscriptEl.textContent = text;
    stopConvRecognition();
    setConvState("thinking");
    sendMessage(text, true);
  };

  convRecognition.onresult = e => {
    if (!convMode || convListenGen !== myGen || dispatched) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const text = e.results[i][0].transcript.trim();
      if (!text || convMuted) continue; // mute gate — drop finals while muted
      pendingFinals.push(text);
    }
    if (!pendingFinals.length) return;
    // Update display with the running merged text and restart the debounce timer.
    convTranscriptEl.textContent = pendingFinals.join(" ").replace(/\s+/g, " ").trim();
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(dispatchPending, SEND_DEBOUNCE_MS);
  };

  convDiscardBtn.onclick = () => {
    if (journalDictating) return;
    clearAutoSend();
    convTranscriptEl.textContent = "";
    convLabel.textContent = t("conv.label.discarded");
    setTimeout(() => { if (convMode) convListen(); }, 800);
  };

  convRecognition.onend = () => {
    if (!convMode || convListenGen !== myGen) return;
    // If recognition ended while we have queued finals waiting on the debounce
    // timer, dispatch them now. Without this, the convListen() restart below
    // would bump convListenGen and the old timer's dispatch would fail its
    // gen check, silently losing the user's speech. Defense in depth even
    // with interimResults=false (the previous trigger of mid-utterance ends).
    if (pendingFinals.length && !dispatched && !convMuted) {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      dispatchPending();
      return;
    }
    // Unexpected end (browser timeout ~60s, network drop) — restart
    if (convState === "listening") convListen();
  };

  convRecognition.onerror = e => {
    if (!convMode || convListenGen !== myGen) return;
    if (e.error === "no-speech") {
      if (journalDictating) {
        noSpeechCount++;
        if (noSpeechCount >= 3) { noSpeechCount = 0; fireStillThere(); return; }
      }
      convListen();
    } else {
      setConvState("idle");
    }
  };

  convRecognition.start();
}

function pttPreview(text, max = 180) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

function setPttText(text) {
  convTranscriptEl.textContent = text;
  requestAnimationFrame(() => { convTranscriptEl.scrollTop = convTranscriptEl.scrollHeight; });
}

// ---- Journal chunk pill list ----
function renderChunkList() {
  journalChunkListEl.innerHTML = "";
  journalChunks.forEach((text, idx) => {
    const pill = document.createElement("div");
    pill.className = "journal-chunk-pill";
    pill.dataset.idx = String(idx);

    const num = document.createElement("span");
    num.className = "journal-chunk-pill-num";
    num.textContent = idx + 1;

    const textEl = document.createElement("span");
    textEl.className = "journal-chunk-pill-text";
    textEl.textContent = text;

    // Per-pill delete (✕). Lets the user remove any chunk directly, not just
    // the last one via the global discard button. Picks current journalChunks
    // index from the pill's dataset.idx at click time (so it stays correct
    // even if a render happens between click and handler).
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "journal-chunk-pill-del";
    delBtn.setAttribute("aria-label", "Delete this chunk");
    delBtn.title = t("tooltip.delete-chunk");
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // don't trigger pill click (which would open edit)
      const i = parseInt(pill.dataset.idx, 10);
      if (Number.isNaN(i) || i < 0 || i >= journalChunks.length) return;
      journalChunks.splice(i, 1);
      renderChunkList();
      updateJournalChunkCount();
      saveJournalDraft();
      convDiscardBtn.disabled = journalChunks.length === 0;
      convLabel.textContent = journalChunks.length === 0
        ? t("conv.label.hold-to-record")
        : t("conv.label.chunks-ready");
    });

    pill.append(num, textEl, delBtn);
    pill.addEventListener("click", () => {
      if (orbPttActive) return;
      // Tap-to-select pattern: first tap on a pill selects it (highlights),
      // second tap on the *selected* pill opens the edit textarea. This
      // mirrors macOS Finder / iOS Photos and prevents the accidental
      // "I touched a pill and now I'm editing" frustration. The discard
      // button becomes context-aware against the selected pill — see the
      // convDiscardBtn handler below.
      if (pill.classList.contains("editing")) return; // already editing — clicks fall to textarea
      if (pill.classList.contains("selected")) {
        openPillEdit(pill, idx);
        return;
      }
      // Deselect any other pill, select this one
      journalChunkListEl.querySelectorAll(".journal-chunk-pill.selected").forEach(p => p.classList.remove("selected"));
      pill.classList.add("selected");
    });
    journalChunkListEl.appendChild(pill);
  });
  requestAnimationFrame(() => { journalChunkListEl.scrollTop = journalChunkListEl.scrollHeight; });
}

function openPillEdit(pill, idx) {
  // Commit any other open edit first
  const openPill = journalChunkListEl.querySelector(".journal-chunk-pill.editing");
  if (openPill && openPill !== pill) commitPillEdit(openPill);
  if (pill.classList.contains("editing")) return;

  const textEl = pill.querySelector(".journal-chunk-pill-text");
  const originalText = journalChunks[idx];

  pill.classList.add("editing");
  textEl.style.display = "none";

  const ta = document.createElement("textarea");
  ta.className = "journal-chunk-pill-ta";
  ta.value = originalText;
  const words = originalText.split(/\s+/).length;
  ta.rows = words > 30 ? 4 : words > 15 ? 3 : 2;

  pill.appendChild(ta);
  ta.addEventListener("blur", () => commitPillEdit(pill));
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function commitPillEdit(pill) {
  if (!pill.classList.contains("editing")) return;
  // Guard: if this pill was detached from the list (e.g., the user discarded
  // or deleted while editing, causing renderChunkList to wipe innerHTML),
  // its dataset.idx is stale and journalChunks[idx] may no longer correspond
  // to this pill's intended chunk. Bail out — the textarea's blur fired on
  // an orphan and any "commit" here would corrupt data (resurrect deleted
  // chunks, overwrite the wrong index, etc.).
  if (!journalChunkListEl.contains(pill)) {
    pill.classList.remove("editing");
    return;
  }
  const idx = parseInt(pill.dataset.idx, 10);
  const ta = pill.querySelector(".journal-chunk-pill-ta");
  const textEl = pill.querySelector(".journal-chunk-pill-text");
  if (ta) {
    const newText = ta.value.trim();
    // Restore original if cleared — no silent deletes via backspace
    journalChunks[idx] = newText || journalChunks[idx];
    textEl.textContent = journalChunks[idx];
    ta.remove();
  }
  textEl.style.display = "";
  pill.classList.remove("editing");
  saveJournalDraft();
}

// Android keyboard: keep controls visible above keyboard when editing a pill
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    if (journalDictating) {
      convOverlay.style.height = `${window.visualViewport.height}px`;
    }
  });
}

// PTT journal recording — hold orb to capture, release to stop
// Android Chrome has a mic buffer echo problem: starting a new recognition session
// re-transcribes ~300ms of the previous session's tail audio. Desktop Chrome does not.
const PTT_IS_MOBILE = /Android|iPhone|iPad|iPod|CriOS/i.test(navigator.userAgent);


let pttRecognition = null;
let pttTranscript = "";     // full accumulated text for current hold
let pttHoldText = "";       // carry-forward across mid-hold restarts (mobile only)
let pttRestarting = false;  // true when restarting within the same hold
let pttGen = 0;
let pttRestartTimer = null; // single tracked timer — prevents double-fire duplication

function convPttListen() {
  if (!convMode || !journalDictating) return;
  // Increment gen BEFORE abort so any synchronous onend from abort() sees pttGen !== myGen and exits
  const myGen = ++pttGen;
  if (pttRestartTimer) { clearTimeout(pttRestartTimer); pttRestartTimer = null; }
  stopConvRecognition();
  if (pttRecognition) { try { pttRecognition.abort(); } catch {} pttRecognition = null; }
  const isRestart = pttRestarting;
  pttRestarting = false;
  if (!isRestart) pttHoldText = ""; // new hold — start fresh

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  pttRecognition = new SR();
  pttRecognition.lang = "en-US";
  pttRecognition.interimResults = true;
  // continuous=false on all platforms: delivers interim results word-by-word for live transcript display.
  // Mid-hold silence ends the session; the restart path below restarts immediately (desktop) or
  // after 50ms (mobile) so natural pauses don't break the hold. Echo guard covers inter-session echo.
  pttRecognition.continuous = false;
  setConvState("listening");
  if (isRestart) {
    setPttText(pttHoldText ? pttPreview(pttHoldText) : "");
  } else {
    convLabel.textContent = "Recording...";
  }

  // On mobile, discard finals arriving in the first 300ms of each session.
  // The Android mic buffer replays ~300ms of the previous session's tail audio as a near-instant echo.
  const ECHO_GUARD_MS = PTT_IS_MOBILE ? 300 : 0;
  const startedAt = Date.now();
  let sessionFinal = "";
  let sessionFinalIdx = 0;

  pttRecognition.onresult = e => {
    if (pttGen !== myGen) return;
    const elapsed = Date.now() - startedAt;
    for (let i = sessionFinalIdx; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        if (elapsed >= ECHO_GUARD_MS) {
          sessionFinal += (sessionFinal ? " " : "") + e.results[i][0].transcript.trim();
        }
        sessionFinalIdx = i + 1;
      }
    }
    let interim = "";
    for (let i = sessionFinalIdx; i < e.results.length; i++) {
      interim += e.results[i][0].transcript;
    }
    pttTranscript = pttHoldText + (pttHoldText && sessionFinal ? " " : "") + sessionFinal;
    setPttText([pttTranscript, interim].filter(Boolean).join(" "));
  };

  const onStop = () => {
    if (pttGen !== myGen) return;
    pttRecognition = null;
    if (!convMode) return;
    pttTranscript = pttHoldText + (pttHoldText && sessionFinal ? " " : "") + sessionFinal;

    if (orbPttActive) {
      // Session ended mid-hold (mobile silence timeout, iOS quirk, or unexpected continuous=true end).
      // Restart on any platform — never show "paused" while the user is still holding.
      setConvState("listening"); // re-assert: orb must stay active during restart gap
      pttHoldText = pttTranscript;
      pttRestarting = true;
      if (pttRestartTimer) clearTimeout(pttRestartTimer);
      pttRestartTimer = setTimeout(() => {
        pttRestartTimer = null;
        if (orbPttActive && convMode) { convPttListen(); }
        else { pttRestarting = false; }
      }, PTT_IS_MOBILE ? 50 : 0);
      return;
    }
    processPttChunk();
  };

  pttRecognition.onend = onStop;
  pttRecognition.onerror = onStop;

  try {
    pttRecognition.start();
  } catch {
    pttRecognition = null;
    if (orbPttActive) {
      // start() threw (mic still releasing from previous session) — retry after longer delay
      if (pttRestartTimer) clearTimeout(pttRestartTimer);
      pttRestartTimer = setTimeout(() => {
        pttRestartTimer = null;
        if (orbPttActive && convMode) convPttListen();
        else { pttRestarting = false; setConvState("paused"); }
      }, 200);
    } else {
      setConvState("paused");
    }
  }
}

function processPttChunk() {
  pttRestarting = false;
  pttHoldText = "";
  if (pttRestartTimer) { clearTimeout(pttRestartTimer); pttRestartTimer = null; }
  if (!pttTranscript) {
    setConvState("paused");
    convLabel.textContent = journalChunks.length === 0
      ? t("conv.label.hold-to-record")
      : t("conv.label.chunks-ready");
    return;
  }
  if (PTT_IS_MOBILE && navigator.vibrate) navigator.vibrate(40); // confirm chunk saved
  journalChunks.push(pttTranscript);
  renderChunkList();
  updateJournalChunkCount();
  saveJournalDraft();
  convDiscardBtn.disabled = false;
  setConvState("paused");
  convLabel.textContent = t("conv.label.chunks-ready");
}

function convPttStop() {
  if (pttRecognition) {
    try { pttRecognition.stop(); } catch { try { pttRecognition.abort(); } catch {} pttRecognition = null; }
  }
}

// ---- Whisper voice input ----

// Silence detection — monitors the audio stream and auto-sends after speech + silence
// AudioContext + AnalyserNode are created once per recorder session and reused
// across all mute/unmute cycles. iOS Safari has a hard cap of ~6 simultaneous
// AudioContexts per page; the previous implementation closed and recreated on
// every cycle, which under rapid mute toggling would exhaust the cap and
// silently disable VAD for the rest of the session. (Per Rule 1c.)
let silenceRaf = null;
let silenceCtx = null;
let silenceAnalyser = null;
let silenceBuf = null;

function startSilenceDetection(stream) {
  // Cancel any active tick first, but keep the AudioContext alive.
  if (silenceRaf) { clearInterval(silenceRaf); silenceRaf = null; }
  try {
    if (!silenceCtx) {
      silenceCtx = new (window.AudioContext || window.webkitAudioContext)();
      silenceAnalyser = silenceCtx.createAnalyser();
      silenceAnalyser.fftSize = 1024;
      silenceCtx.createMediaStreamSource(stream).connect(silenceAnalyser);
      silenceBuf = new Float32Array(silenceAnalyser.fftSize);
    }
    let speechDetected = false;
    let silenceStart = null;
    const SPEECH_RMS  = 0.015; // RMS above this = speaking
    const SILENCE_RMS = 0.008; // RMS below this = silent
    const SILENCE_MS  = 900;   // ms of silence after speech before auto-send (was 1500)
    function tick() {
      if (!whisperRecorder) { stopSilenceDetection(); return; }
      silenceAnalyser.getFloatTimeDomainData(silenceBuf);
      const rms = Math.sqrt(silenceBuf.reduce((s, v) => s + v * v, 0) / silenceBuf.length);
      if (rms > SPEECH_RMS) { speechDetected = true; silenceStart = null; }
      else if (speechDetected && rms < SILENCE_RMS) {
        if (!silenceStart) silenceStart = Date.now();
        if (Date.now() - silenceStart > SILENCE_MS) {
          if (journalDictating && orbPttActive) {
            // Journal PTT: user holds the orb to control when recording ends.
            // Silence resets the timer — only pointerup stops the recording.
            silenceStart = null;
          } else {
            stopSilenceDetection();
            orbPttActive = false;
            stopWhisperRecorder().then(handleWhisperResult);
            return;
          }
        }
      }
    }
    // setInterval instead of requestAnimationFrame — rAF throttles/halts when
    // the Android screen dims, which freezes VAD and prevents auto-send.
    silenceRaf = setInterval(tick, 50);
  } catch { stopSilenceDetection(true); }
}

// Stops the VAD tick loop. Pass closeCtx=true to also tear down the
// AudioContext (only when the recorder itself is being destroyed — i.e. on
// orb-tap stop, send, or exit). On mute/unmute we keep the context alive.
function stopSilenceDetection(closeCtx = false) {
  if (silenceRaf) { clearInterval(silenceRaf); silenceRaf = null; }
  if (closeCtx && silenceCtx) {
    try { silenceCtx.close(); } catch {}
    silenceCtx = null;
    silenceAnalyser = null;
    silenceBuf = null;
  }
}

// Discard the current utterance and immediately restart recording on the same
// stream. Called on BOTH mute and unmute edges to ensure speech spoken around
// the mute tap is never sent. The key invariant: onstop and ondataavailable are
// nulled BEFORE stop() so the browser's final flush is dropped and
// handleWhisperResult is never called. A new MediaRecorder restores the WebM
// EBML header that would otherwise be missing from continued chunks.
function restartWhisperRecorder() {
  if (!whisperRecorder || !whisperStream) return;
  const old = whisperRecorder;
  old.ondataavailable = null;  // drop any buffered chunks on final flush
  old.onstop = null;           // prevent handleWhisperResult from firing
  try { old.stop(); } catch {}
  whisperChunks = [];
  whisperRecorder = null;
  stopSilenceDetection();      // kill the VAD closure (resets speechDetected latch)
  try {
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
                   : MediaRecorder.isTypeSupported("audio/mp4")  ? "audio/mp4" : "";
    whisperRecorder = new MediaRecorder(whisperStream, mimeType ? { mimeType } : {});
    whisperRecorder.ondataavailable = e => { if (e.data.size > 0) whisperChunks.push(e.data); };
    whisperRecorder.start(500);
    startSilenceDetection(whisperStream); // fresh closure — speechDetected starts false
  } catch {
    // Some Android builds are flaky on immediate MediaRecorder reuse — fall back
    whisperRecorder = null;
    orbPttActive = true;
    startWhisperPTT();
  }
}

async function startWhisperPTT() {
  try {
    clearTimeout(_streamIdleTimer); _streamIdleTimer = null;
    stopThinkingSound(); // stops oscillators; AudioContext closed separately in exitConvMode
    stopConvAudio();     // stop any TTS playback that would otherwise be captured
    // Fresh chat-mode listen → wipe previous transcript. Journal PTT keeps the
    // existing chunk-list workflow; transcript element isn't its display target.
    if (!journalDictating) convTranscriptEl.textContent = "";
    setConvState("listening"); // pulsate orb immediately, before getUserMedia resolves
    // Mic-on chime — once per conv-mode session, chat-mode only.
    if (!_convChimePlayed && !journalDictating) {
      _convChimePlayed = true;
      playListenChime();
    }
    // Tell iOS we need the mic now — must happen before getUserMedia so WebKit
    // routes audio correctly during capture.
    if (isIOS() && typeof navigator !== 'undefined' && navigator.audioSession) {
      try { navigator.audioSession.type = 'play-and-record'; } catch {}
    }
    // Reuse the persistent stream if it's still live — avoids per-turn getUserMedia
    // latency on mobile (OS mic acquisition takes 500ms–2s each time).
    // On iOS: stream may have been pre-acquired at pointerdown (see _iosMicPreAcquire),
    // so we allow iOS to reuse whisperStream here; it is released after each turn in
    // stopWhisperRecorder() so the next turn picks it up fresh via pre-acquire again.
    const activeTracks = whisperStream && whisperStream.getTracks().filter(t => t.readyState === 'live' && !t.muted);
    if (!activeTracks || activeTracks.length === 0) {
      // On iOS, consume the pre-acquire promise (triggered at pointerdown in the gesture).
      // On Android/desktop, call getUserMedia directly — stream is held persistently.
      const streamPromise = _iosMicPreAcquire || navigator.mediaDevices.getUserMedia({ audio: true });
      _iosMicPreAcquire = null;
      convLabel.textContent = t("conv.label.starting");
      convLabel.classList.add("conv-label--starting");
      const stream = await streamPromise;
      convLabel.classList.remove("conv-label--starting");
      convLabel.textContent = t("conv.label.listening");
      if (!orbPttActive) {
        stream.getTracks().forEach(t => t.stop());
        setConvState(journalDictating ? "paused" : "idle");
        return;
      }
      // Release any stale stream before storing the new one (skip if it's the same stream
      // that the pre-acquire .then() callback already stored in whisperStream)
      if (whisperStream && whisperStream !== stream) { try { whisperStream.getTracks().forEach(t => t.stop()); } catch {} }
      whisperStream = stream;
      // Clear stream ref if the hardware revokes the mic (e.g. incoming call on mobile)
      stream.getTracks().forEach(t => { t.onended = () => { if (whisperStream === stream) whisperStream = null; }; });
    }
    if (!orbPttActive) {
      setConvState(journalDictating ? "paused" : "idle");
      return;
    }
    const stream = whisperStream;
    whisperChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
                   : MediaRecorder.isTypeSupported("audio/mp4")  ? "audio/mp4" : "";
    whisperRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    whisperRecorder.ondataavailable = e => { if (e.data.size > 0) whisperChunks.push(e.data); };
    whisperRecorder.start(500); // timeslice so chunks emit periodically — lets us discard silent chunks on unmute
    // Journal mode always needs tracks enabled. Chat mode respects convMuted.
    // This also re-enables any tracks that were left disabled by a prior mute
    // cycle on a reused stream — critical on iOS where streams are persistent.
    const wantEnabled = journalDictating ? true : !convMuted;
    stream.getTracks().forEach(t => { t.enabled = wantEnabled; });
    if (!journalDictating) startSilenceDetection(stream);
  } catch {
    orbPttActive = false;
    setConvState(journalDictating ? "paused" : "idle");
    showToast(t("toast.mic-denied"));
  }
}

function stopWhisperRecorder() {
  stopSilenceDetection(true); // recorder is being destroyed — close the AudioContext too
  return new Promise(resolve => {
    if (!whisperRecorder) { resolve(null); return; }
    whisperRecorder.onstop = () => {
      const mimeType = (whisperChunks[0] && whisperChunks[0].type) || "audio/webm";
      const blob = new Blob(whisperChunks, { type: mimeType });
      // On iOS: release the stream so WebKit can switch the audio session from
      // play-and-record back to playback — otherwise TTS plays through the earpiece
      // at low volume. Android/desktop keep the stream alive for low-latency restart.
      if (isIOS() && whisperStream) {
        try { whisperStream.getTracks().forEach(t => t.stop()); } catch {}
        whisperStream = null;
      }
      whisperRecorder = null;
      whisperChunks = [];
      resolve(blob);
    };
    try { whisperRecorder.stop(); } catch { whisperRecorder = null; whisperChunks = []; resolve(null); }
  });
}

async function transcribeAudio(blob) {
  // Per Rule 1c: a fresh AbortController is wired so toggleMute() can cancel
  // an in-flight transcription. Without this the network call completes and
  // bills tokens even when the user has already muted.
  whisperTranscribeAbort = new AbortController();
  try {
    const res = await fetch(config.url + "/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "audio/webm",
        "X-Session-Token": session.token,
        "X-Whisper-Language": localStorage.getItem(WHISPER_LANG_KEY) || "en",
      },
      body: blob,
      signal: whisperTranscribeAbort.signal,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Transcription failed");
    return (data.text || "").trim();
  } finally {
    whisperTranscribeAbort = null;
  }
}

async function handleWhisperResult(blob) {
  const myGen = whisperResultGen;
  const fallback = journalDictating ? "paused" : "idle";
  if (!blob || blob.size < 500) { setConvState(fallback); return; }
  if (!journalDictating) {
    setConvState("thinking");
    // Whisper has a 1-3s /transcribe round-trip before we know what was heard.
    // Show a placeholder so the transcript area isn't a void during that gap;
    // the actual transcription replaces it the moment Whisper returns.
    convTranscriptEl.textContent = "Transcribing…";
  }
  try {
    const text = await transcribeAudio(blob);
    if (whisperResultGen !== myGen) return; // cancelled by tap/journal-entry/mute
    if (!text) { setConvState(fallback); return; }
    if (journalDictating) {
      processWhisperChunk(text);
    } else {
      // Show what Whisper heard before kicking off /chat. Persists through
      // thinking → speaking → next listen (until startWhisperPTT wipes on
      // the next cycle).
      convTranscriptEl.textContent = text;
      sendMessage(text, true);
    }
  } catch (err) {
    if (whisperResultGen !== myGen) return;
    showToast(t("toast.transcription-failed"));
    setConvState(fallback);
  }
}

function processWhisperChunk(text) {
  if (!text || !text.trim()) {
    setConvState("paused");
    convLabel.textContent = journalChunks.length === 0
      ? t("conv.label.hold-to-record")
      : t("conv.label.chunks-ready");
    return;
  }
  if (PTT_IS_MOBILE && navigator.vibrate) navigator.vibrate(40);
  journalChunks.push(text.trim());
  renderChunkList();
  updateJournalChunkCount();
  saveJournalDraft();
  convDiscardBtn.disabled = false;
  setConvState("paused");
  convLabel.textContent = t("conv.label.chunks-ready");
}

let _journalFinishPending = false;

function finishJournal() {
  if (!journalDictating || journalChunks.length === 0) { exitConvMode(); return; }
  stopConvRecognition();
  convPttStop();
  setConvState("thinking");
  convLabel.textContent = "Saving journal...";
  convDiscardBtn.disabled = true;
  const chunkTexts = journalChunks.join("\n\n");
  clearJournalDraft();
  setJournalMode(false);
  exitConvMode();
  // brief=false so chat-mode rules apply — Claude emits the write proposal immediately
  // rather than treating this as another dictation chunk (brief=true triggers the
  // multi-turn journal rule that waits for a "done" signal).
  _journalFinishPending = true;
  sendMessage(`Save this journal entry:\n\n${chunkTexts}`, false);
}

// Finish button
convFinishBtn.addEventListener("click", finishJournal);

// Discard chunk in PTT journal mode — context-aware:
//   1. If a pill is being edited, commit/blur it then delete that pill
//   2. Else if a pill is selected (tap-to-select), delete that pill
//   3. Else pop the last chunk (original behavior)
// The per-pill ✕ button is still the most direct path for delete; the global
// Discard button stays as the fallback / discoverable affordance and the
// keyboard-friendly path (no precise tap required on the small ✕).
convDiscardBtn.addEventListener("click", () => {
  if (!journalDictating) {
    // Normal journal (non-PTT) discard — existing behavior handled in convListen closure
    return;
  }
  const editingPill  = journalChunkListEl.querySelector(".journal-chunk-pill.editing");
  const selectedPill = journalChunkListEl.querySelector(".journal-chunk-pill.selected");
  const targetPill   = editingPill || selectedPill;
  if (targetPill) {
    // Commit edit first so we operate on a clean DOM (commitPillEdit removes
    // the .editing class and the textarea). Even if the user discards without
    // saving, we still need the pill detached from the editing state so the
    // splice below removes the right chunk.
    if (editingPill) {
      // Don't call commitPillEdit — we're discarding, not saving. Just blur the
      // textarea to fire its blur handler (which has an orphan guard) and then
      // remove the editing class so the next renderChunkList rebuilds cleanly.
      const ta = editingPill.querySelector(".journal-chunk-pill-ta");
      if (ta) ta.blur();
      editingPill.classList.remove("editing");
    }
    const i = parseInt(targetPill.dataset.idx, 10);
    if (!Number.isNaN(i) && i >= 0 && i < journalChunks.length) {
      journalChunks.splice(i, 1);
    } else {
      journalChunks.pop();
    }
  } else {
    journalChunks.pop();
  }
  renderChunkList();
  updateJournalChunkCount();
  saveJournalDraft();
  convDiscardBtn.disabled = journalChunks.length === 0;
  convLabel.textContent = journalChunks.length === 0
    ? t("conv.label.hold-to-record")
    : t("conv.label.chunks-ready");
});

function stopConvRecognition() {
  if (convRecognition) {
    try { convRecognition.stop(); } catch {}
    convRecognition = null;
  }
}

function stopConvAudio() {
  if (convAudioSource) {
    const s = convAudioSource;
    convAudioSource = null;
    // Capture and null handler BEFORE stop() so the watchdog setTimeout
    // doesn't double-resolve; then invoke it to unblock any awaiting promise.
    const h = s.onended;
    try { s.onended = null; s.stop(); s.disconnect(); } catch {}
    if (h) try { h(); } catch {}
  }
  if (convAudio) {
    const a = convAudio;
    convAudio = null;
    a.pause();
    a.src = "";
    // Fire onerror to unblock any awaiting promise
    if (a.onerror) try { a.onerror(); } catch {}
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// ---- Voice Output ----
function stripMdForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, "see code in chat")   // fenced code blocks
    .replace(/`[^`]*`/g, "")                           // inline code
    .replace(/https?:\/\/[^\s)>\]"]+/g, "see link in chat")  // URLs
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/^[–—]\s*/gm, "")
    .replace(/\s{2,}/g, " ")                      // collapse extra whitespace
    .trim();
}

function speakWithBrowser(text) {
  return new Promise(resolve => {
    if (!window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    let settled = false;
    const done = () => { if (!settled) { settled = true; clearTimeout(wd); resolve(); } };
    utter.onend = done;
    utter.onerror = done;
    // iOS can no-op speak() outside a gesture (neither onend nor onerror fires).
    // Chrome desktop stalls long utterances after ~15s. Watchdog unblocks both.
    const wd = setTimeout(done, Math.min(60000, 3000 + text.length * 90));
    window.speechSynthesis.speak(utter);
  });
}

async function speakText(text, autoLoop = false) {
  if (convMode) setConvState("speaking");
  // Switch iOS audio session to playback so TTS plays through the speaker,
  // not the earpiece. The mic was released in stopWhisperRecorder before we get here.
  if (isIOS() && typeof navigator !== 'undefined' && navigator.audioSession) {
    try { navigator.audioSession.type = 'playback'; } catch {}
  }
  const spokenText = stripMdForSpeech(text);

  // Defensive: kill any prior speakText still playing or fetching.
  if (convSpeakAbort) { try { convSpeakAbort.abort(); } catch {} convSpeakAbort = null; }
  if (convAudioSource) {
    const s = convAudioSource; convAudioSource = null;
    try { s.onended = null; s.stop(); s.disconnect(); } catch {}
  }
  if (convAudio) {
    try { convAudio.pause(); convAudio.src = ""; } catch {}
    convAudio = null;
  }

  try {
    convSpeakAbort = new AbortController();
    const res = await api("/speak", "POST", { text: spokenText, voice: voicePref }, true, convSpeakAbort?.signal);
    convSpeakAbort = null;
    if (!res.ok) {
      await speakWithBrowser(spokenText);
      if (convMode && autoLoop && convState !== "paused") {
        if (useWhisper()) { orbPttActive = true; startWhisperPTT(); }
        else { convListen(); }
      } else if (convMode && convState !== "paused") { setConvState("idle"); }
      return;
    }
    // Route TTS through the session AudioContext (created in enterConvMode inside a
    // real gesture). This bypasses HTMLMediaElement.play() which iOS blocks async.
    // If the context got suspended by mic teardown between turns, attempt a timed
    // resume — if it still won't run, fall back to Web Speech rather than hanging.
    if (thinkingAudioCtx && thinkingAudioCtx.state !== 'closed') {
      if (thinkingAudioCtx.state !== 'running') {
        await Promise.race([
          thinkingAudioCtx.resume().catch(() => {}),
          new Promise(r => setTimeout(r, 1500))
        ]);
      }
      if (thinkingAudioCtx.state === 'running') {
        const arrayBuffer = await res.arrayBuffer();
        const audioBuffer = await thinkingAudioCtx.decodeAudioData(arrayBuffer);
        await new Promise(resolve => {
          const src = thinkingAudioCtx.createBufferSource();
          src.buffer = audioBuffer;
          src.connect(thinkingAudioCtx.destination);
          convAudioSource = src;
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(wd);
            if (convAudioSource === src) convAudioSource = null;
            resolve();
          };
          src.onended = done;
          // Watchdog: if onended never fires (wedged context), unblock after duration + 2s
          const wd = setTimeout(done, audioBuffer.duration * 1000 + 2000);
          src.start(0);
        });
      } else {
        // Context won't resume (e.g. interrupted state) — fall through to Web Speech
        await res.blob(); // consume body
        await speakWithBrowser(spokenText);
      }
    } else {
      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      convAudio = audio;
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(reject);
      });
      URL.revokeObjectURL(audioUrl);
      convAudio = null;
    }

    // After speaking: resume listening (mute state handled inside each listener — mic gate only)
    if (convMode && autoLoop && convState !== "paused") {
      if (useWhisper()) { orbPttActive = true; startWhisperPTT(); }
      else { convListen(); }
    } else if (convMode && convState !== "paused") {
      setConvState("idle");
    }
    // If convState is "paused" (user hard-stopped), leave it as-is
  } catch (err) {
    convSpeakAbort = null;
    if (err.name === "AbortError") return;
    await speakWithBrowser(spokenText);
    // In autoLoop conv mode, restart listening rather than dying silently
    if (convMode && autoLoop && convState !== "paused") {
      if (useWhisper()) { orbPttActive = true; startWhisperPTT(); }
      else { convListen(); }
    } else if (convMode && convState !== "paused") {
      setConvState("idle");
    }
  }
}

// ---- Backup crypto (Web Crypto API — no dependencies) ----

const BACKUP_FILES = ["people.md","reflections.md","fragments.md","loops.md",
                      "archive_people.md","archive_reflections.md","archive_fragments.md","archive_loops.md",
                      "deeparchive_people.md","deeparchive_reflections.md","deeparchive_fragments.md","deeparchive_loops.md"];

async function backupEncrypt(plaintext, password) {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
    keyMat, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const out = new Uint8Array(16 + 12 + ct.byteLength);
  out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(ct), 28);
  return out;
}

async function backupDecrypt(data, password) {
  const enc    = new TextEncoder();
  const salt   = data.slice(0, 16);
  const iv     = data.slice(16, 28);
  const ct     = data.slice(28);
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
    keyMat, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plain);
}

// ---- Export modal ----

function showExportError(msg) {
  exportModalErrorEl.textContent = msg;
  exportModalErrorEl.classList.remove("hidden");
}

exportModalCancel.addEventListener("click", () => {
  exportModal.classList.add("hidden");
});

exportModalConfirm.addEventListener("click", async () => {
  const pw  = exportPwEl.value;
  const pw2 = exportPw2El.value;
  exportModalErrorEl.classList.add("hidden");
  if (!pw)          { showExportError("Password is required."); return; }
  if (pw.length < 6){ showExportError("Password must be at least 6 characters."); return; }
  if (pw !== pw2)   { showExportError("Passwords don't match."); return; }

  exportModalConfirm.disabled = true;
  exportModalConfirm.textContent = "Exporting…";
  try {
    const results = await Promise.all(BACKUP_FILES.map(async f => {
      const res     = await api(`/getMemoryFile?filename=${encodeURIComponent(f)}`, "GET");
      const content = res.ok ? await res.text() : "";
      return [f, content];
    }));
    const today = new Date().toISOString().split("T")[0];
    const payload = { version: 1, exportedAt: today, files: Object.fromEntries(results) };

    // Optionally bundle photos
    const includePhotos = document.getElementById("export-include-photos")?.checked;
    if (includePhotos) {
      const allContent = Object.values(payload.files).join("\n");
      const photoMatches = [...allContent.matchAll(/^[–-] Photo: (.+)$/gm)].map(m => m[1].trim());
      if (photoMatches.length) {
        const photosObj = {};
        await Promise.all(photoMatches.map(async fn => {
          try {
            const r = await api(`/photo/${encodeURIComponent(fn)}`, "GET");
            if (r.ok) {
              const buf = await r.arrayBuffer();
              // Chunked to avoid call-stack overflow on large photos (faster on mobile too)
              const bytes = new Uint8Array(buf);
              const CHUNK = 0x8000; // 32KB
              let b64 = "";
              for (let i = 0; i < bytes.length; i += CHUNK) {
                b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
              }
              b64 = btoa(b64);
              photosObj[fn] = b64;
            }
          } catch {}
        }));
        if (Object.keys(photosObj).length) payload.photos = photosObj;
      }
    }

    const encrypted = await backupEncrypt(JSON.stringify(payload), pw);
    const blob = new Blob([encrypted], { type: "application/octet-stream" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `memory-backup-${today}.whoszoo`; a.click();
    URL.revokeObjectURL(url);
    exportModal.classList.add("hidden");
    appendMessage("system", `Backup exported: memory-backup-${today}.whoszoo\n⚠ Store your password safely — there is no recovery if you lose it.`);
  } catch (err) {
    showExportError(`Export failed: ${err.message}`);
  } finally {
    exportModalConfirm.disabled = false;
    exportModalConfirm.textContent = "Export";
  }
});

// ---- Import modal ----

function showImportError(msg) {
  importModalErrorEl.textContent = msg;
  importModalErrorEl.classList.remove("hidden");
}
function showImportError2(msg) {
  importModalError2.textContent = msg;
  importModalError2.classList.remove("hidden");
}
function closeImportModal() {
  importModal.classList.add("hidden");
  importPendingPayload = null;
  importFileInput.value = "";
}

importModalCancel.addEventListener("click",  closeImportModal);
importModalCancel2.addEventListener("click", closeImportModal);
importModalBack.addEventListener("click", () => {
  importPhase2.classList.add("hidden");
  importPhase1.classList.remove("hidden");
  importConfirmInput.value = "";
  importModalError2.classList.add("hidden");
  importModalConfirmBtn.disabled = true;
  importPendingPayload = null;
  importPwEl.value = "";
  importModalErrorEl.classList.add("hidden");
  setTimeout(() => importPwEl.focus(), 50);
});

// ---- Re-auth Gate (passphrase confirmation for /export, /export-plain, /import) ----
//
// These three actions each produce a complete, portable, re-importable copy of
// every memory file. An unattended unlocked session could otherwise yield one
// in seconds, and /export is entirely client-side so it left no trace at all.
//
// The passphrase — not the Access Key — is the factor here. It is the only
// secret that lives solely in the user's head; the Access Key is one we tell
// people to screenshot and keep in a notes app, so on a device that is already
// unlocked it is the weaker of the two. Confirming also writes the action to
// login_log, which is what makes an export visible after the fact.

let reauthAction = null;

function closeReauthGate() {
  accessKeyGateModal.classList.add("hidden");
  accessKeyGateInput.value = "";
  accessKeyGateConfirm.disabled = true;
  accessKeyGateError.classList.add("hidden");
  accessKeyGateCallback = null;
  reauthAction = null;
}

function showReauthGate(action, callback) {
  reauthAction = action;
  accessKeyGateCallback = callback;
  accessKeyGateInput.value = "";
  accessKeyGateConfirm.disabled = true;
  accessKeyGateError.classList.add("hidden");
  accessKeyGateModal.classList.remove("hidden");
  setTimeout(() => accessKeyGateInput.focus(), 50);
}

accessKeyGateInput.addEventListener("input", () => {
  accessKeyGateConfirm.disabled = accessKeyGateInput.value.trim().length < 1;
});

accessKeyGateCancel.addEventListener("click", closeReauthGate);

accessKeyGateInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !accessKeyGateConfirm.disabled) accessKeyGateConfirm.click();
});

accessKeyGateConfirm.addEventListener("click", async () => {
  const key = accessKeyGateInput.value.trim();
  if (!key) return;
  accessKeyGateError.classList.add("hidden");
  accessKeyGateConfirm.disabled = true;
  accessKeyGateConfirm.textContent = "Verifying…";
  try {
    const res  = await api("/verifyPassphrase", "POST", { password: key, action: reauthAction });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      accessKeyGateError.textContent = data.error || t("modal.reauth-wrong");
      accessKeyGateError.classList.remove("hidden");
      return;
    }
    const cb = accessKeyGateCallback;
    closeReauthGate();
    if (cb) cb();
  } catch (err) {
    accessKeyGateError.textContent = `Verification failed: ${err.message}`;
    accessKeyGateError.classList.remove("hidden");
  } finally {
    accessKeyGateConfirm.disabled = false;
    accessKeyGateConfirm.textContent = "Continue";
  }
});

importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files[0];
  if (!file) return;
  importFilenameEl.textContent = file.name;
  importModalErrorEl.classList.add("hidden");

  if (file.name.toLowerCase().endsWith(".zip")) {
    // Plain-text zip path — detect known .md files, skip decrypt phase
    try {
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const files = {};
      for (const f of BACKUP_FILES) {
        const entry = zip.file(f);
        if (entry) files[f] = await entry.async("string");
      }
      if (Object.keys(files).length === 0) {
        importPhase1.classList.remove("hidden");
        importPhase2.classList.add("hidden");
        importModal.classList.remove("hidden");
        showImportError("No recognized memory files found in this zip. Expected files named people.md, loops.md, etc. at the root level.");
        return;
      }
      const found = Object.keys(files).length;
      const lines = [`Source:   plain text zip  (${found} of ${BACKUP_FILES.length} files present)`, ""];
      BACKUP_FILES.forEach(f => {
        if (files[f] !== undefined) {
          const kb = (files[f].length / 1024).toFixed(1);
          const sections = (files[f].match(/^## /gm) || []).length;
          lines.push(`  ${f.padEnd(30)} ${String(sections).padStart(3)} records   ${kb} KB`);
        } else {
          lines.push(`  ${f.padEnd(30)}   —  (not in zip — unchanged)`);
        }
      });
      importSummaryEl.textContent = lines.join("\n");
      importConfirmInput.value = "";
      importModalError2.classList.add("hidden");
      importModalConfirmBtn.disabled = true;
      importPendingPayload = { files, exportedAt: "plain text zip" };
      importPhase1.classList.add("hidden");
      importPhase2.classList.remove("hidden");
      importModal.classList.remove("hidden");
      setTimeout(() => importConfirmInput.focus(), 50);
    } catch (err) {
      importPhase1.classList.remove("hidden");
      importPhase2.classList.add("hidden");
      importModal.classList.remove("hidden");
      showImportError(`Could not read zip: ${err.message}`);
    }
  } else {
    // Encrypted backup path — existing Phase 1 (password) flow
    importPwEl.value = "";
    importPhase1.classList.remove("hidden");
    importPhase2.classList.add("hidden");
    importModal.classList.remove("hidden");
    setTimeout(() => importPwEl.focus(), 50);
  }
});

importModalDecrypt.addEventListener("click", async () => {
  const pw = importPwEl.value;
  importModalErrorEl.classList.add("hidden");
  if (!pw) { showImportError("Password is required."); return; }

  importModalDecrypt.disabled = true;
  importModalDecrypt.textContent = "Decrypting…";
  try {
    const file = importFileInput.files[0];
    const buf  = await file.arrayBuffer();
    let decrypted;
    try {
      decrypted = await backupDecrypt(new Uint8Array(buf), pw);
    } catch {
      showImportError("Wrong password or corrupted file.");
      return;
    }
    const payload = JSON.parse(decrypted);
    if (!payload.version || !payload.files) throw new Error("Invalid backup file format.");

    const lines = [`Exported:  ${payload.exportedAt || "unknown date"}`,""];
    BACKUP_FILES.forEach(f => {
      const content  = payload.files[f] || "";
      const kb       = (content.length / 1024).toFixed(1);
      const sections = (content.match(/^## /gm) || []).length;
      lines.push(`  ${f.padEnd(28)} ${String(sections).padStart(3)} records   ${kb} KB`);
    });
    importSummaryEl.textContent = lines.join("\n");
    importConfirmInput.value = "";
    importModalError2.classList.add("hidden");
    importModalConfirmBtn.disabled = true;
    importPhase1.classList.add("hidden");
    importPhase2.classList.remove("hidden");
    setTimeout(() => importConfirmInput.focus(), 50);
    importPendingPayload = payload;
  } catch (err) {
    showImportError(`Import failed: ${err.message}`);
  } finally {
    importModalDecrypt.disabled = false;
    importModalDecrypt.textContent = "Decrypt";
  }
});

importConfirmInput.addEventListener("input", () => {
  importModalConfirmBtn.disabled = importConfirmInput.value.trim().toLowerCase() !== "overwrite";
});

// ---- Export Zip (unencrypted) ----

exportZipInput.addEventListener("input", () => {
  exportZipConfirm.disabled = exportZipInput.value.trim().toLowerCase() !== "unencrypted";
});

exportZipCancel.addEventListener("click", () => {
  exportZipModal.classList.add("hidden");
  exportZipInput.value = "";
  exportZipConfirm.disabled = true;
});

exportZipConfirm.addEventListener("click", async () => {
  exportZipError.classList.add("hidden");
  exportZipConfirm.disabled = true;
  exportZipConfirm.textContent = "Building zip…";
  try {
    const results = await Promise.all(BACKUP_FILES.map(async f => {
      const res     = await api(`/getMemoryFile?filename=${encodeURIComponent(f)}`, "GET");
      const content = res.ok ? await res.text() : "";
      return [f, content];
    }));
    const zip = new JSZip();
    results.forEach(([f, content]) => zip.file(f, content));

    // Optionally bundle photos
    const includePhotosZip = document.getElementById("export-zip-include-photos")?.checked;
    let zipPhotoSuccess = 0;
    let zipPhotoTotal = 0;
    if (includePhotosZip) {
      const allContent = results.map(([, c]) => c).join("\n");
      const photoMatches = [...allContent.matchAll(/^[–-] Photo: (.+)$/gm)].map(m => m[1].trim());
      zipPhotoTotal = photoMatches.length;
      await Promise.all(photoMatches.map(async fn => {
        try {
          const r = await api(`/photo/${encodeURIComponent(fn)}`, "GET");
          if (r.ok) {
            const buf = await r.arrayBuffer();
            zip.file(`photos/${fn}`, buf);
            zipPhotoSuccess++;
          }
        } catch {}
      }));
    }

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const today = new Date().toISOString().split("T")[0];
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href = url; a.download = `memory-export-${today}.zip`; a.click();
    URL.revokeObjectURL(url);
    exportZipModal.classList.add("hidden");
    exportZipInput.value = "";
    appendMessage("system", `Exported: memory-export-${today}.zip\nContains 8 plain-text .md files — keep this file in a secure location.`);
    if (zipPhotoTotal > 0) {
      appendMessage("system", t("chat.photo-zip-summary", { done: zipPhotoSuccess, total: zipPhotoTotal }));
    }
  } catch (err) {
    exportZipError.textContent = `Export failed: ${err.message}`;
    exportZipError.classList.remove("hidden");
  } finally {
    exportZipConfirm.disabled = false;
    exportZipConfirm.textContent = "Download Zip";
  }
});

importModalConfirmBtn.addEventListener("click", async () => {
  if (!importPendingPayload) return;
  importModalError2.classList.add("hidden");
  importModalConfirmBtn.disabled = true;
  importModalConfirmBtn.textContent = "Importing…";
  try {
    const entries = Object.entries(importPendingPayload.files).filter(([f]) => BACKUP_FILES.includes(f));
    for (const [filename, content] of entries) {
      const res  = await api("/putMemoryFile", "POST", { filename, content });
      const data = await res.json();
      if (!data.ok) throw new Error(`Failed to write ${filename}`);
    }

    // Restore photos if present in payload
    const photoEntries = Object.entries(importPendingPayload.photos || {});
    let photosDone = 0;
    if (photoEntries.length) {
      appendMessage("system", t("chat.photo-restore-progress", { done: 0, total: photoEntries.length }));
      const lastMsg = document.querySelector(".messages .message.system:last-child");
      for (const [fn, b64] of photoEntries) {
        try {
          const ext = fn.split(".").pop() || "jpg";
          const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
          const mimeType = mimeMap[ext] || "image/jpeg";
          const r = await api("/uploadPhoto", "POST", { filename: fn, imageBase64: b64, mimeType, skipIncrement: true });
          const d = await r.json();
          if (d.ok) {
            photosDone++;
            if (lastMsg) lastMsg.textContent = t("chat.photo-restore-progress", { done: photosDone, total: photoEntries.length });
          }
        } catch {}
      }
    }

    closeImportModal();
    const photoNote = photoEntries.length
      ? photosDone === photoEntries.length
        ? ` · ${t("chat.photo-restore-all", { n: photosDone })}`
        : photosDone === 0
          ? ` · ${t("chat.photo-restore-none")}`
          : ` · ${t("chat.photo-restore-partial", { done: photosDone, total: photoEntries.length })}`
      : "";
    appendMessage("system", `Import complete — ${entries.length} files restored${photoNote}.\nReloading your memories…`);
    setTimeout(() => startSession(true), 1500);
  } catch (err) {
    showImportError2(`Import failed: ${err.message}`);
    importModalConfirmBtn.disabled = false;
    importModalConfirmBtn.textContent = "Overwrite Memory";
  }
});

// ---- API ----
async function api(path, method = "GET", body = null, auth = true, signal = null) {
  const headers = { "Content-Type": "application/json" };
  if (auth && session?.token) headers["X-Session-Token"] = session.token;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  if (signal) opts.signal = signal;
  return fetch(config.url + path, opts);
}

// ---- Attachment handling ----

const SUPPORTED_TYPES = ["image/jpeg","image/png","image/gif","image/webp","application/pdf","text/plain"];
const OFFICE_EXTS = /\.(docx?|xlsx?|pptx?|odt|ods)$/i;

function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    if (OFFICE_EXTS.test(file.name)) {
      reject(new Error("Word/Excel files aren't supported. Please save as PDF first.")); return;
    }
    if (!SUPPORTED_TYPES.includes(file.type)) {
      reject(new Error(`File type "${file.type || file.name.split('.').pop()}" not supported. Use images, PDF, or TXT.`)); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error("File too large (max 10 MB). Try compressing it first.")); return;
    }
    if (file.type === "text/plain") {
      const reader = new FileReader();
      reader.onload = e => resolve({ type: "text", text: e.target.result, name: file.name });
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        const dataUrl = e.target.result;
        const base64 = dataUrl.split(",")[1];
        resolve({ type: file.type.startsWith("image/") ? "image" : "document",
          mimeType: file.type, base64, dataUrl, name: file.name });
      };
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsDataURL(file);
    }
  });
}

const MAX_ATTACHMENTS = 5;

async function handleFileInput(file) {
  if (pendingAttachments.length >= MAX_ATTACHMENTS) {
    showToast(t("toast.max-attachments", { n: MAX_ATTACHMENTS }));
    return;
  }
  try {
    const att = await readFileAsAttachment(file);
    pendingAttachments.push(att);
    rebuildAttachmentPreviews();
    inputEl.focus();
  } catch (err) {
    showToast(err.message);
  }
}

function rebuildAttachmentPreviews() {
  attachmentPreview.innerHTML = "";
  if (!pendingAttachments.length) {
    attachmentPreview.classList.add("hidden");
    inputEl.placeholder = t("chat.input-placeholder");
    attachBtn.classList.remove("has-file");
    return;
  }
  pendingAttachments.forEach((att, idx) => {
    const card = document.createElement("div");
    card.className = "attachment-card";
    if (att.type === "image") {
      const img = document.createElement("img");
      img.src = att.dataUrl;
      img.className = "attachment-thumb-img";
      img.alt = att.name;
      card.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "attachment-thumb-label";
      icon.textContent = (att.type === "document" ? "📄 " : "📝 ") + att.name;
      card.appendChild(icon);
    }
    const removeBtn = document.createElement("button");
    removeBtn.className = "attachment-clear-btn";
    removeBtn.title = t("tooltip.remove");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      pendingAttachments.splice(idx, 1);
      rebuildAttachmentPreviews();
    });
    card.appendChild(removeBtn);
    attachmentPreview.appendChild(card);
  });
  attachmentPreview.classList.remove("hidden");
  inputEl.placeholder = t("chat.attach-placeholder");
  attachBtn.classList.toggle("has-file", pendingAttachments.length > 0);
}

function updateContextAttachBar() {
  if (attachmentsInHistory.length === 0) {
    contextAttachBar.classList.add("hidden");
    return;
  }
  const names = attachmentsInHistory.map(a => a.name).join(", ");
  const imageCount = attachmentsInHistory.filter(a => a.type === "image").length;
  let msg = `${names} in context`;
  if (imageCount > 0) {
    msg += ` · ⚠ ${imageCount} image${imageCount > 1 ? "s" : ""} cost tokens every turn`;
  }
  msg += " · /cls to clear";
  contextAttachNames.textContent = msg;
  contextAttachBar.classList.remove("hidden");
}

function updateVaultBar() {
  const bar = document.getElementById("vault-context-bar");
  const label = document.getElementById("vault-context-label");
  if (!bar || !label) return;
  if (pendingRecallContext) {
    label.textContent = pendingRecallContext.section;
    bar.classList.remove("hidden");
  } else {
    bar.classList.add("hidden");
  }
}

function updateDeepRecordBadge(count) {
  const badge = document.getElementById("deep-record-badge");
  const countEl = document.getElementById("deep-record-count");
  if (!badge || !countEl) return;
  if (count > 0) {
    countEl.textContent = count;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

async function refreshDeepBadge() {
  try {
    const res = await api("/healthz", "GET");
    const data = await res.json();
    if (data.ok) updateDeepRecordBadge(data.deepRecordCount || 0);
  } catch {}
}

function clearAttachment() {
  pendingAttachments = [];
  attachmentPreview.innerHTML = "";
  attachmentPreview.classList.add("hidden");
  inputEl.placeholder = "Ask your memory...";
  attachBtn.classList.remove("has-file");
  fileInput.value = "";
}

function appendAttachmentThumbs(atts) {
  const el = document.createElement("div");
  el.className = "message user attachment-msg";
  for (const att of atts) {
    if (att.type === "image") {
      const img = document.createElement("img");
      img.src = att.dataUrl;
      img.className = "chat-thumb";
      el.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "chat-doc-label";
      span.textContent = (att.type === "document" ? "📄 " : "📝 ") + att.name;
      el.appendChild(span);
    }
  }
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ■ Stop button — aborts in-flight streaming response
stopBtn.addEventListener("click", () => {
  if (convChatAbort) { convChatAbort.abort(); convChatAbort = null; }
});

// + button — triggers file picker (works on desktop, iOS, Android)
attachBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files);
  if (!files.length) return;
  for (const file of files) await handleFileInput(file);
  inputEl.focus();
  fileInput.value = ""; // reset so same file can be re-selected
});

// ---- Contacts Import (.vcf / .csv) ----

function parseVcf(text) {
  const contacts = [];
  const cards = text.split(/BEGIN:VCARD/i).slice(1);
  for (const card of cards) {
    const get = (key) => {
      const m = card.match(new RegExp(`^${key}[^:]*:(.+)$`, "im"));
      return m ? m[1].replace(/\\n/g, " ").replace(/\\,/g, ",").trim() : "";
    };
    const getAll = (key) => {
      const re = new RegExp(`^${key}[^:]*:(.+)$`, "gim");
      return [...card.matchAll(re)].map(m => m[1].replace(/\\n/g, " ").trim());
    };
    let name = get("FN");
    if (!name) {
      const n = get("N").split(";");
      name = [n[1], n[0]].filter(Boolean).join(" ").trim();
    }
    if (!name) continue;
    const phones = getAll("TEL");
    const emails = getAll("EMAIL");
    const org = get("ORG").split(";")[0].trim();
    const bday = get("BDAY").replace(/\D/g, "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    contacts.push({ name, phones, emails, org, bday });
  }
  return contacts;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const idx = (keys) => keys.map(k => headers.findIndex(h => h.includes(k))).find(i => i >= 0) ?? -1;
  const iFirst = idx(["first name", "first"]);
  const iLast = idx(["last name", "last", "surname"]);
  const iName = idx(["name", "full name", "display name"]);
  const iEmail = idx(["email", "e-mail"]);
  const iPhone = idx(["phone", "mobile", "tel", "cell"]);
  const iOrg = idx(["company", "organization", "org"]);
  const contacts = [];
  for (const line of lines.slice(1)) {
    const cols = (() => {
      const out = []; let i = 0;
      while (i <= line.length) {
        if (line[i] === '"') {
          let j = i + 1;
          while (j < line.length && !(line[j] === '"' && line[j+1] !== '"')) j++;
          out.push(line.slice(i+1, j).replace(/""/g, '"').trim());
          i = j + 2; // skip closing quote + comma
        } else {
          const c = line.indexOf(',', i);
          if (c === -1) { out.push(line.slice(i).trim()); break; }
          out.push(line.slice(i, c).trim());
          i = c + 1;
        }
      }
      return out;
    })();
    let name = "";
    if (iName >= 0) name = cols[iName] || "";
    if (!name && iFirst >= 0) name = [cols[iFirst], iLast >= 0 ? cols[iLast] : ""].filter(Boolean).join(" ").trim();
    if (!name) continue;
    const phone = iPhone >= 0 ? cols[iPhone] || "" : "";
    const email = iEmail >= 0 ? cols[iEmail] || "" : "";
    const org = iOrg >= 0 ? cols[iOrg] || "" : "";
    contacts.push({ name, phones: phone ? [phone] : [], emails: email ? [email] : [], org, bday: "" });
  }
  return contacts;
}

function contactToSection(c) {
  const today = new Date().toLocaleDateString("en-CA");
  const tags = ["personal, contact"];
  if (c.org) tags[0] = "work, contact";
  let md = `## ${c.name}\n– Tags: ${tags[0]}\n– Intent: imported contact\n`;
  if (c.org) md += `\n### Work\n${c.org}\n`;
  const contactLines = [
    ...c.phones.map((p, i) => `– ${i === 0 ? "Mobile" : "Phone " + (i + 1)}: ${p}`),
    ...c.emails.map((e, i) => `– ${i === 0 ? "Email" : "Email " + (i + 1)}: ${e}`),
  ];
  if (contactLines.length) md += `\n### Contact\n${contactLines.join("\n")}\n`;
  if (c.bday) md += `\n### Family\n– Birthday: ${c.bday}\n`;
  md += `\n### Timeline\n– **${today}**: Imported from contacts\n`;
  return md;
}

document.getElementById("import-contacts-input").addEventListener("change", async function() {
  const file = this.files[0];
  if (!file) return;
  this.value = "";
  const text = await file.text();
  const isVcf = file.name.toLowerCase().endsWith(".vcf");
  const contacts = isVcf ? parseVcf(text) : parseCsv(text);
  if (!contacts.length) {
    appendMessage("system", `No contacts found in ${file.name}. Make sure it's a vCard (.vcf) or CSV export from your contacts app.`);
    return;
  }

  // Volume guard — show count + token estimate and require confirmation
  const estTokens = Math.round(contacts.length * 40);
  let warningLine = "";
  if (contacts.length > 100) {
    warningLine = `\nEstimated token addition: ~${estTokens.toLocaleString()} tokens.`;
    if (contacts.length > 300) warningLine += " Consider importing a smaller batch if memory is near capacity.";
  }

  const confirmed = await new Promise(resolve => {
    const msgEl = appendMessage("system",
      `Found ${contacts.length} contact${contacts.length !== 1 ? "s" : ""} in ${file.name}.${warningLine}`);
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;margin-top:10px;";
    const importBtn = document.createElement("button");
    importBtn.className = "source-btn";
    importBtn.textContent = `Import ${contacts.length}`;
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "source-btn";
    cancelBtn.style.opacity = "0.6";
    cancelBtn.textContent = "Cancel";
    btnRow.appendChild(importBtn);
    btnRow.appendChild(cancelBtn);
    msgEl.appendChild(btnRow);
    importBtn.addEventListener("click", () => { msgEl.remove(); resolve(true); });
    cancelBtn.addEventListener("click", () => { msgEl.remove(); resolve(false); });
  });

  if (!confirmed) return;

  const progressMsg = appendMessage("system", `Importing 1 / ${contacts.length}…`);
  let added = 0, skipped = 0, failed = 0;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    progressMsg.textContent = `Importing ${i + 1} / ${contacts.length} — ${c.name}`;
    try {
      const res = await api("/insertSection", "POST", {
        filename: "people.md",
        section: contactToSection(c),
        ifExists: "skip",
      });
      const d = await res.json();
      if (d.ok && d.skipped) skipped++;
      else if (d.ok) added++;
      else failed++;
    } catch { failed++; }
  }
  progressMsg.remove();
  const parts = [];
  if (added) parts.push(`${added} new record${added !== 1 ? "s" : ""} added`);
  if (skipped) parts.push(`${skipped} already existed (skipped)`);
  if (failed) parts.push(`${failed} failed`);
  appendMessage("system", `✓ Import done — ${parts.join(", ")}. Type /edit to browse or update any record.`);
});

// Drag & drop
chatScreen.addEventListener("dragenter", e => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.remove("hidden");
});
chatScreen.addEventListener("dragleave", () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.add("hidden"); }
});
chatScreen.addEventListener("dragover", e => e.preventDefault());
chatScreen.addEventListener("drop", async e => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.add("hidden");
  const file = e.dataTransfer.files[0];
  if (file) await handleFileInput(file);
});

// Paste (images from clipboard) — works even when the chat input has focus
document.addEventListener("paste", async e => {
  const imageItem = Array.from(e.clipboardData.items)
    .find(i => i.kind === "file" && i.type.startsWith("image/"));
  if (!imageItem) return; // text paste — let browser handle normally
  e.preventDefault();
  const blob = imageItem.getAsFile();
  if (!blob) return;
  const ext = imageItem.type === "image/png" ? "png" : imageItem.type === "image/jpeg" ? "jpg" : "png";
  const file = new File([blob], `screenshot-${Date.now()}.${ext}`, { type: imageItem.type });
  await handleFileInput(file);
});

// ---- Utils ----
function hasSpeechRecognition() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}
function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
         (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function useWhisper() {
  return voiceInputPref === "whisper" || isIOS();
}

// One-time notice before the first voice session in Auto mode.
//
// Auto transcribes with the browser's own Web Speech Recognition API, which on
// Chrome and Edge is NOT on-device — the browser streams the clip to Google's
// speech service along with this site's domain. That path never touches the
// Worker, so it falls outside the "your notes stay in your Cloudflare account"
// boundary the rest of the app maintains. Users who speak a client's name into
// voice mode deserve to know that before they do it, not afterwards.
//
// Deliberately placed here rather than in Settings: the decision that matters
// happens when someone starts talking, not when they browse preferences.
// iOS never sees this — useWhisper() is always true there (no Web Speech API).
// Returns true if the notice was shown, in which case the caller must NOT open
// conv mode; each button re-calls enterConvMode() once the choice is recorded.
function maybeShowVoicePrivacyNotice() {
  if (useWhisper()) return false;
  // A throwing/erased localStorage means we can't record having shown this, and
  // a notice that reappears every session is worse than one that never does.
  try { if (localStorage.getItem(VOICE_PRIVACY_KEY)) return false; } catch { return false; }

  appendMessage("system", t("voice.privacy.body"));
  const hint = document.createElement("div");
  hint.className = "archive-hint";
  hint.innerHTML = `<button class="archive-hint-btn">${t("voice.privacy.switch")}</button>` +
                   `<button class="archive-hint-btn recall-hint-btn">${t("voice.privacy.keep")}</button>`;
  const record = () => {
    hint.remove();
    try { localStorage.setItem(VOICE_PRIVACY_KEY, "1"); } catch {}
  };
  hint.querySelector(".archive-hint-btn").addEventListener("click", () => {
    record();
    voiceInputPref = "whisper";
    try { localStorage.setItem(VOICE_INPUT_KEY, "whisper"); } catch {}
    if (panelVoiceInput) panelVoiceInput.value = "whisper";
    showToast(t("voice.privacy.switched"));
    enterConvMode();
  });
  hint.querySelector(".recall-hint-btn").addEventListener("click", () => {
    record();
    enterConvMode();
  });
  messagesEl.appendChild(hint);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return true;
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let _workingBytes = 0;
let _archiveBytes = 0;
let _contextTokens = 0;     // total input tokens from the last chat response
let _historyTokens = 0;     // history portion at last response = _contextTokens − memTokensAtThatTurn

function updateMemoryBadge(workingBytes) {
  _workingBytes = workingBytes;
  const TOKEN_CAP = 180000;
  const baseMemBytes = archiveMode === 1 ? workingBytes + _archiveBytes : workingBytes;
  const baseMemTokens = Math.round(baseMemBytes / 4);

  // A cold storage record loaded via "Use in chat" rides on every subsequent
  // chat turn until cleared, so it's an additional token cost we should show.
  // _historyTokens won't reflect it until after the first chat turn fires.
  const vaultBytes = pendingRecallContext ? pendingRecallContext.content.length : 0;
  const vaultTokens = Math.round(vaultBytes / 4);

  // Total = current live memory + pending vault context + last known history.
  // Toggling archive or loading a vault record recomputes immediately;
  // history stays grounded in the most recent real chat-turn measurement.
  const totalTokens = baseMemTokens + vaultTokens + _historyTokens;
  const pct = totalTokens / TOKEN_CAP;
  const pctLabel = Math.round(pct * 100) + "%";
  const color = pct >= 0.9 ? "var(--red)" : pct >= 0.7 ? "var(--amber)" : "var(--green)";
  const badge = document.getElementById("memory-badge");
  if (badge) {
    badge.textContent = pctLabel;
    badge.style.color = color;
    const totalK = Math.round(totalTokens / 1000);
    const memK = Math.round(baseMemTokens / 1000);
    const vaultK = Math.round(vaultTokens / 1000);
    const histK = Math.round(_historyTokens / 1000);
    const parts = [t("tooltip.badge-part-memory", { n: memK })];
    if (vaultTokens > 0) parts.push(t("tooltip.badge-part-vault", { n: vaultK }));
    if (_historyTokens > 0) parts.push(t("tooltip.badge-part-history", { n: histK }));
    badge.title = parts.length === 1
      ? t("tooltip.badge-memory-only", { totalK, pct: pctLabel })
      : t("tooltip.badge-breakdown", { totalK, pct: pctLabel, parts: parts.join(" + ") });
  }

  // Mirror the indicator into the conversation overlay
  const colorClass = pct >= 0.9 ? "red" : pct >= 0.7 ? "amber" : "";
  if (convCtxPct) {
    convCtxPct.textContent = pctLabel;
    convCtxPct.className = "conv-ctx-pct" + (colorClass ? " " + colorClass : "");
    const totalK  = Math.round(totalTokens / 1000);
    const memK    = Math.round(baseMemTokens / 1000);
    const vaultK  = Math.round(vaultTokens / 1000);
    const histK   = Math.round(_historyTokens / 1000);
    const parts   = [t("tooltip.badge-part-memory", { n: memK })];
    if (vaultTokens > 0) parts.push(t("tooltip.badge-part-vault", { n: vaultK }));
    if (_historyTokens > 0) parts.push(t("tooltip.badge-part-history", { n: histK }));
    const breakdown = parts.length > 1
      ? t("tooltip.badge-breakdown", { totalK, pct: pctLabel, parts: parts.join(" + ") })
      : t("tooltip.badge-memory-only", { totalK, pct: pctLabel });
    convCtxPct.title = breakdown + t("tooltip.conv-ctx-suffix");
  }
  if (convResetCtxBtn) {
    convResetCtxBtn.className = "conv-reset-ctx-btn" + (colorClass ? " " + colorClass : "");
  }
}

document.getElementById("memory-badge").addEventListener("click", () => {
  sendMessage("/diagnostics");
});

document.getElementById("deep-record-badge").addEventListener("click", () => {
  inputEl.value = "";
  inputEl.style.height = "auto";
  hideCmdSuggestions();
  sendMessage("/recall", false, true);
});

// ---- Android keyboard / Visual Viewport fix ----
// Keeps the preview overlay above the keyboard on Android Chrome
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    const keyboardHeight = window.innerHeight - window.visualViewport.height;
    previewOverlay.style.bottom = keyboardHeight > 0 ? `${keyboardHeight}px` : "";
  });
}

// ---- Reset Memory Modal ----

function updateResetBtn() {
  resetConfirmBtn.disabled = !(resetAccessKey.value.trim() && resetConfirmWord.value.toLowerCase() === "reset");
}

resetAccessKey.addEventListener("input", updateResetBtn);
resetConfirmWord.addEventListener("input", updateResetBtn);

resetCancelBtn.addEventListener("click", () => resetModal.classList.add("hidden"));

resetConfirmBtn.addEventListener("click", async () => {
  const key = resetAccessKey.value.trim();
  const newName = resetNewName.value.trim();
  resetConfirmBtn.disabled = true;
  resetConfirmBtn.textContent = "Resetting…";
  resetError.classList.add("hidden");
  try {
    const res = await fetch(config.url + "/resetMemory", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Key": key,
        ...(session?.token ? { "X-Session-Token": session.token } : {}),
      },
      body: JSON.stringify(newName ? { newName } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || "Reset failed.");
    resetModal.classList.add("hidden");
    localStorage.removeItem("whoszoo_welcomed");
    localStorage.removeItem("whoszoo_intro_seen");
    appendMessage("system", "Memory system reset. Reloading…");
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    resetError.textContent = err.message;
    resetError.classList.remove("hidden");
    resetConfirmBtn.disabled = false;
    resetConfirmBtn.textContent = "Reset Memory";
  }
});

// Attach a show/hide eye toggle to every passphrase input. Single-source helper
// so adding new password fields elsewhere is just an ID-list update — no HTML
// repetition. Tabindex -1 keeps tab order focused on the actual inputs.
function attachPasswordEye(input) {
  if (!input || input.dataset.eyeAttached) return;
  input.dataset.eyeAttached = "1";
  const wrap = document.createElement("div");
  wrap.className = "password-field";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.tabIndex = -1;
  btn.className = "password-eye";
  btn.setAttribute("aria-label", "Show passphrase");
  btn.title = t("tooltip.show-passphrase");
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  btn.addEventListener("click", () => {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.classList.toggle("showing", !showing);
    const label = showing ? "Show passphrase" : "Hide passphrase";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  });
  wrap.appendChild(btn);
}
// All password-type inputs across the app get the same SVG eye toggle — the
// canonical show/hide affordance. Backup-modal inputs (export/import/reset/
// access-key gate) and API-key inputs (anthropic/openai/elevenlabs) used to
// have a separate text "show" button or no toggle at all; consolidated here
// so every secret field has the same look.
[
  "login-passphrase", "setup-passphrase", "setup-passphrase-confirm",
  "cp-current", "cp-new", "cp-confirm",
  "access-key-gate-input", "reset-access-key",
  "export-pw", "export-pw2", "import-pw",
  "apikey-anthropic", "apikey-openai", "apikey-elevenlabs",
].forEach(id => attachPasswordEye(document.getElementById(id)));

init();
