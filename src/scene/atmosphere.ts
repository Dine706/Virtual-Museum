// Atmosphere presets (DESIGN.md §1 scene colours, §10 presets) as shared shader uniforms.
// Switching presets cross-fades every value over 1.2 s; nothing is reloaded.
import * as THREE from 'three';
import { WORLD, WORLD_W, WORLD_D } from '../data/geo';

export type AtmoName = 'clear' | 'golden' | 'mist';
export const ATMO_ORDER: AtmoName[] = ['clear', 'golden', 'mist'];

export interface CloudLayerParams { level: number; coverage: number; opacity: number; scale: number }

interface Preset {
  sunAz: number; sunEl: number; sunColor: string; sunIntensity: number;
  zenith: string; horizon: string; horizonAway: string; glow: string; glowIntensity: number;
  ambientSky: string; ambientGround: string; ambient: number;
  fogDensity: number; // per metre at sea level
  mistLevel: number; mistDensity: number; mistAmount: number; mistColor: string; // metres (true scale)
  saturation: number; grade: string; exposure: number;
  clouds: CloudLayerParams[]; // 3 layers; levels in true metres
}

const PRESETS: Record<AtmoName, Preset> = {
  clear: {
    sunAz: 135, sunEl: 52, sunColor: '#FFF4E2', sunIntensity: 3.5,
    zenith: '#8FB6D9', horizon: '#DCE9EF', horizonAway: '#D3E2EC', glow: '#FFF1D6', glowIntensity: 0.25,
    ambientSky: '#B9D2E6', ambientGround: '#56603F', ambient: 0.5,
    fogDensity: 2.1e-5,
    mistLevel: 640, mistDensity: 0.00045, mistAmount: 0.25, mistColor: '#E3ECEF',
    saturation: 1.0, grade: '#FFFFFF', exposure: 0.92,
    clouds: [
      { level: 2900, coverage: 0.2, opacity: 0.85, scale: 3000 },
      { level: 3400, coverage: 0.14, opacity: 0.55, scale: 6000 },
      { level: 1500, coverage: 0.0, opacity: 0.0, scale: 3000 },
    ],
  },
  golden: {
    sunAz: 255, sunEl: 9, sunColor: '#FFD9A0', sunIntensity: 3.4,
    zenith: '#1C4662', horizon: '#F2B26B', horizonAway: '#A9A7AE', glow: '#FFB46E', glowIntensity: 0.7,
    ambientSky: '#6F8FB4', ambientGround: '#40422E', ambient: 0.6,
    fogDensity: 1.6e-5,
    mistLevel: 600, mistDensity: 0.0006, mistAmount: 0.3, mistColor: '#E7C89C',
    saturation: 1.05, grade: '#FFF3E6', exposure: 1.02,
    clouds: [
      { level: 1550, coverage: 0.28, opacity: 0.85, scale: 4200 },
      { level: 3000, coverage: 0.16, opacity: 0.7, scale: 7000 },
      { level: 1450, coverage: 0.0, opacity: 0.0, scale: 3000 },
    ],
  },
  mist: {
    sunAz: 110, sunEl: 24, sunColor: '#F6F1E6', sunIntensity: 2.2,
    zenith: '#9FB3BC', horizon: '#E6ECEB', horizonAway: '#DDE5E6', glow: '#FFF8EC', glowIntensity: 0.35,
    ambientSky: '#C7D3D6', ambientGround: '#5D6656', ambient: 0.85,
    fogDensity: 4.6e-5,
    mistLevel: 1350, mistDensity: 0.0016, mistAmount: 1.0, mistColor: '#EEF2F1',
    saturation: 0.78, grade: '#F4F8F8', exposure: 1.0,
    clouds: [
      { level: 1330, coverage: 0.96, opacity: 0.97, scale: 3600 },
      { level: 1400, coverage: 0.7, opacity: 0.75, scale: 2400 },
      { level: 1470, coverage: 0.35, opacity: 0.6, scale: 1700 },
    ],
  },
};

const lin = (hex: string) => new THREE.Color(hex); // THREE converts sRGB hex to linear working space

/** Live (interpolated) state, mirrored into the uniforms each frame of a transition. */
interface State {
  sunAz: number; sunEl: number; sunColor: THREE.Color; zenith: THREE.Color; horizon: THREE.Color; horizonAway: THREE.Color; glow: THREE.Color;
  ambientSky: THREE.Color; ambientGround: THREE.Color; fogDensity: number;
  mistLevel: number; mistDensity: number; mistAmount: number; mistColor: THREE.Color;
  saturation: number; grade: THREE.Color; exposure: number; clouds: CloudLayerParams[];
}

function toState(p: Preset): State {
  return {
    sunAz: p.sunAz, sunEl: p.sunEl,
    sunColor: lin(p.sunColor).multiplyScalar(p.sunIntensity),
    zenith: lin(p.zenith), horizon: lin(p.horizon), horizonAway: lin(p.horizonAway), glow: lin(p.glow).multiplyScalar(p.glowIntensity),
    ambientSky: lin(p.ambientSky).multiplyScalar(p.ambient), ambientGround: lin(p.ambientGround).multiplyScalar(p.ambient),
    fogDensity: p.fogDensity, mistLevel: p.mistLevel, mistDensity: p.mistDensity, mistAmount: p.mistAmount, mistColor: lin(p.mistColor),
    saturation: p.saturation, grade: lin(p.grade), exposure: p.exposure,
    clouds: p.clouds.map((c) => ({ ...c })),
  };
}

export class Atmosphere {
  readonly uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSkyZenith: { value: new THREE.Color() },
    uSkyHorizon: { value: new THREE.Color() },
    uSkyHorizonAway: { value: new THREE.Color() },
    uSkyGlow: { value: new THREE.Color() },
    uAmbientSky: { value: new THREE.Color() },
    uAmbientGround: { value: new THREE.Color() },
    uFogDensity: { value: 0 },
    uFogFalloff: { value: 0 },
    uMistLevel: { value: 0 },
    uMistDensity: { value: 0 },
    uMistAmount: { value: 0 },
    uMistColor: { value: new THREE.Color() },
    uSaturation: { value: 1 },
    uGrade: { value: new THREE.Color(1, 1, 1) },
    uTime: { value: 0 },
    uWorld: { value: new THREE.Vector4(WORLD.minX, WORLD.minZ, WORLD_W, WORLD_D) },
    uExag: { value: 1 },
  };
  name: AtmoName;
  state: State;
  exposure = 1;
  private onChange = new Set<() => void>();

  constructor(initial: AtmoName, exag: number) {
    this.name = initial;
    this.state = toState(PRESETS[initial]);
    this.uniforms.uExag.value = exag;
    // Fog falls off with altitude: valleys hazier than the ridge (falloff per scene unit).
    this.uniforms.uFogFalloff.value = 1 / (1800 * exag);
    this.apply();
  }

  subscribe(fn: () => void) { this.onChange.add(fn); }

  private apply() {
    const s = this.state, u = this.uniforms, e = u.uExag.value;
    const az = THREE.MathUtils.degToRad(s.sunAz), el = THREE.MathUtils.degToRad(s.sunEl);
    u.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    u.uSunColor.value.copy(s.sunColor);
    u.uSkyZenith.value.copy(s.zenith);
    u.uSkyHorizon.value.copy(s.horizon);
    u.uSkyHorizonAway.value.copy(s.horizonAway);
    u.uSkyGlow.value.copy(s.glow);
    u.uAmbientSky.value.copy(s.ambientSky);
    u.uAmbientGround.value.copy(s.ambientGround);
    u.uFogDensity.value = s.fogDensity;
    u.uMistLevel.value = s.mistLevel * e;
    u.uMistDensity.value = s.mistDensity / e;
    u.uMistAmount.value = s.mistAmount;
    u.uMistColor.value.copy(s.mistColor);
    u.uSaturation.value = s.saturation;
    u.uGrade.value.copy(s.grade);
    this.exposure = s.exposure;
    this.onChange.forEach((f) => f());
  }

  /** Cross-fade to a preset. Returns an animator for the stage (or applies instantly). */
  transition(to: AtmoName, durationMs = 1200): ((dt: number, now: number) => boolean) | null {
    this.name = to;
    const a = this.state;
    const from: State = { ...a, sunColor: a.sunColor.clone(), zenith: a.zenith.clone(), horizon: a.horizon.clone(), horizonAway: a.horizonAway.clone(), glow: a.glow.clone(),
      ambientSky: a.ambientSky.clone(), ambientGround: a.ambientGround.clone(), mistColor: a.mistColor.clone(), grade: a.grade.clone(),
      clouds: a.clouds.map((c) => ({ ...c })) };
    const target = toState(PRESETS[to]);
    if (durationMs <= 0) { this.state = target; this.apply(); return null; }
    const start = performance.now();
    let dAz = target.sunAz - from.sunAz;
    if (dAz > 180) dAz -= 360;
    if (dAz < -180) dAz += 360;
    return (_dt, now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = t * t * (3 - 2 * t);
      const s = this.state;
      const L = (x: number, y: number) => x + (y - x) * k;
      s.sunAz = from.sunAz + dAz * k; s.sunEl = L(from.sunEl, target.sunEl);
      s.sunColor.lerpColors(from.sunColor, target.sunColor, k);
      s.zenith.lerpColors(from.zenith, target.zenith, k);
      s.horizon.lerpColors(from.horizon, target.horizon, k);
      s.horizonAway.lerpColors(from.horizonAway, target.horizonAway, k);
      s.glow.lerpColors(from.glow, target.glow, k);
      s.ambientSky.lerpColors(from.ambientSky, target.ambientSky, k);
      s.ambientGround.lerpColors(from.ambientGround, target.ambientGround, k);
      s.fogDensity = L(from.fogDensity, target.fogDensity);
      // Mist: move the level while fading the amount, so the cloud sea rises/sinks rather than popping.
      s.mistLevel = L(from.mistLevel, target.mistLevel);
      s.mistDensity = L(from.mistDensity, target.mistDensity);
      s.mistAmount = L(from.mistAmount, target.mistAmount);
      s.mistColor.lerpColors(from.mistColor, target.mistColor, k);
      s.saturation = L(from.saturation, target.saturation);
      s.grade.lerpColors(from.grade, target.grade, k);
      s.exposure = L(from.exposure, target.exposure);
      s.clouds = from.clouds.map((c, i) => {
        const d = target.clouds[i];
        return { level: L(c.level, d.level), coverage: L(c.coverage, d.coverage), opacity: L(c.opacity, d.opacity), scale: L(c.scale, d.scale) };
      });
      this.apply();
      return t < 1;
    };
  }
}

export function nextAtmo(a: AtmoName): AtmoName {
  return ATMO_ORDER[(ATMO_ORDER.indexOf(a) + 1) % ATMO_ORDER.length];
}
