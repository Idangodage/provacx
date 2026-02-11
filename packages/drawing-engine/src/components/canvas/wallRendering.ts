/**
 * Wall Rendering Utilities
 * 
 * Functions for rendering walls on the Fabric.js canvas.
 * Extracted from DrawingCanvas.tsx for better organization.
 */

import * as fabric from 'fabric';

import type { Point2D, Wall2D, DisplayUnit, WallTypeDefinition } from '../../types';
import { getWallTypeById, resolveWallLayers } from '../../utils/wall-types';

import { formatRealWallLength, normalizeHexColor, tintHexColor, withPatternAlpha } from './formatting';
import { wallThicknessToCanvasPx } from './spatial-index';

// =============================================================================
// Constants
// =============================================================================

const WALL_DEFAULT_COLOR = '#6b7280';
const WALL_PATTERN_SIZE = 16;
const wallPatternSourceCache = new Map<string, HTMLCanvasElement>();

// =============================================================================
// Types
// =============================================================================

export interface WallRenderOptions {
    selected?: boolean;
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
    const thicknessPx = wallThicknessToCanvasPx(wall.thickness);
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

    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = Math.hypot(dx, dy);
    const midX = (wall.start.x + wall.end.x) / 2;
    const midY = (wall.start.y + wall.end.y) / 2;
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg > 90 || angleDeg < -90) {
        angleDeg += 180;
    }

    const dimensionLabel = new fabric.Text(formatRealWallLength(length, paperToRealRatio, unit), {
        left: midX,
        top: midY,
        originX: 'center',
        originY: 'center',
        angle: angleDeg,
        fontSize: 11,
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
                name === 'wall-dimension' ||
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

export function renderWallRubberBandPreview(
    canvas: fabric.Canvas,
    anchor: Point2D,
    cursor: Point2D,
    thicknessMm: number,
    unit: DisplayUnit,
    paperToRealRatio: number,
    activeWallTypeId: string,
    wallTypeRegistry: WallTypeDefinition[],
    zoom: number,
    shouldRender = true
): void {
    const safeZoom = Math.max(zoom, 0.01);
    const previewThicknessPx = wallThicknessToCanvasPx(thicknessMm);
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
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg > 90 || angleDeg < -90) {
        angleDeg += 180;
    }

    let label = getWallRubberBandPreviewLabel(canvas);
    if (length > 0.001) {
        const labelText = formatRealWallLength(length, paperToRealRatio, unit);
        if (!label) {
            label = new fabric.Text(labelText, {
                left: midX,
                top: midY,
                originX: 'center',
                originY: 'center',
                angle: angleDeg,
                fontSize: 10,
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
                left: midX,
                top: midY,
                angle: angleDeg,
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
    if (line) {
        canvas.remove(line);
    }
    if (body) {
        canvas.remove(body);
    }
    if (label) {
        canvas.remove(label);
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
