/**
 * Coordinate System Utilities
 * 
 * Professional CAD-style coordinate system handling for the drawing engine.
 * Provides consistent transformations between screen, canvas, and world coordinates.
 */

import type { Point2D } from '../types';

// =============================================================================
// Constants
// =============================================================================

/** Pixels per inch at 100% zoom (standard CSS DPI) */
export const PX_PER_INCH = 96;

/** Millimeters per inch */
export const MM_PER_INCH = 25.4;

/** Conversion factor: pixels to millimeters */
export const PX_TO_MM = MM_PER_INCH / PX_PER_INCH;

/** Conversion factor: millimeters to pixels */
export const MM_TO_PX = PX_PER_INCH / MM_PER_INCH;

// =============================================================================
// Grid Step Calculations (Professional CAD-style adaptive grid)
// =============================================================================

/**
 * Calculate the major grid step in millimeters based on current zoom scale.
 * Uses industry-standard breakpoints for CAD applications.
 */
export function getMajorStepMm(scale: number): number {
  // Adaptive steps based on zoom level for optimal visibility
  if (scale < 0.25) return 100;  // Very zoomed out: 10cm steps
  if (scale < 0.5) return 50;    // Zoomed out: 5cm steps
  if (scale < 1.0) return 20;    // Normal: 2cm steps
  if (scale < 2.0) return 10;    // Zoomed in: 1cm steps
  if (scale < 4.0) return 5;     // More zoomed: 5mm steps
  if (scale < 8.0) return 2;     // Very zoomed: 2mm steps
  return 1;                       // Maximum zoom: 1mm steps
}

/**
 * Calculate the minor grid step in millimeters based on zoom and major step.
 * Ensures minor grid lines are at least 3 pixels apart for visibility.
 */
export function getMinorStepMm(scale: number, majorStepMm: number): number {
  const minPixelSpacing = 3;
  const mmPerPixel = PX_TO_MM / scale;
  const minStepMm = minPixelSpacing * mmPerPixel;

  // Standard minor step divisions: 1, 2, 5
  const candidates = [1, 2, 5];
  for (const step of candidates) {
    if (majorStepMm % step !== 0) continue;
    if (step >= minStepMm) return step;
  }
  return majorStepMm;
}

// =============================================================================
// Coordinate Transformations
// =============================================================================

export interface ViewportTransform {
  zoom: number;
  panOffset: Point2D;
  originOffset: Point2D;
}

/**
 * Convert screen coordinates to world (page) coordinates.
 * Screen coords are relative to the viewport, world coords are in page space.
 */
export function screenToWorld(
  screenPoint: Point2D,
  transform: ViewportTransform
): Point2D {
  const { zoom, panOffset, originOffset } = transform;
  return {
    x: (screenPoint.x - originOffset.x + panOffset.x) / zoom,
    y: (screenPoint.y - originOffset.y + panOffset.y) / zoom,
  };
}

/**
 * Convert world (page) coordinates to screen coordinates.
 */
export function worldToScreen(
  worldPoint: Point2D,
  transform: ViewportTransform
): Point2D {
  const { zoom, panOffset, originOffset } = transform;
  return {
    x: worldPoint.x * zoom - panOffset.x + originOffset.x,
    y: worldPoint.y * zoom - panOffset.y + originOffset.y,
  };
}

/**
 * Convert pixels to millimeters at current zoom level.
 */
export function pxToMm(px: number): number {
  return px * PX_TO_MM;
}

/**
 * Convert millimeters to pixels at current zoom level.
 */
export function mmToPx(mm: number): number {
  return mm * MM_TO_PX;
}

/**
 * Calculate the pan offset needed to zoom towards a specific point.
 * This is the core algorithm for mouse-pointer-based focal point zooming.
 * 
 * The key insight: the mouse position in world (canvas) coordinates should 
 * map to the same screen position before and after the zoom operation.
 * 
 * Mathematics:
 * -----------
 * Given Fabric.js coordinate system where absolutePan(panOffset) shows 
 * the world coordinate `panOffset` at the viewport origin (0,0):
 * 
 *   screenPos = (worldPos - panOffset) * zoom
 *   
 * Solving for worldPos:
 *   worldPos = screenPos / zoom + panOffset
 * 
 * For the mouse point to stay fixed:
 *   worldPosBefore = worldPosAfter
 *   mouseScreen / oldZoom + oldPan = mouseScreen / newZoom + newPan
 *   
 * Solving for newPan:
 *   newPan = mouseScreen / oldZoom + oldPan - mouseScreen / newZoom
 *   newPan = worldPos - mouseScreen / newZoom
 * 
 * @param mousePoint - The focal point in screen coordinates relative to canvas element
 * @param currentZoom - Current zoom level (scale factor, e.g., 1.0 = 100%)
 * @param newZoom - Target zoom level after zooming
 * @param currentPanOffset - Current pan offset in world coordinates
 * @returns New pan offset that keeps the mouse point fixed during zoom
 * 
 * @example
 * // Zoom in 2x towards mouse at screen position (400, 300)
 * const mousePoint = { x: 400, y: 300 };
 * const newPan = calculateZoomPanOffset(mousePoint, 1.0, 2.0, { x: 0, y: 0 });
 * // Result: { x: 200, y: 150 } - the world point (400,300) now appears at (400,300) screen
 */
export function calculateZoomPanOffset(
  mousePoint: Point2D,
  currentZoom: number,
  newZoom: number,
  currentPanOffset: Point2D
): Point2D {
  // Step 1: Find the world coordinate under the mouse BEFORE zoom
  // worldPos = screenPos / zoom + panOffset
  const worldX = mousePoint.x / currentZoom + currentPanOffset.x;
  const worldY = mousePoint.y / currentZoom + currentPanOffset.y;

  // Step 2: Calculate new pan so the same world point stays under the mouse AFTER zoom
  // From: mousePoint = (worldPos - newPan) * newZoom
  // Solve: newPan = worldPos - mousePoint / newZoom
  return {
    x: worldX - mousePoint.x / newZoom,
    y: worldY - mousePoint.y / newZoom,
  };
}

// =============================================================================
// Label Formatting
// =============================================================================

/**
 * Format a millimeter value for display on rulers.
 * Automatically switches between mm and cm based on major step.
 */
export function formatRulerLabel(valueMm: number, majorStepMm: number): string {
  // Show in cm if major step is >= 10mm
  if (majorStepMm >= 10) {
    const cm = valueMm / 10;
    const rounded = Math.round(cm);
    return rounded === 0 ? '0' : rounded.toString();
  }
  // Show decimal cm for smaller steps
  const cm = valueMm / 10;
  if (Math.abs(cm) < 0.0001) return '0';
  return cm.toFixed(1);
}

// =============================================================================
// Device Pixel Ratio Helpers
// =============================================================================

/**
 * Get the device pixel ratio for high-DPI display support.
 */
export function getDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

/**
 * Snap a value to physical device pixels for crisp rendering.
 */
export function snapToDevicePixel(value: number, dpr?: number): number {
  const ratio = dpr ?? getDevicePixelRatio();
  return Math.round(value * ratio) / ratio;
}

/**
 * Calculate visible range in world coordinates for a given axis.
 */
export function getVisibleRange(
  viewportSize: number,
  pageSize: number,
  panOffset: number,
  zoom: number
): { start: number; end: number } {
  const viewStart = Math.max(0, panOffset);
  const viewEnd = Math.min(pageSize, panOffset + viewportSize / zoom);
  return { start: viewStart, end: viewEnd };
}
