/**
 * Pure one-shot celebration rules. No database — the sidebar imports this.
 */

export function shouldFireCelebration(input: {
  milestoneKey: string | null | undefined;
  celebratedKeys: string[];
  reducedMotion: boolean;
}): boolean {
  if (!input.milestoneKey) return false;
  if (input.reducedMotion) return false;
  return !input.celebratedKeys.includes(input.milestoneKey);
}

export function markCelebrated(celebratedKeys: string[], key: string): string[] {
  if (celebratedKeys.includes(key)) return celebratedKeys;
  return [...celebratedKeys, key];
}
