/**
 * Section line renderer for plan view.
 */

import * as fabric from 'fabric';

import type { Point2D, SectionLine } from '../../../types';
import { DEFAULT_SECTION_LINE_COLOR } from '../../../types/wall';
import { MM_TO_PX } from '../scale';

type NamedObject = fabric.Object & {
  id?: string;
  name?: string;
  sectionLineId?: string;
};

type SectionGroup = fabric.Group & {
  id?: string;
  name?: string;
  sectionLineId?: string;
};

function toCanvasPoint(point: Point2D): Point2D {
  return {
    x: point.x * MM_TO_PX,
    y: point.y * MM_TO_PX,
  };
}

function subtract(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

function perpendicular(v: Point2D): Point2D {
  return { x: -v.y, y: v.x };
}

export class SectionLineRenderer {
  private canvas: fabric.Canvas;
  private groups = new Map<string, SectionGroup>();
  private sectionLineData = new Map<string, SectionLine>();
  private selectedSectionLineIds = new Set<string>();
  private hoveredSectionLineId: string | null = null;
  private previewObjects: fabric.FabricObject[] = [];
  private showReferenceIndicators = true;
  private draggable = true;
  private onSectionLineMoved: ((id: string, deltaX: number, deltaY: number) => void) | null = null;

  constructor(canvas: fabric.Canvas) {
    this.canvas = canvas;
  }

  setDraggable(draggable: boolean): void {
    this.draggable = draggable;
  }

  onMoved(callback: (id: string, deltaX: number, deltaY: number) => void): void {
    this.onSectionLineMoved = callback;
  }

  setShowReferenceIndicators(show: boolean): void {
    this.showReferenceIndicators = show;
    this.renderAll(Array.from(this.sectionLineData.values()));
  }

  private annotate(target: fabric.FabricObject, sectionLineId: string, name?: string): void {
    const typed = target as NamedObject;
    typed.sectionLineId = sectionLineId;
    typed.id = sectionLineId;
    if (name) {
      typed.name = name;
    }
  }

  private createArrow(point: Point2D, direction: Point2D, color: string): fabric.Polygon {
    const unit = normalize(direction);
    const normal = perpendicular(unit);
    const tip = point;
    const size = 16;
    const width = 10;
    const base = {
      x: tip.x - unit.x * size,
      y: tip.y - unit.y * size,
    };
    const left = {
      x: base.x + normal.x * width * 0.5,
      y: base.y + normal.y * width * 0.5,
    };
    const right = {
      x: base.x - normal.x * width * 0.5,
      y: base.y - normal.y * width * 0.5,
    };
    return new fabric.Polygon([tip, left, right], {
      fill: color,
      stroke: color,
      strokeWidth: 1,
      selectable: false,
      evented: false,
    });
  }

  private removeSectionLine(sectionLineId: string): void {
    const group = this.groups.get(sectionLineId);
    if (!group) return;
    this.canvas.remove(group);
    this.groups.delete(sectionLineId);
  }

  renderSectionLine(sectionLine: SectionLine): void {
    this.removeSectionLine(sectionLine.id);
    this.sectionLineData.set(sectionLine.id, sectionLine);

    const start = toCanvasPoint(sectionLine.startPoint);
    const end = toCanvasPoint(sectionLine.endPoint);
    const directionVector = normalize(subtract(end, start));
    const normal = {
      x: perpendicular(directionVector).x * sectionLine.direction,
      y: perpendicular(directionVector).y * sectionLine.direction,
    };
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    const color = sectionLine.color || DEFAULT_SECTION_LINE_COLOR;

    const line = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: color,
      strokeWidth: 2.5,
      strokeDashArray: [10, 6, 2, 6],
      selectable: false,
      evented: true,
    });
    this.annotate(line, sectionLine.id, 'section-line');

    const startArrow = this.createArrow(start, {
      x: start.x - end.x,
      y: start.y - end.y,
    }, color);
    this.annotate(startArrow, sectionLine.id, 'section-line-arrow-start');

    const endArrow = this.createArrow(end, {
      x: end.x - start.x,
      y: end.y - start.y,
    }, color);
    this.annotate(endArrow, sectionLine.id, 'section-line-arrow-end');

    const viewArrowTip = {
      x: midpoint.x + normal.x * 26,
      y: midpoint.y + normal.y * 26,
    };
    const viewArrow = this.createArrow(viewArrowTip, normal, color);
    this.annotate(viewArrow, sectionLine.id, 'section-line-view-arrow');

    const label = new fabric.Text(sectionLine.label, {
      left: midpoint.x + normal.x * 38,
      top: midpoint.y + normal.y * 38,
      fontSize: 12,
      fill: color,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    this.annotate(label, sectionLine.id, 'section-line-label');

    const selectionHalo = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: '#1D4ED8',
      strokeWidth: 5,
      selectable: false,
      evented: false,
      visible: this.selectedSectionLineIds.has(sectionLine.id),
    });
    this.annotate(selectionHalo, sectionLine.id, 'section-line-selection');

    const hoverHalo = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: '#059669',
      strokeWidth: 4,
      selectable: false,
      evented: false,
      visible: this.hoveredSectionLineId === sectionLine.id && !this.selectedSectionLineIds.has(sectionLine.id),
    });
    this.annotate(hoverHalo, sectionLine.id, 'section-line-hover');

    const objects: fabric.FabricObject[] = [
      selectionHalo,
      hoverHalo,
      line,
      startArrow,
      endArrow,
      viewArrow,
      label,
    ];

    if (this.showReferenceIndicators && sectionLine.showReferenceIndicators) {
      const refStart = {
        x: midpoint.x - normal.x * 1000,
        y: midpoint.y - normal.y * 1000,
      };
      const refEnd = {
        x: midpoint.x + normal.x * 1000,
        y: midpoint.y + normal.y * 1000,
      };
      const reference = new fabric.Line([refStart.x, refStart.y, refEnd.x, refEnd.y], {
        stroke: color,
        strokeWidth: 1.2,
        strokeDashArray: [4, 5],
        opacity: 0.7,
        selectable: false,
        evented: false,
      });
      this.annotate(reference, sectionLine.id, 'section-line-reference');
      objects.push(reference);
    }

    const isDraggable = this.draggable && !sectionLine.locked;
    const group = new fabric.Group(objects, {
      selectable: true,
      evented: true,
      subTargetCheck: true,
      hasControls: false,
      hasBorders: false,
      lockMovementX: !isDraggable,
      lockMovementY: !isDraggable,
      objectCaching: false,
    }) as SectionGroup;
    group.id = sectionLine.id;
    group.sectionLineId = sectionLine.id;
    group.name = `section-line-${sectionLine.id}`;

    // Track drag for position updates
    if (isDraggable) {
      let dragStartLeft = 0;
      let dragStartTop = 0;
      group.on('mousedown', () => {
        dragStartLeft = group.left ?? 0;
        dragStartTop = group.top ?? 0;
      });
      group.on('mouseup', () => {
        const deltaX = (group.left ?? 0) - dragStartLeft;
        const deltaY = (group.top ?? 0) - dragStartTop;
        if ((Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) && this.onSectionLineMoved) {
          this.onSectionLineMoved(sectionLine.id, deltaX, deltaY);
        }
      });
    }

    this.canvas.add(group);
    this.groups.set(sectionLine.id, group);
  }

  renderAll(sectionLines: SectionLine[]): void {
    this.groups.forEach((group) => this.canvas.remove(group));
    this.groups.clear();
    this.sectionLineData.clear();

    sectionLines.forEach((sectionLine) => this.renderSectionLine(sectionLine));
    this.canvas.requestRenderAll();
  }

  setSelectedSectionLines(ids: string[]): void {
    this.selectedSectionLineIds = new Set(ids);
    this.groups.forEach((group, sectionLineId) => {
      const selection = group
        .getObjects()
        .find((object) => (object as NamedObject).name === 'section-line-selection');
      const hover = group
        .getObjects()
        .find((object) => (object as NamedObject).name === 'section-line-hover');
      if (selection) {
        selection.set('visible', this.selectedSectionLineIds.has(sectionLineId));
      }
      if (hover) {
        hover.set('visible', this.hoveredSectionLineId === sectionLineId && !this.selectedSectionLineIds.has(sectionLineId));
      }
    });
    this.canvas.requestRenderAll();
  }

  setHoveredSectionLine(id: string | null): void {
    this.hoveredSectionLineId = id;
    this.groups.forEach((group, sectionLineId) => {
      const hover = group
        .getObjects()
        .find((object) => (object as NamedObject).name === 'section-line-hover');
      if (!hover) return;
      hover.set('visible', sectionLineId === id && !this.selectedSectionLineIds.has(sectionLineId));
    });
    this.canvas.requestRenderAll();
  }

  renderPreview(startPoint: Point2D, currentPoint: Point2D, direction: 1 | -1, label: string): void {
    this.clearPreview();

    const start = toCanvasPoint(startPoint);
    const end = toCanvasPoint(currentPoint);
    const color = DEFAULT_SECTION_LINE_COLOR;
    const directionVector = normalize(subtract(end, start));
    const normal = {
      x: perpendicular(directionVector).x * direction,
      y: perpendicular(directionVector).y * direction,
    };
    const midpoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };

    const previewLine = new fabric.Line([start.x, start.y, end.x, end.y], {
      stroke: color,
      strokeWidth: 2,
      strokeDashArray: [8, 6],
      selectable: false,
      evented: false,
      opacity: 0.9,
    });
    const previewArrow = this.createArrow({
      x: midpoint.x + normal.x * 24,
      y: midpoint.y + normal.y * 24,
    }, normal, color);
    const previewLabel = new fabric.Text(label, {
      left: midpoint.x + normal.x * 36,
      top: midpoint.y + normal.y * 36,
      fontSize: 11,
      fill: color,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });

    this.previewObjects = [previewLine, previewArrow, previewLabel];
    this.previewObjects.forEach((object) => this.canvas.add(object));
    this.canvas.requestRenderAll();
  }

  clearPreview(): void {
    if (this.previewObjects.length === 0) return;
    this.previewObjects.forEach((object) => this.canvas.remove(object));
    this.previewObjects = [];
    this.canvas.requestRenderAll();
  }

  dispose(): void {
    this.clearPreview();
    this.groups.forEach((group) => this.canvas.remove(group));
    this.groups.clear();
    this.sectionLineData.clear();
  }
}
