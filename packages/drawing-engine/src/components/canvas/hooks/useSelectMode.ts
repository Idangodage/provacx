/**
 * useSelectMode Hook
 *
 * Professional wall editing interactions in select mode:
 * - thickness handles (interior/exterior)
 * - center handle move
 * - endpoint editing with snapping
 * - multi-wall selection helpers
 */

import * as fabric from 'fabric';
import type { Canvas as FabricCanvas, Object as FabricObject } from 'fabric';
import { useRef, useCallback, useEffect } from 'react';
import type { MutableRefObject } from 'react';

import { WallRotationOperation } from '../../../operations';
import type { Point2D, Room, Wall, WallSettings } from '../../../types';
import {
  MAX_WALL_THICKNESS,
  MIN_WALL_LENGTH,
  MIN_WALL_THICKNESS,
} from '../../../types/wall';
import { SnapManager } from '../../../utils/SnapManager';
import { GeometryEngine } from '../../../utils/geometry-engine';
import {
  clampBevelOffset,
  countWallsTouchingEndpoint,
  computeCornerBevelDotsForEndpoint,
  computeDeadEndBevelDotsForEndpoint,
  projectPointToLine,
  type CornerBevelKind,
  type CornerEnd,
} from '../../../utils/wallBevel';
import { MM_TO_PX } from '../scale';
import { computeWallPolygon } from '../wall/WallGeometry';
import { snapToGrid } from '../wall/WallSnapping';

const THICKNESS_PRESETS_MM = [100, 150, 200, 250];
const THICKNESS_SNAP_TOLERANCE_MM = 12;
const PERPENDICULAR_SNAP_TOLERANCE_DEG = 12;
const ENDPOINT_BOND_TOLERANCE_MM = 2;
const SEGMENT_BOND_TOLERANCE_MM = 2;
const SEGMENT_ENDPOINT_T_THRESHOLD = 0.02;

type WallControlType =
  | 'wall-center-handle'
  | 'wall-endpoint-start'
  | 'wall-endpoint-end'
  | 'wall-bevel-outer-start'
  | 'wall-bevel-outer-end'
  | 'wall-bevel-inner-start'
  | 'wall-bevel-inner-end'
  | 'wall-thickness-interior'
  | 'wall-thickness-exterior'
  | 'wall-rotation-handle'
  | 'room-center-handle'
  | 'room-corner-handle'
  | 'room-scale-handle';

interface WallUpdateOptions {
  skipHistory?: boolean;
  source?: 'ui' | 'drag';
  skipRoomDetection?: boolean;
}

interface RoomMoveOptions {
  skipHistory?: boolean;
}

export interface UseSelectModeOptions {
  fabricRef: React.RefObject<FabricCanvas | null>;
  walls: Wall[];
  rooms: Room[];
  selectedIds: string[];
  wallSettings: WallSettings;
  zoom: number;
  setSelectedIds: (ids: string[]) => void;
  setHoveredElement: (id: string | null) => void;
  updateWall: (id: string, updates: Partial<Wall>, options?: WallUpdateOptions) => void;
  updateWallBevel: (
    wallId: string,
    end: CornerEnd,
    bevel: Partial<{ outerOffset: number; innerOffset: number }>,
    options?: WallUpdateOptions
  ) => void;
  resetWallBevel: (wallId: string, end: CornerEnd) => void;
  getCornerBevelDots: (cornerPoint: Point2D) => {
    outerDotPosition: Point2D;
    innerDotPosition: Point2D;
    outerOffset: number;
    innerOffset: number;
  } | null;
  moveRoom: (id: string, delta: Point2D, options?: RoomMoveOptions) => void;
  connectWalls: (wallId: string, otherWallId: string) => void;
  detectRooms: (options?: { debounce?: boolean }) => void;
  saveToHistory: (action: string) => void;
  setProcessingStatus: (status: string, isProcessing: boolean) => void;
  originOffset: { x: number; y: number };
}

interface TargetMeta {
  name?: string;
  id?: string;
  wallId?: string;
  roomId?: string;
  controlType?: WallControlType;
  cornerIndex?: number;
  scaleDirection?: 'NW' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W';
  isWallControl?: boolean;
  isRoomControl?: boolean;
}

interface ConnectedEndpointRef {
  wallId: string;
  endpoint: 'start' | 'end';
}

interface SegmentConstraintRef {
  wallId: string;
  startPoint: Point2D;
  endPoint: Point2D;
}

interface MoveEndpointConstraint {
  wallId: string;
  endpoint: 'start' | 'end';
  connectedEndpoints: ConnectedEndpointRef[];
  segmentConstraints: SegmentConstraintRef[];
}

interface IdleDragState {
  mode: 'idle';
}

interface ThicknessDragState {
  mode: 'thickness';
  wallId: string;
  side: 'interior' | 'exterior';
  startPointer: Point2D;
  baselineWall: Wall;
  normal: Point2D;
}

interface MoveDragState {
  mode: 'move';
  wallIds: string[];
  anchorWallId: string;
  startPointer: Point2D;
  baselineWalls: Map<string, Wall>;
  constrainedNormal: Point2D | null;
  endpointConstraints: MoveEndpointConstraint[];
}

interface EndpointDragState {
  mode: 'endpoint';
  wallId: string;
  endpoint: 'start' | 'end';
  startPointer: Point2D;
  baselineWall: Wall;
  fixedPoint: Point2D;
  connectedEndpoints: ConnectedEndpointRef[];
  segmentConstraints: SegmentConstraintRef[];
}

interface RoomMoveDragState {
  mode: 'room-move';
  roomId: string;
  startPointer: Point2D;
  lastAppliedDelta: Point2D;
  ghostWalls: Wall[];
}

interface RoomCornerDragState {
  mode: 'room-corner';
  roomId: string;
  cornerIndex: number;
  startPointer: Point2D;
  baselineRoom: Room;
  baselineWalls: Map<string, Wall>;
}

interface RoomScaleDragState {
  mode: 'room-scale';
  roomId: string;
  direction: 'NW' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W';
  startPointer: Point2D;
  baselineRoom: Room;
  baselineWalls: Map<string, Wall>;
}

interface RotateDragState {
  mode: 'rotate';
  wallId: string;
  baselineWall: Wall;
  connectedEndpoints: ConnectedEndpointRef[];
  operation: WallRotationOperation;
}

interface BevelDragState {
  mode: 'bevel';
  wallId: string;
  endpoint: CornerEnd;
  kind: CornerBevelKind;
  cornerPoint: Point2D;
  origin: Point2D;
  direction: Point2D;
  maxOffset: number;
  otherWallId: string;
  otherEndpoint: CornerEnd;
}

type DragState =
  | IdleDragState
  | ThicknessDragState
  | MoveDragState
  | EndpointDragState
  | RoomMoveDragState
  | RoomCornerDragState
  | RoomScaleDragState
  | RotateDragState
  | BevelDragState;

interface DragApplyResult {
  label: string;
  point: Point2D;
  snapPoint?: Point2D;
}

interface EndpointSnapMemory {
  mode: 'endpoint';
  wallId: string;
  point: Point2D;
  snappedWallId?: string;
  visual?: {
    color: string;
    indicator: 'circle' | 'square' | 'triangle' | 'cross';
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function subtract(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scale(v: Point2D, factor: number): Point2D {
  return { x: v.x * factor, y: v.y * factor };
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

function magnitude(v: Point2D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function normalize(v: Point2D): Point2D {
  const len = magnitude(v) || 1;
  return { x: v.x / len, y: v.y / len };
}

function pointCacheKey(point?: Point2D): string {
  if (!point) return '';
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function wallLength(wall: Pick<Wall, 'startPoint' | 'endPoint'>): number {
  return magnitude(subtract(wall.endPoint, wall.startPoint));
}

function wallDirection(wall: Pick<Wall, 'startPoint' | 'endPoint'>): Point2D {
  return normalize(subtract(wall.endPoint, wall.startPoint));
}

function wallNormal(wall: Pick<Wall, 'startPoint' | 'endPoint'>): Point2D {
  const direction = wallDirection(wall);
  return { x: -direction.y, y: direction.x };
}

function wallAngleDegrees(wall: Pick<Wall, 'startPoint' | 'endPoint'>): number {
  const angle =
    (Math.atan2(wall.endPoint.y - wall.startPoint.y, wall.endPoint.x - wall.startPoint.x) *
      180) /
    Math.PI;
  return (angle + 360) % 360;
}

function snapThickness(thicknessMm: number): number {
  for (const preset of THICKNESS_PRESETS_MM) {
    if (Math.abs(thicknessMm - preset) <= THICKNESS_SNAP_TOLERANCE_MM) {
      return preset;
    }
  }
  return thicknessMm;
}

function projectPointToSegment(
  point: Point2D,
  start: Point2D,
  end: Point2D
): { point: Point2D; distance: number; t: number } {
  const segment = subtract(end, start);
  const lengthSq = dot(segment, segment);
  if (lengthSq < 0.000001) {
    return {
      point: { ...start },
      distance: magnitude(subtract(point, start)),
      t: 0,
    };
  }

  const t = clamp(dot(subtract(point, start), segment) / lengthSq, 0, 1);
  const projected = add(start, scale(segment, t));
  return {
    point: projected,
    distance: magnitude(subtract(point, projected)),
    t,
  };
}

function distancePointToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  return projectPointToSegment(point, start, end).distance;
}

function segmentDistance(aStart: Point2D, aEnd: Point2D, bStart: Point2D, bEnd: Point2D): number {
  return Math.min(
    distancePointToSegment(aStart, bStart, bEnd),
    distancePointToSegment(aEnd, bStart, bEnd),
    distancePointToSegment(bStart, aStart, aEnd),
    distancePointToSegment(bEnd, aStart, aEnd)
  );
}

function projectionOverlap(
  aStart: Point2D,
  aEnd: Point2D,
  bStart: Point2D,
  bEnd: Point2D,
  axis: Point2D
): number {
  const a0 = dot(aStart, axis);
  const a1 = dot(aEnd, axis);
  const b0 = dot(bStart, axis);
  const b1 = dot(bEnd, axis);
  const minA = Math.min(a0, a1);
  const maxA = Math.max(a0, a1);
  const minB = Math.min(b0, b1);
  const maxB = Math.max(b0, b1);
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function isParallel(a: Pick<Wall, 'startPoint' | 'endPoint'>, b: Pick<Wall, 'startPoint' | 'endPoint'>): boolean {
  const da = wallDirection(a);
  const db = wallDirection(b);
  return Math.abs(dot(da, db)) >= 0.985;
}

function wallsLikelyOverlapping(a: Wall, b: Wall): boolean {
  if (!isParallel(a, b)) return false;

  const axis = wallDirection(a);
  const overlapLength = projectionOverlap(a.startPoint, a.endPoint, b.startPoint, b.endPoint, axis);
  if (overlapLength < 100) return false;

  const centerlineDistance = segmentDistance(a.startPoint, a.endPoint, b.startPoint, b.endPoint);
  const maxAllowed = (a.thickness + b.thickness) / 2 - 1;
  return centerlineDistance < maxAllowed;
}

function toCanvasPoint(point: Point2D): Point2D {
  return {
    x: point.x * MM_TO_PX,
    y: point.y * MM_TO_PX,
  };
}

function pointsNear(a: Point2D, b: Point2D, tolerance = ENDPOINT_BOND_TOLERANCE_MM): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function perpendicularDirection(reference: Wall, atPoint: Point2D): Point2D | null {
  if (!pointsNear(reference.startPoint, atPoint) && !pointsNear(reference.endPoint, atPoint)) {
    return null;
  }
  const dir = pointsNear(reference.startPoint, atPoint)
    ? normalize(subtract(reference.endPoint, reference.startPoint))
    : normalize(subtract(reference.startPoint, reference.endPoint));
  return normalize({ x: -dir.y, y: dir.x });
}

function parseBevelControl(
  controlType?: WallControlType
): { endpoint: CornerEnd; kind: CornerBevelKind } | null {
  switch (controlType) {
    case 'wall-bevel-outer-start':
      return { endpoint: 'start', kind: 'outer' };
    case 'wall-bevel-inner-start':
      return { endpoint: 'start', kind: 'inner' };
    case 'wall-bevel-outer-end':
      return { endpoint: 'end', kind: 'outer' };
    case 'wall-bevel-inner-end':
      return { endpoint: 'end', kind: 'inner' };
    default:
      return null;
  }
}

function roomBounds(vertices: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function validateRoomVertices(vertices: Point2D[]): { valid: boolean; reason?: string } {
  if (vertices.length < 3) {
    return { valid: false, reason: 'Room requires at least 3 corners.' };
  }
  if (GeometryEngine.polygonSelfIntersects(vertices)) {
    return { valid: false, reason: 'Room shape cannot self-intersect.' };
  }
  const areaM2 = GeometryEngine.calculateRoomAreaM2({ vertices });
  if (areaM2 < 2) {
    return { valid: false, reason: 'Room area must be at least 2m².' };
  }
  for (let i = 0; i < vertices.length; i += 1) {
    const next = vertices[(i + 1) % vertices.length];
    if (GeometryEngine.distance(vertices[i], next) < MIN_WALL_LENGTH) {
      return { valid: false, reason: `Each wall segment must be at least ${MIN_WALL_LENGTH}mm.` };
    }
  }
  return { valid: true };
}

function oppositeScaleAnchor(
  direction: 'NW' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W',
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
): Point2D {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  switch (direction) {
    case 'NW':
      return { x: bounds.maxX, y: bounds.maxY };
    case 'N':
      return { x: centerX, y: bounds.maxY };
    case 'NE':
      return { x: bounds.minX, y: bounds.maxY };
    case 'E':
      return { x: bounds.minX, y: centerY };
    case 'SE':
      return { x: bounds.minX, y: bounds.minY };
    case 'S':
      return { x: centerX, y: bounds.minY };
    case 'SW':
      return { x: bounds.maxX, y: bounds.minY };
    case 'W':
    default:
      return { x: bounds.maxX, y: centerY };
  }
}

export function useSelectMode({
  fabricRef,
  walls,
  rooms,
  selectedIds,
  wallSettings,
  zoom,
  setSelectedIds,
  setHoveredElement,
  updateWall,
  updateWallBevel,
  resetWallBevel,
  getCornerBevelDots,
  moveRoom,
  connectWalls,
  detectRooms,
  saveToHistory,
  setProcessingStatus,
}: UseSelectModeOptions) {
  const isWallHandleDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState>({ mode: 'idle' });
  const pendingPointRef = useRef<Point2D | null>(null);
  const frameRef = useRef<number | null>(null);
  const dimensionLabelRef = useRef<fabric.Text | null>(null);
  const ghostObjectsRef = useRef<fabric.FabricObject[]>([]);
  const snapObjectsRef = useRef<fabric.FabricObject[]>([]);
  const lastAppliedStatusRef = useRef<string>('');
  const snapManagerRef = useRef(new SnapManager());
  const smoothedPointerRef = useRef<Point2D | null>(null);
  const endpointSnapMemoryRef = useRef<EndpointSnapMemory | null>(null);
  const wallUpdateCacheRef = useRef<Map<string, string>>(new Map());
  const wallBevelUpdateCacheRef = useRef<Map<string, string>>(new Map());
  const connectedPairCacheRef = useRef<Set<string>>(new Set());
  const modifierKeysRef = useRef({ shift: false, ctrl: false, alt: false });

  const optionsRef = useRef({
    walls,
    rooms,
    selectedIds,
    wallSettings,
    zoom,
    setSelectedIds,
    setHoveredElement,
    updateWall,
    updateWallBevel,
    resetWallBevel,
    getCornerBevelDots,
    moveRoom,
    connectWalls,
    detectRooms,
    saveToHistory,
    setProcessingStatus,
  });

  useEffect(() => {
    optionsRef.current = {
      walls,
      rooms,
      selectedIds,
      wallSettings,
      zoom,
      setSelectedIds,
      setHoveredElement,
      updateWall,
      updateWallBevel,
      resetWallBevel,
      getCornerBevelDots,
      moveRoom,
      connectWalls,
      detectRooms,
      saveToHistory,
      setProcessingStatus,
    };
  }, [
    walls,
    rooms,
    selectedIds,
    wallSettings,
    zoom,
    setSelectedIds,
    setHoveredElement,
    updateWall,
    updateWallBevel,
    resetWallBevel,
    getCornerBevelDots,
    moveRoom,
    connectWalls,
    detectRooms,
    saveToHistory,
    setProcessingStatus,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      modifierKeysRef.current = {
        shift: event.shiftKey,
        ctrl: event.ctrlKey || event.metaKey,
        alt: event.altKey,
      };
    };
    const onKeyUp = (event: KeyboardEvent) => {
      modifierKeysRef.current = {
        shift: event.shiftKey,
        ctrl: event.ctrlKey || event.metaKey,
        alt: event.altKey,
      };
    };
    const onBlur = () => {
      modifierKeysRef.current = { shift: false, ctrl: false, alt: false };
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const clearOverlayObjects = useCallback((objectsRef: MutableRefObject<fabric.FabricObject[]>) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    objectsRef.current.forEach((obj) => canvas.remove(obj));
    objectsRef.current = [];
  }, [fabricRef]);

  const clearDimensionLabel = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (dimensionLabelRef.current) {
      canvas.remove(dimensionLabelRef.current);
      dimensionLabelRef.current = null;
    }
  }, [fabricRef]);

  const setDimensionLabel = useCallback((text: string, point: Point2D) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const canvasPoint = toCanvasPoint(point);
    if (!dimensionLabelRef.current) {
      dimensionLabelRef.current = new fabric.Text(text, {
        left: canvasPoint.x + 12,
        top: canvasPoint.y - 18,
        fontSize: 12,
        fill: '#1D4ED8',
        fontFamily: 'Arial',
        selectable: false,
        evented: false,
      });
      canvas.add(dimensionLabelRef.current);
    } else {
      dimensionLabelRef.current.set({
        text,
        left: canvasPoint.x + 12,
        top: canvasPoint.y - 18,
      });
    }
    canvas.requestRenderAll();
  }, [fabricRef]);

  const showGhostWalls = useCallback((ghostWalls: Wall[]) => {
    clearOverlayObjects(ghostObjectsRef);
    const canvas = fabricRef.current;
    if (!canvas) return;

    const overlays: fabric.FabricObject[] = [];
    for (const wall of ghostWalls) {
      const polygon = computeWallPolygon(wall).map((point) => toCanvasPoint(point));
      const ghost = new fabric.Polygon(polygon, {
        fill: 'rgba(148,163,184,0.08)',
        stroke: '#64748B',
        strokeDashArray: [6, 4],
        strokeWidth: 1.5,
        selectable: false,
        evented: false,
      });
      overlays.push(ghost);
      canvas.add(ghost);
    }
    ghostObjectsRef.current = overlays;
    canvas.requestRenderAll();
  }, [clearOverlayObjects, fabricRef]);

  const clearGhostWalls = useCallback(() => {
    clearOverlayObjects(ghostObjectsRef);
    fabricRef.current?.requestRenderAll();
  }, [clearOverlayObjects, fabricRef]);

  const showSnapIndicator = useCallback((
    point?: Point2D,
    line?: { start: Point2D; end: Point2D },
    visual?: { color?: string; indicator?: 'circle' | 'square' | 'triangle' | 'cross' }
  ) => {
    clearOverlayObjects(snapObjectsRef);
    const canvas = fabricRef.current;
    if (!canvas) return;

    const overlays: fabric.FabricObject[] = [];
    const color = visual?.color ?? '#10B981';

    if (line) {
      const start = toCanvasPoint(line.start);
      const end = toCanvasPoint(line.end);
      const indicatorLine = new fabric.Line(
        [start.x, start.y, end.x, end.y],
        {
          stroke: color,
          strokeWidth: 1.2,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        }
      );
      overlays.push(indicatorLine);
      canvas.add(indicatorLine);
    }

    if (point) {
      const canvasPoint = toCanvasPoint(point);
      if (visual?.indicator === 'square') {
        const marker = new fabric.Rect({
          left: canvasPoint.x,
          top: canvasPoint.y,
          width: 10,
          height: 10,
          fill: color,
          stroke: '#FFFFFF',
          strokeWidth: 1.5,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        overlays.push(marker);
        canvas.add(marker);
      } else if (visual?.indicator === 'triangle') {
        const marker = new fabric.Triangle({
          left: canvasPoint.x,
          top: canvasPoint.y,
          width: 10,
          height: 10,
          fill: color,
          stroke: '#FFFFFF',
          strokeWidth: 1.5,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        overlays.push(marker);
        canvas.add(marker);
      } else if (visual?.indicator === 'cross') {
        const h = new fabric.Line(
          [canvasPoint.x - 6, canvasPoint.y, canvasPoint.x + 6, canvasPoint.y],
          {
            stroke: color,
            strokeWidth: 1.5,
            selectable: false,
            evented: false,
          }
        );
        const v = new fabric.Line(
          [canvasPoint.x, canvasPoint.y - 6, canvasPoint.x, canvasPoint.y + 6],
          {
            stroke: color,
            strokeWidth: 1.5,
            selectable: false,
            evented: false,
          }
        );
        overlays.push(h, v);
        canvas.add(h, v);
      } else {
        const marker = new fabric.Circle({
          left: canvasPoint.x,
          top: canvasPoint.y,
          radius: 5,
          fill: color,
          stroke: '#FFFFFF',
          strokeWidth: 1.5,
          originX: 'center',
          originY: 'center',
          selectable: false,
          evented: false,
        });
        overlays.push(marker);
        canvas.add(marker);
      }
    }

    snapObjectsRef.current = overlays;
    canvas.requestRenderAll();
  }, [clearOverlayObjects, fabricRef]);

  const clearSnapIndicators = useCallback(() => {
    clearOverlayObjects(snapObjectsRef);
    fabricRef.current?.requestRenderAll();
  }, [clearOverlayObjects, fabricRef]);

  const clearEditVisuals = useCallback(() => {
    clearGhostWalls();
    clearSnapIndicators();
    clearDimensionLabel();
  }, [clearGhostWalls, clearSnapIndicators, clearDimensionLabel]);

  const getSnapReleaseDistanceMm = useCallback((): number => {
    const safeZoom = Math.max(optionsRef.current.zoom, 0.01);
    const snapDistancePx = Math.max(
      optionsRef.current.wallSettings.endpointSnapTolerance,
      optionsRef.current.wallSettings.midpointSnapTolerance
    );
    return Math.max(6, (snapDistancePx * 1.8) / (MM_TO_PX * safeZoom));
  }, []);

  const smoothDragPoint = useCallback((point: Point2D, mode: DragState['mode']): Point2D => {
    const previous = smoothedPointerRef.current;
    if (!previous) {
      smoothedPointerRef.current = { ...point };
      return point;
    }

    const alpha =
      mode === 'endpoint'
        ? 0.72
        : mode === 'bevel'
          ? 0.68
          : mode === 'move'
            ? 0.58
            : mode === 'thickness'
              ? 0.62
              : 0.66;
    const jumpDistance = magnitude(subtract(point, previous));
    if (jumpDistance > 180) {
      smoothedPointerRef.current = { ...point };
      return point;
    }

    const next = {
      x: previous.x + (point.x - previous.x) * alpha,
      y: previous.y + (point.y - previous.y) * alpha,
    };
    smoothedPointerRef.current = next;
    return next;
  }, []);

  const findWallById = useCallback((wallId: string): Wall | undefined => {
    return optionsRef.current.walls.find((wall) => wall.id === wallId);
  }, []);

  const findRoomById = useCallback((roomId: string): Room | undefined => {
    return optionsRef.current.rooms.find((room) => room.id === roomId);
  }, []);

  const buildEndpointConstraints = useCallback((
    wall: Wall,
    endpoint: 'start' | 'end',
    skipWallIds: Set<string>
  ): { connectedEndpoints: ConnectedEndpointRef[]; segmentConstraints: SegmentConstraintRef[] } => {
    const movingPoint = endpoint === 'start' ? wall.startPoint : wall.endPoint;
    const connectedEndpoints: ConnectedEndpointRef[] = [];
    const segmentConstraints: SegmentConstraintRef[] = [];
    const endpointSeen = new Set<string>();
    const segmentSeen = new Set<string>();
    const allWalls = optionsRef.current.walls;
    const safeZoom = Math.max(optionsRef.current.zoom, 0.01);
    const endpointTolerance = Math.max(
      ENDPOINT_BOND_TOLERANCE_MM,
      optionsRef.current.wallSettings.endpointSnapTolerance / (MM_TO_PX * safeZoom)
    );
    const segmentTolerance = Math.max(
      SEGMENT_BOND_TOLERANCE_MM,
      optionsRef.current.wallSettings.midpointSnapTolerance / (MM_TO_PX * safeZoom)
    );

    for (const connectedWall of allWalls) {
      if (connectedWall.id === wall.id || skipWallIds.has(connectedWall.id)) continue;

      if (pointsNear(connectedWall.startPoint, movingPoint, endpointTolerance)) {
        const key = `${connectedWall.id}:start`;
        if (!endpointSeen.has(key)) {
          endpointSeen.add(key);
          connectedEndpoints.push({ wallId: connectedWall.id, endpoint: 'start' });
        }
        continue;
      }

      if (pointsNear(connectedWall.endPoint, movingPoint, endpointTolerance)) {
        const key = `${connectedWall.id}:end`;
        if (!endpointSeen.has(key)) {
          endpointSeen.add(key);
          connectedEndpoints.push({ wallId: connectedWall.id, endpoint: 'end' });
        }
        continue;
      }

      const projection = projectPointToSegment(
        movingPoint,
        connectedWall.startPoint,
        connectedWall.endPoint
      );
      if (projection.distance <= segmentTolerance) {
        const segmentLength = Math.max(
          1,
          magnitude(subtract(connectedWall.endPoint, connectedWall.startPoint))
        );
        const endpointBand = Math.min(
          0.2,
          SEGMENT_ENDPOINT_T_THRESHOLD + endpointTolerance / segmentLength
        );
        const nearStart =
          projection.t <= endpointBand ||
          pointsNear(movingPoint, connectedWall.startPoint, endpointTolerance);
        const nearEnd =
          projection.t >= 1 - endpointBand ||
          pointsNear(movingPoint, connectedWall.endPoint, endpointTolerance);

        if (nearStart || nearEnd) {
          const endpointKey = `${connectedWall.id}:${nearStart ? 'start' : 'end'}`;
          if (!endpointSeen.has(endpointKey)) {
            endpointSeen.add(endpointKey);
            connectedEndpoints.push({
              wallId: connectedWall.id,
              endpoint: nearStart ? 'start' : 'end',
            });
          }
          continue;
        }

        const segmentKey = connectedWall.id;
        if (!segmentSeen.has(segmentKey)) {
          segmentSeen.add(segmentKey);
          segmentConstraints.push({
            wallId: connectedWall.id,
            startPoint: { ...connectedWall.startPoint },
            endPoint: { ...connectedWall.endPoint },
          });
        }
      }
    }

    return { connectedEndpoints, segmentConstraints };
  }, []);

  const getTargetMeta = useCallback((target: FabricObject | undefined | null): TargetMeta => {
    const typed = target as FabricObject & TargetMeta & { group?: TargetMeta };
    const group = typed?.group;

    const wallId =
      typed?.wallId ??
      group?.wallId ??
      (typed?.name?.startsWith('wall-') ? typed.id : undefined) ??
      (group?.name?.startsWith('wall-') ? group.id : undefined);
    const roomId =
      typed?.roomId ??
      group?.roomId ??
      (typed?.name?.startsWith('room-') ? typed.id : undefined) ??
      (group?.name?.startsWith('room-') ? group.id : undefined);

    const id = typed?.id ?? group?.id;
    const controlType = typed?.controlType ?? group?.controlType;
    const cornerIndex = typed?.cornerIndex ?? group?.cornerIndex;
    const scaleDirection = typed?.scaleDirection ?? group?.scaleDirection;
    const isWallControl = Boolean(typed?.isWallControl && controlType);
    const isRoomControl = Boolean(typed?.isRoomControl && controlType);

    return {
      name: typed?.name,
      id,
      wallId,
      roomId,
      controlType,
      cornerIndex,
      scaleDirection,
      isWallControl,
      isRoomControl,
    };
  }, []);

  const updateSelectionFromTargets = useCallback(
    (targets: Array<FabricObject | undefined | null>) => {
      const ids = Array.from(
        new Set(
          targets
            .map((target) => {
              const meta = getTargetMeta(target);
              return meta.wallId ?? meta.roomId ?? meta.id;
            })
            .filter((id): id is string => Boolean(id))
        )
      );
      optionsRef.current.setSelectedIds(ids);
    },
    [getTargetMeta]
  );

  const updateSelectionFromTarget = useCallback(
    (target: FabricObject | undefined | null) => {
      updateSelectionFromTargets([target]);
    },
    [updateSelectionFromTargets]
  );

  const setStatusFromWall = useCallback((wall: Wall) => {
    const status = `Wall length: ${Math.round(wallLength(wall))}mm, Thickness: ${Math.round(
      wall.thickness
    )}mm, Angle: ${wallAngleDegrees(wall).toFixed(1)}deg`;
    if (lastAppliedStatusRef.current !== status) {
      lastAppliedStatusRef.current = status;
      optionsRef.current.setProcessingStatus(status, false);
    }
  }, []);

  const setStatusFromRoom = useCallback((room: Room) => {
    const status = `Room: ${room.name}, Area: ${(room.area / 1_000_000).toFixed(1)}m², Perimeter: ${Math.round(room.perimeter)}mm`;
    if (lastAppliedStatusRef.current !== status) {
      lastAppliedStatusRef.current = status;
      optionsRef.current.setProcessingStatus(status, false);
    }
  }, []);

  const updateWallIfChanged = useCallback(
    (wallId: string, updates: Partial<Wall>, options?: WallUpdateOptions) => {
      const cacheKey = [
        `s:${pointCacheKey(updates.startPoint)}`,
        `e:${pointCacheKey(updates.endPoint)}`,
        `t:${updates.thickness !== undefined ? updates.thickness.toFixed(3) : ''}`,
      ].join('|');
      const cached = wallUpdateCacheRef.current.get(wallId);
      if (cached === cacheKey) {
        return;
      }

      const current = findWallById(wallId);
      if (!current) {
        const normalizedOptions =
          options?.source === 'drag' && options.skipRoomDetection === undefined
            ? { ...options, skipRoomDetection: true }
            : options;
        optionsRef.current.updateWall(wallId, updates, normalizedOptions);
        wallUpdateCacheRef.current.set(wallId, cacheKey);
        return;
      }

      const threshold = 0.08;
      const startChanged = updates.startPoint
        ? magnitude(subtract(updates.startPoint, current.startPoint)) > threshold
        : false;
      const endChanged = updates.endPoint
        ? magnitude(subtract(updates.endPoint, current.endPoint)) > threshold
        : false;
      const thicknessChanged =
        updates.thickness !== undefined
          ? Math.abs(updates.thickness - current.thickness) > threshold
          : false;

      if (!startChanged && !endChanged && !thicknessChanged) {
        wallUpdateCacheRef.current.set(wallId, cacheKey);
        return;
      }
      const normalizedOptions =
        options?.source === 'drag' && options.skipRoomDetection === undefined
          ? { ...options, skipRoomDetection: true }
          : options;
      optionsRef.current.updateWall(wallId, updates, normalizedOptions);
      wallUpdateCacheRef.current.set(wallId, cacheKey);
    },
    [findWallById]
  );

  const updateWallBevelIfChanged = useCallback(
    (
      wallId: string,
      end: CornerEnd,
      bevel: Partial<{ outerOffset: number; innerOffset: number }>,
      options?: WallUpdateOptions
    ) => {
      const cacheKey = [
        end,
        `o:${bevel.outerOffset !== undefined ? bevel.outerOffset.toFixed(3) : ''}`,
        `i:${bevel.innerOffset !== undefined ? bevel.innerOffset.toFixed(3) : ''}`,
      ].join('|');
      const bevelCacheKey = `${wallId}:${end}`;
      if (wallBevelUpdateCacheRef.current.get(bevelCacheKey) === cacheKey) {
        return;
      }

      const current = findWallById(wallId);
      if (!current) {
        const normalizedOptions =
          options?.source === 'drag' && options.skipRoomDetection === undefined
            ? { ...options, skipRoomDetection: true }
            : options;
        optionsRef.current.updateWallBevel(wallId, end, bevel, normalizedOptions);
        wallBevelUpdateCacheRef.current.set(bevelCacheKey, cacheKey);
        return;
      }
      const currentBevel = end === 'start' ? current.startBevel : current.endBevel;
      const outerChanged =
        bevel.outerOffset !== undefined
          ? Math.abs(bevel.outerOffset - currentBevel.outerOffset) > 0.01
          : false;
      const innerChanged =
        bevel.innerOffset !== undefined
          ? Math.abs(bevel.innerOffset - currentBevel.innerOffset) > 0.01
          : false;
      if (!outerChanged && !innerChanged) {
        wallBevelUpdateCacheRef.current.set(bevelCacheKey, cacheKey);
        return;
      }
      const normalizedOptions =
        options?.source === 'drag' && options.skipRoomDetection === undefined
          ? { ...options, skipRoomDetection: true }
          : options;
      optionsRef.current.updateWallBevel(wallId, end, bevel, normalizedOptions);
      wallBevelUpdateCacheRef.current.set(bevelCacheKey, cacheKey);
    },
    [findWallById]
  );

  const connectWallsIfNeeded = useCallback((wallId: string, otherWallId: string) => {
    if (wallId === otherWallId) return;
    const pairKey = wallId < otherWallId ? `${wallId}|${otherWallId}` : `${otherWallId}|${wallId}`;
    if (connectedPairCacheRef.current.has(pairKey)) return;

    const wall = findWallById(wallId);
    const otherWall = findWallById(otherWallId);
    if (
      wall?.connectedWalls.includes(otherWallId) &&
      otherWall?.connectedWalls.includes(wallId)
    ) {
      connectedPairCacheRef.current.add(pairKey);
      return;
    }

    optionsRef.current.connectWalls(wallId, otherWallId);
    connectedPairCacheRef.current.add(pairKey);
  }, [findWallById]);

  const resetDragDynamics = useCallback((point: Point2D) => {
    smoothedPointerRef.current = { ...point };
    endpointSnapMemoryRef.current = null;
    wallUpdateCacheRef.current.clear();
    wallBevelUpdateCacheRef.current.clear();
    connectedPairCacheRef.current.clear();
  }, []);

  const beginControlDrag = useCallback((meta: TargetMeta, point: Point2D) => {
    if (!meta.controlType) return false;

    if (meta.controlType === 'room-center-handle' && meta.roomId) {
      const room = findRoomById(meta.roomId);
      if (!room) return false;

      isWallHandleDraggingRef.current = true;
      resetDragDynamics(point);
      const ghostWalls = room.wallIds
        .map((wallId) => findWallById(wallId))
        .filter((wall): wall is Wall => Boolean(wall));
      showGhostWalls(ghostWalls);

      dragStateRef.current = {
        mode: 'room-move',
        roomId: room.id,
        startPointer: { ...point },
        lastAppliedDelta: { x: 0, y: 0 },
        ghostWalls,
      };
      return true;
    }

    if (meta.controlType === 'room-corner-handle' && meta.roomId && typeof meta.cornerIndex === 'number') {
      const room = findRoomById(meta.roomId);
      if (!room) return false;
      const baselineWalls = new Map<string, Wall>();
      room.wallIds.forEach((wallId) => {
        const roomWall = findWallById(wallId);
        if (roomWall) {
          baselineWalls.set(wallId, { ...roomWall });
        }
      });

      isWallHandleDraggingRef.current = true;
      resetDragDynamics(point);
      showGhostWalls(Array.from(baselineWalls.values()));
      dragStateRef.current = {
        mode: 'room-corner',
        roomId: room.id,
        cornerIndex: meta.cornerIndex,
        startPointer: { ...point },
        baselineRoom: {
          ...room,
          vertices: room.vertices.map((vertex) => ({ ...vertex })),
          wallIds: [...room.wallIds],
        },
        baselineWalls,
      };
      return true;
    }

    if (meta.controlType === 'room-scale-handle' && meta.roomId && meta.scaleDirection) {
      const room = findRoomById(meta.roomId);
      if (!room) return false;
      const baselineWalls = new Map<string, Wall>();
      room.wallIds.forEach((wallId) => {
        const roomWall = findWallById(wallId);
        if (roomWall) {
          baselineWalls.set(wallId, { ...roomWall });
        }
      });

      isWallHandleDraggingRef.current = true;
      resetDragDynamics(point);
      showGhostWalls(Array.from(baselineWalls.values()));
      dragStateRef.current = {
        mode: 'room-scale',
        roomId: room.id,
        direction: meta.scaleDirection,
        startPointer: { ...point },
        baselineRoom: {
          ...room,
          vertices: room.vertices.map((vertex) => ({ ...vertex })),
          wallIds: [...room.wallIds],
        },
        baselineWalls,
      };
      return true;
    }

    if (!meta.wallId) return false;
    const wall = findWallById(meta.wallId);
    if (!wall) return false;

    isWallHandleDraggingRef.current = true;
    resetDragDynamics(point);

    const bevelControl = parseBevelControl(meta.controlType);
    if (bevelControl) {
      const cornerTolerance = Math.max(
        2,
        optionsRef.current.wallSettings.endpointSnapTolerance / (MM_TO_PX * Math.max(optionsRef.current.zoom, 0.01))
      );
      const connectionCount = countWallsTouchingEndpoint(
        wall,
        bevelControl.endpoint,
        optionsRef.current.walls,
        cornerTolerance
      );
      const corner = computeCornerBevelDotsForEndpoint(
        wall,
        bevelControl.endpoint,
        optionsRef.current.walls,
        cornerTolerance
      ) ?? (connectionCount === 0
        ? computeDeadEndBevelDotsForEndpoint(wall, bevelControl.endpoint)
        : null);
      if (!corner) {
        isWallHandleDraggingRef.current = false;
        return false;
      }

      const bevelDirection = normalize(corner.bisector);
      if (magnitude(bevelDirection) < 0.0001) {
        isWallHandleDraggingRef.current = false;
        return false;
      }

      const origin = bevelControl.kind === 'outer' ? corner.outerMiterPoint : corner.innerMiterPoint;
      if (!origin) {
        isWallHandleDraggingRef.current = false;
        return false;
      }

      dragStateRef.current = {
        mode: 'bevel',
        wallId: wall.id,
        endpoint: bevelControl.endpoint,
        kind: bevelControl.kind,
        cornerPoint: corner.cornerPoint,
        origin,
        direction: bevelDirection,
        maxOffset: corner.maxOffset,
        otherWallId:
          'otherWallId' in corner && typeof corner.otherWallId === 'string'
            ? corner.otherWallId
            : wall.id,
        otherEndpoint:
          'otherEnd' in corner && (corner.otherEnd === 'start' || corner.otherEnd === 'end')
            ? corner.otherEnd
            : bevelControl.endpoint,
      };
      return true;
    }

    if (meta.controlType === 'wall-thickness-exterior' || meta.controlType === 'wall-thickness-interior') {
      dragStateRef.current = {
        mode: 'thickness',
        wallId: wall.id,
        side: meta.controlType === 'wall-thickness-interior' ? 'interior' : 'exterior',
        startPointer: { ...point },
        baselineWall: { ...wall },
        normal: wallNormal(wall),
      };
      return true;
    }

    if (meta.controlType === 'wall-center-handle') {
      const selectedWallIds = optionsRef.current.selectedIds.includes(wall.id)
        ? optionsRef.current.selectedIds.filter((id) => Boolean(findWallById(id)))
        : [wall.id];
      const selectedWallIdSet = new Set(selectedWallIds);
      const baselineWalls = new Map<string, Wall>();
      for (const wallId of selectedWallIds) {
        const selectedWall = findWallById(wallId);
        if (selectedWall) baselineWalls.set(wallId, { ...selectedWall });
      }

      const endpointConstraints: MoveEndpointConstraint[] = [];
      baselineWalls.forEach((baselineWall) => {
        const startConstraints = buildEndpointConstraints(
          baselineWall,
          'start',
          selectedWallIdSet
        );
        if (startConstraints.connectedEndpoints.length > 0 || startConstraints.segmentConstraints.length > 0) {
          endpointConstraints.push({
            wallId: baselineWall.id,
            endpoint: 'start',
            connectedEndpoints: startConstraints.connectedEndpoints,
            segmentConstraints: startConstraints.segmentConstraints,
          });
        }

        const endConstraints = buildEndpointConstraints(
          baselineWall,
          'end',
          selectedWallIdSet
        );
        if (endConstraints.connectedEndpoints.length > 0 || endConstraints.segmentConstraints.length > 0) {
          endpointConstraints.push({
            wallId: baselineWall.id,
            endpoint: 'end',
            connectedEndpoints: endConstraints.connectedEndpoints,
            segmentConstraints: endConstraints.segmentConstraints,
          });
        }
      });

      const constrainedNormal = baselineWalls.size === 1 ? wallNormal(wall) : null;

      dragStateRef.current = {
        mode: 'move',
        wallIds: Array.from(baselineWalls.keys()),
        anchorWallId: wall.id,
        startPointer: { ...point },
        baselineWalls,
        constrainedNormal,
        endpointConstraints,
      };
      showGhostWalls(Array.from(baselineWalls.values()));
      return true;
    }

    if (meta.controlType === 'wall-rotation-handle') {
      const connectedEndpoints: ConnectedEndpointRef[] = [];
      for (const connectedWallId of wall.connectedWalls) {
        const connectedWall = findWallById(connectedWallId);
        if (!connectedWall) continue;
        if (pointsNear(connectedWall.startPoint, wall.startPoint)) {
          connectedEndpoints.push({ wallId: connectedWall.id, endpoint: 'start' });
        } else if (pointsNear(connectedWall.endPoint, wall.startPoint)) {
          connectedEndpoints.push({ wallId: connectedWall.id, endpoint: 'end' });
        }
        if (pointsNear(connectedWall.startPoint, wall.endPoint)) {
          connectedEndpoints.push({ wallId: connectedWall.id, endpoint: 'start' });
        } else if (pointsNear(connectedWall.endPoint, wall.endPoint)) {
          connectedEndpoints.push({ wallId: connectedWall.id, endpoint: 'end' });
        }
      }

      dragStateRef.current = {
        mode: 'rotate',
        wallId: wall.id,
        baselineWall: { ...wall },
        connectedEndpoints,
        operation: new WallRotationOperation(wall, {
          updateWall: (id, updates) =>
            optionsRef.current.updateWall(id, updates, {
              skipHistory: true,
              source: 'drag',
              skipRoomDetection: true,
            }),
        }),
      };
      showGhostWalls([{ ...wall }]);
      return true;
    }

    if (meta.controlType === 'wall-endpoint-start' || meta.controlType === 'wall-endpoint-end') {
      const endpoint: 'start' | 'end' =
        meta.controlType === 'wall-endpoint-start' ? 'start' : 'end';
      const { connectedEndpoints, segmentConstraints } = buildEndpointConstraints(
        wall,
        endpoint,
        new Set([wall.id])
      );

      dragStateRef.current = {
        mode: 'endpoint',
        wallId: wall.id,
        endpoint,
        startPointer: { ...point },
        baselineWall: { ...wall },
        fixedPoint: endpoint === 'start' ? { ...wall.endPoint } : { ...wall.startPoint },
        connectedEndpoints,
        segmentConstraints,
      };
      return true;
    }

    return false;
  }, [buildEndpointConstraints, findRoomById, findWallById, resetDragDynamics, showGhostWalls]);

  const computePerpendicularSnap = useCallback(
    (state: EndpointDragState, candidatePoint: Point2D): { snapped: Point2D; line?: { start: Point2D; end: Point2D } } => {
      const connectedWalls = state.baselineWall.connectedWalls
        .map((wallId) => findWallById(wallId))
        .filter((wall): wall is Wall => Boolean(wall));

      for (const connectedWall of connectedWalls) {
        const perpDir = perpendicularDirection(connectedWall, state.fixedPoint);
        if (!perpDir) continue;

        const candidateDirection = normalize(subtract(candidatePoint, state.fixedPoint));
        const angle = Math.acos(clamp(dot(candidateDirection, perpDir), -1, 1)) * (180 / Math.PI);
        const angleAlt = Math.min(angle, Math.abs(180 - angle));
        if (angleAlt > PERPENDICULAR_SNAP_TOLERANCE_DEG) continue;

        const projectedLength = dot(subtract(candidatePoint, state.fixedPoint), perpDir);
        const snapped = add(state.fixedPoint, scale(perpDir, projectedLength));
        return {
          snapped,
          line: { start: state.fixedPoint, end: snapped },
        };
      }

      return { snapped: candidatePoint };
    },
    [findWallById]
  );

  const hasOverlapWithUnselectedWalls = useCallback((candidates: Map<string, Wall>): boolean => {
    const candidateIds = new Set(candidates.keys());
    const otherWalls = optionsRef.current.walls.filter((wall) => !candidateIds.has(wall.id));

    for (const candidate of candidates.values()) {
      for (const other of otherWalls) {
        if (wallsLikelyOverlapping(candidate, other)) {
          return true;
        }
      }
    }
    return false;
  }, []);

  const applyDrag = useCallback((point: Point2D): DragApplyResult | null => {
    const state = dragStateRef.current;
    if (state.mode === 'idle') return null;

    if (state.mode === 'thickness') {
      const baseline = state.baselineWall;
      const normal = state.normal;
      const enableThicknessPresetSnap = modifierKeysRef.current.shift;
      const center = midpoint(baseline.startPoint, baseline.endPoint);
      const centerOffset = dot(center, normal);
      const pointerOffset = dot(point, normal);

      // Compute thickness as 2× the perpendicular distance from the centerline to
      // the pointer. Keeping startPoint/endPoint fixed preserves endpoint connections
      // to neighboring walls, ensuring uniform and consistent thickness appearance.
      const rawThickness = 2 * Math.abs(pointerOffset - centerOffset);
      const nextThickness = clamp(
        enableThicknessPresetSnap ? snapThickness(rawThickness) : rawThickness,
        MIN_WALL_THICKNESS,
        MAX_WALL_THICKNESS
      );

      // Only update thickness; centerline (startPoint/endPoint) stays fixed.
      updateWallIfChanged(
        baseline.id,
        { thickness: nextThickness },
        { skipHistory: true, source: 'drag' }
      );

      const updatedWall: Wall = {
        ...baseline,
        thickness: nextThickness,
      };
      setStatusFromWall(updatedWall);

      const handlePoint = add(
        center,
        scale(normal, state.side === 'interior' ? nextThickness / 2 : -nextThickness / 2)
      );

      return {
        label: `Thickness ${Math.round(nextThickness)} mm`,
        point: handlePoint,
      };
    }

    if (state.mode === 'bevel') {
      const projection = projectPointToLine(point, state.origin, state.direction);
      const nextOffset = clampBevelOffset(projection.t, state.maxOffset);
      const direction = normalize(state.direction);
      const fallbackPoint = add(state.origin, scale(direction, nextOffset));
      const bevelUpdate =
        state.kind === 'outer'
          ? { outerOffset: nextOffset }
          : { innerOffset: nextOffset };

      updateWallBevelIfChanged(
        state.wallId,
        state.endpoint,
        bevelUpdate,
        {
          skipHistory: true,
          source: 'drag',
          skipRoomDetection: true,
        }
      );

      const updatedCorner = optionsRef.current.getCornerBevelDots(state.cornerPoint);
      const handlePoint =
        state.kind === 'outer'
          ? updatedCorner?.outerDotPosition ?? fallbackPoint
          : updatedCorner?.innerDotPosition ?? fallbackPoint;

      return {
        label: `${state.kind === 'outer' ? 'Outer' : 'Inner'} bevel ${Math.round(nextOffset)} mm`,
        point: handlePoint,
      };
    }

    if (state.mode === 'move') {
      const { wallSettings } = optionsRef.current;
      const gridSize = Math.max(1, wallSettings.gridSize);
      const shouldGridSnap = wallSettings.snapToGrid && modifierKeysRef.current.shift;
      let translation = subtract(point, state.startPointer);

      if (state.constrainedNormal) {
        const alongNormal = dot(translation, state.constrainedNormal);
        const snapped = shouldGridSnap ? Math.round(alongNormal / gridSize) * gridSize : alongNormal;
        translation = scale(state.constrainedNormal, snapped);
      } else if (shouldGridSnap) {
        translation = {
          x: Math.round(translation.x / gridSize) * gridSize,
          y: Math.round(translation.y / gridSize) * gridSize,
        };
      }

      const candidates = new Map<string, Wall>();
      for (const wallId of state.wallIds) {
        const baselineWall = state.baselineWalls.get(wallId);
        if (!baselineWall) continue;
        candidates.set(wallId, {
          ...baselineWall,
          startPoint: add(baselineWall.startPoint, translation),
          endPoint: add(baselineWall.endPoint, translation),
        });
      }

      // Keep moving-wall junctions bonded to host wall center-lines (T-junction support).
      for (const endpointConstraint of state.endpointConstraints) {
        const candidateWall = candidates.get(endpointConstraint.wallId);
        if (!candidateWall) continue;

        let constrainedPoint =
          endpointConstraint.endpoint === 'start'
            ? { ...candidateWall.startPoint }
            : { ...candidateWall.endPoint };

        if (endpointConstraint.segmentConstraints.length > 0) {
          let bestProjection = projectPointToSegment(
            constrainedPoint,
            endpointConstraint.segmentConstraints[0].startPoint,
            endpointConstraint.segmentConstraints[0].endPoint
          );
          for (let i = 1; i < endpointConstraint.segmentConstraints.length; i += 1) {
            const projection = projectPointToSegment(
              constrainedPoint,
              endpointConstraint.segmentConstraints[i].startPoint,
              endpointConstraint.segmentConstraints[i].endPoint
            );
            if (projection.distance < bestProjection.distance) {
              bestProjection = projection;
            }
          }
          constrainedPoint = bestProjection.point;
        }

        if (endpointConstraint.endpoint === 'start') {
          candidateWall.startPoint = constrainedPoint;
        } else {
          candidateWall.endPoint = constrainedPoint;
        }
      }

      if (hasOverlapWithUnselectedWalls(candidates)) {
        optionsRef.current.setProcessingStatus('Overlap warning: wall intersects other walls.', false);
      }

      candidates.forEach((candidateWall, wallId) => {
        updateWallIfChanged(
          wallId,
          {
            startPoint: candidateWall.startPoint,
            endPoint: candidateWall.endPoint,
          },
          { skipHistory: true, source: 'drag' }
        );
      });

      // Elastic mode: stretch neighboring non-selected walls by moving shared endpoints.
      const followerUpdates = new Map<string, Partial<Wall>>();
      for (const endpointConstraint of state.endpointConstraints) {
        const candidateWall = candidates.get(endpointConstraint.wallId);
        if (!candidateWall) continue;
        const movedPoint =
          endpointConstraint.endpoint === 'start'
            ? candidateWall.startPoint
            : candidateWall.endPoint;

        for (const connected of endpointConstraint.connectedEndpoints) {
          const pending = followerUpdates.get(connected.wallId) ?? {};
          if (connected.endpoint === 'start') {
            pending.startPoint = movedPoint;
          } else {
            pending.endPoint = movedPoint;
          }
          followerUpdates.set(connected.wallId, pending);
          connectWallsIfNeeded(endpointConstraint.wallId, connected.wallId);
        }
      }

      followerUpdates.forEach((updates, wallId) => {
        updateWallIfChanged(
          wallId,
          updates,
          { skipHistory: true, source: 'drag' }
        );
      });

      const anchor = candidates.get(state.anchorWallId);
      if (anchor) {
        setStatusFromWall(anchor);
      }

      const translationLength = Math.round(magnitude(translation));
      const labelPoint = anchor
        ? midpoint(anchor.startPoint, anchor.endPoint)
        : point;
      return {
        label: `Move ${translationLength} mm`,
        point: labelPoint,
      };
    }

    if (state.mode === 'room-move') {
      const room = findRoomById(state.roomId);
      if (!room) return null;
      const { wallSettings } = optionsRef.current;
      let translation = subtract(point, state.startPointer);
      if (wallSettings.snapToGrid && modifierKeysRef.current.shift) {
        translation = {
          x: Math.round(translation.x / wallSettings.gridSize) * wallSettings.gridSize,
          y: Math.round(translation.y / wallSettings.gridSize) * wallSettings.gridSize,
        };
      }

      const delta = {
        x: translation.x - state.lastAppliedDelta.x,
        y: translation.y - state.lastAppliedDelta.y,
      };
      if (Math.abs(delta.x) > 0.0001 || Math.abs(delta.y) > 0.0001) {
        optionsRef.current.moveRoom(state.roomId, delta, { skipHistory: true });
        state.lastAppliedDelta = translation;
      }

      const movedCentroid = add(room.centroid, translation);
      setStatusFromRoom({
        ...room,
        centroid: movedCentroid,
      });

      return {
        label: `${room.name} move ${Math.round(magnitude(translation))} mm`,
        point: movedCentroid,
      };
    }

    if (state.mode === 'room-corner') {
      const room = findRoomById(state.roomId);
      if (!room) return null;

      const nextVertices = state.baselineRoom.vertices.map((vertex) => ({ ...vertex }));
      let nextCorner = { ...point };
      if (optionsRef.current.wallSettings.snapToGrid && modifierKeysRef.current.shift) {
        nextCorner = snapToGrid(nextCorner, optionsRef.current.wallSettings.gridSize);
      }
      nextVertices[state.cornerIndex] = nextCorner;

      const validation = validateRoomVertices(nextVertices);
      if (!validation.valid) {
        optionsRef.current.setProcessingStatus(validation.reason ?? 'Invalid room edit.', false);
        return null;
      }

      state.baselineWalls.forEach((baselineWall, wallId) => {
        let nextStart = { ...baselineWall.startPoint };
        let nextEnd = { ...baselineWall.endPoint };
        state.baselineRoom.vertices.forEach((baselineVertex, vertexIndex) => {
          if (pointsNear(baselineWall.startPoint, baselineVertex)) {
            nextStart = { ...nextVertices[vertexIndex] };
          }
          if (pointsNear(baselineWall.endPoint, baselineVertex)) {
            nextEnd = { ...nextVertices[vertexIndex] };
          }
        });
        if (!pointsNear(nextStart, baselineWall.startPoint) || !pointsNear(nextEnd, baselineWall.endPoint)) {
          updateWallIfChanged(
            wallId,
            { startPoint: nextStart, endPoint: nextEnd },
            { skipHistory: true, source: 'drag', skipRoomDetection: true }
          );
        }
      });

      const areaM2 = GeometryEngine.calculateRoomAreaM2({ vertices: nextVertices });
      const centroid = GeometryEngine.findRoomCentroid({ vertices: nextVertices });
      optionsRef.current.setProcessingStatus(
        `${room.name}: Area ${areaM2.toFixed(2)}m²`,
        false
      );
      return {
        label: `Corner edit | Area ${areaM2.toFixed(2)} m²`,
        point: centroid,
      };
    }

    if (state.mode === 'room-scale') {
      const room = findRoomById(state.roomId);
      if (!room) return null;

      const bounds = roomBounds(state.baselineRoom.vertices);
      const origin = oppositeScaleAnchor(state.direction, bounds);
      const center = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      };
      const handlePointByDirection: Record<typeof state.direction, Point2D> = {
        NW: { x: bounds.minX, y: bounds.minY },
        N: { x: center.x, y: bounds.minY },
        NE: { x: bounds.maxX, y: bounds.minY },
        E: { x: bounds.maxX, y: center.y },
        SE: { x: bounds.maxX, y: bounds.maxY },
        S: { x: center.x, y: bounds.maxY },
        SW: { x: bounds.minX, y: bounds.maxY },
        W: { x: bounds.minX, y: center.y },
      };
      const baseHandle = handlePointByDirection[state.direction];

      let nextPointer = { ...point };
      if (optionsRef.current.wallSettings.snapToGrid && modifierKeysRef.current.shift) {
        nextPointer = snapToGrid(nextPointer, optionsRef.current.wallSettings.gridSize);
      }

      const baseDx = baseHandle.x - origin.x;
      const baseDy = baseHandle.y - origin.y;
      let scaleX = Math.abs(baseDx) < 0.001 ? 1 : (nextPointer.x - origin.x) / baseDx;
      let scaleY = Math.abs(baseDy) < 0.001 ? 1 : (nextPointer.y - origin.y) / baseDy;

      if (state.direction === 'N' || state.direction === 'S') {
        scaleX = 1;
      }
      if (state.direction === 'E' || state.direction === 'W') {
        scaleY = 1;
      }

      if (
        (state.direction === 'NW' || state.direction === 'NE' || state.direction === 'SE' || state.direction === 'SW') &&
        !modifierKeysRef.current.shift
      ) {
        const uniform = Math.max(Math.abs(scaleX), Math.abs(scaleY));
        scaleX = Math.sign(scaleX || 1) * uniform;
        scaleY = Math.sign(scaleY || 1) * uniform;
      }

      scaleX = clamp(scaleX, 0.2, 5);
      scaleY = clamp(scaleY, 0.2, 5);

      const nextVertices = state.baselineRoom.vertices.map((vertex) => ({
        x: origin.x + (vertex.x - origin.x) * scaleX,
        y: origin.y + (vertex.y - origin.y) * scaleY,
      }));

      const validation = validateRoomVertices(nextVertices);
      if (!validation.valid) {
        optionsRef.current.setProcessingStatus(validation.reason ?? 'Invalid room scaling.', false);
        return null;
      }

      state.baselineWalls.forEach((baselineWall, wallId) => {
        let nextStart = { ...baselineWall.startPoint };
        let nextEnd = { ...baselineWall.endPoint };
        state.baselineRoom.vertices.forEach((baselineVertex, vertexIndex) => {
          if (pointsNear(baselineWall.startPoint, baselineVertex)) {
            nextStart = { ...nextVertices[vertexIndex] };
          }
          if (pointsNear(baselineWall.endPoint, baselineVertex)) {
            nextEnd = { ...nextVertices[vertexIndex] };
          }
        });
        if (!pointsNear(nextStart, baselineWall.startPoint) || !pointsNear(nextEnd, baselineWall.endPoint)) {
          updateWallIfChanged(
            wallId,
            { startPoint: nextStart, endPoint: nextEnd },
            { skipHistory: true, source: 'drag', skipRoomDetection: true }
          );
        }
      });

      const areaM2 = GeometryEngine.calculateRoomAreaM2({ vertices: nextVertices });
      const centroid = GeometryEngine.findRoomCentroid({ vertices: nextVertices });
      const scaleDisplay = ((Math.abs(scaleX) + Math.abs(scaleY)) / 2).toFixed(2);
      optionsRef.current.setProcessingStatus(
        `${room.name}: Scale ${scaleDisplay}x | Area ${areaM2.toFixed(2)}m²`,
        false
      );
      return {
        label: `Scale ${scaleDisplay}x | Area ${areaM2.toFixed(2)} m²`,
        point: centroid,
      };
    }

    if (state.mode === 'rotate') {
      const rotationPreview = state.operation.onDrag(point, {
        shift: modifierKeysRef.current.shift,
        ctrl: modifierKeysRef.current.ctrl,
      });

      updateWallIfChanged(
        state.wallId,
        {
          startPoint: rotationPreview.startPoint,
          endPoint: rotationPreview.endPoint,
        },
        { skipHistory: true, source: 'drag' }
      );

      for (const connected of state.connectedEndpoints) {
        const baselineConnected = findWallById(connected.wallId);
        if (!baselineConnected) continue;
        connectWallsIfNeeded(state.wallId, connected.wallId);
        if (
          connected.endpoint === 'start' &&
          pointsNear(baselineConnected.startPoint, state.baselineWall.startPoint)
        ) {
          updateWallIfChanged(
            connected.wallId,
            { startPoint: rotationPreview.startPoint },
            { skipHistory: true, source: 'drag' }
          );
          continue;
        }
        if (
          connected.endpoint === 'end' &&
          pointsNear(baselineConnected.endPoint, state.baselineWall.startPoint)
        ) {
          updateWallIfChanged(
            connected.wallId,
            { endPoint: rotationPreview.startPoint },
            { skipHistory: true, source: 'drag' }
          );
          continue;
        }
        if (
          connected.endpoint === 'start' &&
          pointsNear(baselineConnected.startPoint, state.baselineWall.endPoint)
        ) {
          updateWallIfChanged(
            connected.wallId,
            { startPoint: rotationPreview.endPoint },
            { skipHistory: true, source: 'drag' }
          );
          continue;
        }
        if (
          connected.endpoint === 'end' &&
          pointsNear(baselineConnected.endPoint, state.baselineWall.endPoint)
        ) {
          updateWallIfChanged(
            connected.wallId,
            { endPoint: rotationPreview.endPoint },
            { skipHistory: true, source: 'drag' }
          );
        }
      }

      setStatusFromWall({
        ...state.baselineWall,
        startPoint: rotationPreview.startPoint,
        endPoint: rotationPreview.endPoint,
      });
      return {
        label: `Angle ${rotationPreview.absoluteAngleDeg.toFixed(1)}deg | Delta ${
          rotationPreview.deltaAngleDeg >= 0 ? '+' : ''
        }${rotationPreview.deltaAngleDeg.toFixed(1)}deg`,
        point: midpoint(rotationPreview.startPoint, rotationPreview.endPoint),
      };
    }

    const endpointState = state;
    let snappedPoint = { ...point };
    let snapPoint: Point2D | undefined;
    let snapLine: { start: Point2D; end: Point2D } | undefined;
    let snappedWallId: string | undefined;
    const snapReleaseDistanceMm = getSnapReleaseDistanceMm();
    const snapMemory = endpointSnapMemoryRef.current;
    const canReuseSnapMemory =
      snapMemory?.mode === 'endpoint' && snapMemory.wallId === endpointState.wallId;

    if (!modifierKeysRef.current.ctrl) {
      const snap = snapManagerRef.current.findBestSnap({
        point: snappedPoint,
        walls: optionsRef.current.walls,
        zoom: optionsRef.current.zoom,
        gridSizeMm: optionsRef.current.wallSettings.gridSize,
        snapDistancePx: Math.max(
          optionsRef.current.wallSettings.endpointSnapTolerance,
          optionsRef.current.wallSettings.midpointSnapTolerance
        ),
        excludeWallId: endpointState.wallId,
        referencePoint: endpointState.fixedPoint,
      });
      if (snap) {
        snappedPoint = snap.point;
        snappedWallId = snap.wallId;
        snapPoint = snap.point;
        endpointSnapMemoryRef.current = {
          mode: 'endpoint',
          wallId: endpointState.wallId,
          point: { ...snap.point },
          snappedWallId: snap.wallId,
          visual: {
            color: snap.visual.color,
            indicator: snap.visual.indicator,
          },
        };
        showSnapIndicator(snap.point, undefined, {
          color: snap.visual.color,
          indicator: snap.visual.indicator,
        });
      } else if (canReuseSnapMemory && snapMemory) {
        const distanceToMemory = magnitude(subtract(snappedPoint, snapMemory.point));
        if (distanceToMemory <= snapReleaseDistanceMm) {
          snappedPoint = { ...snapMemory.point };
          snapPoint = { ...snapMemory.point };
          snappedWallId = snapMemory.snappedWallId;
          const memoryVisual = snapMemory.visual ?? { color: '#2563EB', indicator: 'circle' as const };
          showSnapIndicator(snapMemory.point, undefined, {
            color: memoryVisual.color,
            indicator: memoryVisual.indicator,
          });
        } else {
          endpointSnapMemoryRef.current = null;
        }
      }
    } else if (canReuseSnapMemory) {
      endpointSnapMemoryRef.current = null;
    }

    if (optionsRef.current.wallSettings.snapToGrid && modifierKeysRef.current.shift && !snapPoint) {
      snappedPoint = snapToGrid(snappedPoint, optionsRef.current.wallSettings.gridSize);
      snapPoint = snappedPoint;
      showSnapIndicator(snappedPoint, undefined, {
        color: '#10B981',
        indicator: 'circle',
      });
    }

    const perpendicularSnap = modifierKeysRef.current.ctrl
      ? { snapped: snappedPoint as Point2D }
      : computePerpendicularSnap(endpointState, snappedPoint);
    if (!snapPoint && perpendicularSnap.line) {
      snappedPoint = perpendicularSnap.snapped;
      snapLine = perpendicularSnap.line;
      snapPoint = perpendicularSnap.snapped;
    }

    const endpointVector = subtract(snappedPoint, endpointState.fixedPoint);
    const endpointDistance = magnitude(endpointVector);
    if (endpointDistance < MIN_WALL_LENGTH) {
      const direction = endpointDistance < 0.0001
        ? wallDirection(endpointState.baselineWall)
        : normalize(endpointVector);
      snappedPoint = add(endpointState.fixedPoint, scale(direction, MIN_WALL_LENGTH));
    }

    if (endpointState.segmentConstraints.length > 0) {
      let bestProjection = projectPointToSegment(
        snappedPoint,
        endpointState.segmentConstraints[0].startPoint,
        endpointState.segmentConstraints[0].endPoint
      );
      let bestConstraint = endpointState.segmentConstraints[0];
      for (let i = 1; i < endpointState.segmentConstraints.length; i += 1) {
        const projection = projectPointToSegment(
          snappedPoint,
          endpointState.segmentConstraints[i].startPoint,
          endpointState.segmentConstraints[i].endPoint
        );
        if (projection.distance < bestProjection.distance) {
          bestProjection = projection;
          bestConstraint = endpointState.segmentConstraints[i];
        }
      }
      snappedPoint = bestProjection.point;
      snapPoint = snappedPoint;
      snapLine = { start: bestConstraint.startPoint, end: bestConstraint.endPoint };
      connectWallsIfNeeded(endpointState.wallId, bestConstraint.wallId);
    }

    if (endpointState.endpoint === 'start') {
      updateWallIfChanged(
        endpointState.wallId,
        { startPoint: snappedPoint },
        { skipHistory: true, source: 'drag' }
      );
    } else {
      updateWallIfChanged(
        endpointState.wallId,
        { endPoint: snappedPoint },
        { skipHistory: true, source: 'drag' }
      );
    }

    for (const connected of endpointState.connectedEndpoints) {
      if (connected.endpoint === 'start') {
        updateWallIfChanged(
          connected.wallId,
          { startPoint: snappedPoint },
          { skipHistory: true, source: 'drag' }
        );
      } else {
        updateWallIfChanged(
          connected.wallId,
          { endPoint: snappedPoint },
          { skipHistory: true, source: 'drag' }
        );
      }
      connectWallsIfNeeded(endpointState.wallId, connected.wallId);
    }

    if (snappedWallId) {
      connectWallsIfNeeded(endpointState.wallId, snappedWallId);
    }

    if (snapPoint || snapLine) {
      if (snapLine) {
        showSnapIndicator(snapPoint, snapLine, {
          color: '#2563EB',
          indicator: 'cross',
        });
      }
    } else {
      clearSnapIndicators();
    }

    const updatedWall: Wall =
      endpointState.endpoint === 'start'
        ? { ...endpointState.baselineWall, startPoint: snappedPoint }
        : { ...endpointState.baselineWall, endPoint: snappedPoint };
    setStatusFromWall(updatedWall);

    const lengthMm = wallLength(updatedWall);
    const angle = wallAngleDegrees(updatedWall);
    return {
      label: `Length ${Math.round(lengthMm)} mm | ${angle.toFixed(1)}deg`,
      point: midpoint(updatedWall.startPoint, updatedWall.endPoint),
      snapPoint,
    };
  }, [
    clearSnapIndicators,
    connectWallsIfNeeded,
    computePerpendicularSnap,
    findWallById,
    findRoomById,
    getSnapReleaseDistanceMm,
    hasOverlapWithUnselectedWalls,
    setStatusFromRoom,
    setStatusFromWall,
    showSnapIndicator,
    updateWallBevelIfChanged,
    updateWallIfChanged,
  ]);

  const flushDragFrame = useCallback(() => {
    frameRef.current = null;
    const point = pendingPointRef.current;
    pendingPointRef.current = null;
    if (!point) return;

    const result = applyDrag(point);
    if (!result) return;
    setDimensionLabel(result.label, result.point);
  }, [applyDrag, setDimensionLabel]);

  const scheduleDragFrame = useCallback((point: Point2D) => {
    const mode = dragStateRef.current.mode;
    pendingPointRef.current = mode === 'idle' ? point : smoothDragPoint(point, mode);
    if (frameRef.current !== null) return;
    if (typeof window === 'undefined') {
      flushDragFrame();
      return;
    }
    frameRef.current = window.requestAnimationFrame(flushDragFrame);
  }, [flushDragFrame, smoothDragPoint]);

  const handleMouseMove = useCallback(
    (scenePoint: Point2D, target?: FabricObject | null): boolean => {
      const dragState = dragStateRef.current;
      if (dragState.mode === 'idle') {
        const meta = getTargetMeta(target ?? null);
        const hoveredId =
          meta.wallId ??
          meta.roomId ??
          (meta.name?.startsWith('wall-') || meta.name?.startsWith('room-') ? meta.id : null) ??
          null;
        optionsRef.current.setHoveredElement(hoveredId);
        if (meta.roomId) {
          const room = findRoomById(meta.roomId);
          if (room && room.adjacentRoomIds.length > 0) {
            optionsRef.current.setProcessingStatus(
              `${room.name}: adjacent to ${room.adjacentRoomIds.length} room(s).`,
              false
            );
          }
        }
        return false;
      }

      scheduleDragFrame(scenePoint);
      return true;
    },
    [findRoomById, getTargetMeta, scheduleDragFrame]
  );

  const finishDrag = useCallback(() => {
    if (frameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (pendingPointRef.current) {
      const point = pendingPointRef.current;
      pendingPointRef.current = null;
      const result = applyDrag(point);
      if (result) {
        setDimensionLabel(result.label, result.point);
      }
    }

    const mode = dragStateRef.current.mode;
    if (mode !== 'idle') {
      const action =
        mode === 'thickness'
          ? 'Adjust wall thickness'
          : mode === 'move'
            ? 'Move wall'
            : mode === 'rotate'
              ? 'Rotate wall'
            : mode === 'room-corner'
              ? 'Edit room corner'
            : mode === 'room-scale'
                ? 'Scale room'
            : mode === 'room-move'
              ? 'Move room'
            : mode === 'bevel'
              ? 'Adjust wall bevel'
            : 'Edit wall endpoint';
      optionsRef.current.detectRooms();
      optionsRef.current.saveToHistory(action);
    }

    dragStateRef.current = { mode: 'idle' };
    isWallHandleDraggingRef.current = false;
    smoothedPointerRef.current = null;
    endpointSnapMemoryRef.current = null;
    wallUpdateCacheRef.current.clear();
    wallBevelUpdateCacheRef.current.clear();
    connectedPairCacheRef.current.clear();
    clearEditVisuals();
  }, [applyDrag, clearEditVisuals, setDimensionLabel]);

  const finalizeHandleDrag = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  const handleDoubleClick = useCallback((event: MouseEvent) => {
    const canvas = fabricRef.current;
    if (!canvas) return false;
    const target = canvas.findTarget(event as unknown as fabric.TPointerEvent);
    const meta = getTargetMeta((target as FabricObject | undefined | null) ?? null);
    const bevelControl = parseBevelControl(meta.controlType);
    if (!bevelControl || !meta.wallId) {
      return false;
    }

    const bevelUpdate =
      bevelControl.kind === 'outer'
        ? { outerOffset: 0 }
        : { innerOffset: 0 };
    optionsRef.current.updateWallBevel(
      meta.wallId,
      bevelControl.endpoint,
      bevelUpdate,
      {
        skipHistory: false,
        source: 'ui',
        skipRoomDetection: false,
      }
    );
    optionsRef.current.setProcessingStatus(
      `${bevelControl.kind === 'outer' ? 'Outer' : 'Inner'} bevel reset.`,
      false
    );
    return true;
  }, [fabricRef, getTargetMeta]);

  const handleObjectMoving = useCallback((_target: FabricObject) => {
    // Object moving is disabled for wall groups. Editing is handle-driven.
  }, []);

  const handleMouseDown = useCallback(
    (
      target: FabricObject | undefined | null,
      scenePoint: { x: number; y: number },
      addToSelection: boolean = false
    ) => {
      const meta = getTargetMeta(target);

      if ((meta.isWallControl || meta.isRoomControl) && beginControlDrag(meta, scenePoint)) {
        const selectedPrimaryId = meta.wallId ?? meta.roomId;
        if (selectedPrimaryId && !optionsRef.current.selectedIds.includes(selectedPrimaryId)) {
          optionsRef.current.setSelectedIds([selectedPrimaryId]);
        }
        return;
      }

      const clickedId =
        meta.wallId ??
        meta.roomId ??
        (meta.name?.startsWith('wall-') || meta.name?.startsWith('room-') ? meta.id : undefined);
      if (clickedId) {
        if (addToSelection) {
          const current = new Set(optionsRef.current.selectedIds);
          if (current.has(clickedId)) {
            current.delete(clickedId);
          } else {
            current.add(clickedId);
          }
          optionsRef.current.setSelectedIds(Array.from(current));
        } else {
          optionsRef.current.setSelectedIds([clickedId]);
        }
        optionsRef.current.setHoveredElement(clickedId);
        return;
      }

      if (!addToSelection) {
        optionsRef.current.setSelectedIds([]);
      }
      optionsRef.current.setHoveredElement(null);
    },
    [beginControlDrag, getTargetMeta]
  );

  const handleMouseUp = useCallback(() => {
    if (dragStateRef.current.mode === 'idle') return false;
    finishDrag();
    return true;
  }, [finishDrag]);

  const handleRoomHover = useCallback(
    (_point: { x: number; y: number }, _viewportPoint: { x: number; y: number }) => {
      optionsRef.current.setHoveredElement(null);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (frameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(frameRef.current);
      }
      clearEditVisuals();
    };
  }, [clearEditVisuals]);

  return {
    isWallHandleDraggingRef,
    getTargetMeta,
    updateSelectionFromTarget,
    updateSelectionFromTargets,
    finalizeHandleDrag,
    handleObjectMoving,
    handleDoubleClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleRoomHover,
  };
}

