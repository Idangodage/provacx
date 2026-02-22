/**
 * Smart Drawing Store
 *
 * Zustand store for managing drawing state with history support.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import {
  attributeChangeObserver,
  bindRoomGeometryTo3D,
  bindWallGeometryTo3D,
  createAttributeEnvelope,
  DEFAULT_HVAC_DESIGN_CONDITIONS,
  DEFAULT_ROOM_HVAC_TEMPLATES,
  deserializeAttributeEnvelope,
  getDefaultMaterialIdForWallMaterial,
  getArchitecturalMaterial,
  DEFAULT_ARCHITECTURAL_MATERIALS,
  resolveWallMaterialFromLibrary,
  validateRoom3DAttributes,
  validateWall3DAttributes,
} from '../attributes';
import {
  createStandardElevationViews,
  generateCustomElevationView,
  regenerateElevationViews,
} from '../components/canvas/elevation';
import type {
  Point2D,
  DisplayUnit,
  Dimension2D,
  DimensionSettings,
  Annotation2D,
  Sketch2D,
  Guide,
  SymbolInstance2D,
  DrawingLayer,
  DrawingTool,
  ImportedDrawing,
  DetectedElement,
  PageConfig,
  HistoryEntry,
  SplineSettings,
  SplineMethod,
  Room,
  Room3D,
  RoomType,
  HvacDesignConditions,
  ElevationSettings,
  ElevationView,
  Wall,
  Wall3D,
  BevelControl,
  WallDrawingState,
  WallSettings,
  WallMaterial,
  SectionLine,
  SectionLineDrawingState,
  SectionLineDirection,
  SectionLineKind,
  CreateWallParams,
  RoomConfig,
} from '../types';
import { DEFAULT_DIMENSION_SETTINGS } from '../types';
import {
  DEFAULT_ROOM_3D,
  DEFAULT_ELEVATION_SETTINGS,
  DEFAULT_SECTION_LINE_COLOR,
  DEFAULT_SECTION_LINE_DEPTH_MM,
  DEFAULT_SECTION_LINE_DRAWING_STATE,
  DEFAULT_BEVEL_CONTROL,
  DEFAULT_WALL_3D,
  DEFAULT_WALL_SETTINGS,
  DEFAULT_WALL_DRAWING_STATE,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_LAYER_COUNT,
  MAX_WALL_HEIGHT,
  MAX_WALL_THICKNESS,
  MIN_WALL_HEIGHT,
  MIN_WALL_LENGTH,
  MIN_WALL_THICKNESS,
} from '../types/wall';
import { generateId } from '../utils/geometry';
import { GeometryEngine } from '../utils/geometry-engine';
import {
  clampBevelOffset,
  computeCornerBevelDotsForEndpoint,
  withUpdatedBevel,
  type CornerEnd,
} from '../utils/wallBevel';
import { DEFAULT_SPLINE_SETTINGS } from '../utils/spline';

// Import from extracted modules
import {
  DEFAULT_PAGE_CONFIG,
  DEFAULT_LAYERS,
} from './defaults';
import {
  createEmptyHistorySnapshot,
  createHistoryEntry,
  createHistorySnapshot,
} from './helpers';
import {
  detectRoomPolygons,
  inferRoomType,
  roomMinimumDimensionWarnings,
  roomTopologyHash,
  roomTypeFillColor,
} from './roomDetection';

const AUTO_TRIM_TOLERANCE_MM = 120;
const ROOM_DETECTION_DEBOUNCE_MS = 120;
const ELEVATION_REGEN_DEBOUNCE_MS = 120;

let roomDetectionTimer: ReturnType<typeof setTimeout> | null = null;
let elevationRegenTimer: ReturnType<typeof setTimeout> | null = null;
let lastRoomTopologyHash = '';
const INITIAL_ELEVATION_VIEWS = createStandardElevationViews(
  [],
  [],
  DEFAULT_ELEVATION_SETTINGS
);

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sectionLabelForIndex(kind: SectionLineKind, index: number): string {
  if (kind === 'elevation') {
    const presets = ['FRONT ELEVATION', 'END ELEVATION'];
    return presets[index - 1] ?? `ELEVATION ${index}`;
  }

  const normalizedIndex = Math.max(1, Math.floor(index));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letter = alphabet[(normalizedIndex - 1) % alphabet.length];
  return `SECTION ${letter}-${letter}`;
}

function wallLengthMm(startPoint: Point2D, endPoint: Point2D): number {
  return GeometryEngine.distance(startPoint, endPoint);
}

function clampThickness(thickness: number): number {
  return clampValue(thickness, MIN_WALL_THICKNESS, MAX_WALL_THICKNESS);
}

function clampHeight(height: number): number {
  return clampValue(height, MIN_WALL_HEIGHT, MAX_WALL_HEIGHT);
}

function normalizeBevelControl(bevel?: Partial<BevelControl> | null): BevelControl {
  return {
    outerOffset: clampBevelOffset(bevel?.outerOffset ?? DEFAULT_BEVEL_CONTROL.outerOffset, Number.MAX_SAFE_INTEGER),
    innerOffset: clampBevelOffset(bevel?.innerOffset ?? DEFAULT_BEVEL_CONTROL.innerOffset, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeWallBevel(wall: Wall): Wall {
  return {
    ...wall,
    startBevel: normalizeBevelControl(wall.startBevel),
    endBevel: normalizeBevelControl(wall.endBevel),
  };
}

function bevelKeyForEnd(end: CornerEnd): 'startBevel' | 'endBevel' {
  return end === 'start' ? 'startBevel' : 'endBevel';
}

function applyWallEndpointBevel(
  wall: Wall,
  end: CornerEnd,
  bevel: Partial<BevelControl>,
  maxOffset: number
): Wall {
  const normalized = normalizeWallBevel(wall);
  const key = bevelKeyForEnd(end);
  const nextBevel = withUpdatedBevel(normalized[key], bevel, maxOffset);
  if (key === 'startBevel') {
    return {
      ...normalized,
      startBevel: nextBevel,
    };
  }
  return {
    ...normalized,
    endBevel: nextBevel,
  };
}

function rebuildWallGeometry(wall: Wall): Wall {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const perpX = -dy / length;
  const perpY = dx / length;
  const halfThickness = wall.thickness / 2;

  return {
    ...normalizeWallBevel(wall),
    interiorLine: {
      start: { x: wall.startPoint.x + perpX * halfThickness, y: wall.startPoint.y + perpY * halfThickness },
      end: { x: wall.endPoint.x + perpX * halfThickness, y: wall.endPoint.y + perpY * halfThickness },
    },
    exteriorLine: {
      start: { x: wall.startPoint.x - perpX * halfThickness, y: wall.startPoint.y - perpY * halfThickness },
      end: { x: wall.endPoint.x - perpX * halfThickness, y: wall.endPoint.y - perpY * halfThickness },
    },
  };
}

function projectPointToSegment(
  point: Point2D,
  start: Point2D,
  end: Point2D
): { point: Point2D; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq < 0.000001) {
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    return { point: { ...start }, distance };
  }

  const t = clampValue(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq,
    0,
    1
  );

  const projection = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };

  return {
    point: projection,
    distance: Math.hypot(point.x - projection.x, point.y - projection.y),
  };
}

function autoTrimEndpointToNearbyWall(
  endpoint: Point2D,
  fixedPoint: Point2D,
  walls: Wall[]
): Point2D {
  let bestPoint = endpoint;
  let bestDistance = AUTO_TRIM_TOLERANCE_MM;

  for (const wall of walls) {
    const projection = projectPointToSegment(endpoint, wall.startPoint, wall.endPoint);

    if (projection.distance > bestDistance) continue;
    if (wallLengthMm(fixedPoint, projection.point) < MIN_WALL_LENGTH) continue;

    bestDistance = projection.distance;
    bestPoint = projection.point;
  }

  return bestPoint;
}

function autoTrimWallEndpoints(
  startPoint: Point2D,
  endPoint: Point2D,
  walls: Wall[]
): { startPoint: Point2D; endPoint: Point2D } {
  const snappedStart = autoTrimEndpointToNearbyWall(startPoint, endPoint, walls);
  const snappedEnd = autoTrimEndpointToNearbyWall(endPoint, snappedStart, walls);

  if (wallLengthMm(snappedStart, snappedEnd) < MIN_WALL_LENGTH) {
    return { startPoint, endPoint };
  }

  return { startPoint: snappedStart, endPoint: snappedEnd };
}

function pointsNear(a: Point2D, b: Point2D, tolerance: number = 2): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function pointLiesOnWall(point: Point2D, wall: Wall, tolerance: number = 2): boolean {
  const projection = projectPointToSegment(point, wall.startPoint, wall.endPoint);
  return projection.distance <= tolerance;
}

function findWallsTouchingPoint(
  point: Point2D,
  walls: Wall[],
  tolerance: number = 2
): string[] {
  const touching: string[] = [];

  for (const wall of walls) {
    if (
      pointsNear(point, wall.startPoint, tolerance) ||
      pointsNear(point, wall.endPoint, tolerance) ||
      pointLiesOnWall(point, wall, tolerance)
    ) {
      touching.push(wall.id);
    }
  }

  return touching;
}

function polygonArea(vertices: Point2D[]): number {
  return GeometryEngine.calculateRoomAreaMm2({ vertices });
}

function polygonPerimeter(vertices: Point2D[]): number {
  return GeometryEngine.calculateRoomPerimeterMm({ vertices });
}

function polygonCentroid(vertices: Point2D[]): Point2D {
  return GeometryEngine.findRoomCentroid({ vertices });
}

function roomSignatureFromWallIds(wallIds: string[]): string {
  return [...new Set(wallIds)].sort().join('|');
}

function bindWallAttributes(wall: Wall, defaults?: Partial<Wall3D>): Wall {
  const bound = bindWallGeometryTo3D(wall, defaults);
  return {
    ...wall,
    properties3D: bound.value,
  };
}

function bindRoomAttributes(room: Room, defaults?: Partial<Room3D>): Room {
  const computedArea = polygonArea(room.vertices);
  const computedPerimeter = polygonPerimeter(room.vertices);
  const computedCentroid = polygonCentroid(room.vertices);
  const bound = bindRoomGeometryTo3D(
    {
      ...room,
      area: computedArea,
    },
    defaults
  );
  return {
    ...room,
    properties3D: bound.value,
    area: computedArea,
    perimeter: computedPerimeter,
    centroid: computedCentroid,
  };
}

function createRoomModel(params: {
  vertices: Point2D[];
  wallIds: string[];
  name?: string;
  roomType?: RoomType;
  perimeter?: number;
  centroid?: Point2D;
  finishes?: string;
  notes?: string;
  fillColor?: string;
  showLabel?: boolean;
  adjacentRoomIds?: string[];
  hasWindows?: boolean;
  validationWarnings?: string[];
  isExterior?: boolean;
  properties3D?: Partial<Room3D>;
}): Room {
  const area = polygonArea(params.vertices);
  const areaM2 = area / 1_000_000;
  const roomType = params.roomType ?? inferRoomType(areaM2);
  const roomBase: Room = {
    id: generateId(),
    name: params.name ?? `${roomType} ${new Date().toISOString().slice(11, 16)}`,
    roomType,
    vertices: params.vertices.map((vertex) => ({ ...vertex })),
    wallIds: [...params.wallIds],
    area,
    perimeter: params.perimeter ?? polygonPerimeter(params.vertices),
    centroid: params.centroid ? { ...params.centroid } : polygonCentroid(params.vertices),
    finishes: params.finishes ?? '',
    notes: params.notes ?? '',
    fillColor: params.fillColor ?? roomTypeFillColor(roomType),
    showLabel: params.showLabel ?? true,
    adjacentRoomIds: params.adjacentRoomIds ?? [],
    hasWindows: params.hasWindows ?? false,
    validationWarnings: params.validationWarnings ?? [],
    isExterior: params.isExterior ?? false,
    properties3D: { ...DEFAULT_ROOM_3D },
  };
  return bindRoomAttributes(roomBase, params.properties3D);
}

function buildRoomValidationWarnings(params: {
  areaM2: number;
  roomType: RoomType;
  vertices: Point2D[];
  hasWindows: boolean;
}): string[] {
  const warnings: string[] = [];
  if (params.areaM2 < 2) {
    warnings.push('Room area is below 2m² (possible drawing error).');
  }
  if (!params.hasWindows) {
    warnings.push('No windows detected for this room.');
  }
  warnings.push(...roomMinimumDimensionWarnings(params.roomType, params.vertices));
  return warnings;
}

function buildAutoDetectedRooms(
  walls: Wall[],
  existingRooms: Room[]
): Room[] {
  if (walls.length < 3) return [];

  const detection = detectRoomPolygons(walls);
  if (detection.faces.length === 0) return [];

  const existingBySignature = new Map<string, Room>();
  existingRooms.forEach((room) => {
    existingBySignature.set(roomSignatureFromWallIds(room.wallIds), room);
  });

  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const usedNames = new Set(existingRooms.map((room) => room.name));
  const nextRooms: Room[] = [];

  detection.faces.forEach((face, index) => {
    if (face.wallIds.length < 3) return;
    if (detection.exteriorSignatures.has(face.signature)) return;
    const signature = roomSignatureFromWallIds(face.wallIds);
    const existing = existingBySignature.get(signature);
    const areaM2 = face.area / 1_000_000;
    const roomType = existing?.roomType ?? inferRoomType(areaM2);
    const hasWindows = face.wallIds.some((wallId) => {
      const wall = wallById.get(wallId);
      if (!wall) return false;
      return wall.openings.some((opening) => opening.type === 'window');
    });
    const validationWarnings = buildRoomValidationWarnings({
      areaM2,
      roomType,
      vertices: face.vertices,
      hasWindows,
    });

    let roomName = existing?.name;
    if (!roomName) {
      roomName = `${roomType} ${index + 1}`;
      if (usedNames.has(roomName)) {
        roomName = `Room ${index + 1}`;
      }
    }
    usedNames.add(roomName);

    const room = createRoomModel({
      vertices: face.vertices,
      wallIds: face.wallIds,
      name: roomName,
      roomType,
      perimeter: face.perimeter,
      centroid: face.centroid,
      finishes: existing?.finishes ?? '',
      notes: existing?.notes ?? '',
      fillColor: existing?.fillColor ?? roomTypeFillColor(roomType),
      showLabel: existing?.showLabel ?? true,
      adjacentRoomIds: existing?.adjacentRoomIds ?? [],
      hasWindows,
      validationWarnings,
      isExterior: existing?.isExterior ?? false,
      properties3D: existing?.properties3D,
    });

    if (existing) {
      room.id = existing.id;
    }

    nextRooms.push(room);
  });

  const roomIdsByWall = new Map<string, string[]>();
  nextRooms.forEach((room) => {
    room.wallIds.forEach((wallId) => {
      roomIdsByWall.set(wallId, [...(roomIdsByWall.get(wallId) ?? []), room.id]);
    });
  });
  nextRooms.forEach((room) => {
    const adjacent = new Set<string>();
    room.wallIds.forEach((wallId) => {
      const linked = roomIdsByWall.get(wallId) ?? [];
      linked.forEach((roomId) => {
        if (roomId !== room.id) adjacent.add(roomId);
      });
    });
    room.adjacentRoomIds = [...adjacent];
  });

  return nextRooms;
}

function wallLength(wall: Wall): number {
  return GeometryEngine.wallLength(wall);
}

function wallMidpoint(wall: Wall): Point2D {
  return {
    x: (wall.startPoint.x + wall.endPoint.x) / 2,
    y: (wall.startPoint.y + wall.endPoint.y) / 2,
  };
}

function wallLinearMode(wall: Wall): 'horizontal' | 'vertical' | 'aligned' {
  const dx = Math.abs(wall.endPoint.x - wall.startPoint.x);
  const dy = Math.abs(wall.endPoint.y - wall.startPoint.y);
  if (dx >= dy * 1.2) return 'horizontal';
  if (dy >= dx * 1.2) return 'vertical';
  return 'aligned';
}

function buildExteriorWallSet(walls: Wall[], rooms: Room[]): Set<string> {
  const interiorRoomWallRefCount = new Map<string, number>();
  rooms.forEach((room) => {
    if (room.isExterior) return;
    room.wallIds.forEach((wallId) => {
      interiorRoomWallRefCount.set(wallId, (interiorRoomWallRefCount.get(wallId) ?? 0) + 1);
    });
  });
  const exterior = new Set<string>();
  walls.forEach((wall) => {
    const count = interiorRoomWallRefCount.get(wall.id) ?? 0;
    if (count <= 1) {
      exterior.add(wall.id);
    }
  });
  return exterior;
}

function buildAutoWallDimensions(
  walls: Wall[],
  rooms: Room[],
  settings: DimensionSettings
): Omit<Dimension2D, 'id'>[] {
  const exteriorWallIds = buildExteriorWallSet(walls, rooms);
  const exteriorWalls = walls.filter((wall) => exteriorWallIds.has(wall.id));
  if (exteriorWalls.length === 0) return [];

  const horizontal: Wall[] = [];
  const vertical: Wall[] = [];
  const aligned: Wall[] = [];

  exteriorWalls.forEach((wall) => {
    const mode = wallLinearMode(wall);
    if (mode === 'horizontal') horizontal.push(wall);
    else if (mode === 'vertical') vertical.push(wall);
    else aligned.push(wall);
  });

  horizontal.sort((a, b) => wallMidpoint(a).y - wallMidpoint(b).y || wallMidpoint(a).x - wallMidpoint(b).x);
  vertical.sort((a, b) => wallMidpoint(a).x - wallMidpoint(b).x || wallMidpoint(a).y - wallMidpoint(b).y);
  aligned.sort((a, b) => wallLength(b) - wallLength(a));

  const dimensions: Omit<Dimension2D, 'id'>[] = [];
  const offsetBase = Math.max(120, settings.defaultOffset);
  const offsetStep = 120;

  horizontal.forEach((wall, index) => {
    dimensions.push({
      type: 'linear',
      linearMode: 'horizontal',
      points: [{ ...wall.startPoint }, { ...wall.endPoint }],
      value: Math.abs(wall.endPoint.x - wall.startPoint.x),
      unit: settings.unitSystem === 'imperial' ? 'ft-in' : 'mm',
      textPosition: wallMidpoint(wall),
      visible: true,
      style: settings.style,
      precision: settings.precision,
      displayFormat: settings.displayFormat,
      offset: offsetBase + index * offsetStep,
      linkedWallIds: [wall.id],
      anchors: [
        { kind: 'wall-endpoint', wallId: wall.id, endpoint: 'start' },
        { kind: 'wall-endpoint', wallId: wall.id, endpoint: 'end' },
      ],
      isAssociative: true,
      chainGroupId: 'auto-horizontal',
      baselineGroupId: 'auto-exterior',
    });
  });

  vertical.forEach((wall, index) => {
    dimensions.push({
      type: 'linear',
      linearMode: 'vertical',
      points: [{ ...wall.startPoint }, { ...wall.endPoint }],
      value: Math.abs(wall.endPoint.y - wall.startPoint.y),
      unit: settings.unitSystem === 'imperial' ? 'ft-in' : 'mm',
      textPosition: wallMidpoint(wall),
      visible: true,
      style: settings.style,
      precision: settings.precision,
      displayFormat: settings.displayFormat,
      offset: offsetBase + index * offsetStep,
      linkedWallIds: [wall.id],
      anchors: [
        { kind: 'wall-endpoint', wallId: wall.id, endpoint: 'start' },
        { kind: 'wall-endpoint', wallId: wall.id, endpoint: 'end' },
      ],
      isAssociative: true,
      chainGroupId: 'auto-vertical',
      baselineGroupId: 'auto-exterior',
    });
  });

  aligned.forEach((wall, index) => {
    dimensions.push({
      type: 'aligned',
      linearMode: 'aligned',
      points: [{ ...wall.startPoint }, { ...wall.endPoint }],
      value: wallLength(wall),
      unit: settings.unitSystem === 'imperial' ? 'ft-in' : 'mm',
      textPosition: wallMidpoint(wall),
      visible: true,
      style: settings.style,
      precision: settings.precision,
      displayFormat: settings.displayFormat,
      offset: offsetBase + index * offsetStep,
      linkedWallIds: [wall.id],
      anchors: [
        { kind: 'wall-endpoint', wallId: wall.id, endpoint: 'start' },
        { kind: 'wall-endpoint', wallId: wall.id, endpoint: 'end' },
      ],
      isAssociative: true,
      baselineGroupId: 'auto-exterior',
    });
  });

  return dimensions;
}

function buildRoomAreaDimensions(
  rooms: Room[],
  settings: DimensionSettings
): Omit<Dimension2D, 'id'>[] {
  return rooms
    .filter((room) => !room.isExterior)
    .map((room) => ({
      type: 'area',
      points: [{ ...room.centroid }],
      value: room.area,
      unit: settings.unitSystem === 'imperial' ? 'ft-in' : 'mm',
      textPosition: { ...room.centroid },
      visible: true,
      style: settings.style,
      precision: settings.precision,
      displayFormat: settings.displayFormat,
      linkedRoomId: room.id,
      showPerimeter: settings.showAreaPerimeter,
      isAssociative: true,
    }));
}

function normalizeDimensionPayload(
  dimension: Omit<Dimension2D, 'id'> | Dimension2D,
  settings: DimensionSettings
): Omit<Dimension2D, 'id'> {
  const { id: _dimensionId, ...payload } = dimension as Dimension2D;
  void _dimensionId;
  const points = Array.isArray(dimension.points)
    ? dimension.points.map((point) => ({ ...point }))
    : [];
  const safeTextPosition = payload.textPosition
    ? { ...payload.textPosition }
    : points[0]
      ? { ...points[0] }
      : { x: 0, y: 0 };
  const precision = payload.precision ?? settings.precision;

  return {
    ...payload,
    points,
    textPosition: safeTextPosition,
    visible: payload.visible ?? true,
    style: payload.style ?? settings.style,
    precision: precision === 0 || precision === 1 || precision === 2 ? precision : settings.precision,
    displayFormat: payload.displayFormat ?? settings.displayFormat,
    offset: Number.isFinite(payload.offset) ? payload.offset : settings.defaultOffset,
    textPositionLocked: payload.textPositionLocked ?? false,
  };
}

// =============================================================================
// Store Interface
// =============================================================================

export interface DrawingState {
  // Drawing Elements
  dimensions: Dimension2D[];
  dimensionSettings: DimensionSettings;
  annotations: Annotation2D[];
  sketches: Sketch2D[];
  guides: Guide[];
  symbols: SymbolInstance2D[];
  layers: DrawingLayer[];

  // Wall State
  walls: Wall[];
  rooms: Room[];
  materialLibrary: typeof DEFAULT_ARCHITECTURAL_MATERIALS;
  hvacDesignConditions: HvacDesignConditions;
  wallDrawingState: WallDrawingState;
  wallSettings: WallSettings;
  sectionLines: SectionLine[];
  sectionLineDrawingState: SectionLineDrawingState;
  elevationViews: ElevationView[];
  activeElevationViewId: string | null;
  elevationSettings: ElevationSettings;

  // Import State
  importedDrawing: ImportedDrawing | null;
  importProgress: number;
  isProcessing: boolean;
  processingStatus: string;
  detectedElements: DetectedElement[];

  // Tool State
  activeTool: DrawingTool;
  activeLayerId: string | null;
  selectedElementIds: string[];
  hoveredElementId: string | null;

  // Aliases for backward compatibility
  tool: DrawingTool;
  selectedIds: string[];

  // View State
  zoom: number;
  zoomToFitRequestId: number;
  resetViewRequestId: number;
  panOffset: Point2D;
  displayUnit: DisplayUnit;
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;
  showRulers: boolean;
  pageConfig: PageConfig;

  // Preview State
  previewHeight: number;
  show3DPreview: boolean;
  autoSync3D: boolean;

  // Calibration State
  isCalibrating: boolean;
  calibrationStep: number;

  // History State
  history: HistoryEntry[];
  historyIndex: number;

  // Spline Settings
  splineSettings: SplineSettings;
  splineEditMode: 'draw' | 'edit-points' | 'add-point' | 'remove-point';
  editingSplineId: string | null;

  // Actions - Import
  setImportedDrawing: (drawing: ImportedDrawing | null) => void;
  updateImportedDrawing: (data: Partial<ImportedDrawing>) => void;
  setImportProgress: (progress: number) => void;
  setProcessingStatus: (status: string, isProcessing: boolean) => void;
  clearImportedDrawing: () => void;

  // Actions - Detection
  setDetectedElements: (elements: DetectedElement[]) => void;
  acceptDetectedElement: (id: string) => void;
  rejectDetectedElement: (id: string) => void;
  acceptAllDetectedElements: () => void;
  clearDetectedElements: () => void;

  // Actions - Dimensions
  addDimension: (dimension: Omit<Dimension2D, 'id'>, options?: { skipHistory?: boolean }) => string;
  updateDimension: (id: string, data: Partial<Dimension2D>, options?: { skipHistory?: boolean }) => void;
  deleteDimension: (id: string) => void;
  setDimensionSettings: (settings: Partial<DimensionSettings>) => void;
  autoDimensionExteriorWalls: () => void;
  addAreaDimensions: () => void;

  // Actions - Annotations
  addAnnotation: (annotation: Omit<Annotation2D, 'id'>) => string;
  updateAnnotation: (id: string, data: Partial<Annotation2D>) => void;
  deleteAnnotation: (id: string) => void;

  // Actions - Sketches
  addSketch: (sketch: Omit<Sketch2D, 'id'>) => string;
  updateSketch: (id: string, data: Partial<Sketch2D>) => void;
  deleteSketch: (id: string) => void;

  // Actions - Guides
  addGuide: (guide: Guide) => void;
  removeGuide: (id: string) => void;
  clearGuides: () => void;

  // Actions - Symbols
  addSymbol: (symbol: Omit<SymbolInstance2D, 'id'>) => string;
  updateSymbol: (id: string, data: Partial<SymbolInstance2D>) => void;
  deleteSymbol: (id: string) => void;

  // Actions - Walls
  addWall: (params: CreateWallParams) => string;
  updateWall: (
    id: string,
    updates: Partial<Wall>,
    options?: { skipHistory?: boolean; source?: 'ui' | 'drag'; skipRoomDetection?: boolean }
  ) => void;
  updateWallBevel: (
    wallId: string,
    end: CornerEnd,
    bevel: Partial<BevelControl>,
    options?: { skipHistory?: boolean; source?: 'ui' | 'drag'; skipRoomDetection?: boolean }
  ) => void;
  resetWallBevel: (wallId: string, end: CornerEnd) => void;
  getCornerBevelDots: (
    cornerPoint: Point2D
  ) => {
    outerDotPosition: Point2D;
    innerDotPosition: Point2D;
    outerOffset: number;
    innerOffset: number;
  } | null;
  updateWall3DAttributes: (id: string, updates: Partial<Wall3D>) => void;
  deleteWall: (id: string) => void;
  getWall: (id: string) => Wall | undefined;
  addRoom: (params: {
    vertices: Point2D[];
    wallIds: string[];
    name?: string;
    roomType?: RoomType;
    perimeter?: number;
    centroid?: Point2D;
    finishes?: string;
    notes?: string;
    fillColor?: string;
    showLabel?: boolean;
    adjacentRoomIds?: string[];
    hasWindows?: boolean;
    validationWarnings?: string[];
    isExterior?: boolean;
    properties3D?: Partial<Room3D>;
  }) => string;
  updateRoom: (id: string, updates: Partial<Room>) => void;
  updateRoom3DAttributes: (id: string, updates: Partial<Room3D>) => void;
  setHvacDesignConditions: (updates: Partial<HvacDesignConditions>) => void;
  applyRoomTemplateToSelectedRooms: (templateId: string) => void;
  deleteRoom: (id: string) => void;
  getRoom: (id: string) => Room | undefined;
  moveRoom: (id: string, delta: Point2D, options?: { skipHistory?: boolean }) => void;
  detectRooms: (options?: { debounce?: boolean }) => void;
  startWallDrawing: (startPoint: Point2D) => void;
  updateWallPreview: (currentPoint: Point2D) => void;
  commitWall: () => string | null;
  cancelWallDrawing: () => void;
  setChainMode: (enabled: boolean) => void;
  startSectionLineDrawing: (startPoint: Point2D) => void;
  updateSectionLinePreview: (currentPoint: Point2D) => void;
  commitSectionLine: () => string | null;
  cancelSectionLineDrawing: () => void;
  setSectionLineDirection: (direction: SectionLineDirection) => void;
  flipSectionLineDirection: (sectionLineId: string) => void;
  updateSectionLine: (id: string, updates: Partial<SectionLine>) => void;
  deleteSectionLine: (id: string) => void;
  setElevationSettings: (settings: Partial<ElevationSettings>) => void;
  setActiveElevationView: (id: string | null) => void;
  generateElevationForSection: (sectionLineId: string) => void;
  regenerateElevations: (options?: { debounce?: boolean }) => void;
  connectWalls: (wallId: string, otherWallId: string) => void;
  disconnectWall: (wallId: string, otherWallId: string) => void;
  setWallSettings: (settings: Partial<WallSettings>) => void;
  setWallPreviewMaterial: (material: WallMaterial) => void;
  setWallPreviewThickness: (thickness: number) => void;
  createRoomWalls: (config: RoomConfig, startCorner: Point2D) => string[];
  deleteWalls: (ids: string[]) => void;
  clearAllWalls: () => void;

  // Actions - Selection
  selectElement: (id: string, addToSelection?: boolean) => void;
  deselectElement: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setHoveredElement: (id: string | null) => void;
  deleteSelectedElements: () => void;

  // Aliases for backward compatibility
  setSelectedIds: (ids: string[]) => void;
  deleteSelected: () => void;

  // Actions - Tools
  setActiveTool: (tool: DrawingTool) => void;

  // Alias for backward compatibility
  setTool: (tool: DrawingTool) => void;

  // Computed properties for history
  canUndo: boolean;
  canRedo: boolean;

  // Actions - View
  setZoom: (zoom: number) => void;
  setPanOffset: (offset: Point2D) => void;
  setViewTransform: (zoom: number, offset: Point2D) => void;
  setDisplayUnit: (unit: DisplayUnit) => void;
  setGridSize: (size: number) => void;
  setSnapToGrid: (snap: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setShowRulers: (show: boolean) => void;
  toggleRulers: () => void;
  setPageConfig: (config: Partial<PageConfig>) => void;
  resetView: () => void;
  zoomToFit: () => void;

  // Actions - Preview
  setPreviewHeight: (height: number) => void;
  setShow3DPreview: (show: boolean) => void;
  setAutoSync3D: (sync: boolean) => void;

  // Actions - Calibration
  startCalibration: () => void;
  addCalibrationPoint: (point: Point2D) => void;
  setCalibrationDistance: (distance: number) => void;
  finishCalibration: () => void;
  cancelCalibration: () => void;

  // Actions - Layers
  addLayer: (name: string) => string;
  updateLayer: (id: string, data: Partial<DrawingLayer>) => void;
  deleteLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  moveElementToLayer: (elementId: string, layerId: string) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;

  // Actions - History
  saveToHistory: (action: string) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;

  // Actions - Export/Import
  exportToJSON: () => string;
  importFromJSON: (json: string) => void;

  // Data management aliases
  loadData: (data: unknown) => void;
  exportData: () => unknown;

  // Actions - Spline
  setSplineSettings: (settings: Partial<SplineSettings>) => void;
  setSplineEditMode: (mode: 'draw' | 'edit-points' | 'add-point' | 'remove-point') => void;
  setEditingSpline: (id: string | null) => void;
  addSplineControlPoint: (sketchId: string, point: Point2D, index?: number) => void;
  updateSplineControlPoint: (sketchId: string, pointIndex: number, position: Point2D) => void;
  removeSplineControlPoint: (sketchId: string, pointIndex: number) => void;
  toggleSplineClosed: (sketchId: string) => void;
  convertSplineMethod: (sketchId: string, method: SplineMethod) => void;
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useDrawingStore = create<DrawingState>()(
  devtools(
    (set, get) => ({
      // Initial State
      dimensions: [],
      dimensionSettings: { ...DEFAULT_DIMENSION_SETTINGS },
      annotations: [],
      sketches: [],
      guides: [],
      symbols: [],
      layers: [...DEFAULT_LAYERS],

      // Wall State
      walls: [],
      rooms: [],
      materialLibrary: [...DEFAULT_ARCHITECTURAL_MATERIALS],
      hvacDesignConditions: { ...DEFAULT_HVAC_DESIGN_CONDITIONS },
      wallDrawingState: { ...DEFAULT_WALL_DRAWING_STATE },
      wallSettings: { ...DEFAULT_WALL_SETTINGS },
      sectionLines: [],
      sectionLineDrawingState: { ...DEFAULT_SECTION_LINE_DRAWING_STATE },
      elevationViews: INITIAL_ELEVATION_VIEWS.map((view) => ({
        ...view,
        walls: view.walls.map((projection) => ({
          ...projection,
          openings: projection.openings.map((opening) => ({ ...opening })),
        })),
      })),
      activeElevationViewId: INITIAL_ELEVATION_VIEWS[0]?.id ?? null,
      elevationSettings: { ...DEFAULT_ELEVATION_SETTINGS },
      importedDrawing: null,
      importProgress: 0,
      isProcessing: false,
      processingStatus: '',
      detectedElements: [],
      activeTool: 'select',
      activeLayerId: 'default',
      selectedElementIds: [],
      hoveredElementId: null,

      // Aliases for backward compatibility
      tool: 'select',
      selectedIds: [],
      canUndo: false,
      canRedo: false,

      zoom: 1,
      zoomToFitRequestId: 0,
      resetViewRequestId: 0,
      panOffset: { x: 0, y: 0 },
      displayUnit: 'mm',
      gridSize: 20,
      snapToGrid: true,
      showGrid: true,
      showRulers: true,
      pageConfig: { ...DEFAULT_PAGE_CONFIG },
      previewHeight: 3.0,
      show3DPreview: true,
      autoSync3D: true,
      isCalibrating: false,
      calibrationStep: 0,
      history: [createHistoryEntry('Initial state', createEmptyHistorySnapshot())],
      historyIndex: 0,
      splineSettings: { ...DEFAULT_SPLINE_SETTINGS },
      splineEditMode: 'draw',
      editingSplineId: null,

      // Import Actions
      setImportedDrawing: (drawing) => set({ importedDrawing: drawing }),

      updateImportedDrawing: (data) => set((state) => ({
        importedDrawing: state.importedDrawing
          ? { ...state.importedDrawing, ...data }
          : null,
      })),

      setImportProgress: (progress) => set({ importProgress: progress }),

      setProcessingStatus: (status, isProcessing) => set({
        processingStatus: status,
        isProcessing
      }),

      clearImportedDrawing: () => set({
        importedDrawing: null,
        importProgress: 0,
        detectedElements: []
      }),

      // Detection Actions
      setDetectedElements: (elements) => set({ detectedElements: elements }),

      acceptDetectedElement: (id) => set((state) => ({
        detectedElements: state.detectedElements.map((el) =>
          el.id === id ? { ...el, accepted: true } : el
        ),
      })),

      rejectDetectedElement: (id) => set((state) => ({
        detectedElements: state.detectedElements.filter((el) => el.id !== id),
      })),

      acceptAllDetectedElements: () => set((state) => ({
        detectedElements: state.detectedElements.map((el) => ({ ...el, accepted: true })),
      })),

      clearDetectedElements: () => set({ detectedElements: [] }),

      // Guide Actions
      addGuide: (guide) => set((state) => ({ guides: [...state.guides, guide] })),
      removeGuide: (id) => set((state) => ({ guides: state.guides.filter((g) => g.id !== id) })),
      clearGuides: () => set({ guides: [] }),

      // Dimension Actions
      addDimension: (dimension, options) => {
        const id = generateId();
        const normalized = normalizeDimensionPayload(dimension, get().dimensionSettings);
        set((state) => ({ dimensions: [...state.dimensions, { ...normalized, id }] }));
        if (!options?.skipHistory) {
          get().saveToHistory('Add dimension');
        }
        return id;
      },

      updateDimension: (id, data, options) => {
        set((state) => ({
          dimensions: state.dimensions.map((d) => {
            if (d.id !== id) return d;
            const merged = { ...d, ...data };
            return {
              ...normalizeDimensionPayload(
                merged,
                state.dimensionSettings
              ),
              id: d.id,
            };
          })
        }));
        if (!options?.skipHistory) {
          get().saveToHistory('Update dimension');
        }
      },

      deleteDimension: (id) => {
        set((state) => ({ dimensions: state.dimensions.filter((d) => d.id !== id) }));
        get().saveToHistory('Delete dimension');
      },

      setDimensionSettings: (settings) => {
        set((state) => ({
          dimensionSettings: {
            ...state.dimensionSettings,
            ...settings,
            precision:
              settings.precision === 0 || settings.precision === 1 || settings.precision === 2
                ? settings.precision
                : state.dimensionSettings.precision,
            defaultOffset: settings.defaultOffset !== undefined
              ? Math.max(20, settings.defaultOffset)
              : state.dimensionSettings.defaultOffset,
            extensionGap: settings.extensionGap !== undefined
              ? Math.max(0, settings.extensionGap)
              : state.dimensionSettings.extensionGap,
            extensionBeyond: settings.extensionBeyond !== undefined
              ? Math.max(0, settings.extensionBeyond)
              : state.dimensionSettings.extensionBeyond,
          },
        }));
      },

      autoDimensionExteriorWalls: () => {
        const { walls, rooms, dimensionSettings, dimensions } = get();
        const autoLinear = buildAutoWallDimensions(walls, rooms, dimensionSettings);
        const autoArea = buildRoomAreaDimensions(rooms, dimensionSettings);
        const preserved = dimensions.filter((dimension) => !dimension.baselineGroupId && !dimension.linkedRoomId);
        set({
          dimensions: [
            ...preserved,
            ...autoLinear.map((dimension) => ({ ...normalizeDimensionPayload(dimension, dimensionSettings), id: generateId() })),
            ...autoArea.map((dimension) => ({ ...normalizeDimensionPayload(dimension, dimensionSettings), id: generateId() })),
          ],
        });
        get().saveToHistory('Auto dimension exterior walls');
        get().setProcessingStatus('Auto dimensions added (walls + room areas).', false);
      },

      addAreaDimensions: () => {
        const { rooms, dimensionSettings } = get();
        const areaDimensions = buildRoomAreaDimensions(rooms, dimensionSettings);
        set((state) => ({
          dimensions: [
            ...state.dimensions.filter((dimension) => !dimension.linkedRoomId),
            ...areaDimensions.map((dimension) => ({
              ...normalizeDimensionPayload(dimension, dimensionSettings),
              id: generateId(),
            })),
          ],
        }));
        get().saveToHistory('Add room area dimensions');
        get().setProcessingStatus('Room area labels updated.', false);
      },

      // Annotation Actions
      addAnnotation: (annotation) => {
        const id = generateId();
        set((state) => ({ annotations: [...state.annotations, { ...annotation, id }] }));
        get().saveToHistory('Add annotation');
        return id;
      },

      updateAnnotation: (id, data) => {
        set((state) => ({
          annotations: state.annotations.map((a) => a.id === id ? { ...a, ...data } : a)
        }));
        get().saveToHistory('Update annotation');
      },

      deleteAnnotation: (id) => {
        set((state) => ({ annotations: state.annotations.filter((a) => a.id !== id) }));
        get().saveToHistory('Delete annotation');
      },

      // Sketch Actions
      addSketch: (sketch) => {
        const id = generateId();
        set((state) => ({ sketches: [...state.sketches, { ...sketch, id }] }));
        get().saveToHistory('Add sketch');
        return id;
      },

      updateSketch: (id, data) => {
        set((state) => ({
          sketches: state.sketches.map((s) => s.id === id ? { ...s, ...data } : s)
        }));
        get().saveToHistory('Update sketch');
      },

      deleteSketch: (id) => {
        set((state) => ({ sketches: state.sketches.filter((s) => s.id !== id) }));
        get().saveToHistory('Delete sketch');
      },

      // Symbol Actions
      addSymbol: (symbol) => {
        const id = generateId();
        set((state) => ({ symbols: [...state.symbols, { ...symbol, id }] }));
        get().saveToHistory('Add symbol');
        return id;
      },

      updateSymbol: (id, data) => {
        set((state) => ({
          symbols: state.symbols.map((s) => s.id === id ? { ...s, ...data } : s)
        }));
        get().saveToHistory('Update symbol');
      },

      deleteSymbol: (id) => {
        set((state) => ({ symbols: state.symbols.filter((s) => s.id !== id) }));
        get().saveToHistory('Delete symbol');
      },

      // Wall Actions
      detectRooms: (options) => {
        const runDetection = () => {
          set((state) => {
            const topology = roomTopologyHash(state.walls);
            if (topology === lastRoomTopologyHash) {
              return state;
            }
            const detectedRooms = buildAutoDetectedRooms(state.walls, state.rooms);
            lastRoomTopologyHash = topology;
            return {
              rooms: detectedRooms,
            };
          });
        };

        if (options?.debounce) {
          if (roomDetectionTimer) {
            clearTimeout(roomDetectionTimer);
          }
          roomDetectionTimer = setTimeout(() => {
            roomDetectionTimer = null;
            runDetection();
          }, ROOM_DETECTION_DEBOUNCE_MS);
          return;
        }

        if (roomDetectionTimer) {
          clearTimeout(roomDetectionTimer);
          roomDetectionTimer = null;
        }
        runDetection();
      },

      regenerateElevations: (options) => {
        const runRegeneration = () => {
          set((state) => {
            const nextViews = regenerateElevationViews(
              state.walls,
              state.sectionLines,
              state.elevationViews,
              state.elevationSettings
            );
            const nextActiveViewId =
              state.activeElevationViewId &&
                nextViews.some((view) => view.id === state.activeElevationViewId)
                ? state.activeElevationViewId
                : nextViews[0]?.id ?? null;
            return {
              elevationViews: nextViews,
              activeElevationViewId: nextActiveViewId,
            };
          });
        };

        if (options?.debounce) {
          if (elevationRegenTimer) {
            clearTimeout(elevationRegenTimer);
          }
          elevationRegenTimer = setTimeout(() => {
            elevationRegenTimer = null;
            runRegeneration();
          }, ELEVATION_REGEN_DEBOUNCE_MS);
          return;
        }

        if (elevationRegenTimer) {
          clearTimeout(elevationRegenTimer);
          elevationRegenTimer = null;
        }

        runRegeneration();
      },

      setElevationSettings: (settings) => {
        set((state) => ({
          elevationSettings: {
            ...state.elevationSettings,
            ...settings,
            defaultGridIncrementMm: settings.defaultGridIncrementMm !== undefined
              ? Math.max(100, settings.defaultGridIncrementMm)
              : state.elevationSettings.defaultGridIncrementMm,
            defaultScale: settings.defaultScale !== undefined
              ? Math.max(1, settings.defaultScale)
              : state.elevationSettings.defaultScale,
            sunAngleDeg: settings.sunAngleDeg !== undefined
              ? clampValue(settings.sunAngleDeg, 0, 360)
              : state.elevationSettings.sunAngleDeg,
          },
        }));
        get().regenerateElevations();
      },

      setActiveElevationView: (id) =>
        set((state) => ({
          activeElevationViewId: id && state.elevationViews.some((view) => view.id === id) ? id : null,
        })),

      startSectionLineDrawing: (startPoint) => {
        const sectionIndex = get().sectionLines.length + 1;
        const nextKind = get().sectionLineDrawingState.nextKind;
        const nextLabel = sectionLabelForIndex(nextKind, sectionIndex);
        set((state) => ({
          sectionLineDrawingState: {
            ...state.sectionLineDrawingState,
            isDrawing: true,
            startPoint: { ...startPoint },
            currentPoint: { ...startPoint },
            nextLabel,
          },
        }));
      },

      updateSectionLinePreview: (currentPoint) =>
        set((state) => ({
          sectionLineDrawingState: {
            ...state.sectionLineDrawingState,
            currentPoint: { ...currentPoint },
          },
        })),

      cancelSectionLineDrawing: () =>
        set((state) => ({
          sectionLineDrawingState: {
            ...DEFAULT_SECTION_LINE_DRAWING_STATE,
            direction: state.sectionLineDrawingState.direction,
            nextKind: state.sectionLineDrawingState.nextKind,
          },
        })),

      setSectionLineDirection: (direction) =>
        set((state) => ({
          sectionLineDrawingState: {
            ...state.sectionLineDrawingState,
            direction: direction === -1 ? -1 : 1,
          },
        })),

      commitSectionLine: () => {
        const { sectionLineDrawingState, wallSettings } = get();
        if (
          !sectionLineDrawingState.isDrawing ||
          !sectionLineDrawingState.startPoint ||
          !sectionLineDrawingState.currentPoint
        ) {
          return null;
        }

        const sectionLength = wallLengthMm(
          sectionLineDrawingState.startPoint,
          sectionLineDrawingState.currentPoint
        );
        if (sectionLength < MIN_WALL_LENGTH) {
          return null;
        }

        const sectionIndex = get().sectionLines.length + 1;
        const fallbackLabel = sectionLabelForIndex(sectionLineDrawingState.nextKind, sectionIndex);
        const label =
          sectionLineDrawingState.nextLabel.trim().length > 0
            ? sectionLineDrawingState.nextLabel.trim()
            : fallbackLabel;

        const sectionLine: SectionLine = {
          id: generateId(),
          label,
          name: label,
          kind: sectionLineDrawingState.nextKind,
          startPoint: { ...sectionLineDrawingState.startPoint },
          endPoint: { ...sectionLineDrawingState.currentPoint },
          direction: sectionLineDrawingState.direction,
          color: DEFAULT_SECTION_LINE_COLOR,
          depthMm: DEFAULT_SECTION_LINE_DEPTH_MM,
          locked: false,
          showReferenceIndicators: wallSettings.showSectionReferenceLines,
        };

        set((state) => ({
          sectionLines: [...state.sectionLines, sectionLine],
          sectionLineDrawingState: {
            ...DEFAULT_SECTION_LINE_DRAWING_STATE,
            direction: state.sectionLineDrawingState.direction,
            nextKind: state.sectionLineDrawingState.nextKind,
            nextLabel: sectionLabelForIndex(state.sectionLineDrawingState.nextKind, state.sectionLines.length + 2),
          },
        }));
        get().generateElevationForSection(sectionLine.id);
        get().saveToHistory('Add section line');
        return sectionLine.id;
      },

      generateElevationForSection: (sectionLineId) => {
        set((state) => {
          const sectionLine = state.sectionLines.find((entry) => entry.id === sectionLineId);
          if (!sectionLine) return state;

          const existingCustom = state.elevationViews.find(
            (view) => view.kind === 'custom' && view.sectionLineId === sectionLineId
          ) ?? null;
          const customView = generateCustomElevationView(
            sectionLine,
            state.walls,
            existingCustom,
            state.elevationSettings
          );
          const standardViews = createStandardElevationViews(
            state.walls,
            state.elevationViews,
            state.elevationSettings
          );
          const customViews = state.elevationViews.filter(
            (view) =>
              view.kind === 'custom' &&
              view.sectionLineId !== sectionLineId &&
              view.sectionLineId &&
              state.sectionLines.some((entry) => entry.id === view.sectionLineId)
          );
          return {
            elevationViews: [...standardViews, ...customViews, customView],
            activeElevationViewId: customView.id,
          };
        });
      },

      updateSectionLine: (id, updates) => {
        const nextUpdates: Partial<SectionLine> = { ...updates };
        if (nextUpdates.direction !== undefined) {
          nextUpdates.direction = nextUpdates.direction === -1 ? -1 : 1;
        }
        if (nextUpdates.depthMm !== undefined) {
          nextUpdates.depthMm = Math.max(100, nextUpdates.depthMm);
        }
        set((state) => ({
          sectionLines: state.sectionLines.map((line) =>
            line.id === id
              ? {
                ...line,
                ...nextUpdates,
              }
              : line
          ),
        }));
        get().generateElevationForSection(id);
        get().saveToHistory('Update section line');
      },

      flipSectionLineDirection: (sectionLineId) => {
        set((state) => ({
          sectionLines: state.sectionLines.map((line) =>
            line.id === sectionLineId
              ? { ...line, direction: line.direction === 1 ? -1 : 1 }
              : line
          ),
        }));
        get().generateElevationForSection(sectionLineId);
        get().saveToHistory('Flip section direction');
      },

      deleteSectionLine: (id) => {
        set((state) => {
          const nextSectionLines = state.sectionLines.filter((line) => line.id !== id);
          const nextViews = state.elevationViews.filter((view) => view.sectionLineId !== id);
          const nextActive =
            state.activeElevationViewId &&
              nextViews.some((view) => view.id === state.activeElevationViewId)
              ? state.activeElevationViewId
              : nextViews[0]?.id ?? null;
          return {
            sectionLines: nextSectionLines,
            elevationViews: nextViews,
            activeElevationViewId: nextActive,
          };
        });
        get().regenerateElevations();
        get().saveToHistory('Delete section line');
      },

      addWall: (params) => {
        const id = generateId();
        const thickness = clampThickness(params.thickness ?? 150);
        const material = params.material ?? 'brick';
        const layer = params.layer ?? 'partition';
        const existingWalls = get().walls;
        const trimmedEndpoints = autoTrimWallEndpoints(
          params.startPoint,
          params.endPoint,
          existingWalls
        );
        const connectedWallIds = Array.from(
          new Set([
            ...findWallsTouchingPoint(trimmedEndpoints.startPoint, existingWalls),
            ...findWallsTouchingPoint(trimmedEndpoints.endPoint, existingWalls),
          ])
        );

        // Compute offset lines
        const dx = trimmedEndpoints.endPoint.x - trimmedEndpoints.startPoint.x;
        const dy = trimmedEndpoints.endPoint.y - trimmedEndpoints.startPoint.y;
        const length = Math.sqrt(dx * dx + dy * dy) || 1;
        const perpX = -dy / length;
        const perpY = dx / length;
        const halfThickness = thickness / 2;

        const wall: Wall = {
          id,
          startPoint: { ...trimmedEndpoints.startPoint },
          endPoint: { ...trimmedEndpoints.endPoint },
          thickness,
          material,
          layer,
          interiorLine: {
            start: {
              x: trimmedEndpoints.startPoint.x + perpX * halfThickness,
              y: trimmedEndpoints.startPoint.y + perpY * halfThickness,
            },
            end: {
              x: trimmedEndpoints.endPoint.x + perpX * halfThickness,
              y: trimmedEndpoints.endPoint.y + perpY * halfThickness,
            },
          },
          exteriorLine: {
            start: {
              x: trimmedEndpoints.startPoint.x - perpX * halfThickness,
              y: trimmedEndpoints.startPoint.y - perpY * halfThickness,
            },
            end: {
              x: trimmedEndpoints.endPoint.x - perpX * halfThickness,
              y: trimmedEndpoints.endPoint.y - perpY * halfThickness,
            },
          },
          startBevel: { ...DEFAULT_BEVEL_CONTROL },
          endBevel: { ...DEFAULT_BEVEL_CONTROL },
          connectedWalls: connectedWallIds,
          openings: [],
          properties3D: { ...DEFAULT_WALL_3D },
        };
        const materialId = getDefaultMaterialIdForWallMaterial(wall.material);
        const boundWall = bindWallAttributes(wall, {
          materialId,
          height: get().wallSettings.defaultHeight ?? DEFAULT_WALL_HEIGHT,
          layerCount: get().wallSettings.defaultLayerCount ?? DEFAULT_WALL_LAYER_COUNT,
          thermalResistance: getArchitecturalMaterial(materialId)?.thermalResistance ?? DEFAULT_WALL_3D.thermalResistance,
        });

        set((state) => ({
          walls: [
            ...state.walls.map((existingWall) => {
              if (
                connectedWallIds.includes(existingWall.id) &&
                !existingWall.connectedWalls.includes(id)
              ) {
                return {
                  ...existingWall,
                  connectedWalls: [...existingWall.connectedWalls, id],
                };
              }
              return existingWall;
            }),
            boundWall,
          ],
        }));
        attributeChangeObserver.notify({
          entity: 'wall',
          entityId: boundWall.id,
          previousValue: null,
          nextValue: boundWall.properties3D,
          source: 'binding',
          timestamp: Date.now(),
        });
        get().detectRooms();
        get().regenerateElevations();
        get().saveToHistory('Add wall');
        return id;
      },

      updateWall: (id, updates, options) => {
        const safeUpdates = updates.thickness !== undefined
          ? { ...updates, thickness: clampThickness(updates.thickness) }
          : updates;
        let previousValue: Wall3D | null = null;
        let nextValue: Wall3D | null = null;
        const geometryChanged = Boolean(
          safeUpdates.startPoint ||
          safeUpdates.endPoint ||
          safeUpdates.thickness !== undefined ||
          safeUpdates.openings
        );
        const elevationChanged = Boolean(
          geometryChanged ||
          safeUpdates.material !== undefined ||
          safeUpdates.layer !== undefined
        );

        set((state) => {
          const nextWalls = state.walls.map((wall) => {
            if (wall.id !== id) return wall;
            previousValue = wall.properties3D;
            const updatedWall = normalizeWallBevel({
              ...wall,
              ...safeUpdates,
              startBevel: safeUpdates.startBevel ?? wall.startBevel,
              endBevel: safeUpdates.endBevel ?? wall.endBevel,
            });

            // Recompute geometry if relevant fields changed
            if (safeUpdates.startPoint || safeUpdates.endPoint || safeUpdates.thickness) {
              const dx = updatedWall.endPoint.x - updatedWall.startPoint.x;
              const dy = updatedWall.endPoint.y - updatedWall.startPoint.y;
              const length = Math.sqrt(dx * dx + dy * dy) || 1;
              const perpX = -dy / length;
              const perpY = dx / length;
              const halfThickness = updatedWall.thickness / 2;

              updatedWall.interiorLine = {
                start: { x: updatedWall.startPoint.x + perpX * halfThickness, y: updatedWall.startPoint.y + perpY * halfThickness },
                end: { x: updatedWall.endPoint.x + perpX * halfThickness, y: updatedWall.endPoint.y + perpY * halfThickness },
              };
              updatedWall.exteriorLine = {
                start: { x: updatedWall.startPoint.x - perpX * halfThickness, y: updatedWall.startPoint.y - perpY * halfThickness },
                end: { x: updatedWall.endPoint.x - perpX * halfThickness, y: updatedWall.endPoint.y - perpY * halfThickness },
              };
            }

            const reboundWall = bindWallAttributes(updatedWall, updatedWall.properties3D);
            nextValue = reboundWall.properties3D;
            return reboundWall;
          });
          return { walls: nextWalls };
        });
        if (nextValue) {
          attributeChangeObserver.notify({
            entity: 'wall',
            entityId: id,
            previousValue,
            nextValue,
            source: options?.source ?? 'ui',
            timestamp: Date.now(),
          });
        }
        if (!options?.skipHistory) {
          get().saveToHistory('Update wall');
        }
        if (geometryChanged && !options?.skipRoomDetection) {
          get().detectRooms({ debounce: options?.source === 'drag' });
        }
        if (elevationChanged) {
          get().regenerateElevations({ debounce: options?.source === 'drag' });
        }
      },

      updateWallBevel: (wallId, end, bevel, options) => {
        const walls = get().walls;
        const targetWall = walls.find((wall) => wall.id === wallId);
        if (!targetWall) return;

        const corner = computeCornerBevelDotsForEndpoint(targetWall, end, walls, 2);
        const fallbackMax = wallLengthMm(targetWall.startPoint, targetWall.endPoint) / 2;
        const maxOffset = Math.max(0, corner?.maxOffset ?? fallbackMax);

        set((state) => ({
          walls: state.walls.map((wall) => {
            if (wall.id === wallId) {
              return applyWallEndpointBevel(wall, end, bevel, maxOffset);
            }
            if (corner && wall.id === corner.otherWallId) {
              return applyWallEndpointBevel(wall, corner.otherEnd, bevel, maxOffset);
            }
            return wall;
          }),
        }));

        if (!options?.skipHistory) {
          get().saveToHistory('Adjust wall bevel');
        }
        if (!options?.skipRoomDetection) {
          get().detectRooms({ debounce: options?.source === 'drag' });
        }
      },

      resetWallBevel: (wallId, end) => {
        get().updateWallBevel(
          wallId,
          end,
          {
            outerOffset: 0,
            innerOffset: 0,
          },
          {
            skipHistory: false,
            source: 'ui',
            skipRoomDetection: false,
          }
        );
      },

      getCornerBevelDots: (cornerPoint) => {
        const walls = get().walls;
        for (const wall of walls) {
          const startCorner = computeCornerBevelDotsForEndpoint(wall, 'start', walls, 2);
          if (startCorner && pointsNear(startCorner.cornerPoint, cornerPoint, 2)) {
            return {
              outerDotPosition: startCorner.outerDotPosition,
              innerDotPosition: startCorner.innerDotPosition,
              outerOffset: startCorner.outerOffset,
              innerOffset: startCorner.innerOffset,
            };
          }
          const endCorner = computeCornerBevelDotsForEndpoint(wall, 'end', walls, 2);
          if (endCorner && pointsNear(endCorner.cornerPoint, cornerPoint, 2)) {
            return {
              outerDotPosition: endCorner.outerDotPosition,
              innerDotPosition: endCorner.innerDotPosition,
              outerOffset: endCorner.outerOffset,
              innerOffset: endCorner.innerOffset,
            };
          }
        }
        return null;
      },

      updateWall3DAttributes: (id, updates) => {
        let previousValue: Wall3D | null = null;
        let nextValue: Wall3D | null = null;

        set((state) => {
          const nextWalls = state.walls.map((wall) => {
            if (wall.id !== id) return wall;
            previousValue = wall.properties3D;

            const merged = {
              ...wall.properties3D,
              ...updates,
            };
            const validation = validateWall3DAttributes(merged);
            const nextWall = bindWallAttributes(
              {
                ...wall,
                thickness: updates.materialId
                  ? getArchitecturalMaterial(updates.materialId)?.defaultThicknessMm ?? wall.thickness
                  : wall.thickness,
                material: updates.materialId
                  ? resolveWallMaterialFromLibrary(updates.materialId)
                  : wall.material,
                properties3D: validation.value,
              },
              validation.value
            );
            nextValue = nextWall.properties3D;
            return nextWall;
          });
          return { walls: nextWalls };
        });

        if (nextValue) {
          attributeChangeObserver.notify({
            entity: 'wall',
            entityId: id,
            previousValue,
            nextValue,
            source: 'ui',
            timestamp: Date.now(),
          });
        }
        get().regenerateElevations();
        get().saveToHistory('Update wall 3D attributes');
      },

      deleteWall: (id) => {
        const wallToDelete = get().walls.find((wall) => wall.id === id);
        if (!wallToDelete) return;

        set((state) => ({
          walls: state.walls
            .filter((w) => w.id !== id)
            .map((wall) => {
              const cleaned = normalizeWallBevel({
                ...wall,
                connectedWalls: wall.connectedWalls.filter((cid) => cid !== id),
              });
              const touchesStart = pointsNear(cleaned.startPoint, wallToDelete.startPoint, 2)
                || pointsNear(cleaned.startPoint, wallToDelete.endPoint, 2);
              const touchesEnd = pointsNear(cleaned.endPoint, wallToDelete.startPoint, 2)
                || pointsNear(cleaned.endPoint, wallToDelete.endPoint, 2);
              return {
                ...cleaned,
                startBevel: touchesStart ? { ...DEFAULT_BEVEL_CONTROL } : cleaned.startBevel,
                endBevel: touchesEnd ? { ...DEFAULT_BEVEL_CONTROL } : cleaned.endBevel,
              };
            }),
          rooms: state.rooms.map((room) => ({
            ...room,
            wallIds: room.wallIds.filter((wallId) => wallId !== id),
          })),
        }));
        get().detectRooms();
        get().regenerateElevations();
        get().saveToHistory('Delete wall');
      },

      getWall: (id) => get().walls.find((w) => w.id === id),

      addRoom: (params) => {
        const room = createRoomModel(params);
        set((state) => ({
          rooms: [...state.rooms, room],
        }));
        attributeChangeObserver.notify({
          entity: 'room',
          entityId: room.id,
          previousValue: null,
          nextValue: room.properties3D,
          source: 'binding',
          timestamp: Date.now(),
        });
        get().saveToHistory('Add room');
        return room.id;
      },

      updateRoom: (id, updates) => {
        let previousValue: Room3D | null = null;
        let nextValue: Room3D | null = null;
        set((state) => ({
          rooms: state.rooms.map((room) => {
            if (room.id !== id) return room;
            previousValue = room.properties3D;
            const mergedRoom = {
              ...room,
              ...updates,
            };
            const reboundRoom = bindRoomAttributes(mergedRoom, mergedRoom.properties3D);
            nextValue = reboundRoom.properties3D;
            return reboundRoom;
          }),
        }));
        if (nextValue) {
          attributeChangeObserver.notify({
            entity: 'room',
            entityId: id,
            previousValue,
            nextValue,
            source: 'ui',
            timestamp: Date.now(),
          });
        }
        get().saveToHistory('Update room');
      },

      updateRoom3DAttributes: (id, updates) => {
        let previousValue: Room3D | null = null;
        let nextValue: Room3D | null = null;
        set((state) => ({
          rooms: state.rooms.map((room) => {
            if (room.id !== id) return room;
            previousValue = room.properties3D;
            const validation = validateRoom3DAttributes({
              ...room.properties3D,
              ...updates,
            });
            const reboundRoom = bindRoomAttributes(
              {
                ...room,
                properties3D: validation.value,
              },
              validation.value
            );
            nextValue = reboundRoom.properties3D;
            return reboundRoom;
          }),
        }));
        if (nextValue) {
          attributeChangeObserver.notify({
            entity: 'room',
            entityId: id,
            previousValue,
            nextValue,
            source: 'ui',
            timestamp: Date.now(),
          });
        }
        get().saveToHistory('Update room 3D attributes');
      },

      setHvacDesignConditions: (updates) => {
        set((state) => ({
          hvacDesignConditions: {
            ...state.hvacDesignConditions,
            ...updates,
            peakCoolingHour: updates.peakCoolingHour !== undefined
              ? clampValue(updates.peakCoolingHour, 0, 23)
              : state.hvacDesignConditions.peakCoolingHour,
            internalGainDiversityFactor: updates.internalGainDiversityFactor !== undefined
              ? clampValue(updates.internalGainDiversityFactor, 0, 1)
              : state.hvacDesignConditions.internalGainDiversityFactor,
            defaultWindowShgc: updates.defaultWindowShgc !== undefined
              ? clampValue(updates.defaultWindowShgc, 0, 1)
              : state.hvacDesignConditions.defaultWindowShgc,
            seasonalVariation: {
              ...state.hvacDesignConditions.seasonalVariation,
              ...(updates.seasonalVariation ?? {}),
            },
          },
        }));
      },

      applyRoomTemplateToSelectedRooms: (templateId) => {
        const template = DEFAULT_ROOM_HVAC_TEMPLATES.find((entry) => entry.id === templateId);
        if (!template) return;
        const selectedSet = new Set(get().selectedElementIds);
        let affectedCount = 0;

        set((state) => ({
          rooms: state.rooms.map((room) => {
            if (!selectedSet.has(room.id)) return room;
            affectedCount += 1;
            const areaM2 = room.area / 1_000_000;
            const occupancyFromDensity = template.occupantsPer10m2 > 0
              ? (areaM2 / 10) * template.occupantsPer10m2
              : 0;
            const occupantCount = Math.max(1, Math.round(Math.max(template.occupantsBase, occupancyFromDensity) * 10) / 10);
            const validation = validateRoom3DAttributes({
              ...room.properties3D,
              hvacTemplateId: template.id,
              occupantCount,
              occupancySchedule: template.schedule,
              lightingLoadWm2: template.lightingWm2,
              equipmentLoadWm2: template.equipmentWm2,
              requiresExhaust: template.requiresExhaust,
            });
            return bindRoomAttributes(
              {
                ...room,
                properties3D: validation.value,
              },
              validation.value
            );
          }),
        }));

        if (affectedCount > 0) {
          get().saveToHistory('Apply HVAC template');
          get().setProcessingStatus(`Applied template to ${affectedCount} room(s).`, false);
        }
      },

      deleteRoom: (id) => {
        const room = get().rooms.find((entry) => entry.id === id);
        set((state) => ({
          rooms: state.rooms.filter((room) => room.id !== id),
        }));
        if (room) {
          get().setProcessingStatus(`Removed room "${room.name}". Walls were kept.`, false);
        }
        get().saveToHistory('Delete room');
      },

      getRoom: (id) => get().rooms.find((room) => room.id === id),

      moveRoom: (id, delta, options) => {
        const room = get().rooms.find((entry) => entry.id === id);
        if (!room) return;

        room.wallIds.forEach((wallId) => {
          const wall = get().walls.find((entry) => entry.id === wallId);
          if (!wall) return;
          get().updateWall(
            wallId,
            {
              startPoint: {
                x: wall.startPoint.x + delta.x,
                y: wall.startPoint.y + delta.y,
              },
              endPoint: {
                x: wall.endPoint.x + delta.x,
                y: wall.endPoint.y + delta.y,
              },
            },
            {
              skipHistory: true,
              source: 'drag',
              skipRoomDetection: true,
            }
          );
        });

        get().detectRooms({ debounce: options?.skipHistory });
        if (!options?.skipHistory) {
          get().saveToHistory('Move room');
        }
      },

      startWallDrawing: (startPoint) => {
        const { wallSettings } = get();
        set({
          wallDrawingState: {
            isDrawing: true,
            startPoint: { ...startPoint },
            currentPoint: { ...startPoint },
            chainMode: wallSettings.chainModeEnabled,
            previewThickness: clampThickness(wallSettings.defaultThickness),
            previewMaterial: wallSettings.defaultMaterial,
          },
        });
      },

      updateWallPreview: (currentPoint) => {
        set((state) => ({
          wallDrawingState: {
            ...state.wallDrawingState,
            currentPoint: { ...currentPoint },
          },
        }));
      },

      commitWall: () => {
        const { wallDrawingState, wallSettings } = get();

        if (!wallDrawingState.isDrawing || !wallDrawingState.startPoint || !wallDrawingState.currentPoint) {
          return null;
        }

        const length = wallLengthMm(wallDrawingState.startPoint, wallDrawingState.currentPoint);
        if (length < MIN_WALL_LENGTH) {
          return null;
        }

        // Create the wall
        const wallId = get().addWall({
          startPoint: wallDrawingState.startPoint,
          endPoint: wallDrawingState.currentPoint,
          thickness: wallDrawingState.previewThickness,
          material: wallDrawingState.previewMaterial,
          layer: wallSettings.defaultLayer,
        });

        // If chain mode, start next wall from current endpoint
        if (wallDrawingState.chainMode) {
          set({
            wallDrawingState: {
              ...wallDrawingState,
              startPoint: { ...wallDrawingState.currentPoint },
              currentPoint: { ...wallDrawingState.currentPoint },
            },
          });
        } else {
          set({
            wallDrawingState: { ...DEFAULT_WALL_DRAWING_STATE },
          });
        }

        return wallId;
      },

      cancelWallDrawing: () => {
        set({
          wallDrawingState: { ...DEFAULT_WALL_DRAWING_STATE },
        });
      },

      setChainMode: (enabled) => {
        set((state) => ({
          wallDrawingState: {
            ...state.wallDrawingState,
            chainMode: enabled,
          },
          wallSettings: {
            ...state.wallSettings,
            chainModeEnabled: enabled,
          },
        }));
      },

      connectWalls: (wallId, otherWallId) => {
        if (wallId === otherWallId) return;
        set((state) => {
          const wallIndex = state.walls.findIndex((wall) => wall.id === wallId);
          const otherWallIndex = state.walls.findIndex((wall) => wall.id === otherWallId);
          if (wallIndex < 0 || otherWallIndex < 0) {
            return state;
          }

          const wall = state.walls[wallIndex];
          const otherWall = state.walls[otherWallIndex];
          const wallHasOther = wall.connectedWalls.includes(otherWallId);
          const otherHasWall = otherWall.connectedWalls.includes(wallId);

          if (wallHasOther && otherHasWall) {
            return state;
          }

          const nextWalls = [...state.walls];

          if (!wallHasOther) {
            nextWalls[wallIndex] = {
              ...wall,
              connectedWalls: [...wall.connectedWalls, otherWallId],
            };
          }

          if (!otherHasWall) {
            const latestOther = nextWalls[otherWallIndex];
            nextWalls[otherWallIndex] = {
              ...latestOther,
              connectedWalls: [...latestOther.connectedWalls, wallId],
            };
          }

          return { walls: nextWalls };
        });
      },

      disconnectWall: (wallId, otherWallId) => {
        set((state) => ({
          walls: state.walls.map((wall) => {
            if (wall.id === wallId || wall.id === otherWallId) {
              return {
                ...wall,
                connectedWalls: wall.connectedWalls.filter((id) => id !== wallId && id !== otherWallId),
              };
            }
            return wall;
          }),
        }));
      },

      setWallSettings: (settings) => {
        const safeSettings = { ...settings };
        if (safeSettings.defaultThickness !== undefined) {
          safeSettings.defaultThickness = clampThickness(safeSettings.defaultThickness);
        }
        if (safeSettings.defaultHeight !== undefined) {
          safeSettings.defaultHeight = clampValue(
            safeSettings.defaultHeight,
            MIN_WALL_HEIGHT,
            MAX_WALL_HEIGHT
          );
        }
        if (safeSettings.defaultLayerCount !== undefined) {
          safeSettings.defaultLayerCount = Math.max(1, Math.round(safeSettings.defaultLayerCount));
        }
        if (safeSettings.gridSize !== undefined) {
          safeSettings.gridSize = Math.max(1, safeSettings.gridSize);
        }

        set((state) => ({
          wallSettings: { ...state.wallSettings, ...safeSettings },
        }));
      },

      setWallPreviewMaterial: (material) => {
        set((state) => ({
          wallDrawingState: {
            ...state.wallDrawingState,
            previewMaterial: material,
          },
        }));
      },

      setWallPreviewThickness: (thickness) => {
        set((state) => ({
          wallDrawingState: {
            ...state.wallDrawingState,
            previewThickness: clampThickness(thickness),
          },
        }));
      },

      createRoomWalls: (config, startCorner) => {
        const { width, height, wallThickness, material } = config;
        const layer = material === 'partition' ? 'partition' : 'structural';

        const corners: Point2D[] = [
          startCorner,
          { x: startCorner.x + width, y: startCorner.y },
          { x: startCorner.x + width, y: startCorner.y + height },
          { x: startCorner.x, y: startCorner.y + height },
        ];

        const wallIds: string[] = [];
        for (let i = 0; i < 4; i++) {
          const start = corners[i];
          const end = corners[(i + 1) % 4];
          const wallId = get().addWall({
            startPoint: start,
            endPoint: end,
            thickness: wallThickness,
            material,
            layer,
          });
          wallIds.push(wallId);
        }

        for (let i = 0; i < 4; i++) {
          get().connectWalls(wallIds[i], wallIds[(i + 1) % 4]);
        }

        return wallIds;
      },

      deleteWalls: (ids) => {
        const idsSet = new Set(ids);
        const deletedWalls = get().walls.filter((wall) => idsSet.has(wall.id));
        set((state) => ({
          walls: state.walls
            .filter((w) => !idsSet.has(w.id))
            .map((wall) => {
              const cleaned = normalizeWallBevel({
                ...wall,
                connectedWalls: wall.connectedWalls.filter((cid) => !idsSet.has(cid)),
              });
              const touchesStart = deletedWalls.some(
                (deleted) =>
                  pointsNear(cleaned.startPoint, deleted.startPoint, 2)
                  || pointsNear(cleaned.startPoint, deleted.endPoint, 2)
              );
              const touchesEnd = deletedWalls.some(
                (deleted) =>
                  pointsNear(cleaned.endPoint, deleted.startPoint, 2)
                  || pointsNear(cleaned.endPoint, deleted.endPoint, 2)
              );
              return {
                ...cleaned,
                startBevel: touchesStart ? { ...DEFAULT_BEVEL_CONTROL } : cleaned.startBevel,
                endBevel: touchesEnd ? { ...DEFAULT_BEVEL_CONTROL } : cleaned.endBevel,
              };
            }),
          rooms: state.rooms.map((room) => ({
            ...room,
            wallIds: room.wallIds.filter((wallId) => !idsSet.has(wallId)),
          })),
        }));
        get().detectRooms();
        get().regenerateElevations();
        get().saveToHistory('Delete walls');
      },

      clearAllWalls: () => {
        set({ walls: [], rooms: [] });
        lastRoomTopologyHash = '';
        get().regenerateElevations();
        get().saveToHistory('Clear all walls');
      },

      // Selection Actions
      selectElement: (id, addToSelection = false) => set((state) => ({
        selectedElementIds: addToSelection
          ? [...state.selectedElementIds, id]
          : [id],
        selectedIds: addToSelection
          ? [...state.selectedElementIds, id]
          : [id],
      })),

      deselectElement: (id) => set((state) => ({
        selectedElementIds: state.selectedElementIds.filter((eid) => eid !== id),
        selectedIds: state.selectedElementIds.filter((eid) => eid !== id),
      })),

      clearSelection: () => set({ selectedElementIds: [], selectedIds: [] }),

      selectAll: () => set((state) => ({
        selectedElementIds: [
          ...state.dimensions.map((d) => d.id),
          ...state.annotations.map((a) => a.id),
          ...state.sketches.map((s) => s.id),
          ...state.symbols.map((s) => s.id),
          ...state.walls.map((w) => w.id),
          ...state.rooms.map((room) => room.id),
          ...state.sectionLines.map((line) => line.id),
        ],
        selectedIds: [
          ...state.dimensions.map((d) => d.id),
          ...state.annotations.map((a) => a.id),
          ...state.sketches.map((s) => s.id),
          ...state.symbols.map((s) => s.id),
          ...state.walls.map((w) => w.id),
          ...state.rooms.map((room) => room.id),
          ...state.sectionLines.map((line) => line.id),
        ],
      })),

      setHoveredElement: (id) => set({ hoveredElementId: id }),

      deleteSelectedElements: () => {
        const {
          selectedElementIds,
          dimensions,
          annotations,
          sketches,
          symbols,
          walls,
          rooms,
          sectionLines,
          elevationViews,
          activeElevationViewId,
        } = get();
        const selectedSet = new Set(selectedElementIds);
        const selectedRoomCount = rooms.filter((room) => selectedSet.has(room.id)).length;
        const selectedWallCount = walls.filter((wall) => selectedSet.has(wall.id)).length;
        const roomsAtRisk = rooms.filter((room) =>
          room.wallIds.some((wallId) => selectedSet.has(wallId))
        );
        const brokenRoomNames = roomsAtRisk
          .filter((room) => room.wallIds.filter((wallId) => !selectedSet.has(wallId)).length < 3)
          .map((room) => room.name);
        const nextSectionLines = sectionLines.filter((line) => !selectedSet.has(line.id));
        const removedSectionIds = new Set(
          sectionLines
            .filter((line) => selectedSet.has(line.id))
            .map((line) => line.id)
        );
        const nextElevationViews = elevationViews.filter(
          (view) => !selectedSet.has(view.id) && (!view.sectionLineId || !removedSectionIds.has(view.sectionLineId))
        );
        const nextActiveElevationViewId =
          activeElevationViewId && nextElevationViews.some((view) => view.id === activeElevationViewId)
            ? activeElevationViewId
            : nextElevationViews[0]?.id ?? null;
        set({
          dimensions: dimensions.filter((d) => !selectedSet.has(d.id)),
          annotations: annotations.filter((a) => !selectedSet.has(a.id)),
          sketches: sketches.filter((s) => !selectedSet.has(s.id)),
          symbols: symbols.filter((s) => !selectedSet.has(s.id)),
          walls: walls
            .filter((w) => !selectedSet.has(w.id))
            .map((wall) => ({
              ...wall,
              connectedWalls: wall.connectedWalls.filter((cid) => !selectedSet.has(cid)),
            })),
          rooms: rooms
            .filter((room) => !selectedSet.has(room.id))
            .map((room) => ({
              ...room,
              wallIds: room.wallIds.filter((wallId) => !selectedSet.has(wallId)),
            })),
          sectionLines: nextSectionLines,
          elevationViews: nextElevationViews,
          activeElevationViewId: nextActiveElevationViewId,
          selectedElementIds: [],
          selectedIds: [],
        });
        if (brokenRoomNames.length > 0) {
          get().setProcessingStatus(
            `Warning: room enclosure may be broken (${brokenRoomNames.join(', ')}).`,
            false
          );
        } else if (selectedRoomCount > 0 && selectedWallCount === 0) {
          get().setProcessingStatus(
            `Removed ${selectedRoomCount} room object(s); walls were kept.`,
            false
          );
        }
        get().detectRooms();
        get().regenerateElevations();
        get().saveToHistory('Delete selected');
      },

      // Alias methods for backward compatibility
      setSelectedIds: (ids) => set({ selectedElementIds: ids, selectedIds: ids }),
      deleteSelected: () => get().deleteSelectedElements(),
      setTool: (tool) => set({ activeTool: tool, tool }),
      loadData: (data) => {
        try {
          const normalized = typeof data === 'string' ? data : JSON.stringify(data);
          get().importFromJSON(normalized);
        } catch (error) {
          console.error('Failed to load drawing data:', error);
          get().setProcessingStatus('Failed to load drawing data.', false);
        }
      },
      exportData: () => get().exportToJSON(),

      // Tool Actions
      setActiveTool: (tool) => set({ activeTool: tool, tool }),

      // View Actions
      setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
      setPanOffset: (offset) => set({ panOffset: offset }),
      setViewTransform: (zoom, offset) =>
        set({
          zoom: Math.max(0.1, Math.min(10, zoom)),
          panOffset: offset,
        }),
      setDisplayUnit: (unit) => set({ displayUnit: unit }),
      setGridSize: (size) => set({ gridSize: size }),
      setSnapToGrid: (snap) => set({ snapToGrid: snap }),
      setShowGrid: (show) => set({ showGrid: show }),
      setShowRulers: (show) => set({ showRulers: show }),
      toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
      setPageConfig: (config) => set((state) => ({
        pageConfig: { ...state.pageConfig, ...config }
      })),
      resetView: () => set({ zoom: 1, panOffset: { x: 0, y: 0 }, resetViewRequestId: Date.now() }),
      zoomToFit: () => set({ zoomToFitRequestId: Date.now() }),

      // Preview Actions
      setPreviewHeight: (height) => set({ previewHeight: height }),
      setShow3DPreview: (show) => set({ show3DPreview: show }),
      setAutoSync3D: (sync) => set({ autoSync3D: sync }),

      // Calibration Actions
      startCalibration: () => set({
        isCalibrating: true,
        calibrationStep: 1,
        activeTool: 'calibrate',
        tool: 'calibrate',
      }),

      addCalibrationPoint: (point) => set((state) => {
        if (!state.importedDrawing) return state;
        const points = state.importedDrawing.calibrationPoints || [];
        const newPoint = { id: generateId(), pixelPoint: point };
        return {
          importedDrawing: {
            ...state.importedDrawing,
            calibrationPoints: [...points, newPoint]
          },
          calibrationStep: state.calibrationStep + 1,
        };
      }),

      setCalibrationDistance: (distance) => set((state) => {
        if (!state.importedDrawing?.calibrationPoints ||
          state.importedDrawing.calibrationPoints.length < 2) {
          return state;
        }
        const [p1, p2] = state.importedDrawing.calibrationPoints;
        if (!p1 || !p2) {
          return state;
        }
        const pixelDistance = Math.sqrt(
          Math.pow(p2.pixelPoint.x - p1.pixelPoint.x, 2) +
          Math.pow(p2.pixelPoint.y - p1.pixelPoint.y, 2)
        );
        const scale = pixelDistance / distance;
        return {
          importedDrawing: { ...state.importedDrawing, scale },
          isCalibrating: false,
          calibrationStep: 0,
          activeTool: 'select',
          tool: 'select',
        };
      }),

      finishCalibration: () => set({
        isCalibrating: false,
        calibrationStep: 0,
        activeTool: 'select',
        tool: 'select',
      }),

      cancelCalibration: () => set((state) => ({
        isCalibrating: false,
        calibrationStep: 0,
        activeTool: 'select',
        tool: 'select',
        importedDrawing: state.importedDrawing
          ? { ...state.importedDrawing, calibrationPoints: [] }
          : null,
      })),

      // Layer Actions
      addLayer: (name) => {
        const id = generateId();
        set((state) => ({
          layers: [...state.layers, {
            id,
            name,
            visible: true,
            locked: false,
            opacity: 1,
            elements: []
          }],
        }));
        return id;
      },

      updateLayer: (id, data) => set((state) => ({
        layers: state.layers.map((l) => l.id === id ? { ...l, ...data } : l),
      })),

      deleteLayer: (id) => set((state) => ({
        layers: state.layers.filter((l) => l.id !== id),
        activeLayerId: state.activeLayerId === id ? 'default' : state.activeLayerId,
      })),

      setActiveLayer: (id) => set({ activeLayerId: id }),

      moveElementToLayer: (elementId, layerId) => set((state) => ({
        layers: state.layers.map((l) => ({
          ...l,
          elements: l.id === layerId
            ? [...l.elements.filter((e) => e !== elementId), elementId]
            : l.elements.filter((e) => e !== elementId),
        })),
      })),

      toggleLayerVisibility: (id) => set((state) => ({
        layers: state.layers.map((l) =>
          l.id === id ? { ...l, visible: !l.visible } : l
        ),
      })),

      toggleLayerLock: (id) => set((state) => ({
        layers: state.layers.map((l) =>
          l.id === id ? { ...l, locked: !l.locked } : l
        ),
      })),

      // History Actions
      saveToHistory: (action) => set((state) => {
        const snapshot = createHistorySnapshot(state);
        const entry = createHistoryEntry(action, snapshot);
        const newHistory = state.history.slice(0, state.historyIndex + 1);
        newHistory.push(entry);
        if (newHistory.length > 50) {
          newHistory.shift();
        }
        const nextHistoryIndex = newHistory.length - 1;
        return {
          history: newHistory,
          historyIndex: nextHistoryIndex,
          canUndo: nextHistoryIndex > 0,
          canRedo: nextHistoryIndex < newHistory.length - 1,
        };
      }),

      undo: () => set((state) => {
        if (state.historyIndex <= 0) return state;
        const prevEntry = state.history[state.historyIndex - 1];
        if (!prevEntry) return state;
        const nextHistoryIndex = state.historyIndex - 1;
        return {
          detectedElements: prevEntry.snapshot.detectedElements,
          dimensions: prevEntry.snapshot.dimensions,
          annotations: prevEntry.snapshot.annotations,
          sketches: prevEntry.snapshot.sketches,
          symbols: prevEntry.snapshot.symbols,
          walls: prevEntry.snapshot.walls ?? [],
          rooms: prevEntry.snapshot.rooms ?? [],
          sectionLines: prevEntry.snapshot.sectionLines ?? [],
          elevationViews: prevEntry.snapshot.elevationViews ?? [],
          activeElevationViewId: prevEntry.snapshot.activeElevationViewId ?? null,
          historyIndex: nextHistoryIndex,
          canUndo: nextHistoryIndex > 0,
          canRedo: nextHistoryIndex < state.history.length - 1,
        };
      }),

      redo: () => set((state) => {
        if (state.historyIndex >= state.history.length - 1) return state;
        const nextEntry = state.history[state.historyIndex + 1];
        if (!nextEntry) return state;
        const nextHistoryIndex = state.historyIndex + 1;
        return {
          detectedElements: nextEntry.snapshot.detectedElements,
          dimensions: nextEntry.snapshot.dimensions,
          annotations: nextEntry.snapshot.annotations,
          sketches: nextEntry.snapshot.sketches,
          symbols: nextEntry.snapshot.symbols,
          walls: nextEntry.snapshot.walls ?? [],
          rooms: nextEntry.snapshot.rooms ?? [],
          sectionLines: nextEntry.snapshot.sectionLines ?? [],
          elevationViews: nextEntry.snapshot.elevationViews ?? [],
          activeElevationViewId: nextEntry.snapshot.activeElevationViewId ?? null,
          historyIndex: nextHistoryIndex,
          canUndo: nextHistoryIndex > 0,
          canRedo: nextHistoryIndex < state.history.length - 1,
        };
      }),

      clearHistory: () => set((state) => ({
        history: [createHistoryEntry('Baseline', createHistorySnapshot(state))],
        historyIndex: 0,
        canUndo: false,
        canRedo: false,
      })),

      // Export/Import Actions
      exportToJSON: () => {
        const {
          importedDrawing,
          dimensions,
          annotations,
          sketches,
          symbols,
          guides,
          walls,
          rooms,
          sectionLines,
          elevationViews,
          activeElevationViewId,
          elevationSettings,
          wallSettings,
          dimensionSettings,
          hvacDesignConditions,
          materialLibrary,
        } = get();

        const attributeEnvelope = createAttributeEnvelope(walls, rooms);
        return JSON.stringify({
          version: '1.0',
          attributeSchemaVersion: 1,
          dimensions,
          annotations,
          sketches,
          guides,
          symbols,
          walls,
          rooms,
          sectionLines,
          elevationViews,
          activeElevationViewId,
          elevationSettings,
          wallSettings,
          dimensionSettings,
          hvacDesignConditions,
          materialLibrary,
          attributeEnvelope,
          scale: importedDrawing?.scale || 100,
          exportedAt: new Date().toISOString(),
        }, null, 2);
      },

      importFromJSON: (json) => {
        try {
          const data = JSON.parse(json);
          const rawWalls = Array.isArray(data.walls) ? data.walls : [];
          const importedWalls: Wall[] = rawWalls.map((rawWall: Partial<Wall>) => {
            const baseWall: Wall = {
              id: rawWall.id ?? generateId(),
              startPoint: rawWall.startPoint ?? { x: 0, y: 0 },
              endPoint: rawWall.endPoint ?? { x: 0, y: 0 },
              thickness: clampThickness(rawWall.thickness ?? 150),
              material: rawWall.material ?? 'partition',
              layer: rawWall.layer ?? 'partition',
              interiorLine: rawWall.interiorLine ?? { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
              exteriorLine: rawWall.exteriorLine ?? { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
              startBevel: normalizeBevelControl(rawWall.startBevel),
              endBevel: normalizeBevelControl(rawWall.endBevel),
              connectedWalls: Array.isArray(rawWall.connectedWalls) ? rawWall.connectedWalls : [],
              openings: Array.isArray(rawWall.openings) ? rawWall.openings : [],
              properties3D: rawWall.properties3D ?? { ...DEFAULT_WALL_3D },
            };
            const rebuilt = rebuildWallGeometry(baseWall);
            return bindWallAttributes(rebuilt, rawWall.properties3D ?? undefined);
          });

          const rawRooms = Array.isArray(data.rooms) ? data.rooms : [];
          const importedRooms: Room[] = rawRooms.map((rawRoom: Partial<Room>) => {
            const fallbackVertices = Array.isArray(rawRoom.vertices) ? rawRoom.vertices : [];
            const fallbackArea = typeof rawRoom.area === 'number' ? rawRoom.area : polygonArea(fallbackVertices);
            const baseRoom: Room = {
              id: rawRoom.id ?? generateId(),
              name: rawRoom.name ?? 'Room',
              roomType: rawRoom.roomType ?? inferRoomType(fallbackArea / 1_000_000),
              vertices: fallbackVertices,
              wallIds: Array.isArray(rawRoom.wallIds) ? rawRoom.wallIds : [],
              area: fallbackArea,
              perimeter: typeof rawRoom.perimeter === 'number' ? rawRoom.perimeter : polygonPerimeter(fallbackVertices),
              centroid: rawRoom.centroid ?? polygonCentroid(fallbackVertices),
              finishes: rawRoom.finishes ?? '',
              notes: rawRoom.notes ?? '',
              fillColor: rawRoom.fillColor ?? roomTypeFillColor(rawRoom.roomType ?? inferRoomType(fallbackArea / 1_000_000)),
              showLabel: rawRoom.showLabel ?? true,
              adjacentRoomIds: Array.isArray(rawRoom.adjacentRoomIds) ? rawRoom.adjacentRoomIds : [],
              hasWindows: rawRoom.hasWindows ?? false,
              validationWarnings: Array.isArray(rawRoom.validationWarnings) ? rawRoom.validationWarnings : [],
              isExterior: rawRoom.isExterior ?? false,
              properties3D: rawRoom.properties3D ?? { ...DEFAULT_ROOM_3D },
            };
            return bindRoomAttributes(baseRoom, rawRoom.properties3D ?? undefined);
          });

          const rawSectionLines = Array.isArray(data.sectionLines) ? data.sectionLines : [];
          const importedSectionLines: SectionLine[] = rawSectionLines.map(
            (rawLine: Partial<SectionLine>, index: number) => {
              const fallbackLabel = sectionLabelForIndex(rawLine.kind ?? 'section', index + 1);
              return {
                id: rawLine.id ?? generateId(),
                label: rawLine.label ?? fallbackLabel,
                name: rawLine.name ?? rawLine.label ?? fallbackLabel,
                kind: rawLine.kind === 'elevation' ? 'elevation' : 'section',
                startPoint: rawLine.startPoint ?? { x: 0, y: 0 },
                endPoint: rawLine.endPoint ?? { x: 0, y: 0 },
                direction: rawLine.direction === -1 ? -1 : 1,
                color: rawLine.color ?? DEFAULT_SECTION_LINE_COLOR,
                depthMm: Math.max(100, rawLine.depthMm ?? DEFAULT_SECTION_LINE_DEPTH_MM),
                locked: rawLine.locked ?? false,
                showReferenceIndicators: rawLine.showReferenceIndicators ?? true,
              };
            }
          );

          const attributeHydration = deserializeAttributeEnvelope(
            data.attributeEnvelope,
            importedWalls,
            importedRooms
          );

          const nextWallSettings = {
            ...DEFAULT_WALL_SETTINGS,
            ...(typeof data.wallSettings === 'object' && data.wallSettings ? data.wallSettings : {}),
          } as WallSettings;
          nextWallSettings.defaultThickness = clampThickness(nextWallSettings.defaultThickness);
          nextWallSettings.defaultHeight = clampHeight(nextWallSettings.defaultHeight);
          nextWallSettings.defaultLayerCount = Math.max(1, Math.round(nextWallSettings.defaultLayerCount));
          nextWallSettings.gridSize = Math.max(1, nextWallSettings.gridSize);

          const nextMaterialLibrary = Array.isArray(data.materialLibrary) && data.materialLibrary.length > 0
            ? data.materialLibrary
            : [...DEFAULT_ARCHITECTURAL_MATERIALS];

          const nextDimensionSettings = {
            ...DEFAULT_DIMENSION_SETTINGS,
            ...(typeof data.dimensionSettings === 'object' && data.dimensionSettings ? data.dimensionSettings : {}),
          } as DimensionSettings;
          nextDimensionSettings.precision = nextDimensionSettings.precision === 0 || nextDimensionSettings.precision === 1 || nextDimensionSettings.precision === 2
            ? nextDimensionSettings.precision
            : DEFAULT_DIMENSION_SETTINGS.precision;
          nextDimensionSettings.defaultOffset = Math.max(20, nextDimensionSettings.defaultOffset);
          nextDimensionSettings.extensionGap = Math.max(0, nextDimensionSettings.extensionGap);
          nextDimensionSettings.extensionBeyond = Math.max(0, nextDimensionSettings.extensionBeyond);

          const nextHvacDesignConditions = {
            ...DEFAULT_HVAC_DESIGN_CONDITIONS,
            ...(typeof data.hvacDesignConditions === 'object' && data.hvacDesignConditions ? data.hvacDesignConditions : {}),
          } as HvacDesignConditions;
          nextHvacDesignConditions.peakCoolingHour = clampValue(nextHvacDesignConditions.peakCoolingHour, 0, 23);
          nextHvacDesignConditions.internalGainDiversityFactor = clampValue(nextHvacDesignConditions.internalGainDiversityFactor, 0, 1);
          nextHvacDesignConditions.defaultWindowShgc = clampValue(nextHvacDesignConditions.defaultWindowShgc, 0, 1);
          nextHvacDesignConditions.seasonalVariation = {
            summerAdjustment: Number.isFinite(nextHvacDesignConditions.seasonalVariation?.summerAdjustment)
              ? nextHvacDesignConditions.seasonalVariation.summerAdjustment
              : DEFAULT_HVAC_DESIGN_CONDITIONS.seasonalVariation.summerAdjustment,
            winterAdjustment: Number.isFinite(nextHvacDesignConditions.seasonalVariation?.winterAdjustment)
              ? nextHvacDesignConditions.seasonalVariation.winterAdjustment
              : DEFAULT_HVAC_DESIGN_CONDITIONS.seasonalVariation.winterAdjustment,
          };

          const nextElevationSettings = {
            ...DEFAULT_ELEVATION_SETTINGS,
            ...(typeof data.elevationSettings === 'object' && data.elevationSettings ? data.elevationSettings : {}),
          } as ElevationSettings;
          nextElevationSettings.defaultGridIncrementMm = Math.max(100, nextElevationSettings.defaultGridIncrementMm);
          nextElevationSettings.defaultScale = Math.max(1, nextElevationSettings.defaultScale);
          nextElevationSettings.sunAngleDeg = clampValue(nextElevationSettings.sunAngleDeg, 0, 360);

          const importedElevationViews = Array.isArray(data.elevationViews)
            ? data.elevationViews as ElevationView[]
            : [];
          const importedActiveElevationViewId =
            typeof data.activeElevationViewId === 'string'
              ? data.activeElevationViewId
              : null;

          set({
            dimensions: Array.isArray(data.dimensions)
              ? data.dimensions.map((dimension: Omit<Dimension2D, 'id'> & { id: string }) => ({
                ...normalizeDimensionPayload(dimension, nextDimensionSettings),
                id: dimension.id ?? generateId(),
              }))
              : [],
            dimensionSettings: nextDimensionSettings,
            annotations: data.annotations || [],
            sketches: data.sketches || [],
            guides: data.guides || [],
            symbols: data.symbols || [],
            walls: attributeHydration.walls,
            rooms: attributeHydration.rooms,
            sectionLines: importedSectionLines,
            elevationViews: importedElevationViews,
            activeElevationViewId: importedActiveElevationViewId,
            elevationSettings: nextElevationSettings,
            sectionLineDrawingState: { ...DEFAULT_SECTION_LINE_DRAWING_STATE },
            wallSettings: nextWallSettings,
            hvacDesignConditions: nextHvacDesignConditions,
            materialLibrary: nextMaterialLibrary,
          });
          lastRoomTopologyHash = '';
          get().detectRooms();
          get().regenerateElevations();
          importedSectionLines.forEach((line) => {
            get().generateElevationForSection(line.id);
          });
          if (
            importedActiveElevationViewId &&
            get().elevationViews.some((view) => view.id === importedActiveElevationViewId)
          ) {
            get().setActiveElevationView(importedActiveElevationViewId);
          }
          if (attributeHydration.warnings.length > 0) {
            console.warn('Attribute hydration warnings', attributeHydration.warnings);
          }
          get().setProcessingStatus('Imported drawing JSON.', false);
        } catch (error) {
          console.error('Failed to import JSON:', error);
          get().setProcessingStatus('Failed to import drawing JSON.', false);
        }
      },

      // Spline Actions
      setSplineSettings: (settings) => set((state) => ({
        splineSettings: { ...state.splineSettings, ...settings },
      })),

      setSplineEditMode: (mode) => set({ splineEditMode: mode }),

      setEditingSpline: (id) => set({ editingSplineId: id }),

      addSplineControlPoint: (sketchId, point, index) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            const newPoints = [...s.points];
            if (index !== undefined && index >= 0 && index <= newPoints.length) {
              newPoints.splice(index, 0, point);
            } else {
              newPoints.push(point);
            }
            return { ...s, points: newPoints };
          }),
        }));
        get().saveToHistory('Add spline point');
      },

      updateSplineControlPoint: (sketchId, pointIndex, position) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            const newPoints = [...s.points];
            if (pointIndex >= 0 && pointIndex < newPoints.length) {
              newPoints[pointIndex] = position;
            }
            return { ...s, points: newPoints };
          }),
        }));
        get().saveToHistory('Move spline point');
      },

      removeSplineControlPoint: (sketchId, pointIndex) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            if (s.points.length <= 2) return s;
            const newPoints = s.points.filter((_, i) => i !== pointIndex);
            return { ...s, points: newPoints };
          }),
        }));
        get().saveToHistory('Remove spline point');
      },

      toggleSplineClosed: (sketchId) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            const currentSettings = s.splineSettings || DEFAULT_SPLINE_SETTINGS;
            return {
              ...s,
              closed: !currentSettings.closed,
              splineSettings: { ...currentSettings, closed: !currentSettings.closed },
            };
          }),
        }));
        get().saveToHistory('Toggle spline closed');
      },

      convertSplineMethod: (sketchId, method) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            const currentSettings = s.splineSettings || DEFAULT_SPLINE_SETTINGS;
            return {
              ...s,
              splineSettings: { ...currentSettings, method },
            };
          }),
        }));
        get().saveToHistory('Change spline method');
      },
    }),
    { name: 'smart-drawing-store' }
  )
);

// Alias for backwards compatibility
export const useSmartDrawingStore = useDrawingStore;
export type SmartDrawingState = DrawingState;

export default useDrawingStore;
export {
  useRoomStore,
  getRoomWallIds,
  getRoomHoles,
  getArchivedRoom,
  type RoomStore,
} from './roomStore';
