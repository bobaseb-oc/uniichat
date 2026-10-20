// Export
// ======
// `bun local/prime/export.ts`. The staged documents (redact.ts,
// ~/.unii-prime/staged.json) as a Claude website export
// (~/.unii-prime/context.json), which `/import ~/.unii-prime/context.json`
// reads as it reads any (Import.ts chat_claude): a chat per document,
// named by its kind and path, dated by its file, one message: a header
// naming the file, then its text. The header also keeps a file starting
// "# AGENTS.md" from reading as injected context.

import * as fs from "node:fs";
import { OUT } from "./collect.ts";
import type { Staged } from "./redact.ts";

export function chats(staged: Staged[]): object[] {
  return staged.filter((d) => d.text.trim() !== "").map((d) => ({
    name          : d.kind + ": " + d.path,
    created_at    : d.date,
    chat_messages : [{ sender: "human", created_at: d.date, text: "Context file (" + d.kind + "): " + d.path + "\n\n" + d.text }],
  }));
}

if (import.meta.main) {
  const staged: Staged[] = JSON.parse(fs.readFileSync(OUT + "/staged.json", "utf8"));
  const out = chats(staged);
  fs.writeFileSync(OUT + "/context.json", JSON.stringify(out), { mode: 0o600 });
  console.log("context.json:", out.length, "chats of", staged.length, "staged documents");
}
