/**
 * useSelectMode Hook
 *
 * Handles selection mode interactions:
 * - Wall and room selection
 * - Wall handle dragging for editing
 * - Room hover tooltips
 */

import type { Canvas as FabricCanvas, Object as FabricObject, Circle as FabricCircle } from 'fabric';
import { useRef, useCallback } from 'react';

import { useSmartDrawingStore } from '../../../store';
import type { Point2D, Wall2D, Room2D } from '../../../types';
import { applyCornerAngleDrag } from '../../../utils/corner-constraints';
import { detectRoomsFromWallGraph, validateNestedRooms } from '../../../utils/room-detection';
import { WallEditorEngine } from '../../../utils/wall-editing';
import {
    MM_TO_PX,
    distanceBetween,
    deriveNestedRelationWarnings,
    pickSmallestRoomAtPoint,
    snapPointToGrid,
    rebuildWallAdjacency,
    moveConnectedNode,
    getScenePointFromMouseEvent,
} from '../index';

const WALL_ENDPOINT_TOLERANCE = 0.5;
const HANDLE_HIT_RADIUS = 7;
const MIN_WALL_THICKNESS_MM = 1;
const ANGLE_SNAP_VALUES = [90, 45, 30, 60, 120, 135, 150];

type WallHandleType =
    | 'start'
    | 'end'
    | 'mid'
    | 'vertex'
    | 'thickness-positive'
    | 'thickness-negative'
    | 'corner-angle';

interface WallHandleDragSession {
    wallId: string;
    handleType: WallHandleType;
    originalWalls: Wall2D[];
    originalRooms: Room2D[];
    originalStart: Point2D;
    originalEnd: Point2D;
    originalMid: Point2D;
    originalThickness: number;
    sourceNode?: Point2D;
    handleMeta?: Record<string, unknown>;
}

interface TargetMeta {
    name?: string;
    wallId?: string;
    wallIds?: string[];
    roomId?: string;
    nodePoint?: Point2D;
    handleType?: string;
    handleMeta?: Record<string, unknown>;
}

export interface UseSelectModeOptions {
    fabricRef: React.RefObject<FabricCanvas | null>;
    wallsRef: React.MutableRefObject<Wall2D[]>;
    roomsRef: React.MutableRefObject<Room2D[]>;
    resolvedSnapToGrid: boolean;
    resolvedGridSize: number;
    paperToRealRatio: number;
    setSelectedIds: (ids: string[]) => void;
    notifyRoomValidation: (messages: string[], title: string, blocking?: boolean) => void;
    setHoveredRoomInfo: React.Dispatch<React.SetStateAction<{
        id: string;
        name: string;
        area: number;
        perimeter: number;
        screenX: number;
        screenY: number;
    } | null>>;
    setHoveredElement: (id: string | null) => void;
    originOffset: { x: number; y: number };
}

export function useSelectMode({
    fabricRef,
    wallsRef,
    roomsRef,
    resolvedSnapToGrid,
    resolvedGridSize,
    paperToRealRatio,
    setSelectedIds,
    notifyRoomValidation,
    setHoveredRoomInfo,
    setHoveredElement,
    originOffset,
}: UseSelectModeOptions) {
    const wallHandleDragRef = useRef<WallHandleDragSession | null>(null);
    const isWallHandleDraggingRef = useRef(false);

    const getTargetMeta = useCallback((target: FabricObject | undefined | null): TargetMeta => {
        const typed = target as unknown as TargetMeta;
        return {
            name: typed?.name,
            wallId: typed?.wallId,
            wallIds: typed?.wallIds,
            roomId: typed?.roomId,
            nodePoint: typed?.nodePoint,
            handleType: typed?.handleType,
            handleMeta: typed?.handleMeta,
        };
    }, []);

    const cloneWalls = useCallback((input: Wall2D[]): Wall2D[] => (
        input.map((item) => ({
            ...item,
            start: { ...item.start },
            end: { ...item.end },
            connectedWallIds: item.connectedWallIds ? [...item.connectedWallIds] : item.connectedWallIds,
            openings: item.openings.map((opening) => ({ ...opening })),
            wallLayers: item.wallLayers ? item.wallLayers.map((layer) => ({ ...layer })) : item.wallLayers,
        }))
    ), []);

    const cloneRooms = useCallback((input: Room2D[]): Room2D[] => (
        input.map((room) => ({
            ...room,
            vertices: room.vertices.map((vertex) => ({ ...vertex })),
            wallIds: [...room.wallIds],
            childRoomIds: [...room.childRoomIds],
        }))
    ), []);

    const normalizeWallHandleType = useCallback((value?: string): WallHandleType | null => {
        if (!value) return null;
        if (value === 'start' || value === 'wall-start') return 'start';
        if (value === 'end' || value === 'wall-end') return 'end';
        if (value === 'mid' || value === 'wall-midpoint') return 'mid';
        if (value === 'thickness-positive' || value === 'wall-thickness-positive') return 'thickness-positive';
        if (value === 'thickness-negative' || value === 'wall-thickness-negative') return 'thickness-negative';
        if (value === 'corner-angle') return 'corner-angle';
        if (value === 'vertex') return 'vertex';
        return null;
    }, []);

    const wallDirectionNormal = useCallback((start: Point2D, end: Point2D): Point2D | null => {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length <= 0.000001) return null;
        return { x: -dy / length, y: dx / length };
    }, []);

    const projectionOnNormal = useCallback((origin: Point2D, target: Point2D, normal: Point2D): number => (
        (target.x - origin.x) * normal.x + (target.y - origin.y) * normal.y
    ), []);

    const thicknessMmToScenePx = useCallback((thicknessMm: number): number => {
        const safeRatio = Number.isFinite(paperToRealRatio) && paperToRealRatio > 0 ? paperToRealRatio : 1;
        return (Math.max(thicknessMm, MIN_WALL_THICKNESS_MM) / safeRatio) * MM_TO_PX;
    }, [paperToRealRatio]);

    const thicknessScenePxToMm = useCallback((thicknessScenePx: number): number => {
        const safeRatio = Number.isFinite(paperToRealRatio) && paperToRealRatio > 0 ? paperToRealRatio : 1;
        return Math.max((thicknessScenePx / MM_TO_PX) * safeRatio, MIN_WALL_THICKNESS_MM);
    }, [paperToRealRatio]);

    const readPointFromMeta = useCallback((value: unknown): Point2D | null => {
        if (!value || typeof value !== 'object') return null;
        const point = value as { x?: unknown; y?: unknown };
        if (typeof point.x !== 'number' || typeof point.y !== 'number') return null;
        return { x: point.x, y: point.y };
    }, []);

    const updateSelectionFromTarget = useCallback(
        (target: FabricObject | undefined | null) => {
            const meta = getTargetMeta(target);
            if (meta.name === 'wall-render' && meta.wallId) {
                setSelectedIds([meta.wallId]);
                return;
            }
            if ((meta.name === 'room-region' || meta.name === 'room-tag') && meta.roomId) {
                setSelectedIds([meta.roomId]);
                return;
            }
            if (meta.name === 'wall-handle' && meta.wallId) {
                setSelectedIds([meta.wallId]);
                return;
            }
            if (meta.name === 'wall-vertex-marker' && meta.wallIds && meta.wallIds.length > 0) {
                setSelectedIds(meta.wallIds);
                return;
            }
            if (!target) {
                setSelectedIds([]);
            }
        },
        [getTargetMeta, setSelectedIds]
    );

    const applyTransientWallGraph = useCallback((nextWalls: Wall2D[]) => {
        const nextRooms = detectRoomsFromWallGraph(nextWalls, roomsRef.current);
        wallsRef.current = nextWalls;
        roomsRef.current = nextRooms;
        useSmartDrawingStore.setState({ walls: nextWalls, rooms: nextRooms });
    }, [wallsRef, roomsRef]);

    const finalizeHandleDrag = useCallback(() => {
        const dragSession = wallHandleDragRef.current;
        if (!dragSession) {
            isWallHandleDraggingRef.current = false;
            return;
        }

        const currentRooms = roomsRef.current;
        const validation = validateNestedRooms(currentRooms);
        if (validation.errors.length > 0) {
            notifyRoomValidation(validation.errors, 'Invalid room edit. Reverting changes:', true);
            wallsRef.current = dragSession.originalWalls;
            roomsRef.current = dragSession.originalRooms;
            useSmartDrawingStore.setState({
                walls: dragSession.originalWalls,
                rooms: dragSession.originalRooms,
                selectedElementIds: [dragSession.wallId],
                selectedIds: [dragSession.wallId],
            });
            wallHandleDragRef.current = null;
            isWallHandleDraggingRef.current = false;
            return;
        }

        const relationWarnings = deriveNestedRelationWarnings(dragSession.originalRooms, currentRooms);
        const warningMessages = [...validation.warnings, ...relationWarnings];
        if (warningMessages.length > 0) {
            notifyRoomValidation(warningMessages, 'Room warning:');
        }

        useSmartDrawingStore.getState().setWalls(wallsRef.current, 'Edit wall');
        wallHandleDragRef.current = null;
        isWallHandleDraggingRef.current = false;
    }, [wallsRef, roomsRef, notifyRoomValidation]);

    const handleObjectMoving = useCallback(
        (target: FabricObject) => {
            const meta = getTargetMeta(target);
            if (meta.name === 'wall-vertex-marker' && meta.nodePoint) {
                const center = target.getCenterPoint();
                const pointer = resolvedSnapToGrid
                    ? snapPointToGrid({ x: center.x, y: center.y }, resolvedGridSize)
                    : { x: center.x, y: center.y };
                const markerWidth = Number(target.get('width')) || HANDLE_HIT_RADIUS;
                const markerScaleX = Number(target.get('scaleX')) || 1;
                const markerHalf = (markerWidth * markerScaleX) / 2;
                target.set({
                    left: pointer.x - markerHalf,
                    top: pointer.y - markerHalf,
                });
                target.setCoords();

                if (
                    !wallHandleDragRef.current ||
                    wallHandleDragRef.current.handleType !== 'vertex' ||
                    !wallHandleDragRef.current.sourceNode ||
                    distanceBetween(wallHandleDragRef.current.sourceNode, meta.nodePoint) > WALL_ENDPOINT_TOLERANCE
                ) {
                    const sourceWallId = meta.wallIds?.[0];
                    if (!sourceWallId) return;
                    wallHandleDragRef.current = {
                        wallId: sourceWallId,
                        handleType: 'vertex',
                        originalWalls: cloneWalls(wallsRef.current),
                        originalRooms: cloneRooms(roomsRef.current),
                        originalStart: { ...meta.nodePoint },
                        originalEnd: { ...meta.nodePoint },
                        originalMid: { ...meta.nodePoint },
                        originalThickness: MIN_WALL_THICKNESS_MM,
                        sourceNode: { ...meta.nodePoint },
                    };
                }

                const dragSession = wallHandleDragRef.current;
                if (!dragSession?.sourceNode) return;
                isWallHandleDraggingRef.current = true;

                let nextWalls = moveConnectedNode(
                    dragSession.originalWalls,
                    dragSession.sourceNode,
                    pointer,
                    WALL_ENDPOINT_TOLERANCE
                );
                nextWalls = nextWalls.filter((candidate) => distanceBetween(candidate.start, candidate.end) > 0.001);
                nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);
                applyTransientWallGraph(nextWalls);
                setSelectedIds(meta.wallIds && meta.wallIds.length > 0 ? meta.wallIds : [dragSession.wallId]);
                return;
            }

            if (meta.name !== 'wall-handle' || !meta.wallId) return;
            const normalizedType = normalizeWallHandleType(meta.handleType);
            if (!normalizedType || normalizedType === 'vertex') return;

            const wall = wallsRef.current.find((item) => item.id === meta.wallId);
            if (!wall) return;

            const center = target.getCenterPoint();
            const rawPointer = { x: center.x, y: center.y };
            const snappedPointer = resolvedSnapToGrid
                ? snapPointToGrid(rawPointer, resolvedGridSize)
                : rawPointer;
            const pointer =
                normalizedType === 'thickness-positive' ||
                normalizedType === 'thickness-negative' ||
                normalizedType === 'corner-angle'
                    ? rawPointer
                    : snappedPointer;

            const targetRadius = Number((target as FabricCircle).get('radius')) || HANDLE_HIT_RADIUS;
            const setTargetPoint = (point: Point2D): void => {
                target.set({
                    left: point.x - targetRadius,
                    top: point.y - targetRadius,
                });
                target.setCoords();
            };
            setTargetPoint(pointer);

            if (
                !wallHandleDragRef.current ||
                wallHandleDragRef.current.wallId !== meta.wallId ||
                wallHandleDragRef.current.handleType !== normalizedType
            ) {
                wallHandleDragRef.current = {
                    wallId: meta.wallId,
                    handleType: normalizedType,
                    originalWalls: cloneWalls(wallsRef.current),
                    originalRooms: cloneRooms(roomsRef.current),
                    originalStart: { ...wall.start },
                    originalEnd: { ...wall.end },
                    originalMid: {
                        x: (wall.start.x + wall.end.x) / 2,
                        y: (wall.start.y + wall.end.y) / 2,
                    },
                    originalThickness: wall.thickness,
                    handleMeta: meta.handleMeta,
                };
            }

            const dragSession = wallHandleDragRef.current;
            if (!dragSession) return;
            isWallHandleDraggingRef.current = true;

            let nextWalls = dragSession.originalWalls;
            if (dragSession.handleType === 'start') {
                nextWalls = moveConnectedNode(nextWalls, dragSession.originalStart, pointer, WALL_ENDPOINT_TOLERANCE);
            } else if (dragSession.handleType === 'end') {
                nextWalls = moveConnectedNode(nextWalls, dragSession.originalEnd, pointer, WALL_ENDPOINT_TOLERANCE);
            } else if (dragSession.handleType === 'mid') {
                const normal = wallDirectionNormal(dragSession.originalStart, dragSession.originalEnd);
                if (normal) {
                    const offset = projectionOnNormal(dragSession.originalMid, pointer, normal);
                    const constrainedMid = {
                        x: dragSession.originalMid.x + normal.x * offset,
                        y: dragSession.originalMid.y + normal.y * offset,
                    };
                    setTargetPoint(constrainedMid);

                    const editor = new WallEditorEngine({
                        walls: dragSession.originalWalls,
                        rooms: dragSession.originalRooms,
                        selectedWallIds: [dragSession.wallId],
                        options: { nodeTolerance: WALL_ENDPOINT_TOLERANCE },
                    });
                    const moveResult = editor.moveWallPerpendicular(dragSession.wallId, offset, {
                        propagateToAdjacent: true,
                        collisionPolicy: 'allow',
                    });
                    if (moveResult.ok) {
                        nextWalls = moveResult.state.walls;
                    }
                }
            } else if (
                dragSession.handleType === 'thickness-positive' ||
                dragSession.handleType === 'thickness-negative'
            ) {
                const normal = wallDirectionNormal(dragSession.originalStart, dragSession.originalEnd);
                if (normal) {
                    const sideSign = dragSession.handleType === 'thickness-positive' ? 1 : -1;
                    const originalHalfPx = thicknessMmToScenePx(dragSession.originalThickness) / 2;
                    const originalHandlePoint = {
                        x: dragSession.originalMid.x + normal.x * originalHalfPx * sideSign,
                        y: dragSession.originalMid.y + normal.y * originalHalfPx * sideSign,
                    };
                    const deltaSigned = projectionOnNormal(originalHandlePoint, pointer, normal);
                    const nextHalfPx = Math.max(0.5, originalHalfPx + deltaSigned * sideSign);
                    const constrainedPointer = {
                        x: dragSession.originalMid.x + normal.x * nextHalfPx * sideSign,
                        y: dragSession.originalMid.y + normal.y * nextHalfPx * sideSign,
                    };
                    setTargetPoint(constrainedPointer);

                    const nextThickness = thicknessScenePxToMm(nextHalfPx * 2);
                    const editor = new WallEditorEngine({
                        walls: dragSession.originalWalls,
                        rooms: dragSession.originalRooms,
                        selectedWallIds: [dragSession.wallId],
                        options: { nodeTolerance: WALL_ENDPOINT_TOLERANCE },
                    });
                    const thicknessResult = editor.adjustWallThickness(dragSession.wallId, nextThickness, {
                        mode: 'centerline',
                        propagateToAdjacent: false,
                        collisionPolicy: 'allow',
                    });
                    if (thicknessResult.ok) {
                        nextWalls = thicknessResult.state.walls;
                    }
                }
            } else if (dragSession.handleType === 'corner-angle') {
                const cornerPoint = readPointFromMeta(dragSession.handleMeta?.cornerPoint);
                const neighborWallId =
                    typeof dragSession.handleMeta?.neighborWallId === 'string'
                        ? dragSession.handleMeta.neighborWallId
                        : null;
                const sourceWall = dragSession.originalWalls.find((candidate) => candidate.id === dragSession.wallId);
                if (cornerPoint && neighborWallId && sourceWall) {
                    const connectedToStart =
                        distanceBetween(sourceWall.start, cornerPoint) <=
                        distanceBetween(sourceWall.end, cornerPoint);
                    const fixedEndpoint = connectedToStart ? sourceWall.end : sourceWall.start;
                    const referenceVector = {
                        x: fixedEndpoint.x - cornerPoint.x,
                        y: fixedEndpoint.y - cornerPoint.y,
                    };
                    const dragVector = {
                        x: pointer.x - cornerPoint.x,
                        y: pointer.y - cornerPoint.y,
                    };
                    const refLength = Math.hypot(referenceVector.x, referenceVector.y);
                    const dragLength = Math.hypot(dragVector.x, dragVector.y);
                    if (refLength > 0.001 && dragLength > 0.001) {
                        const dotValue =
                            (referenceVector.x * dragVector.x + referenceVector.y * dragVector.y) /
                            (refLength * dragLength);
                        const clamped = Math.max(-1, Math.min(1, dotValue));
                        const targetAngleDeg = (Math.acos(clamped) * 180) / Math.PI;
                        const solve = applyCornerAngleDrag(
                            dragSession.originalWalls,
                            {
                                wallAId: dragSession.wallId,
                                wallBId: neighborWallId,
                                corner: cornerPoint,
                                targetAngleDeg,
                                mode: 'min-movement',
                            },
                            {
                                tolerance: WALL_ENDPOINT_TOLERANCE,
                                maxIterations: 32,
                                snapAngles: ANGLE_SNAP_VALUES,
                                snapToleranceDeg: 3,
                                minAngleDeg: 5,
                                maxAngleDeg: 175,
                                hardAngle: true,
                                preventIntersections: true,
                            }
                        );
                        const hasHardViolation = solve.violations.some(
                            (violation) => violation.severity === 'error'
                        );
                        if (!hasHardViolation) {
                            nextWalls = solve.walls;
                        }
                    }
                }
            }

            nextWalls = nextWalls.filter((candidate) => distanceBetween(candidate.start, candidate.end) > 0.001);
            nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);
            applyTransientWallGraph(nextWalls);
            setSelectedIds([meta.wallId]);
        },
        [
            wallsRef,
            roomsRef,
            resolvedSnapToGrid,
            resolvedGridSize,
            getTargetMeta,
            normalizeWallHandleType,
            cloneWalls,
            cloneRooms,
            wallDirectionNormal,
            projectionOnNormal,
            thicknessMmToScenePx,
            thicknessScenePxToMm,
            readPointFromMeta,
            applyTransientWallGraph,
            setSelectedIds,
        ]
    );

    const handleDoubleClick = useCallback(
        (event: MouseEvent) => {
            const canvas = fabricRef.current;
            if (!canvas) return false;

            const scenePoint = getScenePointFromMouseEvent(canvas, event);
            const room = pickSmallestRoomAtPoint(scenePoint, roomsRef.current);
            if (!room) return false;

            event.preventDefault();
            setSelectedIds([room.id]);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(
                    new CustomEvent('smart-drawing:open-room-properties', { detail: { roomId: room.id } })
                );
            }
            return true;
        },
        [fabricRef, roomsRef, setSelectedIds]
    );

    const handleMouseDown = useCallback(
        (target: FabricObject | undefined | null, scenePoint: Point2D) => {
            const meta = getTargetMeta(target);
            if (meta.name === 'wall-render' || meta.name === 'wall-handle' || meta.name === 'wall-vertex-marker') {
                updateSelectionFromTarget(target);
                return;
            }

            const roomAtPoint = pickSmallestRoomAtPoint(scenePoint, roomsRef.current);
            if (roomAtPoint) {
                setSelectedIds([roomAtPoint.id]);
                return;
            }

            updateSelectionFromTarget(target);
        },
        [roomsRef, getTargetMeta, updateSelectionFromTarget, setSelectedIds]
    );

    const handleRoomHover = useCallback(
        (point: Point2D, viewportPoint: { x: number; y: number }) => {
            const hoveredRoom = pickSmallestRoomAtPoint(point, roomsRef.current);
            if (hoveredRoom) {
                const nextInfo = {
                    id: hoveredRoom.id,
                    name: hoveredRoom.name,
                    area: Number.isFinite(hoveredRoom.netArea) ? hoveredRoom.netArea : hoveredRoom.area,
                    perimeter: hoveredRoom.perimeter,
                    screenX: viewportPoint.x + originOffset.x + 14,
                    screenY: viewportPoint.y + originOffset.y + 14,
                };
                setHoveredRoomInfo((prev) => {
                    if (prev && prev.id === nextInfo.id && Math.abs(prev.screenX - nextInfo.screenX) < 0.5 && Math.abs(prev.screenY - nextInfo.screenY) < 0.5) {
                        return prev;
                    }
                    return nextInfo;
                });
                setHoveredElement(hoveredRoom.id);
            } else {
                setHoveredRoomInfo(null);
                setHoveredElement(null);
            }
        },
        [roomsRef, originOffset, setHoveredRoomInfo, setHoveredElement]
    );

    return {
        wallHandleDragRef,
        isWallHandleDraggingRef,
        getTargetMeta,
        updateSelectionFromTarget,
        applyTransientWallGraph,
        finalizeHandleDrag,
        handleObjectMoving,
        handleDoubleClick,
        handleMouseDown,
        handleRoomHover,
    };
}
