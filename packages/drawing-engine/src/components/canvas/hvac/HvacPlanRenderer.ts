/**
 * HvacPlanRenderer
 *
 * Renders AC/HVAC equipment on the Fabric.js plan canvas.
 */

import * as fabric from 'fabric';

import type { AcEquipmentDefinition } from '../../../data';
import type { HvacElement, Point2D } from '../../../types';
import { buildCeilingCassetteModel } from './ceilingCassetteModel';
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
    element: Pick<HvacElement, 'id' | 'type' | 'label' | 'width' | 'depth' | 'height' | 'category' | 'properties'>,
    options: { valid: boolean; includeInteractionHalos: boolean },
  ): fabric.FabricObject[] {
    const palette = this.getPalette(element, options.valid);
    const baseWidthPx = Math.max(20, element.width * MM_TO_PX);
    const baseDepthPx = Math.max(12, element.depth * MM_TO_PX);
    const widthPx = baseWidthPx;
    const depthPx = baseDepthPx;
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

    if (element.type === 'filter') {
      background.set('strokeDashArray', [6, 4]);
    }

    this.annotate(background, element.id, 'hvac-body');
    objects.push(background);

    switch (element.type) {
      case 'ceiling-cassette-ac': {
        const cassette = buildCeilingCassetteModel(element);
        const toPx = (valueMm: number): number => valueMm * MM_TO_PX;
        const panelSizePx = toPx(cassette.panelSize);
        const minDimension = panelSizePx;
        const panelFill = options.valid ? 'rgba(255,255,255,0.97)' : 'rgba(254,242,242,0.92)';
        const innerPanelFill = options.valid ? 'rgba(248,250,252,0.96)' : 'rgba(255,255,255,0.80)';
        const panelOutlineStroke = options.valid ? 'rgba(15,23,42,0.96)' : 'rgba(185,28,28,0.72)';
        const innerPanelStroke = options.valid ? 'rgba(30,41,59,0.78)' : 'rgba(185,28,28,0.5)';
        const hiddenBodyStroke = options.valid ? 'rgba(138,148,157,0.78)' : 'rgba(127,29,29,0.58)';
        const slotFill = options.valid ? 'rgba(26,32,48,0.92)' : 'rgba(127,29,29,0.52)';
        const vaneFill = options.valid ? 'rgba(208,216,224,0.96)' : 'rgba(255,228,230,0.88)';
        const grilleFrameStroke = options.valid ? 'rgba(205,213,220,0.96)' : 'rgba(185,28,28,0.32)';
        const horizontalSlatStroke = options.valid ? 'rgba(138,151,164,0.92)' : 'rgba(185,28,28,0.48)';
        const verticalSlatStroke = options.valid ? 'rgba(150,163,175,0.92)' : 'rgba(185,28,28,0.42)';
        const accentFill = options.valid ? '#2f67c8' : '#b91c1c';
        const serviceFill = options.valid ? '#eef3f7' : 'rgba(255,244,244,0.92)';
        const serviceStroke = options.valid ? 'rgba(190,201,211,0.92)' : 'rgba(185,28,28,0.24)';

        background.set({
          width: panelSizePx,
          height: panelSizePx,
          fill: panelFill,
          stroke: panelOutlineStroke,
          strokeWidth: 2.1,
          rx: Math.max(8, minDimension * 0.085),
          ry: Math.max(8, minDimension * 0.085),
        });
        background.set('strokeDashArray', null);

        const concealedBody = new fabric.Rect({
          left: toPx(cassette.hiddenBody.x),
          top: toPx(cassette.hiddenBody.y),
          width: toPx(cassette.hiddenBody.width),
          height: toPx(cassette.hiddenBody.depth),
          rx: Math.max(6, toPx(cassette.hiddenBody.cornerRadius)),
          ry: Math.max(6, toPx(cassette.hiddenBody.cornerRadius)),
          originX: 'center',
          originY: 'center',
          fill: 'transparent',
          stroke: hiddenBodyStroke,
          strokeWidth: 1.05,
          strokeDashArray: [7, 5],
          selectable: false,
          evented: false,
        });
        this.annotate(concealedBody, element.id, 'hvac-detail');
        objects.push(concealedBody);

        const innerPanel = new fabric.Rect({
          left: toPx(cassette.innerPanel.x),
          top: toPx(cassette.innerPanel.y),
          width: toPx(cassette.innerPanel.width),
          height: toPx(cassette.innerPanel.depth),
          rx: Math.max(6, toPx(cassette.innerPanel.cornerRadius)),
          ry: Math.max(6, toPx(cassette.innerPanel.cornerRadius)),
          originX: 'center',
          originY: 'center',
          fill: innerPanelFill,
          stroke: innerPanelStroke,
          strokeWidth: 1.45,
          selectable: false,
          evented: false,
        });
        this.annotate(innerPanel, element.id, 'hvac-detail');
        objects.push(innerPanel);

        cassette.slots.forEach((slot) => {
          const slotOpening = new fabric.Rect({
            left: toPx(slot.x),
            top: toPx(slot.y),
            width: toPx(slot.width),
            height: toPx(slot.depth),
            rx: Math.max(2, toPx(slot.cornerRadius)),
            ry: Math.max(2, toPx(slot.cornerRadius)),
            originX: 'center',
            originY: 'center',
            fill: slotFill,
            selectable: false,
            evented: false,
          });
          this.annotate(slotOpening, element.id, 'hvac-detail');
          objects.push(slotOpening);
        });

        cassette.vanes.forEach((vane) => {
          const vaneRect = new fabric.Rect({
            left: toPx(vane.x),
            top: toPx(vane.y),
            width: toPx(vane.width),
            height: toPx(vane.depth),
            originX: 'center',
            originY: 'center',
            fill: vaneFill,
            selectable: false,
            evented: false,
          });
          this.annotate(vaneRect, element.id, 'hvac-detail');
          objects.push(vaneRect);
        });

        const grilleSize = toPx(cassette.grille.size);
        const grilleFrame = new fabric.Rect({
          left: toPx(cassette.grille.x),
          top: toPx(cassette.grille.y),
          width: grilleSize,
          height: grilleSize,
          rx: Math.max(3, toPx(cassette.grille.cornerRadius)),
          ry: Math.max(3, toPx(cassette.grille.cornerRadius)),
          originX: 'center',
          originY: 'center',
          fill: options.valid ? 'rgba(205,213,220,0.22)' : 'rgba(255,255,255,0.18)',
          stroke: grilleFrameStroke,
          strokeWidth: 0.9,
          selectable: false,
          evented: false,
        });
        this.annotate(grilleFrame, element.id, 'hvac-detail');
        objects.push(grilleFrame);

        const horizontalSlatHalfWidth = toPx(cassette.grille.slatSpan / 2);
        const verticalSlatHalfHeight = toPx(cassette.grille.slatSpan / 2);
        for (let i = 0; i < cassette.grille.slatCount; i += 1) {
          const y = toPx(-cassette.grille.slatInset + cassette.grille.slatStep * i);
          const horizontalSlat = new fabric.Line(
            [-horizontalSlatHalfWidth, y, horizontalSlatHalfWidth, y],
            {
              stroke: horizontalSlatStroke,
              strokeWidth: 0.75,
              selectable: false,
              evented: false,
            },
          );
          this.annotate(horizontalSlat, element.id, 'hvac-detail');
          objects.push(horizontalSlat);
        }
        for (let i = 0; i < cassette.grille.slatCount; i += 1) {
          const x = toPx(-cassette.grille.slatInset + cassette.grille.slatStep * i);
          const verticalSlat = new fabric.Line(
            [x, -verticalSlatHalfHeight, x, verticalSlatHalfHeight],
            {
              stroke: verticalSlatStroke,
              strokeWidth: 0.75,
              selectable: false,
              evented: false,
            },
          );
          this.annotate(verticalSlat, element.id, 'hvac-detail');
          objects.push(verticalSlat);
        }

        const accentBar = new fabric.Rect({
          left: toPx(cassette.accentBar.x),
          top: toPx(cassette.accentBar.y),
          width: toPx(cassette.accentBar.width),
          height: Math.max(toPx(cassette.accentBar.depth), 2),
          originX: 'center',
          originY: 'center',
          fill: accentFill,
          selectable: false,
          evented: false,
        });
        this.annotate(accentBar, element.id, 'hvac-detail');
        objects.push(accentBar);

        const serviceTab = new fabric.Rect({
          left: toPx(cassette.serviceTab.x),
          top: toPx(cassette.serviceTab.y),
          width: toPx(cassette.serviceTab.width),
          height: Math.max(toPx(cassette.serviceTab.depth), 2.5),
          originX: 'center',
          originY: 'center',
          fill: serviceFill,
          stroke: serviceStroke,
          strokeWidth: 0.6,
          selectable: false,
          evented: false,
        });
        this.annotate(serviceTab, element.id, 'hvac-detail');
        objects.push(serviceTab);

        cassette.pipePorts.forEach((port) => {
          const flange = new fabric.Rect({
            left: toPx(port.x + port.flangeThickness / 2),
            top: toPx(port.y),
            width: Math.max(toPx(port.flangeThickness), 2),
            height: Math.max(toPx(port.collarRadius * 2.24), 2.5),
            rx: Math.max(toPx(port.collarRadius * 1.12), 1.5),
            ry: Math.max(toPx(port.collarRadius * 1.12), 1.5),
            originX: 'center',
            originY: 'center',
            fill: port.flangeColor ?? '#d7dde2',
            selectable: false,
            evented: false,
          });
          this.annotate(flange, element.id, 'hvac-detail');
          objects.push(flange);

          const collar = new fabric.Rect({
            left: toPx(port.x + port.collarLength / 2 + port.flangeThickness * 0.35),
            top: toPx(port.y),
            width: Math.max(toPx(port.collarLength), 2.5),
            height: Math.max(toPx(port.collarRadius * 2), 2.5),
            rx: Math.max(toPx(port.collarRadius), 1.5),
            ry: Math.max(toPx(port.collarRadius), 1.5),
            originX: 'center',
            originY: 'center',
            fill: port.collarColor ?? '#1f2937',
            selectable: false,
            evented: false,
          });
          this.annotate(collar, element.id, 'hvac-detail');
          objects.push(collar);

          const pipeRun = new fabric.Rect({
            left: toPx(port.x + port.collarLength + port.length / 2 - port.flangeThickness * 0.15),
            top: toPx(port.y),
            width: Math.max(toPx(port.length), 3),
            height: Math.max(toPx(port.radius * 2), 2),
            rx: Math.max(toPx(port.radius), 1.5),
            ry: Math.max(toPx(port.radius), 1.5),
            originX: 'center',
            originY: 'center',
            fill: port.color,
            selectable: false,
            evented: false,
          });
          this.annotate(pipeRun, element.id, 'hvac-detail');
          objects.push(pipeRun);

          const bandMarker = new fabric.Line(
            [
              toPx(port.x + port.bandOffsetX),
              toPx(port.y - port.bandRadius),
              toPx(port.x + port.bandOffsetX),
              toPx(port.y + port.bandRadius),
            ],
            {
              stroke: port.bandColor,
              strokeWidth: Math.max(toPx(port.bandRadius * 0.18), 1.2),
              selectable: false,
              evented: false,
            },
          );
          this.annotate(bandMarker, element.id, 'hvac-detail');
          objects.push(bandMarker);
        });
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
    element: Pick<HvacElement, 'id' | 'type' | 'label' | 'position' | 'rotation' | 'width' | 'depth' | 'height' | 'category' | 'properties'>,
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
      objectCaching: false,
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
