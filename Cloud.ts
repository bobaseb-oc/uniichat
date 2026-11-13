// Cloud
// =====
// Accounts, in one SQLite file: whose they are, and what their calls
// cost them, is their billing's (Billing.ts, which they hold).
//
// Sign-in: an email gets a link (Resend, from noreply@ the site's host; no key:
// printed), "@login" goes through GitHub where the billing takes it; both land
// on /auth?t=<ticket>, where a browser gets a cookie. A terminal posts a token
// it made and waits (/api/wait) while its link's page asks for the code it
// shows (in no link). An emailed link's GET (mail apps open it first) only
// shows a button, whose POST signs in, once. `legion web`: a signed-in
// terminal (its Bearer token, never a cookie) gets a one-minute, one-use
// link for its own account.
// Tokens are kept as hashes. With phones on (UNII_PHONE=1), the iOS app's
// links open it (AASA), its phones get each turn's last message (APNs).

import type { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import * as http2 from "node:http2";
import * as path from "node:path";
import { Billing } from "./Billing.ts";
import * as config from "./Config.ts";
import { Disk } from "./Disk.ts";

// Types
// =====

export type User = { id: string; name: string };

// a sign-in begun: an email or "@" and a GitHub login; the hash of the
// session a terminal waits for; or (`legion web`) the account a signed-in
// terminal opens the site as (who "": not a mailed link, uncounted)
type Ticket = { who: string; session: string | null; user?: User };

// a user's account, in the accounts
export type Account = { cloud: Cloud; user: string };

// the db, its WAL (flushed: Disk.ts); what to tell as a user's balance
// changes, and as a terminal's session is made (to every worker); what
// sends a mail; terminals waiting for a sign-in, by session; the billing
export type Cloud = {
  db      : Database;
  wal     : string;
  change  : (user: string) => void;
  signed  : (session: string) => void;
  post    : (mail: object) => Promise<string | null>;
  waits   : Map<string, () => void>;
  billing : Billing;
  phone   : boolean;
};

// Constants
// =========

const COOKIE = "unii";

// RED ZONE (security review SC, DRAFT awaiting the user's sign-off): a
// session lasts AGE from its sign-in (a terminal's Bearer one, TERM), and
// ends IDLE unused; its last use is written at most once a SEEN
const AGE  = 30 * 864e5;
const TERM = 90 * 864e5;
const IDLE = 14 * 864e5;
const SEEN = 60 * 60 * 1000;

// a session cookie's attributes: Secure only on an https site, as Safari
// drops a Secure cookie an http one (a server on 127.0.0.1) sets
const KEEP = "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + AGE / 1000 + (config.SITE.startsWith("https:") ? "; Secure" : "");

// a session live now, by its row (made, seen, term: Cloud.open's columns)
const LIVE = "made >= ?1 - (case when term = 1 then " + TERM + " else " + AGE + " end) and seen >= ?1 - " + IDLE;

// how long an act's answer with words is kept (ms)
const ACTS = 7 * 864e5;

const LINK    = 15 * 60 * 1000;
const WEB     = 60 * 1000;
const WAIT    = 5 * 60 * 1000;

// sign-in links by address at once (no one mails a victim links; a ticket used
// up leaves the count), and by network a SPAN (no one drains the mail quota):
// an IPv4 address or an IPv6 /48, the most one customer holds (a free tunnel
// gives one), its asks kept in `asks` a SPAN, without the address
const WHO_LINKS = 3;
const IP_LINKS  = 100;
const SPAN      = 24 * 60 * 60 * 1000;

// the connection to APNs, kept open as Apple asks, and the token its
// requests carry, signed again past 40 minutes (Apple takes 20 to 60)
const PUSH = { link: null as http2.ClientHttp2Session | null, jwt: "", at: 0 };
const PUSH_AGE = 40 * 60 * 1000;

// the most a sign-in post may be, read before anyone is signed in
const SMALL_BODY = 16 * 1024;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN = /^@[a-z0-9-]{1,39}$/;

// users: the accounts of a free server (Billing.here), whose ids are
// never reused, so nothing kept by id passes to another account
const SCHEMA = `
create table if not exists sessions (hash text primary key, id text not null, name text not null);
create index if not exists sessions_id on sessions (id);
create table if not exists tickets  (hash text primary key, data text not null, expires integer not null);
create table if not exists asks     (net text not null, at integer not null);
create index if not exists asks_net on asks (net, at);
create table if not exists users    (id integer primary key autoincrement, email text unique not null);
create table if not exists pushes   (token text primary key, session text not null, user text not null);
create index if not exists pushes_user on pushes (user);
create trigger if not exists pushes_go after delete on sessions begin delete from pushes where session = old.hash; end;
create table if not exists acts     (user text not null, id text not null, ans text not null, at integer not null, primary key (user, id));
create index if not exists acts_big on acts (at) where ans <> '{}';
`;

// RED ZONE (security review SC, DRAFT awaiting the user's sign-off): a
// migration, additive: when a session was made and last used, and whether
// a terminal's (TERM); a row from before them starts its age as it runs
const COLUMNS = ["made integer", "seen integer", "term integer not null default 0"];

// Cloud
// =====

export namespace Cloud {

  // the server's processes share it (Server.ts, Disk.db)
  export function open(change: Cloud["change"], signed: Cloud["signed"], post: Cloud["post"]): Cloud {
    const file = path.join(config.DIR, "cloud.db");
    const db = Disk.db(file);
    db.exec(SCHEMA);
    for (const col of COLUMNS) {
      try {
        db.exec("alter table sessions add column " + col);
      } catch (err: any) {
        if (!/duplicate column/.test(String(err?.message))) {
          throw err;
        }
      }
    }
    db.query("update sessions set made = ?1, seen = ?1 where made is null").run(Date.now());
    const base = { db, wal: file + "-wal", change, signed, post, waits: new Map() };
    return { ...base, billing: Billing.open(base), phone: config.PHONE };
  }

  // a terminal's session made: its wait answered, if here
  export function wake(cloud: Cloud, session: string): void {
    cloud.waits.get(session)?.();
  }

  // Sign-in
  // -------

  export function hash(token: string): string {
    return new Bun.CryptoHasher("sha256").update(token).digest("hex");
  }

  export function token(req: Request): string {
    const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const cookies = (req.headers.get("cookie") ?? "").split(/;\s*/);
    const cookie = cookies.find((c) => c.startsWith(COOKIE + "=")) ?? "";
    return auth || decodeURIComponent(cookie.slice(COOKIE.length + 1));
  }

  export function who(cloud: Cloud, req: Request): User | null {
    return Cloud.live(cloud, Cloud.hash(Cloud.token(req)));
  }

  // the user of a session live now (LIVE), its use marked (once a SEEN)
  export function live(cloud: Cloud, hash: string): User | null {
    const now = Date.now();
    const user = cloud.db.query("select id, name from sessions where hash = ?2 and " + LIVE).get(now, hash) as User | null;
    if (user !== null) {
      cloud.db.query("update sessions set seen = ?1 where hash = ?2 and seen < ?3").run(now, hash, now - SEEN);
    }
    return user;
  }

  // one signed in somewhere, by id
  export function user(cloud: Cloud, id: string): User | null {
    return cloud.db.query("select id, name from sessions where id = ?2 and " + LIVE).get(Date.now(), id) as User | null;
  }

  // RED ZONE (security review SC, DRAFT awaiting the user's sign-off): the
  // client's address: the last X-Forwarded-For entry, the one the proxy in
  // front appended (those before it the client may have written); with
  // none (no proxy: a server on 127.0.0.1), the socket's, `addr`
  export function ip(req: Request, addr: string | null = null): string | null {
    return req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || addr;
  }

  // a sign-in post's body, read before anyone is signed in: at most
  // SMALL bytes (said, or counted as it streams); null: bigger
  export const SMALL = SMALL_BODY;
  export async function small(req: Request): Promise<string | null> {
    if (Number(req.headers.get("content-length") ?? 0) > SMALL) {
      return null;
    }
    const parts: Uint8Array[] = [];
    let n = 0;
    for await (const part of req.body ?? []) {
      n += part.length;
      if (n > SMALL) {
        return null;
      }
      parts.push(part);
    }
    return Buffer.concat(parts).toString("utf8");
  }

  export function random(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  }

  // the one email, or @name where GitHub signs in, among the words typed
  // ("@octocat on gh"); null: none, or more
  export function address(text: string, github: boolean): string | null {
    const words = text.toLowerCase().split(/[\s<>()",;:]+/).map((w) => w.replace(/[.!?]+$/, ""));
    const found = words.filter((w) => EMAIL.test(w) || (github && LOGIN.test(w)));
    return found.length === 1 ? found[0] : null;
  }

  // the network an IP counts in (IP_LINKS): IPv4's address (also one
  // written as IPv6, ::ffff:1.2.3.4), IPv6's first 48 bits
  export function net(ip: string): string {
    const v4 = /(\d+\.){3}\d+$/.exec(ip);
    if (v4 !== null || !ip.includes(":")) {
      return v4?.[0] ?? ip;
    }
    const [head, tail = ""] = ip.toLowerCase().split("::");
    const a = head === "" ? [] : head.split(":");
    const b = tail === "" ? [] : tail.split(":");
    const all = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
    return all.slice(0, 3).map((h) => parseInt(h, 16).toString(16)).join(":") + "::/48";
  }

  // a sign-in link asked for `who` from `net` ("": requests with no
  // address, a self-host's, all one network): why it gets none (null: it
  // gets one, counted)
  export function link_ask(cloud: Cloud, who: string, net: string): string | null {
    const now = Date.now();
    const open = cloud.db.query("select count(*) n from tickets where expires >= ? and data ->> 'who' = ?").get(now, who) as { n: number };
    if (open.n >= WHO_LINKS) {
      return "Too many links asked for: use the newest, or wait 15 minutes.";
    }
    const asked = cloud.db.query("select count(*) n from asks where net = ? and at >= ?").get(net, now - SPAN) as { n: number };
    if (asked.n >= IP_LINKS) {
      return "Too many links asked for from your network: try again tomorrow.";
    }
    cloud.db.query("delete from asks where at < ?").run(now - SPAN);
    cloud.db.query("insert into asks values (?, ?)").run(net, now);
    return null;
  }

  // term: a terminal's session (TERM), not a browser's
  export function login(cloud: Cloud, user: User, hash: string, term = false): void {
    const sql = "insert or ignore into sessions (hash, id, name, made, seen, term) values (?1, ?2, ?3, ?4, ?4, ?5)";
    cloud.db.query(sql).run(hash, user.id, user.name, Date.now(), term ? 1 : 0);
  }

  // whether a link not expired still waits for the terminal of a session
  // (the session is logged in, then the ticket used)
  export function ticket_waits(cloud: Cloud, session: string): boolean {
    const sql = "select 1 from tickets where expires >= ? and data ->> 'session' = ?";
    return cloud.db.query(sql).get(Date.now(), session) !== null;
  }

  export function session(cloud: Cloud, user: User): string {
    const token = Cloud.random();
    Cloud.login(cloud, user, Cloud.hash(token));
    return token;
  }

  export function ticket(cloud: Cloud, data: Ticket, ttl: number): string {
    const token = Cloud.random();
    cloud.db.query("delete from tickets where expires < ?").run(Date.now());
    cloud.db.query("insert into tickets values (?, ?, ?)").run(Cloud.hash(token), JSON.stringify(data), Date.now() + ttl);
    return token;
  }

  // a ticket not expired, by its token: used (gone), or kept (the
  // confirm page reads it)
  export function ticket_read(cloud: Cloud, token: string, use: boolean): Ticket | null {
    const sql = use ? "delete from tickets where hash = ? and expires >= ? returning data" : "select data from tickets where hash = ? and expires >= ?";
    const row = cloud.db.query(sql).get(Cloud.hash(token), Date.now()) as { data: string } | null;
    return row === null ? null : JSON.parse(row.data);
  }

  // the six digits a terminal sign-in shows and the user types on the
  // confirm page: proof they hold that terminal (in no email); derived
  // from the session, so nothing extra is stored
  export function code(session: string): string {
    return (parseInt(session.slice(0, 8), 16) % 1e6).toString().padStart(6, "0");
  }

  // Account
  // -------

  // all we hold on a user but their chat: the account, and what its
  // billing holds
  export async function data(cloud: Cloud, user: User): Promise<object> {
    return { id: user.id, name: user.name, ...(await cloud.billing.data(user)) };
  }

  // signs the user out everywhere; then, once their chat rests (Server),
  // close() closes the account, unless its billing can't yet
  export function leave(cloud: Cloud, user: User): void {
    cloud.db.query("delete from sessions where id = ?").run(user.id);
  }

  export async function close(cloud: Cloud, user: User, req: Request): Promise<string | null> {
    const why = await cloud.billing.close(user, req);
    if (why !== null) {
      return why;
    }
    cloud.db.query("delete from users where id = ?").run(user.id);
    cloud.db.query("delete from acts where user = ?").run(user.id);
    return null;
  }

  // Push
  // ----

  // the start of a message, to every phone of the user's (a push token
  // goes with its sign-in); a phone APNs no longer knows is forgotten
  export function push(cloud: Cloud, user: string, text: string): void {
    if (!cloud.phone || !config.APNS || !config.KEYS.apns) {
      return;
    }
    const sql = "select token from pushes where user = ?";
    const phones = cloud.db.query(sql).all(user) as { token: string }[];
    const body = JSON.stringify({ aps: { alert: { body: text.replace(/\s+/g, " ").slice(0, 200) }, sound: "default" } });
    for (const { token } of phones) {
      const link = Cloud.apns();
      const head = { ":method": "POST", ":path": "/3/device/" + token, authorization: "bearer " + PUSH.jwt, "apns-topic": config.APPLE.replace(/^[^.]*\./, ""), "apns-push-type": "alert" };
      const req = link.request(head);
      let out = "";
      req.setEncoding("utf8");
      req.on("data", (got) => (out += got));
      req.on("error", (err) => console.error("push: " + err.message));
      req.on("end", () => {
        if (/Unregistered|BadDeviceToken/.test(out)) {
          cloud.db.query("delete from pushes where token = ?").run(token);
        } else if (out !== "") {
          console.error("push: " + out);
        }
      });
      req.end(body);
    }
  }

  // the connection to APNs, opened again if it closed, and its token
  // signed again if old: the team's, by the key config.APNS names
  export function apns(): http2.ClientHttp2Session {
    if (PUSH.link === null || PUSH.link.closed || PUSH.link.destroyed) {
      const link = (PUSH.link = http2.connect("https://api.push.apple.com"));
      link.on("error", (err) => console.error("push: " + err.message));
      link.on("close", () => PUSH.link === link && (PUSH.link = null));
    }
    if (Date.now() - PUSH.at > PUSH_AGE) {
      const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
      const head = b64({ alg: "ES256", kid: config.APNS }) + "." + b64({ iss: config.APPLE.split(".")[0], iat: Math.floor(Date.now() / 1000) });
      const der = Buffer.from(config.KEYS.apns.replace(/-----[^-]+-----|\s/g, ""), "base64");
      const key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
      const sig = crypto.sign("sha256", Buffer.from(head), { key, dsaEncoding: "ieee-p1363" });
      PUSH.jwt = head + "." + sig.toString("base64url");
      PUSH.at = Date.now();
    }
    return PUSH.link!;
  }

  // Acts
  // ----
  // The acts recorded (Server.ts Chat.act: posts, stops that ended work),
  // by id, kept while the account lives, so none runs again; an answer
  // with words (a recording's) is kept ACTS, then only that it was done

  export function act_put(acct: Account, id: string, ans: object): void {
    const db = acct.cloud.db;
    db.query("update acts set ans = '{}' where at < ? and ans <> '{}'").run(Date.now() - ACTS);
    db.query("insert or ignore into acts values (?, ?, ?, ?)").run(acct.user, id, JSON.stringify(ans), Date.now());
  }

  // null: not done
  export function act_get(acct: Account, id: string): object | null {
    const row = acct.cloud.db.query("select ans from acts where user = ? and id = ?").get(acct.user, id) as { ans: string } | null;
    return row === null ? null : JSON.parse(row.ans);
  }

  // HTTP
  // ----

  // null: not a request of the accounts' API
  export async function http(cloud: Cloud, req: Request, addr: string | null = null): Promise<Response | null> {
    const db = cloud.db;
    const url = new URL(req.url);
    const user = Cloud.who(cloud, req);
    switch (url.pathname) {
      case "/api/login": {
        const text = await Cloud.small(req);
        if (text === null) {
          return Response.json({ error: "Too big." }, { status: 413 });
        }
        const body = Cloud.json(text);
        const github = cloud.billing.github;
        const who = Cloud.address(String(body.who ?? ""), github !== null);
        if (who === null) {
          const error = "Type just your email (you@mail.com)" + (github === null ? "." : " or your GitHub handle (@name).");
          return Response.json({ error }, { status: 400 });
        }
        const refused = Cloud.link_ask(cloud, who, Cloud.net(Cloud.ip(req, addr) ?? ""));
        if (refused !== null) {
          return Response.json({ error: refused }, { status: 429 });
        }
        const session = body.key ? Cloud.hash(String(body.key)) : null;
        const link = config.SITE + "/auth?t=" + Cloud.ticket(cloud, { who, session }, LINK);
        const code = session === null ? {} : { code: Cloud.code(session) };
        if (github !== null && who.startsWith("@")) {
          return Response.json({ url: github(link, who.slice(1)), ...code });
        }
        await Cloud.mail(cloud, who, link, session !== null);
        return Response.json({ ok: true, who, ...code });
      }
      case "/api/web-link": {
        return Cloud.web_link(cloud, req);
      }
      case "/auth": {
        const t = url.searchParams.get("t") ?? "";
        if (req.method === "POST") {
          return Cloud.confirm(cloud, req);
        }
        const link = Cloud.ticket_read(cloud, t, false);
        if (link === null) {
          return Cloud.expired();
        }
        if (link.user !== undefined) {
          return Cloud.web_auth(cloud, t);
        }
        if (link.session !== null) {
          return Cloud.page_confirm(t, link.who, url.searchParams.get("code") ?? "", "");
        }
        // RED ZONE (security review SC, DRAFT awaiting the user's
        // sign-off): an emailed link's GET (a mail app's preview, a
        // scanner) only shows a button; its POST signs in (Cloud.confirm)
        if (!link.who.startsWith("@")) {
          return Cloud.page_sign(t, link.who);
        }
        Cloud.ticket_read(cloud, t, true);
        const account = await cloud.billing.account(link.who, url.searchParams.get("code"), req);
        if (account === null) {
          return Cloud.expired();
        }
        const cookie = COOKIE + "=" + Cloud.session(cloud, account) + KEEP;
        return new Response(null, { status: 302, headers: { location: config.SITE + "/", "set-cookie": cookie } });
      }
      case "/api/wait": {
        if (user !== null) {
          return Response.json({ ok: true });
        }
        const hash = Cloud.hash(Cloud.token(req));
        if (!Cloud.ticket_waits(cloud, hash)) {
          return Response.json({ error: "The sign-in link expired." }, { status: 410 });
        }
        const signed = await new Promise<boolean>((done) => {
          const timer = setTimeout(() => done(false), WAIT);
          cloud.waits.set(hash, () => { clearTimeout(timer); done(true); });
          req.signal.addEventListener("abort", () => { clearTimeout(timer); done(false); });
        });
        cloud.waits.delete(hash);
        return Response.json({ ok: signed }, signed ? {} : { status: 408 });
      }
      case "/.well-known/apple-app-site-association": {
        const links = [{ "/": "/auth" }];
        return cloud.phone && config.APPLE ? Response.json({ applinks: { details: [{ appIDs: [config.APPLE], components: links }] } }) : null;
      }
      case "/api/logout": {
        db.query("delete from sessions where hash = ?").run(Cloud.hash(Cloud.token(req)));
        return Cloud.out();
      }
      // RED ZONE (security review SC, DRAFT awaiting the user's sign-off):
      // signs the user out everywhere (a POST, as every act: Main.http's
      // guards)
      case "/api/logout-all": {
        if (req.method !== "POST") {
          return new Response(null, { status: 405 });
        }
        if (user !== null) {
          Cloud.leave(cloud, user);
        }
        return Cloud.out();
      }
    }
    const billed = await cloud.billing.http(req, user);
    if (billed !== null) {
      return billed;
    }
    if (user === null) {
      return null;
    }
    const billing = cloud.billing;
    switch (url.pathname) {
      case "/api/me": {
        await billing.balance(user.id);
        return Response.json({ id: user.id, name: user.name, bills: billing.bills, credits: billing.credits(user.id) });
      }
      case "/api/account": {
        await billing.balance(user.id);
        return Response.json({ ...(await Cloud.data(cloud, user)), bills: billing.bills, credits: billing.credits(user.id) });
      }
      case "/api/push": {
        if (!cloud.phone) {
          return null;
        }
        const token = (await req.text()).trim();
        if (!/^[0-9a-f]{64,256}$/.test(token)) {
          return Response.json({ error: "Not a push token" }, { status: 400 });
        }
        db.query("insert or replace into pushes values (?, ?, ?)").run(token, Cloud.hash(Cloud.token(req)), user.id);
        return Response.json({ ok: true });
      }
    }
    return null;
  }

  // `legion web`: a terminal signed in asks for a link that opens the site
  // signed in as it. Only its Authorization header counts, never a
  // cookie: a browser can't mint one for itself, nor a cross-site
  // request ride its cookie (it can't set the header without CORS,
  // which this server never grants). Loopback is no proof of anything.
  export function web_link(cloud: Cloud, req: Request): Response {
    if (req.method !== "POST") {
      return new Response(null, { status: 405 });
    }
    const bearer = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
    const user = bearer === "" ? null : Cloud.live(cloud, Cloud.hash(bearer));
    if (user === null) {
      return Response.json({ error: "Sign in first: legion login" }, { status: 401 });
    }
    const t = Cloud.ticket(cloud, { who: "", session: null, user: { id: user.id, name: user.name } }, WEB);
    return Response.json({ url: config.SITE + "/auth?t=" + t });
  }

  // a `legion web` ticket, used up as it's read (one browser, once), gives
  // a session to the account that minted it: no email, no billing lookup
  export function web_auth(cloud: Cloud, t: string): Response {
    const user = Cloud.ticket_read(cloud, t, true)?.user;
    if (user === undefined) {
      return Cloud.expired();
    }
    const cookie = COOKIE + "=" + Cloud.session(cloud, user) + KEEP;
    return new Response(null, { status: 302, headers: { location: config.SITE + "/", "set-cookie": cookie } });
  }

  // the answer that signs a browser out
  export function out(): Response {
    return new Response(null, { status: 204, headers: { "set-cookie": COOKIE + "=; Path=/; Max-Age=0" } });
  }

  // the code typed on the confirm page: right, the terminal signs in: the
  // account (the email's, or the GitHub code's: Billing account), the
  // session, and the terminal waiting on /api/wait woken
  export async function confirm(cloud: Cloud, req: Request): Promise<Response> {
    const text = await Cloud.small(req);
    if (text === null) {
      return new Response("too big", { status: 413 });
    }
    const form = new URLSearchParams(text);
    const t = form.get("t") ?? "";
    const typed = (form.get("code") ?? "").replace(/\D/g, "");
    const github = form.get("github") ?? "";
    const link = Cloud.ticket_read(cloud, t, false);
    if (link !== null && link.session === null && link.user === undefined && !link.who.startsWith("@")) {
      return Cloud.mailed(cloud, t, req);
    }
    if (link === null || link.session === null) {
      return Cloud.expired();
    }
    if (typed !== Cloud.code(link.session)) {
      return Cloud.page_confirm(t, link.who, github, "That code didn't match. Check your terminal and try again.");
    }
    const account = await cloud.billing.account(link.who, github, req);
    if (account === null) {
      return Cloud.expired();
    }
    Cloud.login(cloud, account, link.session, true);
    Cloud.ticket_read(cloud, t, true);
    cloud.signed(link.session);
    return Response.redirect(config.SITE + "/?terminal=1", 302);
  }

  // RED ZONE (security review SC, DRAFT awaiting the user's sign-off): an
  // emailed link's button pressed: its ticket used up as read (once), the
  // email's account gets a browser session
  export async function mailed(cloud: Cloud, t: string, req: Request): Promise<Response> {
    const link = Cloud.ticket_read(cloud, t, true);
    const account = link === null ? null : await cloud.billing.account(link.who, null, req);
    if (account === null) {
      return Cloud.expired();
    }
    const cookie = COOKIE + "=" + Cloud.session(cloud, account) + KEEP;
    return new Response(null, { status: 302, headers: { location: config.SITE + "/", "set-cookie": cookie } });
  }

  // a sign-in post's JSON; {}: none, or not an object
  export function json(text: string): Record<string, unknown> {
    try {
      const got = JSON.parse(text);
      return got !== null && typeof got === "object" ? got : {};
    } catch {
      return {};
    }
  }

  // the site, told the sign-in link expired
  export function expired(): Response {
    return Response.redirect(config.SITE + "/?expired=1", 302);
  }

  // the page a terminal's link opens (the email's, or GitHub's sign-in):
  // it asks for the code the terminal shows
  export function page_confirm(t: string, who: string, github: string, err: string): Response {
    const safe = (s: string) => s.replace(/[<>&"]/g, "");
    const note = err === "" ? "" : `<p class="err">${err}</p>`;
    const body = `<h1>Finish signing in</h1><p>Enter the code shown in your terminal to sign in to <b>${safe(who)}</b>.</p>${note}<form method="post" action="/auth"><input type="hidden" name="t" value="${t}"><input type="hidden" name="github" value="${safe(github)}"><input name="code" inputmode="numeric" autocomplete="off" autofocus aria-label="code"><button type="submit">Confirm</button></form>`;
    return Cloud.page(body);
  }

  // the page an emailed link opens: one button, whose POST signs in
  export function page_sign(t: string, who: string): Response {
    const safe = (s: string) => s.replace(/[<>&"]/g, "");
    return Cloud.page(`<h1>Sign in</h1><p>Sign in to Legion as <b>${safe(who)}</b>.</p><form method="post" action="/auth"><input type="hidden" name="t" value="${safe(t)}"><button type="submit" autofocus>Sign in</button></form>`);
  }

  export function page(body: string): Response {
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Legion</title><link rel="stylesheet" href="/legal.css"></head><body><main>${body}</main></body></html>`;
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  export async function mail(cloud: Cloud, to: string, link: string, terminal: boolean): Promise<void> {
    if (!config.KEYS.resend) {
      console.log("sign-in link for " + to + ": " + link);
      return;
    }
    const ignore = terminal ? "This link signs a unii terminal into your account. If you didn't just start one, ignore this email." : "If you didn't ask for it, ignore this email.";
    const { consent, ...reply } = cloud.billing.mail;
    const text = ["Sign in to Legion:", link, consent, ignore].filter((p) => p !== "").join("\n\n");
    const from = "Legion <noreply@" + new URL(config.SITE).hostname + ">";
    const mail = { from, ...reply, to, subject: "Sign in to Legion", text };
    const err = await cloud.post(mail);
    if (err !== null) {
      throw new Error(err);
    }
  }

}
