/**
 * useCanvasEventBinding
 *
 * Extracted from DrawingCanvas.tsx – the single giant useEffect that subscribes
 * and unsubscribes all canvas / window event handlers (mouse, keyboard, wheel,
 * selection, context-menu, object moving/rotating, etc.).
 *
 * This hook contains NO logic changes – it is a 1-to-1 extraction of the
 * "Event Binding" useEffect block.
 */

import * as fabric from 'fabric';
import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';

import type { ArchitecturalObjectDefinition } from '../../../data';
import { useSmartDrawingStore } from '../../../store';
import type { Point2D, Room, SectionLineDirection, SymbolInstance2D, Wall } from '../../../types';

import type {
    MarqueeSelectionState,
    OpeningPointerInteraction,
    OpeningResizeHandleHit,
    WallContextMenuState,
    DimensionContextMenuState,
    SectionLineContextMenuState,
    ObjectContextMenuState,
} from '../../DrawingCanvas.types';
import { clampValue, hideActiveSelectionChrome } from '../../DrawingCanvas.types';
import { MM_TO_PX } from '../scale';
import { snapPointToGrid } from '../snapping';
import type { WallRenderer } from '../wall/WallRenderer';
import type { ObjectRenderer } from '../object/ObjectRenderer';
import type { UseOffsetToolResult } from './useOffsetTool';
import type { UseTrimToolResult } from './useTrimTool';
import type { UseExtendToolResult } from './useExtendTool';

// =============================================================================
// Options
// =============================================================================

export interface UseCanvasEventBindingOptions {
    // Refs
    fabricRef: RefObject<fabric.Canvas | null>;
    outerRef: RefObject<HTMLDivElement | null>;
    wheelRafId: MutableRefObject<number | null>;
    marqueeSelectionRef: MutableRefObject<MarqueeSelectionState>;
    lastMarqueeSelectionRef: MutableRefObject<MarqueeSelectionState>;
    applyMarqueeFilterRef: MutableRefObject<boolean>;
    openingPointerInteractionRef: MutableRefObject<OpeningPointerInteraction | null>;
    suppressFabricSelectionSyncRef: MutableRefObject<number>;
    isWallHandleDraggingRef: MutableRefObject<boolean>;
    isDraggingObjectRef: MutableRefObject<boolean>;
    placementCursorRef: MutableRefObject<Point2D | null>;
    objectRendererRef: RefObject<ObjectRenderer | null>;
    roomRendererRef: RefObject<{ getRoomIdAtPoint: (point: Point2D) => string | null } | null>;

    // State values
    tool: string;
    selectedIds: string[];
    symbols: SymbolInstance2D[];
    walls: Wall[];
    objectDefinitionsById: Map<string, ArchitecturalObjectDefinition>;
    resolvedSnapToGrid: boolean;
    effectiveSnapGridSize: number;
    pendingPlacementDefinition: ArchitecturalObjectDefinition | null;
    sectionLineDrawingState: { isDrawing: boolean; direction: SectionLineDirection };
    wallById: Map<string, Wall>;
    roomById: Map<string, Room>;
    wallIdSet: Set<string>;
    perimeterWallIdsForRooms: (roomIds: string[]) => string[];
    roomBoundaryDistance: (point: Point2D, vertices: Point2D[]) => number;
    projectPointToSegment: (
        point: Point2D,
        segStart: Point2D,
        segEnd: Point2D,
    ) => { projected: Point2D; t: number; distance: number };

    // Canvas mouse handlers (the main useCallback-s from DrawingCanvas)
    handleMouseDown: (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => void;
    handleMouseMove: (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => void;
    handleMouseUp: () => void;
    handleWheel: (e: fabric.TPointerEventInfo<WheelEvent>) => void;

    // Middle-pan handlers
    stopMiddlePan: () => void;
    handleMiddleMouseDown: (e: MouseEvent) => void;
    handleMiddleMouseMove: (e: MouseEvent) => void;
    handleMiddleMouseUp: (e: MouseEvent) => void;
    preventMiddleAuxClick: (e: MouseEvent) => void;

    // Select-mode handlers
    handleSelectDoubleClick: (e: MouseEvent) => boolean;
    updateSelectionFromTarget: (target: fabric.Object | null | undefined) => void;
    updateSelectionFromTargets: (targets: fabric.Object[]) => void;
    handleSelectMouseDown: (
        target: fabric.Object | null | undefined,
        wallPointMm: Point2D,
        addToSelection: boolean,
    ) => void;
    handleSelectObjectMoving: (target: fabric.Object) => void;
    finalizeHandleDrag: () => void;
    handleSelectMouseMove: (selectPoint: Point2D, target: fabric.Object | null) => void;

    // Target resolvers
    resolveWallIdFromTarget: (target: fabric.Object | null | undefined) => string | null;
    resolveDimensionIdFromTarget: (target: fabric.Object | null | undefined) => string | null;
    resolveSectionLineIdFromTarget: (target: fabric.Object | null | undefined) => string | null;
    resolveRoomIdFromTarget: (target: fabric.Object | null | undefined) => string | null;
    resolveObjectIdFromTarget: (target: fabric.Object | null | undefined) => string | null;
    resolveOpeningIdFromTarget: (target: fabric.Object | null | undefined) => string | null;
    resolveOpeningResizeHandleFromTarget: (
        target: fabric.Object | null | undefined,
    ) => OpeningResizeHandleHit | null;
    findOpeningAtPoint: (
        point: Point2D,
    ) => { openingId: string; wallId: string } | null;
    filterMarqueeSelectionTargets: (targets: fabric.Object[]) => fabric.Object[];
    getTargetMeta: (
        target: fabric.Object | null | undefined,
    ) => {
        isWallControl?: boolean;
        isRoomControl?: boolean;
        wallId?: string | null;
        roomId?: string | null;
    };

    // Wall tool handlers
    handleWallDoubleClick: () => void;
    handleWallToolKeyDown: (e: KeyboardEvent) => void;
    handleWallToolKeyUp: (e: KeyboardEvent) => void;

    // Dimension tool handlers
    handleDimensionDoubleClick: (target: fabric.Object | null | undefined) => boolean;
    handleDimensionKeyDown: (e: KeyboardEvent) => boolean;
    handleDimensionSelectMouseDown: (
        target: fabric.Object | null | undefined,
        wallPointMm: Point2D,
        addToSelection: boolean,
    ) => boolean;

    // Tool hooks
    offsetTool: Pick<UseOffsetToolResult, 'handleKeyDown'>;
    trimTool: Pick<UseTrimToolResult, 'handleKeyDown'>;
    extendTool: Pick<UseExtendToolResult, 'handleKeyDown'>;

    // Opening placement
    computePlacement: (
        position: Point2D,
        definition: ArchitecturalObjectDefinition,
        options?: {
            ignoreOpeningId?: string;
            ignoreSymbolId?: string;
            openingWidthMm?: number;
        },
    ) => {
        valid: boolean;
        point: Point2D;
        rotationDeg: number;
        snappedWall: { wall: Wall; positionAlongWall: number } | null;
    };
    syncOpeningForSymbol: (
        symbolId: string,
        definition: ArchitecturalObjectDefinition,
        wallSnap: { wall: Wall; positionAlongWall: number },
        dims: { openingWidthMm: number; openingHeightMm: number; sillHeightMm: number },
    ) => void;
    buildHostedOpeningSymbolProperties: (
        definition: ArchitecturalObjectDefinition,
        wall: Wall,
        positionAlongWall: number,
        existingProperties: Record<string, unknown> | undefined,
        openingWidthMm: number,
        openingHeightMm: number,
        sillHeightMm: number,
    ) => Record<string, unknown>;
    resolveOpeningWidthMm: (
        definition: ArchitecturalObjectDefinition,
        properties?: Record<string, unknown>,
    ) => number;
    resolveOpeningHeightMm: (
        definition: ArchitecturalObjectDefinition,
        properties?: Record<string, unknown>,
    ) => number;
    resolveOpeningSillHeightMm: (
        definition: ArchitecturalObjectDefinition,
        properties?: Record<string, unknown>,
    ) => number;
    hasFurnitureCollision: (
        position: Point2D,
        definition: ArchitecturalObjectDefinition,
        options?: { ignoreSymbolId?: string },
    ) => boolean;

    // Opening interaction
    beginOpeningPointerInteraction: (interaction: OpeningPointerInteraction) => void;
    finishOpeningPointerInteraction: () => void;

    // Context menus
    closeWallContextMenu: () => void;
    closeDimensionContextMenu: () => void;
    closeSectionLineContextMenu: () => void;
    closeObjectContextMenu: () => void;

    // Store actions
    setSelectedIds: (ids: string[]) => void;
    setHoveredElement: (id: string | null) => void;
    setProcessingStatus: (message: string, loading: boolean) => void;
    updateSymbol: (id: string, updates: Partial<SymbolInstance2D>) => void;
    placePendingObject: (cursor: Point2D) => boolean;
    onCancelObjectPlacement?: (() => void) | null;

    // Local state setters
    setOpeningInteractionActive: (active: boolean) => void;
    setMarqueeSelectionMode: (mode: 'window' | 'crossing') => void;
    setPersistentRoomControlId: (id: string | null) => void;
    setPlacementRotationDeg: Dispatch<SetStateAction<number>>;
    setWallContextMenu: (state: WallContextMenuState) => void;
    setDimensionContextMenu: (state: DimensionContextMenuState) => void;
    setSectionLineContextMenu: (state: SectionLineContextMenuState) => void;
    setObjectContextMenu: (state: ObjectContextMenuState) => void;

    // Section-line actions
    cancelSectionLineDrawing: () => void;
    commitSectionLine: () => void;
    setSectionLineDirection: (direction: SectionLineDirection) => void;

    // Nudge
    nudgeSelectedObjects: (dx: number, dy: number) => boolean;

    // Wall renderer
    wallRenderer: WallRenderer | null;

}

// =============================================================================
// Result
// =============================================================================

export interface UseCanvasEventBindingResult {
    // Currently returns nothing – the effect is purely side-effectful.
}

// =============================================================================
// Hook
// =============================================================================

export function useCanvasEventBinding(
    options: UseCanvasEventBindingOptions,
): UseCanvasEventBindingResult {
    const {
        fabricRef,
        outerRef,
        wheelRafId,
        marqueeSelectionRef,
        lastMarqueeSelectionRef,
        applyMarqueeFilterRef,
        openingPointerInteractionRef,
        suppressFabricSelectionSyncRef,
        isWallHandleDraggingRef,
        isDraggingObjectRef,
        placementCursorRef,
        objectRendererRef,
        roomRendererRef,
        tool,
        selectedIds,
        symbols,
        walls,
        objectDefinitionsById,
        resolvedSnapToGrid,
        effectiveSnapGridSize,
        pendingPlacementDefinition,
        sectionLineDrawingState,
        wallById,
        roomById,
        wallIdSet,
        perimeterWallIdsForRooms,
        roomBoundaryDistance,
        projectPointToSegment,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleWheel,
        stopMiddlePan,
        handleMiddleMouseDown,
        handleMiddleMouseMove,
        handleMiddleMouseUp,
        preventMiddleAuxClick,
        handleSelectDoubleClick,
        updateSelectionFromTarget,
        updateSelectionFromTargets,
        handleSelectMouseDown,
        handleSelectObjectMoving,
        finalizeHandleDrag,
        handleSelectMouseMove,
        resolveWallIdFromTarget,
        resolveDimensionIdFromTarget,
        resolveSectionLineIdFromTarget,
        resolveRoomIdFromTarget,
        resolveObjectIdFromTarget,
        resolveOpeningIdFromTarget,
        resolveOpeningResizeHandleFromTarget,
        findOpeningAtPoint,
        filterMarqueeSelectionTargets,
        getTargetMeta,
        handleWallDoubleClick,
        handleWallToolKeyDown,
        handleWallToolKeyUp,
        handleDimensionDoubleClick,
        handleDimensionKeyDown,
        handleDimensionSelectMouseDown,
        offsetTool,
        trimTool,
        extendTool,
        computePlacement,
        syncOpeningForSymbol,
        buildHostedOpeningSymbolProperties,
        resolveOpeningWidthMm,
        resolveOpeningHeightMm,
        resolveOpeningSillHeightMm,
        hasFurnitureCollision,
        beginOpeningPointerInteraction,
        finishOpeningPointerInteraction,
        closeWallContextMenu,
        closeDimensionContextMenu,
        closeSectionLineContextMenu,
        closeObjectContextMenu,
        setSelectedIds,
        setHoveredElement,
        setProcessingStatus,
        updateSymbol,
        placePendingObject,
        onCancelObjectPlacement,
        setOpeningInteractionActive,
        setMarqueeSelectionMode,
        setPersistentRoomControlId,
        setPlacementRotationDeg,
        setWallContextMenu,
        setDimensionContextMenu,
        setSectionLineContextMenu,
        setObjectContextMenu,
        cancelSectionLineDrawing,
        commitSectionLine,
        setSectionLineDirection,
        nudgeSelectedObjects,
        wallRenderer,
    } = options;

    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const upperCanvasEl = canvas.upperCanvasEl;

        const handleCanvasDoubleClick = (event: MouseEvent) => {
            const target = canvas.findTarget(event as unknown as fabric.TPointerEvent);
            if (tool === 'select') {
                const dimensionHandled = handleDimensionDoubleClick(
                    (target as fabric.Object | null | undefined) ?? null
                );
                if (dimensionHandled) {
                    return;
                }
                const selectHandled = handleSelectDoubleClick(event);
                if (selectHandled) {
                    return;
                }
                const roomId = resolveRoomIdFromTarget(target ?? null);
                if (roomId && typeof window !== 'undefined') {
                    setSelectedIds([roomId]);
                    window.dispatchEvent(new CustomEvent('smart-drawing:open-room-properties'));
                }
            }
            if (tool === 'wall') {
                handleWallDoubleClick();
            }
        };

        // Wall tool keyboard handlers
        const handleWallKeyDown = (e: KeyboardEvent) => {
            if (pendingPlacementDefinition) {
                if (e.key === 'Escape') {
                    onCancelObjectPlacement?.();
                    objectRendererRef.current?.clearPlacementPreview();
                    e.preventDefault();
                    return;
                }
                if (e.key.toLowerCase() === 'r') {
                    const step = e.shiftKey ? 15 : 90;
                    setPlacementRotationDeg((prev) => ((prev + step) % 360 + 360) % 360);
                    e.preventDefault();
                    return;
                }
                if (e.key === 'Enter' && placementCursorRef.current) {
                    const handled = placePendingObject(placementCursorRef.current);
                    if (handled) {
                        e.preventDefault();
                        return;
                    }
                }
            }

            if (tool === 'wall') {
                handleWallToolKeyDown(e);
                return;
            }
            if (tool === 'select') {
                const arrowStep = e.shiftKey ? 1 : 10;
                if (e.key === 'ArrowUp') {
                    if (nudgeSelectedObjects(0, -arrowStep)) e.preventDefault();
                    return;
                }
                if (e.key === 'ArrowDown') {
                    if (nudgeSelectedObjects(0, arrowStep)) e.preventDefault();
                    return;
                }
                if (e.key === 'ArrowLeft') {
                    if (nudgeSelectedObjects(-arrowStep, 0)) e.preventDefault();
                    return;
                }
                if (e.key === 'ArrowRight') {
                    if (nudgeSelectedObjects(arrowStep, 0)) e.preventDefault();
                    return;
                }
            }
            if (tool === 'section-line') {
                if (e.key === 'Escape') {
                    cancelSectionLineDrawing();
                    e.preventDefault();
                    return;
                }
                if (e.key === 'Enter' && sectionLineDrawingState.isDrawing) {
                    commitSectionLine();
                    e.preventDefault();
                    return;
                }
                if (e.key.toLowerCase() === 'f') {
                    const nextDirection = sectionLineDrawingState.direction === 1 ? -1 : 1;
                    setSectionLineDirection(nextDirection);
                    e.preventDefault();
                }
                return;
            }
            if (tool === 'dimension') {
                const handled = handleDimensionKeyDown(e);
                if (handled) {
                    e.preventDefault();
                }
            }
            if (tool === 'offset') {
                const handled = offsetTool.handleKeyDown(e);
                if (handled) {
                    e.preventDefault();
                }
            }
            if (tool === 'trim') {
                const handled = trimTool.handleKeyDown(e);
                if (handled) {
                    e.preventDefault();
                }
            }
            if (tool === 'extend') {
                const handled = extendTool.handleKeyDown(e);
                if (handled) {
                    e.preventDefault();
                }
            }
        };
        const handleWallKeyUp = (e: KeyboardEvent) => {
            if (tool === 'wall') {
                handleWallToolKeyUp(e);
            }
        };

        const handleSelectionCreated = (event: fabric.CanvasEvents['selection:created']) => {
            if (tool !== 'select') return;
            hideActiveSelectionChrome(canvas);
            const nativeEvent = event.e as MouseEvent | PointerEvent | undefined;
            if (nativeEvent?.shiftKey || nativeEvent?.ctrlKey || nativeEvent?.metaKey) {
                return;
            }
            if (suppressFabricSelectionSyncRef.current > 0) {
                suppressFabricSelectionSyncRef.current -= 1;
                return;
            }
            const openingInteraction = openingPointerInteractionRef.current;
            if (openingInteraction) {
                setPersistentRoomControlId(null);
                setSelectedIds([openingInteraction.openingId]);
                return;
            }
            const targets = filterMarqueeSelectionTargets(event.selected ?? []);
            applyMarqueeFilterRef.current = false;
            const objectIds = targets
                .map((target) => resolveObjectIdFromTarget(target))
                .filter((id): id is string => Boolean(id));
            if (objectIds.length > 0) {
                setPersistentRoomControlId(null);
                setSelectedIds(Array.from(new Set(objectIds)));
                return;
            }
            const roomIds = targets
                .map((target) => resolveRoomIdFromTarget(target))
                .filter((id): id is string => Boolean(id));
            if (roomIds.length > 0) {
                const perimeterWallIds = perimeterWallIdsForRooms(roomIds);
                const roomSelectionIds = Array.from(new Set([...roomIds, ...perimeterWallIds]));
                if (roomSelectionIds.length > 0) {
                    setPersistentRoomControlId(roomIds[0] ?? null);
                    setSelectedIds(roomSelectionIds);
                    return;
                }
            }
            setPersistentRoomControlId(null);
            updateSelectionFromTargets(targets);
        };

        const handleSelectionUpdated = (event: fabric.CanvasEvents['selection:updated']) => {
            if (tool !== 'select') return;
            hideActiveSelectionChrome(canvas);
            const nativeEvent = event.e as MouseEvent | PointerEvent | undefined;
            if (nativeEvent?.shiftKey || nativeEvent?.ctrlKey || nativeEvent?.metaKey) {
                return;
            }
            if (suppressFabricSelectionSyncRef.current > 0) {
                suppressFabricSelectionSyncRef.current -= 1;
                return;
            }
            const openingInteraction = openingPointerInteractionRef.current;
            if (openingInteraction) {
                setPersistentRoomControlId(null);
                setSelectedIds([openingInteraction.openingId]);
                return;
            }
            const targets = filterMarqueeSelectionTargets(event.selected ?? []);
            applyMarqueeFilterRef.current = false;
            const objectIds = targets
                .map((target) => resolveObjectIdFromTarget(target))
                .filter((id): id is string => Boolean(id));
            if (objectIds.length > 0) {
                setPersistentRoomControlId(null);
                setSelectedIds(Array.from(new Set(objectIds)));
                return;
            }
            const roomIds = targets
                .map((target) => resolveRoomIdFromTarget(target))
                .filter((id): id is string => Boolean(id));
            if (roomIds.length > 0) {
                const perimeterWallIds = perimeterWallIdsForRooms(roomIds);
                const roomSelectionIds = Array.from(new Set([...roomIds, ...perimeterWallIds]));
                if (roomSelectionIds.length > 0) {
                    setPersistentRoomControlId(roomIds[0] ?? null);
                    setSelectedIds(roomSelectionIds);
                    return;
                }
            }
            setPersistentRoomControlId(null);
            updateSelectionFromTargets(targets);
        };

        const handleSelectionCleared = (event: fabric.CanvasEvents['selection:cleared']) => {
            const nativeEvent = event?.e as MouseEvent | PointerEvent | undefined;
            if (nativeEvent?.shiftKey || nativeEvent?.ctrlKey || nativeEvent?.metaKey) {
                return;
            }
            if (suppressFabricSelectionSyncRef.current > 0) {
                suppressFabricSelectionSyncRef.current -= 1;
                return;
            }
            applyMarqueeFilterRef.current = false;
            const openingInteraction = openingPointerInteractionRef.current;
            if (openingInteraction) {
                setPersistentRoomControlId(null);
                setSelectedIds([openingInteraction.openingId]);
                return;
            }
            if (!isWallHandleDraggingRef.current) {
                setPersistentRoomControlId(null);
                setSelectedIds([]);
            }
        };

        const handleCanvasMouseDown = (event: fabric.CanvasEvents['mouse:down']) => {
            closeWallContextMenu();
            closeDimensionContextMenu();
            closeSectionLineContextMenu();
            closeObjectContextMenu();
            if (pendingPlacementDefinition) return;
            if (tool !== 'select') return;
            suppressFabricSelectionSyncRef.current = 0;
            const suppressNextFabricSelectionSync = (count: number = 3) => {
                suppressFabricSelectionSyncRef.current = Math.max(
                    suppressFabricSelectionSyncRef.current,
                    count
                );
            };
            const getLiveSelectedSet = () =>
                new Set(useSmartDrawingStore.getState().selectedElementIds);
            const toggleSelectedId = (id: string) => {
                const current = getLiveSelectedSet();
                if (current.has(id)) {
                    current.delete(id);
                } else {
                    current.add(id);
                }
                setSelectedIds(Array.from(current));
            };
            const toggleSelectedIds = (ids: string[]) => {
                const current = getLiveSelectedSet();
                const alreadySelected = ids.every((id) => current.has(id));
                ids.forEach((id) => {
                    if (alreadySelected) {
                        current.delete(id);
                    } else {
                        current.add(id);
                    }
                });
                setSelectedIds(Array.from(current));
            };
            const hitTarget = ((event.target as fabric.Object | null | undefined) ??
                (event.e ? canvas.findTarget(event.e as unknown as fabric.TPointerEvent) : null) ??
                null);
            const subTargets = (event as fabric.CanvasEvents['mouse:down'] & { subTargets?: fabric.Object[] })
                .subTargets ?? [];
            const candidateTargets = [...subTargets, ...(hitTarget ? [hitTarget] : [])];
            const addToSelection = Boolean(event.e?.shiftKey || event.e?.ctrlKey || event.e?.metaKey);
            const scenePoint = event.e ? canvas.getScenePoint(event.e) : null;
            const wallPoint = scenePoint
                ? {
                    x: scenePoint.x / MM_TO_PX,
                    y: scenePoint.y / MM_TO_PX,
                }
                : null;
            openingPointerInteractionRef.current = null;
            setOpeningInteractionActive(false);
            const openingResizeHandle =
                candidateTargets
                    .map((target) => resolveOpeningResizeHandleFromTarget(target))
                    .find((entry): entry is OpeningResizeHandleHit => Boolean(entry)) ??
                null;
            if (openingResizeHandle) {
                suppressNextFabricSelectionSync();
                setPersistentRoomControlId(null);
                marqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
                lastMarqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
                applyMarqueeFilterRef.current = false;
                setMarqueeSelectionMode('window');
                setSelectedIds([openingResizeHandle.openingId]);
                setHoveredElement(openingResizeHandle.openingId);
                const hostWall = walls.find((wall) => wall.id === openingResizeHandle.wallId)
                    ?? walls.find((wall) =>
                        wall.openings.some((opening) => opening.id === openingResizeHandle.openingId)
                    );
                const hostOpening = hostWall?.openings.find(
                    (opening) => opening.id === openingResizeHandle.openingId
                );
                if (hostWall && hostOpening) {
                    const anchorEdgeAlongWall = openingResizeHandle.side === 'start'
                        ? hostOpening.position + hostOpening.width / 2
                        : hostOpening.position - hostOpening.width / 2;
                    beginOpeningPointerInteraction({
                        openingId: openingResizeHandle.openingId,
                        mode: openingResizeHandle.side === 'start' ? 'resize-start' : 'resize-end',
                        wallId: hostWall.id,
                        anchorEdgeAlongWall,
                        changed: false,
                    });
                }
                return;
            }

            const inferredOpening = wallPoint ? findOpeningAtPoint(wallPoint) : null;
            const openingVisualId =
                candidateTargets
                    .map((target) => resolveOpeningIdFromTarget(target))
                    .find((entry): entry is string => Boolean(entry)) ??
                resolveOpeningIdFromTarget(hitTarget)
                ?? inferredOpening?.openingId
                ?? null;
            if (openingVisualId) {
                suppressNextFabricSelectionSync();
                setPersistentRoomControlId(null);
                marqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
                lastMarqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
                applyMarqueeFilterRef.current = false;
                setMarqueeSelectionMode('window');
                if (addToSelection) {
                    toggleSelectedId(openingVisualId);
                } else {
                    setSelectedIds([openingVisualId]);
                }
                setHoveredElement(openingVisualId);
                if (!addToSelection) {
                    const hostWall = inferredOpening?.openingId === openingVisualId
                        ? walls.find((wall) => wall.id === inferredOpening.wallId)
                        : undefined;
                    const fallbackWall = walls.find((wall) =>
                        wall.openings.some((opening) => opening.id === openingVisualId)
                    );
                    const linkedWall = hostWall ?? fallbackWall;
                    const linkedOpening = linkedWall?.openings.find((opening) => opening.id === openingVisualId);
                    let grabOffsetAlongWallMm = 0;

                    if (linkedWall && linkedOpening && wallPoint) {
                        const wallLength = Math.hypot(
                            linkedWall.endPoint.x - linkedWall.startPoint.x,
                            linkedWall.endPoint.y - linkedWall.startPoint.y
                        );
                        if (Number.isFinite(wallLength) && wallLength > 0.001) {
                            const projection = projectPointToSegment(
                                wallPoint,
                                linkedWall.startPoint,
                                linkedWall.endPoint
                            );
                            const pointerAlongWall = projection.t * wallLength;
                            const rawOffset = pointerAlongWall - linkedOpening.position;
                            grabOffsetAlongWallMm = clampValue(
                                rawOffset,
                                -linkedOpening.width / 2,
                                linkedOpening.width / 2
                            );
                        }
                    }

                    beginOpeningPointerInteraction({
                        openingId: openingVisualId,
                        mode: 'move',
                        wallId: linkedWall?.id,
                        grabOffsetAlongWallMm,
                        changed: false,
                    });
                }
                return;
            }

            const sectionLineId =
                candidateTargets
                    .map((target) => resolveSectionLineIdFromTarget(target))
                    .find((entry): entry is string => Boolean(entry)) ??
                resolveSectionLineIdFromTarget(hitTarget);
            if (sectionLineId) {
                suppressNextFabricSelectionSync();
                setPersistentRoomControlId(null);
                if (addToSelection) {
                    toggleSelectedId(sectionLineId);
                } else {
                    setSelectedIds([sectionLineId]);
                }
                setHoveredElement(sectionLineId);
                return;
            }

            const objectId =
                candidateTargets
                    .map((target) => resolveObjectIdFromTarget(target))
                    .find((entry): entry is string => Boolean(entry)) ??
                resolveObjectIdFromTarget(hitTarget);
            if (objectId) {
                suppressNextFabricSelectionSync();
                setPersistentRoomControlId(null);
                if (addToSelection) {
                    toggleSelectedId(objectId);
                } else {
                    setSelectedIds([objectId]);
                }
                setHoveredElement(objectId);
                return;
            }

            if (!scenePoint) {
                updateSelectionFromTarget(hitTarget);
                return;
            }
            const wallPointMm = {
                x: scenePoint.x / MM_TO_PX,
                y: scenePoint.y / MM_TO_PX,
            };
            const prioritizedWallOrRoomTarget =
                candidateTargets.find((target) => {
                    const meta = getTargetMeta(target as fabric.Object | null | undefined);
                    return Boolean(meta.isWallControl || meta.isRoomControl);
                }) ?? null;
            const prioritizedDimensionControlTarget =
                candidateTargets.find((target) => {
                    const typed = target as fabric.Object & {
                        isDimensionControl?: boolean;
                    };
                    return Boolean(typed.isDimensionControl);
                }) ?? null;
            const targetMeta = getTargetMeta(prioritizedWallOrRoomTarget ?? hitTarget);
            const directWallId =
                candidateTargets
                    .map((target) => resolveWallIdFromTarget(target))
                    .find((entry): entry is string => Boolean(entry)) ??
                resolveWallIdFromTarget(hitTarget);
            const clickedWallId = directWallId ?? wallRenderer?.getWallIdAtPoint(wallPointMm) ?? null;
            const clickedRoomId =
                roomRendererRef.current?.getRoomIdAtPoint(wallPointMm) ??
                resolveRoomIdFromTarget(hitTarget);
            const clickedRoom = clickedRoomId ? roomById.get(clickedRoomId) ?? null : null;
            const roomInteriorDistance = clickedRoom
                ? roomBoundaryDistance(wallPointMm, clickedRoom.vertices)
                : Number.POSITIVE_INFINITY;
            const roomWallThicknesses = clickedRoom
                ? clickedRoom.wallIds
                    .map((wId) => wallById.get(wId)?.thickness)
                    .filter((value): value is number => Number.isFinite(value))
                : [];
            const roomInteriorThreshold = roomWallThicknesses.length > 0
                ? Math.max(10, Math.min(28, Math.min(...roomWallThicknesses) * 0.35))
                : 14;
            const isRoomAreaClick = roomInteriorDistance > roomInteriorThreshold;
            if (prioritizedWallOrRoomTarget) {
                suppressNextFabricSelectionSync();
                const prioritizedMeta = getTargetMeta(prioritizedWallOrRoomTarget);
                if (prioritizedMeta.roomId) {
                    setPersistentRoomControlId(prioritizedMeta.roomId);
                } else if (!prioritizedMeta.isRoomControl) {
                    setPersistentRoomControlId(null);
                }
                handleSelectMouseDown(prioritizedWallOrRoomTarget, wallPointMm, addToSelection);
                return;
            }
            if (
                clickedRoomId &&
                isRoomAreaClick &&
                !targetMeta.isRoomControl &&
                !targetMeta.isWallControl &&
                !targetMeta.wallId
            ) {
                const perimeterWallIdsList = perimeterWallIdsForRooms([clickedRoomId]);
                const roomSelectionIds = [clickedRoomId, ...perimeterWallIdsList];
                if (roomSelectionIds.length > 0) {
                    suppressNextFabricSelectionSync();
                    setPersistentRoomControlId(clickedRoomId);
                    wallRenderer?.setHoveredWall(null);
                    setHoveredElement(clickedRoomId);

                    const roomAlreadySelected = selectedIds.includes(clickedRoomId);
                    if (roomAlreadySelected && !addToSelection) {
                        const syntheticRoomTarget = {
                            roomId: clickedRoomId,
                            id: clickedRoomId,
                            name: `room-${clickedRoomId}`,
                        } as unknown as fabric.Object;
                        handleSelectMouseDown(syntheticRoomTarget, wallPointMm, false);
                    } else if (addToSelection) {
                        toggleSelectedIds(roomSelectionIds);
                    } else {
                        setSelectedIds(roomSelectionIds);
                    }
                    return;
                }
            }
            if (clickedWallId) {
                suppressNextFabricSelectionSync();
                setPersistentRoomControlId(null);
                if (addToSelection) {
                    canvas.discardActiveObject();
                    toggleSelectedId(clickedWallId);
                } else {
                    setSelectedIds([clickedWallId]);
                }
                wallRenderer?.setHoveredWall(clickedWallId);
                setHoveredElement(clickedWallId);
                return;
            }
            const dimensionHandled = handleDimensionSelectMouseDown(
                prioritizedDimensionControlTarget ?? hitTarget,
                wallPointMm,
                addToSelection
            );
            if (dimensionHandled) {
                suppressNextFabricSelectionSync();
                setPersistentRoomControlId(null);
                return;
            }
            setPersistentRoomControlId(null);
            handleSelectMouseDown(prioritizedWallOrRoomTarget ?? hitTarget, wallPointMm, addToSelection);
        };

        const handleCanvasContextMenu = (event: MouseEvent) => {
            if (tool !== 'select') {
                closeWallContextMenu();
                closeDimensionContextMenu();
                closeSectionLineContextMenu();
                closeObjectContextMenu();
                return;
            }

            const target = canvas.findTarget(event as unknown as fabric.TPointerEvent);
            const scenePoint = canvas.getScenePoint(event as unknown as fabric.TPointerEvent);
            const wallPointMm = scenePoint
                ? {
                    x: scenePoint.x / MM_TO_PX,
                    y: scenePoint.y / MM_TO_PX,
                }
                : null;
            const targetSectionLineId = resolveSectionLineIdFromTarget(target ?? null);
            const targetObjectId = resolveObjectIdFromTarget(target ?? null);
            const clickedWallId = wallPointMm ? wallRenderer?.getWallIdAtPoint(wallPointMm) ?? null : null;
            if (!targetSectionLineId && !targetObjectId && clickedWallId) {
                event.preventDefault();
                event.stopPropagation();
                setSelectedIds([clickedWallId]);
                closeDimensionContextMenu();
                closeSectionLineContextMenu();
                closeObjectContextMenu();

                const outerRect = outerRef.current?.getBoundingClientRect();
                const x = outerRect ? event.clientX - outerRect.left : event.clientX;
                const y = outerRect ? event.clientY - outerRect.top : event.clientY;
                setWallContextMenu({ wallId: clickedWallId, x, y });
                return;
            }
            const dimensionId = resolveDimensionIdFromTarget(target ?? null);
            if (dimensionId) {
                event.preventDefault();
                event.stopPropagation();
                setSelectedIds([dimensionId]);
                closeWallContextMenu();
                closeSectionLineContextMenu();
                closeObjectContextMenu();

                const outerRect = outerRef.current?.getBoundingClientRect();
                const x = outerRect ? event.clientX - outerRect.left : event.clientX;
                const y = outerRect ? event.clientY - outerRect.top : event.clientY;
                setDimensionContextMenu({ dimensionId, x, y });
                return;
            }

            const sectionLineId = targetSectionLineId;
            if (sectionLineId) {
                event.preventDefault();
                event.stopPropagation();
                setSelectedIds([sectionLineId]);
                closeWallContextMenu();
                closeDimensionContextMenu();
                closeObjectContextMenu();

                const outerRect = outerRef.current?.getBoundingClientRect();
                const x = outerRect ? event.clientX - outerRect.left : event.clientX;
                const y = outerRect ? event.clientY - outerRect.top : event.clientY;
                setSectionLineContextMenu({ sectionLineId, x, y });
                return;
            }

            const contextObjectId = targetObjectId;
            if (contextObjectId) {
                event.preventDefault();
                event.stopPropagation();
                setSelectedIds([contextObjectId]);
                closeWallContextMenu();
                closeDimensionContextMenu();
                closeSectionLineContextMenu();

                const outerRect = outerRef.current?.getBoundingClientRect();
                const x = outerRect ? event.clientX - outerRect.left : event.clientX;
                const y = outerRect ? event.clientY - outerRect.top : event.clientY;
                setObjectContextMenu({ objectId: contextObjectId, x, y });
                return;
            }

            const wallId = resolveWallIdFromTarget(target ?? null);
            if (!wallId) {
                closeWallContextMenu();
                closeDimensionContextMenu();
                closeSectionLineContextMenu();
                closeObjectContextMenu();
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            setSelectedIds([wallId]);
            closeDimensionContextMenu();
            closeSectionLineContextMenu();
            closeObjectContextMenu();

            const outerRect = outerRef.current?.getBoundingClientRect();
            const x = outerRect ? event.clientX - outerRect.left : event.clientX;
            const y = outerRect ? event.clientY - outerRect.top : event.clientY;
            setWallContextMenu({ wallId, x, y });
        };

        const handleObjectMoving = (event: fabric.CanvasEvents['object:moving']) => {
            if (!event.target || tool !== 'select') return;

            const objectId = resolveObjectIdFromTarget(event.target);
            if (objectId) {
                const target = event.target as fabric.Object;

                // ── Drag-start optimisation: skip target-find while dragging ──
                if (!isDraggingObjectRef.current) {
                    isDraggingObjectRef.current = true;
                    // Tell Fabric not to hit-test other objects on every mouse move
                    if (canvas) canvas.skipTargetFind = true;
                }

                const instance = symbols.find((entry) => entry.id === objectId);
                const definition = instance
                    ? objectDefinitionsById.get(instance.symbolId)
                    : undefined;
                const isFurnitureLike =
                    definition?.category === 'furniture' || definition?.category === 'fixtures';

                if (resolvedSnapToGrid && !isFurnitureLike) {
                    const center = target.getCenterPoint();
                    const snappedPx = snapPointToGrid(
                        { x: center.x, y: center.y },
                        effectiveSnapGridSize
                    );
                    target.set({ left: snappedPx.x, top: snappedPx.y });
                }

                const movedCenter = target.getCenterPoint();
                const movedPositionMm = {
                    x: movedCenter.x / MM_TO_PX,
                    y: movedCenter.y / MM_TO_PX,
                };

                if (instance && definition) {
                    const isOpening =
                        definition.category === 'doors' || definition.category === 'windows';
                    if (isOpening) {
                        const openingWidthMm = resolveOpeningWidthMm(definition, instance.properties);
                        const snappedPlacement = computePlacement(movedPositionMm, definition, {
                            ignoreOpeningId: objectId,
                            ignoreSymbolId: objectId,
                            openingWidthMm,
                        });

                        if (!snappedPlacement.valid || !snappedPlacement.snappedWall) {
                            target.set({
                                left: instance.position.x * MM_TO_PX,
                                top: instance.position.y * MM_TO_PX,
                                angle: instance.rotation,
                            });
                            return;
                        }

                        target.set({
                            left: snappedPlacement.point.x * MM_TO_PX,
                            top: snappedPlacement.point.y * MM_TO_PX,
                            angle: snappedPlacement.rotationDeg,
                        });
                        return;
                    }

                }
                return;
            }

            handleSelectObjectMoving(event.target);
        };

        const handleObjectModified = (event: fabric.CanvasEvents['object:modified']) => {
            // ── Drag-end cleanup: restore canvas interactive behaviour ──
            if (isDraggingObjectRef.current) {
                isDraggingObjectRef.current = false;
                if (canvas) canvas.skipTargetFind = false;
            }

            if (!event.target) return;
            const objectId = resolveObjectIdFromTarget(event.target);
            if (objectId) {
                const target = event.target as fabric.Object;
                const center = target.getCenterPoint();
                const position = {
                    x: center.x / MM_TO_PX,
                    y: center.y / MM_TO_PX,
                };
                const rotation = target.angle ?? 0;
                const existing = symbols.find((entry) => entry.id === objectId);
                if (existing) {
                    const definition = objectDefinitionsById.get(existing.symbolId);
                    if (
                        definition &&
                        (definition.category === 'doors' || definition.category === 'windows')
                    ) {
                        const openingWidthMm = resolveOpeningWidthMm(definition, existing.properties);
                        const openingHeightMm = resolveOpeningHeightMm(definition, existing.properties);
                        const openingSillHeightMm = resolveOpeningSillHeightMm(definition, existing.properties);
                        const placement = computePlacement(position, definition, {
                            ignoreOpeningId: objectId,
                            ignoreSymbolId: objectId,
                            openingWidthMm,
                        });

                        if (!placement.valid || !placement.snappedWall) {
                            target.set({
                                left: existing.position.x * MM_TO_PX,
                                top: existing.position.y * MM_TO_PX,
                                angle: existing.rotation,
                            });
                            fabricRef.current?.requestRenderAll();
                            setProcessingStatus(
                                'Move blocked: opening must remain on a valid wall segment.',
                                false
                            );
                            return;
                        }

                        const snappedWall = placement.snappedWall.wall;
                        const nextRotation = placement.rotationDeg;
                        const nextPosition = placement.point;
                        const nextProperties = buildHostedOpeningSymbolProperties(
                            definition,
                            snappedWall,
                            placement.snappedWall.positionAlongWall,
                            existing.properties,
                            openingWidthMm,
                            openingHeightMm,
                            openingSillHeightMm
                        );

                        syncOpeningForSymbol(objectId, definition, {
                            wall: snappedWall,
                            positionAlongWall: placement.snappedWall.positionAlongWall,
                        }, {
                            openingWidthMm,
                            openingHeightMm,
                            sillHeightMm: openingSillHeightMm,
                        });

                        const changed =
                            Math.abs(existing.position.x - nextPosition.x) > 0.01 ||
                            Math.abs(existing.position.y - nextPosition.y) > 0.01 ||
                            Math.abs(existing.rotation - nextRotation) > 0.01 ||
                            existing.properties?.hostWallId !== nextProperties.hostWallId ||
                            Math.abs(
                                Number(existing.properties?.widthMm ?? 0) -
                                Number(nextProperties.widthMm ?? 0)
                            ) > 0.01 ||
                            Math.abs(
                                Number(existing.properties?.heightMm ?? 0) -
                                Number(nextProperties.heightMm ?? 0)
                            ) > 0.01 ||
                            Math.abs(
                                Number(existing.properties?.positionAlongWallMm ?? 0) -
                                Number(nextProperties.positionAlongWallMm ?? 0)
                            ) > 0.01 ||
                            String(existing.properties?.doorOpenSide ?? '') !== String(nextProperties.doorOpenSide ?? '');

                        if (changed) {
                            updateSymbol(objectId, {
                                position: nextPosition,
                                rotation: nextRotation,
                                properties: nextProperties,
                            });
                        }

                        target.set({
                            left: nextPosition.x * MM_TO_PX,
                            top: nextPosition.y * MM_TO_PX,
                            angle: nextRotation,
                        });
                        fabricRef.current?.requestRenderAll();
                        return;
                    }

                    if (
                        definition &&
                        (definition.category === 'furniture' || definition.category === 'fixtures')
                    ) {
                        const collides = hasFurnitureCollision(position, definition, {
                            ignoreSymbolId: objectId,
                        });
                        if (collides) {
                            setProcessingStatus('Warning: furniture overlap detected.', false);
                        }
                    }
                }

                if (
                    existing &&
                    (Math.abs(existing.position.x - position.x) > 0.01 ||
                        Math.abs(existing.position.y - position.y) > 0.01 ||
                        Math.abs(existing.rotation - rotation) > 0.01)
                ) {
                    updateSymbol(objectId, { position, rotation });
                }
                return;
            }
            finalizeHandleDrag();
        };

        const handleObjectRotating = (event: fabric.CanvasEvents['object:rotating']) => {
            if (!event.target || tool !== 'select') return;
            const objectId = resolveObjectIdFromTarget(event.target);
            if (!objectId) return;
            const nativeEvent = event.e as MouseEvent | undefined;
            const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
            const majorAngles = [0, 45, 90, 135, 180, 225, 270, 315];
            const currentAngle = normalizeAngle(event.target.angle ?? 0);
            const nearestMajorAngle = majorAngles.reduce((best, candidate) => {
                const candidateDelta = Math.abs(candidate - currentAngle);
                const wrappedDelta = Math.min(candidateDelta, 360 - candidateDelta);
                const bestDelta = Math.abs(best - currentAngle);
                const wrappedBestDelta = Math.min(bestDelta, 360 - bestDelta);
                return wrappedDelta < wrappedBestDelta ? candidate : best;
            }, majorAngles[0] ?? 0);
            const snapToIncrement = nativeEvent?.shiftKey || nativeEvent?.ctrlKey;
            if (snapToIncrement) {
                event.target.set('angle', Math.round(currentAngle / 15) * 15);
            } else {
                const delta = Math.abs(nearestMajorAngle - currentAngle);
                const wrappedDelta = Math.min(delta, 360 - delta);
                if (wrappedDelta <= 4) {
                    event.target.set('angle', nearestMajorAngle);
                }
            }
            const liveAngle = ((event.target.angle ?? 0) % 360 + 360) % 360;
            setProcessingStatus(`Object rotation: ${liveAngle.toFixed(1)}deg`, false);
        };

        const handleWindowBlur = () => {
            stopMiddlePan();
            finalizeHandleDrag();
            finishOpeningPointerInteraction();
        };

        const handleSelectDragMouseMove = (event: MouseEvent) => {
            if (tool !== 'select') return;
            if (!isWallHandleDraggingRef.current) return;
            if (upperCanvasEl && event.target instanceof Node && upperCanvasEl.contains(event.target)) {
                return;
            }
            const scenePoint = canvas.getScenePoint(event as unknown as fabric.TPointerEvent);
            const selectPoint = {
                x: scenePoint.x / MM_TO_PX,
                y: scenePoint.y / MM_TO_PX,
            };
            handleSelectMouseMove(selectPoint, null);
        };

        const handleCanvasMouseLeave = () => {
            wallRenderer?.setHoveredWall(null);
            setHoveredElement(null);
        };

        canvas.on('mouse:down', handleMouseDown);
        canvas.on('mouse:move', handleMouseMove);
        canvas.on('mouse:up', handleMouseUp);
        canvas.on('mouse:wheel', handleWheel);
        canvas.on('selection:created', handleSelectionCreated);
        canvas.on('selection:updated', handleSelectionUpdated);
        canvas.on('selection:cleared', handleSelectionCleared);
        canvas.on('mouse:down', handleCanvasMouseDown);
        canvas.on('object:moving', handleObjectMoving);
        canvas.on('object:rotating', handleObjectRotating);
        canvas.on('object:modified', handleObjectModified);
        window.addEventListener('mouseup', handleMouseUp);

        upperCanvasEl?.addEventListener('mousedown', handleMiddleMouseDown);
        upperCanvasEl?.addEventListener('auxclick', preventMiddleAuxClick);
        upperCanvasEl?.addEventListener('dblclick', handleCanvasDoubleClick);
        upperCanvasEl?.addEventListener('mouseleave', handleCanvasMouseLeave);
        upperCanvasEl?.addEventListener('contextmenu', handleCanvasContextMenu);
        window.addEventListener('mousemove', handleSelectDragMouseMove);
        window.addEventListener('mousemove', handleMiddleMouseMove, { passive: false });
        window.addEventListener('mouseup', handleMiddleMouseUp);
        window.addEventListener('blur', handleWindowBlur);
        window.addEventListener('keydown', handleWallKeyDown);
        window.addEventListener('keyup', handleWallKeyUp);

        return () => {
            canvas.off('mouse:down', handleMouseDown);
            canvas.off('mouse:move', handleMouseMove);
            canvas.off('mouse:up', handleMouseUp);
            canvas.off('mouse:wheel', handleWheel);
            canvas.off('selection:created', handleSelectionCreated);
            canvas.off('selection:updated', handleSelectionUpdated);
            canvas.off('selection:cleared', handleSelectionCleared);
            canvas.off('mouse:down', handleCanvasMouseDown);
            canvas.off('object:moving', handleObjectMoving);
            canvas.off('object:rotating', handleObjectRotating);
            canvas.off('object:modified', handleObjectModified);
            window.removeEventListener('mouseup', handleMouseUp);
            upperCanvasEl?.removeEventListener('mousedown', handleMiddleMouseDown);
            upperCanvasEl?.removeEventListener('auxclick', preventMiddleAuxClick);
            upperCanvasEl?.removeEventListener('dblclick', handleCanvasDoubleClick);
            upperCanvasEl?.removeEventListener('mouseleave', handleCanvasMouseLeave);
            upperCanvasEl?.removeEventListener('contextmenu', handleCanvasContextMenu);
            window.removeEventListener('mousemove', handleSelectDragMouseMove);
            window.removeEventListener('mousemove', handleMiddleMouseMove);
            window.removeEventListener('mouseup', handleMiddleMouseUp);
            window.removeEventListener('blur', handleWindowBlur);
            window.removeEventListener('keydown', handleWallKeyDown);
            window.removeEventListener('keyup', handleWallKeyUp);
            // Cancel any pending wheel rAF store sync.
            if (wheelRafId.current) {
                cancelAnimationFrame(wheelRafId.current);
                wheelRafId.current = null;
            }
        };
    }, [
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleWheel,
        tool,
        stopMiddlePan,
        handleMiddleMouseDown,
        handleMiddleMouseMove,
        handleMiddleMouseUp,
        preventMiddleAuxClick,
        handleSelectDoubleClick,
        updateSelectionFromTargets,
        isWallHandleDraggingRef,
        updateSelectionFromTarget,
        handleSelectMouseDown,
        handleSelectObjectMoving,
        finalizeHandleDrag,
        handleSelectMouseMove,
        setSelectedIds,
        selectedIds,
        setHoveredElement,
        closeWallContextMenu,
        closeDimensionContextMenu,
        closeSectionLineContextMenu,
        closeObjectContextMenu,
        resolveWallIdFromTarget,
        resolveDimensionIdFromTarget,
        resolveSectionLineIdFromTarget,
        resolveRoomIdFromTarget,
        resolveObjectIdFromTarget,
        resolveOpeningIdFromTarget,
        resolveOpeningResizeHandleFromTarget,
        findOpeningAtPoint,
        filterMarqueeSelectionTargets,
        getTargetMeta,
        handleWallDoubleClick,
        handleWallToolKeyDown,
        handleWallToolKeyUp,
        handleDimensionDoubleClick,
        handleDimensionKeyDown,
        handleDimensionSelectMouseDown,
        offsetTool,
        trimTool,
        extendTool,
        symbols,
        objectDefinitionsById,
        hasFurnitureCollision,
        computePlacement,
        syncOpeningForSymbol,
        resolveOpeningWidthMm,
        resolveOpeningHeightMm,
        resolveOpeningSillHeightMm,
        resolvedSnapToGrid,
        effectiveSnapGridSize,
        updateSymbol,
        setProcessingStatus,
        pendingPlacementDefinition,
        onCancelObjectPlacement,
        placePendingObject,
        perimeterWallIdsForRooms,
        roomBoundaryDistance,
        roomById,
        nudgeSelectedObjects,
        cancelSectionLineDrawing,
        commitSectionLine,
        sectionLineDrawingState.isDrawing,
        sectionLineDrawingState.direction,
        setSectionLineDirection,
        projectPointToSegment,
        wallById,
        walls,
        wallIdSet,
        wallRenderer,
        beginOpeningPointerInteraction,
        finishOpeningPointerInteraction,
    ]);

    return {};
}
