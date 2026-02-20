/**
 * Wall + Room Types
 *
 * Type definitions for architectural drawing and 3D attribute binding.
 * All geometric coordinates are in millimeters internally.
 */

import type { Point2D } from './index';

// =============================================================================
// Basic Types
// =============================================================================

export interface Line {
  start: Point2D;
  end: Point2D;
}

export interface BevelControl {
  outerOffset: number;
  innerOffset: number;
}

export type WallMaterial = 'brick' | 'concrete' | 'partition';
export type WallLayer = 'structural' | 'partition';
export type JoinType = 'miter' | 'butt';
export type RoomType = 'Bathroom/Closet' | 'Bedroom' | 'Living Room' | 'Open Space' | 'Custom';
export type CompassDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type RoomOccupancySchedule = 'daytime' | 'evening' | '24-hour';
export type WallColorMode = 'material' | 'u-value' | 'exposure';
export type SectionLineKind = 'elevation' | 'section';
export type ElevationViewKind = 'north' | 'south' | 'east' | 'west' | 'custom';
export type ElevationRenderMode = 'simplified' | 'realistic';
export type SectionLineDirection = 1 | -1;

export interface ElevationOpeningProjection {
  id: string;
  wallId: string;
  openingId: string;
  type: 'door' | 'window';
  xStart: number;
  xEnd: number;
  yBottom: number;
  yTop: number;
  sillHeight: number;
  height: number;
  wallXStart: number;
  wallXEnd: number;
  wallLength: number;
  wallOpeningPosition: number;
}

export interface ElevationWallProjection {
  id: string;
  wallId: string;
  xStart: number;
  xEnd: number;
  yBottom: number;
  yTop: number;
  depth: number;
  depthAlpha: number;
  materialId: string;
  wallMaterial: WallMaterial;
  hatchPattern: 'brick' | 'concrete' | 'wood' | 'glass' | 'none';
  openings: ElevationOpeningProjection[];
}

export interface SectionLine {
  id: string;
  label: string;
  name: string;
  kind: SectionLineKind;
  startPoint: Point2D;
  endPoint: Point2D;
  direction: SectionLineDirection;
  color: string;
  depthMm: number;
  locked: boolean;
  showReferenceIndicators: boolean;
}

export interface ElevationView {
  id: string;
  name: string;
  kind: ElevationViewKind;
  sectionLineId: string | null;
  viewDirection: CompassDirection | 'custom';
  walls: ElevationWallProjection[];
  minX: number;
  maxX: number;
  maxHeightMm: number;
  gridIncrementMm: number;
  scale: number;
  sourceHash: string;
  updatedAt: number;
}

export interface ElevationSettings {
  defaultGridIncrementMm: number;
  defaultScale: number;
  showGroundLine: boolean;
  showDepthCueing: boolean;
  showReferenceIndicators: boolean;
  renderMode: ElevationRenderMode;
  showShadows: boolean;
  sunAngleDeg: number;
}

export interface WallAssemblyLayer {
  id: string;
  materialId: string;
  thicknessMm: number;
  order: number;
}

export interface WallThermalBreakdownItem {
  layerId: string;
  materialId: string;
  resistance: number;
  uValue: number;
  percentage: number;
}

export interface HvacDesignConditions {
  location: string;
  country: string;
  summerDryBulbC: number;
  summerWetBulbC: number;
  winterDryBulbC: number;
  groundTemperatureC: number;
  altitudeM: number;
  peakCoolingMonth: string;
  peakCoolingHour: number;
  peakHeatingCondition: string;
  internalGainDiversityFactor: number;
  defaultWindowShgc: number;
  seasonalVariation: {
    summerAdjustment: number;
    winterAdjustment: number;
  };
}

// =============================================================================
// 3D Attribute Schemas
// =============================================================================

/**
 * Wall3D - Bound 3D properties for a 2D wall.
 */
export interface Wall3D {
  height: number;                // wall height in mm
  baseElevation: number;         // base elevation from floor in mm
  layerCount: number;            // multi-layer wall build-up count
  materialId: string;            // material library id
  thermalResistance: number;     // effective R-value
  overallUValue: number;         // effective U-value
  thermalAssembly: WallAssemblyLayer[];
  thermalBreakdown: WallThermalBreakdownItem[];
  exposureAngleFromNorth: number;
  exposureDirection: CompassDirection;
  exposureOverride: CompassDirection | null;
  shadingFactor: number;         // 0-1, lower means more shaded
  shadingContext: string;
  computedLength: number;        // derived from 2D geometry (mm)
  computedVolumeM3: number;      // derived from 2D geometry + height/thickness
}

/**
 * Room3D - Bound 3D properties for a 2D room footprint.
 */
export interface Room3D {
  ceilingHeight: number;         // in mm
  floorElevation: number;        // in mm
  slabThickness: number;         // in mm
  materialId: string;            // material library id for dominant finish/system
  hvacTemplateId: string;
  occupantCount: number;
  occupancySchedule: RoomOccupancySchedule;
  lightingLoadWm2: number;
  equipmentLoadWm2: number;
  requiresExhaust: boolean;
  outdoorAirPerPersonLps: number;
  outdoorAirPerAreaLpsm2: number;
  ventilationOutdoorAirLps: number;
  heatingSetpointC: number;
  coolingSetpointC: number;
  internalGainDiversityFactor: number;
  windowShgc: number;
  calculatedCoolingLoadW: number;
  calculatedHeatingLoadW: number;
  loadBreakdown: {
    occupancyW: number;
    lightingW: number;
    equipmentW: number;
  };
  computedAreaM2: number;        // derived from 2D polygon
  computedVolumeM3: number;      // derived from 2D area + height
}

// =============================================================================
// Wall + Room Models
// =============================================================================

/**
 * Wall - Core wall data structure.
 *
 * The center-line is the primary geometry. Interior and exterior lines
 * are computed from center +/- (thickness/2), perpendicular to wall direction.
 */
export interface Wall {
  id: string;
  startPoint: Point2D;           // center-line start (mm)
  endPoint: Point2D;             // center-line end (mm)
  thickness: number;             // in mm
  material: WallMaterial;
  layer: WallLayer;
  interiorLine: Line;            // computed from center + thickness/2
  exteriorLine: Line;            // computed from center - thickness/2
  startBevel: BevelControl;      // bevel controls at start endpoint
  endBevel: BevelControl;        // bevel controls at end endpoint
  connectedWalls: string[];      // IDs of walls sharing endpoints
  openings: Opening[];
  properties3D: Wall3D;
}

/**
 * Room - 2D room footprint + bound 3D attributes.
 */
export interface Room {
  id: string;
  name: string;
  roomType: RoomType;
  vertices: Point2D[];
  wallIds: string[];
  area: number;                  // in mm^2
  perimeter: number;             // in mm
  centroid: Point2D;
  finishes: string;
  notes: string;
  fillColor: string;
  showLabel: boolean;
  adjacentRoomIds: string[];
  hasWindows: boolean;
  validationWarnings: string[];
  isExterior: boolean;
  properties3D: Room3D;
}

/**
 * CreateWallParams - Parameters for creating a new wall.
 */
export interface CreateWallParams {
  startPoint: Point2D;
  endPoint: Point2D;
  thickness?: number;
  material?: WallMaterial;
  layer?: WallLayer;
}

/**
 * CreateRoomParams - Parameters for creating a room from polygon vertices.
 */
export interface CreateRoomParams {
  name?: string;
  vertices: Point2D[];
  wallIds?: string[];
  properties3D?: Partial<Room3D>;
}

/**
 * Opening - Door/window openings in walls.
 */
export interface Opening {
  id: string;
  type: 'door' | 'window';
  position: number;      // distance from wall start along center-line (mm)
  width: number;         // opening width (mm)
  height: number;        // opening height (mm)
  sillHeight?: number;   // for windows, height from floor (mm)
}

// =============================================================================
// Wall Drawing State
// =============================================================================

/**
 * WallDrawingState - State during wall drawing.
 */
export interface WallDrawingState {
  isDrawing: boolean;
  startPoint: Point2D | null;
  currentPoint: Point2D | null;
  chainMode: boolean;
  previewThickness: number;
  previewMaterial: WallMaterial;
}

/**
 * SectionLineDrawingState - State during section/elevation line drawing.
 */
export interface SectionLineDrawingState {
  isDrawing: boolean;
  startPoint: Point2D | null;
  currentPoint: Point2D | null;
  direction: SectionLineDirection;
  nextKind: SectionLineKind;
  nextLabel: string;
}

/**
 * WallSettings - User-configurable wall settings.
 */
export interface WallSettings {
  defaultThickness: number;       // default wall thickness (mm)
  defaultHeight: number;          // default wall height (mm)
  defaultLayerCount: number;      // default wall layer count
  defaultMaterial: WallMaterial;
  defaultLayer: WallLayer;
  showCenterLines: boolean;
  showHeightTags: boolean;
  colorCodeByMaterial: boolean;
  wallColorMode: WallColorMode;
  showLayerCountIndicators: boolean;
  showRoomTemperatureIcons: boolean;
  showRoomVentilationBadges: boolean;
  showSectionReferenceLines: boolean;
  snapToGrid: boolean;
  gridSize: number;               // snap grid size (mm), default 100
  endpointSnapTolerance: number;  // snap tolerance in pixels, default 15
  midpointSnapTolerance: number;  // midpoint snap tolerance in pixels, default 18
  chainModeEnabled: boolean;      // auto-chain walls
}

// =============================================================================
// Room Configuration
// =============================================================================

/**
 * RoomConfig - Configuration for room shortcut.
 */
export interface RoomConfig {
  width: number;           // room width (mm)
  height: number;          // room depth (mm)
  wallThickness: number;   // wall thickness (mm)
  material: WallMaterial;
}

// =============================================================================
// Join Data
// =============================================================================

/**
 * JoinData - Information about a wall join.
 */
export interface JoinData {
  wallId: string;
  otherWallId: string;
  endpoint?: 'start' | 'end';
  joinPoint: Point2D;
  joinType: JoinType;
  angle: number;
  interiorVertex: Point2D;
  exteriorVertex: Point2D;
  bevelDirection?: Point2D;
  maxBevelOffset?: number;
}

/**
 * EndpointSnapResult - Result of endpoint snapping.
 */
export interface EndpointSnapResult {
  snappedPoint: Point2D;
  wallId: string;
  endpoint: 'start' | 'end' | 'midpoint';
  distance: number;
}

/**
 * SnapResult - Result of wall point snapping.
 */
export interface SnapResult {
  snappedPoint: Point2D;
  snapType: 'grid' | 'endpoint' | 'midpoint' | 'angle' | 'none';
  connectedWallId?: string;
  endpoint?: 'start' | 'end' | 'midpoint';
}

// =============================================================================
// Constants
// =============================================================================

export const MIN_WALL_LENGTH = 100;
export const MIN_WALL_THICKNESS = 50;
export const MAX_WALL_THICKNESS = 500;
export const MIN_WALL_HEIGHT = 100;
export const MAX_WALL_HEIGHT = 10000;
export const MIN_U_VALUE = 0.1;
export const MAX_U_VALUE = 10;
export const DEFAULT_WALL_HEIGHT = 2700;
export const DEFAULT_ROOM_HEIGHT = 2700;
export const DEFAULT_WALL_LAYER_COUNT = 1;
export const DEFAULT_ROOM_SLAB_THICKNESS = 150;
export const DEFAULT_SECTION_LINE_COLOR = '#D81B60';
export const DEFAULT_SECTION_LINE_DEPTH_MM = 10000;
export const DEFAULT_BEVEL_CONTROL: BevelControl = {
  outerOffset: 0,
  innerOffset: 0,
};

export const DEFAULT_WALL_THICKNESS: Record<WallLayer, number> = {
  structural: 200,
  partition: 150,
};

export const WALL_MATERIAL_COLORS: Record<WallMaterial, { fill: string; stroke: string; pattern?: 'hatch' }> = {
  brick: { fill: '#E3E3E3', stroke: '#000000', pattern: 'hatch' },
  concrete: { fill: '#D9D9D9', stroke: '#000000' },
  partition: { fill: '#ECECEC', stroke: '#000000' },
};

export const DEFAULT_WALL_SETTINGS: WallSettings = {
  defaultThickness: 150,
  defaultHeight: DEFAULT_WALL_HEIGHT,
  defaultLayerCount: DEFAULT_WALL_LAYER_COUNT,
  defaultMaterial: 'brick',
  defaultLayer: 'partition',
  showCenterLines: true,
  showHeightTags: false,
  colorCodeByMaterial: true,
  wallColorMode: 'material',
  showLayerCountIndicators: false,
  showRoomTemperatureIcons: true,
  showRoomVentilationBadges: true,
  showSectionReferenceLines: true,
  snapToGrid: true,
  gridSize: 100,
  endpointSnapTolerance: 15,
  midpointSnapTolerance: 18,
  chainModeEnabled: true,
};

export const DEFAULT_WALL_DRAWING_STATE: WallDrawingState = {
  isDrawing: false,
  startPoint: null,
  currentPoint: null,
  chainMode: false,
  previewThickness: 150,
  previewMaterial: 'brick',
};

export const DEFAULT_SECTION_LINE_DRAWING_STATE: SectionLineDrawingState = {
  isDrawing: false,
  startPoint: null,
  currentPoint: null,
  direction: 1,
  nextKind: 'section',
  nextLabel: 'SECTION A-A',
};

export const DEFAULT_ELEVATION_SETTINGS: ElevationSettings = {
  defaultGridIncrementMm: 500,
  defaultScale: 100,
  showGroundLine: true,
  showDepthCueing: true,
  showReferenceIndicators: true,
  renderMode: 'simplified',
  showShadows: false,
  sunAngleDeg: 45,
};

export const DEFAULT_WALL_3D: Wall3D = {
  height: DEFAULT_WALL_HEIGHT,
  baseElevation: 0,
  layerCount: DEFAULT_WALL_LAYER_COUNT,
  materialId: 'exterior-brick-200',
  thermalResistance: 0.8,
  overallUValue: 1.25,
  thermalAssembly: [
    {
      id: 'layer-exterior-brick-200',
      materialId: 'exterior-brick-200',
      thicknessMm: 200,
      order: 0,
    },
    {
      id: 'layer-interior-drywall-12-5',
      materialId: 'interior-drywall-12-5',
      thicknessMm: 12.5,
      order: 1,
    },
  ],
  thermalBreakdown: [],
  exposureAngleFromNorth: 0,
  exposureDirection: 'N',
  exposureOverride: null,
  shadingFactor: 1,
  shadingContext: '',
  computedLength: 0,
  computedVolumeM3: 0,
};

export const DEFAULT_ROOM_3D: Room3D = {
  ceilingHeight: DEFAULT_ROOM_HEIGHT,
  floorElevation: 0,
  slabThickness: DEFAULT_ROOM_SLAB_THICKNESS,
  materialId: 'interior-drywall-12-5',
  hvacTemplateId: 'template-bedroom',
  occupantCount: 2,
  occupancySchedule: 'evening',
  lightingLoadWm2: 10,
  equipmentLoadWm2: 5,
  requiresExhaust: false,
  outdoorAirPerPersonLps: 7.5,
  outdoorAirPerAreaLpsm2: 0.3,
  ventilationOutdoorAirLps: 0,
  heatingSetpointC: 21,
  coolingSetpointC: 24,
  internalGainDiversityFactor: 0.9,
  windowShgc: 0.35,
  calculatedCoolingLoadW: 0,
  calculatedHeatingLoadW: 0,
  loadBreakdown: {
    occupancyW: 0,
    lightingW: 0,
    equipmentW: 0,
  },
  computedAreaM2: 0,
  computedVolumeM3: 0,
};

export const DEFAULT_HVAC_DESIGN_CONDITIONS: HvacDesignConditions = {
  location: 'New York',
  country: 'USA',
  summerDryBulbC: 35,
  summerWetBulbC: 24,
  winterDryBulbC: -5,
  groundTemperatureC: 13,
  altitudeM: 10,
  peakCoolingMonth: 'July',
  peakCoolingHour: 15,
  peakHeatingCondition: '99% Winter Design',
  internalGainDiversityFactor: 0.9,
  defaultWindowShgc: 0.35,
  seasonalVariation: {
    summerAdjustment: 1,
    winterAdjustment: 1,
  },
};

export const ANGLE_CONSTRAINTS = [0, 90, 180, 270];

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  width: 4000,
  height: 3000,
  wallThickness: 150,
  material: 'brick',
};
