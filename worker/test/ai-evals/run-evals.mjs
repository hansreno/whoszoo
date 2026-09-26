#!/usr/bin/env node
// Tier B: AI eval harness for the worker's system prompt.
//
// Costs real money. Run on-demand only (npm run test:ai). Each prompt is
// ~1-3K tokens. Full suite typically costs $0.02–0.15.
//
// What this catches:
//   - System-prompt regressions ("did my last edit break /journal format?")
//   - writeProposal XML schema breakage
//   - Format compliance ("first line must be ## header")
//   - Routing logic (slash-command vs natural-language)
//
// What it does NOT catch:
//   - Subtle quality degradation (would need LLM-as-judge scoring)
//   - Edge-case prompts not in the fixture set
//   - Multi-turn conversation drift
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... node test/ai-evals/run-evals.mjs
//   ANTHROPIC_API_KEY=sk-... node test/ai-evals/run-evals.mjs --dry-run
//
// --dry-run mode skips the real API call and reports estimated cost only.
// Use it to sanity-check the fixture set without spending money.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildStaticPrompt, buildDynamicPrompt } from "../../src/system-prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(__dirname, "fixtures.json");

const DRY_RUN = process.argv.includes("--dry-run");
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!DRY_RUN && !API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY environment variable not set.");
  console.error("Run with --dry-run to skip the live API and validate fixtures only.");
  process.exit(1);
}

// Same model + max_tokens the worker uses for /chat. Eval runs use Haiku to
// keep cost low — most regressions show up identically across model sizes,
// and the format-compliance checks (XML schema, slash routing) don't need
// Sonnet-grade reasoning.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

// Build the eval prompt from the REAL worker system-prompt builder. No more
// drift — the eval and the live worker now share one source of truth at
// worker/src/system-prompt.js. Anything the production prompt asserts about
// response format, this eval will check against.
//
// Context shape we pass to the builders:
//   userName        — "Hans" (eval user; doesn't affect format rules)
//   ambiguousNames  — empty (no duplicate first names in fixture set)
//   memoryContext   — small canned memory blob, enough to make the prompt
//                     well-formed without inflating token usage
//   today/yesterday — fixed dates so the prompt is deterministic across runs
//   brief           — false (chat mode, not conversation mode)
// Dana/Paul/Iris exist to cover ONE specific failure: a fact recorded in two
// records at once. Iris's birth date is deliberately stored in both the
// grandparent's record and the parent's record, mirroring a real case where
// the model cited only the parent (the topically obvious owner) while its own
// answer clearly drew on the grandparent's record too.
const EVAL_MEMORY_CONTEXT = `<memory_file name="people.md">
# people.md

## Maria Lopez
– Tags: work
– Domain: work
– Intent: collaborate
### Summary
PM on the platform team. Took over the migration project in March.

## Dana Reyes
– Tags: family
### Summary
Grandmother to Iris Reyes, born March 2, 2026. Iris is the daughter of Dana's son Paul Reyes and his wife Nichole. Dana is Iris's paternal grandmother.
Her next-door neighbour is Tom Vance, who feeds her cat when she travels.

## Tom Vance
– Tags: neighbour
### Summary
Retired postal worker. Restores vintage radios in his garage.

## Paul Reyes
– Tags: family
### Summary
Dana's son. Lives in Boise with his wife Nichole.
### Timeline
- **2026-03-02**: Daughter: Iris Reyes (b. March 2, 2026)
</memory_file>

<memory_file name="reflections.md">
# reflections.md

## 2026-05-10 14:00 – Migration Project Kickoff Notes
Spent the day with Maria mapping out the migration scope.
</memory_file>

<memory_file name="fragments.md">
# fragments.md
</memory_file>

<memory_file name="loops.md">
# loops.md
</memory_file>`;

const EVAL_SYSTEM_PROMPT_STATIC = buildStaticPrompt({
  userName: "Hans",
  ambiguousNames: [],
  memoryContext: EVAL_MEMORY_CONTEXT,
});
const EVAL_SYSTEM_PROMPT_DYNAMIC = buildDynamicPrompt({
  today: "2026-05-15",
  yesterday: "2026-05-14",
  brief: false,
});

async function callClaude(userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Same shape as the production worker: split system block so the static
      // (cacheable) portion stays consistent across runs. The eval doesn't
      // need cache_control since fixtures are one-shot.
      system: [
        { type: "text", text: EVAL_SYSTEM_PROMPT_STATIC },
        { type: "text", text: EVAL_SYSTEM_PROMPT_DYNAMIC },
      ],
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return {
    text: data.content?.[0]?.text || "",
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

// Each fixture is { id, input, expect: { contains?, matches?, notContains?, hasMemoryWrite?, sourcesInclude?, sourcesExclude? } }
// hasMemoryWrite checks for the production <memory-write>...</memory-write>
// block emitted by the real worker system prompt.
// All assertions on a fixture must pass for the fixture to be marked OK.
function checkFixture(fixture, response) {
  const failures = [];
  const exp = fixture.expect || {};
  if (exp.contains) {
    for (const s of exp.contains) {
      if (!response.text.includes(s)) failures.push(`missing required text: "${s}"`);
    }
  }
  if (exp.notContains) {
    for (const s of exp.notContains) {
      if (response.text.includes(s)) failures.push(`forbidden text present: "${s}"`);
    }
  }
  if (exp.matches) {
    for (const pattern of exp.matches) {
      const re = new RegExp(pattern, "i");
      if (!re.test(response.text)) failures.push(`pattern did not match: /${pattern}/i`);
    }
  }
  if (typeof exp.hasMemoryWrite === "boolean") {
    const has = /<memory-write>[\s\S]+<\/memory-write>/.test(response.text);
    if (has !== exp.hasMemoryWrite) {
      failures.push(`expected hasMemoryWrite=${exp.hasMemoryWrite}, got ${has}`);
    }
  }
  // sourcesInclude: assert against the parsed <sources> JSON, not raw response
  // text. A plain `contains` check would pass on a name that merely appears in
  // the prose ("daughter of Paul Reyes") while the citation itself omitted that
  // record — which is exactly the under-citation bug this guards against. Also
  // validates the block is well-formed JSON of the documented shape, which
  // nothing else in the suite checked.
  if (exp.sourcesInclude) {
    const m = response.text.match(/<sources>([\s\S]*?)<\/sources>/);
    if (!m) {
      failures.push(`expected a <sources> block, none present`);
    } else {
      let parsed = null;
      try { parsed = JSON.parse(m[1].trim()); } catch { /* reported below */ }
      if (!Array.isArray(parsed)) {
        failures.push(`<sources> was not a JSON array: ${m[1].trim().slice(0, 120)}`);
      } else {
        const sections = parsed.map(s => (s && s.section) || "");
        for (const want of exp.sourcesInclude) {
          if (!sections.includes(want)) {
            failures.push(`<sources> missing "${want}" (cited: ${sections.join(", ") || "nothing"})`);
          }
        }
      }
    }
  }
  // The other half of the rule: a record merely NAMED in the answer, which
  // contributed no fact, must not be cited. Guards the citation rule from
  // over-correcting into "cite everything mentioned".
  if (exp.sourcesExclude) {
    const m = response.text.match(/<sources>([\s\S]*?)<\/sources>/);
    if (m) {
      let parsed = null;
      try { parsed = JSON.parse(m[1].trim()); } catch { /* shape already reported above if asserted */ }
      if (Array.isArray(parsed)) {
        const sections = parsed.map(s => (s && s.section) || "");
        for (const unwanted of exp.sourcesExclude) {
          if (sections.includes(unwanted)) {
            failures.push(`<sources> wrongly cited "${unwanted}" — it was only named, not drawn from`);
          }
        }
      }
    }
  }
  return failures;
}

// Haiku pricing (per million tokens): $1 input, $5 output as of mid-2026.
// Used only for the cost-estimate display.
const HAIKU_INPUT_PER_MTOK = 1.0;
const HAIKU_OUTPUT_PER_MTOK = 5.0;

async function main() {
  const fixtures = JSON.parse(await readFile(FIXTURES_PATH, "utf-8"));
  console.log(`Loaded ${fixtures.length} fixture(s) from ${FIXTURES_PATH}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no API calls)" : "LIVE (will spend tokens)"}`);
  console.log("");

  let passed = 0;
  let failed = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const failureDetails = [];

  for (const fixture of fixtures) {
    if (DRY_RUN) {
      console.log(`  [SKIP] ${fixture.id} — input: "${fixture.input.slice(0, 60)}${fixture.input.length > 60 ? "…" : ""}"`);
      continue;
    }
    try {
      const response = await callClaude(fixture.input);
      totalInput += response.inputTokens;
      totalOutput += response.outputTokens;
      const failures = checkFixture(fixture, response);
      if (failures.length === 0) {
        console.log(`  PASS  ${fixture.id}`);
        passed++;
      } else {
        console.log(`  FAIL  ${fixture.id}`);
        for (const f of failures) console.log(`        - ${f}`);
        failureDetails.push({ id: fixture.id, failures, response: response.text });
        failed++;
      }
    } catch (err) {
      console.log(`  ERROR ${fixture.id} — ${err.message}`);
      failed++;
    }
  }

  console.log("");
  if (DRY_RUN) {
    console.log(`Dry run: ${fixtures.length} fixtures would have been sent to ${MODEL}.`);
    // Real system prompt is ~10K tokens (production prompt from system-prompt.js
    // + small canned memory context). Output averages ~300 tokens per fixture.
    console.log(`Estimated cost at ~10K input + ~300 output tokens per call:`);
    const estIn = fixtures.length * 10000;
    const estOut = fixtures.length * 300;
    const estCost = (estIn * HAIKU_INPUT_PER_MTOK + estOut * HAIKU_OUTPUT_PER_MTOK) / 1_000_000;
    console.log(`  ~$${estCost.toFixed(4)}`);
    return;
  }

  const cost = (totalInput * HAIKU_INPUT_PER_MTOK + totalOutput * HAIKU_OUTPUT_PER_MTOK) / 1_000_000;
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Tokens:  ${totalInput} input, ${totalOutput} output`);
  console.log(`Cost:    $${cost.toFixed(4)}`);

  if (failed > 0) {
    console.log("");
    console.log("--- FAILURE DETAILS ---");
    for (const fd of failureDetails) {
      console.log(`\n${fd.id}:`);
      for (const f of fd.failures) console.log(`  - ${f}`);
      console.log(`  Response (first 400 chars):`);
      console.log(`    ${fd.response.slice(0, 400).replace(/\n/g, "\n    ")}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
