/**
 * Wall Handle Geometry
 *
 * Geometry helpers for wall thickness/translation handles.
 */

import type { Point2D, Wall2D } from '../../types';

import { PX_TO_MM } from './scale';
import { wallThicknessToCanvasPx } from './spatial-index';

export const MIN_WALL_THICKNESS_MM = 101.6; // 4 in
export const MAX_WALL_THICKNESS_MM = 609.6; // 24 in

export interface WallHandleGeometry {
    direction: Point2D;
    interiorToExteriorNormal: Point2D;
    centerMid: Point2D;
    interiorMid: Point2D;
    exteriorMid: Point2D;
    thicknessScenePx: number;
}

function normalize(vector: Point2D): Point2D | null {
    const length = Math.hypot(vector.x, vector.y);
    if (length <= 1e-6) return null;
    return { x: vector.x / length, y: vector.y / length };
}

export function resolveWallExteriorNormalForDirection(wall: Wall2D, direction: Point2D): Point2D {
    const leftNormal = { x: -direction.y, y: direction.x };
    if (wall.exteriorSide === 'right') {
        return { x: -leftNormal.x, y: -leftNormal.y };
    }
    return leftNormal;
}

export function resolveWallHandleGeometry(
    wall: Wall2D,
    paperToRealRatio: number
): WallHandleGeometry | null {
    const direction = normalize({
        x: wall.end.x - wall.start.x,
        y: wall.end.y - wall.start.y,
    });
    if (!direction) return null;

    const thicknessScenePx = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio);
    const halfThickness = thicknessScenePx / 2;
    const exteriorNormal = resolveWallExteriorNormalForDirection(wall, direction);
    const interiorNormal = { x: -exteriorNormal.x, y: -exteriorNormal.y };
    const centerMid = {
        x: (wall.start.x + wall.end.x) / 2,
        y: (wall.start.y + wall.end.y) / 2,
    };

    return {
        direction,
        interiorToExteriorNormal: exteriorNormal,
        centerMid,
        interiorMid: {
            x: centerMid.x + interiorNormal.x * halfThickness,
            y: centerMid.y + interiorNormal.y * halfThickness,
        },
        exteriorMid: {
            x: centerMid.x + exteriorNormal.x * halfThickness,
            y: centerMid.y + exteriorNormal.y * halfThickness,
        },
        thicknessScenePx,
    };
}

export function projectDeltaOnNormal(delta: Point2D, normal: Point2D): number {
    return delta.x * normal.x + delta.y * normal.y;
}

export function sceneThicknessToMm(sceneThicknessPx: number, paperToRealRatio: number): number {
    const safeRatio = Number.isFinite(paperToRealRatio) && paperToRealRatio > 0 ? paperToRealRatio : 1;
    return sceneThicknessPx * PX_TO_MM * safeRatio;
}

export function mmThicknessToScene(mmThickness: number, paperToRealRatio: number): number {
    const safeRatio = Number.isFinite(paperToRealRatio) && paperToRealRatio > 0 ? paperToRealRatio : 1;
    return mmThickness / (PX_TO_MM * safeRatio);
}

export function clampWallThicknessMm(thicknessMm: number): number {
    return Math.max(MIN_WALL_THICKNESS_MM, Math.min(MAX_WALL_THICKNESS_MM, thicknessMm));
}
