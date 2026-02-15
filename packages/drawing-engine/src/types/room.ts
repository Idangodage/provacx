/**
 * Room Types
 *
 * Type definitions for the room detection and management system.
 * Rooms are enclosed areas formed by connected walls.
 * All coordinates are in millimeters internally.
 */

import type { Point2D } from './index';

// =============================================================================
// Room Interface
// =============================================================================

/**
 * Room - Core room data structure
 *
 * Rooms are automatically detected as enclosed polygons formed by walls.
 * The boundaryPolygon represents the interior face of the room (walls offset inward).
 */
export interface Room {
  id: string;
  name: string;                   // "Living Room", "Bedroom 1", etc.
  boundaryWallIds: string[];      // ordered wall IDs forming the loop
  boundaryPolygon: Point2D[];     // computed closed polygon (interior face)
  area: number;                   // in m² — auto-calculated
  perimeter: number;              // in m — auto-calculated
  centroid: Point2D;              // center point for label placement
  floorLevel: number;             // default 0 (for multi-storey support)
  properties3D: Room3D | null;    // populated in Phase 5
  furnitureIds: string[];         // populated in Phase 7
  hvacEquipmentIds: string[];     // populated in Phase 9
  color: string;                  // fill color (with alpha)
  userOverride: RoomUserOverride | null;  // manual user adjustments
}

/**
 * Room3D - 3D properties for rooms (Phase 5)
 */
export interface Room3D {
  ceilingHeight: number;          // ceiling height in mm
  floorElevation: number;         // floor elevation from ground in mm
  ceilingType: 'flat' | 'sloped'; // ceiling type
}

/**
 * RoomUserOverride - User customizations that persist through re-detection
 */
export interface RoomUserOverride {
  customName?: string;            // user-defined name
  mergedRoomIds?: string[];       // IDs of rooms merged into this one
  virtualBoundary?: Point2D[];    // custom split boundary
}

// =============================================================================
// Graph Types for Room Detection
// =============================================================================

/**
 * GraphNode - A node in the wall graph (represents an endpoint)
 */
export interface GraphNode {
  id: string;
  position: Point2D;
  connectedEdgeIds: string[];     // IDs of edges connected to this node
}

/**
 * GraphEdge - An edge in the wall graph (represents a wall)
 */
export interface GraphEdge {
  id: string;                     // Same as wall ID
  wallId: string;
  startNodeId: string;
  endNodeId: string;
  angle: number;                  // angle in radians from start to end
}

/**
 * WallGraph - The complete graph structure for cycle detection
 */
export interface WallGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

/**
 * DetectedCycle - A cycle found in the graph (potential room)
 */
export interface DetectedCycle {
  edgeIds: string[];              // ordered edge IDs forming the cycle
  nodeIds: string[];              // ordered node IDs
  isClockwise: boolean;           // winding order
  signedArea: number;             // positive = CCW, negative = CW
}

// =============================================================================
// Room Detection Types
// =============================================================================

/**
 * RoomDetectionResult - Result of room detection
 */
export interface RoomDetectionResult {
  rooms: Room[];
  warnings: string[];
  stats: RoomDetectionStats;
}

/**
 * RoomDetectionStats - Statistics from room detection
 */
export interface RoomDetectionStats {
  totalNodes: number;
  totalEdges: number;
  cyclesFound: number;
  roomsCreated: number;
  executionTimeMs: number;
}

/**
 * RoomDetectionOptions - Options for room detection
 */
export interface RoomDetectionOptions {
  snapTolerance: number;          // tolerance for merging nearby nodes (mm), default 5
  minRoomArea: number;            // minimum room area to consider valid (m²), default 1
  maxRoomArea: number;            // maximum room area to consider valid (m²), default 10000
  defaultRoomColor: string;       // default fill color, default 'rgba(14,165,233,0.15)'
}

// =============================================================================
// Room State Types
// =============================================================================

/**
 * RoomRenderOptions - Options for room rendering
 */
export interface RoomRenderOptions {
  showLabels: boolean;
  showArea: boolean;
  showCentroid: boolean;
  labelFontSize: number;
  areaFontSize: number;
  highlightSelected: boolean;
}

/**
 * RoomState - State for room management
 */
export interface RoomState {
  rooms: Room[];
  selectedRoomId: string | null;
  hoveredRoomId: string | null;
  editingRoomId: string | null;   // room being renamed
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_ROOM_DETECTION_OPTIONS: RoomDetectionOptions = {
  snapTolerance: 5,               // 5mm tolerance
  minRoomArea: 1,                 // 1 m² minimum
  maxRoomArea: 10000,             // 10,000 m² maximum
  defaultRoomColor: 'rgba(14,165,233,0.15)',  // light blue with 15% opacity
};

export const DEFAULT_ROOM_RENDER_OPTIONS: RoomRenderOptions = {
  showLabels: true,
  showArea: true,
  showCentroid: false,
  labelFontSize: 14,
  areaFontSize: 11,
  highlightSelected: true,
};

export const ROOM_COLORS = [
  'rgba(14, 165, 233, 0.15)',    // blue
  'rgba(16, 185, 129, 0.15)',   // green
  'rgba(245, 158, 11, 0.15)',   // amber
  'rgba(239, 68, 68, 0.15)',    // red
  'rgba(139, 92, 246, 0.15)',   // purple
  'rgba(236, 72, 153, 0.15)',   // pink
  'rgba(6, 182, 212, 0.15)',    // cyan
  'rgba(132, 204, 22, 0.15)',   // lime
];

export const DEFAULT_ROOM_STATE: RoomState = {
  rooms: [],
  selectedRoomId: null,
  hoveredRoomId: null,
  editingRoomId: null,
};
