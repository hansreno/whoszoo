// WhosWhoZoo — Locale strings v1.8.13
// Supported: en (default), es, fr, hi
// Non-English strings are auto-translated and marked "// needs-review" until human-verified.
// Add new keys to "en" first; run lang-sync agent to propagate to other locales.

const LOCALES = {
  en: {
    // ---- Setup screen ----
    "setup.subtitle-new":       "Connect your memory to get started.",
    "setup.subtitle-recovery":  "Enter your Access Key to reset your passphrase.",
    "setup.privacy-note":       "Your notes are stored in your own private account — never used to train AI, and never sent to us.",
    "setup.label-worker-url":   "Worker URL",
    "setup.label-access-key":   "Access Key",
    "setup.label-access-key-hint": "(from setup)",
    "setup.label-passphrase":   "Choose a passphrase",
    "setup.label-confirm":      "Confirm passphrase",
    "setup.ph-worker-url":      "https://your-worker.workers.dev",
    "setup.ph-access-key":      "Paste your access key",
    "setup.ph-passphrase":      "At least 12 characters",
    "setup.ph-confirm":         "Confirm passphrase",
    "setup.btn-setup":          "Set Up",
    "setup.btn-setup-loading":  "Setting up…",
    "setup.link-how":           "How does this work? →",

    // ---- Login screen ----
    "login.subtitle-new-visitor": "WhosWhoZoo is a personal memory app — each user runs their own copy. Sign in if this is yours, or visit whoszoo.app to set up your own.",
    "login.subtitle-returning": "Welcome back. Enter your passphrase to continue.",
    "login.label-passphrase":   "Passphrase",
    "login.ph-passphrase":      "Enter your passphrase",
    "login.btn-unlock":         "Unlock",
    "login.btn-unlock-loading": "Unlocking…",
    "login.btn-biometric":      "Use fingerprint",
    "login.btn-forgot":         "Forgot passphrase? Use access key to reset →",

    // ---- Settings panel ----
    "settings.title":           "Settings",
    "settings.btn-back":        "← Back to app",
    "settings.btn-change-passphrase": "Change passphrase",
    "settings.btn-signout":     "Sign out",
    "settings.btn-help":        "Help & docs",
    // "Recommend … to a friend" anchors the object of the action outside the
    // user's own memory. Never shorten this to "Share" — that word is
    // overloaded in software (share access, share a file) and is the one most
    // likely to make someone wonder whether tapping it exposes their notes.
    "settings.btn-share":       "Recommend WhosWhoZoo to a friend",
    // Must NOT contain the URL: navigator.share() takes text and url as
    // separate fields and composes them, so an embedded link would appear
    // twice. The clipboard fallback appends SHARE_URL itself.
    // Leads with the concrete benefit, not the architecture — a cold recipient
    // decides in about five seconds and "your own account" means nothing to
    // them yet. Says "no subscription" rather than "$39": a number goes stale
    // across four locales in a shipped build, and quoting a price makes a
    // personal recommendation read like an ad.
    "settings.share-message":   "WhosWhoZoo — a personal memory app. I tell it things worth remembering — people, conversations, loose ends — and ask it later.",
    "settings.share-copied":    "Message copied — links to whoszoo.app",
    "settings.share-failed":    "Couldn't copy — the link is whoszoo.app",
    "settings.access-key-note": "Access Key can be rotated at <a href='https://whoszoo.app/setup' target='_blank' rel='noopener'>whoszoo.app/setup</a>",
    "settings.label-voice":        "Voice input",
    "settings.opt-auto":           "Auto",
    "settings.opt-whisper":        "Whisper (accurate)",
    "voice.privacy.body":          "🎙 One quick note before your first voice session: Auto mode is fast and free, but on Chrome and Edge it sends your clip to Google's speech service — not through your own Worker. Fine trade for everyday questions. Speaking about something confidential? Whisper routes the audio through your Worker to OpenAI instead, under no-training terms — a fraction of a cent per clip. Switch anytime in Settings → Voice input.",
    "voice.privacy.switch":        "🔒 Use Whisper instead",
    "voice.privacy.keep":          "⚡ Keep Auto",
    "voice.privacy.switched":      "Switched to Whisper",
    "settings.label-whisper-lang": "Voice language",
    "settings.label-autolock":     "Auto-lock",
    "settings.opt-never":       "Never",
    "settings.opt-on":          "On",
    "settings.opt-off":         "Off",
    "settings.label-cap":       "Daily spend cap",
    "settings.label-token-saver":  "Token Saver",
    "settings.hint-token-saver":   "Clears conversation history when you exit voice mode.",
    "settings.label-language":  "Language",
    "settings.toggle-advanced": "Advanced",
    "settings.toggle-apikeys":  "API Keys",
    "settings.label-worker-url-adv":  "Worker URL",
    "settings.hint-worker-url-adv":   "Only change this if you redeployed to a new address.",
    "settings.btn-test-save":         "Test & Save",
    "settings.btn-test-save-loading": "Testing…",
    "settings.hint-apikeys":    "Write-only — values are stored on your worker. Leave blank to keep the current key.",
    "settings.apikey-source-setup": "✓ Using key from setup",
    "settings.apikey-source-app":   "✓ Using key saved here",
    "settings.apikey-not-configured": "Not configured",
    "settings.apikey-btn-save":         "Save",
    "settings.apikey-btn-save-loading": "Saving…",
    "settings.apikey-btn-clear":         "Clear override",
    "settings.apikey-btn-clear-loading": "Clearing…",
    "settings.apikey-cleared":   "Cleared — using install key.",
    "settings.apikey-enter-value": "Enter a key value.",
    "settings.apikey-saved":     "Saved.",
    "settings.fingerprint-unavailable": "Fingerprint unlock",
    "settings.fingerprint-unavailable-badge": "not available on this browser",
    "settings.fingerprint-setup": "Set up fingerprint unlock",
    "settings.fingerprint-remove-badge": "✓ Remove",
    "settings.btn-install":         "Install to home screen",
    "settings.install-done-badge": "✓ Installed",
    "settings.install-retry":      "Not ready yet on this page — try reloading.",
    "settings.fingerprint-setup-loading": "Setting up…",

    // ---- Change passphrase sub-form ----
    "cp.label-current":  "Current passphrase",
    "cp.label-new":      "New passphrase",
    "cp.label-confirm":  "Confirm new passphrase",
    "cp.ph-current":     "Current passphrase",
    "cp.ph-new":         "At least 12 characters",
    "cp.ph-confirm":     "Confirm new passphrase",
    "cp.btn-update":     "Update passphrase",
    "cp.btn-back":       "← Back to settings",

    // ---- Installer link ----
    "install.get-title": "Get set up →",
    "install.get-sub":   "whoszoo.app — setup wizard, install guide, and how it works",

    // ---- Loading screen ----
    "loading.text": "Loading your memories...",

    // ---- Chat UI ----
    "chat.cold-storage-cleared": "Cold storage record cleared from context.",
    "chat.cleared":              "Chat cleared. Memory still loaded.",
    "chat.biometric-offer":      "Enable fingerprint unlock to sign in without typing your passphrase next time.",
    "chat.input-placeholder":    "Ask your memory...",
    "chat.attach-placeholder":   "Add instructions for the attached file...",
    "chat.last-login":           "Last login: {time}",
    "chat.bulk-since-login":     "⚠ {count} data export/import since your last login: {actions}. If that wasn't you, change your passphrase now.",
    "security.method.passphrase":"passphrase",
    "security.method.biometric": "biometric",
    "security.method.setup":     "initial setup",
    "security.method.recovery":  "Access Key recovery",
    "security.method.failed":    "failed attempt",
    "security.method.export":    "encrypted export",
    "security.method.export-plain":"PLAIN-TEXT export",
    "security.method.import":    "import (memory overwritten)",
    "modal.reauth-title":        "Confirm it's you",
    "modal.reauth-desc":         "This creates or restores a complete copy of your memory. Enter your passphrase to continue.",
    "modal.reauth-ph":           "Enter your passphrase",
    "modal.reauth-wrong":        "Passphrase incorrect.",
    "chat.audit-ignored-time":   "· ignored {time}",
    "chat.photo-one-at-a-time":    "⚠ Please add photos one at a time — attach one image per message and ask me to save it.",
    "chat.photo-data-unavailable": "⚠ Photo data not available — please attach the photo and ask again.",
    "chat.photo-r2-required":      "⚠ Photos require R2 storage. See Help & docs → R2 setup — it's free on Cloudflare's free tier.",
    "chat.photo-upload-failed":    "⚠ Photo upload failed: {error}",
    "chat.photo-added":            "📷 Photo added to {name}'s record.",
    "chat.photo-saved-partial":    "⚠ Photo saved to storage but could not update {name}'s record: {error}. Manually add – Photo: {filename} to their ### Photos section.",
    "chat.photo-save-failed":      "⚠ Photo save failed: {error}",
    "chat.photo-zip-summary":      "ZIP exported — {done}/{total} photo(s) included.",
    "chat.photo-restore-progress": "Restoring photos ({done} of {total})…",
    "chat.photo-restore-all":      "{n} photo(s) restored",
    "chat.photo-restore-none":     "⚠ Photos not restored — R2 storage not configured on this worker",
    "chat.photo-restore-partial":  "{done}/{total} photo(s) restored (some failed)",
    "time.days-ago-one":         "1 day ago",
    "time.days-ago-many":        "{n} days ago",
    "time.hours-ago-one":        "1 hour ago",
    "time.hours-ago-many":       "{n} hours ago",
    "time.just-now":             "just now",

    // ---- Modals — Preview ----
    "modal.preview-title": "Memory Preview",
    "modal.btn-cancel":    "Cancel",
    "modal.btn-save":      "Save",

    // ---- Modals — Archive Review ----
    "modal.archive-title":      "Archive Review",
    "modal.btn-archive-cancel": "Cancel",
    "modal.btn-archive-confirm": "Archive Selected ({n})",

    // ---- Modals — Cold Storage Review ----
    "modal.deep-title":      "Cold Storage Review",
    "modal.btn-deep-cancel": "Cancel",
    "modal.btn-deep-confirm": "Move to Cold Storage ({n})",

    // ---- Modals — Compact Review ----
    "modal.compact-title":      "Compact Review",
    "modal.btn-compact-cancel": "Cancel",
    "modal.btn-compact-confirm": "Compact Selected ({n})",
    "compact.tally-one":        "1 preview loaded · est. ¢{cost}",
    "compact.tally-many":       "{n} previews loaded · est. ¢{cost}",

    // ---- Modals — Edit ----
    "modal.edit-title":      "Edit Record",
    "modal.btn-edit-cancel": "Cancel",
    "modal.btn-edit-save":   "Save",
    "modal.btn-edit-delete": "Delete record",
    "modal.btn-move":        "Move",

    // ---- Modals — Delete ----
    "modal.delete-title":       "Delete Record",
    "modal.delete-warning":     "This permanently removes the record from memory. Cannot be undone.",
    "modal.delete-confirm-hint": "Type delete to confirm",
    "modal.delete-ph":          "Type \"delete\" to confirm",
    "modal.btn-delete-cancel":  "Cancel",
    "modal.btn-delete-confirm": "Delete",

    // ---- Modals — Access Key Gate ----
    "modal.btn-access-cancel": "Cancel",
    "modal.btn-access-confirm": "Continue",

    // ---- Modals — Export Zip ----
    "modal.export-zip-title":        "Export Plain Text Files",
    "modal.export-zip-confirm-hint": "Type unencrypted to confirm you understand.",
    "modal.export-zip-ph":           "Type \"unencrypted\" to confirm",
    "modal.btn-export-zip-cancel":   "Cancel",
    "modal.btn-export-zip-confirm":  "Download Zip",

    // ---- Modals — Reset ----
    "modal.reset-title":       "Reset Memory System",
    "modal.reset-confirm-hint": "Type reset to confirm",
    "modal.reset-ph":          "Type \"reset\" to confirm",
    "modal.reset-name-hint":   "New name for this system",
    "modal.reset-name-ph":     "First name",
    "modal.btn-reset-cancel":  "Cancel",
    "modal.btn-reset-confirm": "Reset Memory",

    // ---- Modals — Export Backup ----
    "modal.export-title":       "Export Memory Backup",
    "modal.export-ph-pw":       "Password",
    "modal.export-ph-pw2":      "Confirm password",
    "modal.btn-export-cancel":  "Cancel",
    "modal.btn-export-confirm": "Export",
    "modal.export-include-photos":      "Include photos",
    "modal.export-include-photos-hint": "Uncheck for a smaller file — your photos stay safe in R2.",

    // ---- Modals — Import Backup ----
    "modal.import-title":       "Import Memory Backup",
    "modal.import-ph-pw":       "Backup password",
    "modal.btn-import-cancel":  "Cancel",
    "modal.btn-import-decrypt": "Decrypt",
    "modal.btn-import-back":    "← Back",
    "modal.btn-import-cancel2": "Cancel",
    "modal.btn-import-confirm": "Overwrite Memory",

    // ---- Drop overlay ----
    "drop.label": "Drop file to attach",
    "drop.sub":   "Images · PDF · TXT",

    // ---- Toast messages ----
    "toast.fill-worker-key":          "Please fill in the Worker URL and access key.",
    "toast.passphrase-too-short":     "Passphrase must be at least 12 characters.",
    "toast.passphrase-mismatch":      "Passphrases don't match.",
    "toast.enter-passphrase":         "Enter your passphrase.",
    "toast.no-passphrase-set":        "No passphrase set yet. Use access key to set up.",
    "toast.incorrect-passphrase":     "Incorrect passphrase.",
    "toast.connection-failed":        "Could not reach server — check your connection.",
    "toast.worker-fetch-failed":      "Could not reach worker — check the URL.",
    "toast.worker-url-saved":         "Worker URL saved.",
    "toast.url-empty":                "URL cannot be empty.",
    "toast.url-unreachable":          "Can't reach that URL. Check the address and try again.",
    "toast.fingerprint-enabled":      "Fingerprint unlock enabled.",
    "toast.fingerprint-removed":      "Fingerprint unlock removed.",
    "toast.fingerprint-remove-failed":"Could not remove biometric. Try again.",
    "toast.current-passphrase-required": "Enter your current passphrase.",
    "toast.new-passphrase-too-short": "New passphrase must be at least 12 characters.",
    "toast.new-passphrase-mismatch":  "New passphrases don't match.",
    "toast.nothing-to-copy":          "Nothing to copy.",
    "toast.conversation-copied":      "Conversation copied.",
    "toast.copy-failed":              "Copy failed — try selecting manually.",
    "toast.context-reset":            "Context reset — memory still loaded.",
    "toast.mic-denied":               "Microphone access denied.",
    "toast.transcription-failed":     "Transcription failed — check your OpenAI key.",
    "toast.max-attachments":          "Max {n} attachments per message.",
    "toast.attach-add-instructions":  "Add instructions for the attached file before sending.",
    "toast.archive-on":               "Filing cabinet on — older records included in chat and search.",
    "toast.archive-off":              "Filing cabinet off — active memory only.",
    "toast.autolock-disabled":        "Auto-lock disabled.",
    "toast.autolock-set":             "Auto-lock set to {label}.",
    "toast.cap-disabled":             "Daily spend cap disabled.",
    "toast.cap-set":                  "Daily spend cap set to ${n}/day.",
    "toast.cap-save-failed":          "Couldn't save cap: {error}",
    "toast.model-sonnet":             "Switched to Sonnet (higher quality)",
    "toast.model-haiku":              "Switched to Haiku (lower cost)",
    "toast.voice-switched":           "Voice: {name}",
    "toast.voice-input-set":          "Voice input: {label}",
    "toast.photo-delete-failed":      "Could not delete photo: {error}",
    "cmd.desc.archive":                    "move a record to archive (fuzzy search)",
    "cmd.desc.archive-review":             "AI suggests archive candidates · add [file] [deep] [context]",
    "cmd.desc.archive-review-ignored":     "view and un-ignore dismissed archive suggestions",
    "cmd.desc.deep":                       "move a record to cold storage (rarely accessed tier)",
    "cmd.desc.deep-review":                "AI suggests cold storage candidates from long-term tier",
    "cmd.desc.deep-review-ignored":        "view and un-ignore dismissed deep-review suggestions",
    "cmd.desc.audit":                      "scan memory for integrity issues (quick scan, free)",
    "cmd.desc.audit-deep":                 "+ Haiku-assisted near-duplicate and name-mismatch detection (~3¢)",
    "cmd.desc.audit-ignored":              "view and un-ignore dismissed audit findings",
    "cmd.desc.restore":                    "restore a record from archive or cold storage back to active",
    "cmd.desc.cls":                        "clear visible chat AND reset Claude's context (drops conversation history)",
    "cmd.desc.compact":                    "compact a specific record — choose Normal/Medium/High in the preview",
    "cmd.desc.compact-review":             "surface verbose records across all four files",
    "cmd.desc.compact-review-people":      "surface verbose people.md records",
    "cmd.desc.compact-review-loops":       "surface verbose loops.md records",
    "cmd.desc.compact-review-fragments":   "surface verbose fragments.md records",
    "cmd.desc.compact-review-reflections": "surface verbose reflections.md records",
    "cmd.desc.browse-people":              "list all people.md records sorted by size",
    "cmd.desc.browse-loops":               "list all loops.md records sorted by size",
    "cmd.desc.browse-fragments":           "list all fragments.md records sorted by size",
    "cmd.desc.browse-reflections":         "list all reflections.md records sorted by size",
    "cmd.desc.browse-archive-people":      "list archived people sorted by size",
    "cmd.desc.browse-archive-loops":       "list archived loops sorted by size",
    "cmd.desc.browse-archive-fragments":   "list archived fragments sorted by size",
    "cmd.desc.browse-archive-reflections": "list archived reflections sorted by size",
    "cmd.desc.browse-cold-people":         "list cold-storage people sorted by size",
    "cmd.desc.browse-cold-loops":          "list cold-storage loops sorted by size",
    "cmd.desc.browse-cold-fragments":      "list cold-storage fragments sorted by size",
    "cmd.desc.browse-cold-reflections":    "list cold-storage reflections sorted by size",
    "cmd.desc.costs":                      "show today's and weekly Claude API cost estimate",
    "cmd.desc.delete":                     "permanently delete a record (requires typing delete)",
    "cmd.desc.diagnostics":                "system health: memory sizes, cost log, errors",
    "cmd.desc.security":                   "show recent login history (location, device, method)",
    "cmd.desc.edit":                       "edit a record directly (fuzzy search)",
    "cmd.desc.export":                     "download an encrypted backup of all memory files",
    "cmd.desc.export-plain":               "download a plain-text zip of all memory files (unencrypted)",
    "cmd.desc.help":                       "show available commands",
    "cmd.desc.import":                     "restore memory files from an encrypted backup or a plain-text zip",
    "cmd.desc.journal":                    "polish and save a journal entry to reflections.md",
    "cmd.desc.journal-flush":              "move journal entries older than 60 days to archive (add a number to override)",
    "cmd.desc.memory-game":                "start a people memory quiz",
    "cmd.desc.mnemonic":                   "[name] to generate · [name: your text] to save your own",
    "cmd.desc.l":                          "lock the app immediately",
    "cmd.desc.r":                          "drop conversation history (chat scroll stays · memory files stay loaded)",
    "cmd.desc.recall":                     "browse cold storage headings · ¢ with a search term",
    "cmd.desc.references":                 "find all records that mention a name or topic",
    "cmd.desc.import-contacts":             "import contacts from a .vcf (vCard) or .csv file — creates people.md records",
    "cmd.desc.reset":                      "wipe all memory files to blank templates (requires Access Key)",
    "tooltip.apikey-save":     "Write-only — once saved the value cannot be read back",
    "tooltip.apikey-clear":    "Removes your saved key and reverts to the key set during installation",
    "tooltip.deep-badge":      "Cold storage — tap to browse",
    "tooltip.cls-btn":         "Tap: clear chat (/cls) · Long-press: reset context (/r)",
    "tooltip.copy-chat":       "Copy conversation",
    "tooltip.settings":        "Settings",
    "tooltip.model-btn":       "Tap to switch model",
    "tooltip.archive-btn":     "Tap to include archive files in chat and search",
    "archive.label.off":       "📦 Archive: OFF",
    "archive.label.on":        "📦 Archive: ON",
    "archive.tip.off":         "Archive OFF — active memory only. Tap to include older archived records in chat and search.",
    "archive.tip.on":          "Archive ON — older records included in chat. Uses more tokens. Tap to turn off.",
    "header.context-reset":    "↺ Context Reset",
    "tooltip.vault-clear":     "Remove cold storage record from context",
    "tooltip.attach-btn":      "Attach file",
    "tooltip.conv-btn":        "Conversation Mode",
    "tooltip.conv-reset-ctx":  "Clear conversation history — memory stays loaded",
    "tooltip.conv-voice":      "Tap to cycle voices",
    "tooltip.conv-archive":    "Tap to include archive files in chat",
    "tooltip.conv-mute":       "Mute mic",
    "tooltip.conv-discard":    "Discard last chunk",
    "tooltip.conv-finish":     "Finish journaling",
    "conv.discard":            "↺ Discard",
    "conv.finish":             "✓ Finish",
    "conv.exit":               "✕ Exit",
    "conv.recording-journal":  "Recording journal",
    "conv.keep-going":         "Keep Going",
    "conv.exit-anyway":        "Exit Anyway",
    "conv.label.idle":         "Tap to chat · Hold to journal",
    "conv.label.listening":    "Listening...",
    "conv.label.starting":     "Starting...",
    "conv.label.recording":    "Recording...",
    "conv.label.thinking":     "Thinking...",
    "conv.label.speaking":     "Tap orb to interrupt",
    "conv.label.hold-to-record":  "Hold orb to record · Tap Finish when done",
    "conv.label.chunks-ready":    "Hold for more · Tap chunk to select · Tap again to edit",
    "conv.label.paused":          "Tap orb to chat  •  Hold to journal",
    "conv.label.muted":           "Muted  •  ↺ to discard",
    "conv.label.captured":        "Tap orb to send  •  ↺ discard",
    "conv.label.discarded":       "Discarded",
    "conv.exit-msg-default":      "Exit journal? Your dictation will be lost.",
    "conv.exit-msg-one":          "Exit journal? Your 1 recorded chunk will be lost.",
    "conv.exit-msg-many":         "Exit journal? Your {n} recorded chunks will be lost.",
    "conv.chunks-resume-one":     "1 chunk · Hold for more",
    "conv.chunks-resume-many":    "{n} chunks · Hold for more",
    "tooltip.modal-close":     "Close",
    "tooltip.voice-unsupported":"Voice not supported in this browser",
    "tooltip.sort-name":       "Sort by name",
    "tooltip.sort-size":       "Sort by size",
    "tooltip.cache-hit":       "Prompt cache hit — your memory was already cached, this message used ~90% fewer tokens",
    "tooltip.cache-miss":      "New session — memory was re-read and cached. Future messages this session will cost much less",
    "tooltip.dismiss":         "Dismiss",
    "install.banner":          "Add WhosWhoZoo to your home screen for quicker access.",
    "install.btn":             "Install",
    "tooltip.audit-ignore":    "Won't show in future audits.",
    "tooltip.skip-suggest":    "Never suggest again",
    "tooltip.delete-chunk":    "Delete this chunk",
    "tooltip.remove":          "Remove",
    "tooltip.photo-delete":    "Delete photo",
    "tooltip.photo-chip":      "View {name}'s photos",
    "tooltip.show-passphrase": "Show passphrase",
    "tooltip.stop-btn":          "Stop generating",
    "tooltip.send":              "Send",
    "tooltip.model-sonnet":      "Sonnet — smarter, more nuanced answers. ~5× higher cost per message. Tap to switch to Haiku.",
    "tooltip.model-haiku":       "Haiku — fast and low cost. Best for everyday questions. Tap to switch to Sonnet for complex tasks.",
    "tooltip.badge-memory-only": "~{totalK}K tokens · {pct} of memory budget (no chat history yet)",
    "tooltip.badge-breakdown":   "~{totalK}K tokens · {pct} of budget ({parts})",
    "tooltip.badge-part-memory": "{n}K memory",
    "tooltip.badge-part-vault":  "{n}K vault",
    "tooltip.badge-part-history":"{n}K history",
    "tooltip.conv-ctx-suffix":   " — tap ↺ to clear history if responses feel slow or incomplete",

    // ---- Daily brief (open loops at session start) ----
    "brief.header":              "📋 Open loops — {summary}",
    "brief.part-overdue":        "{n} overdue",
    "brief.part-due-today":      "{n} due today",
    "brief.part-due-week":       "{n} due this week",
    "brief.part-open-tasks":     "{n} with open tasks",
    "brief.part-new":            "{n} open",
    "brief.badge-overdue":       "⚠ overdue ({date})",
    "brief.badge-due-today":     "• due today",
    "brief.badge-due-date":      "• due {date}",
    "brief.badge-open-tasks":    "• open tasks",
    "brief.badge-new":           "• open",
    "brief.toast-load-failed":   "Couldn't load loop",
    "brief.toast-open-failed":   "Couldn't open loop",
    "brief.hint":                "Tap to open · or say \"close my [loop name] loop\"",

    // ---- Photo UI ----
    "photo.strip.label":         "Photos ({n})",
    "photo.strip.add":           "Add photo",

    // ---- Audit actions ----
    "audit.btn-delete-r2":       "Delete from R2",
    "audit.btn-open-record":     "Open record",
  },

  es: {
    // ---- Setup screen ----
    "setup.subtitle-new":       "Conecta tu memoria para comenzar.", // needs-review
    "setup.subtitle-recovery":  "Ingresa tu Clave de Acceso para restablecer tu frase de contraseña.", // needs-review
    "setup.privacy-note":       "Tus notas se almacenan en tu propia cuenta privada — nunca se usan para entrenar IA y nunca se nos envían.", // needs-review
    "setup.label-worker-url":   "URL del Worker",
    "setup.label-access-key":   "Clave de Acceso",
    "setup.label-access-key-hint": "(de la configuración)", // needs-review
    "setup.label-passphrase":   "Elige una frase de contraseña",
    "setup.label-confirm":      "Confirmar frase de contraseña",
    "setup.ph-worker-url":      "https://tu-worker.workers.dev", // needs-review
    "setup.ph-access-key":      "Pega tu clave de acceso",
    "setup.ph-passphrase":      "Al menos 12 caracteres",
    "setup.ph-confirm":         "Confirmar frase de contraseña",
    "setup.btn-setup":          "Configurar",
    "setup.btn-setup-loading":  "Configurando…",
    "setup.link-how":           "¿Cómo funciona esto? →",

    // ---- Login screen ----
    "login.subtitle-new-visitor": "WhosWhoZoo es una app de memoria personal — cada usuario tiene su propia copia. Inicia sesión si es la tuya, o visita whoszoo.app para configurar la tuya.", // needs-review
    "login.subtitle-returning": "Bienvenido de nuevo. Ingresa tu frase de contraseña para continuar.", // needs-review
    "login.label-passphrase":   "Frase de contraseña",
    "login.ph-passphrase":      "Ingresa tu frase de contraseña",
    "login.btn-unlock":         "Desbloquear",
    "login.btn-unlock-loading": "Desbloqueando…",
    "login.btn-biometric":      "Usar huella digital",
    "login.btn-forgot":         "¿Olvidaste tu frase? Usa la clave de acceso para restablecer →", // needs-review

    // ---- Settings panel ----
    "settings.title":           "Configuración",
    "settings.btn-back":        "← Volver a la app",
    "settings.btn-change-passphrase": "Cambiar frase de contraseña",
    "settings.btn-signout":     "Cerrar sesión",
    "settings.btn-help":        "Ayuda y documentación",
    "settings.btn-share":       "Recomienda WhosWhoZoo a alguien", // needs-review
    "settings.share-message":   "WhosWhoZoo — una app de memoria personal. Le cuento lo que vale la pena recordar — personas, conversaciones, cabos sueltos — y se lo pregunto más adelante.",  // needs-review
    "settings.share-copied":    "Mensaje copiado — enlaza a whoszoo.app", // needs-review
    "settings.share-failed":    "No se pudo copiar — el enlace es whoszoo.app", // needs-review
    "settings.access-key-note": "La clave de acceso se puede rotar en <a href='https://whoszoo.app/setup' target='_blank' rel='noopener'>whoszoo.app/setup</a>", // needs-review
    "settings.label-voice":     "Entrada de voz",
    "settings.opt-auto":        "Auto",
    "settings.opt-whisper":     "Whisper (preciso)",
    "voice.privacy.body":       "🎙 Una nota rápida antes de tu primera sesión de voz: el modo Auto es rápido y gratuito, pero en Chrome y Edge envía tu grabación al servicio de voz de Google, no a través de tu propio Worker. Para preguntas del día a día es un buen equilibrio. ¿Vas a hablar de algo confidencial? Whisper envía el audio a través de tu Worker a OpenAI, bajo términos que no permiten entrenamiento: una fracción de céntimo por grabación. Puedes cambiarlo cuando quieras en Configuración → Entrada de voz.", // needs-review
    "voice.privacy.switch":     "🔒 Usar Whisper", // needs-review
    "voice.privacy.keep":       "⚡ Seguir con Auto", // needs-review
    "voice.privacy.switched":   "Cambiado a Whisper", // needs-review
    "settings.label-whisper-lang": "Idioma de voz", // needs-review
    "settings.label-autolock":  "Bloqueo automático",
    "settings.opt-never":       "Nunca",
    "settings.opt-on":          "Activado", // needs-review
    "settings.opt-off":         "Desactivado", // needs-review
    "settings.label-cap":       "Límite de gasto diario",
    "settings.label-token-saver":  "Token Saver", // needs-review
    "settings.hint-token-saver":   "Borra el historial de conversación al salir del modo de voz.", // needs-review
    "settings.label-language":  "Idioma",
    "settings.toggle-advanced": "Avanzado",
    "settings.toggle-apikeys":  "Claves API",
    "settings.label-worker-url-adv":  "URL del Worker",
    "settings.hint-worker-url-adv":   "Solo cambia esto si volviste a implementar en una nueva dirección.", // needs-review
    "settings.btn-test-save":         "Probar y guardar",
    "settings.btn-test-save-loading": "Probando…",
    "settings.hint-apikeys":    "Solo escritura — los valores se guardan en tu worker. Deja en blanco para mantener la clave actual.", // needs-review
    "settings.apikey-source-setup": "✓ Usando clave de configuración",
    "settings.apikey-source-app":   "✓ Usando clave guardada aquí",
    "settings.apikey-not-configured": "No configurado",
    "settings.apikey-btn-save":         "Guardar",
    "settings.apikey-btn-save-loading": "Guardando…",
    "settings.apikey-btn-clear":         "Eliminar anulación",
    "settings.apikey-btn-clear-loading": "Eliminando…",
    "settings.apikey-cleared":   "Eliminado — usando clave de instalación.",
    "settings.apikey-enter-value": "Ingresa un valor de clave.",
    "settings.apikey-saved":     "Guardado.",
    "settings.fingerprint-unavailable": "Desbloqueo por huella digital",
    "settings.fingerprint-unavailable-badge": "no disponible en este navegador",
    "settings.fingerprint-setup": "Configurar desbloqueo por huella digital",
    "settings.fingerprint-remove-badge": "✓ Eliminar",
    "settings.btn-install":         "Instalar en la pantalla de inicio", // needs-review
    "settings.install-done-badge": "✓ Instalada", // needs-review
    "settings.install-retry":      "Aún no está listo en esta página — intenta recargar.", // needs-review
    "settings.fingerprint-setup-loading": "Configurando…",

    // ---- Change passphrase sub-form ----
    "cp.label-current":  "Frase de contraseña actual",
    "cp.label-new":      "Nueva frase de contraseña",
    "cp.label-confirm":  "Confirmar nueva frase de contraseña",
    "cp.ph-current":     "Frase de contraseña actual",
    "cp.ph-new":         "Al menos 12 caracteres",
    "cp.ph-confirm":     "Confirmar nueva frase de contraseña",
    "cp.btn-update":     "Actualizar frase de contraseña",
    "cp.btn-back":       "← Volver a configuración",

    // ---- Installer link ----
    "install.get-title": "Configúrate →", // needs-review
    "install.get-sub":   "whoszoo.app — asistente de configuración, guía de instalación y cómo funciona", // needs-review

    // ---- Loading screen ----
    "loading.text": "Cargando tus memorias...",

    // ---- Chat UI ----
    "chat.cold-storage-cleared": "Registro de almacenamiento frío eliminado del contexto.",
    "chat.cleared":              "Chat borrado. La memoria sigue cargada.",
    "chat.biometric-offer":      "Activa el desbloqueo por huella digital para iniciar sesión sin escribir tu frase la próxima vez.", // needs-review
    "chat.input-placeholder":    "Pregunta a tu memoria...", // needs-review
    "chat.attach-placeholder":   "Agrega instrucciones para el archivo adjunto...", // needs-review
    "chat.last-login":           "Último acceso: {time}", // needs-review
    "chat.bulk-since-login":     "⚠ {count} exportación/importación de datos desde tu último acceso: {actions}. Si no fuiste tú, cambia tu frase de contraseña ahora.", // needs-review
    "security.method.passphrase":"frase de contraseña", // needs-review
    "security.method.biometric": "biométrico", // needs-review
    "security.method.setup":     "configuración inicial", // needs-review
    "security.method.recovery":  "recuperación con clave de acceso", // needs-review
    "security.method.failed":    "intento fallido", // needs-review
    "security.method.export":    "exportación cifrada", // needs-review
    "security.method.export-plain":"exportación SIN CIFRAR (texto plano)", // needs-review
    "security.method.import":    "importación (memoria sobrescrita)", // needs-review
    "modal.reauth-title":        "Confirma que eres tú", // needs-review
    "modal.reauth-desc":         "Esto crea o restaura una copia completa de tu memoria. Ingresa tu frase de contraseña para continuar.", // needs-review
    "modal.reauth-ph":           "Ingresa tu frase de contraseña", // needs-review
    "modal.reauth-wrong":        "Frase de contraseña incorrecta.", // needs-review
    "chat.audit-ignored-time":   "· ignorado {time}", // needs-review
    "chat.photo-one-at-a-time":    "⚠ Por favor agrega las fotos de a una — adjunta una imagen por mensaje y pídeme que la guarde.", // needs-review
    "chat.photo-data-unavailable": "⚠ Datos de la foto no disponibles — adjunta la foto y vuelve a intentarlo.", // needs-review
    "chat.photo-r2-required":      "⚠ Las fotos requieren almacenamiento R2. Consulta Ayuda → Configuración de R2 — es gratuito en el nivel gratuito de Cloudflare.", // needs-review
    "chat.photo-upload-failed":    "⚠ La subida de la foto falló: {error}", // needs-review
    "chat.photo-added":            "📷 Foto agregada al registro de {name}.", // needs-review
    "chat.photo-saved-partial":    "⚠ Foto guardada en el almacenamiento pero no se pudo actualizar el registro de {name}: {error}. Agrega manualmente – Photo: {filename} en la sección ### Photos.", // needs-review
    "chat.photo-save-failed":      "⚠ Error al guardar la foto: {error}", // needs-review
    "chat.photo-zip-summary":      "ZIP exportado — {done}/{total} foto(s) incluida(s).", // needs-review
    "chat.photo-restore-progress": "Restaurando fotos ({done} de {total})…", // needs-review
    "chat.photo-restore-all":      "{n} foto(s) restaurada(s)", // needs-review
    "chat.photo-restore-none":     "⚠ Fotos no restauradas — R2 no está configurado en este worker", // needs-review
    "chat.photo-restore-partial":  "{done}/{total} foto(s) restaurada(s) (algunas fallaron)", // needs-review
    "time.days-ago-one":         "hace 1 día", // needs-review
    "time.days-ago-many":        "hace {n} días", // needs-review
    "time.hours-ago-one":        "hace 1 hora", // needs-review
    "time.hours-ago-many":       "hace {n} horas", // needs-review
    "time.just-now":             "hace un momento", // needs-review

    // ---- Modals — Preview ----
    "modal.preview-title": "Vista previa de memoria",
    "modal.btn-cancel":    "Cancelar",
    "modal.btn-save":      "Guardar",

    // ---- Modals — Archive Review ----
    "modal.archive-title":       "Revisión de archivo",
    "modal.btn-archive-cancel":  "Cancelar",
    "modal.btn-archive-confirm": "Archivar seleccionados ({n})",

    // ---- Modals — Cold Storage Review ----
    "modal.deep-title":       "Revisión de almacenamiento frío",
    "modal.btn-deep-cancel":  "Cancelar",
    "modal.btn-deep-confirm": "Mover a almacenamiento frío ({n})",

    // ---- Modals — Compact Review ----
    "modal.compact-title":       "Revisión de compactación",
    "modal.btn-compact-cancel":  "Cancelar",
    "modal.btn-compact-confirm": "Compactar seleccionados ({n})",
    "compact.tally-one":         "1 vista previa cargada · est. ¢{cost}", // needs-review
    "compact.tally-many":        "{n} vistas previas cargadas · est. ¢{cost}", // needs-review

    // ---- Modals — Edit ----
    "modal.edit-title":      "Editar registro",
    "modal.btn-edit-cancel": "Cancelar",
    "modal.btn-edit-save":   "Guardar",
    "modal.btn-edit-delete": "Eliminar registro",
    "modal.btn-move":        "Mover",

    // ---- Modals — Delete ----
    "modal.delete-title":        "Eliminar registro",
    "modal.delete-warning":      "Esto elimina permanentemente el registro de la memoria. No se puede deshacer.", // needs-review
    "modal.delete-confirm-hint": "Escribe delete para confirmar",
    "modal.delete-ph":           "Escribe \"delete\" para confirmar",
    "modal.btn-delete-cancel":   "Cancelar",
    "modal.btn-delete-confirm":  "Eliminar",

    // ---- Modals — Access Key Gate ----
    "modal.btn-access-cancel": "Cancelar",
    "modal.btn-access-confirm":"Continuar",

    // ---- Modals — Export Zip ----
    "modal.export-zip-title":        "Exportar archivos de texto plano",
    "modal.export-zip-confirm-hint": "Escribe unencrypted para confirmar que entiendes.",
    "modal.export-zip-ph":           "Escribe \"unencrypted\" para confirmar",
    "modal.btn-export-zip-cancel":   "Cancelar",
    "modal.btn-export-zip-confirm":  "Descargar Zip",

    // ---- Modals — Reset ----
    "modal.reset-title":        "Restablecer sistema de memoria",
    "modal.reset-confirm-hint": "Escribe reset para confirmar",
    "modal.reset-ph":           "Escribe \"reset\" para confirmar",
    "modal.reset-name-hint":    "Nuevo nombre para este sistema",
    "modal.reset-name-ph":      "Nombre",
    "modal.btn-reset-cancel":   "Cancelar",
    "modal.btn-reset-confirm":  "Restablecer memoria",

    // ---- Modals — Export Backup ----
    "modal.export-title":       "Exportar copia de seguridad de memoria",
    "modal.export-ph-pw":       "Contraseña",
    "modal.export-ph-pw2":      "Confirmar contraseña",
    "modal.btn-export-cancel":  "Cancelar",
    "modal.btn-export-confirm": "Exportar",
    "modal.export-include-photos":      "Incluir fotos", // needs-review
    "modal.export-include-photos-hint": "Desactiva para un archivo más pequeño — tus fotos están seguras en R2.", // needs-review

    // ---- Modals — Import Backup ----
    "modal.import-title":       "Importar copia de seguridad de memoria",
    "modal.import-ph-pw":       "Contraseña de la copia de seguridad",
    "modal.btn-import-cancel":  "Cancelar",
    "modal.btn-import-decrypt": "Descifrar",
    "modal.btn-import-back":    "← Atrás",
    "modal.btn-import-cancel2": "Cancelar",
    "modal.btn-import-confirm": "Sobrescribir memoria",

    // ---- Drop overlay ----
    "drop.label": "Suelta el archivo para adjuntar",
    "drop.sub":   "Imágenes · PDF · TXT",

    // ---- Toast messages ----
    "toast.fill-worker-key":          "Por favor completa la URL del Worker y la clave de acceso.",
    "toast.passphrase-too-short":     "La frase de contraseña debe tener al menos 12 caracteres.",
    "toast.passphrase-mismatch":      "Las frases de contraseña no coinciden.",
    "toast.enter-passphrase":         "Ingresa tu frase de contraseña.",
    "toast.no-passphrase-set":        "No hay frase configurada. Usa la clave de acceso para configurar.", // needs-review
    "toast.incorrect-passphrase":     "Frase de contraseña incorrecta.",
    "toast.connection-failed":        "No se pudo conectar al servidor — revisa tu conexión.",
    "toast.worker-fetch-failed":      "No se pudo alcanzar el worker — revisa la URL.",
    "toast.worker-url-saved":         "URL del Worker guardada.",
    "toast.url-empty":                "La URL no puede estar vacía.",
    "toast.url-unreachable":          "No se puede alcanzar esa URL. Revisa la dirección e intenta de nuevo.", // needs-review
    "toast.fingerprint-enabled":      "Desbloqueo por huella digital activado.",
    "toast.fingerprint-removed":      "Desbloqueo por huella digital eliminado.",
    "toast.fingerprint-remove-failed":"No se pudo eliminar el método biométrico. Intenta de nuevo.",
    "toast.current-passphrase-required": "Ingresa tu frase de contraseña actual.",
    "toast.new-passphrase-too-short": "La nueva frase de contraseña debe tener al menos 12 caracteres.",
    "toast.new-passphrase-mismatch":  "Las nuevas frases de contraseña no coinciden.",
    "toast.nothing-to-copy":          "Nada que copiar.",
    "toast.conversation-copied":      "Conversación copiada.",
    "toast.copy-failed":              "Error al copiar — intenta seleccionar manualmente.",
    "toast.context-reset":            "Contexto restablecido — la memoria sigue cargada.",
    "toast.mic-denied":               "Acceso al micrófono denegado.",
    "toast.transcription-failed":     "Error de transcripción — revisa tu clave de OpenAI.",
    "toast.max-attachments":          "Máximo {n} archivos adjuntos por mensaje.",
    "toast.attach-add-instructions":  "Agrega instrucciones para el archivo adjunto antes de enviar.",
    "toast.archive-on":               "Archivador activado — registros más antiguos incluidos en el chat y la búsqueda.", // needs-review
    "toast.archive-off":              "Archivador desactivado — solo memoria activa.", // needs-review
    "toast.autolock-disabled":        "Bloqueo automático desactivado.",
    "toast.autolock-set":             "Bloqueo automático establecido en {label}.",
    "toast.cap-disabled":             "Límite de gasto diario desactivado.",
    "toast.cap-set":                  "Límite de gasto diario establecido en ${n}/día.",
    "toast.cap-save-failed":          "No se pudo guardar el límite: {error}",
    "toast.model-sonnet":             "Cambiado a Sonnet (mayor calidad)",
    "toast.model-haiku":              "Cambiado a Haiku (menor costo)",
    "toast.voice-switched":           "Voz: {name}",
    "toast.voice-input-set":          "Entrada de voz: {label}",
    "toast.photo-delete-failed":      "No se pudo eliminar la foto: {error}", // needs-review
    "cmd.desc.archive":                    "mover un registro al archivo (búsqueda aproximada)", // needs-review
    "cmd.desc.archive-review":             "la IA sugiere candidatos para archivar · añade [archivo] [deep] [contexto]", // needs-review
    "cmd.desc.archive-review-ignored":     "ver y restaurar sugerencias de archivo ignoradas", // needs-review
    "cmd.desc.deep":                       "mover un registro a almacenamiento en frío (nivel de acceso infrecuente)", // needs-review
    "cmd.desc.deep-review":                "la IA sugiere candidatos para almacenamiento en frío desde el nivel a largo plazo", // needs-review
    "cmd.desc.deep-review-ignored":        "ver y restaurar sugerencias de revisión profunda ignoradas", // needs-review
    "cmd.desc.audit":                      "analizar la memoria en busca de problemas de integridad (análisis rápido, gratuito)", // needs-review
    "cmd.desc.audit-deep":                 "+ detección asistida por Haiku de casi-duplicados y discrepancias de nombres (~3¢)", // needs-review
    "cmd.desc.audit-ignored":              "ver y restaurar hallazgos de auditoría ignorados", // needs-review
    "cmd.desc.restore":                    "restaurar un registro del archivo o almacenamiento en frío a activo", // needs-review
    "cmd.desc.cls":                        "limpiar el chat visible Y restablecer el contexto de Claude (elimina el historial de conversación)", // needs-review
    "cmd.desc.compact":                    "compactar un registro específico — elige Normal/Medio/Alto en la vista previa", // needs-review
    "cmd.desc.compact-review":             "mostrar registros extensos en los cuatro archivos", // needs-review
    "cmd.desc.compact-review-people":      "mostrar registros extensos de people.md", // needs-review
    "cmd.desc.compact-review-loops":       "mostrar registros extensos de loops.md", // needs-review
    "cmd.desc.compact-review-fragments":   "mostrar registros extensos de fragments.md", // needs-review
    "cmd.desc.compact-review-reflections": "mostrar registros extensos de reflections.md", // needs-review
    "cmd.desc.browse-people":              "listar todos los registros de people.md ordenados por tamaño", // needs-review
    "cmd.desc.browse-loops":               "listar todos los registros de loops.md ordenados por tamaño", // needs-review
    "cmd.desc.browse-fragments":           "listar todos los registros de fragments.md ordenados por tamaño", // needs-review
    "cmd.desc.browse-reflections":         "listar todos los registros de reflections.md ordenados por tamaño", // needs-review
    "cmd.desc.browse-archive-people":      "listar personas archivadas ordenadas por tamaño", // needs-review
    "cmd.desc.browse-archive-loops":       "listar bucles archivados ordenados por tamaño", // needs-review
    "cmd.desc.browse-archive-fragments":   "listar fragmentos archivados ordenados por tamaño", // needs-review
    "cmd.desc.browse-archive-reflections": "listar reflexiones archivadas ordenadas por tamaño", // needs-review
    "cmd.desc.browse-cold-people":         "listar personas en almacenamiento en frío ordenadas por tamaño", // needs-review
    "cmd.desc.browse-cold-loops":          "listar bucles en almacenamiento en frío ordenados por tamaño", // needs-review
    "cmd.desc.browse-cold-fragments":      "listar fragmentos en almacenamiento en frío ordenados por tamaño", // needs-review
    "cmd.desc.browse-cold-reflections":    "listar reflexiones en almacenamiento en frío ordenadas por tamaño", // needs-review
    "cmd.desc.costs":                      "mostrar el costo estimado de la API de Claude hoy y esta semana", // needs-review
    "cmd.desc.delete":                     "eliminar permanentemente un registro (requiere escribir delete)", // needs-review
    "cmd.desc.diagnostics":                "salud del sistema: tamaños de memoria, registro de costos, errores", // needs-review
    "cmd.desc.security":                   "mostrar historial de inicio de sesión reciente (ubicación, dispositivo, método)", // needs-review
    "cmd.desc.edit":                       "editar un registro directamente (búsqueda aproximada)", // needs-review
    "cmd.desc.export":                     "descargar una copia de seguridad cifrada de todos los archivos de memoria", // needs-review
    "cmd.desc.export-plain":               "descargar un zip de texto plano de todos los archivos de memoria (sin cifrado)", // needs-review
    "cmd.desc.help":                       "mostrar los comandos disponibles", // needs-review
    "cmd.desc.import":                     "restaurar archivos de memoria desde una copia de seguridad cifrada o un zip de texto plano", // needs-review
    "cmd.desc.journal":                    "pulir y guardar una entrada de diario en reflections.md", // needs-review
    "cmd.desc.journal-flush":              "mover entradas de diario de más de 60 días al archivo (añade un número para modificar)", // needs-review
    "cmd.desc.memory-game":                "iniciar un cuestionario de memoria de personas", // needs-review
    "cmd.desc.mnemonic":                   "[nombre] para generar · [nombre: tu texto] para guardar el tuyo", // needs-review
    "cmd.desc.l":                          "bloquear la aplicación de inmediato", // needs-review
    "cmd.desc.r":                          "eliminar el historial de conversación (el scroll del chat permanece · los archivos de memoria siguen cargados)", // needs-review
    "cmd.desc.recall":                     "explorar encabezados de almacenamiento en frío · ¢ con un término de búsqueda", // needs-review
    "cmd.desc.references":                 "encontrar todos los registros que mencionan un nombre o tema", // needs-review
    "cmd.desc.import-contacts":             "importar contactos desde un archivo .vcf (vCard) o .csv — crea registros en people.md", // needs-review
    "cmd.desc.reset":                      "borrar todos los archivos de memoria a plantillas en blanco (requiere Clave de Acceso)", // needs-review
    "tooltip.apikey-save":     "Solo escritura — una vez guardado el valor no puede leerse", // needs-review
    "tooltip.apikey-clear":    "Elimina tu clave guardada y revierte a la clave establecida durante la instalación", // needs-review
    "tooltip.deep-badge":      "Almacenamiento en frío — toca para explorar", // needs-review
    "tooltip.cls-btn":         "Toca: limpiar chat (/cls) · Mantén: restablecer contexto (/r)", // needs-review
    "tooltip.copy-chat":       "Copiar conversación", // needs-review
    "tooltip.settings":        "Configuración", // needs-review
    "tooltip.model-btn":       "Toca para cambiar modelo", // needs-review
    "tooltip.archive-btn":     "Toca para incluir archivos del archivo en el chat y búsqueda", // needs-review
    "archive.label.off":       "📦 Archivo: OFF", // needs-review
    "archive.label.on":        "📦 Archivo: ON", // needs-review
    "archive.tip.off":         "Archivo DESACTIVADO — solo memoria activa. Toca para incluir registros más antiguos.", // needs-review
    "archive.tip.on":          "Archivo ACTIVADO — registros antiguos incluidos. Usa más tokens. Toca para desactivar.", // needs-review
    "header.context-reset":    "↺ Restablecer contexto", // needs-review
    "tooltip.vault-clear":     "Eliminar registro de almacenamiento en frío del contexto", // needs-review
    "tooltip.attach-btn":      "Adjuntar archivo", // needs-review
    "tooltip.conv-btn":        "Modo conversación", // needs-review
    "tooltip.conv-reset-ctx":  "Limpiar historial de conversación — la memoria permanece cargada", // needs-review
    "tooltip.conv-voice":      "Toca para cambiar voz", // needs-review
    "tooltip.conv-archive":    "Toca para incluir archivos del archivo en el chat", // needs-review
    "tooltip.conv-mute":       "Silenciar micrófono", // needs-review
    "tooltip.conv-discard":    "Descartar último fragmento", // needs-review
    "tooltip.conv-finish":     "Terminar diario", // needs-review
    "conv.discard":            "↺ Descartar", // needs-review
    "conv.finish":             "✓ Terminar", // needs-review
    "conv.exit":               "✕ Salir", // needs-review
    "conv.recording-journal":  "Grabando diario", // needs-review
    "conv.keep-going":         "Continuar", // needs-review
    "conv.exit-anyway":        "Salir de todos modos", // needs-review
    "conv.label.idle":         "Toca para hablar · Mantén para diario", // needs-review
    "conv.label.listening":    "Escuchando...", // needs-review
    "conv.label.starting":     "Iniciando...", // needs-review
    "conv.label.recording":    "Grabando...", // needs-review
    "conv.label.thinking":     "Pensando...", // needs-review
    "conv.label.speaking":     "Toca el orbe para interrumpir", // needs-review
    "conv.label.hold-to-record":  "Mantén el orbe para grabar · Toca Terminar al acabar", // needs-review
    "conv.label.chunks-ready":    "Mantén para más · Toca fragmento para seleccionar · Toca de nuevo para editar", // needs-review
    "conv.label.paused":          "Toca el orbe para hablar  •  Mantén para diario", // needs-review
    "conv.label.muted":           "Silenciado  •  ↺ para descartar", // needs-review
    "conv.label.captured":        "Toca el orbe para enviar  •  ↺ descartar", // needs-review
    "conv.label.discarded":       "Descartado", // needs-review
    "conv.exit-msg-default":      "¿Salir del diario? Se perderá tu dictado.", // needs-review
    "conv.exit-msg-one":          "¿Salir del diario? Se perderá tu 1 fragmento grabado.", // needs-review
    "conv.exit-msg-many":         "¿Salir del diario? Se perderán tus {n} fragmentos grabados.", // needs-review
    "conv.chunks-resume-one":     "1 fragmento · Mantén para más", // needs-review
    "conv.chunks-resume-many":    "{n} fragmentos · Mantén para más", // needs-review
    "tooltip.modal-close":     "Cerrar", // needs-review
    "tooltip.voice-unsupported":"Voz no compatible con este navegador", // needs-review
    "tooltip.sort-name":       "Ordenar por nombre", // needs-review
    "tooltip.sort-size":       "Ordenar por tamaño", // needs-review
    "tooltip.cache-hit":       "Caché de prompt activo — tu memoria ya estaba en caché, este mensaje usó ~90% menos tokens", // needs-review
    "tooltip.cache-miss":      "Nueva sesión — la memoria fue releída y cacheada. Los mensajes futuros costarán mucho menos", // needs-review
    "tooltip.dismiss":         "Descartar", // needs-review
    "install.banner":          "Añade WhosWhoZoo a tu pantalla de inicio para acceder más rápido.", // needs-review
    "install.btn":             "Instalar", // needs-review
    "tooltip.audit-ignore":    "No aparecerá en auditorías futuras.", // needs-review
    "tooltip.skip-suggest":    "No sugerir nunca más", // needs-review
    "tooltip.delete-chunk":    "Eliminar este fragmento", // needs-review
    "tooltip.remove":          "Eliminar", // needs-review
    "tooltip.photo-delete":    "Eliminar foto", // needs-review
    "tooltip.photo-chip":      "Ver fotos de {name}", // needs-review
    "tooltip.show-passphrase": "Mostrar frase de contraseña", // needs-review
    "tooltip.stop-btn":          "Detener generación", // needs-review
    "tooltip.send":              "Enviar", // needs-review
    "tooltip.model-sonnet":    "Sonnet — respuestas más inteligentes y matizadas. ~5× mayor costo por mensaje. Toca para cambiar a Haiku.", // needs-review
    "tooltip.model-haiku":       "Haiku — rápido y económico. Ideal para preguntas cotidianas. Toca para cambiar a Sonnet en tareas complejas.", // needs-review
    "tooltip.badge-memory-only": "~{totalK}K tokens · {pct} del presupuesto de memoria (sin historial de chat aún)", // needs-review
    "tooltip.badge-breakdown":   "~{totalK}K tokens · {pct} del presupuesto ({parts})", // needs-review
    "tooltip.badge-part-memory": "{n}K memoria", // needs-review
    "tooltip.badge-part-vault":  "{n}K bóveda", // needs-review
    "tooltip.badge-part-history":"{n}K historial", // needs-review
    "tooltip.conv-ctx-suffix":   " — toca ↺ para limpiar el historial si las respuestas se sienten lentas o incompletas", // needs-review

    // ---- Daily brief (open loops at session start) ----
    "brief.header":              "📋 Tareas pendientes — {summary}", // needs-review
    "brief.part-overdue":        "{n} vencida", // needs-review
    "brief.part-due-today":      "{n} para hoy", // needs-review
    "brief.part-due-week":       "{n} para esta semana", // needs-review
    "brief.part-open-tasks":     "{n} con tareas abiertas", // needs-review
    "brief.part-new":            "{n} abierta", // needs-review
    "brief.badge-overdue":       "⚠ vencida ({date})", // needs-review
    "brief.badge-due-today":     "• para hoy", // needs-review
    "brief.badge-due-date":      "• para el {date}", // needs-review
    "brief.badge-open-tasks":    "• tareas abiertas", // needs-review
    "brief.badge-new":           "• abierta", // needs-review
    "brief.toast-load-failed":   "No se pudo cargar la tarea", // needs-review
    "brief.toast-open-failed":   "No se pudo abrir la tarea", // needs-review
    "brief.hint":                "Toca para abrir · o di \"cierra mi tarea [nombre]\"", // needs-review

    // ---- Photo UI ----
    "photo.strip.label":         "Fotos ({n})", // needs-review
    "photo.strip.add":           "Añadir foto", // needs-review

    // ---- Audit actions ----
    "audit.btn-delete-r2":       "Eliminar de R2", // needs-review
    "audit.btn-open-record":     "Abrir registro", // needs-review
  },

  fr: {
    // ---- Setup screen ----
    "setup.subtitle-new":       "Connectez votre mémoire pour commencer.", // needs-review
    "setup.subtitle-recovery":  "Entrez votre Clé d'Accès pour réinitialiser votre phrase secrète.", // needs-review
    "setup.privacy-note":       "Vos notes sont stockées dans votre propre compte privé — jamais utilisées pour entraîner l'IA, et elles ne nous sont jamais transmises.", // needs-review
    "setup.label-worker-url":   "URL du Worker",
    "setup.label-access-key":   "Clé d'Accès",
    "setup.label-access-key-hint": "(depuis la configuration)", // needs-review
    "setup.label-passphrase":   "Choisissez une phrase secrète",
    "setup.label-confirm":      "Confirmer la phrase secrète",
    "setup.ph-worker-url":      "https://votre-worker.workers.dev", // needs-review
    "setup.ph-access-key":      "Collez votre clé d'accès",
    "setup.ph-passphrase":      "Au moins 12 caractères",
    "setup.ph-confirm":         "Confirmer la phrase secrète",
    "setup.btn-setup":          "Configurer",
    "setup.btn-setup-loading":  "Configuration…",
    "setup.link-how":           "Comment ça fonctionne ? →",

    // ---- Login screen ----
    "login.subtitle-new-visitor": "WhosWhoZoo est une application de mémoire personnelle — chaque utilisateur a sa propre copie. Connectez-vous si c'est la vôtre, ou visitez whoszoo.app pour configurer la vôtre.", // needs-review
    "login.subtitle-returning": "Bon retour. Entrez votre phrase secrète pour continuer.", // needs-review
    "login.label-passphrase":   "Phrase secrète",
    "login.ph-passphrase":      "Entrez votre phrase secrète",
    "login.btn-unlock":         "Déverrouiller",
    "login.btn-unlock-loading": "Déverrouillage…",
    "login.btn-biometric":      "Utiliser l'empreinte digitale",
    "login.btn-forgot":         "Phrase oubliée ? Utilisez la clé d'accès pour réinitialiser →", // needs-review

    // ---- Settings panel ----
    "settings.title":           "Paramètres",
    "settings.btn-back":        "← Retour à l'app",
    "settings.btn-change-passphrase": "Changer la phrase secrète",
    "settings.btn-signout":     "Se déconnecter",
    "settings.btn-help":        "Aide et documentation",
    "settings.btn-share":       "Recommander WhosWhoZoo à un ami", // needs-review
    "settings.share-message":   "WhosWhoZoo — une appli de mémoire personnelle. Je lui confie ce qui mérite d'être retenu — des personnes, des conversations, des choses en suspens — et je le lui redemande plus tard.",  // needs-review
    "settings.share-copied":    "Message copié — le lien pointe vers whoszoo.app", // needs-review
    "settings.share-failed":    "Copie impossible — le lien est whoszoo.app", // needs-review
    "settings.access-key-note": "La clé d'accès peut être changée sur <a href='https://whoszoo.app/setup' target='_blank' rel='noopener'>whoszoo.app/setup</a>", // needs-review
    "settings.label-voice":     "Saisie vocale",
    "settings.opt-auto":        "Auto",
    "settings.opt-whisper":     "Whisper (précis)",
    "voice.privacy.body":       "🎙 Une précision avant votre première session vocale : le mode Auto est rapide et gratuit, mais sur Chrome et Edge il envoie votre extrait au service vocal de Google, et non via votre propre Worker. Pour les questions du quotidien, le compromis est raisonnable. Vous allez parler de quelque chose de confidentiel ? Whisper transmet l'audio via votre Worker à OpenAI, sous des conditions qui excluent l'entraînement — une fraction de centime par extrait. Vous pouvez changer à tout moment dans Paramètres → Saisie vocale.", // needs-review
    "voice.privacy.switch":     "🔒 Utiliser Whisper", // needs-review
    "voice.privacy.keep":       "⚡ Garder Auto", // needs-review
    "voice.privacy.switched":   "Passé à Whisper", // needs-review
    "settings.label-whisper-lang": "Langue vocale", // needs-review
    "settings.label-autolock":  "Verrouillage auto",
    "settings.opt-never":       "Jamais",
    "settings.opt-on":          "Activé", // needs-review
    "settings.opt-off":         "Désactivé", // needs-review
    "settings.label-cap":       "Plafond de dépenses quotidien",
    "settings.label-token-saver":  "Token Saver", // needs-review
    "settings.hint-token-saver":   "Efface l'historique de conversation en quittant le mode vocal.", // needs-review
    "settings.label-language":  "Langue",
    "settings.toggle-advanced": "Avancé",
    "settings.toggle-apikeys":  "Clés API",
    "settings.label-worker-url-adv":  "URL du Worker",
    "settings.hint-worker-url-adv":   "Ne changez ceci que si vous avez redéployé à une nouvelle adresse.", // needs-review
    "settings.btn-test-save":         "Tester et enregistrer",
    "settings.btn-test-save-loading": "Test en cours…",
    "settings.hint-apikeys":    "Écriture seule — les valeurs sont stockées sur votre worker. Laissez vide pour conserver la clé actuelle.", // needs-review
    "settings.apikey-source-setup": "✓ Utilisation de la clé d'installation",
    "settings.apikey-source-app":   "✓ Utilisation de la clé enregistrée ici",
    "settings.apikey-not-configured": "Non configuré",
    "settings.apikey-btn-save":         "Enregistrer",
    "settings.apikey-btn-save-loading": "Enregistrement…",
    "settings.apikey-btn-clear":         "Supprimer le remplacement",
    "settings.apikey-btn-clear-loading": "Suppression…",
    "settings.apikey-cleared":   "Supprimé — utilisation de la clé d'installation.",
    "settings.apikey-enter-value": "Entrez une valeur de clé.",
    "settings.apikey-saved":     "Enregistré.",
    "settings.fingerprint-unavailable": "Déverrouillage par empreinte",
    "settings.fingerprint-unavailable-badge": "non disponible sur ce navigateur",
    "settings.fingerprint-setup": "Configurer le déverrouillage par empreinte",
    "settings.fingerprint-remove-badge": "✓ Supprimer",
    "settings.btn-install":         "Installer sur l’écran d’accueil", // needs-review
    "settings.install-done-badge": "✓ Installée", // needs-review
    "settings.install-retry":      "Pas encore prêt sur cette page — essayez de recharger.", // needs-review
    "settings.fingerprint-setup-loading": "Configuration…",

    // ---- Change passphrase sub-form ----
    "cp.label-current":  "Phrase secrète actuelle",
    "cp.label-new":      "Nouvelle phrase secrète",
    "cp.label-confirm":  "Confirmer la nouvelle phrase secrète",
    "cp.ph-current":     "Phrase secrète actuelle",
    "cp.ph-new":         "Au moins 12 caractères",
    "cp.ph-confirm":     "Confirmer la nouvelle phrase secrète",
    "cp.btn-update":     "Mettre à jour la phrase secrète",
    "cp.btn-back":       "← Retour aux paramètres",

    // ---- Installer link ----
    "install.get-title": "Configurer →", // needs-review
    "install.get-sub":   "whoszoo.app — assistant de configuration, guide d'installation et fonctionnement", // needs-review

    // ---- Loading screen ----
    "loading.text": "Chargement de vos souvenirs...",

    // ---- Chat UI ----
    "chat.cold-storage-cleared": "Enregistrement du stockage froid supprimé du contexte.",
    "chat.cleared":              "Chat effacé. La mémoire est toujours chargée.",
    "chat.biometric-offer":      "Activez le déverrouillage par empreinte pour vous connecter sans saisir votre phrase la prochaine fois.", // needs-review
    "chat.input-placeholder":    "Interrogez votre mémoire...", // needs-review
    "chat.attach-placeholder":   "Ajoutez des instructions pour le fichier joint...", // needs-review
    "chat.last-login":           "Dernière connexion : {time}", // needs-review
    "chat.bulk-since-login":     "⚠ {count} export/import de données depuis votre dernière connexion : {actions}. Si ce n'était pas vous, changez votre phrase secrète maintenant.", // needs-review
    "security.method.passphrase":"phrase secrète", // needs-review
    "security.method.biometric": "biométrique", // needs-review
    "security.method.setup":     "configuration initiale", // needs-review
    "security.method.recovery":  "récupération par clé d'accès", // needs-review
    "security.method.failed":    "tentative échouée", // needs-review
    "security.method.export":    "export chiffré", // needs-review
    "security.method.export-plain":"export NON CHIFFRÉ (texte brut)", // needs-review
    "security.method.import":    "import (mémoire écrasée)", // needs-review
    "modal.reauth-title":        "Confirmez votre identité", // needs-review
    "modal.reauth-desc":         "Cette action crée ou restaure une copie complète de votre mémoire. Entrez votre phrase secrète pour continuer.", // needs-review
    "modal.reauth-ph":           "Entrez votre phrase secrète", // needs-review
    "modal.reauth-wrong":        "Phrase secrète incorrecte.", // needs-review
    "chat.audit-ignored-time":   "· ignoré {time}", // needs-review
    "chat.photo-one-at-a-time":    "⚠ Veuillez ajouter les photos une à une — joignez une image par message et demandez-moi de la sauvegarder.", // needs-review
    "chat.photo-data-unavailable": "⚠ Données de la photo non disponibles — joignez la photo et réessayez.", // needs-review
    "chat.photo-r2-required":      "⚠ Les photos nécessitent le stockage R2. Voir Aide → Configuration R2 — c'est gratuit sur le niveau gratuit de Cloudflare.", // needs-review
    "chat.photo-upload-failed":    "⚠ Échec de l'envoi de la photo : {error}", // needs-review
    "chat.photo-added":            "📷 Photo ajoutée à l'enregistrement de {name}.", // needs-review
    "chat.photo-saved-partial":    "⚠ Photo enregistrée mais impossible de mettre à jour l'enregistrement de {name} : {error}. Ajoutez manuellement – Photo: {filename} dans leur section ### Photos.", // needs-review
    "chat.photo-save-failed":      "⚠ Échec de la sauvegarde de la photo : {error}", // needs-review
    "chat.photo-zip-summary":      "ZIP exporté — {done}/{total} photo(s) incluse(s).", // needs-review
    "chat.photo-restore-progress": "Restauration des photos ({done} sur {total})…", // needs-review
    "chat.photo-restore-all":      "{n} photo(s) restaurée(s)", // needs-review
    "chat.photo-restore-none":     "⚠ Photos non restaurées — R2 n'est pas configuré sur ce worker", // needs-review
    "chat.photo-restore-partial":  "{done}/{total} photo(s) restaurée(s) (certaines ont échoué)", // needs-review
    "time.days-ago-one":         "il y a 1 jour", // needs-review
    "time.days-ago-many":        "il y a {n} jours", // needs-review
    "time.hours-ago-one":        "il y a 1 heure", // needs-review
    "time.hours-ago-many":       "il y a {n} heures", // needs-review
    "time.just-now":             "à l'instant", // needs-review

    // ---- Modals — Preview ----
    "modal.preview-title": "Aperçu de la mémoire",
    "modal.btn-cancel":    "Annuler",
    "modal.btn-save":      "Enregistrer",

    // ---- Modals — Archive Review ----
    "modal.archive-title":       "Révision de l'archive",
    "modal.btn-archive-cancel":  "Annuler",
    "modal.btn-archive-confirm": "Archiver la sélection ({n})",

    // ---- Modals — Cold Storage Review ----
    "modal.deep-title":       "Révision du stockage froid",
    "modal.btn-deep-cancel":  "Annuler",
    "modal.btn-deep-confirm": "Déplacer vers le stockage froid ({n})",

    // ---- Modals — Compact Review ----
    "modal.compact-title":       "Révision de la compaction",
    "modal.btn-compact-cancel":  "Annuler",
    "modal.btn-compact-confirm": "Compacter la sélection ({n})",
    "compact.tally-one":         "1 aperçu chargé · est. ¢{cost}", // needs-review
    "compact.tally-many":        "{n} aperçus chargés · est. ¢{cost}", // needs-review

    // ---- Modals — Edit ----
    "modal.edit-title":      "Modifier l'enregistrement",
    "modal.btn-edit-cancel": "Annuler",
    "modal.btn-edit-save":   "Enregistrer",
    "modal.btn-edit-delete": "Supprimer l'enregistrement",
    "modal.btn-move":        "Déplacer",

    // ---- Modals — Delete ----
    "modal.delete-title":        "Supprimer l'enregistrement",
    "modal.delete-warning":      "Cela supprime définitivement l'enregistrement de la mémoire. Impossible à annuler.", // needs-review
    "modal.delete-confirm-hint": "Tapez delete pour confirmer",
    "modal.delete-ph":           "Tapez \"delete\" pour confirmer",
    "modal.btn-delete-cancel":   "Annuler",
    "modal.btn-delete-confirm":  "Supprimer",

    // ---- Modals — Access Key Gate ----
    "modal.btn-access-cancel": "Annuler",
    "modal.btn-access-confirm":"Continuer",

    // ---- Modals — Export Zip ----
    "modal.export-zip-title":        "Exporter les fichiers texte brut",
    "modal.export-zip-confirm-hint": "Tapez unencrypted pour confirmer votre compréhension.",
    "modal.export-zip-ph":           "Tapez \"unencrypted\" pour confirmer",
    "modal.btn-export-zip-cancel":   "Annuler",
    "modal.btn-export-zip-confirm":  "Télécharger le Zip",

    // ---- Modals — Reset ----
    "modal.reset-title":        "Réinitialiser le système de mémoire",
    "modal.reset-confirm-hint": "Tapez reset pour confirmer",
    "modal.reset-ph":           "Tapez \"reset\" pour confirmer",
    "modal.reset-name-hint":    "Nouveau nom pour ce système",
    "modal.reset-name-ph":      "Prénom",
    "modal.btn-reset-cancel":   "Annuler",
    "modal.btn-reset-confirm":  "Réinitialiser la mémoire",

    // ---- Modals — Export Backup ----
    "modal.export-title":       "Exporter la sauvegarde de mémoire",
    "modal.export-ph-pw":       "Mot de passe",
    "modal.export-ph-pw2":      "Confirmer le mot de passe",
    "modal.btn-export-cancel":  "Annuler",
    "modal.btn-export-confirm": "Exporter",
    "modal.export-include-photos":      "Inclure les photos", // needs-review
    "modal.export-include-photos-hint": "Décochez pour un fichier plus petit — vos photos restent en sécurité dans R2.", // needs-review

    // ---- Modals — Import Backup ----
    "modal.import-title":       "Importer la sauvegarde de mémoire",
    "modal.import-ph-pw":       "Mot de passe de la sauvegarde",
    "modal.btn-import-cancel":  "Annuler",
    "modal.btn-import-decrypt": "Déchiffrer",
    "modal.btn-import-back":    "← Retour",
    "modal.btn-import-cancel2": "Annuler",
    "modal.btn-import-confirm": "Écraser la mémoire",

    // ---- Drop overlay ----
    "drop.label": "Déposez le fichier pour l'attacher",
    "drop.sub":   "Images · PDF · TXT",

    // ---- Toast messages ----
    "toast.fill-worker-key":          "Veuillez remplir l'URL du Worker et la clé d'accès.",
    "toast.passphrase-too-short":     "La phrase secrète doit comporter au moins 12 caractères.",
    "toast.passphrase-mismatch":      "Les phrases secrètes ne correspondent pas.",
    "toast.enter-passphrase":         "Entrez votre phrase secrète.",
    "toast.no-passphrase-set":        "Aucune phrase configurée. Utilisez la clé d'accès pour configurer.", // needs-review
    "toast.incorrect-passphrase":     "Phrase secrète incorrecte.",
    "toast.connection-failed":        "Impossible de joindre le serveur — vérifiez votre connexion.",
    "toast.worker-fetch-failed":      "Impossible de joindre le worker — vérifiez l'URL.",
    "toast.worker-url-saved":         "URL du Worker enregistrée.",
    "toast.url-empty":                "L'URL ne peut pas être vide.",
    "toast.url-unreachable":          "Impossible de joindre cette URL. Vérifiez l'adresse et réessayez.", // needs-review
    "toast.fingerprint-enabled":      "Déverrouillage par empreinte activé.",
    "toast.fingerprint-removed":      "Déverrouillage par empreinte supprimé.",
    "toast.fingerprint-remove-failed":"Impossible de supprimer le biométrique. Réessayez.",
    "toast.current-passphrase-required": "Entrez votre phrase secrète actuelle.",
    "toast.new-passphrase-too-short": "La nouvelle phrase secrète doit comporter au moins 12 caractères.",
    "toast.new-passphrase-mismatch":  "Les nouvelles phrases secrètes ne correspondent pas.",
    "toast.nothing-to-copy":          "Rien à copier.",
    "toast.conversation-copied":      "Conversation copiée.",
    "toast.copy-failed":              "Échec de la copie — essayez de sélectionner manuellement.",
    "toast.context-reset":            "Contexte réinitialisé — la mémoire est toujours chargée.",
    "toast.mic-denied":               "Accès au microphone refusé.",
    "toast.transcription-failed":     "Échec de la transcription — vérifiez votre clé OpenAI.",
    "toast.max-attachments":          "Maximum {n} pièces jointes par message.",
    "toast.attach-add-instructions":  "Ajoutez des instructions pour le fichier joint avant d'envoyer.",
    "toast.archive-on":               "Classeur activé — anciens enregistrements inclus dans le chat et la recherche.", // needs-review
    "toast.archive-off":              "Classeur désactivé — mémoire active uniquement.", // needs-review
    "toast.autolock-disabled":        "Verrouillage automatique désactivé.",
    "toast.autolock-set":             "Verrouillage automatique réglé sur {label}.",
    "toast.cap-disabled":             "Plafond de dépenses quotidien désactivé.",
    "toast.cap-set":                  "Plafond de dépenses quotidien réglé à ${n}/jour.",
    "toast.cap-save-failed":          "Impossible d'enregistrer le plafond : {error}",
    "toast.model-sonnet":             "Passé à Sonnet (meilleure qualité)",
    "toast.model-haiku":              "Passé à Haiku (coût réduit)",
    "toast.voice-switched":           "Voix : {name}",
    "toast.voice-input-set":          "Saisie vocale : {label}",
    "toast.photo-delete-failed":      "Impossible de supprimer la photo : {error}", // needs-review
    "cmd.desc.archive":                    "déplacer un enregistrement vers l'archive (recherche approximative)", // needs-review
    "cmd.desc.archive-review":             "l'IA suggère des candidats à archiver · ajoutez [fichier] [deep] [contexte]", // needs-review
    "cmd.desc.archive-review-ignored":     "voir et restaurer les suggestions d'archive ignorées", // needs-review
    "cmd.desc.deep":                       "déplacer un enregistrement vers le stockage froid (niveau rarement consulté)", // needs-review
    "cmd.desc.deep-review":                "l'IA suggère des candidats au stockage froid depuis le niveau long terme", // needs-review
    "cmd.desc.deep-review-ignored":        "voir et restaurer les suggestions de révision approfondie ignorées", // needs-review
    "cmd.desc.audit":                      "analyser la mémoire pour détecter des problèmes d'intégrité (analyse rapide, gratuite)", // needs-review
    "cmd.desc.audit-deep":                 "+ détection assistée par Haiku des quasi-doublons et divergences de noms (~3¢)", // needs-review
    "cmd.desc.audit-ignored":              "voir et restaurer les résultats d'audit ignorés", // needs-review
    "cmd.desc.restore":                    "restaurer un enregistrement de l'archive ou du stockage froid vers l'actif", // needs-review
    "cmd.desc.cls":                        "effacer le chat visible ET réinitialiser le contexte de Claude (supprime l'historique de conversation)", // needs-review
    "cmd.desc.compact":                    "compacter un enregistrement — choisissez Normal/Moyen/Élevé dans l'aperçu", // needs-review
    "cmd.desc.compact-review":             "faire remonter les enregistrements verbeux dans les quatre fichiers", // needs-review
    "cmd.desc.compact-review-people":      "faire remonter les enregistrements verbeux de people.md", // needs-review
    "cmd.desc.compact-review-loops":       "faire remonter les enregistrements verbeux de loops.md", // needs-review
    "cmd.desc.compact-review-fragments":   "faire remonter les enregistrements verbeux de fragments.md", // needs-review
    "cmd.desc.compact-review-reflections": "faire remonter les enregistrements verbeux de reflections.md", // needs-review
    "cmd.desc.browse-people":              "lister tous les enregistrements de people.md triés par taille", // needs-review
    "cmd.desc.browse-loops":               "lister tous les enregistrements de loops.md triés par taille", // needs-review
    "cmd.desc.browse-fragments":           "lister tous les enregistrements de fragments.md triés par taille", // needs-review
    "cmd.desc.browse-reflections":         "lister tous les enregistrements de reflections.md triés par taille", // needs-review
    "cmd.desc.browse-archive-people":      "lister les personnes archivées triées par taille", // needs-review
    "cmd.desc.browse-archive-loops":       "lister les boucles archivées triées par taille", // needs-review
    "cmd.desc.browse-archive-fragments":   "lister les fragments archivés triés par taille", // needs-review
    "cmd.desc.browse-archive-reflections": "lister les réflexions archivées triées par taille", // needs-review
    "cmd.desc.browse-cold-people":         "lister les personnes en stockage froid triées par taille", // needs-review
    "cmd.desc.browse-cold-loops":          "lister les boucles en stockage froid triées par taille", // needs-review
    "cmd.desc.browse-cold-fragments":      "lister les fragments en stockage froid triés par taille", // needs-review
    "cmd.desc.browse-cold-reflections":    "lister les réflexions en stockage froid triées par taille", // needs-review
    "cmd.desc.costs":                      "afficher l'estimation du coût de l'API Claude aujourd'hui et cette semaine", // needs-review
    "cmd.desc.delete":                     "supprimer définitivement un enregistrement (nécessite de saisir delete)", // needs-review
    "cmd.desc.diagnostics":                "santé du système : tailles mémoire, journal des coûts, erreurs", // needs-review
    "cmd.desc.security":                   "afficher l'historique de connexion récent (lieu, appareil, méthode)", // needs-review
    "cmd.desc.edit":                       "modifier un enregistrement directement (recherche approximative)", // needs-review
    "cmd.desc.export":                     "télécharger une sauvegarde chiffrée de tous les fichiers mémoire", // needs-review
    "cmd.desc.export-plain":               "télécharger un zip en texte clair de tous les fichiers mémoire (non chiffré)", // needs-review
    "cmd.desc.help":                       "afficher les commandes disponibles", // needs-review
    "cmd.desc.import":                     "restaurer les fichiers mémoire depuis une sauvegarde chiffrée ou un zip en texte clair", // needs-review
    "cmd.desc.journal":                    "peaufiner et enregistrer une entrée de journal dans reflections.md", // needs-review
    "cmd.desc.journal-flush":              "déplacer les entrées de journal de plus de 60 jours vers l'archive (ajoutez un nombre pour modifier)", // needs-review
    "cmd.desc.memory-game":                "démarrer un quiz de mémorisation des personnes", // needs-review
    "cmd.desc.mnemonic":                   "[nom] pour générer · [nom : votre texte] pour enregistrer le vôtre", // needs-review
    "cmd.desc.l":                          "verrouiller l'application immédiatement", // needs-review
    "cmd.desc.r":                          "supprimer l'historique de conversation (défilement du chat conservé · fichiers mémoire restent chargés)", // needs-review
    "cmd.desc.recall":                     "parcourir les titres du stockage froid · ¢ avec un terme de recherche", // needs-review
    "cmd.desc.references":                 "trouver tous les enregistrements mentionnant un nom ou un sujet", // needs-review
    "cmd.desc.import-contacts":             "importer des contacts depuis un fichier .vcf (vCard) ou .csv — crée des enregistrements dans people.md", // needs-review
    "cmd.desc.reset":                      "réinitialiser tous les fichiers mémoire à des modèles vierges (nécessite la Clé d'Accès)", // needs-review
    "tooltip.apikey-save":     "Écriture seule — une fois enregistrée, la valeur ne peut pas être relue", // needs-review
    "tooltip.apikey-clear":    "Supprime votre clé enregistrée et revient à la clé définie lors de l'installation", // needs-review
    "tooltip.deep-badge":      "Stockage froid — appuyez pour parcourir", // needs-review
    "tooltip.cls-btn":         "Appuyer : effacer le chat (/cls) · Maintenir : réinitialiser le contexte (/r)", // needs-review
    "tooltip.copy-chat":       "Copier la conversation", // needs-review
    "tooltip.settings":        "Paramètres", // needs-review
    "tooltip.model-btn":       "Appuyez pour changer de modèle", // needs-review
    "tooltip.archive-btn":     "Appuyez pour inclure les fichiers d'archive dans le chat et la recherche", // needs-review
    "archive.label.off":       "📦 Archive : OFF", // needs-review
    "archive.label.on":        "📦 Archive : ON", // needs-review
    "archive.tip.off":         "Archive DÉSACTIVÉE — mémoire active uniquement. Appuyez pour inclure les anciens enregistrements.", // needs-review
    "archive.tip.on":          "Archive ACTIVÉE — anciens enregistrements inclus. Utilise plus de tokens. Appuyez pour désactiver.", // needs-review
    "header.context-reset":    "↺ Réinitialiser le contexte", // needs-review
    "tooltip.vault-clear":     "Retirer l'enregistrement du stockage froid du contexte", // needs-review
    "tooltip.attach-btn":      "Joindre un fichier", // needs-review
    "tooltip.conv-btn":        "Mode conversation", // needs-review
    "tooltip.conv-reset-ctx":  "Effacer l'historique de conversation — la mémoire reste chargée", // needs-review
    "tooltip.conv-voice":      "Appuyez pour changer de voix", // needs-review
    "tooltip.conv-archive":    "Appuyez pour inclure les fichiers d'archive dans le chat", // needs-review
    "tooltip.conv-mute":       "Couper le microphone", // needs-review
    "tooltip.conv-discard":    "Ignorer le dernier fragment", // needs-review
    "tooltip.conv-finish":     "Terminer le journal", // needs-review
    "conv.discard":            "↺ Ignorer", // needs-review
    "conv.finish":             "✓ Terminer", // needs-review
    "conv.exit":               "✕ Quitter", // needs-review
    "conv.recording-journal":  "Journal en cours", // needs-review
    "conv.keep-going":         "Continuer", // needs-review
    "conv.exit-anyway":        "Quitter quand même", // needs-review
    "conv.label.idle":         "Appuyer pour parler · Maintenir pour journal", // needs-review
    "conv.label.listening":    "Écoute en cours...", // needs-review
    "conv.label.starting":     "Démarrage...", // needs-review
    "conv.label.recording":    "Enregistrement...", // needs-review
    "conv.label.thinking":     "Réflexion...", // needs-review
    "conv.label.speaking":     "Appuyer sur l'orbe pour interrompre", // needs-review
    "conv.label.hold-to-record":  "Maintenir l'orbe · Appuyer sur Terminer quand c'est fait", // needs-review
    "conv.label.chunks-ready":    "Maintenir pour plus · Toucher un fragment · Retoucher pour modifier", // needs-review
    "conv.label.paused":          "Appuyer sur l'orbe pour parler  •  Maintenir pour journal", // needs-review
    "conv.label.muted":           "Muet  •  ↺ pour ignorer", // needs-review
    "conv.label.captured":        "Appuyer sur l'orbe pour envoyer  •  ↺ ignorer", // needs-review
    "conv.label.discarded":       "Ignoré", // needs-review
    "conv.exit-msg-default":      "Quitter le journal ? Votre dictée sera perdue.", // needs-review
    "conv.exit-msg-one":          "Quitter le journal ? Votre 1 fragment enregistré sera perdu.", // needs-review
    "conv.exit-msg-many":         "Quitter le journal ? Vos {n} fragments enregistrés seront perdus.", // needs-review
    "conv.chunks-resume-one":     "1 fragment · Maintenir pour plus", // needs-review
    "conv.chunks-resume-many":    "{n} fragments · Maintenir pour plus", // needs-review
    "tooltip.modal-close":     "Fermer", // needs-review
    "tooltip.voice-unsupported":"Voix non prise en charge par ce navigateur", // needs-review
    "tooltip.sort-name":       "Trier par nom", // needs-review
    "tooltip.sort-size":       "Trier par taille", // needs-review
    "tooltip.cache-hit":       "Cache de prompt actif — votre mémoire était déjà en cache, ce message a utilisé ~90% moins de tokens", // needs-review
    "tooltip.cache-miss":      "Nouvelle session — la mémoire a été relue et mise en cache. Les futurs messages coûteront beaucoup moins", // needs-review
    "tooltip.dismiss":         "Ignorer", // needs-review
    "install.banner":          "Ajoutez WhosWhoZoo à votre écran d'accueil pour y accéder plus vite.", // needs-review
    "install.btn":             "Installer", // needs-review
    "tooltip.audit-ignore":    "N'apparaîtra plus dans les futurs audits.", // needs-review
    "tooltip.skip-suggest":    "Ne plus jamais suggérer", // needs-review
    "tooltip.delete-chunk":    "Supprimer ce fragment", // needs-review
    "tooltip.remove":          "Supprimer", // needs-review
    "tooltip.photo-delete":    "Supprimer la photo", // needs-review
    "tooltip.photo-chip":      "Voir les photos de {name}", // needs-review
    "tooltip.show-passphrase": "Afficher la phrase secrète", // needs-review
    "tooltip.stop-btn":        "Arrêter la génération", // needs-review
    "tooltip.send":            "Envoyer", // needs-review
    "tooltip.model-sonnet":    "Sonnet — réponses plus intelligentes et nuancées. ~5× coût plus élevé par message. Appuyez pour passer à Haiku.", // needs-review
    "tooltip.model-haiku":       "Haiku — rapide et économique. Idéal pour les questions quotidiennes. Appuyez pour passer à Sonnet pour les tâches complexes.", // needs-review
    "tooltip.badge-memory-only": "~{totalK}K tokens · {pct} du budget mémoire (pas encore d'historique)", // needs-review
    "tooltip.badge-breakdown":   "~{totalK}K tokens · {pct} du budget ({parts})", // needs-review
    "tooltip.badge-part-memory": "{n}K mémoire", // needs-review
    "tooltip.badge-part-vault":  "{n}K coffre", // needs-review
    "tooltip.badge-part-history":"{n}K historique", // needs-review
    "tooltip.conv-ctx-suffix":   " — appuyez sur ↺ pour effacer l'historique si les réponses semblent lentes ou incomplètes", // needs-review

    // ---- Daily brief (open loops at session start) ----
    "brief.header":              "📋 Boucles ouvertes — {summary}", // needs-review
    "brief.part-overdue":        "{n} en retard", // needs-review
    "brief.part-due-today":      "{n} pour aujourd'hui", // needs-review
    "brief.part-due-week":       "{n} pour cette semaine", // needs-review
    "brief.part-open-tasks":     "{n} avec tâches ouvertes", // needs-review
    "brief.part-new":            "{n} ouverte", // needs-review
    "brief.badge-overdue":       "⚠ en retard ({date})", // needs-review
    "brief.badge-due-today":     "• pour aujourd'hui", // needs-review
    "brief.badge-due-date":      "• pour le {date}", // needs-review
    "brief.badge-open-tasks":    "• tâches ouvertes", // needs-review
    "brief.badge-new":           "• ouverte", // needs-review
    "brief.toast-load-failed":   "Impossible de charger la boucle", // needs-review
    "brief.toast-open-failed":   "Impossible d'ouvrir la boucle", // needs-review
    "brief.hint":                "Appuyer pour ouvrir · ou dire \"ferme ma tâche [nom]\"", // needs-review

    // ---- Photo UI ----
    "photo.strip.label":         "Photos ({n})", // needs-review
    "photo.strip.add":           "Ajouter une photo", // needs-review

    // ---- Audit actions ----
    "audit.btn-delete-r2":       "Supprimer de R2", // needs-review
    "audit.btn-open-record":     "Ouvrir l'enregistrement", // needs-review
  },

  hi: {
    // ---- Setup screen ----
    "setup.subtitle-new":       "शुरू करने के लिए अपनी मेमोरी को कनेक्ट करें।", // needs-review
    "setup.subtitle-recovery":  "अपनी फ्रेज़ रीसेट करने के लिए Access Key दर्ज करें।", // needs-review
    "setup.privacy-note":       "आपकी नोट्स आपके अपने निजी अकाउंट में सेव होती हैं — कभी AI ट्रेनिंग के लिए इस्तेमाल नहीं होतीं, और कभी हम तक नहीं पहुँचतीं।", // needs-review
    "setup.label-worker-url":   "Worker URL",
    "setup.label-access-key":   "Access Key",
    "setup.label-access-key-hint": "(सेटअप से)", // needs-review
    "setup.label-passphrase":   "एक फ्रेज़ चुनें", // needs-review
    "setup.label-confirm":      "फ्रेज़ की पुष्टि करें", // needs-review
    "setup.ph-worker-url":      "https://your-worker.workers.dev",
    "setup.ph-access-key":      "अपनी access key पेस्ट करें", // needs-review
    "setup.ph-passphrase":      "कम से कम 12 अक्षर", // needs-review
    "setup.ph-confirm":         "फ्रेज़ की पुष्टि करें", // needs-review
    "setup.btn-setup":          "सेट अप करें", // needs-review
    "setup.btn-setup-loading":  "सेट अप हो रहा है…", // needs-review
    "setup.link-how":           "यह कैसे काम करता है? →", // needs-review

    // ---- Login screen ----
    "login.subtitle-new-visitor": "WhosWhoZoo एक पर्सनल मेमोरी ऐप है — हर यूज़र अपनी कॉपी चलाता है। अगर यह आपकी है तो साइन इन करें, या अपनी सेट अप करने के लिए whoszoo.app पर जाएँ।", // needs-review
    "login.subtitle-returning": "वापस स्वागत है। जारी रखने के लिए अपनी फ्रेज़ दर्ज करें।", // needs-review
    "login.label-passphrase":   "फ्रेज़", // needs-review
    "login.ph-passphrase":      "अपनी फ्रेज़ दर्ज करें", // needs-review
    "login.btn-unlock":         "अनलॉक करें", // needs-review
    "login.btn-unlock-loading": "अनलॉक हो रहा है…", // needs-review
    "login.btn-biometric":      "फिंगरप्रिंट का उपयोग करें", // needs-review
    "login.btn-forgot":         "फ्रेज़ भूल गए? रीसेट करने के लिए access key का उपयोग करें →", // needs-review

    // ---- Settings panel ----
    "settings.title":           "सेटिंग्स", // needs-review
    "settings.btn-back":        "← ऐप पर वापस जाएँ", // needs-review
    "settings.btn-change-passphrase": "फ्रेज़ बदलें", // needs-review
    "settings.btn-signout":     "साइन आउट करें", // needs-review
    "settings.btn-help":        "सहायता और दस्तावेज़", // needs-review
    "settings.btn-share":       "किसी दोस्त को WhosWhoZoo सुझाएँ", // needs-review
    "settings.share-message":   "WhosWhoZoo — एक निजी मेमोरी ऐप। याद रखने लायक बातें मैं इसे बता देता हूँ — लोग, बातचीत, अधूरे काम — और बाद में इससे पूछ लेता हूँ।",  // needs-review
    "settings.share-copied":    "मैसेज कॉपी हो गया — लिंक whoszoo.app पर जाता है", // needs-review
    "settings.share-failed":    "कॉपी नहीं हो सका — लिंक है whoszoo.app", // needs-review
    "settings.access-key-note": "Access Key को <a href='https://whoszoo.app/setup' target='_blank' rel='noopener'>whoszoo.app/setup</a> पर बदला जा सकता है", // needs-review
    "settings.label-voice":        "वॉयस इनपुट", // needs-review
    "settings.opt-auto":           "Auto",
    "settings.opt-whisper":        "Whisper (सटीक)", // needs-review
    "voice.privacy.body":          "🎙 आपके पहले वॉयस सेशन से पहले एक बात। Auto मोड तेज़ और मुफ़्त है, लेकिन Chrome और Edge पर यह आपकी रिकॉर्डिंग Google की वॉयस सेवा को भेजता है, आपके अपने Worker से होकर नहीं। रोज़मर्रा के सवालों के लिए यह ठीक सौदा है। कुछ गोपनीय बोलने जा रहे हैं? Whisper ऑडियो को आपके Worker से होकर OpenAI तक भेजता है, ऐसी शर्तों के तहत जो ट्रेनिंग की अनुमति नहीं देतीं, और लागत प्रति रिकॉर्डिंग एक पैसे का अंश भर है। इसे कभी भी सेटिंग्स → वॉयस इनपुट में बदल सकते हैं।", // needs-review
    "voice.privacy.switch":        "🔒 Whisper इस्तेमाल करें", // needs-review
    "voice.privacy.keep":          "⚡ Auto ही रखें", // needs-review
    "voice.privacy.switched":      "Whisper पर बदल दिया", // needs-review
    "settings.label-whisper-lang": "वॉयस भाषा", // needs-review
    "settings.label-autolock":     "ऑटो-लॉक", // needs-review
    "settings.opt-never":       "कभी नहीं", // needs-review
    "settings.opt-on":          "चालू", // needs-review
    "settings.opt-off":         "बंद", // needs-review
    "settings.label-cap":       "दैनिक खर्च सीमा", // needs-review
    "settings.label-token-saver":  "Token Saver", // needs-review
    "settings.hint-token-saver":   "वॉइस मोड से बाहर निकलने पर बातचीत का इतिहास हटाता है।", // needs-review
    "settings.label-language":  "भाषा", // needs-review
    "settings.toggle-advanced": "उन्नत", // needs-review
    "settings.toggle-apikeys":  "API Keys",
    "settings.label-worker-url-adv":  "Worker URL",
    "settings.hint-worker-url-adv":   "यह तभी बदलें जब आपने नए पते पर री-डिप्लॉय किया हो।", // needs-review
    "settings.btn-test-save":         "टेस्ट करें और सेव करें", // needs-review
    "settings.btn-test-save-loading": "टेस्ट हो रहा है…", // needs-review
    "settings.hint-apikeys":    "केवल लिखने के लिए — वैल्यू आपके worker पर सेव होती हैं। मौजूदा key रखने के लिए खाली छोड़ें।", // needs-review
    "settings.apikey-source-setup": "✓ सेटअप की key उपयोग हो रही है", // needs-review
    "settings.apikey-source-app":   "✓ यहाँ सेव की गई key उपयोग हो रही है", // needs-review
    "settings.apikey-not-configured": "कॉन्फ़िगर नहीं है", // needs-review
    "settings.apikey-btn-save":         "सेव करें", // needs-review
    "settings.apikey-btn-save-loading": "सेव हो रहा है…", // needs-review
    "settings.apikey-btn-clear":         "ओवरराइड हटाएँ", // needs-review
    "settings.apikey-btn-clear-loading": "हटाया जा रहा है…", // needs-review
    "settings.apikey-cleared":   "हटाया गया — इंस्टॉल key का उपयोग हो रहा है।", // needs-review
    "settings.apikey-enter-value": "एक key वैल्यू दर्ज करें।", // needs-review
    "settings.apikey-saved":     "सेव हो गया।", // needs-review
    "settings.fingerprint-unavailable": "फिंगरप्रिंट अनलॉक", // needs-review
    "settings.fingerprint-unavailable-badge": "इस ब्राउज़र पर उपलब्ध नहीं", // needs-review
    "settings.fingerprint-setup": "फिंगरप्रिंट अनलॉक सेट करें", // needs-review
    "settings.fingerprint-remove-badge": "✓ हटाएँ", // needs-review
    "settings.btn-install":         "होम स्क्रीन पर इंस्टॉल करें", // needs-review
    "settings.install-done-badge": "✓ इंस्टॉल हो चुकी", // needs-review
    "settings.install-retry":      "इस पेज पर अभी तैयार नहीं — रीलोड करके देखें।", // needs-review
    "settings.fingerprint-setup-loading": "सेट अप हो रहा है…", // needs-review

    // ---- Change passphrase sub-form ----
    "cp.label-current":  "मौजूदा फ्रेज़", // needs-review
    "cp.label-new":      "नई फ्रेज़", // needs-review
    "cp.label-confirm":  "नई फ्रेज़ की पुष्टि करें", // needs-review
    "cp.ph-current":     "मौजूदा फ्रेज़", // needs-review
    "cp.ph-new":         "कम से कम 12 अक्षर", // needs-review
    "cp.ph-confirm":     "नई फ्रेज़ की पुष्टि करें", // needs-review
    "cp.btn-update":     "फ्रेज़ अपडेट करें", // needs-review
    "cp.btn-back":       "← सेटिंग्स पर वापस", // needs-review

    // ---- Installer link ----
    "install.get-title": "सेट अप करें →", // needs-review
    "install.get-sub":   "whoszoo.app — सेटअप विज़ार्ड, इंस्टॉल गाइड और यह कैसे काम करता है", // needs-review

    // ---- Loading screen ----
    "loading.text": "आपकी यादें लोड हो रही हैं...", // needs-review

    // ---- Chat UI ----
    "chat.cold-storage-cleared": "Cold storage रिकॉर्ड संदर्भ से हटा दिया गया।", // needs-review
    "chat.cleared":              "Chat साफ हो गया। मेमोरी अभी भी लोड है।", // needs-review
    "chat.biometric-offer":      "अगली बार फ्रेज़ टाइप किए बिना साइन इन करने के लिए फिंगरप्रिंट अनलॉक चालू करें।", // needs-review
    "chat.input-placeholder":    "अपनी मेमोरी से पूछें...", // needs-review
    "chat.attach-placeholder":   "संलग्न फ़ाइल के लिए निर्देश जोड़ें...", // needs-review
    "chat.last-login":           "आखिरी लॉगिन: {time}", // needs-review
    "chat.bulk-since-login":     "⚠ आपके आखिरी लॉगिन के बाद {count} डेटा एक्सपोर्ट/इमपोर्ट: {actions}। यदि यह आप नहीं थे, तो अभी अपना फ्रेज़ बदलें।", // needs-review
    "security.method.passphrase":"फ्रेज़", // needs-review
    "security.method.biometric": "बायोमेट्रिक", // needs-review
    "security.method.setup":     "प्रारंभिक सेटअप", // needs-review
    "security.method.recovery":  "Access Key रिकवरी", // needs-review
    "security.method.failed":    "विफल प्रयास", // needs-review
    "security.method.export":    "एन्क्रिप्टेड एक्सपोर्ट", // needs-review
    "security.method.export-plain":"प्लेन-टेक्स्ट एक्सपोर्ट", // needs-review
    "security.method.import":    "इमपोर्ट (मेमोरी ओवरराइट)", // needs-review
    "modal.reauth-title":        "पुष्टि करें कि यह आप ही हैं", // needs-review
    "modal.reauth-desc":         "यह आपकी मेमोरी की पूरी कॉपी बनाता या पुनःस्थापित करता है। जारी रखने के लिए अपना फ्रेज़ दर्ज करें।", // needs-review
    "modal.reauth-ph":           "अपना फ्रेज़ दर्ज करें", // needs-review
    "modal.reauth-wrong":        "फ्रेज़ गलत।", // needs-review
    "chat.audit-ignored-time":   "· {time} को नज़रअंदाज़ किया", // needs-review
    "chat.photo-one-at-a-time":    "⚠ कृपया एक बार में एक फ़ोटो जोड़ें — प्रति संदेश एक इमेज अटैच करें और मुझसे सेव करने के लिए कहें।", // needs-review
    "chat.photo-data-unavailable": "⚠ फ़ोटो डेटा उपलब्ध नहीं है — फ़ोटो अटैच करें और फिर से कोशिश करें।", // needs-review
    "chat.photo-r2-required":      "⚠ फ़ोटो के लिए R2 स्टोरेज चाहिए। सहायता → R2 सेटअप देखें — यह Cloudflare के फ्री टियर पर मुफ़्त है।", // needs-review
    "chat.photo-upload-failed":    "⚠ फ़ोटो अपलोड विफल: {error}", // needs-review
    "chat.photo-added":            "📷 {name} के रिकॉर्ड में फ़ोटो जोड़ी गई।", // needs-review
    "chat.photo-saved-partial":    "⚠ फ़ोटो स्टोरेज में सेव हुई पर {name} का रिकॉर्ड अपडेट नहीं हो पाया: {error}। उनके ### Photos सेक्शन में मैन्युअल रूप से – Photo: {filename} जोड़ें।", // needs-review
    "chat.photo-save-failed":      "⚠ फ़ोटो सेव विफल: {error}", // needs-review
    "chat.photo-zip-summary":      "ZIP एक्सपोर्ट हुआ — {done}/{total} फ़ोटो शामिल।", // needs-review
    "chat.photo-restore-progress": "फ़ोटो रिस्टोर हो रही हैं ({done} में से {total})…", // needs-review
    "chat.photo-restore-all":      "{n} फ़ोटो रिस्टोर हुई", // needs-review
    "chat.photo-restore-none":     "⚠ फ़ोटो रिस्टोर नहीं हुईं — इस worker पर R2 कॉन्फ़िगर नहीं है", // needs-review
    "chat.photo-restore-partial":  "{done}/{total} फ़ोटो रिस्टोर हुईं (कुछ विफल)", // needs-review
    "time.days-ago-one":         "1 दिन पहले", // needs-review
    "time.days-ago-many":        "{n} दिन पहले", // needs-review
    "time.hours-ago-one":        "1 घंटा पहले", // needs-review
    "time.hours-ago-many":       "{n} घंटे पहले", // needs-review
    "time.just-now":             "अभी-अभी", // needs-review

    // ---- Modals — Preview ----
    "modal.preview-title": "मेमोरी प्रीव्यू", // needs-review
    "modal.btn-cancel":    "रद्द करें", // needs-review
    "modal.btn-save":      "सेव करें", // needs-review

    // ---- Modals — Archive Review ----
    "modal.archive-title":      "आर्काइव समीक्षा", // needs-review
    "modal.btn-archive-cancel": "रद्द करें", // needs-review
    "modal.btn-archive-confirm": "चुने हुए आर्काइव करें ({n})", // needs-review

    // ---- Modals — Cold Storage Review ----
    "modal.deep-title":      "Cold Storage समीक्षा", // needs-review
    "modal.btn-deep-cancel": "रद्द करें", // needs-review
    "modal.btn-deep-confirm": "Cold Storage में ले जाएँ ({n})", // needs-review

    // ---- Modals — Compact Review ----
    "modal.compact-title":      "कॉम्पैक्ट समीक्षा", // needs-review
    "modal.btn-compact-cancel": "रद्द करें", // needs-review
    "modal.btn-compact-confirm": "चुने हुए कॉम्पैक्ट करें ({n})", // needs-review
    "compact.tally-one":        "1 प्रीव्यू लोड हुआ · अनुमान ¢{cost}", // needs-review
    "compact.tally-many":       "{n} प्रीव्यू लोड हुए · अनुमान ¢{cost}", // needs-review

    // ---- Modals — Edit ----
    "modal.edit-title":      "रिकॉर्ड संपादित करें", // needs-review
    "modal.btn-edit-cancel": "रद्द करें", // needs-review
    "modal.btn-edit-save":   "सेव करें", // needs-review
    "modal.btn-edit-delete": "रिकॉर्ड हटाएँ", // needs-review
    "modal.btn-move":        "ले जाएँ", // needs-review

    // ---- Modals — Delete ----
    "modal.delete-title":       "रिकॉर्ड हटाएँ", // needs-review
    "modal.delete-warning":     "यह रिकॉर्ड मेमोरी से स्थायी रूप से हटा देगा। यह पूर्ववत नहीं किया जा सकता।", // needs-review
    "modal.delete-confirm-hint": "पुष्टि के लिए delete टाइप करें", // needs-review
    "modal.delete-ph":          "पुष्टि के लिए \"delete\" टाइप करें", // needs-review
    "modal.btn-delete-cancel":  "रद्द करें", // needs-review
    "modal.btn-delete-confirm": "हटाएँ", // needs-review

    // ---- Modals — Access Key Gate ----
    "modal.btn-access-cancel": "रद्द करें", // needs-review
    "modal.btn-access-confirm": "जारी रखें", // needs-review

    // ---- Modals — Export Zip ----
    "modal.export-zip-title":        "प्लेन टेक्स्ट फ़ाइलें एक्सपोर्ट करें", // needs-review
    "modal.export-zip-confirm-hint": "पुष्टि के लिए unencrypted टाइप करें कि आप समझ गए हैं।", // needs-review
    "modal.export-zip-ph":           "पुष्टि के लिए \"unencrypted\" टाइप करें", // needs-review
    "modal.btn-export-zip-cancel":   "रद्द करें", // needs-review
    "modal.btn-export-zip-confirm":  "Zip डाउनलोड करें", // needs-review

    // ---- Modals — Reset ----
    "modal.reset-title":       "मेमोरी सिस्टम रीसेट करें", // needs-review
    "modal.reset-confirm-hint": "पुष्टि के लिए reset टाइप करें", // needs-review
    "modal.reset-ph":          "पुष्टि के लिए \"reset\" टाइप करें", // needs-review
    "modal.reset-name-hint":   "इस सिस्टम के लिए नया नाम", // needs-review
    "modal.reset-name-ph":     "पहला नाम", // needs-review
    "modal.btn-reset-cancel":  "रद्द करें", // needs-review
    "modal.btn-reset-confirm": "मेमोरी रीसेट करें", // needs-review

    // ---- Modals — Export Backup ----
    "modal.export-title":       "मेमोरी बैकअप एक्सपोर्ट करें", // needs-review
    "modal.export-ph-pw":       "पासवर्ड", // needs-review
    "modal.export-ph-pw2":      "पासवर्ड की पुष्टि करें", // needs-review
    "modal.btn-export-cancel":  "रद्द करें", // needs-review
    "modal.btn-export-confirm": "एक्सपोर्ट करें", // needs-review
    "modal.export-include-photos":      "फ़ोटो शामिल करें", // needs-review
    "modal.export-include-photos-hint": "छोटी फ़ाइल के लिए अनचेक करें — आपकी फ़ोटो R2 में सुरक्षित हैं।", // needs-review

    // ---- Modals — Import Backup ----
    "modal.import-title":       "मेमोरी बैकअप इंपोर्ट करें", // needs-review
    "modal.import-ph-pw":       "बैकअप पासवर्ड", // needs-review
    "modal.btn-import-cancel":  "रद्द करें", // needs-review
    "modal.btn-import-decrypt": "डिक्रिप्ट करें", // needs-review
    "modal.btn-import-back":    "← वापस", // needs-review
    "modal.btn-import-cancel2": "रद्द करें", // needs-review
    "modal.btn-import-confirm": "मेमोरी ओवरराइट करें", // needs-review

    // ---- Drop overlay ----
    "drop.label": "फ़ाइल अटैच करने के लिए यहाँ छोड़ें", // needs-review
    "drop.sub":   "Images · PDF · TXT",

    // ---- Toast messages ----
    "toast.fill-worker-key":          "कृपया Worker URL और access key भरें।", // needs-review
    "toast.passphrase-too-short":     "फ्रेज़ कम से कम 12 अक्षरों की होनी चाहिए।", // needs-review
    "toast.passphrase-mismatch":      "फ्रेज़ मेल नहीं खातीं।", // needs-review
    "toast.enter-passphrase":         "अपनी फ्रेज़ दर्ज करें।", // needs-review
    "toast.no-passphrase-set":        "कोई फ्रेज़ सेट नहीं है। सेट अप के लिए access key का उपयोग करें।", // needs-review
    "toast.incorrect-passphrase":     "गलत फ्रेज़।", // needs-review
    "toast.connection-failed":        "सर्वर से कनेक्ट नहीं हो पाया — अपना कनेक्शन जाँचें।", // needs-review
    "toast.worker-fetch-failed":      "Worker तक नहीं पहुँच पाया — URL जाँचें।", // needs-review
    "toast.worker-url-saved":         "Worker URL सेव हो गया।", // needs-review
    "toast.url-empty":                "URL खाली नहीं हो सकता।", // needs-review
    "toast.url-unreachable":          "उस URL तक नहीं पहुँच पाया। पता जाँचें और फिर कोशिश करें।", // needs-review
    "toast.fingerprint-enabled":      "फिंगरप्रिंट अनलॉक चालू हो गया।", // needs-review
    "toast.fingerprint-removed":      "फिंगरप्रिंट अनलॉक हटा दिया गया।", // needs-review
    "toast.fingerprint-remove-failed":"बायोमेट्रिक नहीं हटाया जा सका। फिर कोशिश करें।", // needs-review
    "toast.current-passphrase-required": "अपनी मौजूदा फ्रेज़ दर्ज करें।", // needs-review
    "toast.new-passphrase-too-short": "नई फ्रेज़ कम से कम 12 अक्षरों की होनी चाहिए।", // needs-review
    "toast.new-passphrase-mismatch":  "नई फ्रेज़ मेल नहीं खातीं।", // needs-review
    "toast.nothing-to-copy":          "कॉपी करने के लिए कुछ नहीं है।", // needs-review
    "toast.conversation-copied":      "बातचीत कॉपी हो गई।", // needs-review
    "toast.copy-failed":              "कॉपी विफल हुई — मैन्युअल रूप से चुनें।", // needs-review
    "toast.context-reset":            "संदर्भ रीसेट हो गया — मेमोरी अभी भी लोड है।", // needs-review
    "toast.mic-denied":               "माइक्रोफ़ोन का एक्सेस नकारा गया।", // needs-review
    "toast.transcription-failed":     "ट्रांसक्रिप्शन विफल हुआ — अपनी OpenAI key जाँचें।", // needs-review
    "toast.max-attachments":          "प्रति संदेश अधिकतम {n} अटैचमेंट।", // needs-review
    "toast.attach-add-instructions":  "भेजने से पहले संलग्न फ़ाइल के लिए निर्देश जोड़ें।", // needs-review
    "toast.archive-on":               "फाइलिंग कैबिनेट चालू — पुराने रिकॉर्ड chat और खोज में शामिल।", // needs-review
    "toast.archive-off":              "फाइलिंग कैबिनेट बंद — केवल सक्रिय मेमोरी।", // needs-review
    "toast.autolock-disabled":        "ऑटो-लॉक बंद हो गया।", // needs-review
    "toast.autolock-set":             "ऑटो-लॉक {label} पर सेट हो गया।", // needs-review
    "toast.cap-disabled":             "दैनिक खर्च सीमा बंद हो गई।", // needs-review
    "toast.cap-set":                  "दैनिक खर्च सीमा ${n}/दिन सेट हो गई।", // needs-review
    "toast.cap-save-failed":          "सीमा सेव नहीं हो पाई: {error}", // needs-review
    "toast.model-sonnet":             "Sonnet पर स्विच किया (बेहतर गुणवत्ता)", // needs-review
    "toast.model-haiku":              "Haiku पर स्विच किया (कम लागत)", // needs-review
    "toast.voice-switched":           "आवाज़: {name}", // needs-review
    "toast.voice-input-set":          "वॉयस इनपुट: {label}", // needs-review
    "toast.photo-delete-failed":      "फ़ोटो नहीं हटाई जा सकी: {error}", // needs-review
    "cmd.desc.archive":                    "एक रिकॉर्ड को आर्काइव में ले जाएँ (फ़ज़ी सर्च)", // needs-review
    "cmd.desc.archive-review":             "AI आर्काइव उम्मीदवार सुझाता है · [file] [deep] [context] जोड़ें", // needs-review
    "cmd.desc.archive-review-ignored":     "नज़रअंदाज़ की गई आर्काइव सुझावें देखें और पुनः चालू करें", // needs-review
    "cmd.desc.deep":                       "एक रिकॉर्ड को cold storage में ले जाएँ (कम एक्सेस वाला स्तर)", // needs-review
    "cmd.desc.deep-review":                "AI long-term स्तर से cold storage उम्मीदवार सुझाता है", // needs-review
    "cmd.desc.deep-review-ignored":        "नज़रअंदाज़ की गई deep-review सुझावें देखें और पुनः चालू करें", // needs-review
    "cmd.desc.audit":                      "मेमोरी में अखंडता समस्याएँ जाँचें (त्वरित स्कैन, मुफ़्त)", // needs-review
    "cmd.desc.audit-deep":                 "+ Haiku-सहायता से नज़दीकी-डुप्लीकेट और नाम-मिसमैच पहचान (~3¢)", // needs-review
    "cmd.desc.audit-ignored":              "नज़रअंदाज़ किए गए ऑडिट परिणाम देखें और पुनः चालू करें", // needs-review
    "cmd.desc.restore":                    "आर्काइव या cold storage से कोई रिकॉर्ड सक्रिय में वापस लाएँ", // needs-review
    "cmd.desc.cls":                        "दिखाई देने वाला chat साफ करें और Claude का संदर्भ रीसेट करें (बातचीत इतिहास हटता है)", // needs-review
    "cmd.desc.compact":                    "एक विशिष्ट रिकॉर्ड कॉम्पैक्ट करें — प्रीव्यू में Normal/Medium/High चुनें", // needs-review
    "cmd.desc.compact-review":             "सभी चार फ़ाइलों में विस्तृत रिकॉर्ड दिखाएँ", // needs-review
    "cmd.desc.compact-review-people":      "people.md के विस्तृत रिकॉर्ड दिखाएँ", // needs-review
    "cmd.desc.compact-review-loops":       "loops.md के विस्तृत रिकॉर्ड दिखाएँ", // needs-review
    "cmd.desc.compact-review-fragments":   "fragments.md के विस्तृत रिकॉर्ड दिखाएँ", // needs-review
    "cmd.desc.compact-review-reflections": "reflections.md के विस्तृत रिकॉर्ड दिखाएँ", // needs-review
    "cmd.desc.browse-people":              "people.md के सभी रिकॉर्ड आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-loops":               "loops.md के सभी रिकॉर्ड आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-fragments":           "fragments.md के सभी रिकॉर्ड आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-reflections":         "reflections.md के सभी रिकॉर्ड आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-archive-people":      "आर्काइव किए गए लोगों को आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-archive-loops":       "आर्काइव किए गए loops को आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-archive-fragments":   "आर्काइव किए गए fragments को आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-archive-reflections": "आर्काइव किए गए reflections को आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-cold-people":         "cold storage के लोगों को आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-cold-loops":          "cold storage के loops को आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-cold-fragments":      "cold storage के fragments को आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.browse-cold-reflections":    "cold storage के reflections को आकार के अनुसार सूचीबद्ध करें", // needs-review
    "cmd.desc.costs":                      "आज और इस हफ्ते का Claude API लागत अनुमान दिखाएँ", // needs-review
    "cmd.desc.delete":                     "एक रिकॉर्ड स्थायी रूप से हटाएँ (delete टाइप करना ज़रूरी)", // needs-review
    "cmd.desc.diagnostics":                "सिस्टम स्वास्थ्य: मेमोरी आकार, लागत लॉग, त्रुटियाँ", // needs-review
    "cmd.desc.security":                   "हालिया लॉगिन इतिहास दिखाएँ (स्थान, डिवाइस, तरीका)", // needs-review
    "cmd.desc.edit":                       "कोई रिकॉर्ड सीधे संपादित करें (फ़ज़ी सर्च)", // needs-review
    "cmd.desc.export":                     "सभी मेमोरी फ़ाइलों का एन्क्रिप्टेड बैकअप डाउनलोड करें", // needs-review
    "cmd.desc.export-plain":               "सभी मेमोरी फ़ाइलों का plain-text zip डाउनलोड करें (एन्क्रिप्टेड नहीं)", // needs-review
    "cmd.desc.help":                       "उपलब्ध commands दिखाएँ", // needs-review
    "cmd.desc.import":                     "एन्क्रिप्टेड बैकअप या plain-text zip से मेमोरी फ़ाइलें रिस्टोर करें", // needs-review
    "cmd.desc.journal":                    "reflections.md में एक जर्नल एंट्री पॉलिश करके सेव करें", // needs-review
    "cmd.desc.journal-flush":              "60 दिन से पुरानी जर्नल एंट्रियाँ आर्काइव में ले जाएँ (संख्या जोड़कर बदलें)", // needs-review
    "cmd.desc.memory-game":                "लोगों की मेमोरी क्विज़ शुरू करें", // needs-review
    "cmd.desc.mnemonic":                   "[नाम] से बनाएँ · [नाम: आपका टेक्स्ट] से अपना सेव करें", // needs-review
    "cmd.desc.l":                          "ऐप को तुरंत लॉक करें", // needs-review
    "cmd.desc.r":                          "बातचीत इतिहास हटाएँ (chat स्क्रॉल रहता है · मेमोरी फ़ाइलें लोड रहती हैं)", // needs-review
    "cmd.desc.recall":                     "cold storage हेडिंग ब्राउज़ करें · खोज शब्द के साथ ¢ लागत", // needs-review
    "cmd.desc.references":                 "किसी नाम या विषय का उल्लेख करने वाले सभी रिकॉर्ड खोजें", // needs-review
    "cmd.desc.import-contacts":             ".vcf (vCard) या .csv फ़ाइल से संपर्क इंपोर्ट करें — people.md में रिकॉर्ड बनाता है", // needs-review
    "cmd.desc.reset":                      "सभी मेमोरी फ़ाइलें खाली टेम्पलेट पर रीसेट करें (Access Key ज़रूरी)", // needs-review
    "tooltip.apikey-save":     "केवल लिखने के लिए — एक बार सेव होने पर वैल्यू वापस नहीं पढ़ी जा सकती", // needs-review
    "tooltip.apikey-clear":    "आपकी सेव की गई key हटाता है और इंस्टॉलेशन के दौरान सेट key पर वापस जाता है", // needs-review
    "tooltip.deep-badge":      "Cold storage — ब्राउज़ करने के लिए टैप करें", // needs-review
    "tooltip.cls-btn":         "टैप: chat साफ करें (/cls) · लंबा दबाएँ: संदर्भ रीसेट करें (/r)", // needs-review
    "tooltip.copy-chat":       "बातचीत कॉपी करें", // needs-review
    "tooltip.settings":        "सेटिंग्स", // needs-review
    "tooltip.model-btn":       "मॉडल बदलने के लिए टैप करें", // needs-review
    "tooltip.archive-btn":     "chat और खोज में आर्काइव फ़ाइलें शामिल करने के लिए टैप करें", // needs-review
    "archive.label.off":       "📦 आर्काइव: बंद", // needs-review
    "archive.label.on":        "📦 आर्काइव: चालू", // needs-review
    "archive.tip.off":         "आर्काइव बंद — केवल सक्रिय मेमोरी। पुराने रिकॉर्ड शामिल करने के लिए टैप करें।", // needs-review
    "archive.tip.on":          "आर्काइव चालू — पुराने रिकॉर्ड शामिल हैं। अधिक tokens उपयोग होंगे। बंद करने के लिए टैप करें।", // needs-review
    "header.context-reset":    "↺ संदर्भ रीसेट", // needs-review
    "tooltip.vault-clear":     "संदर्भ से cold storage रिकॉर्ड हटाएँ", // needs-review
    "tooltip.attach-btn":      "फ़ाइल अटैच करें", // needs-review
    "tooltip.conv-btn":        "बातचीत मोड", // needs-review
    "tooltip.conv-reset-ctx":  "बातचीत इतिहास साफ करें — मेमोरी लोड रहती है", // needs-review
    "tooltip.conv-voice":      "आवाज़ें बदलने के लिए टैप करें", // needs-review
    "tooltip.conv-archive":    "chat में आर्काइव फ़ाइलें शामिल करने के लिए टैप करें", // needs-review
    "tooltip.conv-mute":       "माइक्रोफ़ोन म्यूट करें", // needs-review
    "tooltip.conv-discard":    "आखिरी हिस्सा हटाएँ", // needs-review
    "tooltip.conv-finish":     "जर्नलिंग समाप्त करें", // needs-review
    "conv.discard":            "↺ हटाएँ", // needs-review
    "conv.finish":             "✓ समाप्त", // needs-review
    "conv.exit":               "✕ बाहर", // needs-review
    "conv.recording-journal":  "जर्नल रिकॉर्ड हो रहा है", // needs-review
    "conv.keep-going":         "जारी रखें", // needs-review
    "conv.exit-anyway":        "फिर भी बाहर जाएँ", // needs-review
    "conv.label.idle":         "बात के लिए टैप करें · जर्नल के लिए दबाए रखें", // needs-review
    "conv.label.listening":    "सुन रहा हूँ...", // needs-review
    "conv.label.starting":     "शुरू हो रहा है...", // needs-review
    "conv.label.recording":    "रिकॉर्ड हो रहा है...", // needs-review
    "conv.label.thinking":     "सोच रहा हूँ...", // needs-review
    "conv.label.speaking":     "रोकने के लिए ऑर्ब टैप करें", // needs-review
    "conv.label.hold-to-record":  "रिकॉर्ड करने के लिए ऑर्ब दबाए रखें · Finish टैप करें", // needs-review
    "conv.label.chunks-ready":    "और के लिए दबाएँ · हिस्सा चुनने के लिए टैप · संपादन के लिए फिर टैप", // needs-review
    "conv.label.paused":          "बात के लिए ऑर्ब टैप करें  •  जर्नल के लिए दबाए रखें", // needs-review
    "conv.label.muted":           "म्यूट  •  ↺ हटाने के लिए", // needs-review
    "conv.label.captured":        "भेजने के लिए ऑर्ब टैप करें  •  ↺ हटाएँ", // needs-review
    "conv.label.discarded":       "हटाया गया", // needs-review
    "conv.exit-msg-default":      "जर्नल छोड़ें? आपकी डिक्टेशन खो जाएगी।", // needs-review
    "conv.exit-msg-one":          "जर्नल छोड़ें? आपका 1 रिकॉर्ड किया हिस्सा खो जाएगा।", // needs-review
    "conv.exit-msg-many":         "जर्नल छोड़ें? आपके {n} रिकॉर्ड किए हिस्से खो जाएँगे।", // needs-review
    "conv.chunks-resume-one":     "1 हिस्सा · और के लिए दबाएँ", // needs-review
    "conv.chunks-resume-many":    "{n} हिस्से · और के लिए दबाएँ", // needs-review
    "tooltip.modal-close":     "बंद करें", // needs-review
    "tooltip.voice-unsupported":"इस ब्राउज़र में वॉयस समर्थित नहीं है", // needs-review
    "tooltip.sort-name":       "नाम के अनुसार क्रमबद्ध करें", // needs-review
    "tooltip.sort-size":       "आकार के अनुसार क्रमबद्ध करें", // needs-review
    "tooltip.cache-hit":       "Prompt cache हिट — आपकी मेमोरी पहले से cache में थी, इस संदेश ने ~90% कम tokens उपयोग किए", // needs-review
    "tooltip.cache-miss":      "नया सत्र — मेमोरी दोबारा पढ़ी और cache की गई। इस सत्र के भविष्य के संदेशों की लागत बहुत कम होगी", // needs-review
    "tooltip.dismiss":         "खारिज करें", // needs-review
    "install.banner":          "तेज़ पहुंच के लिए WhosWhoZoo को अपनी होम स्क्रीन पर जोड़ें।", // needs-review
    "install.btn":             "इंस्टॉल करें", // needs-review
    "tooltip.audit-ignore":    "भविष्य के ऑडिट में नहीं दिखेगा।", // needs-review
    "tooltip.skip-suggest":    "फिर कभी न सुझाएँ", // needs-review
    "tooltip.delete-chunk":    "यह हिस्सा हटाएँ", // needs-review
    "tooltip.remove":          "हटाएँ", // needs-review
    "tooltip.photo-delete":    "फ़ोटो हटाएँ", // needs-review
    "tooltip.photo-chip":      "{name} की फ़ोटो देखें", // needs-review
    "tooltip.show-passphrase": "फ्रेज़ दिखाएँ", // needs-review
    "tooltip.stop-btn":        "जनरेशन रोकें", // needs-review
    "tooltip.send":            "भेजें", // needs-review
    "tooltip.model-sonnet":    "Sonnet — अधिक स्मार्ट और सूक्ष्म जवाब। प्रति संदेश ~5× अधिक लागत। Haiku पर स्विच करने के लिए टैप करें।", // needs-review
    "tooltip.model-haiku":       "Haiku — तेज़ और किफ़ायती। रोज़मर्रा के सवालों के लिए बेस्ट। जटिल कामों के लिए Sonnet पर स्विच करने के लिए टैप करें।", // needs-review
    "tooltip.badge-memory-only": "~{totalK}K टोकन · {pct} मेमोरी बजट का (अभी तक कोई चैट इतिहास नहीं)", // needs-review
    "tooltip.badge-breakdown":   "~{totalK}K टोकन · {pct} बजट का ({parts})", // needs-review
    "tooltip.badge-part-memory": "{n}K मेमोरी", // needs-review
    "tooltip.badge-part-vault":  "{n}K वॉल्ट", // needs-review
    "tooltip.badge-part-history":"{n}K इतिहास", // needs-review
    "tooltip.conv-ctx-suffix":   " — इतिहास साफ़ करने के लिए ↺ दबाएं अगर जवाब धीमे या अधूरे लगें", // needs-review

    // ---- Daily brief (open loops at session start) ----
    "brief.header":              "📋 खुले काम — {summary}", // needs-review
    "brief.part-overdue":        "{n} देरी से", // needs-review
    "brief.part-due-today":      "{n} आज के लिए", // needs-review
    "brief.part-due-week":       "{n} इस हफ्ते के लिए", // needs-review
    "brief.part-open-tasks":     "{n} खुले कार्यों के साथ", // needs-review
    "brief.part-new":            "{n} खुला", // needs-review
    "brief.badge-overdue":       "⚠ देर हो गई ({date})", // needs-review
    "brief.badge-due-today":     "• आज देय", // needs-review
    "brief.badge-due-date":      "• {date} को देय", // needs-review
    "brief.badge-open-tasks":    "• खुले कार्य", // needs-review
    "brief.badge-new":           "• खुला", // needs-review
    "brief.toast-load-failed":   "काम लोड नहीं हो पाया", // needs-review
    "brief.toast-open-failed":   "काम नहीं खुल पाया", // needs-review
    "brief.hint":                "खोलने के लिए टैप करें · या कहें \"मेरी [नाम] टास्क बंद करो\"", // needs-review

    // ---- Photo UI ----
    "photo.strip.label":         "फ़ोटो ({n})", // needs-review
    "photo.strip.add":           "फ़ोटो जोड़ें", // needs-review

    // ---- Audit actions ----
    "audit.btn-delete-r2":       "R2 से हटाएँ", // needs-review
    "audit.btn-open-record":     "रिकॉर्ड खोलें", // needs-review
  }
};

// Current locale — set before app.js runs
const _savedLang = localStorage.getItem("whoszoo_lang") || "en";
const _locale = LOCALES[_savedLang] || LOCALES.en;

function t(key, vars) {
  let str = _locale[key] ?? LOCALES.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
  }
  return str;
}

function applyLocale() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    // safe — all values are hardcoded strings from LOCALES, never user input
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}
