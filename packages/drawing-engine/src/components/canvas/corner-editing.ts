/**
 * Corner Editing Geometry
 *
 * Corner pair resolution and bevel/angle-edit computations.
 */

import type { Point2D, Wall2D } from '../../types';

import { wallThicknessToCanvasPx } from './spatial-index';
import { projectDeltaOnNormal, resolveWallExteriorNormalForDirection } from './wall-handle-geometry';

export const CORNER_MIN_ANGLE_DEG = 15;
export const CORNER_MAX_ANGLE_DEG = 165;

interface Line2D {
    point: Point2D;
    direction: Point2D;
}

export interface CornerPair {
    node: Point2D;
    wallA: Wall2D;
    wallB: Wall2D;
    awayA: Point2D;
    awayB: Point2D;
    lengthA: number;
    lengthB: number;
}

export interface CornerControlGeometry {
    outerVertex: Point2D;
    innerVertex: Point2D;
    center: Point2D;
    outerRadial: Point2D | null;
    innerRadial: Point2D | null;
    centerRadial: Point2D | null;
    maxBevelLength: number;
    angleDeg: number;
}

function normalize(vector: Point2D): Point2D | null {
    const length = Math.hypot(vector.x, vector.y);
    if (length <= 1e-8) return null;
    return { x: vector.x / length, y: vector.y / length };
}

function arePointsClose(a: Point2D, b: Point2D, tolerance: number): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
}

function directionAwayFromNode(wall: Wall2D, node: Point2D, tolerance: number): Point2D | null {
    if (arePointsClose(wall.start, node, tolerance)) {
        return normalize({ x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y });
    }
    if (arePointsClose(wall.end, node, tolerance)) {
        return normalize({ x: wall.start.x - wall.end.x, y: wall.start.y - wall.end.y });
    }
    return null;
}

function setWallNodePoint(wall: Wall2D, node: Point2D, replacement: Point2D, tolerance: number): Wall2D {
    if (arePointsClose(wall.start, node, tolerance)) {
        return { ...wall, start: { ...replacement } };
    }
    if (arePointsClose(wall.end, node, tolerance)) {
        return { ...wall, end: { ...replacement } };
    }
    return wall;
}

function intersectLines(a: Line2D, b: Line2D): Point2D | null {
    const det = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
    if (Math.abs(det) <= 1e-8) return null;
    const dx = b.point.x - a.point.x;
    const dy = b.point.y - a.point.y;
    const t = (dx * b.direction.y - dy * b.direction.x) / det;
    return {
        x: a.point.x + a.direction.x * t,
        y: a.point.y + a.direction.y * t,
    };
}

function nodeKey(point: Point2D): string {
    return `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;
}

function calculateAngleDeg(a: Point2D, b: Point2D): number {
    const dot = a.x * b.x + a.y * b.y;
    const clamped = Math.max(-1, Math.min(1, dot));
    return (Math.acos(clamped) * 180) / Math.PI;
}

function getOffsetLineAtNode(
    wall: Wall2D,
    node: Point2D,
    awayDirection: Point2D,
    paperToRealRatio: number,
    side: 'outer' | 'inner'
): Line2D | null {
    const wallDirection = normalize({
        x: wall.end.x - wall.start.x,
        y: wall.end.y - wall.start.y,
    });
    if (!wallDirection) return null;

    const exteriorNormal = resolveWallExteriorNormalForDirection(wall, wallDirection);
    const sideNormal =
        side === 'outer'
            ? exteriorNormal
            : { x: -exteriorNormal.x, y: -exteriorNormal.y };
    const halfThickness = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio) / 2;

    return {
        point: {
            x: node.x + sideNormal.x * halfThickness,
            y: node.y + sideNormal.y * halfThickness,
        },
        direction: awayDirection,
    };
}

export function resolveCornerPair(
    walls: Wall2D[],
    node: Point2D,
    wallIds?: string[],
    tolerance = 0.5
): CornerPair | null {
    const filtered = walls.filter((wall) => {
        if (wallIds && wallIds.length > 0 && !wallIds.includes(wall.id)) return false;
        return arePointsClose(wall.start, node, tolerance) || arePointsClose(wall.end, node, tolerance);
    });
    if (filtered.length < 2) return null;

    const wallA = filtered[0];
    const wallB = filtered[1];
    if (!wallA || !wallB) return null;

    const awayA = directionAwayFromNode(wallA, node, tolerance);
    const awayB = directionAwayFromNode(wallB, node, tolerance);
    if (!awayA || !awayB) return null;

    const farA = arePointsClose(wallA.start, node, tolerance) ? wallA.end : wallA.start;
    const farB = arePointsClose(wallB.start, node, tolerance) ? wallB.end : wallB.start;
    const lengthA = Math.hypot(farA.x - node.x, farA.y - node.y);
    const lengthB = Math.hypot(farB.x - node.x, farB.y - node.y);
    if (lengthA <= 1e-4 || lengthB <= 1e-4) return null;

    return { node: { ...node }, wallA, wallB, awayA, awayB, lengthA, lengthB };
}

export function resolveCornerControlGeometry(
    pair: CornerPair,
    paperToRealRatio: number
): CornerControlGeometry | null {
    const outerA = getOffsetLineAtNode(pair.wallA, pair.node, pair.awayA, paperToRealRatio, 'outer');
    const outerB = getOffsetLineAtNode(pair.wallB, pair.node, pair.awayB, paperToRealRatio, 'outer');
    const innerA = getOffsetLineAtNode(pair.wallA, pair.node, pair.awayA, paperToRealRatio, 'inner');
    const innerB = getOffsetLineAtNode(pair.wallB, pair.node, pair.awayB, paperToRealRatio, 'inner');
    if (!outerA || !outerB || !innerA || !innerB) return null;

    const outerFallback = {
        x: (outerA.point.x + outerB.point.x) / 2,
        y: (outerA.point.y + outerB.point.y) / 2,
    };
    const innerFallback = {
        x: (innerA.point.x + innerB.point.x) / 2,
        y: (innerA.point.y + innerB.point.y) / 2,
    };

    const outerVertex = intersectLines(outerA, outerB) ?? outerFallback;
    const innerVertex = intersectLines(innerA, innerB) ?? innerFallback;
    const center = {
        x: (outerVertex.x + innerVertex.x) / 2,
        y: (outerVertex.y + innerVertex.y) / 2,
    };

    const centerRadial =
        normalize({ x: center.x - pair.node.x, y: center.y - pair.node.y }) ??
        normalize({ x: pair.awayA.x + pair.awayB.x, y: pair.awayA.y + pair.awayB.y });
    const angleDeg = calculateAngleDeg(pair.awayA, pair.awayB);

    return {
        outerVertex,
        innerVertex,
        center,
        outerRadial: normalize({ x: outerVertex.x - pair.node.x, y: outerVertex.y - pair.node.y }),
        innerRadial: normalize({ x: innerVertex.x - pair.node.x, y: innerVertex.y - pair.node.y }),
        centerRadial,
        maxBevelLength: Math.min(pair.lengthA, pair.lengthB) / 3,
        angleDeg,
    };
}

function buildBevelWallId(pair: CornerPair): string {
    const ids = [pair.wallA.id, pair.wallB.id].sort();
    return `bevel:${ids[0]}:${ids[1]}:${nodeKey(pair.node)}`;
}

export function applyCornerBevel(
    sourceWalls: Wall2D[],
    pair: CornerPair,
    geometry: CornerControlGeometry,
    handleType: 'outer' | 'inner',
    pointer: Point2D,
    tolerance = 0.5
): Wall2D[] | null {
    const radial = handleType === 'outer' ? geometry.outerRadial : geometry.innerRadial;
    const origin = handleType === 'outer' ? geometry.outerVertex : geometry.innerVertex;
    if (!radial) return null;

    const projected = projectDeltaOnNormal(
        { x: pointer.x - origin.x, y: pointer.y - origin.y },
        radial
    );
    const bevelLength = Math.max(0, Math.min(geometry.maxBevelLength, projected));

    const walls = sourceWalls.map((wall) => ({
        ...wall,
        start: { ...wall.start },
        end: { ...wall.end },
        openings: wall.openings.map((opening) => ({ ...opening })),
    }));
    const cutA = {
        x: pair.node.x + pair.awayA.x * bevelLength,
        y: pair.node.y + pair.awayA.y * bevelLength,
    };
    const cutB = {
        x: pair.node.x + pair.awayB.x * bevelLength,
        y: pair.node.y + pair.awayB.y * bevelLength,
    };

    const nextWalls = walls.map((wall) => {
        if (wall.id === pair.wallA.id) {
            return setWallNodePoint(wall, pair.node, cutA, tolerance);
        }
        if (wall.id === pair.wallB.id) {
            return setWallNodePoint(wall, pair.node, cutB, tolerance);
        }
        return wall;
    });

    const bevelKey = nodeKey(pair.node);
    const cleanedWalls = nextWalls.filter((wall) => {
        if (!wall.isBevelSegment) return true;
        if (wall.bevelNodeKey !== bevelKey) return true;
        const sourceIds = wall.bevelSourceWallIds ?? [];
        return !(sourceIds.includes(pair.wallA.id) && sourceIds.includes(pair.wallB.id));
    });

    if (bevelLength <= 0.001) {
        return cleanedWalls;
    }

    const bevelWall: Wall2D = {
        id: buildBevelWallId(pair),
        start: cutA,
        end: cutB,
        thickness: Math.min(pair.wallA.thickness, pair.wallB.thickness),
        height: Math.min(pair.wallA.height, pair.wallB.height),
        wallType: pair.wallA.wallType,
        wallTypeId: pair.wallA.wallTypeId,
        wallLayers: pair.wallA.wallLayers ? pair.wallA.wallLayers.map((layer) => ({ ...layer })) : undefined,
        isWallTypeOverride: pair.wallA.isWallTypeOverride || pair.wallB.isWallTypeOverride,
        material: pair.wallA.material ?? pair.wallB.material,
        color: pair.wallA.color ?? pair.wallB.color,
        layer: pair.wallA.layer ?? pair.wallB.layer,
        openings: [],
        isBevelSegment: true,
        bevelNodeKey: bevelKey,
        bevelSourceWallIds: [pair.wallA.id, pair.wallB.id],
        interiorSide: pair.wallA.interiorSide,
        exteriorSide: pair.wallA.exteriorSide,
    };

    cleanedWalls.push(bevelWall);
    return cleanedWalls;
}

export function applyCornerCenterDrag(
    sourceWalls: Wall2D[],
    pair: CornerPair,
    geometry: CornerControlGeometry,
    pointer: Point2D,
    moveNode: (walls: Wall2D[], sourceNode: Point2D, targetNode: Point2D, tolerance: number) => Wall2D[],
    tolerance = 0.5
): Wall2D[] | null {
    const radial = geometry.centerRadial;
    if (!radial) return null;
    const projected = projectDeltaOnNormal(
        { x: pointer.x - geometry.center.x, y: pointer.y - geometry.center.y },
        radial
    );
    const nextNode = {
        x: pair.node.x + radial.x * projected,
        y: pair.node.y + radial.y * projected,
    };

    const movedWalls = moveNode(sourceWalls, pair.node, nextNode, tolerance);
    const movedPair = resolveCornerPair(movedWalls, nextNode, [pair.wallA.id, pair.wallB.id], tolerance);
    if (!movedPair) return null;
    const nextAngle = calculateAngleDeg(movedPair.awayA, movedPair.awayB);
    if (nextAngle < CORNER_MIN_ANGLE_DEG || nextAngle > CORNER_MAX_ANGLE_DEG) {
        return null;
    }

    return movedWalls;
}
