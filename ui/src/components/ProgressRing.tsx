export interface ProgressRingProps {
  readonly value: number;
  readonly max: number;
  readonly color?: string;
  readonly label: string;
  readonly size?: number;
}

export function ProgressRing({
  value,
  max,
  color = '#7ec8e3',
  label,
  size = 56,
}: ProgressRingProps) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 500ms ease-out' }}
        />
      </svg>
      <div>
        <div className="text-[13px] font-semibold text-zinc-200 font-mono tabular-nums">
          {value}
          <span className="text-zinc-500">/{max}</span>
        </div>
        <div className="text-[10px] uppercase tracking-[0.10em] text-zinc-500">{label}</div>
      </div>
    </div>
  );
}
