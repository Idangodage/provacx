/**
 * Geometry Helpers Hook
 *
 * Pure geometry utility callbacks: point-to-segment projection,
 * room boundary distance, perimeter wall resolution, wall placement snap,
 * and opening hit-testing.
 */

import { useCallback } from 'react';

import type { Point2D, Room, Wall } from '../../../types';
import { OPENING_HIT_PADDING_MM } from '../../DrawingCanvas.types';
import { MM_TO_PX } from '../scale';

export interface UseGeometryHelpersOptions {
    walls: Wall[];
    rooms: Room[];
    roomById: Map<string, Room>;
    wallById: Map<string, Wall>;
    wallIdSet: Set<string>;
    viewportZoom: number;
}

export interface PointProjection {
    projected: Point2D;
    t: number;
    distance: number;
}

export interface WallPlacementSnap {
    wall: Wall;
    point: Point2D;
    t: number;
    distance: number;
    angleDeg: number;
    normal: Point2D;
    wallLength: number;
}

export interface UseGeometryHelpersResult {
    projectPointToSegment: (point: Point2D, start: Point2D, end: Point2D) => PointProjection;
    roomBoundaryDistance: (point: Point2D, vertices: Point2D[]) => number;
    perimeterWallIdsForRooms: (roomIds: string[]) => string[];
    findWallPlacementSnap: (point: Point2D) => WallPlacementSnap | null;
    findOpeningAtPoint: (point: Point2D) => { openingId: string; wallId: string } | null;
}

export function useGeometryHelpers(options: UseGeometryHelpersOptions): UseGeometryHelpersResult {
    const { walls, roomById, wallById, wallIdSet, viewportZoom } = options;

    const projectPointToSegment = useCallback((point: Point2D, start: Point2D, end: Point2D): PointProjection => {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 0.000001) {
            return {
                projected: { ...start },
                t: 0,
                distance: Math.hypot(point.x - start.x, point.y - start.y),
            };
        }
        const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq));
        const projected = {
            x: start.x + dx * t,
            y: start.y + dy * t,
        };
        const distance = Math.hypot(point.x - projected.x, point.y - projected.y);
        return { projected, t, distance };
    }, []);

    const roomBoundaryDistance = useCallback((point: Point2D, vertices: Point2D[]): number => {
        if (vertices.length < 2) return Number.POSITIVE_INFINITY;
        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < vertices.length; i += 1) {
            const start = vertices[i];
            const end = vertices[(i + 1) % vertices.length];
            if (!start || !end) continue;
            const projection = projectPointToSegment(point, start, end);
            if (projection.distance < best) {
                best = projection.distance;
            }
        }
        return best;
    }, [projectPointToSegment]);

    const perimeterWallIdsForRooms = useCallback((roomIds: string[]): string[] => {
        const pointsNear = (a: Point2D, b: Point2D, toleranceMm: number = 6) =>
            Math.hypot(a.x - b.x, a.y - b.y) <= toleranceMm;

        const wallMatchesEdge = (wall: Wall, start: Point2D, end: Point2D) =>
            (pointsNear(wall.startPoint, start) && pointsNear(wall.endPoint, end)) ||
            (pointsNear(wall.startPoint, end) && pointsNear(wall.endPoint, start));

        const unique = new Set<string>();
        roomIds.forEach((roomId) => {
            const room = roomById.get(roomId);
            if (!room) return;
            const matchedWallIds = new Set<string>();
            const candidateWalls = room.wallIds
                .map((wallId) => wallById.get(wallId))
                .filter((wall): wall is Wall => Boolean(wall));

            for (let index = 0; index < room.vertices.length; index += 1) {
                const start = room.vertices[index];
                const end = room.vertices[(index + 1) % room.vertices.length];
                if (!start || !end) continue;

                const matchedWall = candidateWalls.find((wall) => wallMatchesEdge(wall, start, end));
                if (matchedWall) {
                    matchedWallIds.add(matchedWall.id);
                }
            }

            const resolvedWallIds = matchedWallIds.size > 0
                ? Array.from(matchedWallIds)
                : room.wallIds.filter((wallId) => wallIdSet.has(wallId));

            resolvedWallIds.forEach((wallId) => unique.add(wallId));
        });
        return Array.from(unique);
    }, [roomById, wallById, wallIdSet]);

    const findWallPlacementSnap = useCallback((point: Point2D): WallPlacementSnap | null => {
        const maxSnapDistanceMm = Math.max(100, 72 / Math.max(viewportZoom, 0.01) / MM_TO_PX);
        let best: WallPlacementSnap | null = null;

        for (const wall of walls) {
            const projection = projectPointToSegment(point, wall.startPoint, wall.endPoint);
            if (projection.distance > maxSnapDistanceMm) continue;
            const angleDeg = (Math.atan2(
                wall.endPoint.y - wall.startPoint.y,
                wall.endPoint.x - wall.startPoint.x
            ) * 180) / Math.PI;
            const wallLength = Math.hypot(
                wall.endPoint.x - wall.startPoint.x,
                wall.endPoint.y - wall.startPoint.y
            ) || 1;
            const normal = {
                x: -(wall.endPoint.y - wall.startPoint.y) / wallLength,
                y: (wall.endPoint.x - wall.startPoint.x) / wallLength,
            };

            if (!best || projection.distance < best.distance) {
                best = {
                    wall,
                    point: projection.projected,
                    t: projection.t,
                    distance: projection.distance,
                    angleDeg,
                    normal,
                    wallLength,
                };
            }
        }
        return best;
    }, [walls, projectPointToSegment, viewportZoom]);

    const findOpeningAtPoint = useCallback((point: Point2D): { openingId: string; wallId: string } | null => {
        let best: { openingId: string; wallId: string; score: number } | null = null;
        for (const wall of walls) {
            if (wall.openings.length === 0) continue;
            const wallLength = Math.hypot(
                wall.endPoint.x - wall.startPoint.x,
                wall.endPoint.y - wall.startPoint.y
            );
            if (!Number.isFinite(wallLength) || wallLength <= 0.001) continue;

            const projection = projectPointToSegment(point, wall.startPoint, wall.endPoint);
            const alongWall = projection.t * wallLength;
            for (const opening of wall.openings) {
                const maxPerpendicularDistance = Math.max(
                    wall.thickness / 2 + OPENING_HIT_PADDING_MM,
                    opening.width + OPENING_HIT_PADDING_MM
                );
                if (projection.distance > maxPerpendicularDistance) continue;
                const halfWidth = opening.width / 2;
                const minAlong = opening.position - halfWidth - OPENING_HIT_PADDING_MM;
                const maxAlong = opening.position + halfWidth + OPENING_HIT_PADDING_MM;
                if (alongWall < minAlong || alongWall > maxAlong) continue;

                const edgeDistance = Math.abs(alongWall - opening.position) / Math.max(1, halfWidth);
                const score = projection.distance + edgeDistance * 30;
                if (!best || score < best.score) {
                    best = {
                        openingId: opening.id,
                        wallId: wall.id,
                        score,
                    };
                }
            }
        }

        if (!best) return null;
        return {
            openingId: best.openingId,
            wallId: best.wallId,
        };
    }, [walls, projectPointToSegment]);

    return {
        projectPointToSegment,
        roomBoundaryDistance,
        perimeterWallIdsForRooms,
        findWallPlacementSnap,
        findOpeningAtPoint,
    };
}
