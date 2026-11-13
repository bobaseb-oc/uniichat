// Harvest test
// ============
// `bun test Harvest.test.ts`. RED ZONE (Harvest.ts, K5): against a fake
// Harvest on 127.0.0.1: the token checked at sign-in and kept only in the
// store; each request with the account and a User-Agent; the user's own
// assignments and entries read; an entry checked whole before it is
// posted (ids, date, hours, notes), posted only by post; logout deletes.

import { afterAll, expect, test } from "bun:test";
import type { Store } from "./Auth.ts";
import { Harvest, type Opts } from "./Harvest.ts";

function memory(): Store & { all: Map<string, string> } {
  const all = new Map<string, string>();
  return { all, get: async (n) => all.get(n) ?? null, set: async (n, v) => void all.set(n, v), delete: async (n) => all.delete(n) };
}

const sent: { method: string; path: string; query: string; auth: string | null; account: string | null; agent: string | null; body: any }[] = [];
const harvest = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json() : null;
    sent.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.get("authorization"), account: req.headers.get("harvest-account-id"), agent: req.headers.get("user-agent"), body });
    if (req.headers.get("authorization") !== "Bearer good-token-1") {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }
    if (url.pathname === "/v2/users/me") {
      return Response.json({ id: 42, first_name: "Seb", last_name: "B", email: "s@x.com" });
    }
    if (url.pathname === "/v2/users/me/project_assignments") {
      return Response.json({ project_assignments: [{ is_active: true, project: { id: 7, name: "PIMCO recon", code: "PIM-01" }, client: { id: 1, name: "PIMCO" }, task_assignments: [{ is_active: true, task: { id: 70, name: "Development" } }, { is_active: false, task: { id: 71, name: "Old" } }] }], links: { next: null } });
    }
    if (url.pathname === "/v2/time_entries" && req.method === "GET") {
      return Response.json({ time_entries: [{ id: 900, spent_date: "2026-11-10", hours: 2.5, notes: "recon checks", project: { id: 7, name: "PIMCO recon" }, task: { id: 70, name: "Development" } }], links: { next: null } });
    }
    if (url.pathname === "/v2/time_entries" && req.method === "POST") {
      return Response.json({ id: 901, ...body }, { status: 201 });
    }
    return new Response("no", { status: 404 });
  },
});
afterAll(() => harvest.stop(true));
const O: Opts = { insecure: true, api: "http://127.0.0.1:" + harvest.port + "/v2" };

test("sign-in: the token checked with Harvest, then kept in the store only; a bad one kept nowhere; logout deletes", async () => {
  const store = memory();
  await expect(Harvest.login(store, "bad-token-123", "540457", O)).rejects.toThrow("HTTP 401");
  await expect(Harvest.login(store, "bad", "540457", O)).rejects.toThrow("not a Harvest personal access token");
  expect(store.all.size).toBe(0);
  const me = await Harvest.login(store, " good-token-1 \n", "540457", O);
  expect(me).toEqual({ id: 42, name: "Seb B" });
  expect(store.all.get("token")).toBe("good-token-1");
  expect(store.all.get("account")).toBe("540457");
  const asked = sent.at(-1)!;
  expect(asked).toMatchObject({ path: "/v2/users/me", auth: "Bearer good-token-1", account: "540457" });
  expect(asked.agent).toContain("Legion");
  await expect(Harvest.login(memory(), "good-token-1", "54x", O)).rejects.toThrow("account");
  expect(await Harvest.logout(store)).toBe(true);
  expect(store.all.size).toBe(0);
  await expect(Harvest.creds(store)).rejects.toThrow("legion harvest-login");
  await expect(Harvest.login(memory(), "good-token-1", "540457", { api: "http://example.com/v2" })).rejects.toThrow("not https");
});

// security review H5 (RED ZONE): the token in the login keychain with no
// application trusted (-T ""), so each read asks the user; given on
// security's stdin, never its arguments; the old Bun.secrets item deleted.
// A fake `security` here: no real Keychain is touched.
test("the token's store: no app trusted, so each read asks; never an argument; the old item deleted", async () => {
  const calls: { args: string[]; input?: string }[] = [];
  let kept: string | null = null;
  const run = async (args: string[], input?: string) => {
    calls.push({ args, input });
    if (args[0] === "-i") {
      kept = input!.match(/ -w (\S+)/)![1];
      return { code: 0, out: "" };
    }
    if (args[0] === "find-generic-password") {
      return kept === null ? { code: 44, out: "" } : { code: 0, out: kept + "\n" };
    }
    if (args[0] === "delete-generic-password") {
      const had = kept !== null;
      kept = null;
      return { code: had ? 0 : 44, out: "" };
    }
    return { code: 1, out: "" };
  };
  const old = memory();
  const store = Harvest.store(run, old);
  expect(await store.get("token")).toBeNull();
  old.all.set("token", "old-token-123");
  await store.set("token", "1234567.pt.synthetic-value_0");
  expect(old.all.has("token")).toBe(false);
  expect(calls.find((c) => c.args[0] === "-i")).toEqual({ args: ["-i"], input: 'add-generic-password -s legion-harvest-guarded-token -a oauth -T "" -w 1234567.pt.synthetic-value_0\n' });
  expect(calls.every((c) => !c.args.join(" ").includes("synthetic"))).toBe(true);
  expect(await store.get("token")).toBe("1234567.pt.synthetic-value_0");
  expect(calls.at(-1)!.args).toEqual(["find-generic-password", "-s", "legion-harvest-guarded-token", "-a", "oauth", "-w"]);
  await store.set("account", "540457");
  expect(old.all.get("account")).toBe("540457");
  expect(await store.get("account")).toBe("540457");
  await expect(store.set("token", 'x" -A -w y')).rejects.toThrow("not a token");
  expect(await store.get("token")).toBe("1234567.pt.synthetic-value_0");
  expect(await store.delete("token")).toBe(true);
  expect(await store.get("token")).toBeNull();
  const denied = Harvest.store(async () => ({ code: 128, out: "" }), memory());
  await expect(denied.get("token")).rejects.toThrow("the Keychain refused");
  await expect(denied.set("token", "1234567.pt.synthetic-value_0")).rejects.toThrow("the Keychain refused");
});

// security review follow-up (RED ZONE): a token Bun.secrets kept before
// (readable by any bun) is moved to the asking store at its first read,
// then deleted; if it can't be moved, nothing is deleted and that is said.
// Fakes for both stores: no real Keychain is touched.
test("the old Bun.secrets token: moved at first read, then deleted; kept where it was if it can't be", async () => {
  const items = new Map<string, string>();
  const run = async (args: string[], input?: string) => {
    if (args[0] === "-i") {
      items.set("token", input!.match(/ -w (\S+)/)![1]);
      return { code: 0, out: "" };
    }
    if (args[0] === "find-generic-password") {
      return items.has("token") ? { code: 0, out: items.get("token") + "\n" } : { code: 44, out: "" };
    }
    return { code: items.delete("token") ? 0 : 44, out: "" };
  };
  const old = memory();
  old.all.set("token", "1234567.pt.old-synthetic_0");
  old.all.set("account", "540457");
  const store = Harvest.store(run, old);
  expect(await Harvest.creds(store)).toEqual({ token: "1234567.pt.old-synthetic_0", account: "540457" });
  expect(items.get("token")).toBe("1234567.pt.old-synthetic_0");
  expect(old.all.has("token")).toBe(false);
  expect(await store.get("token")).toBe("1234567.pt.old-synthetic_0");
  const stuck = memory();
  stuck.all.set("token", "1234567.pt.old-synthetic_0");
  const refusing = Harvest.store(async (args) => ({ code: args[0] === "find-generic-password" ? 44 : 1, out: "" }), stuck);
  await expect(refusing.get("token")).rejects.toThrow("nothing deleted");
  expect(stuck.all.get("token")).toBe("1234567.pt.old-synthetic_0");
  const none = Harvest.store(async () => ({ code: 44, out: "" }), memory());
  expect(await none.get("token")).toBeNull();
});

test("reads: the user's active assignments and active tasks; their entries for a range", async () => {
  const c = { token: "good-token-1", account: "540457" };
  expect(await Harvest.projects(c, O)).toEqual([{ project_id: 7, project: "PIMCO recon", code: "PIM-01", client: "PIMCO", tasks: [{ task_id: 70, task: "Development" }] }]);
  expect(await Harvest.entries(c, "2026-11-09", "2026-11-15", O)).toEqual([{ id: 900, date: "2026-11-10", hours: 2.5, project_id: 7, project: "PIMCO recon", task_id: 70, task: "Development", notes: "recon checks" }]);
  const q = new URLSearchParams(sent.findLast((s) => s.path === "/v2/time_entries")!.query);
  expect([q.get("user_id"), q.get("from"), q.get("to")]).toEqual(["42", "2026-11-09", "2026-11-15"]);
  await expect(Harvest.entries(c, "2026-13-01", "2026-11-15", O)).rejects.toThrow("date");
  expect(Harvest.week(new Date(2026, 10, 13))).toEqual({ from: "2026-11-09", to: "2026-11-15" });
});

test("an entry: checked whole before it is posted; posted as Harvest asks", async () => {
  const c = { token: "good-token-1", account: "540457" };
  const ok = { project_id: 7, task_id: 70, date: "2026-11-12", hours: 1.25, notes: "PR #3 review" };
  expect(Harvest.entry_check(ok)).toEqual(ok);
  for (const bad of [{ ...ok, project_id: -1 }, { ...ok, task_id: 1.5 }, { ...ok, date: "12/11/2026" }, { ...ok, hours: 0 }, { ...ok, hours: 25 }, { ...ok, hours: "2" }, { ...ok, notes: "x".repeat(2001) }, null]) {
    expect(typeof Harvest.entry_check(bad)).toBe("string");
  }
  const before = sent.filter((s) => s.method === "POST").length;
  expect(await Harvest.post(c, ok, O)).toEqual({ id: 901 });
  const post = sent.at(-1)!;
  expect(post.body).toEqual({ project_id: 7, task_id: 70, spent_date: "2026-11-12", hours: 1.25, notes: "PR #3 review" });
  await expect(Harvest.post(c, { ...ok, hours: 30 } as any, O)).rejects.toThrow("hours");
  expect(sent.filter((s) => s.method === "POST").length - before).toBe(1);
});

test("the agents' harvest tool reads only: projects and entries (this week by default); no write action", async () => {
  const c = { token: "good-token-1", account: "540457" };
  const now = new Date(2026, 10, 13);
  expect(await Harvest.tool(c, { action: "projects" }, now, O)).toContain("PIMCO recon");
  expect(await Harvest.tool(c, { action: "entries" }, now, O)).toContain("recon checks");
  const q = new URLSearchParams(sent.findLast((s) => s.path === "/v2/time_entries")!.query);
  expect(q.get("from")).toBe("2026-11-09");
  const posts = sent.filter((s) => s.method === "POST").length;
  await expect(Harvest.tool(c, { action: "post", project_id: 7 }, now, O)).rejects.toThrow("No harvest action post");
  expect(sent.filter((s) => s.method === "POST").length).toBe(posts);
});

// the guarded token is its own Keychain item: were it the old one's
// (service legion-harvest-token, account oauth), the move never runs and
// the old item, readable by bun with no prompt, stays (round-4 check)
test("the guarded token never shares the old Keychain item", async () => {
  const asked: string[][] = [];
  const run = async (args: string[]) => { asked.push(args); return { code: 44, out: "" }; };
  await Harvest.store(run as any, { get: async () => null, set: async () => {}, delete: async () => true }).get("token");
  const service = asked.find((a) => a[0] === "find-generic-password")![2];
  expect(service).not.toBe("legion-harvest-token");
});
