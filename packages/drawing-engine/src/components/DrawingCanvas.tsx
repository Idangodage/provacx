/**
 * Drawing Canvas Component
 * 
 * Main Fabric.js canvas wrapper for HVAC smart drawing.
 * Handles canvas initialization, rendering, and user interactions.
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import * as fabric from 'fabric';
import { useSmartDrawingStore } from '../store';
import type { Point2D, DrawingTool } from '../types';
import { Grid, PageLayout, Rulers } from './canvas';

// =============================================================================
// Types
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const zoomRef = useRef(1);
  const panOffsetRef = useRef<Point2D>({ x: 0, y: 0 });
  const middlePanRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const canvasStateRef = useRef<CanvasState>({
    isPanning: false,
    lastPanPoint: null,
    isDrawing: false,
    drawingPoints: [],
  });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [mousePosition, setMousePosition] = useState<Point2D>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  const [canvasState, setCanvasState] = useState<CanvasState>({
    isPanning: false,
    lastPanPoint: null,
    isDrawing: false,
    drawingPoints: [],
  });

  const {
    tool,
    zoom,
    panOffset,
    pageConfig,
    gridSize: storeGridSize,
    showGrid: storeShowGrid,
    showRulers: storeShowRulers,
    snapToGrid: storeSnapToGrid,
    setPanOffset,
    setViewTransform,
    addWall,
    addRoom,
    addSketch,
  } = useSmartDrawingStore();

  const resolvedGridSize = gridSize ?? storeGridSize ?? 20;
  const resolvedShowGrid = showGrid ?? storeShowGrid ?? true;
  const resolvedShowRulers = showRulers ?? storeShowRulers ?? true;
  const resolvedSnapToGrid = snapToGrid ?? storeSnapToGrid ?? true;

  const rulerSize = 24;
  const leftRulerWidth = Math.round(rulerSize * 1.2);
  const originOffset = resolvedShowRulers ? { x: leftRulerWidth, y: rulerSize } : { x: 0, y: 0 };
  const hostWidth = Math.max(1, viewportSize.width - originOffset.x);
  const hostHeight = Math.max(1, viewportSize.height - originOffset.y);

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

    // Handle resize
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

  // ---------------------------------------------------------------------------
  // Zoom and Pan
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const viewportTransform: fabric.TMat2D = [
      zoom,
      0,
      0,
      zoom,
      -panOffset.x * zoom,
      -panOffset.y * zoom,
    ];
    canvas.setViewportTransform(viewportTransform);
    canvas.requestRenderAll();

    zoomRef.current = zoom;
    panOffsetRef.current = panOffset;
  }, [zoom, panOffset]);

  useEffect(() => {
    canvasStateRef.current = canvasState;
  }, [canvasState]);

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

    // Disable object selection for drawing tools
    canvas.forEachObject((obj) => {
      obj.selectable = allowSelection;
      obj.evented = allowSelection;
    });

    canvas.renderAll();
  }, [tool, isSpacePressed, canvasState.isPanning]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isEditableElement(event.target)) return;
      event.preventDefault();
      setIsSpacePressed(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    const clearSpacePan = () => setIsSpacePressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearSpacePan);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearSpacePan);
    };
  }, []);

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
      // Middle-button panning is handled by dedicated DOM listeners.
      if ('button' in mouseEvent && mouseEvent.button === 1) {
        mouseEvent.preventDefault();
        return;
      }
      const shouldPan = tool === 'pan' || isSpacePressed;

      if (shouldPan) {
        const nextState: CanvasState = {
          ...canvasStateRef.current,
          isPanning: true,
          lastPanPoint: { x: viewportPoint.x, y: viewportPoint.y },
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
        return;
      }

      if (isDrawingTool(tool)) {
        const nextState: CanvasState = {
          ...canvasStateRef.current,
          isDrawing: true,
          drawingPoints: [point],
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
      }
    },
    [tool, resolvedSnapToGrid, resolvedGridSize, isSpacePressed]
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
      if (middlePanRef.current.active) return;

      if (currentState.isPanning && currentState.lastPanPoint) {
        const dx = viewportPoint.x - currentState.lastPanPoint.x;
        const dy = viewportPoint.y - currentState.lastPanPoint.y;

        const nextPan = {
          x: panOffsetRef.current.x - dx / zoomRef.current,
          y: panOffsetRef.current.y - dy / zoomRef.current,
        };
        panOffsetRef.current = nextPan;
        setPanOffset(nextPan);

        const nextState: CanvasState = {
          ...currentState,
          lastPanPoint: { x: viewportPoint.x, y: viewportPoint.y },
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
        return;
      }

      if (!currentState.isDrawing) return;

      const nextPoints = [...currentState.drawingPoints, point];
      const nextState: CanvasState = {
        ...currentState,
        drawingPoints: nextPoints,
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
      renderDrawingPreview(canvas, nextPoints, tool);
    },
    [tool, resolvedSnapToGrid, resolvedGridSize, setPanOffset]
  );

  const handleMouseUp = useCallback(
    () => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const currentState = canvasStateRef.current;

      if (currentState.isPanning) {
        const nextState: CanvasState = {
          ...currentState,
          isPanning: false,
          lastPanPoint: null,
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
        return;
      }

      if (currentState.isDrawing && currentState.drawingPoints.length > 1) {
        finalizeDrawing(currentState.drawingPoints, tool);
        clearDrawingPreview(canvas);
      }

      const nextState: CanvasState = {
        ...currentState,
        isDrawing: false,
        drawingPoints: [],
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
    },
    [tool]
  );

  const handleWheel = useCallback(
    (e: fabric.TPointerEventInfo<WheelEvent>) => {
      e.e.preventDefault();
      const canvas = fabricRef.current;
      if (!canvas) return;

      // Get mouse position in screen coordinates
      const pointer = canvas.getViewportPoint(e.e);
      const scenePoint = canvas.getScenePoint(e.e);

      const currentZoom = zoomRef.current;
      const zoomFactor = Math.exp(-e.e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const newZoom = Math.min(Math.max(currentZoom * zoomFactor, MIN_ZOOM), MAX_ZOOM);
      if (Math.abs(newZoom - currentZoom) < 0.0001) return;

      // Calculate new pan offset to keep the point under cursor fixed
      const nextPan = {
        x: scenePoint.x - pointer.x / newZoom,
        y: scenePoint.y - pointer.y / newZoom,
      };

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

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:wheel', handleWheel);
    window.addEventListener('mouseup', handleMouseUp);

    const upperCanvasEl = canvas.upperCanvasEl;
    const stopMiddlePan = () => {
      if (!middlePanRef.current.active) return;
      middlePanRef.current.active = false;
      const nextState: CanvasState = {
        ...canvasStateRef.current,
        isPanning: false,
        lastPanPoint: null,
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
    };

    const handleMiddleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      middlePanRef.current = {
        active: true,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      const nextState: CanvasState = {
        ...canvasStateRef.current,
        isPanning: true,
        lastPanPoint: { x: event.clientX, y: event.clientY },
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
    };

    const preventMiddleAuxClick = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };

    const handleMiddleMouseMove = (event: MouseEvent) => {
      if (!middlePanRef.current.active) return;
      if ((event.buttons & 4) !== 4) {
        stopMiddlePan();
        return;
      }
      event.preventDefault();

      const dx = event.clientX - middlePanRef.current.lastX;
      const dy = event.clientY - middlePanRef.current.lastY;

      middlePanRef.current.lastX = event.clientX;
      middlePanRef.current.lastY = event.clientY;

      const nextPan = {
        x: panOffsetRef.current.x - dx / zoomRef.current,
        y: panOffsetRef.current.y - dy / zoomRef.current,
      };
      panOffsetRef.current = nextPan;
      setPanOffset(nextPan);
    };

    const handleMiddleMouseUp = (event: MouseEvent) => {
      if (event.button !== 1 && !middlePanRef.current.active) return;
      stopMiddlePan();
    };
    const handleWindowBlur = () => stopMiddlePan();

    upperCanvasEl?.addEventListener('mousedown', handleMiddleMouseDown);
    upperCanvasEl?.addEventListener('auxclick', preventMiddleAuxClick);
    window.addEventListener('mousemove', handleMiddleMouseMove, { passive: false });
    window.addEventListener('mouseup', handleMiddleMouseUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('mouse:wheel', handleWheel);
      window.removeEventListener('mouseup', handleMouseUp);
      upperCanvasEl?.removeEventListener('mousedown', handleMiddleMouseDown);
      upperCanvasEl?.removeEventListener('auxclick', preventMiddleAuxClick);
      window.removeEventListener('mousemove', handleMiddleMouseMove);
      window.removeEventListener('mouseup', handleMiddleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, setPanOffset]);

  // ---------------------------------------------------------------------------
  // Drawing Finalization
  // ---------------------------------------------------------------------------

  const finalizeDrawing = useCallback(
    (points: Point2D[], currentTool: DrawingTool) => {
      if (points.length < 2) return;

      const startPoint = points[0];
      const endPoint = points[points.length - 1];
      if (!startPoint || !endPoint) return;

      switch (currentTool) {
        case 'wall':
          addWall({
            start: startPoint,
            end: endPoint,
            thickness: 0.15,
            height: 3.0,
            wallType: 'interior',
          });
          break;

        case 'room':
          if (points.length >= 3) {
            addRoom({
              vertices: points,
              name: `Room ${Date.now()}`,
              spaceType: 'general',
              floorHeight: 0,
              ceilingHeight: 3.0,
            });
          }
          break;

        case 'pencil':
        case 'spline':
          addSketch({
            points,
            type: currentTool === 'spline' ? 'spline' : 'freehand',
          });
          break;
      }
    },
    [addWall, addRoom, addSketch]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={outerRef}
      className={`relative w-full h-full overflow-hidden ${className}`}
    >
      <div
        ref={hostRef}
        className="absolute"
        style={{
          top: originOffset.y,
          left: originOffset.x,
          width: hostWidth,
          height: hostHeight,
          overflow: 'hidden',
        }}
      >
        <PageLayout
          pageWidth={pageConfig.width}
          pageHeight={pageConfig.height}
          zoom={zoom}
          panOffset={panOffset}
        />
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
        mousePosition={mousePosition}
      />
    </div>
  );
}

// =============================================================================
// Utility Functions
// =============================================================================

function snapPointToGrid(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable=""], [contenteditable="true"]'
    )
  );
}

function getToolCursor(tool: DrawingTool): string {
  switch (tool) {
    case 'select':
      return 'default';
    case 'pan':
      return 'grab';
    case 'wall':
    case 'room':
    case 'dimension':
      return 'crosshair';
    case 'pencil':
    case 'spline':
      return 'crosshair';
    case 'text':
      return 'text';
    case 'eraser':
      return 'not-allowed';
    default:
      return 'default';
  }
}

function isDrawingTool(tool: DrawingTool): boolean {
  return ['wall', 'room', 'pencil', 'spline', 'dimension', 'rectangle', 'circle', 'line'].includes(
    tool
  );
}

function renderDrawingPreview(
  canvas: fabric.Canvas,
  points: Point2D[],
  tool: DrawingTool
): void {
  clearDrawingPreview(canvas);

  if (points.length < 2) return;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return;

  let previewObject: fabric.Object | null = null;

  switch (tool) {
    case 'wall':
    case 'line':
      previewObject = new fabric.Line(
        [firstPoint.x, firstPoint.y, lastPoint.x, lastPoint.y],
        {
          stroke: '#2196F3',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
          name: 'drawing-preview',
        }
      );
      break;

    case 'room':
    case 'pencil':
    case 'spline':
      previewObject = new fabric.Polyline(
        points.map((p) => ({ x: p.x, y: p.y })),
        {
          stroke: '#2196F3',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          fill: 'transparent',
          selectable: false,
          evented: false,
          name: 'drawing-preview',
        }
      );
      break;

    case 'rectangle':
      if (points.length >= 2) {
        const start = points[0];
        const end = points[points.length - 1];
        if (!start || !end) break;
        previewObject = new fabric.Rect({
          left: Math.min(start.x, end.x),
          top: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
          stroke: '#2196F3',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          fill: 'transparent',
          selectable: false,
          evented: false,
          name: 'drawing-preview',
        });
      }
      break;

    case 'circle':
      if (points.length >= 2) {
        const center = points[0];
        const edge = points[points.length - 1];
        if (!center || !edge) break;
        const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
        previewObject = new fabric.Circle({
          left: center.x - radius,
          top: center.y - radius,
          radius,
          stroke: '#2196F3',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          fill: 'transparent',
          selectable: false,
          evented: false,
          name: 'drawing-preview',
        });
      }
      break;
  }

  if (previewObject) {
    canvas.add(previewObject);
    canvas.renderAll();
  }
}

function clearDrawingPreview(canvas: fabric.Canvas): void {
  const previewObjects = canvas.getObjects().filter((obj) => (obj as unknown as { name?: string }).name === 'drawing-preview');
  previewObjects.forEach((obj) => canvas.remove(obj));
  canvas.renderAll();
}

export default DrawingCanvas;
