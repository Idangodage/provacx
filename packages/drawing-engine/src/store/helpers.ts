/**
 * Store Helper Functions
 * 
 * Shared utility functions used by store actions.
 * Extracted for better organization and testability.
 */

import { detectAndLabelRooms } from '../professional/wall-network';
import type {
    Point2D,
    Wall2D,
    Room2D,
    DetectedElement,
    Dimension2D,
    Annotation2D,
    Sketch2D,
    SymbolInstance2D,
    HistoryEntry,
    WallTypeDefinition,
} from '../types';
import { generateId } from '../utils/geometry';
import { applyNestedRoomHierarchy } from '../utils/room-detection';
import { applyWallOrientationMetadata } from '../utils/wall-orientation';
import {
    BUILT_IN_WALL_TYPES,
    normalizeWallForTypeSystem,
} from '../utils/wall-types';

// =============================================================================
// Constants
// =============================================================================

export const WALL_NODE_TOLERANCE_PX = 0.5;

// =============================================================================
// Deep Clone
// =============================================================================

export function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

// =============================================================================
// History Helpers
// =============================================================================

export function createEmptyHistorySnapshot(): HistoryEntry['snapshot'] {
    return {
        walls: [],
        rooms: [],
        detectedElements: [],
        dimensions: [],
        annotations: [],
        sketches: [],
        symbols: [],
    };
}

export function createHistoryEntry(action: string, snapshot: HistoryEntry['snapshot']): HistoryEntry {
    return {
        id: generateId(),
        timestamp: Date.now(),
        action,
        snapshot,
    };
}

export function createHistorySnapshot(state: {
    walls: Wall2D[];
    rooms: Room2D[];
    detectedElements: DetectedElement[];
    dimensions: Dimension2D[];
    annotations: Annotation2D[];
    sketches: Sketch2D[];
    symbols: SymbolInstance2D[];
}): HistoryEntry['snapshot'] {
    return {
        walls: deepClone(state.walls),
        rooms: deepClone(state.rooms),
        detectedElements: deepClone(state.detectedElements),
        dimensions: deepClone(state.dimensions),
        annotations: deepClone(state.annotations),
        sketches: deepClone(state.sketches),
        symbols: deepClone(state.symbols),
    };
}

// =============================================================================
// Wall Geometry Helpers
// =============================================================================

export function wallGeometryChanged(a: Wall2D, b: Wall2D, tolerance = 1e-6): boolean {
    return (
        Math.abs(a.start.x - b.start.x) > tolerance ||
        Math.abs(a.start.y - b.start.y) > tolerance ||
        Math.abs(a.end.x - b.end.x) > tolerance ||
        Math.abs(a.end.y - b.end.y) > tolerance
    );
}

export function pointToEndpointKey(point: Point2D, tolerance: number): string {
    const step = Math.max(tolerance, 1e-4);
    return `${Math.round(point.x / step)}:${Math.round(point.y / step)}`;
}

export function buildWallAdjacencyMap(walls: Wall2D[], tolerance: number): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();
    const buckets = new Map<string, string[]>();

    walls.forEach((wall) => {
        adjacency.set(wall.id, new Set<string>());
        const keys = [
            pointToEndpointKey(wall.start, tolerance),
            pointToEndpointKey(wall.end, tolerance),
        ];

        keys.forEach((key) => {
            const wallIds = buckets.get(key) ?? [];
            wallIds.push(wall.id);
            buckets.set(key, wallIds);
        });
    });

    buckets.forEach((wallIdsAtNode) => {
        for (let i = 0; i < wallIdsAtNode.length; i++) {
            const sourceId = wallIdsAtNode[i];
            if (!sourceId) continue;
            for (let j = i + 1; j < wallIdsAtNode.length; j++) {
                const targetId = wallIdsAtNode[j];
                if (!targetId) continue;
                adjacency.get(sourceId)?.add(targetId);
                adjacency.get(targetId)?.add(sourceId);
            }
        }
    });

    return adjacency;
}

// =============================================================================
// Room Detection Helpers
// =============================================================================

export function getRoomCentroid(room: Room2D): Point2D {
    if (room.vertices.length === 0) return { x: 0, y: 0 };
    const sum = room.vertices.reduce(
        (acc, vertex) => ({ x: acc.x + vertex.x, y: acc.y + vertex.y }),
        { x: 0, y: 0 }
    );
    return {
        x: sum.x / room.vertices.length,
        y: sum.y / room.vertices.length,
    };
}

export function sortRoomsForDisplay(rooms: Room2D[]): Room2D[] {
    return [...rooms].sort((a, b) => {
        const centroidA = getRoomCentroid(a);
        const centroidB = getRoomCentroid(b);
        if (Math.abs(centroidA.y - centroidB.y) > 1e-6) {
            return centroidA.y - centroidB.y;
        }
        if (Math.abs(centroidA.x - centroidB.x) > 1e-6) {
            return centroidA.x - centroidB.x;
        }
        return a.name.localeCompare(b.name);
    });
}

export function detectRoomsIncremental(
    previousWalls: Wall2D[],
    nextWalls: Wall2D[],
    previousRooms: Room2D[]
): Room2D[] {
    void previousWalls;
    if (nextWalls.length < 3) return [];
    const detected = detectAndLabelRooms(nextWalls, previousRooms);
    return sortRoomsForDisplay(applyNestedRoomHierarchy(detected.rooms));
}

// =============================================================================
// Wall Normalization
// =============================================================================

export function withRebuiltAdjacency(
    walls: Wall2D[],
    wallTypeRegistry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): Wall2D[] {
    const normalizedWalls = walls.map((wall) => normalizeWallForTypeSystem(wall, wallTypeRegistry));
    const adjacency = buildWallAdjacencyMap(normalizedWalls, WALL_NODE_TOLERANCE_PX);
    const wallsWithAdjacency = normalizedWalls.map((wall) => ({
        ...wall,
        connectedWallIds: Array.from(adjacency.get(wall.id) ?? []),
    }));
    return applyWallOrientationMetadata(wallsWithAdjacency, {
        nodeTolerancePx: WALL_NODE_TOLERANCE_PX,
        defaultInteriorSideForOpenChains: 'right',
        probeOffsetPx: 6,
    });
}
