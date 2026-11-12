// Html
// ====
// What View.ts draws and Md.ts's tokens, as HTML, every text escaped, one
// element per row, knob or tab; and the account page's parts. A click's
// effect is in the markup: `data-act`, the View.Act it makes;
// `data-copy`, what Copy copies; `data-usd`, the credit it buys
// (main.ts), so `credit_html` works wherever it is put.

import * as Call from "../../Call.ts";
import * as Md from "../../Md.ts";
import * as Theme from "../../Theme.ts";
import type { Mode as Perm } from "../../Modes.ts";
import * as View from "../../View.ts";

// Constants
// =========

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

// a user's message past TALL chars (a line counts 80 or more: a paste)
// shows its head; its `details` unfolds it (style.css)
const TALL = 4000;

// the Copy button's icons: two sheets, and a check once copied
export const SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
export const CHECK  = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;

// a diff line's class, by its mark
const MARKS: Record<Md.Line["s"], string> = { " ": "", "-": "del", "+": "add" };

// Show
// ====

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

function act_html(act: View.Act): string {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}

function copy_html(text: string): string {
  return `<button class="copy" data-copy="${esc(text)}" title="Copy">${SHEETS}</button>`;
}

// a row's markup, made once: a known message's rows are kept (View's
// whole_rows)
const MADE = new WeakMap<View.Row, string>();

export function row_html(row: View.Row): string {
  const html = MADE.get(row) ?? row_make(row);
  MADE.set(row, html);
  return html;
}

function row_make(row: View.Row): string {
  switch (row.$) {
    case "Sum": {
      const open = act_html({ $: "Open", id: row.id, n: row.n });
      const text = row.call === null ? esc(row.text) : head_html(row.call, Call.call_line(row.call), "");
      return `<div class="block"${open} data-a="${row.id}"><span class="lv">${row.n}x</span><div>${text}</div></div>`;
    }
    case "Box": { // a message open (1x) looks as it does whole, its "fold" pill beside Copy
      const shut = act_html({ $: "Shut", id: row.id, n: row.n });
      const one  = row.n === 1 ? " one" : "";
      const rows = row.rows.map(row_html).join("");
      return `<div class="open${one}" data-a="${row.id}"><button class="fold"${shut}>${esc(row.text)}</button>${rows}</div>`;
    }
    case "Msg": {
      const at = row.id === null ? "" : ` data-a="${row.id}"`;
      const copy = copy_html(row.call === null ? row.text : Call.call_text(row.call));
      const body = row.call === null ? row.body.map(block_html).join("") : call_html(row.call);
      const pics = images_html(row.images);
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split("\n").length > TALL;
      const fold = tall ? `<div class="clip">${body}</div><details class="more"><summary></summary></details>` : body;
      const who = row.who === "" ? "" : ` data-who="${esc(row.who)}"`;
      return `<div class="msg ${row.kind}"${at}${who}>${copy}${fold}${pics}</div>`;
    }
    case "Cap": {
      return `<p class="cap">${esc(row.text)}</p>`;
    }
  }
}

// a tool call: its icon, verb, head and device, over a code block for
// each other value
function call_html(c: Call.Call): string {
  return head_html(c, c.head, c.device) + c.blocks.map(block_html).join("");
}

// a call's head: its emoji (Theme.TOOL) and name, then text ("" device:
// none shown)
function head_html(c: Call.Call, text: string, device: string): string {
  const icon  = `<span class="ic">${Theme.tool_glyph(c.name)}</span>`;
  const verb  = c.name === "" ? "" : `<b>${esc(c.name)}</b> `;
  const where = device === "" ? "" : `<span class="on">· ${esc(device)}</span>`;
  return `<p class="call">${where}${icon}${verb}${esc(text)}</p>`;
}

function images_html(names: string[]): string {
  const pics = names.map((name) => {
    const url = "/image/" + esc(name);
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${esc(name)}" loading="lazy"></a>`;
  });
  return names.length === 0 ? "" : `<div class="pics">${pics.join("")}</div>`;
}

// the line over the message box: fold/unfold (none on an agent's page),
// a rule, then the pick's knobs
export function pick_html(fold: string | null, on: boolean, knobs: View.Knob[]): string[] {
  const parts = knobs.map((k) => `<button title="${esc(k.hint)}"${act_html({ $: "Move", move: k.move })}>${esc(k.text)}</button>`);
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  return [...all, `<span class="rule"></span>`, ...parts.flatMap((part, i) => (i === 0 ? [part] : [`<span class="dot">·</span>`, part]))];
}

// Crew view
// ---------

// an agent's buttons by its status: at work, stop; asking, approve and
// deny; done, failed or stopped, dismiss
function acts_html(c: View.Crew): string {
  const x = (label: string, title: string, a: View.Act, cls = "") => `<button class="x${cls}" title="${title}"${act_html(a)}>${label}</button>`;
  switch (c.status) {
    case "working":
    case "waiting": return x("■", "stop", { $: "Stop", name: c.name });
    case "asking":  return x("✓", "approve", { $: "Approve", name: c.name, yes: true }, " yes") + x("×", "deny", { $: "Approve", name: c.name, yes: false });
    default:        return x("×", "dismiss", { $: "Dismiss", name: c.name });
  }
}

// an agent's label: its title (its goal) as the main line, else its
// name; its repos as chips; and what goes before what it is (its name,
// when the title stands for it)
function who_html(c: View.Crew, chips = true): string {
  return `<b>${esc(c.title ?? c.name)}</b>${chips ? repos_html(c) : ""}`;
}
function repos_html(c: View.Crew): string {
  return (c.repos ?? []).map((r) => `<span class="repo">${esc(r)}</span>`).join("");
}
function also(c: View.Crew): string {
  return c.title === undefined ? "" : c.name + " · ";
}

// the link that puts an agent in focus (#crew/<name>)
function focus_href(name: string): string {
  return ` href="${esc(View.view_hash("crew", name))}"`;
}

// the Crew tree (View.view_tree): per agent a caret (managers: fold or
// open), its link (mark, name, tier, model; its roll-up or how long
// ago), its actions
export function tree_html(v: View.View, now: number): string[] {
  return View.view_tree(v, now).map((r) => {
    const here = v.page?.name === r.name ? " here" : "";
    const caret = r.kids === 0 ? `<span class="caret"></span>` : `<button class="caret" title="${r.open ? "fold" : "open"}"${act_html({ $: "Expand", name: r.name })}>${r.open ? "▾" : "▸"}</button>`;
    const ago = r.text.slice(r.text.lastIndexOf(" · ") + 3);
    const info = r.kids > 0 && !r.open ? r.rollup : r.tier + " · " + r.model + " · " + ago;
    const what = `<span class="st">${View.CREW[r.status]}</span>${who_html(r, false)}<span class="meta">${esc(info)}</span>`;
    const repos = (r.repos ?? []).length === 0 ? "" : " · " + r.repos!.join(", ");
    const title = esc(r.name + " · " + r.tier + " · " + r.model + " · " + r.status + " · " + ago + repos);
    return `<div class="node d${Math.min(r.depth, 4)} ${r.status}${here}">${caret}<a${focus_href(r.name)} title="${title}">${what}</a>${acts_html(r)}${line_html(v, r)}</div>`;
  });
}

// an agent's activity line, by its pulse: at work, what it does now;
// else its report's last line (none: nothing)
function line_html(v: View.View, c: View.Crew): string {
  const p = v.pulses.get(c.name);
  const at = c.status === "working" || c.status === "waiting" || c.status === "asking";
  const text = p === undefined ? "" : at ? p.act || p.last : p.last || p.act;
  return text === "" ? "" : `<div class="line">${esc(text)}</div>`;
}

// the Crew grid (View.view_tiles), no agent in focus: per tile its head
// (mark, name, what it is) and actions, a dot per agent under it (a link
// to it), its roll-up and activity line, and a box that tells it
export function grid_html(v: View.View, now: number): string[] {
  return View.view_tiles(v, now).map((t) => {
    const dots = t.dots.map((d) => `<a class="dot ${d.status}"${focus_href(d.name)} title="${esc(d.name + " · " + d.status)}"></a>`).join("");
    const todo = View.view_todo(t);
    const head = `<a class="head"${focus_href(t.name)}><span class="st">${View.CREW[t.status]}</span>${who_html(t, false)}${todo === "" ? "" : `<span class="todo">${esc(todo)}</span>`}<span class="meta">${esc(also(t) + t.tier + " · " + t.model)}</span></a>`;
    const repos = repos_html(t);
    const roll = t.rollup === "" ? "" : `<div class="roll">${esc(t.rollup)}</div>`;
    const tell = `<form class="tell" data-tell="${esc(t.name)}"><input placeholder="Tell ${esc(t.name)}…" aria-label="tell ${esc(t.name)}"></form>`;
    return `<div class="tile ${t.status}"><div class="top">${head}${acts_html(t)}</div>${repos === "" ? "" : `<div class="repos">${repos}</div>`}${dots === "" ? "" : `<div class="dots">${dots}</div>`}${roll}${line_html(v, t)}${tell}</div>`;
  });
}

// the lane of the agent in focus (View.view_lane): a mark per event at
// its time, a message's a button that jumps to it (data-seek: its row in
// the log); none in focus or no marks: nothing
export function lane_html(v: View.View, now: number): string {
  const marks = View.view_lane(v, now);
  if (marks.length === 0) {
    return "";
  }
  const pct = (at: number) => Math.round(at * 1000) / 10 + "%";
  const mk = marks.map((m) => {
    const attrs = `class="mk ${m.kind}" style="left:${pct(m.at)}" title="${esc(new Date(m.t).toLocaleTimeString() + " · " + m.label)}"`;
    return m.k === null ? `<span ${attrs}></span>` : `<button ${attrs} data-seek="${m.k}"></button>`;
  });
  return `<div class="lane">${mk.join("")}</div>`;
}

// what needs the person (View.view_needs), each with what it waits on
// and its buttons
export function needs_html(v: View.View): string[] {
  const plan = v.plan ? [`<div class="need question"><a href="#chat" data-qs-open><b>Plan ready</b> <span class="meta">waiting for your approval</span></a></div>`] : [];
  const calls = (v.calls ?? []).map((c) => `<div class="need asking"><a href="#chat" data-qs-open><b>${esc(c.who)} wants to run</b> <span class="meta">${esc(c.what.slice(0, 80))}</span></a></div>`);
  const asked = [...plan, ...calls, ...View.view_questions(v).map((q) => `<div class="need question"><a href="#chat" data-qs-open><b>? ${esc(q.text.split("\n")[0]!)}</b> <span class="meta">question ${q.id}</span></a></div>`)];
  return [...asked, ...View.view_needs(v).map((c) => {
    const why = c.status === "asking" ? "asks to start" : "failed";
    const name = c.title === undefined ? "" : ` <span class="meta">${esc(c.name)}</span>`;
    return `<div class="need ${c.status}"><a${focus_href(c.name)}><b>${esc(c.title ?? c.name)}</b>${name} ${why}</a>${acts_html(c)}</div>`;
  })];
}

// what waits for the person besides questions, first in the pane: the
// orchestrator's plan (approve into auto or full; send back with
// feedback), then each call auto mode's reviewer couldn't check (run it,
// or not); none: nothing
export function waiting_html(v: View.View): string[] {
  const b = (label: string, a: View.Act, cls = "qo") => `<button class="${cls}"${act_html(a)}>${label}</button>`;
  const plan = v.plan ? [`<div class="q plan"><div class="qh"><b>Plan</b><span class="meta">${esc(new Date(v.plan.date).toLocaleString())}</span></div><div class="qt">${esc(v.plan.text)}</div><div class="qos">${b("Approve: auto", { $: "Verdict", yes: true, mode: "auto" })}${b("Approve: full", { $: "Verdict", yes: true, mode: "full" })}</div><form class="qa" data-verdict><input placeholder="Send it back: what to change…" aria-label="send the plan back with feedback"></form></div>`] : [];
  const calls = (v.calls ?? []).map((c) => `<div class="q call"><div class="qh"><b>${c.id}</b><span class="meta">${esc(c.who)} wants to run (auto mode's reviewer couldn't check it)</span></div><div class="qt">${esc(c.what)}</div><div class="qos">${b("Run it", { $: "Consent", n: c.id, yes: true })}${b("Refuse", { $: "Consent", n: c.id, yes: false })}</div></div>`);
  return [...plan, ...calls];
}

// the question backlog (View.view_questions), beside the chat: each the
// orchestrator's question (its lines kept), its offered answers as
// buttons, a box to answer it, a dismiss; none: nothing
export function questions_html(v: View.View): string[] {
  return View.view_questions(v).map((q) => {
    const quick = (q.options ?? []).map((o) => `<button class="qo"${act_html({ $: "Answer", q: q.id, text: o })}>${esc(o)}</button>`).join("");
    const head = `<div class="qh"><b>${q.id}</b><span class="meta">${esc(new Date(q.date).toLocaleString())}</span><button class="x" title="dismiss"${act_html({ $: "Drop", q: q.id })}>×</button></div>`;
    const box = `<form class="qa" data-q="${q.id}"><input placeholder="Answer…" aria-label="answer question ${q.id}"></form>`;
    return `<div class="q">${head}<div class="qt">${esc(q.text)}</div>${quick === "" ? "" : `<div class="qos">${quick}</div>`}${box}</div>`;
  });
}

// the agent in focus, over its session (the log): its name, what it
// is, how it is, its actions; none: Unii's chat. One the crew no longer
// tells (dismissed) shows its name only
export function focus_html(v: View.View): string {
  const name = v.page?.name ?? null;
  if (name === null) {
    return `<div class="focus"><b>${esc(View.MAIN)}</b> <span class="meta">orchestrator · ${v.busy ? "working" : "idle"} · type to tell it</span></div>`;
  }
  const c = v.crew.find((x) => x.name === name);
  if (c === undefined) {
    return `<div class="focus"><b>${esc(name)}</b></div>`;
  }
  const todo = (c.todo ?? []).length === 0 ? "" : `<ol class="todo">${c.todo!.map((x) => `<li class="${esc(x.status)}">${esc(x.text)}</li>`).join("")}</ol>`;
  return `<div class="focus ${c.status}">${who_html(c)} <span class="meta">${esc(also(c) + c.tier + " · " + c.model + " · " + c.status)} · type to tell it</span>${acts_html(c)}${todo}</div>`;
}

// Chat | Crew, the one shown marked; the pill (View.view_pill) on Crew,
// marked when someone needs the person
// and the questions open (a button showing or hiding their pane)
// and the permission mode's chip (a click: the next)
export function mode_html(mode: View.Mode, pill: string, asked = 0, perm?: Perm): string[] {
  const here = (m: View.Mode) => (m === mode ? ` class="here"` : "");
  const tag = pill === "" ? "" : ` <span class="pill${pill.includes("need you") ? " need" : ""}">${esc(pill)}</span>`;
  const qs = asked === 0 ? [] : [`<button class="qs" data-qs title="your questions">? ${asked}</button>`];
  const chip = perm === undefined ? [] : [`<button class="perm ${perm}" title="the mode: Shift+Tab in the box cycles it"${act_html({ $: "Mode" })}>${perm} mode</button>`];
  return [`<a href="#chat"${here("chat")}>Chat</a>`, `<a href="#crew"${here("crew")}>Crew${tag}</a>`, ...chip, ...qs];
}

export function tabs_html(tabs: View.Tab[]): string[] {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    return `<button${here}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}</button>`;
  });
}

// Account
// =======

// buying credit: a button per amount, then the fine print (in the iOS
// app, the App Store's)
export function credit_html(app: boolean): string {
  const buttons = [10, 25, 50, 100].map((usd) => `<button data-usd="${usd}">$${usd}</button>`).join("");
  return `<div class="credit"><div class="usd">${buttons}</div>${fine_html(app)}</div>`;
}

// what buying credit costs and means, in one line (the terms say the rest)
export function fine_html(app: boolean): string {
  const fee = app ? "Paid at the App Store's price." : "+10% platform fee (min $0.80).";
  return `<p class="fine">${fee} Buying accepts the <a href="/terms.html" target="_blank">terms</a>.</p>`;
}

// the account page (/account): where the server bills, the balance and
// credit to add, the use by day and the purchases; then the account's
// own acts; deleting asks first, in place (main.ts)
export function account_html(a: View.Account, app: boolean): string {
  const tops    = a.topups ?? [];
  const days    = View.account_days(a);
  const balance = a.credits === null ? "" : section_html("Balance", `<p class="big">${View.usd_show(a.credits)}</p>` + credit_html(app));
  const usage   = section_html("Usage", days.length === 0 ? `<p class="sub">Nothing yet.</p>` : table_html("days", ["Day", "Use", "Cost"], days.map((d) => [d.date, d.what, View.cost_show(d.usd)])));
  const buys    = tops.length === 0 ? "" : section_html("Purchases", table_html("buys", View.TOPUP, tops.map(View.topup_cells)));
  const money   = a.bills ? balance + usage + buys : "";
  const item    = (what: string, note: string, act: string) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const closes  = a.bills ? `<p>This also closes your BendAI account (same sign-in). Credit you bought and didn't use goes back to your card.</p>` : "";
  const kill    = `<form class="kill" hidden>${closes}<p>Type <b>${esc(a.name)}</b> to confirm.</p><input name="name" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(a.name)}"><p class="why"></p><div><button type="button" class="chip keep">Cancel</button><button class="chip red" disabled>Delete for good</button></div></form>`;
  const acts    = [
    item(esc(a.name), "", `<button class="chip out">Sign out</button>`),
    item("Export memory", "Chat and account, in one file.", `<a class="chip" href="/export">Download</a>`),
    item("Delete account", "Erases chat and memory for good.", `<button class="chip red del">Delete</button>`),
  ];
  const account = section_html("Sign-in and data", acts.join("") + kill);
  const links   = a.bills ? `<p class="foot"><a href="/pricing" target="_blank">Prices</a> · <a href="/terms.html" target="_blank">Terms</a> · <a href="/privacy.html" target="_blank">Privacy</a> · <a href="mailto:contact@higherorderco.com">Help</a></p>` : "";
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Account</h1>` + money + account + links;
}

// a section of the account page: its title, then its markup
function section_html(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

// a table (cls: its class) of inline markdown cells
function table_html(cls: string, head: string[], rows: string[][]): string {
  const cells = (row: string[], tag: string) => row.map((x) => `<${tag}>${spans_html(Md.span_parse(x))}</${tag}>`).join("");
  const body  = rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("");
  return `<div class="wide ${cls}"><table><tr>${cells(head, "th")}</tr>${body}</table></div>`;
}

export function block_html(b: Md.Block): string {
  switch (b.$) {
    case "Para": {
      return `<p>${b.x.map(spans_html).join("<br>")}</p>`;
    }
    case "Head": {
      const tag = "h" + Math.min(4, b.k + 1);
      return `<${tag}>${spans_html(b.x)}</${tag}>`;
    }
    case "Code": {
      const lang = b.k === "" ? "" : `<span class="lang">${esc(b.k)}</span>`;
      return `<pre>${copy_html(b.x)}${lang}<code>${esc(b.x)}</code></pre>`;
    }
    case "Rule": {
      return "<hr>";
    }
    case "Quot": {
      return `<blockquote>${b.x.map(block_html).join("")}</blockquote>`;
    }
    case "List": {
      const tag = b.k ? "ol" : "ul";
      const items = b.x.map((item) => `<li>${spans_html(item)}</li>`);
      return `<${tag}>${items.join("")}</${tag}>`;
    }
    case "Tabl": {
      const rows = b.x.map((row, i) => {
        const tag = i === 0 ? "th" : "td";
        const cells = row.map((cell) => `<${tag}>${spans_html(cell)}</${tag}>`);
        return `<tr>${cells.join("")}</tr>`;
      });
      return `<table>${rows.join("")}</table>`;
    }
    case "Diff": {
      return diff_html(b.k, b.x);
    }
    case "File": {
      return file_html(b.k, b.n, b.x);
    }
  }
}

// a diff: its file and its lines added and dropped over its lines, each
// its number, its mark and its text (style.css hangs a wrap after the
// number); a ⋯ between hunks
function diff_html(file: string, hunks: Md.Line[][]): string {
  const all   = hunks.flat();
  const nw    = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const adds  = all.filter((l) => l.s === "+").length;
  const dels  = all.filter((l) => l.s === "-").length;
  const head  = `<span class="lang">${esc(file)} <b class="add">+${adds}</b> <b class="del">-${dels}</b></span>`;
  const line  = (l: Md.Line) => `<span class="${MARKS[l.s]}"><i>${l.n}</i>${l.s} ${esc(l.x)}</span>`;
  const lines = hunks.map((h) => h.map(line).join("")).join(`<span class="gap">⋯</span>`);
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${lines}</code></pre>`;
}

// a read's lines: framed as a diff is, the lines shown over them, each
// its number and its text
function file_html(shown: string, from: number, lines: string[]): string {
  const nw   = String(from + lines.length - 1).length;
  const head = `<span class="lang">${esc(shown)}</span>`;
  const body = lines.map((x, k) => `<span class="file"><i>${from + k}</i>${esc(x)}</span>`).join("");
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${body}</code></pre>`;
}

function spans_html(spans: Md.Span[]): string {
  return spans.map(span_html).join("");
}

function span_html(s: Md.Span): string {
  switch (s.$) {
    case "Text": { // the name, in the brand's font
      return esc(s.x).replaceAll("Legion", `<span class="brand">Legion</span>`);
    }
    case "Code": {
      return `<code>${esc(s.x)}</code>`;
    }
    case "Bold": {
      return `<strong>${esc(s.x)}</strong>`;
    }
    case "Ital": {
      return `<em>${esc(s.x)}</em>`;
    }
    case "Link": {
      return `<a href="${esc(s.k)}" target="_blank" rel="noopener">${esc(s.x)}</a>`;
    }
    case "Name": {
      return `<button class="name"${act_html({ $: "Goto", name: s.x })}>[${esc(s.x)}]</button>`;
    }
  }
}
