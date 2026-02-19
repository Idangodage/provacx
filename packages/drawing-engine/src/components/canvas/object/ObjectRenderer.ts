/**
 * ObjectRenderer
 *
 * Renders architectural library objects placed on plan.
 */

import * as fabric from 'fabric';

import type { ArchitecturalObjectDefinition } from '../../../data';
import type { SymbolInstance2D } from '../../../types';
import { MM_TO_PX } from '../scale';

type NamedObject = fabric.Object & {
  id?: string;
  name?: string;
  objectId?: string;
};

type ObjectGroup = fabric.Group & {
  id?: string;
  objectId?: string;
  name?: string;
};

function definitionFallback(definitionId: string): ArchitecturalObjectDefinition {
  return {
    id: definitionId,
    name: 'Object',
    category: 'my-library',
    type: 'custom',
    widthMm: 900,
    depthMm: 600,
    heightMm: 900,
    tags: ['custom'],
    view: 'plan-2d',
  };
}

function toPx(mm: number, scale: number): number {
  return mm * MM_TO_PX * scale;
}

function doorGraphics(
  definition: ArchitecturalObjectDefinition,
  swingDirectionRaw: unknown,
  widthPx: number,
  stroke: string
): fabric.FabricObject[] {
  const objects: fabric.FabricObject[] = [];
  const line = new fabric.Line([-widthPx / 2, 0, widthPx / 2, 0], {
    stroke,
    strokeWidth: 2,
    selectable: false,
    evented: false,
  });
  objects.push(line);

  const swingDirection = swingDirectionRaw === 'right' ? 'right' : 'left';
  const swingAngleDeg = Math.max(30, Math.min(180, definition.swingAngleDeg ?? 90));
  const swingAngle = (swingAngleDeg * Math.PI) / 180;
  const pivotX = swingDirection === 'right' ? widthPx / 2 : -widthPx / 2;
  const radius = widthPx;
  const endPoint = swingDirection === 'right'
    ? {
      x: pivotX - Math.cos(swingAngle) * radius,
      y: Math.sin(swingAngle) * radius,
    }
    : {
      x: pivotX + Math.cos(swingAngle) * radius,
      y: Math.sin(swingAngle) * radius,
    };

  const leaf = new fabric.Line([pivotX, 0, endPoint.x, endPoint.y], {
    stroke,
    strokeWidth: 1.8,
    selectable: false,
    evented: false,
  });
  objects.push(leaf);

  const arcPoints: Array<{ x: number; y: number }> = [];
  const sampleCount = 18;
  for (let i = 0; i <= sampleCount; i += 1) {
    const t = i / sampleCount;
    const angle = t * swingAngle;
    arcPoints.push(
      swingDirection === 'right'
        ? {
          x: pivotX - Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        }
        : {
          x: pivotX + Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        }
    );
  }
  const arc = new fabric.Polyline(arcPoints, {
    fill: 'transparent',
    stroke,
    strokeDashArray: [4, 3],
    strokeWidth: 1.2,
    selectable: false,
    evented: false,
  });
  objects.push(arc);
  return objects;
}

function windowGraphics(widthPx: number, stroke: string): fabric.FabricObject[] {
  return [
    new fabric.Line([-widthPx / 2, -6, widthPx / 2, -6], {
      stroke,
      strokeWidth: 1.8,
      selectable: false,
      evented: false,
    }),
    new fabric.Line([-widthPx / 2, 6, widthPx / 2, 6], {
      stroke,
      strokeWidth: 1.8,
      selectable: false,
      evented: false,
    }),
    new fabric.Line([0, -6, 0, 6], {
      stroke,
      strokeWidth: 1,
      selectable: false,
      evented: false,
    }),
  ];
}

function genericGraphics(
  definition: ArchitecturalObjectDefinition,
  widthPx: number,
  depthPx: number,
  stroke: string
): fabric.FabricObject[] {
  const rect = new fabric.Rect({
    left: 0,
    top: 0,
    width: Math.max(6, widthPx),
    height: Math.max(6, depthPx),
    fill: 'rgba(226,232,240,0.45)',
    stroke,
    strokeWidth: 1.4,
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
  });
  const label = new fabric.Text(definition.name, {
    left: 0,
    top: 0,
    fontSize: 10,
    fill: '#334155',
    fontFamily: 'Arial',
    fontWeight: '600',
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
  });
  return [rect, label];
}

function graphicsForDefinition(
  definition: ArchitecturalObjectDefinition,
  instance: SymbolInstance2D,
  widthPx: number,
  depthPx: number,
  stroke: string
): fabric.FabricObject[] {
  if (definition.category === 'doors') {
    const swingDirection = instance.properties?.swingDirection;
    return doorGraphics(definition, swingDirection, widthPx, stroke);
  }
  if (definition.category === 'windows') {
    return windowGraphics(widthPx, stroke);
  }
  if (definition.symbolPath) {
    const path = new fabric.Path(definition.symbolPath, {
      fill: 'rgba(226,232,240,0.28)',
      stroke,
      strokeWidth: 1.4,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });
    const bounds = path.getBoundingRect();
    const scaleX = bounds.width > 0 ? widthPx / bounds.width : 1;
    const scaleY = bounds.height > 0 ? depthPx / bounds.height : 1;
    path.set({
      scaleX,
      scaleY,
      left: 0,
      top: 0,
    });
    return [path];
  }
  return genericGraphics(definition, widthPx, depthPx, stroke);
}

export class ObjectRenderer {
  private canvas: fabric.Canvas;
  private groups = new Map<string, ObjectGroup>();
  private definitions = new Map<string, ArchitecturalObjectDefinition>();
  private selectedObjectIds = new Set<string>();
  private hoveredObjectId: string | null = null;
  private previewGroup: ObjectGroup | null = null;
  private instancesCache: SymbolInstance2D[] = [];

  constructor(canvas: fabric.Canvas) {
    this.canvas = canvas;
  }

  setDefinitions(definitions: ArchitecturalObjectDefinition[]): void {
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
    if (this.instancesCache.length > 0) {
      this.renderAll(this.instancesCache);
    }
  }

  private annotate(object: fabric.FabricObject, objectId: string, name?: string): void {
    const typed = object as NamedObject;
    typed.id = objectId;
    typed.objectId = objectId;
    if (name) {
      typed.name = name;
    }
  }

  private clearAllObjects(): void {
    this.groups.forEach((group) => this.canvas.remove(group));
    this.groups.clear();
  }

  private buildGroup(
    instance: SymbolInstance2D,
    definition: ArchitecturalObjectDefinition,
    options?: { preview?: boolean; valid?: boolean }
  ): ObjectGroup {
    const scale = Number.isFinite(instance.scale) && instance.scale > 0 ? instance.scale : 1;
    const widthPx = toPx(definition.widthMm, scale);
    const depthPx = toPx(definition.depthMm, scale);
    const stroke = options?.preview
      ? options.valid === false
        ? '#dc2626'
        : '#16a34a'
      : '#111827';

    const body = graphicsForDefinition(definition, instance, widthPx, depthPx, stroke);

    const selectionOutline = new fabric.Rect({
      left: 0,
      top: 0,
      width: Math.max(6, widthPx + 12),
      height: Math.max(6, depthPx + 12),
      fill: 'transparent',
      stroke: '#2563EB',
      strokeWidth: 2.5,
      originX: 'center',
      originY: 'center',
      visible: !options?.preview && this.selectedObjectIds.has(instance.id),
      selectable: false,
      evented: false,
    });
    this.annotate(selectionOutline, instance.id, 'object-selection');

    const hoverOutline = new fabric.Rect({
      left: 0,
      top: 0,
      width: Math.max(6, widthPx + 10),
      height: Math.max(6, depthPx + 10),
      fill: 'transparent',
      stroke: '#22c55e',
      strokeWidth: 1.8,
      originX: 'center',
      originY: 'center',
      visible: !options?.preview && this.hoveredObjectId === instance.id && !this.selectedObjectIds.has(instance.id),
      selectable: false,
      evented: false,
    });
    this.annotate(hoverOutline, instance.id, 'object-hover');

    body.forEach((item, index) => this.annotate(item, instance.id, `object-body-${index}`));
    const group = new fabric.Group([...body, hoverOutline, selectionOutline], {
      left: instance.position.x * MM_TO_PX,
      top: instance.position.y * MM_TO_PX,
      angle: instance.rotation,
      opacity: options?.preview ? 0.65 : 1,
      originX: 'center',
      originY: 'center',
      hasControls: !options?.preview,
      hasBorders: !options?.preview,
      lockScalingX: true,
      lockScalingY: true,
      transparentCorners: false,
      objectCaching: false,
      selectable: !options?.preview,
      evented: !options?.preview,
      subTargetCheck: false,
    }) as ObjectGroup;
    group.id = instance.id;
    group.objectId = instance.id;
    group.name = `object-${instance.id}`;
    return group;
  }

  renderAll(instances: SymbolInstance2D[]): void {
    this.instancesCache = instances.map((instance) => ({
      ...instance,
      position: { ...instance.position },
      properties: { ...instance.properties },
    }));
    this.clearAllObjects();
    instances.forEach((instance) => {
      const definition = this.definitions.get(instance.symbolId) ?? definitionFallback(instance.symbolId);
      const group = this.buildGroup(instance, definition);
      this.canvas.add(group);
      this.groups.set(instance.id, group);
    });
    this.canvas.requestRenderAll();
  }

  setSelectedObjects(ids: string[]): void {
    this.selectedObjectIds = new Set(ids);
    this.groups.forEach((group, objectId) => {
      const selection = group.getObjects().find((item) => (item as NamedObject).name === 'object-selection');
      const hover = group.getObjects().find((item) => (item as NamedObject).name === 'object-hover');
      if (selection) selection.set('visible', this.selectedObjectIds.has(objectId));
      if (hover) hover.set('visible', this.hoveredObjectId === objectId && !this.selectedObjectIds.has(objectId));
    });
    this.canvas.requestRenderAll();
  }

  setHoveredObject(id: string | null): void {
    this.hoveredObjectId = id;
    this.groups.forEach((group, objectId) => {
      const hover = group.getObjects().find((item) => (item as NamedObject).name === 'object-hover');
      if (!hover) return;
      hover.set('visible', this.hoveredObjectId === objectId && !this.selectedObjectIds.has(objectId));
    });
    this.canvas.requestRenderAll();
  }

  renderPlacementPreview(
    definition: ArchitecturalObjectDefinition,
    position: { x: number; y: number },
    rotationDeg: number,
    valid: boolean
  ): void {
    this.clearPlacementPreview();
    const previewInstance: SymbolInstance2D = {
      id: '__object-preview__',
      symbolId: definition.id,
      position,
      rotation: rotationDeg,
      scale: 1,
      flipped: false,
      properties: {},
    };
    this.previewGroup = this.buildGroup(previewInstance, definition, { preview: true, valid });
    this.canvas.add(this.previewGroup);
    this.canvas.requestRenderAll();
  }

  clearPlacementPreview(): void {
    if (!this.previewGroup) return;
    this.canvas.remove(this.previewGroup);
    this.previewGroup = null;
    this.canvas.requestRenderAll();
  }

  dispose(): void {
    this.clearPlacementPreview();
    this.clearAllObjects();
    this.definitions.clear();
    this.selectedObjectIds.clear();
    this.hoveredObjectId = null;
    this.instancesCache = [];
  }
}
