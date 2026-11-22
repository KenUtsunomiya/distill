// distill reader on Cloudflare Workers. Serves the page and a small API that
// reads and marks the article issues with the signed-in user's GitHub token.
// The design, including the security rules, is in docs/reader-design.md.
//
// GitHub tokens live only in KV. The browser holds a random session id in an
// HttpOnly cookie. Never log or return a token.

const SESSION_COOKIE = "__Host-distill_session";
const OAUTH_COOKIE = "__Host-distill_oauth";
const UA = "distill-reader";

// ---- Small helpers ---------------------------------------------------------

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomId(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function withSecurityHeaders(response) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

// ---- GitHub OAuth (GitHub App user tokens) ---------------------------------

async function tokenRequest(env, params) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new HttpError(401, `token request failed: ${data.error || res.status}`);
  return data;
}

// Turns a token response into what the session keeps. Apps without expiring
// tokens return no expires_in; their sessions then last 30 days.
function tokensFrom(data) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return {
    access: data.access_token,
    accessExp: data.expires_in ? now + data.expires_in * 1000 : now + 30 * day,
    refresh: data.refresh_token || null,
    refreshExp: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : now + 30 * day,
  };
}

async function saveSession(env, id, session) {
  const ttl = Math.max(60, Math.floor((session.refreshExp - Date.now()) / 1000));
  await env.SESSIONS.put(`s:${id}`, JSON.stringify(session), { expirationTtl: ttl });
}

async function loadSession(env, id) {
  const raw = await env.SESSIONS.get(`s:${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function login(request, env) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new HttpError(500, "GitHub App is not configured");
  const origin = new URL(request.url).origin;
  const state = randomId();
  const verifier = randomId(48);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${origin}/auth/callback`,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return new Response(null, {
    status: 302,
    headers: { Location: url.href, "Set-Cookie": cookie(OAUTH_COOKIE, `${state}.${verifier}`, 600), "Cache-Control": "no-store" },
  });
}

async function callback(request, env) {
  const url = new URL(request.url);
  const [state, verifier] = (getCookie(request, OAUTH_COOKIE) || "").split(".");
  const clearOauth = cookie(OAUTH_COOKIE, "", 0);
  if (!state || url.searchParams.get("state") !== state || !url.searchParams.get("code")) {
    return signInError("ログインの確認に失敗しました。もう一度試してください。", clearOauth);
  }

  const tokens = tokensFrom(
    await tokenRequest(env, {
      code: url.searchParams.get("code"),
      redirect_uri: `${url.origin}/auth/callback`,
      code_verifier: verifier,
    }),
  );
  const user = await github(tokens.access, "/user");
  if (user.login.toLowerCase() !== env.ALLOWED_LOGIN.toLowerCase()) {
    return signInError("このアカウントは使えません。", clearOauth);
  }

  const id = randomId();
  await saveSession(env, id, { login: user.login, ...tokens });
  const maxAge = Math.floor((tokens.refreshExp - Date.now()) / 1000);
  const headers = new Headers({ Location: "/", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearOauth);
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, id, maxAge));
  return new Response(null, { status: 302, headers });
}

function signInError(message, setCookie) {
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>distill</title><link rel="stylesheet" href="/style.css"><main class="page"><p class="error">${message}</p><p class="empty"><a href="/">戻る</a></p></main>`;
  return new Response(page, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": setCookie, "Cache-Control": "no-store" },
  });
}

async function logout(request, env) {
  const id = getCookie(request, SESSION_COOKIE);
  if (id) await env.SESSIONS.delete(`s:${id}`);
  return json({ ok: true }, 200, { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) });
}

// Returns the session's GitHub token, refreshing it when it has expired.
async function sessionToken(request, env) {
  const id = getCookie(request, SESSION_COOKIE);
  if (!id) throw new HttpError(401, "signin");
  let session = await loadSession(env, id);
  if (!session) throw new HttpError(401, "signin");
  if (session.accessExp - 60_000 > Date.now()) return session;
  if (!session.refresh || session.refreshExp < Date.now()) throw new HttpError(401, "signin");

  try {
    session = { ...session, ...tokensFrom(await tokenRequest(env, { grant_type: "refresh_token", refresh_token: session.refresh })) };
    await saveSession(env, id, session);
    return session;
  } catch (e) {
    // Another request may have used the refresh token first. Take its result.
    const latest = await loadSession(env, id);
    if (latest && latest.accessExp - 60_000 > Date.now()) return latest;
    throw new HttpError(401, "signin");
  }
}

// ---- GitHub API -------------------------------------------------------------

async function github(token, path, { method = "GET", body, accept = "application/vnd.github+json" } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new HttpError(401, "signin");
  if (!res.ok) throw new HttpError(502, `GitHub ${method} ${path.split("?")[0]}: ${res.status}`);
  if (res.status === 204) return null;
  return accept.endsWith("raw") ? res.text() : res.json();
}

async function listIssues(token, repo, params, maxPages = 5) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ ...params, per_page: "100", page: String(page) });
    const batch = await github(token, `/repos/${repo}/issues?${qs}`);
    out.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return out;
}

// Theme names from config/sources.yaml, cached for a while per isolate.
let themeCache = { at: 0, names: {} };
async function themeNames(token, repo) {
  if (Date.now() - themeCache.at < 10 * 60_000) return themeCache.names;
  const names = {};
  try {
    const yaml = await github(token, `/repos/${repo}/contents/config/sources.yaml`, { accept: "application/vnd.github.raw" });
    for (const m of yaml.matchAll(/-\s*slug:\s*(\S+)\s*\n\s*name:\s*(.+)/g)) names[m[1]] = m[2].trim();
  } catch {
    // Fall back to slugs.
  }
  themeCache = { at: Date.now(), names };
  return names;
}

// ---- Parsing issue bodies (format in routine/prompt.md) ---------------------

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
  return {
    url: safeUrl(body.match(/^URL:\s*(\S+)/m)?.[1] ?? ""),
    source: field("Source"),
    published: field("Published"),
    summary: body.split(/^## Summary\s*$/m)[1]?.trim() ?? "",
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

function toCard(issue, names) {
  const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name));
  const digest = labels.includes("aws-digest");
  return {
    number: issue.number,
    title: issue.title,
    issueUrl: issue.html_url,
    createdAt: issue.created_at,
    state: issue.state,
    want: labels.includes("want"),
    themes: labels
      .filter((l) => l.startsWith("theme:"))
      .map((l) => l.slice(6))
      .map((slug) => ({ slug, name: names[slug] ?? slug })),
    kind: digest ? "digest" : "article",
    ...(digest ? parseDigest(issue.body ?? "") : parseArticle(issue.body ?? "")),
  };
}

// ---- API --------------------------------------------------------------------

async function view(token, repo, name) {
  if (name === "today") {
    const open = await listIssues(token, repo, { labels: "article", state: "open" });
    return open.filter((i) => !i.labels.some((l) => l.name === "want"));
  }
  if (name === "toread") return listIssues(token, repo, { labels: "article,want", state: "open" });
  if (name === "done") {
    const closed = await listIssues(token, repo, { labels: "article,want", state: "closed", sort: "updated" }, 1);
    return closed.filter((i) => i.state_reason === "completed").slice(0, 50);
  }
  throw new HttpError(404, "unknown view");
}

const actions = {
  want: (t, repo, n) => github(t, `/repos/${repo}/issues/${n}/labels`, { method: "POST", body: { labels: ["want"] } }),
  unwant: (t, repo, n) => github(t, `/repos/${repo}/issues/${n}/labels/want`, { method: "DELETE" }),
  done: (t, repo, n) => github(t, `/repos/${repo}/issues/${n}`, { method: "PATCH", body: { state: "closed", state_reason: "completed" } }),
  reopen: (t, repo, n) => github(t, `/repos/${repo}/issues/${n}`, { method: "PATCH", body: { state: "open" } }),
};

function requireSameOrigin(request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new HttpError(403, "cross-origin request");
}

async function api(request, env, url) {
  const session = await sessionToken(request, env);
  const token = session.access;
  const repo = env.REPO;

  if (request.method === "GET" && url.pathname === "/api/me") return json({ login: session.login, repo });

  const viewMatch = url.pathname.match(/^\/api\/views\/(\w+)$/);
  if (request.method === "GET" && viewMatch) {
    const [issues, names] = await Promise.all([view(token, repo, viewMatch[1]), themeNames(token, repo)]);
    return json({ cards: issues.map((i) => toCard(i, names)) });
  }

  const actionMatch = url.pathname.match(/^\/api\/issues\/(\d+)\/(\w+)$/);
  if (request.method === "POST" && actionMatch && Object.hasOwn(actions, actionMatch[2])) {
    requireSameOrigin(request);
    const number = Number(actionMatch[1]);
    const issue = await github(token, `/repos/${repo}/issues/${number}`);
    if (issue.pull_request || !issue.labels.some((l) => l.name === "article")) throw new HttpError(400, "not an article issue");
    await actions[actionMatch[2]](token, repo, number);
    return json({ ok: true });
  }

  throw new HttpError(404, "not found");
}

// ---- Entry ------------------------------------------------------------------

async function route(request, env) {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/auth/login" && request.method === "GET") return await login(request, env);
    if (url.pathname === "/auth/callback" && request.method === "GET") return await callback(request, env);
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      requireSameOrigin(request);
      return await logout(request, env);
    }
    if (url.pathname.startsWith("/api/")) return await api(request, env, url);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(e.message);
    return json({ error: status === 500 ? "internal error" : e.message }, status);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    return withSecurityHeaders(await route(request, env));
  },
};
