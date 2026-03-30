/**
 * HvacPlanRenderer
 *
 * Renders AC/HVAC equipment on the Fabric.js plan canvas.
 */

import * as fabric from 'fabric';

import type { AcEquipmentDefinition } from '../../../data';
import type { HvacElement, Point2D } from '../../../types';
import { MM_TO_PX } from '../scale';
import {
  getCanvasViewportBounds,
  hasMeaningfulViewportZoomChange,
  isViewportBoundsContained,
  type ViewportBounds,
} from '../viewportVisibility';

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

interface SyncHvacElementsOptions {
  force?: boolean;
}

interface VisualPalette {
  stroke: string;
  fill: string;
  detail: string;
  halo: string;
  hover: string;
}

function toCanvas(point: Point2D): Point2D {
  return { x: point.x * MM_TO_PX, y: point.y * MM_TO_PX };
}

function elementCenter(element: Pick<HvacElement, 'position' | 'width' | 'depth'>): Point2D {
  return {
    x: element.position.x + element.width / 2,
    y: element.position.y + element.depth / 2,
  };
}

function clampFontSize(widthPx: number): number {
  return Math.max(8, Math.min(11, widthPx * 0.08));
}

export class HvacPlanRenderer {
  private canvas: fabric.Canvas;
  private groups = new Map<string, HvacGroup>();
  private hvacData = new Map<string, HvacElement>();
  private selectedIds = new Set<string>();
  private hoveredId: string | null = null;
  private placementPreview: HvacGroup | null = null;
  private lastVisibilityBounds: ViewportBounds | null = null;
  private lastVisibilityZoom: number | null = null;

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

  private getPalette(element: Pick<HvacElement, 'type' | 'category'>, valid: boolean): VisualPalette {
    if (!valid) {
      return {
        stroke: '#B91C1C',
        fill: 'rgba(185,28,28,0.08)',
        detail: 'rgba(185,28,28,0.75)',
        halo: '#DC2626',
        hover: '#F97316',
      };
    }

    switch (element.type) {
      case 'outdoor-unit':
        return {
          stroke: '#0F766E',
          fill: 'rgba(15,118,110,0.10)',
          detail: 'rgba(15,118,110,0.85)',
          halo: '#0F766E',
          hover: '#14B8A6',
        };
      case 'remote-controller':
      case 'control-panel':
        return {
          stroke: '#B45309',
          fill: 'rgba(180,83,9,0.10)',
          detail: 'rgba(146,64,14,0.85)',
          halo: '#D97706',
          hover: '#F59E0B',
        };
      case 'filter':
      case 'accessory':
        return {
          stroke: '#475569',
          fill: 'rgba(71,85,105,0.08)',
          detail: 'rgba(71,85,105,0.78)',
          halo: '#475569',
          hover: '#0EA5E9',
        };
      default:
        return {
          stroke: '#1D4ED8',
          fill: 'rgba(37,99,235,0.08)',
          detail: 'rgba(37,99,235,0.80)',
          halo: '#1D4ED8',
          hover: '#059669',
        };
    }
  }

  private removeElement(id: string): void {
    const group = this.groups.get(id);
    if (group) {
      this.canvas.remove(group);
      this.groups.delete(id);
    }
    this.hvacData.delete(id);
    this.selectedIds.delete(id);
    if (this.hoveredId === id) {
      this.hoveredId = null;
    }
  }

  private hvacElementNeedsRerender(previousElement: HvacElement | undefined, nextElement: HvacElement): boolean {
    return previousElement !== nextElement;
  }

  private isObjectVisibleInViewport(object: fabric.FabricObject, bounds: ViewportBounds): boolean {
    const rect = object.getBoundingRect();
    return !(
      rect.left + rect.width < bounds.left ||
      rect.left > bounds.right ||
      rect.top + rect.height < bounds.top ||
      rect.top > bounds.bottom
    );
  }

  refreshViewportVisibility(force: boolean = false): void {
    const visibleBounds = getCanvasViewportBounds(this.canvas, 96);
    const actualBounds = getCanvasViewportBounds(this.canvas, 0);
    if (!visibleBounds || !actualBounds) {
      return;
    }
    const zoom = Math.max(this.canvas.getZoom(), 0.01);
    if (
      !force &&
      this.lastVisibilityBounds &&
      !hasMeaningfulViewportZoomChange(this.lastVisibilityZoom, zoom) &&
      isViewportBoundsContained(actualBounds, this.lastVisibilityBounds)
    ) {
      return;
    }

    this.lastVisibilityBounds = visibleBounds;
    this.lastVisibilityZoom = zoom;
    this.groups.forEach((group) => {
      const visible = this.isObjectVisibleInViewport(group, visibleBounds);
      if (group.visible !== visible) {
        group.set('visible', visible);
        group.set('dirty', true);
      }
    });
  }

  private syncHvacVisualState(): void {
    this.groups.forEach((group, id) => {
      const selectionHalo = group
        .getObjects()
        .find((obj) => (obj as NamedObject).name === 'hvac-selection');
      const hoverHalo = group
        .getObjects()
        .find((obj) => (obj as NamedObject).name === 'hvac-hover');
      if (selectionHalo) {
        selectionHalo.set('visible', this.selectedIds.has(id));
      }
      if (hoverHalo) {
        hoverHalo.set('visible', this.hoveredId === id && !this.selectedIds.has(id));
      }
      group.set('dirty', true);
    });
  }

  private createBaseObjects(
    element: Pick<HvacElement, 'id' | 'type' | 'label' | 'width' | 'depth' | 'category'>,
    options: { valid: boolean; includeInteractionHalos: boolean },
  ): fabric.FabricObject[] {
    const palette = this.getPalette(element, options.valid);
    const widthPx = Math.max(20, element.width * MM_TO_PX);
    const depthPx = Math.max(12, element.depth * MM_TO_PX);
    const halfW = widthPx / 2;
    const halfD = depthPx / 2;
    const objects: fabric.FabricObject[] = [];

    const background = new fabric.Rect({
      left: 0,
      top: 0,
      width: widthPx,
      height: depthPx,
      rx: Math.min(8, depthPx * 0.18),
      ry: Math.min(8, depthPx * 0.18),
      originX: 'center',
      originY: 'center',
      fill: palette.fill,
      stroke: palette.stroke,
      strokeWidth: 1.4,
      selectable: false,
      evented: false,
    });

    if (element.type === 'ceiling-cassette-ac' || element.type === 'filter') {
      background.set('strokeDashArray', [6, 4]);
    }

    this.annotate(background, element.id, 'hvac-body');
    objects.push(background);

    switch (element.type) {
      case 'ceiling-cassette-ac': {
        const horizontal = new fabric.Line(
          [-halfW * 0.82, 0, halfW * 0.82, 0],
          {
            stroke: palette.detail,
            strokeWidth: 1,
            selectable: false,
            evented: false,
          },
        );
        const vertical = new fabric.Line(
          [0, -halfD * 0.82, 0, halfD * 0.82],
          {
            stroke: palette.detail,
            strokeWidth: 1,
            selectable: false,
            evented: false,
          },
        );
        const centerDot = new fabric.Circle({
          left: 0,
          top: 0,
          radius: Math.max(2.5, Math.min(widthPx, depthPx) * 0.045),
          originX: 'center',
          originY: 'center',
          fill: palette.detail,
          selectable: false,
          evented: false,
        });
        this.annotate(horizontal, element.id, 'hvac-detail');
        this.annotate(vertical, element.id, 'hvac-detail');
        this.annotate(centerDot, element.id, 'hvac-detail');
        objects.push(horizontal, vertical, centerDot);
        break;
      }
      case 'wall-mounted-ac':
      case 'remote-controller':
      case 'control-panel': {
        const topLine = new fabric.Line(
          [-halfW * 0.78, -halfD * 0.18, halfW * 0.78, -halfD * 0.18],
          {
            stroke: palette.detail,
            strokeWidth: 1.1,
            selectable: false,
            evented: false,
          },
        );
        const bottomLine = new fabric.Line(
          [-halfW * 0.74, halfD * 0.18, halfW * 0.74, halfD * 0.18],
          {
            stroke: palette.detail,
            strokeWidth: 0.9,
            selectable: false,
            evented: false,
          },
        );
        this.annotate(topLine, element.id, 'hvac-detail');
        this.annotate(bottomLine, element.id, 'hvac-detail');
        objects.push(topLine, bottomLine);
        break;
      }
      case 'ceiling-suspended-ac':
      case 'ducted-ac': {
        const centerLine = new fabric.Line(
          [-halfW * 0.8, 0, halfW * 0.8, 0],
          {
            stroke: palette.detail,
            strokeWidth: 1.1,
            selectable: false,
            evented: false,
          },
        );
        this.annotate(centerLine, element.id, 'hvac-detail');
        objects.push(centerLine);
        for (let index = -1; index <= 1; index += 1) {
          const grille = new fabric.Line(
            [index * halfW * 0.45, -halfD * 0.55, index * halfW * 0.45, halfD * 0.55],
            {
              stroke: palette.detail,
              strokeWidth: 0.8,
              selectable: false,
              evented: false,
            },
          );
          this.annotate(grille, element.id, 'hvac-detail');
          objects.push(grille);
        }
        break;
      }
      case 'outdoor-unit': {
        const fanRing = new fabric.Circle({
          left: 0,
          top: 0,
          radius: Math.min(halfW, halfD) * 0.42,
          originX: 'center',
          originY: 'center',
          stroke: palette.detail,
          strokeWidth: 1.1,
          fill: 'transparent',
          selectable: false,
          evented: false,
        });
        const horizontal = new fabric.Line(
          [-halfW * 0.28, 0, halfW * 0.28, 0],
          {
            stroke: palette.detail,
            strokeWidth: 1,
            selectable: false,
            evented: false,
          },
        );
        const vertical = new fabric.Line(
          [0, -halfD * 0.28, 0, halfD * 0.28],
          {
            stroke: palette.detail,
            strokeWidth: 1,
            selectable: false,
            evented: false,
          },
        );
        this.annotate(fanRing, element.id, 'hvac-detail');
        this.annotate(horizontal, element.id, 'hvac-detail');
        this.annotate(vertical, element.id, 'hvac-detail');
        objects.push(fanRing, horizontal, vertical);
        break;
      }
      case 'filter':
      case 'accessory':
      default: {
        for (let index = -1; index <= 1; index += 1) {
          const grille = new fabric.Line(
            [-halfW * 0.7, index * halfD * 0.35, halfW * 0.7, index * halfD * 0.35],
            {
              stroke: palette.detail,
              strokeWidth: 0.8,
              selectable: false,
              evented: false,
            },
          );
          this.annotate(grille, element.id, 'hvac-detail');
          objects.push(grille);
        }
        break;
      }
    }

    const label = new fabric.Text(element.label.toUpperCase(), {
      left: 0,
      top: -halfD - 8,
      originX: 'center',
      originY: 'bottom',
      fontSize: clampFontSize(widthPx),
      fontFamily: 'monospace',
      fontWeight: '500',
      fill: palette.stroke,
      selectable: false,
      evented: false,
    });
    this.annotate(label, element.id, 'hvac-label');
    objects.push(label);

    if (options.includeInteractionHalos) {
      const selectionHalo = new fabric.Rect({
        left: 0,
        top: 0,
        width: widthPx + 8,
        height: depthPx + 8,
        originX: 'center',
        originY: 'center',
        fill: 'transparent',
        stroke: palette.halo,
        strokeWidth: 2,
        selectable: false,
        evented: false,
        visible: this.selectedIds.has(element.id),
      });
      const hoverHalo = new fabric.Rect({
        left: 0,
        top: 0,
        width: widthPx + 6,
        height: depthPx + 6,
        originX: 'center',
        originY: 'center',
        fill: 'transparent',
        stroke: palette.hover,
        strokeWidth: 1.5,
        selectable: false,
        evented: false,
        visible: this.hoveredId === element.id && !this.selectedIds.has(element.id),
      });
      this.annotate(selectionHalo, element.id, 'hvac-selection');
      this.annotate(hoverHalo, element.id, 'hvac-hover');
      objects.push(selectionHalo, hoverHalo);
    }

    return objects;
  }

  private buildGroup(
    element: Pick<HvacElement, 'id' | 'type' | 'label' | 'position' | 'rotation' | 'width' | 'depth' | 'category'>,
    options: { valid?: boolean; selectable?: boolean; evented?: boolean; includeInteractionHalos?: boolean },
  ): HvacGroup {
    const center = toCanvas(elementCenter(element));
    const objects = this.createBaseObjects(element, {
      valid: options.valid ?? true,
      includeInteractionHalos: options.includeInteractionHalos ?? true,
    });

    const group = new fabric.Group(objects, {
      left: center.x,
      top: center.y,
      angle: element.rotation ?? 0,
      originX: 'center',
      originY: 'center',
      selectable: options.selectable ?? true,
      evented: options.evented ?? true,
      subTargetCheck: true,
      hasControls: false,
      hasBorders: false,
      lockRotation: true,
      objectCaching: true,
    }) as HvacGroup;
    group.id = element.id;
    group.hvacElementId = element.id;
    group.name = `hvac-${element.id}`;
    return group;
  }

  renderElement(element: HvacElement): void {
    this.removeElement(element.id);
    this.hvacData.set(element.id, element);

    const group = this.buildGroup(element, {
      valid: true,
      selectable: true,
      evented: true,
      includeInteractionHalos: true,
    });

    this.canvas.add(group);
    this.groups.set(element.id, group);
  }

  renderPlacementPreview(
    definition: AcEquipmentDefinition,
    position: Point2D,
    rotationDeg: number,
    valid: boolean,
  ): void {
    this.clearPlacementPreview();

    const previewElement: HvacElement = {
      id: '__hvac-placement-preview__',
      type: definition.type,
      category: definition.equipmentCategory,
      subtype: definition.subtype,
      modelLabel: definition.modelLabel,
      position,
      rotation: rotationDeg,
      width: definition.widthMm,
      depth: definition.depthMm,
      height: definition.heightMm,
      elevation: definition.elevationMm,
      mountType: definition.mountType,
      label: definition.name,
      supplyZoneRatio: definition.supplyZoneRatio ?? 0.5,
      properties: {},
    };

    const group = this.buildGroup(previewElement, {
      valid,
      selectable: false,
      evented: false,
      includeInteractionHalos: false,
    });
    group.set({
      opacity: valid ? 0.86 : 0.92,
      excludeFromExport: true,
    });

    this.canvas.add(group);
    this.canvas.bringObjectToFront(group);
    this.placementPreview = group;
    this.canvas.requestRenderAll();
  }

  clearPlacementPreview(): void {
    if (!this.placementPreview) {
      return;
    }
    this.canvas.remove(this.placementPreview);
    this.placementPreview = null;
    this.canvas.requestRenderAll();
  }

  renderAll(elements: HvacElement[]): void {
    this.syncElements(elements, { force: true });
  }

  syncElements(elements: HvacElement[], options: SyncHvacElementsOptions = {}): void {
    const { force = false } = options;
    const nextElementIds = new Set(elements.map((element) => element.id));
    let changed = force;

    this.hvacData.forEach((_, id) => {
      if (!nextElementIds.has(id)) {
        this.removeElement(id);
        changed = true;
      }
    });

    elements.forEach((element) => {
      const previousElement = this.hvacData.get(element.id);
      const hasGroup = this.groups.has(element.id);
      if (!force && hasGroup && !this.hvacElementNeedsRerender(previousElement, element)) {
        return;
      }
      this.renderElement(element);
      changed = true;
    });

    if (!changed) {
      return;
    }

    this.refreshViewportVisibility(true);
    this.syncHvacVisualState();
    if (this.placementPreview) {
      this.canvas.bringObjectToFront(this.placementPreview);
    }
    this.canvas.requestRenderAll();
  }

  setSelectedElements(ids: string[]): void {
    this.selectedIds = new Set(ids);
    this.syncHvacVisualState();
    this.canvas.requestRenderAll();
  }

  setHoveredElement(id: string | null): void {
    this.hoveredId = id;
    this.syncHvacVisualState();
    this.canvas.requestRenderAll();
  }

  dispose(): void {
    this.clearPlacementPreview();
    this.groups.forEach((group) => this.canvas.remove(group));
    this.groups.clear();
    this.hvacData.clear();
  }
}
