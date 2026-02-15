/**
 * @provacx/smart-drawing
 *
 * Professional CAD drawing package for ProvacX.
 * Provides a complete drawing editor with Fabric.js canvas,
 * symbol library, and CAD tools.
 */

// Main Editor Component
export { SmartDrawingEditor, type SmartDrawingEditorProps } from './SmartDrawingEditor';

// Individual Components
export {
  DrawingCanvas,
  Toolbar,
  PropertiesPanel,
  SymbolPalette,
  DrawingGrid,
  DrawingRulers,
  DrawingPageLayout,
  ZoomIndicator,
  CoordinatesDisplay,
  type DrawingCanvasProps,
  type ToolbarProps,
  type PropertiesPanelProps,
  type SymbolPaletteProps,
  type DrawingGridProps,
  type DrawingRulersProps,
  type DrawingPageLayoutProps,
} from './components';

// Spatial hash for interaction proximity detection
export {
  SpatialHash,
  boundsIntersect as spatialHashBoundsIntersect,
  pointBounds,
  getCoveredCells,
  type HashBounds,
  type SpatialHashItem,
} from './components/canvas/spatial-hash';

// Store
export { useSmartDrawingStore, type SmartDrawingState } from './store';

// Types
export type {
  Point2D,
  Bounds,
  DisplayUnit,
  SplineType,
  SplineSettings,
  DrawingTool,
  Sketch2D,
  PageConfig,
  DrawingLayer,
  HistoryEntry,
} from './types';

// Utilities
export {
  // Geometry
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
  mergeBounds,
  expandBounds,
  buildArcPath,
  buildRevisionCloudPath,
  sampleCatmullRom,
  countBy,
  // Splines
  DEFAULT_SPLINE_SETTINGS,
  buildSplinePath,
  getSplineTypes,
  interpolateSpline,
  // Spatial index
  PackedRTree,
  boundsIntersect,
  inflateBounds,
  type RTreeBounds,
  type RTreeEntry,
} from './utils';

// Symbol Library
export {
  SYMBOL_LIBRARY,
  SYMBOL_CATEGORIES,
  getSymbolById,
  getSymbolsByCategory,
  searchSymbols,
  getCategoryLabel,
  type SymbolDefinition,
  type SymbolCategory,
} from './data';

// Professional architecture modules
export {
  ProfessionalFloorPlanKernel,
  ParametricModelEngine,
  solveParametricModel,
  PrecisionToolkit,
  parseCoordinateInput,
  FloorPlanSpatialIndex,
  computeLodDecision,
  cullWallsForViewport,
  cullRoomsForViewport,
  DirtyRegionTracker,
  batchWallsByStyle,
  LazyFloorPlanMetrics,
  CommandHistoryManager,
  SnapshotCommand,
  createFloorPlanFile,
  serializeFloorPlanFile,
  parseFloorPlanFile,
  migrateFloorPlanFile,
  exportFloorPlanToSvg,
  exportFloorPlanToDxf,
  exportFloorPlanToPdfModel,
  importFloorPlanFromJson,
  importFloorPlanFromDxf,
  FLOOR_PLAN_SCHEMA_ID,
  CURRENT_FLOOR_PLAN_VERSION,
  FLOOR_PLAN_JSON_SCHEMA,
  type LinearDimensionConstraint,
  type DimensionChainConstraint,
  type ParameterDefinition,
  type ParametricDiagnostic,
  type ParametricSolveResult,
  type ParametricSolveInput,
  type CoordinateInputMode,
  type CoordinateInputContext,
  type CoordinateInputResult,
  type DistanceMeasurement,
  type AngleMeasurement,
  type AreaMeasurement,
  type ViewportBounds,
  type VertexRef,
  type LodLevel,
  type LodDecision,
  type RenderBatch,
  type EditorCommand,
  type HistoryEntry as ProfessionalHistoryEntry,
  type CommandContext,
  type MementoAdapter,
  type FloorPlanFileMetadata,
  type FloorPlanFileEnvelope,
  type FloorPlanFileEnvelopeV1,
  type FloorPlanFileEnvelopeV2,
  type PdfExportModel,
  type IndustryImportResult,
} from './professional';
