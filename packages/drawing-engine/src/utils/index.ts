/**
 * Utility Module Index
 * 
 * Re-exports all utility functions for the smart-drawing package.
 */

// Geometry utilities
export {
  generateId,
  clamp,
  roundToNearest,
  roundValue,
  lerp,
  lerpPoint,
  distance,
  distanceSquared,
  midpoint,
  angleBetween,
  normalOffset,
  rotatePoint,
  calculatePolygonArea,
  calculateCentroid,
  polygonBounds,
  isPointInPolygon,
  distancePointToSegment,
  segmentsIntersect,
  lineIntersection,
  polylineLength,
  projectPointToPolyline,
  simplifyPolyline,
  findNearestWall,
  mergeBounds,
  expandBounds,
  buildArcPath,
  buildRevisionCloudPath,
  sampleCatmullRom,
  countBy,
} from './geometry';

// Spline utilities
export {
  DEFAULT_SPLINE_SETTINGS,
  buildSplinePath,
  getSplineTypes,
  interpolateSpline,
} from './spline';

// Duct plan utilities
export {
  buildDuctDefaults,
  buildBranchRoute,
  buildDuctPlan,
  generateBoqSummary,
  type DuctDefaults,
} from './duct-plan';
