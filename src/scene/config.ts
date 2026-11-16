// Scene-wide constants.
/** Default vertical exaggeration (CLAUDE.md §5: at true scale the massif looks flat). */
export const DEFAULT_EXAG = 1.8;
/** Minimum camera height above the terrain (m). The DEM is 30 m: closer looks smooth (CLAUDE.md §6.3). */
export const MIN_CLEARANCE = 700;

export const ORBIT = {
  minPolarDeg: 10, // 90° − max elevation 80°
  maxPolarDeg: 75, // 90° − min elevation 15°: never below the horizon
  minDistance: 700,
  maxDistance: 38000,
};

/** Default orbit after the flyover (CLAUDE.md §6.9): azimuth 215°, elevation 38°, 14 km. */
export const HOME_VIEW = { azimuthDeg: 215, elevationDeg: 38, distance: 14000, target: { lon: -8.425, lat: 7.625, h: 900 } };
