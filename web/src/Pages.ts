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
