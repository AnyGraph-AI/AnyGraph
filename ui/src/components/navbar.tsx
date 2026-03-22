'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectionIndicator } from './connection-indicator';
import { AnythingGraphLogo } from './AnythingGraphLogo';
import { CommandPalette } from './CommandPalette';
import { SaveViewButton } from './SaveViewButton';
import { LoadViewDropdown } from './LoadViewDropdown';
import { CopyLinkButton } from './CopyLinkButton';
import { ACCENT, SURFACE, TEXT } from '@/lib/tokens';

const TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/explorer?mode=neighbors', label: 'Explorer' },
  { href: '/diagnosis?tab=diagnosis', label: 'Diagnosis' },
  { href: '/?view=gaps', label: 'Gaps' },
  { href: '/?view=fragility', label: 'Fragility' },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 backdrop-blur-xl px-5 py-3" style={{ backgroundColor: `${SURFACE.nav}D9` }}>
      <div className="mx-auto flex max-w-[1400px] items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <AnythingGraphLogo size={26} />
            <span className="font-bold tracking-[-0.02em] text-zinc-100" style={{ fontSize: TEXT.base.size }}>
              AnythingGraph
            </span>
          </Link>
          {/* Desktop nav tabs — hidden on mobile */}
          <div className="ml-1 hidden md:flex items-center gap-1">
            {TABS.map((tab) => {
              const isActive = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                    isActive ? '' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                  }`}
                  style={isActive ? { color: ACCENT.info, backgroundColor: `${ACCENT.info}26` } : undefined}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2">
            <SaveViewButton />
            <LoadViewDropdown />
            <CopyLinkButton />
            <CommandPalette />
          </div>
          <ConnectionIndicator />
          {/* Hamburger — visible on mobile only */}
          <button
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setMenuOpen(prev => !prev)}
          >
            <span className={`block h-0.5 w-5 bg-zinc-400 transition-transform duration-200 ${menuOpen ? 'translate-y-2 rotate-45' : ''}`} />
            <span className={`block h-0.5 w-5 bg-zinc-400 transition-opacity duration-200 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-zinc-400 transition-transform duration-200 ${menuOpen ? '-translate-y-2 -rotate-45' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {menuOpen && (
        <div id="mobile-nav-menu" className="md:hidden mt-3 border-t border-white/10 pt-3 pb-2 space-y-1">
          {TABS.map((tab) => {
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => setMenuOpen(false)}
                className={`block rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive ? '' : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                }`}
                style={isActive ? { color: ACCENT.info, backgroundColor: `${ACCENT.info}26` } : undefined}
              >
                {tab.label}
              </Link>
            );
          })}
          <div className="flex items-center gap-2 px-3 pt-2">
            <SaveViewButton />
            <LoadViewDropdown />
            <CopyLinkButton />
            <CommandPalette />
          </div>
        </div>
      )}
    </nav>
  );
}
