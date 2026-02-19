/**
 * DimensionRenderer
 *
 * Fabric.js renderer for architectural dimensions.
 */

import * as fabric from 'fabric';

import type { Dimension2D, DimensionSettings, Room, Wall } from '../../../types';
import { DEFAULT_DIMENSION_SETTINGS } from '../../../types';
import { MM_TO_PX } from '../scale';

import {
  getDimensionStyleProfile,
  resolveDimensionGeometry,
  type ResolvedAngularDimensionGeometry,
  type ResolvedAreaDimensionGeometry,
  type ResolvedLinearDimensionGeometry,
} from './dimensionGeometry';

type NamedObject = fabric.Object & {
  id?: string;
  name?: string;
  dimensionId?: string;
  controlType?: 'dimension-text-handle' | 'dimension-offset-handle';
  isDimensionControl?: boolean;
  isDimensionControlDecoration?: boolean;
};

type DimensionGroup = fabric.Group & { id?: string; name?: string; dimensionId?: string };

function toCanvas(value: number): number {
  return value * MM_TO_PX;
}

function toCanvasPoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: toCanvas(point.x),
    y: toCanvas(point.y),
  };
}

function lineCoords(start: { x: number; y: number }, end: { x: number; y: number }): [number, number, number, number] {
  return [toCanvas(start.x), toCanvas(start.y), toCanvas(end.x), toCanvas(end.y)];
}

function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(v.x, v.y);
  if (len < 0.000001) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function perpendicular(v: { x: number; y: number }): { x: number; y: number } {
  return { x: -v.y, y: v.x };
}

export class DimensionRenderer {
  private canvas: fabric.Canvas;
  private dimensionGroups = new Map<string, DimensionGroup>();
  private dimensionData = new Map<string, Dimension2D>();
  private selectedDimensionIds = new Set<string>();
  private hoveredDimensionId: string | null = null;
  private walls: Wall[] = [];
  private rooms: Room[] = [];
  private settings: DimensionSettings = { ...DEFAULT_DIMENSION_SETTINGS };

  constructor(canvas: fabric.Canvas) {
    this.canvas = canvas;
  }

  setContext(walls: Wall[], rooms: Room[], settings: DimensionSettings): void {
    this.walls = walls;
    this.rooms = rooms;
    this.settings = { ...settings };
  }

  private annotate(
    object: fabric.FabricObject,
    dimensionId: string,
    name?: string
  ): void {
    const typed = object as NamedObject;
    typed.dimensionId = dimensionId;
    typed.id = dimensionId;
    if (name) typed.name = name;
  }

  private annotateControl(
    object: fabric.FabricObject,
    dimensionId: string,
    controlType: 'dimension-text-handle' | 'dimension-offset-handle'
  ): void {
    const typed = object as NamedObject;
    typed.dimensionId = dimensionId;
    typed.id = dimensionId;
    typed.name = controlType;
    typed.controlType = controlType;
    typed.isDimensionControl = true;
    typed.selectable = true;
    typed.evented = true;
    typed.hasControls = false;
    typed.hasBorders = false;
  }

  private createTerminator(
    point: { x: number; y: number },
    direction: { x: number; y: number },
    kind: 'arrow' | 'tick',
    dimensionId: string
  ): fabric.FabricObject {
    const canvasPoint = toCanvasPoint(point);
    const unit = normalize(direction);
    const normal = perpendicular(unit);

    if (kind === 'tick') {
      const size = 12;
      const a = {
        x: canvasPoint.x - unit.x * size * 0.5 + normal.x * size * 0.5,
        y: canvasPoint.y - unit.y * size * 0.5 + normal.y * size * 0.5,
      };
      const b = {
        x: canvasPoint.x + unit.x * size * 0.5 - normal.x * size * 0.5,
        y: canvasPoint.y + unit.y * size * 0.5 - normal.y * size * 0.5,
      };
      const tick = new fabric.Line([a.x, a.y, b.x, b.y], {
        stroke: '#111827',
        strokeWidth: 1.5,
        selectable: false,
        evented: false,
      });
      this.annotate(tick, dimensionId, 'terminator');
      return tick;
    }

    const length = 14;
    const width = 8;
    const tip = canvasPoint;
    const baseCenter = {
      x: tip.x - unit.x * length,
      y: tip.y - unit.y * length,
    };
    const left = {
      x: baseCenter.x + normal.x * width * 0.5,
      y: baseCenter.y + normal.y * width * 0.5,
    };
    const right = {
      x: baseCenter.x - normal.x * width * 0.5,
      y: baseCenter.y - normal.y * width * 0.5,
    };

    const triangle = new fabric.Polygon([tip, left, right], {
      fill: '#111827',
      stroke: '#111827',
      strokeWidth: 1,
      selectable: false,
      evented: false,
    });
    this.annotate(triangle, dimensionId, 'terminator');
    return triangle;
  }

  private createTextWithBackground(
    label: string,
    x: number,
    y: number,
    fontSize: number,
    dimensionId: string
  ): fabric.FabricObject[] {
    const text = new fabric.Text(label, {
      left: toCanvas(x),
      top: toCanvas(y),
      fill: '#0F172A',
      fontSize,
      fontFamily: 'Arial',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: true,
    });
    this.annotate(text, dimensionId, 'dimensionText');

    const width = (text.width ?? 0) + 10;
    const height = (text.height ?? fontSize) + 4;
    const bg = new fabric.Rect({
      left: toCanvas(x),
      top: toCanvas(y),
      width,
      height,
      fill: '#FFFFFF',
      stroke: '#94A3B8',
      strokeWidth: 1.2,
      rx: 2,
      ry: 2,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    this.annotate(bg, dimensionId, 'dimensionTextBg');

    const textHandle = new fabric.Circle({
      left: toCanvas(x),
      top: toCanvas(y),
      radius: 6,
      fill: '#EFF6FF',
      stroke: '#1D4ED8',
      strokeWidth: 2.2,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: true,
      visible: this.selectedDimensionIds.has(dimensionId),
      hoverCursor: 'move',
    });
    this.annotateControl(textHandle, dimensionId, 'dimension-text-handle');

    return [bg, text, textHandle];
  }

  private createLinearGroup(
    dimension: Dimension2D,
    geometry: ResolvedLinearDimensionGeometry
  ): DimensionGroup {
    const profile = getDimensionStyleProfile(this.settings, dimension.style);

    const extensionA = new fabric.Line(
      lineCoords(geometry.extensionAStart, geometry.extensionAEnd),
      {
        stroke: '#111827',
        strokeWidth: profile.extensionStrokeWidth,
        selectable: false,
        evented: false,
      }
    );
    this.annotate(extensionA, dimension.id, 'extensionA');

    const extensionB = new fabric.Line(
      lineCoords(geometry.extensionBStart, geometry.extensionBEnd),
      {
        stroke: '#111827',
        strokeWidth: profile.extensionStrokeWidth,
        selectable: false,
        evented: false,
      }
    );
    this.annotate(extensionB, dimension.id, 'extensionB');

    const dimensionLine = new fabric.Line(
      lineCoords(geometry.dimensionStart, geometry.dimensionEnd),
      {
        stroke: '#111827',
        strokeWidth: profile.dimensionStrokeWidth,
        selectable: false,
        evented: true,
      }
    );
    this.annotate(dimensionLine, dimension.id, 'dimensionLine');

    const selectionHalo = new fabric.Line(
      lineCoords(geometry.dimensionStart, geometry.dimensionEnd),
      {
        stroke: '#1D4ED8',
        strokeWidth: 5,
        selectable: false,
        evented: false,
        visible: this.selectedDimensionIds.has(dimension.id),
      }
    );
    this.annotate(selectionHalo, dimension.id, 'selectionHalo');

    const hoverHalo = new fabric.Line(
      lineCoords(geometry.dimensionStart, geometry.dimensionEnd),
      {
        stroke: '#059669',
        strokeWidth: 3.5,
        selectable: false,
        evented: false,
        visible: this.hoveredDimensionId === dimension.id && !this.selectedDimensionIds.has(dimension.id),
      }
    );
    this.annotate(hoverHalo, dimension.id, 'hoverHalo');

    const terminatorA = this.createTerminator(
      geometry.dimensionStart,
      {
        x: geometry.direction.x,
        y: geometry.direction.y,
      },
      profile.terminator,
      dimension.id
    );
    const terminatorB = this.createTerminator(
      geometry.dimensionEnd,
      {
        x: -geometry.direction.x,
        y: -geometry.direction.y,
      },
      profile.terminator,
      dimension.id
    );

    const [textBg, text, textHandle] = this.createTextWithBackground(
      geometry.label,
      geometry.textPosition.x,
      geometry.textPosition.y,
      profile.textSizePx,
      dimension.id
    );

    const offsetHandle = new fabric.Circle({
      left: toCanvas(geometry.midpoint.x),
      top: toCanvas(geometry.midpoint.y),
      radius: 6,
      fill: '#EFF6FF',
      stroke: '#1D4ED8',
      strokeWidth: 2.2,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: true,
      hoverCursor: 'ns-resize',
      visible: this.selectedDimensionIds.has(dimension.id),
    });
    this.annotateControl(offsetHandle, dimension.id, 'dimension-offset-handle');

    const group = new fabric.Group(
      [
        extensionA,
        extensionB,
        selectionHalo,
        hoverHalo,
        dimensionLine,
        terminatorA,
        terminatorB,
        textBg,
        text,
        textHandle,
        offsetHandle,
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
    ) as DimensionGroup;

    group.id = dimension.id;
    group.dimensionId = dimension.id;
    group.name = `dimension-${dimension.id}`;
    return group;
  }

  private createAngularArcPath(geometry: ResolvedAngularDimensionGeometry): string {
    const start = toCanvasPoint(geometry.arcStart);
    const end = toCanvasPoint(geometry.arcEnd);
    const radius = toCanvas(geometry.radius);
    const sweep = geometry.deltaAngle >= 0 ? 1 : 0;
    const largeArc = Math.abs(geometry.deltaAngle) > Math.PI ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;
  }

  private createAngularGroup(
    dimension: Dimension2D,
    geometry: ResolvedAngularDimensionGeometry
  ): DimensionGroup {
    const profile = getDimensionStyleProfile(this.settings, dimension.style);
    const accent = geometry.isCommonAngle ? '#2563EB' : '#111827';

    const legA = new fabric.Line(lineCoords(geometry.vertex, geometry.arcStart), {
      stroke: '#111827',
      strokeWidth: profile.extensionStrokeWidth,
      selectable: false,
      evented: false,
    });
    this.annotate(legA, dimension.id, 'angularLegA');

    const legB = new fabric.Line(lineCoords(geometry.vertex, geometry.arcEnd), {
      stroke: '#111827',
      strokeWidth: profile.extensionStrokeWidth,
      selectable: false,
      evented: false,
    });
    this.annotate(legB, dimension.id, 'angularLegB');

    const arc = new fabric.Path(this.createAngularArcPath(geometry), {
      fill: 'transparent',
      stroke: accent,
      strokeWidth: profile.dimensionStrokeWidth,
      selectable: false,
      evented: true,
    });
    this.annotate(arc, dimension.id, 'angularArc');

    const selectionHalo = new fabric.Path(this.createAngularArcPath(geometry), {
      fill: 'transparent',
      stroke: '#1D4ED8',
      strokeWidth: 5,
      selectable: false,
      evented: false,
      visible: this.selectedDimensionIds.has(dimension.id),
    });
    this.annotate(selectionHalo, dimension.id, 'selectionHalo');

    const hoverHalo = new fabric.Path(this.createAngularArcPath(geometry), {
      fill: 'transparent',
      stroke: '#059669',
      strokeWidth: 3.5,
      selectable: false,
      evented: false,
      visible: this.hoveredDimensionId === dimension.id && !this.selectedDimensionIds.has(dimension.id),
    });
    this.annotate(hoverHalo, dimension.id, 'hoverHalo');

    const [textBg, text, textHandle] = this.createTextWithBackground(
      geometry.label,
      geometry.textPosition.x,
      geometry.textPosition.y,
      profile.textSizePx,
      dimension.id
    );

    const group = new fabric.Group(
      [selectionHalo, hoverHalo, legA, legB, arc, textBg, text, textHandle],
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
    ) as DimensionGroup;

    group.id = dimension.id;
    group.dimensionId = dimension.id;
    group.name = `dimension-${dimension.id}`;
    return group;
  }

  private createAreaGroup(
    dimension: Dimension2D,
    geometry: ResolvedAreaDimensionGeometry
  ): DimensionGroup {
    const profile = getDimensionStyleProfile(this.settings, dimension.style);
    const [textBg, text, textHandle] = this.createTextWithBackground(
      geometry.label,
      geometry.textPosition.x,
      geometry.textPosition.y,
      profile.textSizePx + 1,
      dimension.id
    );

    const selectionHalo = new fabric.Rect({
      left: toCanvas(geometry.textPosition.x),
      top: toCanvas(geometry.textPosition.y),
      width: (text.width ?? 0) + 16,
      height: (text.height ?? 0) + 10,
      stroke: '#1D4ED8',
      strokeWidth: 3,
      fill: 'rgba(37,99,235,0.08)',
      strokeDashArray: [6, 4],
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      visible: this.selectedDimensionIds.has(dimension.id),
    });
    this.annotate(selectionHalo, dimension.id, 'selectionHalo');

    const hoverHalo = new fabric.Rect({
      left: toCanvas(geometry.textPosition.x),
      top: toCanvas(geometry.textPosition.y),
      width: (text.width ?? 0) + 14,
      height: (text.height ?? 0) + 8,
      stroke: '#059669',
      strokeWidth: 2.5,
      fill: 'rgba(16,185,129,0.08)',
      strokeDashArray: [5, 5],
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
      visible: this.hoveredDimensionId === dimension.id && !this.selectedDimensionIds.has(dimension.id),
    });
    this.annotate(hoverHalo, dimension.id, 'hoverHalo');

    const group = new fabric.Group([selectionHalo, hoverHalo, textBg, text, textHandle], {
      selectable: true,
      evented: true,
      subTargetCheck: true,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      objectCaching: false,
    }) as DimensionGroup;

    group.id = dimension.id;
    group.dimensionId = dimension.id;
    group.name = `dimension-${dimension.id}`;
    return group;
  }

  private createDimensionGroup(dimension: Dimension2D): DimensionGroup | null {
    const geometry = resolveDimensionGeometry(dimension, this.walls, this.rooms, this.settings);
    if (!geometry) return null;

    if (geometry.kind === 'linear') {
      return this.createLinearGroup(dimension, geometry);
    }
    if (geometry.kind === 'angular') {
      return this.createAngularGroup(dimension, geometry);
    }
    return this.createAreaGroup(dimension, geometry);
  }

  renderDimension(dimension: Dimension2D): void {
    this.removeDimension(dimension.id);
    this.dimensionData.set(dimension.id, dimension);
    if (!dimension.visible || !this.settings.showLayer) return;

    const group = this.createDimensionGroup(dimension);
    if (!group) return;

    this.dimensionGroups.set(dimension.id, group);
    this.canvas.add(group);
    this.canvas.bringObjectToFront(group);
  }

  renderAllDimensions(dimensions: Dimension2D[]): void {
    this.dimensionGroups.forEach((group) => this.canvas.remove(group));
    this.dimensionGroups.clear();
    this.dimensionData.clear();

    dimensions.forEach((dimension) => this.renderDimension(dimension));
    this.setSelectedDimensions([...this.selectedDimensionIds]);
    this.canvas.requestRenderAll();
  }

  setSelectedDimensions(dimensionIds: string[]): void {
    this.selectedDimensionIds = new Set(dimensionIds);
    this.dimensionGroups.forEach((group, dimensionId) => {
      const selected = this.selectedDimensionIds.has(dimensionId);
      group.getObjects().forEach((obj) => {
        const typed = obj as NamedObject;
        if (typed.name === 'selectionHalo') {
          obj.set('visible', selected);
        } else if (typed.name === 'hoverHalo') {
          obj.set('visible', !selected && this.hoveredDimensionId === dimensionId);
        } else if (typed.isDimensionControl) {
          obj.set('visible', selected);
        }
      });
    });
    this.canvas.requestRenderAll();
  }

  setHoveredDimension(dimensionId: string | null): void {
    this.hoveredDimensionId = dimensionId;
    this.dimensionGroups.forEach((group, currentId) => {
      group.getObjects().forEach((obj) => {
        const typed = obj as NamedObject;
        if (typed.name === 'hoverHalo') {
          obj.set(
            'visible',
            currentId === dimensionId && !this.selectedDimensionIds.has(currentId)
          );
        }
      });
    });
    this.canvas.requestRenderAll();
  }

  removeDimension(dimensionId: string): void {
    const group = this.dimensionGroups.get(dimensionId);
    if (group) {
      this.canvas.remove(group);
      this.dimensionGroups.delete(dimensionId);
    }
    this.dimensionData.delete(dimensionId);
    this.selectedDimensionIds.delete(dimensionId);
    if (this.hoveredDimensionId === dimensionId) {
      this.hoveredDimensionId = null;
    }
  }

  getDimensionObject(dimensionId: string): DimensionGroup | undefined {
    return this.dimensionGroups.get(dimensionId);
  }

  clearAllDimensions(): void {
    this.dimensionGroups.forEach((group) => this.canvas.remove(group));
    this.dimensionGroups.clear();
    this.dimensionData.clear();
    this.selectedDimensionIds.clear();
    this.hoveredDimensionId = null;
    this.canvas.requestRenderAll();
  }

  dispose(): void {
    this.clearAllDimensions();
  }
}
