/**
 * CAD-style interaction system for floor plan editing.
 *
 * Features:
 * - Multi-level selection (vertex/wall/room) with propagation
 * - Window/crossing/lasso selection
 * - Handle generation for wall edits
 * - Smart snapping and alignment guides
 * - State machine and event delegation adapters
 * - Render invalidation scheduler for canvas/SVG overlay optimization
 */

import type { Point2D, Room2D, Wall2D } from '../../types';
import {
    arePointsClose,
    calculatePolygonBounds,
    distanceBetween,
    distancePointToSegment,
    isPointInsidePolygon,
    projectPointToSegment,
} from './geometry';
import { SpatialHash, pointBounds, type HashBounds } from './spatial-hash';

// =============================================================================
// Selection Types
// =============================================================================

export type SelectionLevel = 'vertex' | 'wall' | 'room';
export type SelectionBoxMode = 'window' | 'crossing';
export type LassoMode = 'enclosed' | 'crossing';

export interface EntityRef {
    level: SelectionLevel;
    id: string;
}

export interface SelectionState {
    vertices: Set<string>;
    walls: Set<string>;
    rooms: Set<string>;
    primary: EntityRef | null;
}

export interface SelectionOptions {
    toggle?: boolean;
    append?: boolean;
    clearIfEmpty?: boolean;
}

export interface SelectionPropagationOptions {
    vertexToWalls?: boolean;
    wallToVertices?: boolean;
    wallToRooms?: boolean;
    roomToWalls?: boolean;
    roomToVertices?: boolean;
}

// =============================================================================
// Scene Primitives
// =============================================================================

export interface VertexPrimitive {
    id: string;
    position: Point2D;
    wallIds: string[];
}

export interface WallPrimitive {
    id: string;
    start: Point2D;
    end: Point2D;
    startVertexId: string;
    endVertexId: string;
    thickness: number;
    bounds: HashBounds;
}

export interface RoomPrimitive {
    id: string;
    vertices: Point2D[];
    wallIds: string[];
    bounds: HashBounds;
}

export interface InteractionScene {
    vertices: Map<string, VertexPrimitive>;
    walls: Map<string, WallPrimitive>;
    rooms: Map<string, RoomPrimitive>;
    vertexHash: SpatialHash<VertexPrimitive>;
    wallHash: SpatialHash<WallPrimitive>;
    roomHash: SpatialHash<RoomPrimitive>;
    wallToRooms: Map<string, Set<string>>;
}

export interface SceneBuildOptions {
    endpointMergeTolerance?: number;
    hashCellSize?: number;
}

// =============================================================================
// Handles
// =============================================================================

export type HandleType =
    | 'wall-midpoint'
    | 'wall-start'
    | 'wall-end'
    | 'wall-thickness-positive'
    | 'wall-thickness-negative'
    | 'corner-angle';

export interface ManipulationHandle {
    id: string;
    type: HandleType;
    wallId: string;
    position: Point2D;
    cursor: string;
    metadata?: Record<string, unknown>;
}

export interface HandleGenerationOptions {
    angleHandleRadius?: number;
    minimumWallLength?: number;
}

export interface InteractionVisualTheme {
    normal: string;
    hovered: string;
    selected: string;
    preview: string;
    handle: string;
    handleHovered: string;
    guide: string;
}

export interface DimensionOverlay {
    label: string;
    anchor: Point2D;
    tangent: Point2D;
    normal: Point2D;
}

export const DEFAULT_VISUAL_THEME: InteractionVisualTheme = {
    normal: '#64748b',
    hovered: '#0ea5e9',
    selected: '#2563eb',
    preview: '#f59e0b',
    handle: '#f97316',
    handleHovered: '#ea580c',
    guide: '#22c55e',
};

// =============================================================================
// Snapping
// =============================================================================

export type SnapKind =
    | 'none'
    | 'grid'
    | 'vertex'
    | 'wall-endpoint'
    | 'wall-midpoint'
    | 'wall-segment'
    | 'angle'
    | 'parallel'
    | 'perpendicular';

export interface SnapTarget {
    kind: SnapKind;
    point: Point2D;
    entityId?: string;
    distance: number;
    priority: number;
}

export interface AlignmentGuide {
    kind: 'horizontal' | 'vertical' | 'angle' | 'parallel' | 'perpendicular';
    from: Point2D;
    to: Point2D;
    label?: string;
}

export interface SmartSnapConfig {
    enabled: boolean;
    threshold: number;
    grid: {
        enabled: boolean;
        spacing: number;
    };
    vertices: boolean;
    wallPoints: boolean;
    wallSegments: boolean;
    angle: {
        enabled: boolean;
        incrementsDeg: number[];
    };
    relationship: {
        parallel: boolean;
        perpendicular: boolean;
    };
}

export interface SnapContext {
    scene: InteractionScene;
    config: SmartSnapConfig;
    inputPoint: Point2D;
    anchorPoint?: Point2D;
    referenceDirection?: Point2D;
    movingWallId?: string;
    modifiers?: KeyboardModifiers;
}

export interface SnapResult {
    point: Point2D;
    target: SnapTarget | null;
    guides: AlignmentGuide[];
}

export const DEFAULT_SNAP_CONFIG: SmartSnapConfig = {
    enabled: true,
    threshold: 10,
    grid: {
        enabled: true,
        spacing: 10,
    },
    vertices: true,
    wallPoints: true,
    wallSegments: true,
    angle: {
        enabled: true,
        incrementsDeg: [0, 30, 45, 60, 90, 120, 135, 150, 180],
    },
    relationship: {
        parallel: true,
        perpendicular: true,
    },
};

// =============================================================================
// Modifiers + Context Menu
// =============================================================================

export interface KeyboardModifiers {
    shift: boolean;
    ctrlOrCmd: boolean;
    alt: boolean;
}

export interface ContextMenuAction {
    id: string;
    label: string;
    enabled: boolean;
}

export interface ContextMenuModel {
    anchor: Point2D;
    actions: ContextMenuAction[];
}

export interface WallPropertyPatch {
    thickness?: number;
    material?: string;
    wallType?: Wall2D['wallType'];
    layer?: string;
}

// =============================================================================
// State Machine
// =============================================================================

export type InteractionMode =
    | 'idle'
    | 'hover'
    | 'box-select'
    | 'lasso-select'
    | 'drag-handle'
    | 'context-menu';

export interface InteractionState {
    mode: InteractionMode;
    selection: SelectionState;
    hover: EntityRef | null;
    dragStart: Point2D | null;
    dragCurrent: Point2D | null;
    lassoPath: Point2D[];
    activeHandleId: string | null;
    modifiers: KeyboardModifiers;
    contextMenu: ContextMenuModel | null;
}

export type InteractionCommand =
    | { type: 'selection-changed'; selection: SelectionState }
    | { type: 'hover-changed'; hover: EntityRef | null }
    | { type: 'preview-box'; start: Point2D; current: Point2D; mode: SelectionBoxMode }
    | { type: 'preview-lasso'; points: Point2D[] }
    | { type: 'preview-handle-drag'; handleId: string; point: Point2D }
    | { type: 'open-context-menu'; model: ContextMenuModel }
    | { type: 'clear-previews' };

export type InteractionEvent =
    | {
          type: 'pointer-down';
          point: Point2D;
          button: number;
          modifiers: KeyboardModifiers;
          hitHandleId?: string | null;
          lassoRequested?: boolean;
      }
    | {
          type: 'pointer-move';
          point: Point2D;
          modifiers: KeyboardModifiers;
      }
    | {
          type: 'pointer-up';
          point: Point2D;
          modifiers: KeyboardModifiers;
      }
    | {
          type: 'context-menu';
          point: Point2D;
      }
    | {
          type: 'cancel';
      };

export interface StateMachineOptions {
    clickHitRadius?: number;
    dragThreshold?: number;
    selectionPropagation?: SelectionPropagationOptions;
}

const DEFAULT_PROPAGATION: Required<SelectionPropagationOptions> = {
    vertexToWalls: true,
    wallToVertices: true,
    wallToRooms: true,
    roomToWalls: true,
    roomToVertices: true,
};

// =============================================================================
// Render Scheduler
// =============================================================================

export interface RenderDirtyFlags {
    selection?: boolean;
    hover?: boolean;
    overlays?: boolean;
    guides?: boolean;
    handles?: boolean;
}

export class InteractionRenderScheduler {
    private dirty: Required<RenderDirtyFlags> = {
        selection: false,
        hover: false,
        overlays: false,
        guides: false,
        handles: false,
    };
    private frameId: number | null = null;

    constructor(private readonly onFlush: (flags: Required<RenderDirtyFlags>) => void) {}

    invalidate(flags: RenderDirtyFlags): void {
        this.dirty = {
            selection: this.dirty.selection || Boolean(flags.selection),
            hover: this.dirty.hover || Boolean(flags.hover),
            overlays: this.dirty.overlays || Boolean(flags.overlays),
            guides: this.dirty.guides || Boolean(flags.guides),
            handles: this.dirty.handles || Boolean(flags.handles),
        };
        if (this.frameId != null || typeof window === 'undefined') return;
        this.frameId = window.requestAnimationFrame(() => {
            this.frameId = null;
            const payload = this.dirty;
            this.dirty = {
                selection: false,
                hover: false,
                overlays: false,
                guides: false,
                handles: false,
            };
            this.onFlush(payload);
        });
    }

    dispose(): void {
        if (this.frameId == null || typeof window === 'undefined') return;
        window.cancelAnimationFrame(this.frameId);
        this.frameId = null;
    }
}

// =============================================================================
// Scene Builder
// =============================================================================

export function buildInteractionScene(
    walls: Wall2D[],
    rooms: Room2D[],
    options: SceneBuildOptions = {}
): InteractionScene {
    const endpointMergeTolerance = options.endpointMergeTolerance ?? 0.5;
    const hashCellSize = options.hashCellSize ?? 64;

    const vertices = new Map<string, VertexPrimitive>();
    const wallsMap = new Map<string, WallPrimitive>();
    const roomsMap = new Map<string, RoomPrimitive>();
    const wallToRooms = new Map<string, Set<string>>();

    const createOrFindVertex = (point: Point2D): string => {
        for (const vertex of vertices.values()) {
            if (arePointsClose(vertex.position, point, endpointMergeTolerance)) {
                return vertex.id;
            }
        }
        const id = `v_${vertices.size + 1}`;
        vertices.set(id, { id, position: { ...point }, wallIds: [] });
        return id;
    };

    walls.forEach((wall) => {
        const startVertexId = createOrFindVertex(wall.start);
        const endVertexId = createOrFindVertex(wall.end);
        const wallPrimitive: WallPrimitive = {
            id: wall.id,
            start: { ...wall.start },
            end: { ...wall.end },
            startVertexId,
            endVertexId,
            thickness: wall.thickness,
            bounds: wallBounds(wall),
        };
        wallsMap.set(wall.id, wallPrimitive);
        vertices.get(startVertexId)?.wallIds.push(wall.id);
        vertices.get(endVertexId)?.wallIds.push(wall.id);
    });

    rooms.forEach((room) => {
        const polygonBounds = calculatePolygonBounds(room.vertices);
        const bounds: HashBounds = {
            minX: polygonBounds.left,
            minY: polygonBounds.top,
            maxX: polygonBounds.right,
            maxY: polygonBounds.bottom,
        };
        roomsMap.set(room.id, {
            id: room.id,
            vertices: room.vertices.map((point) => ({ ...point })),
            wallIds: [...room.wallIds],
            bounds,
        });
        room.wallIds.forEach((wallId) => {
            const roomSet = wallToRooms.get(wallId) ?? new Set<string>();
            roomSet.add(room.id);
            wallToRooms.set(wallId, roomSet);
        });
    });

    const vertexHash = new SpatialHash<VertexPrimitive>(hashCellSize);
    vertexHash.rebuild(
        Array.from(vertices.values()).map((vertex) => ({
            id: vertex.id,
            value: vertex,
            ...pointBounds(vertex.position, 1),
        }))
    );

    const wallHash = new SpatialHash<WallPrimitive>(hashCellSize);
    wallHash.rebuild(
        Array.from(wallsMap.values()).map((wall) => ({
            id: wall.id,
            value: wall,
            ...wall.bounds,
        }))
    );

    const roomHash = new SpatialHash<RoomPrimitive>(hashCellSize);
    roomHash.rebuild(
        Array.from(roomsMap.values()).map((room) => ({
            id: room.id,
            value: room,
            ...room.bounds,
        }))
    );

    return {
        vertices,
        walls: wallsMap,
        rooms: roomsMap,
        vertexHash,
        wallHash,
        roomHash,
        wallToRooms,
    };
}

// =============================================================================
// Selection Helpers
// =============================================================================

export function createEmptySelection(): SelectionState {
    return {
        vertices: new Set<string>(),
        walls: new Set<string>(),
        rooms: new Set<string>(),
        primary: null,
    };
}

export function cloneSelection(selection: SelectionState): SelectionState {
    return {
        vertices: new Set<string>(selection.vertices),
        walls: new Set<string>(selection.walls),
        rooms: new Set<string>(selection.rooms),
        primary: selection.primary ? { ...selection.primary } : null,
    };
}

export function resolveSelectionBoxMode(start: Point2D, end: Point2D): SelectionBoxMode {
    return end.x >= start.x ? 'window' : 'crossing';
}

export function hitTestSelection(
    scene: InteractionScene,
    point: Point2D,
    hitRadius = 8
): EntityRef | null {
    const vertexCandidates = scene.vertexHash.queryRadius(point, hitRadius);
    if (vertexCandidates.length > 0) {
        let nearest = vertexCandidates[0].value;
        let nearestDistance = distanceBetween(point, nearest.position);
        vertexCandidates.forEach((candidate) => {
            const currentDistance = distanceBetween(point, candidate.value.position);
            if (currentDistance < nearestDistance) {
                nearest = candidate.value;
                nearestDistance = currentDistance;
            }
        });
        if (nearestDistance <= hitRadius) {
            return { level: 'vertex', id: nearest.id };
        }
    }

    const wallCandidates = scene.wallHash.queryRadius(point, hitRadius);
    if (wallCandidates.length > 0) {
        let nearestWallId: string | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        wallCandidates.forEach((candidate) => {
            const d = distancePointToSegment(point, candidate.value.start, candidate.value.end);
            if (d < nearestDistance) {
                nearestDistance = d;
                nearestWallId = candidate.value.id;
            }
        });
        if (nearestWallId && nearestDistance <= hitRadius) {
            return { level: 'wall', id: nearestWallId };
        }
    }

    const roomCandidates = scene.roomHash.queryRadius(point, 0);
    const containingRooms = roomCandidates
        .map((item) => item.value)
        .filter((room) => isPointInsidePolygon(point, room.vertices));
    if (containingRooms.length > 0) {
        containingRooms.sort((a, b) => polygonArea(a.vertices) - polygonArea(b.vertices));
        return { level: 'room', id: containingRooms[0]?.id ?? '' };
    }

    return null;
}

export function applyClickSelection(
    current: SelectionState,
    target: EntityRef | null,
    options: SelectionOptions = {}
): SelectionState {
    const next = options.append || options.toggle ? cloneSelection(current) : createEmptySelection();
    const clearIfEmpty = options.clearIfEmpty ?? true;

    if (!target) {
        return clearIfEmpty ? createEmptySelection() : next;
    }

    const bucket = getSelectionBucket(next, target.level);
    const has = bucket.has(target.id);
    if (options.toggle && has) {
        bucket.delete(target.id);
        if (next.primary?.id === target.id && next.primary.level === target.level) {
            next.primary = null;
        }
        return next;
    }

    bucket.add(target.id);
    next.primary = { ...target };
    return next;
}

export function applyWindowSelection(
    scene: InteractionScene,
    current: SelectionState,
    start: Point2D,
    end: Point2D,
    mode: SelectionBoxMode,
    options: SelectionOptions = {}
): SelectionState {
    const bounds = normalizedBounds(start, end);
    const next = options.append || options.toggle ? cloneSelection(current) : createEmptySelection();

    const candidateVertices = scene.vertexHash.queryBounds(bounds).map((item) => item.value);
    const candidateWalls = scene.wallHash.queryBounds(bounds).map((item) => item.value);
    const candidateRooms = scene.roomHash.queryBounds(bounds).map((item) => item.value);

    candidateVertices.forEach((vertex) => {
        const selected = pointInBounds(vertex.position, bounds);
        updateSelectionMembership(next.vertices, vertex.id, selected, options.toggle);
    });

    candidateWalls.forEach((wall) => {
        const selected =
            mode === 'window'
                ? pointInBounds(wall.start, bounds) && pointInBounds(wall.end, bounds)
                : segmentIntersectsBounds(wall.start, wall.end, bounds);
        updateSelectionMembership(next.walls, wall.id, selected, options.toggle);
    });

    candidateRooms.forEach((room) => {
        const selected =
            mode === 'window'
                ? room.vertices.every((vertex) => pointInBounds(vertex, bounds))
                : polygonIntersectsBounds(room.vertices, bounds);
        updateSelectionMembership(next.rooms, room.id, selected, options.toggle);
    });

    next.primary = inferPrimary(next);
    return next;
}

export function applyLassoSelection(
    scene: InteractionScene,
    current: SelectionState,
    polygon: Point2D[],
    mode: LassoMode = 'crossing',
    options: SelectionOptions = {}
): SelectionState {
    const next = options.append || options.toggle ? cloneSelection(current) : createEmptySelection();
    if (polygon.length < 3) return next;

    const polygonBounds = calculatePolygonBounds(polygon);
    const bounds: HashBounds = {
        minX: polygonBounds.left,
        minY: polygonBounds.top,
        maxX: polygonBounds.right,
        maxY: polygonBounds.bottom,
    };
    const candidateVertices = scene.vertexHash.queryBounds(bounds).map((item) => item.value);
    const candidateWalls = scene.wallHash.queryBounds(bounds).map((item) => item.value);
    const candidateRooms = scene.roomHash.queryBounds(bounds).map((item) => item.value);

    candidateVertices.forEach((vertex) => {
        const selected = isPointInsidePolygon(vertex.position, polygon);
        updateSelectionMembership(next.vertices, vertex.id, selected, options.toggle);
    });

    candidateWalls.forEach((wall) => {
        const selected =
            mode === 'enclosed'
                ? isPointInsidePolygon(wall.start, polygon) && isPointInsidePolygon(wall.end, polygon)
                : segmentIntersectsPolygon(wall.start, wall.end, polygon) ||
                  isPointInsidePolygon(wall.start, polygon) ||
                  isPointInsidePolygon(wall.end, polygon);
        updateSelectionMembership(next.walls, wall.id, selected, options.toggle);
    });

    candidateRooms.forEach((room) => {
        const selected =
            mode === 'enclosed'
                ? room.vertices.every((vertex) => isPointInsidePolygon(vertex, polygon))
                : polygonIntersectsPolygon(room.vertices, polygon);
        updateSelectionMembership(next.rooms, room.id, selected, options.toggle);
    });

    next.primary = inferPrimary(next);
    return next;
}

export function propagateSelection(
    scene: InteractionScene,
    selection: SelectionState,
    propagation: SelectionPropagationOptions = {}
): SelectionState {
    const options = { ...DEFAULT_PROPAGATION, ...propagation };
    const next = cloneSelection(selection);

    if (options.vertexToWalls) {
        next.vertices.forEach((vertexId) => {
            scene.vertices.get(vertexId)?.wallIds.forEach((wallId) => next.walls.add(wallId));
        });
    }

    if (options.wallToVertices) {
        next.walls.forEach((wallId) => {
            const wall = scene.walls.get(wallId);
            if (!wall) return;
            next.vertices.add(wall.startVertexId);
            next.vertices.add(wall.endVertexId);
        });
    }

    if (options.wallToRooms) {
        next.walls.forEach((wallId) => {
            scene.wallToRooms.get(wallId)?.forEach((roomId) => next.rooms.add(roomId));
        });
    }

    if (options.roomToWalls) {
        next.rooms.forEach((roomId) => {
            scene.rooms.get(roomId)?.wallIds.forEach((wallId) => next.walls.add(wallId));
        });
    }

    if (options.roomToVertices) {
        next.rooms.forEach((roomId) => {
            const room = scene.rooms.get(roomId);
            if (!room) return;
            room.wallIds.forEach((wallId) => {
                const wall = scene.walls.get(wallId);
                if (!wall) return;
                next.vertices.add(wall.startVertexId);
                next.vertices.add(wall.endVertexId);
            });
        });
    }

    if (!next.primary) {
        next.primary = inferPrimary(next);
    }
    return next;
}

// =============================================================================
// Handle Generation
// =============================================================================

export function createWallManipulationHandles(
    scene: InteractionScene,
    wallId: string,
    options: HandleGenerationOptions = {}
): ManipulationHandle[] {
    const wall = scene.walls.get(wallId);
    if (!wall) return [];

    const minLength = options.minimumWallLength ?? 0.001;
    if (distanceBetween(wall.start, wall.end) < minLength) return [];

    const normal = unitNormal(wall.start, wall.end);
    const midpoint = midpoint2(wall.start, wall.end);
    const halfThickness = Math.max(0.5, wall.thickness / 2);
    const angleHandleRadius = options.angleHandleRadius ?? 28;

    const handles: ManipulationHandle[] = [
        {
            id: `${wall.id}:mid`,
            wallId: wall.id,
            type: 'wall-midpoint',
            position: midpoint,
            cursor: 'move',
            metadata: { constraint: 'perpendicular' },
        },
        {
            id: `${wall.id}:start`,
            wallId: wall.id,
            type: 'wall-start',
            position: wall.start,
            cursor: 'crosshair',
            metadata: { role: 'endpoint', endpoint: 'start' },
        },
        {
            id: `${wall.id}:end`,
            wallId: wall.id,
            type: 'wall-end',
            position: wall.end,
            cursor: 'crosshair',
            metadata: { role: 'endpoint', endpoint: 'end' },
        },
        {
            id: `${wall.id}:thickness:+`,
            wallId: wall.id,
            type: 'wall-thickness-positive',
            position: {
                x: midpoint.x + normal.x * halfThickness,
                y: midpoint.y + normal.y * halfThickness,
            },
            cursor: 'ew-resize',
            metadata: { role: 'thickness', side: 'positive' },
        },
        {
            id: `${wall.id}:thickness:-`,
            wallId: wall.id,
            type: 'wall-thickness-negative',
            position: {
                x: midpoint.x - normal.x * halfThickness,
                y: midpoint.y - normal.y * halfThickness,
            },
            cursor: 'ew-resize',
            metadata: { role: 'thickness', side: 'negative' },
        },
    ];

    const startAngle = buildCornerAngleHandle(scene, wall, wall.startVertexId, angleHandleRadius);
    const endAngle = buildCornerAngleHandle(scene, wall, wall.endVertexId, angleHandleRadius);
    if (startAngle) handles.push(startAngle);
    if (endAngle) handles.push(endAngle);

    return handles;
}

function buildCornerAngleHandle(
    scene: InteractionScene,
    wall: WallPrimitive,
    cornerVertexId: string,
    radius: number
): ManipulationHandle | null {
    const cornerVertex = scene.vertices.get(cornerVertexId);
    if (!cornerVertex) return null;
    const neighborWallId = cornerVertex.wallIds.find((id) => id !== wall.id);
    if (!neighborWallId) return null;
    const neighborWall = scene.walls.get(neighborWallId);
    if (!neighborWall) return null;

    const wallOtherPoint =
        wall.startVertexId === cornerVertexId
            ? wall.end
            : wall.start;
    const neighborOtherPoint =
        neighborWall.startVertexId === cornerVertexId
            ? neighborWall.end
            : neighborWall.start;

    const v1 = unit(vectorBetween(cornerVertex.position, wallOtherPoint));
    const v2 = unit(vectorBetween(cornerVertex.position, neighborOtherPoint));
    const bisector = unit({ x: v1.x + v2.x, y: v1.y + v2.y });
    const effectiveBisector = vectorLength(bisector) < 1e-6 ? v1 : bisector;
    const angleDeg = angleBetweenVectors(v1, v2);

    return {
        id: `${wall.id}:${cornerVertexId}:angle`,
        wallId: wall.id,
        type: 'corner-angle',
        position: {
            x: cornerVertex.position.x + effectiveBisector.x * radius,
            y: cornerVertex.position.y + effectiveBisector.y * radius,
        },
        cursor: 'grab',
        metadata: {
            cornerVertexId,
            neighborWallId,
            angleDeg,
        },
    };
}

export function buildDragDimensionOverlay(
    from: Point2D,
    to: Point2D,
    unitLabel = 'mm'
): DimensionOverlay {
    const tangent = unit(vectorBetween(from, to));
    const normal = { x: -tangent.y, y: tangent.x };
    const length = distanceBetween(from, to);
    return {
        label: `${length.toFixed(1)} ${unitLabel}`,
        anchor: midpoint2(from, to),
        tangent,
        normal,
    };
}

// =============================================================================
// Smart Snapping
// =============================================================================

export function resolveSmartSnap(context: SnapContext): SnapResult {
    const { inputPoint, config, scene } = context;
    const guides: AlignmentGuide[] = [];

    const effectiveEnabled = config.enabled && !(context.modifiers?.ctrlOrCmd ?? false);
    if (!effectiveEnabled) {
        return {
            point: { ...inputPoint },
            target: null,
            guides,
        };
    }

    const threshold = config.threshold;
    const candidates: SnapTarget[] = [];

    if (config.grid.enabled && config.grid.spacing > 0) {
        const gridX = Math.round(inputPoint.x / config.grid.spacing) * config.grid.spacing;
        const gridY = Math.round(inputPoint.y / config.grid.spacing) * config.grid.spacing;
        const gridPoint = { x: gridX, y: gridY };
        const gridDistance = distanceBetween(inputPoint, gridPoint);
        if (gridDistance <= threshold) {
            candidates.push({
                kind: 'grid',
                point: gridPoint,
                distance: gridDistance,
                priority: 10,
            });

            guides.push({
                kind: 'vertical',
                from: { x: gridX, y: inputPoint.y - 1000 },
                to: { x: gridX, y: inputPoint.y + 1000 },
            });
            guides.push({
                kind: 'horizontal',
                from: { x: inputPoint.x - 1000, y: gridY },
                to: { x: inputPoint.x + 1000, y: gridY },
            });
        }
    }

    if (config.vertices) {
        const nearbyVertices = scene.vertexHash.queryRadius(inputPoint, threshold);
        nearbyVertices.forEach((item) => {
            const d = distanceBetween(inputPoint, item.value.position);
            if (d > threshold) return;
            candidates.push({
                kind: 'vertex',
                point: { ...item.value.position },
                entityId: item.value.id,
                distance: d,
                priority: 100,
            });
        });
    }

    if (config.wallPoints || config.wallSegments) {
        const nearbyWalls = scene.wallHash.queryRadius(inputPoint, threshold);
        nearbyWalls.forEach((item) => {
            const wall = item.value;
            if (config.wallPoints) {
                const midpoint = midpoint2(wall.start, wall.end);
                const points: Array<{ point: Point2D; kind: SnapKind; priority: number }> = [
                    { point: wall.start, kind: 'wall-endpoint', priority: 80 },
                    { point: wall.end, kind: 'wall-endpoint', priority: 80 },
                    { point: midpoint, kind: 'wall-midpoint', priority: 70 },
                ];
                points.forEach((candidate) => {
                    const d = distanceBetween(inputPoint, candidate.point);
                    if (d > threshold) return;
                    candidates.push({
                        kind: candidate.kind,
                        point: { ...candidate.point },
                        entityId: wall.id,
                        distance: d,
                        priority: candidate.priority,
                    });
                });
            }

            if (config.wallSegments) {
                const projection = projectPointToSegment(inputPoint, wall.start, wall.end);
                if (projection.distance <= threshold) {
                    candidates.push({
                        kind: 'wall-segment',
                        point: projection.projection,
                        entityId: wall.id,
                        distance: projection.distance,
                        priority: 50,
                    });
                }
            }
        });
    }

    if (context.anchorPoint && config.angle.enabled) {
        const length = distanceBetween(context.anchorPoint, inputPoint);
        if (length > 1e-6) {
            const rawAngle = Math.atan2(
                inputPoint.y - context.anchorPoint.y,
                inputPoint.x - context.anchorPoint.x
            );
            const snapAngles = config.angle.incrementsDeg;
            let bestAngle = rawAngle;
            let bestDiff = Number.POSITIVE_INFINITY;
            snapAngles.forEach((angleDeg) => {
                const angleRad = (angleDeg * Math.PI) / 180;
                const diff = Math.abs(normalizeAngleRad(rawAngle - angleRad));
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestAngle = angleRad;
                }
            });
            const snappedAnglePoint = {
                x: context.anchorPoint.x + Math.cos(bestAngle) * length,
                y: context.anchorPoint.y + Math.sin(bestAngle) * length,
            };
            const snapDistance = distanceBetween(inputPoint, snappedAnglePoint);
            if (snapDistance <= threshold) {
                candidates.push({
                    kind: 'angle',
                    point: snappedAnglePoint,
                    distance: snapDistance,
                    priority: 60,
                });
                guides.push({
                    kind: 'angle',
                    from: { ...context.anchorPoint },
                    to: snappedAnglePoint,
                    label: `${((bestAngle * 180) / Math.PI).toFixed(0)} deg`,
                });
            }
        }
    }

    if (
        context.anchorPoint &&
        context.referenceDirection &&
        (config.relationship.parallel || config.relationship.perpendicular)
    ) {
        const anchor = context.anchorPoint;
        const nearbyWalls = scene.wallHash.queryRadius(inputPoint, threshold * 2);
        const dragLength = distanceBetween(anchor, inputPoint);
        nearbyWalls.forEach((item) => {
            if (item.value.id === context.movingWallId) return;
            const wallDirection = unit(vectorBetween(item.value.start, item.value.end));
            if (vectorLength(wallDirection) < 1e-6 || dragLength < 1e-6) return;

            const wallAngle = Math.atan2(wallDirection.y, wallDirection.x);
            if (config.relationship.parallel) {
                const parallelPoint = {
                    x: anchor.x + Math.cos(wallAngle) * dragLength,
                    y: anchor.y + Math.sin(wallAngle) * dragLength,
                };
                const d = distanceBetween(inputPoint, parallelPoint);
                if (d <= threshold) {
                    candidates.push({
                        kind: 'parallel',
                        point: parallelPoint,
                        entityId: item.value.id,
                        distance: d,
                        priority: 55,
                    });
                    guides.push({
                        kind: 'parallel',
                        from: { ...anchor },
                        to: parallelPoint,
                        label: 'parallel',
                    });
                }
            }

            if (config.relationship.perpendicular) {
                const perpAngle = wallAngle + Math.PI / 2;
                const perpendicularPoint = {
                    x: anchor.x + Math.cos(perpAngle) * dragLength,
                    y: anchor.y + Math.sin(perpAngle) * dragLength,
                };
                const d = distanceBetween(inputPoint, perpendicularPoint);
                if (d <= threshold) {
                    candidates.push({
                        kind: 'perpendicular',
                        point: perpendicularPoint,
                        entityId: item.value.id,
                        distance: d,
                        priority: 58,
                    });
                    guides.push({
                        kind: 'perpendicular',
                        from: { ...anchor },
                        to: perpendicularPoint,
                        label: 'perpendicular',
                    });
                }
            }
        });
    }

    if (candidates.length === 0) {
        return {
            point: { ...inputPoint },
            target: null,
            guides: [],
        };
    }

    candidates.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.distance - b.distance;
    });
    const best = candidates[0] ?? null;

    return {
        point: best ? { ...best.point } : { ...inputPoint },
        target: best,
        guides,
    };
}

export function constrainPointWithShift(anchor: Point2D, input: Point2D): Point2D {
    const dx = input.x - anchor.x;
    const dy = input.y - anchor.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
        return { x: input.x, y: anchor.y };
    }
    return { x: anchor.x, y: input.y };
}

// =============================================================================
// Context Menu + Properties
// =============================================================================

export function buildContextMenuModel(
    _scene: InteractionScene,
    selection: SelectionState,
    anchor: Point2D
): ContextMenuModel {
    const hasWalls = selection.walls.size > 0;
    const hasRooms = selection.rooms.size > 0;
    const hasVertices = selection.vertices.size > 0;

    const actions: ContextMenuAction[] = [
        { id: 'delete', label: 'Delete', enabled: hasWalls || hasRooms || hasVertices },
        { id: 'duplicate', label: 'Duplicate', enabled: hasWalls || hasRooms },
        { id: 'split-wall', label: 'Split wall', enabled: selection.walls.size === 1 },
        { id: 'make-perpendicular', label: 'Toggle perpendicular', enabled: selection.walls.size === 2 },
        { id: 'make-parallel', label: 'Toggle parallel', enabled: selection.walls.size === 2 },
        { id: 'wall-type', label: 'Wall type', enabled: hasWalls },
        { id: 'wall-thickness', label: 'Wall thickness', enabled: hasWalls },
        { id: 'assign-layer', label: 'Assign layer', enabled: hasWalls || hasRooms },
    ];

    const filtered = actions.filter((action) => action.enabled || action.id === 'delete');

    return {
        anchor,
        actions: filtered,
    };
}

export function applyWallPropertyPatch(wall: Wall2D, patch: WallPropertyPatch): Wall2D {
    return {
        ...wall,
        thickness: patch.thickness ?? wall.thickness,
        material: patch.material ?? wall.material,
        wallType: patch.wallType ?? wall.wallType,
        layer: patch.layer ?? wall.layer,
    };
}

// =============================================================================
// State Machine
// =============================================================================

export function createInitialInteractionState(): InteractionState {
    return {
        mode: 'idle',
        selection: createEmptySelection(),
        hover: null,
        dragStart: null,
        dragCurrent: null,
        lassoPath: [],
        activeHandleId: null,
        modifiers: { shift: false, ctrlOrCmd: false, alt: false },
        contextMenu: null,
    };
}

export function reduceInteractionState(
    scene: InteractionScene,
    current: InteractionState,
    event: InteractionEvent,
    options: StateMachineOptions = {}
): { state: InteractionState; commands: InteractionCommand[] } {
    const dragThreshold = options.dragThreshold ?? 4;
    const hitRadius = options.clickHitRadius ?? 8;
    const propagationOptions = options.selectionPropagation ?? DEFAULT_PROPAGATION;
    const commands: InteractionCommand[] = [];
    let next = { ...current, selection: cloneSelection(current.selection) };

    if (event.type === 'cancel') {
        next = {
            ...next,
            mode: 'idle',
            dragStart: null,
            dragCurrent: null,
            lassoPath: [],
            activeHandleId: null,
            contextMenu: null,
        };
        commands.push({ type: 'clear-previews' });
        return { state: next, commands };
    }

    if (event.type === 'context-menu') {
        const menu = buildContextMenuModel(scene, current.selection, event.point);
        next = {
            ...next,
            mode: 'context-menu',
            contextMenu: menu,
        };
        commands.push({ type: 'open-context-menu', model: menu });
        return { state: next, commands };
    }

    if (event.type === 'pointer-down') {
        next.modifiers = event.modifiers;
        if (event.button === 2) {
            const menu = buildContextMenuModel(scene, current.selection, event.point);
            next = {
                ...next,
                mode: 'context-menu',
                contextMenu: menu,
            };
            commands.push({ type: 'open-context-menu', model: menu });
            return { state: next, commands };
        }

        if (event.hitHandleId) {
            next = {
                ...next,
                mode: 'drag-handle',
                activeHandleId: event.hitHandleId,
                dragStart: event.point,
                dragCurrent: event.point,
                contextMenu: null,
            };
            return { state: next, commands };
        }

        next = {
            ...next,
            mode: event.lassoRequested ? 'lasso-select' : 'idle',
            dragStart: event.point,
            dragCurrent: event.point,
            lassoPath: event.lassoRequested ? [event.point] : [],
            contextMenu: null,
        };
        return { state: next, commands };
    }

    if (event.type === 'pointer-move') {
        next.modifiers = event.modifiers;

        if (current.mode === 'drag-handle' && current.activeHandleId) {
            next.dragCurrent = event.point;
            commands.push({
                type: 'preview-handle-drag',
                handleId: current.activeHandleId,
                point: event.point,
            });
            return { state: next, commands };
        }

        if (current.mode === 'lasso-select' && current.dragStart) {
            next.dragCurrent = event.point;
            next.lassoPath = [...current.lassoPath, event.point];
            commands.push({ type: 'preview-lasso', points: next.lassoPath });
            return { state: next, commands };
        }

        if (current.dragStart && current.dragCurrent) {
            const dragged = distanceBetween(current.dragStart, event.point);
            if (dragged > dragThreshold) {
                next.mode = 'box-select';
                next.dragCurrent = event.point;
                const mode = resolveSelectionBoxMode(current.dragStart, event.point);
                commands.push({
                    type: 'preview-box',
                    start: current.dragStart,
                    current: event.point,
                    mode,
                });
                return { state: next, commands };
            }
        }

        const hoverTarget = hitTestSelection(scene, event.point, hitRadius);
        if (
            hoverTarget?.id !== current.hover?.id ||
            hoverTarget?.level !== current.hover?.level
        ) {
            next.mode = hoverTarget ? 'hover' : 'idle';
            next.hover = hoverTarget;
            commands.push({ type: 'hover-changed', hover: hoverTarget });
        }
        return { state: next, commands };
    }

    if (event.type === 'pointer-up') {
        next.modifiers = event.modifiers;

        if (current.mode === 'drag-handle') {
            next = {
                ...next,
                mode: 'idle',
                activeHandleId: null,
                dragStart: null,
                dragCurrent: null,
            };
            commands.push({ type: 'clear-previews' });
            return { state: next, commands };
        }

        if (current.mode === 'box-select' && current.dragStart && current.dragCurrent) {
            const mode = resolveSelectionBoxMode(current.dragStart, current.dragCurrent);
            const selected = applyWindowSelection(
                scene,
                current.selection,
                current.dragStart,
                current.dragCurrent,
                mode,
                {
                    toggle: event.modifiers.ctrlOrCmd,
                    append: event.modifiers.ctrlOrCmd,
                    clearIfEmpty: true,
                }
            );
            const propagated = propagateSelection(scene, selected, propagationOptions);
            next = {
                ...next,
                mode: 'idle',
                selection: propagated,
                dragStart: null,
                dragCurrent: null,
            };
            commands.push({ type: 'selection-changed', selection: propagated });
            commands.push({ type: 'clear-previews' });
            return { state: next, commands };
        }

        if (current.mode === 'lasso-select' && current.lassoPath.length >= 3) {
            const selected = applyLassoSelection(
                scene,
                current.selection,
                current.lassoPath,
                'crossing',
                {
                    toggle: event.modifiers.ctrlOrCmd,
                    append: event.modifiers.ctrlOrCmd,
                    clearIfEmpty: true,
                }
            );
            const propagated = propagateSelection(scene, selected, propagationOptions);
            next = {
                ...next,
                mode: 'idle',
                selection: propagated,
                dragStart: null,
                dragCurrent: null,
                lassoPath: [],
            };
            commands.push({ type: 'selection-changed', selection: propagated });
            commands.push({ type: 'clear-previews' });
            return { state: next, commands };
        }

        if (current.dragStart) {
            const hitTarget = hitTestSelection(scene, event.point, hitRadius);
            const selected = applyClickSelection(current.selection, hitTarget, {
                toggle: event.modifiers.ctrlOrCmd,
                append: event.modifiers.ctrlOrCmd,
                clearIfEmpty: true,
            });
            const propagated = propagateSelection(scene, selected, propagationOptions);
            next = {
                ...next,
                mode: 'idle',
                selection: propagated,
                hover: hitTarget,
                dragStart: null,
                dragCurrent: null,
                lassoPath: [],
            };
            commands.push({ type: 'selection-changed', selection: propagated });
            commands.push({ type: 'hover-changed', hover: hitTarget });
            return { state: next, commands };
        }
    }

    return { state: next, commands };
}

// =============================================================================
// Controller + Event Delegation
// =============================================================================

export interface CadInteractionControllerOptions extends StateMachineOptions {
    scene: InteractionScene;
    onCommands?: (commands: InteractionCommand[], state: InteractionState) => void;
}

export class CadInteractionController {
    private scene: InteractionScene;
    private state: InteractionState;
    private readonly options: StateMachineOptions;
    private readonly onCommands?: (commands: InteractionCommand[], state: InteractionState) => void;

    constructor(options: CadInteractionControllerOptions) {
        this.scene = options.scene;
        this.state = createInitialInteractionState();
        this.options = options;
        this.onCommands = options.onCommands;
    }

    setScene(scene: InteractionScene): void {
        this.scene = scene;
    }

    getState(): InteractionState {
        return this.state;
    }

    setSelection(selection: SelectionState): void {
        this.state = {
            ...this.state,
            selection: cloneSelection(selection),
        };
    }

    dispatch(event: InteractionEvent): InteractionState {
        const transition = reduceInteractionState(this.scene, this.state, event, this.options);
        this.state = transition.state;
        this.onCommands?.(transition.commands, this.state);
        return this.state;
    }
}

export interface DelegatedEventAdapterOptions {
    element: HTMLElement;
    controller: CadInteractionController;
    scenePointFromEvent: (event: MouseEvent) => Point2D;
    hitHandleIdAtPoint?: (point: Point2D) => string | null;
    shouldUseLasso?: (event: MouseEvent) => boolean;
}

export function createDelegatedEventAdapter(options: DelegatedEventAdapterOptions): {
    attach: () => void;
    detach: () => void;
} {
    const { element, controller, scenePointFromEvent, hitHandleIdAtPoint, shouldUseLasso } = options;

    const toModifiers = (event: MouseEvent): KeyboardModifiers => ({
        shift: event.shiftKey,
        ctrlOrCmd: event.ctrlKey || event.metaKey,
        alt: event.altKey,
    });

    const onPointerDown = (event: MouseEvent) => {
        const point = scenePointFromEvent(event);
        const hitHandleId = hitHandleIdAtPoint?.(point) ?? null;
        controller.dispatch({
            type: 'pointer-down',
            point,
            button: event.button,
            modifiers: toModifiers(event),
            hitHandleId,
            lassoRequested: shouldUseLasso?.(event) ?? false,
        });
    };

    const onPointerMove = (event: MouseEvent) => {
        const point = scenePointFromEvent(event);
        controller.dispatch({
            type: 'pointer-move',
            point,
            modifiers: toModifiers(event),
        });
    };

    const onPointerUp = (event: MouseEvent) => {
        const point = scenePointFromEvent(event);
        controller.dispatch({
            type: 'pointer-up',
            point,
            modifiers: toModifiers(event),
        });
    };

    const onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        const point = scenePointFromEvent(event);
        controller.dispatch({
            type: 'context-menu',
            point,
        });
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            controller.dispatch({ type: 'cancel' });
        }
    };

    const attach = () => {
        element.addEventListener('mousedown', onPointerDown);
        element.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);
        element.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('keydown', onKeyDown);
    };

    const detach = () => {
        element.removeEventListener('mousedown', onPointerDown);
        element.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        element.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('keydown', onKeyDown);
    };

    return { attach, detach };
}

// =============================================================================
// Utility Math + Geometry
// =============================================================================

function getSelectionBucket(selection: SelectionState, level: SelectionLevel): Set<string> {
    if (level === 'vertex') return selection.vertices;
    if (level === 'wall') return selection.walls;
    return selection.rooms;
}

function inferPrimary(selection: SelectionState): EntityRef | null {
    const firstVertex = selection.vertices.values().next().value;
    if (firstVertex) return { level: 'vertex', id: firstVertex };
    const firstWall = selection.walls.values().next().value;
    if (firstWall) return { level: 'wall', id: firstWall };
    const firstRoom = selection.rooms.values().next().value;
    if (firstRoom) return { level: 'room', id: firstRoom };
    return null;
}

function updateSelectionMembership(
    set: Set<string>,
    id: string,
    shouldInclude: boolean,
    toggle = false
): void {
    if (!shouldInclude) return;
    if (toggle && set.has(id)) {
        set.delete(id);
        return;
    }
    set.add(id);
}

function wallBounds(wall: Pick<Wall2D, 'start' | 'end' | 'thickness'>): HashBounds {
    const half = Math.max(1, wall.thickness / 2);
    return {
        minX: Math.min(wall.start.x, wall.end.x) - half,
        minY: Math.min(wall.start.y, wall.end.y) - half,
        maxX: Math.max(wall.start.x, wall.end.x) + half,
        maxY: Math.max(wall.start.y, wall.end.y) + half,
    };
}

function normalizedBounds(a: Point2D, b: Point2D): HashBounds {
    return {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
    };
}

function pointInBounds(point: Point2D, bounds: HashBounds): boolean {
    return (
        point.x >= bounds.minX &&
        point.x <= bounds.maxX &&
        point.y >= bounds.minY &&
        point.y <= bounds.maxY
    );
}

function segmentIntersectsBounds(start: Point2D, end: Point2D, bounds: HashBounds): boolean {
    if (pointInBounds(start, bounds) || pointInBounds(end, bounds)) return true;

    const tl = { x: bounds.minX, y: bounds.minY };
    const tr = { x: bounds.maxX, y: bounds.minY };
    const br = { x: bounds.maxX, y: bounds.maxY };
    const bl = { x: bounds.minX, y: bounds.maxY };

    return (
        segmentIntersectsSegment(start, end, tl, tr) ||
        segmentIntersectsSegment(start, end, tr, br) ||
        segmentIntersectsSegment(start, end, br, bl) ||
        segmentIntersectsSegment(start, end, bl, tl)
    );
}

function polygonIntersectsBounds(polygon: Point2D[], bounds: HashBounds): boolean {
    if (polygon.some((point) => pointInBounds(point, bounds))) return true;
    const tl = { x: bounds.minX, y: bounds.minY };
    const tr = { x: bounds.maxX, y: bounds.minY };
    const br = { x: bounds.maxX, y: bounds.maxY };
    const bl = { x: bounds.minX, y: bounds.maxY };
    if ([tl, tr, br, bl].some((corner) => isPointInsidePolygon(corner, polygon))) return true;

    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (!a || !b) continue;
        if (segmentIntersectsBounds(a, b, bounds)) return true;
    }
    return false;
}

function segmentIntersectsPolygon(start: Point2D, end: Point2D, polygon: Point2D[]): boolean {
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (!a || !b) continue;
        if (segmentIntersectsSegment(start, end, a, b)) return true;
    }
    return false;
}

function polygonIntersectsPolygon(a: Point2D[], b: Point2D[]): boolean {
    if (a.some((point) => isPointInsidePolygon(point, b))) return true;
    if (b.some((point) => isPointInsidePolygon(point, a))) return true;
    for (let i = 0; i < a.length; i++) {
        const a1 = a[i];
        const a2 = a[(i + 1) % a.length];
        if (!a1 || !a2) continue;
        for (let j = 0; j < b.length; j++) {
            const b1 = b[j];
            const b2 = b[(j + 1) % b.length];
            if (!b1 || !b2) continue;
            if (segmentIntersectsSegment(a1, a2, b1, b2)) return true;
        }
    }
    return false;
}

function segmentIntersectsSegment(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
    const orientation = (a: Point2D, b: Point2D, c: Point2D): number =>
        (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);

    const onSegment = (a: Point2D, b: Point2D, c: Point2D): boolean =>
        b.x <= Math.max(a.x, c.x) &&
        b.x >= Math.min(a.x, c.x) &&
        b.y <= Math.max(a.y, c.y) &&
        b.y >= Math.min(a.y, c.y);

    const o1 = orientation(p1, p2, p3);
    const o2 = orientation(p1, p2, p4);
    const o3 = orientation(p3, p4, p1);
    const o4 = orientation(p3, p4, p2);

    if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    if (Math.abs(o1) < 1e-8 && onSegment(p1, p3, p2)) return true;
    if (Math.abs(o2) < 1e-8 && onSegment(p1, p4, p2)) return true;
    if (Math.abs(o3) < 1e-8 && onSegment(p3, p1, p4)) return true;
    if (Math.abs(o4) < 1e-8 && onSegment(p3, p2, p4)) return true;

    return false;
}

function vectorBetween(a: Point2D, b: Point2D): Point2D {
    return { x: b.x - a.x, y: b.y - a.y };
}

function vectorLength(v: Point2D): number {
    return Math.hypot(v.x, v.y);
}

function unit(v: Point2D): Point2D {
    const len = vectorLength(v);
    if (len < 1e-8) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
}

function midpoint2(a: Point2D, b: Point2D): Point2D {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function unitNormal(start: Point2D, end: Point2D): Point2D {
    const d = unit(vectorBetween(start, end));
    return { x: -d.y, y: d.x };
}

function angleBetweenVectors(a: Point2D, b: Point2D): number {
    const ua = unit(a);
    const ub = unit(b);
    const cosine = clamp(ua.x * ub.x + ua.y * ub.y, -1, 1);
    return (Math.acos(cosine) * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function normalizeAngleRad(angle: number): number {
    let result = angle;
    while (result > Math.PI) result -= Math.PI * 2;
    while (result < -Math.PI) result += Math.PI * 2;
    return result;
}

function polygonArea(vertices: Point2D[]): number {
    if (vertices.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        if (!a || !b) continue;
        area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area / 2);
}

// =============================================================================
// Modifier Utilities
// =============================================================================

export function normalizeModifiersFromMouseEvent(event: MouseEvent): KeyboardModifiers {
    return {
        shift: event.shiftKey,
        ctrlOrCmd: event.ctrlKey || event.metaKey,
        alt: event.altKey,
    };
}
