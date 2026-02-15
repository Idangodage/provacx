/**
 * WallPreview
 *
 * Live preview during wall drawing.
 * Shows interior, center (dashed), and exterior lines.
 */

import * as fabric from 'fabric';
import type { Point2D, WallMaterial } from '../../../types';
import { WALL_MATERIAL_COLORS } from '../../../types/wall';
import { computeOffsetLines } from './WallGeometry';
import { MM_TO_PX } from '../scale';

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

  constructor(canvas: fabric.Canvas, pageHeight: number = 3000) {
    this.canvas = canvas;
    this.pageHeight = pageHeight;
  }

  /**
   * Convert Y coordinate for architectural convention
   */
  private toCanvasY(y: number): number {
    return (this.pageHeight - y) * MM_TO_PX;
  }

  /**
   * Set page height for Y-axis conversion
   */
  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

  /**
   * Start preview from a point
   */
  startPreview(startPoint: Point2D, thickness: number, material: WallMaterial): void {
    this.clearPreview();
    this.startPoint = startPoint;
    this.thickness = thickness;
    this.material = material;
  }

  /**
   * Update preview to current point
   */
  updatePreview(endPoint: Point2D): void {
    if (!this.startPoint) return;

    // Clear previous preview
    if (this.previewGroup) {
      this.canvas.remove(this.previewGroup);
    }

    // Don't show preview for zero-length walls
    const dx = endPoint.x - this.startPoint.x;
    const dy = endPoint.y - this.startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length < 1) {
      this.previewGroup = null;
      return;
    }

    // Compute offset lines
    const { interiorLine, exteriorLine } = computeOffsetLines(
      this.startPoint,
      endPoint,
      this.thickness
    );

    const materialColors = WALL_MATERIAL_COLORS[this.material];

    // Create preview lines
    const objects: fabric.FabricObject[] = [];

    // Interior line
    objects.push(
      new fabric.Line(
        [
          interiorLine.start.x * MM_TO_PX,
          this.toCanvasY(interiorLine.start.y),
          interiorLine.end.x * MM_TO_PX,
          this.toCanvasY(interiorLine.end.y),
        ],
        {
          stroke: materialColors.stroke,
          strokeWidth: 2,
          selectable: false,
          evented: false,
        }
      )
    );

    // Center line (dashed)
    objects.push(
      new fabric.Line(
        [
          this.startPoint.x * MM_TO_PX,
          this.toCanvasY(this.startPoint.y),
          endPoint.x * MM_TO_PX,
          this.toCanvasY(endPoint.y),
        ],
        {
          stroke: '#666666',
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        }
      )
    );

    // Exterior line
    objects.push(
      new fabric.Line(
        [
          exteriorLine.start.x * MM_TO_PX,
          this.toCanvasY(exteriorLine.start.y),
          exteriorLine.end.x * MM_TO_PX,
          this.toCanvasY(exteriorLine.end.y),
        ],
        {
          stroke: materialColors.stroke,
          strokeWidth: 2,
          selectable: false,
          evented: false,
        }
      )
    );

    // End caps (perpendicular lines)
    objects.push(
      new fabric.Line(
        [
          interiorLine.start.x * MM_TO_PX,
          this.toCanvasY(interiorLine.start.y),
          exteriorLine.start.x * MM_TO_PX,
          this.toCanvasY(exteriorLine.start.y),
        ],
        {
          stroke: materialColors.stroke,
          strokeWidth: 2,
          selectable: false,
          evented: false,
        }
      )
    );

    objects.push(
      new fabric.Line(
        [
          interiorLine.end.x * MM_TO_PX,
          this.toCanvasY(interiorLine.end.y),
          exteriorLine.end.x * MM_TO_PX,
          this.toCanvasY(exteriorLine.end.y),
        ],
        {
          stroke: materialColors.stroke,
          strokeWidth: 2,
          selectable: false,
          evented: false,
        }
      )
    );

    // Semi-transparent fill polygon
    const polygon = new fabric.Polygon(
      [
        { x: interiorLine.start.x * MM_TO_PX, y: this.toCanvasY(interiorLine.start.y) },
        { x: interiorLine.end.x * MM_TO_PX, y: this.toCanvasY(interiorLine.end.y) },
        { x: exteriorLine.end.x * MM_TO_PX, y: this.toCanvasY(exteriorLine.end.y) },
        { x: exteriorLine.start.x * MM_TO_PX, y: this.toCanvasY(exteriorLine.start.y) },
      ],
      {
        fill: materialColors.fill,
        opacity: 0.5,
        selectable: false,
        evented: false,
      }
    );
    objects.unshift(polygon); // Add polygon first so lines are on top

    // Create preview group
    this.previewGroup = new fabric.Group(objects, {
      selectable: false,
      evented: false,
    });

    this.canvas.add(this.previewGroup);
    this.canvas.renderAll();
  }

  /**
   * Show preview with specific start and end points
   */
  showPreview(
    startPoint: Point2D,
    endPoint: Point2D,
    thickness: number,
    material: WallMaterial
  ): void {
    this.startPoint = startPoint;
    this.thickness = thickness;
    this.material = material;
    this.updatePreview(endPoint);
  }

  /**
   * Clear preview from canvas
   */
  clearPreview(): void {
    if (this.previewGroup) {
      this.canvas.remove(this.previewGroup);
      this.previewGroup = null;
    }
    this.startPoint = null;
    this.canvas.renderAll();
  }

  /**
   * Check if preview is active
   */
  isActive(): boolean {
    return this.startPoint !== null;
  }

  /**
   * Dispose preview
   */
  dispose(): void {
    this.clearPreview();
  }
}
