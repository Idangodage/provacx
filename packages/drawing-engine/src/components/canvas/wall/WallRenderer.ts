/**
 * WallRenderer
 *
 * Fabric.js rendering for walls with clean architectural appearance.
 * Walls are rendered with solid black exterior/interior lines and a subtle fill.
 */

import * as fabric from 'fabric';
import type { Point2D, Wall, WallMaterial, JoinData } from '../../../types';
import { computeWallPolygon, computeMiterJoin, angleBetweenWalls, determineJoinType } from './WallGeometry';
import { MM_TO_PX } from '../scale';

// =============================================================================
// Types
// =============================================================================

export interface WallRenderOptions {
  showCenterLines: boolean;
  pageHeight: number;
}

// Wall fill colors - clean architectural style
const WALL_FILLS: Record<WallMaterial, string> = {
  brick: '#F5E6D3',      // Light warm beige
  concrete: '#E8E8E8',   // Light gray
  partition: '#FFFFFF',  // White
};

// =============================================================================
// WallRenderer Class
// =============================================================================

export class WallRenderer {
  private canvas: fabric.Canvas;
  private wallObjects: Map<string, fabric.Group> = new Map();
  private pageHeight: number;
  private scaleRatio: number;

  constructor(canvas: fabric.Canvas, pageHeight: number = 3000, scaleRatio: number = 1) {
    this.canvas = canvas;
    this.pageHeight = pageHeight;
    this.scaleRatio = scaleRatio;
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
  // Configuration
  // ==========================================================================

  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

  setScaleRatio(ratio: number): void {
    this.scaleRatio = ratio;
  }

  setShowCenterLines(_show: boolean): void {
    // Center lines removed for cleaner appearance
  }

  // ==========================================================================
  // Wall Rendering
  // ==========================================================================

  /**
   * Render a wall with clean architectural appearance
   */
  renderWall(wall: Wall, joins?: JoinData[]): fabric.Group {
    this.removeWall(wall.id);

    // Compute polygon vertices (order: interiorStart, interiorEnd, exteriorEnd, exteriorStart)
    const vertices = computeWallPolygon(wall, joins);
    const canvasVertices = vertices.map((v) => this.toCanvasPoint(v));

    // Get fill color based on material
    const fillColor = WALL_FILLS[wall.material] || WALL_FILLS.brick;

    const objects: fabric.FabricObject[] = [];

    // Create solid fill polygon with clean black outline
    const polygon = new fabric.Polygon(canvasVertices, {
      fill: fillColor,
      stroke: '#000000',
      strokeWidth: 1.5,
      selectable: false,
      evented: false,
      strokeLineJoin: 'miter',
    });
    (polygon as fabric.Object & { name?: string }).name = 'wallPolygon';
    objects.push(polygon);

    // Create the group
    const group = new fabric.Group(objects, {
      selectable: true,
      evented: true,
      subTargetCheck: true,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
    });

    // Store wall ID for selection
    (group as fabric.Group & { wallId?: string }).wallId = wall.id;
    (group as fabric.Group & { name?: string }).name = `wall-${wall.id}`;

    this.canvas.add(group);
    this.wallObjects.set(wall.id, group);

    return group;
  }

  // ==========================================================================
  // Wall Management
  // ==========================================================================

  updateWall(wall: Wall, joins?: JoinData[]): void {
    this.renderWall(wall, joins);
  }

  removeWall(wallId: string): void {
    const existing = this.wallObjects.get(wallId);
    if (existing) {
      this.canvas.remove(existing);
      this.wallObjects.delete(wallId);
    }
  }

  renderAllWalls(walls: Wall[]): void {
    // Clear existing
    this.wallObjects.forEach((obj) => {
      this.canvas.remove(obj);
    });
    this.wallObjects.clear();

    // Compute joins
    const joinsMap = this.computeAllJoins(walls);

    // Render each wall
    for (const wall of walls) {
      const joins = joinsMap.get(wall.id) || [];
      this.renderWall(wall, joins);
    }

    this.canvas.renderAll();
  }

  private computeAllJoins(walls: Wall[]): Map<string, JoinData[]> {
    const joinsMap = new Map<string, JoinData[]>();
    const wallsById = new Map(walls.map((w) => [w.id, w]));

    for (const wall of walls) {
      const joins: JoinData[] = [];

      for (const connectedId of wall.connectedWalls) {
        const connectedWall = wallsById.get(connectedId);
        if (!connectedWall) continue;

        const sharedEndpoint = this.findSharedEndpoint(wall, connectedWall);
        if (!sharedEndpoint) continue;

        const angle = angleBetweenWalls(wall, connectedWall, sharedEndpoint);
        const joinType = determineJoinType(angle);
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

  private findSharedEndpoint(wall1: Wall, wall2: Wall): Point2D | null {
    const tolerance = 0.1;
    const endpoints1 = [wall1.startPoint, wall1.endPoint];
    const endpoints2 = [wall2.startPoint, wall2.endPoint];

    for (const p1 of endpoints1) {
      for (const p2 of endpoints2) {
        if (Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance) {
          return p1;
        }
      }
    }
    return null;
  }

  // ==========================================================================
  // Selection Highlight
  // ==========================================================================

  highlightWall(wallId: string, highlight: boolean): void {
    const group = this.wallObjects.get(wallId);
    if (!group) return;

    // Find the wall polygon and highlight it
    const objects = group.getObjects();
    for (const obj of objects) {
      const name = (obj as fabric.Object & { name?: string }).name;
      if (name === 'wallPolygon') {
        (obj as fabric.Polygon).set('stroke', highlight ? '#2196F3' : '#000000');
        (obj as fabric.Polygon).set('strokeWidth', highlight ? 2.5 : 1.5);
      }
    }

    this.canvas.renderAll();
  }

  getWallObject(wallId: string): fabric.Group | undefined {
    return this.wallObjects.get(wallId);
  }

  clearAllWalls(): void {
    this.wallObjects.forEach((obj) => {
      this.canvas.remove(obj);
    });
    this.wallObjects.clear();
    this.canvas.renderAll();
  }

  dispose(): void {
    this.clearAllWalls();
  }
}
