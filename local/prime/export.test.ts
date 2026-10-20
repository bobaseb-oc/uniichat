// Export test
// ===========
// `bun test local/prime/export.test.ts`. The staged documents as a Claude
// website export, read back by the importer itself (Import.ts): a chat
// per document, its text whole, under its path.

import { expect, test } from "bun:test";
import * as Import from "../../Import.ts";
import { chats } from "./export.ts";

const STAGED = [
  { kind: "instructions", path: "/Volumes/dev/git/x/AGENTS.md", date: "2026-09-01T10:00:00.000Z", text: "# AGENTS.md\n\nRules." },
  { kind: "doc", path: "/Users/u/Documents/deck.pptx", date: "2024-05-02T08:00:00.000Z", text: "[slide 1]\nRoadmap" },
  { kind: "doc", path: "/Users/u/Downloads/empty.xlsx", date: "2024-05-02T08:00:00.000Z", text: "  \n" },
];

test("each document with text is a chat the importer reads, its text after a header naming it", async () => {
  const sessions = await Import.import_export(new Blob([JSON.stringify(chats(STAGED))]));
  expect(sessions.map((s) => [s.app, s.where, s.start])).toEqual([
    ["Claude", 'chat "instructions: /Volumes/dev/git/x/AGENTS.md"', "2026-09-01T10:00:00.000Z"],
    ["Claude", 'chat "doc: /Users/u/Documents/deck.pptx"', "2024-05-02T08:00:00.000Z"],
  ]);
  const msgs = [];
  for await (const m of Import.import_read(sessions[0])) {
    msgs.push(m);
  }
  expect(msgs).toHaveLength(1);
  expect(msgs[0].kind).toBe("user");
  expect(msgs[0].text).toBe("Context file (instructions): /Volumes/dev/git/x/AGENTS.md\n\n# AGENTS.md\n\nRules.");
});
