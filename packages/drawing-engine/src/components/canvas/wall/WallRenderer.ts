/**
 * WallRenderer
 *
 * Fabric.js rendering for walls with material fills and joins.
 */

import * as fabric from 'fabric';
import type { Point2D, Wall, WallMaterial, JoinData } from '../../../types';
import { WALL_MATERIAL_COLORS } from '../../../types/wall';
import { computeWallPolygon, computeMiterJoin, angleBetweenWalls, determineJoinType } from './WallGeometry';
import { MM_TO_PX } from '../scale';

// =============================================================================
// Types
// =============================================================================

export interface WallRenderOptions {
  showCenterLines: boolean;
  pageHeight: number;  // For Y-axis flip
}

// =============================================================================
// WallRenderer Class
// =============================================================================

export class WallRenderer {
  private canvas: fabric.Canvas;
  private wallObjects: Map<string, fabric.Group> = new Map();
  private showCenterLines: boolean = true;
  private pageHeight: number;
  private hatchPatterns: Map<WallMaterial, fabric.Pattern | null> = new Map();

  constructor(canvas: fabric.Canvas, pageHeight: number = 3000) {
    this.canvas = canvas;
    this.pageHeight = pageHeight;
    this.initializePatterns();
  }

  /**
   * Initialize hatch patterns for materials
   */
  private initializePatterns(): void {
    // Create brick hatch pattern
    const brickPattern = this.createHatchPattern('#CC9999');
    this.hatchPatterns.set('brick', brickPattern);
    this.hatchPatterns.set('concrete', null);
    this.hatchPatterns.set('partition', null);
  }

  /**
   * Create 45-degree hatch pattern
   */
  private createHatchPattern(strokeColor: string): fabric.Pattern | null {
    // Create a small canvas for the pattern
    const patternSize = 10;
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = patternSize;
    patternCanvas.height = patternSize;
    const ctx = patternCanvas.getContext('2d');

    if (!ctx) return null;

    // Draw diagonal line
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, patternSize);
    ctx.lineTo(patternSize, 0);
    ctx.stroke();

    return new fabric.Pattern({
      source: patternCanvas,
      repeat: 'repeat',
    });
  }

  /**
   * Convert Y coordinate for architectural convention (Y-up to canvas Y-down)
   */
  private toCanvasY(y: number): number {
    return (this.pageHeight - y) * MM_TO_PX;
  }

  /**
   * Convert point to canvas coordinates
   */
  private toCanvasPoint(point: Point2D): { x: number; y: number } {
    return {
      x: point.x * MM_TO_PX,
      y: this.toCanvasY(point.y),
    };
  }

  /**
   * Set page height for Y-axis conversion
   */
  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

  /**
   * Set whether to show center lines
   */
  setShowCenterLines(show: boolean): void {
    this.showCenterLines = show;
    // Update all existing walls
    this.wallObjects.forEach((group, wallId) => {
      const centerLine = group.getObjects().find((obj) =>
        (obj as fabric.Object & { name?: string }).name === 'centerLine'
      );
      if (centerLine) {
        centerLine.set('visible', show);
      }
    });
    this.canvas.renderAll();
  }

  /**
   * Render a wall as a Fabric.js group
   */
  renderWall(wall: Wall, joins?: JoinData[]): fabric.Group {
    // Remove existing wall object if any
    this.removeWall(wall.id);

    // Compute polygon vertices
    const vertices = computeWallPolygon(wall, joins);

    // Convert to canvas coordinates
    const canvasVertices = vertices.map((v) => this.toCanvasPoint(v));

    // Get material colors
    const materialColors = WALL_MATERIAL_COLORS[wall.material];

    // Create wall polygon
    const polygon = new fabric.Polygon(canvasVertices, {
      fill: materialColors.fill,
      stroke: materialColors.stroke,
      strokeWidth: 1,
      selectable: true,
      evented: true,
    });

    // Apply hatch pattern if needed
    if (materialColors.pattern === 'hatch') {
      const pattern = this.hatchPatterns.get(wall.material);
      if (pattern) {
        // Draw base fill first, then apply pattern overlay
        polygon.set('fill', materialColors.fill);
      }
    }

    const objects: fabric.FabricObject[] = [polygon];

    // Create center line (dashed)
    if (this.showCenterLines) {
      const centerLine = new fabric.Line(
        [
          wall.startPoint.x * MM_TO_PX,
          this.toCanvasY(wall.startPoint.y),
          wall.endPoint.x * MM_TO_PX,
          this.toCanvasY(wall.endPoint.y),
        ],
        {
          stroke: '#666666',
          strokeWidth: 1,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
        }
      );
      (centerLine as fabric.Object & { name?: string }).name = 'centerLine';
      objects.push(centerLine);
    }

    // Create group
    const group = new fabric.Group(objects, {
      selectable: true,
      evented: true,
      subTargetCheck: true,
    });

    // Store wall ID in the group
    (group as fabric.Group & { wallId?: string }).wallId = wall.id;
    (group as fabric.Group & { name?: string }).name = `wall-${wall.id}`;

    // Add to canvas and store reference
    this.canvas.add(group);
    this.wallObjects.set(wall.id, group);

    return group;
  }

  /**
   * Update an existing wall's rendering
   */
  updateWall(wall: Wall, joins?: JoinData[]): void {
    this.renderWall(wall, joins);
  }

  /**
   * Remove a wall from the canvas
   */
  removeWall(wallId: string): void {
    const existing = this.wallObjects.get(wallId);
    if (existing) {
      this.canvas.remove(existing);
      this.wallObjects.delete(wallId);
    }
  }

  /**
   * Render all walls with proper joins
   */
  renderAllWalls(walls: Wall[]): void {
    // Clear existing wall objects
    this.wallObjects.forEach((obj) => {
      this.canvas.remove(obj);
    });
    this.wallObjects.clear();

    // Compute joins for connected walls
    const joinsMap = this.computeAllJoins(walls);

    // Render each wall with its joins
    for (const wall of walls) {
      const joins = joinsMap.get(wall.id) || [];
      this.renderWall(wall, joins);
    }

    this.canvas.renderAll();
  }

  /**
   * Compute all wall joins
   */
  private computeAllJoins(walls: Wall[]): Map<string, JoinData[]> {
    const joinsMap = new Map<string, JoinData[]>();
    const wallsById = new Map(walls.map((w) => [w.id, w]));

    for (const wall of walls) {
      const joins: JoinData[] = [];

      for (const connectedId of wall.connectedWalls) {
        const connectedWall = wallsById.get(connectedId);
        if (!connectedWall) continue;

        // Find shared endpoint
        const sharedEndpoint = this.findSharedEndpoint(wall, connectedWall);
        if (!sharedEndpoint) continue;

        // Calculate angle and join type
        const angle = angleBetweenWalls(wall, connectedWall, sharedEndpoint);
        const joinType = determineJoinType(angle);

        // Compute miter/butt join vertices
        const { interiorVertex, exteriorVertex } = computeMiterJoin(wall, connectedWall, sharedEndpoint);

        joins.push({
          wallId: wall.id,
          otherWallId: connectedId,
          joinPoint: sharedEndpoint,
          joinType,
          angle,
          interiorVertex,
          exteriorVertex,
        });
      }

      joinsMap.set(wall.id, joins);
    }

    return joinsMap;
  }

  /**
   * Find shared endpoint between two walls
   */
  private findSharedEndpoint(wall1: Wall, wall2: Wall): Point2D | null {
    const tolerance = 0.1;

    const endpoints1 = [wall1.startPoint, wall1.endPoint];
    const endpoints2 = [wall2.startPoint, wall2.endPoint];

    for (const p1 of endpoints1) {
      for (const p2 of endpoints2) {
        if (
          Math.abs(p1.x - p2.x) < tolerance &&
          Math.abs(p1.y - p2.y) < tolerance
        ) {
          return p1;
        }
      }
    }

    return null;
  }

  /**
   * Highlight a wall
   */
  highlightWall(wallId: string, highlight: boolean): void {
    const group = this.wallObjects.get(wallId);
    if (!group) return;

    const polygon = group.getObjects()[0];
    if (polygon) {
      polygon.set('strokeWidth', highlight ? 3 : 1);
      polygon.set('stroke', highlight ? '#2196F3' : WALL_MATERIAL_COLORS.brick.stroke);
    }

    this.canvas.renderAll();
  }

  /**
   * Get wall object by ID
   */
  getWallObject(wallId: string): fabric.Group | undefined {
    return this.wallObjects.get(wallId);
  }

  /**
   * Clear all walls
   */
  clearAllWalls(): void {
    this.wallObjects.forEach((obj) => {
      this.canvas.remove(obj);
    });
    this.wallObjects.clear();
    this.canvas.renderAll();
  }

  /**
   * Dispose renderer
   */
  dispose(): void {
    this.clearAllWalls();
    this.hatchPatterns.clear();
  }
}
