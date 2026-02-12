/**
 * Room Polygon Validation
 *
 * Validates room polygon topology constraints for edit commit safety.
 */

import type { Point2D, Room2D } from '../../types';

export interface RoomPolygonValidationResult {
    errors: string[];
    warnings: string[];
}

function arePointsClose(a: Point2D, b: Point2D, tolerance: number): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
}

function normalizeVertices(vertices: Point2D[], tolerance: number): Point2D[] {
    const deduped: Point2D[] = [];
    vertices.forEach((vertex) => {
        const previous = deduped[deduped.length - 1];
        if (!previous || !arePointsClose(previous, vertex, tolerance)) {
            deduped.push(vertex);
        }
    });

    if (deduped.length > 1) {
        const first = deduped[0];
        const last = deduped[deduped.length - 1];
        if (first && last && arePointsClose(first, last, tolerance)) {
            deduped.pop();
        }
    }

    return deduped;
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isPointOnSegment(point: Point2D, start: Point2D, end: Point2D, tolerance: number): boolean {
    return (
        point.x >= Math.min(start.x, end.x) - tolerance &&
        point.x <= Math.max(start.x, end.x) + tolerance &&
        point.y >= Math.min(start.y, end.y) - tolerance &&
        point.y <= Math.max(start.y, end.y) + tolerance &&
        Math.abs(orientation(start, end, point)) <= tolerance
    );
}

function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D, tolerance: number): boolean {
    const o1 = orientation(a1, a2, b1);
    const o2 = orientation(a1, a2, b2);
    const o3 = orientation(b1, b2, a1);
    const o4 = orientation(b1, b2, a2);

    const properCross = (o1 > tolerance) !== (o2 > tolerance) && (o3 > tolerance) !== (o4 > tolerance);
    if (properCross) return true;

    if (Math.abs(o1) <= tolerance && isPointOnSegment(b1, a1, a2, tolerance)) return true;
    if (Math.abs(o2) <= tolerance && isPointOnSegment(b2, a1, a2, tolerance)) return true;
    if (Math.abs(o3) <= tolerance && isPointOnSegment(a1, b1, b2, tolerance)) return true;
    if (Math.abs(o4) <= tolerance && isPointOnSegment(a2, b1, b2, tolerance)) return true;
    return false;
}

function hasSelfIntersection(vertices: Point2D[], tolerance: number): boolean {
    const count = vertices.length;
    if (count < 4) return false;

    for (let i = 0; i < count; i += 1) {
        const a1 = vertices[i];
        const a2 = vertices[(i + 1) % count];
        if (!a1 || !a2) continue;

        for (let j = i + 1; j < count; j += 1) {
            if (Math.abs(i - j) <= 1) continue;
            if (i === 0 && j === count - 1) continue;

            const b1 = vertices[j];
            const b2 = vertices[(j + 1) % count];
            if (!b1 || !b2) continue;
            if (segmentsIntersect(a1, a2, b1, b2, tolerance)) {
                return true;
            }
        }
    }

    return false;
}

export function validateRoomPolygonTopology(
    rooms: Room2D[],
    tolerance = 1e-6
): RoomPolygonValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    rooms.forEach((room) => {
        const vertices = normalizeVertices(room.vertices ?? [], tolerance);
        if (vertices.length < 3) {
            warnings.push(`"${room.name}" has fewer than 3 vertices.`);
            return;
        }
        if (hasSelfIntersection(vertices, tolerance)) {
            errors.push(`"${room.name}" contains a self-intersecting polygon.`);
        }
    });

    return { errors, warnings };
}
