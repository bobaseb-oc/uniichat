// Google test
// ===========
// `bun test Google.test.ts`. RED ZONE (Google.ts): the sign-in against a
// fake Google on 127.0.0.1: PKCE S256, offline consent, the scopes asked
// and all of them granted, the state checked, the client's secret sent as
// Google asks, the grant kept only in the store; a token refreshed once
// near expiry however many ask, a failed refresh said; logout revokes then
// deletes; the reads ask no attendee's address and keep only safe links.

import { afterAll, expect, test } from "bun:test";
import type { Store } from "./Auth.ts";
import { Google, SCOPES, TEXT, type Opts } from "./Google.ts";

// a store in memory (the Keychain's stand-in)
function memory(): Store & { all: Map<string, string> } {
  const all = new Map<string, string>();
  return { all, get: async (n) => all.get(n) ?? null, set: async (n, v) => void all.set(n, v), delete: async (n) => all.delete(n) };
}

// the fake Google: what it was sent; how it answers
const sent: { path: string; form: Record<string, string>; auth: string | null; query: string }[] = [];
let grant_scope = SCOPES.join(" ");
let refresh_ok = true;
const google = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const form = req.method === "POST" ? Object.fromEntries(new URLSearchParams(await req.text())) : {};
    sent.push({ path: url.pathname, form, auth: req.headers.get("authorization"), query: url.search });
    if (url.pathname === "/token" && form.grant_type === "authorization_code") {
      return Response.json({ access_token: "at1", refresh_token: "rt1", expires_in: 3600, token_type: "Bearer", scope: grant_scope });
    }
    if (url.pathname === "/token" && form.grant_type === "refresh_token") {
      await Bun.sleep(30);
      return refresh_ok ? Response.json({ access_token: "at2", expires_in: 3600, token_type: "Bearer" }) : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url.pathname === "/revoke") {
      return new Response("");
    }
    if (url.pathname.startsWith("/calendar/")) {
      return Response.json({ items: [{ id: "e1", summary: "Weekly", start: { dateTime: "2026-11-12T13:30:00Z" }, end: { dateTime: "2026-11-12T14:00:00Z" }, hangoutLink: "https://meet.google.com/abc", attendees: [{ responseStatus: "accepted" }, { responseStatus: "needsAction" }] }] });
    }
    if (url.pathname === "/drive/v3/files") {
      return Response.json({ files: [{ id: "doc_1234567890", name: "Standup - Transcript", modifiedTime: "2026-11-11T10:00:00Z", webViewLink: "https://docs.google.com/document/d/doc_1234567890" }] });
    }
    if (url.pathname.endsWith("/export")) {
      return new Response("x".repeat(TEXT + 50));
    }
    return new Response("no", { status: 404 });
  },
});
afterAll(() => google.stop(true));
const base = "http://127.0.0.1:" + google.port;
const O: Opts = { insecure: true, ends: { auth: base + "/auth", token: base + "/token", revoke: base + "/revoke", api: base }, wait: 5000 };
const CLIENT = { client_id: "123.apps.googleusercontent.com", client_secret: "not-so-secret" };

// the browser: follows the authorize URL to the callback, with its state
// (or another)
const browse = (state?: string) => async (at: string) => {
  const u = new URL(at);
  const back = new URL(u.searchParams.get("redirect_uri")!);
  back.searchParams.set("code", "c0de");
  back.searchParams.set("state", state ?? u.searchParams.get("state")!);
  await fetch(back);
};

test("the client file: a desktop app's, checked", () => {
  expect(Google.client_read({ installed: { ...CLIENT, project_id: "p" } })).toEqual(CLIENT);
  expect(() => Google.client_read({ web: CLIENT })).toThrow();
  expect(() => Google.client_read({ installed: { client_id: "evil.example.com", client_secret: "s" } })).toThrow();
});

test("sign-in: S256, offline consent, the read-only scopes; the code swapped with the verifier and secret; kept in the store only", async () => {
  const store = memory();
  let asked = "";
  await Google.login(store, CLIENT, { ...O, open: async (at) => { asked = at; await browse()(at); } });
  const u = new URL(asked);
  expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  expect(u.searchParams.get("access_type")).toBe("offline");
  expect(u.searchParams.get("scope")).toBe(SCOPES.join(" "));
  expect(SCOPES.every((s) => s.endsWith(".readonly"))).toBe(true);
  expect(u.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const swap = sent.find((s) => s.form.grant_type === "authorization_code")!;
  expect(swap.form.code).toBe("c0de");
  expect(swap.form.client_secret).toBe("not-so-secret");
  expect(swap.form.code_verifier.length).toBeGreaterThan(40);
  expect(JSON.parse(store.all.get("grant")!)).toMatchObject({ access_token: "at1", refresh_token: "rt1" });
  expect(JSON.parse(store.all.get("client")!)).toEqual(CLIENT);
});

test("sign-in refused: a callback with another state; fewer scopes granted than asked; nothing kept", async () => {
  const store = memory();
  await expect(Google.login(store, CLIENT, { ...O, open: browse("not-ours") })).rejects.toThrow("state");
  grant_scope = SCOPES[0];
  await expect(Google.login(store, CLIENT, { ...O, open: browse() })).rejects.toThrow("less than calendar and Drive");
  grant_scope = SCOPES.join(" ");
  expect(store.all.size).toBe(0);
  await expect(Google.login(memory(), CLIENT, { ...O, ends: { ...O.ends!, token: "http://example.com/token" }, open: browse() })).rejects.toThrow("not https");
});

test("a token: fresh as kept; near expiry refreshed once for all who ask; none or a failed refresh: sign in again", async () => {
  const store = memory();
  await expect(Google.token(store, O)).rejects.toThrow("not signed in: legion google-login");
  store.all.set("client", JSON.stringify(CLIENT));
  store.all.set("grant", JSON.stringify({ access_token: "at1", refresh_token: "rt1", expires_at: Date.now() + 3600e3 }));
  expect(await Google.token(store, O)).toBe("at1");
  store.all.set("grant", JSON.stringify({ access_token: "at1", refresh_token: "rt1", expires_at: Date.now() + 60e3 }));
  const before = sent.filter((s) => s.form.grant_type === "refresh_token").length;
  expect(await Promise.all([Google.token(store, O), Google.token(store, O), Google.token(store, O)])).toEqual(["at2", "at2", "at2"]);
  expect(sent.filter((s) => s.form.grant_type === "refresh_token").length - before).toBe(1);
  expect(JSON.parse(store.all.get("grant")!)).toMatchObject({ access_token: "at2", refresh_token: "rt1" });
  store.all.set("grant", JSON.stringify({ access_token: "at1", refresh_token: "rt1", expires_at: 0 }));
  refresh_ok = false;
  await expect(Google.token(store, O)).rejects.toThrow("sign in again: legion google-login");
  refresh_ok = true;
});

test("logout: revoked at Google, then deleted, the client too", async () => {
  const store = memory();
  store.all.set("client", JSON.stringify(CLIENT));
  store.all.set("grant", JSON.stringify({ access_token: "at1", refresh_token: "rt1", expires_at: Date.now() + 3600e3 }));
  expect(await Google.logout(store, O)).toBe(true);
  expect(sent.at(-1)).toMatchObject({ path: "/revoke", form: { token: "rt1" } });
  expect(store.all.size).toBe(0);
  expect(await Google.logout(store, O)).toBe(false);
});

test("reads: events without attendees' addresses, Meet links only; transcript Docs with Docs links only; a text cut, a bad id refused", async () => {
  const events = await Google.events("at1", new Date(2026, 10, 12), O);
  expect(events).toEqual([{ id: "e1", title: "Weekly", start: "2026-11-12T13:30:00Z", end: "2026-11-12T14:00:00Z", meet: "https://meet.google.com/abc", people: 2 }]);
  const asked = sent.findLast((s) => s.path.startsWith("/calendar/"))!;
  expect(asked.auth).toBe("Bearer at1");
  expect(decodeURIComponent(asked.query)).not.toContain("email");
  expect(Google.events_read({ items: [{ id: "x", status: "cancelled" }, { id: "y", hangoutLink: "https://evil.example/meet" }] }).map((e) => [e.id, e.meet])).toEqual([["y", ""]]);
  expect(await Google.docs("at1", new Date(2026, 10, 12), O)).toEqual([{ id: "doc_1234567890", title: "Standup - Transcript", at: "2026-11-11T10:00:00Z", url: "https://docs.google.com/document/d/doc_1234567890" }]);
  expect(Google.docs_read({ files: [{ id: "../x", name: "n" }, { id: "abc", webViewLink: "javascript:x" }] })).toEqual([{ id: "abc", title: "", at: "", url: "" }]);
  expect((await Google.text("at1", "doc_1234567890", O)).length).toBe(TEXT);
  await expect(Google.text("at1", "../../etc", O)).rejects.toThrow("not a Drive file id");
});
