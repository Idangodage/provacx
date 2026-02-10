/**
 * useRoomMode Hook
 *
 * Handles room drawing mode:
 * - Rectangle drawing (drag to create)
 * - Polygon drawing (click vertices)
 * - Room commitment from vertices
 */

import type { Canvas as FabricCanvas } from 'fabric';
import { useRef, useCallback } from 'react';

import type { Point2D, Wall2D, Room2D, WallTypeDefinition } from '../../../types';
import { detectRoomsFromWallGraph, validateNestedRooms } from '../../../utils/room-detection';
import { createWallFromTypeDefaults } from '../../../utils/wall-types';
import {
    arePointsClose,
    findWallSnapTarget,
    clearDrawingPreview,
    clearSnapHighlight,
    renderSnapHighlight,
    renderRoomRectanglePreview,
    renderRoomPolygonPreview,
    rebuildWallAdjacency,
    normalizeRoomVertices,
    buildClosedPolygonEdges,
    buildRectangleVertices,
    addEdgeWithWallReuse,
} from '../index';

const WALL_SNAP_THRESHOLD_PX = 10;
const WALL_ENDPOINT_TOLERANCE = 0.5;
const ROOM_EDGE_OVERLAP_TOLERANCE = 0.5;

export type RoomDrawMode = 'rectangle' | 'polygon';

export interface UseRoomModeOptions {
    fabricRef: React.RefObject<FabricCanvas | null>;
    wallsRef: React.MutableRefObject<Wall2D[]>;
    roomsRef: React.MutableRefObject<Room2D[]>;
    zoomRef: React.MutableRefObject<number>;
    activeLayerId: string | null;
    activeWallTypeId: string;
    wallTypeRegistry: WallTypeDefinition[];
    setWalls: (walls: Wall2D[], historyLabel?: string) => void;
    notifyRoomValidation: (messages: string[], title: string, blocking?: boolean) => void;
}

export function useRoomMode({
    fabricRef,
    wallsRef,
    roomsRef,
    zoomRef,
    activeLayerId,
    activeWallTypeId,
    wallTypeRegistry,
    setWalls,
    notifyRoomValidation,
}: UseRoomModeOptions) {
    const roomPolygonPointsRef = useRef<Point2D[]>([]);
    const roomPolygonHoverRef = useRef<Point2D | null>(null);

    const clearRoomPolygonState = useCallback(() => {
        roomPolygonPointsRef.current = [];
        roomPolygonHoverRef.current = null;
        const canvas = fabricRef.current;
        if (!canvas) return;
        clearDrawingPreview(canvas);
        clearSnapHighlight(canvas);
    }, [fabricRef]);

    const commitRoomFromVertices = useCallback(
        (vertices: Point2D[]) => {
            const normalizedVertices = normalizeRoomVertices(vertices);
            if (normalizedVertices.length < 3) return;

            const roomEdges = buildClosedPolygonEdges(normalizedVertices);
            if (roomEdges.length === 0) return;

            let nextWalls = [...wallsRef.current];
            roomEdges.forEach((edge) => {
                nextWalls = addEdgeWithWallReuse(
                    nextWalls,
                    edge.start,
                    edge.end,
                    activeLayerId ?? 'default',
                    ROOM_EDGE_OVERLAP_TOLERANCE,
                    { wallType: 'interior', ...createWallFromTypeDefaults(activeWallTypeId, wallTypeRegistry) }
                );
            });

            nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);
            const nextRooms = detectRoomsFromWallGraph(nextWalls, roomsRef.current);
            const validation = validateNestedRooms(nextRooms);
            if (validation.errors.length > 0) {
                notifyRoomValidation(validation.errors, 'Cannot create this room:', true);
                return;
            }
            if (validation.warnings.length > 0) {
                notifyRoomValidation(validation.warnings, 'Room warning:');
            }
            wallsRef.current = nextWalls;
            setWalls(nextWalls, 'Draw room');
        },
        [activeLayerId, activeWallTypeId, wallTypeRegistry, wallsRef, roomsRef, setWalls, notifyRoomValidation]
    );

    const handleRectangleMouseUp = useCallback(
        (startPoint: Point2D, endPoint: Point2D) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const vertices = buildRectangleVertices(startPoint, endPoint);
            commitRoomFromVertices(vertices);
            clearDrawingPreview(canvas);
        },
        [fabricRef, commitRoomFromVertices]
    );

    const handlePolygonMouseDown = useCallback(
        (point: Point2D, isDoubleClick: boolean): boolean => {
            const canvas = fabricRef.current;
            if (!canvas) return false;

            const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
            const snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
            const targetPoint = snapTarget ? snapTarget.point : point;

            if (snapTarget) {
                renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
            } else {
                clearSnapHighlight(canvas);
            }

            const polygonPoints = roomPolygonPointsRef.current;
            const closeThreshold = snapThresholdScene;

            if (isDoubleClick) {
                if (polygonPoints.length >= 2) {
                    const finalVertices = [...polygonPoints];
                    const lastVertex = finalVertices[finalVertices.length - 1];
                    if (!lastVertex || !arePointsClose(lastVertex, targetPoint, closeThreshold)) {
                        finalVertices.push(targetPoint);
                    }
                    commitRoomFromVertices(finalVertices);
                }
                clearRoomPolygonState();
                return true;
            }

            if (polygonPoints.length === 0) {
                roomPolygonPointsRef.current = [targetPoint];
                roomPolygonHoverRef.current = targetPoint;
                renderRoomPolygonPreview(canvas, roomPolygonPointsRef.current, roomPolygonHoverRef.current);
                return true;
            }

            const firstPoint = polygonPoints[0];
            if (firstPoint && polygonPoints.length >= 3 && arePointsClose(firstPoint, targetPoint, closeThreshold)) {
                commitRoomFromVertices(polygonPoints);
                clearRoomPolygonState();
                return true;
            }

            const lastPoint = polygonPoints[polygonPoints.length - 1];
            if (lastPoint && arePointsClose(lastPoint, targetPoint, closeThreshold)) {
                return true;
            }

            const nextPolygon = [...polygonPoints, targetPoint];
            roomPolygonPointsRef.current = nextPolygon;
            roomPolygonHoverRef.current = targetPoint;
            renderRoomPolygonPreview(canvas, nextPolygon, roomPolygonHoverRef.current);
            return true;
        },
        [fabricRef, wallsRef, zoomRef, commitRoomFromVertices, clearRoomPolygonState]
    );

    const handleRectangleMouseDown = useCallback(
        (point: Point2D): Point2D => {
            const canvas = fabricRef.current;
            if (!canvas) return point;

            const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
            const snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
            const targetPoint = snapTarget ? snapTarget.point : point;

            if (snapTarget) {
                renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
            } else {
                clearSnapHighlight(canvas);
            }

            return targetPoint;
        },
        [fabricRef, wallsRef, zoomRef]
    );

    const handleRectangleMouseMove = useCallback(
        (startPoint: Point2D, currentPoint: Point2D): Point2D => {
            const canvas = fabricRef.current;
            if (!canvas) return currentPoint;

            const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
            const snapTarget = findWallSnapTarget(currentPoint, wallsRef.current, snapThresholdScene);
            const targetPoint = snapTarget ? snapTarget.point : currentPoint;

            if (snapTarget) {
                renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
            } else {
                clearSnapHighlight(canvas);
            }

            renderRoomRectanglePreview(canvas, startPoint, targetPoint);
            return targetPoint;
        },
        [fabricRef, wallsRef, zoomRef]
    );

    const handlePolygonMouseMove = useCallback(
        (point: Point2D) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
            const snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
            const targetPoint = snapTarget ? snapTarget.point : point;

            if (snapTarget) {
                renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
            } else {
                clearSnapHighlight(canvas);
            }

            const polygonPoints = roomPolygonPointsRef.current;
            roomPolygonHoverRef.current = targetPoint;
            renderRoomPolygonPreview(canvas, polygonPoints, targetPoint);
        },
        [fabricRef, wallsRef, zoomRef]
    );

    return {
        roomPolygonPointsRef,
        roomPolygonHoverRef,
        clearRoomPolygonState,
        commitRoomFromVertices,
        handleRectangleMouseDown,
        handleRectangleMouseMove,
        handleRectangleMouseUp,
        handlePolygonMouseDown,
        handlePolygonMouseMove,
    };
}
