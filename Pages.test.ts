// Pages test
// ==========
// `bun test Pages.test.ts`. The cockpit's pages as markup
// (web/src/Pages.ts): what each shows, its buttons' acts, every text
// escaped, links only where the inbox has one.

import { expect, test } from "bun:test";
import * as Cockpit from "./Cockpit.ts";
import type * as Inbox from "./Inbox.ts";
import * as Pages from "./web/src/Pages.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const act = (a: object) => JSON.stringify(a).replace(/"/g, "&quot;");

function pr(over: Partial<Inbox.Pr> = {}): Inbox.Pr {
  return {
    repo: "o/r", number: 1, title: "A change", url: "https://github.com/o/r/pull/" + (over.number ?? 1), author: "ann", bot: false,
    updated: new Date(NOW - 3600e3).toISOString(), add: 1, del: 0, files: 1, branch: "b", state: "ready", failing: [], body: "", you: true, ...over,
  };
}
function inbox(over: Partial<Inbox.Inbox> = {}): Inbox.Inbox {
  return { at: NOW, login: "me", reviews: [], mine: [], merged: 0, today: 0, tickets: [], clean: [], notes: [], errors: [], ...over };
}
const ui = (over: Partial<Pages.InboxUi> = {}): Pages.InboxUi => ({ shut: new Set(), cursor: null, picks: new Set(), detail: null, ...over });

test("the inbox: a section per kind, its count, folded when shut; a row's tag by its tone; text escaped", () => {
  const s = Cockpit.inbox_sections(inbox({ mine: [pr({ title: "<b>x</b>", state: "failing", failing: ["ruff"] })] }), [], "", NOW);
  const html = Pages.inbox_html(s, ui()).join("");
  expect(html).toContain('data-fold="mine"');
  expect(html).toContain("Your PRs");
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  expect(html).not.toContain("<b>x</b>");
  expect(html).toContain('class="tag bad">Failing: ruff');
  expect(html).toContain('href="https://github.com/o/r/pull/1"');
  const shut = Pages.inbox_html(s, ui({ shut: new Set(["mine"]) })).join("");
  expect(shut).toContain('class="ibs shut"');
});

test("a row's acts: review a review request, fix a PR that fails; the cursor's row marked; picks ticked", () => {
  const s = Cockpit.inbox_sections(inbox({ reviews: [pr({ number: 5 })], mine: [pr({ number: 6, state: "conflicts" }), pr({ number: 7, state: "ready" })] }), [], "", NOW);
  const html = Pages.inbox_html(s, ui({ cursor: "https://github.com/o/r/pull/5", picks: new Set(["https://github.com/o/r/pull/6"]) })).join("");
  expect(html).toContain(act({ $: "Review", prs: ["https://github.com/o/r/pull/5"], how: "review" }));
  expect(html).toContain(act({ $: "Review", prs: ["https://github.com/o/r/pull/6"], how: "fix" }));
  expect(html).not.toContain(act({ $: "Review", prs: ["https://github.com/o/r/pull/7"], how: "fix" })); // ready: nothing to fix
  expect(html).toMatch(/class="ibr[^"]* here"[^>]*data-row="https:\/\/github.com\/o\/r\/pull\/5"/);
  expect(html).toMatch(/data-pick="https:\/\/github.com\/o\/r\/pull\/6" checked/);
});

test("review requests older than 60 days folded under a count; Jira's note in place of rows", () => {
  const s = Cockpit.inbox_sections(inbox({ reviews: [pr({ number: 1 }), pr({ number: 2, updated: "2026-01-01T00:00:00Z" })], tickets: null, errors: ["acli: <signed out>"] }), [], "", NOW);
  const html = Pages.inbox_html(s, ui()).join("");
  expect(html).toContain("<details class=\"old\"><summary>1 older than 60 days</summary>");
  expect(html).toContain('class="ibnote">acli: &lt;signed out&gt;');
});

test("the details card: a PR's numbers, branch, author, failing checks and body, escaped; no link where none is", () => {
  const s = Cockpit.inbox_sections(inbox({ mine: [pr({ body: "Why <script>", failing: ["unit"], state: "failing", add: 318, del: 74, files: 8 })], clean: [{ repo: "r", path: "/p", branch: null, changes: 1, merged: false }] }), [], "", NOW);
  const html = Pages.inbox_html(s, ui({ detail: "https://github.com/o/r/pull/1" })).join("");
  expect(html).toContain('class="ibd"');
  expect(html).toContain("+318 −74 · 8 files · b · ann");
  expect(html).toContain("Why &lt;script&gt;");
  const clean = html.slice(html.indexOf('data-row="clean:/p"'));
  expect(clean.slice(0, clean.indexOf("</div>"))).not.toContain("href=");
});

test("the picked panel: how many, each one, Review / Fix / Open / Drop picks, the Claude Code option off", () => {
  const s = Cockpit.inbox_sections(inbox({ reviews: [pr({ number: 5 }), pr({ number: 6 })] }), [], "", NOW);
  expect(Pages.picks_html(s, new Set(), false)).toBe("");
  const html = Pages.picks_html(s, new Set(["https://github.com/o/r/pull/5", "https://github.com/o/r/pull/6"]), false);
  expect(html).toContain("2 picked");
  expect(html).toContain(act({ $: "Review", prs: ["https://github.com/o/r/pull/5", "https://github.com/o/r/pull/6"], how: "review" }));
  expect(html).toContain("data-open-picks");
  expect(html).toContain("data-drop-picks");
  expect(html).toContain('<input type="checkbox" data-claude>');
  expect(Pages.picks_html(s, new Set(["https://github.com/o/r/pull/5"]), true)).toContain(act({ $: "Review", prs: ["https://github.com/o/r/pull/5"], how: "review", claude: true }));
});

test("the inbox's head: when read, what changed, refresh, File issue (on Legion's repo, GitHub's own page); not read yet: how to", () => {
  expect(Pages.inbox_head(null, 0)).toContain("No device has read the inbox yet");
  const h = Pages.inbox_head(inbox({ errors: ["gh: <bad>"] }), 3);
  expect(h).toContain("3 changed since you looked");
  expect(h).toContain(act({ $: "Fetch" }));
  expect(h).toContain(`href="${Pages.ISSUES}"`); // Legion's own repo: a bug in the cockpit
  expect(h).toContain("gh: &lt;bad&gt;");
});

// Home (Pages.home_html): the head, the stat cards linking to their pages,
// the agent cards (Go to agent, Archive; Archive all over the done), the
// apps, the activity; text escaped
test("home: greeting, stats, agent cards with their acts, apps, activity", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  v.crew = [
    { name: "A", parent: "main", tier: "worker", model: "m", status: "working", since: NOW - 60e3, title: "review o/r#5 <x>", repos: ["r"], spent: 1 },
    { name: "B", parent: "main", tier: "worker", model: "m", status: "done", since: NOW - 60e3, title: "AO-1 done" },
  ];
  v.inbox = inbox({ notes: [{ kind: "review", title: "Review requested: <y>", repo: "o/r", url: "https://github.com/o/r/pull/1", at: "", unread: true }] });
  const html = Pages.home_html(v, new Date(NOW)).join("");
  expect(html).toContain("Good ");
  expect(html).toContain("1 working");
  expect(html).toContain('href="#inbox"');
  expect(html).toContain("review o/r#5 &lt;x&gt;");
  expect(html).toContain('href="#crew/A"');
  expect(html).toContain("≈$1.00");
  expect(html).toContain(act({ $: "Archive", names: ["B"] }));
  expect(html).not.toContain(act({ $: "Archive", names: ["A"] })); // working: not archived
  expect(html).toContain("Archive all");
  expect(html).toContain("Review requested: &lt;y&gt;");
  expect(html).toContain("data-new-agent");
  expect(html).toContain("data-focus");
});

// the sidebar (Pages.side_html): search or run, the pages (the shown one
// marked, the inbox's count), agents by ticket, spaces (a click filters
// the inbox), Settings, Add machine; the palette's list, its pick marked
test("the sidebar and the palette", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  v.crew = [{ name: "A", parent: "main", tier: "worker", model: "m", status: "working", since: NOW, title: "AO-1 <fix>", repos: ["web"] }];
  v.inbox = inbox({ reviews: [pr()] });
  const side = Pages.side_html(v, "inbox", NOW).join("");
  expect(side).toContain("data-palette");
  expect(side).toContain('href="#inbox" class="here"');
  expect(side).toContain('<span class="n">1</span>');
  expect(side).toContain("AO-1 &lt;fix&gt;");
  expect(side).toContain('href="#crew/A"');
  expect(side).toContain('data-space="web"');
  v.inbox = inbox({ spaces: Array.from({ length: 20 }, (_, k) => "repo" + k) });
  const many = Pages.side_html(v, "home", NOW).join("");
  expect(many.match(/class="sspace"/g)!.length).toBe(Pages.SPACES);
  expect(many).toContain("+9 more");
  expect(side).toContain('data-go="/account"');
  expect(side).toContain("data-add-machine");
  const items = Cockpit.palette(v, "");
  const list = Pages.palette_html(items, 1).join("");
  expect(list).toContain('class="pi here" data-pi="1"');
  expect(list).toContain("AO-1 &lt;fix&gt;");
  expect(Pages.palette_html([], 0).join("")).toContain("Nothing matches");
});

// the team digest (Pages.digest_html): merged by author (most first), each
// author's themes if summarized, else their PRs; open ones; Summarize by
// theme and Refresh; none yet: how
test("the digest: merged by author, themes or PRs, open ones, its acts", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  expect(Pages.digest_html(v).join("")).toContain("No digest yet");
  const d = (n: number, author: string) => ({ repo: "o/r", number: n, title: "T" + n + " <x>", url: "https://github.com/o/r/pull/" + n, author, at: "" });
  v.inbox = inbox({ digest: { repos: ["o/r"], merged: [d(1, "bo"), d(2, "ann"), d(3, "ann")], open: [d(4, "cy")] } });
  expect(Cockpit.digest_groups(v.inbox.digest!.merged).map((g) => [g.author, g.prs.length])).toEqual([["ann", 2], ["bo", 1]]);
  const html = Pages.digest_html(v).join("");
  expect(html.indexOf(">ann<")).toBeLessThan(html.indexOf(">bo<"));
  expect(html).toContain("T2 &lt;x&gt;");
  expect(html).toContain('href="https://github.com/o/r/pull/4"');
  expect(html).toContain(act({ $: "Themes" }));
  expect(html).toContain(act({ $: "Fetch" }));
  v.themes = { ann: ["Login <fixes> (#2, #3)"] };
  const themed = Pages.digest_html(v).join("");
  expect(themed).toContain("Login &lt;fixes&gt; (#2, #3)");
  expect(themed.slice(themed.indexOf(">ann<"), themed.indexOf(">bo<"))).not.toContain("T2 &lt;x&gt;");
});

// Google's pages (RED ZONE draft): Up next on Home (today's and tomorrow's
// events not over, Join for a Meet link); the Transcripts page (the Docs,
// the one picked: its summary, or Summarize; Open full transcript); signed
// out: how to sign in; text escaped
test("Up next and Transcripts", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  const now = new Date(2026, 10, 12, 12, 0);
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  v.inbox = inbox({ errors: ["google: not signed in: legion google-login"], google: null });
  expect(Pages.home_html(v, now).join("")).toContain("legion google-login");
  v.inbox = inbox({ google: {
    events: [
      { id: "a", title: "Done <early>", start: at(12, 9), end: at(12, 10), meet: "", people: 2 },
      { id: "b", title: "Ryan & Jenny <1:1>", start: at(12, 13, 30), end: at(12, 14), meet: "https://meet.google.com/abc", people: 2 },
      { id: "c", title: "Board prep", start: at(13, 10), end: at(13, 11), meet: "", people: 5 },
    ],
    docs: [{ id: "doc_1", title: "Standup <x> - Transcript", at: "2026-11-11T10:00:00Z", url: "https://docs.google.com/document/d/doc_1" }],
  } });
  expect(Cockpit.up_next(v, now.getTime()).map((e) => [e.title, e.day, e.time])).toEqual([["Ryan & Jenny <1:1>", "today", "13:30"], ["Board prep", "tomorrow", "10:00"]]);
  const home = Pages.home_html(v, now).join("");
  expect(home).toContain("Ryan &amp; Jenny &lt;1:1&gt;");
  expect(home).toContain('href="https://meet.google.com/abc"');
  expect(home).not.toContain("Done &lt;early&gt;");
  const list = Pages.transcripts_html(v, null, new Set()).join("");
  expect(list).toContain("Standup &lt;x&gt; - Transcript");
  expect(list).toContain('data-doc="doc_1"');
  const picked = Pages.transcripts_html(v, "doc_1", new Set()).join("");
  expect(picked).toContain(act({ $: "Transcript", id: "doc_1" }));
  expect(picked).toContain('href="https://docs.google.com/document/d/doc_1"');
  expect(Pages.transcripts_html(v, "doc_1", new Set(["doc_1"])).join("")).toContain("Reading and summarizing");
  v.summaries.set("doc_1", { title: "Standup", text: "## Decided\n- ship <Friday>", at: 1 });
  const done = Pages.transcripts_html(v, "doc_1", new Set()).join("");
  expect(done).toContain("ship &lt;Friday&gt;");
  expect(done).not.toContain(act({ $: "Transcript", id: "doc_1" }));
  expect(View.view_route("#transcripts")).toEqual({ mode: "transcripts", name: null });
});

// the files pane and git tab (K4): each agent's touched files, a Look each;
// a file shown with its lines numbered, escaped; git's views of its repo;
// a diff's lines marked; a log's commits each a Look; a device's refusal said
test("files: agents' files, a file's lines, git's views, diffs marked, commits opened", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [{ name: "Owl", parent: "main", tier: "worker", model: "m", status: "working", since: 0, title: "Fix <login>", files: ["src/a.ts"] }, { name: "Elk", parent: "main", tier: "worker", model: "m", status: "done", since: 0 }] } as any);
  expect(View.view_route("#files")).toEqual({ mode: "files", name: null });
  expect(View.view_act(v, { $: "Look", what: { kind: "file", path: "a.ts" } })).toEqual([{ $: "look", what: { kind: "file", path: "a.ts" } }]);
  const empty = Pages.files_html(v).join("");
  expect(empty).toContain("Fix &lt;login&gt;");
  expect(empty).toContain(act({ $: "Look", what: { kind: "file", path: "src/a.ts", agent: "Owl" } }));
  expect(empty).not.toContain("Elk");
  expect(empty).toContain(act({ $: "Look", what: { kind: "git", repo: "@home", op: "status" } }));
  View.view_hear(v, { $: "looked", id: "x", kind: "file", path: "/w/Owl/src/a.ts", text: "const a = <b>;\nexport { a };" });
  const file = Pages.files_html(v).join("");
  expect(file).toContain('<span class="ln">2</span><span class="k">export</span> { a };');
  expect(file).toContain(" a = &lt;b&gt;;");
  expect(file).toContain(act({ $: "Look", what: { kind: "git", repo: "/w/Owl/src/a.ts", op: "log" } }));
  View.view_hear(v, { $: "looked", id: "y", kind: "git", path: "/r", op: "log", text: "abc1234 (HEAD) first\ndef5678 second" });
  const log = Pages.files_html(v).join("");
  expect(log).toContain(act({ $: "Look", what: { kind: "git", repo: "/r", op: "show", rev: "abc1234" } }));
  View.view_hear(v, { $: "looked", id: "s", kind: "git", path: "/r", op: "status", text: "## trunk <x>\n M a.ts" });
  expect(Pages.files_html(v).join("")).toContain("## trunk &lt;x&gt;");
  View.view_hear(v, { $: "looked", id: "z", kind: "git", path: "/r", op: "diff", text: "@@ -1 +1 @@\n-old\n+new" });
  const diff = Pages.files_html(v).join("");
  expect(diff).toContain('<span class="del">-old</span>');
  expect(diff).toContain('<span class="add">+new</span>');
  expect(diff).toContain('<span class="hunk">@@ -1 +1 @@</span>');
  View.view_hear(v, { $: "looked", id: "w", kind: "file", error: ".env may hold a secret: not shown." });
  expect(Pages.files_html(v).join("")).toContain(".env may hold a secret");
  // a box to run a command in what is shown's folder (K9): a file's own
  // folder, a repo's; none shown: the home repo (no folder)
  View.view_hear(v, { $: "looked", id: "f", kind: "file", path: "/w/Owl/src/a.ts", text: "x" });
  expect(Pages.files_html(v).join("")).toContain('<form class="fsh" data-dir="/w/Owl/src">');
  View.view_hear(v, { $: "looked", id: "g", kind: "git", path: "/r/it's", op: "log", text: "" });
  expect(Pages.files_html(v).join("")).toContain('data-dir="/r/it\'s"');
  expect(Pages.files_html(View.view_new()).join("")).toContain('<form class="fsh" data-dir="">');
});

// the Timesheet page (K5, RED ZONE): drafts by day with each day's hours,
// each escaped with its why and a Drop; Submit names exactly the drafts
// not sent nor sending; sent ones show Harvest's id, failed ones why; a
// routine to draft each workday offered when none drafts
test("timesheet: drafts by day, totals, Submit only the unsent, sent and failed shown, the routine offered", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  expect(View.view_route("#timesheet")).toEqual({ mode: "timesheet", name: null });
  expect(View.view_act(v, { $: "Timesheet", op: "submit", ns: [1, 2] })).toEqual([{ $: "timesheet", op: "submit", ns: [1, 2] }]);
  expect(View.view_act(v, { $: "Timesheet", op: "submit", ns: [] })).toEqual([]);
  const d = (n: number, date: string, hours: number, state: string, more = {}) => ({ n, project_id: 7, task_id: 70, project: "PIMCO <recon>", task: "Dev", date, hours, notes: "PR #" + n, why: "calendar: standup", by: "main", state, ...more });
  View.view_hear(v, { $: "state", ...v, drafts: [d(1, "2026-11-12", 1.5, "draft"), d(2, "2026-11-12", 2, "failed", { error: "Harvest: HTTP 422." }), d(3, "2026-11-13", 1, "sent", { harvest: 555 }), d(4, "2026-11-13", 0.5, "sending")] } as any);
  const html = Pages.timesheet_html(v).join("");
  expect(html).toContain("PIMCO &lt;recon&gt;");
  expect(html).toContain("calendar: standup");
  expect(html).toContain("3.5 h");
  expect(html).toContain(act({ $: "Timesheet", op: "submit", ns: [1, 2] }));
  expect(html).toContain(act({ $: "Timesheet", op: "drop", ns: [1] }));
  expect(html).not.toContain(act({ $: "Timesheet", op: "drop", ns: [3] }));
  expect(html).toContain("Harvest #555");
  expect(html).toContain("Harvest: HTTP 422.");
  expect(html).toContain("sending");
  expect(html).not.toContain('"$":"Routine"');
  const empty = View.view_new();
  const none = Pages.timesheet_html(empty).join("");
  expect(none).toContain("No drafts");
  expect(none).toContain(act({ $: "Routine", op: "add", routine: Pages.TIMESHEET_ROUTINE }));
  expect(Pages.TIMESHEET_ROUTINE.when).toEqual({ $: "weekly", day: 5, at: "09:00" }); // user, 2026-11-13: Friday mornings only
  expect(Pages.TIMESHEET_ROUTINE.task).toContain("Monday to Friday");
  const Routines = await import("./Routines.ts");
  expect(typeof Routines.routine_check(Pages.TIMESHEET_ROUTINE)).toBe("object");
});

// every page has a link on screen (user's report 2026-11-13: Files and
// Timesheet had none): the sidebar's pages and Home's Apps list each name
// all of View.PAGES; Files counts the agents with files, Timesheet the
// drafts waiting
test("every page is linked from the sidebar and Home's Apps, with Files' and Timesheet's counts", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  const d = (n: number, state: string) => ({ n, project_id: 7, task_id: 70, project: "P", task: "T", date: "2026-11-12", hours: 1, notes: "", why: "", by: "main", state });
  View.view_hear(v, { $: "state", ...v, drafts: [d(1, "draft"), d(2, "failed"), d(3, "sent")], crew: [{ name: "Owl", parent: "main", tier: "worker", model: "m", status: "working", since: 0, files: ["a.ts"] }] } as any);
  const side = Pages.side_html(v, "files", NOW).join("");
  const home = Pages.home_html(v, new Date(NOW)).join("");
  for (const page of View.PAGES) {
    expect([page, side.includes(`href="#${page}"`)]).toEqual([page, true]);
    expect([page, page === "home" || home.includes(`href="#${page}"`)]).toEqual([page, true]);
  }
  expect(side).toContain('<a href="#files" class="here">Files<span class="n">1</span></a>');
  expect(side).toContain('<a href="#timesheet">Timesheet<span class="n">2</span></a>');
  expect(home).toContain("2 drafts to review");
  expect(home).toContain("1 agent's files");
});

// the files pane draws a file as its kind asks (user's ask, 2026-11-13):
// code colored (Hl.ts), Markdown rendered, HTML previewed in a sandboxed
// frame (no scripts, no Legion origin); Source shows either's lines; a new
// file shown is drawn rendered again
test("files: code colored, Markdown rendered, HTML in a sandboxed frame, Source toggles", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  View.view_hear(v, { $: "looked", id: "a", kind: "file", path: "/r/a.ts", text: "const a = 1;" });
  expect(Pages.files_html(v).join("")).toContain('<span class="ln">1</span><span class="k">const</span> a = <span class="n">1</span>;');
  View.view_hear(v, { $: "looked", id: "m", kind: "file", path: "/r/README.md", text: "# Hi <x>\n\n- one" });
  const md = Pages.files_html(v).join("");
  expect(md).toContain("<h2>Hi &lt;x&gt;</h2>");
  expect(md).toContain("<li>one</li>");
  expect(md).toContain(act({ $: "Source", on: true }));
  expect(View.view_act(v, { $: "Source", on: true })).toEqual([]);
  const src = Pages.files_html(v).join("");
  expect(src).toContain('<span class="ln">1</span># Hi &lt;x&gt;');
  expect(src).toContain(act({ $: "Source", on: false }));
  View.view_hear(v, { $: "looked", id: "h", kind: "file", path: "/r/report.html", text: '<p onclick="x()">a & b</p><script>steal()</script>' });
  const html = Pages.files_html(v).join("");
  expect(html).toContain('<iframe class="fprev" sandbox="" srcdoc="&lt;p onclick=&quot;x()&quot;&gt;a &amp; b&lt;/p&gt;&lt;script&gt;steal()&lt;/script&gt;"></iframe>');
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("allow-same-origin");
  View.view_act(v, { $: "Source", on: true });
  expect(Pages.files_html(v).join("")).toContain('<span class="ln">1</span>&lt;p onclick');
  // plain text: lines only, no Source button
  View.view_hear(v, { $: "looked", id: "t", kind: "file", path: "/r/notes.txt", text: "if x" });
  const txt = Pages.files_html(v).join("");
  expect(txt).toContain('<span class="ln">1</span>if x');
  expect(txt).not.toContain('"Source"');
});

// the files explorer (user's ask 2026-11-13, Terax-like): workspaces
// opened from the device's roots, several at once, each a tree; a folder
// unfolded is asked of the device once; a file is a Look, a secret's opens
// in the editor; a folder's answer never replaces the file shown; the file
// shown opens in the editor too
test("files explorer: workspaces from the roots, folders asked once, files opened", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  expect(View.view_act(v, { $: "List", path: "@roots" })).toEqual([{ $: "look", what: { kind: "dir", path: "@roots" } }]);
  expect(View.view_act(v, { $: "List", path: "@roots" })).toEqual([]); // asked, not yet answered: not again
  View.view_hear(v, { $: "looked", id: "f", kind: "file", path: "/r/a.ts", text: "x" });
  View.view_hear(v, { $: "looked", id: "r", kind: "dir", path: "@roots", text: "d /r\nd /w/Owl" });
  expect(v.looked?.path).toBe("/r/a.ts");
  const picker = Pages.files_html(v).join("");
  expect(picker).toContain('<select data-ws aria-label="open a workspace"><option value="">Open a workspace…</option><option value="/r">r — /r</option><option value="/w/Owl">Owl — /w/Owl</option></select>');
  expect(View.view_act(v, { $: "Workspace", path: "/r", on: true })).toEqual([{ $: "look", what: { kind: "dir", path: "/r" } }]);
  expect(v.workspaces).toEqual(["/r"]);
  View.view_act(v, { $: "Workspace", path: "/w/Owl", on: true });
  View.view_hear(v, { $: "looked", id: "d", kind: "dir", path: "/r", text: "d src\ns .env\nf a.ts" });
  const tree = Pages.files_html(v).join("");
  expect(tree).toContain(act({ $: "Tree", path: "/r/src" }));
  expect(tree).toContain(act({ $: "Look", what: { kind: "file", path: "/r/a.ts" } }));
  expect(tree).toContain(act({ $: "Look", what: { kind: "open", path: "/r/.env" } }));
  expect(tree).toContain(act({ $: "Workspace", path: "/w/Owl", on: false }));
  expect(tree).toContain('<option value="">Open a workspace…</option></select>'); // both open: none left to pick
  // the file shown: Open in editor
  expect(tree).toContain(act({ $: "Look", what: { kind: "open", path: "/r/a.ts" } }));
  // a folder unfolded: asked once; folded again: no ask
  expect(View.view_act(v, { $: "Tree", path: "/r/src" })).toEqual([{ $: "look", what: { kind: "dir", path: "/r/src" } }]);
  View.view_hear(v, { $: "looked", id: "s", kind: "dir", path: "/r/src", error: "/r/src is not under this device's roots." });
  expect(Pages.files_html(v).join("")).toContain("is not under this device");
  expect(View.view_act(v, { $: "Tree", path: "/r/src" })).toEqual([]);
  expect(View.view_act(v, { $: "Tree", path: "/r/src" })).toEqual([]);
  // an editor's answer: said, the file shown kept
  View.view_hear(v, { $: "looked", id: "o", kind: "open", path: "/r/.env", text: "Opened .env in VS Code." });
  expect(v.looked?.path).toBe("/r/a.ts");
  expect(Pages.files_html(v).join("")).toContain("Opened .env in VS Code.");
  View.view_act(v, { $: "Workspace", path: "/r", on: false });
  expect(v.workspaces).toEqual(["/w/Owl"]);
});

// a path's line (path:42, a search's hit): the file opened at it, the
// line marked to scroll to; Markdown and HTML shown as source for it
test("files: a file opened at a line, marked; rendered kinds shown as source", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  expect(View.view_line("src/a.ts:42:7")).toBe(42);
  expect(View.view_line("src/a.ts")).toBeNull();
  expect(View.view_act(v, { $: "Look", what: { kind: "file", path: "/r/a.ts", line: 2 } })).toEqual([{ $: "look", what: { kind: "file", path: "/r/a.ts" } }]);
  View.view_hear(v, { $: "looked", id: "a", kind: "file", path: "/r/a.ts", text: "x\ny\nz" });
  const at = Pages.files_html(v).join("");
  expect(at).toContain('<span class="hit" id="L2"><span class="ln">2</span>y</span>');
  expect(at).not.toContain('id="L1"');
  View.view_act(v, { $: "Look", what: { kind: "file", path: "/r/b.md", line: 1 } });
  View.view_hear(v, { $: "looked", id: "b", kind: "file", path: "/r/b.md", text: "# hi" });
  expect(Pages.files_html(v).join("")).toContain('<span class="hit" id="L1"><span class="ln">1</span># hi</span>');
  View.view_act(v, { $: "Look", what: { kind: "file", path: "/r/c.ts" } });
  View.view_hear(v, { $: "looked", id: "c", kind: "file", path: "/r/c.ts", text: "q" });
  expect(Pages.files_html(v).join("")).not.toContain('class="hit"');
});

// an agent's changes (its branch's work since main) a click away, from
// the repo of the first file it touched by its full path; git's bar too
test("files: an agent's changes, from its files' repo; changes in git's bar", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [{ name: "Owl", parent: "main", tier: "worker", model: "m", status: "working", since: 0, files: ["notes.md", "/w/repo/src/a.ts"] }, { name: "Elk", parent: "main", tier: "worker", model: "m", status: "working", since: 0, files: ["rel.ts"] }] } as any);
  const html = Pages.files_html(v).join("");
  expect(html).toContain(act({ $: "Look", what: { kind: "git", repo: "/w/repo/src/a.ts", op: "changes" } }));
  expect(html).toContain(act({ $: "Look", what: { kind: "git", repo: "@home", op: "changes" } }));
  expect(html.split('op&quot;:&quot;changes').length - 1).toBe(2); // Elk: no full path, no button
});

// quick open and search across the open workspaces (⌘P, ⌘⇧F): a find or
// a search asked of each; answers to an older query dropped; each hit a
// Look (a search's at its line); cleared by an empty query
test("files: find and search across the workspaces, hits opened, old answers dropped", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  expect(View.view_act(v, { $: "Find", kind: "find", q: "scan" })).toEqual([]);
  expect(Pages.files_html(v).join("")).toContain("Open a workspace to find in it.");
  v.workspaces = ["/r", "/s"];
  expect(View.view_act(v, { $: "Find", kind: "grep", q: " needle " })).toEqual([{ $: "look", what: { kind: "grep", path: "/r", q: "needle" } }, { $: "look", what: { kind: "grep", path: "/s", q: "needle" } }]);
  View.view_hear(v, { $: "looked", id: "2", kind: "grep", path: "/r", q: "needle", text: "src/a.py:12:    return <needle>" });
  View.view_hear(v, { $: "looked", id: "1", kind: "grep", path: "/r", q: "old", text: "x.ts:1:old" }); // an older query's, late
  const html = Pages.files_html(v).join("");
  expect(html).toContain(act({ $: "Look", what: { kind: "file", path: "/r/src/a.py", line: 12 } }));
  expect(html).toContain("return &lt;needle&gt;");
  expect(html).not.toContain("x.ts");
  expect(html).toContain("Searching…");
  expect(html).toContain('<form class="ffind" data-find="grep"><input data-keep="grep" value="needle"');
  View.view_act(v, { $: "Find", kind: "find", q: "cfg" });
  View.view_hear(v, { $: "looked", id: "3", kind: "find", path: "/s", q: "cfg", text: "lib/cfg.ts" });
  expect(Pages.files_html(v).join("")).toContain(act({ $: "Look", what: { kind: "file", path: "/s/lib/cfg.ts" } }));
  expect(View.view_act(v, { $: "Find", kind: "find", q: "" })).toEqual([]);
  expect(v.found).toBeNull();
});

// editing a file in the browser (RED ZONE): Edit shows its text in a box
// (escaped), Save sends it with the hash it was shown with; saved: said,
// the box closed, the file asked again; refused: said, the box kept
test("files: a file edited and saved as shown; a refusal keeps the edit", async () => {
  const View = await import("./View.ts");
  const v = View.view_new();
  View.view_hear(v, { $: "looked", id: "f", kind: "file", path: "/r/a.ts", hash: "h1", text: "a </textarea> b" });
  expect(Pages.files_html(v).join("")).toContain(act({ $: "Edit", on: true }));
  View.view_act(v, { $: "Edit", on: true });
  const box = Pages.files_html(v).join("");
  expect(box).toContain('<textarea data-keep="edit" spellcheck="false" aria-label="the file\'s text">a &lt;/textarea&gt; b</textarea>');
  expect(View.view_act(v, { $: "Save", text: "new" })).toEqual([{ $: "look", what: { kind: "save", path: "/r/a.ts", text: "new", base: "h1" } }]);
  expect(View.view_hear(v, { $: "looked", id: "s", kind: "save", path: "/r/a.ts", error: "/r/a.ts changed since it was shown" })).toEqual([]);
  expect(v.editing).toBe(true);
  expect(Pages.files_html(v).join("")).toContain("changed since it was shown");
  expect(View.view_hear(v, { $: "looked", id: "t", kind: "save", path: "/r/a.ts", hash: "h2", text: "Saved a.ts." })).toEqual([{ $: "look", what: { kind: "file", path: "/r/a.ts" } }]);
  expect(v.editing).toBe(false);
  // nothing shown, or no hash: nothing to save
  View.view_hear(v, { $: "looked", id: "e", kind: "file", error: "no" });
  expect(View.view_act(v, { $: "Save", text: "x" })).toEqual([]);
  expect(Pages.files_html(v).join("")).not.toContain(act({ $: "Edit", on: true }));
});
