/**
 * RoomEditor
 *
 * Handles room-specific editing operations:
 * - Room centroid dragging (moves all boundary walls as rigid group)
 * - Shared wall handling (move, duplicate, or prompt)
 */

import type { Point2D, Wall, Room, RoomMoveResult, SharedWallInfo } from '../../../types';
import { add, subtract } from '../wall/WallGeometry';

// =============================================================================
// Types
// =============================================================================

export type SharedWallHandling = 'move' | 'duplicate' | 'prompt';

export interface MoveRoomParams {
  roomId: string;
  delta: Point2D;
  handleSharedWalls: SharedWallHandling;
}

export interface RoomEditorCallbacks {
  getRoom: (id: string) => Room | undefined;
  getAllRooms: () => Room[];
  getWall: (id: string) => Wall | undefined;
  getAllWalls: () => Wall[];
  updateWall: (id: string, updates: Partial<Wall>) => void;
  addWall: (params: { startPoint: Point2D; endPoint: Point2D; thickness: number; material: string; layer: string }) => string;
}

// =============================================================================
// RoomEditor Class
// =============================================================================

export class RoomEditor {
  private callbacks: RoomEditorCallbacks;

  constructor(callbacks: RoomEditorCallbacks) {
    this.callbacks = callbacks;
  }

  // ==========================================================================
  // Room Move Operation
  // ==========================================================================

  /**
   * Move an entire room by moving all its boundary walls as a rigid group
   */
  moveRoom(params: MoveRoomParams): RoomMoveResult {
    const { roomId, delta, handleSharedWalls } = params;
    const room = this.callbacks.getRoom(roomId);

    if (!room) {
      return {
        success: false,
        movedWallIds: [],
        duplicatedWallIds: [],
        requiresPrompt: false,
      };
    }

    // Get all boundary walls
    const boundaryWalls = this.getRoomBoundaryWalls(roomId);

    if (boundaryWalls.length === 0) {
      return {
        success: false,
        movedWallIds: [],
        duplicatedWallIds: [],
        requiresPrompt: false,
      };
    }

    // Check for shared walls
    const sharedWallInfo = this.findSharedWalls(roomId);

    if (sharedWallInfo.length > 0 && handleSharedWalls === 'prompt') {
      // Return early to trigger prompt UI
      return {
        success: false,
        movedWallIds: [],
        duplicatedWallIds: [],
        requiresPrompt: true,
        sharedWallInfo,
      };
    }

    const movedWallIds: string[] = [];
    const duplicatedWallIds: string[] = [];
    const wallsToMove = new Set<string>();
    const wallsToDuplicate = new Set<string>();

    // Categorize walls
    for (const wall of boundaryWalls) {
      const isShared = sharedWallInfo.some(info => info.wallId === wall.id);

      if (isShared && handleSharedWalls === 'duplicate') {
        wallsToDuplicate.add(wall.id);
      } else {
        wallsToMove.add(wall.id);
      }
    }

    // Move walls
    for (const wallId of wallsToMove) {
      const wall = this.callbacks.getWall(wallId);
      if (!wall) continue;

      const newStartPoint = add(wall.startPoint, delta);
      const newEndPoint = add(wall.endPoint, delta);

      this.callbacks.updateWall(wallId, {
        startPoint: newStartPoint,
        endPoint: newEndPoint,
      });

      movedWallIds.push(wallId);
    }

    // Duplicate and move walls
    for (const wallId of wallsToDuplicate) {
      const wall = this.callbacks.getWall(wallId);
      if (!wall) continue;

      const newWallId = this.callbacks.addWall({
        startPoint: add(wall.startPoint, delta),
        endPoint: add(wall.endPoint, delta),
        thickness: wall.thickness,
        material: wall.material,
        layer: wall.layer,
      });

      duplicatedWallIds.push(newWallId);
    }

    return {
      success: true,
      movedWallIds,
      duplicatedWallIds,
      requiresPrompt: false,
      sharedWallInfo: sharedWallInfo.length > 0 ? sharedWallInfo : undefined,
    };
  }

  // ==========================================================================
  // Shared Wall Detection
  // ==========================================================================

  /**
   * Check if a room has walls shared with other rooms
   */
  hasSharedWalls(roomId: string): boolean {
    return this.findSharedWalls(roomId).length > 0;
  }

  /**
   * Find all walls shared between this room and other rooms
   */
  findSharedWalls(roomId: string): SharedWallInfo[] {
    const room = this.callbacks.getRoom(roomId);
    if (!room) return [];

    const allRooms = this.callbacks.getAllRooms();
    const sharedWalls: SharedWallInfo[] = [];

    for (const wallId of room.boundaryWallIds) {
      const sharedWithRoomIds: string[] = [];

      for (const otherRoom of allRooms) {
        if (otherRoom.id === roomId) continue;

        if (otherRoom.boundaryWallIds.includes(wallId)) {
          sharedWithRoomIds.push(otherRoom.id);
        }
      }

      if (sharedWithRoomIds.length > 0) {
        sharedWalls.push({
          wallId,
          sharedWithRoomIds,
        });
      }
    }

    return sharedWalls;
  }

  // ==========================================================================
  // Room Boundary Walls
  // ==========================================================================

  /**
   * Get all walls forming the room boundary
   */
  getRoomBoundaryWalls(roomId: string): Wall[] {
    const room = this.callbacks.getRoom(roomId);
    if (!room) return [];

    return room.boundaryWallIds
      .map(id => this.callbacks.getWall(id))
      .filter((w): w is Wall => w !== undefined);
  }

  // ==========================================================================
  // Preview Calculations
  // ==========================================================================

  /**
   * Calculate preview positions for room move
   */
  previewRoomMove(roomId: string, delta: Point2D): Wall[] {
    const boundaryWalls = this.getRoomBoundaryWalls(roomId);

    return boundaryWalls.map(wall => ({
      ...wall,
      startPoint: add(wall.startPoint, delta),
      endPoint: add(wall.endPoint, delta),
      // Note: interiorLine/exteriorLine would need recomputation for accurate preview
      // For preview purposes, we shift them by delta as well
      interiorLine: {
        start: add(wall.interiorLine.start, delta),
        end: add(wall.interiorLine.end, delta),
      },
      exteriorLine: {
        start: add(wall.exteriorLine.start, delta),
        end: add(wall.exteriorLine.end, delta),
      },
    }));
  }

  // ==========================================================================
  // Room Queries
  // ==========================================================================

  /**
   * Find rooms that would be affected by moving a specific wall
   */
  findRoomsContainingWall(wallId: string): Room[] {
    const allRooms = this.callbacks.getAllRooms();
    return allRooms.filter(room => room.boundaryWallIds.includes(wallId));
  }

  /**
   * Check if moving a wall would break any room's enclosure
   */
  wouldBreakRoom(wallId: string, newStartPoint: Point2D, newEndPoint: Point2D): boolean {
    const affectedRooms = this.findRoomsContainingWall(wallId);

    // For each affected room, check if the wall would still connect
    // This is a simplified check - full implementation would use graph connectivity
    for (const room of affectedRooms) {
      const otherWalls = room.boundaryWallIds
        .filter(id => id !== wallId)
        .map(id => this.callbacks.getWall(id))
        .filter((w): w is Wall => w !== undefined);

      // Check if the new wall endpoints would still connect to other walls
      const tolerance = 1; // 1mm

      let startConnected = false;
      let endConnected = false;

      for (const wall of otherWalls) {
        if (this.distance(newStartPoint, wall.startPoint) < tolerance ||
            this.distance(newStartPoint, wall.endPoint) < tolerance) {
          startConnected = true;
        }
        if (this.distance(newEndPoint, wall.startPoint) < tolerance ||
            this.distance(newEndPoint, wall.endPoint) < tolerance) {
          endConnected = true;
        }
      }

      if (!startConnected || !endConnected) {
        return true; // Would break room
      }
    }

    return false;
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
