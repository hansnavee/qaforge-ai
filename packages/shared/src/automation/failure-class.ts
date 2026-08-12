export const FAILURE_CLASSES = [
  'ASSERTION',
  'LOCATOR',
  'TIMEOUT',
  'INFRA',
  'UNKNOWN',
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export function classifyFailure(error: string | null | undefined): FailureClass {
  const msg = (error ?? '').toLowerCase();
  if (!msg.trim()) return 'UNKNOWN';
  if (
    /expect\(|assertion|tohave|tobevisible|tohaveurl|tohavetext|strict mode violation.*expect/i.test(
      msg,
    )
  ) {
    return 'ASSERTION';
  }
  if (
    /timeout.*exceeded|timed out|waiting for|locator\.waitfor|waiting until/i.test(
      msg,
    ) &&
    /not found|waiting for locator|element|visible/i.test(msg)
  ) {
    return 'LOCATOR';
  }
  if (
    /locator.*not found|no node found|strict mode violation|unable to find|element is not visible|waiting for locator/i.test(
      msg,
    )
  ) {
    return 'LOCATOR';
  }
  if (/timeout|timed out|net::err_|target closed|browser has been closed/i.test(msg)) {
    if (/net::|econn|socket|browser has been closed|target closed/i.test(msg)) {
      return 'INFRA';
    }
    return 'TIMEOUT';
  }
  if (/net::|econnrefused|enotfound|dns|proxy/i.test(msg)) return 'INFRA';
  return 'UNKNOWN';
}

export function shouldHeal(failureClass: FailureClass): boolean {
  return failureClass === 'LOCATOR' || failureClass === 'TIMEOUT';
}
