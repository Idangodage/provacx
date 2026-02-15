/**
 * RoomManager
 *
 * Business logic for room operations.
 * Manages room CRUD, user overrides (merge/split/rename), and reactive detection.
 */

import type { Point2D, Wall, Room, RoomUserOverride, RoomDetectionOptions } from '../../../types';
import { detectRooms, mergeRoomDetections } from './RoomDetector';
import { DEFAULT_ROOM_DETECTION_OPTIONS, ROOM_COLORS } from '../../../types/room';

// =============================================================================
// Types
// =============================================================================

export interface RoomUpdateEvent {
  type: 'added' | 'removed' | 'updated' | 'redetected';
  roomIds: string[];
  previousRooms?: Room[];
}

export type RoomEventCallback = (event: RoomUpdateEvent) => void;

// =============================================================================
// RoomManager Class
// =============================================================================

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private previousWallsHash: string = '';
  private eventListeners: Set<RoomEventCallback> = new Set();
  private options: RoomDetectionOptions;

  constructor(options: Partial<RoomDetectionOptions> = {}) {
    this.options = { ...DEFAULT_ROOM_DETECTION_OPTIONS, ...options };
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Subscribe to room update events
   */
  subscribe(callback: RoomEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: RoomUpdateEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  // ==========================================================================
  // Room Access
  // ==========================================================================

  /**
   * Get all rooms
   */
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Get room by ID
   */
  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /**
   * Get rooms at a point
   */
  getRoomsAtPoint(point: Point2D): Room[] {
    const results: Room[] = [];
    for (const room of this.rooms.values()) {
      if (this.isPointInRoom(point, room)) {
        results.push(room);
      }
    }
    return results;
  }

  /**
   * Get room count
   */
  getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Check if a point is inside a room
   */
  isPointInRoom(point: Point2D, room: Room): boolean {
    return this.isPointInPolygon(point, room.boundaryPolygon);
  }

  /**
   * Ray casting algorithm for point in polygon
   */
  private isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const pi = polygon[i];
      const pj = polygon[j];

      if (
        ((pi.y > point.y) !== (pj.y > point.y)) &&
        (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x)
      ) {
        inside = !inside;
      }
    }

    return inside;
  }

  // ==========================================================================
  // Reactive Detection
  // ==========================================================================

  /**
   * Redetect rooms from walls
   * This should be called whenever walls change
   */
  detectFromWalls(walls: Wall[]): Room[] {
    const previousRooms = this.getAllRooms();
    const wallsHash = this.computeWallsHash(walls);

    // Skip if walls haven't changed
    if (wallsHash === this.previousWallsHash) {
      return previousRooms;
    }
    this.previousWallsHash = wallsHash;

    // Run detection
    const result = detectRooms(walls, this.options);

    // Merge with previous rooms to preserve user overrides
    const mergedRooms = mergeRoomDetections(result.rooms, previousRooms);

    // Update internal state
    this.rooms.clear();
    for (const room of mergedRooms) {
      this.rooms.set(room.id, room);
    }

    // Emit event
    this.emit({
      type: 'redetected',
      roomIds: mergedRooms.map(r => r.id),
      previousRooms,
    });

    return mergedRooms;
  }

  /**
   * Compute a hash of walls for change detection
   */
  private computeWallsHash(walls: Wall[]): string {
    // Simple hash based on wall positions
    return walls
      .map(w => `${w.id}:${w.startPoint.x},${w.startPoint.y}-${w.endPoint.x},${w.endPoint.y}`)
      .sort()
      .join('|');
  }

  // ==========================================================================
  // Room CRUD Operations
  // ==========================================================================

  /**
   * Set rooms from external state
   */
  setRooms(rooms: Room[]): void {
    this.rooms.clear();
    for (const room of rooms) {
      this.rooms.set(room.id, room);
    }
  }

  /**
   * Update a room
   */
  updateRoom(id: string, updates: Partial<Room>): Room | null {
    const room = this.rooms.get(id);
    if (!room) return null;

    const updatedRoom = { ...room, ...updates };
    this.rooms.set(id, updatedRoom);

    this.emit({
      type: 'updated',
      roomIds: [id],
    });

    return updatedRoom;
  }

  /**
   * Remove a room
   */
  removeRoom(id: string): boolean {
    const deleted = this.rooms.delete(id);
    if (deleted) {
      this.emit({
        type: 'removed',
        roomIds: [id],
      });
    }
    return deleted;
  }

  /**
   * Clear all rooms
   */
  clear(): void {
    const ids = Array.from(this.rooms.keys());
    this.rooms.clear();
    this.previousWallsHash = '';

    if (ids.length > 0) {
      this.emit({
        type: 'removed',
        roomIds: ids,
      });
    }
  }

  // ==========================================================================
  // User Override Operations
  // ==========================================================================

  /**
   * Rename a room (via double-click on label)
   */
  renameRoom(id: string, newName: string): Room | null {
    const room = this.rooms.get(id);
    if (!room) return null;

    const userOverride: RoomUserOverride = {
      ...room.userOverride,
      customName: newName,
    };

    return this.updateRoom(id, {
      name: newName,
      userOverride,
    });
  }

  /**
   * Merge two rooms into one (e.g., open-plan living + dining)
   */
  mergeRooms(roomId1: string, roomId2: string, newName?: string): Room | null {
    const room1 = this.rooms.get(roomId1);
    const room2 = this.rooms.get(roomId2);

    if (!room1 || !room2) return null;

    // Combine boundary wall IDs (remove duplicates)
    const combinedWallIds = [...new Set([
      ...room1.boundaryWallIds,
      ...room2.boundaryWallIds,
    ])];

    // Combine polygons (this is a simplification - proper merging would need boolean ops)
    // For now, we just use the larger room's polygon
    const polygon1Area = Math.abs(this.signedPolygonArea(room1.boundaryPolygon));
    const polygon2Area = Math.abs(this.signedPolygonArea(room2.boundaryPolygon));
    const largerPolygon = polygon1Area >= polygon2Area
      ? room1.boundaryPolygon
      : room2.boundaryPolygon;

    // Create merged room
    const mergedRoom: Room = {
      id: room1.id,  // Keep first room's ID
      name: newName || `${room1.name} + ${room2.name}`,
      boundaryWallIds: combinedWallIds,
      boundaryPolygon: largerPolygon,
      area: room1.area + room2.area,
      perimeter: Math.max(room1.perimeter, room2.perimeter),
      centroid: {
        x: (room1.centroid.x + room2.centroid.x) / 2,
        y: (room1.centroid.y + room2.centroid.y) / 2,
      },
      floorLevel: room1.floorLevel,
      properties3D: room1.properties3D,
      furnitureIds: [...room1.furnitureIds, ...room2.furnitureIds],
      hvacEquipmentIds: [...room1.hvacEquipmentIds, ...room2.hvacEquipmentIds],
      color: room1.color,
      userOverride: {
        customName: newName,
        mergedRoomIds: [room1.id, room2.id],
      },
    };

    // Remove room2 and update room1
    this.rooms.delete(roomId2);
    this.rooms.set(roomId1, mergedRoom);

    this.emit({
      type: 'updated',
      roomIds: [roomId1],
    });
    this.emit({
      type: 'removed',
      roomIds: [roomId2],
    });

    return mergedRoom;
  }

  /**
   * Split a room with a virtual boundary
   */
  splitRoom(roomId: string, splitLine: [Point2D, Point2D]): [Room, Room] | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // This is a simplified split - proper implementation would need
    // polygon clipping algorithms
    const midPoint = {
      x: (splitLine[0].x + splitLine[1].x) / 2,
      y: (splitLine[0].y + splitLine[1].y) / 2,
    };

    // Create two new rooms by splitting the boundary
    // For simplicity, we split by the centroid side of the split line
    const polygon1: Point2D[] = [];
    const polygon2: Point2D[] = [];

    for (const vertex of room.boundaryPolygon) {
      // Determine which side of the split line this vertex is on
      const side = this.pointSideOfLine(vertex, splitLine[0], splitLine[1]);
      if (side >= 0) {
        polygon1.push(vertex);
      } else {
        polygon2.push(vertex);
      }
    }

    // Add split line endpoints to both polygons
    polygon1.push(splitLine[0], splitLine[1]);
    polygon2.push(splitLine[0], splitLine[1]);

    if (polygon1.length < 3 || polygon2.length < 3) {
      return null;  // Invalid split
    }

    const room1: Room = {
      ...room,
      id: room.id,
      name: `${room.name} A`,
      boundaryPolygon: polygon1,
      area: this.computePolygonArea(polygon1),
      perimeter: this.computePolygonPerimeter(polygon1),
      centroid: this.computePolygonCentroid(polygon1),
      userOverride: {
        virtualBoundary: splitLine,
      },
    };

    const room2: Room = {
      ...room,
      id: `room-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: `${room.name} B`,
      boundaryPolygon: polygon2,
      area: this.computePolygonArea(polygon2),
      perimeter: this.computePolygonPerimeter(polygon2),
      centroid: this.computePolygonCentroid(polygon2),
      color: ROOM_COLORS[(ROOM_COLORS.indexOf(room.color) + 1) % ROOM_COLORS.length],
      userOverride: {
        virtualBoundary: splitLine,
      },
    };

    this.rooms.set(room1.id, room1);
    this.rooms.set(room2.id, room2);

    this.emit({
      type: 'updated',
      roomIds: [room1.id],
    });
    this.emit({
      type: 'added',
      roomIds: [room2.id],
    });

    return [room1, room2];
  }

  /**
   * Change room color
   */
  setRoomColor(id: string, color: string): Room | null {
    return this.updateRoom(id, { color });
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Determine which side of a line a point is on
   * Returns positive for one side, negative for the other, 0 for on the line
   */
  private pointSideOfLine(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
    return (lineEnd.x - lineStart.x) * (point.y - lineStart.y) -
           (lineEnd.y - lineStart.y) * (point.x - lineStart.x);
  }

  /**
   * Compute signed area of polygon (shoelace formula)
   */
  private signedPolygonArea(vertices: Point2D[]): number {
    if (vertices.length < 3) return 0;
    let area = 0;
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += vertices[i].x * vertices[j].y;
      area -= vertices[j].x * vertices[i].y;
    }
    return area / 2;
  }

  /**
   * Compute polygon area in m²
   */
  private computePolygonArea(vertices: Point2D[]): number {
    const areaMm2 = Math.abs(this.signedPolygonArea(vertices));
    return Math.round(areaMm2 / 1_000_000 * 100) / 100;
  }

  /**
   * Compute polygon perimeter in m
   */
  private computePolygonPerimeter(vertices: Point2D[]): number {
    if (vertices.length < 2) return 0;
    let perimeter = 0;
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = vertices[j].x - vertices[i].x;
      const dy = vertices[j].y - vertices[i].y;
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }
    return Math.round(perimeter / 1000 * 100) / 100;
  }

  /**
   * Compute polygon centroid
   */
  private computePolygonCentroid(vertices: Point2D[]): Point2D {
    if (vertices.length === 0) return { x: 0, y: 0 };
    const sumX = vertices.reduce((sum, v) => sum + v.x, 0);
    const sumY = vertices.reduce((sum, v) => sum + v.y, 0);
    return {
      x: sumX / vertices.length,
      y: sumY / vertices.length,
    };
  }

  // ==========================================================================
  // Dispose
  // ==========================================================================

  /**
   * Dispose the manager
   */
  dispose(): void {
    this.rooms.clear();
    this.eventListeners.clear();
    this.previousWallsHash = '';
  }
}
