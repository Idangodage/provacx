/**
 * Drawing Canvas Component
 *
 * Main Fabric.js canvas wrapper for smart drawing.
 * Uses mode-specific hooks following industry best practices.
 */

'use client';

import * as fabric from 'fabric';
import { useEffect, useRef, useCallback, useState } from 'react';

import { useSmartDrawingStore } from '../store';
import type { DisplayUnit, Point2D } from '../types';

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
}: DrawingCanvasProps) {
    // Core refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const outerRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const fabricRef = useRef<fabric.Canvas | null>(null);
    const zoomRef = useRef(1);
    const panOffsetRef = useRef<Point2D>({ x: 0, y: 0 });
    const mousePositionRef = useRef<Point2D>({ x: 0, y: 0 });
    const mousePositionFrameRef = useRef<number | null>(null);
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
    const [fabricCanvas, setFabricCanvas] = useState<fabric.Canvas | null>(null);
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
        pageConfig,
        gridSize: storeGridSize,
        showGrid: storeShowGrid,
        showRulers: storeShowRulers,
        snapToGrid: storeSnapToGrid,
        setPanOffset,
        setViewTransform,
        setSelectedIds,
        setHoveredElement,
        addSketch,
        deleteSelected,
        // Wall state and actions
        walls,
        wallDrawingState,
        wallSettings,
        startWallDrawing,
        updateWallPreview,
        commitWall,
        cancelWallDrawing,
        connectWalls,
        createRoomWalls,
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
    // scaleRatio converts paper mm to real-world mm (e.g., 50 for 1:50 scale)
    const scaleRatio = safeScaleReal / safeScaleDrawing;
    const safeGridSubdivisions = Number.isFinite(gridSubdivisions) && gridSubdivisions >= 1
        ? Math.max(1, Math.floor(gridSubdivisions))
        : 1;
    const baseGridMajorMm = gridMode === 'real'
        ? toMillimeters(majorGridSize, resolvedRealWorldUnit) * paperPerRealRatio
        : toMillimeters(majorGridSize, paperUnit);
    const configuredGridMajorScenePx = Math.max(baseGridMajorMm * MM_TO_PX, 0.5);
    const effectiveSnapGridSize = Math.max(configuredGridMajorScenePx / safeGridSubdivisions, 0.5);
    const rulerSize = 24;
    const leftRulerWidth = Math.round(rulerSize * 1.2);
    const originOffset = resolvedShowRulers ? { x: leftRulerWidth, y: rulerSize } : { x: 0, y: 0 };
    const hostWidth = Math.max(1, viewportSize.width - originOffset.x);
    const hostHeight = Math.max(1, viewportSize.height - originOffset.y);

    void selectedIds;
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

    useEffect(() => {
        return () => {
            if (mousePositionFrameRef.current !== null && typeof window !== 'undefined') {
                window.cancelAnimationFrame(mousePositionFrameRef.current);
                mousePositionFrameRef.current = null;
            }
        };
    }, []);

    // Mode hooks
    const selectMode = useSelectMode({
        fabricRef,
        setSelectedIds,
        setHoveredElement,
        originOffset,
    });

    const middlePan = useMiddlePan({
        zoomRef,
        panOffsetRef,
        setPanOffset,
        setCanvasState,
        canvasStateRef,
    });

    // Wall tool hook
    const wallTool = useWallTool({
        fabricRef,
        canvas: fabricCanvas,
        walls,
        wallDrawingState,
        wallSettings,
        zoom,
        pageHeight: pageConfig.height,
        scaleRatio,
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

    // Keyboard handling
    useCanvasKeyboard({
        tool,
        selectedIds,
        deleteSelected,
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
        const viewportTransform: fabric.TMat2D = [zoom, 0, 0, zoom, -panOffset.x * zoom, -panOffset.y * zoom];
        canvas.setViewportTransform(viewportTransform);
        canvas.requestRenderAll();
        zoomRef.current = zoom;
        panOffsetRef.current = panOffset;
    }, [zoom, panOffset]);

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
        canvas.defaultCursor = pointerCursor;
        canvas.hoverCursor = pointerCursor;

        canvas.forEachObject((obj) => {
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

            // Handle wall tool - convert from pixels to real-world mm with Y-flip and scale
            if (tool === 'wall') {
                // Convert pixels -> paper mm -> real-world mm
                const paperX = rawPoint.x / MM_TO_PX;
                const paperY = pageConfig.height - rawPoint.y / MM_TO_PX;
                const wallPoint = {
                    x: paperX * scaleRatio,
                    y: paperY * scaleRatio,
                };
                wallTool.handleMouseDown(wallPoint);
                return;
            }

            // Handle room tool - convert from pixels to real-world mm with Y-flip and scale
            if (tool === 'room') {
                const paperX = rawPoint.x / MM_TO_PX;
                const paperY = pageConfig.height - rawPoint.y / MM_TO_PX;
                const roomPoint = {
                    x: paperX * scaleRatio,
                    y: paperY * scaleRatio,
                };
                roomTool.handleMouseDown(roomPoint);
                return;
            }

            if (isDrawingTool(tool)) {
                const nextState: CanvasState = { ...canvasStateRef.current, isDrawing: true, drawingPoints: [point] };
                canvasStateRef.current = nextState;
                setCanvasState(nextState);
            }
        },
        [tool, resolvedSnapToGrid, effectiveSnapGridSize, isSpacePressed, queueMousePositionUpdate, wallTool, roomTool, pageConfig.height, scaleRatio]
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

            // Handle wall tool movement - convert from pixels to real-world mm with Y-flip and scale
            if (tool === 'wall' && wallTool.isDrawing) {
                const paperX = rawPoint.x / MM_TO_PX;
                const paperY = pageConfig.height - rawPoint.y / MM_TO_PX;
                const wallPoint = {
                    x: paperX * scaleRatio,
                    y: paperY * scaleRatio,
                };
                wallTool.handleMouseMove(wallPoint);
                return;
            }

            if (!currentState.isDrawing) return;
            const nextPoints = [...currentState.drawingPoints, point];
            const nextState: CanvasState = { ...currentState, drawingPoints: nextPoints };
            canvasStateRef.current = nextState;
            setCanvasState(nextState);
            renderDrawingPreview(canvas, nextPoints, tool);
        },
        [tool, resolvedSnapToGrid, effectiveSnapGridSize, setPanOffset, queueMousePositionUpdate, middlePan.middlePanRef, wallTool, pageConfig.height, scaleRatio]
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

        if (currentState.isDrawing && currentState.drawingPoints.length > 1) {
            if (tool === 'pencil' || tool === 'spline') {
                addSketch({ points: currentState.drawingPoints, type: tool === 'spline' ? 'spline' : 'freehand' });
            }
        }

        const nextState: CanvasState = { ...currentState, isDrawing: false, drawingPoints: [] };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
    }, [tool, addSketch]);

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
            if (tool === 'select') {
                selectMode.handleDoubleClick(event);
            }
            if (tool === 'wall') {
                wallTool.handleDoubleClick();
            }
        };

        // Wall tool keyboard handlers
        const handleWallKeyDown = (e: KeyboardEvent) => {
            if (tool === 'wall') {
                wallTool.handleKeyDown(e);
            }
        };
        const handleWallKeyUp = (e: KeyboardEvent) => {
            if (tool === 'wall') {
                wallTool.handleKeyUp(e);
            }
        };

        const handleSelectionCreated = (event: fabric.CanvasEvents['selection:created']) => {
            if (tool === 'select') selectMode.updateSelectionFromTarget(event.selected?.[0] ?? null);
        };

        const handleSelectionUpdated = (event: fabric.CanvasEvents['selection:updated']) => {
            if (tool === 'select') selectMode.updateSelectionFromTarget(event.selected?.[0] ?? null);
        };

        const handleSelectionCleared = () => {
            if (!selectMode.isWallHandleDraggingRef.current) {
                setSelectedIds([]);
            }
        };

        const handleCanvasMouseDown = (event: fabric.CanvasEvents['mouse:down']) => {
            if (tool !== 'select') return;
            const scenePoint = event.e ? canvas.getScenePoint(event.e) : null;
            if (!scenePoint) {
                selectMode.updateSelectionFromTarget(event.target ?? null);
                return;
            }
            selectMode.handleMouseDown(event.target ?? null, scenePoint);
        };

        const handleObjectMoving = (event: fabric.CanvasEvents['object:moving']) => {
            if (event.target && tool === 'select') {
                selectMode.handleObjectMoving(event.target);
            }
        };

        const handleObjectModified = (event: fabric.CanvasEvents['object:modified']) => {
            if (!event.target) return;
            selectMode.finalizeHandleDrag();
        };

        const handleWindowBlur = () => {
            middlePan.stopMiddlePan();
            selectMode.finalizeHandleDrag();
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
        canvas.on('object:modified', handleObjectModified);
        window.addEventListener('mouseup', handleMouseUp);

        upperCanvasEl?.addEventListener('mousedown', middlePan.handleMiddleMouseDown);
        upperCanvasEl?.addEventListener('auxclick', middlePan.preventMiddleAuxClick);
        upperCanvasEl?.addEventListener('dblclick', handleCanvasDoubleClick);
        upperCanvasEl?.addEventListener('mouseleave', handleCanvasMouseLeave);
        window.addEventListener('mousemove', middlePan.handleMiddleMouseMove, { passive: false });
        window.addEventListener('mouseup', middlePan.handleMiddleMouseUp);
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
            canvas.off('object:modified', handleObjectModified);
            window.removeEventListener('mouseup', handleMouseUp);
            upperCanvasEl?.removeEventListener('mousedown', middlePan.handleMiddleMouseDown);
            upperCanvasEl?.removeEventListener('auxclick', middlePan.preventMiddleAuxClick);
            upperCanvasEl?.removeEventListener('dblclick', handleCanvasDoubleClick);
            upperCanvasEl?.removeEventListener('mouseleave', handleCanvasMouseLeave);
            window.removeEventListener('mousemove', middlePan.handleMiddleMouseMove);
            window.removeEventListener('mouseup', middlePan.handleMiddleMouseUp);
            window.removeEventListener('blur', handleWindowBlur);
            window.removeEventListener('keydown', handleWallKeyDown);
            window.removeEventListener('keyup', handleWallKeyUp);
            selectMode.finalizeHandleDrag();
        };
    }, [handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, tool, selectMode, middlePan, setSelectedIds, setHoveredElement, wallTool]);

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
                        x: roomTool.startCorner.x * MM_TO_PX * zoom - panOffset.x * zoom + originOffset.x + 20,
                        y: (pageConfig.height - roomTool.startCorner.y) * MM_TO_PX * zoom - panOffset.y * zoom + originOffset.y + 20,
                    }}
                />
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
                displayUnit={resolvedRealWorldUnit}
                mousePosition={mousePosition}
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
