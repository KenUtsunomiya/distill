# Design of the reader page

A page for reading the article issues the routine delivers and marking them with one button, hosted on GitHub Pages so it works from a phone too. As of 2026-11-22.

## Why

- Issues and the Projects board are hard to read: the summaries are only visible after opening each issue
- The first version ([PR #26](https://github.com/KenUtsunomiya/distill/pull/26)) was a local server that used the `gh` login. It only works while it runs on my PC, so it moves to a static page that needs no server

## What stays the same

- Issues are the only data. The page reads and changes them through the GitHub API, so the routine, the issue format and the label-based tallies do not change
- The mark is still the `want` label, and an article I read is still closed as completed ([concept](distill-concept.md#article-states))

## Hosting

- GitHub Pages, deployed by a GitHub Actions workflow from `app/` on main. The page lives at https://kenutsunomiya.github.io/distill/
- The repository's Pages source is set to "GitHub Actions"
- Plain HTML, CSS and JavaScript with no build step and no packages, as in the first version
- The local server (`app/server.mjs`) is removed. To work on the page locally, serve `app/` with any static server, such as `python3 -m http.server`

## Authentication

The page calls `api.github.com` straight from the browser, which GitHub allows (CORS).

- **Reading** needs no token, since the repository is public. Without a token the page is read-only, and GitHub allows 60 requests an hour per IP address, enough for opening the page a few times
- **Marking** needs a fine-grained personal access token, pasted into the page's settings once per device
  - Repository access: only `KenUtsunomiya/distill`
  - Permissions: Issues, read and write (Metadata, read-only, is added automatically). Nothing else
  - Expiry: one year. When it expires, the page says so and goes back to read-only
  - Kept in 1Password, so it can be filled in on each device
- The token is kept in that browser's `localStorage` and sent only to `api.github.com`. It is never put in the repository, a URL or the cloud
- The settings let me remove the token from the device

### Protecting the token

A token in `localStorage` can be read by any script that runs on the page, so the page only runs its own code.

- A Content Security Policy in a `<meta>` tag: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https://api.github.com; manifest-src 'self'; base-uri 'none'; form-action 'none'`
- No third-party scripts, styles or fonts
- Issue text comes from third-party articles, so it is only ever inserted as text, never as HTML. Links are kept only when they are `http` or `https`
- Changes are refused for issues without the `article` label

GitHub Pages cannot set response headers, so `frame-ancestors` (which only works as a header) is not available. The page has no action that a click inside a frame could trigger without me seeing the button, so this is accepted.

## Screens

The same as the first version.

| Tab | Shows | Buttons |
|---|---|---|
| 今日 | Open `article` issues without `want` | 読みたい: add `want` |
| 読みたい | Open issues with `want` | 読んだ: close as completed / 外す: remove `want` |
| 読んだ | Issues with `want` closed as completed, the latest 50 | 読みたいに戻す: reopen |

- Each article is a card with its source, date, title (linked to the article), themes and summary. The AWS digest shows its announcements as links grouped by theme
- Every button can be undone from the message that appears afterwards
- Theme names come from `config/sources.yaml`, read through the GitHub API
- A settings screen to paste, check and remove the token. It shows the token's expiry date when GitHub returns it
- It can be added to a phone's home screen (a web app manifest and an icon)

## Projects board

Fine-grained tokens are not expected to be able to change a Project owned by a user account (to be checked when building it). If they cannot, the page no longer sets the Project's Status when it closes an issue. Closed issues stay "New" on the board, but both views only show open issues, so the board still looks right. The Status field may be removed later if the board goes unused.

## Not decided yet

- Whether to keep the Projects board at all, now that the page covers both of its views
