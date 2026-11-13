// Google login
// ============
// `bun local/google-login.ts [client.json] [--logout]` (legion
// google-login, legion google-logout). RED ZONE draft (Google.ts): signs
// in to Google for the cockpit's calendar, transcripts, mail and Chat, read-only. The
// first time, give the OAuth client file Google Cloud gives for a desktop
// app (OnCorps' project, Internal); it goes to the Keychain with the grant
// and can be deleted after. The browser opens at Google's consent; the
// grant never goes to a file or this terminal. Logout revokes it at Google
// and deletes it. Devices read with it from their next inbox read.

import * as fs from "node:fs";
import { Google, type Client } from "../Google.ts";

const args = process.argv.slice(2);
const store = Google.store();
try {
  if (args.includes("--logout")) {
    console.log((await Google.logout(store)) ? "legion: signed out of Google (revoked)" : "legion: not signed in to Google");
    process.exit(0);
  }
  const file = args.find((a: string) => !a.startsWith("--"));
  const kept = await store.get("client");
  const client: Client | null = file !== undefined ? Google.client_read(JSON.parse(fs.readFileSync(file, "utf8"))) : kept === null ? null : JSON.parse(kept);
  if (client === null) {
    throw new Error("the first time, give the OAuth client file: legion google-login ~/Downloads/client_secret_….json (Google Cloud → APIs & Services → Credentials → an OAuth client of type Desktop app)");
  }
  await Google.login(store, client, {
    open: (url) => {
      console.log("legion: sign in to Google in your browser (it should open; else open this):\n" + url);
      Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
    },
  });
  console.log("legion: signed in to Google (calendar, Drive, Gmail and Chat, read-only)." + (file !== undefined ? " The client is in the Keychain: you may delete " + file + "." : ""));
} catch (err: any) {
  console.error("legion: " + String(err?.message ?? err).split("\n")[0]);
  process.exit(1);
}
