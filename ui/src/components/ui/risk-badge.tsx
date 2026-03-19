export type RiskTier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type BadgeSize = "sm" | "md";

export interface RiskBadgeProps {
  readonly tier: RiskTier;
  readonly size?: BadgeSize;
}

const tierStyles: Record<RiskTier, string> = {
  CRITICAL: "bg-red-500/15 text-red-400 border-red-400/30",
  HIGH: "bg-orange-500/15 text-orange-400 border-orange-400/30",
  MEDIUM: "bg-yellow-500/15 text-yellow-400 border-yellow-400/30",
  LOW: "bg-emerald-500/15 text-emerald-400 border-emerald-400/30",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "text-[10px] px-2 py-0.5",
  md: "text-xs px-2.5 py-1",
};

export function RiskBadge({ tier, size = "md" }: RiskBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-md border font-semibold tabular-nums font-mono tracking-[0.05em]",
        tierStyles[tier],
        sizeStyles[size],
      ].join(" ")}
    >
      {tier}
    </span>
  );
}
