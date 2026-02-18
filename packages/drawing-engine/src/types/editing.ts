/**
 * Editing Types
 *
 * Type definitions for interactive wall and room editing.
 */

import type { Point2D, Wall, Room } from './index';

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Wall handle types for editing
 */
export type WallHandleType =
  | 'endpoint-start'    // Diamond at wall start point
  | 'endpoint-end'      // Diamond at wall end point
  | 'interior-edge'     // Square on interior line midpoint
  | 'exterior-edge'     // Square on exterior line midpoint
  | 'center-midpoint';  // Circle at center-line midpoint

/**
 * Room handle types for editing
 */
export type RoomHandleType = 'centroid';  // Crosshair at room center

/**
 * Wall handle data
 */
export interface WallHandle {
  id: string;
  wallId: string;
  type: WallHandleType;
  position: Point2D;  // In real-world mm
}

/**
 * Room handle data
 */
export interface RoomHandle {
  id: string;
  roomId: string;
  type: RoomHandleType;
  position: Point2D;  // In real-world mm
}

/**
 * Combined handle type
 */
export type EditHandle = WallHandle | RoomHandle;

/**
 * Hit test result for handles
 */
export interface HandleHitResult {
  type: 'wall' | 'room';
  handleType: WallHandleType | RoomHandleType;
  elementId: string;  // wallId or roomId
  handle: EditHandle;
  priority: number;   // Lower = higher priority
}

// =============================================================================
// Drag State
// =============================================================================

/**
 * State during a drag operation
 */
export interface DragState {
  isActive: boolean;
  handleType: WallHandleType | RoomHandleType | null;
  elementId: string | null;
  startPosition: Point2D | null;
  currentPosition: Point2D | null;
  initialWallState: Wall | null;
  initialRoomState: Room | null;
  connectedWallIds: string[];
  affectedRoomIds: string[];
}

/**
 * Default drag state
 */
export const DEFAULT_DRAG_STATE: DragState = {
  isActive: false,
  handleType: null,
  elementId: null,
  startPosition: null,
  currentPosition: null,
  initialWallState: null,
  initialRoomState: null,
  connectedWallIds: [],
  affectedRoomIds: [],
};

// =============================================================================
// Edit Results
// =============================================================================

/**
 * Result of a wall edit operation
 */
export interface WallEditResult {
  success: boolean;
  updatedWalls: Wall[];
  warnings: string[];
  constraintViolations: ConstraintViolation[];
}

/**
 * Result of a room move operation
 */
export interface RoomMoveResult {
  success: boolean;
  movedWallIds: string[];
  duplicatedWallIds: string[];
  requiresPrompt: boolean;
  sharedWallInfo?: SharedWallInfo[];
}

/**
 * Info about shared walls between rooms
 */
export interface SharedWallInfo {
  wallId: string;
  sharedWithRoomIds: string[];
}

// =============================================================================
// Constraints
// =============================================================================

/**
 * Wall editing constraints
 */
export interface WallConstraints {
  minThickness: number;  // mm
  maxThickness: number;  // mm
  minLength: number;     // mm
}

/**
 * Default wall constraints
 */
export const DEFAULT_WALL_CONSTRAINTS: WallConstraints = {
  minThickness: 50,   // 50mm minimum
  maxThickness: 600,  // 600mm maximum
  minLength: 100,     // 100mm minimum
};

/**
 * Constraint violation
 */
export interface ConstraintViolation {
  type: 'min-thickness' | 'max-thickness' | 'min-length' | 'gap-created';
  message: string;
  wallId?: string;
  value?: number;
  limit?: number;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validation result after an edit
 */
export interface ValidationResult {
  isValid: boolean;
  warnings: ValidationWarning[];
  gaps: GapInfo[];
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  type: 'gap' | 'thin-wall' | 'room-broken' | 'disconnected';
  message: string;
  affectedElementIds: string[];
  position?: Point2D;
}

/**
 * Gap information for broken rooms
 */
export interface GapInfo {
  position: Point2D;
  gapSize: number;
  nearbyWallIds: string[];
}

// =============================================================================
// Shared Wall Prompt
// =============================================================================

/**
 * Prompt for handling shared walls during room move
 */
export interface SharedWallPrompt {
  isVisible: boolean;
  wallId: string | null;
  sourceRoomId: string | null;
  targetRoomIds: string[];
  position: Point2D | null;
}

/**
 * User choice for shared wall handling
 */
export type SharedWallChoice = 'move' | 'duplicate' | 'cancel';

/**
 * Default shared wall prompt state
 */
export const DEFAULT_SHARED_WALL_PROMPT: SharedWallPrompt = {
  isVisible: false,
  wallId: null,
  sourceRoomId: null,
  targetRoomIds: [],
  position: null,
};

// =============================================================================
// Handle Visual Config
// =============================================================================

/**
 * Handle visual configuration
 */
export interface HandleVisualConfig {
  size: number;
  color: string;
  hoverColor: string;
  activeColor: string;
}

/**
 * Handle colors by type
 */
export const HANDLE_COLORS: Record<WallHandleType | RoomHandleType, HandleVisualConfig> = {
  'endpoint-start': {
    size: 10,
    color: '#4CAF50',    // Green
    hoverColor: '#FFEB3B', // Yellow
    activeColor: '#F44336', // Red
  },
  'endpoint-end': {
    size: 10,
    color: '#4CAF50',    // Green
    hoverColor: '#FFEB3B',
    activeColor: '#F44336',
  },
  'interior-edge': {
    size: 8,
    color: '#2196F3',    // Blue
    hoverColor: '#FFEB3B',
    activeColor: '#F44336',
  },
  'exterior-edge': {
    size: 8,
    color: '#FF9800',    // Orange
    hoverColor: '#FFEB3B',
    activeColor: '#F44336',
  },
  'center-midpoint': {
    size: 8,
    color: '#9C27B0',    // Purple
    hoverColor: '#FFEB3B',
    activeColor: '#F44336',
  },
  'centroid': {
    size: 12,
    color: '#E91E63',    // Pink
    hoverColor: '#FFEB3B',
    activeColor: '#F44336',
  },
};

/**
 * Handle hit priorities (lower = higher priority)
 */
export const HANDLE_PRIORITIES: Record<WallHandleType | RoomHandleType, number> = {
  'endpoint-start': 1,
  'endpoint-end': 1,
  'interior-edge': 2,
  'exterior-edge': 2,
  'center-midpoint': 3,
  'centroid': 4,
};
