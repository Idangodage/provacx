/**
 * Drawing Canvas Component
 *
 * Main Fabric.js canvas wrapper for smart drawing.
 * Uses mode-specific hooks following industry best practices.
 */

'use client';

import * as fabric from 'fabric';
import { useEffect, useRef, useCallback, useMemo, useState } from 'react';

import type { ArchitecturalObjectDefinition } from '../data';
import { useSmartDrawingStore } from '../store';
import type { DisplayUnit, Point2D, SymbolInstance2D, Wall } from '../types';
import { resolveHostedDoorSwingProperties } from '../utils/doorSwing';
import { generateId } from '../utils/geometry';

import {
    Grid,
    PageLayout,
    Rulers,
    snapWallPoint,
    snapPointToGrid,
    getToolCursor,
    isDrawingTool,
    renderDrawingPreview,
    MM_TO_PX,
    toMillimeters,
    type PaperUnit,
    // Hooks
    useCanvasKeyboard,
    useSelectMode,
    useMiddlePan,
    useWallTool,
    useRoomTool,
    useDimensionTool,
    useOffsetTool,
    useTrimTool,
    useExtendTool,
    RoomRenderer,
    DimensionRenderer,
    ObjectRenderer,
    SectionLineRenderer,
    HvacPlanRenderer,
    formatDimensionLength,
} from './canvas';
import { endDragPerfTimer, startDragPerfTimer } from './canvas/perf/dragPerf';

// =============================================================================
// Types & Constants
// =============================================================================

export interface DrawingCanvasProps {
    className?: string;
    gridSize?: number;
    snapToGrid?: boolean;
    showGrid?: boolean;
    showRulers?: boolean;
    paperUnit?: PaperUnit;
    realWorldUnit?: DisplayUnit;
    scaleDrawing?: number;
    scaleReal?: number;
    rulerMode?: 'paper' | 'real';
    majorTickInterval?: number;
    tickSubdivisions?: number;
    showRulerLabels?: boolean;
    gridMode?: 'paper' | 'real';
    majorGridSize?: number;
    gridSubdivisions?: number;
    backgroundColor?: string;
    onCanvasReady?: (canvas: fabric.Canvas) => void;
    objectDefinitions?: ArchitecturalObjectDefinition[];
    pendingPlacementObjectId?: string | null;
    onObjectPlaced?: (definitionId: string, instance: SymbolInstance2D) => void;
    onCancelObjectPlacement?: () => void;
}

interface CanvasState {
    isPanning: boolean;
    lastPanPoint: Point2D | null;
    isDrawing: boolean;
    drawingPoints: Point2D[];
}

interface MarqueeSelectionState {
    active: boolean;
    start: Point2D | null;
    current: Point2D | null;
    mode: 'window' | 'crossing';
}

interface WallContextMenuState {
    wallId: string;
    x: number;
    y: number;
}

interface DimensionContextMenuState {
    dimensionId: string;
    x: number;
    y: number;
}

interface SectionLineContextMenuState {
    sectionLineId: string;
    x: number;
    y: number;
}

interface ObjectContextMenuState {
    objectId: string;
    x: number;
    y: number;
}

interface OpeningResizeHandleHit {
    openingId: string;
    wallId: string;
    side: 'start' | 'end';
}

interface OpeningPointerInteraction {
    openingId: string;
    mode: 'move' | 'resize-start' | 'resize-end';
    wallId?: string;
    anchorEdgeAlongWall?: number;
    grabOffsetAlongWallMm?: number;
    changed: boolean;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const MIN_OPENING_EDGE_MARGIN_MM = 50;
const MIN_OPENING_GEOMETRY_WIDTH_MM = 120;
const OPENING_HIT_PADDING_MM = 20;
const OPENING_RESIZE_HANDLE_SIZE_PX = 16;
const OPENING_RESIZE_HANDLE_COLOR = '#7a2e0a';

const clampValue = (value: number, min: number, max: number): number => {
    if (min > max) return value;
    return Math.min(max, Math.max(min, value));
};

const hideActiveSelectionChrome = (canvas: fabric.Canvas | null): void => {
    if (!canvas) return;
    const activeObject = canvas.getActiveObject() as
        | (fabric.Object & {
            setControlsVisibility?: (options: Record<string, boolean>) => void;
            allowRotationControl?: boolean;
            objectCategory?: string;
            controls?: Record<string, fabric.Control | undefined>;
        })
        | null;
    if (!activeObject) return;

    if (activeObject.allowRotationControl) {
        activeObject.set({
            hasControls: true,
            hasBorders: false,
            borderColor: 'rgba(0,0,0,0)',
            cornerColor: '#2563EB',
            cornerStrokeColor: '#FFFFFF',
            transparentCorners: false,
            cornerSize: 14,
            touchCornerSize: 26,
            padding: 0,
        });
        if (typeof activeObject.setControlsVisibility === 'function') {
            activeObject.setControlsVisibility({
                tl: false,
                tr: false,
                bl: false,
                br: false,
                ml: false,
                mt: false,
                mr: false,
                mb: false,
                mtr: true,
            });
        }
        const rotationControl = activeObject.controls?.mtr;
        if (rotationControl) {
            rotationControl.offsetY = -28;
            rotationControl.withConnection = true;
        }
        return;
    }

    activeObject.set({
        hasControls: false,
        hasBorders: false,
        borderColor: 'rgba(0,0,0,0)',
        cornerColor: 'rgba(0,0,0,0)',
        cornerStrokeColor: 'rgba(0,0,0,0)',
        transparentCorners: true,
        cornerSize: 0,
        padding: 0,
    });
    if (typeof activeObject.setControlsVisibility === 'function') {
        activeObject.setControlsVisibility({
            tl: false,
            tr: false,
            bl: false,
            br: false,
            ml: false,
            mt: false,
            mr: false,
            mb: false,
            mtr: false,
        });
    }
};

// =============================================================================
// Component
// =============================================================================

export function DrawingCanvas({
    className = '',
    gridSize,
    snapToGrid,
    showGrid,
    showRulers,
    paperUnit = 'mm',
    realWorldUnit,
    scaleDrawing = 1,
    scaleReal = 50,
    rulerMode = 'paper',
    majorTickInterval = 10,
    tickSubdivisions = 10,
    showRulerLabels = true,
    gridMode = 'paper',
    majorGridSize = 10,
    gridSubdivisions = 10,
    backgroundColor = 'transparent',
    onCanvasReady,
    objectDefinitions = [],
    pendingPlacementObjectId = null,
    onObjectPlaced,
    onCancelObjectPlacement,
}: DrawingCanvasProps) {
    // Core refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const snapOverlayRef = useRef<HTMLCanvasElement>(null); // [SNAP WIRE] overlay for snap indicators
    const outerRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);
    const roomRendererRef = useRef<RoomRenderer | null>(null);
    const dimensionRendererRef = useRef<DimensionRenderer | null>(null);
    const objectRendererRef = useRef<ObjectRenderer | null>(null);
    const sectionLineRendererRef = useRef<SectionLineRenderer | null>(null);
    const hvacRendererRef = useRef<HvacPlanRenderer | null>(null);
    const zoomRef = useRef(1);
    const panOffsetRef = useRef<Point2D>({ x: 0, y: 0 });
    // Smooth-zoom: rAF-batched store sync (one React update per frame)
    const wheelRafId = useRef<number | null>(null);
    const wheelPendingZoom = useRef<number>(1);
    const wheelPendingPan = useRef<Point2D>({ x: 0, y: 0 });
    const paperScaleRatioRef = useRef(1);
    const placementCursorRef = useRef<Point2D | null>(null);
    const mousePositionRef = useRef<Point2D>({ x: 0, y: 0 });
    const mousePositionFrameRef = useRef<number | null>(null);
    const marqueeSelectionRef = useRef<MarqueeSelectionState>({
        active: false,
        start: null,
        current: null,
        mode: 'window',
    });
    const lastMarqueeSelectionRef = useRef<MarqueeSelectionState>({
        active: false,
        start: null,
        current: null,
        mode: 'window',
    });
    const applyMarqueeFilterRef = useRef(false);
    const canvasStateRef = useRef<CanvasState>({
        isPanning: false,
        lastPanPoint: null,
        isDrawing: false,
        drawingPoints: [],
    });
    const wallClipboardRef = useRef<Wall[] | null>(null);
    const openingResizeHandlesRef = useRef<fabric.Object[]>([]);
    const openingPointerInteractionRef = useRef<OpeningPointerInteraction | null>(null);
    const suppressFabricSelectionSyncRef = useRef(0);
    const dimensionRefreshFrameRef = useRef<number | null>(null);
    const autoDimensionSyncFrameRef = useRef<number | null>(null);
    const objectRefreshFrameRef = useRef<number | null>(null);

    // Drag interaction state
    const isDraggingObjectRef = useRef(false);

    // State
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [mousePosition, setMousePosition] = useState<Point2D>({ x: 0, y: 0 });
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [fabricCanvas, setFabricCanvas] = useState<fabric.Canvas | null>(null);
    const [wallContextMenu, setWallContextMenu] = useState<WallContextMenuState | null>(null);
    const [dimensionContextMenu, setDimensionContextMenu] = useState<DimensionContextMenuState | null>(null);
    const [sectionLineContextMenu, setSectionLineContextMenu] = useState<SectionLineContextMenuState | null>(null);
    const [objectContextMenu, setObjectContextMenu] = useState<ObjectContextMenuState | null>(null);
    const [placementRotationDeg, setPlacementRotationDeg] = useState(0);
    const [placementValid, setPlacementValid] = useState(true);
    const [openingInteractionActive, setOpeningInteractionActive] = useState(false);
    const [isHandleDragging, setIsHandleDragging] = useState(false);
    const [activeRoomDragId, setActiveRoomDragId] = useState<string | null>(null);
    const [persistentRoomControlId, setPersistentRoomControlId] = useState<string | null>(null);
    const [canvasState, setCanvasState] = useState<CanvasState>({
        isPanning: false,
        lastPanPoint: null,
        isDrawing: false,
        drawingPoints: [],
    });

    const setViewportSizeIfChanged = useCallback((width: number, height: number) => {
        const nextWidth = Math.max(1, Math.floor(width));
        const nextHeight = Math.max(1, Math.floor(height));
        setViewportSize((prev) => {
            if (prev.width === nextWidth && prev.height === nextHeight) {
                return prev;
            }
            return { width: nextWidth, height: nextHeight };
        });
    }, []);

    // Store
    const {
        activeTool: tool,
        zoom,
        panOffset,
        displayUnit,
        selectedElementIds: selectedIds,
        hoveredElementId,
        dimensions,
        dimensionSettings,
        symbols,
        pageConfig,
        gridSize: storeGridSize,
        showGrid: storeShowGrid,
        showRulers: storeShowRulers,
        snapToGrid: storeSnapToGrid,
        setPanOffset,
        setViewTransform,
        setTool,
        setSelectedIds,
        setHoveredElement,
        setProcessingStatus,
        saveToHistory,
        detectRooms,
        addSketch,
        addDimension,
        updateDimension,
        deleteDimension,
        addSymbol,
        updateSymbol,
        deleteSymbol,
        addWall,
        deleteSelected,
        updateWall,
        updateWalls,
        updateWallBevel,
        resetWallBevel,
        getCornerBevelDots,
        deleteWall,
        getWall,
        // Wall state and actions
        walls,
        rooms,
        translateAttachedSymbolsForRooms,
        rotateRoomAttachedSymbols,
        wallDrawingState,
        wallSettings,
        sectionLines,
        sectionLineDrawingState,
        startWallDrawing,
        updateWallPreview,
        commitWall,
        cancelWallDrawing,
        startSectionLineDrawing,
        updateSectionLinePreview,
        commitSectionLine,
        cancelSectionLineDrawing,
        setSectionLineDirection,
        flipSectionLineDirection,
        updateSectionLine,
        deleteSectionLine,
        generateElevationForSection,
        connectWalls,
        createRoomWalls,
        moveRoom,
        hvacElements,
        syncAutoDimensions,
    } = useSmartDrawingStore();
    const wallsRef = useRef<Wall[]>(walls);
    const symbolsRef = useRef<SymbolInstance2D[]>(symbols);
    wallsRef.current = walls;
    symbolsRef.current = symbols;

    // Derived values
    const resolvedRealWorldUnit = realWorldUnit ?? displayUnit;
    const resolvedGridSize = gridSize ?? storeGridSize ?? 20;
    const resolvedShowGrid = showGrid ?? storeShowGrid ?? true;
    const resolvedShowRulers = showRulers ?? storeShowRulers ?? true;
    const resolvedSnapToGrid = snapToGrid ?? storeSnapToGrid ?? true;
    const safeScaleDrawing = Number.isFinite(scaleDrawing) && scaleDrawing > 0 ? scaleDrawing : 1;
    const safeScaleReal = Number.isFinite(scaleReal) && scaleReal > 0 ? scaleReal : 1;
    const paperPerRealRatio = safeScaleDrawing / safeScaleReal;
    const safePaperPerRealRatio = Math.max(paperPerRealRatio, 0.000001);
    const viewportZoom = zoom * safePaperPerRealRatio;
    const overlayPanOffset = useMemo(
        () => ({
            x: panOffset.x * safePaperPerRealRatio,
            y: panOffset.y * safePaperPerRealRatio,
        }),
        [panOffset.x, panOffset.y, safePaperPerRealRatio]
    );
    const rulerMousePosition = useMemo(
        () => ({
            x: mousePosition.x * safePaperPerRealRatio,
            y: mousePosition.y * safePaperPerRealRatio,
        }),
        [mousePosition.x, mousePosition.y, safePaperPerRealRatio]
    );
    const safeGridSubdivisions = Number.isFinite(gridSubdivisions) && gridSubdivisions >= 1
        ? Math.max(1, Math.floor(gridSubdivisions))
        : 1;
    const baseGridMajorMm = gridMode === 'real'
        ? toMillimeters(majorGridSize, resolvedRealWorldUnit) * paperPerRealRatio
        : toMillimeters(majorGridSize, paperUnit);
    const configuredGridMajorPaperPx = Math.max(baseGridMajorMm * MM_TO_PX, 0.5);
    const effectiveSnapGridSize = Math.max(
        configuredGridMajorPaperPx / safeGridSubdivisions / safePaperPerRealRatio,
        0.5
    );
    const rulerSize = 24;
    const leftRulerWidth = Math.round(rulerSize * 1.2);
    const originOffset = resolvedShowRulers ? { x: leftRulerWidth, y: rulerSize } : { x: 0, y: 0 };
    const hostWidth = Math.max(1, viewportSize.width - originOffset.x);
    const hostHeight = Math.max(1, viewportSize.height - originOffset.y);
    const objectDefinitionsById = useMemo(
        () => new Map(objectDefinitions.map((definition) => [definition.id, definition])),
        [objectDefinitions]
    );
    const wallIdSet = useMemo(() => new Set(walls.map((wall) => wall.id)), [walls]);
    const wallById = useMemo(() => new Map(walls.map((wall) => [wall.id, wall])), [walls]);
    const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
    const pendingPlacementDefinition = pendingPlacementObjectId
        ? objectDefinitionsById.get(pendingPlacementObjectId) ?? null
        : null;
    const contextObjectInstance = objectContextMenu
        ? symbols.find((entry) => entry.id === objectContextMenu.objectId) ?? null
        : null;
    const contextObjectDefinition = contextObjectInstance
        ? objectDefinitionsById.get(contextObjectInstance.symbolId) ?? null
        : null;
    const isContextDoorObject = contextObjectDefinition?.category === 'doors';
    const doorWindowSymbolsSignature = useMemo(() => {
        return symbols
            .map((instance) => {
                const definition = objectDefinitionsById.get(instance.symbolId);
                if (!definition) return null;
                if (definition.category !== 'doors' && definition.category !== 'windows') return null;
                return [
                    instance.id,
                    definition.type,
                    instance.rotation.toFixed(2),
                    String(instance.properties?.swingDirection ?? ''),
                    String(instance.properties?.type ?? ''),
                    String(instance.properties?.widthMm ?? ''),
                    String(instance.properties?.heightMm ?? ''),
                    String(instance.properties?.hostWallId ?? ''),
                ].join(':');
            })
            .filter((entry): entry is string => Boolean(entry))
            .sort()
            .join('|');
    }, [symbols, objectDefinitionsById]);

    const resolveOpeningWidthMm = useCallback(
        (
            definition: ArchitecturalObjectDefinition,
            properties?: Record<string, unknown>
        ): number => {
            const fromProperties =
                typeof properties?.widthMm === 'number' && Number.isFinite(properties.widthMm)
                    ? properties.widthMm
                    : null;
            return Math.max(1, fromProperties ?? definition.openingWidthMm ?? definition.widthMm);
        },
        []
    );

    const resolveOpeningHeightMm = useCallback(
        (
            definition: ArchitecturalObjectDefinition,
            properties?: Record<string, unknown>
        ): number => {
            const fromProperties =
                typeof properties?.heightMm === 'number' && Number.isFinite(properties.heightMm)
                    ? properties.heightMm
                    : null;
            return Math.max(1, fromProperties ?? definition.heightMm);
        },
        []
    );

    const resolveOpeningSillHeightMm = useCallback(
        (
            definition: ArchitecturalObjectDefinition,
            properties?: Record<string, unknown>
        ): number => {
            if (definition.category !== 'windows') return 0;
            const fromProperties =
                typeof properties?.sillHeightMm === 'number' && Number.isFinite(properties.sillHeightMm)
                    ? properties.sillHeightMm
                    : null;
            return Math.max(0, fromProperties ?? definition.sillHeightMm ?? 900);
        },
        []
    );

    const fitOpeningToWall = useCallback(
        (wall: Wall, opening: { position: number; width: number }): { position: number; width: number } => {
            const wallLength = Math.hypot(
                wall.endPoint.x - wall.startPoint.x,
                wall.endPoint.y - wall.startPoint.y
            );
            if (!Number.isFinite(wallLength) || wallLength <= 0.001) {
                return { position: 0, width: Math.max(120, opening.width) };
            }

            const maxWidth = Math.max(120, wallLength - MIN_OPENING_EDGE_MARGIN_MM * 2);
            const fittedWidth = Math.max(120, Math.min(opening.width, maxWidth));
            const halfWidth = fittedWidth / 2;
            const minPosition = MIN_OPENING_EDGE_MARGIN_MM + halfWidth;
            const maxPosition = wallLength - MIN_OPENING_EDGE_MARGIN_MM - halfWidth;
            const fittedPosition =
                minPosition <= maxPosition
                    ? Math.min(Math.max(opening.position, minPosition), maxPosition)
                    : wallLength / 2;

            return {
                position: fittedPosition,
                width: fittedWidth,
            };
        },
        []
    );

    void MM_TO_PX;

    const queueMousePositionUpdate = useCallback((position: Point2D) => {
        mousePositionRef.current = position;
        if (typeof window === 'undefined') return;
        if (mousePositionFrameRef.current !== null) return;
        mousePositionFrameRef.current = window.requestAnimationFrame(() => {
            mousePositionFrameRef.current = null;
            setMousePosition(mousePositionRef.current);
        });
    }, []);

    const setMarqueeSelectionMode = useCallback((mode: 'window' | 'crossing') => {
        const canvas = fabricRef.current as (fabric.Canvas & { selectionFullyContained?: boolean }) | null;
        if (!canvas) return;
        canvas.selectionFullyContained = mode === 'window';
    }, []);

    const getSelectionRect = useCallback((selection: MarqueeSelectionState) => {
        if (!selection.start || !selection.current) return null;
        return {
            minX: Math.min(selection.start.x, selection.current.x),
            minY: Math.min(selection.start.y, selection.current.y),
            maxX: Math.max(selection.start.x, selection.current.x),
            maxY: Math.max(selection.start.y, selection.current.y),
        };
    }, []);

    const getTargetBoundsMm = useCallback((target: fabric.Object) => {
        const rect = target.getBoundingRect();
        if (
            !Number.isFinite(rect.left) ||
            !Number.isFinite(rect.top) ||
            !Number.isFinite(rect.width) ||
            !Number.isFinite(rect.height)
        ) {
            return null;
        }
        return {
            minX: rect.left / MM_TO_PX,
            minY: rect.top / MM_TO_PX,
            maxX: (rect.left + rect.width) / MM_TO_PX,
            maxY: (rect.top + rect.height) / MM_TO_PX,
        };
    }, []);

    const filterMarqueeSelectionTargets = useCallback((targets: fabric.Object[]) => {
        if (!applyMarqueeFilterRef.current) return targets;

        const lastSelection = lastMarqueeSelectionRef.current;
        const selectionRect = getSelectionRect(lastSelection);
        if (!selectionRect) return targets;

        const width = selectionRect.maxX - selectionRect.minX;
        const height = selectionRect.maxY - selectionRect.minY;
        if (width < 2 && height < 2) {
            return targets;
        }

        return targets.filter((target) => {
            const bounds = getTargetBoundsMm(target);
            if (!bounds) return true;

            const intersects = !(
                bounds.maxX < selectionRect.minX ||
                bounds.minX > selectionRect.maxX ||
                bounds.maxY < selectionRect.minY ||
                bounds.minY > selectionRect.maxY
            );

            if (lastSelection.mode === 'crossing') {
                return intersects;
            }

            return (
                bounds.minX >= selectionRect.minX &&
                bounds.maxX <= selectionRect.maxX &&
                bounds.minY >= selectionRect.minY &&
                bounds.maxY <= selectionRect.maxY
            );
        });
    }, [getSelectionRect, getTargetBoundsMm]);

    useEffect(() => {
        return () => {
            if (mousePositionFrameRef.current !== null && typeof window !== 'undefined') {
                window.cancelAnimationFrame(mousePositionFrameRef.current);
                mousePositionFrameRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const previousRatio = paperScaleRatioRef.current;
        if (!Number.isFinite(previousRatio) || previousRatio <= 0) {
            paperScaleRatioRef.current = safePaperPerRealRatio;
            return;
        }
        if (Math.abs(previousRatio - safePaperPerRealRatio) < 0.0000001) {
            paperScaleRatioRef.current = safePaperPerRealRatio;
            return;
        }

        const currentPan = panOffsetRef.current;
        const nextPan = {
            x: currentPan.x * previousRatio / safePaperPerRealRatio,
            y: currentPan.y * previousRatio / safePaperPerRealRatio,
        };
        paperScaleRatioRef.current = safePaperPerRealRatio;
        panOffsetRef.current = nextPan;
        setPanOffset(nextPan);
    }, [safePaperPerRealRatio, setPanOffset]);

    const projectPointToSegment = useCallback((point: Point2D, start: Point2D, end: Point2D) => {
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

    const findWallPlacementSnap = useCallback((point: Point2D) => {
        const maxSnapDistanceMm = Math.max(100, 72 / Math.max(viewportZoom, 0.01) / MM_TO_PX);
        let best: {
            wall: Wall;
            point: Point2D;
            t: number;
            distance: number;
            angleDeg: number;
            normal: Point2D;
            wallLength: number;
        } | null = null;

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

    const collisionBounds = useCallback((
        center: Point2D,
        widthMm: number,
        depthMm: number
    ) => ({
        minX: center.x - widthMm / 2,
        maxX: center.x + widthMm / 2,
        minY: center.y - depthMm / 2,
        maxY: center.y + depthMm / 2,
    }), []);

    const objectsOverlap = useCallback(
        (
            a: ReturnType<typeof collisionBounds>,
            b: ReturnType<typeof collisionBounds>
        ) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY,
        []
    );

    const hasFurnitureCollision = useCallback(
        (
            targetPoint: Point2D,
            definition: ArchitecturalObjectDefinition,
            options?: { ignoreSymbolId?: string }
        ): boolean => {
            if (definition.category !== 'furniture' && definition.category !== 'fixtures') {
                return false;
            }
            const targetBounds = collisionBounds(targetPoint, definition.widthMm, definition.depthMm);
            for (const instance of symbols) {
                if (options?.ignoreSymbolId && instance.id === options.ignoreSymbolId) {
                    continue;
                }
                const instanceDefinition = objectDefinitionsById.get(instance.symbolId);
                if (!instanceDefinition) continue;
                if (instanceDefinition.category !== 'furniture' && instanceDefinition.category !== 'fixtures') {
                    continue;
                }
                const existingBounds = collisionBounds(
                    instance.position,
                    instanceDefinition.widthMm,
                    instanceDefinition.depthMm
                );
                if (objectsOverlap(targetBounds, existingBounds)) {
                    return true;
                }
            }
            return false;
        },
        [symbols, objectDefinitionsById, collisionBounds, objectsOverlap]
    );

    const computePlacement = useCallback(
        (
            point: Point2D,
            definition: ArchitecturalObjectDefinition,
            options?: { ignoreSymbolId?: string; ignoreOpeningId?: string; openingWidthMm?: number }
        ) => {
            let placementPoint = { ...point };
            let rotationDeg = placementRotationDeg;
            let snappedWall: (ReturnType<typeof findWallPlacementSnap> & { positionAlongWall: number }) | null = null;
            const alignmentPoint: Point2D | null = null;
            let openingPlacementValid = true;

            if (definition.category === 'doors' || definition.category === 'windows') {
                const wallSnap = findWallPlacementSnap(point);
                if (wallSnap) {
                    const openingWidth =
                        typeof options?.openingWidthMm === 'number' && Number.isFinite(options.openingWidthMm)
                            ? Math.max(1, options.openingWidthMm)
                            : definition.openingWidthMm ?? definition.widthMm;
                    const edgeClearance = openingWidth / 2 + MIN_OPENING_EDGE_MARGIN_MM;
                    const unclampedPositionAlongWall = wallSnap.t * wallSnap.wallLength;
                    const clampedPositionAlongWall = Math.min(
                        Math.max(unclampedPositionAlongWall, edgeClearance),
                        wallSnap.wallLength - edgeClearance
                    );
                    const clampedT = wallSnap.wallLength > 0
                        ? clampedPositionAlongWall / wallSnap.wallLength
                        : 0.5;
                    placementPoint = {
                        x: wallSnap.wall.startPoint.x + (wallSnap.wall.endPoint.x - wallSnap.wall.startPoint.x) * clampedT,
                        y: wallSnap.wall.startPoint.y + (wallSnap.wall.endPoint.y - wallSnap.wall.startPoint.y) * clampedT,
                    };
                    rotationDeg = wallSnap.angleDeg;

                    const overlapsExistingOpening = wallSnap.wall.openings.some((existing) => {
                        if (options?.ignoreOpeningId && existing.id === options.ignoreOpeningId) {
                            return false;
                        }
                        const requiredGap =
                            existing.width / 2 + openingWidth / 2 + MIN_OPENING_EDGE_MARGIN_MM;
                        return Math.abs(existing.position - clampedPositionAlongWall) < requiredGap;
                    });
                    const fitsSegment =
                        wallSnap.wallLength >= openingWidth + MIN_OPENING_EDGE_MARGIN_MM * 2;
                    openingPlacementValid = fitsSegment && !overlapsExistingOpening;

                    snappedWall = {
                        ...wallSnap,
                        t: clampedT,
                        positionAlongWall: clampedPositionAlongWall,
                    };
                } else {
                    openingPlacementValid = false;
                }
            } else if (definition.category === 'furniture' || definition.category === 'fixtures') {
                // Keep furniture/fixture placement free-form to avoid sticky cursor behavior.
                placementPoint = { ...point };
            }

            const isFurnitureLike =
                definition.category === 'furniture' || definition.category === 'fixtures';
            if (resolvedSnapToGrid && !snappedWall && !isFurnitureLike) {
                const gridStep = Math.max(1, wallSettings.gridSize);
                placementPoint = {
                    x: Math.round(placementPoint.x / gridStep) * gridStep,
                    y: Math.round(placementPoint.y / gridStep) * gridStep,
                };
            }

            const collision = hasFurnitureCollision(
                placementPoint,
                definition,
                options?.ignoreSymbolId ? { ignoreSymbolId: options.ignoreSymbolId } : undefined
            );
            const valid = !collision && openingPlacementValid;

            return {
                point: placementPoint,
                rotationDeg,
                snappedWall,
                alignmentPoint,
                valid,
            };
        },
        [
            placementRotationDeg,
            findWallPlacementSnap,
            rooms,
            symbols,
            objectDefinitionsById,
            hasFurnitureCollision,
            resolvedSnapToGrid,
            wallSettings.gridSize,
        ]
    );

    const syncOpeningForSymbol = useCallback(
        (
            symbolId: string,
            definition: ArchitecturalObjectDefinition,
            snappedWall: { wall: Wall; positionAlongWall: number },
            overrides?: { openingWidthMm?: number; openingHeightMm?: number; sillHeightMm?: number }
        ) => {
            if (definition.category !== 'doors' && definition.category !== 'windows') {
                return;
            }

            const openingWidth =
                typeof overrides?.openingWidthMm === 'number' && Number.isFinite(overrides.openingWidthMm)
                    ? Math.max(1, overrides.openingWidthMm)
                    : definition.openingWidthMm ?? definition.widthMm;
            const openingHeight =
                typeof overrides?.openingHeightMm === 'number' && Number.isFinite(overrides.openingHeightMm)
                    ? Math.max(1, overrides.openingHeightMm)
                    : definition.heightMm;
            const sillHeight =
                definition.category === 'windows'
                    ? (typeof overrides?.sillHeightMm === 'number' && Number.isFinite(overrides.sillHeightMm)
                        ? Math.max(0, overrides.sillHeightMm)
                        : definition.sillHeightMm ?? 900)
                    : 0;
            const targetWallId = snappedWall.wall.id;
            const nextOpening = {
                id: symbolId,
                type: (definition.category === 'doors' ? 'door' : 'window') as 'door' | 'window',
                position: snappedWall.positionAlongWall,
                width: openingWidth + 50,
                height: openingHeight,
                sillHeight,
            };

            for (const wall of walls) {
                const hasSymbolOpening = wall.openings.some((opening) => opening.id === symbolId);
                const isTargetWall = wall.id === targetWallId;
                if (!hasSymbolOpening && !isTargetWall) continue;

                const filtered = wall.openings.filter((opening) => opening.id !== symbolId);
                const nextOpenings = isTargetWall
                    ? [...filtered, nextOpening].sort((a, b) => a.position - b.position)
                    : filtered;

                const unchanged =
                    nextOpenings.length === wall.openings.length &&
                    nextOpenings.every((opening, index) => {
                        const existing = wall.openings[index];
                        return (
                            !!existing &&
                            opening.id === existing.id &&
                            opening.type === existing.type &&
                            Math.abs(opening.position - existing.position) < 0.001 &&
                            Math.abs(opening.width - existing.width) < 0.001 &&
                            Math.abs(opening.height - existing.height) < 0.001 &&
                            (opening.sillHeight ?? 0) === (existing.sillHeight ?? 0)
                        );
                    });

                if (unchanged) continue;
                updateWall(
                    wall.id,
                    { openings: nextOpenings },
                    { skipHistory: true, source: 'ui' }
                );
            }
        },
        [walls, updateWall]
    );

    const buildHostedOpeningSymbolProperties = useCallback(
        (
            definition: ArchitecturalObjectDefinition,
            wall: Wall,
            positionAlongWallMm: number,
            sourceProperties: Record<string, unknown>,
            openingWidthMm: number,
            openingHeightMm: number,
            openingSillHeightMm: number,
        ): Record<string, unknown> => {
            const nextBaseElevationMm =
                definition.category === 'windows'
                    ? (wall.properties3D.baseElevation ?? 0) + openingSillHeightMm
                    : (wall.properties3D.baseElevation ?? 0);
            const nextProperties: Record<string, unknown> = {
                ...sourceProperties,
                widthMm: openingWidthMm,
                depthMm: wall.thickness,
                heightMm: openingHeightMm,
                hostWallId: wall.id,
                hostWallThicknessMm: wall.thickness,
                positionAlongWallMm: positionAlongWallMm,
                baseElevationMm: nextBaseElevationMm,
            };

            if (definition.category === 'windows') {
                nextProperties.sillHeightMm = openingSillHeightMm;
            }

            if (definition.category === 'doors') {
                Object.assign(
                    nextProperties,
                    resolveHostedDoorSwingProperties(
                        wall,
                        positionAlongWallMm,
                        openingWidthMm,
                        rooms,
                        nextProperties
                    )
                );
            }

            return nextProperties;
        },
        [rooms]
    );

    const buildOpeningPreviewProperties = useCallback(
        (
            definition: ArchitecturalObjectDefinition,
            snappedWall?: { wall: Wall; positionAlongWall: number } | null
        ): Record<string, unknown> | undefined => {
            if (definition.category !== 'doors' || !snappedWall) {
                return undefined;
            }

            return {
                type: definition.type,
                swingDirection: 'left',
                doorSwingBehavior: 'inward',
                doorHingeMode: 'auto-corner',
                ...resolveHostedDoorSwingProperties(
                    snappedWall.wall,
                    snappedWall.positionAlongWall,
                    definition.openingWidthMm ?? definition.widthMm,
                    rooms,
                    { swingDirection: 'left', doorSwingBehavior: 'inward', doorHingeMode: 'auto-corner' }
                ),
            };
        },
        [rooms]
    );

    const placePendingObject = useCallback((point: Point2D): boolean => {
        if (!pendingPlacementDefinition) return false;
        const placement = computePlacement(point, pendingPlacementDefinition);
        setPlacementValid(placement.valid);
        if (!placement.valid) {
            const isOpening =
                pendingPlacementDefinition.category === 'doors' ||
                pendingPlacementDefinition.category === 'windows';
            setProcessingStatus(
                isOpening
                    ? 'Placement blocked: opening does not fit or overlaps an existing opening.'
                    : 'Placement blocked: furniture overlap detected.',
                false
            );
            return true;
        }

        const baseProperties: Record<string, unknown> = {
            definitionId: pendingPlacementDefinition.id,
            category: pendingPlacementDefinition.category,
            type: pendingPlacementDefinition.type,
            widthMm:
                (pendingPlacementDefinition.category === 'doors' || pendingPlacementDefinition.category === 'windows') &&
                    placement.snappedWall
                    ? (pendingPlacementDefinition.openingWidthMm ?? pendingPlacementDefinition.widthMm)
                    : pendingPlacementDefinition.widthMm,
            depthMm:
                (pendingPlacementDefinition.category === 'doors' || pendingPlacementDefinition.category === 'windows') &&
                    placement.snappedWall
                    ? placement.snappedWall.wall.thickness
                    : pendingPlacementDefinition.depthMm,
            heightMm: pendingPlacementDefinition.heightMm,
            baseElevationMm:
                pendingPlacementDefinition.category === 'windows'
                    ? ((placement.snappedWall?.wall.properties3D.baseElevation ?? 0) +
                        (pendingPlacementDefinition.sillHeightMm ?? 900))
                    : (placement.snappedWall?.wall.properties3D.baseElevation ?? 0),
            material: pendingPlacementDefinition.material,
            swingDirection: 'left',
            doorSwingBehavior: pendingPlacementDefinition.category === 'doors' ? 'inward' : undefined,
            doorHingeMode: pendingPlacementDefinition.category === 'doors' ? 'auto-corner' : undefined,
            ...(pendingPlacementDefinition.renderType === 'circular-table-chairs' ||
                pendingPlacementDefinition.renderType === 'square-table-chairs'
                ? { chairCount: 4 }
                : {}),
            hostWallId: placement.snappedWall?.wall.id,
            hostWallThicknessMm: placement.snappedWall?.wall.thickness,
            positionAlongWallMm: placement.snappedWall?.positionAlongWall,
            placedAt: new Date().toISOString(),
        };
        const resolvedProperties =
            (pendingPlacementDefinition.category === 'doors' || pendingPlacementDefinition.category === 'windows') &&
                placement.snappedWall
                ? buildHostedOpeningSymbolProperties(
                    pendingPlacementDefinition,
                    placement.snappedWall.wall,
                    placement.snappedWall.positionAlongWall,
                    baseProperties,
                    pendingPlacementDefinition.openingWidthMm ?? pendingPlacementDefinition.widthMm,
                    pendingPlacementDefinition.heightMm,
                    pendingPlacementDefinition.sillHeightMm ?? 900
                )
                : baseProperties;

        const symbolPayload: Omit<SymbolInstance2D, 'id'> = {
            symbolId: pendingPlacementDefinition.id,
            position: placement.point,
            rotation: placement.rotationDeg,
            scale: 1,
            flipped: false,
            properties: resolvedProperties,
        };
        const symbolId = addSymbol(symbolPayload);
        const placedInstance: SymbolInstance2D = { ...symbolPayload, id: symbolId };
        const placedIsOpening =
            pendingPlacementDefinition.category === 'doors' ||
            pendingPlacementDefinition.category === 'windows';
        setSelectedIds(placedIsOpening ? [] : [symbolId]);

        if (
            placement.snappedWall &&
            (pendingPlacementDefinition.category === 'doors' || pendingPlacementDefinition.category === 'windows')
        ) {
            syncOpeningForSymbol(symbolId, pendingPlacementDefinition, {
                wall: placement.snappedWall.wall,
                positionAlongWall: placement.snappedWall.positionAlongWall,
            });
        }

        onObjectPlaced?.(pendingPlacementDefinition.id, placedInstance);
        setProcessingStatus(`Placed ${pendingPlacementDefinition.name}.`, false);
        return true;
    }, [
        pendingPlacementDefinition,
        buildHostedOpeningSymbolProperties,
        computePlacement,
        addSymbol,
        setSelectedIds,
        syncOpeningForSymbol,
        onObjectPlaced,
        setProcessingStatus,
    ]);

    const resolveWallIdFromTarget = useCallback(
        (target: fabric.Object | undefined | null): string | null => {
            if (!target) return null;

            const typedTarget = target as fabric.Object & {
                id?: string;
                wallId?: string;
                name?: string;
                group?: fabric.Group & { id?: string; wallId?: string; name?: string };
            };

            if (typedTarget.wallId) return typedTarget.wallId;
            if (typedTarget.id && typedTarget.name?.startsWith('wall-')) return typedTarget.id;

            const parent = typedTarget.group;
            if (parent?.wallId) return parent.wallId;
            if (parent?.id && parent?.name?.startsWith('wall-')) return parent.id;

            return null;
        },
        []
    );

    const resolveRoomIdFromTarget = useCallback(
        (target: fabric.Object | undefined | null): string | null => {
            if (!target) return null;

            const typedTarget = target as fabric.Object & {
                id?: string;
                roomId?: string;
                name?: string;
                group?: fabric.Group & { id?: string; roomId?: string; name?: string };
            };

            if (typedTarget.roomId) return typedTarget.roomId;
            if (typedTarget.id && typedTarget.name?.startsWith('room-')) return typedTarget.id;

            const parent = typedTarget.group;
            if (parent?.roomId) return parent.roomId;
            if (parent?.id && parent?.name?.startsWith('room-')) return parent.id;

            return null;
        },
        []
    );

    const resolveDimensionIdFromTarget = useCallback(
        (target: fabric.Object | undefined | null): string | null => {
            if (!target) return null;

            const typedTarget = target as fabric.Object & {
                id?: string;
                dimensionId?: string;
                name?: string;
                group?: fabric.Group & { id?: string; dimensionId?: string; name?: string };
            };

            if (typedTarget.dimensionId) return typedTarget.dimensionId;
            if (typedTarget.id && typedTarget.name?.startsWith('dimension-')) return typedTarget.id;

            const parent = typedTarget.group;
            if (parent?.dimensionId) return parent.dimensionId;
            if (parent?.id && parent?.name?.startsWith('dimension-')) return parent.id;

            return null;
        },
        []
    );

    const resolveSectionLineIdFromTarget = useCallback(
        (target: fabric.Object | undefined | null): string | null => {
            if (!target) return null;

            const typedTarget = target as fabric.Object & {
                id?: string;
                sectionLineId?: string;
                name?: string;
                group?: fabric.Group & { id?: string; sectionLineId?: string; name?: string };
            };

            if (typedTarget.sectionLineId) return typedTarget.sectionLineId;
            if (typedTarget.id && typedTarget.name?.startsWith('section-line-')) return typedTarget.id;

            const parent = typedTarget.group;
            if (parent?.sectionLineId) return parent.sectionLineId;
            if (parent?.id && parent?.name?.startsWith('section-line-')) return parent.id;

            return null;
        },
        []
    );

    const resolveObjectIdFromTarget = useCallback(
        (target: fabric.Object | undefined | null): string | null => {
            if (!target) return null;

            const typedTarget = target as fabric.Object & {
                id?: string;
                objectId?: string;
                openingId?: string;
                name?: string;
                group?: fabric.Group & { id?: string; objectId?: string; openingId?: string; name?: string };
            };

            if (typedTarget.objectId) return typedTarget.objectId;
            if (typedTarget.openingId) return typedTarget.openingId;
            if (typedTarget.id && typedTarget.name?.startsWith('object-')) return typedTarget.id;

            const parent = typedTarget.group;
            if (parent?.objectId) return parent.objectId;
            if (parent?.openingId) return parent.openingId;
            if (parent?.id && parent?.name?.startsWith('object-')) return parent.id;

            return null;
        },
        []
    );

    const resolveOpeningIdFromTarget = useCallback(
        (target: fabric.Object | undefined | null): string | null => {
            if (!target) return null;

            const typedTarget = target as fabric.Object & {
                openingId?: string;
                group?: fabric.Group & { openingId?: string };
            };

            if (typedTarget.openingId) return typedTarget.openingId;
            if (typedTarget.group?.openingId) return typedTarget.group.openingId;
            return null;
        },
        []
    );

    const resolveOpeningResizeHandleFromTarget = useCallback(
        (target: fabric.Object | undefined | null): OpeningResizeHandleHit | null => {
            if (!target) return null;

            const typedTarget = target as fabric.Object & {
                openingId?: string;
                wallId?: string;
                openingResizeSide?: 'start' | 'end';
                isOpeningResizeHandle?: boolean;
                group?: fabric.Group & {
                    openingId?: string;
                    wallId?: string;
                    openingResizeSide?: 'start' | 'end';
                    isOpeningResizeHandle?: boolean;
                };
            };

            const fromTarget = typedTarget.isOpeningResizeHandle
                ? {
                    openingId: typedTarget.openingId,
                    wallId: typedTarget.wallId,
                    side: typedTarget.openingResizeSide,
                }
                : null;
            const fromParent = typedTarget.group?.isOpeningResizeHandle
                ? {
                    openingId: typedTarget.group.openingId,
                    wallId: typedTarget.group.wallId,
                    side: typedTarget.group.openingResizeSide,
                }
                : null;
            const resolved = fromTarget ?? fromParent;
            if (!resolved?.openingId || !resolved.wallId || !resolved.side) return null;
            return {
                openingId: resolved.openingId,
                wallId: resolved.wallId,
                side: resolved.side,
            };
        },
        []
    );

    const clearOpeningResizeHandles = useCallback(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        if (openingResizeHandlesRef.current.length === 0) return;
        openingResizeHandlesRef.current.forEach((handle) => canvas.remove(handle));
        openingResizeHandlesRef.current = [];
        canvas.requestRenderAll();
    }, []);

    const applyOpeningSymbolPlacement = useCallback(
        (
            instance: SymbolInstance2D,
            definition: ArchitecturalObjectDefinition,
            wall: Wall,
            positionAlongWallMm: number,
            openingWidthMm: number,
            openingHeightMm: number,
            openingSillHeightMm: number,
            options?: { skipHistory?: boolean }
        ) => {
            const dx = wall.endPoint.x - wall.startPoint.x;
            const dy = wall.endPoint.y - wall.startPoint.y;
            const wallLength = Math.hypot(dx, dy) || 1;
            const t = positionAlongWallMm / wallLength;
            const nextPosition = {
                x: wall.startPoint.x + dx * t,
                y: wall.startPoint.y + dy * t,
            };
            const nextRotation = (Math.atan2(dy, dx) * 180) / Math.PI;
            const nextProperties = buildHostedOpeningSymbolProperties(
                definition,
                wall,
                positionAlongWallMm,
                instance.properties,
                openingWidthMm,
                openingHeightMm,
                openingSillHeightMm
            );
            updateSymbol(
                instance.id,
                {
                    position: nextPosition,
                    rotation: nextRotation,
                    properties: nextProperties,
                },
                options
            );
        },
        [buildHostedOpeningSymbolProperties, updateSymbol]
    );

    const updateOpeningPointerInteraction = useCallback(
        (pointerMm: Point2D): boolean => {
            const interaction = openingPointerInteractionRef.current;
            if (!interaction) return false;

            const hostWall = walls.find((wall) => wall.id === interaction.wallId)
                ?? walls.find((wall) => wall.openings.some((entry) => entry.id === interaction.openingId));
            const hostOpening = hostWall?.openings.find((entry) => entry.id === interaction.openingId);
            const instance = symbols.find((entry) => entry.id === interaction.openingId);
            const definition = instance
                ? objectDefinitionsById.get(instance.symbolId)
                : undefined;
            const hasLinkedSymbol = Boolean(
                instance &&
                definition &&
                (definition.category === 'doors' || definition.category === 'windows')
            );
            const openingWidthMm = hasLinkedSymbol
                ? resolveOpeningWidthMm(definition as ArchitecturalObjectDefinition, instance?.properties)
                : Math.max(1, (hostOpening?.width ?? MIN_OPENING_GEOMETRY_WIDTH_MM) - 50);
            const openingHeightMm = hasLinkedSymbol
                ? resolveOpeningHeightMm(definition as ArchitecturalObjectDefinition, instance?.properties)
                : Math.max(1, hostOpening?.height ?? 2100);
            const openingSillHeightMm = hasLinkedSymbol
                ? resolveOpeningSillHeightMm(definition as ArchitecturalObjectDefinition, instance?.properties)
                : Math.max(0, hostOpening?.sillHeight ?? 0);

            if (interaction.mode === 'move') {
                const sourceWall = hostWall ?? null;
                const snappedAnchorWall = findWallPlacementSnap(pointerMm)?.wall ?? sourceWall;
                let placementSeedPoint = pointerMm;

                if (snappedAnchorWall) {
                    const wallDx = snappedAnchorWall.endPoint.x - snappedAnchorWall.startPoint.x;
                    const wallDy = snappedAnchorWall.endPoint.y - snappedAnchorWall.startPoint.y;
                    const wallLength = Math.hypot(wallDx, wallDy);
                    if (Number.isFinite(wallLength) && wallLength > 0.001) {
                        const pointerProjection = projectPointToSegment(
                            pointerMm,
                            snappedAnchorWall.startPoint,
                            snappedAnchorWall.endPoint
                        );
                        const pointerAlongWall = pointerProjection.t * wallLength;
                        const grabOffset = interaction.grabOffsetAlongWallMm ?? 0;
                        const desiredCenterAlongWall = clampValue(
                            pointerAlongWall - grabOffset,
                            0,
                            wallLength
                        );
                        const t = desiredCenterAlongWall / wallLength;
                        placementSeedPoint = {
                            x: snappedAnchorWall.startPoint.x + wallDx * t,
                            y: snappedAnchorWall.startPoint.y + wallDy * t,
                        };
                    }
                }

                if (!hasLinkedSymbol) {
                    if (!hostWall || !hostOpening) return true;
                    const wallDx = hostWall.endPoint.x - hostWall.startPoint.x;
                    const wallDy = hostWall.endPoint.y - hostWall.startPoint.y;
                    const wallLength = Math.hypot(wallDx, wallDy);
                    if (!Number.isFinite(wallLength) || wallLength <= 0.001) return true;

                    const projected = projectPointToSegment(
                        placementSeedPoint,
                        hostWall.startPoint,
                        hostWall.endPoint
                    );
                    const projectedAlongWall = projected.t * wallLength;
                    const grabOffset = interaction.grabOffsetAlongWallMm ?? 0;
                    const desiredCenterAlongWall = projectedAlongWall - grabOffset;
                    const halfWidth = hostOpening.width / 2;

                    let minPosition = MIN_OPENING_EDGE_MARGIN_MM + halfWidth;
                    let maxPosition = wallLength - MIN_OPENING_EDGE_MARGIN_MM - halfWidth;
                    const neighbours = hostWall.openings.filter((entry) => entry.id !== interaction.openingId);
                    neighbours.forEach((entry) => {
                        const requiredGap = entry.width / 2 + halfWidth + MIN_OPENING_EDGE_MARGIN_MM;
                        if (entry.position < hostOpening.position) {
                            minPosition = Math.max(minPosition, entry.position + requiredGap);
                        } else {
                            maxPosition = Math.min(maxPosition, entry.position - requiredGap);
                        }
                    });
                    if (maxPosition < minPosition) return true;
                    const nextPosition = clampValue(desiredCenterAlongWall, minPosition, maxPosition);
                    if (Math.abs(nextPosition - hostOpening.position) > 0.01) {
                        updateWall(
                            hostWall.id,
                            {
                                openings: hostWall.openings.map((entry) =>
                                    entry.id === interaction.openingId
                                        ? { ...entry, position: nextPosition }
                                        : entry
                                ),
                            },
                            { skipHistory: true, source: 'ui' }
                        );
                        interaction.changed = true;
                    }
                    return true;
                }

                const placement = computePlacement(
                    placementSeedPoint,
                    definition as ArchitecturalObjectDefinition,
                    {
                        ignoreOpeningId: interaction.openingId,
                        ignoreSymbolId: interaction.openingId,
                        openingWidthMm,
                    }
                );
                if (!placement.valid || !placement.snappedWall || !instance || !definition) {
                    return true;
                }

                const snappedWall = placement.snappedWall.wall;
                const positionAlongWall = placement.snappedWall.positionAlongWall;
                syncOpeningForSymbol(
                    interaction.openingId,
                    definition,
                    { wall: snappedWall, positionAlongWall },
                    {
                        openingWidthMm,
                        openingHeightMm,
                        sillHeightMm: openingSillHeightMm,
                    }
                );
                applyOpeningSymbolPlacement(
                    instance,
                    definition,
                    snappedWall,
                    positionAlongWall,
                    openingWidthMm,
                    openingHeightMm,
                    openingSillHeightMm,
                    { skipHistory: true }
                );
                interaction.changed = true;
                return true;
            }

            if (!hostWall) return true;
            if (!hostOpening) return true;

            const wallDx = hostWall.endPoint.x - hostWall.startPoint.x;
            const wallDy = hostWall.endPoint.y - hostWall.startPoint.y;
            const wallLength = Math.hypot(wallDx, wallDy);
            if (!Number.isFinite(wallLength) || wallLength <= 0.001) return true;

            const projected = projectPointToSegment(pointerMm, hostWall.startPoint, hostWall.endPoint);
            const projectedAlongWall = projected.t * wallLength;
            const defaultAnchor = interaction.mode === 'resize-start'
                ? hostOpening.position + hostOpening.width / 2
                : hostOpening.position - hostOpening.width / 2;
            const anchorEdge = interaction.anchorEdgeAlongWall ?? defaultAnchor;
            if (!Number.isFinite(interaction.anchorEdgeAlongWall ?? Number.NaN)) {
                interaction.anchorEdgeAlongWall = anchorEdge;
            }

            const neighbours = hostWall.openings.filter((entry) => entry.id !== interaction.openingId);
            let startEdge = hostOpening.position - hostOpening.width / 2;
            let endEdge = hostOpening.position + hostOpening.width / 2;

            if (interaction.mode === 'resize-start') {
                let minStartEdge = MIN_OPENING_EDGE_MARGIN_MM;
                neighbours
                    .filter((entry) => entry.position < hostOpening.position)
                    .forEach((entry) => {
                        const neighbourRightEdge =
                            entry.position + entry.width / 2 + MIN_OPENING_EDGE_MARGIN_MM;
                        minStartEdge = Math.max(minStartEdge, neighbourRightEdge);
                    });
                const maxStartEdge = Math.min(
                    wallLength - MIN_OPENING_EDGE_MARGIN_MM,
                    anchorEdge - MIN_OPENING_GEOMETRY_WIDTH_MM
                );
                if (maxStartEdge < minStartEdge) return true;
                startEdge = clampValue(projectedAlongWall, minStartEdge, maxStartEdge);
                endEdge = anchorEdge;
            } else {
                let maxEndEdge = wallLength - MIN_OPENING_EDGE_MARGIN_MM;
                neighbours
                    .filter((entry) => entry.position > hostOpening.position)
                    .forEach((entry) => {
                        const neighbourLeftEdge =
                            entry.position - entry.width / 2 - MIN_OPENING_EDGE_MARGIN_MM;
                        maxEndEdge = Math.min(maxEndEdge, neighbourLeftEdge);
                    });
                const minEndEdge = Math.max(
                    MIN_OPENING_EDGE_MARGIN_MM,
                    anchorEdge + MIN_OPENING_GEOMETRY_WIDTH_MM
                );
                if (maxEndEdge < minEndEdge) return true;
                startEdge = anchorEdge;
                endEdge = clampValue(projectedAlongWall, minEndEdge, maxEndEdge);
            }

            const openingWidthWithClearanceMm = Math.max(
                MIN_OPENING_GEOMETRY_WIDTH_MM,
                endEdge - startEdge
            );
            const nextPositionAlongWall = (startEdge + endEdge) / 2;
            if (hasLinkedSymbol && instance && definition) {
                const nextOpeningWidthMm = Math.max(1, openingWidthWithClearanceMm - 50);
                syncOpeningForSymbol(
                    interaction.openingId,
                    definition,
                    { wall: hostWall, positionAlongWall: nextPositionAlongWall },
                    {
                        openingWidthMm: nextOpeningWidthMm,
                        openingHeightMm,
                        sillHeightMm: openingSillHeightMm,
                    }
                );
                applyOpeningSymbolPlacement(
                    instance,
                    definition,
                    hostWall,
                    nextPositionAlongWall,
                    nextOpeningWidthMm,
                    openingHeightMm,
                    openingSillHeightMm,
                    { skipHistory: true }
                );
            } else {
                updateWall(
                    hostWall.id,
                    {
                        openings: hostWall.openings.map((entry) =>
                            entry.id === interaction.openingId
                                ? {
                                    ...entry,
                                    position: nextPositionAlongWall,
                                    width: openingWidthWithClearanceMm,
                                    height: openingHeightMm,
                                    sillHeight: openingSillHeightMm,
                                }
                                : entry
                        ),
                    },
                    { skipHistory: true, source: 'ui' }
                );
            }
            interaction.changed = true;
            return true;
        },
        [
            symbols,
            objectDefinitionsById,
            walls,
            resolveOpeningWidthMm,
            resolveOpeningHeightMm,
            resolveOpeningSillHeightMm,
            findWallPlacementSnap,
            computePlacement,
            syncOpeningForSymbol,
            applyOpeningSymbolPlacement,
            projectPointToSegment,
            updateWall,
        ]
    );

    const beginOpeningPointerInteraction = useCallback((interaction: OpeningPointerInteraction) => {
        openingPointerInteractionRef.current = interaction;
        setOpeningInteractionActive(true);
        const canvas = fabricRef.current;
        if (!canvas) return;
        canvas.selection = false;
        canvas.discardActiveObject();
        canvas.requestRenderAll();
    }, []);

    const finishOpeningPointerInteraction = useCallback((): boolean => {
        const interaction = openingPointerInteractionRef.current;
        if (!interaction) return false;
        openingPointerInteractionRef.current = null;
        setOpeningInteractionActive(false);
        if (interaction.changed) {
            saveToHistory(interaction.mode === 'move' ? 'Move opening' : 'Resize opening');
        }
        return true;
    }, [saveToHistory]);

    const closeWallContextMenu = useCallback(() => {
        setWallContextMenu(null);
    }, []);

    const closeDimensionContextMenu = useCallback(() => {
        setDimensionContextMenu(null);
    }, []);

    const closeSectionLineContextMenu = useCallback(() => {
        setSectionLineContextMenu(null);
    }, []);

    const closeObjectContextMenu = useCallback(() => {
        setObjectContextMenu(null);
    }, []);

    const handleEditWallProperties = useCallback(() => {
        if (!wallContextMenu) return;
        setSelectedIds([wallContextMenu.wallId]);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('smart-drawing:open-properties-panel'));
        }
        closeWallContextMenu();
    }, [wallContextMenu, setSelectedIds, closeWallContextMenu]);

    const handleDeleteWallFromContext = useCallback(() => {
        if (!wallContextMenu) return;
        deleteWall(wallContextMenu.wallId);
        setSelectedIds(selectedIds.filter((id) => id !== wallContextMenu.wallId));
        closeWallContextMenu();
    }, [wallContextMenu, deleteWall, selectedIds, setSelectedIds, closeWallContextMenu]);

    const handleConvertWallToDoorOpening = useCallback(() => {
        if (!wallContextMenu) return;

        const wall = getWall(wallContextMenu.wallId);
        if (!wall) {
            closeWallContextMenu();
            return;
        }

        const length = Math.hypot(
            wall.endPoint.x - wall.startPoint.x,
            wall.endPoint.y - wall.startPoint.y
        );

        updateWall(wall.id, {
            openings: [
                ...wall.openings,
                {
                    id: generateId(),
                    type: 'door',
                    position: length / 2,
                    width: 900,
                    height: 2100,
                },
            ],
        });

        closeWallContextMenu();
    }, [wallContextMenu, getWall, updateWall, closeWallContextMenu]);

    const handleEditDimensionProperties = useCallback(() => {
        if (!dimensionContextMenu) return;
        setSelectedIds([dimensionContextMenu.dimensionId]);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('smart-drawing:open-properties-panel'));
        }
        closeDimensionContextMenu();
    }, [dimensionContextMenu, setSelectedIds, closeDimensionContextMenu]);

    const handleDeleteDimensionFromContext = useCallback(() => {
        if (!dimensionContextMenu) return;
        deleteDimension(dimensionContextMenu.dimensionId);
        setSelectedIds(selectedIds.filter((id) => id !== dimensionContextMenu.dimensionId));
        closeDimensionContextMenu();
    }, [dimensionContextMenu, deleteDimension, selectedIds, setSelectedIds, closeDimensionContextMenu]);

    const handleToggleDimensionVisibility = useCallback(() => {
        if (!dimensionContextMenu) return;
        const dimension = dimensions.find((entry) => entry.id === dimensionContextMenu.dimensionId);
        if (!dimension) {
            closeDimensionContextMenu();
            return;
        }
        updateDimension(dimension.id, { visible: !dimension.visible });
        closeDimensionContextMenu();
    }, [dimensionContextMenu, dimensions, updateDimension, closeDimensionContextMenu]);

    const handleFlipSectionLineDirection = useCallback(() => {
        if (!sectionLineContextMenu) return;
        flipSectionLineDirection(sectionLineContextMenu.sectionLineId);
        closeSectionLineContextMenu();
    }, [sectionLineContextMenu, flipSectionLineDirection, closeSectionLineContextMenu]);

    const handleToggleSectionLineLock = useCallback(() => {
        if (!sectionLineContextMenu) return;
        const line = sectionLines.find((entry) => entry.id === sectionLineContextMenu.sectionLineId);
        if (!line) {
            closeSectionLineContextMenu();
            return;
        }
        updateSectionLine(line.id, { locked: !line.locked });
        closeSectionLineContextMenu();
    }, [sectionLineContextMenu, sectionLines, updateSectionLine, closeSectionLineContextMenu]);

    const handleGenerateElevationFromSection = useCallback(() => {
        if (!sectionLineContextMenu) return;
        generateElevationForSection(sectionLineContextMenu.sectionLineId);
        closeSectionLineContextMenu();
    }, [sectionLineContextMenu, generateElevationForSection, closeSectionLineContextMenu]);

    const handleDeleteSectionLineFromContext = useCallback(() => {
        if (!sectionLineContextMenu) return;
        deleteSectionLine(sectionLineContextMenu.sectionLineId);
        setSelectedIds(selectedIds.filter((id) => id !== sectionLineContextMenu.sectionLineId));
        closeSectionLineContextMenu();
    }, [sectionLineContextMenu, deleteSectionLine, selectedIds, setSelectedIds, closeSectionLineContextMenu]);

    const handleEditObjectProperties = useCallback(() => {
        if (!objectContextMenu) return;
        setSelectedIds([objectContextMenu.objectId]);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('smart-drawing:open-properties-panel'));
        }
        closeObjectContextMenu();
    }, [objectContextMenu, setSelectedIds, closeObjectContextMenu]);

    const handleDeleteObjectFromContext = useCallback(() => {
        if (!objectContextMenu) return;
        deleteSymbol(objectContextMenu.objectId);
        setSelectedIds(selectedIds.filter((id) => id !== objectContextMenu.objectId));
        closeObjectContextMenu();
    }, [objectContextMenu, deleteSymbol, selectedIds, setSelectedIds, closeObjectContextMenu]);

    const handleFlipDoorSwing = useCallback(() => {
        if (!objectContextMenu) return;
        const instance = symbols.find((entry) => entry.id === objectContextMenu.objectId);
        if (!instance) {
            closeObjectContextMenu();
            return;
        }
        const current = instance.properties?.swingDirection;
        const next = current === 'right' ? 'left' : 'right';
        updateSymbol(instance.id, {
            properties: {
                ...instance.properties,
                doorHingeMode: 'manual',
                swingDirection: next,
            },
        });
        setProcessingStatus(`Door swing set to ${next}.`, false);
        closeObjectContextMenu();
    }, [objectContextMenu, symbols, updateSymbol, setProcessingStatus, closeObjectContextMenu]);

    const nudgeSelectedObjects = useCallback((dxMm: number, dyMm: number) => {
        const selectedSet = new Set(selectedIds);
        const selectedObjects = symbols.filter((entry) => selectedSet.has(entry.id));
        if (selectedObjects.length === 0) return false;

        for (const instance of selectedObjects) {
            const definition = objectDefinitionsById.get(instance.symbolId);
            if (!definition) continue;
            const candidatePosition = {
                x: instance.position.x + dxMm,
                y: instance.position.y + dyMm,
            };
            if (definition.category === 'doors' || definition.category === 'windows') {
                const openingWidthMm = resolveOpeningWidthMm(definition, instance.properties);
                const openingHeightMm = resolveOpeningHeightMm(definition, instance.properties);
                const openingSillHeightMm = resolveOpeningSillHeightMm(definition, instance.properties);
                const placement = computePlacement(candidatePosition, definition, {
                    ignoreSymbolId: instance.id,
                    ignoreOpeningId: instance.id,
                    openingWidthMm,
                });
                if (!placement.valid || !placement.snappedWall) {
                    setProcessingStatus('Movement blocked: opening must remain on a valid wall segment.', false);
                    continue;
                }

                const snappedWall = placement.snappedWall.wall;
                const nextProperties = buildHostedOpeningSymbolProperties(
                    definition,
                    snappedWall,
                    placement.snappedWall.positionAlongWall,
                    instance.properties,
                    openingWidthMm,
                    openingHeightMm,
                    openingSillHeightMm
                );

                syncOpeningForSymbol(instance.id, definition, {
                    wall: snappedWall,
                    positionAlongWall: placement.snappedWall.positionAlongWall,
                }, {
                    openingWidthMm,
                    openingHeightMm,
                    sillHeightMm: openingSillHeightMm,
                });
                updateSymbol(instance.id, {
                    position: placement.point,
                    rotation: placement.rotationDeg,
                    properties: nextProperties,
                });
                continue;
            }
            const collides = hasFurnitureCollision(candidatePosition, definition, {
                ignoreSymbolId: instance.id,
            });
            if (collides) {
                setProcessingStatus('Movement blocked: furniture overlap detected.', false);
                continue;
            }
            updateSymbol(instance.id, { position: candidatePosition });
        }
        return true;
    }, [
        selectedIds,
        symbols,
        objectDefinitionsById,
        buildHostedOpeningSymbolProperties,
        computePlacement,
        syncOpeningForSymbol,
        resolveOpeningWidthMm,
        resolveOpeningHeightMm,
        resolveOpeningSillHeightMm,
        hasFurnitureCollision,
        setProcessingStatus,
        updateSymbol,
    ]);

    useEffect(() => {
        if (!wallContextMenu && !dimensionContextMenu && !sectionLineContextMenu && !objectContextMenu) return;

        const handleGlobalPointerDown = () => {
            closeWallContextMenu();
            closeDimensionContextMenu();
            closeSectionLineContextMenu();
            closeObjectContextMenu();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeWallContextMenu();
                closeDimensionContextMenu();
                closeSectionLineContextMenu();
                closeObjectContextMenu();
            }
        };

        window.addEventListener('pointerdown', handleGlobalPointerDown);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', handleGlobalPointerDown, true);

        return () => {
            window.removeEventListener('pointerdown', handleGlobalPointerDown);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', handleGlobalPointerDown, true);
        };
    }, [
        wallContextMenu,
        dimensionContextMenu,
        sectionLineContextMenu,
        objectContextMenu,
        closeWallContextMenu,
        closeDimensionContextMenu,
        closeSectionLineContextMenu,
        closeObjectContextMenu,
    ]);

    // Mode hooks
    const selectMode = useSelectMode({
        fabricRef,
        walls,
        rooms,
        selectedIds,
        wallSettings,
        zoom: viewportZoom,
        setSelectedIds,
        setHoveredElement,
        updateWall,
        updateWalls,
        updateWallBevel,
        resetWallBevel,
        getCornerBevelDots,
        moveRoom,
        translateAttachedSymbolsForRooms,
        rotateRoomAttachedSymbols,
        connectWalls,
        detectRooms,
        saveToHistory,
        setProcessingStatus,
        onDragStateChange: setIsHandleDragging,
        onRoomDragStateChange: setActiveRoomDragId,
        originOffset,
    });
    const {
        isWallHandleDraggingRef,
        getTargetMeta,
        updateSelectionFromTarget,
        updateSelectionFromTargets,
        finalizeHandleDrag,
        handleObjectMoving: handleSelectObjectMoving,
        handleDoubleClick: handleSelectDoubleClick,
        handleMouseDown: handleSelectMouseDown,
        handleMouseMove: handleSelectMouseMove,
        handleMouseUp: handleSelectMouseUp,
    } = selectMode;

    const {
        middlePanRef,
        stopMiddlePan,
        handleMiddleMouseDown,
        handleMiddleMouseMove,
        handleMiddleMouseUp,
        preventMiddleAuxClick,
    } = useMiddlePan({
        zoomRef,
        panOffsetRef,
        setPanOffset,
        setCanvasState,
        canvasStateRef,
    });

    // Wall tool hook
    const {
        wallRenderer,
        handleMouseDown: handleWallMouseDown,
        handleMouseMove: handleWallMouseMove,
        handleDoubleClick: handleWallDoubleClick,
        handleKeyDown: handleWallToolKeyDown,
        handleKeyUp: handleWallToolKeyUp,
        isDrawing: isWallDrawing,
    } = useWallTool({
        fabricRef,
        canvas: fabricCanvas,
        walls,
        rooms,
        selectedIds,
        isHandleDragging,
        wallDrawingState,
        wallSettings,
        zoom: viewportZoom,
        panOffset,
        pageHeight: pageConfig.height,
        overlayCanvasRef: snapOverlayRef, // [SNAP WIRE]
        startWallDrawing,
        updateWallPreview,
        commitWall,
        cancelWallDrawing,
        connectWalls,
    });

    // Room tool hook (2-click rectangle)
    const roomTool = useRoomTool({
        gridSize: wallSettings.gridSize,
        wallThickness: wallSettings.defaultThickness,
        wallMaterial: wallSettings.defaultMaterial,
        snapPoint: (scenePoint) => {
            if (!resolvedSnapToGrid) {
                return scenePoint;
            }
            const snapResult = snapWallPoint(
                scenePoint,
                null,
                wallSettings,
                walls,
                false,
                viewportZoom,
                undefined
            );
            return snapResult.snappedPoint;
        },
        createRoomWalls,
    });
    const {
        isDrawing: isRoomDrawing,
        startCorner: roomStartCorner,
        handleMouseDown: handleRoomMouseDown,
        handleMouseMove: handleRoomMouseMove,
        cancelRoomCreation,
    } = roomTool;

    const {
        handlePlacementMouseDown: handleDimensionPlacementMouseDown,
        handlePlacementMouseMove: handleDimensionPlacementMouseMove,
        handleSelectMouseDown: handleDimensionSelectMouseDown,
        handleSelectMouseMove: handleDimensionSelectMouseMove,
        handleSelectMouseUp: handleDimensionSelectMouseUp,
        handleDoubleClick: handleDimensionDoubleClick,
        handleKeyDown: handleDimensionKeyDown,
        cancelPlacement: cancelDimensionPlacement,
        isSelectDragActive: isDimensionSelectDragActive,
    } = useDimensionTool({
        fabricRef,
        walls,
        rooms,
        dimensions,
        dimensionSettings,
        wallSettings,
        zoom: viewportZoom,
        selectedIds,
        addDimension,
        updateDimension,
        deleteDimension,
        setSelectedIds,
        setHoveredElement,
        setProcessingStatus,
        saveToHistory,
    });

    const restackInteractiveOverlays = useCallback((canvas: fabric.Canvas) => {
        const selectedObjectIds = new Set(selectedIds);
        const selectedObjects: fabric.Object[] = [];
        const selectModeOverlays: fabric.Object[] = [];
        const roomControlDecorations: fabric.Object[] = [];
        const roomControls: fabric.Object[] = [];
        const dimensionControlDecorations: fabric.Object[] = [];
        const dimensionControls: fabric.Object[] = [];
        const wallControlDecorations: fabric.Object[] = [];
        const wallControls: fabric.Object[] = [];
        const openingResizeHandles: fabric.Object[] = [];

        canvas.getObjects().forEach((obj) => {
            const typed = obj as fabric.Object & {
                isWallControl?: boolean;
                isWallControlDecoration?: boolean;
                isRoomControl?: boolean;
                isRoomControlDecoration?: boolean;
                isDimensionControl?: boolean;
                isDimensionControlDecoration?: boolean;
                isOpeningResizeHandle?: boolean;
                isSelectModeOverlay?: boolean;
                objectId?: string;
            };

            if (typed.objectId && selectedObjectIds.has(typed.objectId)) {
                selectedObjects.push(obj);
                return;
            }
            if (typed.isSelectModeOverlay) {
                selectModeOverlays.push(obj);
                return;
            }
            if (typed.isRoomControlDecoration) {
                roomControlDecorations.push(obj);
                return;
            }
            if (typed.isRoomControl) {
                roomControls.push(obj);
                return;
            }
            if (typed.isDimensionControlDecoration) {
                dimensionControlDecorations.push(obj);
                return;
            }
            if (typed.isDimensionControl) {
                dimensionControls.push(obj);
                return;
            }
            if (typed.isWallControlDecoration) {
                wallControlDecorations.push(obj);
                return;
            }
            if (typed.isWallControl) {
                wallControls.push(obj);
                return;
            }
            if (typed.isOpeningResizeHandle) {
                openingResizeHandles.push(obj);
            }
        });

        [
            selectedObjects,
            selectModeOverlays,
            roomControlDecorations,
            roomControls,
            dimensionControlDecorations,
            dimensionControls,
            wallControlDecorations,
            wallControls,
            openingResizeHandles,
        ].forEach((objects) => {
            objects.forEach((obj) => canvas.bringObjectToFront(obj));
        });
    }, [selectedIds]);

    // Offset tool hook
    const offsetTool = useOffsetTool({
        fabricRef,
        walls,
        selectedIds,
        zoom: viewportZoom,
        addWall,
        setSelectedIds,
        setTool,
        detectRooms,
        saveToHistory,
        setProcessingStatus,
    });

    // Trim tool hook
    const trimTool = useTrimTool({
        fabricRef,
        walls,
        updateWall,
        addWall,
        deleteWall,
        connectWalls,
        setTool,
        detectRooms,
        saveToHistory,
        setProcessingStatus,
    });

    const extendTool = useExtendTool({
        fabricRef,
        walls,
        updateWall,
        connectWalls,
        setTool,
        detectRooms,
        saveToHistory,
        setProcessingStatus,
    });

    const copySelectedWalls = useCallback(() => {
        const selectedWallIds = new Set(selectedIds);
        const selectedWalls = walls
            .filter((wall) => selectedWallIds.has(wall.id))
            .map((wall) => ({
                ...wall,
                startPoint: { ...wall.startPoint },
                endPoint: { ...wall.endPoint },
                interiorLine: {
                    start: { ...wall.interiorLine.start },
                    end: { ...wall.interiorLine.end },
                },
                exteriorLine: {
                    start: { ...wall.exteriorLine.start },
                    end: { ...wall.exteriorLine.end },
                },
                openings: wall.openings.map((opening) => ({ ...opening })),
                connectedWalls: [...wall.connectedWalls],
                startBevel: { ...wall.startBevel },
                endBevel: { ...wall.endBevel },
            }));
        if (selectedWalls.length === 0) return;
        wallClipboardRef.current = selectedWalls;
        setProcessingStatus(`Copied ${selectedWalls.length} wall(s).`, false);
    }, [selectedIds, walls, setProcessingStatus]);

    const pasteWalls = useCallback(() => {
        const copied = wallClipboardRef.current;
        if (!copied || copied.length === 0) return;

        const offset = Math.max(100, wallSettings.gridSize * 2);
        const idMap = new Map<string, string>();
        const newIds: string[] = [];

        for (const wall of copied) {
            const newId = addWall({
                startPoint: { x: wall.startPoint.x + offset, y: wall.startPoint.y + offset },
                endPoint: { x: wall.endPoint.x + offset, y: wall.endPoint.y + offset },
                thickness: wall.thickness,
                material: wall.material,
                layer: wall.layer,
            });
            updateWall(
                newId,
                {
                    openings: wall.openings.map((opening) => ({
                        ...opening,
                        id: generateId(),
                    })),
                    startBevel: { ...wall.startBevel },
                    endBevel: { ...wall.endBevel },
                },
                { skipHistory: true, source: 'ui' }
            );
            idMap.set(wall.id, newId);
            newIds.push(newId);
        }

        for (const wall of copied) {
            const sourceNewId = idMap.get(wall.id);
            if (!sourceNewId) continue;
            for (const connectedId of wall.connectedWalls) {
                const targetNewId = idMap.get(connectedId);
                if (!targetNewId || sourceNewId >= targetNewId) continue;
                connectWalls(sourceNewId, targetNewId);
            }
        }

        setSelectedIds(newIds);
        saveToHistory('Paste walls');
        setProcessingStatus(`Pasted ${newIds.length} wall(s).`, false);
    }, [
        wallSettings.gridSize,
        addWall,
        updateWall,
        connectWalls,
        setSelectedIds,
        saveToHistory,
        setProcessingStatus,
    ]);

    const handleEscapeShortcut = useCallback(() => {
        if (pendingPlacementDefinition) return true;
        if (tool === 'wall' && isWallDrawing) return true;
        if (tool === 'room' && isRoomDrawing) {
            cancelRoomCreation();
            wallRenderer?.clearPreviewWall();
            return true;
        }
        if (tool === 'section-line' && sectionLineDrawingState.isDrawing) return true;
        if (selectedIds.length > 0 || persistentRoomControlId) {
            const canvas = fabricRef.current;
            if (canvas) {
                canvas.discardActiveObject();
                hideActiveSelectionChrome(canvas);
                canvas.requestRenderAll();
            }
            setSelectedIds([]);
            setHoveredElement(null);
            wallRenderer?.setHoveredWall(null);
            roomRendererRef.current?.setHoveredRoom(null);
            roomRendererRef.current?.setSelectedRooms([]);
            roomRendererRef.current?.setActiveDragRoom(null);
            roomRendererRef.current?.setPersistentControlRoom(null);
            setActiveRoomDragId(null);
            setPersistentRoomControlId(null);
            return true;
        }
        return false;
    }, [
        pendingPlacementDefinition,
        tool,
        isWallDrawing,
        isRoomDrawing,
        cancelRoomCreation,
        sectionLineDrawingState.isDrawing,
        selectedIds.length,
        persistentRoomControlId,
        fabricRef,
        setSelectedIds,
        setHoveredElement,
        wallRenderer,
    ]);

    // Keyboard handling
    useCanvasKeyboard({
        tool,
        selectedIds,
        deleteSelected,
        setIsSpacePressed,
        setTool,
        onEscape: handleEscapeShortcut,
        onCopy: copySelectedWalls,
        onPaste: pasteWalls,
    });

    // Ensure room perimeter preview is cleared when leaving room tool.
    useEffect(() => {
        if (tool !== 'room') {
            wallRenderer?.clearPreviewWall();
        }
    }, [tool, wallRenderer]);

    // ---------------------------------------------------------------------------
    // Canvas Initialization
    // ---------------------------------------------------------------------------

    useEffect(() => {
        if (!canvasRef.current || !hostRef.current || !outerRef.current) return;

        const host = hostRef.current;
        const outer = outerRef.current;
        const canvas = new fabric.Canvas(canvasRef.current, {
            width: host.clientWidth,
            height: host.clientHeight,
            backgroundColor,
            selection: tool === 'select',
            preserveObjectStacking: true,
            enableRetinaScaling: true,
        });

        fabricRef.current = canvas;
        roomRendererRef.current = new RoomRenderer(canvas);
        dimensionRendererRef.current = new DimensionRenderer(canvas);
        objectRendererRef.current = new ObjectRenderer(canvas);
        sectionLineRendererRef.current = new SectionLineRenderer(canvas);
        hvacRendererRef.current = new HvacPlanRenderer(canvas);

        // Enable section line dragging with store update
        sectionLineRendererRef.current.setDraggable(true);
        sectionLineRendererRef.current.onMoved((id, deltaX, deltaY) => {
            const { sectionLines: lines, updateSectionLine: update, regenerateElevations: regen } =
                useSmartDrawingStore.getState();
            const line = lines.find((l) => l.id === id);
            if (!line) return;
            const pxToMm = 1 / MM_TO_PX;
            update(id, {
                startPoint: {
                    x: line.startPoint.x + deltaX * pxToMm,
                    y: line.startPoint.y + deltaY * pxToMm,
                },
                endPoint: {
                    x: line.endPoint.x + deltaX * pxToMm,
                    y: line.endPoint.y + deltaY * pxToMm,
                },
            });
            regen({ debounce: true });
        });

        setFabricCanvas(canvas);
        onCanvasReady?.(canvas);
        setViewportSizeIfChanged(outer.clientWidth, outer.clientHeight);

        // [SNAP WIRE] Size overlay canvas to match fabric canvas
        if (snapOverlayRef.current) {
            snapOverlayRef.current.width = host.clientWidth;
            snapOverlayRef.current.height = host.clientHeight;
        }

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (entry.target === host) {
                    const nextWidth = Math.max(1, Math.floor(width));
                    const nextHeight = Math.max(1, Math.floor(height));
                    if (nextWidth <= 2 || nextHeight <= 2) {
                        continue;
                    }
                    canvas.setDimensions({ width: nextWidth, height: nextHeight });
                    canvas.renderAll();
                    // [SNAP WIRE] Keep overlay in sync
                    if (snapOverlayRef.current) {
                        snapOverlayRef.current.width = nextWidth;
                        snapOverlayRef.current.height = nextHeight;
                    }
                }
                if (entry.target === outer) {
                    setViewportSizeIfChanged(width, height);
                }
            }
        });
        resizeObserver.observe(host);
        resizeObserver.observe(outer);

        return () => {
            roomRendererRef.current?.dispose();
            roomRendererRef.current = null;
            dimensionRendererRef.current?.dispose();
            dimensionRendererRef.current = null;
            objectRendererRef.current?.dispose();
            objectRendererRef.current = null;
            sectionLineRendererRef.current?.dispose();
            sectionLineRendererRef.current = null;
            hvacRendererRef.current?.dispose();
            hvacRendererRef.current = null;
            resizeObserver.disconnect();
            canvas.dispose();
            fabricRef.current = null;
            setFabricCanvas(null);
        };
    }, [onCanvasReady, setViewportSizeIfChanged]);

    // Recover from transient layout glitches (tab restore/focus/resize) that can
    // leave Fabric canvas dimensions stale after heavy frame drops.
    useEffect(() => {
        const canvas = fabricRef.current;
        const outer = outerRef.current;
        if (!canvas || !outer) return;

        const syncCanvasDimensions = () => {
            const outerWidth = Math.max(1, Math.floor(outer.clientWidth));
            const outerHeight = Math.max(1, Math.floor(outer.clientHeight));
            setViewportSizeIfChanged(outerWidth, outerHeight);

            const targetWidth = Math.max(1, outerWidth - originOffset.x);
            const targetHeight = Math.max(1, outerHeight - originOffset.y);
            if (targetWidth <= 2 || targetHeight <= 2) {
                return;
            }

            const currentWidth = Math.round(canvas.getWidth());
            const currentHeight = Math.round(canvas.getHeight());
            if (Math.abs(currentWidth - targetWidth) > 1 || Math.abs(currentHeight - targetHeight) > 1) {
                canvas.setDimensions({ width: targetWidth, height: targetHeight });
                if (snapOverlayRef.current) {
                    snapOverlayRef.current.width = targetWidth;
                    snapOverlayRef.current.height = targetHeight;
                }
                canvas.requestRenderAll();
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden) return;
            window.requestAnimationFrame(syncCanvasDimensions);
        };

        syncCanvasDimensions();
        window.addEventListener('resize', syncCanvasDimensions);
        window.addEventListener('focus', syncCanvasDimensions);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('resize', syncCanvasDimensions);
            window.removeEventListener('focus', syncCanvasDimensions);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fabricCanvas, originOffset.x, originOffset.y, setViewportSizeIfChanged]);

    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        canvas.set('backgroundColor', backgroundColor);
        canvas.renderAll();
    }, [backgroundColor]);

    // Sync view transform
    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const viewportTransform: fabric.TMat2D = [
            viewportZoom,
            0,
            0,
            viewportZoom,
            -panOffset.x * viewportZoom,
            -panOffset.y * viewportZoom,
        ];
        canvas.setViewportTransform(viewportTransform);
        roomRendererRef.current?.setViewportZoom(viewportZoom);
        wallRenderer?.setViewportZoom(viewportZoom);
        dimensionRendererRef.current?.setViewportZoom(viewportZoom);
        hideActiveSelectionChrome(canvas);
        canvas.requestRenderAll();
        zoomRef.current = viewportZoom;
        panOffsetRef.current = panOffset;
    }, [viewportZoom, panOffset, wallRenderer]);

    useEffect(() => {
        if (tool === 'select') {
            return;
        }
        const hoveredWallId = hoveredElementId && wallIdSet.has(hoveredElementId)
            ? hoveredElementId
            : null;
        wallRenderer?.setHoveredWall(hoveredWallId);
    }, [wallRenderer, hoveredElementId, wallIdSet, tool]);

    useEffect(() => {
        if (tool !== 'dimension') {
            cancelDimensionPlacement();
        }
    }, [tool, cancelDimensionPlacement]);

    useEffect(() => {
        if (tool !== 'offset') {
            offsetTool.cleanup();
        }
    }, [tool, offsetTool]);

    useEffect(() => {
        if (tool !== 'trim') {
            trimTool.cleanup();
        }
    }, [tool, trimTool]);

    useEffect(() => {
        if (tool !== 'extend') {
            extendTool.cleanup();
        }
    }, [tool, extendTool]);

    // Live elastic dimension shown while drawing a wall.
    useEffect(() => {
        const renderer = dimensionRendererRef.current;
        if (!renderer) return;
        if (
            tool === 'wall' &&
            wallDrawingState.isDrawing &&
            wallDrawingState.startPoint &&
            wallDrawingState.currentPoint
        ) {
            const start = wallDrawingState.startPoint;
            const end = wallDrawingState.currentPoint;
            const lengthMm = Math.hypot(end.x - start.x, end.y - start.y);
            const label = formatDimensionLength(lengthMm, dimensionSettings);
            renderer.setViewportZoom(viewportZoom);
            renderer.renderLiveDimension(start, end, label);
        } else {
            renderer.clearLiveDimension();
        }
    }, [tool, wallDrawingState, dimensionSettings, viewportZoom]);

    const refreshDimensionLayer = useCallback(() => {
        const perfStart = startDragPerfTimer();
        const renderer = dimensionRendererRef.current;
        const canvas = fabricRef.current;
        if (!renderer || !canvas) {
            endDragPerfTimer('canvas.refreshDimensionLayer', perfStart, {
                dimensions: dimensions.length,
                walls: walls.length,
                rooms: rooms.length,
            });
            return;
        }
        renderer.setViewportZoom(viewportZoom);
        renderer.setContext(walls, rooms, dimensionSettings);
        renderer.renderAllDimensions(dimensions);
        const dimensionIdSet = new Set(dimensions.map((dimension) => dimension.id));
        const selectedDimensionIds = selectedIds.filter((id) => dimensionIdSet.has(id));
        const hoveredDimensionId =
            hoveredElementId && dimensionIdSet.has(hoveredElementId)
                ? hoveredElementId
                : null;
        renderer.setSelectedDimensions(selectedDimensionIds);
        renderer.setHoveredDimension(hoveredDimensionId);
        restackInteractiveOverlays(canvas);
        canvas.requestRenderAll();
        endDragPerfTimer('canvas.refreshDimensionLayer', perfStart, {
            dimensions: dimensions.length,
            walls: walls.length,
            rooms: rooms.length,
        });
    }, [
        walls,
        rooms,
        dimensionSettings,
        dimensions,
        viewportZoom,
        selectedIds,
        hoveredElementId,
        restackInteractiveOverlays,
    ]);

    const scheduleAutoDimensionSync = useCallback(() => {
        if (typeof window === 'undefined') {
            syncAutoDimensions();
            return;
        }
        if (autoDimensionSyncFrameRef.current !== null) return;
        autoDimensionSyncFrameRef.current = window.requestAnimationFrame(() => {
            autoDimensionSyncFrameRef.current = null;
            syncAutoDimensions();
        });
    }, [syncAutoDimensions]);

    // Automatically rebuild all auto-generated dimensions whenever walls, rooms,
    // or dimension settings change — so dimensions are always visible without
    // requiring a manual "Auto Dimension" button press.
    // During handle dragging, frame-throttle updates so wall dimensions stay live.
    useEffect(() => {
        if (wallDrawingState.isDrawing) return;
        if (walls.length === 0 && rooms.length === 0) return;
        if (isHandleDragging) {
            scheduleAutoDimensionSync();
            return;
        }
        syncAutoDimensions();
    }, [
        walls,
        rooms,
        dimensionSettings,
        wallDrawingState.isDrawing,
        isHandleDragging,
        scheduleAutoDimensionSync,
        syncAutoDimensions,
    ]);

    const scheduleDimensionLayerRefresh = useCallback(() => {
        if (typeof window === 'undefined') {
            refreshDimensionLayer();
            return;
        }
        if (dimensionRefreshFrameRef.current !== null) return;
        dimensionRefreshFrameRef.current = window.requestAnimationFrame(() => {
            dimensionRefreshFrameRef.current = null;
            refreshDimensionLayer();
        });
    }, [refreshDimensionLayer]);

    const refreshObjectLayer = useCallback(() => {
        if (!objectRendererRef.current) return;
        objectRendererRef.current.renderIncremental(symbolsRef.current);
    }, []);

    const scheduleObjectLayerRefresh = useCallback(() => {
        if (typeof window === 'undefined') {
            refreshObjectLayer();
            return;
        }
        if (objectRefreshFrameRef.current !== null) return;
        objectRefreshFrameRef.current = window.requestAnimationFrame(() => {
            objectRefreshFrameRef.current = null;
            refreshObjectLayer();
        });
    }, [refreshObjectLayer]);

    useEffect(() => {
        roomRendererRef.current?.setWallContext(walls);
        roomRendererRef.current?.renderAllRooms(rooms);
        objectRendererRef.current?.bringObjectsToFront(symbols.map((symbol) => symbol.id));
        // Rebuild dimensions after room re-renders, then restore edit-handle priority.
        if (isHandleDragging) {
            scheduleDimensionLayerRefresh();
            return;
        }
        refreshDimensionLayer();
    }, [rooms, walls, symbols, fabricCanvas, refreshDimensionLayer, isHandleDragging, scheduleDimensionLayerRefresh]);

    useEffect(() => {
        return () => {
            if (
                dimensionRefreshFrameRef.current !== null &&
                typeof window !== 'undefined'
            ) {
                window.cancelAnimationFrame(dimensionRefreshFrameRef.current);
                dimensionRefreshFrameRef.current = null;
            }
            if (
                autoDimensionSyncFrameRef.current !== null &&
                typeof window !== 'undefined'
            ) {
                window.cancelAnimationFrame(autoDimensionSyncFrameRef.current);
                autoDimensionSyncFrameRef.current = null;
            }
            if (
                objectRefreshFrameRef.current !== null &&
                typeof window !== 'undefined'
            ) {
                window.cancelAnimationFrame(objectRefreshFrameRef.current);
                objectRefreshFrameRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        roomRendererRef.current?.setShowTemperatureIcons(wallSettings.showRoomTemperatureIcons);
        roomRendererRef.current?.setShowVentilationBadges(wallSettings.showRoomVentilationBadges);
    }, [wallSettings.showRoomTemperatureIcons, wallSettings.showRoomVentilationBadges, fabricCanvas]);

    useEffect(() => {
        if (isHandleDragging) {
            scheduleDimensionLayerRefresh();
            return;
        }
        refreshDimensionLayer();
    }, [refreshDimensionLayer, scheduleDimensionLayerRefresh, fabricCanvas, isHandleDragging]);

    useEffect(() => {
        const roomIdSet = new Set(rooms.map((room) => room.id));
        const selectedRoomIds = selectedIds.filter((id) => roomIdSet.has(id));
        roomRendererRef.current?.setSelectedRooms(selectedRoomIds);
        if (selectedRoomIds.length > 0) {
            setPersistentRoomControlId(selectedRoomIds[0] ?? null);
        }
    }, [rooms, selectedIds]);

    useEffect(() => {
        const roomIdSet = new Set(rooms.map((room) => room.id));
        const resolvedRoomDragId =
            activeRoomDragId && roomIdSet.has(activeRoomDragId)
                ? activeRoomDragId
                : null;
        roomRendererRef.current?.setActiveDragRoom(resolvedRoomDragId);
        if (resolvedRoomDragId !== activeRoomDragId) {
            setActiveRoomDragId(resolvedRoomDragId);
        }
    }, [rooms, activeRoomDragId]);

    useEffect(() => {
        const roomIdSet = new Set(rooms.map((room) => room.id));
        const resolvedPersistentRoomControlId =
            persistentRoomControlId && roomIdSet.has(persistentRoomControlId)
                ? persistentRoomControlId
                : null;
        roomRendererRef.current?.setPersistentControlRoom(resolvedPersistentRoomControlId);
        if (resolvedPersistentRoomControlId !== persistentRoomControlId) {
            setPersistentRoomControlId(resolvedPersistentRoomControlId);
        }
    }, [rooms, persistentRoomControlId]);

    useEffect(() => {
        const dimensionIdSet = new Set(dimensions.map((dimension) => dimension.id));
        const selectedDimensionIds = selectedIds.filter((id) => dimensionIdSet.has(id));
        dimensionRendererRef.current?.setSelectedDimensions(selectedDimensionIds);
    }, [dimensions, selectedIds]);

    useEffect(() => {
        const roomIdSet = new Set(rooms.map((room) => room.id));
        const hoveredRoomId = hoveredElementId && roomIdSet.has(hoveredElementId)
            ? hoveredElementId
            : null;
        roomRendererRef.current?.setHoveredRoom(hoveredRoomId);
    }, [rooms, hoveredElementId]);

    useEffect(() => {
        const dimensionIdSet = new Set(dimensions.map((dimension) => dimension.id));
        const hoveredDimensionId = hoveredElementId && dimensionIdSet.has(hoveredElementId)
            ? hoveredElementId
            : null;
        dimensionRendererRef.current?.setHoveredDimension(hoveredDimensionId);
    }, [dimensions, hoveredElementId]);

    useEffect(() => {
        if (!objectRendererRef.current) return;
        objectRendererRef.current.setDefinitions(objectDefinitions);
    }, [objectDefinitions, fabricCanvas]);

    useEffect(() => {
        if (isHandleDragging) {
            scheduleObjectLayerRefresh();
            return;
        }
        refreshObjectLayer();
    }, [symbols, objectDefinitions, fabricCanvas, isHandleDragging, refreshObjectLayer, scheduleObjectLayerRefresh]);

    useEffect(() => {
        if (!wallRenderer) return;
        const openingSymbols = symbolsRef.current.filter((instance) => {
            const definition = objectDefinitionsById.get(instance.symbolId);
            return definition?.category === 'doors' || definition?.category === 'windows';
        });
        wallRenderer.setOpeningSymbolInstances(openingSymbols);
        wallRenderer.setDragOptimizedMode(isHandleDragging);
        if (isHandleDragging) {
            wallRenderer.renderWallsInteractive(wallsRef.current);
            if (fabricRef.current) {
                restackInteractiveOverlays(fabricRef.current);
            }
            scheduleDimensionLayerRefresh();
            return;
        }
        wallRenderer.renderAllWalls(wallsRef.current);
        // Rebuild dimensions after wall re-renders, then restore edit-handle priority.
        refreshDimensionLayer();
    }, [
        wallRenderer,
        walls,
        doorWindowSymbolsSignature,
        objectDefinitionsById,
        refreshDimensionLayer,
        scheduleDimensionLayerRefresh,
        restackInteractiveOverlays,
        isHandleDragging,
    ]);

    useEffect(() => {
        if (isHandleDragging) return;
        if (walls.length === 0 || symbols.length === 0) return;

        let adjustedAnyWall = false;
        for (const wall of walls) {
            if (wall.openings.length === 0) continue;
            let hasWallChange = false;
            const nextOpenings = wall.openings.map((opening) => {
                const fitted = fitOpeningToWall(wall, opening);
                if (
                    Math.abs(fitted.position - opening.position) > 0.01 ||
                    Math.abs(fitted.width - opening.width) > 0.01
                ) {
                    hasWallChange = true;
                    return {
                        ...opening,
                        position: fitted.position,
                        width: fitted.width,
                    };
                }
                return opening;
            });

            if (hasWallChange) {
                adjustedAnyWall = true;
                updateWall(
                    wall.id,
                    { openings: nextOpenings },
                    { skipHistory: true, source: 'drag' }
                );
            }
        }

        if (adjustedAnyWall) {
            return;
        }

        const openingLookup = new Map<string, { wall: Wall; opening: Wall['openings'][number] }>();
        for (const wall of walls) {
            for (const opening of wall.openings) {
                openingLookup.set(opening.id, { wall, opening });
            }
        }

        for (const instance of symbols) {
            const definition = objectDefinitionsById.get(instance.symbolId);
            if (!definition) continue;
            if (definition.category !== 'doors' && definition.category !== 'windows') continue;

            const linked = openingLookup.get(instance.id);
            if (!linked) continue;

            const { wall, opening } = linked;
            const dx = wall.endPoint.x - wall.startPoint.x;
            const dy = wall.endPoint.y - wall.startPoint.y;
            const wallLength = Math.hypot(dx, dy) || 1;
            const t = opening.position / wallLength;
            const nextPosition = {
                x: wall.startPoint.x + dx * t,
                y: wall.startPoint.y + dy * t,
            };
            const nextRotation = (Math.atan2(dy, dx) * 180) / Math.PI;
            const nextWidthMm = Math.max(1, opening.width - 50);
            const nextHeightMm = Math.max(1, opening.height);
            const nextSillHeightMm =
                definition.category === 'windows'
                    ? Math.max(0, opening.sillHeight ?? resolveOpeningSillHeightMm(definition, instance.properties))
                    : 0;
            const nextBaseElevationMm =
                definition.category === 'windows'
                    ? (wall.properties3D.baseElevation ?? 0) + nextSillHeightMm
                    : (wall.properties3D.baseElevation ?? 0);
            const nextProperties = buildHostedOpeningSymbolProperties(
                definition,
                wall,
                opening.position,
                instance.properties,
                nextWidthMm,
                nextHeightMm,
                nextSillHeightMm
            );

            const properties = instance.properties ?? {};
            const changed =
                Math.abs(instance.position.x - nextPosition.x) > 0.01 ||
                Math.abs(instance.position.y - nextPosition.y) > 0.01 ||
                Math.abs(instance.rotation - nextRotation) > 0.01 ||
                Math.abs(Number(properties.widthMm ?? 0) - nextWidthMm) > 0.01 ||
                Math.abs(Number(properties.depthMm ?? 0) - wall.thickness) > 0.01 ||
                Math.abs(Number(properties.heightMm ?? 0) - nextHeightMm) > 0.01 ||
                Math.abs(Number(properties.positionAlongWallMm ?? 0) - opening.position) > 0.01 ||
                String(properties.hostWallId ?? '') !== wall.id ||
                Math.abs(Number(properties.baseElevationMm ?? 0) - nextBaseElevationMm) > 0.01 ||
                String(properties.doorOpenSide ?? '') !== String(nextProperties.doorOpenSide ?? '') ||
                (definition.category === 'windows' &&
                    Math.abs(Number(properties.sillHeightMm ?? 0) - nextSillHeightMm) > 0.01);

            if (!changed) continue;

            updateSymbol(
                instance.id,
                {
                    position: nextPosition,
                    rotation: nextRotation,
                    properties: nextProperties,
                },
                { skipHistory: true }
            );
        }
    }, [
        walls,
        symbols,
        objectDefinitionsById,
        buildHostedOpeningSymbolProperties,
        fitOpeningToWall,
        resolveOpeningSillHeightMm,
        updateWall,
        updateSymbol,
        isHandleDragging,
    ]);

    useEffect(() => {
        const canvas = fabricRef.current;
        const symbolIdSet = new Set(symbols.map((symbol) => symbol.id));
        const selectedSymbolIds = selectedIds.filter((id) => symbolIdSet.has(id));
        objectRendererRef.current?.setSelectedObjects(selectedSymbolIds);
        const activeObject = canvas?.getActiveObject() as (fabric.Object & { objectId?: string }) | null;
        const activeObjectId = activeObject?.objectId ?? null;
        const singleSelectedSymbolId =
            tool === 'select' && selectedIds.length === 1 && selectedSymbolIds.length === 1
                ? selectedSymbolIds[0]
                : null;

        if (singleSelectedSymbolId) {
            if (activeObjectId !== singleSelectedSymbolId) {
                objectRendererRef.current?.activateObject(singleSelectedSymbolId);
            }
            hideActiveSelectionChrome(fabricRef.current);
        } else if (canvas && activeObjectId) {
            canvas.discardActiveObject();
            hideActiveSelectionChrome(canvas);
        }
        if (canvas && selectedSymbolIds.length > 0) {
            restackInteractiveOverlays(canvas);
            canvas.requestRenderAll();
        }
    }, [symbols, selectedIds, tool, restackInteractiveOverlays]);

    useEffect(() => {
        const symbolIdSet = new Set(symbols.map((symbol) => symbol.id));
        const hoveredSymbolId = hoveredElementId && symbolIdSet.has(hoveredElementId)
            ? hoveredElementId
            : null;
        objectRendererRef.current?.setHoveredObject(hoveredSymbolId);
    }, [symbols, hoveredElementId]);

    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        clearOpeningResizeHandles();
        if (tool !== 'select' || selectedIds.length === 0) return;

        const selectedId = selectedIds.find((id) =>
            walls.some((wall) => wall.openings.some((opening) => opening.id === id))
        );
        if (!selectedId) return;
        const hostWall = walls.find((wall) => wall.openings.some((opening) => opening.id === selectedId));
        if (!hostWall) return;
        const hostOpening = hostWall.openings.find((opening) => opening.id === selectedId);
        if (!hostOpening) return;

        const dx = hostWall.endPoint.x - hostWall.startPoint.x;
        const dy = hostWall.endPoint.y - hostWall.startPoint.y;
        const wallLength = Math.hypot(dx, dy);
        if (!Number.isFinite(wallLength) || wallLength <= 0.001) return;

        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        const direction = { x: dx / wallLength, y: dy / wallLength };
        const startEdge = hostOpening.position - hostOpening.width / 2;
        const endEdge = hostOpening.position + hostOpening.width / 2;
        const handleSizePx = OPENING_RESIZE_HANDLE_SIZE_PX / Math.max(viewportZoom, 0.01);

        const createHandle = (side: 'start' | 'end', edgeAlongWallMm: number) => {
            const pointMm = {
                x: hostWall.startPoint.x + direction.x * edgeAlongWallMm,
                y: hostWall.startPoint.y + direction.y * edgeAlongWallMm,
            };
            const angle = side === 'start' ? angleDeg + 270 : angleDeg + 90;
            const handle = new fabric.Triangle({
                left: pointMm.x * MM_TO_PX,
                top: pointMm.y * MM_TO_PX,
                width: handleSizePx,
                height: handleSizePx,
                angle,
                fill: OPENING_RESIZE_HANDLE_COLOR,
                stroke: '#ffffff',
                strokeWidth: 2 / Math.max(viewportZoom, 0.01),
                originX: 'center',
                originY: 'center',
                selectable: false,
                evented: true,
                hasControls: false,
                hasBorders: false,
                objectCaching: false,
                hoverCursor: 'ew-resize',
                moveCursor: 'ew-resize',
            });
            const typedHandle = handle as fabric.Object & {
                id?: string;
                name?: string;
                openingId?: string;
                wallId?: string;
                openingResizeSide?: 'start' | 'end';
                isOpeningResizeHandle?: boolean;
            };
            typedHandle.id = `${selectedId}-resize-${side}`;
            typedHandle.name = `opening-resize-${side}`;
            typedHandle.openingId = selectedId;
            typedHandle.wallId = hostWall.id;
            typedHandle.openingResizeSide = side;
            typedHandle.isOpeningResizeHandle = true;
            canvas.add(handle);
            canvas.bringObjectToFront(handle);
            openingResizeHandlesRef.current.push(handle);
        };

        createHandle('start', startEdge);
        createHandle('end', endEdge);
        canvas.requestRenderAll();
    }, [
        tool,
        selectedIds,
        symbols,
        walls,
        objectDefinitionsById,
        viewportZoom,
        clearOpeningResizeHandles,
    ]);

    useEffect(() => {
        if (tool !== 'select') {
            openingPointerInteractionRef.current = null;
            setOpeningInteractionActive(false);
        }
    }, [tool]);

    useEffect(() => {
        if (!sectionLineRendererRef.current) return;
        sectionLineRendererRef.current.setShowReferenceIndicators(wallSettings.showSectionReferenceLines);
        sectionLineRendererRef.current.renderAll(sectionLines);
    }, [sectionLines, wallSettings.showSectionReferenceLines, fabricCanvas]);

    // Render HVAC elements on plan canvas
    useEffect(() => {
        if (!hvacRendererRef.current) return;
        hvacRendererRef.current.renderAll(hvacElements);
    }, [hvacElements, fabricCanvas]);

    useEffect(() => {
        const sectionIds = new Set(sectionLines.map((line) => line.id));
        const selectedSectionIds = selectedIds.filter((id) => sectionIds.has(id));
        sectionLineRendererRef.current?.setSelectedSectionLines(selectedSectionIds);
    }, [sectionLines, selectedIds]);

    useEffect(() => {
        const sectionIds = new Set(sectionLines.map((line) => line.id));
        const hoveredSectionId = hoveredElementId && sectionIds.has(hoveredElementId)
            ? hoveredElementId
            : null;
        sectionLineRendererRef.current?.setHoveredSectionLine(hoveredSectionId);
    }, [sectionLines, hoveredElementId]);

    useEffect(() => {
        const renderer = sectionLineRendererRef.current;
        if (!renderer) return;
        if (
            tool === 'section-line' &&
            sectionLineDrawingState.isDrawing &&
            sectionLineDrawingState.startPoint &&
            sectionLineDrawingState.currentPoint
        ) {
            renderer.renderPreview(
                sectionLineDrawingState.startPoint,
                sectionLineDrawingState.currentPoint,
                sectionLineDrawingState.direction,
                sectionLineDrawingState.nextLabel
            );
            return;
        }
        renderer.clearPreview();
    }, [tool, sectionLineDrawingState]);

    useEffect(() => {
        if (!pendingPlacementDefinition) {
            objectRendererRef.current?.clearPlacementPreview();
            placementCursorRef.current = null;
            setPlacementValid(true);
            return;
        }
        setPlacementRotationDeg(pendingPlacementDefinition.defaultRotationDeg ?? 0);
        if (!placementCursorRef.current) {
            const seedPoint = {
                x: mousePositionRef.current.x / MM_TO_PX,
                y: mousePositionRef.current.y / MM_TO_PX,
            };
            placementCursorRef.current = seedPoint;
            const placement = computePlacement(seedPoint, pendingPlacementDefinition);
            setPlacementValid(placement.valid);
            objectRendererRef.current?.renderPlacementPreview(
                pendingPlacementDefinition,
                placement.point,
                placement.rotationDeg,
                placement.valid,
                placement.snappedWall ? {
                    wall: placement.snappedWall.wall,
                    positionAlongWall: placement.snappedWall.positionAlongWall,
                } : null,
                buildOpeningPreviewProperties(
                    pendingPlacementDefinition,
                    placement.snappedWall ? {
                        wall: placement.snappedWall.wall,
                        positionAlongWall: placement.snappedWall.positionAlongWall,
                    } : null
                ),
            );
        }
    }, [pendingPlacementDefinition, buildOpeningPreviewProperties, computePlacement]);

    useEffect(() => {
        if (!pendingPlacementDefinition || !placementCursorRef.current) return;
        const placement = computePlacement(placementCursorRef.current, pendingPlacementDefinition);
        setPlacementValid(placement.valid);
        objectRendererRef.current?.renderPlacementPreview(
            pendingPlacementDefinition,
            placement.point,
            placement.rotationDeg,
            placement.valid,
            placement.snappedWall ? {
                wall: placement.snappedWall.wall,
                positionAlongWall: placement.snappedWall.positionAlongWall,
            } : null,
            buildOpeningPreviewProperties(
                pendingPlacementDefinition,
                placement.snappedWall ? {
                    wall: placement.snappedWall.wall,
                    positionAlongWall: placement.snappedWall.positionAlongWall,
                } : null
            ),
        );
    }, [pendingPlacementDefinition, placementRotationDeg, buildOpeningPreviewProperties, computePlacement]);

    useEffect(() => { canvasStateRef.current = canvasState; }, [canvasState]);

    // ---------------------------------------------------------------------------
    // Tool Change Handler
    // ---------------------------------------------------------------------------

    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const effectiveTool = isSpacePressed ? 'pan' : tool;
        const allowSelection =
            effectiveTool === 'select' &&
            !pendingPlacementDefinition &&
            !openingInteractionActive;
        const pointerCursor = canvasState.isPanning
            ? 'grabbing'
            : pendingPlacementDefinition
                ? 'crosshair'
                : getToolCursor(effectiveTool);

        canvas.selection = allowSelection;
        (canvas as fabric.Canvas & { selectionFullyContained?: boolean }).selectionFullyContained = allowSelection;
        canvas.defaultCursor = pointerCursor;
        canvas.hoverCursor = pointerCursor;
        if (!allowSelection) {
            marqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
            lastMarqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
            applyMarqueeFilterRef.current = false;
        }

        canvas.forEachObject((obj) => {
            const typed = obj as fabric.Object & {
                isWallControl?: boolean;
                isWallControlDecoration?: boolean;
                isRoomControl?: boolean;
                isRoomControlDecoration?: boolean;
                isDimensionControl?: boolean;
                isDimensionControlDecoration?: boolean;
                sectionLineId?: string;
                isOpeningResizeHandle?: boolean;
            };
            if (typed.isWallControlDecoration) {
                obj.selectable = false;
                obj.evented = false;
                return;
            }
            if (typed.isRoomControlDecoration) {
                obj.selectable = false;
                obj.evented = false;
                return;
            }
            if (typed.isWallControl) {
                obj.selectable = allowSelection;
                obj.evented = allowSelection;
                return;
            }
            if (typed.isRoomControl) {
                obj.selectable = allowSelection;
                obj.evented = allowSelection;
                return;
            }
            if (typed.isDimensionControlDecoration) {
                obj.selectable = false;
                obj.evented = false;
                return;
            }
            if (typed.isDimensionControl) {
                obj.selectable = allowSelection;
                obj.evented = allowSelection;
                return;
            }
            if (typed.sectionLineId) {
                obj.selectable = false;
                obj.evented = allowSelection;
                return;
            }
            if (typed.isOpeningResizeHandle) {
                obj.selectable = false;
                obj.evented = allowSelection;
                return;
            }
            obj.selectable = allowSelection;
            obj.evented = allowSelection;
        });
        if (allowSelection) {
            hideActiveSelectionChrome(canvas);
        }
        canvas.renderAll();
    }, [tool, isSpacePressed, canvasState.isPanning, pendingPlacementDefinition, openingInteractionActive]);

    // ---------------------------------------------------------------------------
    // Mouse Event Handlers
    // ---------------------------------------------------------------------------

    const handleMouseDown = useCallback(
        (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const viewportPoint = canvas.getViewportPoint(e.e);
            const scenePoint = canvas.getScenePoint(e.e);
            const rawPoint = { x: scenePoint.x, y: scenePoint.y };
            const point = resolvedSnapToGrid
                ? snapPointToGrid(rawPoint, effectiveSnapGridSize)
                : rawPoint;
            queueMousePositionUpdate(rawPoint);
            closeWallContextMenu();
            closeDimensionContextMenu();
            closeSectionLineContextMenu();
            closeObjectContextMenu();

            const mouseEvent = e.e as MouseEvent;
            if ('button' in mouseEvent && mouseEvent.button === 1) {
                mouseEvent.preventDefault();
                return;
            }
            if ('button' in mouseEvent && mouseEvent.button === 2) {
                return;
            }

            const shouldPan = tool === 'pan' || isSpacePressed;
            if (shouldPan) {
                const nextState: CanvasState = { ...canvasStateRef.current, isPanning: true, lastPanPoint: { x: viewportPoint.x, y: viewportPoint.y } };
                canvasStateRef.current = nextState;
                setCanvasState(nextState);
                return;
            }

            if (tool === 'select') {
                const pointerMm = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                const inferredOpening = findOpeningAtPoint(pointerMm);
                if (!e.target && !inferredOpening) {
                    const start = {
                        x: rawPoint.x / MM_TO_PX,
                        y: rawPoint.y / MM_TO_PX,
                    };
                    const initialSelection: MarqueeSelectionState = {
                        active: true,
                        start,
                        current: start,
                        mode: 'window',
                    };
                    marqueeSelectionRef.current = initialSelection;
                    lastMarqueeSelectionRef.current = initialSelection;
                    applyMarqueeFilterRef.current = false;
                    setMarqueeSelectionMode('window');
                } else {
                    marqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
                    lastMarqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
                    applyMarqueeFilterRef.current = false;
                    setMarqueeSelectionMode('window');
                }
            }

            if (pendingPlacementDefinition) {
                const placementPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                placePendingObject(placementPoint);
                return;
            }

            // Handle wall tool - convert from pixels to mm
            if (tool === 'wall') {
                const wallPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                handleWallMouseDown(wallPoint);
                return;
            }

            // Handle room tool (2-click rectangle) - convert from pixels to mm
            if (tool === 'room') {
                const wasRoomDrawing = isRoomDrawing;
                const roomPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                handleRoomMouseDown(roomPoint);
                if (wasRoomDrawing) {
                    wallRenderer?.clearPreviewWall();
                }
                return;
            }

            if (tool === 'dimension') {
                const dimensionPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                handleDimensionPlacementMouseDown(
                    dimensionPoint,
                    (e.target as fabric.Object | null | undefined) ?? null
                );
                return;
            }

            if (tool === 'section-line') {
                const sectionPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                if (!sectionLineDrawingState.isDrawing) {
                    startSectionLineDrawing(sectionPoint);
                } else {
                    updateSectionLinePreview(sectionPoint);
                    commitSectionLine();
                }
                return;
            }

            if (tool === 'offset') {
                offsetTool.handleMouseDown(rawPoint);
                return;
            }

            if (tool === 'trim') {
                trimTool.handleMouseDown(rawPoint);
                return;
            }

            if (tool === 'extend') {
                extendTool.handleMouseDown(rawPoint);
                return;
            }

            if (isDrawingTool(tool)) {
                const nextState: CanvasState = { ...canvasStateRef.current, isDrawing: true, drawingPoints: [point] };
                canvasStateRef.current = nextState;
                setCanvasState(nextState);
            }
        },
        [
            tool,
            resolvedSnapToGrid,
            effectiveSnapGridSize,
            isSpacePressed,
            pendingPlacementDefinition,
            queueMousePositionUpdate,
            closeWallContextMenu,
            closeDimensionContextMenu,
            closeSectionLineContextMenu,
            closeObjectContextMenu,
            placePendingObject,
            handleWallMouseDown,
            isRoomDrawing,
            handleRoomMouseDown,
            findOpeningAtPoint,
            handleDimensionPlacementMouseDown,
            setMarqueeSelectionMode,
            sectionLineDrawingState.isDrawing,
            startSectionLineDrawing,
            updateSectionLinePreview,
            commitSectionLine,
            wallRenderer,
            offsetTool,
            trimTool,
            extendTool,
        ]
    );

    const handleMouseMove = useCallback(
        (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const viewportPoint = canvas.getViewportPoint(e.e);
            const scenePoint = canvas.getScenePoint(e.e);
            const rawPoint = { x: scenePoint.x, y: scenePoint.y };
            const point = resolvedSnapToGrid
                ? snapPointToGrid(rawPoint, effectiveSnapGridSize)
                : rawPoint;
            queueMousePositionUpdate(rawPoint);

            const currentState = canvasStateRef.current;
            if (middlePanRef.current.active) return;

            if (tool === 'select' && isWallHandleDraggingRef.current) {
                const selectPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                handleSelectMouseMove(selectPoint, null);
                return;
            }

            if (currentState.isPanning && currentState.lastPanPoint) {
                const dx = viewportPoint.x - currentState.lastPanPoint.x;
                const dy = viewportPoint.y - currentState.lastPanPoint.y;
                const nextPan = { x: panOffsetRef.current.x - dx / zoomRef.current, y: panOffsetRef.current.y - dy / zoomRef.current };
                panOffsetRef.current = nextPan;
                setPanOffset(nextPan);
                const nextState: CanvasState = { ...currentState, lastPanPoint: { x: viewportPoint.x, y: viewportPoint.y } };
                canvasStateRef.current = nextState;
                setCanvasState(nextState);
                return;
            }

            if (tool === 'select' && openingPointerInteractionRef.current) {
                const pointerMm = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                const handled = updateOpeningPointerInteraction(pointerMm);
                if (handled) {
                    return;
                }
            }

            if (tool === 'select' && marqueeSelectionRef.current.active && marqueeSelectionRef.current.start) {
                const current = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                const mode: 'window' | 'crossing' =
                    current.x >= marqueeSelectionRef.current.start.x ? 'window' : 'crossing';
                marqueeSelectionRef.current = {
                    ...marqueeSelectionRef.current,
                    current,
                    mode,
                };
                lastMarqueeSelectionRef.current = {
                    ...marqueeSelectionRef.current,
                    start: marqueeSelectionRef.current.start ? { ...marqueeSelectionRef.current.start } : null,
                    current: marqueeSelectionRef.current.current ? { ...marqueeSelectionRef.current.current } : null,
                };
                setMarqueeSelectionMode(mode);
            }

            if (pendingPlacementDefinition) {
                const placementPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                placementCursorRef.current = placementPoint;
                const placement = computePlacement(placementPoint, pendingPlacementDefinition);
                setPlacementValid(placement.valid);
                objectRendererRef.current?.renderPlacementPreview(
                    pendingPlacementDefinition,
                    placement.point,
                    placement.rotationDeg,
                    placement.valid,
                    placement.snappedWall ? {
                        wall: placement.snappedWall.wall,
                        positionAlongWall: placement.snappedWall.positionAlongWall,
                    } : null,
                    buildOpeningPreviewProperties(
                        pendingPlacementDefinition,
                        placement.snappedWall ? {
                            wall: placement.snappedWall.wall,
                            positionAlongWall: placement.snappedWall.positionAlongWall,
                        } : null
                    ),
                );
                return;
            }

            // Handle wall tool movement - convert from pixels to mm
            // Show snap indicators on hover even before drawing starts
            if (tool === 'wall') {
                const wallPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                handleWallMouseMove(wallPoint);
                scheduleDimensionLayerRefresh();
                if (!isWallDrawing) {
                    // Don't return early — allow other handlers below to still fire
                    // But snap indicators are already rendered by handleWallMouseMove
                }
                if (isWallDrawing) return;
            }

            if (tool === 'room') {
                const roomPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                // Reuse wall-tool snap indicator rendering so room mode shows
                // the same magnetic endpoint proposal marker.
                if (resolvedSnapToGrid) {
                    handleWallMouseMove(roomPoint);
                }
                handleRoomMouseMove(roomPoint);
                scheduleDimensionLayerRefresh();
                if (isRoomDrawing && roomStartCorner) {
                    const snappedEnd = resolvedSnapToGrid
                        ? snapWallPoint(
                            roomPoint,
                            null,
                            wallSettings,
                            walls,
                            false,
                            viewportZoom,
                            undefined
                        ).snappedPoint
                        : roomPoint;
                    const minX = Math.min(roomStartCorner.x, snappedEnd.x);
                    const maxX = Math.max(roomStartCorner.x, snappedEnd.x);
                    const minY = Math.min(roomStartCorner.y, snappedEnd.y);
                    const maxY = Math.max(roomStartCorner.y, snappedEnd.y);
                    const segments = [
                        { startPoint: { x: minX, y: minY }, endPoint: { x: maxX, y: minY } },
                        { startPoint: { x: maxX, y: minY }, endPoint: { x: maxX, y: maxY } },
                        { startPoint: { x: maxX, y: maxY }, endPoint: { x: minX, y: maxY } },
                        { startPoint: { x: minX, y: maxY }, endPoint: { x: minX, y: minY } },
                    ];
                    wallRenderer?.renderPreviewWalls(
                        segments,
                        wallSettings.defaultThickness,
                        wallSettings.defaultMaterial
                    );
                    return;
                }
                wallRenderer?.clearPreviewWall();
            }

            if (tool === 'section-line' && sectionLineDrawingState.isDrawing) {
                const sectionPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                updateSectionLinePreview(sectionPoint);
                return;
            }

            if (tool === 'dimension') {
                const dimensionPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                const handled = handleDimensionPlacementMouseMove(dimensionPoint);
                if (handled) {
                    return;
                }
            }

            if (tool === 'offset') {
                offsetTool.handleMouseMove(rawPoint);
                return;
            }

            if (tool === 'trim') {
                trimTool.handleMouseMove(rawPoint);
                return;
            }

            if (tool === 'extend') {
                extendTool.handleMouseMove(rawPoint);
                return;
            }

            if (tool === 'select') {
                const hitTarget = ((e.target as fabric.Object | null | undefined) ??
                    canvas.findTarget(e.e as unknown as fabric.TPointerEvent) ??
                    null);
                const subTargets = (e as fabric.TPointerEventInfo<fabric.TPointerEvent> & { subTargets?: fabric.Object[] })
                    .subTargets ?? [];
                const candidateTargets = [...subTargets, ...(hitTarget ? [hitTarget] : [])];
                const selectPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                const prioritizedWallOrRoomTarget =
                    candidateTargets.find((target) => {
                        const meta = getTargetMeta(target as fabric.Object | null | undefined);
                        return Boolean(meta.isWallControl || meta.isRoomControl);
                    }) ?? null;
                const hoveredObjectId =
                    candidateTargets
                        .map((target) => resolveObjectIdFromTarget(target))
                        .find((entry): entry is string => Boolean(entry)) ??
                    resolveObjectIdFromTarget(hitTarget);
                const inferredOpening = findOpeningAtPoint(selectPoint);
                const openingHoverId = hoveredObjectId ?? inferredOpening?.openingId ?? null;
                if (openingHoverId) {
                    wallRenderer?.setHoveredWall(null);
                    setHoveredElement(openingHoverId);
                    return;
                }
                const hoveredSectionLineId =
                    candidateTargets
                        .map((target) => resolveSectionLineIdFromTarget(target))
                        .find((entry): entry is string => Boolean(entry)) ??
                    resolveSectionLineIdFromTarget(hitTarget);
                if (hoveredSectionLineId) {
                    wallRenderer?.setHoveredWall(null);
                    setHoveredElement(hoveredSectionLineId);
                    return;
                }
                if (isDimensionSelectDragActive()) {
                    const dimensionHandled = handleDimensionSelectMouseMove(
                        selectPoint,
                        hitTarget
                    );
                    if (dimensionHandled) {
                        return;
                    }
                }
                if (prioritizedWallOrRoomTarget) {
                    const prioritizedMeta = getTargetMeta(
                        prioritizedWallOrRoomTarget as fabric.Object | null | undefined
                    );
                    wallRenderer?.setHoveredWall(prioritizedMeta.wallId ?? null);
                    handleSelectMouseMove(selectPoint, prioritizedWallOrRoomTarget);
                    return;
                }

                const hoveredWallId = wallRenderer?.getWallIdAtPoint(selectPoint) ?? null;
                wallRenderer?.setHoveredWall(hoveredWallId);
                if (hoveredWallId) {
                    setHoveredElement(hoveredWallId);
                    return;
                }

                const dimensionHandled = handleDimensionSelectMouseMove(
                    selectPoint,
                    hitTarget
                );
                if (dimensionHandled) {
                    return;
                }
                const handled = handleSelectMouseMove(selectPoint, hitTarget);
                if (handled) {
                    return;
                }
                const hoveredRoomId =
                    roomRendererRef.current?.getRoomIdAtPoint(selectPoint) ??
                    resolveRoomIdFromTarget(hitTarget);
                if (hoveredRoomId) {
                    wallRenderer?.setHoveredWall(null);
                    setHoveredElement(hoveredRoomId);
                    return;
                }
            }

            if (!currentState.isDrawing) return;
            const nextPoints = [...currentState.drawingPoints, point];
            const nextState: CanvasState = { ...currentState, drawingPoints: nextPoints };
            canvasStateRef.current = nextState;
            setCanvasState(nextState);
            renderDrawingPreview(canvas, nextPoints, tool);
        },
        [
            tool,
            resolvedSnapToGrid,
            effectiveSnapGridSize,
            setPanOffset,
            queueMousePositionUpdate,
            middlePanRef,
            pendingPlacementDefinition,
            computePlacement,
            isWallDrawing,
            isRoomDrawing,
            roomStartCorner,
            handleWallMouseMove,
            handleRoomMouseMove,
            handleDimensionPlacementMouseMove,
            handleDimensionSelectMouseMove,
            isDimensionSelectDragActive,
            handleSelectMouseMove,
            sectionLineDrawingState.isDrawing,
            updateSectionLinePreview,
            getTargetMeta,
            resolveObjectIdFromTarget,
            resolveRoomIdFromTarget,
            resolveSectionLineIdFromTarget,
            findOpeningAtPoint,
            walls,
            viewportZoom,
            wallRenderer,
            offsetTool,
            trimTool,
            extendTool,
            scheduleDimensionLayerRefresh,
            wallSettings.gridSize,
            wallSettings.defaultThickness,
            setHoveredElement,
            setMarqueeSelectionMode,
            updateOpeningPointerInteraction,
        ]
    );

    const handleMouseUp = useCallback(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        // ── Safety cleanup for drag optimisation state ──
        if (isDraggingObjectRef.current) {
            isDraggingObjectRef.current = false;
            canvas.skipTargetFind = false;
        }

        const currentState = canvasStateRef.current;

        if (currentState.isPanning) {
            const nextState: CanvasState = { ...currentState, isPanning: false, lastPanPoint: null };
            canvasStateRef.current = nextState;
            setCanvasState(nextState);
            return;
        }

        if (tool === 'select') {
            const handledOpeningInteraction = finishOpeningPointerInteraction();
            if (handledOpeningInteraction) {
                return;
            }
        }

        if (tool === 'select' && marqueeSelectionRef.current.active) {
            const currentSelection = marqueeSelectionRef.current;
            const rect = getSelectionRect(currentSelection);
            const hasMarqueeDrag = Boolean(
                rect &&
                rect.maxX - rect.minX > 2 &&
                rect.maxY - rect.minY > 2
            );
            lastMarqueeSelectionRef.current = {
                ...currentSelection,
                active: false,
                start: currentSelection.start ? { ...currentSelection.start } : null,
                current: currentSelection.current ? { ...currentSelection.current } : null,
            };
            marqueeSelectionRef.current = { active: false, start: null, current: null, mode: 'window' };
            applyMarqueeFilterRef.current = hasMarqueeDrag;
        } else if (tool === 'select') {
            applyMarqueeFilterRef.current = false;
        }

        if (tool === 'select') {
            const dimensionHandled = handleDimensionSelectMouseUp();
            if (dimensionHandled) {
                return;
            }
            const handled = handleSelectMouseUp();
            if (handled) {
                return;
            }
        }

        if (currentState.isDrawing && currentState.drawingPoints.length > 1) {
            if (tool === 'pencil' || tool === 'spline') {
                addSketch({ points: currentState.drawingPoints, type: tool === 'spline' ? 'spline' : 'freehand' });
            }
        }

        const nextState: CanvasState = { ...currentState, isDrawing: false, drawingPoints: [] };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
    }, [
        tool,
        addSketch,
        handleDimensionSelectMouseUp,
        handleSelectMouseUp,
        getSelectionRect,
        finishOpeningPointerInteraction,
    ]);

    // ── Wheel zoom handler ─────────────────────────────────────────────
    const handleWheel = useCallback(
        (e: fabric.TPointerEventInfo<WheelEvent>) => {
            e.e.preventDefault();
            const canvas = fabricRef.current;
            if (!canvas) return;

            // Read zoom from ref so rapid wheel ticks compound correctly
            // without waiting for React re-renders.
            const currentVpZoom = zoomRef.current;
            const currentZoom = currentVpZoom / safePaperPerRealRatio;

            // Exponential zoom factor from wheel delta.
            const zoomFactor = Math.exp(-e.e.deltaY * WHEEL_ZOOM_SENSITIVITY);
            const newZoom = Math.min(Math.max(currentZoom * zoomFactor, MIN_ZOOM), MAX_ZOOM);
            if (Math.abs(newZoom - currentZoom) < 0.0001) return;
            const newVpZoom = newZoom * safePaperPerRealRatio;

            // Compute cursor position in viewport-pixel space.
            const canvasEl = canvas.upperCanvasEl ?? canvas.lowerCanvasEl;
            const rect = canvasEl.getBoundingClientRect();
            const vpX = e.e.clientX - rect.left;
            const vpY = e.e.clientY - rect.top;

            // Scene-space point under cursor (from refs, not canvas — avoids lag).
            const curPan = panOffsetRef.current;
            const sceneX = curPan.x + vpX / currentVpZoom;
            const sceneY = curPan.y + vpY / currentVpZoom;

            // New pan so that scenePoint stays pinned under cursor.
            const nextPan: Point2D = {
                x: sceneX - vpX / newVpZoom,
                y: sceneY - vpY / newVpZoom,
            };

            // Apply immediately to Fabric canvas for instant visual feedback.
            const vt: fabric.TMat2D = [
                newVpZoom, 0, 0, newVpZoom,
                -nextPan.x * newVpZoom,
                -nextPan.y * newVpZoom,
            ];
            canvas.setViewportTransform(vt);
            roomRendererRef.current?.setViewportZoom(newVpZoom);
            wallRenderer?.setViewportZoom(newVpZoom);
            dimensionRendererRef.current?.setViewportZoom(newVpZoom);
            canvas.requestRenderAll();

            // Update refs for next tick.
            zoomRef.current = newVpZoom;
            panOffsetRef.current = nextPan;

            // Batch store update via rAF — coalesces multiple wheel events
            // within the same frame into one React update, so overlays
            // (PageLayout, Grid, Rulers) stay in sync every frame.
            wheelPendingZoom.current = newZoom;
            wheelPendingPan.current = nextPan;
            if (!wheelRafId.current) {
                wheelRafId.current = requestAnimationFrame(() => {
                    wheelRafId.current = null;
                    setViewTransform(
                        wheelPendingZoom.current,
                        wheelPendingPan.current
                    );
                });
            }
        },
        [safePaperPerRealRatio, setViewTransform, wallRenderer]
    );

    // ---------------------------------------------------------------------------
    // Event Binding
    // ---------------------------------------------------------------------------

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
                    .map((wallId) => wallById.get(wallId)?.thickness)
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
                const perimeterWallIds = perimeterWallIdsForRooms([clickedRoomId]);
                const roomSelectionIds = [clickedRoomId, ...perimeterWallIds];
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

            const objectId = targetObjectId;
            if (objectId) {
                event.preventDefault();
                event.stopPropagation();
                setSelectedIds([objectId]);
                closeWallContextMenu();
                closeDimensionContextMenu();
                closeSectionLineContextMenu();

                const outerRect = outerRef.current?.getBoundingClientRect();
                const x = outerRect ? event.clientX - outerRect.left : event.clientX;
                const y = outerRect ? event.clientY - outerRect.top : event.clientY;
                setObjectContextMenu({ objectId, x, y });
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

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <div ref={outerRef} className={`relative w-full h-full overflow-hidden ${className}`}>
            <div
                ref={hostRef}
                className="absolute"
                style={{ top: originOffset.y, left: originOffset.x, width: hostWidth, height: hostHeight, overflow: 'hidden' }}
            >
                <PageLayout pageWidth={pageConfig.width} pageHeight={pageConfig.height} zoom={zoom} panOffset={overlayPanOffset} />
                <Grid
                    pageWidth={pageConfig.width}
                    pageHeight={pageConfig.height}
                    zoom={zoom}
                    panOffset={overlayPanOffset}
                    gridSize={resolvedGridSize}
                    showGrid={resolvedShowGrid}
                    viewportWidth={hostWidth}
                    viewportHeight={hostHeight}
                    gridMode={gridMode}
                    paperUnit={paperUnit}
                    realWorldUnit={resolvedRealWorldUnit}
                    scaleDrawing={safeScaleDrawing}
                    scaleReal={safeScaleReal}
                    majorGridSize={majorGridSize}
                    gridSubdivisions={safeGridSubdivisions}
                />
                <canvas ref={canvasRef} className="relative z-[2] block" />
                {/* [SNAP WIRE] Overlay canvas for snap indicators — sits on top, pointer-events: none */}
                <canvas
                    ref={snapOverlayRef}
                    className="absolute left-0 top-0 z-[10] block"
                    style={{ pointerEvents: 'none' }}
                />
            </div>

            {wallContextMenu && (
                <div
                    className="absolute z-[30] min-w-[190px] rounded-md border border-slate-200 bg-white shadow-lg py-1"
                    style={{ left: wallContextMenu.x, top: wallContextMenu.y }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={handleEditWallProperties}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        Edit Properties
                    </button>
                    <button
                        type="button"
                        onClick={handleDeleteWallFromContext}
                        className="w-full px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                    >
                        Delete
                    </button>
                    <button
                        type="button"
                        onClick={handleConvertWallToDoorOpening}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        Convert to Door Opening
                    </button>
                </div>
            )}

            {dimensionContextMenu && (
                <div
                    className="absolute z-[30] min-w-[190px] rounded-md border border-slate-200 bg-white shadow-lg py-1"
                    style={{ left: dimensionContextMenu.x, top: dimensionContextMenu.y }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={handleEditDimensionProperties}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        Properties
                    </button>
                    <button
                        type="button"
                        onClick={handleDeleteDimensionFromContext}
                        className="w-full px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                    >
                        Delete
                    </button>
                    <button
                        type="button"
                        onClick={handleToggleDimensionVisibility}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        Toggle Display
                    </button>
                </div>
            )}

            {sectionLineContextMenu && (
                <div
                    className="absolute z-[30] min-w-[210px] rounded-md border border-slate-200 bg-white shadow-lg py-1"
                    style={{ left: sectionLineContextMenu.x, top: sectionLineContextMenu.y }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={handleGenerateElevationFromSection}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        Generate Elevation
                    </button>
                    <button
                        type="button"
                        onClick={handleFlipSectionLineDirection}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        Flip View Direction
                    </button>
                    <button
                        type="button"
                        onClick={handleToggleSectionLineLock}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        Toggle Lock
                    </button>
                    <button
                        type="button"
                        onClick={handleDeleteSectionLineFromContext}
                        className="w-full px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                    >
                        Delete
                    </button>
                </div>
            )}

            {objectContextMenu && (
                <div
                    className="absolute z-[30] min-w-[190px] rounded-md border border-slate-200 bg-white shadow-lg py-1"
                    style={{ left: objectContextMenu.x, top: objectContextMenu.y }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={handleEditObjectProperties}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                        Edit Properties
                    </button>
                    {isContextDoorObject && (
                        <button
                            type="button"
                            onClick={handleFlipDoorSwing}
                            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                        >
                            Flip Swing
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleDeleteObjectFromContext}
                        className="w-full px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50"
                    >
                        Delete
                    </button>
                </div>
            )}

            {pendingPlacementDefinition && !placementValid && (
                <div className="absolute left-4 top-4 z-[25] rounded border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700">
                    {pendingPlacementDefinition.category === 'doors' || pendingPlacementDefinition.category === 'windows'
                        ? 'Placement blocked: opening does not fit or overlaps an existing opening.'
                        : 'Placement blocked: furniture overlap detected.'}
                </div>
            )}

            <Rulers
                pageWidth={pageConfig.width}
                pageHeight={pageConfig.height}
                zoom={zoom}
                panOffset={overlayPanOffset}
                viewportWidth={hostWidth}
                viewportHeight={hostHeight}
                showRulers={resolvedShowRulers}
                rulerSize={rulerSize}
                originOffset={originOffset}
                gridSize={resolvedGridSize}
                displayUnit={resolvedRealWorldUnit}
                mousePosition={rulerMousePosition}
                rulerMode={rulerMode}
                paperUnit={paperUnit}
                realWorldUnit={resolvedRealWorldUnit}
                scaleDrawing={safeScaleDrawing}
                scaleReal={safeScaleReal}
                majorTickInterval={majorTickInterval}
                tickSubdivisions={tickSubdivisions}
                showRulerLabels={showRulerLabels}
            />
        </div>
    );
}

export default DrawingCanvas;
