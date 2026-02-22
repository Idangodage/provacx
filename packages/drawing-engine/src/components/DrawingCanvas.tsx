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
import { generateId } from '../utils/geometry';

import {
    Grid,
    PageLayout,
    Rulers,
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
    RoomRenderer,
    DimensionRenderer,
    ObjectRenderer,
    SectionLineRenderer,
    HvacPlanRenderer,
} from './canvas';
import { RoomConfigPopup } from './canvas/wall';

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

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

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
    const [canvasState, setCanvasState] = useState<CanvasState>({
        isPanning: false,
        lastPanPoint: null,
        isDrawing: false,
        drawingPoints: [],
    });

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
        updateWallBevel,
        resetWallBevel,
        getCornerBevelDots,
        deleteWall,
        getWall,
        // Wall state and actions
        walls,
        rooms,
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
        regenerateElevations,
        connectWalls,
        createRoomWalls,
        moveRoom,
        hvacElements,
    } = useSmartDrawingStore();

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

    const findWallPlacementSnap = useCallback((point: Point2D) => {
        let best: {
            wall: Wall;
            point: Point2D;
            t: number;
            distance: number;
            angleDeg: number;
            normal: Point2D;
        } | null = null;

        for (const wall of walls) {
            const projection = projectPointToSegment(point, wall.startPoint, wall.endPoint);
            if (projection.distance > 100) continue;
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
                };
            }
        }
        return best;
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
        (point: Point2D, definition: ArchitecturalObjectDefinition) => {
            let placementPoint = { ...point };
            let rotationDeg = placementRotationDeg;
            let snappedWall: ReturnType<typeof findWallPlacementSnap> | null = null;
            let alignmentPoint: Point2D | null = null;

            if (definition.category === 'doors' || definition.category === 'windows') {
                snappedWall = findWallPlacementSnap(point);
                if (snappedWall) {
                    placementPoint = { ...snappedWall.point };
                    rotationDeg = snappedWall.angleDeg;
                }
            } else if (definition.category === 'furniture' || definition.category === 'fixtures') {
                const nearestRoom = rooms.reduce(
                    (best, room) => {
                        const distance = Math.hypot(room.centroid.x - point.x, room.centroid.y - point.y);
                        if (distance > 300) return best;
                        if (!best || distance < best.distance) {
                            return { room, distance };
                        }
                        return best;
                    },
                    null as { room: (typeof rooms)[number]; distance: number } | null
                );
                if (nearestRoom) {
                    placementPoint = { ...nearestRoom.room.centroid };
                } else {
                    const wallSnap = findWallPlacementSnap(point);
                    if (wallSnap) {
                        const dot = (point.x - wallSnap.point.x) * wallSnap.normal.x + (point.y - wallSnap.point.y) * wallSnap.normal.y;
                        const side = dot >= 0 ? 1 : -1;
                        placementPoint = {
                            x: wallSnap.point.x + wallSnap.normal.x * 50 * side,
                            y: wallSnap.point.y + wallSnap.normal.y * 50 * side,
                        };
                    }
                }

                const alignmentSnap = symbols.reduce(
                    (best, instance) => {
                        const instanceDefinition = objectDefinitionsById.get(instance.symbolId);
                        if (!instanceDefinition) return best;
                        if (instanceDefinition.category !== 'furniture' && instanceDefinition.category !== 'fixtures') {
                            return best;
                        }
                        const dx = Math.abs(instance.position.x - placementPoint.x);
                        const dy = Math.abs(instance.position.y - placementPoint.y);
                        if (dx <= 40 || dy <= 40) {
                            return {
                                x: dx <= dy ? instance.position.x : placementPoint.x,
                                y: dy < dx ? instance.position.y : placementPoint.y,
                            };
                        }
                        return best;
                    },
                    null as Point2D | null
                );
                if (alignmentSnap) {
                    placementPoint = alignmentSnap;
                    alignmentPoint = alignmentSnap;
                }
            }

            if (resolvedSnapToGrid && !snappedWall) {
                const gridStep = Math.max(1, wallSettings.gridSize);
                placementPoint = {
                    x: Math.round(placementPoint.x / gridStep) * gridStep,
                    y: Math.round(placementPoint.y / gridStep) * gridStep,
                };
            }

            const collision = hasFurnitureCollision(placementPoint, definition);
            const valid = !collision;

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

    const placePendingObject = useCallback((point: Point2D): boolean => {
        if (!pendingPlacementDefinition) return false;
        const placement = computePlacement(point, pendingPlacementDefinition);
        setPlacementValid(placement.valid);
        if (!placement.valid) {
            setProcessingStatus('Placement blocked: furniture overlap detected.', false);
            return true;
        }

        const symbolPayload: Omit<SymbolInstance2D, 'id'> = {
            symbolId: pendingPlacementDefinition.id,
            position: placement.point,
            rotation: placement.rotationDeg,
            scale: 1,
            flipped: false,
            properties: {
                definitionId: pendingPlacementDefinition.id,
                category: pendingPlacementDefinition.category,
                type: pendingPlacementDefinition.type,
                widthMm: pendingPlacementDefinition.widthMm,
                depthMm: pendingPlacementDefinition.depthMm,
                heightMm: pendingPlacementDefinition.heightMm,
                material: pendingPlacementDefinition.material,
                swingDirection: 'left',
                placedAt: new Date().toISOString(),
            },
        };
        const symbolId = addSymbol(symbolPayload);
        const placedInstance: SymbolInstance2D = { ...symbolPayload, id: symbolId };
        setSelectedIds([symbolId]);

        if (
            placement.snappedWall &&
            (pendingPlacementDefinition.category === 'doors' || pendingPlacementDefinition.category === 'windows')
        ) {
            const wall = placement.snappedWall.wall;
            const wallLength = Math.hypot(
                wall.endPoint.x - wall.startPoint.x,
                wall.endPoint.y - wall.startPoint.y
            ) || 1;
            const openingWidth = (pendingPlacementDefinition.openingWidthMm ?? pendingPlacementDefinition.widthMm) + 50;
            const halfOpening = openingWidth / 2;
            const openingPosition = Math.min(
                Math.max(halfOpening, wallLength * placement.snappedWall.t),
                wallLength - halfOpening
            );
            updateWall(
                wall.id,
                {
                    openings: [
                        ...wall.openings,
                        {
                            id: generateId(),
                            type: pendingPlacementDefinition.category === 'doors' ? 'door' : 'window',
                            position: openingPosition,
                            width: openingWidth,
                            height: pendingPlacementDefinition.heightMm,
                            sillHeight: pendingPlacementDefinition.category === 'windows'
                                ? pendingPlacementDefinition.sillHeightMm ?? 900
                                : 0,
                        },
                    ],
                },
                { skipHistory: true, source: 'ui' }
            );
        }

        onObjectPlaced?.(pendingPlacementDefinition.id, placedInstance);
        setProcessingStatus(`Placed ${pendingPlacementDefinition.name}.`, false);
        return true;
    }, [
        pendingPlacementDefinition,
        computePlacement,
        addSymbol,
        setSelectedIds,
        updateWall,
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
                name?: string;
                group?: fabric.Group & { id?: string; objectId?: string; name?: string };
            };

            if (typedTarget.objectId) return typedTarget.objectId;
            if (typedTarget.id && typedTarget.name?.startsWith('object-')) return typedTarget.id;

            const parent = typedTarget.group;
            if (parent?.objectId) return parent.objectId;
            if (parent?.id && parent?.name?.startsWith('object-')) return parent.id;

            return null;
        },
        []
    );

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
        updateWallBevel,
        resetWallBevel,
        getCornerBevelDots,
        moveRoom,
        connectWalls,
        detectRooms,
        saveToHistory,
        setProcessingStatus,
        originOffset,
    });
    const {
        isWallHandleDraggingRef,
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
        wallDrawingState,
        wallSettings,
        zoom: viewportZoom,
        pageHeight: pageConfig.height,
        startWallDrawing,
        updateWallPreview,
        commitWall,
        cancelWallDrawing,
        connectWalls,
    });

    // Room tool hook
    const roomTool = useRoomTool({
        gridSize: wallSettings.gridSize,
        createRoomWalls,
    });
    const { handleMouseDown: handleRoomMouseDown } = roomTool;

    const {
        handlePlacementMouseDown: handleDimensionPlacementMouseDown,
        handlePlacementMouseMove: handleDimensionPlacementMouseMove,
        handleSelectMouseDown: handleDimensionSelectMouseDown,
        handleSelectMouseMove: handleDimensionSelectMouseMove,
        handleSelectMouseUp: handleDimensionSelectMouseUp,
        handleDoubleClick: handleDimensionDoubleClick,
        handleKeyDown: handleDimensionKeyDown,
        cancelPlacement: cancelDimensionPlacement,
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

    // Keyboard handling
    useCanvasKeyboard({
        tool,
        selectedIds,
        deleteSelected,
        setIsSpacePressed,
        setTool,
        onCopy: copySelectedWalls,
        onPaste: pasteWalls,
    });

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
        setViewportSize({ width: outer.clientWidth, height: outer.clientHeight });

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (entry.target === host) {
                    canvas.setDimensions({ width, height });
                    canvas.renderAll();
                }
                if (entry.target === outer) {
                    setViewportSize({ width, height });
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
    }, [onCanvasReady]);

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
        canvas.requestRenderAll();
        zoomRef.current = viewportZoom;
        panOffsetRef.current = panOffset;
    }, [viewportZoom, panOffset]);

    useEffect(() => {
        wallRenderer?.setHoveredWall(hoveredElementId ?? null);
    }, [wallRenderer, hoveredElementId]);

    useEffect(() => {
        if (tool !== 'dimension') {
            cancelDimensionPlacement();
        }
    }, [tool, cancelDimensionPlacement]);

    useEffect(() => {
        roomRendererRef.current?.renderAllRooms(rooms);
    }, [rooms]);

    useEffect(() => {
        roomRendererRef.current?.setShowTemperatureIcons(wallSettings.showRoomTemperatureIcons);
        roomRendererRef.current?.setShowVentilationBadges(wallSettings.showRoomVentilationBadges);
    }, [wallSettings.showRoomTemperatureIcons, wallSettings.showRoomVentilationBadges]);

    useEffect(() => {
        if (!dimensionRendererRef.current) return;
        dimensionRendererRef.current.setContext(walls, rooms, dimensionSettings);
        dimensionRendererRef.current.renderAllDimensions(dimensions);
    }, [walls, rooms, dimensions, dimensionSettings]);

    useEffect(() => {
        const roomIdSet = new Set(rooms.map((room) => room.id));
        const selectedRoomIds = selectedIds.filter((id) => roomIdSet.has(id));
        roomRendererRef.current?.setSelectedRooms(selectedRoomIds);
    }, [rooms, selectedIds]);

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
    }, [objectDefinitions]);

    useEffect(() => {
        objectRendererRef.current?.renderAll(symbols);
    }, [symbols, objectDefinitions]);

    useEffect(() => {
        const symbolIdSet = new Set(symbols.map((symbol) => symbol.id));
        const selectedSymbolIds = selectedIds.filter((id) => symbolIdSet.has(id));
        objectRendererRef.current?.setSelectedObjects(selectedSymbolIds);
    }, [symbols, selectedIds]);

    useEffect(() => {
        const symbolIdSet = new Set(symbols.map((symbol) => symbol.id));
        const hoveredSymbolId = hoveredElementId && symbolIdSet.has(hoveredElementId)
            ? hoveredElementId
            : null;
        objectRendererRef.current?.setHoveredObject(hoveredSymbolId);
    }, [symbols, hoveredElementId]);

    useEffect(() => {
        if (!sectionLineRendererRef.current) return;
        sectionLineRendererRef.current.setShowReferenceIndicators(wallSettings.showSectionReferenceLines);
        sectionLineRendererRef.current.renderAll(sectionLines);
    }, [sectionLines, wallSettings.showSectionReferenceLines]);

    // Render HVAC elements on plan canvas
    useEffect(() => {
        if (!hvacRendererRef.current) return;
        hvacRendererRef.current.renderAll(hvacElements);
    }, [hvacElements]);

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
    }, [pendingPlacementDefinition?.id]);

    useEffect(() => {
        if (!pendingPlacementDefinition || !placementCursorRef.current) return;
        const placement = computePlacement(placementCursorRef.current, pendingPlacementDefinition);
        setPlacementValid(placement.valid);
        objectRendererRef.current?.renderPlacementPreview(
            pendingPlacementDefinition,
            placement.point,
            placement.rotationDeg,
            placement.valid
        );
    }, [pendingPlacementDefinition, placementRotationDeg, computePlacement]);

    useEffect(() => { canvasStateRef.current = canvasState; }, [canvasState]);

    // ---------------------------------------------------------------------------
    // Tool Change Handler
    // ---------------------------------------------------------------------------

    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const effectiveTool = isSpacePressed ? 'pan' : tool;
        const allowSelection = effectiveTool === 'select';
        const pointerCursor = canvasState.isPanning ? 'grabbing' : getToolCursor(effectiveTool);

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
            obj.selectable = allowSelection;
            obj.evented = allowSelection;
        });
        canvas.renderAll();
    }, [tool, isSpacePressed, canvasState.isPanning]);

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
                if (!e.target) {
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
                    applyMarqueeFilterRef.current = false;
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

            // Handle room tool - convert from pixels to mm
            if (tool === 'room') {
                const roomPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                handleRoomMouseDown(roomPoint);
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
            handleRoomMouseDown,
            handleDimensionPlacementMouseDown,
            setMarqueeSelectionMode,
            sectionLineDrawingState.isDrawing,
            startSectionLineDrawing,
            updateSectionLinePreview,
            commitSectionLine,
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
                    placement.valid
                );
                return;
            }

            // Handle wall tool movement - convert from pixels to mm
            if (tool === 'wall' && isWallDrawing) {
                const wallPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
                handleWallMouseMove(wallPoint);
                return;
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

            if (tool === 'select') {
                const hitTarget = ((e.target as fabric.Object | null | undefined) ??
                    canvas.findTarget(e.e as unknown as fabric.TPointerEvent) ??
                    null);
                const hoveredObjectId = resolveObjectIdFromTarget(
                    hitTarget
                );
                if (hoveredObjectId) {
                    setHoveredElement(hoveredObjectId);
                    return;
                }
                const hoveredSectionLineId = resolveSectionLineIdFromTarget(
                    hitTarget
                );
                if (hoveredSectionLineId) {
                    setHoveredElement(hoveredSectionLineId);
                    return;
                }
                const selectPoint = {
                    x: rawPoint.x / MM_TO_PX,
                    y: rawPoint.y / MM_TO_PX,
                };
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
            handleWallMouseMove,
            handleDimensionPlacementMouseMove,
            handleDimensionSelectMouseMove,
            handleSelectMouseMove,
            sectionLineDrawingState.isDrawing,
            updateSectionLinePreview,
            resolveObjectIdFromTarget,
            resolveSectionLineIdFromTarget,
            setHoveredElement,
            setMarqueeSelectionMode,
        ]
    );

    const handleMouseUp = useCallback(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const currentState = canvasStateRef.current;

        if (currentState.isPanning) {
            const nextState: CanvasState = { ...currentState, isPanning: false, lastPanPoint: null };
            canvasStateRef.current = nextState;
            setCanvasState(nextState);
            return;
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
    }, [tool, addSketch, handleDimensionSelectMouseUp, handleSelectMouseUp, getSelectionRect]);

    const handleWheel = useCallback(
        (e: fabric.TPointerEventInfo<WheelEvent>) => {
            e.e.preventDefault();
            const canvas = fabricRef.current;
            if (!canvas) return;

            const pointer = canvas.getViewportPoint(e.e);
            const scenePoint = canvas.getScenePoint(e.e);
            const currentZoom = zoom;
            const zoomFactor = Math.exp(-e.e.deltaY * WHEEL_ZOOM_SENSITIVITY);
            const newZoom = Math.min(Math.max(currentZoom * zoomFactor, MIN_ZOOM), MAX_ZOOM);
            if (Math.abs(newZoom - currentZoom) < 0.0001) return;
            const newViewportZoom = newZoom * safePaperPerRealRatio;

            const nextPan = {
                x: scenePoint.x - pointer.x / newViewportZoom,
                y: scenePoint.y - pointer.y / newViewportZoom,
            };
            zoomRef.current = newViewportZoom;
            panOffsetRef.current = nextPan;
            setViewTransform(newZoom, nextPan);
        },
        [zoom, safePaperPerRealRatio, setViewTransform]
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
        };
        const handleWallKeyUp = (e: KeyboardEvent) => {
            if (tool === 'wall') {
                handleWallToolKeyUp(e);
            }
        };

        const handleSelectionCreated = (event: fabric.CanvasEvents['selection:created']) => {
            if (tool !== 'select') return;
            const targets = filterMarqueeSelectionTargets(event.selected ?? []);
            applyMarqueeFilterRef.current = false;
            const objectIds = targets
                .map((target) => resolveObjectIdFromTarget(target))
                .filter((id): id is string => Boolean(id));
            if (objectIds.length > 0) {
                setSelectedIds(Array.from(new Set(objectIds)));
                return;
            }
            updateSelectionFromTargets(targets);
        };

        const handleSelectionUpdated = (event: fabric.CanvasEvents['selection:updated']) => {
            if (tool !== 'select') return;
            const targets = filterMarqueeSelectionTargets(event.selected ?? []);
            applyMarqueeFilterRef.current = false;
            const objectIds = targets
                .map((target) => resolveObjectIdFromTarget(target))
                .filter((id): id is string => Boolean(id));
            if (objectIds.length > 0) {
                setSelectedIds(Array.from(new Set(objectIds)));
                return;
            }
            updateSelectionFromTargets(targets);
        };

        const handleSelectionCleared = () => {
            applyMarqueeFilterRef.current = false;
            if (!isWallHandleDraggingRef.current) {
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
            const hitTarget = ((event.target as fabric.Object | null | undefined) ??
                (event.e ? canvas.findTarget(event.e as unknown as fabric.TPointerEvent) : null) ??
                null);
            const addToSelection = Boolean(event.e?.shiftKey);
            const sectionLineId = resolveSectionLineIdFromTarget(hitTarget);
            if (sectionLineId) {
                if (addToSelection) {
                    const current = new Set(selectedIds);
                    if (current.has(sectionLineId)) {
                        current.delete(sectionLineId);
                    } else {
                        current.add(sectionLineId);
                    }
                    setSelectedIds(Array.from(current));
                } else {
                    setSelectedIds([sectionLineId]);
                }
                setHoveredElement(sectionLineId);
                return;
            }

            const objectId = resolveObjectIdFromTarget(hitTarget);
            if (objectId) {
                if (addToSelection) {
                    const current = new Set(selectedIds);
                    if (current.has(objectId)) {
                        current.delete(objectId);
                    } else {
                        current.add(objectId);
                    }
                    setSelectedIds(Array.from(current));
                } else {
                    setSelectedIds([objectId]);
                }
                setHoveredElement(objectId);
                return;
            }

            const scenePoint = event.e ? canvas.getScenePoint(event.e) : null;
            if (!scenePoint) {
                updateSelectionFromTarget(hitTarget);
                return;
            }
            const wallPoint = {
                x: scenePoint.x / MM_TO_PX,
                y: scenePoint.y / MM_TO_PX,
            };
            const dimensionHandled = handleDimensionSelectMouseDown(
                hitTarget,
                wallPoint,
                addToSelection
            );
            if (dimensionHandled) {
                return;
            }
            handleSelectMouseDown(hitTarget, wallPoint, addToSelection);
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

            const sectionLineId = resolveSectionLineIdFromTarget(target ?? null);
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

            const objectId = resolveObjectIdFromTarget(target ?? null);
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
                if (resolvedSnapToGrid) {
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

                const instance = symbols.find((entry) => entry.id === objectId);
                const definition = instance
                    ? objectDefinitionsById.get(instance.symbolId)
                    : undefined;
                if (instance && definition) {
                    const collides = hasFurnitureCollision(movedPositionMm, definition, {
                        ignoreSymbolId: objectId,
                    });
                    if (collides) {
                        target.set({
                            left: instance.position.x * MM_TO_PX,
                            top: instance.position.y * MM_TO_PX,
                        });
                        setProcessingStatus('Movement blocked: furniture overlap detected.', false);
                    }
                }
                return;
            }

            handleSelectObjectMoving(event.target);
        };

        const handleObjectModified = (event: fabric.CanvasEvents['object:modified']) => {
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
            if (nativeEvent?.ctrlKey) {
                const angle = event.target.angle ?? 0;
                event.target.set('angle', Math.round(angle / 15) * 15);
            }
        };

        const handleWindowBlur = () => {
            stopMiddlePan();
            finalizeHandleDrag();
        };

        const handleSelectDragMouseMove = (event: MouseEvent) => {
            if (tool !== 'select') return;
            if (!isWallHandleDraggingRef.current) return;
            const scenePoint = canvas.getScenePoint(event as unknown as fabric.TPointerEvent);
            const selectPoint = {
                x: scenePoint.x / MM_TO_PX,
                y: scenePoint.y / MM_TO_PX,
            };
            handleSelectMouseMove(selectPoint, null);
        };

        const handleCanvasMouseLeave = () => {
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
        filterMarqueeSelectionTargets,
        handleWallDoubleClick,
        handleWallToolKeyDown,
        handleWallToolKeyUp,
        handleDimensionDoubleClick,
        handleDimensionKeyDown,
        handleDimensionSelectMouseDown,
        symbols,
        objectDefinitionsById,
        hasFurnitureCollision,
        resolvedSnapToGrid,
        effectiveSnapGridSize,
        updateSymbol,
        setProcessingStatus,
        pendingPlacementDefinition,
        onCancelObjectPlacement,
        placePendingObject,
        nudgeSelectedObjects,
        cancelSectionLineDrawing,
        commitSectionLine,
        sectionLineDrawingState.isDrawing,
        sectionLineDrawingState.direction,
        setSectionLineDirection,
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
            </div>

            {/* Room Configuration Popup */}
            {roomTool.showConfigPopup && roomTool.startCorner && (
                <RoomConfigPopup
                    config={roomTool.roomConfig}
                    onChange={roomTool.setRoomConfig}
                    onConfirm={roomTool.confirmRoomCreation}
                    onCancel={roomTool.cancelRoomCreation}
                    position={{
                        x: roomTool.startCorner.x * MM_TO_PX * viewportZoom - panOffset.x * viewportZoom + originOffset.x + 20,
                        y: roomTool.startCorner.y * MM_TO_PX * viewportZoom - panOffset.y * viewportZoom + originOffset.y + 20,
                    }}
                />
            )}

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
                    Placement blocked: furniture overlap detected.
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
