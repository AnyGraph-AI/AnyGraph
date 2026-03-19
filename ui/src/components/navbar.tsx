'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectionIndicator } from './connection-indicator';
import { AnythingGraphLogo } from './AnythingGraphLogo';

const TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/explorer', label: 'Explorer' },
  { href: '/diagnosis', label: 'Diagnosis' },
  { href: '/gaps', label: 'Gaps' },
  { href: '/fragility', label: 'Fragility' },
] as const;

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0c10]/85 backdrop-blur-xl px-5 py-3">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <AnythingGraphLogo size={26} />
            <span className="text-[17px] font-bold tracking-[-0.02em] text-zinc-100">
              AnythingGraph
            </span>
          </Link>
          <div className="ml-1 flex items-center gap-1">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  pathname === tab.href
                    ? 'bg-[#7ec8e3]/15 text-[#7ec8e3]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>

        <ConnectionIndicator />
      </div>
    </nav>
  );
}
