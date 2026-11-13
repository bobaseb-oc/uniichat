// Harvest
// =======
// RED ZONE (tasks/todo.md K5; user's ask 2026-11-13, design D5: drafts
// only, the user approves; this code is a DRAFT for their review before
// merge). The user's Harvest timesheet, from the device, with their own
// personal access token:
//
// - Sign-in: `legion harvest-login` takes the token (Harvest → Developers
//   → Personal access tokens) and the account id (OnCorps': ACCOUNT),
//   checks them with Harvest (GET /users/me), then keeps them in the
//   Keychain only (services "legion-harvest-guarded-token", asked each read;
//   "legion-harvest-account"): never a file, an argument, the
//   environment, a log, an error, the server or a model. The token
//   (RED ZONE, security review SD, DRAFT awaiting the user's sign-off)
//   with no application trusted (Auth.asking): each read, the Submit's
//   or the harvest tool's or an agent's shell's, shows a macOS prompt the
//   user allows (Allow, never Always Allow); a prompt they didn't expect
//   is one to deny.
// - Reads (the agents' harvest tool, read-only): the user's active
//   project and task assignments; their own entries for a range.
// - The one write: post, a new time entry, checked whole (entry_check).
//   It runs only on the user's Submit of drafts they reviewed on the
//   Timesheet page (Device.device_harvest); no agent can call it. Nothing
//   is updated or deleted.

import { Auth, type Store } from "./Auth.ts";

// Types
// =====

export type Creds = { token: string; account: string };
export type Opts = { insecure?: boolean; api?: string };

export type Project = { project_id: number; project: string; code: string; client: string; tasks: { task_id: number; task: string }[] };
export type Entry = { id: number; date: string; hours: number; project_id: number; project: string; task_id: number; task: string; notes: string };

// a time entry to post: checked by entry_check
export type New = { project_id: number; task_id: number; date: string; hours: number; notes: string };

// Constants
// =========

export const API = "https://api.harvestapp.com/v2";

// OnCorps' Harvest account (the shared harvest skill's)
export const ACCOUNT = "540457";

const AGENT = "Legion (OnCorps; local)";
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const NOTES = 2000;
const PAGES = 10;

// Harvest
// =======

export namespace Harvest {

  // RED ZONE (security review SD, DRAFT awaiting the user's sign-off):
  // the token where every read asks the user (Auth.asking), the account
  // id (no secret) where it was (old: Auth.keychain). A token kept by
  // Bun.secrets before (any bun reads it) is moved to the asking store at
  // its first read, then deleted (if it can't be moved, nothing is
  // deleted, and that is said); deleted too when one is kept, and on
  // logout.
  export function store(run: Auth.Run = Auth.security, old: Store = Auth.keychain("legion-harvest")): Store {
    const asked = Auth.asking("legion-harvest-guarded", run); // its own item: the old one (legion-harvest-token) is bun-readable
    const moved = async (): Promise<string | null> => {
      const was = await old.get("token").catch(() => null);
      if (was === null) {
        return null;
      }
      try {
        await asked.set("token", was);
      } catch (err: any) {
        throw new Error("the Harvest token kept by Bun could not be moved to the Keychain (" + String(err?.message ?? err) + "); nothing deleted: legion harvest-login again.");
      }
      await old.delete("token").catch(() => false);
      return was;
    };
    return {
      get    : async (name) => (name === "token" ? (await asked.get(name)) ?? moved() : old.get(name)),
      set    : async (name, value) => {
        if (name === "token") {
          await old.delete(name).catch(() => false);
          return asked.set(name, value);
        }
        return old.set(name, value);
      },
      delete : async (name) => {
        if (name !== "token") {
          return old.delete(name);
        }
        const was = await old.delete(name).catch(() => false);
        return (await asked.delete(name)) || was;
      },
    };
  }

  // the token and account checked with Harvest, then kept; who they are
  export async function login(store: Store, token: string, account: string, o: Opts = {}): Promise<{ id: number; name: string }> {
    const c = { token: token.trim(), account: account.trim() };
    if (!/^\d{1,12}$/.test(c.account)) {
      throw new Error("the account id is digits (OnCorps': " + ACCOUNT + ").");
    }
    if (!/^[\w.-]{10,400}$/.test(c.token)) {
      throw new Error("that is not a Harvest personal access token.");
    }
    const me = await Harvest.me(c, o);
    await store.set("token", c.token);
    await store.set("account", c.account);
    return me;
  }

  export async function logout(store: Store): Promise<boolean> {
    const had = await store.delete("token");
    await store.delete("account");
    return had;
  }

  // the kept token and account; none: why (signed out)
  export async function creds(store: Store): Promise<Creds> {
    const token = await store.get("token");
    const account = await store.get("account");
    if (token === null || account === null) {
      throw new Error("not signed in to Harvest: legion harvest-login");
    }
    return { token, account };
  }

  // a request to Harvest with the token and account; its JSON; a failure
  // said by its status only
  async function ask(c: Creds, path: string, o: Opts, init: RequestInit = {}): Promise<any> {
    const url = Auth.safe((o.api ?? API) + path, o);
    const headers = { authorization: "Bearer " + c.token, "harvest-account-id": c.account, "user-agent": AGENT, "content-type": "application/json" };
    const res = await fetch(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(20e3) }).catch(() => null);
    if (res === null || !res.ok) {
      const why = res?.status === 401 ? " (sign in again: legion harvest-login)" : "";
      throw new Error("Harvest: " + (res === null ? "not reachable" : "HTTP " + res.status) + why + ".");
    }
    return res.json();
  }

  // every page of a list, at most PAGES
  async function all(c: Creds, path: string, key: string, o: Opts): Promise<any[]> {
    const out: any[] = [];
    for (let page = 1; page <= PAGES; page++) {
      const json = await ask(c, path + (path.includes("?") ? "&" : "?") + "page=" + page + "&per_page=100", o);
      out.push(...(Array.isArray(json?.[key]) ? json[key] : []));
      if (!json?.links?.next) {
        break;
      }
    }
    return out;
  }

  export async function me(c: Creds, o: Opts = {}): Promise<{ id: number; name: string }> {
    const u = await ask(c, "/users/me", o);
    if (!Number.isInteger(u?.id)) {
      throw new Error("Harvest: no user for this token.");
    }
    return { id: u.id, name: [u.first_name, u.last_name].filter((x) => typeof x === "string" && x !== "").join(" ") };
  }

  // the user's active projects and their active tasks
  export async function projects(c: Creds, o: Opts = {}): Promise<Project[]> {
    const list = await all(c, "/users/me/project_assignments", "project_assignments", o);
    return list.filter((a) => a?.is_active !== false && Number.isInteger(a?.project?.id)).map((a) => ({
      project_id: a.project.id, project: String(a.project.name ?? ""), code: String(a.project.code ?? ""), client: String(a.client?.name ?? ""),
      tasks: (Array.isArray(a.task_assignments) ? a.task_assignments : []).filter((t: any) => t?.is_active !== false && Number.isInteger(t?.task?.id)).map((t: any) => ({ task_id: t.task.id, task: String(t.task.name ?? "") })),
    }));
  }

  // the user's own entries from one date to another (YYYY-MM-DD)
  export async function entries(c: Creds, from: string, to: string, o: Opts = {}): Promise<Entry[]> {
    if (!DATE.test(from) || !DATE.test(to)) {
      throw new Error("a date is YYYY-MM-DD.");
    }
    const who = await Harvest.me(c, o);
    const list = await all(c, "/time_entries?" + new URLSearchParams({ user_id: String(who.id), from, to }), "time_entries", o);
    return list.filter((e) => Number.isInteger(e?.id)).map((e) => ({
      id: e.id, date: String(e.spent_date ?? ""), hours: Number(e.hours ?? 0), project_id: Number(e.project?.id), project: String(e.project?.name ?? ""),
      task_id: Number(e.task?.id), task: String(e.task?.name ?? ""), notes: String(e.notes ?? ""),
    }));
  }

  // the week of a day, Monday to Sunday (local days)
  export function week(now: Date): { from: string; to: string } {
    const day = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    return { from: day(monday), to: day(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
  }

  // a new entry checked whole: positive whole ids, a real date, 0 < hours
  // <= 24 (hundredths), notes at most NOTES; else why not
  export function entry_check(x: any): New | string {
    if (x === null || typeof x !== "object") {
      return "an entry is an object.";
    }
    const id = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n > 0;
    if (!id(x.project_id) || !id(x.task_id)) {
      return "an entry's project_id and task_id are Harvest's ids.";
    }
    if (typeof x.date !== "string" || !DATE.test(x.date) || Number.isNaN(Date.parse(x.date))) {
      return "an entry's date is YYYY-MM-DD.";
    }
    if (typeof x.hours !== "number" || !(x.hours > 0 && x.hours <= 24) || Math.round(x.hours * 100) !== x.hours * 100) {
      return "an entry's hours are more than 0, at most 24, in hundredths.";
    }
    if (typeof (x.notes ?? "") !== "string" || String(x.notes ?? "").length > NOTES) {
      return "an entry's notes are text, at most " + NOTES + " characters.";
    }
    return { project_id: x.project_id, task_id: x.task_id, date: x.date, hours: x.hours, notes: String(x.notes ?? "") };
  }

  // a new time entry posted (the user's Submit only); its id
  export async function post(c: Creds, x: New, o: Opts = {}): Promise<{ id: number }> {
    const e = Harvest.entry_check(x);
    if (typeof e === "string") {
      throw new Error("not posted: " + e);
    }
    const body = JSON.stringify({ project_id: e.project_id, task_id: e.task_id, spent_date: e.date, hours: e.hours, notes: e.notes });
    const made = await ask(c, "/time_entries", o, { method: "POST", body });
    if (!Number.isInteger(made?.id)) {
      throw new Error("Harvest: no entry made.");
    }
    return { id: made.id };
  }

  // the agents' harvest tool (Machine.ts): reads only
  export async function tool(c: Creds, input: any, now: Date, o: Opts = {}): Promise<string> {
    const action = String(input?.action ?? "");
    switch (action) {
      case "projects": {
        return JSON.stringify(await Harvest.projects(c, o), null, 1);
      }
      case "entries": {
        const w = Harvest.week(now);
        return JSON.stringify(await Harvest.entries(c, String(input.from ?? w.from), String(input.to ?? w.to), o), null, 1);
      }
      default: {
        throw new Error("No harvest action " + action.slice(0, 40) + ": projects or entries (drafts go to the timesheet tool).");
      }
    }
  }

}
