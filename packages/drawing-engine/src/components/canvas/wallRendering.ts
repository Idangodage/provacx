/**
 * Wall Rendering Utilities
 * 
 * Functions for rendering walls on the Fabric.js canvas.
 * Extracted from DrawingCanvas.tsx for better organization.
 */

import * as fabric from 'fabric';

import type { Point2D, Wall2D, DisplayUnit, WallTypeDefinition } from '../../types';
import { getWallTypeById, resolveWallLayers } from '../../utils/wall-types';

import { formatDistance, normalizeHexColor, tintHexColor, withPatternAlpha } from './formatting';
import { PX_TO_MM } from './scale';
import { wallThicknessToCanvasPx } from './spatial-index';

// =============================================================================
// Constants
// =============================================================================

const WALL_DEFAULT_COLOR = '#6b7280';
const WALL_PATTERN_SIZE = 16;
const WALL_JOIN_NODE_TOLERANCE_PX = 0.5;
const WALL_JOIN_COLLINEAR_EPSILON = 0.03;
const WALL_JOIN_PATCH_OVERDRAW_PX = 1.2;
const DIMENSION_OFFSET_SCREEN_PX = 14;
const DIMENSION_CHAIN_EXTRA_OFFSET_SCREEN_PX = 16;
const DIMENSION_TICK_SCREEN_PX = 8;
const DIMENSION_STROKE_SCREEN_PX = 1;
const DIMENSION_TEXT_SCREEN_PX = 11;
const DIMENSION_TEXT_MIN_SCREEN_PX = 9;
const DIMENSION_TEXT_MAX_SCREEN_PX = 14;
const DIMENSION_METRIC_SNAP_MM = 1;
const DIMENSION_FT_SNAP_MM = 3.175;
const wallPatternSourceCache = new Map<string, HTMLCanvasElement>();

function normalize(vector: Point2D): Point2D | null {
    const length = Math.hypot(vector.x, vector.y);
    if (length <= 0.000001) return null;
    return { x: vector.x / length, y: vector.y / length };
}

// =============================================================================
// Types
// =============================================================================

export interface WallRenderOptions {
    selected?: boolean;
    zoom?: number;
    wallLookup?: Map<string, Wall2D>;
    roomPolygons?: Point2D[][];
    wallBoundaryLookup?: Map<string, WallBoundaryPoints>;
}

export interface WallBoundaryPoints {
    interiorStart: Point2D;
    interiorEnd: Point2D;
    exteriorStart: Point2D;
    exteriorEnd: Point2D;
}

interface WallJoinAttachment {
    wall: Wall2D;
    thicknessPx: number;
    joinFill: string | fabric.Pattern;
    polygonPoints: Point2D[] | null;
}

interface WallJoinNode {
    sx: number;
    sy: number;
    count: number;
    attachments: WallJoinAttachment[];
}

// =============================================================================
// Wall Polygon Creation
// =============================================================================

export function createWallPolygonPoints(start: Point2D, end: Point2D, thicknessPx: number): Point2D[] | null {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) return null;

    const half = thicknessPx / 2;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;

    return [
        { x: start.x + nx, y: start.y + ny },
        { x: end.x + nx, y: end.y + ny },
        { x: end.x - nx, y: end.y - ny },
        { x: start.x - nx, y: start.y - ny },
    ];
}

function intersectInfiniteLines(
    originA: Point2D,
    directionA: Point2D,
    originB: Point2D,
    directionB: Point2D
): Point2D | null {
    const det = directionA.x * directionB.y - directionA.y * directionB.x;
    if (Math.abs(det) <= 1e-9) return null;
    const dx = originB.x - originA.x;
    const dy = originB.y - originA.y;
    const t = (dx * directionB.y - dy * directionB.x) / det;
    return {
        x: originA.x + directionA.x * t,
        y: originA.y + directionA.y * t,
    };
}

function clampMiterPoint(
    miterPoint: Point2D | null,
    fallbackPoint: Point2D,
    nodePoint: Point2D,
    maxDistance: number
): Point2D {
    if (!miterPoint) return fallbackPoint;
    const distance = Math.hypot(miterPoint.x - nodePoint.x, miterPoint.y - nodePoint.y);
    if (!Number.isFinite(distance) || distance > maxDistance) return fallbackPoint;
    return miterPoint;
}

function createParallelOffsetWallPolygonPoints(
    wall: Wall2D,
    thicknessPx: number,
    paperToRealRatio: number,
    wallLookup?: Map<string, Wall2D>,
    roomPolygons: Point2D[][] = [],
    boundary?: WallBoundaryPoints
): Point2D[] | null {
    if (boundary) {
        return [
            boundary.interiorStart,
            boundary.interiorEnd,
            boundary.exteriorEnd,
            boundary.exteriorStart,
        ];
    }
    const interior = getMiteredOffsetBoundarySegment(
        wall,
        'interior',
        thicknessPx,
        paperToRealRatio,
        wallLookup,
        roomPolygons
    );
    const exterior = getMiteredOffsetBoundarySegment(
        wall,
        'exterior',
        thicknessPx,
        paperToRealRatio,
        wallLookup,
        roomPolygons
    );
    if (!interior || !exterior) return null;
    return [interior.start, interior.end, exterior.end, exterior.start];
}

function getMiteredOffsetBoundarySegment(
    wall: Wall2D,
    side: 'interior' | 'exterior',
    thicknessPx: number,
    paperToRealRatio: number,
    wallLookup?: Map<string, Wall2D>,
    roomPolygons: Point2D[][] = []
): { start: Point2D; end: Point2D; normal: Point2D } | null {
    const direction = normalize({
        x: wall.end.x - wall.start.x,
        y: wall.end.y - wall.start.y,
    });
    if (!direction) return null;

    const fallbackExteriorNormal = { x: -direction.y, y: direction.x };
    const exteriorNormal = resolveExteriorNormalForWall(wall, roomPolygons, thicknessPx) ?? fallbackExteriorNormal;
    const normal =
        side === 'exterior'
            ? exteriorNormal
            : { x: -exteriorNormal.x, y: -exteriorNormal.y };

    const half = thicknessPx / 2;
    let start = {
        x: wall.start.x + normal.x * half,
        y: wall.start.y + normal.y * half,
    };
    let end = {
        x: wall.end.x + normal.x * half,
        y: wall.end.y + normal.y * half,
    };

    const resolveEndpoint = (
        node: Point2D,
        thisAway: Point2D,
        basePoint: Point2D
    ): Point2D => {
        if (!wallLookup || !wall.connectedWallIds || wall.connectedWallIds.length === 0) {
            return basePoint;
        }

        const neighbors = (wall.connectedWallIds ?? [])
            .map((id) => wallLookup.get(id))
            .filter((neighbor): neighbor is Wall2D => {
                if (!neighbor) return false;
                return isNearPoint(neighbor.start, node) || isNearPoint(neighbor.end, node);
            });
        if (neighbors.length !== 1) {
            return basePoint;
        }

        const neighbor = neighbors[0];
        if (!neighbor) return basePoint;
        const neighborAway = getDirectionFromNode(neighbor, node);
        if (!neighborAway) return basePoint;
        const dot = thisAway.x * neighborAway.x + thisAway.y * neighborAway.y;
        if (Math.abs(dot + 1) <= WALL_JOIN_COLLINEAR_EPSILON || Math.abs(dot - 1) <= 0.02) {
            return basePoint;
        }

        const neighborThicknessPx = wallThicknessToCanvasPx(neighbor.thickness, paperToRealRatio);
        const neighborFallbackExterior = { x: -neighborAway.y, y: neighborAway.x };
        const neighborExteriorNormal =
            resolveExteriorNormalForWall(neighbor, roomPolygons, neighborThicknessPx) ?? neighborFallbackExterior;
        const neighborNormal =
            side === 'exterior'
                ? neighborExteriorNormal
                : { x: -neighborExteriorNormal.x, y: -neighborExteriorNormal.y };
        const neighborBase = {
            x: node.x + neighborNormal.x * (neighborThicknessPx / 2),
            y: node.y + neighborNormal.y * (neighborThicknessPx / 2),
        };
        const intersection = intersectInfiniteLines(basePoint, thisAway, neighborBase, neighborAway);
        const maxMiterDistance = Math.max(thicknessPx, neighborThicknessPx) * 6;
        return clampMiterPoint(intersection, basePoint, node, maxMiterDistance);
    };

    start = resolveEndpoint(wall.start, direction, start);
    end = resolveEndpoint(wall.end, { x: -direction.x, y: -direction.y }, end);

    return { start, end, normal };
}

// =============================================================================
// Pattern Drawing
// =============================================================================

function drawBrickPattern(ctx: CanvasRenderingContext2D, size: number, stroke: string): void {
    const rowHeight = size / 4;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    for (let y = 0; y <= size; y += rowHeight) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
    }
    for (let y = 0; y < size; y += rowHeight) {
        const offset = ((y / rowHeight) % 2) * (size / 4);
        for (let x = offset; x <= size; x += size / 2) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, Math.min(size, y + rowHeight));
            ctx.stroke();
        }
    }
}

function drawPattern(textureId: string, ctx: CanvasRenderingContext2D, size: number, baseColor: string): void {
    ctx.fillStyle = tintHexColor(baseColor, 24);
    ctx.fillRect(0, 0, size, size);
    const stroke = withPatternAlpha(baseColor, 0.55);

    switch (textureId) {
        case 'block-diagonal-crosshatch': {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            for (let i = -size; i <= size * 2; i += 6) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i - size, size);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(i, size);
                ctx.lineTo(i - size, 0);
                ctx.stroke();
            }
            break;
        }
        case 'brick-staggered':
            drawBrickPattern(ctx, size, stroke);
            break;
        case 'concrete-stipple': {
            ctx.fillStyle = withPatternAlpha(baseColor, 0.45);
            for (let y = 2; y < size; y += 4) {
                for (let x = 2; x < size; x += 4) {
                    ctx.beginPath();
                    ctx.arc(x + ((x + y) % 2), y, 0.9, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            break;
        }
        case 'block-diagonal-dots': {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            for (let i = -size; i <= size * 2; i += 7) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i - size, size);
                ctx.stroke();
            }
            ctx.fillStyle = withPatternAlpha(baseColor, 0.42);
            for (let y = 3; y < size; y += 6) {
                for (let x = 3; x < size; x += 6) {
                    ctx.beginPath();
                    ctx.arc(x, y, 0.9, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            break;
        }
        case 'partition-parallel-lines': {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            for (let x = 0; x <= size; x += 4) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, size);
                ctx.stroke();
            }
            break;
        }
        case 'cavity-block-insulation': {
            drawBrickPattern(ctx, size, withPatternAlpha(baseColor, 0.35));
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x <= size; x += 2) {
                const y = size / 2 + (x % 4 === 0 ? -2 : 2);
                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
            break;
        }
        default: {
            ctx.strokeStyle = withPatternAlpha(baseColor, 0.45);
            ctx.lineWidth = 1;
            for (let x = 0; x <= size; x += 5) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, size);
                ctx.stroke();
            }
            break;
        }
    }
}

function getWallPatternSource(textureId: string, baseColor: string): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const safeColor = normalizeHexColor(baseColor, '#9ca3af');
    const key = `${textureId}:${safeColor}`;
    const cached = wallPatternSourceCache.get(key);
    if (cached) return cached;

    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = WALL_PATTERN_SIZE;
    patternCanvas.height = WALL_PATTERN_SIZE;
    const ctx = patternCanvas.getContext('2d');
    if (!ctx) return null;

    drawPattern(textureId, ctx, WALL_PATTERN_SIZE, safeColor);
    wallPatternSourceCache.set(key, patternCanvas);
    return patternCanvas;
}

function resolveWallBaseColor(wall: Wall2D, wallTypeRegistry: WallTypeDefinition[]): string {
    const wallType = getWallTypeById(wall.wallTypeId, wallTypeRegistry);
    const layers = resolveWallLayers(wall, wallTypeRegistry);
    const coreLayer = layers.find((layer) => layer.isCore) ?? layers[0];
    return wall.color ?? coreLayer?.color ?? wallType.coreColor ?? WALL_DEFAULT_COLOR;
}

function createWallFillStyle(
    wall: Wall2D,
    wallTypeRegistry: WallTypeDefinition[],
    patternOrigin?: Point2D
): string | fabric.Pattern {
    const wallType = getWallTypeById(wall.wallTypeId, wallTypeRegistry);
    const baseColor = resolveWallBaseColor(wall, wallTypeRegistry);
    const source = getWallPatternSource(wallType.planTextureId, baseColor);
    if (!source) return baseColor;
    const pattern = new fabric.Pattern({ source, repeat: 'repeat' });
    if (patternOrigin) {
        // Anchor pattern in scene space so adjacent wall overlaps do not reveal square hatch seams.
        pattern.offsetX = -patternOrigin.x;
        pattern.offsetY = -patternOrigin.y;
    }
    return pattern;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function formatSnappedRealWallLength(
    lengthScenePx: number,
    paperToRealRatio: number,
    unit: DisplayUnit
): string {
    const safeRatio = Number.isFinite(paperToRealRatio) && paperToRealRatio > 0 ? paperToRealRatio : 1;
    const rawMm = lengthScenePx * PX_TO_MM * safeRatio;
    const snapMm = unit === 'ft-in' ? DIMENSION_FT_SNAP_MM : DIMENSION_METRIC_SNAP_MM;
    const snappedMm = Math.round(rawMm / snapMm) * snapMm;
    return formatDistance(snappedMm, unit);
}

interface DimensionAnnotationStyle {
    name: string;
    zoom: number;
    lineOffsetScenePx: number;
    stroke: string;
    strokeWidthScenePx: number;
    textFill: string;
    textBackground: string;
    textPrefix?: string;
    normal?: Point2D;
    collisionStepScenePx?: number;
}

function createLinearDimensionAnnotation(
    start: Point2D,
    end: Point2D,
    textValue: string,
    style: DimensionAnnotationStyle
): fabric.Group | null {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) return null;

    const safeZoom = Math.max(style.zoom, 0.01);
    const ux = dx / length;
    const uy = dy / length;
    const fallbackNormal = { x: -uy, y: ux };
    const explicitNormal = style.normal ? normalize(style.normal) : null;
    const normal = explicitNormal ?? fallbackNormal;
    const nx = normal.x;
    const ny = normal.y;

    const offset = style.lineOffsetScenePx;
    const dimStart = {
        x: start.x + nx * offset,
        y: start.y + ny * offset,
    };
    const dimEnd = {
        x: end.x + nx * offset,
        y: end.y + ny * offset,
    };

    const tickHalf = (DIMENSION_TICK_SCREEN_PX / safeZoom) / 2;
    const tickStart = new fabric.Line(
        [
            dimStart.x - nx * tickHalf,
            dimStart.y - ny * tickHalf,
            dimStart.x + nx * tickHalf,
            dimStart.y + ny * tickHalf,
        ],
        {
            stroke: style.stroke,
            strokeWidth: style.strokeWidthScenePx,
            selectable: false,
            evented: false,
            objectCaching: false,
        }
    );
    const tickEnd = new fabric.Line(
        [
            dimEnd.x - nx * tickHalf,
            dimEnd.y - ny * tickHalf,
            dimEnd.x + nx * tickHalf,
            dimEnd.y + ny * tickHalf,
        ],
        {
            stroke: style.stroke,
            strokeWidth: style.strokeWidthScenePx,
            selectable: false,
            evented: false,
            objectCaching: false,
        }
    );

    const dimensionLine = new fabric.Line([dimStart.x, dimStart.y, dimEnd.x, dimEnd.y], {
        stroke: style.stroke,
        strokeWidth: style.strokeWidthScenePx,
        selectable: false,
        evented: false,
        objectCaching: false,
    });

    let textAngle = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (textAngle > 90 || textAngle < -90) {
        textAngle += 180;
    }
    const midX = (dimStart.x + dimEnd.x) / 2;
    const midY = (dimStart.y + dimEnd.y) / 2;
    const screenFont = clamp(
        DIMENSION_TEXT_SCREEN_PX,
        DIMENSION_TEXT_MIN_SCREEN_PX,
        DIMENSION_TEXT_MAX_SCREEN_PX
    );
    const text = new fabric.Text(
        style.textPrefix ? `${style.textPrefix}${textValue}` : textValue,
        {
            left: midX,
            top: midY,
            originX: 'center',
            originY: 'center',
            angle: textAngle,
            fontSize: screenFont / safeZoom,
            fill: style.textFill,
            backgroundColor: style.textBackground,
            selectable: false,
            evented: false,
            objectCaching: false,
        }
    );
    (text as unknown as { name?: string }).name = 'dimension-text';

    const group = new fabric.Group([dimensionLine, tickStart, tickEnd, text], {
        selectable: false,
        evented: false,
        objectCaching: false,
    });
    (group as unknown as { name?: string }).name = style.name;
    (group as unknown as { layerRole?: string }).layerRole = 'dimension';
    (group as unknown as { dimensionNormal?: Point2D }).dimensionNormal = { x: nx, y: ny };
    (group as unknown as { dimensionTangent?: Point2D }).dimensionTangent = { x: ux, y: uy };
    (group as unknown as { dimensionCollisionStep?: number }).dimensionCollisionStep =
        style.collisionStepScenePx ?? 10 / safeZoom;
    return group;
}

function boundsOverlap(
    a: { left: number; top: number; width: number; height: number },
    b: { left: number; top: number; width: number; height: number },
    padding = 2
): boolean {
    const aRight = a.left + a.width;
    const aBottom = a.top + a.height;
    const bRight = b.left + b.width;
    const bBottom = b.top + b.height;
    return (
        a.left < bRight + padding &&
        aRight > b.left - padding &&
        a.top < bBottom + padding &&
        aBottom > b.top - padding
    );
}

function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
    if (polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const pi = polygon[i];
        const pj = polygon[j];
        if (!pi || !pj) continue;
        const intersects =
            (pi.y > point.y) !== (pj.y > point.y) &&
            point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + Number.EPSILON) + pi.x;
        if (intersects) inside = !inside;
    }
    return inside;
}

function countContainingRooms(point: Point2D, roomPolygons: Point2D[][]): number {
    let count = 0;
    roomPolygons.forEach((polygon) => {
        if (isPointInPolygon(point, polygon)) {
            count += 1;
        }
    });
    return count;
}

export function resolveWallDimensionCollisions(objects: fabric.Object[], zoom: number): void {
    const safeZoom = Math.max(zoom, 0.01);
    const placedBounds: Array<{ left: number; top: number; width: number; height: number }> = [];
    const placedLabelBounds: Array<{ left: number; top: number; width: number; height: number }> = [];

    objects.forEach((object) => {
        object.setCoords();
        let bounds = object.getBoundingRect();
        const name = (object as unknown as { name?: string }).name;
        const lockWallGap = name === 'wall-dimension' || name === 'wall-chain-dimension';
        if (lockWallGap) {
            // Keep a single fixed offset from wall. Resolve only label overlap by sliding text along dimension axis.
            const group = object as fabric.Group;
            const textObject = group
                .getObjects()
                .find((candidate) => (candidate as unknown as { name?: string }).name === 'dimension-text');
            if (textObject) {
                const tangent = (group as unknown as { dimensionTangent?: Point2D }).dimensionTangent;
                const step =
                    (group as unknown as { dimensionCollisionStep?: number }).dimensionCollisionStep ??
                    10 / safeZoom;
                const baseLeft = textObject.left ?? 0;
                const baseTop = textObject.top ?? 0;
                let attempts = 0;

                textObject.setCoords();
                let textBounds = textObject.getBoundingRect();
                while (
                    attempts < 8 &&
                    placedLabelBounds.some((placed) => boundsOverlap(textBounds, placed, 1.5))
                ) {
                    const direction = attempts % 2 === 0 ? 1 : -1;
                    const hop = Math.floor(attempts / 2) + 1;
                    const distance = hop * step * direction;
                    textObject.set({
                        left: baseLeft + (tangent?.x ?? 1) * distance,
                        top: baseTop + (tangent?.y ?? 0) * distance,
                    });
                    textObject.setCoords();
                    group.setCoords();
                    textBounds = textObject.getBoundingRect();
                    attempts += 1;
                }
                placedLabelBounds.push(textBounds);
            }

            bounds = object.getBoundingRect();
            placedBounds.push(bounds);
            return;
        }
        const normal = (object as unknown as { dimensionNormal?: Point2D }).dimensionNormal;
        const step =
            (object as unknown as { dimensionCollisionStep?: number }).dimensionCollisionStep ??
            10 / safeZoom;
        let attempts = 0;

        while (
            attempts < 6 &&
            placedBounds.some((placed) => boundsOverlap(bounds, placed, 1.5))
        ) {
            const dx = (normal?.x ?? 0) * step;
            const dy = (normal?.y ?? -1) * step;
            object.set({
                left: (object.left ?? 0) + dx,
                top: (object.top ?? 0) + dy,
            });
            object.setCoords();
            bounds = object.getBoundingRect();
            attempts += 1;
        }

        placedBounds.push(bounds);
    });
}

// =============================================================================
// Wall Render Objects
// =============================================================================

export function createWallRenderObjects(
    wall: Wall2D,
    unit: DisplayUnit,
    paperToRealRatio: number,
    wallTypeRegistry: WallTypeDefinition[],
    options: WallRenderOptions = {}
): {
    wallBody: fabric.Object;
    dimensionLabel: fabric.Object;
    overrideMarker: fabric.Object | null;
} {
    const safeZoom = Math.max(options.zoom ?? 1, 0.01);
    const thicknessPx = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio);
    const boundary = options.wallBoundaryLookup?.get(wall.id);
    const polygonPoints = createParallelOffsetWallPolygonPoints(
        wall,
        thicknessPx,
        paperToRealRatio,
        options.wallLookup,
        options.roomPolygons ?? [],
        boundary
    );
    const isSelected = options.selected === true;

    const patternOrigin = { x: 0, y: 0 };
    const fillStyle = createWallFillStyle(wall, wallTypeRegistry, patternOrigin);

    let wallBody: fabric.Object;
    if (polygonPoints) {
        const fillPolygon = new fabric.Polygon(polygonPoints, {
            fill: fillStyle,
            stroke: undefined,
            strokeWidth: 0,
            objectCaching: false,
            selectable: false,
            evented: false,
        });

        const interiorStart = polygonPoints[0];
        const interiorEnd = polygonPoints[1];
        const exteriorEnd = polygonPoints[2];
        const exteriorStart = polygonPoints[3];
        const boundaryColor = isSelected ? '#2563eb' : '#475569';
        const boundaryWidth = isSelected ? 2 : 1;
        const interiorBoundary = new fabric.Line(
            [
                interiorStart?.x ?? wall.start.x,
                interiorStart?.y ?? wall.start.y,
                interiorEnd?.x ?? wall.end.x,
                interiorEnd?.y ?? wall.end.y,
            ],
            {
                stroke: boundaryColor,
                strokeWidth: boundaryWidth,
                selectable: false,
                evented: false,
                objectCaching: false,
            }
        );
        const exteriorBoundary = new fabric.Line(
            [
                exteriorStart?.x ?? wall.start.x,
                exteriorStart?.y ?? wall.start.y,
                exteriorEnd?.x ?? wall.end.x,
                exteriorEnd?.y ?? wall.end.y,
            ],
            {
                stroke: boundaryColor,
                strokeWidth: boundaryWidth,
                selectable: false,
                evented: false,
                objectCaching: false,
            }
        );
        wallBody = new fabric.Group([fillPolygon, interiorBoundary, exteriorBoundary], {
            selectable: true,
            evented: true,
            objectCaching: false,
        });
    } else {
        wallBody = new fabric.Circle({
            left: wall.start.x - thicknessPx / 2,
            top: wall.start.y - thicknessPx / 2,
            radius: thicknessPx / 2,
            fill: fillStyle,
            stroke: isSelected ? '#2563eb' : '#475569',
            strokeWidth: isSelected ? 2 : 1,
            objectCaching: false,
            selectable: true,
            evented: true,
        });
    }
    (wallBody as unknown as { name?: string }).name = 'wall-render';
    (wallBody as unknown as { wallId?: string }).wallId = wall.id;

    const midX = (wall.start.x + wall.end.x) / 2;
    const midY = (wall.start.y + wall.end.y) / 2;
    const exteriorNormal = resolveExteriorNormalForWall(
        wall,
        options.roomPolygons,
        thicknessPx / 2 + DIMENSION_OFFSET_SCREEN_PX / safeZoom
    );
    const interiorReference = getInteriorDimensionReferenceSegment(
        wall,
        options.wallLookup,
        paperToRealRatio,
        options.roomPolygons ?? [],
        boundary
    );
    const interiorLength = interiorReference.length;
    const dimensionLabel =
        createLinearDimensionAnnotation(
            interiorReference.start,
            interiorReference.end,
            formatSnappedRealWallLength(interiorLength, paperToRealRatio, unit),
            {
                name: 'wall-dimension',
                zoom: safeZoom,
                lineOffsetScenePx: thicknessPx + DIMENSION_OFFSET_SCREEN_PX / safeZoom,
                stroke: isSelected ? '#1d4ed8' : '#334155',
                strokeWidthScenePx: DIMENSION_STROKE_SCREEN_PX / safeZoom,
                textFill: isSelected ? '#0b3b9e' : '#0f172a',
                textBackground: isSelected ? 'rgba(219,234,254,0.94)' : 'rgba(255,255,255,0.78)',
                normal: exteriorNormal ?? undefined,
                collisionStepScenePx: 10 / safeZoom,
            }
        ) ??
        new fabric.Text(formatSnappedRealWallLength(interiorLength, paperToRealRatio, unit), {
            left: midX,
            top: midY,
            originX: 'center',
            originY: 'center',
            fontSize: DIMENSION_TEXT_SCREEN_PX / safeZoom,
            fill: isSelected ? '#0b3b9e' : '#111827',
            backgroundColor: isSelected ? 'rgba(219,234,254,0.92)' : 'rgba(255,255,255,0.75)',
            selectable: false,
            evented: false,
            name: 'wall-dimension',
        });

    let overrideMarker: fabric.Object | null = null;
    if (wall.isWallTypeOverride) {
        const markerRadius = 7;
        const markerCircle = new fabric.Circle({
            radius: markerRadius,
            fill: 'rgba(234, 88, 12, 0.92)',
            stroke: '#c2410c',
            strokeWidth: 1,
            originX: 'center',
            originY: 'center',
            left: 0,
            top: 0,
        });
        const markerText = new fabric.Text('!', {
            textAlign: 'center',
            originX: 'center',
            originY: 'center',
            fill: '#fff',
            fontSize: 10,
            fontWeight: 'bold',
            left: 0,
            top: 0.5,
        });
        overrideMarker = new fabric.Group([markerCircle, markerText], {
            left: midX + 10,
            top: midY - 10,
            originX: 'center',
            originY: 'center',
            selectable: false,
            evented: false,
            objectCaching: false,
        });
        (overrideMarker as unknown as { name?: string }).name = 'wall-override-indicator';
        (overrideMarker as unknown as { wallId?: string }).wallId = wall.id;
    }

    return { wallBody, dimensionLabel, overrideMarker };
}

function resolveExteriorNormalForWall(
    wall: Wall2D,
    roomPolygons: Point2D[][] = [],
    probeDistancePx = 10
): Point2D | null {
    const direction = normalize({
        x: wall.end.x - wall.start.x,
        y: wall.end.y - wall.start.y,
    });
    if (!direction) return null;
    const right = { x: -direction.y, y: direction.x };
    const left = { x: direction.y, y: -direction.x };

    if (roomPolygons.length > 0) {
        const midpoint = {
            x: (wall.start.x + wall.end.x) / 2,
            y: (wall.start.y + wall.end.y) / 2,
        };
        const safeProbe = Math.max(probeDistancePx, 2);
        const leftProbe = {
            x: midpoint.x + left.x * safeProbe,
            y: midpoint.y + left.y * safeProbe,
        };
        const rightProbe = {
            x: midpoint.x + right.x * safeProbe,
            y: midpoint.y + right.y * safeProbe,
        };
        const leftRoomHits = countContainingRooms(leftProbe, roomPolygons);
        const rightRoomHits = countContainingRooms(rightProbe, roomPolygons);

        // Dimension should sit on exterior side, opposite to the room interior.
        if (leftRoomHits !== rightRoomHits) {
            return leftRoomHits > rightRoomHits ? right : left;
        }
    }

    if (wall.exteriorNormal) {
        const normalized = normalize(wall.exteriorNormal);
        if (normalized) return normalized;
    }
    if (wall.exteriorSide === 'right') return right;
    if (wall.exteriorSide === 'left') return left;
    if (wall.interiorSide === 'right') return left;
    if (wall.interiorSide === 'left') return right;
    return left;
}

function getInteriorDimensionReferenceSegment(
    wall: Wall2D,
    wallLookup: Map<string, Wall2D> | undefined,
    paperToRealRatio: number,
    roomPolygons: Point2D[][] = [],
    boundary?: WallBoundaryPoints
): { start: Point2D; end: Point2D; length: number } {
    if (boundary) {
        const length = Math.max(
            Math.hypot(
                boundary.interiorEnd.x - boundary.interiorStart.x,
                boundary.interiorEnd.y - boundary.interiorStart.y
            ),
            0
        );
        return {
            start: boundary.interiorStart,
            end: boundary.interiorEnd,
            length,
        };
    }
    const thicknessPx = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio);
    const interior = getMiteredOffsetBoundarySegment(
        wall,
        'interior',
        thicknessPx,
        paperToRealRatio,
        wallLookup,
        roomPolygons
    );
    const start = interior?.start ?? wall.start;
    const end = interior?.end ?? wall.end;
    const length = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 0);
    return { start, end, length };
}

function toJoinNodeKey(point: Point2D, tolerance = WALL_JOIN_NODE_TOLERANCE_PX): string {
    const safeTolerance = Math.max(tolerance, 0.0001);
    const gx = Math.round(point.x / safeTolerance);
    const gy = Math.round(point.y / safeTolerance);
    return `${gx}:${gy}`;
}

function isNearPoint(a: Point2D, b: Point2D, tolerance = WALL_JOIN_NODE_TOLERANCE_PX): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
}

function getDirectionFromNode(wall: Wall2D, node: Point2D): Point2D | null {
    const fromStart = isNearPoint(wall.start, node);
    const fromEnd = isNearPoint(wall.end, node);

    let dx = 0;
    let dy = 0;
    if (fromStart || !fromEnd) {
        dx = wall.end.x - wall.start.x;
        dy = wall.end.y - wall.start.y;
    } else {
        dx = wall.start.x - wall.end.x;
        dy = wall.start.y - wall.end.y;
    }

    const length = Math.hypot(dx, dy);
    if (length <= 0.0001) return null;
    return { x: dx / length, y: dy / length };
}

interface WallEndpointBoundarySeed {
    wallId: string;
    endpoint: 'start' | 'end';
    nodePoint: Point2D;
    dirAway: Point2D;
    halfThickness: number;
    interiorNormal: Point2D;
    exteriorNormal: Point2D;
}

function assignBoundaryPoint(
    lookup: Map<string, WallBoundaryPoints>,
    endpoint: WallEndpointBoundarySeed,
    side: 'interior' | 'exterior',
    point: Point2D
): void {
    const boundary = lookup.get(endpoint.wallId);
    if (!boundary) return;
    if (endpoint.endpoint === 'start') {
        if (side === 'interior') {
            boundary.interiorStart = point;
        } else {
            boundary.exteriorStart = point;
        }
        return;
    }

    if (side === 'interior') {
        boundary.interiorEnd = point;
    } else {
        boundary.exteriorEnd = point;
    }
}

function getOffsetPointForSide(
    endpoint: WallEndpointBoundarySeed,
    side: 'interior' | 'exterior'
): Point2D {
    const normal = side === 'interior' ? endpoint.interiorNormal : endpoint.exteriorNormal;
    return {
        x: endpoint.nodePoint.x + normal.x * endpoint.halfThickness,
        y: endpoint.nodePoint.y + normal.y * endpoint.halfThickness,
    };
}

function resolveCornerPointFromEndpoints(
    endpointA: WallEndpointBoundarySeed,
    endpointB: WallEndpointBoundarySeed,
    side: 'interior' | 'exterior'
): Point2D {
    const baseA = getOffsetPointForSide(endpointA, side);
    const baseB = getOffsetPointForSide(endpointB, side);
    const fallbackPoint = {
        x: (baseA.x + baseB.x) / 2,
        y: (baseA.y + baseB.y) / 2,
    };
    const intersection = intersectInfiniteLines(baseA, endpointA.dirAway, baseB, endpointB.dirAway);
    const maxDistance = Math.max(endpointA.halfThickness, endpointB.halfThickness) * 8;
    if (!intersection) return fallbackPoint;
    const nodePoint = endpointA.nodePoint;
    const distance = Math.hypot(intersection.x - nodePoint.x, intersection.y - nodePoint.y);
    if (!Number.isFinite(distance) || distance > maxDistance) {
        return fallbackPoint;
    }
    return intersection;
}

export function buildWallBoundaryLookup(
    walls: Wall2D[],
    paperToRealRatio: number,
    roomPolygons: Point2D[][] = []
): Map<string, WallBoundaryPoints> {
    const wallLookup = new Map(walls.map((wall) => [wall.id, wall]));
    const boundaryLookup = new Map<string, WallBoundaryPoints>();
    const endpointsByNode = new Map<string, WallEndpointBoundarySeed[]>();

    walls.forEach((wall) => {
        const direction = normalize({ x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y });
        if (!direction) return;
        const thicknessPx = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio);
        const halfThickness = thicknessPx / 2;
        const fallbackExteriorNormal = { x: -direction.y, y: direction.x };
        const exteriorNormal = resolveExteriorNormalForWall(wall, roomPolygons, thicknessPx) ?? fallbackExteriorNormal;
        const interiorNormal = { x: -exteriorNormal.x, y: -exteriorNormal.y };

        const interiorStart = {
            x: wall.start.x + interiorNormal.x * halfThickness,
            y: wall.start.y + interiorNormal.y * halfThickness,
        };
        const interiorEnd = {
            x: wall.end.x + interiorNormal.x * halfThickness,
            y: wall.end.y + interiorNormal.y * halfThickness,
        };
        const exteriorStart = {
            x: wall.start.x + exteriorNormal.x * halfThickness,
            y: wall.start.y + exteriorNormal.y * halfThickness,
        };
        const exteriorEnd = {
            x: wall.end.x + exteriorNormal.x * halfThickness,
            y: wall.end.y + exteriorNormal.y * halfThickness,
        };
        boundaryLookup.set(wall.id, { interiorStart, interiorEnd, exteriorStart, exteriorEnd });

        const startNodeKey = toJoinNodeKey(wall.start);
        const endNodeKey = toJoinNodeKey(wall.end);

        const startEndpoints = endpointsByNode.get(startNodeKey) ?? [];
        startEndpoints.push({
            wallId: wall.id,
            endpoint: 'start',
            nodePoint: wall.start,
            dirAway: direction,
            halfThickness,
            interiorNormal,
            exteriorNormal,
        });
        endpointsByNode.set(startNodeKey, startEndpoints);

        const endEndpoints = endpointsByNode.get(endNodeKey) ?? [];
        endEndpoints.push({
            wallId: wall.id,
            endpoint: 'end',
            nodePoint: wall.end,
            dirAway: { x: -direction.x, y: -direction.y },
            halfThickness,
            interiorNormal,
            exteriorNormal,
        });
        endpointsByNode.set(endNodeKey, endEndpoints);
    });

    endpointsByNode.forEach((endpoints) => {
        if (endpoints.length !== 2) return;
        const first = endpoints[0];
        const second = endpoints[1];
        if (!first || !second) return;
        if (first.wallId === second.wallId) return;

        const interiorCorner = resolveCornerPointFromEndpoints(first, second, 'interior');
        const exteriorCorner = resolveCornerPointFromEndpoints(first, second, 'exterior');
        assignBoundaryPoint(boundaryLookup, first, 'interior', interiorCorner);
        assignBoundaryPoint(boundaryLookup, second, 'interior', interiorCorner);
        assignBoundaryPoint(boundaryLookup, first, 'exterior', exteriorCorner);
        assignBoundaryPoint(boundaryLookup, second, 'exterior', exteriorCorner);
    });

    // Keep existing component-aware fallback for isolated/complex nodes.
    boundaryLookup.forEach((boundary, wallId) => {
        const wall = wallLookup.get(wallId);
        if (!wall) return;
        if (!wall.connectedWallIds || wall.connectedWallIds.length === 0) return;
        const thicknessPx = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio);
        const fallbackInterior = getMiteredOffsetBoundarySegment(
            wall,
            'interior',
            thicknessPx,
            paperToRealRatio,
            wallLookup,
            roomPolygons
        );
        const fallbackExterior = getMiteredOffsetBoundarySegment(
            wall,
            'exterior',
            thicknessPx,
            paperToRealRatio,
            wallLookup,
            roomPolygons
        );
        if (!fallbackInterior || !fallbackExterior) return;
        if (!Number.isFinite(boundary.interiorStart.x) || !Number.isFinite(boundary.interiorStart.y)) {
            boundary.interiorStart = fallbackInterior.start;
        }
        if (!Number.isFinite(boundary.interiorEnd.x) || !Number.isFinite(boundary.interiorEnd.y)) {
            boundary.interiorEnd = fallbackInterior.end;
        }
        if (!Number.isFinite(boundary.exteriorStart.x) || !Number.isFinite(boundary.exteriorStart.y)) {
            boundary.exteriorStart = fallbackExterior.start;
        }
        if (!Number.isFinite(boundary.exteriorEnd.x) || !Number.isFinite(boundary.exteriorEnd.y)) {
            boundary.exteriorEnd = fallbackExterior.end;
        }
    });

    return boundaryLookup;
}

function shouldSkipJoinCap(nodePoint: Point2D, attachments: WallJoinAttachment[]): boolean {
    if (attachments.length !== 2) return false;
    const first = attachments[0];
    const second = attachments[1];
    if (!first || !second) return false;

    const d1 = getDirectionFromNode(first.wall, nodePoint);
    const d2 = getDirectionFromNode(second.wall, nodePoint);
    if (!d1 || !d2) return false;

    const dot = d1.x * d2.x + d1.y * d2.y;
    const nearlyCollinear = Math.abs(dot + 1) <= WALL_JOIN_COLLINEAR_EPSILON;
    const similarThickness = Math.abs(first.thicknessPx - second.thicknessPx) <= 0.25;
    return nearlyCollinear && similarThickness;
}

function polygonSignedArea(points: Point2D[]): number {
    if (points.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (!a || !b) continue;
        area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
}

function ensureCounterClockwise(points: Point2D[]): Point2D[] {
    return polygonSignedArea(points) >= 0 ? points : [...points].reverse();
}

function lineIntersectionForClip(
    s: Point2D,
    e: Point2D,
    a: Point2D,
    b: Point2D
): Point2D {
    const x1 = s.x;
    const y1 = s.y;
    const x2 = e.x;
    const y2 = e.y;
    const x3 = a.x;
    const y3 = a.y;
    const x4 = b.x;
    const y4 = b.y;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) <= 1e-9) {
        return { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
    }
    const px =
        ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) /
        denom;
    const py =
        ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) /
        denom;
    return { x: px, y: py };
}

function isInsideClipEdge(point: Point2D, a: Point2D, b: Point2D): boolean {
    // Left side of directed edge for CCW clip polygon.
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= -1e-9;
}

function intersectConvexPolygons(subjectPolygon: Point2D[], clipPolygon: Point2D[]): Point2D[] {
    if (subjectPolygon.length < 3 || clipPolygon.length < 3) return [];
    let output = ensureCounterClockwise(subjectPolygon);
    const clip = ensureCounterClockwise(clipPolygon);

    for (let i = 0; i < clip.length; i += 1) {
        const clipA = clip[i];
        const clipB = clip[(i + 1) % clip.length];
        if (!clipA || !clipB) continue;
        const input = output;
        output = [];
        if (input.length === 0) break;

        let s = input[input.length - 1];
        if (!s) continue;
        input.forEach((e) => {
            if (!e) return;
            const eInside = isInsideClipEdge(e, clipA, clipB);
            const sInside = isInsideClipEdge(s!, clipA, clipB);
            if (eInside) {
                if (!sInside) {
                    output.push(lineIntersectionForClip(s!, e, clipA, clipB));
                }
                output.push(e);
            } else if (sInside) {
                output.push(lineIntersectionForClip(s!, e, clipA, clipB));
            }
            s = e;
        });
    }

    if (output.length < 3) return [];
    if (Math.abs(polygonSignedArea(output)) <= 0.01) return [];
    return output;
}

function getJoinPatchPointsFromWallOverlap(
    attachments: WallJoinAttachment[]
): Point2D[] | null {
    if (attachments.length !== 2) return null;
    const first = attachments[0];
    const second = attachments[1];
    if (!first?.polygonPoints || !second?.polygonPoints) return null;
    const intersection = intersectConvexPolygons(first.polygonPoints, second.polygonPoints);
    return intersection.length >= 3 ? intersection : null;
}

function getNodeSideCorners(
    attachment: WallJoinAttachment,
    nodePoint: Point2D
): { interior: Point2D; exterior: Point2D } | null {
    const polygon = attachment.polygonPoints;
    if (!polygon || polygon.length < 4) return null;

    const startDistance = Math.hypot(attachment.wall.start.x - nodePoint.x, attachment.wall.start.y - nodePoint.y);
    const endDistance = Math.hypot(attachment.wall.end.x - nodePoint.x, attachment.wall.end.y - nodePoint.y);
    const atStart = startDistance <= endDistance;

    if (atStart) {
        const interior = polygon[0];
        const exterior = polygon[3];
        if (!interior || !exterior) return null;
        return { interior, exterior };
    }

    const interior = polygon[1];
    const exterior = polygon[2];
    if (!interior || !exterior) return null;
    return { interior, exterior };
}

function getDegreeTwoJoinPatchPoints(
    nodePoint: Point2D,
    attachments: WallJoinAttachment[]
): Point2D[] {
    if (attachments.length !== 2) return [];
    const firstCorners = getNodeSideCorners(attachments[0]!, nodePoint);
    const secondCorners = getNodeSideCorners(attachments[1]!, nodePoint);
    if (!firstCorners || !secondCorners) return [];

    const points = [
        firstCorners.interior,
        secondCorners.interior,
        secondCorners.exterior,
        firstCorners.exterior,
    ];

    const uniquePoints: Point2D[] = [];
    points.forEach((point) => {
        const exists = uniquePoints.some(
            (existing) => Math.hypot(existing.x - point.x, existing.y - point.y) <= 0.02
        );
        if (!exists) {
            uniquePoints.push(point);
        }
    });
    if (uniquePoints.length < 3) return [];

    const ordered = uniquePoints.sort((a, b) => {
        const angleA = Math.atan2(a.y - nodePoint.y, a.x - nodePoint.x);
        const angleB = Math.atan2(b.y - nodePoint.y, b.x - nodePoint.x);
        return angleA - angleB;
    });

    if (Math.abs(polygonSignedArea(ordered)) <= 0.0025) return [];
    return ordered;
}

function getJoinPatchPoints(nodePoint: Point2D, attachments: WallJoinAttachment[]): Point2D[] {
    const radialPoints: Point2D[] = [];

    attachments.forEach((attachment) => {
        const direction = getDirectionFromNode(attachment.wall, nodePoint);
        if (!direction) return;
        const half = attachment.thicknessPx / 2 + WALL_JOIN_PATCH_OVERDRAW_PX;
        const normal = { x: -direction.y, y: direction.x };
        radialPoints.push(
            { x: nodePoint.x + normal.x * half, y: nodePoint.y + normal.y * half },
            { x: nodePoint.x - normal.x * half, y: nodePoint.y - normal.y * half }
        );
    });

    if (radialPoints.length < 3) return [];

    const uniquePoints: Point2D[] = [];
    radialPoints.forEach((point) => {
        const exists = uniquePoints.some(
            (existing) => Math.hypot(existing.x - point.x, existing.y - point.y) <= 0.2
        );
        if (!exists) {
            uniquePoints.push(point);
        }
    });
    if (uniquePoints.length < 3) return [];

    return uniquePoints.sort((a, b) => {
        const angleA = Math.atan2(a.y - nodePoint.y, a.x - nodePoint.x);
        const angleB = Math.atan2(b.y - nodePoint.y, b.x - nodePoint.x);
        return angleA - angleB;
    });
}

export function createWallJoinRenderObjects(
    walls: Wall2D[],
    paperToRealRatio: number,
    wallTypeRegistry: WallTypeDefinition[],
    _selectedWallIds: Set<string> = new Set(),
    wallBoundaryLookup?: Map<string, WallBoundaryPoints>
): fabric.Object[] {
    if (walls.length === 0) return [];

    const wallLookup = new Map(walls.map((wall) => [wall.id, wall]));
    const boundaryLookup = wallBoundaryLookup ?? buildWallBoundaryLookup(walls, paperToRealRatio, []);
    const joinNodes = new Map<string, WallJoinNode>();
    walls.forEach((wall) => {
        const thicknessPx = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio);
        const boundary = boundaryLookup.get(wall.id);
        const polygonPoints = createParallelOffsetWallPolygonPoints(
            wall,
            thicknessPx,
            paperToRealRatio,
            wallLookup,
            [],
            boundary
        );
        const attachment: WallJoinAttachment = {
            wall,
            thicknessPx,
            joinFill: createWallFillStyle(wall, wallTypeRegistry, { x: 0, y: 0 }),
            polygonPoints,
        };

        [wall.start, wall.end].forEach((point) => {
            const key = toJoinNodeKey(point);
            const current = joinNodes.get(key);
            if (current) {
                current.sx += point.x;
                current.sy += point.y;
                current.count += 1;
                current.attachments.push(attachment);
                return;
            }
            joinNodes.set(key, {
                sx: point.x,
                sy: point.y,
                count: 1,
                attachments: [attachment],
            });
        });
    });

    const objects: fabric.Object[] = [];
    joinNodes.forEach((node) => {
        if (node.attachments.length < 2 || node.count <= 0) return;

        const point = { x: node.sx / node.count, y: node.sy / node.count };
        if (shouldSkipJoinCap(point, node.attachments)) return;

        const dominantAttachment =
            node.attachments.reduce((best, current) =>
                current.thicknessPx > best.thicknessPx ? current : best
            );
        const patchPoints = node.attachments.length === 2
            ? getDegreeTwoJoinPatchPoints(point, node.attachments)
            : (
                getJoinPatchPointsFromWallOverlap(node.attachments) ??
                getJoinPatchPoints(point, node.attachments)
            );
        if (patchPoints.length < 3) return;

        const joinCap = new fabric.Polygon(patchPoints, {
            fill: dominantAttachment.joinFill,
            stroke: undefined,
            strokeWidth: 0,
            strokeLineJoin: 'miter',
            strokeLineCap: 'butt',
            selectable: false,
            evented: false,
            objectCaching: false,
        });
        (joinCap as unknown as { name?: string }).name = 'wall-join-render';
        objects.push(joinCap);
    });

    return objects;
}

export function createWallOrientationIndicatorObjects(
    walls: Wall2D[],
    zoom: number
): fabric.Object[] {
    const safeZoom = Math.max(zoom, 0.01);
    const bodyLength = 12 / safeZoom;
    const headLength = 4 / safeZoom;
    const halfHeadWidth = 2.5 / safeZoom;

    const indicators: fabric.Object[] = [];
    walls.forEach((wall) => {
        const normal = resolveExteriorNormalForWall(wall);
        if (!normal) return;
        const midpoint = {
            x: (wall.start.x + wall.end.x) / 2,
            y: (wall.start.y + wall.end.y) / 2,
        };
        const start = midpoint;
        const end = {
            x: midpoint.x + normal.x * bodyLength,
            y: midpoint.y + normal.y * bodyLength,
        };
        const tangent = { x: -normal.y, y: normal.x };
        const headLeft = {
            x: end.x - normal.x * headLength + tangent.x * halfHeadWidth,
            y: end.y - normal.y * headLength + tangent.y * halfHeadWidth,
        };
        const headRight = {
            x: end.x - normal.x * headLength - tangent.x * halfHeadWidth,
            y: end.y - normal.y * headLength - tangent.y * halfHeadWidth,
        };

        const color = wall.orientationSource === 'manual' ? '#c2410c' : '#0f766e';
        const stem = new fabric.Line([start.x, start.y, end.x, end.y], {
            stroke: color,
            strokeWidth: Math.max(1 / safeZoom, 0.8 / safeZoom),
            selectable: false,
            evented: false,
            objectCaching: false,
            opacity: 0.85,
        });
        const headA = new fabric.Line([end.x, end.y, headLeft.x, headLeft.y], {
            stroke: color,
            strokeWidth: Math.max(1 / safeZoom, 0.8 / safeZoom),
            selectable: false,
            evented: false,
            objectCaching: false,
            opacity: 0.85,
        });
        const headB = new fabric.Line([end.x, end.y, headRight.x, headRight.y], {
            stroke: color,
            strokeWidth: Math.max(1 / safeZoom, 0.8 / safeZoom),
            selectable: false,
            evented: false,
            objectCaching: false,
            opacity: 0.85,
        });
        const group = new fabric.Group([stem, headA, headB], {
            selectable: false,
            evented: false,
            objectCaching: false,
        });
        (group as unknown as { name?: string }).name = 'wall-orientation-indicator';
        (group as unknown as { layerRole?: string }).layerRole = 'dimension';
        indicators.push(group);
    });

    return indicators;
}

interface VertexNodeAccumulator {
    sx: number;
    sy: number;
    count: number;
    wallIds: Set<string>;
    degree: number;
}

export function createWallVertexMarkerObjects(
    walls: Wall2D[],
    zoom: number,
    selectedWallIds: Set<string> = new Set()
): fabric.Rect[] {
    if (walls.length === 0) return [];

    const safeZoom = Math.max(zoom, 0.01);
    const nodes = new Map<string, VertexNodeAccumulator>();
    walls.forEach((wall) => {
        [wall.start, wall.end].forEach((point) => {
            const key = toJoinNodeKey(point);
            const current = nodes.get(key);
            if (current) {
                current.sx += point.x;
                current.sy += point.y;
                current.count += 1;
                current.wallIds.add(wall.id);
                current.degree += 1;
                return;
            }
            nodes.set(key, {
                sx: point.x,
                sy: point.y,
                count: 1,
                wallIds: new Set([wall.id]),
                degree: 1,
            });
        });
    });

    const markerSize = 7 / safeZoom;
    const markers: fabric.Rect[] = [];
    nodes.forEach((node) => {
        const point = { x: node.sx / node.count, y: node.sy / node.count };
        const connectedIds = Array.from(node.wallIds);
        const hasSelected = connectedIds.some((wallId) => selectedWallIds.has(wallId));
        const isJunction = node.degree > 2;

        const marker = new fabric.Rect({
            left: point.x - markerSize / 2,
            top: point.y - markerSize / 2,
            width: markerSize,
            height: markerSize,
            fill: isJunction ? 'rgba(254,243,199,0.92)' : 'rgba(248,250,252,0.92)',
            stroke: hasSelected ? '#2563eb' : '#64748b',
            strokeWidth: Math.max(1 / safeZoom, 0.6 / safeZoom),
            selectable: true,
            evented: true,
            objectCaching: false,
            hasControls: false,
            hasBorders: false,
            hoverCursor: 'move',
        });
        (marker as unknown as { name?: string }).name = 'wall-vertex-marker';
        (marker as unknown as { wallIds?: string[] }).wallIds = connectedIds;
        (marker as unknown as { nodePoint?: Point2D }).nodePoint = point;
        (marker as unknown as { layerRole?: string }).layerRole = 'dimension';

        marker.on('mouseover', () => {
            marker.set({
                fill: isJunction ? 'rgba(253,230,138,0.98)' : 'rgba(219,234,254,0.98)',
                strokeWidth: Math.max(1.5 / safeZoom, 1 / safeZoom),
            });
        });
        marker.on('mouseout', () => {
            marker.set({
                fill: isJunction ? 'rgba(254,243,199,0.92)' : 'rgba(248,250,252,0.92)',
                strokeWidth: Math.max(1 / safeZoom, 0.6 / safeZoom),
            });
        });

        markers.push(marker);
    });

    return markers;
}

interface ChainEdge {
    wall: Wall2D;
    fromKey: string;
    toKey: string;
}

interface ChainNode {
    point: Point2D;
    edgeIndices: number[];
}

function getStraightChainDirectionScore(edges: ChainEdge[]): number {
    if (edges.length < 2) return 1;
    const first = edges[0];
    if (!first) return 0;
    const refDx = first.wall.end.x - first.wall.start.x;
    const refDy = first.wall.end.y - first.wall.start.y;
    const refLength = Math.hypot(refDx, refDy);
    if (refLength <= 0.0001) return 0;
    const refUx = refDx / refLength;
    const refUy = refDy / refLength;

    let minAbsDot = 1;
    edges.forEach((edge) => {
        const dx = edge.wall.end.x - edge.wall.start.x;
        const dy = edge.wall.end.y - edge.wall.start.y;
        const length = Math.hypot(dx, dy);
        if (length <= 0.0001) return;
        const ux = dx / length;
        const uy = dy / length;
        const absDot = Math.abs(refUx * ux + refUy * uy);
        minAbsDot = Math.min(minAbsDot, absDot);
    });
    return minAbsDot;
}

export function createWallChainDimensionObjects(
    walls: Wall2D[],
    unit: DisplayUnit,
    paperToRealRatio: number,
    zoom: number,
    roomPolygons: Point2D[][] = []
): fabric.Object[] {
    if (walls.length < 2) return [];

    const safeZoom = Math.max(zoom, 0.01);
    const nodes = new Map<string, ChainNode>();
    const edges: ChainEdge[] = walls.map((wall) => {
        const fromKey = toJoinNodeKey(wall.start);
        const toKey = toJoinNodeKey(wall.end);
        const fromNode = nodes.get(fromKey) ?? { point: wall.start, edgeIndices: [] };
        nodes.set(fromKey, fromNode);
        const toNode = nodes.get(toKey) ?? { point: wall.end, edgeIndices: [] };
        nodes.set(toKey, toNode);
        return { wall, fromKey, toKey };
    });

    edges.forEach((edge, index) => {
        nodes.get(edge.fromKey)?.edgeIndices.push(index);
        nodes.get(edge.toKey)?.edgeIndices.push(index);
    });

    const visited = new Set<number>();
    const output: fabric.Object[] = [];

    for (let i = 0; i < edges.length; i += 1) {
        if (visited.has(i)) continue;
        const stack = [i];
        const component: number[] = [];
        while (stack.length > 0) {
            const edgeIndex = stack.pop();
            if (edgeIndex === undefined || visited.has(edgeIndex)) continue;
            visited.add(edgeIndex);
            component.push(edgeIndex);
            const edge = edges[edgeIndex];
            if (!edge) continue;
            [edge.fromKey, edge.toKey].forEach((nodeKey) => {
                const node = nodes.get(nodeKey);
                if (!node) return;
                node.edgeIndices.forEach((neighborIndex) => {
                    if (!visited.has(neighborIndex)) {
                        stack.push(neighborIndex);
                    }
                });
            });
        }

        if (component.length < 2) continue;
        const componentEdges = component.map((edgeIndex) => edges[edgeIndex]).filter(Boolean) as ChainEdge[];
        const straightScore = getStraightChainDirectionScore(componentEdges);
        if (straightScore < 0.995) continue;

        const degreeMap = new Map<string, number>();
        componentEdges.forEach((edge) => {
            degreeMap.set(edge.fromKey, (degreeMap.get(edge.fromKey) ?? 0) + 1);
            degreeMap.set(edge.toKey, (degreeMap.get(edge.toKey) ?? 0) + 1);
        });
        const endpoints = Array.from(degreeMap.entries())
            .filter(([, degree]) => degree === 1)
            .map(([key]) => key);
        if (endpoints.length !== 2) continue;

        const startNode = nodes.get(endpoints[0] ?? '');
        const endNode = nodes.get(endpoints[1] ?? '');
        if (!startNode || !endNode) continue;

        const maxThicknessPx = componentEdges.reduce(
            (maxThickness, edge) =>
                Math.max(maxThickness, wallThicknessToCanvasPx(edge.wall.thickness, paperToRealRatio)),
            0
        );
        const referenceWall = componentEdges[0]?.wall;
        const referenceNormal = referenceWall
            ? resolveExteriorNormalForWall(
                referenceWall,
                roomPolygons,
                maxThicknessPx / 2 + DIMENSION_OFFSET_SCREEN_PX / safeZoom
            )
            : null;
        const chainStartPoint = startNode.point;
        const chainEndPoint = endNode.point;
        const chainInteriorLength = Math.hypot(
            chainEndPoint.x - chainStartPoint.x,
            chainEndPoint.y - chainStartPoint.y
        );
        const annotation = createLinearDimensionAnnotation(
            chainStartPoint,
            chainEndPoint,
            formatSnappedRealWallLength(chainInteriorLength, paperToRealRatio, unit),
            {
                name: 'wall-chain-dimension',
                zoom: safeZoom,
                lineOffsetScenePx:
                    maxThicknessPx +
                    (DIMENSION_OFFSET_SCREEN_PX + DIMENSION_CHAIN_EXTRA_OFFSET_SCREEN_PX) / safeZoom,
                stroke: '#0f172a',
                strokeWidthScenePx: DIMENSION_STROKE_SCREEN_PX / safeZoom,
                textFill: '#0f172a',
                textBackground: 'rgba(255,255,255,0.82)',
                textPrefix: 'TOTAL ',
                normal: referenceNormal ?? undefined,
                collisionStepScenePx: 12 / safeZoom,
            }
        );
        if (annotation) {
            output.push(annotation);
        }
    }

    return output;
}

// =============================================================================
// Wall Handles
// =============================================================================

const HANDLE_HIT_RADIUS = 7;

export function createWallHandles(wall: Wall2D, zoom: number): fabric.Circle[] {
    const radius = Math.max(HANDLE_HIT_RADIUS / Math.max(zoom, 0.01), 3);
    const midpoint = {
        x: (wall.start.x + wall.end.x) / 2,
        y: (wall.start.y + wall.end.y) / 2,
    };
    return [
        createWallHandleCircle(wall.id, 'start', wall.start, radius, '#2563eb'),
        createWallHandleCircle(wall.id, 'end', wall.end, radius, '#2563eb'),
        createWallHandleCircle(wall.id, 'mid', midpoint, radius, '#f59e0b'),
    ];
}

function createWallHandleCircle(
    wallId: string,
    handleType: 'start' | 'end' | 'mid',
    point: Point2D,
    radius: number,
    color: string
): fabric.Circle {
    const handle = new fabric.Circle({
        left: point.x - radius,
        top: point.y - radius,
        radius,
        fill: color,
        stroke: '#ffffff',
        strokeWidth: Math.max(radius * 0.18, 1),
        selectable: true,
        evented: true,
        hasControls: false,
        hasBorders: false,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        objectCaching: false,
        hoverCursor: 'grab',
    });
    (handle as unknown as { name?: string }).name = 'wall-handle';
    (handle as unknown as { wallId?: string }).wallId = wallId;
    (handle as unknown as { handleType?: string }).handleType = handleType;
    return handle;
}

// =============================================================================
// Canvas Clearing Functions
// =============================================================================

export function clearRenderedWalls(canvas: fabric.Canvas): void {
    const wallObjects = canvas
        .getObjects()
        .filter((obj) => {
            const name = (obj as unknown as { name?: string }).name;
            return (
                name === 'wall-render' ||
                name === 'wall-join-render' ||
                name === 'wall-dimension' ||
                name === 'wall-chain-dimension' ||
                name === 'wall-vertex-marker' ||
                name === 'wall-orientation-indicator' ||
                name === 'wall-override-indicator'
            );
        });
    wallObjects.forEach((obj) => canvas.remove(obj));
}

export function clearWallHandles(canvas: fabric.Canvas): void {
    const handles = canvas
        .getObjects()
        .filter((obj) => (obj as unknown as { name?: string }).name === 'wall-handle');
    handles.forEach((obj) => canvas.remove(obj));
}

export function clearDrawingPreview(canvas: fabric.Canvas, shouldRender = true): void {
    const previews = canvas
        .getObjects()
        .filter((obj) => (obj as unknown as { name?: string }).name === 'drawing-preview');
    previews.forEach((obj) => canvas.remove(obj));
    if (shouldRender) {
        canvas.requestRenderAll();
    }
}

export function clearSnapHighlight(canvas: fabric.Canvas, shouldRender = true): void {
    const highlights = canvas
        .getObjects()
        .filter((obj) => (obj as unknown as { name?: string }).name === 'wall-snap-highlight');
    highlights.forEach((obj) => canvas.remove(obj));
    if (shouldRender) {
        canvas.requestRenderAll();
    }
}

const WALL_RUBBER_BAND_PREVIEW_NAME = 'wall-rubber-band-preview';
const WALL_RUBBER_BAND_PREVIEW_BODY_NAME = 'wall-rubber-band-preview-body';
const WALL_RUBBER_BAND_PREVIEW_LABEL_NAME = 'wall-rubber-band-preview-label';
const WALL_RUBBER_BAND_PREVIEW_TICK_START_NAME = 'wall-rubber-band-preview-tick-start';
const WALL_RUBBER_BAND_PREVIEW_TICK_END_NAME = 'wall-rubber-band-preview-tick-end';

interface WallRubberBandPreviewContext {
    walls?: Wall2D[];
    roomPolygons?: Point2D[][];
}

function getWallRubberBandPreview(canvas: fabric.Canvas): fabric.Line | null {
    const object = canvas
        .getObjects()
        .find((obj) => (obj as unknown as { name?: string }).name === WALL_RUBBER_BAND_PREVIEW_NAME);
    return (object as fabric.Line | undefined) ?? null;
}

function getWallRubberBandPreviewBody(canvas: fabric.Canvas): fabric.Polygon | null {
    const object = canvas
        .getObjects()
        .find((obj) => (obj as unknown as { name?: string }).name === WALL_RUBBER_BAND_PREVIEW_BODY_NAME);
    return (object as fabric.Polygon | undefined) ?? null;
}

function getWallRubberBandPreviewLabel(canvas: fabric.Canvas): fabric.Text | null {
    const object = canvas
        .getObjects()
        .find((obj) => (obj as unknown as { name?: string }).name === WALL_RUBBER_BAND_PREVIEW_LABEL_NAME);
    return (object as fabric.Text | undefined) ?? null;
}

function getWallRubberBandPreviewTickStart(canvas: fabric.Canvas): fabric.Line | null {
    const object = canvas
        .getObjects()
        .find((obj) => (obj as unknown as { name?: string }).name === WALL_RUBBER_BAND_PREVIEW_TICK_START_NAME);
    return (object as fabric.Line | undefined) ?? null;
}

function getWallRubberBandPreviewTickEnd(canvas: fabric.Canvas): fabric.Line | null {
    const object = canvas
        .getObjects()
        .find((obj) => (obj as unknown as { name?: string }).name === WALL_RUBBER_BAND_PREVIEW_TICK_END_NAME);
    return (object as fabric.Line | undefined) ?? null;
}

export function renderWallRubberBandPreview(
    canvas: fabric.Canvas,
    anchor: Point2D,
    cursor: Point2D,
    thicknessMm: number,
    unit: DisplayUnit,
    paperToRealRatio: number,
    activeWallTypeId: string,
    wallTypeRegistry: WallTypeDefinition[],
    interiorSideHint: 'left' | 'right' | null,
    zoom: number,
    shouldRender = true,
    previewContext?: WallRubberBandPreviewContext
): void {
    const safeZoom = Math.max(zoom, 0.01);
    const previewThicknessPx = wallThicknessToCanvasPx(thicknessMm, paperToRealRatio);
    const interiorSide = interiorSideHint ?? 'right';
    const previewWalls = previewContext?.walls ?? [];
    const roomPolygons = previewContext?.roomPolygons ?? [];
    const previewConnectedWallIds = previewWalls
        .filter((wall) => isNearPoint(wall.start, anchor) || isNearPoint(wall.end, anchor))
        .map((wall) => wall.id);
    const previewWall: Wall2D = {
        id: 'wall-rubber-band-preview',
        start: anchor,
        end: cursor,
        thickness: thicknessMm,
        height: 3000,
        wallType: 'interior',
        wallTypeId: activeWallTypeId,
        openings: [],
        connectedWallIds: previewConnectedWallIds,
        interiorSide,
        exteriorSide: interiorSide === 'right' ? 'left' : 'right',
    };
    const wallsForPreview = [...previewWalls, previewWall];
    const previewWallLookup = new Map(wallsForPreview.map((wall) => [wall.id, wall]));
    const previewBoundaryLookup = buildWallBoundaryLookup(wallsForPreview, paperToRealRatio, roomPolygons);
    const previewBoundary = previewBoundaryLookup.get(previewWall.id);
    const previewPolygonPoints = createParallelOffsetWallPolygonPoints(
        previewWall,
        previewThicknessPx,
        paperToRealRatio,
        previewWallLookup,
        roomPolygons,
        previewBoundary
    );
    const interiorReference = getInteriorDimensionReferenceSegment(
        previewWall,
        previewWallLookup,
        paperToRealRatio,
        roomPolygons,
        previewBoundary
    );

    let body = getWallRubberBandPreviewBody(canvas);
    if (previewPolygonPoints) {
        const previewFill = createWallFillStyle(
            previewWall,
            wallTypeRegistry,
            {
                x: Math.min(anchor.x, cursor.x) - previewThicknessPx / 2,
                y: Math.min(anchor.y, cursor.y) - previewThicknessPx / 2,
            }
        );
        const styleKey = `${activeWallTypeId}:${Math.round(thicknessMm)}`;

        if (!body) {
            body = new fabric.Polygon(previewPolygonPoints, {
                fill: previewFill,
                stroke: '#5f7088',
                strokeWidth: Math.max(1.2 / safeZoom, 0.8),
                selectable: false,
                evented: false,
                objectCaching: false,
                opacity: 0.78,
            });
            (body as unknown as { name?: string }).name = WALL_RUBBER_BAND_PREVIEW_BODY_NAME;
            (body as unknown as { styleKey?: string }).styleKey = styleKey;
            canvas.add(body);
        } else {
            body.set({
                strokeWidth: Math.max(1.2 / safeZoom, 0.8),
                opacity: 0.78,
                visible: true,
            });
            (body as unknown as { points: Point2D[] }).points = previewPolygonPoints;
            const bodyMeta = body as unknown as { styleKey?: string };
            if (bodyMeta.styleKey !== styleKey) {
                body.set({ fill: previewFill });
                bodyMeta.styleKey = styleKey;
            }
            body.setCoords();
        }
    } else if (body) {
        body.set({ visible: false });
    }

    let line = getWallRubberBandPreview(canvas);

    if (!line) {
        line = new fabric.Line([anchor.x, anchor.y, cursor.x, cursor.y], {
            stroke: '#2563eb',
            strokeWidth: Math.max(1.8 / safeZoom, 1),
            strokeDashArray: [8 / safeZoom, 6 / safeZoom],
            selectable: false,
            evented: false,
            objectCaching: false,
        });
        (line as unknown as { name?: string }).name = WALL_RUBBER_BAND_PREVIEW_NAME;
        canvas.add(line);
    } else {
        line.set({
            x1: anchor.x,
            y1: anchor.y,
            x2: cursor.x,
            y2: cursor.y,
            strokeWidth: Math.max(1.8 / safeZoom, 1),
            strokeDashArray: [8 / safeZoom, 6 / safeZoom],
            visible: true,
        });
        line.setCoords();
    }

    const dimensionStart = interiorReference.start;
    const dimensionEnd = interiorReference.end;
    const dimensionDx = dimensionEnd.x - dimensionStart.x;
    const dimensionDy = dimensionEnd.y - dimensionStart.y;
    const dimensionLength = Math.hypot(dimensionDx, dimensionDy);
    const midX = (dimensionStart.x + dimensionEnd.x) / 2;
    const midY = (dimensionStart.y + dimensionEnd.y) / 2;
    const ux = dimensionLength > 0.001 ? dimensionDx / dimensionLength : 0;
    const uy = dimensionLength > 0.001 ? dimensionDy / dimensionLength : 0;
    const fallbackInteriorNormal =
        interiorSide === 'right'
            ? { x: -uy, y: ux }
            : { x: uy, y: -ux };
    const resolvedExteriorNormal =
        resolveExteriorNormalForWall(
            previewWall,
            roomPolygons,
            previewThicknessPx / 2 + DIMENSION_OFFSET_SCREEN_PX / safeZoom
        ) ?? {
            x: -fallbackInteriorNormal.x,
            y: -fallbackInteriorNormal.y,
        };
    const nx = resolvedExteriorNormal.x;
    const ny = resolvedExteriorNormal.y;
    let angleDeg = (Math.atan2(dimensionDy, dimensionDx) * 180) / Math.PI;
    if (angleDeg > 90 || angleDeg < -90) {
        angleDeg += 180;
    }

    let tickStart = getWallRubberBandPreviewTickStart(canvas);
    let tickEnd = getWallRubberBandPreviewTickEnd(canvas);
    if (dimensionLength > 0.001) {
        const dimensionOffset = previewThicknessPx + DIMENSION_OFFSET_SCREEN_PX / safeZoom;
        const dimLineStart = {
            x: dimensionStart.x + nx * dimensionOffset,
            y: dimensionStart.y + ny * dimensionOffset,
        };
        const dimLineEnd = {
            x: dimensionEnd.x + nx * dimensionOffset,
            y: dimensionEnd.y + ny * dimensionOffset,
        };
        const tickHalf = (DIMENSION_TICK_SCREEN_PX / safeZoom) / 2;
        const tickStartCoords: [number, number, number, number] = [
            dimLineStart.x - nx * tickHalf,
            dimLineStart.y - ny * tickHalf,
            dimLineStart.x + nx * tickHalf,
            dimLineStart.y + ny * tickHalf,
        ];
        const tickEndCoords: [number, number, number, number] = [
            dimLineEnd.x - nx * tickHalf,
            dimLineEnd.y - ny * tickHalf,
            dimLineEnd.x + nx * tickHalf,
            dimLineEnd.y + ny * tickHalf,
        ];

        if (!tickStart) {
            tickStart = new fabric.Line(tickStartCoords, {
                stroke: '#2563eb',
                strokeWidth: DIMENSION_STROKE_SCREEN_PX / safeZoom,
                selectable: false,
                evented: false,
                objectCaching: false,
            });
            (tickStart as unknown as { name?: string }).name = WALL_RUBBER_BAND_PREVIEW_TICK_START_NAME;
            canvas.add(tickStart);
        } else {
            tickStart.set({
                x1: tickStartCoords[0],
                y1: tickStartCoords[1],
                x2: tickStartCoords[2],
                y2: tickStartCoords[3],
                strokeWidth: DIMENSION_STROKE_SCREEN_PX / safeZoom,
                visible: true,
            });
            tickStart.setCoords();
        }

        if (!tickEnd) {
            tickEnd = new fabric.Line(tickEndCoords, {
                stroke: '#2563eb',
                strokeWidth: DIMENSION_STROKE_SCREEN_PX / safeZoom,
                selectable: false,
                evented: false,
                objectCaching: false,
            });
            (tickEnd as unknown as { name?: string }).name = WALL_RUBBER_BAND_PREVIEW_TICK_END_NAME;
            canvas.add(tickEnd);
        } else {
            tickEnd.set({
                x1: tickEndCoords[0],
                y1: tickEndCoords[1],
                x2: tickEndCoords[2],
                y2: tickEndCoords[3],
                strokeWidth: DIMENSION_STROKE_SCREEN_PX / safeZoom,
                visible: true,
            });
            tickEnd.setCoords();
        }
    } else {
        if (tickStart) {
            tickStart.set({ visible: false });
        }
        if (tickEnd) {
            tickEnd.set({ visible: false });
        }
    }

    let label = getWallRubberBandPreviewLabel(canvas);
    if (dimensionLength > 0.001) {
        const labelText = formatSnappedRealWallLength(interiorReference.length, paperToRealRatio, unit);
        const labelOffset = previewThicknessPx + DIMENSION_OFFSET_SCREEN_PX / safeZoom;
        if (!label) {
            label = new fabric.Text(labelText, {
                left: midX + nx * labelOffset,
                top: midY + ny * labelOffset,
                originX: 'center',
                originY: 'center',
                angle: angleDeg,
                fontSize: DIMENSION_TEXT_SCREEN_PX / safeZoom,
                fill: '#0f3ebf',
                backgroundColor: 'rgba(255,255,255,0.8)',
                selectable: false,
                evented: false,
                objectCaching: false,
            });
            (label as unknown as { name?: string }).name = WALL_RUBBER_BAND_PREVIEW_LABEL_NAME;
            canvas.add(label);
        } else {
            label.set({
                text: labelText,
                left: midX + nx * labelOffset,
                top: midY + ny * labelOffset,
                angle: angleDeg,
                fontSize: DIMENSION_TEXT_SCREEN_PX / safeZoom,
                visible: true,
            });
            label.setCoords();
        }
    } else if (label) {
        label.set({ visible: false });
    }

    const canvasWithBring = canvas as unknown as { bringObjectToFront?: (obj: fabric.Object) => void };
    if (body) {
        canvasWithBring.bringObjectToFront?.(body);
    }
    canvasWithBring.bringObjectToFront?.(line);
    if (tickStart) {
        canvasWithBring.bringObjectToFront?.(tickStart);
    }
    if (tickEnd) {
        canvasWithBring.bringObjectToFront?.(tickEnd);
    }
    if (label) {
        canvasWithBring.bringObjectToFront?.(label);
    }

    if (shouldRender) {
        canvas.requestRenderAll();
    }
}

export function clearWallRubberBandPreview(canvas: fabric.Canvas, shouldRender = true): void {
    const line = getWallRubberBandPreview(canvas);
    const body = getWallRubberBandPreviewBody(canvas);
    const label = getWallRubberBandPreviewLabel(canvas);
    const tickStart = getWallRubberBandPreviewTickStart(canvas);
    const tickEnd = getWallRubberBandPreviewTickEnd(canvas);
    if (line) {
        canvas.remove(line);
    }
    if (body) {
        canvas.remove(body);
    }
    if (label) {
        canvas.remove(label);
    }
    if (tickStart) {
        canvas.remove(tickStart);
    }
    if (tickEnd) {
        canvas.remove(tickEnd);
    }
    if (shouldRender) {
        canvas.requestRenderAll();
    }
}

export function renderSnapHighlight(
    canvas: fabric.Canvas,
    point: Point2D,
    zoom: number,
    shouldRender = true
): void {
    const safeZoom = Math.max(zoom, 0.01);
    const radius = Math.max(3 / safeZoom, 1.5);
    let highlight = canvas
        .getObjects()
        .find((obj) => (obj as unknown as { name?: string }).name === 'wall-snap-highlight') as fabric.Circle | undefined;

    if (!highlight) {
        highlight = new fabric.Circle({
            left: point.x - radius,
            top: point.y - radius,
            radius,
            fill: 'rgba(76, 175, 80, 0.45)',
            stroke: '#2e7d32',
            strokeWidth: 1 / safeZoom,
            selectable: false,
            evented: false,
            name: 'wall-snap-highlight',
        });
        canvas.add(highlight);
    } else {
        highlight.set({
            left: point.x - radius,
            top: point.y - radius,
            radius,
            strokeWidth: 1 / safeZoom,
            visible: true,
        });
        highlight.setCoords();
    }
    const canvasWithBring = canvas as unknown as { bringObjectToFront?: (obj: fabric.Object) => void };
    canvasWithBring.bringObjectToFront?.(highlight);
    if (shouldRender) {
        canvas.requestRenderAll();
    }
}

export function bringTransientOverlaysToFront(canvas: fabric.Canvas): void {
    const transientObjects = canvas.getObjects().filter((obj) => {
        const name = (obj as unknown as { name?: string }).name;
        return name === 'drawing-preview' || name === 'wall-snap-highlight';
    });
    const canvasWithBring = canvas as unknown as { bringObjectToFront?: (obj: fabric.Object) => void };
    transientObjects.forEach((obj) => {
        if (canvasWithBring.bringObjectToFront) {
            canvasWithBring.bringObjectToFront(obj);
        }
    });
}
