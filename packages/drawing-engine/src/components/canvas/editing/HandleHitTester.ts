/**
 * HandleHitTester
 *
 * Priority-based hit detection for editing handles.
 * Returns the highest priority handle at a given point.
 */

import type {
  Point2D,
  WallHandle,
  RoomHandle,
  EditHandle,
  HandleHitResult,
  WallHandleType,
  RoomHandleType,
} from '../../../types';
import { HANDLE_PRIORITIES, HANDLE_COLORS } from '../../../types/editing';
import { MM_TO_PX } from '../scale';

// =============================================================================
// HandleHitTester Class
// =============================================================================

export class HandleHitTester {
  private handles: EditHandle[] = [];
  private hitTolerancePx: number = 10;
  private pageHeight: number;
  private scaleRatio: number;

  constructor(pageHeight: number = 3000, scaleRatio: number = 1) {
    this.pageHeight = pageHeight;
    this.scaleRatio = scaleRatio;
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

  /**
   * Set hit tolerance in pixels
   */
  setHitTolerance(tolerancePx: number): void {
    this.hitTolerancePx = tolerancePx;
  }

  /**
   * Update the list of handles to test against
   */
  setHandles(handles: EditHandle[]): void {
    this.handles = handles;
  }

  /**
   * Add handles to the current list
   */
  addHandles(handles: EditHandle[]): void {
    this.handles.push(...handles);
  }

  /**
   * Clear all handles
   */
  clearHandles(): void {
    this.handles = [];
  }

  // ==========================================================================
  // Coordinate Conversion
  // ==========================================================================

  /**
   * Convert canvas point to real-world coordinates
   */
  private toRealWorldPoint(canvasPoint: Point2D): Point2D {
    const paperX = canvasPoint.x / MM_TO_PX;
    const paperY = this.pageHeight - canvasPoint.y / MM_TO_PX;
    return {
      x: paperX * this.scaleRatio,
      y: paperY * this.scaleRatio,
    };
  }

  /**
   * Convert real-world point to canvas coordinates
   */
  private toCanvasPoint(point: Point2D): Point2D {
    const paperX = point.x / this.scaleRatio;
    const paperY = point.y / this.scaleRatio;
    return {
      x: paperX * MM_TO_PX,
      y: (this.pageHeight - paperY) * MM_TO_PX,
    };
  }

  // ==========================================================================
  // Hit Testing
  // ==========================================================================

  /**
   * Test for handle hit at canvas coordinates
   * Returns the highest priority handle within tolerance, or null
   */
  hitTest(canvasPoint: Point2D): HandleHitResult | null {
    const candidates: HandleHitResult[] = [];

    for (const handle of this.handles) {
      const handleCanvasPos = this.toCanvasPoint(handle.position);
      const distance = this.distanceToHandle(canvasPoint, handleCanvasPos, handle.type);

      if (distance <= this.hitTolerancePx) {
        const priority = HANDLE_PRIORITIES[handle.type];
        const isWallHandle = 'wallId' in handle;

        candidates.push({
          type: isWallHandle ? 'wall' : 'room',
          handleType: handle.type,
          elementId: isWallHandle ? (handle as WallHandle).wallId : (handle as RoomHandle).roomId,
          handle,
          priority,
        });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort by priority (lower = higher priority)
    candidates.sort((a, b) => a.priority - b.priority);

    return candidates[0];
  }

  /**
   * Test for handle hit at real-world coordinates
   */
  hitTestRealWorld(realWorldPoint: Point2D): HandleHitResult | null {
    const canvasPoint = this.toCanvasPoint(realWorldPoint);
    return this.hitTest(canvasPoint);
  }

  /**
   * Get all handles within tolerance (for debugging/visualization)
   */
  getAllHitsAtPoint(canvasPoint: Point2D): HandleHitResult[] {
    const hits: HandleHitResult[] = [];

    for (const handle of this.handles) {
      const handleCanvasPos = this.toCanvasPoint(handle.position);
      const distance = this.distanceToHandle(canvasPoint, handleCanvasPos, handle.type);

      if (distance <= this.hitTolerancePx) {
        const priority = HANDLE_PRIORITIES[handle.type];
        const isWallHandle = 'wallId' in handle;

        hits.push({
          type: isWallHandle ? 'wall' : 'room',
          handleType: handle.type,
          elementId: isWallHandle ? (handle as WallHandle).wallId : (handle as RoomHandle).roomId,
          handle,
          priority,
        });
      }
    }

    return hits.sort((a, b) => a.priority - b.priority);
  }

  // ==========================================================================
  // Distance Calculations
  // ==========================================================================

  /**
   * Calculate distance from point to handle
   * Considers handle shape for more accurate hit detection
   */
  private distanceToHandle(
    point: Point2D,
    handlePos: Point2D,
    handleType: WallHandleType | RoomHandleType
  ): number {
    const dx = point.x - handlePos.x;
    const dy = point.y - handlePos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // For different handle shapes, we could adjust the hit area
    // For now, use simple circular hit detection for all
    const config = HANDLE_COLORS[handleType];
    const handleRadius = config.size / 2;

    // Return effective distance (subtract handle radius so we're measuring from edge)
    return Math.max(0, distance - handleRadius);
  }

  /**
   * Simple euclidean distance
   */
  private euclideanDistance(p1: Point2D, p2: Point2D): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ==========================================================================
  // Handle Queries
  // ==========================================================================

  /**
   * Find handle by ID
   */
  findHandleById(handleId: string): EditHandle | undefined {
    return this.handles.find(h => h.id === handleId);
  }

  /**
   * Find handles for a specific wall
   */
  findWallHandles(wallId: string): WallHandle[] {
    return this.handles.filter(
      (h): h is WallHandle => 'wallId' in h && h.wallId === wallId
    );
  }

  /**
   * Find handle for a specific room
   */
  findRoomHandle(roomId: string): RoomHandle | undefined {
    return this.handles.find(
      (h): h is RoomHandle => 'roomId' in h && h.roomId === roomId
    );
  }

  /**
   * Get handle count
   */
  getHandleCount(): number {
    return this.handles.length;
  }
}
