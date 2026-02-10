/**
 * useWallMode Hook
 *
 * Handles wall drawing mode:
 * - Wall chain creation
 * - Snapping to existing walls/grid
 * - Orthogonal constraints (shift key)
 * - Wall segment commitment
 */

import type { Canvas as FabricCanvas } from 'fabric';
import { useRef, useCallback } from 'react';

import type { Point2D, Wall2D, Room2D, WallTypeDefinition, DisplayUnit } from '../../../types';
import { detectRoomsFromWallGraph, validateNestedRooms } from '../../../utils/room-detection';
import { createWallFromTypeDefaults } from '../../../utils/wall-types';
import {
    distanceBetween,
    findWallSnapTarget,
    applyOrthogonalConstraint,
    clearDrawingPreview,
    clearSnapHighlight,
    renderWallPreview,
    renderSnapHighlight,
    splitWallAtPoint,
    rebuildWallAdjacency,
    addEdgeWithWallReuse,
} from '../index';
import type { WallSnapTarget } from '../snapping';

const WALL_SNAP_THRESHOLD_PX = 10;
const WALL_ENDPOINT_TOLERANCE = 0.5;
const ROOM_EDGE_OVERLAP_TOLERANCE = 0.5;

export interface UseWallModeOptions {
    fabricRef: React.RefObject<FabricCanvas | null>;
    wallsRef: React.MutableRefObject<Wall2D[]>;
    roomsRef: React.MutableRefObject<Room2D[]>;
    zoomRef: React.MutableRefObject<number>;
    activeLayerId: string | null;
    activeWallTypeId: string;
    wallTypeRegistry: WallTypeDefinition[];
    displayUnit: DisplayUnit;
    setWalls: (walls: Wall2D[], historyLabel?: string) => void;
    notifyRoomValidation: (messages: string[], title: string, blocking?: boolean) => void;
}

export function useWallMode({
    fabricRef,
    wallsRef,
    roomsRef,
    zoomRef,
    activeLayerId,
    activeWallTypeId,
    wallTypeRegistry,
    displayUnit,
    setWalls,
    notifyRoomValidation,
}: UseWallModeOptions) {
    const wallChainStartRef = useRef<Point2D | null>(null);
    const wallChainActiveRef = useRef(false);
    const snapTargetRef = useRef<WallSnapTarget | null>(null);

    const clearWallTransientOverlays = useCallback(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        clearDrawingPreview(canvas);
        clearSnapHighlight(canvas);
    }, [fabricRef]);

    const endWallChain = useCallback(() => {
        wallChainStartRef.current = null;
        wallChainActiveRef.current = false;
        snapTargetRef.current = null;
        clearWallTransientOverlays();
    }, [clearWallTransientOverlays]);

    const commitWallSegment = useCallback(
        (startPoint: Point2D, endPoint: Point2D, startSnap: WallSnapTarget | null, endSnap: WallSnapTarget | null) => {
            if (distanceBetween(startPoint, endPoint) <= 0.001) return;

            let nextWalls = [...wallsRef.current];
            const processedSplitWallIds = new Set<string>();

            [startSnap, endSnap].forEach((snapTarget) => {
                if (!snapTarget || snapTarget.type === 'endpoint') return;
                if (processedSplitWallIds.has(snapTarget.wallId)) return;

                const wallIndex = nextWalls.findIndex((wall) => wall.id === snapTarget.wallId);
                if (wallIndex < 0) return;

                const sourceWall = nextWalls[wallIndex];
                if (!sourceWall) return;
                const splitResult = splitWallAtPoint(sourceWall, snapTarget.point, activeLayerId ?? 'default');
                if (!splitResult) return;

                nextWalls.splice(wallIndex, 1, splitResult.first, splitResult.second);
                processedSplitWallIds.add(snapTarget.wallId);
            });

            nextWalls = addEdgeWithWallReuse(
                nextWalls,
                startPoint,
                endPoint,
                activeLayerId ?? 'default',
                ROOM_EDGE_OVERLAP_TOLERANCE,
                { wallType: 'interior', ...createWallFromTypeDefaults(activeWallTypeId, wallTypeRegistry) }
            );
            nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);

            const nextRooms = detectRoomsFromWallGraph(nextWalls, roomsRef.current);
            const validation = validateNestedRooms(nextRooms);
            if (validation.errors.length > 0) {
                notifyRoomValidation(validation.errors, 'Cannot create this wall segment:', true);
                return;
            }
            if (validation.warnings.length > 0) {
                notifyRoomValidation(validation.warnings, 'Room warning:');
            }

            wallsRef.current = nextWalls;
            setWalls(nextWalls, 'Draw wall');
        },
        [activeLayerId, activeWallTypeId, wallTypeRegistry, wallsRef, roomsRef, setWalls, notifyRoomValidation]
    );

    const handleMouseDown = useCallback(
        (point: Point2D, isDoubleClick: boolean, shiftKey: boolean): boolean => {
            const canvas = fabricRef.current;
            if (!canvas) return false;

            if (isDoubleClick) {
                endWallChain();
                return true;
            }

            const chainStart = wallChainStartRef.current;
            const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
            let snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
            let targetPoint = snapTarget ? snapTarget.point : point;

            if (chainStart && shiftKey) {
                const orthogonalPoint = applyOrthogonalConstraint(chainStart, targetPoint);
                const orthogonalSnapTarget = findWallSnapTarget(orthogonalPoint, wallsRef.current, snapThresholdScene);
                if (orthogonalSnapTarget) {
                    snapTarget = orthogonalSnapTarget;
                    targetPoint = orthogonalSnapTarget.point;
                } else {
                    snapTarget = null;
                    targetPoint = orthogonalPoint;
                }
            }

            if (!chainStart) {
                wallChainStartRef.current = targetPoint;
                wallChainActiveRef.current = true;
                snapTargetRef.current = snapTarget;
                clearDrawingPreview(canvas);
                if (snapTarget) {
                    renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
                } else {
                    clearSnapHighlight(canvas);
                }
                return true;
            }

            const segmentLength = distanceBetween(chainStart, targetPoint);
            if (segmentLength > 0.001) {
                commitWallSegment(chainStart, targetPoint, snapTargetRef.current, snapTarget);
                wallChainStartRef.current = targetPoint;
                wallChainActiveRef.current = true;
                snapTargetRef.current = snapTarget;
                clearDrawingPreview(canvas);
                if (snapTarget) {
                    renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
                } else {
                    clearSnapHighlight(canvas);
                }
            }
            return true;
        },
        [fabricRef, wallsRef, zoomRef, commitWallSegment, endWallChain]
    );

    const handleMouseMove = useCallback(
        (point: Point2D, shiftKey: boolean, totalThickness: number) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const chainStart = wallChainStartRef.current;
            const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
            let snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
            let targetPoint = snapTarget ? snapTarget.point : point;

            if (chainStart && shiftKey) {
                const orthogonalPoint = applyOrthogonalConstraint(chainStart, targetPoint);
                const orthogonalSnapTarget = findWallSnapTarget(orthogonalPoint, wallsRef.current, snapThresholdScene);
                if (orthogonalSnapTarget) {
                    snapTarget = orthogonalSnapTarget;
                    targetPoint = orthogonalSnapTarget.point;
                } else {
                    snapTarget = null;
                    targetPoint = orthogonalPoint;
                }
            }

            if (snapTarget) {
                renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
            } else {
                clearSnapHighlight(canvas);
            }

            if (chainStart && distanceBetween(chainStart, targetPoint) > 0.001) {
                renderWallPreview(canvas, chainStart, targetPoint, totalThickness, displayUnit);
            } else {
                clearDrawingPreview(canvas);
            }
        },
        [fabricRef, wallsRef, zoomRef, displayUnit]
    );

    return {
        wallChainStartRef,
        wallChainActiveRef,
        snapTargetRef,
        endWallChain,
        handleMouseDown,
        handleMouseMove,
        clearWallTransientOverlays,
    };
}
