// Harvest login
// =============
// `bun local/harvest-login.ts [--account N] [--logout]` (legion
// harvest-login, legion harvest-logout). RED ZONE draft (Harvest.ts):
// asks for a Harvest personal access token (Harvest → Developers →
// Personal access tokens) with echo off, checks it with Harvest, keeps it
// and the account id (OnCorps' by default) in the Keychain only. Never an
// argument, a file or the environment. Logout deletes them.

import { ACCOUNT, Harvest } from "../Harvest.ts";

const args = process.argv.slice(2);
const store = Harvest.store();

// a line read from the terminal with its echo off
async function hidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const tty = process.stdin.isTTY === true;
  if (tty) {
    Bun.spawnSync(["stty", "-echo"], { stdin: "inherit" });
  }
  try {
    for await (const line of console) {
      return line;
    }
    return "";
  } finally {
    if (tty) {
      Bun.spawnSync(["stty", "echo"], { stdin: "inherit" });
    }
    process.stdout.write("\n");
  }
}

try {
  if (args.includes("--logout")) {
    console.log((await Harvest.logout(store)) ? "legion: Harvest token deleted" : "legion: no Harvest token kept");
    process.exit(0);
  }
  const at = args.indexOf("--account");
  const account = at >= 0 ? String(args[at + 1] ?? "") : ACCOUNT;
  const token = await hidden("Harvest personal access token (https://id.getharvest.com/developers): ");
  const me = await Harvest.login(store, token, account);
  // RED ZONE (security review SD, DRAFT awaiting the user's sign-off)
  console.log("legion: signed in to Harvest as " + (me.name || "user " + me.id) + " (account " + account + "); the token is in the Keychain only, and macOS asks you each time it is read: click Allow (never Always Allow), and Deny a prompt you didn't expect.");
} catch (err: any) {
  console.error("legion: " + String(err?.message ?? err).split("\n")[0]);
  process.exit(1);
}
