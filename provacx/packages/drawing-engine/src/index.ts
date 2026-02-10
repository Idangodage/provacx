/**
 * @provacx/smart-drawing
 * 
 * Professional HVAC CAD drawing package for ProvacX.
 * Provides a complete drawing editor with Fabric.js canvas,
 * HVAC symbol library, and industry-standard CAD tools.
 */

// Main Editor Component
export { SmartDrawingEditor, type SmartDrawingEditorProps } from './SmartDrawingEditor';

// Individual Components
export {
  DrawingCanvas,
  Toolbar,
  PropertiesPanel,
  SymbolPalette,
  LayersPanel,
  RoomHierarchyPanel,
  DrawingGrid,
  DrawingRulers,
  DrawingPageLayout,
  ZoomIndicator,
  CoordinatesDisplay,
  type DrawingCanvasProps,
  type ToolbarProps,
  type PropertiesPanelProps,
  type SymbolPaletteProps,
  type LayersPanelProps,
  type RoomHierarchyPanelProps,
  type DrawingGridProps,
  type DrawingRulersProps,
  type DrawingPageLayoutProps,
} from './components';

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
  Wall2D,
  MaterialType,
  MaterialProperties,
  WallLayer,
  WallLayerThicknessConstraint,
  WallTypeDefinition,
  Room2D,
  Sketch2D,
  IndoorUnit2D,
  OutdoorUnit2D,
  DuctSegment2D,
  RefrigerantLine2D,
  DrainLine2D,
  ControlWiring2D,
  HVACLayout2D,
  BoqSummary,
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
  findNearestWall,
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
  // Duct Planning
  buildDuctDefaults,
  buildBranchRoute,
  buildDuctPlan,
  generateBoqSummary,
  detectRoomsFromWallGraph,
  applyNestedRoomHierarchy,
  validateNestedRooms,
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
  type DuctDefaults,
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
