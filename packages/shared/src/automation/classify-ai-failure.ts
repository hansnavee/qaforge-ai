/**
 * Prefix failure messages for cockpit "Update cases from findings".
 * Shared by server AI execute, local runner, and heal pipeline.
 */
export function classifyAiFailureMessage(
  raw: string,
  durationMs?: number,
): string {
  const msg = (raw || 'Unknown failure').trim();
  if (
    msg.startsWith('[UI]') ||
    msg.startsWith('[FUNCTIONAL]') ||
    msg.startsWith('[PERF]')
  ) {
    return msg;
  }
  const lower = msg.toLowerCase();
  if (
    /button|getbyrole\(\s*['"]button|click.*not (found|visible|enabled)|unable to click/i.test(
      lower,
    )
  ) {
    return `[FUNCTIONAL] ${msg}`;
  }
  if (
    /locator|timeout|waiting for|strict mode|element|selector|not found|not visible|detached|intercepts pointer|blocked step|unsupported step/i.test(
      lower,
    )
  ) {
    return `[UI] ${msg}`;
  }
  if (typeof durationMs === 'number' && durationMs >= 10_000) {
    return `[PERF] Slow step (${Math.round(durationMs / 1000)}s): ${msg}`;
  }
  return msg;
}
