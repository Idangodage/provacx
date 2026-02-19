/**
 * RoomRenderer
 *
 * Fabric.js renderer for detected rooms:
 * - light room fill
 * - centroid label
 * - center marker handle for room move
 */

import * as fabric from 'fabric';

import type { Point2D, Room } from '../../../types';
import { MM_TO_PX } from '../scale';

type NamedObject = fabric.Object & {
  id?: string;
  name?: string;
  roomId?: string;
  controlType?: string;
  cornerIndex?: number;
  scaleDirection?: 'NW' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W';
  isRoomControl?: boolean;
  isRoomControlDecoration?: boolean;
};

type RoomGroup = fabric.Group & { roomId?: string; id?: string; name?: string };
type RoomLabelGroup = fabric.Group & { roomId?: string; id?: string; name?: string };

const MIN_LABEL_FONT_SIZE = 72;
const MAX_LABEL_FONT_SIZE = 56;
const LABEL_OFFSET_Y = 28;
const LABEL_MIN_SCREEN_SCALE = 1.4;
const LABEL_MIN_SCENE_SCALE = 1.05;

function toCanvasPoint(point: Point2D): Point2D {
  return {
    x: point.x * MM_TO_PX,
    y: point.y * MM_TO_PX,
  };
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function roomBounds(vertices: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class RoomRenderer {
  private canvas: fabric.Canvas;
  private roomGroups = new Map<string, RoomGroup>();
  private roomLabelGroups = new Map<string, RoomLabelGroup>();
  private roomData = new Map<string, Room>();
  private selectedRoomIds = new Set<string>();
  private hoveredRoomId: string | null = null;
  private showTemperatureIcons: boolean = true;
  private showVentilationBadges: boolean = true;
  private viewportZoom = 1;

  constructor(canvas: fabric.Canvas) {
    this.canvas = canvas;
  }

  setShowTemperatureIcons(show: boolean): void {
    this.showTemperatureIcons = show;
    this.renderAllRooms(Array.from(this.roomData.values()));
  }

  setShowVentilationBadges(show: boolean): void {
    this.showVentilationBadges = show;
    this.renderAllRooms(Array.from(this.roomData.values()));
  }

  setViewportZoom(zoom: number): void {
    this.viewportZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    this.applyLabelZoomScaling();
    this.canvas.requestRenderAll();
  }

  private annotate(target: fabric.FabricObject, roomId: string, name?: string): void {
    const typed = target as NamedObject;
    typed.roomId = roomId;
    typed.id = roomId;
    if (name) {
      typed.name = name;
    }
  }

  private createRoomLabelGroup(room: Room): RoomLabelGroup | null {
    if (!room.showLabel) {
      return null;
    }

    const centroidCanvas = toCanvasPoint(room.centroid);
    const areaM2 = room.area / 1_000_000;
    const titleFontSize = clamp(Math.sqrt(Math.max(areaM2, 1)) * 2.2 + 11, MIN_LABEL_FONT_SIZE, MAX_LABEL_FONT_SIZE);
    const metaFontSize = clamp(titleFontSize - 2, MIN_LABEL_FONT_SIZE - 1, MAX_LABEL_FONT_SIZE - 2);
    const titleText = room.name;
    const areaText = `${areaM2.toFixed(1)} m²`;

    const title = new fabric.Text(titleText, {
      left: 0,
      top: 0,
      fontSize: titleFontSize,
      fontWeight: 'bold',
      fill: '#0F172A',
      fontFamily: 'Arial',
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
    });
    this.annotate(title, room.id, 'roomLabelTitle');

    const meta = new fabric.Text(areaText, {
      left: 0,
      top: 0,
      fontSize: metaFontSize,
      fill: '#1E293B',
      fontFamily: 'Arial',
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
    });
    this.annotate(meta, room.id, 'roomLabelArea');

    const paddingX = 10;
    const paddingY = 8;
    const lineGap = 4;
    const dotRadius = 5;
    const dotGap = 8;
    const titleWidth = title.width ?? titleText.length * titleFontSize * 0.55;
    const metaWidth = meta.width ?? areaText.length * metaFontSize * 0.55;
    const titleHeight = title.height ?? titleFontSize * 1.2;
    const metaHeight = meta.height ?? metaFontSize * 1.2;
    const textWidth = Math.max(titleWidth, metaWidth);
    const textHeight = titleHeight + lineGap + metaHeight;
    const contentWidth = dotRadius * 2 + dotGap + textWidth;
    const labelWidth = contentWidth + paddingX * 2;
    const labelHeight = textHeight + paddingY * 2;

    const background = new fabric.Rect({
      left: 0,
      top: 0,
      width: labelWidth,
      height: labelHeight,
      rx: 6,
      ry: 6,
      fill: 'rgba(255,255,255,0.96)',
      stroke: 'rgba(15,23,42,0.35)',
      strokeWidth: 1,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      shadow: new fabric.Shadow({
        color: 'rgba(15,23,42,0.2)',
        blur: 5,
        offsetX: 0,
        offsetY: 1,
      }),
    });
    this.annotate(background, room.id, 'roomLabelBackground');

    const dotCenterX = paddingX + dotRadius;
    const textStartX = paddingX + dotRadius * 2 + dotGap;
    const dotCenterY = paddingY + titleHeight * 0.5 + 1;

    const colorDot = new fabric.Circle({
      left: dotCenterX,
      top: dotCenterY,
      radius: dotRadius,
      fill: room.fillColor,
      stroke: '#0F172A',
      strokeWidth: 0.5,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    this.annotate(colorDot, room.id, 'roomLabelDot');

    title.set({
      left: textStartX,
      top: paddingY,
    });
    meta.set({
      left: textStartX,
      top: paddingY + titleHeight + lineGap,
    });

    const labelGroup = new fabric.Group([background, colorDot, title, meta], {
      left: centroidCanvas.x,
      top: centroidCanvas.y - LABEL_OFFSET_Y,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      objectCaching: false,
      excludeFromExport: true,
    }) as RoomLabelGroup;
    labelGroup.id = room.id;
    labelGroup.roomId = room.id;
    labelGroup.name = `room-label-${room.id}`;
    this.applyZoomScaleToLabelGroup(labelGroup);
    return labelGroup;
  }

  private applyZoomScaleToLabelGroup(group: RoomLabelGroup): void {
    const safeZoom = Math.max(this.viewportZoom, 0.05);
    const scale = clamp(LABEL_MIN_SCREEN_SCALE / safeZoom, LABEL_MIN_SCENE_SCALE, 10);
    group.set({
      scaleX: scale,
      scaleY: scale,
    });
  }

  private applyLabelZoomScaling(): void {
    this.roomLabelGroups.forEach((group) => {
      this.applyZoomScaleToLabelGroup(group);
    });
  }

  private createRoomGroup(room: Room): RoomGroup {
    const polygonPoints = room.vertices.map((point) => toCanvasPoint(point));

    const fill = new fabric.Polygon(polygonPoints, {
      fill: room.fillColor,
      opacity: 0.12,
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: true,
    });
    this.annotate(fill, room.id, 'roomFill');

    const selectionOutline = new fabric.Polygon(polygonPoints, {
      fill: 'rgba(37,99,235,0.12)',
      stroke: '#1D4ED8',
      strokeWidth: 3,
      strokeDashArray: [6, 4],
      selectable: false,
      evented: false,
      visible: this.selectedRoomIds.has(room.id),
    });
    this.annotate(selectionOutline, room.id, 'selectionOutline');

    const hoverOutline = new fabric.Polygon(polygonPoints, {
      fill: 'rgba(16,185,129,0.1)',
      stroke: '#059669',
      strokeWidth: 2.5,
      strokeDashArray: [5, 5],
      selectable: false,
      evented: false,
      visible: this.hoveredRoomId === room.id && !this.selectedRoomIds.has(room.id),
    });
    this.annotate(hoverOutline, room.id, 'hoverOutline');

    const labelText = `${room.name} - ${(room.area / 1_000_000).toFixed(1)}m²`;
    const centroidCanvas = toCanvasPoint(room.centroid);
    const bounds = roomBounds(room.vertices);
    const boundsCenter = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    const label = new fabric.Text(labelText, {
      left: centroidCanvas.x,
      top: centroidCanvas.y - 18,
      fontSize: 12,
      fill: '#1F2937',
      fontFamily: 'Arial',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      visible: room.showLabel,
    });
    this.annotate(label, room.id, 'roomLabel');

    const hvacIndicators: fabric.FabricObject[] = [];
    if (this.showTemperatureIcons) {
      const avgSetpoint = (room.properties3D.heatingSetpointC + room.properties3D.coolingSetpointC) / 2;
      const temperatureColor = avgSetpoint <= 20
        ? '#60A5FA'
        : avgSetpoint >= 26
          ? '#F97316'
          : '#34D399';
      const temperatureIcon = new fabric.Circle({
        left: centroidCanvas.x + 44,
        top: centroidCanvas.y - 26,
        radius: 8,
        fill: '#FFFFFF',
        stroke: temperatureColor,
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      this.annotate(temperatureIcon, room.id, 'room-temp-icon');
      const temperatureText = new fabric.Text(`${room.properties3D.heatingSetpointC.toFixed(0)}-${room.properties3D.coolingSetpointC.toFixed(0)}C`, {
        left: centroidCanvas.x + 44,
        top: centroidCanvas.y - 26,
        fontSize: 8,
        fill: '#1F2937',
        fontFamily: 'Arial',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      this.annotate(temperatureText, room.id, 'room-temp-text');
      hvacIndicators.push(temperatureIcon, temperatureText);
    }

    if (this.showVentilationBadges) {
      const ventilationLabel = room.properties3D.requiresExhaust
        ? `OA ${room.properties3D.ventilationOutdoorAirLps.toFixed(0)} + EXH`
        : `OA ${room.properties3D.ventilationOutdoorAirLps.toFixed(0)}`;
      const badgeWidth = Math.max(44, ventilationLabel.length * 4.7);
      const ventilationBadge = new fabric.Rect({
        left: centroidCanvas.x + 44,
        top: centroidCanvas.y - 10,
        width: badgeWidth,
        height: 12,
        rx: 6,
        ry: 6,
        fill: '#FFFFFF',
        stroke: room.properties3D.requiresExhaust ? '#0EA5E9' : '#64748B',
        strokeWidth: 1,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      this.annotate(ventilationBadge, room.id, 'room-oa-badge');
      const ventilationText = new fabric.Text(ventilationLabel, {
        left: centroidCanvas.x + 44,
        top: centroidCanvas.y - 10,
        fontSize: 8,
        fill: '#0F172A',
        fontFamily: 'Arial',
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
      });
      this.annotate(ventilationText, room.id, 'room-oa-text');
      hvacIndicators.push(ventilationBadge, ventilationText);
    }

    const centerHandle = new fabric.Circle({
      left: centroidCanvas.x,
      top: centroidCanvas.y,
      radius: this.selectedRoomIds.has(room.id) ? 9 : 8,
      fill: '#F8FAFC',
      stroke: this.selectedRoomIds.has(room.id) ? '#1D4ED8' : '#334155',
      strokeWidth: 2.5,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hoverCursor: 'move',
      hasControls: false,
      hasBorders: false,
    });
    this.annotate(centerHandle, room.id, 'room-center-handle');
    (centerHandle as NamedObject).controlType = 'room-center-handle';
    (centerHandle as NamedObject).isRoomControl = true;

    const cornerHandles = room.vertices.map((vertex, index) => {
      const cornerPoint = toCanvasPoint(vertex);
      const corner = new fabric.Rect({
        left: cornerPoint.x,
        top: cornerPoint.y,
        width: 12,
        height: 12,
        fill: '#EFF6FF',
        stroke: '#1D4ED8',
        strokeWidth: 2.5,
        originX: 'center',
        originY: 'center',
        selectable: true,
        evented: true,
        hoverCursor: 'move',
        visible: this.selectedRoomIds.has(room.id),
        hasControls: false,
        hasBorders: false,
      });
      this.annotate(corner, room.id, 'room-corner-handle');
      (corner as NamedObject).controlType = 'room-corner-handle';
      (corner as NamedObject).isRoomControl = true;
      (corner as NamedObject).cornerIndex = index;
      return corner;
    });

    const edgeMidHandles = room.vertices.map((vertex, index) => {
      const next = room.vertices[(index + 1) % room.vertices.length];
      const edgePoint = toCanvasPoint(midpoint(vertex, next));
      const edgeHandle = new fabric.Circle({
        left: edgePoint.x,
        top: edgePoint.y,
        radius: 6,
        fill: '#EFF6FF',
        stroke: '#1D4ED8',
        strokeWidth: 2,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        visible: this.selectedRoomIds.has(room.id),
      });
      this.annotate(edgeHandle, room.id, 'room-edge-mid-handle');
      return edgeHandle;
    });

    const scaleHandleSpecs: Array<{
      direction: 'NW' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W';
      point: Point2D;
      cursor: string;
    }> = [
      { direction: 'NW', point: { x: bounds.minX, y: bounds.minY }, cursor: 'nwse-resize' },
      { direction: 'N', point: { x: boundsCenter.x, y: bounds.minY }, cursor: 'ns-resize' },
      { direction: 'NE', point: { x: bounds.maxX, y: bounds.minY }, cursor: 'nesw-resize' },
      { direction: 'E', point: { x: bounds.maxX, y: boundsCenter.y }, cursor: 'ew-resize' },
      { direction: 'SE', point: { x: bounds.maxX, y: bounds.maxY }, cursor: 'nwse-resize' },
      { direction: 'S', point: { x: boundsCenter.x, y: bounds.maxY }, cursor: 'ns-resize' },
      { direction: 'SW', point: { x: bounds.minX, y: bounds.maxY }, cursor: 'nesw-resize' },
      { direction: 'W', point: { x: bounds.minX, y: boundsCenter.y }, cursor: 'ew-resize' },
    ];

    const scaleHandles = scaleHandleSpecs.map((spec) => {
      const scalePoint = toCanvasPoint(spec.point);
      const scaleHandle = new fabric.Rect({
        left: scalePoint.x,
        top: scalePoint.y,
        width: 11,
        height: 11,
        fill: '#ECFDF5',
        stroke: '#15803D',
        strokeWidth: 2.4,
        originX: 'center',
        originY: 'center',
        selectable: true,
        evented: true,
        hoverCursor: spec.cursor,
        visible: this.selectedRoomIds.has(room.id),
        hasControls: false,
        hasBorders: false,
      });
      this.annotate(scaleHandle, room.id, 'room-scale-handle');
      (scaleHandle as NamedObject).controlType = 'room-scale-handle';
      (scaleHandle as NamedObject).isRoomControl = true;
      (scaleHandle as NamedObject).scaleDirection = spec.direction;
      return scaleHandle;
    });

    const crossHorizontal = new fabric.Line(
      [centroidCanvas.x - 5, centroidCanvas.y, centroidCanvas.x + 5, centroidCanvas.y],
      {
        stroke: '#334155',
        strokeWidth: 1.8,
        selectable: false,
        evented: false,
      }
    );
    this.annotate(crossHorizontal, room.id, 'room-center-cross-h');
    (crossHorizontal as NamedObject).isRoomControlDecoration = true;

    const crossVertical = new fabric.Line(
      [centroidCanvas.x, centroidCanvas.y - 5, centroidCanvas.x, centroidCanvas.y + 5],
      {
        stroke: '#334155',
        strokeWidth: 1.8,
        selectable: false,
        evented: false,
      }
    );
    this.annotate(crossVertical, room.id, 'room-center-cross-v');
    (crossVertical as NamedObject).isRoomControlDecoration = true;

    const group = new fabric.Group(
      [
        fill,
        selectionOutline,
        hoverOutline,
        label,
        ...hvacIndicators,
        ...edgeMidHandles,
        ...cornerHandles,
        ...scaleHandles,
        centerHandle,
        crossHorizontal,
        crossVertical,
      ],
      {
        selectable: true,
        evented: true,
        subTargetCheck: true,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        objectCaching: false,
      }
    ) as RoomGroup;

    group.id = room.id;
    group.roomId = room.id;
    group.name = `room-${room.id}`;
    return group;
  }

  renderRoom(room: Room): void {
    this.removeRoom(room.id);
    this.roomData.set(room.id, room);

    const group = this.createRoomGroup(room);
    this.roomGroups.set(room.id, group);
    this.canvas.add(group);
    this.canvas.sendObjectToBack(group);

    const labelGroup = this.createRoomLabelGroup(room);
    if (labelGroup) {
      this.roomLabelGroups.set(room.id, labelGroup);
      this.canvas.add(labelGroup);
      this.canvas.bringObjectToFront(labelGroup);
    }
  }

  renderAllRooms(rooms: Room[]): void {
    this.roomGroups.forEach((group) => {
      this.canvas.remove(group);
    });
    this.roomLabelGroups.forEach((group) => {
      this.canvas.remove(group);
    });
    this.roomGroups.clear();
    this.roomLabelGroups.clear();
    this.roomData.clear();

    rooms.forEach((room) => this.renderRoom(room));
    this.applyLabelZoomScaling();
    this.setSelectedRooms([...this.selectedRoomIds]);
    this.canvas.requestRenderAll();
  }

  setSelectedRooms(roomIds: string[]): void {
    this.selectedRoomIds = new Set(roomIds);
    this.roomGroups.forEach((group, roomId) => {
      const selected = this.selectedRoomIds.has(roomId);
      const selection = group
        .getObjects()
        .find((object) => (object as NamedObject).name === 'selectionOutline');
      if (selection) {
        selection.set('visible', selected);
      }

      const hover = group
        .getObjects()
        .find((object) => (object as NamedObject).name === 'hoverOutline');
      if (hover) {
        hover.set(
          'visible',
          !selected && this.hoveredRoomId === roomId
        );
      }

      const handle = group
        .getObjects()
        .find((object) => (object as NamedObject).name === 'room-center-handle');
      if (handle) {
        const typed = handle as fabric.Circle;
        typed.set({
          radius: selected ? 9 : 8,
          stroke: selected ? '#1D4ED8' : '#334155',
        });
      }

      group.getObjects().forEach((object) => {
        const typed = object as NamedObject;
        if (
          typed.name === 'room-corner-handle' ||
          typed.name === 'room-scale-handle' ||
          typed.name === 'room-edge-mid-handle'
        ) {
          object.set('visible', selected);
        }
      });
    });
    this.canvas.requestRenderAll();
  }

  setHoveredRoom(roomId: string | null): void {
    this.hoveredRoomId = roomId;
    this.roomGroups.forEach((group, currentId) => {
      const hover = group
        .getObjects()
        .find((object) => (object as NamedObject).name === 'hoverOutline');
      if (hover) {
        hover.set(
          'visible',
          currentId === roomId && !this.selectedRoomIds.has(currentId)
        );
      }
    });
    this.canvas.requestRenderAll();
  }

  removeRoom(roomId: string): void {
    const group = this.roomGroups.get(roomId);
    if (group) {
      this.canvas.remove(group);
      this.roomGroups.delete(roomId);
    }
    const labelGroup = this.roomLabelGroups.get(roomId);
    if (labelGroup) {
      this.canvas.remove(labelGroup);
      this.roomLabelGroups.delete(roomId);
    }
    this.roomData.delete(roomId);
    this.selectedRoomIds.delete(roomId);
    if (this.hoveredRoomId === roomId) {
      this.hoveredRoomId = null;
    }
  }

  clearAllRooms(): void {
    this.roomGroups.forEach((group) => this.canvas.remove(group));
    this.roomLabelGroups.forEach((group) => this.canvas.remove(group));
    this.roomGroups.clear();
    this.roomLabelGroups.clear();
    this.roomData.clear();
    this.selectedRoomIds.clear();
    this.hoveredRoomId = null;
    this.canvas.requestRenderAll();
  }

  dispose(): void {
    this.clearAllRooms();
  }
}

