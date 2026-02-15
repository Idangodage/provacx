/**
 * RoomRenderer
 *
 * Fabric.js rendering for rooms with fills, labels, and area display.
 */

import * as fabric from 'fabric';
import type { Point2D, Room, RoomRenderOptions } from '../../../types';
import { DEFAULT_ROOM_RENDER_OPTIONS } from '../../../types/room';
import { MM_TO_PX } from '../scale';

// =============================================================================
// Types
// =============================================================================

export interface RoomFabricGroup extends fabric.Group {
  roomId: string;
  name: string;
}

// =============================================================================
// RoomRenderer Class
// =============================================================================

export class RoomRenderer {
  private canvas: fabric.Canvas;
  private roomObjects: Map<string, RoomFabricGroup> = new Map();
  private pageHeight: number;
  private scaleRatio: number;  // scaleReal / scaleDrawing
  private options: RoomRenderOptions;
  private selectedRoomId: string | null = null;
  private hoveredRoomId: string | null = null;

  constructor(
    canvas: fabric.Canvas,
    pageHeight: number = 3000,
    scaleRatio: number = 1,
    options: Partial<RoomRenderOptions> = {}
  ) {
    this.canvas = canvas;
    this.pageHeight = pageHeight;
    this.scaleRatio = scaleRatio;
    this.options = { ...DEFAULT_ROOM_RENDER_OPTIONS, ...options };
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Set page height for Y-axis conversion
   */
  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

  /**
   * Set scale ratio for coordinate conversion
   */
  setScaleRatio(ratio: number): void {
    this.scaleRatio = ratio;
  }

  /**
   * Update render options
   */
  setOptions(options: Partial<RoomRenderOptions>): void {
    this.options = { ...this.options, ...options };
    // Re-render all rooms with new options
    this.canvas.renderAll();
  }

  // ==========================================================================
  // Coordinate Conversion
  // ==========================================================================

  /**
   * Convert Y coordinate for architectural convention (Y-up to canvas Y-down)
   */
  private toCanvasY(y: number): number {
    const paperMm = y / this.scaleRatio;
    return (this.pageHeight - paperMm) * MM_TO_PX;
  }

  /**
   * Convert point to canvas coordinates
   */
  private toCanvasPoint(point: Point2D): { x: number; y: number } {
    const paperX = point.x / this.scaleRatio;
    const paperY = point.y / this.scaleRatio;
    return {
      x: paperX * MM_TO_PX,
      y: (this.pageHeight - paperY) * MM_TO_PX,
    };
  }

  // ==========================================================================
  // Room Rendering
  // ==========================================================================

  /**
   * Render a single room
   */
  renderRoom(room: Room): RoomFabricGroup {
    // Remove existing room object if any
    this.removeRoom(room.id);

    // Convert polygon to canvas coordinates
    const canvasVertices = room.boundaryPolygon.map(v => this.toCanvasPoint(v));

    // Determine if room is selected or hovered
    const isSelected = this.selectedRoomId === room.id;
    const isHovered = this.hoveredRoomId === room.id;

    // Parse room color to extract RGB values
    const baseColor = room.color;
    let fillColor = baseColor;
    let strokeColor = this.extractStrokeColor(baseColor);

    if (isSelected && this.options.highlightSelected) {
      strokeColor = '#0284c7';  // blue-600
      fillColor = this.adjustOpacity(baseColor, 0.3);
    } else if (isHovered) {
      fillColor = this.adjustOpacity(baseColor, 0.25);
    }

    // Create room polygon fill
    const polygon = new fabric.Polygon(canvasVertices, {
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: isSelected ? 2 : 1,
      selectable: true,
      evented: true,
      objectCaching: false,
    });

    const objects: fabric.FabricObject[] = [polygon];

    // Add room label if enabled
    if (this.options.showLabels) {
      const labelPos = this.toCanvasPoint(room.centroid);
      const label = new fabric.Text(room.name, {
        left: labelPos.x,
        top: labelPos.y - (this.options.showArea ? 10 : 0),
        fontSize: this.options.labelFontSize,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: '600',
        fill: '#1e3a5f',
        textAlign: 'center',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      objects.push(label);
    }

    // Add area display if enabled
    if (this.options.showArea) {
      const areaPos = this.toCanvasPoint(room.centroid);
      const areaText = `${room.area} m²`;
      const areaLabel = new fabric.Text(areaText, {
        left: areaPos.x,
        top: areaPos.y + (this.options.showLabels ? 10 : 0),
        fontSize: this.options.areaFontSize,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: '400',
        fill: '#64748b',
        textAlign: 'center',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      objects.push(areaLabel);
    }

    // Add centroid marker if enabled
    if (this.options.showCentroid) {
      const centroidPos = this.toCanvasPoint(room.centroid);
      const marker = new fabric.Circle({
        left: centroidPos.x - 3,
        top: centroidPos.y - 3,
        radius: 3,
        fill: '#0284c7',
        stroke: '#ffffff',
        strokeWidth: 1,
        selectable: false,
        evented: false,
      });
      objects.push(marker);
    }

    // Create group
    const group = new fabric.Group(objects, {
      selectable: true,
      evented: true,
      subTargetCheck: true,
    }) as RoomFabricGroup;

    // Store room ID and name
    group.roomId = room.id;
    group.name = `room-${room.id}`;

    // Add to canvas (rooms should be below walls)
    this.canvas.add(group);
    this.canvas.sendObjectToBack(group);
    this.roomObjects.set(room.id, group);

    return group;
  }

  /**
   * Render all rooms
   */
  renderAllRooms(rooms: Room[]): void {
    // Clear existing room objects
    this.clearAllRooms();

    // Render each room
    for (const room of rooms) {
      this.renderRoom(room);
    }

    this.canvas.renderAll();
  }

  /**
   * Update an existing room's rendering
   */
  updateRoom(room: Room): void {
    this.renderRoom(room);
  }

  /**
   * Remove a room from the canvas
   */
  removeRoom(roomId: string): void {
    const existing = this.roomObjects.get(roomId);
    if (existing) {
      this.canvas.remove(existing);
      this.roomObjects.delete(roomId);
    }
  }

  /**
   * Clear all rooms
   */
  clearAllRooms(): void {
    for (const obj of this.roomObjects.values()) {
      this.canvas.remove(obj);
    }
    this.roomObjects.clear();
  }

  // ==========================================================================
  // Selection and Hover
  // ==========================================================================

  /**
   * Set selected room
   */
  setSelectedRoom(roomId: string | null): void {
    const previousSelected = this.selectedRoomId;
    this.selectedRoomId = roomId;

    // Re-render affected rooms
    if (previousSelected) {
      const group = this.roomObjects.get(previousSelected);
      if (group) {
        // Room exists, find and update it
        // We need the room data to re-render, so we'll just update styles
        this.updateRoomStyles(previousSelected, false, this.hoveredRoomId === previousSelected);
      }
    }

    if (roomId) {
      this.updateRoomStyles(roomId, true, false);
    }

    this.canvas.renderAll();
  }

  /**
   * Set hovered room
   */
  setHoveredRoom(roomId: string | null): void {
    const previousHovered = this.hoveredRoomId;
    this.hoveredRoomId = roomId;

    // Re-render affected rooms
    if (previousHovered && previousHovered !== this.selectedRoomId) {
      this.updateRoomStyles(previousHovered, false, false);
    }

    if (roomId && roomId !== this.selectedRoomId) {
      this.updateRoomStyles(roomId, false, true);
    }

    this.canvas.renderAll();
  }

  /**
   * Update room visual styles without full re-render
   */
  private updateRoomStyles(roomId: string, isSelected: boolean, isHovered: boolean): void {
    const group = this.roomObjects.get(roomId);
    if (!group || !group.getObjects().length) return;

    const polygon = group.getObjects()[0] as fabric.Polygon;
    if (!polygon) return;

    // Get original color from the polygon fill or use default
    const currentFill = polygon.get('fill') as string || 'rgba(14,165,233,0.15)';
    const baseColor = this.extractBaseColor(currentFill);

    if (isSelected && this.options.highlightSelected) {
      polygon.set('stroke', '#0284c7');
      polygon.set('strokeWidth', 2);
      polygon.set('fill', this.adjustOpacity(baseColor, 0.3));
    } else if (isHovered) {
      polygon.set('stroke', this.extractStrokeColor(baseColor));
      polygon.set('strokeWidth', 1);
      polygon.set('fill', this.adjustOpacity(baseColor, 0.25));
    } else {
      polygon.set('stroke', this.extractStrokeColor(baseColor));
      polygon.set('strokeWidth', 1);
      polygon.set('fill', baseColor);
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Extract stroke color from fill color (darker version)
   */
  private extractStrokeColor(fillColor: string): string {
    // Parse rgba and make it darker
    const match = fillColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = Math.round(parseInt(match[1]) * 0.7);
      const g = Math.round(parseInt(match[2]) * 0.7);
      const b = Math.round(parseInt(match[3]) * 0.7);
      return `rgb(${r}, ${g}, ${b})`;
    }
    return '#666666';
  }

  /**
   * Extract base color (with original opacity)
   */
  private extractBaseColor(color: string): string {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      return `rgba(${r}, ${g}, ${b}, 0.15)`;
    }
    return color;
  }

  /**
   * Adjust opacity of an rgba color
   */
  private adjustOpacity(color: string, newOpacity: number): string {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${newOpacity})`;
    }
    return color;
  }

  /**
   * Get room object by ID
   */
  getRoomObject(roomId: string): RoomFabricGroup | undefined {
    return this.roomObjects.get(roomId);
  }

  /**
   * Find room at canvas coordinates
   */
  findRoomAtPoint(canvasX: number, canvasY: number): string | null {
    for (const [roomId, group] of this.roomObjects) {
      if (group.containsPoint(new fabric.Point(canvasX, canvasY))) {
        return roomId;
      }
    }
    return null;
  }

  // ==========================================================================
  // Dispose
  // ==========================================================================

  /**
   * Dispose renderer
   */
  dispose(): void {
    this.clearAllRooms();
    this.selectedRoomId = null;
    this.hoveredRoomId = null;
  }
}
