"use client";

import { useEffect, useRef, useState } from "react";

export interface ProgressBarProps {
  readonly value: number;
  readonly label: string;
  readonly variant?: "success" | "warning" | "default";
}

const variantColors: Record<NonNullable<ProgressBarProps["variant"]>, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  default: "bg-blue-500",
};

export function ProgressBar({
  value,
  label,
  variant = "default",
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const [width, setWidth] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      setWidth(clamped);
    } else {
      // Defer one frame so the transition fires
      requestAnimationFrame(() => setWidth(clamped));
    }
  }, [clamped]);

  const fillColor = variantColors[variant];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="text-xs text-zinc-400 tabular-nums">{clamped}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${fillColor} transition-[width] duration-500 ease-out`}
          style={{ width: `${width}%` }}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
