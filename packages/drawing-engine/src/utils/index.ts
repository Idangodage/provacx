/**
 * Utility Module Index
 * 
 * Re-exports all utility functions for the smart-drawing package.
 */

// Coordinate system utilities
export {
  PX_PER_INCH,
  MM_PER_INCH,
  PX_TO_MM,
  MM_TO_PX,
  getMajorStepMm,
  getMinorStepMm,
  screenToWorld,
  worldToScreen,
  pxToMm,
  mmToPx,
  calculateZoomPanOffset,
  formatRulerLabel,
  getDevicePixelRatio,
  snapToDevicePixel,
  getVisibleRange,
} from './coordinates';
export type { ViewportTransform } from './coordinates';

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
