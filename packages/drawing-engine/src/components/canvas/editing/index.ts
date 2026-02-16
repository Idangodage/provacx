/**
 * Editing Module
 *
 * Interactive wall and room editing components.
 */

// Main coordinator
export { EditingManager } from './EditingManager';
export type { EditingManagerCallbacks, EditingManagerOptions } from './EditingManager';

// Handle rendering
export { HandleRenderer } from './HandleRenderer';
export type { HandleFabricObject } from './HandleRenderer';

// Hit testing
export { HandleHitTester } from './HandleHitTester';

// Wall editing
export { WallEditor } from './WallEditor';
export type {
  WallEditorOptions,
  DragEdgeParams,
  DragEndpointParams,
  DragCenterParams,
} from './WallEditor';

// Room editing
export { RoomEditor } from './RoomEditor';
export type { SharedWallHandling, MoveRoomParams, RoomEditorCallbacks } from './RoomEditor';

// Drag preview
export { DragPreview } from './DragPreview';
export type { DragPreviewOptions } from './DragPreview';

// Tooltip manager
export { TooltipManager } from './TooltipManager';
export type { TooltipOptions } from './TooltipManager';
