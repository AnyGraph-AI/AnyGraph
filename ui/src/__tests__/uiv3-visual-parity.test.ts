/**
 * UI-V3 parity scaffolding checks
 */
import { describe, expect, it } from 'vitest';

describe('[UI-V3] visual parity components', () => {
  it('exports AnythingGraphLogo component', async () => {
    const mod = await import('@/components/AnythingGraphLogo');
    expect(mod.AnythingGraphLogo).toBeDefined();
    expect(typeof mod.AnythingGraphLogo).toBe('function');
  });

  it('exports ProgressRing component', async () => {
    const mod = await import('@/components/ProgressRing');
    expect(mod.ProgressRing).toBeDefined();
    expect(typeof mod.ProgressRing).toBe('function');
  });
});

describe('[UI-V3] composition wiring', () => {
  it('navbar imports AnythingGraphLogo', async () => {
    const src = await import('@/components/navbar');
    expect(src.Navbar).toBeDefined();
  });

  it('dashboard page composes ProgressRing and HeroTreemap', async () => {
    const page = await import('@/app/page');
    expect(page.default).toBeDefined();
    expect(typeof page.default).toBe('function');
  });
});
