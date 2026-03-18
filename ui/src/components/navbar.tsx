'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectionIndicator } from './connection-indicator';

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
    <nav className="bg-zinc-950 border-b border-zinc-800 px-4 py-3">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-zinc-100 hover:text-white">
            AnythingGraph
          </Link>
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  pathname === tab.href
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
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
