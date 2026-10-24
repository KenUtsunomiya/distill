# distill: a system for learning from articles

The concept as of 2026-10-24. Detailed requirements are not settled yet.

## Name

The service and the repository are named **distill**. The name describes the act of distilling the key points of an article and keeping them. Since the key points come out of my own conversations with AI, I chose the verb distill over distiller, which names a tool.

## Goal

Deepen my knowledge of topics related to my work, starting with AI agent development.

It started as "a system that delivers relevant articles every day". While working out the MVP, it gained a feature for talking with AI about an article and keeping notes, and became "a system for learning from articles".

## MVP

In order of importance. Build 1 first.

1. **Fetching and listing articles**: once a day, fetch articles worth reading and list them
2. **Notes**: talk with AI about an article to understand it better, then save the key points as a note
3. **Selection and tuning**: select articles, and use the results to change the themes of the articles that get fetched

3 can be done by hand at first, by editing the list of themes myself.

1 alone is already useful as a daily reading list. 2 and 3 will be built on what I learn from using 1.

## Collecting articles

- A Claude Code cloud routine collects the articles. It runs in the cloud, so my PC does not need to be on
- Candidates come from a web search per theme and from the RSS feeds of registered blogs and newsletters. The routine keeps the ones that match the themes
- The routine checks that each link actually exists, and never delivers an article it has delivered before
- Data sources: company engineering blogs, newsletters, Twitter. Personal blogs are not used
- Twitter is not in the MVP. Posts that turn up in web searches are enough for now
  - The official X API can fetch posts, but as of 2026 it is pay-per-use with no free tier. Reading a post costs $0.005
  - If I find that I need it after using the MVP, add it through the official API's search. Searching by theme needs only an app-only Bearer token, not OAuth user authentication
  - Rough cost: 5 themes × 20 posts × 30 days comes to about $15 a month. Keep it down by capping the number of results per search
  - Do not use unofficial services that scrape X data. They are a gray area under X's terms of service
- Collect broadly by theme, then pick the ones that interest me or that I think matter most

### Candidate themes

- AI agent design
- Tool design
- MCP
- Evals
- Context engineering
- Large-scale systems
- Data storage
- Observability
- Kubernetes

Themes are not limited to AI.

## Recording selections

- Only mark the articles I want to read. Moving an article to the "To read" column on the kanban board is the mark
- At first, do not record why I picked or skipped an article. Keeping the daily effort low, so that I keep doing it, comes first
- As selections accumulate, trends such as the blogs I often pick or the themes I always skip will show, and I can adjust the themes I fetch
- If the adjustments are not precise enough, start recording reasons at that point

## Where it lives

- Keep it separate from the repository for my daily records
  - That repository covers a wide range of my life and has a different purpose
  - Keeping them apart makes it easier to move this somewhere else later
- I read articles on my PC. They do not need to be delivered to Slack
- Store each article as one issue in this repository's GitHub Issues, and manage them on a GitHub Projects kanban board
  - The routine already works against GitHub, so no other service needs to be connected
  - Marking an article is just moving it between columns
  - With sources and themes as labels, tallying selections is just filtering by label
  - Notes for an article can be written in Markdown in the issue body or comments
  - Notion was also a candidate, but connecting it takes more work. Move to it if I want richer notes or tallies

### Article states

| State | Kanban column | Issue |
|---|---|---|
| New | New | open |
| To read | To read | open |
| Read | Done | closed (completed) |
| Skipped | none | closed (not planned), `stale` label |

- New articles from the previous day that I did not move to "To read" are labeled `stale` and closed by the next morning's routine
- To tell skipped articles apart from read ones, they differ in both the close reason and the `stale` label
- Articles moved to "To read" stay open until I finish reading them

## Operation

- Runs every day at 8:00, including weekends and holidays
- No fixed number of articles per day
- For the AI conversations in 2, I copy the article link myself and talk in Claude Desktop or similar, at first
