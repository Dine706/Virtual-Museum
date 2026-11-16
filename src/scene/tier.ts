// Device tiering (CLAUDE.md §7). Detected once; ?tier= overrides; the FPS watchdog (M8) can step down.
export type Tier = 'high' | 'mid' | 'low';

export interface TierSpec {
  tier: Tier;
  segments: number; // terrain grid segments per side
  terrarium: 'terrarium.png' | 'terrarium_504.png';
  terrariumBytes: number;
  dprCap: number;
  shadowSteps: number; // terrain self-shadow ray-march steps (0 = off)
  clouds: 0 | 1 | 2 | 3; // cloud layers
  antialias: boolean;
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { tier: 'high', segments: 504, terrarium: 'terrarium.png', terrariumBytes: 2024075, dprCap: 2, shadowSteps: 24, clouds: 3, antialias: true },
  mid: { tier: 'mid', segments: 256, terrarium: 'terrarium_504.png', terrariumBytes: 531402, dprCap: 1.5, shadowSteps: 12, clouds: 2, antialias: true },
  low: { tier: 'low', segments: 160, terrarium: 'terrarium_504.png', terrariumBytes: 531402, dprCap: 1, shadowSteps: 0, clouds: 0, antialias: false },
};

const KEY = 'nimba.tier';

export function detectTier(override: string | null): TierSpec {
  if (override === 'high' || override === 'mid' || override === 'low') return TIERS[override];
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'high' || saved === 'mid' || saved === 'low') return TIERS[saved];
  } catch { /* ignore */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  if (mem <= 2 || cores <= 2) return TIERS.low;
  if (coarse || small || mem < 4 || cores < 6) return TIERS.mid;
  return TIERS.high;
}

export function saveTier(t: Tier | null) {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function savedTier(): Tier | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'high' || v === 'mid' || v === 'low' ? v : null;
  } catch { return null; }
}
