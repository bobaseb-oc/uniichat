// Pages
// =====
// The cockpit's pages (Cockpit.ts works them out) as HTML, every text
// escaped: the inbox's head, sections, rows, a PR's details card and the
// picked panel. A click's effect is in the markup, as Html.ts's:
// `data-act`, the View.Act it makes; `data-fold`, a section shut or
// opened; `data-row`, the cursor's row; `data-pick`, a row picked; the
// rest main.ts reads (data-open-picks, data-drop-picks, data-claude).

import * as Cockpit from "../../Cockpit.ts";
import { Directives } from "../../Directives.ts";
import * as Explain from "../../Explain.ts";
import type { Inbox } from "../../Inbox.ts";
import type { Note } from "../../Notes.ts";
import * as Routines from "../../Routines.ts";
import type * as View from "../../View.ts";
import { FIND, FOUND, minute, PINNED, PINS, SHOWN } from "../../View.ts";
import { block_html, esc } from "./Html.ts";
import { md_parse } from "../../Md.ts";
import { hl_lang, hl_lines } from "../../Hl.ts";

// where File issue goes: Legion's own repo, GitHub's own page (nothing is
// posted from here)
export const ISSUES = "https://github.com/bobaseb-oc/legion/issues/new";

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
// the user's that fails, conflicts or had changes asked fixed (Cockpit.FIX)
function row_acts(s: Cockpit.SectionId, r: Cockpit.Row): string {
  // a worktree the server shows as safe (Inbox.inbox_safe): Remove,
  // confirmed (View.tidy_ask), then checked again on the device
  if (r.clean?.safe === true) {
    return `<button class="ra"${act_html({ $: "Tidy", paths: [r.clean.path] })} title="merged or gone, clean, pushed, no stash, not in use: remove it (git worktree remove)">Remove</button>`;
  }
  if (r.pr === undefined) {
    return "";
  }
  if (s === "reviews") {
    return `<button class="ra"${act_html({ $: "Review", prs: [r.pr.url], how: "review" })} title="a Legion agent reviews it">Review</button>`;
  }
  if ((s === "mine" || s === "alerts") && Cockpit.FIX.includes(r.pr.state)) {
    return `<button class="ra"${act_html({ $: "Review", prs: [r.pr.url], how: "fix" })} title="a Legion agent fixes it">Fix</button>`;
  }
  return "";
}

function detail_html(r: Cockpit.Row): string {
  const p = r.pr;
  if (p === undefined) {
    if (r.clean === undefined) {
      return "";
    }
    // security review 4 D2: .env files git can't give back keep it (Inbox.inbox_safe)
    const envs = (r.clean.envs ?? []).length === 0 ? "" : `<p class="fail">${esc("kept: .env files git can't give back: " + (r.clean.envs ?? []).join(", "))}</p>`;
    const why = r.clean.why === undefined ? "" : `<p class="fail">${esc("kept: " + r.clean.why)}</p>`;
    return `<div class="ibd"><code>${esc(r.clean.path)}</code>${why}${envs}</div>`;
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

// the To clean up section's Remove of every row the server shows as safe:
// one confirm listing them (View.tidy_ask), each checked again on the device
function tidy_all(rows: Cockpit.Row[]): string {
  const paths = rows.flatMap((r) => (r.clean?.safe === true ? [r.clean.path] : []));
  return paths.length === 0 ? "" : `<p class="ibnote"><button class="ra"${act_html({ $: "Tidy", paths })} title="every worktree shown as safe: remove them (git worktree remove)">Remove all ${paths.length} safe</button></p>`;
}

// the inbox's sections; review requests older than Cockpit.OLD folded
export function inbox_html(sections: Cockpit.Section[], ui: InboxUi): string[] {
  return sections.map((s) => {
    const shut = ui.shut.has(s.id);
    const head = `<button class="ibt" data-fold="${s.id}"><span class="caret">${shut ? "▸" : "▾"}</span><b>${esc(s.title)}</b><span class="meta">${esc(s.sub)}</span><span class="n">${s.count}</span></button>`;
    const fresh = s.rows.filter((r) => !r.old).map((r) => row_html(s.id, r, ui)).join("");
    const old = s.rows.filter((r) => r.old);
    const folded = old.length === 0 ? "" : `<details class="old"><summary>${old.length} older than 60 days</summary>${old.map((r) => row_html(s.id, r, ui)).join("")}</details>`;
    const note = (s.note === undefined ? "" : `<p class="ibnote">${esc(s.note)}</p>`) + (s.id === "clean" ? tidy_all(s.rows) : "");
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
// one's own: a review request reviewed, a PR fixed; if ticked, Legion is
// asked for a Claude Code worker each), opened, the picks dropped
export function picks_html(sections: Cockpit.Section[], picks: Set<string>, claude: boolean): string {
  if (picks.size === 0) {
    return "";
  }
  const { picked, review, fix } = Cockpit.picks_acts(sections, picks, claude);
  const go = (label: string, act: View.Act | null) =>
    act === null || act.$ !== "Review" ? "" : `<button class="pbtn"${act_html(act)}>${label} ${act.prs.length}</button>`;
  const list = picked.map((r) => `<li>${esc(r.sub + " " + r.title)}</li>`).join("");
  return `<aside class="picks"><b>${picked.length} picked</b><p class="meta">Each gets its own Legion agent.</p><ul>${list}</ul>`
    + `<label class="cc"><input type="checkbox" data-claude${claude ? " checked" : ""}> as Claude Code workers</label>`
    + `<div class="acts">${go("Review", review)}${go("Fix", fix)}<button class="pbtn" data-open-picks>Open</button><button class="pbtn" data-drop-picks>Drop picks</button></div></aside>`;
}

// Home
// ====

// a card: Archive only for an agent no longer at work
function card_html(c: Cockpit.Card): string {
  const archive = !["working", "waiting", "asking"].includes(c.status);
  const chips = [c.repo, c.ticket, c.pr].filter((x): x is string => x !== null).map((x) => `<span class="hchip">${esc(x)}</span>`).join("");
  const under = c.under === 0 ? "" : `<span class="meta">${c.under} under it</span>`;
  const acts = `<a class="pbtn" href="#crew/${esc(encodeURIComponent(c.name))}">Go to agent</a>` + (archive ? `<button class="pbtn"${act_html({ $: "Archive", names: [c.name] })}>Archive</button>` : "");
  return `<div class="hcard ${c.status}"><div class="hc1"><span class="hchip who">${esc(c.name)}</span><span class="meta">${esc(c.status)}</span><span class="age">${esc(c.age)}</span></div>`
    + `<b class="ht">${esc(c.title)}</b><div class="hc2">${chips}${c.cost === "" ? "" : `<span class="cost">${esc(c.cost)}</span>`}${under}</div><div class="hc3">${acts}</div></div>`;
}

const KIND_MARK: Record<string, string> = { review: "◎", assign: "▣", mention: "@", ci: "✗", security: "⚠", other: "•" };

// While you were away (Cockpit.away): how long, the agents done or failed
// (a failed one's why), the routines run, links to what is counted (the
// questions' and notes' text stays in the Questions pane); Got it marks
// it seen (main.ts reads data-away-seen)
export function away_html(a: Cockpit.Away): string {
  const n = (k: number, one: string, many = one + "s") => k + " " + (k === 1 ? one : many);
  const counts = [a.done === 0 ? "" : a.done + " done", a.failed === 0 ? "" : a.failed + " failed"].filter((x) => x !== "");
  const head = `<div class="awh"><b>While you were away</b><span class="meta">${esc([a.span, ...counts].join(" · "))}</span><button class="pbtn" data-away-seen title="hide this till you are away again">Got it</button></div>`;
  const agent = (x: Cockpit.AwayAgent) => `<a class="awa ${x.status}" href="#crew/${esc(encodeURIComponent(x.name))}"><span class="mk">${MARK[x.status]}</span><span class="t">${esc(x.title)}</span>`
    + `${x.why === "" ? "" : `<span class="meta">${esc(x.why)}</span>`}</a>`;
  const more = a.more === 0 ? "" : `<a class="meta" href="#crew">+${a.more} more</a>`;
  const ran = a.routines.length === 0 ? "" : `<p class="meta">Routines ran: ${esc(a.routines.join(", "))}</p>`;
  const links = [
    a.questions === 0 ? "" : `<a href="#chat">${n(a.questions, "new question")}</a>`,
    a.notes === 0 ? "" : `<a href="#chat">${n(a.notes, "new note")}</a>`,
    a.inbox === 0 ? "" : `<a href="#inbox">${n(a.inbox, "inbox change")}</a>`,
  ].filter((x) => x !== "");
  return `<section class="away">${head}${a.agents.map(agent).join("")}${more}${ran}${links.length === 0 ? "" : `<p class="awl">${links.join(" · ")}</p>`}</section>`;
}

// Home: the head (date, greeting, who needs the user; New agent, Focus),
// the card of what happened while away (if any), the stats, Legion's
// agents working then done, the apps, the activity
export function home_html(v: View.View, now: Date, away: Cockpit.Away | null = null): string[] {
  const day = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const head = `<div class="phead home"><p class="meta">${esc(day)}</p><h2>${esc(Cockpit.home_greeting(now))}</h2><p class="meta">${esc(Cockpit.home_line(v))}</p>`
    + `<button class="pbtn" data-new-agent title="start an agent on a task (/agent)">New agent</button><button class="pbtn" data-focus title="hide the side columns">Focus</button></div>`;
  const stats = `<div class="stats">${Cockpit.home_stats(v).map((s) => `<a class="stat" href="${s.href}"><span class="meta">${esc(s.label)}</span><b>${esc(s.value)}</b><span class="meta">${esc(s.sub)}</span></a>`).join("")}</div>`;
  const { working, done } = Cockpit.home_cards(v, now.getTime());
  const group = (title: string, cards: Cockpit.Card[], archive: boolean) => cards.length === 0 ? "" :
    `<div class="hgroup"><div class="hgh"><b>${esc(title)}</b><span class="n">${cards.length}</span>${archive ? `<button class="pbtn"${act_html({ $: "Archive", names: cards.map((c) => c.name) })}>Archive all</button>` : ""}</div>${cards.map(card_html).join("")}</div>`;
  const empty = working.length + done.length === 0 ? `<p class="meta">No agents yet: tell Legion what to do in the chat, or start one with New agent.</p>` : "";
  const apps = Cockpit.home_apps(v);
  const app = (href: string, name: string, line: string) => `<a class="app" href="${href}"><b>${esc(name)}</b><span class="meta">${esc(line)}</span></a>`;
  const signed = v.inbox?.errors.find((e) => e.startsWith("google:"));
  const next = Cockpit.up_next(v, now.getTime());
  const meet = (url: string) => url === "" ? "" : `<a class="pbtn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Join</a>`;
  const upnext = `<section><h3>Up next</h3>${v.inbox?.google ? (next.map((e) => `<div class="next"><span class="when">${esc(e.time)}<span class="meta">${e.day}</span></span><span class="t">${esc(e.title)}</span>${meet(e.meet)}</div>`).join("") || `<p class="meta">Nothing coming up.</p>`)
    : `<p class="meta">${esc(signed !== undefined ? signed.replace(/^google: /, "Google: ") : "Calendar: run legion google-login on your device.")}</p>`}</section>`;
  const todos = (v.assigned ?? []).length;
  const side = `<div class="hside">${upnext}<section><h3>Apps</h3>${app("#inbox", "Inbox", apps.inbox)}${app("#todo", "Todo", todos === 0 ? "nothing to do" : todos + " for you to do")}${app("#tracks", "Tracks", tracks_line(v))}${app("#chat", "Questions", apps.questions)}${app("#routines", "Routines", apps.routines)}${app("#transcripts", "Transcripts", String(v.inbox?.google?.docs.length ?? 0) + " in 14 days")}`
    + `${app("#digest", "Digest", String(v.inbox?.digest?.merged.length ?? 0) + " merged this week")}${app("#files", "Files", files_line(v))}${app("#timesheet", "Timesheet", sheet_line(v))}${app("#memory", "Memory", (v.pins ?? []).length + " pinned · search, the tree")}</section>`
    + `<section><h3>Activity</h3>${Cockpit.home_activity(v).map((n) => `<a class="act" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer"><span class="mk">${KIND_MARK[n.kind]}</span><span class="t">${esc(n.title)}</span><span class="meta">${esc(n.repo)}</span></a>`).join("") || `<p class="meta">Nothing yet.</p>`}</section></div>`;
  return [head, ...(away === null ? [] : [away_html(away)]), stats, `<div class="hcols"><div class="hmain">${group("Working", working, false)}${group("Done", done, true)}${empty}</div>${side}</div>`];
}

// the agents with files to show (Files), the timesheet drafts waiting for
// the user (Timesheet), and Home's lines for them
function with_files(v: View.View): number {
  return v.crew.filter((c) => (c.files ?? []).length > 0).length;
}
function drafts_open(v: View.View): number {
  return (v.drafts ?? []).filter((d) => d.state === "draft" || d.state === "failed").length;
}
function files_line(v: View.View): string {
  const n = with_files(v);
  return n === 0 ? "what agents read and change" : n + (n === 1 ? " agent's" : " agents'") + " files";
}
function sheet_line(v: View.View): string {
  const n = drafts_open(v);
  return n === 0 ? "Harvest drafts" : n + (n === 1 ? " draft" : " drafts") + " to review";
}

// Sidebar, palette
// ================

// the most spaces the sidebar lists (the rest: a count)
export const SPACES = 12;

const MARK: Record<string, string> = Cockpit.MARK;

// the sidebar: search or run (the palette), the pages (the one shown
// marked; the inbox's count, the crew's pill), Legion's agents by ticket,
// the spaces (a click: the inbox filtered by it), Settings, Add machine
export function side_html(v: View.View, mode: View.Mode, now: number): string[] {
  const here = (m: string) => (m === mode ? ` class="here"` : "");
  const n = (k: number) => (k === 0 ? "" : `<span class="n">${k}</span>`);
  const working = v.crew.filter((c) => c.status === "working").length;
  const pages = [
    ["home", "Home", 0], ["inbox", "Inbox", Cockpit.inbox_badge(v.inbox)], ["todo", "Todo", (v.assigned ?? []).length], ["chat", "Chat", (v.questions ?? []).length],
    ["crew", "Crew", working], ["tracks", "Tracks", 0], ["routines", "Routines", (v.routines ?? []).filter((r) => r.on).length], ["digest", "Digest", 0], ["transcripts", "Transcripts", 0],
    ["files", "Files", with_files(v)], ["timesheet", "Timesheet", drafts_open(v)], ["memory", "Memory", (v.pins ?? []).length],
  ] as const;
  const nav = `<nav class="spages">${pages.map(([m, label, k]) => `<a href="#${m}"${here(m)}>${label}${n(k)}</a>`).join("")}</nav>`;
  const search = `<button class="ssearch" data-palette title="⌘K or Ctrl+P">Search or run… <kbd>⌘K</kbd></button>`;
  const groups = Cockpit.side_groups(v, now).map((g) => `<div class="sgroup"><div class="sgh">${esc(g.ticket ?? "–")}</div>${g.agents.map((a) =>
    `<a class="sagent ${a.status}" href="#crew/${esc(encodeURIComponent(a.name))}"><span class="st">${MARK[a.status]}</span><span class="t">${esc(a.title)}</span><span class="age">${esc(a.age)}</span></a>`).join("")}</div>`).join("");
  const count = v.crew.filter((c) => c.parent === "main").length;
  const agents = `<section class="sagents"><h3>Agents <span class="n">${count}</span></h3>${groups || `<p class="meta">None yet.</p>`}</section>`;
  const all = Cockpit.side_spaces(v);
  const more = all.length > SPACES ? `<p class="meta">+${all.length - SPACES} more (the palette finds them)</p>` : "";
  const spaces = `<section class="sspaces"><h3>Spaces</h3>${all.slice(0, SPACES).map((s) =>
    `<button class="sspace" data-space="${esc(s.repo)}" title="the inbox, filtered by it"><span class="t">${esc(s.repo)}</span>${s.agents === 0 ? "" : `<span class="meta">${s.agents}×</span>`}${s.clean === 0 ? "" : `<span class="dirty" title="worktrees to clean up">${s.clean}</span>`}</button>`).join("") || `<p class="meta">None yet.</p>`}${more}</section>`;
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
// requests"), the last; Run now, On/Off, Delete; then the form
// to add one (main.ts reads it: form.radd)
export function routines_html(v: View.View, now: number): string[] {
  const rows = (v.routines ?? []).map((r) => {
    const next = Routines.routine_next(r, now);
    const when = `<span class="meta">${esc(Routines.when_text(r.when))}${!r.on ? " · off" : next === null ? "" : " · next " + esc(when_at(next))}${r.last === null ? "" : " · last " + esc(Cockpit.age(now - r.last)) + " ago"}</span>`;
    const run = r.when.$ === "review" ? "" : `<button class="pbtn"${act_html({ $: "Routine", op: "run", n: r.id })}>Run now</button>`;
    const flip = `<button class="pbtn"${act_html({ $: "Routine", op: "toggle", n: r.id, on: !r.on })}>${r.on ? "Turn off" : "Turn on"}</button>`;
    const drop = `<button class="pbtn"${act_html({ $: "Routine", op: "drop", n: r.id })}>Delete</button>`;
    const task = r.task === "" ? "" : `<p class="rtask">${esc(r.task)}</p>`;
    const acts = `<div class="acts">${run}${flip}${drop}</div>`;
    if (!Routines.pending(r)) {
      return `<div class="routine${r.on ? "" : " off"}"><div class="rh"><b>${r.id}. ${esc(r.name)}</b>${when}</div>${task}${acts}</div>`;
    }
    // an agent's proposal: marked, its name and why quoted as the agent's
    // words, its whole task beside Turn on (what turning it on approves)
    const who = r.by === "main" ? "Legion" : esc(r.by!);
    return `<div class="routine off proposed"><div class="rh"><span class="rbadge">Proposed by ${who}</span><b>${r.id}. “${esc(r.name)}”</b>${when}</div>`
      + `<blockquote class="rwhy">${who}'s words: “${esc(r.why ?? "")}”</blockquote><div class="rapprove"><p class="meta">Turn on approves this task:</p>${task}${acts}</div></div>`;
  });
  const head = `<div class="phead"><h2>Routines</h2><p class="meta">Each starts a Legion agent on its task; they run while Legion's server runs and a view or a device is connected.</p></div>`;
  const form = `<form class="radd"><b>New routine</b><input name="name" placeholder="Name" maxlength="${Routines.NAME}" required>`
    + `<div class="rwhen"><select name="kind"><option value="daily">daily at</option><option value="weekly">weekly on</option><option value="every">every</option><option value="review">on each new review request</option></select>`
    + `<select name="day" aria-label="day">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => `<option value="${i}"${i === 5 ? " selected" : ""}>${d}</option>`).join("")}</select>`
    + `<input name="at" type="time" value="09:00"><input name="hours" type="number" min="1" max="${Routines.HOURS}" value="4" aria-label="hours"><span class="meta">hours</span>`
    + `</div>`
    + `<textarea name="task" rows="3" placeholder="The task (a review routine: what to look at besides the review)" maxlength="${Routines.TASK}"></textarea><button class="pbtn">Add</button></form>`;
  return [head, ...(rows.length === 0 ? [`<p class="meta">No routines yet.</p>`] : rows), form];
}

// what a routine act's answer says where it was pressed (main.ts toasts
// it; user's report 2026-11-27: Run now seemed to do nothing, its errors
// only a note in the chat): an error word for word, a run started; null:
// nothing to say
export function routine_said(a: View.Act, out: View.Answer): string | null {
  if (a.$ !== "Routine") {
    return null;
  }
  if (out.error !== undefined) {
    return out.error;
  }
  return a.op === "run" ? "Routine started: its agent reports in the chat." : null;
}

// the agents' pending timers, under the routines (security review R4: the
// user sees what will wake unattended): each its number, whose, when, its
// note, and Close; none: nothing
export function timers_html(v: View.View): string[] {
  const ts = v.timers ?? [];
  if (ts.length === 0) {
    return [];
  }
  const time = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const rows = ts.map((t) => {
    const who = t.who === "main" ? "Legion" : esc(t.who);
    const close = `<button class="pbtn"${act_html({ $: "Timer", n: t.id })}>Close</button>`;
    return `<div class="routine"><div class="rh"><b>${t.id}. ${who}</b><span class="meta">at ${esc(time(t.at))}</span></div><p class="rtask">${esc(t.note)}</p><div class="acts">${close}</div></div>`;
  });
  return [`<div class="phead"><h3>Timers</h3><p class="meta">Each wakes the agent that set it with its note. Stop (all) clears them all.</p></div>`, ...rows];
}

// Digest
// ======

// the team digest: the repos and the week; merged by author (their themes
// if summarized, else their PRs), then open ones; Summarize by theme,
// Refresh
export function digest_html(v: View.View): string[] {
  const d = v.inbox?.digest ?? null;
  const refresh = `<button class="pbtn"${act_html({ $: "Fetch" })}>Refresh</button>`;
  if (d === null) {
    return [`<div class="phead"><h2>Digest</h2><p class="meta">No digest yet: a device reads it from your spaces' GitHub repos (LEGION_SPACES on the device, else its home repo).</p>${refresh}</div>`];
  }
  const repos = `<p class="meta">${d.repos.length} repo${d.repos.length === 1 ? "" : "s"}: ${esc(d.repos.join(", "))}</p>`;
  const head = `<div class="phead"><h2>Digest: last 7 days</h2>${repos}<p class="meta">${d.merged.length} merged · ${d.open.length} open</p>`
    + `<button class="pbtn"${act_html({ $: "Themes" })} title="one call to the compactor's model">Summarize by theme</button>${refresh}</div>`;
  const pr = (p: { title: string; url: string; number: number; repo: string }) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a> <span class="meta">#${p.number}</span></li>`;
  const merged = Cockpit.digest_groups(d.merged).map((g) => {
    const themes = v.themes?.[g.author];
    const lines = themes !== undefined && themes.length > 0 ? themes.map((t) => `<li>${esc(t)}</li>`).join("") : g.prs.map(pr).join("");
    return `<div class="dauthor"><h4>${esc(g.author)}</h4><ul>${lines}</ul></div>`;
  });
  const open = Cockpit.digest_groups(d.open).map((g) => `<div class="dauthor"><h4>${esc(g.author)}</h4><ul>${g.prs.map(pr).join("")}</ul></div>`);
  return [head, `<section class="digest"><h3>Merged</h3>${merged.join("") || `<p class="meta">Nothing merged this week.</p>`}</section>`, `<section class="digest"><h3>In progress</h3>${open.join("") || `<p class="meta">Nothing open.</p>`}</section>`];
}

// Transcripts (Google.ts, RED ZONE draft)
// =======================================

// the transcript Docs of the last 14 days, and the one picked: its
// summary (Markdown, escaped by Html.block_html), or Summarize (one call
// to the compactor), or that it's being read and summarized; Open full
// transcript (Google Docs); signed out: how to sign in
export function transcripts_html(v: View.View, sel: string | null, reading: Set<string>): string[] {
  const g = v.inbox?.google ?? null;
  const head = `<div class="phead"><h2>Transcripts</h2><p class="meta">Recorded calls: last 14 days</p><button class="pbtn"${act_html({ $: "Fetch" })}>Refresh</button></div>`;
  if (g === null) {
    const why = v.inbox?.errors.find((e) => e.startsWith("google:")) ?? "google: run legion google-login on your device";
    return [head, `<p class="meta">${esc(why.replace(/^google: /, "Google: "))}</p>`];
  }
  const day = (at: string) => new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const list = g.docs.map((d) => `<button class="tdoc${d.id === sel ? " here" : ""}" data-doc="${esc(d.id)}"><span class="meta">${esc(day(d.at))}</span><span class="t">${esc(d.title)}</span>${v.summaries.has(d.id) ? `<span class="meta">summarized</span>` : ""}</button>`).join("") || `<p class="meta">No transcripts in the last 14 days.</p>`;
  const doc = g.docs.find((d) => d.id === sel);
  let body = `<p class="meta">Pick a transcript.</p>`;
  if (doc !== undefined) {
    const s = v.summaries.get(doc.id);
    const open = doc.url === "" ? "" : `<a class="pbtn" href="${esc(doc.url)}" target="_blank" rel="noopener noreferrer">Open full transcript</a>`;
    const what = s !== undefined ? `<div class="tsum">${md_parse(s.text).map(block_html).join("")}</div>`
      : reading.has(doc.id) ? `<p class="meta">Reading and summarizing…</p>`
      : `<button class="pbtn"${act_html({ $: "Transcript", id: doc.id })} title="its text goes to the compactor's model, once">Summarize</button>`;
    body = `<h3>${esc(doc.title)}</h3><p class="meta">${esc(day(doc.at))}</p><div class="acts">${open}</div>${what}`;
  }
  return [head, `<div class="tcols"><div class="tlist">${list}</div><div class="tbody">${body}</div></div>`];
}

// the files pane and git tab (K4, Terax-like, read-only): each agent's
// touched files (Tools.touched), a Look each; git's views of the shown
// file's repo (else the home repo); what a device showed last: a file's
// lines numbered, a diff's lines marked, a log's commits each opened
export function files_html(v: View.View): string[] {
  const looked = v.looked;
  const head = `<div class="phead"><h2>Files</h2><p class="meta">What the agents read and changed, read-only; Git: its repo</p></div>`;
  const agents = v.crew.filter((c) => (c.files ?? []).length > 0).map((c) => {
    const files = (c.files ?? []).map((f) => `<button class="fpath${looked?.kind === "file" && looked.path?.endsWith("/" + f.replace(/^\.?\//, "")) ? " here" : ""}"${act_html({ $: "Look", what: { kind: "file", path: f, agent: c.name } })}>${esc(f)}</button>`).join("");
    // its changes: the repo of the first file it touched by its full path
    const full = (c.files ?? []).find((f) => f.startsWith("/"));
    const changes = full === undefined ? "" : ` <button class="pbtn" title="its branch's work since main, committed or not"${act_html({ $: "Look", what: { kind: "git", repo: full, op: "changes" } })}>changes</button>`;
    return `<div class="fgroup"><h3>${esc(c.title ?? c.name)} <span class="meta">${esc(c.name)}</span>${changes}</h3>${files}</div>`;
  }).join("") || `<p class="meta">No agent has read or changed a file yet. A path in the chat opens here too.</p>`;
  const repo = looked?.path ?? "@home";
  const editor = looked?.kind === "file" && looked.path !== undefined && looked.error === undefined ? `<button class="pbtn" title="in VS Code, else your default editor"${act_html({ $: "Look", what: { kind: "open", path: looked.path } })}>Open in editor</button>` : "";
  const told = v.told === null ? "" : `<span class="meta">${esc(v.told)}</span>`;
  const shown = looked?.kind === "file" && looked.hash !== undefined && looked.error === undefined;
  const edit = !shown || v.editing ? "" : `<button class="pbtn" title="edit it here; saved only if unchanged since shown"${act_html({ $: "Edit", on: true })}>Edit</button>`;
  const git = ["status", "log", "diff", "changes", "branches"].map((op) => `<button class="pbtn${looked?.kind === "git" && looked.op === op ? " here" : ""}"${act_html({ $: "Look", what: { kind: "git", repo, op } })}>${op}</button>`).join("");
  const where = `<div class="fbar"><span class="meta">${esc(looked?.path ?? "home repo")}</span>${editor}${edit}${told}<span class="fgit">Git: ${git}</span></div>`;
  const dir = looked?.path === undefined ? "" : looked.kind === "file" ? looked.path.slice(0, Math.max(1, looked.path.lastIndexOf("/"))) : looked.path;
  const run = `<form class="fsh" data-dir="${esc(dir)}"><input placeholder="Run a command in ${esc(dir || "the home repo")} (its output comes in the chat)" aria-label="run a command here" autocomplete="off"></form>`;
  return [head, `<div class="tcols"><div class="tlist">${explorer_html(v)}${agents}</div><div class="tbody">${where}${run}${v.editing && shown ? edit_html(looked!.text ?? "") : shown_html(looked, v.source, v.line)}</div></div>`];
}

// the file shown in an editing box (RED ZONE): Save sends it (main.ts,
// View's Save, with the hash it was shown with), Cancel drops the edit
function edit_html(text: string): string {
  return `<form class="fedit" data-edit><textarea data-keep="edit" spellcheck="false" aria-label="the file's text">${esc(text)}</textarea><div class="acts"><button type="submit" class="pbtn">Save</button><button type="button" class="pbtn"${act_html({ $: "Edit", on: false })}>Cancel</button><span class="meta">⌘S saves</span></div></form>`;
}

// the last find (⌘P) or search (⌘⇧F) across the workspaces: each one's
// hits, a Look each (a search's at its line); none open: said
function found_html(v: View.View): string {
  const f = v.found;
  const box = (kind: "find" | "grep", hint: string) => `<form class="ffind" data-find="${kind}"><input data-keep="${kind}" value="${esc(f?.kind === kind ? f.q : "")}" placeholder="${hint}" aria-label="${hint}" autocomplete="off"></form>`;
  const boxes = box("find", "Find a file… ⌘P") + box("grep", "Search text… ⌘⇧F");
  if (f === null) {
    return boxes;
  }
  const close = `<button class="fclose" title="clear"${act_html({ $: "Find", kind: f.kind, q: "" })}>×</button>`;
  if (f.by.size === 0) {
    return boxes + `<p class="meta">Open a workspace to find in it.</p>`;
  }
  const each = [...f.by].map(([w, got]) => {
    const head = `<p class="meta fx">${esc(w.slice(w.lastIndexOf("/") + 1) || w)}</p>`;
    if (got.error !== undefined || got.text === undefined) {
      return head + `<p class="meta fx" style="--d:1">${esc(got.error ?? (f.kind === "find" ? "Finding…" : "Searching…"))}</p>`;
    }
    const rows = got.text.split("\n").filter((l) => l !== "").map((l) => hit_html(f.kind, w, l));
    return head + (rows.join("") || `<p class="meta fx" style="--d:1">none</p>`);
  }).join("");
  return boxes + `<div class="ffound"><h3>${f.kind === "find" ? "Files" : "Lines"} with “${esc(f.q)}” ${close}</h3>${each}</div>`;
}

// a hit in workspace w: a found file, or a search's file:line:text, a Look
function hit_html(kind: "find" | "grep", w: string, l: string): string {
  if (kind === "find") {
    return `<button class="fx" style="--d:1"${act_html({ $: "Look", what: { kind: "file", path: w + "/" + l } })}>${esc(l)}</button>`;
  }
  const m = /^(.*?):(\d+):(.*)$/.exec(l);
  if (m === null) {
    return "";
  }
  const [, file, line, text] = m as unknown as [string, string, string, string];
  return `<button class="fx" style="--d:1" title="${esc(file + ":" + line)}"${act_html({ $: "Look", what: { kind: "file", path: w + "/" + file, line: Number(line) } })}><b>${esc(file.slice(file.lastIndexOf("/") + 1))}:${line}</b> ${esc(text.trim())}</button>`;
}

// the explorer (Terax-like): workspaces opened from the device's roots,
// several at once, each a tree of the folders unfolded (View's Tree);
// a file a Look, a secret's opened in the editor only (never shown here)
function explorer_html(v: View.View): string {
  const roots = (v.dirs.get("@roots")?.text ?? "").split("\n").filter((l) => l.startsWith("d ")).map((l) => l.slice(2));
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1) || p;
  const pick = roots.filter((r) => !v.workspaces.includes(r)).map((r) => `<option value="${esc(r)}">${esc(base(r) + " — " + r)}</option>`).join("");
  const picker = `<select data-ws aria-label="open a workspace"><option value="">Open a workspace…</option>${pick}</select>`;
  const spaces = v.workspaces.map((w) => {
    const open = v.unfolded.has(w);
    const head = `<div class="fws"><button class="fx fdir" title="${esc(w)}"${act_html({ $: "Tree", path: w })}>${open ? "▾" : "▸"} ${esc(base(w))}</button><button class="fclose" title="close this workspace"${act_html({ $: "Workspace", path: w, on: false })}>×</button></div>`;
    return head + (open ? folder_html(v, w, 1) : "");
  }).join("");
  return `<div class="fgroup fexp">${found_html(v)}<h3>Workspaces</h3>${picker}${spaces}</div>`;
}

// a folder's entries, as its device listed them (View.Looked's "dir")
function folder_html(v: View.View, dir: string, depth: number): string {
  const got = v.dirs.get(dir);
  const note = (s: string) => `<p class="meta fx" style="--d:${depth}">${esc(s)}</p>`;
  if (got?.error !== undefined) {
    return note(got.error);
  }
  if (got?.text === undefined) {
    return note("Loading…");
  }
  const rows = got.text.split("\n").filter((l) => l.length > 2).map((l) => {
    const name = l.slice(2);
    const at = dir.replace(/\/+$/, "") + "/" + name;
    const pad = ` style="--d:${depth}"`;
    if (l[0] === "d") {
      const open = v.unfolded.has(at);
      return `<button class="fx fdir"${pad}${act_html({ $: "Tree", path: at })}>${open ? "▾" : "▸"} ${esc(name)}</button>${open ? folder_html(v, at, depth + 1) : ""}`;
    }
    if (l[0] === "s") {
      return `<button class="fx fsec"${pad} title="may hold a secret: opens in your editor, never here"${act_html({ $: "Look", what: { kind: "open", path: at } })}>🔒 ${esc(name)}</button>`;
    }
    const here = v.looked?.kind === "file" && v.looked.path === at ? " here" : "";
    return `<button class="fx${here}"${pad}${act_html({ $: "Look", what: { kind: "file", path: at } })}>${esc(name)}</button>`;
  });
  return rows.join("") || note("(empty)");
}

// a file drawn as its kind asks: Markdown rendered (Html.block_html
// escapes it), HTML in a frame sandboxed with nothing allowed (no
// scripts, an origin of its own: it can't reach Legion's session; the
// page's CSP still applies), code colored (Hl.ts); Source: its lines
// line: the one asked for, marked (id L<n>: main.ts scrolls to it); a
// rendered kind is shown as its source for it
function file_html(path: string, text: string, asked: boolean, line: number | null): string {
  const source = asked || line !== null;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const kind = ["md", "markdown"].includes(ext) ? "md" : ["html", "htm"].includes(ext) ? "html" : null;
  const toggle = kind === null ? "" : `<button class="pbtn"${act_html({ $: "Source", on: !source })}>${source ? (kind === "md" ? "Rendered" : "Preview") : "Source"}</button>`;
  if (kind === "md" && !source) {
    return `${toggle}<div class="msg fmd">${md_parse(text).map(block_html).join("")}</div>`;
  }
  if (kind === "html" && !source) {
    return `${toggle}<iframe class="fprev" sandbox="" srcdoc="${esc(text)}"></iframe>`;
  }
  const lang = hl_lang(path);
  const lines = lang === null ? text.replace(/\n$/, "").split("\n").map(esc) : hl_lines(text.replace(/\n$/, ""), lang);
  const row = (l: string, k: number) => k + 1 === line ? `<span class="hit" id="L${k + 1}"><span class="ln">${k + 1}</span>${l}</span>` : `<span class="ln">${k + 1}</span>${l}`;
  return `${toggle}<pre class="code">${lines.map(row).join("\n")}</pre>`;
}

function shown_html(looked: View.Looked | null, source: boolean, at: number | null): string {
  if (looked === null) {
    return `<p class="meta">Pick a file, or a git view.</p>`;
  }
  if (looked.error !== undefined) {
    return `<p class="meta">${esc(looked.error)}</p>`;
  }
  if (looked.kind === "file") {
    return file_html(looked.path ?? "", looked.text ?? "", source, at);
  }
  const lines = (looked.text ?? "").replace(/\n$/, "").split("\n");
  const repo = looked.path ?? "@home";
  const line = (l: string) => {
    const sha = looked.op === "log" ? /^([0-9a-f]{7,40})\b/.exec(l)?.[1] : undefined;
    if (sha !== undefined) {
      return `<button class="sha"${act_html({ $: "Look", what: { kind: "git", repo, op: "show", rev: sha } })}>${esc(sha)}</button>${esc(l.slice(sha.length))}`;
    }
    const cls = l.startsWith("@@") ? "hunk" : l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : "";
    return cls === "" ? esc(l) : `<span class="${cls}">${esc(l)}</span>`;
  };
  return `<pre class="code git">${lines.map(line).join("\n")}</pre>`;
}

// the Friday drafting routine (Cockpit.ts, the terminal offers it too)
export const TIMESHEET_ROUTINE = Cockpit.TIMESHEET_ROUTINE;

// the Timesheet page (K5, RED ZONE): the drafts by day, newest first, each
// day's hours; each draft's project, task, hours, notes and why, a Drop
// while unsent; Submit sends exactly those not sent nor sending (the
// user's act, to one device); sent ones with Harvest's id, failed ones why
// Todo
// ====

// what agents need the user to do (Tools.assign), oldest first: each its
// text, who filed it and when, Done (its agent hears it) and Drop
export function todo_html(v: View.View): string[] {
  const all = v.assigned ?? [];
  const head = `<div class="phead"><h2>Todo</h2><p class="meta">What only you can do, put here by your agents: tick it Done and its agent hears it</p></div>`;
  if (all.length === 0) {
    return [head, `<p class="meta">${esc(Cockpit.TODO_NONE)}</p>`];
  }
  const row = (a: View.Assignment) => `<div class="trow todo"><span class="n">${esc(a.text)}</span><span class="meta why">by ${esc(Cockpit.todo_who(a))} · ${esc(minute(a.date))}</span>`
    + `<button class="pbtn go"${act_html({ $: "Assignment", n: a.n, done: true })} title="its agent hears it">Done</button><button class="x" title="drop: not yours to do"${act_html({ $: "Assignment", n: a.n, done: false })}>×</button></div>`;
  return [head, `<div class="tday">${all.map(row).join("")}</div>`];
}

// Tracks
// ======

const BOX = { pending: "[ ]", doing: "[>]", done: "[x]" } as const;

// one card per track (Explain.ts): the observer's summary (read-only, when
// written), the agent's checklist and the user's pins with their marks;
// the questions asked and their answers, then the box (a question
// answered here, never in the chat). Every text escaped
export function tracks_html(v: View.View, now: number): string[] {
  const ex = v.explain;
  const ago = ex === null ? "not written yet" : Explain.explain_ago(ex, now);
  const head = `<div class="phead"><h2>Tracks</h2><p class="meta">Each agent's work, what it builds and why, its checklist and your pins · ${esc(ago)}${ex?.error ? " · " + esc(ex.error) : ""}</p></div>`;
  const field = (label: string, text: string) => `<p><b>${label}</b> ${esc(text)}</p>`;
  // security review 4 (E2): the report and each card are the observer's,
  // written from the agents' words: said so (Explain.OBSERVED)
  const observed = `<p class="meta observed">${esc(Explain.OBSERVED)}</p>`;
  const summary = (c: Explain.Card | undefined) => c === undefined || c.title === "" ? `<p class="meta">No summary yet.</p>`
    : `<h4>${esc(c.title)}</h4>${observed}${field("What", c.what)}${field("Why", c.why)}${field("Status", c.status)}${field("Watch", c.watch)}`;
  type TrackView = NonNullable<View.View["tracks"]>[number];
  const button = (label: string, a: View.Act) => ` <button class="pbtn small"${act_html(a)}>${label}</button>`;
  const item = (t: TrackView) => (x: View.Todo & { dropped?: boolean }, i: number) => `<li class="titem ${x.status}"><span class="box">${BOX[x.status]}</span> <span class="t">${i + 1}. ${esc(x.text)}</span>${x.dropped ? ` <span class="meta">dropped by you</span>` : ""}`
    + `${t.editable && !x.dropped ? button("Drop", { $: "Track", name: t.name, op: "drop", i: i + 1, was: x.text }) : ""}</li>`;
  const pin = (t: TrackView) => (p: View.Mine, k: number) => `<li class="titem pin ${p.status}"><span class="box">${BOX[p.status]}</span> <span class="t">#${p.n} ${esc(p.text)}</span> <span class="meta">you${p.from === undefined ? "" : " · edited from «" + esc(p.from) + "»"}</span>`
    + `${t.editable && k > 0 ? button("Up", { $: "Track", name: t.name, op: "move", n: p.n, to: k }) : ""}${t.editable && k < t.pins.length - 1 ? button("Down", { $: "Track", name: t.name, op: "move", n: p.n, to: k + 2 }) : ""}`
    + `${t.editable || t.orphaned ? button("Drop", { $: "Track", name: t.name, op: "drop", n: p.n }) : ""}</li>`;
  // an editable track's box: text alone pins a new item; with #n (a pin)
  // or i (the agent's item i) it edits that one (Cockpit.tracks_cmd). Kept
  // by the track's name, not its place: a track gone before it must not
  // hand what is typed to the next one (main.ts typing)
  const add = (t: TrackView) => !t.editable ? "" : `<form class="tadd" data-track="${esc(t.name)}"><input name="ref" data-keep="tref:${esc(t.name)}" size="4" maxlength="4" placeholder="#n / i" aria-label="the item to edit (none: a new one)" autocomplete="off"><input name="text" data-keep="ttext:${esc(t.name)}" maxlength="${Explain.PIN_TEXT}" placeholder="Pin an item for ${esc(t.name)}, or edit one" aria-label="the item's text" autocomplete="off"></form>`;
  const track = (t: TrackView) => {
    const marks = [t.orphaned ? "agent gone: read-only" : t.editable ? "" : "read-only", t.queued ? "queued, agent idle" : ""].filter((x) => x !== "").map((x) => `<span class="meta">${esc(x)}</span>`).join(" ");
    return `<div class="track"><h4>${esc(t.name)}${t.title === undefined ? "" : " · " + esc(t.title)} ${marks}</h4><ul class="tlist">${t.items.map(item(t)).join("")}${t.pins.map(pin(t)).join("")}</ul>${add(t)}</div>`;
  };
  // the tracks by theme (Explain.explain_assign; none: the track's own
  // name), one card each, its tracks under it; the status report on top
  const tracks = v.tracks ?? [];
  const theme_of = (t: TrackView) => ex?.themes?.[t.name] ?? t.name;
  const theme = (name: string) => `<section class="xcard theme"><h3>${esc(name)}</h3>${summary(ex?.cards.find((c) => c.track === name))}${tracks.filter((t) => theme_of(t) === name).map(track).join("")}</section>`;
  const report = ex?.report ? `<section class="xreport"><h3>Status report</h3>${observed}<p>${esc(ex.report.text)}</p><p class="meta">${esc(minute(new Date(ex.report.at).toISOString()))} UTC</p></section>` : "";
  // one element per entry (main.ts markup keeps an entry's first element)
  const cards = tracks.length === 0 ? [`<p class="meta">${esc(Cockpit.TRACKS_NONE)}</p>`] : [...(report === "" ? [] : [report]), `<div class="xcards">${[...new Set(tracks.map(theme_of))].map(theme).join("")}</div>`];
  const qa = (ex?.qa ?? []).map((x) => `<div class="xq">${esc(x.q)}</div><div class="xa">${esc(x.a)}</div>`).join("");
  const asking = ex?.asking ? `<div class="xq">${esc(ex.asking)}</div><p class="meta xa">answering…</p>` : "";
  const form = `<form class="xask"><input name="q" data-keep="explain" maxlength="${Explain.Q}" placeholder="Ask about what the crew is building (answered here, not in the chat)" aria-label="ask about it" autocomplete="off"></form>`;
  return [head, ...cards, `<section class="xqa"><h3>Ask about it</h3>${qa}${asking}${form}</section>`];
}

// Home's Tracks app: its tracks, or what it is for
function tracks_line(v: View.View): string {
  const n = (v.tracks ?? []).length;
  return n === 0 ? "each agent's work, and why" : n + (n === 1 ? " track" : " tracks");
}

// when a routine runs next, as its card and the Timesheet tab say it: the
// weekday and the date (user's report 2026-11-27: "next Fri 09:00" read as
// today when it was a week on)
export function when_at(ms: number): string {
  return new Date(ms).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// the Timesheet tab's routine: not kept, Draft weekly adds it; kept, when
// it drafts next and a Draft now that runs it (user's report 2026-11-27:
// once added, the tab had no button, and adding it ran nothing)
function sheet_routine(v: View.View, now: number): string {
  const r = (v.routines ?? []).find((x) => x.name === TIMESHEET_ROUTINE.name);
  if (r === undefined) {
    return `<button class="pbtn"${act_html({ $: "Routine", op: "add", routine: TIMESHEET_ROUTINE })} title="a worker drafts the week on Friday mornings; you submit">Draft weekly, Fridays at 09:00</button>`;
  }
  const next = Routines.routine_next(r, now);
  const when = !r.on ? "the weekly draft is off (the Routines page turns it on)" : next === null ? "" : "next draft " + when_at(next);
  const run = r.when.$ === "review" ? "" : `<button class="pbtn"${act_html({ $: "Routine", op: "run", n: r.id })} title="a worker drafts this week now; you submit">Draft now</button>`;
  return `${run}<span class="meta">${esc(when)}</span>`;
}

export function timesheet_html(v: View.View, now = Date.now()): string[] {
  const drafts = v.drafts ?? [];
  const open = drafts.filter((d) => d.state === "draft" || d.state === "failed").map((d) => d.n);
  const submit = open.length === 0 ? "" : `<button class="pbtn go"${act_html({ $: "Timesheet", op: "submit", ns: open })} title="posts them to Harvest from your device">Submit ${open.length} to Harvest</button>`;
  const head = `<div class="phead"><h2>Timesheet</h2><p class="meta">Drafts for Harvest: nothing is sent until you submit</p>${submit}${sheet_routine(v, now)}</div>`;
  if (drafts.length === 0) {
    return [head, `<p class="meta">No drafts yet. Agents draft with the timesheet tool (they need legion harvest-login on your device): ask in the chat, or add the routine.</p>`];
  }
  const days = [...new Set(drafts.map((d) => d.date))].sort().reverse();
  const row = (d: View.Draft) => {
    const state = d.state === "sent" ? `<span class="tag ok">Harvest #${esc(String(d.harvest ?? ""))}</span>`
      : d.state === "failed" ? `<span class="tag bad">${esc(d.error ?? "failed")}</span>`
      : d.state === "sending" ? `<span class="tag">sending</span>`
      : `<button class="x" title="drop"${act_html({ $: "Timesheet", op: "drop", ns: [d.n] })}>×</button>`;
    return `<div class="trow ${esc(d.state)}"><span class="h">${esc(String(d.hours))} h</span><span class="p">${esc(d.project)} · ${esc(d.task)}</span><span class="n">${esc(d.notes)}</span><span class="meta why">${esc(d.why)} · by ${esc(d.by)}</span>${state}</div>`;
  };
  const body = days.map((day) => {
    const of = drafts.filter((d) => d.date === day);
    const total = Math.round(of.reduce((t, d) => t + d.hours, 0) * 100) / 100;
    return `<div class="tday"><h3>${esc(day)} <span class="meta">${total} h</span></h3>${of.map(row).join("")}</div>`;
  }).join("");
  return [head, body];
}

// the Memory page: the search box (main.ts sends it) and its hits, the
// pins, and the map of the tree, read-only: a line, the n messages from
// id summarized, opens into the two it was made from (the server's zoom,
// as the chat's blocks), down to the messages; a message's, or a hit's or
// a pin's, is a jump to it in the chat (View's Seek)
export function memory_html(v: View.View): string[] {
  const head = `<div class="phead"><h2>Memory</h2><p class="meta">What Legion remembers: search it, pin what every call should see whole, walk its tree</p></div>`;
  const form = `<form class="msearch"><input name="q" maxlength="${FIND}" value="${esc(v.recall?.q ?? "")}" placeholder="Search your chat, every message word for word" aria-label="search your chat" autocomplete="off"></form>`;
  const notes = v.notebook ?? [];
  return [head, form + hits_html(v.recall), directives_html(notes.find((n) => n.name === Directives.NAME)), pins_html(v.pins ?? []), notes_html(notes.filter((n) => n.name !== Directives.NAME)), map_html(v)];
}

// Standing directives
// -------------------
// Legion's standing orders: the note Directives.NAME, a line each (its
// "- " lines), listed on the Memory page (user's ask 2026-11-27), each an
// edit box as the Notes' (2026-11-28: a long one shows whole; emptied, it
// drops) and a Delete, then an Add box. main.ts
// (directive_edit) saves the whole note through the Note act, as the
// Notes section's Edit; only Legion makes a note (Chat.noted), so with
// none kept there's nothing to add to

const BULLET = /^- /;

// the note's directives: its "- " lines, their text
export function directive_lines(text: string): string[] {
  return text.split("\n").filter((l) => BULLET.test(l)).map((l) => l.slice(2));
}

// the note's text with one directive edited (emptied: dropped), dropped
// or added (after the last); one line each; the other lines kept as
// they are; an edit of no line, or an empty add, changes nothing
export type DirectiveOp = { n: number; text: string } | { n: number; drop: true } | { add: string };
export function directives_edit(text: string, op: DirectiveOp): string {
  const lines = text.split("\n");
  const at = lines.flatMap((l, k) => (BULLET.test(l) ? [k] : []));
  const one = (t: string) => t.replace(/\s+/g, " ").trim();
  if ("add" in op) {
    const t = one(op.add);
    if (t === "") {
      return text;
    }
    if (at.length === 0) {
      return (text.trim() === "" ? "" : text.replace(/\n*$/, "\n")) + "- " + t + "\n";
    }
    lines.splice(at[at.length - 1] + 1, 0, "- " + t);
    return lines.join("\n");
  }
  const k = at[op.n];
  if (k === undefined) {
    return text;
  }
  const t = "drop" in op ? "" : one(op.text);
  if (t === "") {
    lines.splice(k, 1);
  } else {
    lines[k] = "- " + t;
  }
  return lines.join("\n");
}

function directives_html(note: Note | undefined): string {
  const head = `<h3>Standing directives</h3><p class="meta">The orders Legion keeps for every turn, and its checker holds it to: edit, delete or add one.</p>`;
  if (note === undefined) {
    return `<section class="mdirs">${head}<p class="meta">None kept yet: tell Legion in the chat to keep one as a standing directive.</p></section>`;
  }
  const rows = directive_lines(note.text).map((d, k) => `<form class="mdir" data-n="${k}"><textarea name="d" data-keep="dir-${k}" rows="3" aria-label="directive ${k + 1}">${esc(d)}</textarea>`
    + `<div class="acts"><button type="submit" class="pbtn">Save</button><button type="submit" name="drop" value="1" class="pbtn">Delete</button></div></form>`).join("");
  const add = `<form class="mdir-add"><textarea name="d" data-keep="dir-add" rows="2" placeholder="A new standing directive" aria-label="a new standing directive"></textarea><div class="acts"><button type="submit" class="pbtn">Add</button></div></form>`;
  return `<section class="mdirs">${head}${rows || `<p class="meta">No directives in the note.</p>`}${add}</section>`;
}

// a text escaped, the first match of q in it marked
function marked(text: string, q: string): string {
  const at = q === "" ? -1 : text.toLowerCase().indexOf(q.toLowerCase());
  return at < 0 ? esc(text) : esc(text.slice(0, at)) + "<mark>" + esc(text.slice(at, at + q.length)) + "</mark>" + esc(text.slice(at + q.length));
}

function recall_html(h: View.Hit, q: string): string {
  return `<button class="mhit"${act_html({ $: "Seek", id: h.i })} title="show it in the chat"><span class="meta">#${h.i} · ${esc(minute(h.date))} · ${esc(h.kind)}</span> ${marked(h.text, q)}</button>`;
}

function hits_html(found: View.Recall | null): string {
  if (found === null) {
    return "";
  }
  if (found.hits === null) {
    return `<p class="meta">Searching…</p>`;
  }
  if (found.hits.length === 0) {
    return `<p class="meta">No message has “${esc(found.q)}”.</p>`;
  }
  const more = found.more ? `<p class="meta">The newest ${FOUND} shown: search for more words to reach older ones.</p>` : "";
  return `<div class="mhits">${found.hits.map((h) => recall_html(h, found.q)).join("")}${more}</div>`;
}

function pins_html(pins: View.Pin[]): string {
  const kb = (pins.reduce((t, p) => t + p.size, 0) / 1000).toFixed(1);
  const head = `<h3>Pinned <span class="meta">${pins.length} of ${PINS} · ${kb} of ${PINNED / 1000} KB</span></h3>`;
  const rows = pins.map((p) => `<div class="mpin">${recall_html(p, "")}<button class="x" title="unpin"${act_html({ $: "Pin", i: p.i })}>×</button></div>`).join("");
  return `<section class="mpins">${head}${rows || `<p class="meta">Nothing pinned. A message's 📌 in the chat pins it: every call then sees it whole, however old.</p>`}</section>`;
}

// Legion's notes (Notes.ts), each an edit box: Edit saves its text (main.ts
// note_edit), Drop drops it; untrusted text, so all of it escaped
function notes_html(notes: Note[]): string {
  const head = `<h3>Notes</h3><p class="meta">What Legion keeps across runs and reads at each call: edit or drop any.</p>`;
  const rows = notes.map((n) => `<form class="mnote" data-note="${esc(n.name)}"><b>${esc(n.name)}</b> <span class="meta">${esc(n.line)}</span>`
    + `<textarea data-keep="note-${esc(n.name)}" rows="3" aria-label="the note's text">${esc(n.text)}</textarea>`
    + `<div class="acts"><button type="submit" class="pbtn">Edit</button><button type="button" class="pbtn"${act_html({ $: "Note", name: n.name, drop: true })}>Drop</button></div></form>`).join("");
  return `<section class="mnotes">${head}${rows || `<p class="meta">No notes yet.</p>`}</section>`;
}

function map_html(v: View.View): string {
  const lines = v.roots === null ? `<p class="meta">Loading…</p>` : v.roots.map((part) => line_html(v, part, 0)).join("") || `<p class="meta">No messages yet.</p>`;
  return `<section class="mmap"><h3>Map <span class="meta">the tree, oldest first</span></h3>${lines}</section>`;
}

function line_html(v: View.View, [id, n]: View.Part, depth: number): string {
  const pad = ` style="--d:${depth}"`;
  if (n === 1) {
    const e = v.whole.get(id);
    const when = e?.date === undefined ? "" : " · " + esc(minute(e.date));
    return `<button class="mx m0"${pad}${act_html({ $: "Seek", id })} title="show it in the chat"><span class="meta">#${id}${when}</span> ${esc(e === undefined ? "…" : e.kind + ": " + e.text.slice(0, SHOWN))}</button>`;
  }
  const open = v.mapped.has(id + "+" + n);
  const node = v.nodes.get(id + "+" + n);
  const when = node?.to ? " · to " + esc(minute(node.to)) : "";
  const row = `<button class="mx"${pad}${act_html({ $: "Map", id, n })}>${open ? "▾" : "▸"} <span class="meta">#${id}–${id + n - 1} · ${n}x${when}</span> ${esc(node?.text ?? "(not summarized yet)")}</button>`;
  return row + (open ? line_html(v, [id, n / 2], depth + 1) + line_html(v, [id + n / 2, n / 2], depth + 1) : "");
}
