import type { Tier } from '../scene/tier';

export interface WalkSettings {
  fov: number;
  sensitivity: number;
  headBob: boolean;
  reducedMotion: boolean;
  quality: 'auto' | Tier;
}
const KEY = 'nimba.walk.settings.v1';
export const DEFAULT_SETTINGS: WalkSettings = { fov: 72, sensitivity: 1, headBob: true, reducedMotion: false, quality: 'auto' };

export function readSettings(): WalkSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    const p = raw as Record<string, unknown>;
    const finite = (v: unknown, fallback: number, min: number, max: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
    return {
      fov: finite(p.fov, 72, 55, 100), sensitivity: finite(p.sensitivity, 1, 0.25, 2.5),
      headBob: typeof p.headBob === 'boolean' ? p.headBob : true,
      reducedMotion: typeof p.reducedMotion === 'boolean' ? p.reducedMotion : false,
      quality: ['auto', 'high', 'mid', 'low'].includes(String(p.quality)) ? p.quality as WalkSettings['quality'] : 'auto',
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s: WalkSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* Storage is optional. */ }
}
