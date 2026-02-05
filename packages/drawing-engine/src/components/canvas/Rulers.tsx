'use client';

import React, { useEffect, useRef, useCallback } from 'react';

// =============================================================================
// Constants
// =============================================================================

const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
const MM_PER_CANVAS_UNIT = MM_PER_INCH / PX_PER_INCH;
const MIN_LABEL_SPACING_PX = 45;
const MIN_MAJOR_TICK_PX = 40;
const MIN_SUB_TICK_PX = 3;
const TICK_SUBDIVISIONS = 10;

// =============================================================================
// Types
// =============================================================================

export interface RulersProps {
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
  /** Major tick spacing in mm (optional, overrides adaptive spacing) */
  majorTickMm?: number;
  /** Sub-division count between major ticks */
  tickSubdivisions?: number;
  /** Ruler thickness in screen pixels (default: 30) */
  rulerSize?: number;
  /** Whether to show rulers */
  visible?: boolean;
  /** Current mouse position in screen coordinates (for crosshair) */
  mousePosition?: { x: number; y: number } | null;
  /** Whether to show crosshair lines */
  showCrosshair?: boolean;
  /** Ruler background color */
  backgroundColor?: string;
  /** Ruler tick color */
  tickColor?: string;
  /** Ruler text color */
  textColor?: string;
  /** Crosshair color */
  crosshairColor?: string;
  /** Corner background color */
  cornerColor?: string;
}

// =============================================================================
// Rulers Component
// =============================================================================

/**
 * Canvas-based rulers with adaptive tick spacing.
 * 
 * Features:
 * - Horizontal and vertical rulers
 * - Adaptive tick density based on zoom level
 * - Crosshair following mouse cursor
 * - Numbers show canvas coordinates
 * - Fixed UI size (doesn't scale with zoom)
 */
export const Rulers: React.FC<RulersProps> = ({
  width,
  height,
  zoom,
  panX,
  panY,
  pageWidth,
  pageHeight,
  majorTickMm: majorTickMmProp,
  tickSubdivisions = TICK_SUBDIVISIONS,
  rulerSize = 30,
  visible = true,
  mousePosition = null,
  showCrosshair = true,
  backgroundColor = '#e5e5e5',
  tickColor = '#666666',
  textColor = '#333333',
  crosshairColor = 'rgba(255, 100, 100, 0.5)',
  cornerColor = '#e5e5e5',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Convert canvas coordinates to screen position
  const canvasToScreen = useCallback(
    (canvasX: number, canvasY: number) => ({
      x: canvasX * zoom + panX,
      y: canvasY * zoom + panY,
    }),
    [zoom, panX, panY]
  );

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => ({
      x: (screenX - panX) / zoom,
      y: (screenY - panY) / zoom,
    }),
    [zoom, panX, panY]
  );

  // Convert canvas units to ruler units (mm)
  const canvasToUnits = useCallback((value: number) => value * MM_PER_CANVAS_UNIT, []);

  // Convert ruler units (mm) to canvas units
  const unitsToCanvas = useCallback((value: number) => value / MM_PER_CANVAS_UNIT, []);

  // Get page bounds in screen coordinates
  const getPageBounds = useCallback(() => {
    const left = panX;
    const top = panY;
    const right = panX + pageWidth * zoom;
    const bottom = panY + pageHeight * zoom;

    return { left, top, right, bottom };
  }, [panX, panY, pageWidth, pageHeight, zoom]);

  // Get ruler bounds, clamped to canvas edges when page goes out of view
  const getRulerBounds = useCallback(() => {
    const { left: pageLeft, top: pageTop, right: pageRight, bottom: pageBottom } = getPageBounds();
    const maxRulerTop = Math.max(0, height - rulerSize);
    const maxRulerLeft = Math.max(0, width - rulerSize);
    const rulerTop = Math.min(Math.max(pageTop - rulerSize, 0), maxRulerTop);
    const rulerLeft = Math.min(Math.max(pageLeft - rulerSize, 0), maxRulerLeft);
    const rulerBottom = rulerTop + rulerSize;
    const rulerRight = rulerLeft + rulerSize;

    return {
      pageLeft,
      pageTop,
      pageRight,
      pageBottom,
      rulerTop,
      rulerBottom,
      rulerLeft,
      rulerRight,
    };
  }, [getPageBounds, width, height, rulerSize]);

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

  // Calculate adaptive major tick spacing based on zoom
  const getAdaptiveTickSpacing = useCallback(() => {
    if (majorTickMmProp && majorTickMmProp > 0) {
      return majorTickMmProp;
    }
    const spacings = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; // mm

    for (const spacing of spacings) {
      const screenSpacing = unitsToCanvas(spacing) * zoom;
      if (screenSpacing >= MIN_MAJOR_TICK_PX) {
        return spacing;
      }
    }

    return 5000;
  }, [majorTickMmProp, zoom, unitsToCanvas]);

  const isMultiple = useCallback((value: number, interval: number) => {
    if (interval === 0) return false;
    const ratio = value / interval;
    return Math.abs(ratio - Math.round(ratio)) < 1e-6;
  }, []);

  const formatLabel = useCallback((value: number) => {
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) < 1e-6) {
      return rounded.toString();
    }

    const oneDecimal = Math.round(value * 10) / 10;
    if (Math.abs(value - oneDecimal) < 1e-6) {
      return oneDecimal.toFixed(1);
    }

    return value.toFixed(2).replace(/\.?0+$/, '');
  }, []);

  // Draw horizontal ruler (top)
  const drawHorizontalRuler = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const viewport = getVisibleCanvasArea();
      const majorTickMm = getAdaptiveTickSpacing();
      const subTickMm = majorTickMm / Math.max(1, tickSubdivisions);
      const midTickMm = majorTickMm / 2;
      const majorSpacingPx = unitsToCanvas(majorTickMm) * zoom;
      const showSubTicks = unitsToCanvas(subTickMm) * zoom >= MIN_SUB_TICK_PX;
      const showMidLabels = showSubTicks && majorSpacingPx >= MIN_LABEL_SPACING_PX * 2;
      const { pageLeft, pageRight, rulerTop, rulerBottom } = getRulerBounds();

      ctx.fillStyle = textColor;
      ctx.strokeStyle = tickColor;
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const viewportLeft = canvasToUnits(viewport.left);
      const viewportRight = canvasToUnits(viewport.right);
      // Sub-ticks
      if (showSubTicks) {
        const startSub = Math.floor(viewportLeft / subTickMm) * subTickMm;
        for (let value = startSub; value <= viewportRight; value += subTickMm) {
          if (isMultiple(value, majorTickMm)) continue;

          const canvasX = unitsToCanvas(value);
          const x = canvasToScreen(canvasX, 0).x;

          if (x < pageLeft || x > pageRight) continue;

          const isMid = isMultiple(value, midTickMm);
          const tickHeight = isMid ? 8 : 4;

          ctx.beginPath();
          ctx.moveTo(x, rulerBottom - tickHeight);
          ctx.lineTo(x, rulerBottom);
          ctx.stroke();

          if (isMid && showMidLabels) {
            ctx.fillText(formatLabel(value), x, rulerTop + 2);
          }
        }
      }

      // Major ticks + labels
      let lastLabelX = -Infinity;
      const startMajor = Math.floor(viewportLeft / majorTickMm) * majorTickMm;
      for (let value = startMajor; value <= viewportRight; value += majorTickMm) {
        const canvasX = unitsToCanvas(value);
        const x = canvasToScreen(canvasX, 0).x;

        if (x < pageLeft || x > pageRight) continue;

        ctx.beginPath();
        ctx.moveTo(x, rulerBottom - 15);
        ctx.lineTo(x, rulerBottom);
        ctx.stroke();

        if (x - lastLabelX >= MIN_LABEL_SPACING_PX) {
          ctx.fillText(formatLabel(value), x, rulerTop + 2);
          lastLabelX = x;
        }
      }
    },
    [getVisibleCanvasArea, getAdaptiveTickSpacing, getRulerBounds, canvasToUnits, unitsToCanvas, canvasToScreen, isMultiple, formatLabel, textColor, tickColor, tickSubdivisions, zoom]
  );

  // Draw vertical ruler (left)
  const drawVerticalRuler = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const viewport = getVisibleCanvasArea();
      const majorTickMm = getAdaptiveTickSpacing();
      const subTickMm = majorTickMm / Math.max(1, tickSubdivisions);
      const midTickMm = majorTickMm / 2;
      const majorSpacingPx = unitsToCanvas(majorTickMm) * zoom;
      const showSubTicks = unitsToCanvas(subTickMm) * zoom >= MIN_SUB_TICK_PX;
      const showMidLabels = showSubTicks && majorSpacingPx >= MIN_LABEL_SPACING_PX * 2;
      const { pageTop, pageBottom, rulerRight } = getRulerBounds();

      ctx.fillStyle = textColor;
      ctx.strokeStyle = tickColor;
      ctx.font = '11px Arial';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      const viewportTop = canvasToUnits(viewport.top);
      const viewportBottom = canvasToUnits(viewport.bottom);
      // Sub-ticks
      if (showSubTicks) {
        const startSub = Math.floor(viewportTop / subTickMm) * subTickMm;
        for (let value = startSub; value <= viewportBottom; value += subTickMm) {
          if (isMultiple(value, majorTickMm)) continue;

          const canvasY = unitsToCanvas(value);
          const y = canvasToScreen(0, canvasY).y;

          if (y < pageTop || y > pageBottom) continue;

          const isMid = isMultiple(value, midTickMm);
          const tickWidth = isMid ? 8 : 4;

          ctx.beginPath();
          ctx.moveTo(rulerRight - tickWidth, y);
          ctx.lineTo(rulerRight, y);
          ctx.stroke();

          if (isMid && showMidLabels) {
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(formatLabel(value), rulerRight - rulerSize / 2, y - 2);
            ctx.restore();
          }
        }
      }

      // Major ticks + labels
      let lastLabelY = -Infinity;
      const startMajor = Math.floor(viewportTop / majorTickMm) * majorTickMm;
      for (let value = startMajor; value <= viewportBottom; value += majorTickMm) {
        const canvasY = unitsToCanvas(value);
        const y = canvasToScreen(0, canvasY).y;

        if (y < pageTop || y > pageBottom) continue;

        ctx.beginPath();
        ctx.moveTo(rulerRight - 15, y);
        ctx.lineTo(rulerRight, y);
        ctx.stroke();

        if (y - lastLabelY >= MIN_LABEL_SPACING_PX) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(formatLabel(value), rulerRight - rulerSize / 2, y - 2);
          ctx.restore();
          lastLabelY = y;
        }
      }
    },
    [getVisibleCanvasArea, getAdaptiveTickSpacing, getRulerBounds, canvasToUnits, unitsToCanvas, canvasToScreen, isMultiple, formatLabel, textColor, tickColor, tickSubdivisions, zoom, rulerSize]
  );

  // Draw crosshair lines following mouse
  const drawCrosshair = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!mousePosition || mousePosition.x < 0 || mousePosition.y < 0) return;

      const { x, y } = mousePosition;
      const {
        pageLeft,
        pageTop,
        pageRight,
        pageBottom,
        rulerTop,
        rulerBottom,
        rulerLeft,
        rulerRight,
      } = getRulerBounds();

      if (x < pageLeft || x > pageRight || y < pageTop || y > pageBottom) return;

      ctx.strokeStyle = crosshairColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(x, pageTop);
      ctx.lineTo(x, pageBottom);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(pageLeft, y);
      ctx.lineTo(pageRight, y);
      ctx.stroke();

      ctx.setLineDash([]);

      // Draw position indicators on rulers
      const canvasPos = screenToCanvas(x, y);
      const unitPos = {
        x: canvasToUnits(canvasPos.x),
        y: canvasToUnits(canvasPos.y),
      };

      // Highlight on horizontal ruler
      ctx.fillStyle = 'rgba(255, 100, 100, 0.3)';
      ctx.fillRect(x - 1, rulerTop, 2, rulerSize);

      // Highlight on vertical ruler
      ctx.fillRect(rulerLeft, y - 1, rulerSize, 2);

      // Show coordinates on ruler corners
      ctx.fillStyle = textColor;
      ctx.font = 'bold 9px Arial';

      // X coordinate on horizontal ruler
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(formatLabel(unitPos.x), x, rulerBottom - 2);

      // Y coordinate on vertical ruler
      ctx.save();
      ctx.translate(rulerRight - 2, y);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(formatLabel(unitPos.y), 0, 0);
      ctx.restore();
    },
    [mousePosition, crosshairColor, rulerSize, screenToCanvas, canvasToUnits, formatLabel, textColor, getRulerBounds]
  );

  // Main render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    const { pageLeft, pageTop, pageRight, pageBottom, rulerTop, rulerBottom, rulerLeft, rulerRight } = getRulerBounds();
    const rulerWidth = pageRight - pageLeft;
    const rulerHeight = pageBottom - pageTop;

    // Draw ruler backgrounds
    // Top ruler
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(pageLeft, rulerTop, rulerWidth, rulerSize);

    // Left ruler
    ctx.fillRect(rulerLeft, pageTop, rulerSize, rulerHeight);

    // Corner
    ctx.fillStyle = cornerColor;
    ctx.fillRect(rulerLeft, rulerTop, rulerSize, rulerSize);

    // Draw ticks and numbers
    drawHorizontalRuler(ctx);
    drawVerticalRuler(ctx);

    // Draw crosshair
    if (showCrosshair) {
      drawCrosshair(ctx);
    }
  }, [
    width,
    height,
    visible,
    rulerSize,
    backgroundColor,
    cornerColor,
    tickColor,
    showCrosshair,
    drawHorizontalRuler,
    drawVerticalRuler,
    drawCrosshair,
    getRulerBounds,
  ]);

  // Re-render when dependencies change
  useEffect(() => {
    render();
  }, [render]);

  if (!visible) return null;

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
        zIndex: 100,
      }}
    />
  );
};

export default Rulers;
