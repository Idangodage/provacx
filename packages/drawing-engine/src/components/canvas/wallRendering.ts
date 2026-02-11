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
}

interface WallJoinAttachment {
    wall: Wall2D;
    thicknessPx: number;
    fillStyle: string | fabric.Pattern;
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

function createWallFillStyle(wall: Wall2D, wallTypeRegistry: WallTypeDefinition[]): string | fabric.Pattern {
    const wallType = getWallTypeById(wall.wallTypeId, wallTypeRegistry);
    const layers = resolveWallLayers(wall, wallTypeRegistry);
    const coreLayer = layers.find((layer) => layer.isCore) ?? layers[0];
    const baseColor = wall.color ?? coreLayer?.color ?? wallType.coreColor ?? WALL_DEFAULT_COLOR;
    const source = getWallPatternSource(wallType.planTextureId, baseColor);
    if (!source) return baseColor;
    return new fabric.Pattern({ source, repeat: 'repeat' });
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

    const group = new fabric.Group([dimensionLine, tickStart, tickEnd, text], {
        selectable: false,
        evented: false,
        objectCaching: false,
    });
    (group as unknown as { name?: string }).name = style.name;
    (group as unknown as { layerRole?: string }).layerRole = 'dimension';
    (group as unknown as { dimensionNormal?: Point2D }).dimensionNormal = { x: nx, y: ny };
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

export function resolveWallDimensionCollisions(objects: fabric.Object[], zoom: number): void {
    const safeZoom = Math.max(zoom, 0.01);
    const placedBounds: Array<{ left: number; top: number; width: number; height: number }> = [];

    objects.forEach((object) => {
        object.setCoords();
        let bounds = object.getBoundingRect();
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
    const polygonPoints = createWallPolygonPoints(wall.start, wall.end, thicknessPx);
    const isSelected = options.selected === true;
    const fillStyle = createWallFillStyle(wall, wallTypeRegistry);

    let wallBody: fabric.Object;
    if (polygonPoints) {
        wallBody = new fabric.Polygon(polygonPoints, {
            fill: fillStyle,
            stroke: isSelected ? '#2563eb' : '#475569',
            strokeWidth: isSelected ? 2 : 1,
            objectCaching: false,
            selectable: true,
            evented: true,
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

    const interiorLength = estimateInteriorSegmentLengthScenePx(
        wall,
        options.wallLookup,
        paperToRealRatio
    );
    const midX = (wall.start.x + wall.end.x) / 2;
    const midY = (wall.start.y + wall.end.y) / 2;
    const exteriorNormal = resolveExteriorNormalForWall(wall);
    const dimensionLabel =
        createLinearDimensionAnnotation(
            wall.start,
            wall.end,
            formatSnappedRealWallLength(interiorLength, paperToRealRatio, unit),
            {
                name: 'wall-dimension',
                zoom: safeZoom,
                lineOffsetScenePx: thicknessPx / 2 + DIMENSION_OFFSET_SCREEN_PX / safeZoom,
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

function resolveExteriorNormalForWall(wall: Wall2D): Point2D | null {
    const direction = normalize({
        x: wall.end.x - wall.start.x,
        y: wall.end.y - wall.start.y,
    });
    if (!direction) return null;
    const right = { x: -direction.y, y: direction.x };
    const left = { x: direction.y, y: -direction.x };

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

function estimateInteriorSegmentLengthScenePx(
    wall: Wall2D,
    wallLookup: Map<string, Wall2D> | undefined,
    paperToRealRatio: number
): number {
    const baseLength = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (baseLength <= 0.001 || !wallLookup || !wall.connectedWallIds || wall.connectedWallIds.length === 0) {
        return baseLength;
    }

    const thisThicknessPx = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio);
    const endpointTrim = (endpoint: Point2D) => {
        let trim = 0;
        wall.connectedWallIds?.forEach((neighborId) => {
            const neighbor = wallLookup.get(neighborId);
            if (!neighbor) return;
            const sharesEndpoint =
                Math.hypot(neighbor.start.x - endpoint.x, neighbor.start.y - endpoint.y) <= WALL_JOIN_NODE_TOLERANCE_PX ||
                Math.hypot(neighbor.end.x - endpoint.x, neighbor.end.y - endpoint.y) <= WALL_JOIN_NODE_TOLERANCE_PX;
            if (!sharesEndpoint) return;
            const neighborThicknessPx = wallThicknessToCanvasPx(neighbor.thickness, paperToRealRatio);
            trim = Math.max(trim, Math.min(thisThicknessPx, neighborThicknessPx) / 2);
        });
        return trim;
    };

    const startTrim = endpointTrim(wall.start);
    const endTrim = endpointTrim(wall.end);
    return Math.max(baseLength - startTrim - endTrim, 0);
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

export function createWallJoinRenderObjects(
    walls: Wall2D[],
    paperToRealRatio: number,
    wallTypeRegistry: WallTypeDefinition[],
    selectedWallIds: Set<string> = new Set()
): fabric.Object[] {
    if (walls.length === 0) return [];

    const joinNodes = new Map<string, WallJoinNode>();
    walls.forEach((wall) => {
        const thicknessPx = wallThicknessToCanvasPx(wall.thickness, paperToRealRatio);
        const fillStyle = createWallFillStyle(wall, wallTypeRegistry);
        const attachment: WallJoinAttachment = { wall, thicknessPx, fillStyle };

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
        const hasSelectedWall = node.attachments.some(({ wall }) => selectedWallIds.has(wall.id));
        const capRadius = Math.max(dominantAttachment.thicknessPx / 2 + 0.6, 0.75);
        const joinCap = new fabric.Circle({
            left: point.x - capRadius,
            top: point.y - capRadius,
            radius: capRadius,
            fill: dominantAttachment.fillStyle,
            stroke: hasSelectedWall ? '#2563eb' : '#475569',
            strokeWidth: hasSelectedWall ? 2 : 1,
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
    zoom: number
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

        const totalLength = componentEdges.reduce((sum, edge) => {
            const dx = edge.wall.end.x - edge.wall.start.x;
            const dy = edge.wall.end.y - edge.wall.start.y;
            return sum + Math.hypot(dx, dy);
        }, 0);
        const maxThicknessPx = componentEdges.reduce(
            (maxThickness, edge) =>
                Math.max(maxThickness, wallThicknessToCanvasPx(edge.wall.thickness, paperToRealRatio)),
            0
        );
        const referenceWall = componentEdges[0]?.wall;
        const referenceNormal = referenceWall ? resolveExteriorNormalForWall(referenceWall) : null;
        const annotation = createLinearDimensionAnnotation(
            startNode.point,
            endNode.point,
            formatSnappedRealWallLength(totalLength, paperToRealRatio, unit),
            {
                name: 'wall-chain-dimension',
                zoom: safeZoom,
                lineOffsetScenePx:
                    maxThicknessPx / 2 +
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
    shouldRender = true
): void {
    const safeZoom = Math.max(zoom, 0.01);
    const previewThicknessPx = wallThicknessToCanvasPx(thicknessMm, paperToRealRatio);
    const previewPolygonPoints = createWallPolygonPoints(anchor, cursor, previewThicknessPx);

    let body = getWallRubberBandPreviewBody(canvas);
    if (previewPolygonPoints) {
        const previewFill = createWallFillStyle(
            {
                id: 'wall-rubber-band-preview',
                start: anchor,
                end: cursor,
                thickness: thicknessMm,
                height: 3000,
                wallType: 'interior',
                wallTypeId: activeWallTypeId,
                openings: [],
            },
            wallTypeRegistry
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

    const dx = cursor.x - anchor.x;
    const dy = cursor.y - anchor.y;
    const length = Math.hypot(dx, dy);
    const midX = (anchor.x + cursor.x) / 2;
    const midY = (anchor.y + cursor.y) / 2;
    const ux = length > 0.001 ? dx / length : 0;
    const uy = length > 0.001 ? dy / length : 0;
    const interiorSide = interiorSideHint ?? 'right';
    const interiorNormal =
        interiorSide === 'right'
            ? { x: -uy, y: ux }
            : { x: uy, y: -ux };
    const exteriorNormal = { x: -interiorNormal.x, y: -interiorNormal.y };
    const nx = exteriorNormal.x;
    const ny = exteriorNormal.y;
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg > 90 || angleDeg < -90) {
        angleDeg += 180;
    }

    let tickStart = getWallRubberBandPreviewTickStart(canvas);
    let tickEnd = getWallRubberBandPreviewTickEnd(canvas);
    if (length > 0.001) {
        const tickHalf = (DIMENSION_TICK_SCREEN_PX / safeZoom) / 2;
        const tickStartCoords: [number, number, number, number] = [
            anchor.x - nx * tickHalf,
            anchor.y - ny * tickHalf,
            anchor.x + nx * tickHalf,
            anchor.y + ny * tickHalf,
        ];
        const tickEndCoords: [number, number, number, number] = [
            cursor.x - nx * tickHalf,
            cursor.y - ny * tickHalf,
            cursor.x + nx * tickHalf,
            cursor.y + ny * tickHalf,
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
    if (length > 0.001) {
        const labelText = formatSnappedRealWallLength(length, paperToRealRatio, unit);
        if (!label) {
            label = new fabric.Text(labelText, {
                left: midX + nx * (previewThicknessPx / 2 + DIMENSION_OFFSET_SCREEN_PX / safeZoom),
                top: midY + ny * (previewThicknessPx / 2 + DIMENSION_OFFSET_SCREEN_PX / safeZoom),
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
                left: midX + nx * (previewThicknessPx / 2 + DIMENSION_OFFSET_SCREEN_PX / safeZoom),
                top: midY + ny * (previewThicknessPx / 2 + DIMENSION_OFFSET_SCREEN_PX / safeZoom),
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
