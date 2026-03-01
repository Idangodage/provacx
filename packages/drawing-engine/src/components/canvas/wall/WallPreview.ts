/**
 * WallPreview
 *
 * Live preview during wall drawing.
 * Shows interior, dashed center, and exterior lines.
 */

import * as fabric from 'fabric';

import type { Point2D, Wall, WallMaterial } from '../../../types';
import { WALL_MATERIAL_COLORS } from '../../../types/wall';
import { MM_TO_PX } from '../scale';

import { buildTemporaryWall } from './WallJoinNetwork';
import { computeWallUnionRenderData, type WallUnionComponent } from './WallUnionGeometry';

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
  private lastEndPoint: Point2D | null = null;
  private frameHandle: number | null = null;
  private walls: Wall[] = [];
  private preferredStartWall: Wall | null = null;

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

  private toCanvasPoint(point: Point2D): { x: number; y: number } {
    return {
      x: point.x * MM_TO_PX,
      y: this.toCanvasY(point.y),
    };
  }

  private componentPathData(component: WallUnionComponent): string {
    return this.polygonsPathData(component.polygons);
  }

  private polygonsPathData(polygons: Point2D[][][]): string {
    return polygons
      .flatMap((polygon) =>
        polygon
          .filter((ring) => ring.length >= 3)
          .map((ring) => {
            const [first, ...rest] = ring.map((point) => this.toCanvasPoint(point));
            const commands = [`M ${first.x} ${first.y}`];
            rest.forEach((point) => {
              commands.push(`L ${point.x} ${point.y}`);
            });
            commands.push('Z');
            return commands.join(' ');
          })
      )
      .join(' ');
  }

  /**
   * Set page height for compatibility with existing hook contracts.
   */
  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

  setWalls(walls: Wall[]): void {
    this.walls = walls;
    this.preferredStartWall = null;
    if (this.startPoint && this.lastEndPoint) {
      this.queuedEndPoint = { ...this.lastEndPoint };
      this.scheduleRender();
    }
  }

  /**
   * Start preview from a point.
   */
  startPreview(
    startPoint: Point2D,
    thickness: number,
    material: WallMaterial,
    preferredStartWall?: Wall | null
  ): void {
    this.clearPreview();
    this.startPoint = { ...startPoint };
    this.thickness = thickness;
    this.material = material;
    this.preferredStartWall = preferredStartWall ? { ...preferredStartWall } : null;
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

    this.lastEndPoint = { ...endPoint };

    const dx = endPoint.x - this.startPoint.x;
    const dy = endPoint.y - this.startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1) return;

    const previewWall = buildTemporaryWall(
      '__preview__',
      this.startPoint,
      endPoint,
      this.thickness,
      this.material
    );
    const previewWalls = [
      ...this.walls,
      ...(this.preferredStartWall ? [this.preferredStartWall] : []),
      previewWall,
    ];
    const renderData = computeWallUnionRenderData(previewWalls);
    const previewComponent = renderData.components.find((component) =>
      component.wallIds.includes(previewWall.id)
    );

    if (!previewComponent) {
      return;
    }

    const materialColors = WALL_MATERIAL_COLORS[this.material];
    const mergedPreviewPath = new fabric.Path(this.componentPathData(previewComponent), {
      fill: materialColors.fill,
      opacity: 0.55,
      fillRule: 'evenodd',
      stroke: '#000000',
      strokeWidth: 2,
      strokeLineJoin: 'miter',
      selectable: false,
      evented: false,
      objectCaching: false,
    });
    const overlayPreviewPathData = this.polygonsPathData(previewComponent.junctionOverlays);
    const overlayPreviewPath = overlayPreviewPathData
      ? new fabric.Path(overlayPreviewPathData, {
        fill: '#000000',
        opacity: 0.85,
        fillRule: 'evenodd',
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false,
        objectCaching: false,
      })
      : null;

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

    this.previewGroup = new fabric.Group(
      [
        mergedPreviewPath,
        ...(overlayPreviewPath ? [overlayPreviewPath] : []),
        centerPreviewLine,
      ],
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
    this.lastEndPoint = null;
    this.preferredStartWall = null;
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
