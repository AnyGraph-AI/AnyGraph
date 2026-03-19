export type RiskTier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type BadgeSize = "sm" | "md";

export interface RiskBadgeProps {
  readonly tier: RiskTier;
  readonly size?: BadgeSize;
}

const tierStyles: Record<RiskTier, string> = {
  CRITICAL: "bg-red-500/20 text-red-400",
  HIGH: "bg-orange-500/20 text-orange-400",
  MEDIUM: "bg-yellow-500/20 text-yellow-400",
  LOW: "bg-emerald-500/20 text-emerald-400",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "text-xs px-1.5 py-0.5",
  md: "text-sm px-2 py-1",
};

export function RiskBadge({ tier, size = "md" }: RiskBadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded font-semibold tabular-nums",
        tierStyles[tier],
        sizeStyles[size],
      ].join(" ")}
    >
      {tier}
    </span>
  );
}
