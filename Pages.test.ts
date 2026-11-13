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
  expect(file).toContain('<span class="ln">2</span>export { a };');
  expect(file).toContain("const a = &lt;b&gt;;");
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
});
