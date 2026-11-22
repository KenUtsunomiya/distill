// Page logic for the distill reader. All text from issues is untrusted (it is
// written from third-party articles), so it is only ever set as textContent.

const views = ["today", "toread", "done"];
const leads = {
  today: (n) => `未選択の記事が ${n} 件あります。ハートを付けなかった記事は、翌朝 8:00 に閉じられます。`,
  toread: (n) => `読みたい記事が ${n} 件あります。読み終わったら「読んだ」を押してください。`,
  done: (n) => `最近読んだ記事 ${n} 件です。`,
};
const empties = {
  today: "今日の新しい記事はありません。",
  toread: "読みたい記事はまだありません。「今日」のタブでハートを付けてください。",
  done: "読み終わった記事はまだありません。",
};

const state = { view: "today", data: {}, theme: null };

const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function formatDate(s) {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// ---- Data ----

class SignInNeeded extends Error {}

async function call(path, options) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  if (res.status === 401) throw new SignInNeeded();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function load(view) {
  state.data[view] = (await call(`/api/views/${view}`)).cards;
}

async function loadAll() {
  const results = await Promise.allSettled(views.map(load));
  if (results.some((r) => r.status === "rejected" && r.reason instanceof SignInNeeded)) return showSignIn();
  results.forEach((r, i) => {
    if (r.status === "rejected") state.data[views[i]] = { error: r.reason.message };
  });
  render();
}

function act(number, action) {
  return call(`/api/issues/${number}/${action}`, { method: "POST" });
}

function showSignIn() {
  $("signin").hidden = false;
  $("tabs").hidden = true;
  $("who").hidden = true;
  $("lead").textContent = "";
  $("filters").hidden = true;
  $("list").replaceChildren();
  hideToast();
}

// ---- Actions (optimistic, with undo) ----

const moves = {
  want: { from: "today", to: "toread", undo: "unwant", message: "「読みたい」に追加しました" },
  unwant: { from: "toread", to: "today", undo: "want", message: "「今日」に戻しました" },
  done: { from: "toread", to: "done", undo: "reopen", message: "「読んだ」に移しました" },
  reopen: { from: "done", to: "toread", undo: "done", message: "「読みたい」に戻しました" },
};

function moveLocal(card, action) {
  const { from, to } = moves[action];
  const src = state.data[from];
  const dst = state.data[to];
  if (Array.isArray(src)) state.data[from] = src.filter((c) => c.number !== card.number);
  if (Array.isArray(dst)) state.data[to] = [card, ...dst.filter((c) => c.number !== card.number)];
}

async function run(card, action, el, { isUndo = false } = {}) {
  el?.classList.add("leaving");
  el?.querySelectorAll("button").forEach((b) => (b.disabled = true));
  await new Promise((r) => setTimeout(r, 180));
  moveLocal(card, action);
  render();
  try {
    await act(card.number, action);
    if (!isUndo) showToast(moves[action].message, () => run(card, moves[action].undo, null, { isUndo: true }));
    else hideToast();
  } catch (e) {
    if (e instanceof SignInNeeded) return showSignIn();
    moveLocal(card, moves[action].undo);
    render();
    showToast(`失敗しました: ${e.message}`);
  }
}

// ---- Toast ----

let toastTimer;

function showToast(text, undo) {
  $("toast-text").textContent = text;
  const btn = $("toast-undo");
  btn.hidden = !undo;
  btn.onclick = undo ? () => { hideToast(); undo(); } : null;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  $("toast").hidden = true;
}

// ---- Rendering ----

const HEART = "M12 20.5s-7.5-4.6-9.6-9.2C1 8.2 2.9 4.5 6.6 4.5c2.1 0 3.6 1.2 5.4 3.2 1.8-2 3.3-3.2 5.4-3.2 3.7 0 5.6 3.7 4.2 6.8-2.1 4.6-9.6 9.2-9.6 9.2z";

function heartIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", HEART);
  svg.append(path);
  return svg;
}

// The heart is the want mark: outlined on 今日, filled on 読みたい. Pressing it toggles want.
function heartButton(card, el) {
  const on = state.view === "toread";
  const button = h("button", {
    class: "heart",
    type: "button",
    "aria-pressed": String(on),
    "aria-label": on ? "読みたいから外す" : "読みたい",
    title: on ? "読みたいから外す" : "読みたい",
  });
  button.append(heartIcon());
  button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", String(!on));
    button.classList.add("pop");
    run(card, on ? "unwant" : "want", el());
  });
  return button;
}

function buttonsFor(card, el) {
  const btn = (label, action, primary) =>
    h("button", { class: primary ? "btn primary" : "btn", type: "button", onclick: () => run(card, action, el()) }, label);
  if (state.view === "today") return [heartButton(card, el)];
  if (state.view === "toread") return [heartButton(card, el), btn("読んだ", "done", true)];
  return [btn("読みたいに戻す", "reopen")];
}

function articleCard(card) {
  let el;
  const date = formatDate(card.published) ?? formatDate(card.createdAt);
  el = h(
    "article",
    { class: "card" },
    h("div", { class: "meta" }, card.source && h("span", { class: "source" }, card.source), date && h("span", {}, date)),
    h("h2", { class: "title" }, card.url ? h("a", { href: card.url, target: "_blank", rel: "noopener noreferrer" }, card.title) : card.title),
    card.summary && h("p", { class: "summary" }, card.summary),
    h("div", { class: "chips" }, card.themes.map((t) => h("span", { class: "chip" }, t.name))),
    h(
      "div",
      { class: "foot" },
      h("a", { class: "issue-link", href: card.issueUrl, target: "_blank", rel: "noopener noreferrer" }, `#${card.number}`),
      h("div", { class: "actions" }, buttonsFor(card, () => el)),
    ),
  );
  return el;
}

function digestCard(card) {
  let el;
  const count = card.sections.reduce((n, s) => n + s.items.length, 0);
  el = h(
    "article",
    { class: "card digest" },
    h("div", { class: "meta" }, h("span", { class: "source" }, "AWS What's New"), h("span", {}, `${count} 件`)),
    h("h2", { class: "title" }, card.title),
    card.intro && h("p", { class: "intro" }, card.intro),
    card.sections.map((s) =>
      h(
        "section",
        {},
        h("h3", {}, s.title),
        h(
          "ul",
          {},
          s.items.map((it) =>
            h(
              "li",
              {},
              it.url ? h("a", { href: it.url, target: "_blank", rel: "noopener noreferrer" }, it.title) : it.title,
              it.summary && h("span", { class: "what" }, it.summary),
            ),
          ),
        ),
      ),
    ),
    h(
      "div",
      { class: "foot" },
      h("a", { class: "issue-link", href: card.issueUrl, target: "_blank", rel: "noopener noreferrer" }, `#${card.number}`),
      h("div", { class: "actions" }, buttonsFor(card, () => el)),
    ),
  );
  return el;
}

function renderFilters(cards) {
  const box = $("filters");
  const themes = new Map();
  for (const c of cards) for (const t of c.themes) themes.set(t.slug, t.name);
  if (themes.size < 2) {
    box.hidden = true;
    state.theme = null;
    return;
  }
  if (state.theme && !themes.has(state.theme)) state.theme = null;
  const chip = (slug, name) =>
    h("button", { type: "button", "aria-pressed": String(state.theme === slug), onclick: () => { state.theme = slug; render(); } }, name);
  box.replaceChildren(chip(null, "すべて"), ...[...themes].map(([slug, name]) => chip(slug, name)));
  box.hidden = false;
}

function render() {
  for (const tab of document.querySelectorAll(".tabs button")) {
    const v = tab.dataset.view;
    tab.setAttribute("aria-selected", String(v === state.view));
    const d = state.data[v];
    tab.querySelector(".count").textContent = Array.isArray(d) ? d.length : "";
  }

  const list = $("list");
  const data = state.data[state.view];

  if (data === undefined) {
    $("lead").textContent = "";
    $("filters").hidden = true;
    list.replaceChildren(h("div", { class: "skeleton" }), h("div", { class: "skeleton" }), h("div", { class: "skeleton" }));
    return;
  }
  if (data.error) {
    $("lead").textContent = "";
    $("filters").hidden = true;
    list.replaceChildren(h("p", { class: "error" }, `読み込めませんでした: ${data.error}`));
    return;
  }

  // Articles first, newest first; digests after them.
  const sorted = [...data].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "digest" ? 1 : -1;
    return (b.published ?? b.createdAt).localeCompare(a.published ?? a.createdAt);
  });

  $("lead").textContent = leads[state.view](data.length);
  renderFilters(sorted);
  const shown = state.theme ? sorted.filter((c) => c.themes.some((t) => t.slug === state.theme)) : sorted;

  if (shown.length === 0) {
    list.replaceChildren(h("p", { class: "empty" }, empties[state.view]));
    return;
  }
  list.replaceChildren(...shown.map((c) => (c.kind === "digest" ? digestCard(c) : articleCard(c))));
}

for (const tab of document.querySelectorAll(".tabs button")) {
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    state.theme = null;
    hideToast();
    render();
    window.scrollTo({ top: 0 });
  });
}

$("logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  location.reload();
});

// The session check comes first, so that an expired GitHub token is refreshed
// by one request before the views load in parallel.
async function start() {
  try {
    const me = await call("/api/me");
    $("who-login").textContent = me.login;
    $("who").hidden = false;
    $("tabs").hidden = false;
  } catch (e) {
    if (e instanceof SignInNeeded) return showSignIn();
    $("list").replaceChildren(h("p", { class: "error" }, `読み込めませんでした: ${e.message}`));
    return;
  }
  render();
  loadAll();
}

start();
