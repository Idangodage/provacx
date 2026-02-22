/**
 * WallRenderer
 *
 * Fabric.js rendering for walls with material fills and joins.
 */

import * as fabric from 'fabric';

import { colorFromExposure, getArchitecturalMaterial, heatColorFromUValue } from '../../../attributes';
import type { Point2D, Wall, WallColorMode, WallMaterial, JoinData } from '../../../types';
import { WALL_MATERIAL_COLORS } from '../../../types/wall';
import {
  computeCornerBevelDotsForEndpoint,
  computeDeadEndBevelDotsForEndpoint,
  countWallsTouchingEndpoint,
} from '../../../utils/wallBevel';
import { MM_TO_PX } from '../scale';

import {
  computeWallPolygon,
  computeMiterJoin,
  angleBetweenWalls,
  determineJoinType,
  lineIntersection,
} from './WallGeometry';

// =============================================================================
// Types
// =============================================================================

export interface WallRenderOptions {
  showCenterLines: boolean;
  pageHeight: number;
}

type NamedObject = fabric.Object & { name?: string; wallId?: string; id?: string };
type WallGroup = fabric.Group & { wallId?: string; id?: string; name?: string };
type WallControlType =
  | 'wall-center-handle'
  | 'wall-endpoint-start'
  | 'wall-endpoint-end'
  | 'wall-bevel-outer-start'
  | 'wall-bevel-outer-end'
  | 'wall-bevel-inner-start'
  | 'wall-bevel-inner-end'
  | 'wall-thickness-interior'
  | 'wall-thickness-exterior'
  | 'wall-rotation-handle';
type WallControlObject = NamedObject & {
  isWallControl?: boolean;
  controlType?: WallControlType;
  isControlHitTarget?: boolean;
};

interface WallJoinMatch {
  point: Point2D;
  endpoint: 'start' | 'end';
  matchType: 'endpoint' | 'segment';
}

// =============================================================================
// WallRenderer Class
// =============================================================================

export class WallRenderer {
  private canvas: fabric.Canvas;
  private wallObjects: Map<string, WallGroup> = new Map();
  private wallData: Map<string, Wall> = new Map();
  private showCenterLines: boolean = true;
  private pageHeight: number;
  private hatchPatterns: Map<WallMaterial, fabric.Pattern | null> = new Map();
  private selectedWallIds: Set<string> = new Set();
  private controlPointObjects: Map<string, fabric.FabricObject[]> = new Map();
  private showHeightTags: boolean = false;
  private wallColorMode: WallColorMode = 'material';
  private showLayerCountIndicators: boolean = false;
  private hoveredWallId: string | null = null;

  constructor(canvas: fabric.Canvas, pageHeight: number = 3000) {
    this.canvas = canvas;
    this.pageHeight = pageHeight;
    this.initializePatterns();
  }

  /**
   * Initialize hatch patterns for materials.
   */
  private initializePatterns(): void {
    const hatchPattern = this.createHatchPattern('#A3A3A3');
    this.hatchPatterns.set('brick', hatchPattern);
    this.hatchPatterns.set('concrete', null);
    this.hatchPatterns.set('partition', null);
  }

  /**
   * Create 45-degree hatch pattern.
   */
  private createHatchPattern(strokeColor: string): fabric.Pattern | null {
    const patternSize = 10;
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = patternSize;
    patternCanvas.height = patternSize;
    const ctx = patternCanvas.getContext('2d');

    if (!ctx) return null;

    ctx.fillStyle = '#E3E3E3';
    ctx.fillRect(0, 0, patternSize, patternSize);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, patternSize);
    ctx.lineTo(patternSize, 0);
    ctx.stroke();

    return new fabric.Pattern({
      source: patternCanvas,
      repeat: 'repeat',
    });
  }

  /**
   * Convert Y coordinate to canvas coordinates (top-left origin).
   */
  private toCanvasY(y: number): number {
    return y * MM_TO_PX;
  }

  /**
   * Convert point to canvas coordinates.
   */
  private toCanvasPoint(point: Point2D): { x: number; y: number } {
    return {
      x: point.x * MM_TO_PX,
      y: this.toCanvasY(point.y),
    };
  }

  private toSceneSize(screenPx: number): number {
    const zoom = Math.max(this.canvas.getZoom(), 0.01);
    return screenPx / zoom;
  }

  private toSceneTolerance(screenPx: number, minMm = 1, maxMm = 120): number {
    const zoom = Math.max(this.canvas.getZoom(), 0.01);
    const sceneMm = screenPx / (MM_TO_PX * zoom);
    return Math.min(maxMm, Math.max(minMm, sceneMm));
  }

  private annotateWallTarget(object: fabric.Object, wallId: string): void {
    const typed = object as NamedObject;
    typed.wallId = wallId;
    typed.id = wallId;
  }

  /**
   * Set page height for compatibility with existing hook contracts.
   */
  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

  /**
   * Set whether to show center lines.
   */
  setShowCenterLines(show: boolean): void {
    this.showCenterLines = show;
    this.wallObjects.forEach((group) => {
      const centerLine = group.getObjects().find((obj) =>
        (obj as NamedObject).name === 'centerLine'
      );
      if (centerLine) {
        centerLine.set('visible', show);
      }
    });
    this.canvas.requestRenderAll();
  }

  setShowHeightTags(show: boolean): void {
    this.showHeightTags = show;
    this.renderAllWalls(Array.from(this.wallData.values()));
  }

  setColorCodeByMaterial(show: boolean): void {
    this.wallColorMode = show ? 'material' : 'u-value';
    this.renderAllWalls(Array.from(this.wallData.values()));
  }

  setWallColorMode(mode: WallColorMode): void {
    this.wallColorMode = mode;
    this.renderAllWalls(Array.from(this.wallData.values()));
  }

  setShowLayerCountIndicators(show: boolean): void {
    this.showLayerCountIndicators = show;
    this.renderAllWalls(Array.from(this.wallData.values()));
  }

  /**
   * Render a wall as a Fabric.js group.
   */
  renderWall(wall: Wall, joins?: JoinData[]): WallGroup {
    this.removeWall(wall.id);
    this.wallData.set(wall.id, wall);

    const vertices = computeWallPolygon(wall, joins);
    const canvasVertices = vertices.map((v) => this.toCanvasPoint(v));
    const materialColors = WALL_MATERIAL_COLORS[wall.material];
    const libraryMaterial = getArchitecturalMaterial(wall.properties3D.materialId);
    const defaultMaterialFill = libraryMaterial?.color ?? materialColors.fill;
    const exposureDirection = wall.properties3D.exposureOverride ?? wall.properties3D.exposureDirection;
    const fillColor = this.wallColorMode === 'u-value'
      ? heatColorFromUValue(wall.properties3D.overallUValue)
      : this.wallColorMode === 'exposure'
        ? colorFromExposure(exposureDirection)
        : defaultMaterialFill;

    const fillPolygon = new fabric.Polygon(canvasVertices, {
      fill: fillColor,
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: false,
    });
    (fillPolygon as NamedObject).name = 'wallFill';

    if (this.wallColorMode === 'material' && materialColors.pattern === 'hatch') {
      const pattern = this.hatchPatterns.get(wall.material);
      if (pattern) {
        fillPolygon.set('fill', pattern);
      }
    }
    this.annotateWallTarget(fillPolygon, wall.id);

    const interiorStart = canvasVertices[0];
    const interiorEnd = canvasVertices[1];
    const exteriorEnd = canvasVertices[2];
    const exteriorStart = canvasVertices[3];
    const joinEndpointTolerance = this.toSceneTolerance(10, 2, 180);
    const hasStartJoin = (joins ?? []).some(
      (join) => this.pointDistance(join.joinPoint, wall.startPoint) <= joinEndpointTolerance
    );
    const hasEndJoin = (joins ?? []).some(
      (join) => this.pointDistance(join.joinPoint, wall.endPoint) <= joinEndpointTolerance
    );

    const interiorBoundary = new fabric.Line(
      [interiorStart.x, interiorStart.y, interiorEnd.x, interiorEnd.y],
      {
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      }
    );
    (interiorBoundary as NamedObject).name = 'interiorBoundary';
    this.annotateWallTarget(interiorBoundary, wall.id);

    const exteriorBoundary = new fabric.Line(
      [exteriorStart.x, exteriorStart.y, exteriorEnd.x, exteriorEnd.y],
      {
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      }
    );
    (exteriorBoundary as NamedObject).name = 'exteriorBoundary';
    this.annotateWallTarget(exteriorBoundary, wall.id);

    const startCap = new fabric.Line(
      [interiorStart.x, interiorStart.y, exteriorStart.x, exteriorStart.y],
      {
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
        visible: !hasStartJoin,
      }
    );
    (startCap as NamedObject).name = 'startCap';
    this.annotateWallTarget(startCap, wall.id);

    const endCap = new fabric.Line(
      [interiorEnd.x, interiorEnd.y, exteriorEnd.x, exteriorEnd.y],
      {
        stroke: '#000000',
        strokeWidth: 2,
        selectable: false,
        evented: false,
        visible: !hasEndJoin,
      }
    );
    (endCap as NamedObject).name = 'endCap';
    this.annotateWallTarget(endCap, wall.id);

    const centerLine = new fabric.Line(
      [
        wall.startPoint.x * MM_TO_PX,
        this.toCanvasY(wall.startPoint.y),
        wall.endPoint.x * MM_TO_PX,
        this.toCanvasY(wall.endPoint.y),
      ],
      {
        stroke: '#000000',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        visible: this.showCenterLines,
      }
    );
    (centerLine as NamedObject).name = 'centerLine';
    this.annotateWallTarget(centerLine, wall.id);

    const selectionOutline = new fabric.Polygon(canvasVertices, {
      fill: 'rgba(37,99,235,0.14)',
      stroke: '#1D4ED8',
      strokeWidth: this.toSceneSize(4),
      selectable: false,
      evented: false,
      visible: false,
    });
    (selectionOutline as NamedObject).name = 'selectionOutline';
    this.annotateWallTarget(selectionOutline, wall.id);

    const hoverOutline = new fabric.Polygon(canvasVertices, {
      fill: 'rgba(16,185,129,0.1)',
      stroke: '#059669',
      strokeWidth: this.toSceneSize(3),
      selectable: false,
      evented: false,
      visible: this.hoveredWallId === wall.id && !this.selectedWallIds.has(wall.id),
    });
    (hoverOutline as NamedObject).name = 'hoverOutline';
    this.annotateWallTarget(hoverOutline, wall.id);

    const midpoint = {
      x: (wall.startPoint.x + wall.endPoint.x) / 2,
      y: (wall.startPoint.y + wall.endPoint.y) / 2,
    };

    const indicators: fabric.FabricObject[] = [];
    if (this.showHeightTags) {
      const heightText = new fabric.Text(`H ${(wall.properties3D.height / 1000).toFixed(2)}m`, {
        left: midpoint.x * MM_TO_PX + 6,
        top: this.toCanvasY(midpoint.y) - 16,
        fill: '#1F2937',
        fontSize: 11,
        fontFamily: 'Arial',
        selectable: false,
        evented: false,
      });
      (heightText as NamedObject).name = 'heightTag';
      this.annotateWallTarget(heightText, wall.id);
      indicators.push(heightText);
    }

    if (this.showLayerCountIndicators) {
      const layerCircle = new fabric.Circle({
        left: midpoint.x * MM_TO_PX - 5,
        top: this.toCanvasY(midpoint.y) + 7,
        radius: 8,
        fill: '#FFFFFF',
        stroke: '#111827',
        strokeWidth: 1.5,
        selectable: false,
        evented: false,
        originX: 'center',
        originY: 'center',
      });
      (layerCircle as NamedObject).name = 'layerCountCircle';
      this.annotateWallTarget(layerCircle, wall.id);

      const layerText = new fabric.Text(`${Math.max(1, wall.properties3D.layerCount)}`, {
        left: midpoint.x * MM_TO_PX - 5,
        top: this.toCanvasY(midpoint.y) + 7,
        fill: '#111827',
        fontSize: 10,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        selectable: false,
        evented: false,
        originX: 'center',
        originY: 'center',
      });
      (layerText as NamedObject).name = 'layerCountText';
      this.annotateWallTarget(layerText, wall.id);

      indicators.push(layerCircle, layerText);
    }

    const objects: fabric.FabricObject[] = [
      fillPolygon,
      interiorBoundary,
      exteriorBoundary,
      startCap,
      endCap,
      centerLine,
      selectionOutline,
      hoverOutline,
      ...indicators,
    ];

    const group: WallGroup = new fabric.Group(objects, {
      selectable: true,
      evented: true,
      subTargetCheck: false,
      hasControls: false,
      hasBorders: false,
      lockMovementX: true,
      lockMovementY: true,
      transparentCorners: false,
      objectCaching: false,
    }) as WallGroup;

    group.wallId = wall.id;
    group.id = wall.id;
    group.name = `wall-${wall.id}`;

    this.canvas.add(group);
    this.wallObjects.set(wall.id, group);

    return group;
  }

  /**
   * Update an existing wall's rendering.
   */
  updateWall(wall: Wall, joins?: JoinData[]): void {
    this.renderWall(wall, joins);
    this.setSelectedWalls([...this.selectedWallIds]);
  }

  /**
   * Remove wall selection control points.
   */
  private removeControlPoints(wallId: string): void {
    const controls = this.controlPointObjects.get(wallId);
    if (!controls) return;

    controls.forEach((control) => this.canvas.remove(control));
    this.controlPointObjects.delete(wallId);
  }

  private annotateControlTarget(
    control: fabric.FabricObject,
    wallId: string,
    controlType: WallControlType
  ): void {
    const typed = control as WallControlObject;
    typed.name = controlType;
    typed.id = wallId;
    typed.wallId = wallId;
    typed.controlType = controlType;
    typed.isWallControl = true;
    typed.selectable = true;
    typed.evented = true;
    typed.hasControls = false;
    typed.hasBorders = false;
  }

  private createControlHitTarget(
    point: Point2D,
    wallId: string,
    controlType: WallControlType,
    cursor: string,
    hitRadiusPx: number
  ): fabric.Circle {
    const hitTarget = new fabric.Circle({
      left: point.x * MM_TO_PX,
      top: this.toCanvasY(point.y),
      radius: this.toSceneSize(hitRadiusPx),
      fill: 'rgba(0,0,0,0.001)',
      strokeWidth: 0,
      originX: 'center',
      originY: 'center',
      hoverCursor: cursor,
      lockMovementX: true,
      lockMovementY: true,
    });
    const typed = hitTarget as WallControlObject;
    this.annotateControlTarget(hitTarget, wallId, controlType);
    typed.isControlHitTarget = true;
    return hitTarget;
  }

  /**
   * Create endpoint, thickness, and midpoint controls for selected walls.
   */
  private createControlPoints(wallId: string): void {
    const wall = this.wallData.get(wallId);
    if (!wall) return;

    this.removeControlPoints(wallId);
    const endpointSize = this.toSceneSize(16);
    const endpointStroke = this.toSceneSize(2.8);
    const bevelRadius = this.toSceneSize(5.5);
    const bevelStroke = this.toSceneSize(1.5);
    const thicknessRadius = this.toSceneSize(8);
    const centerRadius = this.toSceneSize(11);
    const rotationRadius = this.toSceneSize(11);
    const crossHalf = this.toSceneSize(5);
    const crossStroke = this.toSceneSize(1.8);
    const stemStroke = this.toSceneSize(1.8);
    const endpointHitRadiusPx = 16;
    const bevelHitRadiusPx = 14;
    const thicknessHitRadiusPx = 16;
    const centerHitRadiusPx = 16;
    const rotationHitRadiusPx = 16;

    const midpoint = {
      x: (wall.startPoint.x + wall.endPoint.x) / 2,
      y: (wall.startPoint.y + wall.endPoint.y) / 2,
    };
    const direction = {
      x: wall.endPoint.x - wall.startPoint.x,
      y: wall.endPoint.y - wall.startPoint.y,
    };
    const directionLength = Math.hypot(direction.x, direction.y) || 1;
    const unitDirection = {
      x: direction.x / directionLength,
      y: direction.y / directionLength,
    };
    const rotationHandleDistanceMm = 300;
    const rotationPoint = {
      x: midpoint.x - unitDirection.y * rotationHandleDistanceMm,
      y: midpoint.y + unitDirection.x * rotationHandleDistanceMm,
    };
    const interiorMid = {
      x: (wall.interiorLine.start.x + wall.interiorLine.end.x) / 2,
      y: (wall.interiorLine.start.y + wall.interiorLine.end.y) / 2,
    };
    const exteriorMid = {
      x: (wall.exteriorLine.start.x + wall.exteriorLine.end.x) / 2,
      y: (wall.exteriorLine.start.y + wall.exteriorLine.end.y) / 2,
    };

    const startHandle = new fabric.Rect({
      left: wall.startPoint.x * MM_TO_PX,
      top: this.toCanvasY(wall.startPoint.y),
      width: endpointSize,
      height: endpointSize,
      fill: '#FFFFFF',
      stroke: '#1D4ED8',
      strokeWidth: endpointStroke,
      originX: 'center',
      originY: 'center',
      hoverCursor: 'crosshair',
      lockMovementX: true,
      lockMovementY: true,
    });
    this.annotateControlTarget(startHandle, wallId, 'wall-endpoint-start');
    startHandle.set({
      selectable: false,
      evented: false,
    });
    const startHandleHit = this.createControlHitTarget(
      wall.startPoint,
      wallId,
      'wall-endpoint-start',
      'crosshair',
      endpointHitRadiusPx
    );

    const endHandle = new fabric.Rect({
      left: wall.endPoint.x * MM_TO_PX,
      top: this.toCanvasY(wall.endPoint.y),
      width: endpointSize,
      height: endpointSize,
      fill: '#FFFFFF',
      stroke: '#1D4ED8',
      strokeWidth: endpointStroke,
      originX: 'center',
      originY: 'center',
      hoverCursor: 'crosshair',
      lockMovementX: true,
      lockMovementY: true,
    });
    this.annotateControlTarget(endHandle, wallId, 'wall-endpoint-end');
    endHandle.set({
      selectable: false,
      evented: false,
    });
    const endHandleHit = this.createControlHitTarget(
      wall.endPoint,
      wallId,
      'wall-endpoint-end',
      'crosshair',
      endpointHitRadiusPx
    );

    const allWalls = Array.from(this.wallData.values());
    const cornerTolerance = this.toSceneTolerance(10, 2, 180);
    const startCornerConnectionCount = countWallsTouchingEndpoint(wall, 'start', allWalls, cornerTolerance);
    const endCornerConnectionCount = countWallsTouchingEndpoint(wall, 'end', allWalls, cornerTolerance);
    const startCorner =
      computeCornerBevelDotsForEndpoint(wall, 'start', allWalls, cornerTolerance)
      ?? (startCornerConnectionCount === 0
        ? computeDeadEndBevelDotsForEndpoint(wall, 'start')
        : null);
    const endCorner =
      computeCornerBevelDotsForEndpoint(wall, 'end', allWalls, cornerTolerance)
      ?? (endCornerConnectionCount === 0
        ? computeDeadEndBevelDotsForEndpoint(wall, 'end')
        : null);

    const createBevelDot = (
      corner: NonNullable<typeof startCorner>,
      endpoint: 'start' | 'end',
      kind: 'outer' | 'inner'
    ): { visual: fabric.Circle; hit: fabric.Circle } => {
      const dotPosition = kind === 'outer' ? corner.outerDotPosition : corner.innerDotPosition;
      const controlType: WallControlType =
        endpoint === 'start'
          ? kind === 'outer'
            ? 'wall-bevel-outer-start'
            : 'wall-bevel-inner-start'
          : kind === 'outer'
            ? 'wall-bevel-outer-end'
            : 'wall-bevel-inner-end';

      const bevelDot = new fabric.Circle({
        left: dotPosition.x * MM_TO_PX,
        top: this.toCanvasY(dotPosition.y),
        radius: bevelRadius,
        fill: kind === 'outer' ? '#FF6B35' : '#4ECDC4',
        stroke: '#FFFFFF',
        strokeWidth: bevelStroke,
        originX: 'center',
        originY: 'center',
        hoverCursor: 'ew-resize',
        lockMovementX: true,
        lockMovementY: true,
      });
      this.annotateControlTarget(bevelDot, wallId, controlType);
      bevelDot.set({
        selectable: false,
        evented: false,
      });
      const hitTarget = this.createControlHitTarget(
        dotPosition,
        wallId,
        controlType,
        'ew-resize',
        bevelHitRadiusPx
      );
      return {
        visual: bevelDot,
        hit: hitTarget,
      };
    };

    const startOuterBevelDot = startCorner
      ? createBevelDot(startCorner, 'start', 'outer')
      : null;
    const startInnerBevelDot = startCorner
      ? createBevelDot(startCorner, 'start', 'inner')
      : null;
    const endOuterBevelDot = endCorner
      ? createBevelDot(endCorner, 'end', 'outer')
      : null;
    const endInnerBevelDot = endCorner
      ? createBevelDot(endCorner, 'end', 'inner')
      : null;

    const interiorThicknessHandle = new fabric.Circle({
      left: interiorMid.x * MM_TO_PX,
      top: this.toCanvasY(interiorMid.y),
      radius: thicknessRadius,
      fill: '#EFF6FF',
      stroke: '#1D4ED8',
      strokeWidth: endpointStroke,
      originX: 'center',
      originY: 'center',
      hoverCursor: 'ew-resize',
      lockMovementX: true,
      lockMovementY: true,
    });
    this.annotateControlTarget(interiorThicknessHandle, wallId, 'wall-thickness-interior');
    interiorThicknessHandle.set({
      selectable: false,
      evented: false,
    });
    const interiorThicknessHandleHit = this.createControlHitTarget(
      interiorMid,
      wallId,
      'wall-thickness-interior',
      'ew-resize',
      thicknessHitRadiusPx
    );

    const exteriorThicknessHandle = new fabric.Circle({
      left: exteriorMid.x * MM_TO_PX,
      top: this.toCanvasY(exteriorMid.y),
      radius: thicknessRadius,
      fill: '#EFF6FF',
      stroke: '#1D4ED8',
      strokeWidth: endpointStroke,
      originX: 'center',
      originY: 'center',
      hoverCursor: 'ew-resize',
      lockMovementX: true,
      lockMovementY: true,
    });
    this.annotateControlTarget(exteriorThicknessHandle, wallId, 'wall-thickness-exterior');
    exteriorThicknessHandle.set({
      selectable: false,
      evented: false,
    });
    const exteriorThicknessHandleHit = this.createControlHitTarget(
      exteriorMid,
      wallId,
      'wall-thickness-exterior',
      'ew-resize',
      thicknessHitRadiusPx
    );

    const centerHandle = new fabric.Circle({
      left: midpoint.x * MM_TO_PX,
      top: this.toCanvasY(midpoint.y),
      radius: centerRadius,
      fill: '#DBEAFE',
      stroke: '#1E40AF',
      strokeWidth: endpointStroke,
      originX: 'center',
      originY: 'center',
      hoverCursor: 'move',
      lockMovementX: true,
      lockMovementY: true,
    });
    this.annotateControlTarget(centerHandle, wallId, 'wall-center-handle');
    centerHandle.set({
      selectable: false,
      evented: false,
    });
    const centerHandleHit = this.createControlHitTarget(
      midpoint,
      wallId,
      'wall-center-handle',
      'move',
      centerHitRadiusPx
    );

    const centerCrossH = new fabric.Line(
      [
        midpoint.x * MM_TO_PX - crossHalf,
        this.toCanvasY(midpoint.y),
        midpoint.x * MM_TO_PX + crossHalf,
        this.toCanvasY(midpoint.y),
      ],
      {
        stroke: '#1E3A8A',
        strokeWidth: crossStroke,
        selectable: false,
        evented: false,
      }
    );
    (centerCrossH as WallControlObject & { isWallControlDecoration?: boolean }).isWallControlDecoration = true;

    const centerCrossV = new fabric.Line(
      [
        midpoint.x * MM_TO_PX,
        this.toCanvasY(midpoint.y) - crossHalf,
        midpoint.x * MM_TO_PX,
        this.toCanvasY(midpoint.y) + crossHalf,
      ],
      {
        stroke: '#1E3A8A',
        strokeWidth: crossStroke,
        selectable: false,
        evented: false,
      }
    );
    (centerCrossV as WallControlObject & { isWallControlDecoration?: boolean }).isWallControlDecoration = true;

    const rotationStem = new fabric.Line(
      [
        midpoint.x * MM_TO_PX,
        this.toCanvasY(midpoint.y),
        rotationPoint.x * MM_TO_PX,
        this.toCanvasY(rotationPoint.y),
      ],
      {
        stroke: '#15803D',
        strokeWidth: stemStroke,
        strokeDashArray: [this.toSceneSize(4), this.toSceneSize(4)],
        selectable: false,
        evented: false,
      }
    );
    (rotationStem as WallControlObject & { isWallControlDecoration?: boolean }).isWallControlDecoration = true;

    const rotationHandle = new fabric.Circle({
      left: rotationPoint.x * MM_TO_PX,
      top: this.toCanvasY(rotationPoint.y),
      radius: rotationRadius,
      fill: '#ECFDF5',
      stroke: '#15803D',
      strokeWidth: endpointStroke,
      originX: 'center',
      originY: 'center',
      hoverCursor: 'alias',
      lockMovementX: true,
      lockMovementY: true,
    });
    this.annotateControlTarget(rotationHandle, wallId, 'wall-rotation-handle');
    rotationHandle.set({
      selectable: false,
      evented: false,
    });
    const rotationHandleHit = this.createControlHitTarget(
      rotationPoint,
      wallId,
      'wall-rotation-handle',
      'alias',
      rotationHitRadiusPx
    );

    const controls: fabric.FabricObject[] = [
      startHandleHit,
      startHandle,
      endHandleHit,
      endHandle,
      ...(startOuterBevelDot ? [startOuterBevelDot.hit, startOuterBevelDot.visual] : []),
      ...(startInnerBevelDot ? [startInnerBevelDot.hit, startInnerBevelDot.visual] : []),
      ...(endOuterBevelDot ? [endOuterBevelDot.hit, endOuterBevelDot.visual] : []),
      ...(endInnerBevelDot ? [endInnerBevelDot.hit, endInnerBevelDot.visual] : []),
      interiorThicknessHandleHit,
      interiorThicknessHandle,
      exteriorThicknessHandleHit,
      exteriorThicknessHandle,
      centerHandleHit,
      centerHandle,
      centerCrossH,
      centerCrossV,
      rotationStem,
      rotationHandleHit,
      rotationHandle,
    ];

    controls.forEach((control) => this.canvas.add(control));

    this.controlPointObjects.set(wallId, controls);
  }

  /**
   * Show selection state for walls.
   */
  setSelectedWalls(selectedWallIds: string[]): void {
    this.selectedWallIds = new Set(selectedWallIds);

    this.wallObjects.forEach((group, wallId) => {
      const outline = group
        .getObjects()
        .find((obj) => (obj as NamedObject).name === 'selectionOutline');
      const hoverOutline = group
        .getObjects()
        .find((obj) => (obj as NamedObject).name === 'hoverOutline');
      if (outline) {
        outline.set('visible', this.selectedWallIds.has(wallId));
      }
      if (hoverOutline) {
        hoverOutline.set(
          'visible',
          !this.selectedWallIds.has(wallId) && this.hoveredWallId === wallId
        );
      }
    });

    Array.from(this.controlPointObjects.keys()).forEach((wallId) => {
      if (!this.selectedWallIds.has(wallId)) {
        this.removeControlPoints(wallId);
      }
    });

    this.selectedWallIds.forEach((wallId) => {
      if (this.wallObjects.has(wallId)) {
        this.createControlPoints(wallId);
      }
    });

    this.canvas.requestRenderAll();
  }

  setHoveredWall(wallId: string | null): void {
    if (this.hoveredWallId === wallId) return;
    this.hoveredWallId = wallId;

    this.wallObjects.forEach((group, currentWallId) => {
      const hoverOutline = group
        .getObjects()
        .find((obj) => (obj as NamedObject).name === 'hoverOutline');
      if (!hoverOutline) return;
      hoverOutline.set(
        'visible',
        currentWallId === wallId && !this.selectedWallIds.has(currentWallId)
      );
    });

    this.canvas.requestRenderAll();
  }

  /**
   * Remove a wall from the canvas.
   */
  removeWall(wallId: string): void {
    const existing = this.wallObjects.get(wallId);
    if (existing) {
      this.canvas.remove(existing);
      this.wallObjects.delete(wallId);
    }
    this.removeControlPoints(wallId);
    this.wallData.delete(wallId);
    this.selectedWallIds.delete(wallId);
    if (this.hoveredWallId === wallId) {
      this.hoveredWallId = null;
    }
  }

  /**
   * Render all walls with proper joins.
   */
  renderAllWalls(walls: Wall[]): void {
    this.wallObjects.forEach((obj) => {
      this.canvas.remove(obj);
    });
    this.wallObjects.clear();
    this.wallData.clear();

    this.controlPointObjects.forEach((controls) => {
      controls.forEach((control) => this.canvas.remove(control));
    });
    this.controlPointObjects.clear();

    const joinsMap = this.computeAllJoins(walls);

    for (const wall of walls) {
      const joins = joinsMap.get(wall.id) || [];
      this.renderWall(wall, joins);
    }

    this.setSelectedWalls([...this.selectedWallIds]);
    this.canvas.requestRenderAll();
  }

  /**
   * Compute all wall joins.
   */
  private computeAllJoins(walls: Wall[]): Map<string, JoinData[]> {
    const joinsMap = new Map<string, JoinData[]>();

    for (const wall of walls) {
      const bestJoinByEndpoint = new Map<
        'start' | 'end',
        { join: JoinData; priority: number }
      >();

      for (const otherWall of walls) {
        if (otherWall.id === wall.id) continue;

        const matches = this.findJoinMatches(wall, otherWall);
        for (const match of matches) {
          const angle = angleBetweenWalls(wall, otherWall, match.point);
          if (!Number.isFinite(angle) || angle < 5 || angle > 175) {
            continue;
          }

          const isTJunction = match.matchType === 'segment';
          const joinType = isTJunction ? 'butt' : determineJoinType(angle);
          const { interiorVertex, exteriorVertex } = isTJunction
            ? this.computeButtJoinVertices(wall, otherWall, match.endpoint)
            : computeMiterJoin(wall, otherWall, match.point);
          const bevelDirection = this.computeBevelDirection(wall, otherWall, match.endpoint, match.point);
          const maxBevelOffset = this.computeMaxBevelOffset(wall, otherWall);

          const join: JoinData = {
            wallId: wall.id,
            otherWallId: otherWall.id,
            endpoint: match.endpoint,
            joinPoint: match.point,
            joinType,
            angle,
            interiorVertex,
            exteriorVertex,
            bevelDirection,
            maxBevelOffset,
          };

          const priority = match.matchType === 'endpoint' ? 2 : 1;
          const existing = bestJoinByEndpoint.get(match.endpoint);
          if (
            !existing ||
            priority > existing.priority ||
            (priority === existing.priority && angle > existing.join.angle)
          ) {
            bestJoinByEndpoint.set(match.endpoint, { join, priority });
          }
        }
      }

      joinsMap.set(
        wall.id,
        Array.from(bestJoinByEndpoint.values()).map((entry) => entry.join)
      );
    }

    return joinsMap;
  }

  /**
   * Find endpoint-level joins between walls (shared endpoint or endpoint-on-segment).
   */
  private findJoinMatches(wall: Wall, otherWall: Wall): WallJoinMatch[] {
    const JOIN_TOLERANCE_MM = this.toSceneTolerance(10, 2, 180);
    const ENDPOINT_T_RATIO = 0.02;
    const matches: WallJoinMatch[] = [];
    const seen = new Set<string>();

    const endpoints: Array<{ endpoint: 'start' | 'end'; point: Point2D }> = [
      { endpoint: 'start', point: wall.startPoint },
      { endpoint: 'end', point: wall.endPoint },
    ];

    for (const { endpoint, point } of endpoints) {
      if (
        this.pointsNear(point, otherWall.startPoint, JOIN_TOLERANCE_MM) ||
        this.pointsNear(point, otherWall.endPoint, JOIN_TOLERANCE_MM)
      ) {
        const key = `${endpoint}:endpoint`;
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({ endpoint, point: { ...point }, matchType: 'endpoint' });
        }
        continue;
      }

      const projection = this.projectPointToSegment(
        point,
        otherWall.startPoint,
        otherWall.endPoint
      );
      if (projection.distance > JOIN_TOLERANCE_MM) {
        continue;
      }

      const segmentLength = Math.max(
        1,
        this.pointDistance(otherWall.startPoint, otherWall.endPoint)
      );
      const endpointBand = Math.min(
        0.2,
        ENDPOINT_T_RATIO + JOIN_TOLERANCE_MM / segmentLength
      );
      const nearOtherStart =
        projection.t <= endpointBand &&
        this.pointDistance(point, otherWall.startPoint) <= JOIN_TOLERANCE_MM * 2;
      const nearOtherEnd =
        projection.t >= 1 - endpointBand &&
        this.pointDistance(point, otherWall.endPoint) <= JOIN_TOLERANCE_MM * 2;
      const matchType: 'endpoint' | 'segment' =
        nearOtherStart || nearOtherEnd ? 'endpoint' : 'segment';

      const key = `${endpoint}:${matchType}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({ endpoint, point: { ...point }, matchType });
      }
    }

    return matches;
  }

  private computeButtJoinVertices(
    wall: Wall,
    hostWall: Wall,
    endpoint: 'start' | 'end'
  ): { interiorVertex: Point2D; exteriorVertex: Point2D } {
    const endpointPoint = endpoint === 'start' ? wall.startPoint : wall.endPoint;
    const oppositePoint = endpoint === 'start' ? wall.endPoint : wall.startPoint;
    const interiorFallback =
      endpoint === 'start' ? wall.interiorLine.start : wall.interiorLine.end;
    const exteriorFallback =
      endpoint === 'start' ? wall.exteriorLine.start : wall.exteriorLine.end;

    const approachVector = {
      x: endpointPoint.x - oppositePoint.x,
      y: endpointPoint.y - oppositePoint.y,
    };
    const approachLength = Math.hypot(approachVector.x, approachVector.y);
    const hostVector = {
      x: hostWall.endPoint.x - hostWall.startPoint.x,
      y: hostWall.endPoint.y - hostWall.startPoint.y,
    };
    const hostLength = Math.hypot(hostVector.x, hostVector.y);
    if (approachLength < 0.0001 || hostLength < 0.0001) {
      return { interiorVertex: interiorFallback, exteriorVertex: exteriorFallback };
    }

    const approachDir = {
      x: approachVector.x / approachLength,
      y: approachVector.y / approachLength,
    };
    const hostNormal = {
      x: -hostVector.y / hostLength,
      y: hostVector.x / hostLength,
    };

    // Select the host face that the branch wall is approaching.
    const useInteriorFace =
      approachDir.x * hostNormal.x + approachDir.y * hostNormal.y < 0;
    const hostFace = useInteriorFace ? hostWall.interiorLine : hostWall.exteriorLine;

    const interiorVertex =
      lineIntersection(
        wall.interiorLine.start,
        wall.interiorLine.end,
        hostFace.start,
        hostFace.end
      ) ?? interiorFallback;
    const exteriorVertex =
      lineIntersection(
        wall.exteriorLine.start,
        wall.exteriorLine.end,
        hostFace.start,
        hostFace.end
      ) ?? exteriorFallback;

    return { interiorVertex, exteriorVertex };
  }

  private directionAwayFromEndpoint(wall: Wall, endpoint: 'start' | 'end'): Point2D {
    const vector =
      endpoint === 'start'
        ? {
          x: wall.endPoint.x - wall.startPoint.x,
          y: wall.endPoint.y - wall.startPoint.y,
        }
        : {
          x: wall.startPoint.x - wall.endPoint.x,
          y: wall.startPoint.y - wall.endPoint.y,
        };
    const length = Math.hypot(vector.x, vector.y);
    if (length < 0.000001) {
      return { x: 0, y: 0 };
    }
    return {
      x: vector.x / length,
      y: vector.y / length,
    };
  }

  private computeBevelDirection(
    wall: Wall,
    otherWall: Wall,
    endpoint: 'start' | 'end',
    joinPoint: Point2D
  ): Point2D {
    const tolerance = this.toSceneTolerance(10, 2, 180);
    const wallDirection = this.directionAwayFromEndpoint(wall, endpoint);
    const otherEndpoint: 'start' | 'end' =
      this.pointDistance(otherWall.startPoint, joinPoint) <=
        this.pointDistance(otherWall.endPoint, joinPoint)
        ? 'start'
        : 'end';
    const otherDirection = this.directionAwayFromEndpoint(otherWall, otherEndpoint);
    const bisector = {
      x: wallDirection.x + otherDirection.x,
      y: wallDirection.y + otherDirection.y,
    };
    const length = Math.hypot(bisector.x, bisector.y);
    if (length < 0.000001) {
      return wallDirection;
    }
    const normalized = {
      x: bisector.x / length,
      y: bisector.y / length,
    };
    if (Math.hypot(normalized.x, normalized.y) < 0.000001) {
      return wallDirection;
    }

    // Keep direction stable even when the join point drifts within tolerance.
    if (this.pointDistance(otherWall.startPoint, joinPoint) <= tolerance || this.pointDistance(otherWall.endPoint, joinPoint) <= tolerance) {
      return normalized;
    }
    return normalized;
  }

  private computeMaxBevelOffset(wall: Wall, otherWall: Wall): number {
    const lengthA = this.pointDistance(wall.startPoint, wall.endPoint);
    const lengthB = this.pointDistance(otherWall.startPoint, otherWall.endPoint);
    let maxOffset = Math.min(lengthA / 2, lengthB / 2);
    if (lengthA * MM_TO_PX < 20 || lengthB * MM_TO_PX < 20) {
      maxOffset = Math.min(maxOffset, Math.min(lengthA, lengthB) / 3);
    }
    return Math.max(0, maxOffset);
  }

  private pointDistance(a: Point2D, b: Point2D): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private pointsNear(a: Point2D, b: Point2D, tolerance = 0.1): boolean {
    return this.pointDistance(a, b) <= tolerance;
  }

  private projectPointToSegment(
    point: Point2D,
    start: Point2D,
    end: Point2D
  ): { point: Point2D; distance: number; t: number } {
    const segment = {
      x: end.x - start.x,
      y: end.y - start.y,
    };
    const lengthSq = segment.x * segment.x + segment.y * segment.y;

    if (lengthSq < 0.000001) {
      return {
        point: { ...start },
        distance: this.pointDistance(point, start),
        t: 0,
      };
    }

    const tRaw =
      ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) / lengthSq;
    const t = Math.max(0, Math.min(1, tRaw));
    const projection = {
      x: start.x + segment.x * t,
      y: start.y + segment.y * t,
    };

    return {
      point: projection,
      distance: this.pointDistance(point, projection),
      t,
    };
  }

  /**
   * Backwards-compatible highlight helper.
   */
  highlightWall(wallId: string, highlight: boolean): void {
    const nextSelection = new Set(this.selectedWallIds);
    if (highlight) {
      nextSelection.add(wallId);
    } else {
      nextSelection.delete(wallId);
    }
    this.setSelectedWalls([...nextSelection]);
  }

  /**
   * Get wall object by ID.
   */
  getWallObject(wallId: string): fabric.Group | undefined {
    return this.wallObjects.get(wallId);
  }

  /**
   * Clear all walls.
   */
  clearAllWalls(): void {
    this.wallObjects.forEach((obj) => {
      this.canvas.remove(obj);
    });
    this.wallObjects.clear();
    this.wallData.clear();
    this.selectedWallIds.clear();
    this.hoveredWallId = null;

    this.controlPointObjects.forEach((controls) => {
      controls.forEach((control) => this.canvas.remove(control));
    });
    this.controlPointObjects.clear();

    this.canvas.requestRenderAll();
  }

  /**
   * Dispose renderer.
   */
  dispose(): void {
    this.clearAllWalls();
    this.hatchPatterns.clear();
  }
}
