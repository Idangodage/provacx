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

// Room detection utilities
export {
  detectRoomsFromWallGraph,
  applyNestedRoomHierarchy,
  validateNestedRooms,
} from './room-detection';

// Wall type utilities
export {
  MATERIAL_LIBRARY,
  BUILT_IN_WALL_TYPES,
  BUILT_IN_WALL_TYPE_IDS,
  DEFAULT_WALL_TYPE_ID,
  getWallTypeRegistry,
  getWallTypeById,
  getWallLayersForType,
  getDefaultLayerPreset,
  snapCoreThickness,
  resolveWallLayers,
  isWallUsingTypeDefault,
  resizeWallTotalThickness,
  addWallLayer,
  removeWallLayer,
  reorderWallLayers,
  updateWallLayerThickness,
  convertWallCoreMaterial,
  resetWallToTypeDefault,
  createWallFromTypeDefaults,
  normalizeWallForTypeSystem,
  getWallTotalThickness,
  getWallRValue,
  getWallUValue,
  getWallCoreThickness,
  getWallFinishThickness,
  getWallLayerAtDepth,
  createWallComputationFacade,
  type WallLayerOperationResult,
  type LayerPresetType,
} from './wall-types';

// Wall orientation utilities
export {
  computeWallOrientation,
  applyWallOrientationMetadata,
  flipWallInteriorExteriorOverride,
  type WallSide,
  type WallOrientationSource,
  type WallOrientationNode,
  type WallOrientationComponent,
  type WallOrientationGraph,
  type WallOrientationData,
  type WallOrientationComputeResult,
  type WallOrientationOptions,
} from './wall-orientation';

// Spatial index utilities
export {
  PackedRTree,
  boundsIntersect,
  inflateBounds,
  type RTreeBounds,
  type RTreeEntry,
} from './rtree';

// Professional wall editing engine
export {
  WallEditorEngine,
  type WallEndpoint,
  type RotationPivot,
  type ThicknessAnchorMode,
  type CollisionPolicy,
  type SelectionMergeMode,
  type SelectionHitMode,
  type DirtyFlags,
  type WallEditorState,
  type WallCollision,
  type WallEditOperationResult,
  type SelectionVisualInfo,
  type WallValidationIssue,
  type CommandLifecycleEvent,
  type WallEditorEvents,
  type WallEditCommand,
  type MutationOptions,
  type MoveWallOptions,
  type ResizeWallOptions,
  type RotateWallOptions,
  type AdjustThicknessOptions,
  type RectangleSelectionOptions,
  type PolygonSelectionOptions,
  type GroupTransformOptions,
  type ParallelMoveOptions,
  type ChainSelectionOptions,
  type ChainTransformOptions,
  type WallEditorEngineOptions,
  type WallEditorEngineInit,
} from './wall-editing';

// Corner constraints and editing
export {
  applyCornerAngleInput,
  applyCornerAngleDrag,
  suggestRectangularCorner,
  snapAngle,
  solveConstraints,
  buildGraphFromWalls,
  detectWallIntersections,
  type Constraint,
  type ConstraintKind,
  type ConstraintViolation,
  type AngleSolveMode,
  type CornerEditInput,
  type CornerEditOptions,
  type SolveResult,
} from './corner-constraints';
