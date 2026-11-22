# Design of the article delivery routine

How to build MVP 1 of the [concept](distill-concept.md) with a Claude Code cloud routine and GitHub Issues / Projects. As of 2026-10-24.

## Overall flow

The routine runs every day at 8:00 JST and does the following, in order.

1. Labels `stale` and closes the earlier new articles that I did not mark `want`
2. Collects candidates from the RSS feeds and the sites without feeds in [config/sources.yaml](../config/sources.yaml)
3. Drops candidates that do not match a theme, were delivered before, or whose links do not open
4. Creates one issue per remaining article
5. Creates one digest issue of the on-theme AWS What's New announcements

The instruction registered in the routine is a single line. The actual steps live in [routine/prompt.md](../routine/prompt.md), so both the steps and the themes can be changed by editing files in this repository.

## Labels

| Label | Meaning | Created |
|---|---|---|
| `article` | An article issue created by the routine. Separates them from other issues | By hand, once |
| `theme:<slug>` | The article's theme. More than one is allowed | By hand, once. Also by hand when adding a theme |
| `source:<host>` | The article's site, as the host name without `www.` (e.g. `source:simonwillison.net`) | By the routine, when missing |
| `want` | An article I want to read. This is the mark the routine looks at | By hand, once |
| `stale` | An article I did not mark `want`, closed by the routine | By hand, once |
| `aws-digest` | The daily digest of AWS What's New announcements. Also has `article`, so `want` and `stale` work the same way | By hand, once |

- Selection trends are counted by filtering on labels. For example, count the articles marked `want` per `source:`, or see which `theme:` tends to go `stale`
- `source:` is a host name, so it cannot tell apart writers on a site like medium.com that hosts many of them. Deal with that if it becomes a problem

Labels to create first:

```bash
gh label create article --color 0E8A16 --description "Article delivered by the routine"
gh label create want --color 1D76DB --description "Marked to read; kept open by the routine"
gh label create stale --color BFBFBF --description "Closed without being marked want"
gh label create aws-digest --color FF9900 --description "Daily digest of AWS What's New announcements"
gh label create theme:agent-design --color FBCA04 --description "AI agent design"
gh label create theme:tool-design --color FBCA04 --description "Tool design"
gh label create theme:mcp --color FBCA04 --description "MCP"
gh label create theme:evals --color FBCA04 --description "Evals"
gh label create theme:context-engineering --color FBCA04 --description "Context engineering"
gh label create theme:large-scale-systems --color FBCA04 --description "Large-scale systems"
gh label create theme:data-storage --color FBCA04 --description "Data storage"
gh label create theme:observability --color FBCA04 --description "Observability"
gh label create theme:kubernetes --color FBCA04 --description "Kubernetes"
```

## Issue format

The title is the article's original title. The body takes the following form. The URL on the first line is used to detect duplicates, so it must always be in this form.

```markdown
URL: https://example.com/posts/agent-tools

- Source: Example Blog
- Published: 2026-10-23
- Found via: RSS

## Summary

(2–3 sentences: what the article covers and which themes it relates to)
```

URLs are normalized by removing tracking parameters such as `utm_` and any trailing `#...`.

## AWS digest

AWS What's New publishes dozens of announcements a day (about 100 from 2026-11-19 to 11-21). One issue each would bury the articles, and each announcement is only a few lines, so the on-theme ones go into one issue per day.

- Title: `AWS What's New <YYYY-MM-DD>` (JST)
- Body: announcements grouped by theme, one line each with a link and a one-sentence summary
- Kept: announcements that change how systems are designed, built or operated, on a theme
- Dropped: region expansions, Partner Central, Marketplace, billing and pricing, minor version support
- Duplicates: compared against the links in earlier `aws-digest` issues. Digests are left out of the article duplicate check, since they have no `URL:` line
- AWS blog posts are still delivered one by one as articles. For posts from aws.amazon.com, product and feature posts on a theme are kept, unlike other sources

## Projects kanban board

The routine's GitHub tools cannot read Project Status, so the mark is the `want` label, not a kanban column. The board is only a view, and the routine never looks at it.

Create one user Project named `distill` and put the distill repository's issues on it.

- **Status field**: two options, "New" and "Done"
- **Built-in workflows**
  - Auto-add to project: automatically add `is:issue label:article`
  - Item added to project: set Status to "New"
  - Auto-close issue: close the issue when Status becomes "Done" (closed as completed)
  - Item closed: **turn it off**. If it stays on, articles closed as `stale` also move to "Done"
- **Views**
  - Today: filter `is:open -label:want`, the new articles to pick from
  - To read: filter `is:open label:want`

The routine only creates issues. Adding them to the Project and setting their Status is left to the workflows.

## Reader page

Issues and the board were hard to read, so [app/](../app/README.md) has a page that lists the articles with their summaries and adds `want` or closes an issue with one button. It is hosted on Cloudflare Workers with GitHub sign-in so it works from a phone too; the design is in [reader-design.md](reader-design.md). It changes only labels and issue state, so the routine and the label-based tallies are unaffected.

## Deciding what is stale

- Target: open issues with the `article` label that were created before the current run and have neither `want` nor `stale`
- Action: add the `stale` label and close the issue as not planned
- Articles marked `want` stay open until I finish reading them, so leave them alone
- Reading Project Status with a separate token was considered and dropped: the token would have to be stored in the cloud environment as a plain value, and I keep my secrets in 1Password

## Detecting duplicates

- Fetch every issue with the `article` label, open and closed, and compare against the URL on the first line of the body
- Skip a candidate if its URL is already there. This includes issues closed as `stale`, so an article I passed on once never comes back

## Things to check first

Checks for whether the routine's environment can do the following. The first manual run was on 2026-11-21.

1. Create issues and labels in the distill repository
   - Works: the routine uses the GitHub MCP tools (`mcp__github__*`), not `gh`. The second run on 2026-11-21 created #2 with all its labels, including a new `source:datadoghq.com` label
2. Read the Status of Project items. Needed to decide what is stale
   - Cannot: a one-off check on 2026-11-21 found no Projects tools among the routine's GitHub tools. Switched to the `want` label
3. Fetch RSS feeds and article pages (no network restrictions)
   - Works after switching the Default environment to full network access. Before that, most feed hosts failed DNS. Search results point to arbitrary hosts, so an allowlist is not enough
   - aws.amazon.com article pages come back as navigation only through WebFetch, so their bodies cannot be checked
   - Web search returned only old, evergreen pages, even after running every query and checking dates on the pages. Dropped on 2026-11-22 in favor of more RSS feeds, along with the `via:` labels
4. Run at 8:00 JST. If the schedule is in UTC, set it to 23:00
   - Done: the routine's schedule is `0 23 * * *` (UTC)

## Not decided yet

- How to notice when the routine fails. At first, an empty board is enough of a signal
