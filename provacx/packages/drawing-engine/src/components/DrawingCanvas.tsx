/**
 * Drawing Canvas Component
 *
 * Main Fabric.js canvas wrapper for HVAC smart drawing.
 * Uses mode-specific hooks following industry best practices.
 */

'use client';

import * as fabric from 'fabric';
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';

import { useSmartDrawingStore } from '../store';
import type { Point2D, Wall2D, Room2D, WallTypeDefinition } from '../types';
import { generateId } from '../utils/geometry';
import { BUILT_IN_WALL_TYPE_IDS, getWallTypeById } from '../utils/wall-types';

import type { SceneBounds, TagBounds, RoomDrawMode } from './canvas';
import {
    Grid,
    PageLayout,
    Rulers,
    snapPointToGrid,
    buildWallSpatialIndex,
    queryWallsInBounds,
    roomIntersectsBounds,
    WALL_SPATIAL_INDEX_CELL_PX,
    WALL_VIEWPORT_MARGIN_PX,
    createWallRenderObjects,
    createWallHandles,
    clearRenderedWalls,
    clearWallHandles,
    clearDrawingPreview,
    bringTransientOverlaysToFront,
    createRoomRenderObjects,
    clearRenderedRooms,
    getRoomHierarchyDepth,
    getToolCursor,
    isDrawingTool,
    renderDrawingPreview,
    // Hooks
    useCanvasKeyboard,
    useSelectMode,
    useWallMode,
    useRoomMode,
    useMiddlePan,
    // UI
    WallTypeSelector,
    RoomModeSelector,
    HoveredRoomTooltip,
} from './canvas';

// =============================================================================
// Types & Constants
// =============================================================================

export interface DrawingCanvasProps {
    className?: string;
    gridSize?: number;
    snapToGrid?: boolean;
    showGrid?: boolean;
    showRulers?: boolean;
    backgroundColor?: string;
    onCanvasReady?: (canvas: fabric.Canvas) => void;
}

interface CanvasState {
    isPanning: boolean;
    lastPanPoint: Point2D | null;
    isDrawing: boolean;
    drawingPoints: Point2D[];
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
    backgroundColor = 'transparent',
    onCanvasReady,
}: DrawingCanvasProps) {
    // Core refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const outerRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);
    const zoomRef = useRef(1);
    const panOffsetRef = useRef<Point2D>({ x: 0, y: 0 });
    const wallsRef = useRef<Wall2D[]>([]);
    const roomsRef = useRef<Room2D[]>([]);
    const canvasStateRef = useRef<CanvasState>({
        isPanning: false,
        lastPanPoint: null,
        isDrawing: false,
        drawingPoints: [],
    });

    // State
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [mousePosition, setMousePosition] = useState<Point2D>({ x: 0, y: 0 });
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [roomDrawMode, setRoomDrawMode] = useState<RoomDrawMode>('rectangle');
    const [hoveredRoomInfo, setHoveredRoomInfo] = useState<{
        id: string;
        name: string;
        area: number;
        perimeter: number;
        screenX: number;
        screenY: number;
    } | null>(null);
    const [canvasState, setCanvasState] = useState<CanvasState>({
        isPanning: false,
        lastPanPoint: null,
        isDrawing: false,
        drawingPoints: [],
    });

    // Store
    const {
        activeTool: tool,
        activeWallTypeId,
        wallTypeRegistry,
        zoom,
        panOffset,
        displayUnit,
        walls,
        rooms,
        selectedElementIds: selectedIds,
        activeLayerId,
        pageConfig,
        gridSize: storeGridSize,
        showGrid: storeShowGrid,
        showRulers: storeShowRulers,
        snapToGrid: storeSnapToGrid,
        setPanOffset,
        setViewTransform,
        setSelectedIds,
        setHoveredElement,
        setActiveWallTypeId,
        setWallTypeRegistry,
        setWalls,
        addSketch,
        deleteSelected,
    } = useSmartDrawingStore();

    // Derived values
    const activeWallType = useMemo(
        () => getWallTypeById(activeWallTypeId, wallTypeRegistry),
        [activeWallTypeId, wallTypeRegistry]
    );
    const resolvedGridSize = gridSize ?? storeGridSize ?? 20;
    const resolvedShowGrid = showGrid ?? storeShowGrid ?? true;
    const resolvedShowRulers = showRulers ?? storeShowRulers ?? true;
    const resolvedSnapToGrid = snapToGrid ?? storeSnapToGrid ?? true;
    const rulerSize = 24;
    const leftRulerWidth = Math.round(rulerSize * 1.2);
    const originOffset = resolvedShowRulers ? { x: leftRulerWidth, y: rulerSize } : { x: 0, y: 0 };
    const hostWidth = Math.max(1, viewportSize.width - originOffset.x);
    const hostHeight = Math.max(1, viewportSize.height - originOffset.y);

    const visibleSceneBounds = useMemo<SceneBounds>(() => {
        const safeZoom = Math.max(zoom, 0.01);
        return {
            left: panOffset.x - WALL_VIEWPORT_MARGIN_PX / safeZoom,
            top: panOffset.y - WALL_VIEWPORT_MARGIN_PX / safeZoom,
            right: panOffset.x + hostWidth / safeZoom + WALL_VIEWPORT_MARGIN_PX / safeZoom,
            bottom: panOffset.y + hostHeight / safeZoom + WALL_VIEWPORT_MARGIN_PX / safeZoom,
        };
    }, [panOffset.x, panOffset.y, zoom, hostWidth, hostHeight]);

    const wallSpatialIndex = useMemo(
        () => buildWallSpatialIndex(walls, WALL_SPATIAL_INDEX_CELL_PX),
        [walls]
    );

    // Helper callback
    const notifyRoomValidation = useCallback(
        (messages: string[], title: string, blocking = false) => {
            if (messages.length === 0) return;
            const formatted = `${title}\n${messages.slice(0, 3).join('\n')}`;
            console.warn(formatted);
            if (typeof window !== 'undefined') {
                window.alert(formatted);
            }
            if (blocking) {
                const canvas = fabricRef.current;
                if (canvas) clearDrawingPreview(canvas, false);
            }
        },
        []
    );

    // Mode hooks
    const selectMode = useSelectMode({
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
    });

    const wallMode = useWallMode({
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
    });

    const roomMode = useRoomMode({
        fabricRef,
        wallsRef,
        roomsRef,
        zoomRef,
        activeLayerId,
        activeWallTypeId,
        wallTypeRegistry,
        setWalls,
        notifyRoomValidation,
    });

    const middlePan = useMiddlePan({
        zoomRef,
        panOffsetRef,
        setPanOffset,
        setCanvasState,
        canvasStateRef,
    });

    // Keyboard handling
    useCanvasKeyboard({
        tool,
        roomDrawMode,
        selectedIds,
        endWallChain: wallMode.endWallChain,
        clearRoomPolygonState: roomMode.clearRoomPolygonState,
        deleteSelected,
        setActiveWallTypeId,
        setIsSpacePressed,
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
            resizeObserver.disconnect();
            canvas.dispose();
            fabricRef.current = null;
        };
    }, [onCanvasReady]);

    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        canvas.set('backgroundColor', backgroundColor);
        canvas.renderAll();
    }, [backgroundColor]);

    // Sync refs with store
    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const viewportTransform: fabric.TMat2D = [zoom, 0, 0, zoom, -panOffset.x * zoom, -panOffset.y * zoom];
        canvas.setViewportTransform(viewportTransform);
        canvas.requestRenderAll();
        zoomRef.current = zoom;
        panOffsetRef.current = panOffset;
    }, [zoom, panOffset]);

    useEffect(() => { canvasStateRef.current = canvasState; }, [canvasState]);
    useEffect(() => { wallsRef.current = walls; }, [walls]);
    useEffect(() => { roomsRef.current = rooms; }, [rooms]);

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
        canvas.defaultCursor = pointerCursor;
        canvas.hoverCursor = pointerCursor;

        canvas.forEachObject((obj) => {
            const objectName = (obj as unknown as { name?: string }).name;
            const isNonInteractive =
                objectName === 'drawing-preview' ||
                objectName === 'wall-snap-highlight' ||
                objectName === 'wall-dimension' ||
                objectName === 'wall-override-indicator' ||
                objectName === 'room-tag';
            if (isNonInteractive) {
                obj.selectable = false;
                obj.evented = false;
                return;
            }
            obj.selectable = allowSelection;
            obj.evented = allowSelection;
        });
        canvas.renderAll();
    }, [tool, isSpacePressed, canvasState.isPanning]);

    // ---------------------------------------------------------------------------
    // Rendering Effects
    // ---------------------------------------------------------------------------

    // Wall rendering
    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const allowSelection = (isSpacePressed ? 'pan' : tool) === 'select';
        const wallIdSet = new Set(walls.map((w) => w.id));
        const selectedWallIdSet = new Set(selectedIds.filter((id) => wallIdSet.has(id)));
        const selectedRoom = rooms.find((r) => selectedIds.includes(r.id));
        const selectedRoomBoundarySet = new Set(selectedRoom?.wallIds ?? []);
        const visibleWalls = queryWallsInBounds(wallSpatialIndex, visibleSceneBounds);

        clearRenderedWalls(canvas);
        visibleWalls.forEach((wall) => {
            const { wallBody, dimensionLabel, overrideMarker } = createWallRenderObjects(
                wall, displayUnit, wallTypeRegistry,
                { selected: selectedWallIdSet.has(wall.id) || selectedRoomBoundarySet.has(wall.id) }
            );
            wallBody.selectable = allowSelection;
            wallBody.evented = allowSelection;
            dimensionLabel.selectable = false;
            dimensionLabel.evented = false;
            canvas.add(wallBody);
            canvas.add(dimensionLabel);
            if (overrideMarker) {
                overrideMarker.selectable = false;
                overrideMarker.evented = false;
                canvas.add(overrideMarker);
            }
        });
        bringTransientOverlaysToFront(canvas);
        canvas.requestRenderAll();
    }, [walls, rooms, selectedIds, displayUnit, tool, isSpacePressed, wallSpatialIndex, visibleSceneBounds, wallTypeRegistry]);

    // Room rendering
    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const allowSelection = (isSpacePressed ? 'pan' : tool) === 'select';
        const selectedRoomId = rooms.find((r) => selectedIds.includes(r.id))?.id ?? null;
        const hoveredRoomId = hoveredRoomInfo?.id ?? null;
        const roomById = new Map(rooms.map((r) => [r.id, r]));
        const visibleRooms = rooms.filter((r) => selectedRoomId === r.id || roomIntersectsBounds(r, visibleSceneBounds));
        const orderedRooms = [...visibleRooms].sort((a, b) => {
            const depthDelta = getRoomHierarchyDepth(a, roomById) - getRoomHierarchyDepth(b, roomById);
            if (depthDelta !== 0) return depthDelta;
            return (b.grossArea ?? b.area) - (a.grossArea ?? a.area);
        });
        const occupiedTagBounds: TagBounds[] = [];

        clearRenderedRooms(canvas);
        orderedRooms.forEach((room) => {
            const { roomFill, roomTag, tagBounds } = createRoomRenderObjects(
                room, zoom, displayUnit, roomById, occupiedTagBounds,
                { selected: selectedRoomId === room.id, hovered: hoveredRoomId === room.id }
            );
            roomFill.selectable = allowSelection;
            roomFill.evented = allowSelection;
            canvas.add(roomFill);
            canvas.sendObjectToBack(roomFill);
            if (roomTag && tagBounds) {
                roomTag.selectable = false;
                roomTag.evented = false;
                canvas.add(roomTag);
                occupiedTagBounds.push(tagBounds);
            }
        });
        bringTransientOverlaysToFront(canvas);
        canvas.requestRenderAll();
    }, [rooms, selectedIds, hoveredRoomInfo?.id, zoom, displayUnit, tool, isSpacePressed, visibleSceneBounds]);

    // Wall handles
    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        if (selectMode.isWallHandleDraggingRef.current) return;
        clearWallHandles(canvas);

        if (tool !== 'select') {
            canvas.requestRenderAll();
            return;
        }

        const selectedWall = walls.find((w) => selectedIds.includes(w.id));
        if (!selectedWall) {
            canvas.requestRenderAll();
            return;
        }

        const handles = createWallHandles(selectedWall, zoom);
        handles.forEach((handle) => {
            handle.selectable = true;
            handle.evented = true;
            canvas.add(handle);
        });
        bringTransientOverlaysToFront(canvas);
        canvas.requestRenderAll();
    }, [tool, walls, selectedIds, zoom, selectMode.isWallHandleDraggingRef]);

    // Tool state cleanup
    useEffect(() => {
        if (tool !== 'wall') wallMode.endWallChain();
        if (tool !== 'room') roomMode.clearRoomPolygonState();
    }, [tool, wallMode, roomMode]);

    useEffect(() => {
        if (tool === 'room') setRoomDrawMode('rectangle');
    }, [tool]);

    useEffect(() => {
        if (tool === 'select' && !isSpacePressed) return;
        setHoveredRoomInfo(null);
        setHoveredElement(null);
    }, [tool, isSpacePressed, setHoveredElement]);

    useEffect(() => {
        if (tool !== 'room') return;
        if (roomDrawMode === 'rectangle') {
            roomMode.clearRoomPolygonState();
            return;
        }
        const currentState = canvasStateRef.current;
        if (currentState.isDrawing) {
            const nextState: CanvasState = { ...currentState, isDrawing: false, drawingPoints: [] };
            canvasStateRef.current = nextState;
            setCanvasState(nextState);
            const canvas = fabricRef.current;
            if (canvas) clearDrawingPreview(canvas);
        }
    }, [tool, roomDrawMode, roomMode]);

    // ---------------------------------------------------------------------------
    // Mouse Event Handlers
    // ---------------------------------------------------------------------------

    const handleMouseDown = useCallback(
        (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const viewportPoint = canvas.getViewportPoint(e.e);
            const scenePoint = canvas.getScenePoint(e.e);
            const point = resolvedSnapToGrid
                ? snapPointToGrid({ x: scenePoint.x, y: scenePoint.y }, resolvedGridSize)
                : { x: scenePoint.x, y: scenePoint.y };
            setMousePosition({ x: scenePoint.x, y: scenePoint.y });

            const mouseEvent = e.e as MouseEvent;
            if ('button' in mouseEvent && mouseEvent.button === 1) {
                mouseEvent.preventDefault();
                return;
            }

            const shouldPan = tool === 'pan' || isSpacePressed;
            if (shouldPan) {
                const nextState: CanvasState = { ...canvasStateRef.current, isPanning: true, lastPanPoint: { x: viewportPoint.x, y: viewportPoint.y } };
                canvasStateRef.current = nextState;
                setCanvasState(nextState);
                return;
            }

            if (tool === 'room') {
                if (roomDrawMode === 'rectangle') {
                    const targetPoint = roomMode.handleRectangleMouseDown(point);
                    const nextState: CanvasState = { ...canvasStateRef.current, isDrawing: true, drawingPoints: [targetPoint] };
                    canvasStateRef.current = nextState;
                    setCanvasState(nextState);
                } else {
                    roomMode.handlePolygonMouseDown(point, mouseEvent.detail >= 2);
                }
                return;
            }

            if (tool === 'wall') {
                wallMode.handleMouseDown(point, mouseEvent.detail >= 2, mouseEvent.shiftKey);
                return;
            }

            if (isDrawingTool(tool)) {
                const nextState: CanvasState = { ...canvasStateRef.current, isDrawing: true, drawingPoints: [point] };
                canvasStateRef.current = nextState;
                setCanvasState(nextState);
            }
        },
        [tool, roomDrawMode, resolvedSnapToGrid, resolvedGridSize, isSpacePressed, wallMode, roomMode]
    );

    const handleMouseMove = useCallback(
        (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
            const canvas = fabricRef.current;
            if (!canvas) return;

            const viewportPoint = canvas.getViewportPoint(e.e);
            const scenePoint = canvas.getScenePoint(e.e);
            const point = resolvedSnapToGrid
                ? snapPointToGrid({ x: scenePoint.x, y: scenePoint.y }, resolvedGridSize)
                : { x: scenePoint.x, y: scenePoint.y };
            setMousePosition({ x: scenePoint.x, y: scenePoint.y });

            const currentState = canvasStateRef.current;
            if (middlePan.middlePanRef.current.active) return;

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

            // Room hover (select mode)
            if (tool === 'select' && !isSpacePressed && !currentState.isDrawing) {
                selectMode.handleRoomHover(point, { x: viewportPoint.x, y: viewportPoint.y });
            } else {
                setHoveredRoomInfo(null);
                setHoveredElement(null);
            }

            if (tool === 'room') {
                if (roomDrawMode === 'rectangle') {
                    if (currentState.isDrawing && currentState.drawingPoints[0]) {
                        const targetPoint = roomMode.handleRectangleMouseMove(currentState.drawingPoints[0], point);
                        const nextState: CanvasState = { ...currentState, drawingPoints: [currentState.drawingPoints[0], targetPoint] };
                        canvasStateRef.current = nextState;
                        setCanvasState(nextState);
                    }
                } else {
                    roomMode.handlePolygonMouseMove(point);
                }
                return;
            }

            if (tool === 'wall') {
                const mouseEvent = e.e as MouseEvent;
                wallMode.handleMouseMove(point, mouseEvent.shiftKey, activeWallType.totalThickness);
                return;
            }

            if (!currentState.isDrawing) return;
            const nextPoints = [...currentState.drawingPoints, point];
            const nextState: CanvasState = { ...currentState, drawingPoints: nextPoints };
            canvasStateRef.current = nextState;
            setCanvasState(nextState);
            renderDrawingPreview(canvas, nextPoints, tool);
        },
        [tool, roomDrawMode, resolvedSnapToGrid, resolvedGridSize, setPanOffset, activeWallType.totalThickness, isSpacePressed, selectMode, wallMode, roomMode, setHoveredElement]
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

        if (tool === 'room' && roomDrawMode === 'rectangle') {
            if (currentState.isDrawing && currentState.drawingPoints.length > 1) {
                const startPoint = currentState.drawingPoints[0];
                const endPoint = currentState.drawingPoints[currentState.drawingPoints.length - 1];
                if (startPoint && endPoint) {
                    roomMode.handleRectangleMouseUp(startPoint, endPoint);
                }
            }
            const nextState: CanvasState = { ...currentState, isDrawing: false, drawingPoints: [] };
            canvasStateRef.current = nextState;
            setCanvasState(nextState);
            return;
        }

        if (currentState.isDrawing && currentState.drawingPoints.length > 1) {
            if (tool === 'pencil' || tool === 'spline') {
                addSketch({ points: currentState.drawingPoints, type: tool === 'spline' ? 'spline' : 'freehand' });
            }
            clearDrawingPreview(canvas);
        }

        const nextState: CanvasState = { ...currentState, isDrawing: false, drawingPoints: [] };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
    }, [tool, roomDrawMode, roomMode, addSketch]);

    const handleWheel = useCallback(
        (e: fabric.TPointerEventInfo<WheelEvent>) => {
            e.e.preventDefault();
            const canvas = fabricRef.current;
            if (!canvas) return;

            const pointer = canvas.getViewportPoint(e.e);
            const scenePoint = canvas.getScenePoint(e.e);
            const currentZoom = zoomRef.current;
            const zoomFactor = Math.exp(-e.e.deltaY * WHEEL_ZOOM_SENSITIVITY);
            const newZoom = Math.min(Math.max(currentZoom * zoomFactor, MIN_ZOOM), MAX_ZOOM);
            if (Math.abs(newZoom - currentZoom) < 0.0001) return;

            const nextPan = { x: scenePoint.x - pointer.x / newZoom, y: scenePoint.y - pointer.y / newZoom };
            zoomRef.current = newZoom;
            panOffsetRef.current = nextPan;
            setViewTransform(newZoom, nextPan);
        },
        [setViewTransform]
    );

    // ---------------------------------------------------------------------------
    // Event Binding
    // ---------------------------------------------------------------------------

    useEffect(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;

        const upperCanvasEl = canvas.upperCanvasEl;

        const handleCanvasDoubleClick = (event: MouseEvent) => {
            if (tool === 'wall') {
                event.preventDefault();
                wallMode.endWallChain();
                return;
            }
            if (tool === 'select') {
                selectMode.handleDoubleClick(event);
            }
        };

        const handleSelectionCreated = (event: fabric.CanvasEvents['selection:created']) => {
            if (tool === 'select') selectMode.updateSelectionFromTarget(event.selected?.[0] ?? null);
        };

        const handleSelectionUpdated = (event: fabric.CanvasEvents['selection:updated']) => {
            if (tool === 'select') selectMode.updateSelectionFromTarget(event.selected?.[0] ?? null);
        };

        const handleSelectionCleared = () => {
            if (!selectMode.isWallHandleDraggingRef.current) setSelectedIds([]);
        };

        const handleCanvasMouseDown = (event: fabric.CanvasEvents['mouse:down']) => {
            if (tool !== 'select') return;
            const scenePoint = event.e ? canvas.getScenePoint(event.e) : null;
            if (scenePoint) {
                selectMode.handleMouseDown(event.target ?? null, { x: scenePoint.x, y: scenePoint.y });
            } else {
                selectMode.updateSelectionFromTarget(event.target ?? null);
            }
        };

        const handleObjectMoving = (event: fabric.CanvasEvents['object:moving']) => {
            if (event.target && tool === 'select') {
                selectMode.handleObjectMoving(event.target);
            }
        };

        const handleObjectModified = (event: fabric.CanvasEvents['object:modified']) => {
            if (!event.target) return;
            const meta = selectMode.getTargetMeta(event.target);
            if (meta.name === 'wall-handle') selectMode.finalizeHandleDrag();
        };

        const handleWindowBlur = () => {
            middlePan.stopMiddlePan();
            selectMode.finalizeHandleDrag();
        };

        const handleCanvasMouseLeave = () => {
            setHoveredRoomInfo(null);
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
        canvas.on('object:modified', handleObjectModified);
        window.addEventListener('mouseup', handleMouseUp);

        upperCanvasEl?.addEventListener('mousedown', middlePan.handleMiddleMouseDown);
        upperCanvasEl?.addEventListener('auxclick', middlePan.preventMiddleAuxClick);
        upperCanvasEl?.addEventListener('dblclick', handleCanvasDoubleClick);
        upperCanvasEl?.addEventListener('mouseleave', handleCanvasMouseLeave);
        window.addEventListener('mousemove', middlePan.handleMiddleMouseMove, { passive: false });
        window.addEventListener('mouseup', middlePan.handleMiddleMouseUp);
        window.addEventListener('blur', handleWindowBlur);

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
            canvas.off('object:modified', handleObjectModified);
            window.removeEventListener('mouseup', handleMouseUp);
            upperCanvasEl?.removeEventListener('mousedown', middlePan.handleMiddleMouseDown);
            upperCanvasEl?.removeEventListener('auxclick', middlePan.preventMiddleAuxClick);
            upperCanvasEl?.removeEventListener('dblclick', handleCanvasDoubleClick);
            upperCanvasEl?.removeEventListener('mouseleave', handleCanvasMouseLeave);
            window.removeEventListener('mousemove', middlePan.handleMiddleMouseMove);
            window.removeEventListener('mouseup', middlePan.handleMiddleMouseUp);
            window.removeEventListener('blur', handleWindowBlur);
            selectMode.finalizeHandleDrag();
        };
    }, [handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, tool, wallMode, selectMode, middlePan, setSelectedIds, setHoveredElement]);

    // ---------------------------------------------------------------------------
    // Custom Wall Type Creation
    // ---------------------------------------------------------------------------

    const createCustomWallType = useCallback(() => {
        if (typeof window === 'undefined') return;
        const rawName = window.prompt('New wall type name', `${activeWallType.name} (Custom)`);
        const nextName = rawName?.trim();
        if (!nextName) return;

        const slug = nextName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-wall';
        const id = `${slug}-${Date.now().toString(36)}`;
        const customTypes = wallTypeRegistry.filter((wt) => !BUILT_IN_WALL_TYPE_IDS.includes(wt.id));
        const customWallType: WallTypeDefinition = {
            ...activeWallType,
            id,
            name: nextName,
            layers: activeWallType.layers.map((layer, index) => ({ ...layer, id: generateId(), order: index })),
        };
        setWallTypeRegistry([...customTypes, customWallType]);
        setActiveWallTypeId(id);
    }, [activeWallType, wallTypeRegistry, setWallTypeRegistry, setActiveWallTypeId]);

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
                <PageLayout pageWidth={pageConfig.width} pageHeight={pageConfig.height} zoom={zoom} panOffset={panOffset} />
                <Grid
                    pageWidth={pageConfig.width}
                    pageHeight={pageConfig.height}
                    zoom={zoom}
                    panOffset={panOffset}
                    gridSize={resolvedGridSize}
                    showGrid={resolvedShowGrid}
                    viewportWidth={hostWidth}
                    viewportHeight={hostHeight}
                />
                <canvas ref={canvasRef} className="relative z-[2] block" />
            </div>

            {(tool === 'wall' || tool === 'room') && (
                <WallTypeSelector
                    wallTypeRegistry={wallTypeRegistry}
                    activeWallTypeId={activeWallTypeId}
                    onSelectWallType={setActiveWallTypeId}
                    onCreateCustomType={createCustomWallType}
                />
            )}

            {tool === 'room' && <RoomModeSelector roomDrawMode={roomDrawMode} onModeChange={setRoomDrawMode} />}

            {hoveredRoomInfo && tool === 'select' && !isSpacePressed && (
                <HoveredRoomTooltip roomInfo={hoveredRoomInfo} displayUnit={displayUnit} />
            )}

            <Rulers
                pageWidth={pageConfig.width}
                pageHeight={pageConfig.height}
                zoom={zoom}
                panOffset={panOffset}
                viewportWidth={hostWidth}
                viewportHeight={hostHeight}
                showRulers={resolvedShowRulers}
                rulerSize={rulerSize}
                originOffset={originOffset}
                gridSize={resolvedGridSize}
                displayUnit={displayUnit}
                mousePosition={mousePosition}
            />
        </div>
    );
}

export default DrawingCanvas;
