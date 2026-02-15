/**
 * Wall Types
 *
 * Type definitions for the wall drawing system.
 * All coordinates are in millimeters internally.
 */

import type { Point2D } from './index';

// =============================================================================
// Basic Types
// =============================================================================

export interface Line {
  start: Point2D;
  end: Point2D;
}

export type WallMaterial = 'brick' | 'concrete' | 'partition';
export type WallLayer = 'structural' | 'partition';
export type JoinType = 'miter' | 'butt';

// =============================================================================
// Wall Interface
// =============================================================================

/**
 * Wall - Core wall data structure
 *
 * The center-line is the primary geometry. Interior and exterior lines
 * are computed from center +/- (thickness/2), perpendicular to wall direction.
 */
export interface Wall {
  id: string;
  startPoint: Point2D;           // center-line start (in mm)
  endPoint: Point2D;             // center-line end (in mm)
  thickness: number;             // in mm (default 150mm for partition, 200mm for structural)
  material: WallMaterial;
  layer: WallLayer;
  interiorLine: Line;            // computed from center + thickness/2
  exteriorLine: Line;            // computed from center - thickness/2
  connectedWalls: string[];      // IDs of walls sharing endpoints
  openings: Opening[];           // populated by Phase 7
  properties3D: Wall3D | null;   // populated by Phase 5
}

/**
 * CreateWallParams - Parameters for creating a new wall
 */
export interface CreateWallParams {
  startPoint: Point2D;
  endPoint: Point2D;
  thickness?: number;
  material?: WallMaterial;
  layer?: WallLayer;
}

// =============================================================================
// Future Phase Placeholders
// =============================================================================

/**
 * Wall3D - 3D properties for walls (Phase 5)
 */
export interface Wall3D {
  height: number;        // wall height in mm
  baseElevation: number; // base elevation from floor in mm
}

/**
 * Opening - Door/window openings in walls (Phase 7)
 */
export interface Opening {
  id: string;
  type: 'door' | 'window';
  position: number;      // distance from wall start along center-line (mm)
  width: number;         // opening width (mm)
  height: number;        // opening height (mm)
  sillHeight?: number;   // for windows, height from floor (mm)
}

// =============================================================================
// Wall Drawing State
// =============================================================================

/**
 * WallDrawingState - State during wall drawing
 */
export interface WallDrawingState {
  isDrawing: boolean;
  startPoint: Point2D | null;
  currentPoint: Point2D | null;
  chainMode: boolean;
  previewThickness: number;
  previewMaterial: WallMaterial;
}

/**
 * WallSettings - User-configurable wall settings
 */
export interface WallSettings {
  defaultThickness: number;       // default wall thickness (mm)
  defaultMaterial: WallMaterial;
  defaultLayer: WallLayer;
  showCenterLines: boolean;
  snapToGrid: boolean;
  gridSize: number;               // snap grid size (mm), default 100
  endpointSnapTolerance: number;  // snap tolerance in pixels, default 15
  chainModeEnabled: boolean;      // auto-chain walls
}

// =============================================================================
// Room Configuration
// =============================================================================

/**
 * RoomConfig - Configuration for room shortcut
 */
export interface RoomConfig {
  width: number;           // room width (mm)
  height: number;          // room height/depth (mm)
  wallThickness: number;   // wall thickness (mm)
  material: WallMaterial;
}

// =============================================================================
// Join Data
// =============================================================================

/**
 * JoinData - Information about a wall join
 */
export interface JoinData {
  wallId: string;
  otherWallId: string;
  joinPoint: Point2D;
  joinType: JoinType;
  angle: number;           // angle between walls in degrees
  interiorVertex: Point2D; // computed miter/butt interior point
  exteriorVertex: Point2D; // computed miter/butt exterior point
}

/**
 * EndpointSnapResult - Result of endpoint snapping
 */
export interface EndpointSnapResult {
  snappedPoint: Point2D;
  wallId: string;
  endpoint: 'start' | 'end';
  distance: number;
}

/**
 * SnapResult - Result of wall point snapping
 */
export interface SnapResult {
  snappedPoint: Point2D;
  snapType: 'grid' | 'endpoint' | 'angle' | 'none';
  connectedWallId?: string;
  endpoint?: 'start' | 'end';
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_WALL_THICKNESS: Record<WallLayer, number> = {
  structural: 200,  // 200mm for structural walls
  partition: 150,   // 150mm for partition walls
};

export const WALL_MATERIAL_COLORS: Record<WallMaterial, { fill: string; stroke: string; pattern?: 'hatch' }> = {
  brick: { fill: '#FFCCCB', stroke: '#CC9999', pattern: 'hatch' },  // light red with hatch
  concrete: { fill: '#C0C0C0', stroke: '#808080' },                  // grey, no pattern
  partition: { fill: '#ADD8E6', stroke: '#87CEEB' },                 // light blue
};

export const DEFAULT_WALL_SETTINGS: WallSettings = {
  defaultThickness: 150,
  defaultMaterial: 'brick',
  defaultLayer: 'partition',
  showCenterLines: true,
  snapToGrid: true,
  gridSize: 100,              // 100mm grid
  endpointSnapTolerance: 15,  // 15px
  chainModeEnabled: true,
};

export const DEFAULT_WALL_DRAWING_STATE: WallDrawingState = {
  isDrawing: false,
  startPoint: null,
  currentPoint: null,
  chainMode: false,
  previewThickness: 150,
  previewMaterial: 'brick',
};

export const ANGLE_CONSTRAINTS = [0, 45, 90, 135, 180, 225, 270, 315];

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  width: 4000,        // 4m
  height: 3000,       // 3m
  wallThickness: 150, // 150mm
  material: 'brick',
};
