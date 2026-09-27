# Security

If you find a vulnerability in this code, please email **hansreno@gmail.com** rather than
opening a public issue. I'll acknowledge within a few days.

This is a one-person project, so I can't promise a fix window — but I'd rather hear about a
problem privately and be slow than read about it publicly and be surprised.

## What's in scope

The Worker and frontend in this repository: authentication, the memory read/write paths, the
handling of API keys, and anything that could expose one user's notes to anyone else.

The hosted setup wizard at whoszoo.app/setup is not in this repository. Reports about it are
equally welcome at the same address.

## Worth knowing before you report

Some things that look like findings are deliberate, and are documented rather than hidden:

- **Your notes are sent to Anthropic to answer a question.** That is how the product works.
  Every outbound path is itemised at [whoszoo.app/privacy](https://whoszoo.app/privacy).
- **The passphrase hash uses PBKDF2 at 100,000 iterations.** That is the ceiling the Workers
  runtime permits, not a chosen value — [the writeup is
  here](https://whoszoo.app/workers-pbkdf2-ceiling). The encrypted export uses 600,000,
  because it runs in the browser where no such cap applies.
- **This is single-user software.** Each install serves one person in their own Cloudflare
  account. There is no multi-tenancy to break out of.
