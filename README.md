# WhosZoo

A personal AI memory assistant that runs entirely inside your own Cloudflare account.
You chat with Claude about the people in your life — family, colleagues, clients — and it
remembers them. Your notes are plain markdown files in your own Cloudflare KV. Nobody
else can read them, including the developer, because there is no server in the middle.

This repository contains the application: the Cloudflare Worker and the frontend it
serves. Both are MIT licensed. You can deploy them yourself with `wrangler`, and the
instructions below are complete — not a teaser.

## The honest bit, up front

This is open core, and it's worth being direct about where the line sits.

**MIT licensed and in this repo:**

- `worker/src/` — the Worker: routing, all Claude API calls, KV reads/writes, auth
- `frontend/` — the app UI (vanilla JS, no framework, no build step)
- `worker/test/` — the test suite
- `scripts/seed-memory.mjs` — creates the twelve KV files a new install needs

**Not in this repo, and not free:**

- The web setup wizard at [whoszoo.app/setup](https://whoszoo.app/setup), which does
  everything in the "Deploy it yourself" section below for you, in a browser, in about
  twenty minutes — including creating the Cloudflare resources and wiring up secrets.
- Update delivery. The wizard also handles upgrading an existing install in place.

A licence for that is $39, one time. If you'd rather do it by hand, everything you need
is here and you don't owe anyone anything. If you'd rather not, that's what the wizard is
for. Both are legitimate; pick whichever your afternoon is worth.

## Deploy it yourself

You'll need a Cloudflare account, an Anthropic API key, and an OpenAI API key (used only
for speech-to-text and text-to-speech — the app works without voice if you skip it).

```bash
git clone https://github.com/hansreno/whoszoo.git
cd whoszoo/worker
npm install

# 1. Create the KV namespace that holds your memory
npx wrangler kv namespace create MEMORY
# note the id it prints

# 2. Configure
cp wrangler.toml.example wrangler.toml
# edit wrangler.toml: set account_id and the MEMORY namespace id.
# Comment out the [[r2_buckets]] block unless you want photo attachments.

# 3. Set secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put WORKER_KEY   # any long random string; this is your recovery key
npx wrangler secret put USER_NAME    # your first name, used in the system prompt
# optional:
npx wrangler secret put ELEVENLABS_API_KEY

# 4. Seed the memory files
node ../scripts/seed-memory.mjs --namespace-id=<your MEMORY namespace id>

# 5. Deploy
npx wrangler deploy
```

Open the `workers.dev` URL it prints. On first load you'll be asked for your `WORKER_KEY`
and a passphrase — that passphrase is what you'll log in with from then on. Keep the
`WORKER_KEY` somewhere safe; it's the only way back in if you forget the passphrase.

### One thing to change

`ALLOWED_ORIGINS` at the top of `worker/src/worker.js` is currently hardcoded to the
maintainer's own domains. If you serve the frontend from somewhere other than the Worker
itself, add your origin there.

## How it works

Memory is twelve plain markdown files in KV, across three tiers — active, archive, deep
archive. Active files are loaded into Claude's context on every turn; archive loads on a
toggle; deep archive only on an explicit recall. There is no vector database and no
retrieval step, which is a deliberate trade: it works because one person's notes are
small, and it would not scale to a multi-user corpus.

Claude never writes to memory directly. It proposes a write, the app shows you the
proposed text, you edit or reject it, and only then is it saved. Every answer can be
traced back to the record it came from.

## Tests

```bash
cd worker && npm test        # deterministic unit tests, no API calls
cd worker && npm run test:ai # evaluates the real system prompt against Haiku (costs ~$0.005)
```

## Support

Issues and pull requests are welcome, but this is a one-person project and the repo is
here for source availability and self-hosters — not as a support desk. If something is
broken, a reproducible issue is far more useful than a question.

## Licence

MIT. See [LICENSE](LICENSE).
