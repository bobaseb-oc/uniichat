// Pages
// =====
// The cockpit's pages (Cockpit.ts works them out) as HTML, every text
// escaped: the inbox's head, sections, rows, a PR's details card and the
// picked panel. A click's effect is in the markup, as Html.ts's:
// `data-act`, the View.Act it makes; `data-fold`, a section shut or
// opened; `data-row`, the cursor's row; `data-pick`, a row picked; the
// rest main.ts reads (data-open-picks, data-drop-picks, data-claude).

import * as Cockpit from "../../Cockpit.ts";
import type { Inbox } from "../../Inbox.ts";
import * as Routines from "../../Routines.ts";
import type * as View from "../../View.ts";
import { esc } from "./Html.ts";

// where File issue goes: Legion's own repo, GitHub's own page (nothing is
// posted from here)
export const ISSUES = "https://github.com/bobaseb-oc/uniichat/issues/new";

// the inbox's state in the page: sections shut, the cursor's row, rows
// picked, the row whose details show
export type InboxUi = { shut: Set<string>; cursor: string | null; picks: Set<string>; detail: string | null };

function act_html(act: View.Act): string {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}

function link_html(url: string, text = "↗"): string {
  return url === "" ? "" : `<a class="go" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="open">${text}</a>`;
}

// what a PR row can have done to it: a review request reviewed, a PR of
// the user's that fails, conflicts or had changes asked fixed
const FIXABLE = ["failing", "conflicts", "changes"];
function row_acts(s: Cockpit.SectionId, r: Cockpit.Row): string {
  if (r.pr === undefined) {
    return "";
  }
  if (s === "reviews") {
    return `<button class="ra"${act_html({ $: "Review", prs: [r.pr.url], how: "review" })} title="a Legion agent reviews it">Review</button>`;
  }
  if ((s === "mine" || s === "alerts") && FIXABLE.includes(r.pr.state)) {
    return `<button class="ra"${act_html({ $: "Review", prs: [r.pr.url], how: "fix" })} title="a Legion agent fixes it">Fix</button>`;
  }
  return "";
}

function detail_html(r: Cockpit.Row): string {
  const p = r.pr;
  if (p === undefined) {
    return r.clean === undefined ? "" : `<div class="ibd"><code>${esc(r.clean.path)}</code></div>`;
  }
  const checks = p.failing.length === 0 ? "" : `<p class="fail">${p.failing.map(esc).join(" · ")}</p>`;
  const body = p.body.trim() === "" ? "" : `<div class="body">${esc(p.body)}</div>`;
  return `<div class="ibd"><p class="meta">${esc(`+${p.add} −${p.del} · ${p.files} files · ${p.branch} · ${p.author}`)}</p>${checks}${body}</div>`;
}

function row_html(s: Cockpit.SectionId, r: Cockpit.Row, ui: InboxUi): string {
  const here = ui.cursor === r.key ? " here" : "";
  const pick = r.pr === undefined ? `<span class="pk"></span>` : `<input type="checkbox" class="pk" data-pick="${esc(r.key)}"${ui.picks.has(r.key) ? " checked" : ""} aria-label="pick">`;
  const tag = r.tag === "" ? "" : `<span class="tag ${r.tone}">${esc(r.tag)}</span>`;
  const open = ui.detail === r.key ? detail_html(r) : "";
  const goto = r.agent === undefined ? "" : `<a class="go" href="#crew/${esc(encodeURIComponent(r.agent))}" title="go to agent">→</a>`;
  return `<div class="ibr ${r.kind}${here}" data-row="${esc(r.key)}">${pick}<span class="sub">${esc(r.sub)}</span><span class="t">${esc(r.title)}</span>${tag}<span class="age">${esc(r.age)}</span>${row_acts(s, r)}${link_html(r.url)}${goto}</div>${open}`;
}

// the inbox's sections; review requests older than Cockpit.OLD folded
export function inbox_html(sections: Cockpit.Section[], ui: InboxUi): string[] {
  return sections.map((s) => {
    const shut = ui.shut.has(s.id);
    const head = `<button class="ibt" data-fold="${s.id}"><span class="caret">${shut ? "▸" : "▾"}</span><b>${esc(s.title)}</b><span class="meta">${esc(s.sub)}</span><span class="n">${s.count}</span></button>`;
    const fresh = s.rows.filter((r) => !r.old).map((r) => row_html(s.id, r, ui)).join("");
    const old = s.rows.filter((r) => r.old);
    const folded = old.length === 0 ? "" : `<details class="old"><summary>${old.length} older than 60 days</summary>${old.map((r) => row_html(s.id, r, ui)).join("")}</details>`;
    const note = s.note === undefined ? "" : `<p class="ibnote">${esc(s.note)}</p>`;
    return `<section class="ibs${shut ? " shut" : ""}" data-sec="${s.id}">${head}<div class="ibrows">${note}${fresh}${folded}</div></section>`;
  });
}

// the inbox's head: when a device read it, what changed since the user
// looked, what failed to be read; Refresh, File issue
export function inbox_head(inbox: Inbox | null, changed: number): string {
  const issue = `<a class="pbtn" href="${esc(ISSUES)}" target="_blank" rel="noopener noreferrer">File issue</a>`;
  const refresh = `<button class="pbtn"${act_html({ $: "Fetch" })} title="the devices read it anew">Refresh</button>`;
  if (inbox === null) {
    return `<div class="phead"><h2>Inbox</h2><p class="meta">No device has read the inbox yet: open a terminal (legion) or run legion device; it reads with your gh, acli and git.</p>${refresh}${issue}</div>`;
  }
  const at = new Date(inbox.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const errs = inbox.errors.filter((e) => !e.startsWith("acli")).map((e) => `<p class="err">${esc(e)}</p>`).join("");
  return `<div class="phead"><h2>Inbox</h2><p class="meta">updated ${esc(at)} · ${changed} changed since you looked</p>${refresh}${issue}${errs}</div>`;
}

// the picked rows' panel: how many, each, what they can have done (each
// one's own: a review request reviewed, a PR fixed; Claude Code workers,
// if ticked, run them under a manager), opened, the picks dropped
export function picks_html(sections: Cockpit.Section[], picks: Set<string>, claude: boolean): string {
  if (picks.size === 0) {
    return "";
  }
  const rows = sections.flatMap((s) => s.rows.filter((r) => picks.has(r.key) && r.pr !== undefined).map((r) => [s.id, r] as const));
  const keys = [...new Set(rows.map(([, r]) => r.key))];
  const reviews = keys.filter((k) => rows.some(([s, r]) => r.key === k && s === "reviews"));
  const fixes = keys.filter((k) => rows.some(([s, r]) => r.key === k && s !== "reviews" && FIXABLE.includes(r.pr!.state)));
  const go = (label: string, prs: string[], how: "review" | "fix") =>
    prs.length === 0 ? "" : `<button class="pbtn"${act_html(claude ? { $: "Review", prs, how, claude: true } : { $: "Review", prs, how })}>${label} ${prs.length}</button>`;
  const list = keys.map((k) => `<li>${esc(rows.find(([, r]) => r.key === k)![1].sub + " " + rows.find(([, r]) => r.key === k)![1].title)}</li>`).join("");
  return `<aside class="picks"><b>${keys.length} picked</b><p class="meta">Each gets its own Legion agent.</p><ul>${list}</ul>`
    + `<label class="cc"><input type="checkbox" data-claude${claude ? " checked" : ""}> as Claude Code workers</label>`
    + `<div class="acts">${go("Review", reviews, "review")}${go("Fix", fixes, "fix")}<button class="pbtn" data-open-picks>Open</button><button class="pbtn" data-drop-picks>Drop picks</button></div></aside>`;
}

// Home
// ====

function card_html(c: Cockpit.Card, archive: boolean): string {
  const chips = [c.repo, c.ticket, c.pr].filter((x): x is string => x !== null).map((x) => `<span class="hchip">${esc(x)}</span>`).join("");
  const under = c.under === 0 ? "" : `<span class="meta">${c.under} under it</span>`;
  const acts = `<a class="pbtn" href="#crew/${esc(encodeURIComponent(c.name))}">Go to agent</a>` + (archive ? `<button class="pbtn"${act_html({ $: "Archive", names: [c.name] })}>Archive</button>` : "");
  return `<div class="hcard ${c.status}"><div class="hc1"><span class="hchip who">${esc(c.name)}</span><span class="meta">${esc(c.status)}</span><span class="age">${esc(c.age)}</span></div>`
    + `<b class="ht">${esc(c.title)}</b><div class="hc2">${chips}${c.cost === "" ? "" : `<span class="cost">${esc(c.cost)}</span>`}${under}</div><div class="hc3">${acts}</div></div>`;
}

const KIND_MARK: Record<string, string> = { review: "◎", assign: "▣", mention: "@", ci: "✗", security: "⚠", other: "•" };

// Home: the head (date, greeting, who needs the user; New agent, Focus),
// the stats, Unii's agents working then done, the apps, the activity
export function home_html(v: View.View, now: Date): string[] {
  const day = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const head = `<div class="phead home"><p class="meta">${esc(day)}</p><h2>${esc(Cockpit.home_greeting(now))}</h2><p class="meta">${esc(Cockpit.home_line(v))}</p>`
    + `<button class="pbtn" data-new-agent title="start an agent on a task (/agent)">New agent</button><button class="pbtn" data-focus title="hide the side columns">Focus</button></div>`;
  const stats = `<div class="stats">${Cockpit.home_stats(v).map((s) => `<a class="stat" href="${s.href}"><span class="meta">${esc(s.label)}</span><b>${esc(s.value)}</b><span class="meta">${esc(s.sub)}</span></a>`).join("")}</div>`;
  const { working, done } = Cockpit.home_cards(v, now.getTime());
  const group = (title: string, cards: Cockpit.Card[], archive: boolean) => cards.length === 0 ? "" :
    `<div class="hgroup"><div class="hgh"><b>${esc(title)}</b><span class="n">${cards.length}</span>${archive ? `<button class="pbtn"${act_html({ $: "Archive", names: cards.map((c) => c.name) })}>Archive all</button>` : ""}</div>${cards.map((c) => card_html(c, archive)).join("")}</div>`;
  const empty = working.length + done.length === 0 ? `<p class="meta">No agents yet: tell Legion what to do in the chat, or start one with New agent.</p>` : "";
  const apps = Cockpit.home_apps(v);
  const app = (href: string, name: string, line: string) => `<a class="app" href="${href}"><b>${esc(name)}</b><span class="meta">${esc(line)}</span></a>`;
  const side = `<div class="hside"><section><h3>Apps</h3>${app("#inbox", "Inbox", apps.inbox)}${app("#chat", "Questions", apps.questions)}${app("#routines", "Routines", apps.routines)}</section>`
    + `<section><h3>Activity</h3>${Cockpit.home_activity(v).map((n) => `<a class="act" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer"><span class="mk">${KIND_MARK[n.kind]}</span><span class="t">${esc(n.title)}</span><span class="meta">${esc(n.repo)}</span></a>`).join("") || `<p class="meta">Nothing yet.</p>`}</section></div>`;
  return [head, stats, `<div class="hcols"><div class="hmain">${group("Working", working, false)}${group("Done", done, true)}${empty}</div>${side}</div>`];
}

// Sidebar, palette
// ================

const MARK: Record<string, string> = { asking: "?", failed: "✗", working: "●", waiting: "◐", stopped: "■", done: "✓" };

// the sidebar: search or run (the palette), the pages (the one shown
// marked; the inbox's count, the crew's pill), Unii's agents by ticket,
// the spaces (a click: the inbox filtered by it), Settings, Add machine
export function side_html(v: View.View, mode: View.Mode, now: number): string[] {
  const here = (m: string) => (m === mode ? ` class="here"` : "");
  const n = (k: number) => (k === 0 ? "" : `<span class="n">${k}</span>`);
  const working = v.crew.filter((c) => c.status === "working").length;
  const pages = [
    ["home", "Home", 0], ["inbox", "Inbox", Cockpit.inbox_badge(v.inbox)], ["chat", "Chat", (v.questions ?? []).length],
    ["crew", "Crew", working], ["routines", "Routines", (v.routines ?? []).filter((r) => r.on).length], ["digest", "Digest", 0],
  ] as const;
  const nav = `<nav class="spages">${pages.map(([m, label, k]) => `<a href="#${m}"${here(m)}>${label}${n(k)}</a>`).join("")}</nav>`;
  const search = `<button class="ssearch" data-palette title="⌘K or Ctrl+P">Search or run… <kbd>⌘K</kbd></button>`;
  const groups = Cockpit.side_groups(v, now).map((g) => `<div class="sgroup"><div class="sgh">${esc(g.ticket ?? "–")}</div>${g.agents.map((a) =>
    `<a class="sagent ${a.status}" href="#crew/${esc(encodeURIComponent(a.name))}"><span class="st">${MARK[a.status]}</span><span class="t">${esc(a.title)}</span><span class="age">${esc(a.age)}</span></a>`).join("")}</div>`).join("");
  const count = v.crew.filter((c) => c.parent === "main").length;
  const agents = `<section class="sagents"><h3>Agents <span class="n">${count}</span></h3>${groups || `<p class="meta">None yet.</p>`}</section>`;
  const spaces = `<section class="sspaces"><h3>Spaces</h3>${Cockpit.side_spaces(v).map((s) =>
    `<button class="sspace" data-space="${esc(s.repo)}" title="the inbox, filtered by it"><span class="t">${esc(s.repo)}</span>${s.agents === 0 ? "" : `<span class="meta">${s.agents}×</span>`}${s.clean === 0 ? "" : `<span class="dirty" title="worktrees to clean up">${s.clean}</span>`}</button>`).join("") || `<p class="meta">None yet.</p>`}</section>`;
  const foot = `<div class="sfoot"><button data-go="/account">Settings</button><button data-add-machine title="another computer runs agents' jobs">Add machine</button></div>`;
  return [search, nav, agents, spaces, foot];
}

// the palette's list: each item, the one picked marked; none: a word
export function palette_html(items: Cockpit.Item[], sel: number): string[] {
  if (items.length === 0) {
    return [`<p class="meta pnone">Nothing matches.</p>`];
  }
  return items.slice(0, 50).map((it, k) => `<button class="pi${k === sel ? " here" : ""}" data-pi="${k}"><span class="t">${esc(it.label)}</span><span class="meta">${esc(it.hint)}</span></button>`);
}

// Routines
// ========

// the routines: each its name, when, the next run (or "on review
// requests"), the last, its tier; Run now, On/Off, Delete; then the form
// to add one (main.ts reads it: form.radd)
export function routines_html(v: View.View, now: number): string[] {
  const time = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const rows = (v.routines ?? []).map((r) => {
    const next = Routines.routine_next(r, now);
    const when = `<span class="meta">${esc(Routines.when_text(r.when))} · ${r.tier}${!r.on ? " · off" : next === null ? "" : " · next " + esc(time(next))}${r.last === null ? "" : " · last " + esc(Cockpit.age(now - r.last)) + " ago"}</span>`;
    const run = r.when.$ === "review" ? "" : `<button class="pbtn"${act_html({ $: "Routine", op: "run", n: r.id })}>Run now</button>`;
    const flip = `<button class="pbtn"${act_html({ $: "Routine", op: "toggle", n: r.id, on: !r.on })}>${r.on ? "Turn off" : "Turn on"}</button>`;
    const drop = `<button class="pbtn"${act_html({ $: "Routine", op: "drop", n: r.id })}>Delete</button>`;
    const task = r.task === "" ? "" : `<p class="rtask">${esc(r.task)}</p>`;
    return `<div class="routine${r.on ? "" : " off"}"><div class="rh"><b>${r.id}. ${esc(r.name)}</b>${when}</div>${task}<div class="acts">${run}${flip}${drop}</div></div>`;
  });
  const head = `<div class="phead"><h2>Routines</h2><p class="meta">Each starts a Legion agent on its task; they run while Legion's server runs and a view or a device is connected.</p></div>`;
  const form = `<form class="radd"><b>New routine</b><input name="name" placeholder="Name" maxlength="${Routines.NAME}" required>`
    + `<div class="rwhen"><select name="kind"><option value="daily">daily at</option><option value="every">every</option><option value="review">on each new review request</option></select>`
    + `<input name="at" type="time" value="09:00"><input name="hours" type="number" min="1" max="${Routines.HOURS}" value="4" aria-label="hours"><span class="meta">hours</span>`
    + `<select name="tier"><option value="worker">a worker</option><option value="manager">a manager</option></select></div>`
    + `<textarea name="task" rows="3" placeholder="The task (a review routine: what to look at besides the review)" maxlength="${Routines.TASK}"></textarea><button class="pbtn">Add</button></form>`;
  return [head, ...(rows.length === 0 ? [`<p class="meta">No routines yet.</p>`] : rows), form];
}
