// Local reader for distill: shows the article issues in a readable page and
// marks them with one click. It reads and writes through the GitHub API with
// the token from `gh auth token`; the token never leaves this process.

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);
const REPO = process.env.DISTILL_REPO || "KenUtsunomiya/distill";
const [OWNER, NAME] = REPO.split("/");

const token = (() => {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    console.error("Could not get a token from `gh auth token`. Run `gh auth login` first.");
    process.exit(1);
  }
})();

// Theme names from config/sources.yaml, so the page can show "AI agent design"
// instead of "agent-design".
const themeNames = (() => {
  const yaml = readFileSync(join(here, "..", "config", "sources.yaml"), "utf8");
  const names = {};
  for (const m of yaml.matchAll(/-\s*slug:\s*(\S+)\s*\n\s*name:\s*(.+)/g)) names[m[1]] = m[2].trim();
  return names;
})();

// ---- GitHub API -----------------------------------------------------------

async function gh(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function graphql(query, variables) {
  const data = await gh("/graphql", { method: "POST", body: { query, variables } });
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function listIssues(params, maxPages = 5) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ ...params, per_page: "100", page: String(page) });
    const batch = await gh(`/repos/${OWNER}/${NAME}/issues?${qs}`);
    out.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return out;
}

// ---- Parsing issue bodies (see routine/prompt.md for the format) ----------

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function parseArticle(body) {
  const field = (name) => body.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1].trim() ?? null;
  const summary = body.split(/^## Summary\s*$/m)[1]?.trim() ?? "";
  return {
    url: safeUrl(body.match(/^URL:\s*(\S+)/m)?.[1] ?? ""),
    source: field("Source"),
    published: field("Published"),
    foundVia: field("Found via"),
    summary,
  };
}

function parseDigest(body) {
  const sections = [];
  let intro = "";
  let current = null;
  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+(.+)$/);
    const item = line.match(/^-\s+\[(.+?)\]\((\S+?)\):\s*(.*)$/);
    if (heading) sections.push((current = { title: heading[1].trim(), items: [] }));
    else if (item && current) current.items.push({ title: item[1], url: safeUrl(item[2]), summary: item[3] });
    else if (!current && line.trim()) intro += (intro ? " " : "") + line.trim();
  }
  return { intro, sections };
}

function toCard(issue) {
  const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name));
  const digest = labels.includes("aws-digest");
  const themes = labels
    .filter((l) => l.startsWith("theme:"))
    .map((l) => l.slice(6))
    .map((slug) => ({ slug, name: themeNames[slug] ?? slug }));
  return {
    number: issue.number,
    title: issue.title,
    issueUrl: issue.html_url,
    createdAt: issue.created_at,
    closedAt: issue.closed_at,
    state: issue.state,
    want: labels.includes("want"),
    themes,
    kind: digest ? "digest" : "article",
    ...(digest ? parseDigest(issue.body ?? "") : parseArticle(issue.body ?? "")),
  };
}

// ---- Views ----------------------------------------------------------------

async function view(name) {
  if (name === "today") {
    const open = await listIssues({ labels: "article", state: "open" });
    return open.filter((i) => !i.labels.some((l) => l.name === "want"));
  }
  if (name === "toread") return listIssues({ labels: "article,want", state: "open" });
  if (name === "done") {
    const closed = await listIssues({ labels: "article,want", state: "closed", sort: "updated" }, 1);
    return closed.filter((i) => i.state_reason === "completed").slice(0, 50);
  }
  throw Object.assign(new Error("unknown view"), { status: 404 });
}

// ---- Actions --------------------------------------------------------------

async function articleIssue(number) {
  const issue = await gh(`/repos/${OWNER}/${NAME}/issues/${number}`);
  if (issue.pull_request || !issue.labels.some((l) => l.name === "article")) {
    throw Object.assign(new Error("not an article issue"), { status: 400 });
  }
  return issue;
}

// Keeps the Project's Status in step when the page closes or reopens an issue.
// The Project's "Item closed" workflow is off, so nothing else does this.
// Best effort: the issue change is what matters.
async function setProjectStatus(number, optionName) {
  try {
    const data = await graphql(
      `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){
        projectItems(first:10){nodes{id project{id field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}}}}`,
      { owner: OWNER, name: NAME, number },
    );
    for (const item of data.repository.issue.projectItems.nodes) {
      const field = item.project.field;
      const option = field?.options.find((o) => o.name === optionName);
      if (!option) continue;
      await graphql(
        `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){clientMutationId}}`,
        { p: item.project.id, i: item.id, f: field.id, o: option.id },
      );
    }
  } catch (e) {
    console.warn(`Could not set Project status for #${number}: ${e.message}`);
  }
}

const actions = {
  async want(n) {
    await gh(`/repos/${OWNER}/${NAME}/issues/${n}/labels`, { method: "POST", body: { labels: ["want"] } });
  },
  async unwant(n) {
    await gh(`/repos/${OWNER}/${NAME}/issues/${n}/labels/want`, { method: "DELETE" });
  },
  async done(n) {
    await gh(`/repos/${OWNER}/${NAME}/issues/${n}`, {
      method: "PATCH",
      body: { state: "closed", state_reason: "completed" },
    });
    await setProjectStatus(n, "Done");
  },
  async reopen(n) {
    await gh(`/repos/${OWNER}/${NAME}/issues/${n}`, { method: "PATCH", body: { state: "open" } });
    await setProjectStatus(n, "New");
  },
};

// ---- HTTP -----------------------------------------------------------------

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

createServer(async (req, res) => {
  try {
    // Refuse requests that did not come to this server by name (DNS rebinding).
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: "bad host" });

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && staticFiles[url.pathname]) {
      const [file, type] = staticFiles[url.pathname];
      return send(res, 200, readFileSync(join(here, "public", file)), type);
    }

    const viewMatch = url.pathname.match(/^\/api\/views\/(\w+)$/);
    if (req.method === "GET" && viewMatch) {
      const issues = await view(viewMatch[1]);
      return send(res, 200, { repo: REPO, cards: issues.map(toCard) });
    }

    const actionMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/(\w+)$/);
    if (req.method === "POST" && actionMatch && Object.hasOwn(actions, actionMatch[2])) {
      // A page on another site cannot set this header without a CORS preflight,
      // which this server never answers.
      if (req.headers["x-distill"] !== "1") return send(res, 403, { error: "missing header" });
      const number = Number(actionMatch[1]);
      await articleIssue(number);
      await actions[actionMatch[2]](number);
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, e.status ?? 500, { error: e.message });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`distill reader: http://localhost:${PORT}  (repo ${REPO})`);
});
