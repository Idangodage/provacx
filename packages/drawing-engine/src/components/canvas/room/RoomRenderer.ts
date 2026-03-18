/**
 * RoomRenderer
 *
 * Fabric.js renderer for detected rooms:
 * - light room fill
 * - centroid label
 * - center marker handle for room move
 */

import * as fabric from 'fabric';

import type { Point2D, Room, Wall } from '../../../types';
import { MM_TO_PX } from '../scale';

import { isRoomIsolatedFromAttachments } from './roomIsolation';

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
type RoomControlGroup = fabric.Group & { roomId?: string; id?: string; name?: string };

const MIN_LABEL_FONT_SIZE = 72;
const MAX_LABEL_FONT_SIZE = 56;
const LABEL_MIN_SCREEN_SCALE = 1.4;
const LABEL_MIN_SCENE_SCALE = 1.05;
const LABEL_SELECTED_MARGIN_X = 18;
const LABEL_SELECTED_MARGIN_Y = 16;
const LABEL_SELECTED_INSET = 6;
const LABEL_FIT_STEPS = 18;

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

function polygonArea(vertices: Point2D[]): number {
  let area = 0;
  for (let index = 0, prevIndex = vertices.length - 1; index < vertices.length; prevIndex = index++) {
    const current = vertices[index];
    const previous = vertices[prevIndex];
    area += previous.x * current.y - current.x * previous.y;
  }
  return Math.abs(area) / 2;
}

export class RoomRenderer {
  private canvas: fabric.Canvas;
  private roomGroups = new Map<string, RoomGroup>();
  private roomControlGroups = new Map<string, RoomControlGroup>();
  private roomLabelGroups = new Map<string, RoomLabelGroup>();
  private roomData = new Map<string, Room>();
  private wallData = new Map<string, Wall>();
  private selectedRoomIds = new Set<string>();
  private activeDragRoomId: string | null = null;
  private persistentControlRoomId: string | null = null;
  private hoveredRoomId: string | null = null;
  private showTemperatureIcons: boolean = true;
  private showVentilationBadges: boolean = true;
  private viewportZoom = 1;

  constructor(canvas: fabric.Canvas) {
    this.canvas = canvas;
  }

  private pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
    let inside = false;
    const count = polygon.length;
    for (let index = 0, prevIndex = count - 1; index < count; prevIndex = index++) {
      const current = polygon[index];
      const previous = polygon[prevIndex];
      if (
        ((current.y > point.y) !== (previous.y > point.y)) &&
        (point.x < (previous.x - current.x) * (point.y - current.y) / (previous.y - current.y) + current.x)
      ) {
        inside = !inside;
      }
    }
    return inside;
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

  private annotateDecoration(target: fabric.FabricObject, roomId: string, name?: string): void {
    const typed = target as NamedObject;
    typed.roomId = roomId;
    typed.id = roomId;
    if (name) {
      typed.name = name;
    }
    typed.isRoomControlDecoration = true;
    typed.selectable = false;
    typed.evented = false;
  }

  private sp(screenPx: number): number {
    return screenPx / this.viewportZoom;
  }

  private getLabelScale(): number {
    const safeZoom = Math.max(this.viewportZoom, 0.05);
    return clamp(LABEL_MIN_SCREEN_SCALE / safeZoom, LABEL_MIN_SCENE_SCALE, 10);
  }

  private isRoomControlVisible(roomId: string): boolean {
    return (
      this.selectedRoomIds.has(roomId) ||
      this.activeDragRoomId === roomId ||
      this.persistentControlRoomId === roomId
    );
  }

  private canShowRoomRotationControl(roomId: string): boolean {
    return isRoomIsolatedFromAttachments(this.roomData.get(roomId), this.wallData);
  }

  private isRotationControlObject(object: fabric.FabricObject): boolean {
    const named = object as NamedObject;
    return named.name?.startsWith('room-rotation-handle') ?? false;
  }

  private updateRoomControlGroupVisibility(group: RoomControlGroup, roomId: string): void {
    const visible = this.isRoomControlVisible(roomId);
    const rotationVisible = visible && this.canShowRoomRotationControl(roomId);
    group.getObjects().forEach((object) => {
      object.set('visible', this.isRotationControlObject(object) ? rotationVisible : visible);
      object.setCoords();
    });
    group.set('dirty', true);
    group.setCoords();
    if (visible) {
      this.canvas.bringObjectToFront(group);
    }
  }

  setWallContext(walls: Wall[]): void {
    this.wallData = new Map(walls.map((wall) => [wall.id, wall]));
    this.roomControlGroups.forEach((group, roomId) => {
      this.updateRoomControlGroupVisibility(group, roomId);
    });
    this.canvas.requestRenderAll();
  }

  private doesLabelRectFitRoom(
    center: Point2D,
    halfWidth: number,
    halfHeight: number,
    room: Room
  ): boolean {
    const polygon = room.vertices.map(toCanvasPoint);
    const testPoints: Point2D[] = [
      center,
      { x: center.x - halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y + halfHeight },
      { x: center.x - halfWidth, y: center.y + halfHeight },
    ];
    return testPoints.every((point) => this.pointInPolygon(point, polygon));
  }

  private findFittedLabelCenter(
    room: Room,
    preferredCenter: Point2D,
    fallbackCenter: Point2D,
    halfWidth: number,
    halfHeight: number
  ): Point2D {
    if (this.doesLabelRectFitRoom(preferredCenter, halfWidth, halfHeight, room)) {
      return preferredCenter;
    }

    for (let step = 1; step <= LABEL_FIT_STEPS; step += 1) {
      const t = step / LABEL_FIT_STEPS;
      const candidate = {
        x: preferredCenter.x + (fallbackCenter.x - preferredCenter.x) * t,
        y: preferredCenter.y + (fallbackCenter.y - preferredCenter.y) * t,
      };
      if (this.doesLabelRectFitRoom(candidate, halfWidth, halfHeight, room)) {
        return candidate;
      }
    }

    return fallbackCenter;
  }

  private getRoomLabelCenter(
    room: Room,
    baseWidth: number,
    baseHeight: number,
    scale: number
  ): Point2D {
    const centroidCanvas = toCanvasPoint(room.centroid);
    const halfWidth = (baseWidth * scale) / 2;
    const halfHeight = (baseHeight * scale) / 2;

    if (this.activeDragRoomId !== room.id) {
      return this.findFittedLabelCenter(
        room,
        centroidCanvas,
        centroidCanvas,
        halfWidth,
        halfHeight
      );
    }

    const bounds = roomBounds(room.vertices);
    const minX = bounds.minX * MM_TO_PX;
    const minY = bounds.minY * MM_TO_PX;
    const maxX = bounds.maxX * MM_TO_PX;
    const maxY = bounds.maxY * MM_TO_PX;
    const preferredX = minX + this.sp(LABEL_SELECTED_MARGIN_X) + halfWidth;
    const preferredY = minY + this.sp(LABEL_SELECTED_MARGIN_Y) + halfHeight;
    const clampedMinX = minX + halfWidth + this.sp(LABEL_SELECTED_INSET);
    const clampedMaxX = maxX - halfWidth - this.sp(LABEL_SELECTED_INSET);
    const clampedMinY = minY + halfHeight + this.sp(LABEL_SELECTED_INSET);
    const clampedMaxY = maxY - halfHeight - this.sp(LABEL_SELECTED_INSET);

    if (clampedMaxX <= clampedMinX || clampedMaxY <= clampedMinY) {
      return {
        x: minX + halfWidth + this.sp(LABEL_SELECTED_MARGIN_X),
        y: minY + halfHeight + this.sp(LABEL_SELECTED_MARGIN_Y),
      };
    }

    const preferredCenter = {
      x: clamp(preferredX, clampedMinX, clampedMaxX),
      y: clamp(preferredY, clampedMinY, clampedMaxY),
    };
    return this.findFittedLabelCenter(
      room,
      preferredCenter,
      centroidCanvas,
      halfWidth,
      halfHeight
    );
  }

  private createRoomLabelGroup(room: Room): RoomLabelGroup | null {
    if (!room.showLabel) {
      return null;
    }
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

    const labelScale = this.getLabelScale();
    const labelCenter = this.getRoomLabelCenter(room, labelWidth, labelHeight, labelScale);

    const labelGroup = new fabric.Group([background, colorDot, title, meta], {
      left: labelCenter.x,
      top: labelCenter.y,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      objectCaching: true,
      excludeFromExport: true,
    }) as RoomLabelGroup;
    labelGroup.id = room.id;
    labelGroup.roomId = room.id;
    labelGroup.name = `room-label-${room.id}`;
    this.applyZoomScaleToLabelGroup(labelGroup);
    return labelGroup;
  }

  private applyZoomScaleToLabelGroup(group: RoomLabelGroup): void {
    const scale = this.getLabelScale();
    const room = group.roomId ? this.roomData.get(group.roomId) : null;
    if (room) {
      const center = this.getRoomLabelCenter(room, group.width ?? 0, group.height ?? 0, scale);
      group.set({
        left: center.x,
        top: center.y,
      });
    }
    group.set({
      scaleX: scale,
      scaleY: scale,
    });
    group.setCoords();
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

    const centroidCanvas = toCanvasPoint(room.centroid);

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

    const group = new fabric.Group(
      [
        fill,
        selectionOutline,
        hoverOutline,
        ...hvacIndicators,
      ],
      {
        selectable: true,
        evented: true,
        subTargetCheck: true,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        objectCaching: true,
      }
    ) as RoomGroup;

    group.id = room.id;
    group.roomId = room.id;
    group.name = `room-${room.id}`;
    return group;
  }

  private createRoomControlGroup(room: Room): RoomControlGroup {
    const centroidCanvas = toCanvasPoint(room.centroid);
    const controlsVisible = this.isRoomControlVisible(room.id);
    const rotationControlsVisible = controlsVisible && this.canShowRoomRotationControl(room.id);
    const bounds = roomBounds(room.vertices);
    const boundsCenter = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    const boundsTopCanvas = bounds.minY * MM_TO_PX;
    const centerHandleSize = this.sp(controlsVisible ? 24 : 22);
    const centerHandleInnerSize = Math.max(centerHandleSize - this.sp(4), this.sp(10));
    const centerHandleHit = new fabric.Circle({
      left: centroidCanvas.x,
      top: centroidCanvas.y,
      radius: this.sp(18),
      fill: 'rgba(37,99,235,0.001)',
      stroke: 'rgba(37,99,235,0.001)',
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hoverCursor: 'move',
      hasControls: false,
      hasBorders: false,
      visible: controlsVisible,
    });
    this.annotate(centerHandleHit, room.id, 'room-center-handle-hit');
    (centerHandleHit as NamedObject).controlType = 'room-center-handle';
    (centerHandleHit as NamedObject).isRoomControl = true;
    const centerHandle = new fabric.Rect({
      left: centroidCanvas.x,
      top: centroidCanvas.y,
      width: centerHandleSize,
      height: centerHandleSize,
      rx: this.sp(4),
      ry: this.sp(4),
      fill: '#FFFFFF',
      stroke: '#2563EB',
      strokeWidth: this.sp(2.2),
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hoverCursor: 'move',
      hasControls: false,
      hasBorders: false,
      visible: controlsVisible,
      shadow: new fabric.Shadow({
        color: 'rgba(37, 99, 235, 0.2)',
        blur: this.sp(8),
        offsetX: 0,
        offsetY: this.sp(1),
      }),
    });
    this.annotate(centerHandle, room.id, 'room-center-handle');
    (centerHandle as NamedObject).controlType = 'room-center-handle';
    (centerHandle as NamedObject).isRoomControl = true;

    const centerHandleInner = new fabric.Rect({
      left: centroidCanvas.x,
      top: centroidCanvas.y,
      width: centerHandleInnerSize,
      height: centerHandleInnerSize,
      rx: this.sp(2.8),
      ry: this.sp(2.8),
      fill: '#EFF6FF',
      stroke: '#BFDBFE',
      strokeWidth: this.sp(1),
      originX: 'center',
      originY: 'center',
      visible: controlsVisible,
    });
    this.annotateDecoration(centerHandleInner, room.id, 'room-center-handle-inner');

    const moveAxisHalf = this.sp(4.8);
    const moveHeadLength = this.sp(3.6);
    const moveHeadHalfWidth = this.sp(2.5);
    const moveGlyphH = new fabric.Line(
      [
        centroidCanvas.x - moveAxisHalf,
        centroidCanvas.y,
        centroidCanvas.x + moveAxisHalf,
        centroidCanvas.y,
      ],
      {
        stroke: '#2563EB',
        strokeWidth: this.sp(1.5),
        visible: controlsVisible,
      }
    );
    this.annotateDecoration(moveGlyphH, room.id, 'room-center-glyph-h');
    const moveGlyphV = new fabric.Line(
      [
        centroidCanvas.x,
        centroidCanvas.y - moveAxisHalf,
        centroidCanvas.x,
        centroidCanvas.y + moveAxisHalf,
      ],
      {
        stroke: '#2563EB',
        strokeWidth: this.sp(1.5),
        visible: controlsVisible,
      }
    );
    this.annotateDecoration(moveGlyphV, room.id, 'room-center-glyph-v');
    const createMoveHead = (dx: number, dy: number) =>
      new fabric.Polygon(
        [
          {
            x: centroidCanvas.x + dx * (moveAxisHalf + moveHeadLength),
            y: centroidCanvas.y + dy * (moveAxisHalf + moveHeadLength),
          },
          {
            x: centroidCanvas.x + dx * moveAxisHalf - dy * moveHeadHalfWidth,
            y: centroidCanvas.y + dy * moveAxisHalf + dx * moveHeadHalfWidth,
          },
          {
            x: centroidCanvas.x + dx * moveAxisHalf + dy * moveHeadHalfWidth,
            y: centroidCanvas.y + dy * moveAxisHalf - dx * moveHeadHalfWidth,
          },
        ],
        {
          fill: '#2563EB',
          stroke: '#2563EB',
          strokeWidth: this.sp(0.8),
          visible: controlsVisible,
        }
      );
    const moveHeadRight = createMoveHead(1, 0);
    const moveHeadLeft = createMoveHead(-1, 0);
    const moveHeadDown = createMoveHead(0, 1);
    const moveHeadUp = createMoveHead(0, -1);
    this.annotateDecoration(moveHeadRight, room.id, 'room-center-glyph-right');
    this.annotateDecoration(moveHeadLeft, room.id, 'room-center-glyph-left');
    this.annotateDecoration(moveHeadDown, room.id, 'room-center-glyph-down');
    this.annotateDecoration(moveHeadUp, room.id, 'room-center-glyph-up');

    // Keep room rotation axis visually vertical: handle is always above centroid X.
    const rotationPoint = {
      x: centroidCanvas.x,
      y: boundsTopCanvas - this.sp(40),
    };
    const rotationHandleHit = new fabric.Circle({
      left: rotationPoint.x,
      top: rotationPoint.y,
      radius: this.sp(18),
      fill: 'rgba(21,128,61,0.001)',
      stroke: 'rgba(21,128,61,0.001)',
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hoverCursor: 'alias',
      hasControls: false,
      hasBorders: false,
      visible: rotationControlsVisible,
    });
    this.annotate(rotationHandleHit, room.id, 'room-rotation-handle-hit');
    (rotationHandleHit as NamedObject).controlType = 'room-rotation-handle';
    (rotationHandleHit as NamedObject).isRoomControl = true;
    const rotationStem = new fabric.Line(
      [
        centroidCanvas.x,
        centroidCanvas.y,
        rotationPoint.x,
        rotationPoint.y,
      ],
      {
        stroke: '#15803D',
        strokeWidth: this.sp(1.3),
        strokeDashArray: [this.sp(4), this.sp(3)],
        visible: rotationControlsVisible,
      }
    );
    this.annotateDecoration(rotationStem, room.id, 'room-rotation-handle-stem');
    const rotationHandle = new fabric.Circle({
      left: rotationPoint.x,
      top: rotationPoint.y,
      radius: this.sp(8),
      fill: '#FFFFFF',
      stroke: '#15803D',
      strokeWidth: this.sp(2.2),
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      hoverCursor: 'alias',
      hasControls: false,
      hasBorders: false,
      visible: rotationControlsVisible,
    });
    this.annotate(rotationHandle, room.id, 'room-rotation-handle');
    (rotationHandle as NamedObject).controlType = 'room-rotation-handle';
    (rotationHandle as NamedObject).isRoomControl = true;
    const rotationLabel = new fabric.Text('R', {
      left: rotationPoint.x,
      top: rotationPoint.y,
      fontSize: this.sp(10),
      fontWeight: 'bold',
      fill: '#166534',
      fontFamily: 'Arial',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      visible: rotationControlsVisible,
    });
    this.annotateDecoration(rotationLabel, room.id, 'room-rotation-handle-label');

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
        visible: controlsVisible,
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
        visible: controlsVisible,
      });
      this.annotateDecoration(edgeHandle, room.id, 'room-edge-mid-handle');
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
        visible: controlsVisible,
        hasControls: false,
        hasBorders: false,
      });
      this.annotate(scaleHandle, room.id, 'room-scale-handle');
      (scaleHandle as NamedObject).controlType = 'room-scale-handle';
      (scaleHandle as NamedObject).isRoomControl = true;
      (scaleHandle as NamedObject).scaleDirection = spec.direction;
      return scaleHandle;
    });

    const group = new fabric.Group(
      [
        ...edgeMidHandles,
        ...cornerHandles,
        ...scaleHandles,
        rotationHandleHit,
        rotationStem,
        rotationHandle,
        rotationLabel,
        centerHandleHit,
        centerHandle,
        centerHandleInner,
        moveGlyphH,
        moveGlyphV,
        moveHeadRight,
        moveHeadLeft,
        moveHeadDown,
        moveHeadUp,
      ],
      {
        selectable: true,
        evented: true,
        subTargetCheck: true,
        perPixelTargetFind: true,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        objectCaching: true,
      }
    ) as RoomControlGroup;

    group.id = room.id;
    group.roomId = room.id;
    group.name = `room-controls-${room.id}`;
    return group;
  }

  renderRoom(room: Room): void {
    this.removeRoom(room.id);
    this.roomData.set(room.id, room);

    const group = this.createRoomGroup(room);
    this.roomGroups.set(room.id, group);
    this.canvas.add(group);
    this.canvas.sendObjectToBack(group);

    const controlGroup = this.createRoomControlGroup(room);
    this.roomControlGroups.set(room.id, controlGroup);
    this.canvas.add(controlGroup);
    this.canvas.bringObjectToFront(controlGroup);

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
    this.roomControlGroups.forEach((group) => {
      this.canvas.remove(group);
    });
    this.roomLabelGroups.forEach((group) => {
      this.canvas.remove(group);
    });
    this.roomGroups.clear();
    this.roomControlGroups.clear();
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

      group.set('dirty', true);
    });
    this.roomControlGroups.forEach((group, roomId) => {
      this.updateRoomControlGroupVisibility(group, roomId);
    });
    this.roomLabelGroups.forEach((group) => {
      this.applyZoomScaleToLabelGroup(group);
      group.set('dirty', true);
    });
    this.canvas.requestRenderAll();
  }

  setActiveDragRoom(roomId: string | null): void {
    this.activeDragRoomId = roomId;
    this.roomControlGroups.forEach((group, currentRoomId) => {
      this.updateRoomControlGroupVisibility(group, currentRoomId);
    });
    if (roomId) {
      const labelGroup = this.roomLabelGroups.get(roomId);
      if (labelGroup) {
        this.canvas.bringObjectToFront(labelGroup);
      }
    }
    this.canvas.requestRenderAll();
  }

  setPersistentControlRoom(roomId: string | null): void {
    this.persistentControlRoomId = roomId;
    this.roomControlGroups.forEach((group, currentRoomId) => {
      this.updateRoomControlGroupVisibility(group, currentRoomId);
    });
    if (roomId) {
      const controlGroup = this.roomControlGroups.get(roomId);
      if (controlGroup) {
        this.canvas.bringObjectToFront(controlGroup);
      }
      const labelGroup = this.roomLabelGroups.get(roomId);
      if (labelGroup) {
        this.canvas.bringObjectToFront(labelGroup);
      }
    }
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
      group.set('dirty', true);
    });
    this.canvas.requestRenderAll();
  }

  getRoomIdAtPoint(point: Point2D): string | null {
    let bestRoomId: string | null = null;
    let bestArea = Number.POSITIVE_INFINITY;

    this.roomData.forEach((room, roomId) => {
      if (!this.pointInPolygon(point, room.vertices)) {
        return;
      }

      const area = Number.isFinite(room.area) && room.area > 0
        ? room.area
        : polygonArea(room.vertices);
      if (area < bestArea) {
        bestArea = area;
        bestRoomId = roomId;
      }
    });

    return bestRoomId;
  }

  removeRoom(roomId: string): void {
    const group = this.roomGroups.get(roomId);
    if (group) {
      this.canvas.remove(group);
      this.roomGroups.delete(roomId);
    }
    const controlGroup = this.roomControlGroups.get(roomId);
    if (controlGroup) {
      this.canvas.remove(controlGroup);
      this.roomControlGroups.delete(roomId);
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
    this.roomControlGroups.forEach((group) => this.canvas.remove(group));
    this.roomLabelGroups.forEach((group) => this.canvas.remove(group));
    this.roomGroups.clear();
    this.roomControlGroups.clear();
    this.roomLabelGroups.clear();
    this.roomData.clear();
    this.selectedRoomIds.clear();
    this.activeDragRoomId = null;
    this.persistentControlRoomId = null;
    this.hoveredRoomId = null;
    this.canvas.requestRenderAll();
  }

  dispose(): void {
    this.clearAllRooms();
  }
}
