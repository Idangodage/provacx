/**
 * Wall-network intelligence utilities.
 *
 * Includes:
 * - auto-cleanup (dedupe, split T-junctions/intersections, merge collinear walls)
 * - room detection and labeling wrappers
 * - topology validation helpers
 */

import type { Room2D, Wall2D } from '../types';
import {
    lineIntersection,
    segmentsIntersect,
    distance,
    generateId,
} from '../utils/geometry';
import { detectRoomsFromWallGraph, validateNestedRooms } from '../utils/room-detection';
import { rebuildWallAdjacency, splitWallAtPoint } from '../components/canvas/wallOperations';

// =============================================================================
// Types
// =============================================================================

export interface WallNetworkCleanupOptions {
    endpointTolerance?: number;
    collinearAngleToleranceDeg?: number;
    enableTJunctionFix?: boolean;
    enableIntersectionHealing?: boolean;
    enableCollinearMerge?: boolean;
    enableGapHealing?: boolean;
}

export interface WallNetworkCleanupReport {
    removedDuplicates: number;
    mergedCollinearWalls: number;
    splitAtTJunctions: number;
    splitAtIntersections: number;
    healedEndpointGaps: number;
}

export interface WallNetworkCleanupResult {
    walls: Wall2D[];
    report: WallNetworkCleanupReport;
}

export interface RoomAutoDetectResult {
    rooms: Room2D[];
    diagnostics: string[];
}

// =============================================================================
// Public API
// =============================================================================

export function autoCleanWallNetwork(
    walls: Wall2D[],
    options: WallNetworkCleanupOptions = {}
): WallNetworkCleanupResult {
    const endpointTolerance = options.endpointTolerance ?? 0.5;
    const collinearAngleToleranceDeg = options.collinearAngleToleranceDeg ?? 1.5;
    let working = walls.map(cloneWall);

    const report: WallNetworkCleanupReport = {
        removedDuplicates: 0,
        mergedCollinearWalls: 0,
        splitAtTJunctions: 0,
        splitAtIntersections: 0,
        healedEndpointGaps: 0,
    };

    const dedupeResult = removeDuplicateWalls(working, endpointTolerance);
    working = dedupeResult.walls;
    report.removedDuplicates += dedupeResult.removed;

    working = deduplicateVertices(working, endpointTolerance);

    if (options.enableGapHealing !== false) {
        const gapResult = healEndpointGaps(working, endpointTolerance);
        working = gapResult.walls;
        report.healedEndpointGaps += gapResult.healed;
    }

    if (options.enableTJunctionFix !== false) {
        const tResult = splitWallsAtTJunctions(working, endpointTolerance);
        working = tResult.walls;
        report.splitAtTJunctions += tResult.splits;
    }

    if (options.enableIntersectionHealing !== false) {
        const iResult = splitWallsAtIntersections(working, endpointTolerance);
        working = iResult.walls;
        report.splitAtIntersections += iResult.splits;
    }

    if (options.enableCollinearMerge !== false) {
        const mergeResult = mergeCollinearWalls(working, endpointTolerance, collinearAngleToleranceDeg);
        working = mergeResult.walls;
        report.mergedCollinearWalls += mergeResult.merged;
    }

    working = rebuildWallAdjacency(working, endpointTolerance);

    return {
        walls: working,
        report,
    };
}

export function detectAndLabelRooms(
    walls: Wall2D[],
    previousRooms: Room2D[] = [],
    labelPrefix = 'Room'
): RoomAutoDetectResult {
    const detected = detectRoomsFromWallGraph(walls, previousRooms);
    const relabeled = autoLabelRooms(detected, labelPrefix);
    const validation = validateNestedRooms(relabeled);
    const diagnostics = [
        ...validation.errors.map((message) => `error: ${message}`),
        ...validation.warnings.map((message) => `warning: ${message}`),
    ];
    return {
        rooms: relabeled,
        diagnostics,
    };
}

export function autoLabelRooms(rooms: Room2D[], labelPrefix = 'Room'): Room2D[] {
    let index = 1;
    return rooms.map((room) => ({
        ...room,
        name: room.name?.trim() ? room.name : `${labelPrefix} ${index++}`,
    }));
}

export function validateRoomTopologyDetailed(rooms: Room2D[]): string[] {
    const diagnostics: string[] = [];
    const byId = new Map(rooms.map((room) => [room.id, room]));

    rooms.forEach((room) => {
        if (room.vertices.length < 3) {
            diagnostics.push(`error: Room ${room.id} has fewer than 3 vertices.`);
        }
        if (room.wallIds.length < 3) {
            diagnostics.push(`error: Room ${room.id} has fewer than 3 boundary walls.`);
        }
        const duplicateWalls = findDuplicates(room.wallIds);
        duplicateWalls.forEach((wallId) => {
            diagnostics.push(`warning: Room ${room.id} references wall ${wallId} multiple times.`);
        });
        if (room.parentRoomId && !byId.has(room.parentRoomId)) {
            diagnostics.push(`error: Room ${room.id} parent ${room.parentRoomId} not found.`);
        }
    });

    return diagnostics;
}

// =============================================================================
// Cleanup Operations
// =============================================================================

function deduplicateVertices(walls: Wall2D[], tolerance: number): Wall2D[] {
    const clusters: Array<{ x: number; y: number; count: number }> = [];
    const normalizedPoints: { x: number; y: number }[] = [];

    const findOrCreateCluster = (point: { x: number; y: number }): { x: number; y: number } => {
        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            const cx = cluster.x / cluster.count;
            const cy = cluster.y / cluster.count;
            if (Math.hypot(point.x - cx, point.y - cy) <= tolerance) {
                cluster.x += point.x;
                cluster.y += point.y;
                cluster.count += 1;
                const next = { x: cluster.x / cluster.count, y: cluster.y / cluster.count };
                normalizedPoints[i] = next;
                return next;
            }
        }
        clusters.push({ x: point.x, y: point.y, count: 1 });
        const created = { x: point.x, y: point.y };
        normalizedPoints.push(created);
        return created;
    };

    return walls.map((wall) => ({
        ...wall,
        start: findOrCreateCluster(wall.start),
        end: findOrCreateCluster(wall.end),
    }));
}

function healEndpointGaps(walls: Wall2D[], tolerance: number): { walls: Wall2D[]; healed: number } {
    const points: Array<{ wallId: string; kind: 'start' | 'end'; x: number; y: number }> = [];
    walls.forEach((wall) => {
        points.push({ wallId: wall.id, kind: 'start', x: wall.start.x, y: wall.start.y });
        points.push({ wallId: wall.id, kind: 'end', x: wall.end.x, y: wall.end.y });
    });

    const replacements = new Map<string, { x: number; y: number }>();
    let healed = 0;

    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
            const b = points[j];
            if (a.wallId === b.wallId) continue;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > tolerance || d < 1e-9) continue;
            const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            replacements.set(`${a.wallId}:${a.kind}`, midpoint);
            replacements.set(`${b.wallId}:${b.kind}`, midpoint);
            healed += 1;
        }
    }

    if (replacements.size === 0) return { walls, healed: 0 };

    const nextWalls = walls.map((wall) => {
        const start = replacements.get(`${wall.id}:start`);
        const end = replacements.get(`${wall.id}:end`);
        return {
            ...wall,
            start: start ? { ...start } : wall.start,
            end: end ? { ...end } : wall.end,
        };
    });

    return { walls: nextWalls, healed };
}

function splitWallsAtTJunctions(
    walls: Wall2D[],
    tolerance: number
): { walls: Wall2D[]; splits: number } {
    let working = [...walls];
    let splits = 0;
    let changed = true;

    while (changed) {
        changed = false;
        outer: for (let i = 0; i < working.length; i++) {
            const source = working[i];
            if (!source) continue;

            const endpoints = [source.start, source.end];
            for (const endpoint of endpoints) {
                for (let j = 0; j < working.length; j++) {
                    if (i === j) continue;
                    const candidate = working[j];
                    if (!candidate) continue;
                    if (isPointNearEndpoint(endpoint, candidate, tolerance)) continue;
                    if (!isPointOnSegment(endpoint, candidate.start, candidate.end, tolerance)) continue;
                    const split = splitWallAtPoint(candidate, endpoint, candidate.layer ?? 'default');
                    if (!split) continue;
                    working.splice(j, 1, split.first, split.second);
                    splits += 1;
                    changed = true;
                    break outer;
                }
            }
        }
    }

    return { walls: working, splits };
}

function splitWallsAtIntersections(
    walls: Wall2D[],
    tolerance: number
): { walls: Wall2D[]; splits: number } {
    let working = [...walls];
    let splits = 0;
    let changed = true;

    while (changed) {
        changed = false;
        outer: for (let i = 0; i < working.length; i++) {
            const a = working[i];
            if (!a) continue;
            for (let j = i + 1; j < working.length; j++) {
                const b = working[j];
                if (!b) continue;
                if (!segmentsIntersect(a.start, a.end, b.start, b.end)) continue;

                const intersection = lineIntersection(a.start, a.end, b.start, b.end);
                if (!intersection) continue;
                if (isPointNearEndpoint(intersection, a, tolerance) && isPointNearEndpoint(intersection, b, tolerance)) {
                    continue;
                }

                const splitA = !isPointNearEndpoint(intersection, a, tolerance)
                    ? splitWallAtPoint(a, intersection, a.layer ?? 'default')
                    : null;
                const splitB = !isPointNearEndpoint(intersection, b, tolerance)
                    ? splitWallAtPoint(b, intersection, b.layer ?? 'default')
                    : null;

                if (!splitA && !splitB) continue;

                const replacement: Wall2D[] = [];
                if (splitA) {
                    replacement.push(splitA.first, splitA.second);
                    splits += 1;
                } else {
                    replacement.push(a);
                }
                if (splitB) {
                    replacement.push(splitB.first, splitB.second);
                    splits += 1;
                } else {
                    replacement.push(b);
                }

                working.splice(j, 1);
                working.splice(i, 1);
                working.push(...replacement);
                changed = true;
                break outer;
            }
        }
    }

    return { walls: working, splits };
}

function mergeCollinearWalls(
    walls: Wall2D[],
    tolerance: number,
    angleToleranceDeg: number
): { walls: Wall2D[]; merged: number } {
    let working = [...walls];
    let merged = 0;
    let changed = true;

    while (changed) {
        changed = false;
        for (let i = 0; i < working.length; i++) {
            const a = working[i];
            if (!a) continue;
            for (let j = i + 1; j < working.length; j++) {
                const b = working[j];
                if (!b) continue;
                const sharedPoint = sharedEndpoint(a, b, tolerance);
                if (!sharedPoint) continue;
                if (!canMergeByProperties(a, b)) continue;
                if (!areCollinear(a, b, angleToleranceDeg)) continue;

                const aOther = otherEndpoint(a, sharedPoint, tolerance);
                const bOther = otherEndpoint(b, sharedPoint, tolerance);
                if (!aOther || !bOther) continue;

                const mergedWall: Wall2D = {
                    ...a,
                    id: generateId(),
                    start: { ...aOther },
                    end: { ...bOther },
                    openings: [...a.openings, ...b.openings].map((opening) => ({
                        ...opening,
                        id: generateId(),
                    })),
                };

                working.splice(j, 1);
                working.splice(i, 1, mergedWall);
                merged += 1;
                changed = true;
                break;
            }
            if (changed) break;
        }
    }

    return { walls: working, merged };
}

function removeDuplicateWalls(
    walls: Wall2D[],
    tolerance: number
): { walls: Wall2D[]; removed: number } {
    const unique: Wall2D[] = [];
    let removed = 0;

    walls.forEach((wall) => {
        if (distance(wall.start, wall.end) <= tolerance * 0.2) {
            removed += 1;
            return;
        }
        const duplicate = unique.some((existing) =>
            sameSegment(existing, wall, tolerance) && canMergeByProperties(existing, wall)
        );
        if (duplicate) {
            removed += 1;
            return;
        }
        unique.push(wall);
    });

    return { walls: unique, removed };
}

// =============================================================================
// Geometry + Property Helpers
// =============================================================================

function isPointNearEndpoint(point: { x: number; y: number }, wall: Wall2D, tolerance: number): boolean {
    return (
        distance(point, wall.start) <= tolerance ||
        distance(point, wall.end) <= tolerance
    );
}

function isPointOnSegment(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number },
    tolerance: number
): boolean {
    const segmentLength = distance(start, end);
    if (segmentLength <= tolerance) return false;
    const d1 = distance(start, point);
    const d2 = distance(point, end);
    return Math.abs(d1 + d2 - segmentLength) <= tolerance * 2;
}

function sharedEndpoint(a: Wall2D, b: Wall2D, tolerance: number): { x: number; y: number } | null {
    const pointsA = [a.start, a.end];
    const pointsB = [b.start, b.end];
    for (const pa of pointsA) {
        for (const pb of pointsB) {
            if (distance(pa, pb) <= tolerance) {
                return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
            }
        }
    }
    return null;
}

function otherEndpoint(
    wall: Wall2D,
    point: { x: number; y: number },
    tolerance: number
): { x: number; y: number } | null {
    if (distance(wall.start, point) <= tolerance) return wall.end;
    if (distance(wall.end, point) <= tolerance) return wall.start;
    return null;
}

function areCollinear(a: Wall2D, b: Wall2D, angleToleranceDeg: number): boolean {
    const da = directionAngleDeg(a.start, a.end);
    const db = directionAngleDeg(b.start, b.end);
    const delta = normalizeAngleDeg(da - db);
    return Math.abs(delta) <= angleToleranceDeg || Math.abs(Math.abs(delta) - 180) <= angleToleranceDeg;
}

function directionAngleDeg(start: { x: number; y: number }, end: { x: number; y: number }): number {
    return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
}

function normalizeAngleDeg(angle: number): number {
    let result = angle;
    while (result > 180) result -= 360;
    while (result < -180) result += 360;
    return result;
}

function sameSegment(a: Wall2D, b: Wall2D, tolerance: number): boolean {
    const direct =
        distance(a.start, b.start) <= tolerance &&
        distance(a.end, b.end) <= tolerance;
    const reverse =
        distance(a.start, b.end) <= tolerance &&
        distance(a.end, b.start) <= tolerance;
    return direct || reverse;
}

function canMergeByProperties(a: Wall2D, b: Wall2D): boolean {
    return (
        a.wallType === b.wallType &&
        a.layer === b.layer &&
        a.material === b.material &&
        Math.abs(a.thickness - b.thickness) <= 1e-6 &&
        Math.abs(a.height - b.height) <= 1e-6
    );
}

function cloneWall(wall: Wall2D): Wall2D {
    return {
        ...wall,
        start: { ...wall.start },
        end: { ...wall.end },
        connectedWallIds: wall.connectedWallIds ? [...wall.connectedWallIds] : wall.connectedWallIds,
        openings: wall.openings.map((opening) => ({ ...opening })),
        wallLayers: wall.wallLayers ? wall.wallLayers.map((layer) => ({ ...layer })) : wall.wallLayers,
    };
}

function findDuplicates(items: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    items.forEach((item) => {
        if (seen.has(item)) duplicates.add(item);
        seen.add(item);
    });
    return Array.from(duplicates.values());
}
