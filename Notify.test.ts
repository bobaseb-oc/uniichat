// Notify test
// ===========
// `bun test Notify.test.ts`. A desktop notification from the terminal:
// how (by UNII_NOTIFY, else the terminal), its escape sequence with no
// control characters a server's text could slip in, osascript's text as
// arguments, never as script.

import { expect, test } from "bun:test";
import * as Notify from "./Notify.ts";

test("the way: UNII_NOTIFY, else iTerm's OSC 9, Terminal's osascript, others OSC 777", () => {
  expect(Notify.notify_way({ UNII_NOTIFY: "off", TERM_PROGRAM: "iTerm.app" })).toBe("off");
  expect(Notify.notify_way({ TERM_PROGRAM: "iTerm.app" })).toBe("osc9");
  expect(Notify.notify_way({ TERM_PROGRAM: "Apple_Terminal" })).toBe("osascript");
  expect(Notify.notify_way({})).toBe("osc777");
  expect(Notify.notify_way({ UNII_NOTIFY: "nonsense" })).toBe("osc777");
});

test("the sequences carry no control characters, OSC 777's title no field separator", () => {
  const evil = "Mgr\x07\x1b]52;c;ZXZpbA==\x07;x\n";
  expect(Notify.notify_osc("osc777", evil, "body\x1b[2J")).toBe("\x1b]777;notify;Mgr]52,c,ZXZpbA==,x;body[2J\x1b\\");
  expect(Notify.notify_osc("osc9", "T", "b\x07")).toBe("\x1b]9;T: b\x1b\\");
});

test("osascript gets the text as arguments, its script fixed", () => {
  const args = Notify.notify_args('a" & do shell script "x', "b");
  expect(args.slice(0, 7)).toEqual(["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", 'a" & do shell script "x']);
  expect(args[7]).toBe("b");
});
