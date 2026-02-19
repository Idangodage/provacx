/**
 * WallPreview
 *
 * Live preview during wall drawing.
 * Shows interior, dashed center, and exterior lines.
 */

import * as fabric from 'fabric';

import type { Point2D, WallMaterial } from '../../../types';
import { WALL_MATERIAL_COLORS } from '../../../types/wall';
import { MM_TO_PX } from '../scale';

import { computeOffsetLines } from './WallGeometry';

// =============================================================================
// WallPreview Class
// =============================================================================

export class WallPreview {
  private canvas: fabric.Canvas;
  private previewGroup: fabric.Group | null = null;
  private pageHeight: number;
  private startPoint: Point2D | null = null;
  private thickness: number = 150;
  private material: WallMaterial = 'brick';
  private queuedEndPoint: Point2D | null = null;
  private frameHandle: number | null = null;

  constructor(canvas: fabric.Canvas, pageHeight: number = 3000) {
    this.canvas = canvas;
    this.pageHeight = pageHeight;
  }

  /**
   * Convert Y coordinate to canvas coordinates (top-left origin).
   */
  private toCanvasY(y: number): number {
    return y * MM_TO_PX;
  }

  /**
   * Set page height for compatibility with existing hook contracts.
   */
  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

  /**
   * Start preview from a point.
   */
  startPreview(startPoint: Point2D, thickness: number, material: WallMaterial): void {
    this.clearPreview();
    this.startPoint = { ...startPoint };
    this.thickness = thickness;
    this.material = material;
  }

  /**
   * Queue preview update to the next animation frame.
   */
  updatePreview(endPoint: Point2D): void {
    if (!this.startPoint) return;
    this.queuedEndPoint = { ...endPoint };
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (typeof window === 'undefined') {
      this.flushPreviewRender();
      return;
    }

    if (this.frameHandle !== null) return;

    this.frameHandle = window.requestAnimationFrame(() => {
      this.frameHandle = null;
      this.flushPreviewRender();
    });
  }

  private flushPreviewRender(): void {
    if (!this.startPoint || !this.queuedEndPoint) return;
    const endPoint = this.queuedEndPoint;
    this.queuedEndPoint = null;

    if (this.previewGroup) {
      this.canvas.remove(this.previewGroup);
      this.previewGroup = null;
    }

    const dx = endPoint.x - this.startPoint.x;
    const dy = endPoint.y - this.startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1) return;

    const { interiorLine, exteriorLine } = computeOffsetLines(
      this.startPoint,
      endPoint,
      this.thickness
    );

    const materialColors = WALL_MATERIAL_COLORS[this.material];

    const fillPolygon = new fabric.Polygon(
      [
        { x: interiorLine.start.x * MM_TO_PX, y: this.toCanvasY(interiorLine.start.y) },
        { x: interiorLine.end.x * MM_TO_PX, y: this.toCanvasY(interiorLine.end.y) },
        { x: exteriorLine.end.x * MM_TO_PX, y: this.toCanvasY(exteriorLine.end.y) },
        { x: exteriorLine.start.x * MM_TO_PX, y: this.toCanvasY(exteriorLine.start.y) },
      ],
      {
        fill: materialColors.fill,
        opacity: 0.55,
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false,
      }
    );

    const interiorBoundary = new fabric.Line(
      [
        interiorLine.start.x * MM_TO_PX,
        this.toCanvasY(interiorLine.start.y),
        interiorLine.end.x * MM_TO_PX,
        this.toCanvasY(interiorLine.end.y),
      ],
      {
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      }
    );

    const centerPreviewLine = new fabric.Line(
      [
        this.startPoint.x * MM_TO_PX,
        this.toCanvasY(this.startPoint.y),
        endPoint.x * MM_TO_PX,
        this.toCanvasY(endPoint.y),
      ],
      {
        stroke: '#000000',
        strokeWidth: 1,
        strokeDashArray: [8, 6],
        selectable: false,
        evented: false,
      }
    );

    const exteriorBoundary = new fabric.Line(
      [
        exteriorLine.start.x * MM_TO_PX,
        this.toCanvasY(exteriorLine.start.y),
        exteriorLine.end.x * MM_TO_PX,
        this.toCanvasY(exteriorLine.end.y),
      ],
      {
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      }
    );

    const startCap = new fabric.Line(
      [
        interiorLine.start.x * MM_TO_PX,
        this.toCanvasY(interiorLine.start.y),
        exteriorLine.start.x * MM_TO_PX,
        this.toCanvasY(exteriorLine.start.y),
      ],
      {
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      }
    );

    const endCap = new fabric.Line(
      [
        interiorLine.end.x * MM_TO_PX,
        this.toCanvasY(interiorLine.end.y),
        exteriorLine.end.x * MM_TO_PX,
        this.toCanvasY(exteriorLine.end.y),
      ],
      {
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      }
    );

    this.previewGroup = new fabric.Group(
      [fillPolygon, interiorBoundary, centerPreviewLine, exteriorBoundary, startCap, endCap],
      {
        selectable: false,
        evented: false,
      }
    );

    this.canvas.add(this.previewGroup);
    this.canvas.requestRenderAll();
  }

  /**
   * Show preview with specific start and end points.
   */
  showPreview(
    startPoint: Point2D,
    endPoint: Point2D,
    thickness: number,
    material: WallMaterial
  ): void {
    this.startPoint = { ...startPoint };
    this.thickness = thickness;
    this.material = material;
    this.updatePreview(endPoint);
  }

  /**
   * Clear preview from canvas.
   */
  clearPreview(): void {
    if (this.frameHandle !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }

    this.queuedEndPoint = null;

    if (this.previewGroup) {
      this.canvas.remove(this.previewGroup);
      this.previewGroup = null;
    }

    this.startPoint = null;
    this.canvas.requestRenderAll();
  }

  /**
   * Check if preview is active.
   */
  isActive(): boolean {
    return this.startPoint !== null;
  }

  /**
   * Dispose preview.
   */
  dispose(): void {
    this.clearPreview();
  }
}
