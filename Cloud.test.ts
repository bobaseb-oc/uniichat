// Sign-in links (Cloud.link_ask): an address has at most 3 unused at once
// (a ticket used up leaves the count) and a network (Cloud.net) 100 a
// day, used or not, so /api/login can't mail a victim links or drain the
// mail quota.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";

process.env.UNII_DIR = fs.mkdtempSync("/tmp/cloud-test-");
process.env.UNII_SITE = "http://127.0.0.1";
const { Cloud } = await import("./Cloud.ts");
// the site, as the first test file to load Config set it (one process)
const config = await import("./Config.ts");

// accounts in a dir made anew; the last test's goes after all
function cloud_new() {
  fs.rmSync(process.env.UNII_DIR ?? "", { recursive: true, force: true });
  fs.mkdirSync(process.env.UNII_DIR ?? "", { recursive: true });
  return Cloud.open(() => {}, () => {}, async () => null);
}

afterAll(() => fs.rmSync(process.env.UNII_DIR ?? "", { recursive: true, force: true }));

test("Cloud.net: IPv4 whole, IPv6 by its /48", () => {
  expect(Cloud.net("1.2.3.4")).toBe("1.2.3.4");
  expect(Cloud.net("::ffff:1.2.3.4")).toBe("1.2.3.4");
  expect(Cloud.net("2001:db8:0:1:aaaa::5")).toBe("2001:db8:0::/48");
  expect(Cloud.net("2001:DB8::1")).toBe("2001:db8:0::/48");
});

test("link_ask caps links by address at once and by network a day", () => {
  const cloud = cloud_new();
  const ask = (who: string, net: string) => Cloud.link_ask(cloud, who, net) ?? Cloud.ticket(cloud, { who, session: null }, 60000);
  const first = ask("a@x.com", "1.1.1.1");
  ask("a@x.com", "1.1.1.1");
  ask("a@x.com", "1.1.1.1");
  expect(Cloud.link_ask(cloud, "a@x.com", "2.2.2.2")).toContain("15 minutes");
  Cloud.ticket_read(cloud, first, true);
  expect(Cloud.link_ask(cloud, "a@x.com", "3.3.3.3")).toBeNull();
  for (let k = 0; k < 97; k++) {
    ask("b" + k + "@x.com", "1.1.1.1");
  }
  expect(Cloud.link_ask(cloud, "c@x.com", "1.1.1.1")).toContain("tomorrow");
  expect(Cloud.link_ask(cloud, "c@x.com", "2.2.2.2")).toBeNull();
  cloud.db.query("update asks set at = at - 864e5").run();
  expect(Cloud.link_ask(cloud, "c@x.com", "1.1.1.1")).toBeNull();
  // no address (a self-host, no proxy): one network, counted
  expect(Cloud.link_ask(cloud, "d@x.com", Cloud.net(""))).toBeNull();
});

test("Cloud.address", () => {
  expect(Cloud.address("@OCTOCAT on gh", true)).toBe("@octocat");
  expect(Cloud.address("o'neil@x.com, not @octocat.", false)).toBe("o'neil@x.com");
});

// A terminal sign-in signs in only when the code the terminal shows is
// typed on the page its link opens (the email's, or GitHub's, which
// brings its code): opening the link makes no session, nor
// does a wrong code; the right one does. So opening an unrequested link,
// or one an attacker forwarded, grants nothing.
test("terminal sign-in needs the code the terminal shows", async () => {
  const cloud = cloud_new();
  const key = Cloud.random();
  const session = Cloud.hash(key);
  const t = Cloud.ticket(cloud, { who: "t@x.com", session }, 60000);
  const code = Cloud.code(session);
  expect(code).toMatch(/^\d{6}$/);
  const post = (c: string) => new Request("http://127.0.0.1/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, code: c }).toString() });
  const signed = () => cloud.db.query("select hash from sessions where hash = ?").get(session);
  const gh = Cloud.ticket(cloud, { who: "@x", session }, 60000);
  for (const link of [t, gh]) {
    const page = await Cloud.http(cloud, new Request("http://127.0.0.1/auth?t=" + link + "&code=" + "a".repeat(64)));
    expect(await page?.text()).toContain("Enter the code");
  }
  expect(signed()).toBeNull();
  await Cloud.confirm(cloud, post(code === "000000" ? "111111" : "000000"));
  expect(signed()).toBeNull();
  await Cloud.confirm(cloud, post(code));
  expect(signed()).not.toBeNull();
});

// An emailed link signs in each time it is opened until it expires: a
// mail app's preview opening it first must not use it up.
test("an emailed link survives its preview", async () => {
  const cloud = cloud_new();
  const t = Cloud.ticket(cloud, { who: "p@x.com", session: null }, 60000);
  const open = async () => (await Cloud.http(cloud, new Request("http://127.0.0.1/auth?t=" + t)))?.headers.get("set-cookie") ?? "";
  expect(await open()).toContain("=");
  expect(await open()).toContain("=");
});

// `unii web`: a terminal's Bearer session mints a ticket for its own
// account, good once for 60 s, which /auth swaps for a browser cookie.
// The cookie alone can't mint one (a page can't widen its own sign-in,
// nor a cross-site request ride it), nor can anyone signed out; the
// session it makes is the minting user's, never another's.
test("/api/web-link: Bearer only, once, briefly, for the same user", async () => {
  const cloud = cloud_new();
  const me = Cloud.session(cloud, { id: "u1", name: "me@x.com" });
  Cloud.session(cloud, { id: "u2", name: "other@x.com" });
  const mint = (headers: Record<string, string>) => Cloud.http(cloud, new Request("http://127.0.0.1/api/web-link", { method: "POST", headers }));
  expect((await mint({}))?.status).toBe(401);
  expect((await mint({ authorization: "Bearer " + Cloud.random() }))?.status).toBe(401);
  expect((await mint({ cookie: "unii=" + me }))?.status).toBe(401);
  expect((await Cloud.http(cloud, new Request("http://127.0.0.1/api/web-link", { headers: { authorization: "Bearer " + me } })))?.status).toBe(405);
  const res = await mint({ authorization: "Bearer " + me });
  expect(res?.status).toBe(200);
  const { url } = (await res?.json()) as { url: string };
  expect(url).toStartWith(config.SITE + "/auth?t=");
  const open = () => Cloud.http(cloud, new Request(url));
  const first = await open();
  expect(first?.status).toBe(302);
  expect(first?.headers.get("location")).toBe(config.SITE + "/");
  const cookie = first?.headers.get("set-cookie") ?? "";
  const token = /^unii=([^;]+)/.exec(cookie)?.[1] ?? "";
  expect(token).not.toBe("");
  expect(token).not.toBe(me);
  const browser = Cloud.who(cloud, new Request("http://127.0.0.1/", { headers: { cookie: "unii=" + token } }));
  expect(browser).toEqual({ id: "u1", name: "me@x.com" });
  // used up
  const again = await open();
  expect(again?.headers.get("set-cookie") ?? "").toBe("");
  expect(again?.headers.get("location")).toContain("expired=1");
  // expired
  const late = (await (await mint({ authorization: "Bearer " + me }))?.json()) as { url: string };
  cloud.db.query("update tickets set expires = ?").run(Date.now() - 1);
  const stale = await Cloud.http(cloud, new Request(late.url));
  expect(stale?.headers.get("set-cookie") ?? "").toBe("");
  // it lasts no more than a minute, and isn't counted as a mailed link
  for (let k = 0; k < 3; k++) {
    await mint({ authorization: "Bearer " + me });
  }
  const row = cloud.db.query("select expires from tickets order by expires desc").get() as { expires: number };
  expect(row.expires - Date.now()).toBeLessThanOrEqual(60000);
  expect(Cloud.link_ask(cloud, "me@x.com", "9.9.9.9")).toBeNull();
});

// a web ticket never reaches the code-confirm path, so it can't sign a
// terminal in either
test("a web ticket can't confirm a terminal", async () => {
  const cloud = cloud_new();
  const me = Cloud.session(cloud, { id: "u1", name: "me@x.com" });
  const res = await Cloud.http(cloud, new Request("http://127.0.0.1/api/web-link", { method: "POST", headers: { authorization: "Bearer " + me } }));
  const t = new URL(((await res?.json()) as { url: string }).url).searchParams.get("t") ?? "";
  const post = new Request("http://127.0.0.1/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, code: "000000" }).toString() });
  const out = await Cloud.confirm(cloud, post);
  expect(out.headers.get("location")).toContain("expired=1");
});

// Phones (APNs pushes, push tokens, the iOS app's AASA) are off unless
// UNII_PHONE=1: no route answers and nothing is stored or sent.
test("phone features are off by default", async () => {
  const cloud = cloud_new();
  expect(cloud.phone).toBe(false);
  const me = Cloud.session(cloud, { id: "u1", name: "me@x.com" });
  const token = "a".repeat(64);
  const push = () => Cloud.http(cloud, new Request("http://127.0.0.1/api/push", { method: "POST", headers: { authorization: "Bearer " + me }, body: token }));
  const stored = () => cloud.db.query("select count(*) n from pushes").get() as { n: number };
  expect(await push()).toBeNull();
  expect(stored().n).toBe(0);
  expect(await Cloud.http(cloud, new Request("http://127.0.0.1/.well-known/apple-app-site-association"))).toBeNull();
  cloud.phone = true;
  expect((await push())?.status).toBe(200);
  expect(stored().n).toBe(1);
});
