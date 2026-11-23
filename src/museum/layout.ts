// Gallery 1 "La montagne / The Mountain": room dimensions, exhibit placement and lights, in metres.
// Room axes: x east-west (west wall x = −W/2), y up, z south-north (north wall with the window at z = −L/2,
// entrance at z = +L/2). Everything that places geometry, bakes light or moves the visitor reads this file.
import * as THREE from 'three';

export const ROOM = { W: 14, L: 24, H: 5 } as const;
export const HX = ROOM.W / 2;
export const HZ = ROOM.L / 2;
export const EYE = 1.6;

/** Relief model of the massif on a plinth, room centre. */
export const RELIEF = { cx: 0, cz: 0.6, size: 3.6, plinth: 4.0, plinthH: 0.86, base: 0.05, exag: 2.0 } as const;
/** Floor-to-ceiling window in the north wall, opening onto the summit view. */
export const WINDOW = { x0: -4.6, x1: 4.6, y0: 0, y1: 4.5 } as const;
/** Ceiling light slot (diffuse daylight). */
export const SKYLIGHT = { x0: -0.8, x1: 0.8, z0: -9.5, z1: 9.5 } as const;
/** Bench facing the window. */
export const BENCH = { cx: 0, cz: -8.2, w: 2.6, d: 0.5, h: 0.46 } as const;
/** Opening in the south wall towards the next gallery. */
export const DOOR = { x0: -1.1, x1: 1.1, h: 3.0, depth: 1.6 } as const;
/** Ceiling track rails for the spotlights (x = ±TRACK_X). */
export const TRACK_X = 5.0;

export interface Box { min: THREE.Vector3; max: THREE.Vector3 }
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box =>
  ({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) });

const P = RELIEF.plinth / 2;
export const PLINTH_BOX = box(RELIEF.cx - P, 0, RELIEF.cz - P, RELIEF.cx + P, RELIEF.plinthH, RELIEF.cz + P);
export const BENCH_BOX = box(BENCH.cx - BENCH.w / 2, 0, BENCH.cz - BENCH.d / 2, BENCH.cx + BENCH.w / 2, BENCH.h, BENCH.cz + BENCH.d / 2);
/** Light occluders for the bake (the relief itself is approximated by a low block on the plinth). */
export const OCCLUDERS: Box[] = [
  PLINTH_BOX,
  box(RELIEF.cx - RELIEF.size / 2, RELIEF.plinthH, RELIEF.cz - RELIEF.size / 2, RELIEF.cx + RELIEF.size / 2, RELIEF.plinthH + 0.16, RELIEF.cz + RELIEF.size / 2),
  BENCH_BOX,
];

// ---------------------------------------------------------------- exhibits
export type Wall = 'west' | 'east';
export type ExhibitKind = 'intro' | 'relief' | 'print' | 'window';

export interface ExhibitDef {
  id: string;
  kind: ExhibitKind;
  /** content.json hotspot shown by this exhibit (prints) */
  hotspot?: string;
  /** photo id printed on the wall (prints) */
  photo?: string;
  wall?: Wall;
  /** centre along the wall (z) */
  z?: number;
}

/** Visiting order (clockwise: intro → relief → peaks on the west wall → window → habitats down the east wall). */
export const EXHIBITS: ExhibitDef[] = [
  { id: 'intro', kind: 'intro', wall: 'west', z: 8.7 },
  { id: 'relief', kind: 'relief' },
  { id: 'richard-molard', kind: 'print', hotspot: 'richard-molard', photo: 'peak-cloudcap', wall: 'west', z: 3.7 },
  { id: 'grands-rochers', kind: 'print', hotspot: 'grands-rochers', photo: 'peak-strata', wall: 'west', z: -1.3 },
  { id: 'pierre-richaud', kind: 'print', hotspot: 'pierre-richaud', photo: 'valley-view', wall: 'west', z: -6.3 },
  { id: 'window', kind: 'window' },
  { id: 'montane-grassland', kind: 'print', hotspot: 'montane-grassland', photo: 'montane-grassland', wall: 'east', z: -9.0 },
  { id: 'cloud-forest', kind: 'print', hotspot: 'cloud-forest', photo: 'cloud-forest', wall: 'east', z: -4.5 },
  { id: 'lowland-forest', kind: 'print', hotspot: 'lowland-forest', photo: 'forest-canopy', wall: 'east', z: 0 },
  { id: 'savanna-fire', kind: 'print', hotspot: 'savanna-fire', photo: 'savanna', wall: 'east', z: 4.5 },
  { id: 'cavally', kind: 'print', hotspot: 'cavally', photo: 'forest-stream', wall: 'east', z: 9.0 },
];

export const PRINT_CY = 1.58; // print centre height
export const INTRO = { w: 4.2, h: 2.3, cy: 1.95 } as const;

/** Wall-plane frame for things hung on a side wall: position along the wall + inward normal + "right" (viewer's right). */
export function wallFrame(wall: Wall) {
  const x = wall === 'west' ? -HX : HX;
  const normal = new THREE.Vector3(wall === 'west' ? 1 : -1, 0, 0);
  // Viewer faces the wall (−normal); their right is −normal × up.
  const right = new THREE.Vector3(0, 0, wall === 'west' ? -1 : 1);
  return { x, normal, right };
}

/** Print size for a photo aspect ratio (≈ 1.35 m tall, ≤ 2.0 m wide). */
export function printSize(aspect: number): { w: number; h: number } {
  const w = Math.min(2.0, 1.36 * aspect);
  return { w, h: w / aspect };
}

// ---------------------------------------------------------------- visitor poses
export interface Pose { x: number; z: number; yaw: number; pitch: number }

/** yaw = 0 looks north (−z); positive yaw turns left (towards −x). */
export const yawTo = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(-(toX - fromX), -(toZ - fromZ));

export const START_POSE: Pose = { x: 1.8, z: 10.6, yaw: 0.2, pitch: -0.06 };

export function exhibitPose(e: ExhibitDef): Pose {
  if (e.kind === 'relief') return { x: RELIEF.cx + 0.5, z: RELIEF.cz + 4.7, yaw: 0.08, pitch: -0.34 };
  if (e.kind === 'window') return { x: 0, z: -5.6, yaw: 0, pitch: 0.02 };
  const f = wallFrame(e.wall!);
  const dist = e.kind === 'intro' ? 4.6 : 2.9;
  const x = f.x + f.normal.x * dist;
  const z = e.z! + f.right.z * (e.kind === 'print' ? 0.35 : 0); // a step to the right: the label is in view
  return { x, z, yaw: yawTo(x, z, f.x, z), pitch: e.kind === 'intro' ? 0.03 : -0.01 };
}

// ---------------------------------------------------------------- lights
export interface Spot { pos: THREE.Vector3; target: THREE.Vector3; cosOuter: number; cosInner: number; intensity: number }

const spot = (pos: THREE.Vector3, target: THREE.Vector3, outerDeg: number, innerDeg: number, intensity: number): Spot =>
  ({ pos, target, cosOuter: Math.cos(THREE.MathUtils.degToRad(outerDeg)), cosInner: Math.cos(THREE.MathUtils.degToRad(innerDeg)), intensity });

export function buildSpots(): Spot[] {
  const S: Spot[] = [];
  const yT = ROOM.H - 0.22;
  for (const e of EXHIBITS) {
    if (e.kind === 'print') {
      const f = wallFrame(e.wall!);
      S.push(spot(new THREE.Vector3(Math.sign(f.x) * TRACK_X, yT, e.z!), new THREE.Vector3(f.x, PRINT_CY - 0.3, e.z!), 24, 10, 40));
    } else if (e.kind === 'intro') {
      const f = wallFrame(e.wall!);
      for (const dz of [-1.2, 1.2]) S.push(spot(new THREE.Vector3(Math.sign(f.x) * TRACK_X, yT, e.z! + dz), new THREE.Vector3(f.x, INTRO.cy, e.z! + dz), 24, 8, 26));
    }
  }
  // Relief: key light from the north-west (cartographic convention), softer fill from the south-east.
  const c = new THREE.Vector3(RELIEF.cx, RELIEF.plinthH + 0.15, RELIEF.cz);
  S.push(spot(new THREE.Vector3(RELIEF.cx - 2.6, yT, RELIEF.cz - 2.4), c.clone(), 34, 20, 60));
  S.push(spot(new THREE.Vector3(RELIEF.cx + 2.4, yT, RELIEF.cz + 2.8), c.clone(), 36, 18, 22));
  return S;
}
