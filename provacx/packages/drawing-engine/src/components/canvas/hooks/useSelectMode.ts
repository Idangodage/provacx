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
import { detectRoomsFromWallGraph, validateNestedRooms } from '../../../utils/room-detection';
import {
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

interface WallHandleDragSession {
    wallId: string;
    handleType: 'start' | 'end' | 'mid';
    originalWalls: Wall2D[];
    originalRooms: Room2D[];
    originalStart: Point2D;
    originalEnd: Point2D;
}

interface TargetMeta {
    name?: string;
    wallId?: string;
    roomId?: string;
    handleType?: 'start' | 'end' | 'mid';
}

export interface UseSelectModeOptions {
    fabricRef: React.RefObject<FabricCanvas | null>;
    wallsRef: React.MutableRefObject<Wall2D[]>;
    roomsRef: React.MutableRefObject<Room2D[]>;
    resolvedSnapToGrid: boolean;
    resolvedGridSize: number;
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
            roomId: typed?.roomId,
            handleType: typed?.handleType,
        };
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

        useSmartDrawingStore.getState().saveToHistory('Edit wall');
        wallHandleDragRef.current = null;
        isWallHandleDraggingRef.current = false;
    }, [wallsRef, roomsRef, notifyRoomValidation]);

    const handleObjectMoving = useCallback(
        (target: FabricObject) => {
            const meta = getTargetMeta(target);
            if (meta.name !== 'wall-handle' || !meta.wallId || !meta.handleType) return;

            const wall = wallsRef.current.find((item) => item.id === meta.wallId);
            if (!wall) return;

            const center = target.getCenterPoint();
            const pointer = resolvedSnapToGrid
                ? snapPointToGrid({ x: center.x, y: center.y }, resolvedGridSize)
                : { x: center.x, y: center.y };

            const targetRadius = Number((target as FabricCircle).get('radius')) || HANDLE_HIT_RADIUS;
            target.set({
                left: pointer.x - targetRadius,
                top: pointer.y - targetRadius,
            });
            target.setCoords();

            if (
                !wallHandleDragRef.current ||
                wallHandleDragRef.current.wallId !== meta.wallId ||
                wallHandleDragRef.current.handleType !== meta.handleType
            ) {
                wallHandleDragRef.current = {
                    wallId: meta.wallId,
                    handleType: meta.handleType,
                    originalWalls: wallsRef.current.map((item) => ({
                        ...item,
                        start: { ...item.start },
                        end: { ...item.end },
                    })),
                    originalRooms: roomsRef.current.map((room) => ({
                        ...room,
                        vertices: room.vertices.map((vertex) => ({ ...vertex })),
                        wallIds: [...room.wallIds],
                        childRoomIds: [...room.childRoomIds],
                    })),
                    originalStart: { ...wall.start },
                    originalEnd: { ...wall.end },
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
            } else {
                const originalMid = {
                    x: (dragSession.originalStart.x + dragSession.originalEnd.x) / 2,
                    y: (dragSession.originalStart.y + dragSession.originalEnd.y) / 2,
                };
                const delta = { x: pointer.x - originalMid.x, y: pointer.y - originalMid.y };
                nextWalls = moveConnectedNode(
                    nextWalls,
                    dragSession.originalStart,
                    { x: dragSession.originalStart.x + delta.x, y: dragSession.originalStart.y + delta.y },
                    WALL_ENDPOINT_TOLERANCE
                );
                nextWalls = moveConnectedNode(
                    nextWalls,
                    dragSession.originalEnd,
                    { x: dragSession.originalEnd.x + delta.x, y: dragSession.originalEnd.y + delta.y },
                    WALL_ENDPOINT_TOLERANCE
                );
            }

            nextWalls = nextWalls.filter((candidate) => distanceBetween(candidate.start, candidate.end) > 0.001);
            nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);
            applyTransientWallGraph(nextWalls);
            setSelectedIds([meta.wallId]);
        },
        [wallsRef, roomsRef, resolvedSnapToGrid, resolvedGridSize, getTargetMeta, applyTransientWallGraph, setSelectedIds]
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
            if (meta.name === 'wall-render' || meta.name === 'wall-handle') {
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
