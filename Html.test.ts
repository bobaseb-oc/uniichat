// Html test
// =========
// `bun test Html.test.ts`. The site's crew (web/src/Html.ts crew_html):
// UniiChat, then each agent under its starter, a button that shows its
// page; the page shown marked; done and failed ones dismissable; names
// escaped.

import { expect, test } from "bun:test";
import * as Html from "./web/src/Html.ts";
import * as View from "./View.ts";

const crew = (name: string, parent: string, status: View.Status): View.Crew => ({ name, parent, tier: parent === "main" ? "manager" : "worker", model: "sonnet-5.5", status, since: 0 });

test("the crew: UniiChat, each agent under its starter, the page shown marked, done ones dismissable", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Mgr", "main", "waiting"), crew("Wkr", "Mgr", "failed"), crew("Old", "main", "done")] });
  View.view_act(v, { $: "Goto", name: "Wkr" });
  const html = Html.crew_html(v, 0);
  expect(html).toHaveLength(4);
  expect(html[0]).toContain("UniiChat · orchestrator");
  expect(html[0]).not.toContain('class="here');
  expect(html[1]).toContain('class="crew d0 waiting"');
  expect(html[2]).toContain('class="crew d1 failed here"');
  expect(html[2]).toContain("&quot;Dismiss&quot;");
  expect(html[1]).not.toContain("Dismiss");
  expect(html[3]).toContain("&quot;Dismiss&quot;");
  expect(View.view_act(v, { $: "Dismiss", name: "Old" })).toEqual([{ $: "dismiss", name: "Old" }]);
});

test("a name from the server is escaped", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("<b>x</b>", "main", "done")] });
  const html = Html.crew_html(v, 0).join("");
  expect(html).not.toContain("<b>x</b>");
  expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
});

test("a Claude Code worker asking to start has approve and deny buttons, no dismiss", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [{ ...crew("Cc", "main", "asking"), tier: "claude" }] });
  const row = Html.crew_html(v, 0)[1];
  expect(row).toContain("&quot;Approve&quot;,&quot;name&quot;:&quot;Cc&quot;,&quot;yes&quot;:true");
  expect(row).toContain("&quot;yes&quot;:false");
  expect(row).not.toContain("Dismiss");
});
