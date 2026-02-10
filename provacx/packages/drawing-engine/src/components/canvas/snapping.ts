/**
 * Snapping Utilities
 *
 * Grid and wall snapping logic for the drawing canvas.
 */

import type { Point2D, Wall2D } from '../../types';

import { distanceBetween, projectPointToSegment } from './geometry';

// Re-export geometry functions for convenience
export { distanceBetween, clamp, projectPointToSegment } from './geometry';

// =============================================================================
// Types
// =============================================================================

export interface WallSnapTarget {
    point: Point2D;
    type: 'endpoint' | 'midpoint' | 'segment';
    wallId: string;
    distance: number;
}

// =============================================================================
// Grid Snapping
// =============================================================================

export function snapPointToGrid(point: Point2D, gridSize: number): Point2D {
    return {
        x: Math.round(point.x / gridSize) * gridSize,
        y: Math.round(point.y / gridSize) * gridSize,
    };
}

// =============================================================================
// Wall Snapping
// =============================================================================

export function findWallSnapTarget(
    point: Point2D,
    walls: Wall2D[],
    thresholdScene: number
): WallSnapTarget | null {
    let best: WallSnapTarget | null = null;

    walls.forEach((wall) => {
        const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
        const candidates: Array<Omit<WallSnapTarget, 'distance'>> = [
            { point: wall.start, type: 'endpoint', wallId: wall.id },
            { point: wall.end, type: 'endpoint', wallId: wall.id },
            { point: mid, type: 'midpoint', wallId: wall.id },
        ];

        const projection = projectPointToSegment(point, wall.start, wall.end);
        if (projection.t > 0.01 && projection.t < 0.99) {
            candidates.push({ point: projection.projection, type: 'segment', wallId: wall.id });
        }

        candidates.forEach((candidate) => {
            const d = distanceBetween(point, candidate.point);
            if (d > thresholdScene) return;
            if (!best || d < best.distance) {
                best = { ...candidate, distance: d };
                return;
            }
            if (best && Math.abs(d - best.distance) < 1e-6 && snapTypePriority(candidate.type) > snapTypePriority(best.type)) {
                best = { ...candidate, distance: d };
            }
        });
    });

    return best;
}

export function snapTypePriority(type: WallSnapTarget['type']): number {
    switch (type) {
        case 'endpoint':
            return 3;
        case 'midpoint':
            return 2;
        default:
            return 1;
    }
}

export function applyOrthogonalConstraint(start: Point2D, target: Point2D): Point2D {
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
        return { x: target.x, y: start.y };
    }
    return { x: start.x, y: target.y };
}
