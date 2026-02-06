/**
 * Drawing Canvas Component
 * 
 * Main Fabric.js canvas wrapper for HVAC smart drawing.
 * Handles canvas initialization, rendering, and user interactions.
 */

'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
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
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  
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
    setZoom,
    setPanOffset,
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
  const pageWidthPx = pageConfig.width * zoom;
  const pageHeightPx = pageConfig.height * zoom;
  const hostWidth = originOffset.x + pageWidthPx;
  const hostHeight = originOffset.y + pageHeightPx;
  const spacerWidth = Math.max(hostWidth, viewportSize.width);
  const spacerHeight = Math.max(hostHeight, viewportSize.height);

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

    canvas.setZoom(zoom);
    canvas.absolutePan(new fabric.Point(-panOffset.x, -panOffset.y));
    canvas.renderAll();
  }, [zoom, panOffset]);

  // ---------------------------------------------------------------------------
  // Tool Change Handler
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.selection = tool === 'select';
    canvas.defaultCursor = getToolCursor(tool);
    canvas.hoverCursor = getToolCursor(tool);

    // Disable object selection for drawing tools
    canvas.forEachObject((obj) => {
      obj.selectable = tool === 'select';
      obj.evented = tool === 'select';
    });

    canvas.renderAll();
  }, [tool]);

  // ---------------------------------------------------------------------------
  // Mouse Event Handlers
  // ---------------------------------------------------------------------------

  const handleMouseDown = useCallback(
    (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const pointer = canvas.getViewportPoint(e.e);
      const point = resolvedSnapToGrid
        ? snapPointToGrid({ x: pointer.x, y: pointer.y }, resolvedGridSize)
        : { x: pointer.x, y: pointer.y };

      // Check for middle mouse button (pan)
      const mouseEvent = e.e as MouseEvent;
      const isMiddleButton = 'button' in mouseEvent && mouseEvent.button === 1;
      
      if (tool === 'pan' || isMiddleButton) {
        setCanvasState((prev) => ({
          ...prev,
          isPanning: true,
          lastPanPoint: point,
        }));
        return;
      }

      if (isDrawingTool(tool)) {
        setCanvasState((prev) => ({
          ...prev,
          isDrawing: true,
          drawingPoints: [point],
        }));
      }
    },
    [tool, resolvedSnapToGrid, resolvedGridSize]
  );

  const handleMouseMove = useCallback(
    (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const pointer = canvas.getViewportPoint(e.e);
      const point = resolvedSnapToGrid
        ? snapPointToGrid({ x: pointer.x, y: pointer.y }, resolvedGridSize)
        : { x: pointer.x, y: pointer.y };

      if (canvasState.isPanning && canvasState.lastPanPoint) {
        const dx = point.x - canvasState.lastPanPoint.x;
        const dy = point.y - canvasState.lastPanPoint.y;
        setPanOffset({
          x: panOffset.x + dx,
          y: panOffset.y + dy,
        });
        setCanvasState((prev) => ({
          ...prev,
          lastPanPoint: point,
        }));
        return;
      }

      if (canvasState.isDrawing) {
        setCanvasState((prev) => ({
          ...prev,
          drawingPoints: [...prev.drawingPoints, point],
        }));
        renderDrawingPreview(canvas, [...canvasState.drawingPoints, point], tool);
      }
    },
    [canvasState, tool, resolvedSnapToGrid, resolvedGridSize, panOffset, setPanOffset]
  );

  const handleMouseUp = useCallback(
    (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      if (canvasState.isPanning) {
        setCanvasState((prev) => ({
          ...prev,
          isPanning: false,
          lastPanPoint: null,
        }));
        return;
      }

      if (canvasState.isDrawing && canvasState.drawingPoints.length > 1) {
        finalizeDrawing(canvasState.drawingPoints, tool);
        clearDrawingPreview(canvas);
      }

      setCanvasState((prev) => ({
        ...prev,
        isDrawing: false,
        drawingPoints: [],
      }));
    },
    [canvasState, tool]
  );

  const handleWheel = useCallback(
    (e: fabric.TPointerEventInfo<WheelEvent>) => {
      e.e.preventDefault();
      const delta = e.e.deltaY;
      const zoomFactor = delta > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.1), 5);
      setZoom(newZoom);
    },
    [zoom, setZoom]
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

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('mouse:wheel', handleWheel);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleWheel]);

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
      className={`relative w-full h-full overflow-auto overflow-x-auto overflow-y-auto ${className}`}
      style={{ scrollbarGutter: 'stable both-edges' }}
    >
      <div
        aria-hidden
        style={{
          width: spacerWidth,
          height: spacerHeight,
          pointerEvents: 'none',
        }}
      />
      <div
        ref={hostRef}
        className="absolute"
        style={{
          top: originOffset.y,
          left: originOffset.x,
          width: hostWidth,
          height: hostHeight,
          overflow: 'visible',
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
        />
        <canvas ref={canvasRef} className="relative z-[2] block" />
      </div>

      <Rulers
        pageWidth={pageConfig.width}
        pageHeight={pageConfig.height}
        zoom={zoom}
        panOffset={panOffset}
        viewportWidth={viewportSize.width}
        viewportHeight={viewportSize.height}
        showRulers={resolvedShowRulers}
        rulerSize={rulerSize}
        originOffset={originOffset}
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

  let previewObject: fabric.Object | null = null;

  switch (tool) {
    case 'wall':
    case 'line':
      previewObject = new fabric.Line(
        [points[0].x, points[0].y, points[points.length - 1].x, points[points.length - 1].y],
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
