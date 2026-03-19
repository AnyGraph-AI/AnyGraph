"use client";

import { useEffect, useRef } from "react";

export interface KpiCardProps {
  readonly value: string | number;
  readonly label: string;
  readonly indicator?: React.ReactNode;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function KpiCard({ value, label, indicator }: KpiCardProps) {
  const displayRef = useRef<HTMLSpanElement>(null);
  const numeric = typeof value === "number" ? value : parseFloat(String(value));
  const isNumeric = !isNaN(numeric) && typeof value === "number";

  useEffect(() => {
    if (!isNumeric || !displayRef.current) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      displayRef.current.textContent = String(value);
      return;
    }

    const duration = 300;
    const start = performance.now();

    let raf: number;
    const tick = (now: number) => {
      const elapsed = Math.min(now - start, duration);
      const progress = easeOut(elapsed / duration);
      const current = Math.round(progress * numeric);
      if (displayRef.current) {
        displayRef.current.textContent = current.toLocaleString();
      }
      if (elapsed < duration) {
        raf = requestAnimationFrame(tick);
      } else if (displayRef.current) {
        displayRef.current.textContent = numeric.toLocaleString();
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [numeric, isNumeric, value]);

  return (
    <div
      className="
        group relative flex flex-col gap-1.5 rounded-xl
        border border-zinc-800/60 bg-zinc-900/70 p-4
        backdrop-blur-sm transition-all duration-200
        hover:-translate-y-px hover:shadow-lg hover:shadow-black/30
      "
    >
      <div className="flex items-center justify-between">
        <span className="text-3xl font-bold text-zinc-50 tabular-nums">
          {isNumeric ? (
            <span ref={displayRef}>0</span>
          ) : (
            <span>{value}</span>
          )}
        </span>
        {indicator && (
          <span className="flex items-center">{indicator}</span>
        )}
      </div>
      <span className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
    </div>
  );
}
