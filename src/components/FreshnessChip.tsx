import type { FreshnessChipState } from "@/components/freshness-chip";

const ERROR_CLASS =
  "text-xs font-medium px-2 py-1 rounded border border-[var(--red)] text-[var(--red)]";

export function FreshnessChip({
  health,
  fallbackLabel,
  className,
  testId = "freshness-chip",
}: {
  health: FreshnessChipState;
  fallbackLabel?: string | null;
  className?: string;
  testId?: string;
}) {
  if (health.kind === "error" && health.href && health.label) {
    return (
      <a
        href={health.href}
        className={className ?? ERROR_CLASS}
        data-testid={testId}
        data-freshness="error"
      >
        {health.label}
      </a>
    );
  }
  if (!fallbackLabel) return null;
  return (
    <span className={className} data-testid={testId}>
      {fallbackLabel}
    </span>
  );
}
