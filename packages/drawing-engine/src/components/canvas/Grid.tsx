'use client';

import React, { useEffect, useRef, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface GridProps {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Current zoom level (1.0 = 100%) */
  zoom: number;
  /** Pan offset X in screen pixels */
  panX: number;
  /** Pan offset Y in screen pixels */
  panY: number;
  /** Document/page width in canvas units */
  pageWidth: number;
  /** Document/page height in canvas units */
  pageHeight: number;
  /** Major grid size in canvas units (default: 100) */
  majorGridSize?: number;
  /** Minor grid size in canvas units (default: 10) */
  minorGridSize?: number;
  /** Sub-minor grid size in canvas units (optional) */
  subMinorGridSize?: number;
  /** Whether to show the grid */
  visible?: boolean;
  /** Whether to show center guidelines */
  showGuidelines?: boolean;
  /** Major grid color */
  majorGridColor?: string;
  /** Minor grid color */
  minorGridColor?: string;
  /** Sub-minor grid color */
  subMinorGridColor?: string;
  /** Pixel grid color (legacy, currently unused) */
  pixelGridColor?: string;
  /** Guideline color */
  guidelineColor?: string;
  /** Background color outside document */
  backgroundColor?: string;
  /** Document background color */
  documentColor?: string;
  /** Document border color */
  documentBorderColor?: string;
}

// =============================================================================
// Grid Component
// =============================================================================

/**
 * High-performance canvas-based grid renderer with adaptive visibility.
 * 
 * Features:
 * - Major grid lines (every 100 units by default)
 * - Minor grid lines (every 10 units by default)
 * - Optional sub-minor grid at high zoom
 * - Center guidelines
 * - Automatic visibility based on zoom level
 * - Renders only visible area for performance
 */
export const Grid: React.FC<GridProps> = ({
  width,
  height,
  zoom,
  panX,
  panY,
  pageWidth,
  pageHeight,
  majorGridSize = 100,
  minorGridSize = 10,
  subMinorGridSize,
  visible = true,
  showGuidelines = true,
  majorGridColor = 'rgba(150, 150, 150, 0.5)',
  minorGridColor = 'rgba(200, 200, 200, 0.3)',
  subMinorGridColor = 'rgba(220, 220, 220, 0.35)',
  pixelGridColor: _pixelGridColor = 'rgba(180, 180, 180, 0.2)',
  guidelineColor = 'rgba(0, 150, 255, 0.5)',
  backgroundColor = '#2a2a2a',
  documentColor = '#ffffff',
  documentBorderColor = '#333333',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Convert screen coordinates to canvas (document) coordinates
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => ({
      x: (screenX - panX) / zoom,
      y: (screenY - panY) / zoom,
    }),
    [panX, panY, zoom]
  );

  // Get visible canvas area in document coordinates
  const getVisibleCanvasArea = useCallback(() => {
    const topLeft = screenToCanvas(0, 0);
    const bottomRight = screenToCanvas(width, height);

    return {
      left: Math.max(0, topLeft.x),
      top: Math.max(0, topLeft.y),
      right: Math.min(pageWidth, bottomRight.x),
      bottom: Math.min(pageHeight, bottomRight.y),
    };
  }, [screenToCanvas, width, height, pageWidth, pageHeight]);

  // Draw grid lines for a given spacing
  const drawGridLines = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      spacing: number,
      viewport: ReturnType<typeof getVisibleCanvasArea>
    ) => {
      ctx.beginPath();

      // Vertical lines
      const startX = Math.floor(viewport.left / spacing) * spacing;
      for (let x = startX; x <= viewport.right; x += spacing) {
        ctx.moveTo(x, viewport.top);
        ctx.lineTo(x, viewport.bottom);
      }

      // Horizontal lines
      const startY = Math.floor(viewport.top / spacing) * spacing;
      for (let y = startY; y <= viewport.bottom; y += spacing) {
        ctx.moveTo(viewport.left, y);
        ctx.lineTo(viewport.right, y);
      }

      ctx.stroke();
    },
    []
  );

  // Main render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw outer background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Save context and apply transform
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw document background
    ctx.fillStyle = documentColor;
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    // Draw document border
    ctx.strokeStyle = documentBorderColor;
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(0, 0, pageWidth, pageHeight);

    // Draw grids if visible
    if (visible) {
      const viewport = getVisibleCanvasArea();
      const subMinorSpacing = (subMinorGridSize ?? 0) * zoom;
      const minorSpacing = minorGridSize * zoom;
      const majorSpacing = majorGridSize * zoom;

      // Sub-minor grid (only when spacing is reasonable)
      if (subMinorGridSize && subMinorSpacing >= 4) {
        ctx.strokeStyle = subMinorGridColor;
        ctx.lineWidth = 1 / zoom;
        drawGridLines(ctx, subMinorGridSize, viewport);
      }

      // Minor grid - only show when spacing is reasonable (4-200 screen pixels)
      if (minorSpacing >= 4 && minorSpacing <= 200) {
        ctx.strokeStyle = minorGridColor;
        ctx.lineWidth = 1 / zoom;
        drawGridLines(ctx, minorGridSize, viewport);
      }

      // Major grid - show when spacing >= 4 screen pixels
      if (majorSpacing >= 4) {
        ctx.strokeStyle = majorGridColor;
        ctx.lineWidth = 1 / zoom;
        drawGridLines(ctx, majorGridSize, viewport);
      }

      // Pixel grid disabled to avoid double sub-grids when aligned to ruler ticks
    }

    // Center guidelines removed

    ctx.restore();
  }, [
    width,
    height,
    zoom,
    panX,
    panY,
    pageWidth,
    pageHeight,
    majorGridSize,
    minorGridSize,
    subMinorGridSize,
    visible,
    showGuidelines,
    majorGridColor,
    minorGridColor,
    subMinorGridColor,
    guidelineColor,
    backgroundColor,
    documentColor,
    documentBorderColor,
    getVisibleCanvasArea,
    drawGridLines,
  ]);

  // Re-render when dependencies change
  useEffect(() => {
    render();
  }, [render]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
};

export default Grid;
