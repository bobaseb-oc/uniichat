// Notify
// ======
// A desktop notification from the terminal, as the person's alert says
// (View.ts view_alerts): by UNII_NOTIFY ("osc777", "osc9", "osascript",
// "off"), else as the terminal takes one (TERM_PROGRAM): iTerm's OSC 9,
// macOS Terminal's none (osascript does it), others OSC 777 (Ghostty,
// Terax, WezTerm, foot, kitty). Its text comes from the server (agents'
// names): a sequence carries none of its control characters, OSC 777's
// title none of its field separator, and osascript gets it as arguments,
// its script fixed, so no text is ever run.

export type Way = "osc777" | "osc9" | "osascript" | "off";

const WAYS: Way[] = ["osc777", "osc9", "osascript", "off"];

// C0 and C1 controls, DEL: what could end a sequence or start another
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/g;

const ST = "\x1b\\";

const SCRIPT = ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run"];

export function notify_way(env: Record<string, string | undefined>): Way {
  const asked = env.UNII_NOTIFY as Way | undefined;
  if (asked !== undefined && WAYS.includes(asked)) {
    return asked;
  }
  return env.TERM_PROGRAM === "iTerm.app" ? "osc9" : env.TERM_PROGRAM === "Apple_Terminal" ? "osascript" : "osc777";
}

export function notify_clean(text: string): string {
  return text.replace(CONTROLS, "");
}

// the escape sequence of a notification, OSC 777 or OSC 9
export function notify_osc(way: "osc777" | "osc9", title: string, body: string): string {
  const [t, b] = [notify_clean(title), notify_clean(body)];
  return way === "osc777" ? "\x1b]777;notify;" + t.replace(/;/g, ",") + ";" + b + ST : "\x1b]9;" + t + ": " + b + ST;
}

// osascript's arguments: its fixed script, then the title and body
export function notify_args(title: string, body: string): string[] {
  return [...SCRIPT, notify_clean(title), notify_clean(body)];
}
