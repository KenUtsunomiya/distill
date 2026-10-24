# Design of the article delivery routine

How to build MVP 1 of the [concept](distill-concept.md) with a Claude Code cloud routine and GitHub Issues / Projects. As of 2026-10-24.

## Overall flow

The routine runs every day at 8:00 JST and does the following, in order.

1. Labels `stale` and closes the earlier new articles that I did not move to "To read"
2. Collects candidates from the themes, RSS feeds and search-only sites in [config/sources.yaml](../config/sources.yaml)
3. Drops candidates that do not match a theme, were delivered before, or whose links do not open
4. Creates one issue per remaining article

The instruction registered in the routine is a single line. The actual steps live in [routine/prompt.md](../routine/prompt.md), so both the steps and the themes can be changed by editing files in this repository.

## Labels

| Label | Meaning | Created |
|---|---|---|
| `article` | An article issue created by the routine. Separates them from other issues | By hand, once |
| `theme:<slug>` | The article's theme. More than one is allowed | By hand, once. Also by hand when adding a theme |
| `source:<host>` | The article's site, as the host name without `www.` (e.g. `source:simonwillison.net`) | By the routine, when missing |
| `via:rss` / `via:search` | How the article was found. Shows whether the search is pulling its weight | By hand, once |
| `stale` | An article I did not move to "To read", closed by the routine | By hand, once |

- Selection trends are counted by filtering on labels. For example, count the articles moved to "To read" per `source:`, or see which `theme:` tends to go `stale`
- `source:` is a host name, so it cannot tell apart writers on a site like medium.com that hosts many of them. Deal with that if it becomes a problem

Labels to create first:

```bash
gh label create article --color 0E8A16 --description "Article delivered by the routine"
gh label create stale --color BFBFBF --description "Closed without being moved to To read"
gh label create via:rss --color C5DEF5
gh label create via:search --color C5DEF5
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

## Projects kanban board

Create one user Project and put the distill repository's issues on it.

- **Status field**: three options, "New", "To read" and "Done"
- **Built-in workflows**
  - Auto-add to project: automatically add `is:issue label:article`
  - Item added to project: set Status to "New"
  - Auto-close issue: close the issue when Status becomes "Done" (closed as completed)
  - Item closed: **turn it off**. If it stays on, articles closed as `stale` also move to "Done"
- **Board filter**: `-label:stale`, so skipped articles are not shown

The routine only creates issues. Adding them to the Project and setting their Status is left to the workflows.

## Deciding what is stale

- Target: open issues with the `article` label that were created before the current run and whose Status is "New"
- Action: add the `stale` label and close the issue as not planned
- Articles in "To read" stay open until I finish reading them, so leave them alone

## Detecting duplicates

- Fetch every issue with the `article` label, open and closed, and compare against the URL on the first line of the body
- Skip a candidate if its URL is already there. This includes issues closed as `stale`, so an article I passed on once never comes back

## Things to check first

It has not been checked yet whether the routine's environment can do the following. Run the routine once by hand to check.

1. Create issues and labels in the distill repository
2. Read the Status of Project items. Needed to decide what is stale
   - If it cannot, use a `want` label instead of the kanban column as the mark, and target "open issues with neither `want` nor `stale`"
3. Fetch RSS feeds and article pages (no network restrictions)
4. Run at 8:00 JST. If the schedule is in UTC, set it to 23:00

## Not decided yet

- How to notice when the routine fails. At first, an empty board is enough of a signal
