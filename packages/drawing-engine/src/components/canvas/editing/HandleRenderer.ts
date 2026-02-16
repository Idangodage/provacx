/**
 * HandleRenderer
 *
 * Renders interactive handles for wall and room editing.
 * Handles are rendered as separate Fabric.js objects in an overlay layer.
 */

import * as fabric from 'fabric';
import type { Point2D, Wall, Room, WallHandle, RoomHandle, WallHandleType, RoomHandleType } from '../../../types';
import { HANDLE_COLORS } from '../../../types/editing';
import { MM_TO_PX } from '../scale';
import { wallCenter } from '../wall/WallGeometry';

// =============================================================================
// Types
// =============================================================================

export interface HandleFabricObject extends fabric.FabricObject {
  handleId: string;
  handleType: WallHandleType | RoomHandleType;
  elementId: string;
  elementType: 'wall' | 'room';
}

// =============================================================================
// HandleRenderer Class
// =============================================================================

export class HandleRenderer {
  private canvas: fabric.Canvas;
  private handles: Map<string, HandleFabricObject> = new Map();
  private wallHandles: Map<string, WallHandle[]> = new Map();
  private roomHandles: Map<string, RoomHandle> = new Map();
  private pageHeight: number;
  private scaleRatio: number;

  constructor(canvas: fabric.Canvas, pageHeight: number = 3000, scaleRatio: number = 1) {
    this.canvas = canvas;
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

  // ==========================================================================
  // Coordinate Conversion
  // ==========================================================================

  private toCanvasPoint(point: Point2D): { x: number; y: number } {
    const paperX = point.x / this.scaleRatio;
    const paperY = point.y / this.scaleRatio;
    return {
      x: paperX * MM_TO_PX,
      y: (this.pageHeight - paperY) * MM_TO_PX,
    };
  }

  // ==========================================================================
  // Wall Handle Rendering
  // ==========================================================================

  /**
   * Render all handles for a selected wall
   * Shows exactly 3 dots:
   * - 1 dot on interior line center (for thickness adjustment)
   * - 1 dot on exterior line center (for thickness adjustment)
   * - 1 dot in the wall center (for wall movement)
   */
  renderWallHandles(wall: Wall): WallHandle[] {
    // Clear existing handles for this wall
    this.clearWallHandles(wall.id);

    const handles: WallHandle[] = [];

    // 1. Interior edge handle (dot at midpoint of interior line - for thickness)
    const interiorMidpoint: Point2D = {
      x: (wall.interiorLine.start.x + wall.interiorLine.end.x) / 2,
      y: (wall.interiorLine.start.y + wall.interiorLine.end.y) / 2,
    };
    const interiorHandle = this.createWallHandle(wall, 'interior-edge', interiorMidpoint);
    handles.push(interiorHandle);

    // 2. Exterior edge handle (dot at midpoint of exterior line - for thickness)
    const exteriorMidpoint: Point2D = {
      x: (wall.exteriorLine.start.x + wall.exteriorLine.end.x) / 2,
      y: (wall.exteriorLine.start.y + wall.exteriorLine.end.y) / 2,
    };
    const exteriorHandle = this.createWallHandle(wall, 'exterior-edge', exteriorMidpoint);
    handles.push(exteriorHandle);

    // 3. Center handle (dot in the middle of the wall - for movement)
    const centerPoint = wallCenter(wall);
    const centerHandle = this.createWallHandle(wall, 'center-midpoint', centerPoint);
    handles.push(centerHandle);

    // Render all handles
    for (const handle of handles) {
      this.renderHandle(handle, 'wall');
    }

    this.wallHandles.set(wall.id, handles);
    this.canvas.renderAll();

    return handles;
  }

  private createWallHandle(wall: Wall, type: WallHandleType, position: Point2D): WallHandle {
    return {
      id: `${wall.id}-${type}`,
      wallId: wall.id,
      type,
      position,
    };
  }

  // ==========================================================================
  // Room Handle Rendering
  // ==========================================================================

  /**
   * Render centroid handle for a selected room
   */
  renderRoomHandle(room: Room): RoomHandle {
    // Clear existing handle for this room
    this.clearRoomHandle(room.id);

    const handle: RoomHandle = {
      id: `${room.id}-centroid`,
      roomId: room.id,
      type: 'centroid',
      position: room.centroid,
    };

    this.renderHandle(handle, 'room');
    this.roomHandles.set(room.id, handle);
    this.canvas.renderAll();

    return handle;
  }

  // ==========================================================================
  // Handle Shape Rendering
  // ==========================================================================

  private renderHandle(handle: WallHandle | RoomHandle, elementType: 'wall' | 'room'): void {
    const canvasPos = this.toCanvasPoint(handle.position);
    const config = HANDLE_COLORS[handle.type];
    let fabricObject: HandleFabricObject;

    switch (handle.type) {
      case 'endpoint-start':
      case 'endpoint-end':
        fabricObject = this.createDiamond(canvasPos, config.size, config.color, 'pointer') as unknown as HandleFabricObject;
        break;
      case 'interior-edge':
      case 'exterior-edge':
        // Use circles (dots) for edge handles - for thickness adjustment
        fabricObject = this.createDot(canvasPos, config.size, config.color, 'ew-resize') as unknown as HandleFabricObject;
        break;
      case 'center-midpoint':
        // Use circle (dot) for center handle - for wall movement
        fabricObject = this.createDot(canvasPos, config.size, config.color, 'move') as unknown as HandleFabricObject;
        break;
      case 'centroid':
        fabricObject = this.createCrosshair(canvasPos, config.size, config.color, 'move') as unknown as HandleFabricObject;
        break;
      default:
        return;
    }

    // Attach metadata
    fabricObject.handleId = handle.id;
    fabricObject.handleType = handle.type;
    fabricObject.elementId = 'wallId' in handle ? handle.wallId : handle.roomId;
    fabricObject.elementType = elementType;

    this.handles.set(handle.id, fabricObject);
    this.canvas.add(fabricObject);
  }

  /**
   * Create diamond shape (for endpoints)
   */
  private createDiamond(pos: { x: number; y: number }, size: number, color: string, cursor: string = 'pointer'): fabric.Polygon {
    const half = size / 2;
    const points = [
      { x: 0, y: -half },    // Top
      { x: half, y: 0 },     // Right
      { x: 0, y: half },     // Bottom
      { x: -half, y: 0 },    // Left
    ];

    return new fabric.Polygon(points, {
      left: pos.x,
      top: pos.y,
      fill: color,
      stroke: '#FFFFFF',
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      objectCaching: false,
      hoverCursor: cursor,
    });
  }

  /**
   * Create simple dot/circle (for edge and center handles)
   * Made interactive for dragging
   */
  private createDot(pos: { x: number; y: number }, size: number, color: string, cursor: string = 'pointer'): fabric.Circle {
    return new fabric.Circle({
      left: pos.x,
      top: pos.y,
      radius: size / 2,
      fill: color,
      stroke: '#FFFFFF',
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: true,
      hasControls: false,
      hasBorders: false,
      lockRotation: true,
      lockMovementX: true,
      lockMovementY: true,
      objectCaching: false,
      hoverCursor: cursor,
      moveCursor: cursor,
    });
  }

  /**
   * Create square shape (for edge handles)
   */
  private createSquare(pos: { x: number; y: number }, size: number, color: string): fabric.Rect {
    return new fabric.Rect({
      left: pos.x,
      top: pos.y,
      width: size,
      height: size,
      fill: color,
      stroke: '#FFFFFF',
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      objectCaching: false,
      hoverCursor: 'ew-resize',
    });
  }

  /**
   * Create circle shape (for center handle)
   */
  private createCircle(pos: { x: number; y: number }, size: number, color: string): fabric.Circle {
    return new fabric.Circle({
      left: pos.x,
      top: pos.y,
      radius: size / 2,
      fill: color,
      stroke: '#FFFFFF',
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      objectCaching: false,
      hoverCursor: 'move',
    });
  }

  /**
   * Create crosshair shape (for room centroid)
   */
  private createCrosshair(pos: { x: number; y: number }, size: number, color: string, cursor: string = 'move'): fabric.Group {
    const half = size / 2;

    const horizontal = new fabric.Line([-half, 0, half, 0], {
      stroke: color,
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
    });

    const vertical = new fabric.Line([0, -half, 0, half], {
      stroke: color,
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
    });

    // Outer circle
    const circle = new fabric.Circle({
      radius: half,
      fill: 'transparent',
      stroke: color,
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
    });

    const group = new fabric.Group([circle, horizontal, vertical], {
      left: pos.x,
      top: pos.y,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      objectCaching: false,
      hoverCursor: cursor,
    });

    return group;
  }

  // ==========================================================================
  // Handle State Updates
  // ==========================================================================

  /**
   * Update handle appearance (normal, hover, active)
   */
  setHandleState(handleId: string, state: 'normal' | 'hover' | 'active'): void {
    const fabricObj = this.handles.get(handleId);
    if (!fabricObj) return;

    const config = HANDLE_COLORS[fabricObj.handleType];
    let color: string;

    switch (state) {
      case 'hover':
        color = config.hoverColor;
        break;
      case 'active':
        color = config.activeColor;
        break;
      default:
        color = config.color;
    }

    if ('fill' in fabricObj) {
      fabricObj.set('fill', color);
    }
    if (fabricObj instanceof fabric.Group) {
      fabricObj.getObjects().forEach(obj => {
        if (obj instanceof fabric.Circle) {
          obj.set('stroke', color);
        } else if (obj instanceof fabric.Line) {
          obj.set('stroke', color);
        }
      });
    }

    this.canvas.renderAll();
  }

  // ==========================================================================
  // Clearing Handles
  // ==========================================================================

  /**
   * Clear handles for a specific wall
   */
  clearWallHandles(wallId: string): void {
    const handles = this.wallHandles.get(wallId);
    if (handles) {
      for (const handle of handles) {
        const fabricObj = this.handles.get(handle.id);
        if (fabricObj) {
          this.canvas.remove(fabricObj);
          this.handles.delete(handle.id);
        }
      }
      this.wallHandles.delete(wallId);
    }
  }

  /**
   * Clear handle for a specific room
   */
  clearRoomHandle(roomId: string): void {
    const handle = this.roomHandles.get(roomId);
    if (handle) {
      const fabricObj = this.handles.get(handle.id);
      if (fabricObj) {
        this.canvas.remove(fabricObj);
        this.handles.delete(handle.id);
      }
      this.roomHandles.delete(roomId);
    }
  }

  /**
   * Clear all handles
   */
  clearAllHandles(): void {
    for (const fabricObj of this.handles.values()) {
      this.canvas.remove(fabricObj);
    }
    this.handles.clear();
    this.wallHandles.clear();
    this.roomHandles.clear();
    this.canvas.renderAll();
  }

  // ==========================================================================
  // Handle Queries
  // ==========================================================================

  /**
   * Get all wall handles for a wall
   */
  getWallHandles(wallId: string): WallHandle[] {
    return this.wallHandles.get(wallId) || [];
  }

  /**
   * Get room handle for a room
   */
  getRoomHandle(roomId: string): RoomHandle | undefined {
    return this.roomHandles.get(roomId);
  }

  /**
   * Get all handles
   */
  getAllHandles(): (WallHandle | RoomHandle)[] {
    const handles: (WallHandle | RoomHandle)[] = [];
    for (const wallHandles of this.wallHandles.values()) {
      handles.push(...wallHandles);
    }
    for (const roomHandle of this.roomHandles.values()) {
      handles.push(roomHandle);
    }
    return handles;
  }

  /**
   * Get fabric object for handle
   */
  getHandleFabricObject(handleId: string): HandleFabricObject | undefined {
    return this.handles.get(handleId);
  }

  // ==========================================================================
  // Dispose
  // ==========================================================================

  dispose(): void {
    this.clearAllHandles();
  }
}
