"use client";

import { useRef, KeyboardEvent } from "react";

export interface TabDef {
  readonly key: string;
  readonly label: string;
}

export interface TabsPanelProps {
  readonly tabs: ReadonlyArray<TabDef>;
  readonly activeTab: string;
  readonly onTabChange: (key: string) => void;
  readonly children: React.ReactNode;
}

export function TabsPanel({
  tabs,
  activeTab,
  onTabChange,
  children,
}: TabsPanelProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = tabs.findIndex((t) => t.key === activeTab);
    if (e.key === "ArrowRight") {
      const next = (idx + 1) % tabs.length;
      onTabChange(tabs[next].key);
      tabRefs.current[next]?.focus();
    } else if (e.key === "ArrowLeft") {
      const prev = (idx - 1 + tabs.length) % tabs.length;
      onTabChange(tabs[prev].key);
      tabRefs.current[prev]?.focus();
    }
  };

  return (
    <div className="flex flex-col">
      {/* Tab bar */}
      <div
        role="tablist"
        className="flex border-b border-zinc-800/40"
        onKeyDown={handleKeyDown}
      >
        {tabs.map((tab, i) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.key}`}
              id={`tab-${tab.key}`}
              ref={(el) => { tabRefs.current[i] = el; }}
              tabIndex={isActive ? 0 : -1}
              className={[
                "px-4 py-2 text-sm font-medium transition-colors duration-150 outline-none",
                isActive
                  ? "bg-zinc-800/80 text-zinc-100 border-b-2 border-zinc-100 -mb-px"
                  : "text-zinc-500 hover:text-zinc-300 border-b-2 border-transparent -mb-px",
              ].join(" ")}
              onClick={() => onTabChange(tab.key)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {tabs.map((tab) => (
        <div
          key={tab.key}
          id={`tabpanel-${tab.key}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.key}`}
          className={[
            "transition-opacity duration-200",
            tab.key === activeTab
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none absolute",
          ].join(" ")}
          style={
            tab.key !== activeTab
              ? { position: "absolute", visibility: "hidden" }
              : undefined
          }
        >
          {tab.key === activeTab ? children : null}
        </div>
      ))}
    </div>
  );
}
