/**
 * useSelectMode Hook
 *
 * Handles selection mode interactions:
 * - Wall and room selection (single/multi/range)
 * - Wall handle dragging for editing
 * - Wall box selection for area-based selection
 * - Room hover tooltips
 */

import * as fabric from 'fabric';
import { useRef, useCallback, useEffect } from 'react';

import type { Point2D, Wall2D, Room2D } from '../../../types';
import { WALL_CONTROL_POINT_BASE_RADIUS_PX } from '../control-point-factory';
import {
    applyCornerBevel,
    applyCornerCenterDrag,
    resolveCornerControlGeometry,
    resolveCornerPair,
} from '../corner-editing';
import {
    distanceBetween,
    pickSmallestRoomAtPoint,
} from '../geometry';
import { createFrameScheduler, type FrameScheduler } from '../interaction-scheduler';
import type { SelectionStatePort } from '../selection-state-port';
import {
    DEFAULT_WALL_SELECTION_TOLERANCE_PX,
    WALL_SELECTION_RECT_OBJECT_NAME,
    findNearestWallAtPoint,
    getSelectionBoundsFromPoints,
    getWallIdsInRange,
    getWallIdsIntersectingBounds,
    isSelectionDragThresholdReached,
    mergeSelectionIds,
    normalizeSelectionIds,
    resolveWallSelectionToleranceScene,
    toggleSelectionId,
    type SelectionModifiers,
} from '../selection-utils';
import { snapPointToGrid } from '../snapping';
import type { WallSpatialIndexCell } from '../spatial-index';
import { getScenePointFromMouseEvent } from '../toolUtils';
import {
    ApplyTransientWallGraphCommand,
    FinalizeWallEditCommand,
    type WallEditCommandContext,
} from '../wall-edit-commands';
import {
    clampWallThicknessMm,
    mmThicknessToScene,
    projectDeltaOnNormal,
    resolveWallHandleGeometry,
    sceneThicknessToMm,
    type WallHandleGeometry,
} from '../wall-handle-geometry';
import { moveConnectedNode, rebuildWallAdjacency } from '../wallOperations';

const WALL_ENDPOINT_TOLERANCE = 0.5;
const HANDLE_HIT_RADIUS = WALL_CONTROL_POINT_BASE_RADIUS_PX;
const WALL_SELECTION_RECT_FILL = 'rgba(37, 99, 235, 0.12)';
const WALL_SELECTION_RECT_STROKE = '#2563eb';

interface WallHandleDragSession {
    wallId: string;
    handleType:
        | 'start'
        | 'end'
        | 'mid'
        | 'vertex'
        | 'center'
        | 'interior'
        | 'exterior'
        | 'corner-outer'
        | 'corner-inner'
        | 'corner-center';
    originalWalls: Wall2D[];
    originalRooms: Room2D[];
    originalStart: Point2D;
    originalEnd: Point2D;
    sourceNode?: Point2D;
    geometry?: WallHandleGeometry;
    cornerWallIds?: string[];
}

interface WallBoxSelectionSession {
    start: Point2D;
    current: Point2D;
    additive: boolean;
}

interface TransientWallUpdatePayload {
    nextWalls: Wall2D[];
    selectedIds: string[];
}

interface TargetMeta {
    name?: string;
    wallId?: string;
    wallIds?: string[];
    roomId?: string;
    nodePoint?: Point2D;
    handleType?: 'start' | 'end' | 'mid' | 'vertex' | 'center' | 'interior' | 'exterior';
    cornerHandleType?: 'outer' | 'inner' | 'center';
}

export interface UseSelectModeOptions {
    fabricRef: React.RefObject<fabric.Canvas | null>;
    zoomRef: React.MutableRefObject<number>;
    wallsRef: React.MutableRefObject<Wall2D[]>;
    roomsRef: React.MutableRefObject<Room2D[]>;
    statePort: SelectionStatePort;
    wallSpatialIndex: Map<string, WallSpatialIndexCell>;
    wallSpatialCellSize: number;
    paperToRealRatio: number;
    resolvedSnapToGrid: boolean;
    resolvedGridSize: number;
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
    wallSelectionTolerancePx?: number;
}

function toSelectionModifiers(pointerEvent: MouseEvent | undefined | null): SelectionModifiers {
    if (!pointerEvent) {
        return { additive: false, range: false };
    }
    return {
        additive: pointerEvent.ctrlKey || pointerEvent.metaKey,
        range: pointerEvent.shiftKey,
    };
}

function cloneWallsForDrag(walls: Wall2D[]): Wall2D[] {
    return walls.map((wall) => ({
        ...wall,
        start: { ...wall.start },
        end: { ...wall.end },
        openings: wall.openings.map((opening) => ({ ...opening })),
        connectedWallIds: wall.connectedWallIds ? [...wall.connectedWallIds] : undefined,
        wallLayers: wall.wallLayers?.map((layer) => ({ ...layer })),
    }));
}

function cloneRoomsForDrag(rooms: Room2D[]): Room2D[] {
    return rooms.map((room) => ({
        ...room,
        vertices: room.vertices.map((vertex) => ({ ...vertex })),
        wallIds: [...room.wallIds],
        childRoomIds: [...room.childRoomIds],
    }));
}

function toCornerSessionHandleType(handleType: 'outer' | 'inner' | 'center'): WallHandleDragSession['handleType'] {
    if (handleType === 'outer') return 'corner-outer';
    if (handleType === 'inner') return 'corner-inner';
    return 'corner-center';
}

function areSameWallIdSet(current: string[] | undefined, next: string[]): boolean {
    if (!current || current.length !== next.length) return false;
    const currentSet = new Set(current);
    return next.every((id) => currentSet.has(id));
}

function areOrderedIdsEqual(current: string[], next: string[]): boolean {
    if (current.length !== next.length) return false;
    for (let index = 0; index < current.length; index += 1) {
        if (current[index] !== next[index]) return false;
    }
    return true;
}

function resolveHistoryAction(handleType: WallHandleDragSession['handleType']): string {
    if (handleType === 'interior' || handleType === 'exterior') {
        return 'Adjust wall thickness';
    }
    if (handleType === 'center' || handleType === 'mid') {
        return 'Move wall';
    }
    if (handleType === 'corner-center') {
        return 'Adjust wall corner angle';
    }
    if (handleType === 'corner-outer' || handleType === 'corner-inner') {
        return 'Bevel wall corner';
    }
    if (handleType === 'vertex' || handleType === 'start' || handleType === 'end') {
        return 'Move wall vertex';
    }
    return 'Edit wall';
}

export function useSelectMode({
    fabricRef,
    zoomRef,
    wallsRef,
    roomsRef,
    statePort,
    wallSpatialIndex,
    wallSpatialCellSize,
    paperToRealRatio,
    resolvedSnapToGrid,
    resolvedGridSize,
    notifyRoomValidation,
    setHoveredRoomInfo,
    setHoveredElement,
    originOffset,
    wallSelectionTolerancePx = DEFAULT_WALL_SELECTION_TOLERANCE_PX,
}: UseSelectModeOptions) {
    const wallHandleDragRef = useRef<WallHandleDragSession | null>(null);
    const isWallHandleDraggingRef = useRef(false);
    const wallRangeAnchorRef = useRef<string | null>(null);
    const wallBoxSelectionRef = useRef<WallBoxSelectionSession | null>(null);
    const isWallBoxSelectingRef = useRef(false);
    const transientUpdateSchedulerRef = useRef<FrameScheduler<TransientWallUpdatePayload> | null>(null);

    const getCurrentSelectedIds = useCallback(() => {
        return normalizeSelectionIds(statePort.getSelectedIds());
    }, [statePort]);

    const applySelectedIds = useCallback(
        (ids: string[]) => {
            const normalizedIds = normalizeSelectionIds(ids);
            const currentIds = normalizeSelectionIds(statePort.getSelectedIds());
            if (areOrderedIdsEqual(currentIds, normalizedIds)) {
                return;
            }
            statePort.setSelectedIds(normalizedIds);
            if (normalizedIds.length === 0) {
                wallRangeAnchorRef.current = null;
            }
        },
        [statePort]
    );

    const createCommandContext = useCallback((): WallEditCommandContext => ({
        getWalls: () => wallsRef.current,
        getRooms: () => roomsRef.current,
        setGraphState: (nextWalls, nextRooms) => {
            wallsRef.current = nextWalls;
            roomsRef.current = nextRooms;
            statePort.setWallRoomState(nextWalls, nextRooms);
        },
        setSelectedIds: (ids) => applySelectedIds(ids),
        saveToHistory: (action) => statePort.saveToHistory(action),
        notifyValidation: notifyRoomValidation,
    }), [wallsRef, roomsRef, statePort, applySelectedIds, notifyRoomValidation]);

    const getTransientScheduler = useCallback(() => {
        if (transientUpdateSchedulerRef.current) {
            return transientUpdateSchedulerRef.current;
        }

        transientUpdateSchedulerRef.current = createFrameScheduler(
            (payload) => {
                const transientCommand = new ApplyTransientWallGraphCommand(
                    createCommandContext(),
                    payload.nextWalls,
                    payload.selectedIds
                );
                transientCommand.execute();
            },
            { minFrameMs: 16 }
        );

        return transientUpdateSchedulerRef.current;
    }, [createCommandContext]);

    const scheduleTransientWallUpdate = useCallback(
        (nextWalls: Wall2D[], selectedIds: string[]) => {
            const scheduler = getTransientScheduler();
            scheduler.schedule({
                nextWalls: nextWalls.map((wall) => ({ ...wall, start: { ...wall.start }, end: { ...wall.end } })),
                selectedIds: [...selectedIds],
            });
        },
        [getTransientScheduler]
    );

    const flushTransientWallUpdate = useCallback(() => {
        transientUpdateSchedulerRef.current?.flush();
    }, []);

    useEffect(() => {
        return () => {
            transientUpdateSchedulerRef.current?.dispose();
            transientUpdateSchedulerRef.current = null;
        };
    }, []);

    const getTargetMeta = useCallback((target: fabric.Object | undefined | null): TargetMeta => {
        const typed = target as unknown as TargetMeta;
        return {
            name: typed?.name,
            wallId: typed?.wallId,
            wallIds: typed?.wallIds,
            roomId: typed?.roomId,
            nodePoint: typed?.nodePoint,
            handleType: typed?.handleType,
            cornerHandleType: typed?.cornerHandleType,
        };
    }, []);

    const renderWallSelectionRect = useCallback(
        (start: Point2D, end: Point2D) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const bounds = getSelectionBoundsFromPoints(start, end);
            const width = Math.max(bounds.right - bounds.left, 0.0001);
            const height = Math.max(bounds.bottom - bounds.top, 0.0001);
            const safeZoom = Math.max(zoomRef.current, 0.01);
            const strokeWidth = Math.max(1 / safeZoom, 0.75 / safeZoom);
            const strokeDash = [6 / safeZoom, 4 / safeZoom];

            let rect = canvas
                .getObjects()
                .find(
                    (obj) =>
                        (obj as unknown as { name?: string }).name ===
                        WALL_SELECTION_RECT_OBJECT_NAME
                ) as fabric.Rect | undefined;

            if (!rect) {
                rect = new fabric.Rect({
                    left: bounds.left,
                    top: bounds.top,
                    width,
                    height,
                    fill: WALL_SELECTION_RECT_FILL,
                    stroke: WALL_SELECTION_RECT_STROKE,
                    strokeWidth,
                    strokeDashArray: strokeDash,
                    selectable: false,
                    evented: false,
                    hasControls: false,
                    hasBorders: false,
                    objectCaching: false,
                });
                (rect as unknown as { name?: string }).name = WALL_SELECTION_RECT_OBJECT_NAME;
                canvas.add(rect);
            } else {
                rect.set({
                    left: bounds.left,
                    top: bounds.top,
                    width,
                    height,
                    strokeWidth,
                    strokeDashArray: strokeDash,
                    visible: true,
                });
                rect.setCoords();
            }

            const canvasWithBring = canvas as unknown as {
                bringObjectToFront?: (obj: fabric.Object) => void;
            };
            canvasWithBring.bringObjectToFront?.(rect);
            canvas.requestRenderAll();
        },
        [fabricRef, zoomRef]
    );

    const clearWallSelectionRect = useCallback(
        (shouldRender = true) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const rect = canvas
                .getObjects()
                .find(
                    (obj) =>
                        (obj as unknown as { name?: string }).name ===
                        WALL_SELECTION_RECT_OBJECT_NAME
                ) as fabric.Rect | undefined;
            if (!rect) return;

            canvas.remove(rect);
            if (shouldRender) {
                canvas.requestRenderAll();
            }
        },
        [fabricRef]
    );

    const clearBoxSelection = useCallback(() => {
        wallBoxSelectionRef.current = null;
        isWallBoxSelectingRef.current = false;
        clearWallSelectionRect();
    }, [clearWallSelectionRect]);

    const selectWallById = useCallback(
        (wallId: string, modifiers: SelectionModifiers) => {
            if (!wallId) return;

            const currentSelectedIds = getCurrentSelectedIds();
            const hasWall = wallsRef.current.some((wall) => wall.id === wallId);
            if (!hasWall) return;

            if (modifiers.range) {
                const firstSelectedWall = currentSelectedIds.find((id) =>
                    wallsRef.current.some((wall) => wall.id === id)
                );
                const anchorWallId =
                    wallRangeAnchorRef.current ?? firstSelectedWall ?? wallId;
                const rangeIds = getWallIdsInRange(wallsRef.current, anchorWallId, wallId);
                const nextIds = modifiers.additive
                    ? mergeSelectionIds(currentSelectedIds, rangeIds)
                    : rangeIds;
                applySelectedIds(nextIds);
                wallRangeAnchorRef.current = anchorWallId;
                return;
            }

            if (modifiers.additive) {
                const nextIds = toggleSelectionId(currentSelectedIds, wallId);
                applySelectedIds(nextIds);
                wallRangeAnchorRef.current = nextIds.includes(wallId)
                    ? wallId
                    : nextIds.length > 0
                        ? nextIds[nextIds.length - 1] ?? null
                        : null;
                return;
            }

            applySelectedIds([wallId]);
            wallRangeAnchorRef.current = wallId;
        },
        [getCurrentSelectedIds, wallsRef, applySelectedIds]
    );

    const selectRoomById = useCallback(
        (roomId: string, modifiers: SelectionModifiers) => {
            if (!roomId) return;
            const currentSelectedIds = getCurrentSelectedIds();
            const additive = modifiers.additive || modifiers.range;

            if (additive) {
                applySelectedIds(toggleSelectionId(currentSelectedIds, roomId));
                return;
            }

            applySelectedIds([roomId]);
        },
        [getCurrentSelectedIds, applySelectedIds]
    );

    const getSelectionIdsFromTargets = useCallback(
        (targets: Array<fabric.Object | null | undefined>): string[] => {
            const ids: string[] = [];
            targets.forEach((target) => {
                if (!target) return;
                const meta = getTargetMeta(target);
                if (meta.name === 'wall-render' && meta.wallId) {
                    ids.push(meta.wallId);
                    return;
                }
                if ((meta.name === 'room-region' || meta.name === 'room-tag') && meta.roomId) {
                    ids.push(meta.roomId);
                    return;
                }
                if (meta.name === 'wall-handle' && meta.wallId) {
                    ids.push(meta.wallId);
                    return;
                }
                if (meta.name === 'wall-corner-handle' && meta.wallIds) {
                    ids.push(...meta.wallIds);
                    return;
                }
                if (meta.name === 'wall-vertex-marker' && meta.wallIds) {
                    ids.push(...meta.wallIds);
                }
            });
            return normalizeSelectionIds(ids);
        },
        [getTargetMeta]
    );

    const updateSelectionFromTargets = useCallback(
        (
            targets: Array<fabric.Object | null | undefined>,
            pointerEvent?: MouseEvent | null
        ) => {
            const ids = getSelectionIdsFromTargets(targets);
            const modifiers = toSelectionModifiers(pointerEvent);

            if (ids.length === 0) {
                if (!modifiers.additive) {
                    applySelectedIds([]);
                }
                return;
            }

            const selectedWallId = ids.find((id) =>
                wallsRef.current.some((wall) => wall.id === id)
            );
            if (modifiers.range && selectedWallId) {
                selectWallById(selectedWallId, modifiers);
                return;
            }

            if (modifiers.additive) {
                const next = mergeSelectionIds(getCurrentSelectedIds(), ids);
                applySelectedIds(next);
            } else {
                applySelectedIds(ids);
            }

            if (selectedWallId) {
                wallRangeAnchorRef.current = selectedWallId;
            }
        },
        [
            getSelectionIdsFromTargets,
            applySelectedIds,
            getCurrentSelectedIds,
            selectWallById,
            wallsRef,
        ]
    );

    const updateSelectionFromTarget = useCallback(
        (target: fabric.Object | undefined | null, pointerEvent?: MouseEvent | null) => {
            updateSelectionFromTargets([target], pointerEvent);
        },
        [updateSelectionFromTargets]
    );

    const applyTransientWallGraph = useCallback(
        (nextWalls: Wall2D[]) => {
            const transientCommand = new ApplyTransientWallGraphCommand(
                createCommandContext(),
                nextWalls
            );
            transientCommand.execute();
        },
        [createCommandContext]
    );

    const finalizeHandleDrag = useCallback(() => {
        flushTransientWallUpdate();

        const dragSession = wallHandleDragRef.current;
        if (!dragSession) {
            isWallHandleDraggingRef.current = false;
            return;
        }

        const selectedIdsForRollback = normalizeSelectionIds([
            ...getCurrentSelectedIds(),
            ...(dragSession.cornerWallIds && dragSession.cornerWallIds.length > 0
                ? dragSession.cornerWallIds
                : [dragSession.wallId]),
        ]);

        const finalizeCommand = new FinalizeWallEditCommand(createCommandContext(), {
            wallId: dragSession.wallId,
            selectionIds: selectedIdsForRollback,
            action: resolveHistoryAction(dragSession.handleType),
            originalWalls: dragSession.originalWalls,
            originalRooms: dragSession.originalRooms,
        });
        finalizeCommand.execute();
        wallHandleDragRef.current = null;
        isWallHandleDraggingRef.current = false;
    }, [createCommandContext, flushTransientWallUpdate, getCurrentSelectedIds]);

    const handleObjectMoving = useCallback(
        (target: fabric.Object, pointerEvent?: MouseEvent | null) => {
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
                    distanceBetween(wallHandleDragRef.current.sourceNode, meta.nodePoint) >
                        WALL_ENDPOINT_TOLERANCE
                ) {
                    const sourceWallId = meta.wallIds?.[0];
                    if (!sourceWallId) return;
                    wallHandleDragRef.current = {
                        wallId: sourceWallId,
                        handleType: 'vertex',
                        originalWalls: cloneWallsForDrag(wallsRef.current),
                        originalRooms: cloneRoomsForDrag(roomsRef.current),
                        originalStart: { ...meta.nodePoint },
                        originalEnd: { ...meta.nodePoint },
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
                nextWalls = nextWalls.filter(
                    (candidate) => distanceBetween(candidate.start, candidate.end) > 0.001
                );
                nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);
                scheduleTransientWallUpdate(
                    nextWalls,
                    meta.wallIds && meta.wallIds.length > 0 ? meta.wallIds : [dragSession.wallId]
                );
                return;
            }

            if (
                meta.name === 'wall-corner-handle' &&
                meta.nodePoint &&
                meta.cornerHandleType &&
                meta.wallIds &&
                meta.wallIds.length >= 2
            ) {
                const center = target.getCenterPoint();
                const snapToGridDuringDrag = pointerEvent?.shiftKey === true;
                const pointer = snapToGridDuringDrag
                    ? snapPointToGrid({ x: center.x, y: center.y }, resolvedGridSize)
                    : { x: center.x, y: center.y };

                const targetRadius = Number((target as fabric.Circle).get('radius')) || HANDLE_HIT_RADIUS;
                const targetScale = Number((target as fabric.Circle).get('scaleX')) || 1;
                const effectiveRadius = targetRadius * targetScale;
                target.set({
                    left: pointer.x - effectiveRadius,
                    top: pointer.y - effectiveRadius,
                });
                target.setCoords();

                const cornerWallIds = meta.wallIds.filter((wallId) =>
                    wallsRef.current.some((wall) => wall.id === wallId)
                );
                if (cornerWallIds.length < 2) return;
                const primaryCornerWallId = cornerWallIds[0];
                if (!primaryCornerWallId) return;
                const sessionHandleType = toCornerSessionHandleType(meta.cornerHandleType);

                if (
                    !wallHandleDragRef.current ||
                    wallHandleDragRef.current.handleType !== sessionHandleType ||
                    !wallHandleDragRef.current.sourceNode ||
                    distanceBetween(wallHandleDragRef.current.sourceNode, meta.nodePoint) > WALL_ENDPOINT_TOLERANCE ||
                    !areSameWallIdSet(wallHandleDragRef.current.cornerWallIds, cornerWallIds)
                ) {
                    wallHandleDragRef.current = {
                        wallId: primaryCornerWallId,
                        handleType: sessionHandleType,
                        originalWalls: cloneWallsForDrag(wallsRef.current),
                        originalRooms: cloneRoomsForDrag(roomsRef.current),
                        originalStart: { ...meta.nodePoint },
                        originalEnd: { ...meta.nodePoint },
                        sourceNode: { ...meta.nodePoint },
                        cornerWallIds: [...cornerWallIds],
                    };
                }

                const dragSession = wallHandleDragRef.current;
                if (!dragSession?.sourceNode || !dragSession.cornerWallIds) return;
                isWallHandleDraggingRef.current = true;

                const pair = resolveCornerPair(
                    dragSession.originalWalls,
                    dragSession.sourceNode,
                    dragSession.cornerWallIds,
                    WALL_ENDPOINT_TOLERANCE
                );
                if (!pair) return;
                const geometry = resolveCornerControlGeometry(pair, paperToRealRatio);
                if (!geometry) return;

                let nextWalls: Wall2D[] | null = null;
                if (meta.cornerHandleType === 'outer' || meta.cornerHandleType === 'inner') {
                    const radial = meta.cornerHandleType === 'outer'
                        ? geometry.outerRadial
                        : geometry.innerRadial;
                    const origin = meta.cornerHandleType === 'outer'
                        ? geometry.outerVertex
                        : geometry.innerVertex;
                    if (!radial) return;
                    const projectedDistance = projectDeltaOnNormal(
                        { x: pointer.x - origin.x, y: pointer.y - origin.y },
                        radial
                    );
                    const constrainedDistance = Math.max(0, Math.min(geometry.maxBevelLength, projectedDistance));
                    const constrainedPointer = {
                        x: origin.x + radial.x * constrainedDistance,
                        y: origin.y + radial.y * constrainedDistance,
                    };
                    target.set({
                        left: constrainedPointer.x - effectiveRadius,
                        top: constrainedPointer.y - effectiveRadius,
                    });
                    target.setCoords();

                    nextWalls = applyCornerBevel(
                        dragSession.originalWalls,
                        pair,
                        geometry,
                        meta.cornerHandleType,
                        constrainedPointer,
                        WALL_ENDPOINT_TOLERANCE
                    );
                } else {
                    const radial = geometry.centerRadial;
                    if (!radial) return;
                    const projectedDistance = projectDeltaOnNormal(
                        { x: pointer.x - geometry.center.x, y: pointer.y - geometry.center.y },
                        radial
                    );
                    const constrainedPointer = {
                        x: geometry.center.x + radial.x * projectedDistance,
                        y: geometry.center.y + radial.y * projectedDistance,
                    };
                    const movedWalls = applyCornerCenterDrag(
                        dragSession.originalWalls,
                        pair,
                        geometry,
                        constrainedPointer,
                        moveConnectedNode,
                        WALL_ENDPOINT_TOLERANCE
                    );
                    if (!movedWalls) {
                        target.set({
                            left: geometry.center.x - effectiveRadius,
                            top: geometry.center.y - effectiveRadius,
                        });
                        target.setCoords();
                        return;
                    }

                    target.set({
                        left: constrainedPointer.x - effectiveRadius,
                        top: constrainedPointer.y - effectiveRadius,
                    });
                    target.setCoords();
                    nextWalls = movedWalls;
                }

                if (!nextWalls) return;
                nextWalls = nextWalls.filter((candidate) => distanceBetween(candidate.start, candidate.end) > 0.001);
                nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);

                const selectedIdsForDrag = getCurrentSelectedIds();
                cornerWallIds.forEach((wallId) => {
                    if (!selectedIdsForDrag.includes(wallId)) {
                        selectedIdsForDrag.push(wallId);
                    }
                });
                scheduleTransientWallUpdate(nextWalls, selectedIdsForDrag);
                return;
            }

            if (meta.name !== 'wall-handle' || !meta.wallId || !meta.handleType) return;

            const wall = wallsRef.current.find((item) => item.id === meta.wallId);
            if (!wall) return;

            const center = target.getCenterPoint();
            const snapToGridDuringDrag = pointerEvent?.shiftKey === true;
            const pointer = snapToGridDuringDrag
                ? snapPointToGrid({ x: center.x, y: center.y }, resolvedGridSize)
                : { x: center.x, y: center.y };

            const targetRadius = Number((target as fabric.Circle).get('radius')) || HANDLE_HIT_RADIUS;
            const targetScale = Number((target as fabric.Circle).get('scaleX')) || 1;
            const effectiveRadius = targetRadius * targetScale;
            target.set({
                left: pointer.x - effectiveRadius,
                top: pointer.y - effectiveRadius,
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
                    originalWalls: cloneWallsForDrag(wallsRef.current),
                    originalRooms: cloneRoomsForDrag(roomsRef.current),
                    originalStart: { ...wall.start },
                    originalEnd: { ...wall.end },
                    geometry: resolveWallHandleGeometry(wall, paperToRealRatio) ?? undefined,
                };
            }

            const dragSession = wallHandleDragRef.current;
            if (!dragSession) return;
            isWallHandleDraggingRef.current = true;

            let nextWalls = dragSession.originalWalls;
            if (dragSession.handleType === 'center' || dragSession.handleType === 'mid') {
                const originalCenter = dragSession.geometry?.centerMid ?? {
                    x: (dragSession.originalStart.x + dragSession.originalEnd.x) / 2,
                    y: (dragSession.originalStart.y + dragSession.originalEnd.y) / 2,
                };
                const delta = { x: pointer.x - originalCenter.x, y: pointer.y - originalCenter.y };
                nextWalls = moveConnectedNode(
                    nextWalls,
                    dragSession.originalStart,
                    {
                        x: dragSession.originalStart.x + delta.x,
                        y: dragSession.originalStart.y + delta.y,
                    },
                    WALL_ENDPOINT_TOLERANCE
                );
                nextWalls = moveConnectedNode(
                    nextWalls,
                    dragSession.originalEnd,
                    { x: dragSession.originalEnd.x + delta.x, y: dragSession.originalEnd.y + delta.y },
                    WALL_ENDPOINT_TOLERANCE
                );
            } else if (dragSession.handleType === 'interior' || dragSession.handleType === 'exterior') {
                const geometry = dragSession.geometry;
                if (!geometry) return;

                const sideNormal =
                    dragSession.handleType === 'exterior'
                        ? geometry.interiorToExteriorNormal
                        : {
                            x: -geometry.interiorToExteriorNormal.x,
                            y: -geometry.interiorToExteriorNormal.y,
                        };
                const anchorPoint =
                    dragSession.handleType === 'exterior'
                        ? geometry.exteriorMid
                        : geometry.interiorMid;

                const projectedDistance = projectDeltaOnNormal(
                    { x: pointer.x - anchorPoint.x, y: pointer.y - anchorPoint.y },
                    sideNormal
                );
                const constrainedPointer = {
                    x: anchorPoint.x + sideNormal.x * projectedDistance,
                    y: anchorPoint.y + sideNormal.y * projectedDistance,
                };
                target.set({
                    left: constrainedPointer.x - effectiveRadius,
                    top: constrainedPointer.y - effectiveRadius,
                });
                target.setCoords();

                const requestedSceneThickness = geometry.thicknessScenePx + projectedDistance;
                const requestedMm = sceneThicknessToMm(requestedSceneThickness, paperToRealRatio);
                const clampedMm = clampWallThicknessMm(requestedMm);
                const clampedScene = mmThicknessToScene(clampedMm, paperToRealRatio);
                const appliedDistance = clampedScene - geometry.thicknessScenePx;
                const centerShift = {
                    x: sideNormal.x * (appliedDistance / 2),
                    y: sideNormal.y * (appliedDistance / 2),
                };
                const shiftedStart = {
                    x: dragSession.originalStart.x + centerShift.x,
                    y: dragSession.originalStart.y + centerShift.y,
                };
                const shiftedEnd = {
                    x: dragSession.originalEnd.x + centerShift.x,
                    y: dragSession.originalEnd.y + centerShift.y,
                };

                nextWalls = moveConnectedNode(
                    nextWalls,
                    dragSession.originalStart,
                    shiftedStart,
                    WALL_ENDPOINT_TOLERANCE
                );
                nextWalls = moveConnectedNode(
                    nextWalls,
                    dragSession.originalEnd,
                    shiftedEnd,
                    WALL_ENDPOINT_TOLERANCE
                );
                nextWalls = nextWalls.map((candidate) =>
                    candidate.id === meta.wallId
                        ? { ...candidate, thickness: clampedMm }
                        : candidate
                );
            } else if (dragSession.handleType === 'start') {
                nextWalls = moveConnectedNode(
                    nextWalls,
                    dragSession.originalStart,
                    pointer,
                    WALL_ENDPOINT_TOLERANCE
                );
            } else if (dragSession.handleType === 'end') {
                nextWalls = moveConnectedNode(
                    nextWalls,
                    dragSession.originalEnd,
                    pointer,
                    WALL_ENDPOINT_TOLERANCE
                );
            }

            nextWalls = nextWalls.filter((candidate) => distanceBetween(candidate.start, candidate.end) > 0.001);
            nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);
            const selectedIdsForDrag = getCurrentSelectedIds();
            if (!selectedIdsForDrag.includes(meta.wallId)) {
                selectedIdsForDrag.push(meta.wallId);
            }
            scheduleTransientWallUpdate(nextWalls, selectedIdsForDrag);
        },
        [
            wallsRef,
            roomsRef,
            resolvedSnapToGrid,
            resolvedGridSize,
            paperToRealRatio,
            getTargetMeta,
            getCurrentSelectedIds,
            scheduleTransientWallUpdate,
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
            applySelectedIds([room.id]);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(
                    new CustomEvent('smart-drawing:open-room-properties', { detail: { roomId: room.id } })
                );
            }
            return true;
        },
        [fabricRef, roomsRef, applySelectedIds]
    );

    const handlePointerDown = useCallback(
        (
            target: fabric.Object | undefined | null,
            scenePoint: Point2D,
            pointerEvent: MouseEvent
        ) => {
            if (pointerEvent.button !== 0) return;

            const meta = getTargetMeta(target);
            const modifiers = toSelectionModifiers(pointerEvent);
            clearBoxSelection();

            if (meta.name === 'wall-handle' && meta.wallId) {
                selectWallById(meta.wallId, modifiers);
                return;
            }

            if (meta.name === 'wall-corner-handle' && meta.wallIds && meta.wallIds.length > 0) {
                if (modifiers.range) {
                    const anchorWallId = meta.wallIds[0];
                    if (anchorWallId) {
                        selectWallById(anchorWallId, modifiers);
                    }
                    return;
                }

                if (modifiers.additive) {
                    applySelectedIds(mergeSelectionIds(getCurrentSelectedIds(), meta.wallIds));
                } else {
                    applySelectedIds(meta.wallIds);
                }
                const firstWallId = meta.wallIds[0];
                wallRangeAnchorRef.current = firstWallId ?? wallRangeAnchorRef.current;
                return;
            }

            if (meta.name === 'wall-vertex-marker' && meta.wallIds && meta.wallIds.length > 0) {
                if (modifiers.range && meta.wallIds.length === 1) {
                    const wallId = meta.wallIds[0];
                    if (wallId) {
                        selectWallById(wallId, modifiers);
                    }
                    return;
                }

                if (modifiers.additive) {
                    applySelectedIds(mergeSelectionIds(getCurrentSelectedIds(), meta.wallIds));
                } else {
                    applySelectedIds(meta.wallIds);
                }
                const firstWallId = meta.wallIds[0];
                wallRangeAnchorRef.current = firstWallId ?? wallRangeAnchorRef.current;
                return;
            }

            if (meta.name === 'wall-render' && meta.wallId) {
                selectWallById(meta.wallId, modifiers);
                return;
            }

            const toleranceScene = resolveWallSelectionToleranceScene(
                zoomRef.current,
                wallSelectionTolerancePx
            );
            const nearbyWall = findNearestWallAtPoint({
                point: scenePoint,
                spatialIndex: wallSpatialIndex,
                cellSize: wallSpatialCellSize,
                paperToRealRatio,
                toleranceScene,
            });
            if (nearbyWall) {
                selectWallById(nearbyWall.id, modifiers);
                return;
            }

            if ((meta.name === 'room-region' || meta.name === 'room-tag') && meta.roomId) {
                selectRoomById(meta.roomId, modifiers);
                return;
            }

            const roomAtPoint = pickSmallestRoomAtPoint(scenePoint, roomsRef.current);
            if (roomAtPoint) {
                selectRoomById(roomAtPoint.id, modifiers);
                return;
            }

            wallBoxSelectionRef.current = {
                start: scenePoint,
                current: scenePoint,
                additive: modifiers.additive,
            };
            isWallBoxSelectingRef.current = true;
            renderWallSelectionRect(scenePoint, scenePoint);
        },
        [
            getTargetMeta,
            clearBoxSelection,
            selectWallById,
            applySelectedIds,
            getCurrentSelectedIds,
            zoomRef,
            wallSelectionTolerancePx,
            wallSpatialIndex,
            wallSpatialCellSize,
            paperToRealRatio,
            selectRoomById,
            roomsRef,
            renderWallSelectionRect,
        ]
    );

    const handleSelectionBoxPointerMove = useCallback(
        (scenePoint: Point2D) => {
            const session = wallBoxSelectionRef.current;
            if (!session) return false;

            session.current = scenePoint;
            renderWallSelectionRect(session.start, session.current);
            return true;
        },
        [renderWallSelectionRect]
    );

    const handleSelectionBoxPointerUp = useCallback(() => {
        const session = wallBoxSelectionRef.current;
        if (!session) return false;

        wallBoxSelectionRef.current = null;
        isWallBoxSelectingRef.current = false;

        const dragged = isSelectionDragThresholdReached(
            session.start,
            session.current,
            zoomRef.current
        );
        if (!dragged) {
            clearWallSelectionRect();
            if (!session.additive) {
                applySelectedIds([]);
            }
            return true;
        }

        const selectionBounds = getSelectionBoundsFromPoints(session.start, session.current);
        const selectedWallIds = getWallIdsIntersectingBounds(
            wallSpatialIndex,
            selectionBounds,
            wallSpatialCellSize,
            paperToRealRatio
        );
        const nextIds = session.additive
            ? mergeSelectionIds(getCurrentSelectedIds(), selectedWallIds)
            : selectedWallIds;
        applySelectedIds(nextIds);
        if (selectedWallIds.length > 0) {
            wallRangeAnchorRef.current = selectedWallIds[selectedWallIds.length - 1] ?? null;
        }
        clearWallSelectionRect();
        return true;
    }, [
        zoomRef,
        clearWallSelectionRect,
        applySelectedIds,
        wallSpatialIndex,
        wallSpatialCellSize,
        paperToRealRatio,
        getCurrentSelectedIds,
    ]);

    const handleMouseDown = useCallback(
        (
            target: fabric.Object | undefined | null,
            scenePoint: Point2D,
            pointerEvent?: MouseEvent | null
        ) => {
            if (pointerEvent) {
                handlePointerDown(target, scenePoint, pointerEvent);
                return;
            }
            const meta = getTargetMeta(target);
            if (
                meta.name === 'wall-render' ||
                meta.name === 'wall-handle' ||
                meta.name === 'wall-corner-handle' ||
                meta.name === 'wall-vertex-marker'
            ) {
                updateSelectionFromTarget(target);
                return;
            }

            const roomAtPoint = pickSmallestRoomAtPoint(scenePoint, roomsRef.current);
            if (roomAtPoint) {
                applySelectedIds([roomAtPoint.id]);
                return;
            }

            updateSelectionFromTarget(target);
        },
        [handlePointerDown, getTargetMeta, updateSelectionFromTarget, roomsRef, applySelectedIds]
    );

    const handleRoomHover = useCallback(
        (point: Point2D, viewportPoint: { x: number; y: number }) => {
            if (isWallBoxSelectingRef.current) {
                setHoveredRoomInfo(null);
                setHoveredElement(null);
                return;
            }

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
                    if (
                        prev &&
                        prev.id === nextInfo.id &&
                        Math.abs(prev.screenX - nextInfo.screenX) < 0.5 &&
                        Math.abs(prev.screenY - nextInfo.screenY) < 0.5
                    ) {
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
        isWallBoxSelectingRef,
        getTargetMeta,
        updateSelectionFromTarget,
        updateSelectionFromTargets,
        applyTransientWallGraph,
        finalizeHandleDrag,
        handleObjectMoving,
        handleDoubleClick,
        handleMouseDown,
        handlePointerDown,
        handleSelectionBoxPointerMove,
        handleSelectionBoxPointerUp,
        clearBoxSelection,
        handleRoomHover,
    };
}
