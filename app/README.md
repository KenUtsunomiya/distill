# distill reader

A local page for reading the article issues the routine delivers, and marking them with one click. Data stays in this repository's issues; the page is only a nicer view of them.

## Run

Requires Node.js 20 or later and a `gh` login with access to the repository. No packages to install.

```bash
cd app
npm start
```

Then open http://localhost:4321. Set `PORT` to use another port, and `DISTILL_REPO` (`owner/name`) to point at another repository.

## What it does

| Tab | Shows | Buttons |
|---|---|---|
| 今日 | Open `article` issues without `want` | 読みたい: add `want` |
| 読みたい | Open issues with `want` | 読んだ: close as completed / 外す: remove `want` |
| 読んだ | Issues with `want` closed as completed, the latest 50 | 読みたいに戻す: reopen |

Every button can be undone from the message that appears at the bottom. When the page closes or reopens an issue, it also sets the Project's Status to Done or New, since the Project's "Item closed" workflow is off.

## Security

- The server gets its token from `gh auth token` and calls the GitHub API itself. The token is never sent to the browser
- It listens on 127.0.0.1 only and refuses requests whose `Host` is not `localhost` or `127.0.0.1` on its port
- Changes need an `X-Distill: 1` header, which a page on another site cannot send without a CORS preflight that this server never answers
- It only changes issues with the `article` label
- Issue text comes from third-party articles, so the page only ever inserts it as text, never as HTML
