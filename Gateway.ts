// Gateway
// =======
// The LiteLLM gateway's daily budget for the key the server calls models
// with, for the status line (a spent one fails at once: Agent.verdict): its
// team membership's spend, cap and reset, read with that same key from
// /key/info (its team and user) and /team/info (the members' budgets).
// Only this member's three numbers are kept; every other member's row,
// and the team's keys, are dropped as read. Each read waits at most WAIT;
// a failure of any kind is no budget, never a throw.

export type Budget = { spend: number; max: number; reset: string | null };

const WAIT = 10e3;

export async function gateway_budget(base: string, key: string, get: typeof fetch = fetch): Promise<Budget | null> {
  const read = async (path: string) => {
    const res = await get(base + path, { headers: { authorization: "Bearer " + key }, signal: AbortSignal.timeout(WAIT) });
    return res.ok ? await res.json() : null;
  };
  try {
    const k = await read("/key/info");
    const info = k?.info ?? k;
    if (typeof info?.team_id !== "string" || typeof info?.user_id !== "string") {
      return null;
    }
    const team = await read("/team/info?team_id=" + encodeURIComponent(info.team_id));
    const me = (Array.isArray(team?.team_memberships) ? team.team_memberships : []).find((m: any) => m?.user_id === info.user_id);
    const cap = me?.litellm_budget_table;
    if (typeof me?.spend !== "number" || typeof cap?.max_budget !== "number") {
      return null;
    }
    return { spend: me.spend, max: cap.max_budget, reset: typeof cap.budget_reset_at === "string" ? cap.budget_reset_at : null };
  } catch {
    return null;
  }
}
