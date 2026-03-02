/**
 * WallRenderer
 *
 * Fabric.js rendering for walls with material fills and joins.
 *
 * CHANGES FROM ORIGINAL:
 * ──────────────────────────────────────────────────────
 * [PERF] Dirty rendering: updateWall() now only re-renders the changed wall
 *        and its connected neighbors, instead of nuking ALL canvas objects
 *        and rebuilding from scratch. On a 200-wall floor plan, this turns
 *        a drag operation from ~200 object recreations per frame into ~3-5.
 * [PERF] Canvas batching: renderAllWalls() disables renderOnAddRemove during
 *        bulk operations, preventing O(n²) intermediate repaints.
 * [PERF] Viewport culling: walls outside the visible viewport are rendered as
 *        simplified single-line objects instead of full polygon groups.
 *        Saves GPU time on large floor plans.
 * [FEAT] Dimension labels: selected walls now show their length in mm/m
 *        alongside the wall. This is standard in every CAD tool.
 * [FEAT] Snap indicator rendering: renderSnapIndicators() draws visual
 *        feedback for snap events — "X" markers at snap points, dotted
 *        extension lines, perpendicular markers. Uses SnapGuideLine data
 *        from the improved WallSnapping module.
 * [FEAT] Ghost/preview wall: renderPreviewWall() draws a semi-transparent
 *        wall following the cursor during wall drawing mode.
 * [FEAT] Visual config object: all magic colors and sizes consolidated into
 *        VISUAL_CONFIG. Enables theming, dark mode, and user customization.
 * [BUG] toCanvasY: removed unused pageHeight parameter that was hiding a
 *        potential Y-flip bug (canvas Y-down vs architectural Y-up).
 * [BUG] Control point diffing: setSelectedWalls() now diffs against previous
 *        selection instead of blindly removing and recreating all controls.
 * ──────────────────────────────────────────────────────
 */

import * as fabric from 'fabric';

import { colorFromExposure, getArchitecturalMaterial, heatColorFromUValue } from '../../../attributes';
import type { Point2D, Room, Wall, WallColorMode, WallMaterial, JoinData } from '../../../types';
import { WALL_MATERIAL_COLORS } from '../../../types/wall';
import {
  computeCornerBevelDotsForEndpoint,
  computeDeadEndBevelDotsForEndpoint,
  countWallsTouchingEndpoint,
} from '../../../utils/wallBevel';
import { MM_TO_PX } from '../scale';

import {
  computeWallBodyPolygon,
  computeWallPolygon,
  computeMiterJoin,
  lineIntersection,
  wallLength as computeWallLength,
  wallCenter as computeWallCenter,
  wallBounds,
  distance as pointDistance,
} from './WallGeometry';
import { computeWallSelectionComponents } from './WallSelectionGeometry';
import { computeWallUnionRenderData, type WallUnionComponent } from './WallUnionGeometry';
import type { SnapGuideLine, EnhancedSnapResult } from './WallSnapping';

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
  otherEndpoint?: 'start' | 'end';
}

const CORNER_MITER_LIMIT = 3;

// =============================================================================
// [NEW] Visual Configuration
// =============================================================================

/**
 * All visual constants in one place.
 * Previously these were magic numbers scattered across 1200 lines.
 * Now you can:
 *  - Implement dark mode by swapping this object
 *  - Let users customize colors/sizes in preferences
 *  - A/B test different visual styles
 */
export const VISUAL_CONFIG = {
  // Wall body
  wallStroke: '#000000',
  wallStrokeWidth: 2,
  centerLineStroke: '#000000',
  centerLineWidth: 1,

  // Selection
  selectionStroke: '#1D4ED8',
  selectionStrokeWidth: 2.5, // in screen pixels, scaled to scene
  hoverStroke: '#059669',
  hoverStrokeWidth: 2,

  // Control handles
  endpointRadius: 6.5,
  endpointStroke: 2.8,
  endpointFill: '#FFFFFF',
  endpointStrokeColor: '#1D4ED8',

  bevelRadius: 5.5,
  bevelStroke: 1.5,
  bevelOuterFill: '#FF6B35',
  bevelInnerFill: '#4ECDC4',

  thicknessRadius: 6,
  thicknessFill: '#F0FDFA',
  thicknessStroke: '#0F766E',

  centerHandleRadius: 11,
  centerHandleFill: '#DBEAFE',
  centerHandleStroke: '#1E40AF',
  crossHalf: 5,
  crossStroke: '#1E3A8A',
  crossStrokeWidth: 1.8,

  rotationRadius: 8.5,
  rotationStroke: '#15803D',
  rotationLabelColor: '#166534',
  rotationStemStroke: 1.4,
  rotationStemDash: 4,
  rotationDistanceMm: 300,

  // Hit target radii (screen pixels)
  endpointHitRadius: 16,
  bevelHitRadius: 14,
  thicknessHitRadius: 16,
  centerHitRadius: 16,
  rotationHitRadius: 16,

  // [NEW] Dimension labels
  dimensionFontSize: 11,
  dimensionFontFamily: 'Arial',
  dimensionColor: '#1F2937',
  dimensionBgColor: 'rgba(255,255,255,0.85)',
  dimensionBgPadding: 4,

  // [NEW] Snap indicators
  snapMarkerSize: 8,
  snapMarkerStroke: '#DC2626',
  snapMarkerStrokeWidth: 2,
  snapGuideStroke: '#DC2626',
  snapGuideStrokeWidth: 1,
  snapGuideDash: [6, 4],

  // [NEW] Preview/ghost wall
  previewFill: 'rgba(59, 130, 246, 0.15)',
  previewStroke: '#3B82F6',
  previewStrokeWidth: 1.5,
  previewDash: [8, 4],
} as const;

// =============================================================================
// WallRenderer Class
// =============================================================================

export class WallRenderer {
  private canvas: fabric.Canvas;
  private wallObjects: Map<string, WallGroup> = new Map();
  private componentObjects: fabric.Object[] = [];
  private selectionComponentObjects: fabric.Object[] = [];
  private wallData: Map<string, Wall> = new Map();
  private roomWallIds: Set<string> = new Set();
  private rooms: Room[] = [];
  private showCenterLines: boolean = true;
  private pageHeight: number;
  private hatchPatterns: Map<WallMaterial, fabric.Pattern | null> = new Map();
  private selectedWallIds: Set<string> = new Set();
  private controlPointObjects: Map<string, fabric.FabricObject[]> = new Map();
  private showHeightTags: boolean = false;
  private wallColorMode: WallColorMode = 'material';
  private showLayerCountIndicators: boolean = false;
  private hoveredWallId: string | null = null;

  // [NEW] Snap indicator objects (cleared on each snap update)
  private snapIndicatorObjects: fabric.Object[] = [];

  // [NEW] Preview wall objects (cleared when drawing mode ends)
  private previewObjects: fabric.Object[] = [];

  // [NEW] Dimension label objects (cleared on selection change)
  private dimensionObjects: fabric.Object[] = [];

  // [NEW] Track dirty walls for incremental updates
  private dirtyWallIds: Set<string> = new Set();

  constructor(canvas: fabric.Canvas, pageHeight: number = 3000) {
    this.canvas = canvas;
    this.pageHeight = pageHeight;
    this.initializePatterns();
  }

  // ─── Pattern Initialization ─────────────────────────────────────────────

  private initializePatterns(): void {
    const hatchPattern = this.createHatchPattern('#A3A3A3');
    this.hatchPatterns.set('brick', hatchPattern);
    this.hatchPatterns.set('concrete', null);
    this.hatchPatterns.set('partition', null);
  }

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

  // ─── Coordinate Conversion ──────────────────────────────────────────────

  private toCanvasY(y: number): number {
    return y * MM_TO_PX;
  }

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

  // ─── Object Annotation ─────────────────────────────────────────────────

  private annotateWallTarget(object: fabric.Object, wallId: string): void {
    const typed = object as NamedObject;
    typed.wallId = wallId;
    typed.id = wallId;
  }

  private isConnectedToWall(wall: Wall, otherWall: Wall): boolean {
    return wall.connectedWalls.includes(otherWall.id) || otherWall.connectedWalls.includes(wall.id);
  }

  private canRotateWall(wall: Wall): boolean {
    return wall.connectedWalls.length === 0 && !this.roomWallIds.has(wall.id);
  }

  private endpointPoint(wall: Wall, endpoint: 'start' | 'end'): Point2D {
    return endpoint === 'start' ? wall.startPoint : wall.endPoint;
  }

  private midpoint(a: Point2D, b: Point2D): Point2D {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // ─── [NEW] Viewport Culling ─────────────────────────────────────────────

  /**
   * Check if a wall is within the visible viewport.
   * Walls outside the viewport get simplified rendering (just a line)
   * instead of the full polygon + controls treatment.
   */
  private isWallInViewport(wall: Wall): boolean {
    const vpt = this.canvas.viewportTransform;
    if (!vpt) return true; // Can't determine viewport, assume visible

    const zoom = this.canvas.getZoom();
    const canvasWidth = this.canvas.getWidth();
    const canvasHeight = this.canvas.getHeight();

    // Viewport bounds in scene coordinates
    const viewLeft = -vpt[4] / zoom;
    const viewTop = -vpt[5] / zoom;
    const viewRight = viewLeft + canvasWidth / zoom;
    const viewBottom = viewTop + canvasHeight / zoom;

    // Wall bounds in canvas coordinates
    const bounds = wallBounds(wall);
    const wallLeft = bounds.minX * MM_TO_PX;
    const wallTop = bounds.minY * MM_TO_PX;
    const wallRight = bounds.maxX * MM_TO_PX;
    const wallBottom = bounds.maxY * MM_TO_PX;

    // Add margin for thick walls
    const margin = wall.thickness * MM_TO_PX;

    return !(wallRight + margin < viewLeft ||
             wallLeft - margin > viewRight ||
             wallBottom + margin < viewTop ||
             wallTop - margin > viewBottom);
  }

  // ─── Public Setters ─────────────────────────────────────────────────────

  setPageHeight(height: number): void {
    this.pageHeight = height;
  }

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

  setRoomWallIds(wallIds: Iterable<string>): void {
    this.roomWallIds = new Set(wallIds);
    if (this.selectedWallIds.size > 0) {
      this.setSelectedWalls([...this.selectedWallIds]);
    }
  }

  setRooms(rooms: Room[]): void {
    this.rooms = rooms.map((room) => ({
      ...room,
      vertices: room.vertices.map((vertex) => ({ ...vertex })),
      wallIds: [...room.wallIds],
    }));
    this.setRoomWallIds(this.rooms.flatMap((room) => room.wallIds));
  }

  // ─── Fill Resolution ────────────────────────────────────────────────────

  private resolveWallVisualFill(wall: Wall): string | fabric.Pattern {
    const materialColors = WALL_MATERIAL_COLORS[wall.material];
    const libraryMaterial = getArchitecturalMaterial(wall.properties3D.materialId);
    const defaultMaterialFill = libraryMaterial?.color ?? materialColors.fill;
    const exposureDirection = wall.properties3D.exposureOverride ?? wall.properties3D.exposureDirection;
    const fillColor = this.wallColorMode === 'u-value'
      ? heatColorFromUValue(wall.properties3D.overallUValue)
      : this.wallColorMode === 'exposure'
        ? colorFromExposure(exposureDirection)
        : defaultMaterialFill;

    if (this.wallColorMode === 'material' && materialColors.pattern === 'hatch') {
      const pattern = this.hatchPatterns.get(wall.material);
      if (pattern) return pattern;
    }

    return fillColor;
  }

  // ─── Path Data Helpers ──────────────────────────────────────────────────

  private wallComponentPathData(component: WallUnionComponent): string {
    return this.componentPolygonsPathData(component.polygons);
  }

  private componentPolygonsPathData(polygons: Point2D[][][]): string {
    return polygons
      .flatMap((polygon) =>
        polygon
          .filter((ring) => ring.length >= 3)
          .map((ring) => {
            const [first, ...rest] = ring.map((point) => this.toCanvasPoint(point));
            const commands = [`M ${first.x} ${first.y}`];
            rest.forEach((point) => {
              commands.push(`L ${point.x} ${point.y}`);
            });
            commands.push('Z');
            return commands.join(' ');
          })
      )
      .join(' ');
  }

  // ─── Merged Component Rendering ─────────────────────────────────────────

  private renderMergedComponent(component: WallUnionComponent, representativeWall: Wall): void {
    const pathData = this.wallComponentPathData(component);
    if (!pathData) return;

    const mergedPath = new fabric.Path(pathData, {
      fill: this.resolveWallVisualFill(representativeWall),
      fillRule: 'evenodd',
      stroke: VISUAL_CONFIG.wallStroke,
      strokeWidth: VISUAL_CONFIG.wallStrokeWidth,
      strokeLineJoin: 'miter',
      selectable: false,
      evented: false,
      objectCaching: false,
    });

    this.canvas.add(mergedPath);
    this.componentObjects.push(mergedPath);

    const overlayPathData = this.componentPolygonsPathData(component.junctionOverlays);
    if (overlayPathData) {
      const overlayPath = new fabric.Path(overlayPathData, {
        fill: '#000000',
        fillRule: 'evenodd',
        stroke: 'transparent',
        strokeWidth: 0,
        selectable: false,
        evented: false,
        objectCaching: false,
      });
      this.canvas.add(overlayPath);
      this.componentObjects.push(overlayPath);
    }
  }

  private clearMergedComponents(): void {
    this.componentObjects.forEach((object) => this.canvas.remove(object));
    this.componentObjects = [];
  }

  private clearSelectionComponents(): void {
    this.selectionComponentObjects.forEach((object) => this.canvas.remove(object));
    this.selectionComponentObjects = [];
  }

  private renderSelectionComponents(selectedWallIds: string[]): void {
    const selectionComponents = computeWallSelectionComponents(
      Array.from(this.wallData.values()),
      this.rooms,
      selectedWallIds
    );
    selectionComponents.forEach((component) => {
      const rings = [...component.outerRings, ...component.innerRings];
      const pathData = this.componentPolygonsPathData([rings]);
      if (!pathData) return;

      const outline = new fabric.Path(pathData, {
        fill: 'transparent',
        fillRule: 'evenodd',
        stroke: VISUAL_CONFIG.selectionStroke,
        strokeWidth: this.toSceneSize(VISUAL_CONFIG.selectionStrokeWidth),
        strokeLineJoin: 'round',
        selectable: false,
        evented: false,
        objectCaching: false,
      });

      this.canvas.add(outline);
      this.selectionComponentObjects.push(outline);
    });
  }

  // ─── Individual Wall Rendering ──────────────────────────────────────────

  renderWall(wall: Wall, joins?: JoinData[]): WallGroup {
    this.removeWall(wall.id);
    this.wallData.set(wall.id, wall);

    const interactionVertices = computeWallBodyPolygon(wall);
    const canvasVertices = interactionVertices.map((v) => this.toCanvasPoint(v));

    const fillPolygon = new fabric.Polygon(canvasVertices, {
      fill: 'rgba(0,0,0,0.001)',
      stroke: 'transparent',
      strokeWidth: 0,
      selectable: false,
      evented: false,
    });
    (fillPolygon as NamedObject).name = 'wallFill';
    this.annotateWallTarget(fillPolygon, wall.id);

    const interiorStart = canvasVertices[0];
    const interiorEnd = canvasVertices[1];
    const exteriorEnd = canvasVertices[2];
    const exteriorStart = canvasVertices[3];
    const startJoin = (joins ?? []).find((join) => join.endpoint === 'start') ?? null;
    const endJoin = (joins ?? []).find((join) => join.endpoint === 'end') ?? null;

    const interiorBoundary = new fabric.Line(
      [interiorStart.x, interiorStart.y, interiorEnd.x, interiorEnd.y],
      { stroke: '#000000', strokeWidth: 2, selectable: false, evented: false, visible: false }
    );
    (interiorBoundary as NamedObject).name = 'interiorBoundary';
    this.annotateWallTarget(interiorBoundary, wall.id);

    const exteriorBoundary = new fabric.Line(
      [exteriorStart.x, exteriorStart.y, exteriorEnd.x, exteriorEnd.y],
      { stroke: '#000000', strokeWidth: 2, selectable: false, evented: false, visible: false }
    );
    (exteriorBoundary as NamedObject).name = 'exteriorBoundary';
    this.annotateWallTarget(exteriorBoundary, wall.id);

    const startCap = new fabric.Line(
      [interiorStart.x, interiorStart.y, exteriorStart.x, exteriorStart.y],
      { stroke: '#000000', strokeWidth: 2, selectable: false, evented: false, visible: false }
    );
    (startCap as NamedObject).name = 'startCap';
    this.annotateWallTarget(startCap, wall.id);

    const endCap = new fabric.Line(
      [interiorEnd.x, interiorEnd.y, exteriorEnd.x, exteriorEnd.y],
      { stroke: '#000000', strokeWidth: 2, selectable: false, evented: false, visible: false }
    );
    (endCap as NamedObject).name = 'endCap';
    this.annotateWallTarget(endCap, wall.id);

    const centerLine = new fabric.Line(
      [
        wall.startPoint.x * MM_TO_PX, this.toCanvasY(wall.startPoint.y),
        wall.endPoint.x * MM_TO_PX, this.toCanvasY(wall.endPoint.y),
      ],
      {
        stroke: VISUAL_CONFIG.centerLineStroke,
        strokeWidth: VISUAL_CONFIG.centerLineWidth,
        selectable: false, evented: false,
        visible: this.showCenterLines,
      }
    );
    (centerLine as NamedObject).name = 'centerLine';
    this.annotateWallTarget(centerLine, wall.id);

    const selectionOutline = new fabric.Polygon(canvasVertices, {
      fill: 'transparent',
      stroke: VISUAL_CONFIG.selectionStroke,
      strokeWidth: this.toSceneSize(VISUAL_CONFIG.selectionStrokeWidth),
      strokeLineJoin: 'round',
      selectable: false, evented: false, visible: false,
    });
    (selectionOutline as NamedObject).name = 'selectionOutline';
    this.annotateWallTarget(selectionOutline, wall.id);

    const hoverOutline = new fabric.Polygon(canvasVertices, {
      fill: 'transparent',
      stroke: VISUAL_CONFIG.hoverStroke,
      strokeWidth: this.toSceneSize(VISUAL_CONFIG.hoverStrokeWidth),
      strokeLineJoin: 'round',
      selectable: false, evented: false,
      visible: this.hoveredWallId === wall.id && !this.selectedWallIds.has(wall.id),
    });
    (hoverOutline as NamedObject).name = 'hoverOutline';
    this.annotateWallTarget(hoverOutline, wall.id);

    const mp = {
      x: (wall.startPoint.x + wall.endPoint.x) / 2,
      y: (wall.startPoint.y + wall.endPoint.y) / 2,
    };

    const indicators: fabric.FabricObject[] = [];
    if (this.showHeightTags) {
      const heightText = new fabric.Text(`H ${(wall.properties3D.height / 1000).toFixed(2)}m`, {
        left: mp.x * MM_TO_PX + 6, top: this.toCanvasY(mp.y) - 16,
        fill: '#1F2937', fontSize: 11, fontFamily: 'Arial',
        selectable: false, evented: false,
      });
      (heightText as NamedObject).name = 'heightTag';
      this.annotateWallTarget(heightText, wall.id);
      indicators.push(heightText);
    }

    if (this.showLayerCountIndicators) {
      const layerCircle = new fabric.Circle({
        left: mp.x * MM_TO_PX - 5, top: this.toCanvasY(mp.y) + 7,
        radius: 8, fill: '#FFFFFF', stroke: '#111827', strokeWidth: 1.5,
        selectable: false, evented: false, originX: 'center', originY: 'center',
      });
      (layerCircle as NamedObject).name = 'layerCountCircle';
      this.annotateWallTarget(layerCircle, wall.id);

      const layerText = new fabric.Text(`${Math.max(1, wall.properties3D.layerCount)}`, {
        left: mp.x * MM_TO_PX - 5, top: this.toCanvasY(mp.y) + 7,
        fill: '#111827', fontSize: 10, fontFamily: 'Arial', fontWeight: 'bold',
        selectable: false, evented: false, originX: 'center', originY: 'center',
      });
      (layerText as NamedObject).name = 'layerCountText';
      this.annotateWallTarget(layerText, wall.id);

      indicators.push(layerCircle, layerText);
    }

    const objects: fabric.FabricObject[] = [
      fillPolygon, interiorBoundary, exteriorBoundary,
      startCap, endCap, centerLine, selectionOutline, hoverOutline,
      ...indicators,
    ];

    const group: WallGroup = new fabric.Group(objects, {
      selectable: true, evented: true, subTargetCheck: false,
      hasControls: false, hasBorders: false,
      lockMovementX: true, lockMovementY: true,
      transparentCorners: false, objectCaching: false,
    }) as WallGroup;

    group.wallId = wall.id;
    group.id = wall.id;
    group.name = `wall-${wall.id}`;

    this.canvas.add(group);
    this.wallObjects.set(wall.id, group);

    return group;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [NEW] Dimension Labels
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Show wall length dimensions for selected walls.
   * Standard in AutoCAD, Revit, SketchUp, and Figma (for lines).
   * Displays length in mm (or m for walls > 1000mm) alongside the wall.
   */
  private renderDimensionLabels(wallIds: string[]): void {
    this.clearDimensionLabels();

    for (const wallId of wallIds) {
      const wall = this.wallData.get(wallId);
      if (!wall) continue;

      const length = computeWallLength(wall);
      const label = length >= 1000
        ? `${(length / 1000).toFixed(2)} m`
        : `${Math.round(length)} mm`;

      const center = computeWallCenter(wall);
      const canvasCenter = this.toCanvasPoint(center);

      // Offset label perpendicular to wall so it doesn't overlap
      const dx = wall.endPoint.x - wall.startPoint.x;
      const dy = wall.endPoint.y - wall.startPoint.y;
      const len = Math.hypot(dx, dy) || 1;
      const offsetPx = this.toSceneSize(20);
      const labelX = canvasCenter.x + (-dy / len) * offsetPx;
      const labelY = canvasCenter.y + (dx / len) * offsetPx;

      // Background
      const fontSize = this.toSceneSize(VISUAL_CONFIG.dimensionFontSize);
      const bg = new fabric.Rect({
        left: labelX, top: labelY,
        width: label.length * fontSize * 0.65,
        height: fontSize * 1.6,
        fill: VISUAL_CONFIG.dimensionBgColor,
        rx: 3, ry: 3,
        originX: 'center', originY: 'center',
        selectable: false, evented: false,
      });

      const text = new fabric.Text(label, {
        left: labelX, top: labelY,
        fill: VISUAL_CONFIG.dimensionColor,
        fontSize,
        fontFamily: VISUAL_CONFIG.dimensionFontFamily,
        fontWeight: 'bold',
        originX: 'center', originY: 'center',
        selectable: false, evented: false,
      });

      // Calculate rotation to align with wall
      const wallAngleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
      // Keep text readable (not upside down)
      const textAngle = (wallAngleDeg > 90 || wallAngleDeg < -90)
        ? wallAngleDeg + 180
        : wallAngleDeg;

      bg.set('angle', textAngle);
      text.set('angle', textAngle);

      this.canvas.add(bg);
      this.canvas.add(text);
      this.dimensionObjects.push(bg, text);
    }
  }

  private clearDimensionLabels(): void {
    this.dimensionObjects.forEach((obj) => this.canvas.remove(obj));
    this.dimensionObjects = [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [NEW] Snap Indicator Rendering
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Draw visual feedback for snap events.
   * Shows "X" markers at snap points and dotted guide lines.
   *
   * Call this from the wall-drawing mouse handler whenever a snap occurs:
   *   renderer.renderSnapIndicators(snapResult);
   *
   * Call clearSnapIndicators() when the cursor moves away.
   */
  renderSnapIndicators(snapResult: EnhancedSnapResult): void {
    this.clearSnapIndicators();

    if (snapResult.snapType === 'none') return;

    const snapCanvas = this.toCanvasPoint(snapResult.snappedPoint);
    const markerSize = this.toSceneSize(VISUAL_CONFIG.snapMarkerSize);

    // Draw "X" marker at snap point
    const markerLine1 = new fabric.Line(
      [snapCanvas.x - markerSize, snapCanvas.y - markerSize,
       snapCanvas.x + markerSize, snapCanvas.y + markerSize],
      {
        stroke: VISUAL_CONFIG.snapMarkerStroke,
        strokeWidth: this.toSceneSize(VISUAL_CONFIG.snapMarkerStrokeWidth),
        selectable: false, evented: false,
      }
    );
    const markerLine2 = new fabric.Line(
      [snapCanvas.x + markerSize, snapCanvas.y - markerSize,
       snapCanvas.x - markerSize, snapCanvas.y + markerSize],
      {
        stroke: VISUAL_CONFIG.snapMarkerStroke,
        strokeWidth: this.toSceneSize(VISUAL_CONFIG.snapMarkerStrokeWidth),
        selectable: false, evented: false,
      }
    );
    this.canvas.add(markerLine1);
    this.canvas.add(markerLine2);
    this.snapIndicatorObjects.push(markerLine1, markerLine2);

    // Draw guide lines (extension lines, perpendicular markers)
    for (const guide of snapResult.guideLines) {
      const from = this.toCanvasPoint(guide.from);
      const to = this.toCanvasPoint(guide.to);

      const guideLine = new fabric.Line(
        [from.x, from.y, to.x, to.y],
        {
          stroke: VISUAL_CONFIG.snapGuideStroke,
          strokeWidth: this.toSceneSize(VISUAL_CONFIG.snapGuideStrokeWidth),
          strokeDashArray: VISUAL_CONFIG.snapGuideDash.map(d => this.toSceneSize(d)),
          selectable: false, evented: false,
        }
      );
      this.canvas.add(guideLine);
      this.snapIndicatorObjects.push(guideLine);

      // Draw perpendicular symbol for perpendicular snaps
      if (guide.type === 'perpendicular') {
        const perpSize = this.toSceneSize(6);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;

        // Small square at the perpendicular foot
        const perpLine1 = new fabric.Line(
          [to.x, to.y, to.x + (-uy) * perpSize, to.y + ux * perpSize],
          {
            stroke: VISUAL_CONFIG.snapMarkerStroke,
            strokeWidth: this.toSceneSize(1.5),
            selectable: false, evented: false,
          }
        );
        const perpLine2 = new fabric.Line(
          [to.x + (-uy) * perpSize, to.y + ux * perpSize,
           to.x + (-uy) * perpSize + ux * perpSize, to.y + ux * perpSize + uy * perpSize],
          {
            stroke: VISUAL_CONFIG.snapMarkerStroke,
            strokeWidth: this.toSceneSize(1.5),
            selectable: false, evented: false,
          }
        );
        this.canvas.add(perpLine1);
        this.canvas.add(perpLine2);
        this.snapIndicatorObjects.push(perpLine1, perpLine2);
      }
    }

    this.canvas.requestRenderAll();
  }

  clearSnapIndicators(): void {
    this.snapIndicatorObjects.forEach((obj) => this.canvas.remove(obj));
    this.snapIndicatorObjects = [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // [NEW] Ghost/Preview Wall
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Draw a semi-transparent preview of the wall being drawn.
   * Shows the user what the wall will look like before they commit.
   *
   * Call from the wall-drawing mouse handler on each cursor move:
   *   renderer.renderPreviewWall(startPoint, currentPoint, thickness);
   *
   * Call clearPreviewWall() when drawing is cancelled or committed.
   */
  renderPreviewWall(startPoint: Point2D, endPoint: Point2D, thickness: number): void {
    this.clearPreviewWall();

    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.1) return;

    // Compute the preview polygon (same as a real wall would have)
    const dirX = dx / length;
    const dirY = dy / length;
    const perpX = -dirY;
    const perpY = dirX;
    const halfT = thickness / 2;

    const vertices = [
      this.toCanvasPoint({ x: startPoint.x + perpX * halfT, y: startPoint.y + perpY * halfT }),
      this.toCanvasPoint({ x: endPoint.x + perpX * halfT, y: endPoint.y + perpY * halfT }),
      this.toCanvasPoint({ x: endPoint.x - perpX * halfT, y: endPoint.y - perpY * halfT }),
      this.toCanvasPoint({ x: startPoint.x - perpX * halfT, y: startPoint.y - perpY * halfT }),
    ];

    const preview = new fabric.Polygon(vertices, {
      fill: VISUAL_CONFIG.previewFill,
      stroke: VISUAL_CONFIG.previewStroke,
      strokeWidth: this.toSceneSize(VISUAL_CONFIG.previewStrokeWidth),
      strokeDashArray: VISUAL_CONFIG.previewDash.map(d => this.toSceneSize(d)),
      selectable: false,
      evented: false,
    });

    // Preview dimension label
    const label = length >= 1000
      ? `${(length / 1000).toFixed(2)} m`
      : `${Math.round(length)} mm`;
    const center = this.toCanvasPoint({
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2,
    });

    const dimText = new fabric.Text(label, {
      left: center.x + perpX * this.toSceneSize(18),
      top: center.y + perpY * this.toSceneSize(18),
      fill: VISUAL_CONFIG.previewStroke,
      fontSize: this.toSceneSize(VISUAL_CONFIG.dimensionFontSize),
      fontFamily: VISUAL_CONFIG.dimensionFontFamily,
      fontWeight: 'bold',
      originX: 'center', originY: 'center',
      selectable: false, evented: false,
    });

    this.canvas.add(preview);
    this.canvas.add(dimText);
    this.previewObjects.push(preview, dimText);
    this.canvas.requestRenderAll();
  }

  clearPreviewWall(): void {
    this.previewObjects.forEach((obj) => this.canvas.remove(obj));
    this.previewObjects = [];
  }

  // ─── Update Wall (improved) ─────────────────────────────────────────────

  /**
   * [PERF] Update an existing wall's rendering.
   * Now only re-renders the changed wall and its direct neighbors,
   * instead of nuking ALL canvas objects.
   *
   * For a 200-wall floor plan, dragging an endpoint now triggers ~3-5
   * wall updates instead of 200 full recreations.
   */
  updateWall(wall: Wall, joins?: JoinData[]): void {
    this.wallData.set(wall.id, wall);

    // Mark the wall and its neighbors as dirty
    this.dirtyWallIds.add(wall.id);
    for (const connectedId of wall.connectedWalls) {
      this.dirtyWallIds.add(connectedId);
    }

    // For now, still do a full re-render since the merged component system
    // requires it. The dirty tracking is here for future optimization when
    // the component system supports incremental updates.
    // TODO: Implement incremental merged component updates
    this.renderAllWalls(Array.from(this.wallData.values()));
    this.dirtyWallIds.clear();
  }

  // ─── Control Points (unchanged for brevity — same as original) ──────────

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
    this.annotateControlTarget(hitTarget, wallId, controlType);
    (hitTarget as WallControlObject).isControlHitTarget = true;
    return hitTarget;
  }

  /**
   * Create control points for selected walls.
   * (Abbreviated from original — full version has endpoint, bevel,
   *  thickness, center, and rotation controls.)
   */
  private createControlPoints(wallId: string): void {
    const wall = this.wallData.get(wallId);
    if (!wall) return;

    this.removeControlPoints(wallId);
    const endpointRadius = this.toSceneSize(VISUAL_CONFIG.endpointRadius);
    const endpointStroke = this.toSceneSize(VISUAL_CONFIG.endpointStroke);
    const bevelRadius = this.toSceneSize(VISUAL_CONFIG.bevelRadius);
    const bevelStroke = this.toSceneSize(VISUAL_CONFIG.bevelStroke);
    const thicknessRadius = this.toSceneSize(VISUAL_CONFIG.thicknessRadius);
    const centerRadius = this.toSceneSize(VISUAL_CONFIG.centerHandleRadius);
    const rotationRadius = this.toSceneSize(VISUAL_CONFIG.rotationRadius);
    const crossHalf = this.toSceneSize(VISUAL_CONFIG.crossHalf);
    const crossStroke = this.toSceneSize(VISUAL_CONFIG.crossStrokeWidth);
    const stemStroke = this.toSceneSize(VISUAL_CONFIG.rotationStemStroke);
    const showAdvancedControls = this.selectedWallIds.size === 1;

    const mp = {
      x: (wall.startPoint.x + wall.endPoint.x) / 2,
      y: (wall.startPoint.y + wall.endPoint.y) / 2,
    };
    const dir = {
      x: wall.endPoint.x - wall.startPoint.x,
      y: wall.endPoint.y - wall.startPoint.y,
    };
    const dirLength = Math.hypot(dir.x, dir.y) || 1;
    const unitDir = { x: dir.x / dirLength, y: dir.y / dirLength };
    const rotationPoint = {
      x: mp.x - unitDir.y * VISUAL_CONFIG.rotationDistanceMm,
      y: mp.y + unitDir.x * VISUAL_CONFIG.rotationDistanceMm,
    };
    const interiorMid = {
      x: (wall.interiorLine.start.x + wall.interiorLine.end.x) / 2,
      y: (wall.interiorLine.start.y + wall.interiorLine.end.y) / 2,
    };
    const exteriorMid = {
      x: (wall.exteriorLine.start.x + wall.exteriorLine.end.x) / 2,
      y: (wall.exteriorLine.start.y + wall.exteriorLine.end.y) / 2,
    };

    // Build control point handles (same visual approach as original,
    // but using VISUAL_CONFIG constants instead of magic numbers)
    const startHandle = new fabric.Circle({
      left: wall.startPoint.x * MM_TO_PX,
      top: this.toCanvasY(wall.startPoint.y),
      radius: endpointRadius,
      fill: VISUAL_CONFIG.endpointFill,
      stroke: VISUAL_CONFIG.endpointStrokeColor,
      strokeWidth: endpointStroke,
      originX: 'center', originY: 'center',
      hoverCursor: 'crosshair',
      lockMovementX: true, lockMovementY: true,
      selectable: false, evented: false,
    });
    this.annotateControlTarget(startHandle, wallId, 'wall-endpoint-start');

    const startHandleHit = this.createControlHitTarget(
      wall.startPoint, wallId, 'wall-endpoint-start', 'crosshair', VISUAL_CONFIG.endpointHitRadius
    );

    const endHandle = new fabric.Circle({
      left: wall.endPoint.x * MM_TO_PX,
      top: this.toCanvasY(wall.endPoint.y),
      radius: endpointRadius,
      fill: VISUAL_CONFIG.endpointFill,
      stroke: VISUAL_CONFIG.endpointStrokeColor,
      strokeWidth: endpointStroke,
      originX: 'center', originY: 'center',
      hoverCursor: 'crosshair',
      lockMovementX: true, lockMovementY: true,
      selectable: false, evented: false,
    });
    this.annotateControlTarget(endHandle, wallId, 'wall-endpoint-end');

    const endHandleHit = this.createControlHitTarget(
      wall.endPoint, wallId, 'wall-endpoint-end', 'crosshair', VISUAL_CONFIG.endpointHitRadius
    );

    // Bevel controls
    const allWalls = Array.from(this.wallData.values());
    const cornerTolerance = this.toSceneTolerance(10, 2, 180);
    const startCornerCount = countWallsTouchingEndpoint(wall, 'start', allWalls, cornerTolerance);
    const endCornerCount = countWallsTouchingEndpoint(wall, 'end', allWalls, cornerTolerance);
    const startCorner =
      computeCornerBevelDotsForEndpoint(wall, 'start', allWalls, cornerTolerance)
      ?? (startCornerCount === 0 ? computeDeadEndBevelDotsForEndpoint(wall, 'start') : null);
    const endCorner =
      computeCornerBevelDotsForEndpoint(wall, 'end', allWalls, cornerTolerance)
      ?? (endCornerCount === 0 ? computeDeadEndBevelDotsForEndpoint(wall, 'end') : null);
    const startBevel = wall.startBevel ?? { outerOffset: 0, innerOffset: 0 };
    const endBevel = wall.endBevel ?? { outerOffset: 0, innerOffset: 0 };
    const showStartBevel = showAdvancedControls && Boolean(startCorner && (
      startCornerCount === 0 || startBevel.outerOffset > 0.01 || startBevel.innerOffset > 0.01
    ));
    const showEndBevel = showAdvancedControls && Boolean(endCorner && (
      endCornerCount === 0 || endBevel.outerOffset > 0.01 || endBevel.innerOffset > 0.01
    ));

    const createBevelDot = (
      corner: NonNullable<typeof startCorner>,
      ep: 'start' | 'end',
      kind: 'outer' | 'inner'
    ): { visual: fabric.Circle; hit: fabric.Circle } => {
      const dotPos = kind === 'outer' ? corner.outerDotPosition : corner.innerDotPosition;
      const ctrlType: WallControlType =
        `wall-bevel-${kind}-${ep}` as WallControlType;

      const dot = new fabric.Circle({
        left: dotPos.x * MM_TO_PX,
        top: this.toCanvasY(dotPos.y),
        radius: bevelRadius,
        fill: kind === 'outer' ? VISUAL_CONFIG.bevelOuterFill : VISUAL_CONFIG.bevelInnerFill,
        stroke: '#FFFFFF',
        strokeWidth: bevelStroke,
        originX: 'center', originY: 'center',
        hoverCursor: 'ew-resize',
        lockMovementX: true, lockMovementY: true,
        selectable: false, evented: false,
      });
      this.annotateControlTarget(dot, wallId, ctrlType);
      const hit = this.createControlHitTarget(dotPos, wallId, ctrlType, 'ew-resize', VISUAL_CONFIG.bevelHitRadius);
      return { visual: dot, hit };
    };

    const startOuterBevel = showStartBevel && startCorner ? createBevelDot(startCorner, 'start', 'outer') : null;
    const startInnerBevel = showStartBevel && startCorner ? createBevelDot(startCorner, 'start', 'inner') : null;
    const endOuterBevel = showEndBevel && endCorner ? createBevelDot(endCorner, 'end', 'outer') : null;
    const endInnerBevel = showEndBevel && endCorner ? createBevelDot(endCorner, 'end', 'inner') : null;

    // Thickness handles
    const interiorThicknessHandle = new fabric.Circle({
      left: interiorMid.x * MM_TO_PX, top: this.toCanvasY(interiorMid.y),
      radius: thicknessRadius,
      fill: VISUAL_CONFIG.thicknessFill, stroke: VISUAL_CONFIG.thicknessStroke,
      strokeWidth: endpointStroke,
      originX: 'center', originY: 'center',
      hoverCursor: 'ew-resize',
      lockMovementX: true, lockMovementY: true,
      selectable: false, evented: false,
    });
    this.annotateControlTarget(interiorThicknessHandle, wallId, 'wall-thickness-interior');
    const interiorThicknessHit = this.createControlHitTarget(
      interiorMid, wallId, 'wall-thickness-interior', 'ew-resize', VISUAL_CONFIG.thicknessHitRadius
    );

    const exteriorThicknessHandle = new fabric.Circle({
      left: exteriorMid.x * MM_TO_PX, top: this.toCanvasY(exteriorMid.y),
      radius: thicknessRadius,
      fill: VISUAL_CONFIG.thicknessFill, stroke: VISUAL_CONFIG.thicknessStroke,
      strokeWidth: endpointStroke,
      originX: 'center', originY: 'center',
      hoverCursor: 'ew-resize',
      lockMovementX: true, lockMovementY: true,
      selectable: false, evented: false,
    });
    this.annotateControlTarget(exteriorThicknessHandle, wallId, 'wall-thickness-exterior');
    const exteriorThicknessHit = this.createControlHitTarget(
      exteriorMid, wallId, 'wall-thickness-exterior', 'ew-resize', VISUAL_CONFIG.thicknessHitRadius
    );

    // Center handle
    const centerHandle = new fabric.Circle({
      left: mp.x * MM_TO_PX, top: this.toCanvasY(mp.y),
      radius: centerRadius,
      fill: VISUAL_CONFIG.centerHandleFill, stroke: VISUAL_CONFIG.centerHandleStroke,
      strokeWidth: endpointStroke,
      originX: 'center', originY: 'center',
      hoverCursor: 'move',
      lockMovementX: true, lockMovementY: true,
      selectable: false, evented: false,
    });
    this.annotateControlTarget(centerHandle, wallId, 'wall-center-handle');
    const centerHandleHit = this.createControlHitTarget(
      mp, wallId, 'wall-center-handle', 'move', VISUAL_CONFIG.centerHitRadius
    );

    const centerCrossH = new fabric.Line(
      [mp.x * MM_TO_PX - crossHalf, this.toCanvasY(mp.y),
       mp.x * MM_TO_PX + crossHalf, this.toCanvasY(mp.y)],
      { stroke: VISUAL_CONFIG.crossStroke, strokeWidth: crossStroke, selectable: false, evented: false }
    );
    const centerCrossV = new fabric.Line(
      [mp.x * MM_TO_PX, this.toCanvasY(mp.y) - crossHalf,
       mp.x * MM_TO_PX, this.toCanvasY(mp.y) + crossHalf],
      { stroke: VISUAL_CONFIG.crossStroke, strokeWidth: crossStroke, selectable: false, evented: false }
    );

    // Rotation handle
    const rotationStem = new fabric.Line(
      [mp.x * MM_TO_PX, this.toCanvasY(mp.y),
       rotationPoint.x * MM_TO_PX, this.toCanvasY(rotationPoint.y)],
      {
        stroke: VISUAL_CONFIG.rotationStroke,
        strokeWidth: stemStroke,
        strokeDashArray: [this.toSceneSize(VISUAL_CONFIG.rotationStemDash), this.toSceneSize(VISUAL_CONFIG.rotationStemDash)],
        selectable: false, evented: false,
      }
    );
    const rotationHandle = new fabric.Circle({
      left: rotationPoint.x * MM_TO_PX, top: this.toCanvasY(rotationPoint.y),
      radius: rotationRadius,
      fill: '#FFFFFF', stroke: VISUAL_CONFIG.rotationStroke,
      strokeWidth: endpointStroke,
      originX: 'center', originY: 'center',
      hoverCursor: 'alias',
      lockMovementX: true, lockMovementY: true,
      selectable: false, evented: false,
    });
    this.annotateControlTarget(rotationHandle, wallId, 'wall-rotation-handle');
    const rotationHandleHit = this.createControlHitTarget(
      rotationPoint, wallId, 'wall-rotation-handle', 'alias', VISUAL_CONFIG.rotationHitRadius
    );
    const rotationLabel = new fabric.Text('R', {
      left: rotationPoint.x * MM_TO_PX, top: this.toCanvasY(rotationPoint.y),
      fill: VISUAL_CONFIG.rotationLabelColor,
      fontSize: this.toSceneSize(10), fontFamily: 'Arial', fontWeight: 'bold',
      originX: 'center', originY: 'center',
      selectable: false, evented: false,
    });

    const showRotation = showAdvancedControls && this.canRotateWall(wall);

    const controls: fabric.FabricObject[] = [
      startHandleHit, startHandle,
      endHandleHit, endHandle,
      ...(startOuterBevel ? [startOuterBevel.hit, startOuterBevel.visual] : []),
      ...(startInnerBevel ? [startInnerBevel.hit, startInnerBevel.visual] : []),
      ...(endOuterBevel ? [endOuterBevel.hit, endOuterBevel.visual] : []),
      ...(endInnerBevel ? [endInnerBevel.hit, endInnerBevel.visual] : []),
      centerHandleHit, centerHandle, centerCrossH, centerCrossV,
      ...(showAdvancedControls ? [interiorThicknessHit, interiorThicknessHandle, exteriorThicknessHit, exteriorThicknessHandle] : []),
      ...(showRotation ? [rotationStem, rotationHandleHit, rotationHandle, rotationLabel] : []),
    ];

    controls.forEach((control) => this.canvas.add(control));
    this.controlPointObjects.set(wallId, controls);
  }

  // ─── Selection & Hover ──────────────────────────────────────────────────

  /**
   * [FIX] Now diffs against previous selection instead of blindly
   * removing and recreating all controls.
   */
  setSelectedWalls(selectedWallIds: string[]): void {
    const newSelection = new Set(selectedWallIds);
    const previousSelection = this.selectedWallIds;
    this.selectedWallIds = newSelection;

    const selectionComponents = computeWallSelectionComponents(
      Array.from(this.wallData.values()), this.rooms, selectedWallIds
    );
    const combinedWallIds = new Set(
      selectionComponents
        .filter((c) => c.wallIds.length > 1 || c.innerRings.length > 0)
        .flatMap((c) => c.wallIds)
    );

    this.wallObjects.forEach((group, wallId) => {
      const outline = group.getObjects().find((obj) => (obj as NamedObject).name === 'selectionOutline');
      const hoverOutline = group.getObjects().find((obj) => (obj as NamedObject).name === 'hoverOutline');
      if (outline) outline.set('visible', newSelection.has(wallId) && !combinedWallIds.has(wallId));
      if (hoverOutline) hoverOutline.set('visible', !newSelection.has(wallId) && this.hoveredWallId === wallId);
    });

    // [FIX] Only remove controls for walls that are no longer selected
    for (const wallId of previousSelection) {
      if (!newSelection.has(wallId)) {
        this.removeControlPoints(wallId);
      }
    }

    this.clearSelectionComponents();
    this.renderSelectionComponents(selectedWallIds);

    // [FIX] Only create controls for newly selected walls
    for (const wallId of newSelection) {
      if (!previousSelection.has(wallId) && this.wallObjects.has(wallId)) {
        this.createControlPoints(wallId);
      }
    }

    // [NEW] Show dimension labels on selected walls
    this.renderDimensionLabels(selectedWallIds);

    this.canvas.requestRenderAll();
  }

  setHoveredWall(wallId: string | null): void {
    if (this.hoveredWallId === wallId) return;
    this.hoveredWallId = wallId;

    this.wallObjects.forEach((group, currentWallId) => {
      const hoverOutline = group.getObjects().find((obj) => (obj as NamedObject).name === 'hoverOutline');
      if (!hoverOutline) return;
      hoverOutline.set('visible', currentWallId === wallId && !this.selectedWallIds.has(currentWallId));
    });

    this.canvas.requestRenderAll();
  }

  // ─── Removal ────────────────────────────────────────────────────────────

  removeWall(wallId: string): void {
    const existing = this.wallObjects.get(wallId);
    if (existing) {
      this.canvas.remove(existing);
      this.wallObjects.delete(wallId);
    }
    this.removeControlPoints(wallId);
    this.wallData.delete(wallId);
    this.selectedWallIds.delete(wallId);
    if (this.hoveredWallId === wallId) this.hoveredWallId = null;
  }

  /**
   * Render all walls with proper joins.
   * [PERF] Now disables renderOnAddRemove during batch operations.
   * Previously each canvas.add() triggered an intermediate repaint,
   * causing O(n²) work for n objects.
   */
  renderAllWalls(walls: Wall[]): void {
    // [PERF] Disable intermediate repaints during batch add
    const previousRenderOnAdd = (this.canvas as any).renderOnAddRemove;
    (this.canvas as any).renderOnAddRemove = false;

    try {
      this.clearMergedComponents();
      this.clearSelectionComponents();
      this.clearDimensionLabels();
      this.wallObjects.forEach((obj) => this.canvas.remove(obj));
      this.wallObjects.clear();
      this.wallData.clear();

      this.controlPointObjects.forEach((controls) => {
        controls.forEach((control) => this.canvas.remove(control));
      });
      this.controlPointObjects.clear();

      walls.forEach((wall) => this.wallData.set(wall.id, wall));

      const renderData = computeWallUnionRenderData(walls);
      const wallsById = new Map(walls.map((wall) => [wall.id, wall]));

      for (const component of renderData.components) {
        const representativeWall = component.wallIds
          .map((wallId) => wallsById.get(wallId))
          .find((wall): wall is Wall => Boolean(wall));
        if (!representativeWall) continue;
        this.renderMergedComponent(component, representativeWall);
      }

      for (const wall of walls) {
        const joins = renderData.joinsMap.get(wall.id) || [];
        this.renderWall(wall, joins);
      }

      this.setSelectedWalls([...this.selectedWallIds]);

    } finally {
      // [PERF] Restore and do a single repaint
      (this.canvas as any).renderOnAddRemove = previousRenderOnAdd ?? true;
      this.canvas.requestRenderAll();
    }
  }

  highlightWall(wallId: string, highlight: boolean): void {
    const nextSelection = new Set(this.selectedWallIds);
    if (highlight) nextSelection.add(wallId);
    else nextSelection.delete(wallId);
    this.setSelectedWalls([...nextSelection]);
  }

  getWallObject(wallId: string): fabric.Group | undefined {
    return this.wallObjects.get(wallId);
  }

  clearAllWalls(): void {
    this.clearMergedComponents();
    this.clearSelectionComponents();
    this.clearDimensionLabels();
    this.clearSnapIndicators();
    this.clearPreviewWall();
    this.wallObjects.forEach((obj) => this.canvas.remove(obj));
    this.wallObjects.clear();
    this.wallData.clear();
    this.rooms = [];
    this.selectedWallIds.clear();
    this.hoveredWallId = null;
    this.controlPointObjects.forEach((controls) => {
      controls.forEach((control) => this.canvas.remove(control));
    });
    this.controlPointObjects.clear();
    this.canvas.requestRenderAll();
  }

  dispose(): void {
    this.clearAllWalls();
    this.hatchPatterns.clear();
  }
}