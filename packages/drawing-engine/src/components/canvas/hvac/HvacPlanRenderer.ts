/**
 * HvacPlanRenderer
 *
 * Renders HVAC elements (ducted AC units, etc.) on the Fabric.js plan canvas.
 * Ceiling-mounted items are shown with dashed outlines per architectural convention.
 */

import * as fabric from 'fabric';

import type { HvacElement, Point2D } from '../../../types';
import { MM_TO_PX } from '../scale';

type NamedObject = fabric.Object & {
  id?: string;
  name?: string;
  hvacElementId?: string;
};

type HvacGroup = fabric.Group & {
  id?: string;
  name?: string;
  hvacElementId?: string;
};

function toCanvas(point: Point2D): Point2D {
  return { x: point.x * MM_TO_PX, y: point.y * MM_TO_PX };
}

export class HvacPlanRenderer {
  private canvas: fabric.Canvas;
  private groups = new Map<string, HvacGroup>();
  private selectedIds = new Set<string>();
  private hoveredId: string | null = null;

  constructor(canvas: fabric.Canvas) {
    this.canvas = canvas;
  }

  private annotate(target: fabric.FabricObject, hvacElementId: string, name?: string): void {
    const typed = target as NamedObject;
    typed.hvacElementId = hvacElementId;
    typed.id = hvacElementId;
    if (name) {
      typed.name = name;
    }
  }

  private removeElement(id: string): void {
    const group = this.groups.get(id);
    if (!group) return;
    this.canvas.remove(group);
    this.groups.delete(id);
  }

  renderElement(element: HvacElement): void {
    this.removeElement(element.id);

    const pos = toCanvas(element.position);
    const w = element.width * MM_TO_PX;
    const d = element.depth * MM_TO_PX;

    const objects: fabric.FabricObject[] = [];

    // Background fill (subtle blue tint for ceiling items)
    const bgRect = new fabric.Rect({
      left: pos.x,
      top: pos.y,
      width: w,
      height: d,
      fill: 'rgba(42,127,255,0.06)',
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: false,
    });
    this.annotate(bgRect, element.id, 'hvac-bg');
    objects.push(bgRect);

    // Dashed outline (ceiling convention)
    const outline = new fabric.Rect({
      left: pos.x,
      top: pos.y,
      width: w,
      height: d,
      fill: 'transparent',
      stroke: 'rgba(42,127,255,0.7)',
      strokeWidth: 1.5,
      strokeDashArray: [5, 3],
      selectable: false,
      evented: false,
    });
    this.annotate(outline, element.id, 'hvac-outline');
    objects.push(outline);

    // Supply/return divider line (vertical center)
    const dividerX = pos.x + w * element.supplyZoneRatio;
    const dividerLine = new fabric.Line(
      [dividerX, pos.y, dividerX, pos.y + d],
      {
        stroke: 'rgba(42,127,255,0.5)',
        strokeWidth: 1,
        selectable: false,
        evented: false,
      }
    );
    this.annotate(dividerLine, element.id, 'hvac-divider');
    objects.push(dividerLine);

    // Grille lines (vertical louver pattern)
    const grillCount = Math.max(2, Math.round(element.width / 400));
    for (let i = 1; i < grillCount; i++) {
      const gx = pos.x + w * (i / grillCount);
      if (Math.abs(gx - dividerX) < 2) continue; // skip if overlaps divider
      const grillLine = new fabric.Line(
        [gx, pos.y, gx, pos.y + d],
        {
          stroke: 'rgba(42,127,255,0.25)',
          strokeWidth: 0.8,
          selectable: false,
          evented: false,
        }
      );
      this.annotate(grillLine, element.id, 'hvac-grill');
      objects.push(grillLine);
    }

    // Supply / Return labels
    const fontSize = Math.max(7, Math.min(11, w * 0.06));
    const supplyLabel = new fabric.Text('S', {
      left: pos.x + (dividerX - pos.x) / 2,
      top: pos.y + d / 2,
      fontSize,
      fill: 'rgba(42,127,255,0.8)',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    this.annotate(supplyLabel, element.id, 'hvac-supply-label');
    objects.push(supplyLabel);

    const returnLabel = new fabric.Text('R', {
      left: dividerX + (pos.x + w - dividerX) / 2,
      top: pos.y + d / 2,
      fontSize,
      fill: 'rgba(42,127,255,0.8)',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    this.annotate(returnLabel, element.id, 'hvac-return-label');
    objects.push(returnLabel);

    // Element label above
    const nameLabel = new fabric.Text(element.label.toUpperCase(), {
      left: pos.x + w / 2,
      top: pos.y - 4,
      fontSize: Math.max(7, Math.min(9, w * 0.04)),
      fill: 'rgba(42,127,255,0.9)',
      fontFamily: 'monospace',
      fontWeight: '500',
      originX: 'center',
      originY: 'bottom',
      selectable: false,
      evented: false,
    });
    this.annotate(nameLabel, element.id, 'hvac-label');
    objects.push(nameLabel);

    // Selection halo
    const selectionHalo = new fabric.Rect({
      left: pos.x - 3,
      top: pos.y - 3,
      width: w + 6,
      height: d + 6,
      fill: 'transparent',
      stroke: '#1D4ED8',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      visible: this.selectedIds.has(element.id),
    });
    this.annotate(selectionHalo, element.id, 'hvac-selection');
    objects.push(selectionHalo);

    const group = new fabric.Group(objects, {
      selectable: true,
      evented: true,
      subTargetCheck: true,
      hasControls: false,
      hasBorders: false,
      lockRotation: true,
      objectCaching: false,
    }) as HvacGroup;
    group.id = element.id;
    group.hvacElementId = element.id;
    group.name = `hvac-${element.id}`;

    this.canvas.add(group);
    this.groups.set(element.id, group);
  }

  renderAll(elements: HvacElement[]): void {
    this.groups.forEach((group) => this.canvas.remove(group));
    this.groups.clear();
    elements.forEach((el) => this.renderElement(el));
    this.canvas.requestRenderAll();
  }

  setSelectedElements(ids: string[]): void {
    this.selectedIds = new Set(ids);
    this.groups.forEach((group, id) => {
      const halo = group
        .getObjects()
        .find((obj) => (obj as NamedObject).name === 'hvac-selection');
      if (halo) {
        halo.set('visible', this.selectedIds.has(id));
      }
    });
    this.canvas.requestRenderAll();
  }

  setHoveredElement(id: string | null): void {
    this.hoveredId = id;
  }

  dispose(): void {
    this.groups.forEach((group) => this.canvas.remove(group));
    this.groups.clear();
  }
}
