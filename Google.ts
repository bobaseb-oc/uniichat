// Google
// ======
// RED ZONE (tasks/todo.md C8: designed with and approved by the user
// 2026-11-12; this code is a DRAFT for their review before merge). The
// cockpit's calendar and meeting transcripts, read on the device with the
// user's own Google sign-in, read-only:
//
// - Sign-in: OAuth 2.0 for a desktop app (Google's installed-app flow):
//   PKCE S256, a random state compared in constant time (Auth.callback),
//   the redirect to 127.0.0.1 at a random port, one callback taken, the
//   code swapped (`legion google-login`). The client is the user's
//   registration in OnCorps' Google Cloud project (Internal: OnCorps
//   accounts only); Google gives desktop clients a secret that isn't
//   secret, sent as Google asks.
// - Scopes: calendar.events.readonly, drive.readonly. Nothing is written.
// - Keys: the client and the grant in the Keychain only (Auth.keychain,
//   services "legion-google-client", "legion-google-grant"), never a file,
//   an argument, the environment, a log, an error, the server or a model.
// - Refresh: 2 minutes before expiry, once however many ask; any failure
//   throws (fail closed: the device reports nothing from Google).
// - Logout revokes the grant at Google, then deletes it.
// - Reads: today's and tomorrow's events (title, times, Meet link,
//   attendee count: no attendee's address); the last 14 days' transcript
//   Docs (title, date, id, link); a transcript's text only when the user
//   opens it (Device.device_transcript), for its summary.

import { Auth, type Store } from "./Auth.ts";

// Types
// =====

// the user's OAuth client (from the JSON Google Cloud gives: "installed")
export type Client = { client_id: string; client_secret: string };

// a grant: the tokens, when the access token expires (ms)
type Grant = { access_token: string; refresh_token?: string; expires_at: number };

// where Google is (tests: a fake on 127.0.0.1, with insecure)
export type Ends = { auth: string; token: string; revoke: string; api: string };
export type Opts = { insecure?: boolean; ends?: Ends; wait?: number };

// an event as the cockpit shows it, and a transcript Doc
export type Event = { id: string; title: string; start: string; end: string; meet: string; people: number };
export type Doc = { id: string; title: string; at: string; url: string };

// Constants
// =========

export const ENDS: Ends = {
  auth   : "https://accounts.google.com/o/oauth2/v2/auth",
  token  : "https://oauth2.googleapis.com/token",
  revoke : "https://oauth2.googleapis.com/revoke",
  api    : "https://www.googleapis.com",
};

export const SCOPES = ["https://www.googleapis.com/auth/calendar.events.readonly", "https://www.googleapis.com/auth/drive.readonly"];

// the Keychain's names
const CLIENT = "client";
const GRANT = "grant";

const WAIT = 300e3;
const MARGIN = 120e3;
const DAY = 86400e3;

// the transcripts looked for: Docs this many days old at most, named as
// Meet and Gemini name them
export const DAYS = 14;
export const NAMES = ["Transcript", "Notes by Gemini"];

// the most a transcript's text may be (characters) to be summarized
export const TEXT = 200_000;

let refreshing: Promise<string> | null = null;

// Google
// ======

export namespace Google {

  export type Event = import("./Google.ts").Event;
  export type Doc = import("./Google.ts").Doc;

  export function store(): Store {
    return Auth.keychain("legion-google");
  }

  // a client file Google Cloud gives (its "installed" part), checked
  export function client_read(json: any): Client {
    const c = json?.installed;
    if (typeof c?.client_id !== "string" || !c.client_id.endsWith(".apps.googleusercontent.com") || typeof c.client_secret !== "string" || c.client_secret === "") {
      throw new Error("not a desktop app's OAuth client file (it has an \"installed\" client_id and client_secret).");
    }
    return { client_id: c.client_id, client_secret: c.client_secret };
  }

  function ends(o: Opts): Ends {
    const e = o.ends ?? ENDS;
    Object.values(e).forEach((u) => Auth.safe(u, o));
    return e;
  }

  // a sign-in: the browser sent to Google's consent (offline, so a refresh
  // token comes), one callback taken, the code swapped, the client and
  // grant stored
  export async function login(store: Store, client: Client, o: Opts & { open: (url: string) => unknown }): Promise<void> {
    const e = ends(o);
    const state = Auth.random();
    const verifier = Auth.random();
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
    const back = Promise.withResolvers<string>();
    back.promise.catch(() => {});
    let taken = false;
    const srv = Bun.serve({
      hostname : "127.0.0.1",
      port     : 0,
      fetch(req) {
        const url = new URL(req.url);
        if (req.method !== "GET" || url.pathname !== "/callback" || taken) {
          return new Response("Not found.", { status: 404 });
        }
        taken = true;
        const why = Auth.callback(url.searchParams, state);
        if (why !== null) {
          back.reject(new Error("sign-in failed: " + why));
          return new Response("The sign-in failed: " + why, { status: 400 });
        }
        back.resolve(url.searchParams.get("code")!);
        return new Response("Signed in to Google for Legion. You can close this tab.");
      },
    });
    const redirect = "http://127.0.0.1:" + srv.port + "/callback";
    const wait = o.wait ?? WAIT;
    const timer = setTimeout(() => back.reject(new Error("sign-in failed: no sign-in in " + wait / 1000 + " s.")), wait);
    try {
      const at = new URL(e.auth);
      const params = {
        response_type: "code", client_id: client.client_id, redirect_uri: redirect, scope: SCOPES.join(" "), state,
        code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent",
      };
      Object.entries(params).forEach(([k, v]) => at.searchParams.set(k, v));
      await o.open(at.href);
      const code = await back.promise;
      const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: client.client_id, client_secret: client.client_secret, code_verifier: verifier });
      const tok = await Auth.ask(new URL(e.token), "token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
      const granted = String(tok.scope ?? "").split(" ");
      if (!SCOPES.every((s) => granted.includes(s))) {
        throw new Error("sign-in failed: Google granted less than calendar and Drive reading; sign in again and allow both.");
      }
      await store.set(CLIENT, JSON.stringify(client));
      await store.set(GRANT, JSON.stringify(Google.grant(tok, undefined)));
    } finally {
      clearTimeout(timer);
      srv.stop(true);
    }
  }

  // a token answer as a grant, checked (Auth.grant's checks); a refresh
  // token kept if none new
  export function grant(tok: any, refresh: string | undefined): Grant {
    const g = Auth.grant(tok, { client_id: "", token_endpoint: "", resource: "", ...(refresh ? { refresh_token: refresh } : {}) });
    return { access_token: g.access_token, ...(g.refresh_token ? { refresh_token: g.refresh_token } : {}), expires_at: g.expires_at };
  }

  async function read<T>(store: Store, name: string): Promise<T | null> {
    const raw = await store.get(name);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error("sign in again: legion google-login (the Keychain's entry is unreadable)");
    }
  }

  // an access token, refreshed if near expiry; none: why (signed out)
  export async function token(store: Store, o: Opts = {}): Promise<string> {
    const g = await read<Grant>(store, GRANT);
    const c = await read<Client>(store, CLIENT);
    if (g === null || c === null) {
      throw new Error("not signed in: legion google-login");
    }
    if (g.expires_at - MARGIN > Date.now()) {
      return g.access_token;
    }
    if (!g.refresh_token) {
      throw new Error("sign in again: legion google-login (the token expired, and there is no refresh token)");
    }
    refreshing ??= (async () => {
      try {
        const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: g.refresh_token!, client_id: c.client_id, client_secret: c.client_secret });
        const tok = await Auth.ask(new URL(ends(o).token), "refresh", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
        const next = Google.grant(tok, g.refresh_token);
        await store.set(GRANT, JSON.stringify(next));
        return next.access_token;
      } catch (err: any) {
        throw new Error("sign in again: legion google-login (" + String(err?.message ?? err) + ")");
      }
    })().finally(() => (refreshing = null));
    return refreshing;
  }

  // the grant revoked at Google (its refresh token, else its access token),
  // then deleted with the client; whether there was one
  export async function logout(store: Store, o: Opts = {}): Promise<boolean> {
    const g = await read<Grant>(store, GRANT).catch(() => null);
    if (g !== null) {
      const form = new URLSearchParams({ token: g.refresh_token ?? g.access_token });
      await fetch(ends(o).revoke, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, redirect: "error", signal: AbortSignal.timeout(20e3) }).catch(() => null);
    }
    const had = await store.delete(GRANT);
    await store.delete(CLIENT);
    return had;
  }

  // a GET of Google's API with the token, its JSON; a failure said by its
  // status only
  async function get(path: string, token: string, o: Opts): Promise<any> {
    const url = new URL(ends(o).api + path);
    const res = await fetch(url, { headers: { authorization: "Bearer " + token }, redirect: "error", signal: AbortSignal.timeout(20e3) }).catch(() => null);
    if (res === null || !res.ok) {
      throw new Error("Google: " + (res === null ? "not reachable" : "HTTP " + res.status) + ".");
    }
    return res;
  }

  // today's and tomorrow's events (local days) on the primary calendar:
  // no attendee's address asked for, only their answers (a count)
  export async function events(token: string, now: Date, o: Opts = {}): Promise<Event[]> {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from.getTime() + 2 * DAY);
    const q = new URLSearchParams({
      timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "30",
      fields: "items(id,summary,start,end,hangoutLink,status,attendees(responseStatus))",
    });
    const json = await (await get("/calendar/v3/calendars/primary/events?" + q, token, o)).json();
    return Google.events_read(json);
  }

  export function events_read(json: any): Event[] {
    const items: any[] = Array.isArray(json?.items) ? json.items : [];
    return items.filter((e) => e?.status !== "cancelled" && typeof e?.id === "string").map((e) => ({
      id: e.id, title: String(e.summary ?? "(no title)"), start: String(e.start?.dateTime ?? e.start?.date ?? ""), end: String(e.end?.dateTime ?? e.end?.date ?? ""),
      meet: typeof e.hangoutLink === "string" && e.hangoutLink.startsWith("https://meet.google.com/") ? e.hangoutLink : "",
      people: Array.isArray(e.attendees) ? e.attendees.length : 0,
    }));
  }

  // the transcript Docs of the last DAYS days, newest first
  export async function docs(token: string, now: Date, o: Opts = {}): Promise<Doc[]> {
    const since = new Date(now.getTime() - DAYS * DAY).toISOString();
    const named = NAMES.map((n) => "name contains '" + n + "'").join(" or ");
    const q = new URLSearchParams({
      q: "mimeType = 'application/vnd.google-apps.document' and trashed = false and modifiedTime > '" + since + "' and (" + named + ")",
      orderBy: "modifiedTime desc", pageSize: "50", fields: "files(id,name,modifiedTime,webViewLink)",
    });
    const json = await (await get("/drive/v3/files?" + q, token, o)).json();
    return Google.docs_read(json);
  }

  export function docs_read(json: any): Doc[] {
    const files: any[] = Array.isArray(json?.files) ? json.files : [];
    return files.filter((f) => typeof f?.id === "string" && /^[\w-]+$/.test(f.id)).map((f) => ({
      id: f.id, title: String(f.name ?? ""), at: String(f.modifiedTime ?? ""),
      url: typeof f.webViewLink === "string" && f.webViewLink.startsWith("https://docs.google.com/") ? f.webViewLink : "",
    }));
  }

  // a transcript Doc's text (plain), cut at TEXT; an id not a Drive id refused
  export async function text(token: string, id: string, o: Opts = {}): Promise<string> {
    if (!/^[\w-]{10,100}$/.test(id)) {
      throw new Error("not a Drive file id.");
    }
    const res = await get("/drive/v3/files/" + id + "/export?mimeType=text%2Fplain", token, o);
    return (await res.text()).slice(0, TEXT);
  }

}
