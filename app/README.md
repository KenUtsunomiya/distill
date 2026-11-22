# distill reader

A page for reading the article issues the routine delivers and marking them with one button. It runs on Cloudflare Workers and signs in with a GitHub App, so it works from a phone too. Data stays in this repository's issues. The design is in [docs/reader-design.md](../docs/reader-design.md).

## Files

- `src/worker.js`: the Worker. Sign-in, sessions in KV, and the API the page calls
- `public/`: the page, its styles, the icon and the web app manifest
- `wrangler.jsonc`: Worker settings. The GitHub App's client id and the KV namespace id go here

## One-time setup

1. Create a Cloudflare account, then sign in from this directory:

   ```bash
   npx wrangler login
   ```

2. Create the KV namespace for sessions, and put the printed id in `wrangler.jsonc` (`kv_namespaces[0].id`):

   ```bash
   npx wrangler kv namespace create SESSIONS
   ```

3. Create a GitHub App (Settings → Developer settings → GitHub Apps → New GitHub App):
   - Name: `distill reader`. Homepage URL: the repository
   - Callback URL: `https://distill-reader.<your subdomain>.workers.dev/auth/callback`, and `http://localhost:8787/auth/callback` for local development
   - Expire user authorization tokens: on
   - Webhook: off
   - Repository permissions: Issues, read and write. Nothing else
   - Where can this GitHub App be installed: only on this account

   Then install it on `KenUtsunomiya/distill` only, and generate a client secret. Keep the secret in 1Password.

4. Put the App's client id in `wrangler.jsonc` (`vars.GITHUB_CLIENT_ID`), and the secret in Cloudflare:

   ```bash
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

5. Connect the repository in Cloudflare (Workers & Pages → the Worker → Settings → Builds): branch `main`, root directory `app`, no build command, deploy command `npx wrangler deploy`. Every push to main then deploys. To deploy by hand instead, run `npm run deploy`.

All five steps were done on 2026-11-22. The page runs at https://distill-reader.distill-reader.workers.dev.

## Local development

```bash
npm install
printf 'GITHUB_CLIENT_ID=...\nGITHUB_CLIENT_SECRET=...\n' > .dev.vars
npm run dev
```

Then open http://localhost:8787. `.dev.vars` and the local KV data in `.wrangler/` are ignored by git.

## Tabs

| Tab | Shows | Buttons |
|---|---|---|
| 新着 | Open `article` issues without `want` | Heart: add `want` |
| Heart (読みたい) | Open issues with `want` | Check: close as completed / filled heart: remove `want` |
| Check (読んだ) | Issues with `want` closed as completed, the latest 50 | Filled check: reopen |

Every button can be undone from the message that appears at the bottom.
