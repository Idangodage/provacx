/**
 * Selection Utilities
 *
 * Shared wall selection helpers for click/range/box selection workflows.
 */

import type { Point2D, Wall2D } from '../../types';

import { distancePointToSegment } from './geometry';
import {
    type SceneBounds,
    type WallSpatialIndexCell,
    getWallBounds,
    queryWallsInBounds,
    sceneBoundsIntersect,
    wallThicknessToCanvasPx,
} from './spatial-index';

export interface SelectionModifiers {
    additive: boolean;
    range: boolean;
}

export const WALL_SELECTION_RECT_OBJECT_NAME = 'wall-selection-rect';
export const DEFAULT_WALL_SELECTION_TOLERANCE_PX = 8;
export const WALL_SELECTION_DRAG_THRESHOLD_PX = 4;

export function normalizeSelectionIds(ids: string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    ids.forEach((id) => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        output.push(id);
    });
    return output;
}

export function mergeSelectionIds(existing: string[], additions: string[]): string[] {
    return normalizeSelectionIds([...existing, ...additions]);
}

export function toggleSelectionId(ids: string[], id: string): string[] {
    if (!id) return normalizeSelectionIds(ids);
    if (ids.includes(id)) {
        return ids.filter((candidate) => candidate !== id);
    }
    return [...ids, id];
}

export function getWallIdsInRange(walls: Wall2D[], anchorWallId: string, targetWallId: string): string[] {
    if (walls.length === 0) return [];
    const anchorIndex = walls.findIndex((wall) => wall.id === anchorWallId);
    const targetIndex = walls.findIndex((wall) => wall.id === targetWallId);
    if (anchorIndex < 0 || targetIndex < 0) return targetWallId ? [targetWallId] : [];
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return walls.slice(start, end + 1).map((wall) => wall.id);
}

export function resolveWallSelectionToleranceScene(zoom: number, tolerancePx = DEFAULT_WALL_SELECTION_TOLERANCE_PX): number {
    const safeZoom = Math.max(zoom, 0.01);
    return tolerancePx / safeZoom;
}

export function getSelectionBoundsFromPoints(start: Point2D, end: Point2D): SceneBounds {
    return {
        left: Math.min(start.x, end.x),
        top: Math.min(start.y, end.y),
        right: Math.max(start.x, end.x),
        bottom: Math.max(start.y, end.y),
    };
}

export function getPointerProbeBounds(point: Point2D, toleranceScene: number): SceneBounds {
    return {
        left: point.x - toleranceScene,
        top: point.y - toleranceScene,
        right: point.x + toleranceScene,
        bottom: point.y + toleranceScene,
    };
}

export function isSelectionDragThresholdReached(
    start: Point2D,
    end: Point2D,
    zoom: number,
    thresholdPx = WALL_SELECTION_DRAG_THRESHOLD_PX
): boolean {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const sceneDistance = Math.hypot(dx, dy);
    const screenDistance = sceneDistance * Math.max(zoom, 0.01);
    return screenDistance >= thresholdPx;
}

export interface FindNearestWallAtPointOptions {
    point: Point2D;
    spatialIndex: Map<string, WallSpatialIndexCell>;
    cellSize: number;
    paperToRealRatio: number;
    toleranceScene: number;
}

export function findNearestWallAtPoint({
    point,
    spatialIndex,
    cellSize,
    paperToRealRatio,
    toleranceScene,
}: FindNearestWallAtPointOptions): Wall2D | null {
    const candidates = queryWallsInBounds(
        spatialIndex,
        getPointerProbeBounds(point, toleranceScene),
        cellSize,
        paperToRealRatio
    );
    if (candidates.length === 0) return null;

    let bestWall: Wall2D | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    candidates.forEach((wall) => {
        const halfThickness = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio) / 2;
        const maxDistance = halfThickness + toleranceScene;
        const distance = distancePointToSegment(point, wall.start, wall.end);
        if (distance > maxDistance) return;

        const normalizedDistance = distance - halfThickness;
        if (normalizedDistance < bestScore) {
            bestScore = normalizedDistance;
            bestWall = wall;
        }
    });

    return bestWall;
}

export function getWallIdsIntersectingBounds(
    spatialIndex: Map<string, WallSpatialIndexCell>,
    bounds: SceneBounds,
    cellSize: number,
    paperToRealRatio: number
): string[] {
    const candidates = queryWallsInBounds(spatialIndex, bounds, cellSize, paperToRealRatio);
    return candidates
        .filter((wall) => sceneBoundsIntersect(getWallBounds(wall, paperToRealRatio), bounds))
        .map((wall) => wall.id);
}
