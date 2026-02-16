/**
 * DragPreview
 *
 * Shows real-time visual preview during drag operations.
 * Renders semi-transparent preview of wall/room changes before committing.
 */

import * as fabric from 'fabric';
import type { Point2D, Wall, Room } from '../../../types';
import { MM_TO_PX } from '../scale';
import { computeOffsetLines } from '../wall/WallGeometry';

// =============================================================================
// Types
// =============================================================================

export interface DragPreviewOptions {
  previewColor: string;
  previewOpacity: number;
  strokeColor: string;
  strokeWidth: number;
}

const DEFAULT_OPTIONS: DragPreviewOptions = {
  previewColor: '#4CAF50',
  previewOpacity: 0.3,
  strokeColor: '#4CAF50',
  strokeWidth: 2,
};

// =============================================================================
// DragPreview Class
// =============================================================================

export class DragPreview {
  private canvas: fabric.Canvas;
  private previewObjects: fabric.FabricObject[] = [];
  private pageHeight: number;
  private scaleRatio: number;
  private options: DragPreviewOptions;

  constructor(
    canvas: fabric.Canvas,
    pageHeight: number = 3000,
    scaleRatio: number = 1,
    options: Partial<DragPreviewOptions> = {}
  ) {
    this.canvas = canvas;
    this.pageHeight = pageHeight;
    this.scaleRatio = scaleRatio;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

  setScaleRatio(ratio: number): void {
    this.scaleRatio = ratio;
  }

  setOptions(options: Partial<DragPreviewOptions>): void {
    this.options = { ...this.options, ...options };
  }

  // ==========================================================================
  // Coordinate Conversion
  // ==========================================================================

  private toCanvasPoint(point: Point2D): { x: number; y: number } {
    const paperX = point.x / this.scaleRatio;
    const paperY = point.y / this.scaleRatio;
    return {
      x: paperX * MM_TO_PX,
      y: (this.pageHeight - paperY) * MM_TO_PX,
    };
  }

  // ==========================================================================
  // Wall Preview
  // ==========================================================================

  /**
   * Show preview of wall during thickness change
   */
  showWallThicknessPreview(wall: Wall, newThickness: number): void {
    this.clearPreview();

    // Compute new offset lines with new thickness
    const { interiorLine, exteriorLine } = computeOffsetLines(
      wall.startPoint,
      wall.endPoint,
      newThickness
    );

    // Convert to canvas coordinates
    const intStart = this.toCanvasPoint(interiorLine.start);
    const intEnd = this.toCanvasPoint(interiorLine.end);
    const extStart = this.toCanvasPoint(exteriorLine.start);
    const extEnd = this.toCanvasPoint(exteriorLine.end);

    // Create preview polygon
    const polygon = new fabric.Polygon(
      [intStart, intEnd, extEnd, extStart],
      {
        fill: this.options.previewColor,
        opacity: this.options.previewOpacity,
        stroke: this.options.strokeColor,
        strokeWidth: this.options.strokeWidth,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
      }
    );

    this.previewObjects.push(polygon);
    this.canvas.add(polygon);
    this.canvas.renderAll();
  }

  /**
   * Show preview of wall during endpoint drag
   */
  showWallEndpointPreview(
    wall: Wall,
    endpoint: 'start' | 'end',
    newPosition: Point2D
  ): void {
    this.clearPreview();

    const newStartPoint = endpoint === 'start' ? newPosition : wall.startPoint;
    const newEndPoint = endpoint === 'end' ? newPosition : wall.endPoint;

    const { interiorLine, exteriorLine } = computeOffsetLines(
      newStartPoint,
      newEndPoint,
      wall.thickness
    );

    const intStart = this.toCanvasPoint(interiorLine.start);
    const intEnd = this.toCanvasPoint(interiorLine.end);
    const extStart = this.toCanvasPoint(exteriorLine.start);
    const extEnd = this.toCanvasPoint(exteriorLine.end);

    const polygon = new fabric.Polygon(
      [intStart, intEnd, extEnd, extStart],
      {
        fill: this.options.previewColor,
        opacity: this.options.previewOpacity,
        stroke: this.options.strokeColor,
        strokeWidth: this.options.strokeWidth,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
      }
    );

    this.previewObjects.push(polygon);
    this.canvas.add(polygon);
    this.canvas.renderAll();
  }

  /**
   * Show preview of wall during parallel translation
   */
  showWallMovePreview(wall: Wall, offset: Point2D): void {
    this.clearPreview();

    const newStartPoint = {
      x: wall.startPoint.x + offset.x,
      y: wall.startPoint.y + offset.y,
    };
    const newEndPoint = {
      x: wall.endPoint.x + offset.x,
      y: wall.endPoint.y + offset.y,
    };

    const { interiorLine, exteriorLine } = computeOffsetLines(
      newStartPoint,
      newEndPoint,
      wall.thickness
    );

    const intStart = this.toCanvasPoint(interiorLine.start);
    const intEnd = this.toCanvasPoint(interiorLine.end);
    const extStart = this.toCanvasPoint(exteriorLine.start);
    const extEnd = this.toCanvasPoint(exteriorLine.end);

    const polygon = new fabric.Polygon(
      [intStart, intEnd, extEnd, extStart],
      {
        fill: this.options.previewColor,
        opacity: this.options.previewOpacity,
        stroke: this.options.strokeColor,
        strokeWidth: this.options.strokeWidth,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
      }
    );

    this.previewObjects.push(polygon);
    this.canvas.add(polygon);
    this.canvas.renderAll();
  }

  // ==========================================================================
  // Room Preview
  // ==========================================================================

  /**
   * Show preview of room during centroid drag
   */
  showRoomMovePreview(walls: Wall[], offset: Point2D): void {
    this.clearPreview();

    for (const wall of walls) {
      const newStartPoint = {
        x: wall.startPoint.x + offset.x,
        y: wall.startPoint.y + offset.y,
      };
      const newEndPoint = {
        x: wall.endPoint.x + offset.x,
        y: wall.endPoint.y + offset.y,
      };

      const { interiorLine, exteriorLine } = computeOffsetLines(
        newStartPoint,
        newEndPoint,
        wall.thickness
      );

      const intStart = this.toCanvasPoint(interiorLine.start);
      const intEnd = this.toCanvasPoint(interiorLine.end);
      const extStart = this.toCanvasPoint(exteriorLine.start);
      const extEnd = this.toCanvasPoint(exteriorLine.end);

      const polygon = new fabric.Polygon(
        [intStart, intEnd, extEnd, extStart],
        {
          fill: this.options.previewColor,
          opacity: this.options.previewOpacity,
          stroke: this.options.strokeColor,
          strokeWidth: this.options.strokeWidth,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        }
      );

      this.previewObjects.push(polygon);
      this.canvas.add(polygon);
    }

    this.canvas.renderAll();
  }

  // ==========================================================================
  // Validation Preview
  // ==========================================================================

  /**
   * Show gap highlight for broken room
   */
  showGapHighlight(position: Point2D, gapSize: number): void {
    const canvasPos = this.toCanvasPoint(position);

    const highlight = new fabric.Circle({
      left: canvasPos.x,
      top: canvasPos.y,
      radius: Math.max(10, gapSize / 2),
      fill: 'rgba(244, 67, 54, 0.3)',
      stroke: '#F44336',
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });

    const warningText = new fabric.Text('!', {
      left: canvasPos.x,
      top: canvasPos.y,
      fontSize: 14,
      fontWeight: 'bold',
      fill: '#F44336',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });

    this.previewObjects.push(highlight, warningText);
    this.canvas.add(highlight, warningText);
    this.canvas.renderAll();
  }

  // ==========================================================================
  // Clear Preview
  // ==========================================================================

  /**
   * Remove all preview objects
   */
  clearPreview(): void {
    for (const obj of this.previewObjects) {
      this.canvas.remove(obj);
    }
    this.previewObjects = [];
    this.canvas.renderAll();
  }

  // ==========================================================================
  // Dispose
  // ==========================================================================

  dispose(): void {
    this.clearPreview();
  }
}