/**
 * Smart Drawing Types
 * 
 * Core type definitions for the HVAC Smart Drawing system.
 * Follows industrial CAD standards with proper separation of concerns.
 */

import type { ReactNode } from 'react';

// =============================================================================
// Geometry Types
// =============================================================================

export interface Point2D {
  x: number;
  y: number;
}

export type DisplayUnit = 'mm' | 'cm' | 'm' | 'ft-in';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface Transform2D {
  position: Point2D;
  rotation: number;
  scale: number;
}

// =============================================================================
// Spline Types (AutoCAD-like)
// =============================================================================

export type SplineType = 'catmullRom' | 'bezier' | 'bspline' | 'nurbs';
export type SplineMethod = 'catmull-rom' | 'bezier' | 'b-spline' | 'nurbs';
export type SplineFitMethod = 'fit-points' | 'control-vertices';
export type KnotParameterization = 'uniform' | 'chord' | 'centripetal' | 'custom';

export interface SplineSettings {
  type?: SplineType;
  method: SplineMethod;
  fitMethod: SplineFitMethod;
  tension: number;
  continuity: number;
  bias: number;
  closed: boolean;
  degree: number;
  fitTolerance: number;
  knotParameterization: KnotParameterization;
  weights?: number[];
  samplesPerSegment?: number;
  showControlPoints: boolean;
  showControlPolygon: boolean;
  showFitPoints: boolean;
  showTangentHandles: boolean;
}

export interface SplineControlPoint {
  position: Point2D;
  tangentIn?: Point2D;
  tangentOut?: Point2D;
  weight?: number;
  isCorner?: boolean;
}

// =============================================================================
// Drawing Elements
// =============================================================================

export type WallType = 'exterior' | 'interior' | 'partition';
export type WallCategory = 'structural' | 'partition' | 'curtain';
export type MaterialType =
  | 'cement-block'
  | 'clay-brick'
  | 'concrete'
  | 'concrete-block'
  | 'gypsum-board'
  | 'plaster'
  | 'putty-skim'
  | 'eps-insulation'
  | 'xps-insulation'
  | 'mineral-wool'
  | 'air-cavity'
  | 'vapor-barrier'
  | 'waterproofing'
  | 'stud-air-gap'
  | 'generic';

export interface MaterialProperties {
  material: MaterialType;
  name: string;
  thermalConductivity: number;
  density: number;
  specificHeatCapacity: number;
}

export interface WallLayer {
  id: string;
  name: string;
  material: MaterialType;
  thickness: number;
  isCore: boolean;
  color: string;
  hatchPattern: string;
  thermalConductivity: number;
  density: number;
  specificHeatCapacity: number;
  order: number;
}

export interface WallLayerThicknessConstraint {
  min: number;
  max?: number;
  step?: number;
}

export interface WallTypeDefinition {
  id: string;
  name: string;
  category: WallCategory;
  layers: WallLayer[];
  totalThickness: number;
  uValue: number;
  defaultHeight: number;
  planTextureId: string;
  sectionTextureId: string;
  coreColor: string;
}

export type OpeningType = 'window' | 'door';
export type SketchType = 
  | 'line' 
  | 'construction-line' 
  | 'polyline' 
  | 'polygon' 
  | 'rectangle' 
  | 'circle' 
  | 'ellipse' 
  | 'arc' 
  | 'spline' 
  | 'revision-cloud'
  | 'freehand'
  | 'pencil';

export type DrawingTool =
  | 'select'
  | 'pan'
  | 'wall'
  | 'wall-line'
  | 'wall-rectangle'
  | 'wall-polyline'
  | 'wall-arc'
  | 'window'
  | 'door'
  | 'room'
  | 'dimension'
  | 'text'
  | 'eraser'
  | 'calibrate'
  | 'line'
  | 'construction-line'
  | 'polyline'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'ellipse'
  | 'arc'
  | 'spline'
  | 'revision-cloud'
  | 'pencil';

export interface Wall2D {
  id: string;
  start: Point2D;
  end: Point2D;
  thickness: number;
  height: number;
  wallType: WallType;
  wallTypeId?: string;
  wallLayers?: WallLayer[];
  isWallTypeOverride?: boolean;
  material?: string;
  color?: string;
  layer?: string;
  connectedWallIds?: string[];
  openings: Opening2D[];
}

export interface Opening2D {
  id: string;
  wallId: string;
  type: OpeningType;
  position: number;
  width: number;
  height: number;
  sillHeight: number;
  material?: string;
}

export interface Room2D {
  id: string;
  name: string;
  wallIds: string[];
  vertices: Point2D[];
  manualParentRoomId?: string | null;
  parentRoomId: string | null;
  childRoomIds: string[];
  grossArea: number;
  netArea: number;
  roomType: 'enclosed-space' | 'remaining-area' | 'surrounding-area';
  area: number;
  perimeter: number;
  spaceType: string;
  floorHeight: number;
  ceilingHeight: number;
  color?: string;
  showTag?: boolean;
}

export interface Dimension2D {
  id: string;
  type: 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter' | 'area';
  points: Point2D[];
  value: number;
  unit: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  text?: string;
  textPosition: Point2D;
  visible: boolean;
}

export interface Annotation2D {
  id: string;
  type: 'text' | 'leader' | 'callout';
  position: Point2D;
  text: string;
  leaderPoints?: Point2D[];
  visible: boolean;
}

export interface Sketch2D {
  id: string;
  type: SketchType;
  points: Point2D[];
  closed?: boolean;
  radius?: number;
  rx?: number;
  ry?: number;
  strokeWidth?: number;
  splineSettings?: SplineSettings;
  controlPoints?: SplineControlPoint[];
  knotVector?: number[];
}

export interface Guide {
  id: string;
  type: 'horizontal' | 'vertical';
  offset: number;
}

// =============================================================================
// Symbol Types
// =============================================================================

export interface Symbol {
  id: string;
  name: string;
  category: string;
  icon: ReactNode;
  svgPath?: string;
  viewBox?: { width: number; height: number };
  defaultWidth: number;
  defaultHeight: number;
  tags: string[];
  favorite?: boolean;
}

export interface SymbolCategory {
  id: string;
  name: string;
  icon: ReactNode;
  symbols: symbol[];
}

export interface SymbolInstance2D {
  id: string;
  symbolId: string;
  position: Point2D;
  rotation: number;
  scale: number;
  flipped: boolean;
  properties: Record<string, unknown>;
}

// =============================================================================
// Import/Calibration Types
// =============================================================================

export type SourceType = 'pdf' | 'image' | 'dxf' | 'ifc' | 'sketch';

export interface CalibrationPoint {
  id: string;
  pixelPoint: Point2D;
  realWorldDistance?: number;
}

export interface ImportedDrawing {
  id: string;
  name: string;
  sourceType: SourceType;
  dataUrl: string;
  originalWidth: number;
  originalHeight: number;
  scale: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  calibrationPoints?: CalibrationPoint[];
}

export interface DetectedElement {
  id: string;
  type: 'wall' | 'door' | 'window' | 'room' | 'text' | 'dimension';
  confidence: number;
  points: Point2D[];
  boundingBox: { x: number; y: number; width: number; height: number };
  metadata?: Record<string, unknown>;
  accepted: boolean;
}

// =============================================================================
// Layer Types
// =============================================================================

export interface DrawingLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  color?: string;
  elements: string[];
}

// =============================================================================
// HVAC Types
// =============================================================================

export type IndoorUnitType = 'wall-mounted' | 'ceiling-cassette' | 'ducted' | 'floor-standing';
export type DuctShape = 'rectangular' | 'round';
export type PipeRouteStyle = 'manhattan' | 'direct';
export type DuctSystem = 'supply' | 'return';
export type PipeSystem = 'refrigerant-liquid' | 'refrigerant-suction' | 'condensate';
export type DiffuserType = 'square' | 'linear' | 'grille';

export interface RoomInput {
  id: string;
  name: string;
  polygon: Point2D[];
  areaM2: number;
  heightM: number;
  requiredCoolingKW?: number;
}

export interface IndoorUnit2D {
  id: string;
  roomId: string;
  type: IndoorUnitType;
  position: Point2D;
  capacityKW: number;
  servedDiffuserIds: string[];
}

export interface OutdoorUnit2D {
  id: string;
  position: Point2D;
  capacityKW: number;
  connectedIndoorIds: string[];
}

export interface Diffuser2D {
  id: string;
  roomId: string;
  type: DiffuserType;
  position: Point2D;
  flowM3s: number;
}

export interface DuctSegment2D {
  id: string;
  system: DuctSystem;
  shape: DuctShape;
  path: Point2D[];
  airflowM3s: number;
  widthMm?: number;
  heightMm?: number;
  diameterMm?: number;
}

export interface PipeSegment2D {
  id: string;
  system: PipeSystem;
  path: Point2D[];
  diameterMm: number;
  insulated: boolean;
}

export interface SmartDrawingLayout {
  rooms: RoomInput[];
  indoorUnits: IndoorUnit2D[];
  outdoorUnits: OutdoorUnit2D[];
  diffusers: Diffuser2D[];
  ducts: DuctSegment2D[];
  pipes: PipeSegment2D[];
  notes: string[];
}

export interface SmartDrawingConfig {
  loadWm2: number;
  diffuserCoverageM2: number;
  ductVelocityMain: number;
  ductVelocityBranch: number;
  ductAspectRatio: number;
  ductMinSizeMm: number;
  ductSizeStepMm: number;
  flexDuctPerDiffuserM: number;
  condensatePerUnitM: number;
}

export interface SmartDrawingOptions {
  unitType: IndoorUnitType;
  ductShape: DuctShape;
  pipeRoute: PipeRouteStyle;
}

// =============================================================================
// BOQ Types
// =============================================================================

export interface BoqLineItem {
  code: string;
  description: string;
  unit: string;
  quantity: number;
}

export interface BoqSummary {
  items: BoqLineItem[];
  totals: Record<string, number>;
}

// =============================================================================
// Page Configuration
// =============================================================================

export interface PageConfig {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
}

export interface PageLayout {
  id: string;
  label: string;
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
}

// =============================================================================
// History Types
// =============================================================================

export interface HistorySnapshot {
  walls: Wall2D[];
  rooms: Room2D[];
  detectedElements: DetectedElement[];
  dimensions: Dimension2D[];
  annotations: Annotation2D[];
  sketches: Sketch2D[];
  symbols: SymbolInstance2D[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  action: string;
  snapshot: HistorySnapshot;
}

// =============================================================================
// Floor Plan Data Export
// =============================================================================

export interface FloorPlanData {
  walls: Wall2D[];
  rooms: Room2D[];
  guides?: Guide[];
  scale: number;
  width: number;
  height: number;
}

// =============================================================================
// Additional HVAC Layout Types (for duct planning)
// =============================================================================

export interface RefrigerantLine2D {
  id: string;
  path: Point2D[];
  diameter: number;
  type: 'liquid' | 'suction';
  fromUnitId: string;
  toUnitId: string;
}

export interface DrainLine2D {
  id: string;
  path: Point2D[];
  diameter: number;
  slope: number;
  fromUnitId: string;
}

export interface ControlWiring2D {
  id: string;
  path: Point2D[];
  type: 'power' | 'communication';
  fromId: string;
  toId: string;
}

export interface HVACLayout2D {
  id: string;
  indoorUnits: IndoorUnit2D[];
  outdoorUnits: OutdoorUnit2D[];
  ductSegments: DuctSegment2D[];
  refrigerantLines: RefrigerantLine2D[];
  drainLines: DrainLine2D[];
  controlWiring: ControlWiring2D[];
}
