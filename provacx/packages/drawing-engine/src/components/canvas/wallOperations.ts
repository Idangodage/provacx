/**
 * Wall Operations Utilities
 *
 * Functions for wall creation, splitting, and adjacency management.
 */

import type { Point2D, Wall2D, WallType } from '../../types';
import { generateId } from '../../utils/geometry';

import { distanceBetween, arePointsClose } from './geometry';

// Re-export for convenience
export { arePointsClose } from './geometry';

// =============================================================================
// Constants
// =============================================================================

const WALL_DEFAULT_THICKNESS_MM = 18;
const WALL_DEFAULT_HEIGHT_MM = 2700;
const WALL_DEFAULT_MATERIAL = 'concrete';
const WALL_DEFAULT_COLOR = '#6b7280';

// =============================================================================
// Types
// =============================================================================

interface WallEdge {
    start: Point2D;
    end: Point2D;
}

interface OverlapInterval {
    start: number;
    end: number;
}

interface ColinearOverlap {
    wallId: string;
    start: number;
    end: number;
}

// =============================================================================
// Wall Segment Creation
// =============================================================================

export function createWallSegment(
    start: Point2D,
    end: Point2D,
    options: Partial<
        Pick<
            Wall2D,
            | 'thickness'
            | 'height'
            | 'wallType'
            | 'wallTypeId'
            | 'wallLayers'
            | 'isWallTypeOverride'
            | 'material'
            | 'color'
            | 'layer'
            | 'openings'
        >
    > = {}
): Wall2D {
    const wallType: WallType = options.wallType ?? 'interior';
    const wallLayers = options.wallLayers?.map((layer, index) => ({
        ...layer,
        id: generateId(),
        order: index,
    }));
    const layerDerivedThickness = wallLayers?.reduce(
        (sum, layer) => sum + Math.max(layer.thickness, 0),
        0
    );
    return {
        id: generateId(),
        start,
        end,
        thickness: options.thickness ?? layerDerivedThickness ?? WALL_DEFAULT_THICKNESS_MM,
        height: options.height ?? WALL_DEFAULT_HEIGHT_MM,
        wallType,
        wallTypeId: options.wallTypeId,
        wallLayers,
        isWallTypeOverride: options.isWallTypeOverride,
        material: options.material ?? WALL_DEFAULT_MATERIAL,
        color: options.color ?? WALL_DEFAULT_COLOR,
        layer: options.layer ?? 'default',
        connectedWallIds: [],
        openings: options.openings ? [...options.openings] : [],
    };
}

// =============================================================================
// Wall Splitting
// =============================================================================

export function splitWallAtPoint(
    wall: Wall2D,
    splitPoint: Point2D,
    fallbackLayer: string
): { first: Wall2D; second: Wall2D } | null {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) return null;

    const t = ((splitPoint.x - wall.start.x) * dx + (splitPoint.y - wall.start.y) * dy) / lenSq;
    if (t <= 0.001 || t >= 0.999) return null;

    const layer = wall.layer ?? fallbackLayer;
    const firstId = generateId();
    const secondId = generateId();
    const clonedWallLayers = wall.wallLayers?.map((wallLayer, index) => ({
        ...wallLayer,
        id: generateId(),
        order: index,
    }));
    const clonedWallLayersSecond = wall.wallLayers?.map((wallLayer, index) => ({
        ...wallLayer,
        id: generateId(),
        order: index,
    }));
    const firstOpenings: Wall2D['openings'] = [];
    const secondOpenings: Wall2D['openings'] = [];
    const safeT = Math.max(0.001, Math.min(0.999, t));

    (wall.openings ?? []).forEach((opening) => {
        if (opening.position <= safeT) {
            firstOpenings.push({
                ...opening,
                id: generateId(),
                wallId: firstId,
                position: Math.max(0, Math.min(1, opening.position / safeT)),
            });
            return;
        }
        secondOpenings.push({
            ...opening,
            id: generateId(),
            wallId: secondId,
            position: Math.max(0, Math.min(1, (opening.position - safeT) / (1 - safeT))),
        });
    });

    const commonProps = {
        thickness: wall.thickness,
        height: wall.height,
        wallType: wall.wallType,
        wallTypeId: wall.wallTypeId,
        wallLayers: clonedWallLayers,
        isWallTypeOverride: wall.isWallTypeOverride,
        material: wall.material ?? WALL_DEFAULT_MATERIAL,
        color: wall.color ?? WALL_DEFAULT_COLOR,
        layer,
        connectedWallIds: [],
    };

    const first: Wall2D = {
        id: firstId,
        start: { ...wall.start },
        end: { ...splitPoint },
        ...commonProps,
        openings: firstOpenings,
    };
    const second: Wall2D = {
        id: secondId,
        start: { ...splitPoint },
        end: { ...wall.end },
        ...commonProps,
        wallLayers: clonedWallLayersSecond,
        openings: secondOpenings,
    };

    return { first, second };
}

// =============================================================================
// Wall Adjacency
// =============================================================================

function endpointsTouch(a: Point2D, b: Point2D, tolerance: number): boolean {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

export function wallsShareEndpoint(a: Wall2D, b: Wall2D, tolerance: number): boolean {
    return (
        endpointsTouch(a.start, b.start, tolerance) ||
        endpointsTouch(a.start, b.end, tolerance) ||
        endpointsTouch(a.end, b.start, tolerance) ||
        endpointsTouch(a.end, b.end, tolerance)
    );
}

export function rebuildWallAdjacency(walls: Wall2D[], tolerance: number): Wall2D[] {
    const adjacencyMap = new Map<string, Set<string>>();
    walls.forEach((wall) => adjacencyMap.set(wall.id, new Set<string>()));

    for (let i = 0; i < walls.length; i++) {
        const a = walls[i];
        if (!a) continue;
        for (let j = i + 1; j < walls.length; j++) {
            const b = walls[j];
            if (!b) continue;
            if (!wallsShareEndpoint(a, b, tolerance)) continue;
            adjacencyMap.get(a.id)?.add(b.id);
            adjacencyMap.get(b.id)?.add(a.id);
        }
    }

    return walls.map((wall) => ({
        ...wall,
        connectedWallIds: Array.from(adjacencyMap.get(wall.id) ?? []),
    }));
}

export function moveConnectedNode(
    walls: Wall2D[],
    sourcePoint: Point2D,
    targetPoint: Point2D,
    tolerance: number
): Wall2D[] {
    return walls.map((wall) => {
        const nextWall: Wall2D = { ...wall };
        let changed = false;
        if (arePointsClose(wall.start, sourcePoint, tolerance)) {
            nextWall.start = { ...targetPoint };
            changed = true;
        }
        if (arePointsClose(wall.end, sourcePoint, tolerance)) {
            nextWall.end = { ...targetPoint };
            changed = true;
        }
        return changed ? nextWall : wall;
    });
}

// =============================================================================
// Room Polygon Utilities
// =============================================================================

export function normalizeRoomVertices(vertices: Point2D[], tolerance = 0.001): Point2D[] {
    const normalized: Point2D[] = [];
    vertices.forEach((vertex) => {
        const last = normalized[normalized.length - 1];
        if (!last || !arePointsClose(last, vertex, tolerance)) {
            normalized.push(vertex);
        }
    });
    if (normalized.length > 1) {
        const first = normalized[0];
        const last = normalized[normalized.length - 1];
        if (first && last && arePointsClose(first, last, tolerance)) {
            normalized.pop();
        }
    }
    return normalized;
}

export function buildClosedPolygonEdges(vertices: Point2D[]): WallEdge[] {
    if (vertices.length < 3) return [];
    const edges: WallEdge[] = [];
    for (let i = 0; i < vertices.length; i++) {
        const start = vertices[i];
        const end = vertices[(i + 1) % vertices.length];
        if (!start || !end) continue;
        if (distanceBetween(start, end) <= 0.001) continue;
        edges.push({ start, end });
    }
    return edges;
}

export function buildRectangleVertices(start: Point2D, end: Point2D): Point2D[] {
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);
    return [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
    ];
}

// =============================================================================
// Wall Edge Reuse (for room creation)
// =============================================================================

function splitWallsAtPoint(
    sourceWalls: Wall2D[],
    splitPoint: Point2D,
    fallbackLayer: string,
    tolerance: number
): Wall2D[] {
    const walls = [...sourceWalls];
    let changed = true;

    while (changed) {
        changed = false;
        for (let i = 0; i < walls.length; i++) {
            const wall = walls[i];
            if (!wall) continue;
            if (arePointsClose(wall.start, splitPoint, tolerance) || arePointsClose(wall.end, splitPoint, tolerance)) {
                continue;
            }
            if (!isPointOnSegment(splitPoint, wall.start, wall.end, tolerance)) continue;

            const splitResult = splitWallAtPoint(wall, splitPoint, fallbackLayer);
            if (!splitResult) continue;

            walls.splice(i, 1, splitResult.first, splitResult.second);
            changed = true;
            break;
        }
    }

    return walls;
}

function isPointOnSegment(point: Point2D, segmentStart: Point2D, segmentEnd: Point2D, tolerance: number): boolean {
    const segmentLength = distanceBetween(segmentStart, segmentEnd);
    if (segmentLength <= tolerance) return false;
    const d1 = distanceBetween(segmentStart, point);
    const d2 = distanceBetween(point, segmentEnd);
    return Math.abs(d1 + d2 - segmentLength) <= tolerance * 2;
}

function collectColinearOverlaps(
    walls: Wall2D[],
    lineStart: Point2D,
    lineEnd: Point2D,
    tolerance: number
): ColinearOverlap[] {
    const lineLength = distanceBetween(lineStart, lineEnd);
    if (lineLength <= 0.001) return [];
    const unit = {
        x: (lineEnd.x - lineStart.x) / lineLength,
        y: (lineEnd.y - lineStart.y) / lineLength,
    };

    const overlaps: ColinearOverlap[] = [];
    walls.forEach((wall) => {
        if (!isWallColinearWithLine(wall, lineStart, lineEnd, tolerance)) return;

        const projectedStart = dotProduct(
            { x: wall.start.x - lineStart.x, y: wall.start.y - lineStart.y },
            unit
        );
        const projectedEnd = dotProduct(
            { x: wall.end.x - lineStart.x, y: wall.end.y - lineStart.y },
            unit
        );
        const overlapStart = Math.max(0, Math.min(projectedStart, projectedEnd));
        const overlapEnd = Math.min(lineLength, Math.max(projectedStart, projectedEnd));
        if (overlapEnd - overlapStart <= tolerance) return;

        overlaps.push({
            wallId: wall.id,
            start: overlapStart,
            end: overlapEnd,
        });
    });
    return overlaps;
}

function splitWallsAtPointOnLine(
    sourceWalls: Wall2D[],
    splitPoint: Point2D,
    lineStart: Point2D,
    lineEnd: Point2D,
    fallbackLayer: string,
    tolerance: number
): Wall2D[] {
    const walls = [...sourceWalls];
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < walls.length; i++) {
            const wall = walls[i];
            if (!wall) continue;
            if (!isWallColinearWithLine(wall, lineStart, lineEnd, tolerance)) continue;
            if (arePointsClose(wall.start, splitPoint, tolerance) || arePointsClose(wall.end, splitPoint, tolerance)) {
                continue;
            }
            if (!isPointOnSegment(splitPoint, wall.start, wall.end, tolerance)) continue;

            const splitResult = splitWallAtPoint(wall, splitPoint, fallbackLayer);
            if (!splitResult) continue;
            walls.splice(i, 1, splitResult.first, splitResult.second);
            changed = true;
            break;
        }
    }
    return walls;
}

function isWallColinearWithLine(
    wall: Wall2D,
    lineStart: Point2D,
    lineEnd: Point2D,
    tolerance: number
): boolean {
    return (
        pointLineDistance(wall.start, lineStart, lineEnd) <= tolerance &&
        pointLineDistance(wall.end, lineStart, lineEnd) <= tolerance
    );
}

function pointLineDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
    const lineDx = lineEnd.x - lineStart.x;
    const lineDy = lineEnd.y - lineStart.y;
    const length = Math.hypot(lineDx, lineDy);
    if (length <= 0.0001) return distanceBetween(point, lineStart);
    const cross = Math.abs(lineDx * (point.y - lineStart.y) - lineDy * (point.x - lineStart.x));
    return cross / length;
}

function dotProduct(a: Point2D, b: Point2D): number {
    return a.x * b.x + a.y * b.y;
}

function pointAtDistance(start: Point2D, unit: Point2D, distance: number): Point2D {
    return {
        x: start.x + unit.x * distance,
        y: start.y + unit.y * distance,
    };
}

function mergeIntervals(intervals: OverlapInterval[], tolerance: number): OverlapInterval[] {
    if (intervals.length === 0) return [];
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    const merged: OverlapInterval[] = [];

    sorted.forEach((interval) => {
        const last = merged[merged.length - 1];
        if (!last || interval.start > last.end + tolerance) {
            merged.push({ ...interval });
            return;
        }
        last.end = Math.max(last.end, interval.end);
    });

    return merged;
}

function subtractIntervals(
    source: OverlapInterval[],
    remove: OverlapInterval[],
    tolerance: number
): OverlapInterval[] {
    let result = [...source];

    remove.forEach((cut) => {
        const next: OverlapInterval[] = [];
        result.forEach((segment) => {
            if (cut.end <= segment.start + tolerance || cut.start >= segment.end - tolerance) {
                next.push(segment);
                return;
            }
            if (cut.start > segment.start + tolerance) {
                next.push({ start: segment.start, end: Math.max(segment.start, cut.start) });
            }
            if (cut.end < segment.end - tolerance) {
                next.push({ start: Math.min(segment.end, cut.end), end: segment.end });
            }
        });
        result = next;
    });

    return result.filter((segment) => segment.end - segment.start > tolerance);
}

export function addEdgeWithWallReuse(
    sourceWalls: Wall2D[],
    start: Point2D,
    end: Point2D,
    layerId: string,
    tolerance: number,
    wallDefaults: Partial<
        Pick<
            Wall2D,
            | 'thickness'
            | 'height'
            | 'wallType'
            | 'wallTypeId'
            | 'wallLayers'
            | 'isWallTypeOverride'
            | 'material'
            | 'color'
        >
    > = {}
): Wall2D[] {
    if (distanceBetween(start, end) <= 0.001) return sourceWalls;

    let walls = [...sourceWalls];
    walls = splitWallsAtPoint(walls, start, layerId, tolerance);
    walls = splitWallsAtPoint(walls, end, layerId, tolerance);

    const lineVector = { x: end.x - start.x, y: end.y - start.y };
    const lineLength = Math.hypot(lineVector.x, lineVector.y);
    if (lineLength <= 0.001) return walls;

    const unit = { x: lineVector.x / lineLength, y: lineVector.y / lineLength };

    // Split existing walls at overlap boundaries to isolate shared segments.
    let overlaps = collectColinearOverlaps(walls, start, end, tolerance);
    overlaps.forEach((overlap) => {
        const startPoint = pointAtDistance(start, unit, overlap.start);
        const endPoint = pointAtDistance(start, unit, overlap.end);
        walls = splitWallsAtPointOnLine(walls, startPoint, start, end, layerId, tolerance);
        walls = splitWallsAtPointOnLine(walls, endPoint, start, end, layerId, tolerance);
    });

    overlaps = collectColinearOverlaps(walls, start, end, tolerance);
    const coveredIntervals = mergeIntervals(
        overlaps.map((overlap) => ({ start: overlap.start, end: overlap.end })),
        tolerance
    );
    const uncoveredIntervals = subtractIntervals(
        [{ start: 0, end: lineLength }],
        coveredIntervals,
        tolerance
    );

    uncoveredIntervals.forEach((segment) => {
        if (segment.end - segment.start <= tolerance) return;
        const segmentStart = pointAtDistance(start, unit, segment.start);
        const segmentEnd = pointAtDistance(start, unit, segment.end);
        walls.push(
            createWallSegment(segmentStart, segmentEnd, {
                ...wallDefaults,
                layer: layerId,
            })
        );
    });

    return walls;
}
