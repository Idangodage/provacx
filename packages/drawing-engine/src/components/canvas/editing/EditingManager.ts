/**
 * EditingManager
 *
 * Central coordinator for all editing operations.
 * Manages handle rendering, hit testing, and drag operations.
 */

import * as fabric from 'fabric';
import type {
  Point2D,
  Wall,
  Room,
  WallHandle,
  RoomHandle,
  HandleHitResult,
  DragState,
  WallHandleType,
  RoomHandleType,
  ValidationResult,
  GapInfo,
} from '../../../types';
import { DEFAULT_DRAG_STATE } from '../../../types/editing';
import { HandleRenderer } from './HandleRenderer';
import { HandleHitTester } from './HandleHitTester';
import { WallEditor } from './WallEditor';
import { RoomEditor } from './RoomEditor';
import type { SharedWallHandling } from './RoomEditor';
import { subtract, dot, perpendicular, direction } from '../wall/WallGeometry';
import { MM_TO_PX } from '../scale';

// =============================================================================
// Types
// =============================================================================

export interface EditingManagerCallbacks {
  // Wall operations
  getWall: (id: string) => Wall | undefined;
  getAllWalls: () => Wall[];
  updateWall: (id: string, updates: Partial<Wall>) => void;
  addWall: (params: { startPoint: Point2D; endPoint: Point2D; thickness: number; material: string; layer: string }) => string;
  deleteWalls: (ids: string[]) => void;

  // Room operations
  getRoom: (id: string) => Room | undefined;
  getAllRooms: () => Room[];
  detectRooms: () => void;

  // Selection
  getSelectedIds: () => string[];
  setSelectedIds: (ids: string[]) => void;

  // History
  saveToHistory: (action: string) => void;

  // Settings
  getGridSize: () => number;
  getSnapToGrid: () => boolean;
}

export interface EditingManagerOptions {
  pageHeight: number;
  scaleRatio: number;
}

// =============================================================================
// EditingManager Class
// =============================================================================

export class EditingManager {
  private canvas: fabric.Canvas;
  private callbacks: EditingManagerCallbacks;
  private options: EditingManagerOptions;

  private handleRenderer: HandleRenderer;
  private hitTester: HandleHitTester;
  private wallEditor: WallEditor;
  private roomEditor: RoomEditor;

  private dragState: DragState = { ...DEFAULT_DRAG_STATE };
  private selectedWallIds: Set<string> = new Set();
  private selectedRoomIds: Set<string> = new Set();

  constructor(
    canvas: fabric.Canvas,
    callbacks: EditingManagerCallbacks,
    options: EditingManagerOptions
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.options = options;

    // Initialize components
    this.handleRenderer = new HandleRenderer(canvas, options.pageHeight, options.scaleRatio);
    this.hitTester = new HandleHitTester(options.pageHeight, options.scaleRatio);

    this.wallEditor = new WallEditor(
      callbacks.updateWall,
      callbacks.getWall,
      callbacks.getAllWalls,
      {
        gridSize: callbacks.getGridSize(),
        snapToGrid: callbacks.getSnapToGrid(),
      }
    );

    this.roomEditor = new RoomEditor({
      getRoom: callbacks.getRoom,
      getAllRooms: callbacks.getAllRooms,
      getWall: callbacks.getWall,
      getAllWalls: callbacks.getAllWalls,
      updateWall: callbacks.updateWall,
      addWall: callbacks.addWall,
    });
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  setPageHeight(height: number): void {
    this.options.pageHeight = height;
    this.handleRenderer.setPageHeight(height);
    this.hitTester.setPageHeight(height);
  }

  setScaleRatio(ratio: number): void {
    this.options.scaleRatio = ratio;
    this.handleRenderer.setScaleRatio(ratio);
    this.hitTester.setScaleRatio(ratio);
  }

  updateSettings(): void {
    this.wallEditor.setGridSize(this.callbacks.getGridSize());
    this.wallEditor.setSnapToGrid(this.callbacks.getSnapToGrid());
  }

  // ==========================================================================
  // Selection & Handle Display
  // ==========================================================================

  /**
   * Show handles for selected wall(s)
   */
  showHandlesForWall(wallId: string): void {
    const wall = this.callbacks.getWall(wallId);
    if (!wall) return;

    const handles = this.handleRenderer.renderWallHandles(wall);
    this.hitTester.addHandles(handles);
    this.selectedWallIds.add(wallId);
  }

  /**
   * Show handles for selected room
   */
  showHandlesForRoom(roomId: string): void {
    const room = this.callbacks.getRoom(roomId);
    if (!room) return;

    const handle = this.handleRenderer.renderRoomHandle(room);
    this.hitTester.addHandles([handle]);
    this.selectedRoomIds.add(roomId);
  }

  /**
   * Hide all handles
   */
  hideAllHandles(): void {
    this.handleRenderer.clearAllHandles();
    this.hitTester.clearHandles();
    this.selectedWallIds.clear();
    this.selectedRoomIds.clear();
  }

  /**
   * Update handles for selection change
   */
  updateSelection(selectedIds: string[]): void {
    this.hideAllHandles();

    for (const id of selectedIds) {
      // Check if it's a wall
      const wall = this.callbacks.getWall(id);
      if (wall) {
        this.showHandlesForWall(id);
        continue;
      }

      // Check if it's a room
      const room = this.callbacks.getRoom(id);
      if (room) {
        this.showHandlesForRoom(id);
      }
    }
  }

  /**
   * Refresh handles (after wall geometry changes)
   */
  refreshHandles(): void {
    const wallIds = Array.from(this.selectedWallIds);
    const roomIds = Array.from(this.selectedRoomIds);

    this.hideAllHandles();

    for (const wallId of wallIds) {
      this.showHandlesForWall(wallId);
    }
    for (const roomId of roomIds) {
      this.showHandlesForRoom(roomId);
    }
  }

  // ==========================================================================
  // Hit Testing
  // ==========================================================================

  /**
   * Test for handle hit at canvas coordinates
   */
  hitTestAtPoint(canvasPoint: Point2D): HandleHitResult | null {
    return this.hitTester.hitTest(canvasPoint);
  }

  /**
   * Test for handle hit at real-world coordinates
   */
  hitTestRealWorld(realWorldPoint: Point2D): HandleHitResult | null {
    return this.hitTester.hitTestRealWorld(realWorldPoint);
  }

  // ==========================================================================
  // Drag Operations
  // ==========================================================================

  /**
   * Start a drag operation
   */
  startDrag(hitResult: HandleHitResult, startPoint: Point2D): void {
    this.dragState = {
      isActive: true,
      handleType: hitResult.handleType,
      elementId: hitResult.elementId,
      startPosition: startPoint,
      currentPosition: startPoint,
      initialWallState: null,
      initialRoomState: null,
      connectedWallIds: [],
      affectedRoomIds: [],
    };

    // Store initial state for preview/undo
    if (hitResult.type === 'wall') {
      const wall = this.callbacks.getWall(hitResult.elementId);
      if (wall) {
        this.dragState.initialWallState = { ...wall };
        this.dragState.connectedWallIds = [...wall.connectedWalls];
      }
    } else if (hitResult.type === 'room') {
      const room = this.callbacks.getRoom(hitResult.elementId);
      if (room) {
        this.dragState.initialRoomState = { ...room };
        this.dragState.affectedRoomIds = [hitResult.elementId];
      }
    }

    // Set handle to active state
    this.handleRenderer.setHandleState(hitResult.handle.id, 'active');
  }

  /**
   * Update drag position
   */
  updateDrag(currentPoint: Point2D): void {
    if (!this.dragState.isActive || !this.dragState.startPosition) return;

    const previousPoint = this.dragState.currentPosition ?? this.dragState.startPosition;
    this.dragState.currentPosition = currentPoint;
    const delta = subtract(currentPoint, previousPoint);

    // Apply drag based on handle type
    switch (this.dragState.handleType) {
      case 'endpoint-start':
        this.applyEndpointDrag('start', currentPoint);
        break;
      case 'endpoint-end':
        this.applyEndpointDrag('end', currentPoint);
        break;
      case 'interior-edge':
        this.applyEdgeDrag('interior', delta);
        break;
      case 'exterior-edge':
        this.applyEdgeDrag('exterior', delta);
        break;
      case 'center-midpoint':
        this.applyCenterDrag(delta);
        break;
      case 'centroid':
        this.applyRoomDrag(delta);
        break;
    }

    // Refresh handles to match new positions
    this.refreshHandles();
  }

  /**
   * End drag operation and commit changes
   */
  endDrag(): void {
    if (!this.dragState.isActive) return;

    // Save to history
    const actionName = this.getActionName();
    this.callbacks.saveToHistory(actionName);

    // Re-run room detection
    this.callbacks.detectRooms();

    // Reset drag state
    this.resetDragState();
  }

  /**
   * Cancel drag operation and revert changes
   */
  cancelDrag(): void {
    if (!this.dragState.isActive) return;

    // Revert to initial state
    if (this.dragState.initialWallState && this.dragState.elementId) {
      const initial = this.dragState.initialWallState;
      this.callbacks.updateWall(this.dragState.elementId, {
        startPoint: initial.startPoint,
        endPoint: initial.endPoint,
        thickness: initial.thickness,
      });
    }

    this.resetDragState();
    this.refreshHandles();
  }

  /**
   * Check if currently dragging
   */
  isDragging(): boolean {
    return this.dragState.isActive;
  }

  /**
   * Get current drag state
   */
  getDragState(): DragState {
    return { ...this.dragState };
  }

  // ==========================================================================
  // Drag Application Methods
  // ==========================================================================

  private applyEndpointDrag(endpoint: 'start' | 'end', newPosition: Point2D): void {
    if (!this.dragState.elementId) return;

    this.wallEditor.dragEndpoint({
      wallId: this.dragState.elementId,
      endpoint,
      newPosition,
      moveConnected: true,
    });
  }

  private applyEdgeDrag(edge: 'interior' | 'exterior', delta: Point2D): void {
    if (!this.dragState.elementId || !this.dragState.initialWallState) return;

    const wall = this.dragState.initialWallState;
    const dir = direction(wall.startPoint, wall.endPoint);
    const perp = perpendicular(dir);

    // Calculate perpendicular component of drag
    const perpDelta = dot(delta, perp);

    this.wallEditor.dragEdge({
      wallId: this.dragState.elementId,
      edge,
      dragDelta: perpDelta,
    });
  }

  private applyCenterDrag(delta: Point2D): void {
    if (!this.dragState.elementId) return;

    this.wallEditor.dragCenter({
      wallId: this.dragState.elementId,
      dragDelta: delta,
      moveConnected: true,
      snapToGrid: this.callbacks.getSnapToGrid(),
    });
  }

  private applyRoomDrag(delta: Point2D): void {
    if (!this.dragState.elementId) return;

    this.roomEditor.moveRoom({
      roomId: this.dragState.elementId,
      delta,
      handleSharedWalls: 'move', // TODO: Add UI for prompt
    });
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  private resetDragState(): void {
    // Reset handle state
    if (this.dragState.handleType && this.dragState.elementId) {
      const handleId = `${this.dragState.elementId}-${this.dragState.handleType}`;
      this.handleRenderer.setHandleState(handleId, 'normal');
    }

    this.dragState = { ...DEFAULT_DRAG_STATE };
  }

  private getActionName(): string {
    switch (this.dragState.handleType) {
      case 'endpoint-start':
      case 'endpoint-end':
        return 'Resize wall';
      case 'interior-edge':
      case 'exterior-edge':
        return 'Change wall thickness';
      case 'center-midpoint':
        return 'Move wall';
      case 'centroid':
        return 'Move room';
      default:
        return 'Edit';
    }
  }

  // ==========================================================================
  // Keyboard Operations
  // ==========================================================================

  /**
   * Nudge selected walls by delta
   */
  nudgeSelected(delta: Point2D): void {
    const selectedIds = this.callbacks.getSelectedIds();
    const wallIds = selectedIds.filter(id => this.callbacks.getWall(id) !== undefined);

    if (wallIds.length > 0) {
      this.wallEditor.nudgeWalls(wallIds, delta);
      this.callbacks.saveToHistory('Nudge walls');
      this.callbacks.detectRooms();
      this.refreshHandles();
    }
  }

  /**
   * Duplicate selected walls
   */
  duplicateSelected(offset: Point2D = { x: 100, y: 100 }): string[] {
    const selectedIds = this.callbacks.getSelectedIds();
    const wallIds = selectedIds.filter(id => this.callbacks.getWall(id) !== undefined);

    if (wallIds.length > 0) {
      const newIds = this.wallEditor.duplicateWalls(wallIds, offset, (params) => {
        return this.callbacks.addWall({
          startPoint: params.startPoint!,
          endPoint: params.endPoint!,
          thickness: params.thickness!,
          material: params.material as string,
          layer: params.layer as string,
        });
      });

      this.callbacks.saveToHistory('Duplicate walls');
      this.callbacks.setSelectedIds(newIds);
      this.callbacks.detectRooms();

      return newIds;
    }

    return [];
  }

  /**
   * Delete selected walls
   */
  deleteSelected(): void {
    const selectedIds = this.callbacks.getSelectedIds();
    const wallIds = selectedIds.filter(id => this.callbacks.getWall(id) !== undefined);

    if (wallIds.length > 0) {
      this.callbacks.deleteWalls(wallIds);
      this.callbacks.saveToHistory('Delete walls');
      this.callbacks.setSelectedIds([]);
      this.callbacks.detectRooms();
      this.hideAllHandles();
    }
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate current state after edits
   */
  validateEdit(): ValidationResult {
    // TODO: Implement gap detection
    return {
      isValid: true,
      warnings: [],
      gaps: [],
    };
  }

  // ==========================================================================
  // Dispose
  // ==========================================================================

  dispose(): void {
    this.hideAllHandles();
    this.resetDragState();
  }
}
