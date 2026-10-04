/**
 * Remembers, per child and per browser, which balance a Parent last put most
 * of a payment toward, so the next suggested split can send the leftover
 * there. A convenience only: storage can be blocked or empty, so every access
 * is guarded and the page works without it.
 */
const key = (memberId: string) => `family-ledger:last-split-balance:${memberId}`;

export function readLastUsedBalance(memberId: string): string | null {
  try {
    return window.localStorage.getItem(key(memberId));
  } catch {
    return null;
  }
}

export function writeLastUsedBalance(memberId: string, balanceId: string): void {
  try {
    window.localStorage.setItem(key(memberId), balanceId);
  } catch {
    // Ignore: remembering is optional.
  }
}
