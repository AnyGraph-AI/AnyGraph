/**
 * View Presets — localStorage-backed named view state presets.
 *
 * UI-6 Task 8: Save Current View button storing named presets in localStorage.
 */

const STORAGE_KEY = 'ag-view-presets';
const MAX_PRESETS = 20;

export interface ViewPreset {
  id: string;
  name: string;
  params: string;
  createdAt: number;
}

function generateId(): string {
  return `vp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadPresets(): ViewPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: unknown): p is ViewPreset =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as ViewPreset).id === 'string' &&
        typeof (p as ViewPreset).name === 'string' &&
        typeof (p as ViewPreset).params === 'string' &&
        typeof (p as ViewPreset).createdAt === 'number',
    );
  } catch {
    return [];
  }
}

export function savePreset(name: string, params: string): ViewPreset {
  const preset: ViewPreset = {
    id: generateId(),
    name,
    params,
    createdAt: Date.now(),
  };
  const existing = loadPresets();
  existing.push(preset);
  // Cap at MAX_PRESETS, keeping most recent
  const capped = existing.length > MAX_PRESETS ? existing.slice(existing.length - MAX_PRESETS) : existing;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  return preset;
}

export function deletePreset(id: string): void {
  const existing = loadPresets();
  const filtered = existing.filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}
