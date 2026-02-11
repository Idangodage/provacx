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
import { useRef, useCallback, useEffect } from 'react';

import type { Point2D, Wall2D, Room2D, WallTypeDefinition, DisplayUnit } from '../../../types';
import { detectRoomsFromWallGraph, validateNestedRooms } from '../../../utils/room-detection';
import { createWallFromTypeDefaults } from '../../../utils/wall-types';
import {
    distanceBetween,
    findWallSnapTarget,
    applyOrthogonalConstraint,
    clearWallRubberBandPreview,
    clearSnapHighlight,
    renderWallRubberBandPreview,
    renderSnapHighlight,
    splitWallAtPoint,
    rebuildWallAdjacency,
    addEdgeWithWallReuse,
} from '../index';
import type { WallSnapTarget } from '../snapping';

const WALL_SNAP_THRESHOLD_PX = 10;
const WALL_SNAP_RELEASE_MULTIPLIER = 1.6;
const WALL_ENDPOINT_TOLERANCE = 0.5;
const ROOM_EDGE_OVERLAP_TOLERANCE = 0.5;

interface RubberBandPreviewState {
    anchor: Point2D | null;
    cursor: Point2D | null;
    thickness: number;
    interiorSideHint: 'left' | 'right' | null;
    visible: boolean;
}

export interface UseWallModeOptions {
    fabricRef: React.RefObject<FabricCanvas | null>;
    wallsRef: React.MutableRefObject<Wall2D[]>;
    roomsRef: React.MutableRefObject<Room2D[]>;
    zoomRef: React.MutableRefObject<number>;
    activeLayerId: string | null;
    activeWallTypeId: string;
    wallTypeRegistry: WallTypeDefinition[];
    displayUnit: DisplayUnit;
    paperToRealRatio: number;
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
    paperToRealRatio,
    setWalls,
    notifyRoomValidation,
}: UseWallModeOptions) {
    const wallChainStartRef = useRef<Point2D | null>(null);
    const wallChainActiveRef = useRef(false);
    const snapTargetRef = useRef<WallSnapTarget | null>(null);
    const hoverSnapTargetRef = useRef<WallSnapTarget | null>(null);
    const previewStateRef = useRef<RubberBandPreviewState>({
        anchor: null,
        cursor: null,
        thickness: 0,
        interiorSideHint: null,
        visible: false,
    });
    const previewFrameRef = useRef<number | null>(null);
    const previousCommittedVectorRef = useRef<Point2D | null>(null);

    const cancelPreviewFrame = useCallback(() => {
        if (previewFrameRef.current === null || typeof window === 'undefined') return;
        window.cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
    }, []);

    const flushPreviewFrame = useCallback(() => {
        previewFrameRef.current = null;
        const canvas = fabricRef.current;
        if (!canvas) return;

        const previewState = previewStateRef.current;
        if (!previewState.visible || !previewState.anchor || !previewState.cursor) {
            clearWallRubberBandPreview(canvas, true);
            return;
        }

        renderWallRubberBandPreview(
            canvas,
            previewState.anchor,
            previewState.cursor,
            previewState.thickness,
            displayUnit,
            paperToRealRatio,
            activeWallTypeId,
            wallTypeRegistry,
            previewState.interiorSideHint,
            zoomRef.current,
            true
        );
    }, [fabricRef, zoomRef, displayUnit, paperToRealRatio, activeWallTypeId, wallTypeRegistry]);

    const schedulePreviewFrame = useCallback(() => {
        if (typeof window === 'undefined') return;
        if (previewFrameRef.current !== null) return;
        previewFrameRef.current = window.requestAnimationFrame(flushPreviewFrame);
    }, [flushPreviewFrame]);

    const setRubberBandPreview = useCallback(
        (
            anchor: Point2D,
            cursor: Point2D,
            thickness: number,
            interiorSideHint: 'left' | 'right' | null,
            immediate = false
        ) => {
            previewStateRef.current = { anchor, cursor, thickness, interiorSideHint, visible: true };
            if (immediate) {
                cancelPreviewFrame();
                flushPreviewFrame();
                return;
            }
            schedulePreviewFrame();
        },
        [cancelPreviewFrame, flushPreviewFrame, schedulePreviewFrame]
    );

    const clearRubberBandPreview = useCallback(
        (shouldRender = true) => {
            previewStateRef.current = {
                anchor: null,
                cursor: null,
                thickness: 0,
                interiorSideHint: null,
                visible: false,
            };
            cancelPreviewFrame();
            const canvas = fabricRef.current;
            if (!canvas) return;
            clearWallRubberBandPreview(canvas, shouldRender);
        },
        [cancelPreviewFrame, fabricRef]
    );

    useEffect(() => {
        return () => {
            cancelPreviewFrame();
        };
    }, [cancelPreviewFrame]);

    const clearWallTransientOverlays = useCallback(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        clearRubberBandPreview(false);
        clearSnapHighlight(canvas, false);
        canvas.requestRenderAll();
    }, [fabricRef, clearRubberBandPreview]);

    const endWallChain = useCallback(() => {
        wallChainStartRef.current = null;
        wallChainActiveRef.current = false;
        snapTargetRef.current = null;
        hoverSnapTargetRef.current = null;
        previousCommittedVectorRef.current = null;
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
        (point: Point2D, isDoubleClick: boolean, shiftKey: boolean, totalThickness: number): boolean => {
            const canvas = fabricRef.current;
            if (!canvas) return false;

            if (isDoubleClick) {
                endWallChain();
                return true;
            }

            const chainStart = wallChainStartRef.current;
            const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
            const snapReleaseThresholdScene = snapThresholdScene * WALL_SNAP_RELEASE_MULTIPLIER;
            const heldSnapTarget = hoverSnapTargetRef.current;
            let snapTarget: WallSnapTarget | null = null;

            if (heldSnapTarget && distanceBetween(point, heldSnapTarget.point) <= snapReleaseThresholdScene) {
                snapTarget = heldSnapTarget;
            } else {
                snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
            }

            hoverSnapTargetRef.current = snapTarget;
            let targetPoint = snapTarget ? snapTarget.point : point;

            if (chainStart && shiftKey) {
                const orthogonalPoint = applyOrthogonalConstraint(chainStart, targetPoint);
                const orthogonalSnapTarget = findWallSnapTarget(orthogonalPoint, wallsRef.current, snapThresholdScene);
                if (orthogonalSnapTarget) {
                    snapTarget = orthogonalSnapTarget;
                    targetPoint = orthogonalSnapTarget.point;
                    hoverSnapTargetRef.current = orthogonalSnapTarget;
                } else {
                    snapTarget = null;
                    targetPoint = orthogonalPoint;
                    hoverSnapTargetRef.current = null;
                }
            }

            if (!chainStart) {
                wallChainStartRef.current = targetPoint;
                wallChainActiveRef.current = true;
                snapTargetRef.current = snapTarget;
                setRubberBandPreview(targetPoint, point, totalThickness, null, true);
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
                previousCommittedVectorRef.current = {
                    x: targetPoint.x - chainStart.x,
                    y: targetPoint.y - chainStart.y,
                };
                wallChainStartRef.current = targetPoint;
                wallChainActiveRef.current = true;
                snapTargetRef.current = snapTarget;
                const previewVector = { x: point.x - targetPoint.x, y: point.y - targetPoint.y };
                const previewCross =
                    previousCommittedVectorRef.current.x * previewVector.y -
                    previousCommittedVectorRef.current.y * previewVector.x;
                const interiorSideHint =
                    Math.abs(previewCross) <= 1e-6 ? 'right' : previewCross > 0 ? 'right' : 'left';
                setRubberBandPreview(targetPoint, point, totalThickness, interiorSideHint, true);
                if (snapTarget) {
                    renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
                } else {
                    clearSnapHighlight(canvas);
                }
            }
            return true;
        },
        [
            fabricRef,
            wallsRef,
            zoomRef,
            commitWallSegment,
            endWallChain,
            setRubberBandPreview,
        ]
    );

    const handleMouseMove = useCallback(
        (point: Point2D, shiftKey: boolean, totalThickness: number) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const chainStart = wallChainStartRef.current;
            const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
            const snapReleaseThresholdScene = snapThresholdScene * WALL_SNAP_RELEASE_MULTIPLIER;
            let workingPoint = point;
            const heldSnapTarget = hoverSnapTargetRef.current;
            let snapTarget: WallSnapTarget | null = null;
            if (heldSnapTarget && distanceBetween(workingPoint, heldSnapTarget.point) <= snapReleaseThresholdScene) {
                snapTarget = heldSnapTarget;
            } else {
                snapTarget = findWallSnapTarget(workingPoint, wallsRef.current, snapThresholdScene);
            }
            hoverSnapTargetRef.current = snapTarget;
            let targetPoint = snapTarget ? snapTarget.point : workingPoint;

            if (chainStart && shiftKey) {
                const orthogonalPoint = applyOrthogonalConstraint(chainStart, targetPoint);
                const heldOrthogonalSnap = hoverSnapTargetRef.current;
                const orthogonalSnapTarget =
                    heldOrthogonalSnap && distanceBetween(orthogonalPoint, heldOrthogonalSnap.point) <= snapReleaseThresholdScene
                        ? heldOrthogonalSnap
                        : findWallSnapTarget(orthogonalPoint, wallsRef.current, snapThresholdScene);
                if (orthogonalSnapTarget) {
                    snapTarget = orthogonalSnapTarget;
                    targetPoint = orthogonalSnapTarget.point;
                    workingPoint = orthogonalPoint;
                    hoverSnapTargetRef.current = orthogonalSnapTarget;
                } else {
                    snapTarget = null;
                    targetPoint = orthogonalPoint;
                    workingPoint = orthogonalPoint;
                    hoverSnapTargetRef.current = null;
                }
            }

            if (snapTarget) {
                renderSnapHighlight(canvas, snapTarget.point, zoomRef.current, !chainStart);
            } else {
                clearSnapHighlight(canvas, !chainStart);
            }

            if (chainStart) {
                // Preview endpoint tracks live cursor (or orthogonal-constrained cursor), while commit still uses snapped target.
                const previousVector = previousCommittedVectorRef.current;
                const previewVector = {
                    x: workingPoint.x - chainStart.x,
                    y: workingPoint.y - chainStart.y,
                };
                const interiorSideHint = (() => {
                    if (!previousVector) return null;
                    const crossValue = previousVector.x * previewVector.y - previousVector.y * previewVector.x;
                    if (Math.abs(crossValue) <= 1e-6) {
                        return 'right';
                    }
                    return crossValue > 0 ? 'right' : 'left';
                })();
                setRubberBandPreview(chainStart, workingPoint, totalThickness, interiorSideHint, false);
            } else {
                clearRubberBandPreview(false);
            }
        },
        [fabricRef, wallsRef, zoomRef, setRubberBandPreview, clearRubberBandPreview]
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
