import type { Point2D, Room2D, Wall2D } from '../types';
import {
    distance,
    distancePointToSegment,
    generateId,
    isPointInPolygon,
    lineIntersection,
    midpoint,
    rotatePoint,
    segmentsIntersect,
} from './geometry';
import { detectRoomsFromWallGraph } from './room-detection';
import { applyWallOrientationMetadata } from './wall-orientation';
import { PackedRTree, boundsIntersect, type RTreeBounds } from './rtree';

export type WallEndpoint = 'start' | 'end';
export type RotationPivot = 'start' | 'end' | 'center';
export type ThicknessAnchorMode = 'centerline' | 'interior-fixed' | 'exterior-fixed';
export type CollisionPolicy = 'reject' | 'allow';
export type SelectionMergeMode = 'replace' | 'add' | 'remove';
export type SelectionHitMode = 'intersects' | 'contains';

export interface DirtyFlags {
    geometry: boolean;
    topology: boolean;
    rooms: boolean;
    spatialIndex: boolean;
    selection: boolean;
}

export interface WallEditorState {
    walls: Wall2D[];
    rooms: Room2D[];
    selectedWallIds: string[];
    dirty: DirtyFlags;
    revision: number;
}

export interface WallCollision {
    wallAId: string;
    wallBId: string;
    reason: 'intersect' | 'clearance' | 'overlap';
    distance: number;
    point?: Point2D;
}

export interface WallEditOperationResult {
    ok: boolean;
    reason?: string;
    changedWallIds: string[];
    collisions: WallCollision[];
    state: WallEditorState;
}

export interface SelectionVisualInfo {
    wallId: string;
    midpoint: Point2D;
    length: number;
    angleDeg: number;
    thickness: number;
}

export interface WallValidationIssue {
    severity: 'error' | 'warning';
    code: string;
    message: string;
    wallId?: string;
    roomId?: string;
}

export interface CommandLifecycleEvent {
    id: string;
    label: string;
    createdAt: number;
    revision: number;
}

export interface WallEditorEvents {
    'state.changed': WallEditorState;
    'selection.changed': string[];
    'dirty.changed': DirtyFlags;
    'command.executed': CommandLifecycleEvent;
    'command.undone': CommandLifecycleEvent;
    'command.redone': CommandLifecycleEvent;
    'collision.detected': WallCollision[];
}

export interface MutationOptions {
    propagateToAdjacent?: boolean;
    collisionPolicy?: CollisionPolicy;
    minClearance?: number;
    deferRecalculation?: boolean;
}

export interface MoveWallOptions extends MutationOptions {}
export interface ResizeWallOptions extends MutationOptions { anchor?: WallEndpoint; minLength?: number; }
export interface RotateWallOptions extends MutationOptions { pivot?: RotationPivot; stretchConnectedAtMovingEnd?: boolean; }
export interface AdjustThicknessOptions extends MutationOptions { mode?: ThicknessAnchorMode; minThickness?: number; }
export interface RectangleSelectionOptions { mergeMode?: SelectionMergeMode; hitMode?: SelectionHitMode; thicknessPadding?: number; }
export interface PolygonSelectionOptions { mergeMode?: SelectionMergeMode; hitMode?: SelectionHitMode; thicknessPadding?: number; }
export interface GroupTransformOptions extends MutationOptions {
    wallIds?: string[];
    translate?: Point2D;
    rotateDeg?: number;
    scaleX?: number;
    scaleY?: number;
    lockAspectRatio?: boolean;
    pivot?: Point2D;
}
export interface ParallelMoveOptions extends MutationOptions { wallIds?: string[]; angleToleranceDeg?: number; }
export interface ChainSelectionOptions { throughJunctions?: boolean; maxDepth?: number; updateSelection?: boolean; }
export interface ChainTransformOptions extends MutationOptions, ChainSelectionOptions { pivot?: Point2D; }
export interface WallEditorEngineOptions { nodeTolerance?: number; defaultClearance?: number; maxHistory?: number; }
export interface WallEditorEngineInit { walls: Wall2D[]; rooms?: Room2D[]; selectedWallIds?: string[]; options?: WallEditorEngineOptions; }

export interface WallEditCommand {
    readonly id: string;
    readonly label: string;
    readonly createdAt: number;
    execute(current: WallEditorState): WallEditorState;
    undo(current: WallEditorState): WallEditorState;
}

class SnapshotCommand implements WallEditCommand {
    readonly id = generateId();
    readonly createdAt = Date.now();
    constructor(
        public readonly label: string,
        private readonly before: WallEditorState,
        private readonly after: WallEditorState
    ) {}
    execute(_current: WallEditorState): WallEditorState { return clone(this.after); }
    undo(_current: WallEditorState): WallEditorState { return clone(this.before); }
}

class CommandStack {
    private past: WallEditCommand[] = [];
    private future: WallEditCommand[] = [];
    constructor(private readonly maxHistory: number) {}
    get canUndo(): boolean { return this.past.length > 0; }
    get canRedo(): boolean { return this.future.length > 0; }
    execute(command: WallEditCommand, current: WallEditorState): { command: WallEditCommand; state: WallEditorState } {
        const state = command.execute(current);
        this.past.push(command);
        if (this.past.length > this.maxHistory) this.past.splice(0, this.past.length - this.maxHistory);
        this.future = [];
        return { command, state };
    }
    undo(current: WallEditorState): { command: WallEditCommand; state: WallEditorState } | null {
        const command = this.past.pop();
        if (!command) return null;
        const state = command.undo(current);
        this.future.push(command);
        return { command, state };
    }
    redo(current: WallEditorState): { command: WallEditCommand; state: WallEditorState } | null {
        const command = this.future.pop();
        if (!command) return null;
        const state = command.execute(current);
        this.past.push(command);
        return { command, state };
    }
    clear(): void { this.past = []; this.future = []; }
}

class EventBus<Events extends object> {
    private listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();
    on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
        const bucket = this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
        bucket.add(listener as (payload: unknown) => void);
        this.listeners.set(event, bucket);
        return () => {
            const current = this.listeners.get(event);
            if (!current) return;
            current.delete(listener as (payload: unknown) => void);
            if (current.size === 0) this.listeners.delete(event);
        };
    }
    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        const bucket = this.listeners.get(event);
        if (!bucket) return;
        bucket.forEach((listener) => listener(payload as unknown));
    }
}

const EPS = 1e-9;
const DEFAULT_NODE_TOLERANCE = 0.5;
const DEFAULT_CLEARANCE = 0.001;
const DEFAULT_MIN_WALL_LENGTH = 0.01;
const DEFAULT_MIN_THICKNESS = 0.01;
const DEFAULT_PARALLEL_TOLERANCE_DEG = 2;

interface MutationSuccess { ok: true; changedWallIds: string[]; }
interface MutationFailure { ok: false; reason: string; }
type MutationResult = MutationSuccess | MutationFailure;

interface NodeRef { wallId: string; endpoint: WallEndpoint; }
interface NodeRecord { key: string; point: Point2D; refs: NodeRef[]; }

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function dirty(initial = false): DirtyFlags { return { geometry: initial, topology: initial, rooms: initial, spatialIndex: initial, selection: initial }; }
function ok(changedWallIds: string[]): MutationSuccess { return { ok: true, changedWallIds }; }
function fail(reason: string): MutationFailure { return { ok: false, reason }; }
function add(a: Point2D, b: Point2D): Point2D { return { x: a.x + b.x, y: a.y + b.y }; }
function sub(a: Point2D, b: Point2D): Point2D { return { x: a.x - b.x, y: a.y - b.y }; }
function mul(a: Point2D, scalar: number): Point2D { return { x: a.x * scalar, y: a.y * scalar }; }
function mag(a: Point2D): number { return Math.hypot(a.x, a.y); }
function norm(a: Point2D): Point2D { const len = mag(a); return len < EPS ? { x: 0, y: 0 } : mul(a, 1 / len); }
function dot(a: Point2D, b: Point2D): number { return a.x * b.x + a.y * b.y; }
function cross(a: Point2D, b: Point2D): number { return a.x * b.y - a.y * b.x; }
function wallDir(wall: Wall2D): Point2D { return norm(sub(wall.end, wall.start)); }
function wallLen(wall: Wall2D): number { return distance(wall.start, wall.end); }
function leftNormal(direction: Point2D): Point2D { return { x: -direction.y, y: direction.x }; }
function close(a: Point2D, b: Point2D, tolerance: number): boolean { return distance(a, b) <= tolerance; }
function pointKey(point: Point2D, tolerance: number): string {
    const step = Math.max(tolerance, 1e-4);
    return `${Math.round(point.x / step)}:${Math.round(point.y / step)}`;
}
function wallAngleDeg(wall: Wall2D): number {
    const d = wallDir(wall);
    return (Math.atan2(d.y, d.x) * 180) / Math.PI;
}
function wallBounds(wall: Wall2D, extra = 0): RTreeBounds {
    const pad = Math.max(extra, 0) + Math.max((wall.thickness ?? 0) / 2, 0);
    return {
        minX: Math.min(wall.start.x, wall.end.x) - pad,
        minY: Math.min(wall.start.y, wall.end.y) - pad,
        maxX: Math.max(wall.start.x, wall.end.x) + pad,
        maxY: Math.max(wall.start.y, wall.end.y) + pad,
    };
}
function polyBounds(points: Point2D[]): RTreeBounds {
    if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    points.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    return { minX, minY, maxX, maxY };
}
function buildGraph(walls: Wall2D[], tolerance: number): { nodes: Map<string, NodeRecord>; wallKeys: Map<string, { startKey: string; endKey: string }> } {
    const nodes = new Map<string, NodeRecord>();
    const wallKeys = new Map<string, { startKey: string; endKey: string }>();
    const counts = new Map<string, number>();
    const register = (wallId: string, endpoint: WallEndpoint, point: Point2D): string => {
        const key = pointKey(point, tolerance);
        const existing = nodes.get(key);
        if (!existing) {
            nodes.set(key, { key, point: { ...point }, refs: [{ wallId, endpoint }] });
            counts.set(key, 1);
            return key;
        }
        existing.refs.push({ wallId, endpoint });
        const count = (counts.get(key) ?? 1) + 1;
        counts.set(key, count);
        existing.point = { x: (existing.point.x * (count - 1) + point.x) / count, y: (existing.point.y * (count - 1) + point.y) / count };
        return key;
    };
    walls.forEach((wall) => {
        const startKey = register(wall.id, 'start', wall.start);
        const endKey = register(wall.id, 'end', wall.end);
        wallKeys.set(wall.id, { startKey, endKey });
    });
    return { nodes, wallKeys };
}
function rebuildAdjacency(walls: Wall2D[], tolerance: number): Wall2D[] {
    const graph = buildGraph(walls, tolerance);
    const adjacency = new Map<string, Set<string>>();
    walls.forEach((wall) => adjacency.set(wall.id, new Set<string>()));
    graph.nodes.forEach((node) => {
        for (let i = 0; i < node.refs.length; i++) {
            for (let j = i + 1; j < node.refs.length; j++) {
                const a = node.refs[i];
                const b = node.refs[j];
                if (!a || !b) continue;
                adjacency.get(a.wallId)?.add(b.wallId);
                adjacency.get(b.wallId)?.add(a.wallId);
            }
        }
    });
    return applyWallOrientationMetadata(
        walls.map((wall) => ({ ...wall, connectedWallIds: Array.from(adjacency.get(wall.id) ?? []) })),
        { nodeTolerancePx: tolerance, defaultInteriorSideForOpenChains: 'right', probeOffsetPx: 6 }
    );
}
function moveNode(walls: Wall2D[], source: Point2D, target: Point2D, tolerance: number, filter?: Set<string>): { walls: Wall2D[]; changedWallIds: string[] } {
    const changed = new Set<string>();
    const next = walls.map((wall) => {
        if (filter && !filter.has(wall.id)) return wall;
        let hit = false;
        let start = wall.start;
        let end = wall.end;
        if (close(wall.start, source, tolerance)) { start = { ...target }; hit = true; }
        if (close(wall.end, source, tolerance)) { end = { ...target }; hit = true; }
        if (!hit) return wall;
        changed.add(wall.id);
        return { ...wall, start, end };
    });
    return { walls: next, changedWallIds: Array.from(changed) };
}
function transformWallSet(
    walls: Wall2D[],
    wallIds: string[],
    transform: (point: Point2D) => Point2D,
    tolerance: number,
    propagate: boolean
): { walls: Wall2D[]; changedWallIds: string[] } {
    const graph = buildGraph(walls, tolerance);
    const selected = new Set(wallIds);
    const nodeTargets = new Map<string, Point2D>();
    wallIds.forEach((wallId) => {
        const keys = graph.wallKeys.get(wallId);
        if (!keys) return;
        const startNode = graph.nodes.get(keys.startKey);
        const endNode = graph.nodes.get(keys.endKey);
        if (startNode) nodeTargets.set(keys.startKey, transform(startNode.point));
        if (endNode) nodeTargets.set(keys.endKey, transform(endNode.point));
    });
    const changed = new Set<string>();
    const next = walls.map((wall) => {
        const keys = graph.wallKeys.get(wall.id);
        if (!keys) return wall;
        if (!propagate && !selected.has(wall.id)) return wall;
        const start = nodeTargets.get(keys.startKey);
        const end = nodeTargets.get(keys.endKey);
        if (!start && !end) return wall;
        const nextStart = start ? { ...start } : wall.start;
        const nextEnd = end ? { ...end } : wall.end;
        if (close(nextStart, wall.start, tolerance * 0.2) && close(nextEnd, wall.end, tolerance * 0.2)) return wall;
        changed.add(wall.id);
        return { ...wall, start: nextStart, end: nextEnd };
    });
    return { walls: next, changedWallIds: Array.from(changed) };
}
function interiorNormal(wall: Wall2D): Point2D {
    if (wall.interiorNormal && Number.isFinite(wall.interiorNormal.x) && Number.isFinite(wall.interiorNormal.y)) {
        return norm(wall.interiorNormal);
    }
    const base = norm(leftNormal(wallDir(wall)));
    const interiorSide = wall.interiorSideOverride ?? wall.interiorSide ?? 'left';
    return interiorSide === 'right' ? mul(base, -1) : base;
}
function wallIntersectsPolygon(wall: Wall2D, polygon: Point2D[]): boolean {
    if (polygon.length < 3) return false;
    if (isPointInPolygon(wall.start, polygon) || isPointInPolygon(wall.end, polygon)) return true;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (!a || !b) continue;
        if (segmentsIntersect(wall.start, wall.end, a, b)) return true;
    }
    return false;
}
function segDistance(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): number {
    if (segmentsIntersect(a1, a2, b1, b2)) return 0;
    return Math.min(
        distancePointToSegment(a1, b1, b2).distance,
        distancePointToSegment(a2, b1, b2).distance,
        distancePointToSegment(b1, a1, a2).distance,
        distancePointToSegment(b2, a1, a2).distance
    );
}
function shareEndpoint(a: Wall2D, b: Wall2D, tolerance: number): boolean {
    return close(a.start, b.start, tolerance) || close(a.start, b.end, tolerance) || close(a.end, b.start, tolerance) || close(a.end, b.end, tolerance);
}
function colinearOverlap(a: Wall2D, b: Wall2D, tolerance: number): boolean {
    const da = sub(a.end, a.start);
    const db = sub(b.end, b.start);
    const la = mag(da);
    const lb = mag(db);
    if (la <= tolerance || lb <= tolerance) return false;
    if (Math.abs(cross(da, db)) > tolerance * Math.max(la, lb)) return false;
    if (Math.abs(cross(da, sub(b.start, a.start))) > tolerance * la) return false;
    const unit = mul(da, 1 / la);
    const p0 = Math.max(0, Math.min(dot(sub(b.start, a.start), unit), dot(sub(b.end, a.start), unit)));
    const p1 = Math.min(la, Math.max(dot(sub(b.start, a.start), unit), dot(sub(b.end, a.start), unit)));
    return p1 - p0 > tolerance;
}
function detectCollisions(walls: Wall2D[], changedIds: Set<string>, tolerance: number, minClearance: number): WallCollision[] {
    if (walls.length <= 1 || changedIds.size === 0) return [];
    const index = new PackedRTree<Wall2D>((wall) => wallBounds(wall), 16);
    index.rebuild(walls);
    const byId = new Map(walls.map((w) => [w.id, w]));
    const seen = new Set<string>();
    const collisions: WallCollision[] = [];
    changedIds.forEach((id) => {
        const wall = byId.get(id);
        if (!wall) return;
        const candidates = index.search(wallBounds(wall, Math.max(minClearance, 0)));
        candidates.forEach((other) => {
            if (other.id === wall.id) return;
            const key = wall.id < other.id ? `${wall.id}|${other.id}` : `${other.id}|${wall.id}`;
            if (seen.has(key)) return;
            seen.add(key);
            const shared = shareEndpoint(wall, other, tolerance);
            if (colinearOverlap(wall, other, tolerance)) { collisions.push({ wallAId: wall.id, wallBId: other.id, reason: 'overlap', distance: 0 }); return; }
            if (segmentsIntersect(wall.start, wall.end, other.start, other.end)) {
                if (!shared) collisions.push({ wallAId: wall.id, wallBId: other.id, reason: 'intersect', distance: 0, point: lineIntersection(wall.start, wall.end, other.start, other.end) ?? undefined });
                return;
            }
            const gap = segDistance(wall.start, wall.end, other.start, other.end);
            if (!shared && gap < minClearance) collisions.push({ wallAId: wall.id, wallBId: other.id, reason: 'clearance', distance: gap });
        });
    });
    return collisions;
}

export class WallEditorEngine {
    private state: WallEditorState;
    private readonly nodeTolerance: number;
    private readonly defaultClearance: number;
    private readonly commandStack: CommandStack;
    private readonly events = new EventBus<WallEditorEvents>();
    private readonly spatialIndex = new PackedRTree<Wall2D>((wall) => wallBounds(wall), 16);

    constructor(init: WallEditorEngineInit) {
        const options = init.options ?? {};
        this.nodeTolerance = options.nodeTolerance ?? DEFAULT_NODE_TOLERANCE;
        this.defaultClearance = options.defaultClearance ?? DEFAULT_CLEARANCE;
        this.commandStack = new CommandStack(options.maxHistory ?? 200);
        const walls = rebuildAdjacency(clone(init.walls), this.nodeTolerance);
        const rooms = init.rooms ? clone(init.rooms) : detectRoomsFromWallGraph(walls, []);
        const validIds = new Set(walls.map((w) => w.id));
        const selectedWallIds = Array.from(new Set((init.selectedWallIds ?? []).filter((id) => validIds.has(id))));
        this.state = { walls, rooms, selectedWallIds, dirty: dirty(false), revision: 0 };
        this.spatialIndex.rebuild(walls);
    }

    on<K extends keyof WallEditorEvents>(event: K, listener: (payload: WallEditorEvents[K]) => void): () => void { return this.events.on(event, listener); }
    get canUndo(): boolean { return this.commandStack.canUndo; }
    get canRedo(): boolean { return this.commandStack.canRedo; }
    clearHistory(): void { this.commandStack.clear(); }

    getState(flushDirty = true): WallEditorState {
        if (flushDirty) this.ensureDerived(false);
        return clone(this.state);
    }

    flushDerivedState(): WallEditorState {
        this.ensureDerived(true);
        return clone(this.state);
    }

    setSelectedWalls(ids: string[], mode: SelectionMergeMode = 'replace'): string[] {
        this.ensureDerived(false);
        const validIds = new Set(this.state.walls.map((w) => w.id));
        const current = this.state.selectedWallIds.filter((id) => validIds.has(id));
        let next = current;
        if (mode === 'replace') next = Array.from(new Set(ids.filter((id) => validIds.has(id))));
        if (mode === 'add') next = Array.from(new Set([...current, ...ids.filter((id) => validIds.has(id))]));
        if (mode === 'remove') next = current.filter((id) => !ids.includes(id));
        const changed = next.length !== this.state.selectedWallIds.length || next.some((id, idx) => id !== this.state.selectedWallIds[idx]);
        if (!changed) return [...this.state.selectedWallIds];
        const prevDirty = clone(this.state.dirty);
        const prevSelection = [...this.state.selectedWallIds];
        this.state = { ...this.state, selectedWallIds: next, dirty: { ...this.state.dirty, selection: true } };
        this.emitState(prevSelection, prevDirty);
        return [...this.state.selectedWallIds];
    }

    selectWallsByRectangle(bounds: RTreeBounds, options: RectangleSelectionOptions = {}): string[] {
        this.ensureDerived(false);
        const hitMode = options.hitMode ?? 'intersects';
        const pad = options.thicknessPadding ?? 0;
        const ids = this.spatialIndex.search(bounds).filter((wall) => {
            if (hitMode === 'contains') {
                return wall.start.x >= bounds.minX && wall.start.x <= bounds.maxX &&
                    wall.start.y >= bounds.minY && wall.start.y <= bounds.maxY &&
                    wall.end.x >= bounds.minX && wall.end.x <= bounds.maxX &&
                    wall.end.y >= bounds.minY && wall.end.y <= bounds.maxY;
            }
            return boundsIntersect(wallBounds(wall, pad), bounds);
        }).map((w) => w.id);
        return this.setSelectedWalls(ids, options.mergeMode ?? 'replace');
    }

    selectWallsByPolygon(polygon: Point2D[], options: PolygonSelectionOptions = {}): string[] {
        this.ensureDerived(false);
        if (polygon.length < 3) return this.setSelectedWalls([], options.mergeMode ?? 'replace');
        const hitMode = options.hitMode ?? 'intersects';
        const bounds = polyBounds(polygon);
        const ids = this.spatialIndex.search(bounds).filter((wall) => {
            if (hitMode === 'contains') return isPointInPolygon(wall.start, polygon) && isPointInPolygon(wall.end, polygon);
            return wallIntersectsPolygon(wall, polygon);
        }).map((w) => w.id);
        return this.setSelectedWalls(ids, options.mergeMode ?? 'replace');
    }

    getSelectedWalls(): Wall2D[] {
        this.ensureDerived(false);
        const selected = new Set(this.state.selectedWallIds);
        return this.state.walls.filter((w) => selected.has(w.id));
    }

    getSelectionVisualInfo(): SelectionVisualInfo[] {
        return this.getSelectedWalls().map((wall) => ({
            wallId: wall.id,
            midpoint: midpoint(wall.start, wall.end),
            length: wallLen(wall),
            angleDeg: wallAngleDeg(wall),
            thickness: wall.thickness,
        }));
    }
    selectWallChain(seedWallId: string, options: ChainSelectionOptions = {}): string[] {
        this.ensureDerived(false);
        if (!this.state.walls.some((w) => w.id === seedWallId)) return [];
        const graph = buildGraph(this.state.walls, this.nodeTolerance);
        const throughJunctions = options.throughJunctions ?? false;
        const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
        const visited = new Set<string>();
        const queue: Array<{ wallId: string; depth: number }> = [{ wallId: seedWallId, depth: 0 }];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current || visited.has(current.wallId)) continue;
            visited.add(current.wallId);
            if (current.depth >= maxDepth) continue;
            const keys = graph.wallKeys.get(current.wallId);
            if (!keys) continue;
            [keys.startKey, keys.endKey].forEach((key) => {
                const node = graph.nodes.get(key);
                if (!node) return;
                if (!throughJunctions && node.refs.length > 2) return;
                node.refs.forEach((ref) => {
                    if (ref.wallId !== current.wallId && !visited.has(ref.wallId)) queue.push({ wallId: ref.wallId, depth: current.depth + 1 });
                });
            });
        }
        const chain = Array.from(visited);
        if (options.updateSelection ?? true) this.setSelectedWalls(chain, 'replace');
        return chain;
    }

    moveWall(wallId: string, delta: Point2D, options: MoveWallOptions = {}): WallEditOperationResult { return this.moveWalls([wallId], delta, options, 'Move wall'); }

    moveWallPerpendicular(wallId: string, offset: number, options: MoveWallOptions = {}): WallEditOperationResult {
        this.ensureDerived(false);
        const wall = this.state.walls.find((w) => w.id === wallId);
        if (!wall) return this.resultFail(`Wall ${wallId} not found.`);
        const normal = norm(leftNormal(wallDir(wall)));
        if (mag(normal) < EPS) return this.resultFail(`Wall ${wallId} has zero direction.`);
        return this.moveWalls([wallId], mul(normal, offset), options, 'Offset wall perpendicular');
    }

    moveWalls(wallIds: string[], delta: Point2D, options: MoveWallOptions = {}, label = 'Move walls'): WallEditOperationResult {
        return this.transformWalls(wallIds, (point) => add(point, delta), options, label);
    }

    resizeWall(wallId: string, deltaLength: number, options: ResizeWallOptions = {}): WallEditOperationResult {
        const anchor = options.anchor ?? 'start';
        const minLength = options.minLength ?? DEFAULT_MIN_WALL_LENGTH;
        const propagate = options.propagateToAdjacent ?? true;
        return this.applyMutation('Resize wall', (draft) => {
            const wall = draft.walls.find((w) => w.id === wallId);
            if (!wall) return fail(`Wall ${wallId} not found.`);
            const direction = wallDir(wall);
            if (mag(direction) < EPS) return fail(`Wall ${wallId} is zero length.`);
            const movingEnd: WallEndpoint = anchor === 'start' ? 'end' : 'start';
            const source = movingEnd === 'end' ? wall.end : wall.start;
            const target = add(source, mul(direction, deltaLength * (movingEnd === 'end' ? 1 : -1)));
            if (propagate) {
                const moved = moveNode(draft.walls, source, target, this.nodeTolerance);
                draft.walls = moved.walls;
            } else {
                draft.walls = draft.walls.map((w) => w.id !== wallId ? w : movingEnd === 'end' ? { ...w, end: { ...target } } : { ...w, start: { ...target } });
            }
            const updated = draft.walls.find((w) => w.id === wallId);
            if (!updated || wallLen(updated) < minLength - EPS) return fail(`Resize below minimum length ${minLength}.`);
            return ok([wallId]);
        }, options);
    }

    rotateWall(wallId: string, angleDeg: number, options: RotateWallOptions = {}): WallEditOperationResult {
        const pivotMode = options.pivot ?? 'center';
        const propagate = options.propagateToAdjacent ?? true;
        const stretch = options.stretchConnectedAtMovingEnd ?? true;
        return this.applyMutation('Rotate wall', (draft) => {
            const wall = draft.walls.find((w) => w.id === wallId);
            if (!wall) return fail(`Wall ${wallId} not found.`);
            const pivot = pivotMode === 'start' ? wall.start : pivotMode === 'end' ? wall.end : midpoint(wall.start, wall.end);
            const targetStart = pivotMode === 'start' ? wall.start : rotatePoint(wall.start, pivot, angleDeg);
            const targetEnd = pivotMode === 'end' ? wall.end : rotatePoint(wall.end, pivot, angleDeg);
            let nextWalls = draft.walls;
            const changed = new Set<string>();
            const applyNode = (source: Point2D, target: Point2D, propagateNode: boolean): void => {
                if (close(source, target, this.nodeTolerance * 0.2)) return;
                const moved = moveNode(nextWalls, source, target, this.nodeTolerance, propagateNode ? undefined : new Set([wallId]));
                nextWalls = moved.walls;
                moved.changedWallIds.forEach((id) => changed.add(id));
            };
            if (pivotMode === 'center') { applyNode(wall.start, targetStart, propagate); applyNode(wall.end, targetEnd, propagate); }
            if (pivotMode === 'start') applyNode(wall.end, targetEnd, stretch && propagate);
            if (pivotMode === 'end') applyNode(wall.start, targetStart, stretch && propagate);
            if (changed.size === 0) return fail('Rotation produced no change.');
            draft.walls = nextWalls;
            return ok(Array.from(changed));
        }, options);
    }

    adjustWallThickness(wallId: string, nextThickness: number, options: AdjustThicknessOptions = {}): WallEditOperationResult {
        const mode = options.mode ?? 'centerline';
        const minThickness = options.minThickness ?? DEFAULT_MIN_THICKNESS;
        const propagate = options.propagateToAdjacent ?? true;
        if (!Number.isFinite(nextThickness) || nextThickness < minThickness) return this.resultFail(`Thickness ${nextThickness} is invalid.`);
        return this.applyMutation('Adjust wall thickness', (draft) => {
            const wall = draft.walls.find((w) => w.id === wallId);
            if (!wall) return fail(`Wall ${wallId} not found.`);
            let nextWalls = draft.walls;
            const changed = new Set<string>();
            const delta = nextThickness - wall.thickness;
            if (Math.abs(delta) > EPS && mode !== 'centerline') {
                const n = interiorNormal(wall);
                const shift = mul(n, mode === 'interior-fixed' ? -delta / 2 : delta / 2);
                const filter = propagate ? undefined : new Set([wallId]);
                const movedStart = moveNode(nextWalls, wall.start, add(wall.start, shift), this.nodeTolerance, filter);
                nextWalls = movedStart.walls;
                movedStart.changedWallIds.forEach((id) => changed.add(id));
                const movedEnd = moveNode(nextWalls, wall.end, add(wall.end, shift), this.nodeTolerance, filter);
                nextWalls = movedEnd.walls;
                movedEnd.changedWallIds.forEach((id) => changed.add(id));
            }
            draft.walls = nextWalls.map((w) => w.id === wallId ? { ...w, thickness: nextThickness } : w);
            changed.add(wallId);
            return ok(Array.from(changed));
        }, options);
    }

    transformSelectedWalls(options: GroupTransformOptions = {}): WallEditOperationResult {
        this.ensureDerived(false);
        const ids = options.wallIds ?? this.state.selectedWallIds;
        if (ids.length === 0) return this.resultFail('No selected walls for group transform.');
        const walls = this.state.walls.filter((w) => ids.includes(w.id));
        if (walls.length === 0) return this.resultFail('No matching walls found for group transform.');
        const translate = options.translate ?? { x: 0, y: 0 };
        const rotateDeg = options.rotateDeg ?? 0;
        let sx = Number.isFinite(options.scaleX) ? (options.scaleX as number) : 1;
        let sy = Number.isFinite(options.scaleY) ? (options.scaleY as number) : 1;
        if (options.lockAspectRatio) {
            if (Number.isFinite(options.scaleX) && !Number.isFinite(options.scaleY)) sy = sx;
            if (!Number.isFinite(options.scaleX) && Number.isFinite(options.scaleY)) sx = sy;
        }
        const pivot = options.pivot ?? this.pivotOfWalls(walls);
        return this.transformWalls(ids, (point) => {
            const scaled = { x: pivot.x + (point.x - pivot.x) * sx, y: pivot.y + (point.y - pivot.y) * sy };
            const rotated = Math.abs(rotateDeg) > EPS ? rotatePoint(scaled, pivot, rotateDeg) : scaled;
            return add(rotated, translate);
        }, options, 'Group transform walls');
    }

    moveParallelWalls(distanceValue: number, options: ParallelMoveOptions = {}): WallEditOperationResult {
        this.ensureDerived(false);
        const ids = options.wallIds ?? this.state.selectedWallIds;
        const walls = this.state.walls.filter((w) => ids.includes(w.id));
        if (walls.length === 0) return this.resultFail('No walls provided for parallel move.');
        const ref = wallDir(walls[0]);
        if (mag(ref) < EPS) return this.resultFail(`Wall ${walls[0].id} has zero direction.`);
        const tol = options.angleToleranceDeg ?? DEFAULT_PARALLEL_TOLERANCE_DEG;
        for (const wall of walls) {
            const direction = wallDir(wall);
            if (mag(direction) < EPS) return this.resultFail(`Wall ${wall.id} has zero direction.`);
            const cosine = Math.max(-1, Math.min(1, Math.abs(dot(direction, ref))));
            const angle = (Math.acos(cosine) * 180) / Math.PI;
            if (angle > tol) return this.resultFail(`Wall ${wall.id} is not parallel within ${tol} deg.`);
        }
        const delta = mul(norm(leftNormal(ref)), distanceValue);
        return this.moveWalls(ids, delta, options, 'Move parallel walls');
    }

    moveWallChain(seedWallId: string, delta: Point2D, options: ChainTransformOptions = {}): WallEditOperationResult {
        const ids = this.selectWallChain(seedWallId, { ...options, updateSelection: false });
        if (ids.length === 0) return this.resultFail(`No chain found for wall ${seedWallId}.`);
        return this.moveWalls(ids, delta, options, 'Move wall chain');
    }

    rotateWallChain(seedWallId: string, angleDeg: number, options: ChainTransformOptions = {}): WallEditOperationResult {
        const ids = this.selectWallChain(seedWallId, { ...options, updateSelection: false });
        if (ids.length === 0) return this.resultFail(`No chain found for wall ${seedWallId}.`);
        this.ensureDerived(false);
        const pivot = options.pivot ?? this.pivotOfWalls(this.state.walls.filter((w) => ids.includes(w.id)));
        return this.transformWalls(ids, (point) => rotatePoint(point, pivot, angleDeg), options, 'Rotate wall chain');
    }

    execute(command: WallEditCommand): WallEditOperationResult {
        const prevSelection = [...this.state.selectedWallIds];
        const prevDirty = clone(this.state.dirty);
        const result = this.commandStack.execute(command, this.state);
        this.state = clone(result.state);
        this.ensureDerived(false);
        this.events.emit('command.executed', this.cmdEvent(command));
        this.emitState(prevSelection, prevDirty);
        return this.resultOk([], []);
    }

    undo(): WallEditOperationResult {
        const result = this.commandStack.undo(this.state);
        if (!result) return this.resultFail('Nothing to undo.');
        const prevSelection = [...this.state.selectedWallIds];
        const prevDirty = clone(this.state.dirty);
        this.state = clone(result.state);
        this.ensureDerived(false);
        this.events.emit('command.undone', this.cmdEvent(result.command));
        this.emitState(prevSelection, prevDirty);
        return this.resultOk([], []);
    }

    redo(): WallEditOperationResult {
        const result = this.commandStack.redo(this.state);
        if (!result) return this.resultFail('Nothing to redo.');
        const prevSelection = [...this.state.selectedWallIds];
        const prevDirty = clone(this.state.dirty);
        this.state = clone(result.state);
        this.ensureDerived(false);
        this.events.emit('command.redone', this.cmdEvent(result.command));
        this.emitState(prevSelection, prevDirty);
        return this.resultOk([], []);
    }
    validateConsistency(): WallValidationIssue[] {
        this.ensureDerived(false);
        const issues: WallValidationIssue[] = [];
        const wallById = new Map(this.state.walls.map((w) => [w.id, w]));
        this.state.walls.forEach((wall) => {
            if (wallLen(wall) <= DEFAULT_MIN_WALL_LENGTH) {
                issues.push({ severity: 'warning', code: 'WALL_TOO_SHORT', message: `Wall ${wall.id} is too short.`, wallId: wall.id });
            }
            if (!Number.isFinite(wall.thickness) || wall.thickness <= 0) {
                issues.push({ severity: 'error', code: 'WALL_THICKNESS_INVALID', message: `Wall ${wall.id} thickness is invalid.`, wallId: wall.id });
            }
            (wall.connectedWallIds ?? []).forEach((neighborId) => {
                const neighbor = wallById.get(neighborId);
                if (!neighbor) {
                    issues.push({ severity: 'error', code: 'WALL_NEIGHBOR_MISSING', message: `Wall ${wall.id} references missing neighbor ${neighborId}.`, wallId: wall.id });
                } else if (!(neighbor.connectedWallIds ?? []).includes(wall.id)) {
                    issues.push({ severity: 'error', code: 'WALL_NEIGHBOR_ASYMMETRIC', message: `Wall ${wall.id} / ${neighborId} adjacency is asymmetric.`, wallId: wall.id });
                }
            });
        });

        this.state.rooms.forEach((room) => {
            room.wallIds.forEach((wallId) => {
                if (!wallById.has(wallId)) {
                    issues.push({ severity: 'error', code: 'ROOM_WALL_MISSING', message: `Room ${room.id} references missing wall ${wallId}.`, roomId: room.id });
                }
            });
        });

        const invalidSel = this.state.selectedWallIds.filter((id) => !wallById.has(id));
        if (invalidSel.length > 0) {
            issues.push({ severity: 'warning', code: 'SELECTION_INVALID_IDS', message: `Selection has ${invalidSel.length} invalid wall ids.` });
        }

        const collisions = detectCollisions(this.state.walls, new Set(this.state.walls.map((w) => w.id)), this.nodeTolerance, this.defaultClearance);
        if (collisions.length > 0) {
            issues.push({ severity: 'warning', code: 'WALL_COLLISIONS_PRESENT', message: `${collisions.length} collision pair(s) detected.` });
        }

        return issues;
    }

    private transformWalls(
        wallIds: string[],
        transform: (point: Point2D) => Point2D,
        options: MutationOptions,
        label: string
    ): WallEditOperationResult {
        const propagate = options.propagateToAdjacent ?? true;
        return this.applyMutation(label, (draft) => {
            const ids = Array.from(new Set(wallIds.filter((id) => draft.walls.some((w) => w.id === id))));
            if (ids.length === 0) return fail('No matching walls for transform.');
            const moved = transformWallSet(draft.walls, ids, transform, this.nodeTolerance, propagate);
            if (moved.changedWallIds.length === 0) return fail('Transform produced no geometry change.');
            draft.walls = moved.walls;
            return ok(moved.changedWallIds);
        }, options);
    }

    private applyMutation(label: string, mutate: (draft: WallEditorState) => MutationResult, options: MutationOptions): WallEditOperationResult {
        this.ensureDerived(false);
        const before = clone(this.state);
        const draft = clone(this.state);
        const mutation = mutate(draft);
        if (!mutation.ok) return this.resultFail(mutation.reason);
        if (mutation.changedWallIds.length === 0) return this.resultFail('Operation produced no changes.');

        draft.dirty = { ...draft.dirty, geometry: true, topology: true, rooms: true, spatialIndex: true };
        const collisions = detectCollisions(draft.walls, new Set(mutation.changedWallIds), this.nodeTolerance, options.minClearance ?? this.defaultClearance);
        if (collisions.length > 0) this.events.emit('collision.detected', collisions);
        if ((options.collisionPolicy ?? 'reject') === 'reject' && collisions.length > 0) {
            return this.resultFail(`Operation blocked by ${collisions.length} collision(s).`, mutation.changedWallIds, collisions);
        }

        if (!options.deferRecalculation) {
            draft.walls = rebuildAdjacency(draft.walls, this.nodeTolerance);
            draft.rooms = detectRoomsFromWallGraph(draft.walls, draft.rooms);
            draft.dirty = dirty(false);
        }

        const validIds = new Set(draft.walls.map((w) => w.id));
        draft.selectedWallIds = draft.selectedWallIds.filter((id) => validIds.has(id));
        draft.revision = this.state.revision + 1;

        const command = new SnapshotCommand(label, before, draft);
        const prevSelection = [...this.state.selectedWallIds];
        const prevDirty = clone(this.state.dirty);
        const execution = this.commandStack.execute(command, this.state);
        this.state = clone(execution.state);

        if (!this.state.dirty.spatialIndex) {
            this.spatialIndex.rebuild(this.state.walls);
        }

        this.events.emit('command.executed', this.cmdEvent(command));
        this.emitState(prevSelection, prevDirty);
        return this.resultOk(mutation.changedWallIds, collisions);
    }

    private ensureDerived(emit: boolean): void {
        const d = this.state.dirty;
        if (!d.geometry && !d.topology && !d.rooms && !d.spatialIndex && !d.selection) return;
        const prevSelection = [...this.state.selectedWallIds];
        const prevDirty = clone(this.state.dirty);
        const next = clone(this.state);

        if (next.dirty.geometry || next.dirty.topology) {
            next.walls = rebuildAdjacency(next.walls, this.nodeTolerance);
            next.dirty.geometry = false;
            next.dirty.topology = false;
            next.dirty.rooms = true;
            next.dirty.spatialIndex = true;
        }

        if (next.dirty.rooms) {
            next.rooms = detectRoomsFromWallGraph(next.walls, next.rooms);
            next.dirty.rooms = false;
        }

        if (next.dirty.spatialIndex) {
            this.spatialIndex.rebuild(next.walls);
            next.dirty.spatialIndex = false;
        }

        if (next.dirty.selection) {
            next.dirty.selection = false;
        }

        this.state = next;
        if (emit) this.emitState(prevSelection, prevDirty);
    }

    private emitState(prevSelection: string[], prevDirty: DirtyFlags): void {
        const selectionChanged = prevSelection.length !== this.state.selectedWallIds.length || prevSelection.some((id, idx) => id !== this.state.selectedWallIds[idx]);
        const dirtyChanged = prevDirty.geometry !== this.state.dirty.geometry || prevDirty.topology !== this.state.dirty.topology || prevDirty.rooms !== this.state.dirty.rooms || prevDirty.spatialIndex !== this.state.dirty.spatialIndex || prevDirty.selection !== this.state.dirty.selection;
        if (selectionChanged) this.events.emit('selection.changed', [...this.state.selectedWallIds]);
        if (dirtyChanged) this.events.emit('dirty.changed', clone(this.state.dirty));
        this.events.emit('state.changed', clone(this.state));
    }

    private pivotOfWalls(walls: Wall2D[]): Point2D {
        if (walls.length === 0) return { x: 0, y: 0 };
        const points = walls.flatMap((w) => [w.start, w.end]);
        const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return { x: sum.x / points.length, y: sum.y / points.length };
    }

    private cmdEvent(command: WallEditCommand): CommandLifecycleEvent {
        return { id: command.id, label: command.label, createdAt: command.createdAt, revision: this.state.revision };
    }

    private resultOk(changedWallIds: string[], collisions: WallCollision[]): WallEditOperationResult {
        return { ok: true, changedWallIds, collisions, state: clone(this.state) };
    }

    private resultFail(reason: string, changedWallIds: string[] = [], collisions: WallCollision[] = []): WallEditOperationResult {
        return { ok: false, reason, changedWallIds, collisions, state: clone(this.state) };
    }
}
