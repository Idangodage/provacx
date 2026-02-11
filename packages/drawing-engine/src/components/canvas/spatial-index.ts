/**
 * Spatial Index Utilities
 * 
 * Spatial indexing for efficient wall and room visibility queries.
 * Extracted from DrawingCanvas.tsx for better organization.
 */

import type { Wall2D, Room2D } from '../../types';

import { MM_TO_PX } from './scale';

// =============================================================================
// Types
// =============================================================================

export interface SceneBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface WallSpatialIndexCell {
    walls: Wall2D[];
}

// =============================================================================
// Constants
// =============================================================================

export const WALL_SPATIAL_INDEX_CELL_PX = 400;
export const WALL_VIEWPORT_MARGIN_PX = 200;
const WALL_DEFAULT_THICKNESS_MM = 180;
const WALL_MAX_THICKNESS_PX = 2000;

// =============================================================================
// Bounds Utilities
// =============================================================================

export function sceneBoundsIntersect(a: SceneBounds, b: SceneBounds): boolean {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function wallThicknessToCanvasPx(thicknessMm: number, paperToRealRatio = 1): number {
    const resolvedThicknessMm = Number.isFinite(thicknessMm) && thicknessMm > 0
        ? thicknessMm
        : WALL_DEFAULT_THICKNESS_MM;
    const safePaperToRealRatio =
        Number.isFinite(paperToRealRatio) && paperToRealRatio > 0
            ? paperToRealRatio
            : 1;
    const paperThicknessMm = resolvedThicknessMm / safePaperToRealRatio;
    return Math.max(0.75, Math.min(paperThicknessMm * MM_TO_PX, WALL_MAX_THICKNESS_PX));
}

export function getWallBounds(wall: Wall2D, paperToRealRatio = 1): SceneBounds {
    const minX = Math.min(wall.start.x, wall.end.x);
    const minY = Math.min(wall.start.y, wall.end.y);
    const maxX = Math.max(wall.start.x, wall.end.x);
    const maxY = Math.max(wall.start.y, wall.end.y);
    const halfThickness = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio) / 2;
    return {
        left: minX - halfThickness,
        top: minY - halfThickness,
        right: maxX + halfThickness,
        bottom: maxY + halfThickness,
    };
}

export function getRoomBounds(room: Room2D): SceneBounds {
    if (room.vertices.length === 0) {
        return { left: 0, top: 0, right: 0, bottom: 0 };
    }
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    room.vertices.forEach((vertex) => {
        left = Math.min(left, vertex.x);
        top = Math.min(top, vertex.y);
        right = Math.max(right, vertex.x);
        bottom = Math.max(bottom, vertex.y);
    });
    return { left, top, right, bottom };
}

export function roomIntersectsBounds(room: Room2D, bounds: SceneBounds): boolean {
    return sceneBoundsIntersect(getRoomBounds(room), bounds);
}

// =============================================================================
// Spatial Index
// =============================================================================

export function buildWallSpatialIndex(
    walls: Wall2D[],
    cellSize: number,
    paperToRealRatio = 1
): Map<string, WallSpatialIndexCell> {
    const safeCell = Math.max(cellSize, 1);
    const index = new Map<string, WallSpatialIndexCell>();

    const keyOf = (x: number, y: number) => `${x}:${y}`;
    walls.forEach((wall) => {
        const bounds = getWallBounds(wall, paperToRealRatio);
        const minCellX = Math.floor(bounds.left / safeCell);
        const maxCellX = Math.floor(bounds.right / safeCell);
        const minCellY = Math.floor(bounds.top / safeCell);
        const maxCellY = Math.floor(bounds.bottom / safeCell);

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cy = minCellY; cy <= maxCellY; cy++) {
                const key = keyOf(cx, cy);
                const cell = index.get(key);
                if (cell) {
                    cell.walls.push(wall);
                } else {
                    index.set(key, { walls: [wall] });
                }
            }
        }
    });

    return index;
}

export function queryWallsInBounds(
    index: Map<string, WallSpatialIndexCell>,
    bounds: SceneBounds,
    cellSize = WALL_SPATIAL_INDEX_CELL_PX,
    paperToRealRatio = 1
): Wall2D[] {
    const safeCell = Math.max(cellSize, 1);
    const minCellX = Math.floor(bounds.left / safeCell);
    const maxCellX = Math.floor(bounds.right / safeCell);
    const minCellY = Math.floor(bounds.top / safeCell);
    const maxCellY = Math.floor(bounds.bottom / safeCell);
    const seen = new Set<string>();
    const visibleWalls: Wall2D[] = [];

    for (let cx = minCellX; cx <= maxCellX; cx++) {
        for (let cy = minCellY; cy <= maxCellY; cy++) {
            const cell = index.get(`${cx}:${cy}`);
            if (!cell) continue;
            cell.walls.forEach((wall) => {
                if (seen.has(wall.id)) return;
                if (!sceneBoundsIntersect(getWallBounds(wall, paperToRealRatio), bounds)) return;
                seen.add(wall.id);
                visibleWalls.push(wall);
            });
        }
    }

    return visibleWalls;
}
