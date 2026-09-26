#!/usr/bin/env node
// Seeds the twelve memory files a fresh WhosWhoZoo install needs.
//
// The Worker refuses to answer if any active memory file is missing from KV, so this has
// to run once before the first deploy is usable. The hosted setup wizard does this for
// you; this script is the manual equivalent.
//
//   node scripts/seed-memory.mjs --namespace-id=<MEMORY namespace id>
//
// Existing keys are left alone unless you pass --force, so re-running is safe.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TIER_NOTE = {
  archive: "Archive tier — entries moved here from working memory.",
  deep: 'Deep archive — permanent long-term storage. Entries marked "– Memory: permanent" are never graduated out.',
};

const FILE_TEMPLATES = {
  "people.md":
    "# people.md\nStructured records about people. Each entry uses ## Full Name with subsections (Summary, Timeline, etc.).\n\n---\n\n",
  "reflections.md":
    "# reflections.md\nDated journal entries and personal reflections. Format: ## YYYY-MM-DD – Title, then prose body.\n\n---\n\n",
  "fragments.md":
    "# fragments.md\nStandalone facts, URLs, reference notes, and how-to procedures. Format: ## YYYY-MM-DD – Title, then – Tags: tag1, tag2.\n\n---\n\n",
  "loops.md":
    "# loops.md\nOpen tasks and follow-ups. Format: ## YYYY-MM-DD – Title, then – Status: Open, – Created: YYYY-MM-DD.\n\n---\n\n",

  "archive_people.md": `# archive_people.md\n${TIER_NOTE.archive}\n\n---\n\n`,
  "archive_reflections.md": `# archive_reflections.md\n${TIER_NOTE.archive}\n\n---\n\n`,
  "archive_fragments.md": `# archive_fragments.md\n${TIER_NOTE.archive}\n\n---\n\n`,
  "archive_loops.md": `# archive_loops.md\nArchive tier — closed loops moved here from working memory.\n\n---\n\n`,

  "deeparchive_people.md": `# deeparchive_people.md\n${TIER_NOTE.deep}\n\n---\n\n`,
  "deeparchive_reflections.md": `# deeparchive_reflections.md\n${TIER_NOTE.deep}\n\n---\n\n`,
  "deeparchive_fragments.md": `# deeparchive_fragments.md\n${TIER_NOTE.deep}\n\n---\n\n`,
  "deeparchive_loops.md": `# deeparchive_loops.md\nDeep archive — permanent long-term storage. Closed loops archived permanently.\n\n---\n\n`,
};

const args = process.argv.slice(2);
const nsArg = args.find((a) => a.startsWith("--namespace-id="));
const force = args.includes("--force");

if (!nsArg) {
  console.error("usage: node scripts/seed-memory.mjs --namespace-id=<id> [--force]");
  console.error("\nFind the id with:  npx wrangler kv namespace list");
  process.exit(1);
}
const namespaceId = nsArg.split("=")[1];

function wrangler(cmdArgs) {
  return execFileSync("npx", ["wrangler", ...cmdArgs], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

function keyExists(key) {
  try {
    wrangler(["kv", "key", "get", key, `--namespace-id=${namespaceId}`, "--remote"]);
    return true;
  } catch {
    return false;
  }
}

// Values are written via a temp file rather than inline: multi-line content passed as a
// shell argument gets mangled on Windows.
const dir = mkdtempSync(join(tmpdir(), "whoszoo-seed-"));
let created = 0;
let skipped = 0;

try {
  for (const [key, value] of Object.entries(FILE_TEMPLATES)) {
    if (!force && keyExists(key)) {
      console.log(`skip    ${key} (already exists)`);
      skipped++;
      continue;
    }
    const tmp = join(dir, key);
    writeFileSync(tmp, value, "utf8");
    wrangler(["kv", "key", "put", key, `--path=${tmp}`, `--namespace-id=${namespaceId}`, "--remote"]);
    console.log(`created ${key}`);
    created++;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\ndone — ${created} created, ${skipped} left alone`);
if (created === 0 && skipped > 0 && !force) {
  console.log("all twelve files were already present; pass --force to overwrite them");
}
