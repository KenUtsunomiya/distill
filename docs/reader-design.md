# Design of the reader page

A page for reading the article issues the routine delivers and marking them with one button, hosted on Cloudflare Workers so it works from a phone too. As of 2026-11-22.

## Why

- Issues and the Projects board were hard to read: the summaries are only visible after opening each issue
- The first version ([PR #26](https://github.com/KenUtsunomiya/distill/pull/26)) was a local server that used the `gh` login. It only works while it runs on my PC, so it moves to a hosted page
- A static page on GitHub Pages with a token pasted into the browser was considered and dropped: I do not want a long-lived token kept in the browser

## What stays the same

- Issues are the only data. The page reads and changes them through the GitHub API, so the routine, the issue format and the label-based tallies do not change
- The mark is still the `want` label, and an article I read is still closed as completed ([concept](distill-concept.md#article-states))

## Overview

```
Browser ──(session cookie)──▶ Cloudflare Worker ──(user token)──▶ GitHub API
                                   │
                                   └─ KV: session id → GitHub tokens
```

- One Worker serves both the page (static assets from `app/public/`) and the API under `/api/`, on one origin
- I sign in with GitHub through a GitHub App. The GitHub tokens stay in the Worker's KV storage, and the browser only gets a random session id in an `HttpOnly` cookie, which scripts cannot read
- The Worker allows only my GitHub account, and only the operations the page needs

## GitHub App

A GitHub App, not an OAuth App, because its token can be limited to one repository and one permission.

- Name: `distill reader`. Owned by my account, installable only on my account
- Installed on `KenUtsunomiya/distill` only
- Repository permissions: Issues, read and write (Metadata, read-only, is added automatically). Nothing else
- "Expire user authorization tokens" on: the user token lasts 8 hours and comes with a refresh token that lasts 6 months
- Callback URLs: `https://<worker host>/auth/callback`, and `http://localhost:8787/auth/callback` for local development
- No webhook
- The user token can only do what both the App and I may do, on the repositories the App is installed on, so even a leaked token reaches only this repository's issues

## Signing in

1. The page has no session, so it shows a "GitHub でログイン" button
2. `/auth/login` creates a random `state` and a PKCE verifier, keeps them in a short-lived `HttpOnly` cookie, and redirects to GitHub's authorize page
3. GitHub sends me back to `/auth/callback`. The Worker checks `state`, exchanges the code for a user token with the App's client secret and the PKCE verifier, and reads `/user`
4. If the login is not `ALLOWED_LOGIN` (`KenUtsunomiya`), the Worker throws the token away and refuses
5. Otherwise it stores the tokens in KV under a random session id and sets the session cookie

- When the user token has expired, the Worker uses the refresh token and stores the new pair. I sign in again only after the refresh token expires (6 months) or when I sign out
- KV entries expire with the refresh token
- "ログアウト" deletes the KV entry and the cookie
- To cut off every device at once, revoke the App's authorization in GitHub's settings, or delete the KV entries

## Secrets

| Name | What | Where |
|---|---|---|
| `GITHUB_CLIENT_SECRET` | The App's client secret | Cloudflare Worker secret, set with `wrangler secret put`. The original is kept in 1Password |
| GitHub user tokens | Issued at sign-in | KV only. Never sent to the browser or written to logs |

The client secret alone cannot act on GitHub: it only works together with a code that GitHub issues after I sign in and approve. Nothing secret is committed to the repository. `GITHUB_CLIENT_ID`, `ALLOWED_LOGIN` and `REPO` are plain settings in `wrangler.jsonc`.

## API

All routes need a valid session, except the sign-in routes and the static files.

| Route | Does |
|---|---|
| `GET /api/me` | The signed-in login, so the page can show it |
| `GET /api/views/today` | Open `article` issues without `want` |
| `GET /api/views/toread` | Open issues with `article` and `want` |
| `GET /api/views/done` | Issues with `article` and `want` closed as completed, the latest 50 |
| `POST /api/issues/:n/want` | Add `want` |
| `POST /api/issues/:n/unwant` | Remove `want` |
| `POST /api/issues/:n/done` | Close as completed |
| `POST /api/issues/:n/reopen` | Reopen |

The Worker parses the issue bodies into cards, as the local server did, and reads theme names from `config/sources.yaml` through the GitHub API.

## Security

- **Allowed account**: the Worker checks the login at sign-in and keeps it in the session
- **Allowed operations**: the API only changes issues in `REPO` that have the `article` label, and only the four actions above. There is no generic proxy to the GitHub API
- **Cross-site requests**: the session cookie is `Secure`, `HttpOnly` and `SameSite=Lax`. Changes are `POST` only and also need an `Origin` header equal to the Worker's own origin
- **Untrusted text**: issue text comes from third-party articles, so the page only ever inserts it as text, never as HTML. Links are kept only when they are `http` or `https`
- **Headers** on every response:
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
- No third-party scripts, styles or fonts

## Screens

The same as the first version, plus sign-in.

| Tab | Shows | Buttons |
|---|---|---|
| 新着 | Open `article` issues without `want` | Heart: add `want` |
| Heart (読みたい) | Open issues with `want` | Check: close as completed / filled heart: remove `want` |
| Check (読んだ) | Issues with `want` closed as completed, the latest 50 | Filled check: reopen |

- Each article is a card with its source, date, title (linked to the article), themes and summary. The AWS digest shows its announcements as links grouped by theme
- Every button can be undone from the message that appears afterwards
- Without a session, the page shows only the sign-in button. The header shows the signed-in login and a sign-out button
- It can be added to a phone's home screen (a web app manifest and an icon)

## Code and deployment

- `app/`: `wrangler.jsonc`, `src/worker.js` (the Worker) and `public/` (the page). Plain JavaScript, no framework. The only package is `wrangler`, as a development dependency
- The local server (`app/server.mjs`) is removed
- Local development: `npx wrangler dev` with a `.dev.vars` file for the client secret. `.dev.vars` is ignored by git
- Deployment: Cloudflare Workers Builds, connected to this repository, deploys `app/` on every push to main. Cloudflare reads the repository through its own GitHub integration, so no Cloudflare token is stored on GitHub
- Free plans of Workers and KV are enough

## Setup, done by hand once

1. Create a Cloudflare account, and run `npx wrangler login`
2. Create the KV namespace (`npx wrangler kv namespace create SESSIONS`) and put its id in `wrangler.jsonc`
3. Create the GitHub App with the settings above, install it on `distill`, and generate a client secret. Keep the secret in 1Password
4. Put the client id in `wrangler.jsonc`, and the secret in Cloudflare with `npx wrangler secret put GITHUB_CLIENT_SECRET`
5. Connect the repository in Workers Builds, with `app/` as the root directory
6. Add the Worker's URL to the App's callback URLs

## Projects board

The page replaces the Projects board, which is no longer part of the design (2026-11-22). The App has no permission for Projects, and the page does not touch the board.

## Not decided yet

- Whether to use a custom domain instead of https://distill-reader.distill-reader.workers.dev, where it runs since 2026-11-22
