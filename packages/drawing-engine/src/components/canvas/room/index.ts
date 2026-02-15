/**
 * Room Module
 *
 * Auto room detection and enclosure engine.
 * Exports all room-related components.
 */

// Room Detection
export { detectRooms, mergeRoomDetections } from './RoomDetector';
export type { RoomDetectionResult } from './RoomDetector';

// Room Manager
export { RoomManager } from './RoomManager';
export type { RoomUpdateEvent, RoomEventCallback } from './RoomManager';

// Room Renderer
export { RoomRenderer } from './RoomRenderer';
export type { RoomFabricGroup } from './RoomRenderer';
