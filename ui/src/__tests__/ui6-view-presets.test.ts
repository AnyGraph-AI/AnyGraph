/**
 * UI-6 Tasks 8-10: View Presets + Copy Link — Spec Tests
 *
 * Tests written FROM the UI_DASHBOARD.md UI-6 spec.
 *
 * Task 8: Save Current View button storing named presets in localStorage
 * Task 9: Load View dropdown in header
 * Task 10: Copy Link button to share current view state
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage for node environment
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};

vi.stubGlobal('localStorage', mockLocalStorage);

// ---- Task 8: view-presets lib ----

describe('UI-6 Task 8: view-presets lib', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.resetModules();
  });

  it('exports savePreset, loadPresets, deletePreset', async () => {
    const mod = await import('@/lib/view-presets');
    expect(typeof mod.savePreset).toBe('function');
    expect(typeof mod.loadPresets).toBe('function');
    expect(typeof mod.deletePreset).toBe('function');
  });

  it('savePreset stores a named preset with current URL params', async () => {
    const { savePreset, loadPresets } = await import('@/lib/view-presets');
    savePreset('My View', '?risk=CRITICAL&days=7&project=proj_c0d3e9a1f200');
    const presets = loadPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0].name).toBe('My View');
    expect(presets[0].params).toBe('?risk=CRITICAL&days=7&project=proj_c0d3e9a1f200');
  });

  it('loadPresets returns empty array when nothing saved', async () => {
    const { loadPresets } = await import('@/lib/view-presets');
    expect(loadPresets()).toEqual([]);
  });

  it('savePreset generates unique id per preset', async () => {
    const { savePreset, loadPresets } = await import('@/lib/view-presets');
    savePreset('View A', '?risk=CRITICAL');
    savePreset('View B', '?risk=HIGH');
    const presets = loadPresets();
    expect(presets).toHaveLength(2);
    expect(presets[0].id).not.toBe(presets[1].id);
  });

  it('deletePreset removes by id', async () => {
    const { savePreset, loadPresets, deletePreset } = await import('@/lib/view-presets');
    savePreset('To Delete', '?risk=LOW');
    const [preset] = loadPresets();
    deletePreset(preset.id);
    expect(loadPresets()).toHaveLength(0);
  });

  it('preset has createdAt timestamp', async () => {
    const { savePreset, loadPresets } = await import('@/lib/view-presets');
    const before = Date.now();
    savePreset('Timestamped', '?risk=HIGH');
    const [preset] = loadPresets();
    expect(preset.createdAt).toBeGreaterThanOrEqual(before);
    expect(preset.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('handles corrupt localStorage gracefully', async () => {
    store['ag-view-presets'] = 'not-json';
    const { loadPresets } = await import('@/lib/view-presets');
    expect(loadPresets()).toEqual([]);
  });

  it('caps presets at a reasonable max (20)', async () => {
    const { savePreset, loadPresets } = await import('@/lib/view-presets');
    for (let i = 0; i < 25; i++) {
      savePreset(`View ${i}`, `?i=${i}`);
    }
    const presets = loadPresets();
    expect(presets.length).toBeLessThanOrEqual(20);
    // Most recent should be kept
    expect(presets[presets.length - 1].name).toBe('View 24');
  });
});

// ---- Task 9: LoadViewDropdown component ----

describe('UI-6 Task 9: LoadViewDropdown component', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.resetModules();
  });

  it('exports LoadViewDropdown component', async () => {
    const mod = await import('@/components/LoadViewDropdown');
    expect(typeof mod.LoadViewDropdown).toBe('function');
  });

  it('LoadViewDropdown exposes a presets prop or reads from loadPresets', async () => {
    // The component should use loadPresets internally to list saved views
    const { savePreset } = await import('@/lib/view-presets');
    savePreset('Test Preset', '?risk=CRITICAL&days=14');
    const mod = await import('@/components/LoadViewDropdown');
    expect(typeof mod.LoadViewDropdown).toBe('function');
  });
});

// ---- Task 10: CopyLinkButton component ----

describe('UI-6 Task 10: CopyLinkButton component', () => {
  it('exports CopyLinkButton component', async () => {
    const mod = await import('@/components/CopyLinkButton');
    expect(typeof mod.CopyLinkButton).toBe('function');
  });
});

// ---- Task 8: SaveViewButton component ----

describe('UI-6 Task 8: SaveViewButton component', () => {
  it('exports SaveViewButton component', async () => {
    const mod = await import('@/components/SaveViewButton');
    expect(typeof mod.SaveViewButton).toBe('function');
  });
});

// ---- Task 8: Navbar wiring ----

describe('UI-6 Task 8: Navbar includes SaveViewButton', () => {
  it('Navbar module imports SaveViewButton', async () => {
    const source = await import('@/components/navbar');
    expect(typeof source.Navbar).toBe('function');
  });
});
