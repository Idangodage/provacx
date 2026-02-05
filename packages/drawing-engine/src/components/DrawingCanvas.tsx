'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import * as fabric from 'fabric';
import { Grid } from './canvas/Grid';
import { Rulers } from './canvas/Rulers';
import { useSmartDrawingStore } from '../store';
import type { DrawingTool } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface DrawingCanvasProps {
  /** Additional CSS class name */
  className?: string;
  /** Callback when canvas is ready */
  onCanvasReady?: (canvas: fabric.Canvas) => void;
  /** Whether to show the grid */
  showGrid?: boolean;
  /** Whether to show rulers */
  showRulers?: boolean;
  /** Whether to snap to grid */
  snapToGrid?: boolean;
  /** Ruler size in pixels */
  rulerSize?: number;
  /** Major grid size in canvas units */
  majorGridSize?: number;
  /** Minor grid size in canvas units */
  minorGridSize?: number;
}

// =============================================================================
// Constants
// =============================================================================

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 32.0;
const ZOOM_STEP = 1.1;
const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
const MM_PER_CANVAS_UNIT = MM_PER_INCH / PX_PER_INCH;
const MIN_MAJOR_TICK_PX = 40;
const TICK_SUBDIVISIONS = 10;
const SUB_MINOR_DIVISIONS = 10;
const MIN_SUB_MINOR_MM = 0.1;

// =============================================================================
// DrawingCanvas Component
// =============================================================================

/**
 * Interactive drawing canvas with mouse-based zoom and pan.
 * 
 * Features:
 * - Mouse wheel zoom at cursor position
 * - Middle-click or Shift+click panning
 * - Adaptive grid with major/minor lines
 * - Rulers with crosshair
 * - Keyboard shortcuts (Ctrl+0 reset, Ctrl+1 fit, Ctrl++/- zoom)
 * - Integration with Fabric.js for drawing
 */
export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  className = '',
  onCanvasReady,
  showGrid: showGridProp,
  showRulers: showRulersProp,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  snapToGrid: _snapToGridProp, // Reserved for future snap-to-grid feature
  rulerSize,
  majorGridSize = 100,
  minorGridSize = 10,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricInstanceRef = useRef<fabric.Canvas | null>(null);

  const {
    zoom,
    panOffset,
    setZoom,
    setPanOffset,
    pageConfig,
    showGrid: showGridStore,
    showRulers: showRulersStore,
    zoomToFitRequestId,
    resetViewRequestId,
    activeTool,
    addSketch,
  } = useSmartDrawingStore();

  // Use props if provided, otherwise fall back to store values
  const showGrid = showGridProp ?? showGridStore;
  const showRulers = showRulersProp ?? showRulersStore;
  // Note: snapToGrid is available via snapToGridProp ?? snapToGridStore when needed

  // Local state
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPointRef = useRef({ x: 0, y: 0 });

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStartPoint, setDrawStartPoint] = useState<{ x: number; y: number } | null>(null);
  const drawingShapeRef = useRef<fabric.Object | null>(null);

  // Scale ruler size based on page dimensions (clamped for usability)
  const baseRulerSize = Math.round(Math.min(pageConfig.width, pageConfig.height) / 50);
  const scaledRulerSize = Math.max(18, Math.min(60, baseRulerSize));
  const resolvedRulerSize = rulerSize ?? scaledRulerSize;

  // Effective ruler size (0 if rulers are hidden)
  const effectiveRulerSize = showRulers ? resolvedRulerSize : 0;

  // Grid alignment with ruler ticks (mm)
  const unitsToCanvas = useCallback((valueMm: number) => valueMm / MM_PER_CANVAS_UNIT, []);
  const getAdaptiveMajorTickSpacingMm = useCallback(() => {
    const spacings = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    for (const spacing of spacings) {
      const screenSpacing = unitsToCanvas(spacing) * zoom;
      if (screenSpacing >= MIN_MAJOR_TICK_PX) {
        return spacing;
      }
    }
    return 5000;
  }, [unitsToCanvas, zoom]);

  const majorTickMm = getAdaptiveMajorTickSpacingMm();
  const minorTickMm = majorTickMm / TICK_SUBDIVISIONS;
  const subMinorTickMm = Math.max(MIN_SUB_MINOR_MM, minorTickMm / SUB_MINOR_DIVISIONS);
  const alignedMinorGridSize = unitsToCanvas(minorTickMm);
  const alignedMajorGridSize = unitsToCanvas(majorTickMm);
  const alignedSubMinorGridSize = unitsToCanvas(subMinorTickMm);
  const gridMinorSize = showRulers ? alignedMinorGridSize : minorGridSize;
  const gridMajorSize = showRulers ? alignedMajorGridSize : majorGridSize;
  const gridSubMinorSize = showRulers ? alignedSubMinorGridSize : undefined;

  // ==========================================================================
  // Coordinate Conversion
  // ==========================================================================

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => ({
      x: (screenX - panOffset.x) / zoom,
      y: (screenY - panOffset.y) / zoom,
    }),
    [panOffset, zoom]
  );

  // ==========================================================================
  // Zoom Functions
  // ==========================================================================

  /**
   * Zoom at a specific screen point (keeps that point fixed)
   */
  const zoomAtPoint = useCallback(
    (screenX: number, screenY: number, zoomDelta: number) => {
      const oldZoom = zoom;
      let newZoom = oldZoom * zoomDelta;
      newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

      if (newZoom === oldZoom) return;

      // Get canvas position under the mouse
      const canvasPoint = screenToCanvas(screenX, screenY);

      // Calculate new pan offset to keep canvas point under mouse
      const newPanX = screenX - canvasPoint.x * newZoom;
      const newPanY = screenY - canvasPoint.y * newZoom;

      // Update store - the useEffect will sync Fabric.js viewport
      setZoom(newZoom);
      setPanOffset({ x: newPanX, y: newPanY });
    },
    [zoom, screenToCanvas, setZoom, setPanOffset]
  );

  /**
   * Zoom in at center
   */
  const zoomIn = useCallback(() => {
    const centerX = containerSize.width / 2;
    const centerY = containerSize.height / 2;
    zoomAtPoint(centerX, centerY, ZOOM_STEP);
  }, [containerSize, zoomAtPoint]);

  /**
   * Zoom out at center
   */
  const zoomOut = useCallback(() => {
    const centerX = containerSize.width / 2;
    const centerY = containerSize.height / 2;
    zoomAtPoint(centerX, centerY, 1 / ZOOM_STEP);
  }, [containerSize, zoomAtPoint]);

  /**
   * Reset zoom to 100% and center the canvas
   */
  const resetZoom = useCallback(() => {
    const newPanX = (containerSize.width - pageConfig.width) / 2;
    const newPanY = (containerSize.height - pageConfig.height) / 2;

    // Update store - the useEffect will sync Fabric.js viewport
    setZoom(1);
    setPanOffset({ x: newPanX, y: newPanY });
  }, [containerSize, pageConfig, setZoom, setPanOffset]);

  /**
   * Fit canvas to screen
   */
  const fitToScreen = useCallback(() => {
    const padding = 50;
    const availableWidth = containerSize.width - padding * 2 - effectiveRulerSize;
    const availableHeight = containerSize.height - padding * 2 - effectiveRulerSize;

    const scaleX = availableWidth / pageConfig.width;
    const scaleY = availableHeight / pageConfig.height;
    const newZoom = Math.min(scaleX, scaleY, MAX_ZOOM);

    const newPanX = (containerSize.width - pageConfig.width * newZoom) / 2;
    const newPanY = (containerSize.height - pageConfig.height * newZoom) / 2;

    // Update store - the useEffect will sync Fabric.js viewport
    setZoom(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  }, [containerSize, pageConfig, effectiveRulerSize, setZoom, setPanOffset]);

  // ==========================================================================
  // Drawing Tool Helpers
  // ==========================================================================

  /**
   * Check if the current tool is a shape drawing tool
   */
  const isDrawingTool = useCallback((tool: DrawingTool): boolean => {
    return ['rectangle', 'circle', 'line', 'ellipse'].includes(tool);
  }, []);

  /**
   * Get cursor style based on current tool
   */
  const getCursorStyle = useCallback((): string => {
    if (isPanning) return 'grabbing';
    if (isDrawingTool(activeTool)) return 'crosshair';
    if (activeTool === 'pan') return 'grab';
    if (activeTool === 'select') return 'default';
    return 'crosshair';
  }, [isPanning, activeTool, isDrawingTool]);

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Handle mouse wheel for zoom
   */
  const handleWheel = useCallback(
    (clientX: number, clientY: number, deltaY: number, deltaMode: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      let normalizedDelta = deltaY;

      if (deltaMode === 1) {
        normalizedDelta *= 16;
      } else if (deltaMode === 2) {
        normalizedDelta *= Math.max(1, rect.height);
      }

      if (Math.abs(normalizedDelta) < 0.01) return;

      const zoomDelta = Math.exp(-normalizedDelta * 0.001);
      zoomAtPoint(mouseX, mouseY, zoomDelta);
    },
    [zoomAtPoint]
  );

  /**
   * Handle mouse down for panning and drawing
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Middle click or Shift + left click = panning
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        setIsPanning(true);
        lastPanPointRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      // Left click with drawing tool = start drawing
      if (e.button === 0 && isDrawingTool(activeTool) && fabricInstanceRef.current) {
        e.preventDefault();
        const canvasPoint = screenToCanvas(mouseX, mouseY);
        setIsDrawing(true);
        setDrawStartPoint(canvasPoint);

        const canvas = fabricInstanceRef.current;

        // Create preview shape based on tool
        let shape: fabric.Object | null = null;

        if (activeTool === 'rectangle') {
          shape = new fabric.Rect({
            left: canvasPoint.x,
            top: canvasPoint.y,
            width: 0,
            height: 0,
            fill: 'rgba(59, 130, 246, 0.3)',
            stroke: '#3b82f6',
            strokeWidth: 2,
            selectable: false,
            evented: false,
          });
        } else if (activeTool === 'circle') {
          shape = new fabric.Circle({
            left: canvasPoint.x,
            top: canvasPoint.y,
            radius: 0,
            fill: 'rgba(34, 197, 94, 0.3)',
            stroke: '#22c55e',
            strokeWidth: 2,
            selectable: false,
            evented: false,
          });
        } else if (activeTool === 'ellipse') {
          shape = new fabric.Ellipse({
            left: canvasPoint.x,
            top: canvasPoint.y,
            rx: 0,
            ry: 0,
            fill: 'rgba(168, 85, 247, 0.3)',
            stroke: '#a855f7',
            strokeWidth: 2,
            selectable: false,
            evented: false,
          });
        } else if (activeTool === 'line') {
          shape = new fabric.Line(
            [canvasPoint.x, canvasPoint.y, canvasPoint.x, canvasPoint.y],
            {
              stroke: '#ef4444',
              strokeWidth: 2,
              selectable: false,
              evented: false,
            }
          );
        }

        if (shape) {
          drawingShapeRef.current = shape;
          canvas.add(shape);
          canvas.requestRenderAll();
        }
      }
    },
    [activeTool, isDrawingTool, screenToCanvas, zoom]
  );

  /**
   * Handle mouse move for panning, drawing, and tracking
   */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setMousePosition({ x: mouseX, y: mouseY });

      // Handle panning
      if (isPanning) {
        const dx = e.clientX - lastPanPointRef.current.x;
        const dy = e.clientY - lastPanPointRef.current.y;

        const newPanX = panOffset.x + dx;
        const newPanY = panOffset.y + dy;

        // Update store - the useEffect will sync Fabric.js viewport
        setPanOffset({ x: newPanX, y: newPanY });
        lastPanPointRef.current = { x: e.clientX, y: e.clientY };
        return;
      }

      // Handle drawing preview
      if (isDrawing && drawStartPoint && drawingShapeRef.current && fabricInstanceRef.current) {
        const canvasPoint = screenToCanvas(mouseX, mouseY);
        const shape = drawingShapeRef.current;

        if (activeTool === 'rectangle' && shape instanceof fabric.Rect) {
          const width = canvasPoint.x - drawStartPoint.x;
          const height = canvasPoint.y - drawStartPoint.y;

          // Handle negative dimensions (dragging left/up)
          shape.set({
            left: width < 0 ? canvasPoint.x : drawStartPoint.x,
            top: height < 0 ? canvasPoint.y : drawStartPoint.y,
            width: Math.abs(width),
            height: Math.abs(height),
          });
        } else if (activeTool === 'circle' && shape instanceof fabric.Circle) {
          const dx = canvasPoint.x - drawStartPoint.x;
          const dy = canvasPoint.y - drawStartPoint.y;
          const radius = Math.sqrt(dx * dx + dy * dy);

          shape.set({
            radius: radius,
          });
        } else if (activeTool === 'ellipse' && shape instanceof fabric.Ellipse) {
          const rx = Math.abs(canvasPoint.x - drawStartPoint.x);
          const ry = Math.abs(canvasPoint.y - drawStartPoint.y);

          shape.set({
            left: canvasPoint.x < drawStartPoint.x ? canvasPoint.x : drawStartPoint.x,
            top: canvasPoint.y < drawStartPoint.y ? canvasPoint.y : drawStartPoint.y,
            rx: rx,
            ry: ry,
          });
        } else if (activeTool === 'line' && shape instanceof fabric.Line) {
          shape.set({
            x2: canvasPoint.x,
            y2: canvasPoint.y,
          });
        }

        fabricInstanceRef.current.requestRenderAll();
      }
    },
    [isPanning, isDrawing, drawStartPoint, panOffset, zoom, setPanOffset, screenToCanvas, activeTool]
  );

  /**
   * Handle mouse up to stop panning or finalize drawing
   */
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // Stop panning
      if (isPanning) {
        setIsPanning(false);
        return;
      }

      // Finalize drawing
      if (isDrawing && drawStartPoint && drawingShapeRef.current && fabricInstanceRef.current) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const canvasPoint = screenToCanvas(mouseX, mouseY);
        const shape = drawingShapeRef.current;

        // Check if shape has meaningful size
        const hasSize =
          (activeTool === 'rectangle' && (shape as fabric.Rect).width! > 5 && (shape as fabric.Rect).height! > 5) ||
          (activeTool === 'circle' && (shape as fabric.Circle).radius! > 5) ||
          (activeTool === 'ellipse' && (shape as fabric.Ellipse).rx! > 5 && (shape as fabric.Ellipse).ry! > 5) ||
          (activeTool === 'line' && Math.abs(canvasPoint.x - drawStartPoint.x) + Math.abs(canvasPoint.y - drawStartPoint.y) > 10);

        if (hasSize) {
          // Make shape selectable and interactive
          shape.set({
            selectable: true,
            evented: true,
            strokeWidth: 2,
          });

          // Store shape in the drawing store
          if (activeTool === 'rectangle') {
            const rectShape = shape as fabric.Rect;
            addSketch({
              type: 'rectangle',
              points: [
                { x: rectShape.left!, y: rectShape.top! },
                { x: rectShape.left! + rectShape.width!, y: rectShape.top! + rectShape.height! },
              ],
            });
          } else if (activeTool === 'circle') {
            const circleShape = shape as fabric.Circle;
            addSketch({
              type: 'circle',
              points: [{ x: circleShape.left!, y: circleShape.top! }],
              radius: circleShape.radius!,
            });
          } else if (activeTool === 'ellipse') {
            const ellipseShape = shape as fabric.Ellipse;
            addSketch({
              type: 'ellipse',
              points: [{ x: ellipseShape.left!, y: ellipseShape.top! }],
              rx: ellipseShape.rx!,
              ry: ellipseShape.ry!,
            });
          } else if (activeTool === 'line') {
            addSketch({
              type: 'line',
              points: [drawStartPoint, canvasPoint],
            });
          }

          fabricInstanceRef.current.setActiveObject(shape);
        } else {
          // Remove shape if too small
          fabricInstanceRef.current.remove(shape);
        }

        fabricInstanceRef.current.requestRenderAll();
      }

      // Reset drawing state
      setIsDrawing(false);
      setDrawStartPoint(null);
      drawingShapeRef.current = null;
    },
    [isPanning, isDrawing, drawStartPoint, screenToCanvas, activeTool, addSketch]
  );

  /**
   * Handle mouse leave
   */
  const handleMouseLeave = useCallback(() => {
    setMousePosition(null);
    setIsPanning(false);
    
    // Cancel drawing if mouse leaves
    if (isDrawing && drawingShapeRef.current && fabricInstanceRef.current) {
      fabricInstanceRef.current.remove(drawingShapeRef.current);
      fabricInstanceRef.current.requestRenderAll();
    }
    setIsDrawing(false);
    setDrawStartPoint(null);
    drawingShapeRef.current = null;
  }, [isDrawing]);

  // ==========================================================================
  // Keyboard Shortcuts
  // ==========================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Zoom shortcuts (Ctrl/Cmd + key)
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          zoomIn();
        } else if (e.key === '-') {
          e.preventDefault();
          zoomOut();
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        } else if (e.key === '1') {
          e.preventDefault();
          fitToScreen();
        }
        return;
      }

      // Tool shortcuts (single key)
      const { setActiveTool } = useSmartDrawingStore.getState();
      switch (e.key.toLowerCase()) {
        case 'v':
          setActiveTool('select');
          break;
        case 'h':
          setActiveTool('pan');
          break;
        case 'r':
          setActiveTool('rectangle');
          break;
        case 'c':
          setActiveTool('circle');
          break;
        case 'l':
          setActiveTool('line');
          break;
        case 'escape':
          // Cancel current drawing and switch to select
          if (isDrawing && drawingShapeRef.current && fabricInstanceRef.current) {
            fabricInstanceRef.current.remove(drawingShapeRef.current);
            fabricInstanceRef.current.requestRenderAll();
          }
          setIsDrawing(false);
          setDrawStartPoint(null);
          drawingShapeRef.current = null;
          setActiveTool('select');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut, resetZoom, fitToScreen, isDrawing]);

  // ==========================================================================
  // Resize Observer
  // ==========================================================================

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });

        // Update Fabric.js canvas size
        if (fabricInstanceRef.current) {
          fabricInstanceRef.current.setDimensions({ width, height });
          fabricInstanceRef.current.requestRenderAll();
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Prevent page scroll and handle zoom on wheel
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleWheel(e.clientX, e.clientY, e.deltaY, e.deltaMode);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [handleWheel]);

  // ==========================================================================
  // Fabric.js Initialization
  // ==========================================================================

  useEffect(() => {
    if (!fabricCanvasRef.current || containerSize.width === 0 || containerSize.height === 0) return;
    if (fabricInstanceRef.current) return; // Already initialized

    const canvas = new fabric.Canvas(fabricCanvasRef.current, {
      width: containerSize.width,
      height: containerSize.height,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true,
      renderOnAddRemove: true,
    });

    fabricInstanceRef.current = canvas;

    // Initial view setup - center the document
    const initialPanX = (containerSize.width - pageConfig.width) / 2;
    const initialPanY = (containerSize.height - pageConfig.height) / 2;
    setPanOffset({ x: initialPanX, y: initialPanY });

    // Set initial Fabric.js viewport transform to match
    // Fabric viewport transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
    canvas.setViewportTransform([1, 0, 0, 1, initialPanX, initialPanY]);
    canvas.requestRenderAll();

    if (onCanvasReady) {
      onCanvasReady(canvas);
    }

    return () => {
      canvas.dispose();
      fabricInstanceRef.current = null;
    };
  }, [containerSize.width, containerSize.height, pageConfig, onCanvasReady, setPanOffset]);

  // ==========================================================================
  // Sync Fabric.js viewport with store zoom/pan
  // ==========================================================================

  useEffect(() => {
    if (!fabricInstanceRef.current) return;

    // Update Fabric.js viewport transform to match our pan/zoom state
    // Fabric viewport transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
    const vpt: [number, number, number, number, number, number] = [
      zoom,      // scaleX
      0,         // skewX
      0,         // skewY
      zoom,      // scaleY
      panOffset.x, // translateX
      panOffset.y, // translateY
    ];
    
    fabricInstanceRef.current.setViewportTransform(vpt);
    fabricInstanceRef.current.requestRenderAll();
  }, [zoom, panOffset]);

  // ==========================================================================
  // Respond to store zoom/pan requests
  // ==========================================================================

  useEffect(() => {
    if (zoomToFitRequestId > 0) {
      fitToScreen();
    }
  }, [zoomToFitRequestId, fitToScreen]);

  useEffect(() => {
    if (resetViewRequestId > 0) {
      resetZoom();
    }
  }, [resetViewRequestId, resetZoom]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ cursor: getCursorStyle() }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* Grid Layer */}
      <Grid
        width={containerSize.width}
        height={containerSize.height}
        zoom={zoom}
        panX={panOffset.x}
        panY={panOffset.y}
        pageWidth={pageConfig.width}
        pageHeight={pageConfig.height}
        majorGridSize={gridMajorSize}
        minorGridSize={gridMinorSize}
        subMinorGridSize={gridSubMinorSize}
        visible={showGrid}
        showGuidelines={false}
        backgroundColor="#f3f4f6"
      />

      {/* Fabric.js Canvas */}
      <canvas
        ref={fabricCanvasRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          zIndex: 10,
        }}
      />

      {/* Rulers Layer (on top) */}
      <Rulers
        width={containerSize.width}
        height={containerSize.height}
        zoom={zoom}
        panX={panOffset.x}
        panY={panOffset.y}
        pageWidth={pageConfig.width}
        pageHeight={pageConfig.height}
        majorTickMm={majorTickMm}
        tickSubdivisions={TICK_SUBDIVISIONS}
        rulerSize={resolvedRulerSize}
        visible={showRulers}
        mousePosition={mousePosition}
        showCrosshair={true}
      />


      {/* Coordinate Display */}
      {mousePosition && (
        <div
          className="absolute top-2 right-2 bg-slate-800/90 text-slate-300 px-3 py-1.5 rounded text-xs font-mono"
          style={{ zIndex: 200 }}
        >
          Canvas: ({Math.round(screenToCanvas(mousePosition.x, mousePosition.y).x)},{' '}
          {Math.round(screenToCanvas(mousePosition.x, mousePosition.y).y)}) | Screen: (
          {Math.round(mousePosition.x)}, {Math.round(mousePosition.y)})
        </div>
      )}

      {/* Active Tool Indicator */}
      <div
        className="absolute top-2 left-2 bg-slate-800/90 text-slate-300 px-3 py-1.5 rounded text-xs font-medium flex items-center gap-2"
        style={{ zIndex: 200 }}
      >
        <span className="text-blue-400">Tool:</span>
        <span className="capitalize">{activeTool}</span>
        {isDrawing && (
          <span className="text-green-400 animate-pulse">• Drawing</span>
        )}
      </div>
    </div>
  );
};

export default DrawingCanvas;
