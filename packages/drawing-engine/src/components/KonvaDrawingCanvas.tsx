'use client';

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Rect, Circle, Ellipse, Line, Group } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { useSmartDrawingStore } from '../store';
import type { DrawingTool, Point2D } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface KonvaDrawingCanvasProps {
  className?: string;
  showGrid?: boolean;
  showRulers?: boolean;
  rulerSize?: number;
  majorGridSize?: number;
  minorGridSize?: number;
}

interface DrawnShape {
  id: string;
  type: 'rectangle' | 'circle' | 'ellipse' | 'line';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  rx?: number;
  ry?: number;
  points?: number[];
  fill: string;
  stroke: string;
  strokeWidth: number;
}

// =============================================================================
// Constants
// =============================================================================

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 32.0;
const ZOOM_STEP = 1.1;

// =============================================================================
// Grid Component (Memoized for performance)
// =============================================================================

interface GridLayerProps {
  pageWidth: number;
  pageHeight: number;
  majorGridSize: number;
  minorGridSize: number;
  zoom: number;
  visible: boolean;
}

const GridLayer = React.memo<GridLayerProps>(({
  pageWidth,
  pageHeight,
  majorGridSize,
  minorGridSize,
  zoom,
  visible,
}) => {
  if (!visible) return null;

  const minorLines: React.ReactNode[] = [];
  const majorLines: React.ReactNode[] = [];

  const minorSpacing = minorGridSize * zoom;
  const majorSpacing = majorGridSize * zoom;

  // Only render minor grid if spacing is reasonable
  if (minorSpacing >= 4 && minorSpacing <= 200) {
    for (let x = 0; x <= pageWidth; x += minorGridSize) {
      minorLines.push(
        <Line
          key={`mv-${x}`}
          points={[x, 0, x, pageHeight]}
          stroke="rgba(200, 200, 200, 0.3)"
          strokeWidth={1}
          listening={false}
        />
      );
    }
    for (let y = 0; y <= pageHeight; y += minorGridSize) {
      minorLines.push(
        <Line
          key={`mh-${y}`}
          points={[0, y, pageWidth, y]}
          stroke="rgba(200, 200, 200, 0.3)"
          strokeWidth={1}
          listening={false}
        />
      );
    }
  }

  // Major grid
  if (majorSpacing >= 4) {
    for (let x = 0; x <= pageWidth; x += majorGridSize) {
      majorLines.push(
        <Line
          key={`Mv-${x}`}
          points={[x, 0, x, pageHeight]}
          stroke="rgba(150, 150, 150, 0.5)"
          strokeWidth={1}
          listening={false}
        />
      );
    }
    for (let y = 0; y <= pageHeight; y += majorGridSize) {
      majorLines.push(
        <Line
          key={`Mh-${y}`}
          points={[0, y, pageWidth, y]}
          stroke="rgba(150, 150, 150, 0.5)"
          strokeWidth={1}
          listening={false}
        />
      );
    }
  }

  // Center guidelines
  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;

  return (
    <Group listening={false}>
      {minorLines}
      {majorLines}
      {/* Center guidelines */}
      <Line
        points={[centerX, 0, centerX, pageHeight]}
        stroke="rgba(0, 150, 255, 0.5)"
        strokeWidth={1}
        dash={[5, 5]}
        listening={false}
      />
      <Line
        points={[0, centerY, pageWidth, centerY]}
        stroke="rgba(0, 150, 255, 0.5)"
        strokeWidth={1}
        dash={[5, 5]}
        listening={false}
      />
    </Group>
  );
});

GridLayer.displayName = 'GridLayer';

// =============================================================================
// Shape Renderer (Memoized)
// =============================================================================

interface ShapeRendererProps {
  shape: DrawnShape;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const ShapeRenderer = React.memo<ShapeRendererProps>(({ shape, isSelected, onSelect }) => {
  const handleClick = useCallback(() => {
    onSelect(shape.id);
  }, [shape.id, onSelect]);

  const commonProps = {
    onClick: handleClick,
    stroke: isSelected ? '#ff6b6b' : shape.stroke,
    strokeWidth: isSelected ? 3 : shape.strokeWidth,
    draggable: true,
  };

  switch (shape.type) {
    case 'rectangle':
      return (
        <Rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          fill={shape.fill}
          {...commonProps}
        />
      );
    case 'circle':
      return (
        <Circle
          x={shape.x}
          y={shape.y}
          radius={shape.radius}
          fill={shape.fill}
          {...commonProps}
        />
      );
    case 'ellipse':
      return (
        <Ellipse
          x={shape.x}
          y={shape.y}
          radiusX={shape.rx ?? 0}
          radiusY={shape.ry ?? 0}
          fill={shape.fill}
          {...commonProps}
        />
      );
    case 'line':
      return (
        <Line
          points={shape.points}
          stroke={shape.stroke}
          strokeWidth={isSelected ? 3 : shape.strokeWidth}
          onClick={handleClick}
          draggable
        />
      );
    default:
      return null;
  }
});

ShapeRenderer.displayName = 'ShapeRenderer';

// =============================================================================
// Main Canvas Component
// =============================================================================

export const KonvaDrawingCanvas: React.FC<KonvaDrawingCanvasProps> = ({
  className = '',
  showGrid: showGridProp,
  // Rulers will be implemented as a separate overlay
  // showRulers: showRulersProp,
  // rulerSize = 30,
  majorGridSize = 100,
  minorGridSize = 10,
}) => {
  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    zoom,
    panOffset,
    setZoom,
    setPanOffset,
    pageConfig,
    showGrid: showGridStore,
    activeTool,
    setActiveTool,
  } = useSmartDrawingStore();

  const showGrid = showGridProp ?? showGridStore;

  // Local state
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [shapes, setShapes] = useState<DrawnShape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<Point2D | null>(null);
  const [previewShape, setPreviewShape] = useState<DrawnShape | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPoint = useRef<Point2D>({ x: 0, y: 0 });

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const isDrawingTool = useCallback((tool: DrawingTool): boolean => {
    return ['rectangle', 'circle', 'line', 'ellipse'].includes(tool);
  }, []);

  const generateId = useCallback(() => {
    return `shape-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  const getPointerPosition = useCallback((): Point2D | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;

    // Convert screen position to canvas coordinates
    return {
      x: (pointer.x - panOffset.x) / zoom,
      y: (pointer.y - panOffset.y) / zoom,
    };
  }, [panOffset, zoom]);

  // ==========================================================================
  // Zoom Functions
  // ==========================================================================

  const zoomAtPoint = useCallback((screenX: number, screenY: number, zoomDelta: number) => {
    const oldZoom = zoom;
    let newZoom = oldZoom * zoomDelta;
    newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

    if (newZoom === oldZoom) return;

    // Get canvas position under the cursor
    const canvasX = (screenX - panOffset.x) / oldZoom;
    const canvasY = (screenY - panOffset.y) / oldZoom;

    // Calculate new pan to keep point fixed
    const newPanX = screenX - canvasX * newZoom;
    const newPanY = screenY - canvasY * newZoom;

    setZoom(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  }, [zoom, panOffset, setZoom, setPanOffset]);

  const resetZoom = useCallback(() => {
    const newPanX = (containerSize.width - pageConfig.width) / 2;
    const newPanY = (containerSize.height - pageConfig.height) / 2;
    setZoom(1);
    setPanOffset({ x: newPanX, y: newPanY });
  }, [containerSize, pageConfig, setZoom, setPanOffset]);

  const fitToScreen = useCallback(() => {
    const padding = 50;
    const availableWidth = containerSize.width - padding * 2;
    const availableHeight = containerSize.height - padding * 2;

    const scaleX = availableWidth / pageConfig.width;
    const scaleY = availableHeight / pageConfig.height;
    const newZoom = Math.min(scaleX, scaleY, MAX_ZOOM);

    const newPanX = (containerSize.width - pageConfig.width * newZoom) / 2;
    const newPanY = (containerSize.height - pageConfig.height * newZoom) / 2;

    setZoom(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  }, [containerSize, pageConfig, setZoom, setPanOffset]);

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const delta = e.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    zoomAtPoint(pointer.x, pointer.y, delta);
  }, [zoomAtPoint]);

  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;

    // Middle click or Shift+left = pan
    if (e.evt.button === 1 || (e.evt.button === 0 && e.evt.shiftKey)) {
      e.evt.preventDefault();
      setIsPanning(true);
      lastPanPoint.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    // Left click with drawing tool
    if (e.evt.button === 0 && isDrawingTool(activeTool)) {
      const pos = getPointerPosition();
      if (!pos) return;

      setIsDrawing(true);
      setDrawStart(pos);
      setSelectedId(null);

      // Create preview shape
      const newShape: DrawnShape = {
        id: 'preview',
        type: activeTool as DrawnShape['type'],
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        radius: 0,
        rx: 0,
        ry: 0,
        points: [pos.x, pos.y, pos.x, pos.y],
        fill: getShapeFill(activeTool),
        stroke: getShapeStroke(activeTool),
        strokeWidth: 2,
      };
      setPreviewShape(newShape);
    }
  }, [activeTool, isDrawingTool, getPointerPosition]);

  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    // Handle panning
    if (isPanning) {
      const dx = e.evt.clientX - lastPanPoint.current.x;
      const dy = e.evt.clientY - lastPanPoint.current.y;
      setPanOffset({ x: panOffset.x + dx, y: panOffset.y + dy });
      lastPanPoint.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    // Handle drawing preview
    if (isDrawing && drawStart && previewShape) {
      const pos = getPointerPosition();
      if (!pos) return;

      const updatedShape = { ...previewShape };

      if (activeTool === 'rectangle') {
        const width = pos.x - drawStart.x;
        const height = pos.y - drawStart.y;
        updatedShape.x = width < 0 ? pos.x : drawStart.x;
        updatedShape.y = height < 0 ? pos.y : drawStart.y;
        updatedShape.width = Math.abs(width);
        updatedShape.height = Math.abs(height);
      } else if (activeTool === 'circle') {
        const dx = pos.x - drawStart.x;
        const dy = pos.y - drawStart.y;
        updatedShape.radius = Math.sqrt(dx * dx + dy * dy);
      } else if (activeTool === 'ellipse') {
        updatedShape.rx = Math.abs(pos.x - drawStart.x);
        updatedShape.ry = Math.abs(pos.y - drawStart.y);
        updatedShape.x = pos.x < drawStart.x ? pos.x : drawStart.x;
        updatedShape.y = pos.y < drawStart.y ? pos.y : drawStart.y;
      } else if (activeTool === 'line') {
        updatedShape.points = [drawStart.x, drawStart.y, pos.x, pos.y];
      }

      setPreviewShape(updatedShape);
    }
  }, [isPanning, isDrawing, drawStart, previewShape, activeTool, panOffset, setPanOffset, getPointerPosition]);

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDrawing && previewShape && drawStart) {
      // Check if shape has meaningful size
      const points = previewShape.points ?? [0, 0, 0, 0];
      const lineLength = Math.abs((points[2] ?? 0) - (points[0] ?? 0)) + 
                         Math.abs((points[3] ?? 0) - (points[1] ?? 0));
      const hasSize =
        (previewShape.type === 'rectangle' && (previewShape.width ?? 0) > 5 && (previewShape.height ?? 0) > 5) ||
        (previewShape.type === 'circle' && (previewShape.radius ?? 0) > 5) ||
        (previewShape.type === 'ellipse' && (previewShape.rx ?? 0) > 5 && (previewShape.ry ?? 0) > 5) ||
        (previewShape.type === 'line' && lineLength > 10);

      if (hasSize) {
        const finalShape: DrawnShape = {
          ...previewShape,
          id: generateId(),
        };
        setShapes((prev) => [...prev, finalShape]);
      }
    }

    setIsDrawing(false);
    setDrawStart(null);
    setPreviewShape(null);
  }, [isPanning, isDrawing, previewShape, drawStart, generateId]);

  const handleShapeSelect = useCallback((id: string) => {
    if (activeTool === 'select') {
      setSelectedId(id);
    }
  }, [activeTool]);

  const handleStageClick = useCallback((e: KonvaEventObject<MouseEvent>) => {
    // Deselect when clicking on empty area
    if (e.target === stageRef.current && activeTool === 'select') {
      setSelectedId(null);
    }
  }, [activeTool]);

  // ==========================================================================
  // Helper functions for shape colors
  // ==========================================================================

  function getShapeFill(tool: DrawingTool): string {
    switch (tool) {
      case 'rectangle': return 'rgba(59, 130, 246, 0.3)';
      case 'circle': return 'rgba(34, 197, 94, 0.3)';
      case 'ellipse': return 'rgba(168, 85, 247, 0.3)';
      default: return 'transparent';
    }
  }

  function getShapeStroke(tool: DrawingTool): string {
    switch (tool) {
      case 'rectangle': return '#3b82f6';
      case 'circle': return '#22c55e';
      case 'ellipse': return '#a855f7';
      case 'line': return '#ef4444';
      default: return '#333';
    }
  }

  // ==========================================================================
  // Keyboard Shortcuts
  // ==========================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          zoomAtPoint(containerSize.width / 2, containerSize.height / 2, ZOOM_STEP);
        } else if (e.key === '-') {
          e.preventDefault();
          zoomAtPoint(containerSize.width / 2, containerSize.height / 2, 1 / ZOOM_STEP);
        } else if (e.key === '0') {
          e.preventDefault();
          resetZoom();
        } else if (e.key === '1') {
          e.preventDefault();
          fitToScreen();
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v': setActiveTool('select'); break;
        case 'r': setActiveTool('rectangle'); break;
        case 'c': setActiveTool('circle'); break;
        case 'l': setActiveTool('line'); break;
        case 'delete':
        case 'backspace':
          if (selectedId) {
            setShapes((prev) => prev.filter((s) => s.id !== selectedId));
            setSelectedId(null);
          }
          break;
        case 'escape':
          setIsDrawing(false);
          setPreviewShape(null);
          setSelectedId(null);
          setActiveTool('select');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [containerSize, selectedId, zoomAtPoint, resetZoom, fitToScreen, setActiveTool]);

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
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Initial centering
  useEffect(() => {
    if (containerSize.width > 0 && containerSize.height > 0 && panOffset.x === 0 && panOffset.y === 0) {
      const initialPanX = (containerSize.width - pageConfig.width) / 2;
      const initialPanY = (containerSize.height - pageConfig.height) / 2;
      setPanOffset({ x: initialPanX, y: initialPanY });
    }
  }, [containerSize, pageConfig, panOffset, setPanOffset]);

  // ==========================================================================
  // Cursor Style
  // ==========================================================================

  const cursorStyle = useMemo(() => {
    if (isPanning) return 'grabbing';
    if (isDrawingTool(activeTool)) return 'crosshair';
    if (activeTool === 'pan') return 'grab';
    return 'default';
  }, [isPanning, activeTool, isDrawingTool]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-slate-800 ${className}`}
      style={{ cursor: cursorStyle }}
    >
      <Stage
        ref={stageRef}
        width={containerSize.width}
        height={containerSize.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleStageClick}
      >
        {/* Layer 1: Background (static, cached) */}
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={containerSize.width}
            height={containerSize.height}
            fill="#2a2a2a"
          />
        </Layer>

        {/* Layer 2: Document + Grid (transforms with zoom/pan) */}
        <Layer
          x={panOffset.x}
          y={panOffset.y}
          scaleX={zoom}
          scaleY={zoom}
          listening={false}
        >
          {/* Document background */}
          <Rect
            x={0}
            y={0}
            width={pageConfig.width}
            height={pageConfig.height}
            fill="#ffffff"
            stroke="#333333"
            strokeWidth={2}
          />
          {/* Grid */}
          <GridLayer
            pageWidth={pageConfig.width}
            pageHeight={pageConfig.height}
            majorGridSize={majorGridSize}
            minorGridSize={minorGridSize}
            zoom={zoom}
            visible={showGrid}
          />
        </Layer>

        {/* Layer 3: Shapes (transforms with zoom/pan) */}
        <Layer
          x={panOffset.x}
          y={panOffset.y}
          scaleX={zoom}
          scaleY={zoom}
        >
          {shapes.map((shape) => (
            <ShapeRenderer
              key={shape.id}
              shape={shape}
              isSelected={selectedId === shape.id}
              onSelect={handleShapeSelect}
            />
          ))}
          {/* Preview shape while drawing */}
          {previewShape && (
            <ShapeRenderer
              shape={previewShape}
              isSelected={false}
              onSelect={() => {}}
            />
          )}
        </Layer>
      </Stage>

      {/* UI Overlay - Tool indicator */}
      <div
        className="absolute top-2 left-2 bg-slate-800/90 text-slate-300 px-3 py-1.5 rounded text-xs font-medium flex items-center gap-2 pointer-events-none"
      >
        <span className="text-blue-400">Tool:</span>
        <span className="capitalize">{activeTool}</span>
        {isDrawing && <span className="text-green-400 animate-pulse">• Drawing</span>}
      </div>

      {/* Zoom indicator */}
      <div
        className="absolute top-2 right-2 bg-slate-800/90 text-slate-300 px-3 py-1.5 rounded text-xs font-mono pointer-events-none"
      >
        {(zoom * 100).toFixed(0)}%
      </div>

      {/* Help overlay */}
      <div
        className="absolute bottom-5 right-5 bg-black/80 text-white p-4 rounded-lg text-xs max-w-[300px] pointer-events-none"
      >
        <h3 className="text-sm font-semibold text-green-400 mb-2">Controls</h3>
        <ul className="space-y-1">
          <li><span className="text-green-400">▸</span> <strong>Wheel:</strong> Zoom at cursor</li>
          <li><span className="text-green-400">▸</span> <strong>Middle/Shift+Drag:</strong> Pan</li>
          <li><span className="text-green-400">▸</span> <strong>Ctrl+0:</strong> Reset | <strong>Ctrl+1:</strong> Fit</li>
        </ul>
        <h3 className="text-sm font-semibold text-blue-400 mt-2 mb-1">Tools</h3>
        <ul className="space-y-0.5">
          <li><strong>V:</strong> Select | <strong>R:</strong> Rectangle | <strong>C:</strong> Circle | <strong>L:</strong> Line</li>
          <li><strong>Del:</strong> Delete selected | <strong>Esc:</strong> Cancel</li>
        </ul>
      </div>
    </div>
  );
};

export default KonvaDrawingCanvas;
