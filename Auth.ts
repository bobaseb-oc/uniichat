// Auth
// ====
// RED ZONE (tasks/atlassian-oauth.md): signing in to an MCP server with
// OAuth 2.1, as the MCP spec has it. The authorization server is found
// from the server itself (its 401 names its metadata, RFC 9728, whose
// server's metadata is RFC 8414), checked: https only, issuer and
// resource the ones asked, PKCE S256. A public client is registered
// (RFC 7591) for a callback on 127.0.0.1 at a random port; the browser
// opens the authorize URL (S256, a random state, the resource, RFC 8707);
// one callback is taken, its state compared in constant time, and the
// code swapped for tokens. They are kept only in the Keychain (Bun.secrets),
// never in a file, an argument, the environment, a log or an error. A
// token is refreshed 2 minutes before it expires, once however many ask
// at a time; any failure throws, so the server is skipped (fail closed).

import { timingSafeEqual } from "node:crypto";

// Types
// =====

// where grants are kept, by server name
export type Store = {
  get    : (name: string) => Promise<string | null>;
  set    : (name: string, value: string) => Promise<void>;
  delete : (name: string) => Promise<boolean>;
};

// a server's grant: its client, where to refresh, for what, the tokens
type Grant = {
  client_id      : string;
  token_endpoint : string;
  resource       : string;
  access_token   : string;
  refresh_token? : string;
  expires_at     : number;
};

type Meta = {
  issuer                 : string;
  authorization_endpoint : string;
  token_endpoint         : string;
  registration_endpoint  : string;
};

// insecure: tests only (no config sets it): http allowed on 127.0.0.1
export type Opts = { insecure?: boolean };

// Constants
// =========

const WAIT = 300e3;
const ASK = 20e3;

// how long before its expiry a token is refreshed
const MARGIN = 120e3;

// a token's life when its server gives none
const LIFE = 3600;

// the refreshes under way, by server: the others asking wait on them
const REFRESHING = new Map<string, Promise<string>>();

// Auth
// ====

export namespace Auth {

  // the Keychain: a grant as the generic password of service
  // "<prefix>-<server>", account "oauth"
  export function keychain(prefix: string): Store {
    const at = (name: string) => ({ service: prefix + "-" + name, name: "oauth" });
    return {
      get    : (name) => Bun.secrets.get(at(name)),
      set    : (name, value) => Bun.secrets.set({ ...at(name), value }),
      delete : (name) => Bun.secrets.delete(at(name)),
    };
  }

  // an endpoint, if allowed: https, or (insecure) http on 127.0.0.1
  export function safe(text: string, o: Opts): URL {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error("refused: an endpoint is no URL.");
    }
    if (url.protocol === "https:" || (o.insecure === true && url.protocol === "http:" && url.hostname === "127.0.0.1")) {
      return url;
    }
    throw new Error("refused: " + url.origin + " is not https.");
  }

  // a request's JSON answer; a failure said by its status and OAuth error
  // code only (a server's description may echo what it was sent)
  export async function ask(url: URL, what: string, init: RequestInit = {}): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(ASK) });
    } catch {
      throw new Error(what + ": " + url.origin + " not reachable.");
    }
    const body = await res.json().catch(() => null) as any;
    if (!res.ok) {
      const code = typeof body?.error === "string" && /^[a-z_]{1,40}$/.test(body.error) ? " " + body.error : "";
      throw new Error(what + ": HTTP " + res.status + code + ".");
    }
    if (body === null || typeof body !== "object") {
      throw new Error(what + ": no JSON from " + url.origin + ".");
    }
    return body;
  }

  // a resource's authorization server, from the metadata its 401 names
  // (else at its well-known path), checked (I2-I4)
  export async function discover(resource: string, o: Opts): Promise<Meta> {
    const res = Auth.safe(resource, o);
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "unii", version: "1" } } };
    let named: string | undefined;
    try {
      const probe = await fetch(res, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(init), redirect: "error", signal: AbortSignal.timeout(ASK) });
      await probe.body?.cancel();
      named = probe.headers.get("www-authenticate")?.match(/resource_metadata="([^"]+)"/)?.[1];
    } catch {
      throw new Error("discovery: " + res.origin + " not reachable.");
    }
    const prm = await Auth.ask(Auth.safe(named ?? res.origin + "/.well-known/oauth-protected-resource" + res.pathname, o), "discovery");
    if (prm.resource !== resource) {
      throw new Error("refused: the resource's metadata is for another resource.");
    }
    const issuer = String(prm.authorization_servers?.[0] ?? "");
    const as = Auth.safe(issuer, o);
    const path = as.pathname === "/" ? "" : as.pathname.replace(/\/$/, "");
    const meta = await Auth.ask(new URL(as.origin + "/.well-known/oauth-authorization-server" + path), "discovery")
      .catch(() => Auth.ask(new URL(issuer.replace(/\/$/, "") + "/.well-known/oauth-authorization-server"), "discovery"));
    if (meta.issuer !== issuer) {
      throw new Error("refused: the authorization server's issuer is not " + issuer + ".");
    }
    for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
      Auth.safe(String(meta[key] ?? ""), o);
    }
    if (!Array.isArray(meta.code_challenge_methods_supported) || !meta.code_challenge_methods_supported.includes("S256")) {
      throw new Error("refused: the authorization server offers no PKCE S256.");
    }
    return meta;
  }

  // a sign-in: a client registered, the browser sent to authorize, one
  // callback taken (I5, I6), the code swapped, the grant stored (I1, I7)
  export async function login(name: string, resource: string, store: Store, o: Opts & { open: (url: string) => unknown; wait?: number; scope?: string }): Promise<void> {
    const meta = await Auth.discover(resource, o);
    const state = Auth.random();
    const verifier = Auth.random();
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
    const back = Promise.withResolvers<string>();
    back.promise.catch(() => {}); // handled where awaited; a callback may come before that
    let taken = false;
    const srv = Bun.serve({
      hostname : "127.0.0.1",
      port     : 0,
      fetch(req) {
        const q = new URL(req.url).searchParams;
        if (req.method !== "GET" || new URL(req.url).pathname !== "/callback" || taken) {
          return new Response("Not found.", { status: 404 });
        }
        taken = true;
        const why = Auth.callback(q, state);
        if (why !== null) {
          back.reject(new Error("sign-in failed: " + why));
          return new Response("The sign-in failed: " + why, { status: 400 });
        }
        back.resolve(q.get("code")!);
        return new Response("Signed in to " + name + " for unii. You can close this tab.");
      },
    });
    const redirect = "http://127.0.0.1:" + srv.port + "/callback";
    const wait = o.wait ?? WAIT;
    const timer = setTimeout(() => back.reject(new Error("sign-in failed: no sign-in in " + wait / 1000 + " s.")), wait);
    try {
      const json = { "content-type": "application/json" };
      const client = await Auth.ask(new URL(meta.registration_endpoint), "registration", { method: "POST", headers: json, body: JSON.stringify({
        client_name                : "unii (local)",
        redirect_uris              : [redirect],
        grant_types                : ["authorization_code", "refresh_token"],
        response_types             : ["code"],
        token_endpoint_auth_method : "none",
        ...(o.scope ? { scope: o.scope } : {}),
      }) });
      if (typeof client.client_id !== "string" || client.client_id === "") {
        throw new Error("registration: no client_id.");
      }
      const at = new URL(meta.authorization_endpoint);
      const params = { response_type: "code", client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state, resource, ...(o.scope ? { scope: o.scope } : {}) };
      Object.entries(params).forEach(([k, v]) => at.searchParams.set(k, v));
      await o.open(at.href);
      const code = await back.promise;
      const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: client.client_id, code_verifier: verifier, resource });
      const tok = await Auth.ask(new URL(meta.token_endpoint), "token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
      await store.set(name, JSON.stringify(Auth.grant(tok, { client_id: client.client_id, token_endpoint: meta.token_endpoint, resource })));
    } finally {
      clearTimeout(timer);
      srv.stop(true);
    }
  }

  // why a callback is refused (null: it is not): the server's error, no
  // code, or a state not ours
  export function callback(q: URLSearchParams, state: string): string | null {
    const error = q.get("error");
    if (error !== null) {
      return "the authorization server said " + (/^[a-z_]{1,40}$/.test(error) ? error : "an error") + ".";
    }
    if (!q.get("code")) {
      return "no code.";
    }
    const got = Buffer.from(q.get("state") ?? "");
    const want = Buffer.from(state);
    return got.length === want.length && timingSafeEqual(got, want) ? null : "the state is not this sign-in's.";
  }

  // 32 random bytes, base64url
  export function random(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  }

  // a token answer as a grant, checked; a refresh token kept if none new
  export function grant(tok: any, base: Omit<Grant, "access_token" | "expires_at">): Grant {
    if (typeof tok.access_token !== "string" || tok.access_token === "" || String(tok.token_type ?? "").toLowerCase() !== "bearer") {
      throw new Error("token: no bearer access token.");
    }
    const life = typeof tok.expires_in === "number" && tok.expires_in > 0 ? tok.expires_in : LIFE;
    const refresh = typeof tok.refresh_token === "string" && tok.refresh_token !== "" ? tok.refresh_token : base.refresh_token;
    return { ...base, access_token: tok.access_token, ...(refresh ? { refresh_token: refresh } : {}), expires_at: Date.now() + life * 1000 };
  }

  // a server's access token, refreshed if near expiry (I8, I9)
  export async function token(name: string, store: Store, o: Opts = {}): Promise<string> {
    const raw = await store.get(name);
    if (raw === null) {
      throw new Error("not signed in: unii mcp-login " + name);
    }
    let g: Grant;
    try {
      g = JSON.parse(raw);
    } catch {
      throw new Error("sign in again: unii mcp-login " + name + " (its grant is unreadable)");
    }
    if (g.expires_at - MARGIN > Date.now()) {
      return g.access_token;
    }
    let p = REFRESHING.get(name);
    if (p === undefined) {
      p = Auth.refresh(name, g, store, o).finally(() => REFRESHING.delete(name));
      REFRESHING.set(name, p);
    }
    return p;
  }

  export async function refresh(name: string, g: Grant, store: Store, o: Opts): Promise<string> {
    const again = "sign in again: unii mcp-login " + name;
    if (!g.refresh_token) {
      throw new Error(again + " (the token expired, and there is no refresh token)");
    }
    let next: Grant;
    try {
      const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: g.refresh_token, client_id: g.client_id, resource: g.resource });
      const tok = await Auth.ask(Auth.safe(g.token_endpoint, o), "refresh", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
      next = Auth.grant(tok, g);
    } catch (err: any) {
      throw new Error(again + " (" + err.message + ")");
    }
    await store.set(name, JSON.stringify(next));
    return next.access_token;
  }

  export function logout(name: string, store: Store): Promise<boolean> {
    return store.delete(name);
  }

}
