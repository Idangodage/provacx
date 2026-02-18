/**
 * WallEditor
 *
 * Handles wall-specific editing operations:
 * - Edge dragging (thickness adjustment)
 * - Endpoint dragging (length/position)
 * - Center dragging (parallel translation)
 */

import type { Point2D, Wall, WallEditResult, WallConstraints, ConstraintViolation } from '../../../types';
import { DEFAULT_WALL_CONSTRAINTS } from '../../../types/editing';
import {
  direction,
  perpendicular,
  scale as scaleVec,
  add,
  subtract,
  dot,
  computeOffsetLines,
} from '../wall/WallGeometry';

// =============================================================================
// Types
// =============================================================================

export interface WallEditorOptions {
  constraints: WallConstraints;
  gridSize: number;
  snapToGrid: boolean;
}

export interface DragEdgeParams {
  wallId: string;
  edge: 'interior' | 'exterior';
  dragDelta: number;  // Perpendicular offset in mm
}

export interface DragEndpointParams {
  wallId: string;
  endpoint: 'start' | 'end';
  newPosition: Point2D;
  moveConnected: boolean;
}

export interface DragCenterParams {
  wallId: string;
  dragDelta: Point2D;
  moveConnected: boolean;
  snapToGrid: boolean;
}

// =============================================================================
// WallEditor Class
// =============================================================================

export class WallEditor {
  private options: WallEditorOptions;
  private updateWallFn: (id: string, updates: Partial<Wall>) => void;
  private getWallFn: (id: string) => Wall | undefined;
  private getAllWallsFn: () => Wall[];

  constructor(
    updateWallFn: (id: string, updates: Partial<Wall>) => void,
    getWallFn: (id: string) => Wall | undefined,
    getAllWallsFn: () => Wall[],
    options: Partial<WallEditorOptions> = {}
  ) {
    this.updateWallFn = updateWallFn;
    this.getWallFn = getWallFn;
    this.getAllWallsFn = getAllWallsFn;
    this.options = {
      constraints: { ...DEFAULT_WALL_CONSTRAINTS, ...options.constraints },
      gridSize: options.gridSize ?? 100,
      snapToGrid: options.snapToGrid ?? true,
    };
  }

  // ==========================================================================
  // Edge Dragging (Thickness)
  // ==========================================================================

  /**
   * Drag interior or exterior edge to change wall thickness
   * Center-line remains fixed; only thickness changes.
   */
  dragEdge(params: DragEdgeParams): WallEditResult {
    const { wallId, edge, dragDelta } = params;
    const wall = this.getWallFn(wallId);

    if (!wall) {
      return {
        success: false,
        updatedWalls: [],
        warnings: [`Wall ${wallId} not found`],
        constraintViolations: [],
      };
    }

    // Positive drag along wall normal increases interior offset;
    // exterior handle uses opposite sign.
    let newThickness: number;

    if (edge === 'interior') {
      newThickness = wall.thickness + dragDelta;
    } else {
      newThickness = wall.thickness - dragDelta;
    }

    // Validate constraints
    const violations: ConstraintViolation[] = [];

    if (newThickness < this.options.constraints.minThickness) {
      violations.push({
        type: 'min-thickness',
        message: `Thickness cannot be less than ${this.options.constraints.minThickness}mm`,
        wallId,
        value: newThickness,
        limit: this.options.constraints.minThickness,
      });
      newThickness = this.options.constraints.minThickness;
    }

    if (newThickness > this.options.constraints.maxThickness) {
      violations.push({
        type: 'max-thickness',
        message: `Thickness cannot exceed ${this.options.constraints.maxThickness}mm`,
        wallId,
        value: newThickness,
        limit: this.options.constraints.maxThickness,
      });
      newThickness = this.options.constraints.maxThickness;
    }

    this.updateWallFn(wallId, {
      thickness: newThickness,
    });

    const updatedWall = this.getWallFn(wallId);

    return {
      success: true,
      updatedWalls: updatedWall ? [updatedWall] : [],
      warnings: violations.length > 0 ? ['Thickness clamped to constraints'] : [],
      constraintViolations: violations,
    };
  }

  // ==========================================================================
  // Endpoint Dragging (Resize)
  // ==========================================================================

  /**
   * Drag an endpoint to resize the wall
   * Optionally moves connected walls' endpoints together
   */
  dragEndpoint(params: DragEndpointParams): WallEditResult {
    const { wallId, endpoint, newPosition, moveConnected } = params;
    const wall = this.getWallFn(wallId);

    if (!wall) {
      return {
        success: false,
        updatedWalls: [],
        warnings: [`Wall ${wallId} not found`],
        constraintViolations: [],
      };
    }

    const updatedWalls: Wall[] = [];
    const violations: ConstraintViolation[] = [];

    // Calculate new wall length
    const otherEndpoint = endpoint === 'start' ? wall.endPoint : wall.startPoint;
    const dx = newPosition.x - otherEndpoint.x;
    const dy = newPosition.y - otherEndpoint.y;
    const newLength = Math.sqrt(dx * dx + dy * dy);

    // Validate minimum length
    if (newLength < this.options.constraints.minLength) {
      violations.push({
        type: 'min-length',
        message: `Wall length cannot be less than ${this.options.constraints.minLength}mm`,
        wallId,
        value: newLength,
        limit: this.options.constraints.minLength,
      });
      // Don't update if too short
      return {
        success: false,
        updatedWalls: [],
        warnings: ['Wall too short'],
        constraintViolations: violations,
      };
    }

    // Get original endpoint position for connected wall updates
    const originalEndpoint = endpoint === 'start' ? wall.startPoint : wall.endPoint;

    // Update the wall
    if (endpoint === 'start') {
      this.updateWallFn(wallId, { startPoint: newPosition });
    } else {
      this.updateWallFn(wallId, { endPoint: newPosition });
    }

    const updatedWall = this.getWallFn(wallId);
    if (updatedWall) {
      updatedWalls.push(updatedWall);
    }

    // Update connected walls if requested
    if (moveConnected && wall.connectedWalls.length > 0) {
      const delta = subtract(newPosition, originalEndpoint);

      for (const connectedId of wall.connectedWalls) {
        const connectedWall = this.getWallFn(connectedId);
        if (!connectedWall) continue;

        // Check which endpoint of the connected wall matches
        const tolerance = 1; // 1mm tolerance
        const startDist = this.distance(connectedWall.startPoint, originalEndpoint);
        const endDist = this.distance(connectedWall.endPoint, originalEndpoint);

        if (startDist < tolerance) {
          this.updateWallFn(connectedId, {
            startPoint: add(connectedWall.startPoint, delta),
          });
          const updated = this.getWallFn(connectedId);
          if (updated) updatedWalls.push(updated);
        } else if (endDist < tolerance) {
          this.updateWallFn(connectedId, {
            endPoint: add(connectedWall.endPoint, delta),
          });
          const updated = this.getWallFn(connectedId);
          if (updated) updatedWalls.push(updated);
        }
      }
    }

    return {
      success: true,
      updatedWalls,
      warnings: [],
      constraintViolations: violations,
    };
  }

  // ==========================================================================
  // Center Dragging (Free Translation)
  // ==========================================================================

  /**
   * Drag the center point to translate the wall freely following the mouse
   */
  dragCenter(params: DragCenterParams): WallEditResult {
    const { wallId, dragDelta, moveConnected, snapToGrid } = params;
    const wall = this.getWallFn(wallId);

    if (!wall) {
      return {
        success: false,
        updatedWalls: [],
        warnings: [`Wall ${wallId} not found`],
        constraintViolations: [],
      };
    }

    const updatedWalls: Wall[] = [];

    // Use the full delta for free movement (wall follows mouse directly)
    let offsetVec = { ...dragDelta };

    // Apply grid snapping if enabled
    if (snapToGrid && this.options.snapToGrid) {
      const gridSize = this.options.gridSize;
      offsetVec = {
        x: Math.round(offsetVec.x / gridSize) * gridSize,
        y: Math.round(offsetVec.y / gridSize) * gridSize,
      };
    }

    // New positions
    const newStartPoint = add(wall.startPoint, offsetVec);
    const newEndPoint = add(wall.endPoint, offsetVec);

    // Update the wall
    this.updateWallFn(wallId, {
      startPoint: newStartPoint,
      endPoint: newEndPoint,
    });

    const updatedWall = this.getWallFn(wallId);
    if (updatedWall) {
      updatedWalls.push(updatedWall);
    }

    // Update connected walls if requested
    if (moveConnected && wall.connectedWalls.length > 0) {
      for (const connectedId of wall.connectedWalls) {
        const connectedWall = this.getWallFn(connectedId);
        if (!connectedWall) continue;

        // Check which endpoint of the connected wall matches our endpoints
        const tolerance = 1; // 1mm tolerance

        // Check start point connection
        const startToOurStart = this.distance(connectedWall.startPoint, wall.startPoint);
        const startToOurEnd = this.distance(connectedWall.startPoint, wall.endPoint);
        const endToOurStart = this.distance(connectedWall.endPoint, wall.startPoint);
        const endToOurEnd = this.distance(connectedWall.endPoint, wall.endPoint);

        if (startToOurStart < tolerance || startToOurEnd < tolerance) {
          this.updateWallFn(connectedId, {
            startPoint: add(connectedWall.startPoint, offsetVec),
          });
          const updated = this.getWallFn(connectedId);
          if (updated) updatedWalls.push(updated);
        }

        if (endToOurStart < tolerance || endToOurEnd < tolerance) {
          this.updateWallFn(connectedId, {
            endPoint: add(connectedWall.endPoint, offsetVec),
          });
          const updated = this.getWallFn(connectedId);
          if (updated) updatedWalls.push(updated);
        }
      }
    }

    return {
      success: true,
      updatedWalls,
      warnings: [],
      constraintViolations: [],
    };
  }

  // ==========================================================================
  // Nudge Operation
  // ==========================================================================

  /**
   * Nudge wall(s) by a fixed delta (for arrow key movement)
   */
  nudgeWalls(wallIds: string[], delta: Point2D): WallEditResult {
    const updatedWalls: Wall[] = [];

    for (const wallId of wallIds) {
      const wall = this.getWallFn(wallId);
      if (!wall) continue;

      const newStartPoint = add(wall.startPoint, delta);
      const newEndPoint = add(wall.endPoint, delta);

      this.updateWallFn(wallId, {
        startPoint: newStartPoint,
        endPoint: newEndPoint,
      });

      const updated = this.getWallFn(wallId);
      if (updated) updatedWalls.push(updated);
    }

    return {
      success: true,
      updatedWalls,
      warnings: [],
      constraintViolations: [],
    };
  }

  // ==========================================================================
  // Duplicate Operation
  // ==========================================================================

  /**
   * Duplicate walls with an offset
   */
  duplicateWalls(
    wallIds: string[],
    offset: Point2D,
    addWallFn: (wall: Partial<Wall>) => string
  ): string[] {
    const newWallIds: string[] = [];

    for (const wallId of wallIds) {
      const wall = this.getWallFn(wallId);
      if (!wall) continue;

      const newWallId = addWallFn({
        startPoint: add(wall.startPoint, offset),
        endPoint: add(wall.endPoint, offset),
        thickness: wall.thickness,
        material: wall.material,
        layer: wall.layer,
      });

      newWallIds.push(newWallId);
    }

    return newWallIds;
  }

  // ==========================================================================
  // Connected Walls Query
  // ==========================================================================

  /**
   * Get walls connected at a specific endpoint
   */
  getConnectedWallsAtEndpoint(wallId: string, endpoint: 'start' | 'end'): Wall[] {
    const wall = this.getWallFn(wallId);
    if (!wall) return [];

    const endpointPos = endpoint === 'start' ? wall.startPoint : wall.endPoint;
    const tolerance = 1; // 1mm

    return wall.connectedWalls
      .map(id => this.getWallFn(id))
      .filter((w): w is Wall => {
        if (!w) return false;
        const startDist = this.distance(w.startPoint, endpointPos);
        const endDist = this.distance(w.endPoint, endpointPos);
        return startDist < tolerance || endDist < tolerance;
      });
  }

  // ==========================================================================
  // Preview Calculations
  // ==========================================================================

  /**
   * Calculate preview wall state for edge drag
   */
  previewEdgeDrag(wallId: string, edge: 'interior' | 'exterior', dragDelta: number): Wall | null {
    const wall = this.getWallFn(wallId);
    if (!wall) return null;

    let newThickness: number;

    if (edge === 'interior') {
      newThickness = wall.thickness + dragDelta;
    } else {
      newThickness = wall.thickness - dragDelta;
    }

    // Clamp thickness
    newThickness = Math.max(
      this.options.constraints.minThickness,
      Math.min(this.options.constraints.maxThickness, newThickness)
    );

    const { interiorLine, exteriorLine } = computeOffsetLines(
      wall.startPoint,
      wall.endPoint,
      newThickness
    );

    return {
      ...wall,
      thickness: newThickness,
      interiorLine,
      exteriorLine,
    };
  }

  /**
   * Calculate preview wall state for endpoint drag
   */
  previewEndpointDrag(wallId: string, endpoint: 'start' | 'end', newPosition: Point2D): Wall | null {
    const wall = this.getWallFn(wallId);
    if (!wall) return null;

    const newStartPoint = endpoint === 'start' ? newPosition : wall.startPoint;
    const newEndPoint = endpoint === 'end' ? newPosition : wall.endPoint;
    const { interiorLine, exteriorLine } = computeOffsetLines(newStartPoint, newEndPoint, wall.thickness);

    return {
      ...wall,
      startPoint: newStartPoint,
      endPoint: newEndPoint,
      interiorLine,
      exteriorLine,
    };
  }

  /**
   * Calculate preview wall state for center drag
   */
  previewCenterDrag(wallId: string, dragDelta: Point2D): Wall | null {
    const wall = this.getWallFn(wallId);
    if (!wall) return null;

    // Project delta onto perpendicular for pure parallel movement
    const dir = direction(wall.startPoint, wall.endPoint);
    const perp = perpendicular(dir);
    const perpComponent = dot(dragDelta, perp);
    const offsetVec = scaleVec(perp, perpComponent);

    const newStartPoint = add(wall.startPoint, offsetVec);
    const newEndPoint = add(wall.endPoint, offsetVec);
    const { interiorLine, exteriorLine } = computeOffsetLines(newStartPoint, newEndPoint, wall.thickness);

    return {
      ...wall,
      startPoint: newStartPoint,
      endPoint: newEndPoint,
      interiorLine,
      exteriorLine,
    };
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  setConstraints(constraints: Partial<WallConstraints>): void {
    this.options.constraints = { ...this.options.constraints, ...constraints };
  }

  setGridSize(size: number): void {
    this.options.gridSize = size;
  }

  setSnapToGrid(enabled: boolean): void {
    this.options.snapToGrid = enabled;
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  private distance(a: Point2D, b: Point2D): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
