/**
 * Room Rendering Utilities
 *
 * Functions for rendering rooms on the Fabric.js canvas.
 */

import * as fabric from 'fabric';

import type { Point2D, Room2D, DisplayUnit } from '../../types';

import { formatDistance } from './formatting';
import {
    calculatePolygonCentroid,
    calculatePolygonBounds,
    isPointInsidePolygon,
} from './geometry';
import { clearDrawingPreview } from './wallRendering';

// Re-export from geometry for backward compatibility
export { getRoomHierarchyDepth } from './geometry';

// =============================================================================
// Types
// =============================================================================

export interface RoomRenderOptions {
    selected?: boolean;
    hovered?: boolean;
}

export interface TagBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

// =============================================================================
// Color Utilities
// =============================================================================

function withAlpha(color: string, alpha: number): string {
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        let r = 0, g = 0, b = 0;
        if (hex.length === 3) {
            r = parseInt(hex[0]! + hex[0]!, 16);
            g = parseInt(hex[1]! + hex[1]!, 16);
            b = parseInt(hex[2]! + hex[2]!, 16);
        } else if (hex.length === 6) {
            r = parseInt(hex.slice(0, 2), 16);
            g = parseInt(hex.slice(2, 4), 16);
            b = parseInt(hex.slice(4, 6), 16);
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
        return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
    }
    return color;
}

// =============================================================================
// Room Visual Styling
// =============================================================================

function inferRoomUsageCategory(room: Room2D): 'circulation' | 'storage' | 'bathroom' | 'utility' | 'general' {
    const text = `${room.name} ${room.spaceType}`.toLowerCase();
    if (/corridor|hall|lobby|passage|circulation|foyer/.test(text)) {
        return 'circulation';
    }
    if (/storage|closet|pantry|shaft/.test(text)) {
        return 'storage';
    }
    if (/bath|wc|toilet|wash/.test(text)) {
        return 'bathroom';
    }
    if (/utility|service|laundry|mechanical/.test(text)) {
        return 'utility';
    }
    return 'general';
}

export function getRoomVisualStyle(
    room: Room2D,
    isSelected: boolean,
    isHovered: boolean
): {
    fill: string;
    stroke: string;
    strokeWidth: number;
    strokeDashArray?: number[];
} {
    const isChild = Boolean(room.parentRoomId);
    const hasChildren = room.childRoomIds.length > 0;
    const usage = inferRoomUsageCategory(room);

    if (isSelected) {
        return {
            fill: 'rgba(37, 99, 235, 0.16)',
            stroke: '#2563eb',
            strokeWidth: 1.75,
        };
    }

    if (isHovered) {
        return {
            fill: 'rgba(59, 130, 246, 0.14)',
            stroke: 'rgba(37, 99, 235, 0.9)',
            strokeWidth: 1.45,
            strokeDashArray: isChild ? [6, 4] : undefined,
        };
    }

    if (room.color) {
        return {
            fill: withAlpha(room.color, hasChildren ? 0.2 : 0.14),
            stroke: hasChildren ? withAlpha(room.color, 0.75) : withAlpha(room.color, 0.55),
            strokeWidth: 1.2,
            strokeDashArray:
                usage === 'storage'
                    ? [4, 3]
                    : usage === 'bathroom'
                        ? [8, 3]
                        : isChild
                            ? [6, 4]
                            : undefined,
        };
    }

    if (hasChildren && !isChild) {
        return {
            fill: 'rgba(245, 158, 11, 0.11)',
            stroke: 'rgba(180, 83, 9, 0.6)',
            strokeWidth: 1.1,
        };
    }

    if (isChild) {
        const childFill =
            usage === 'storage'
                ? 'rgba(20, 184, 166, 0.14)'
                : usage === 'bathroom'
                    ? 'rgba(56, 189, 248, 0.14)'
                    : 'rgba(56, 189, 248, 0.12)';
        return {
            fill: childFill,
            stroke: 'rgba(14, 116, 144, 0.55)',
            strokeWidth: 1.05,
            strokeDashArray: usage === 'storage' ? [4, 3] : [6, 4],
        };
    }

    if (usage === 'circulation') {
        return {
            fill: 'rgba(245, 158, 11, 0.14)',
            stroke: 'rgba(180, 83, 9, 0.5)',
            strokeWidth: 1.1,
            strokeDashArray: [10, 3],
        };
    }

    if (usage === 'bathroom') {
        return {
            fill: 'rgba(125, 211, 252, 0.16)',
            stroke: 'rgba(14, 116, 144, 0.5)',
            strokeWidth: 1.1,
            strokeDashArray: [8, 3],
        };
    }

    if (usage === 'storage') {
        return {
            fill: 'rgba(94, 234, 212, 0.12)',
            stroke: 'rgba(15, 118, 110, 0.5)',
            strokeWidth: 1.1,
            strokeDashArray: [4, 3],
        };
    }

    return {
        fill: 'rgba(148,163,184,0.08)',
        stroke: 'rgba(100,116,139,0.3)',
        strokeWidth: 1,
    };
}

// =============================================================================
// Room Formatting
// =============================================================================

export function formatRoomArea(areaSqm: number, unit: DisplayUnit): string {
    switch (unit) {
        case 'mm': {
            const value = Math.round(areaSqm * 1_000_000);
            return `${value.toLocaleString()} mm²`;
        }
        case 'cm': {
            const value = areaSqm * 10_000;
            return `${value.toFixed(value >= 100 ? 0 : 1)} cm²`;
        }
        case 'ft-in': {
            const value = areaSqm * 10.7639104;
            return `${value.toFixed(value >= 100 ? 0 : 1)} ft²`;
        }
        default:
            return `${areaSqm >= 10 ? areaSqm.toFixed(1) : areaSqm.toFixed(2)} m²`;
    }
}

export function formatRoomPerimeter(perimeterM: number, unit: DisplayUnit): string {
    const mm = perimeterM * 1000;
    return formatDistance(mm, unit);
}

// =============================================================================
// Room Tag Rendering
// =============================================================================

export function getPreferredRoomTagAnchor(room: Room2D, roomById: Map<string, Room2D>): Point2D {
    const centroid = calculatePolygonCentroid(room.vertices);
    if (isPointInsidePolygon(centroid, room.vertices)) {
        return centroid;
    }
    return findBestOpenTagPoint(room, roomById) ?? centroid;
}

export function isValidRoomTagPoint(point: Point2D, room: Room2D, roomById: Map<string, Room2D>): boolean {
    if (!isPointInsidePolygon(point, room.vertices)) return false;
    for (const childId of room.childRoomIds) {
        const childRoom = roomById.get(childId);
        if (childRoom && isPointInsidePolygon(point, childRoom.vertices)) {
            return false;
        }
    }
    return true;
}

function findBestOpenTagPoint(room: Room2D, roomById: Map<string, Room2D>): Point2D | null {
    const bounds = calculatePolygonBounds(room.vertices);
    const stepX = (bounds.right - bounds.left) / 10;
    const stepY = (bounds.bottom - bounds.top) / 10;

    for (let y = bounds.top + stepY; y < bounds.bottom; y += stepY) {
        for (let x = bounds.left + stepX; x < bounds.right; x += stepX) {
            const point = { x, y };
            if (isValidRoomTagPoint(point, room, roomById)) {
                return point;
            }
        }
    }
    return null;
}

// =============================================================================
// Room Tag Object Creation
// =============================================================================

export function createRoomTagObject(
    room: Room2D,
    zoom: number,
    unit: DisplayUnit,
    anchor: Point2D,
    options: RoomRenderOptions = {}
): fabric.Group {
    const netAreaText = formatRoomArea(room.netArea ?? room.area, unit);
    const grossAreaText = formatRoomArea(room.grossArea ?? room.area, unit);
    const perimeterText = formatRoomPerimeter(room.perimeter, unit);
    const isSelected = options.selected === true;
    const hasChildren = room.childRoomIds.length > 0;
    const textLines = [
        {
            text: room.name,
            fontSize: 13,
            fontWeight: '700',
            fill: '#f8fafc',
        },
        {
            text: hasChildren ? `Net: ${netAreaText}` : `Area: ${netAreaText}`,
            fontSize: 11,
            fontWeight: '500',
            fill: '#e2e8f0',
        },
        {
            text: `Perim: ${perimeterText}`,
            fontSize: 11,
            fontWeight: '500',
            fill: '#cbd5e1',
        },
    ];
    if (hasChildren) {
        textLines.push({
            text: `Gross: ${grossAreaText}`,
            fontSize: 10,
            fontWeight: '400',
            fill: '#cbd5e1',
        });
        textLines.push({
            text: `Contains ${room.childRoomIds.length} sub-room${room.childRoomIds.length === 1 ? '' : 's'}`,
            fontSize: 10,
            fontWeight: '600',
            fill: '#a7f3d0',
        });
    }

    const textObjects = textLines.map(
        (line) =>
            new fabric.Text(line.text, {
                fontFamily: 'Segoe UI',
                fontSize: line.fontSize,
                fontWeight: line.fontWeight,
                fill: line.fill,
                originX: 'left',
                originY: 'top',
                selectable: false,
                evented: false,
            })
    );

    const contentWidth = textObjects.reduce((max, text) => Math.max(max, text.width ?? 0), 0);
    const lineHeights = textObjects.map((text) => text.height ?? 0);
    const contentHeight = lineHeights.reduce((sum, height) => sum + height, 0);
    const lineGap = 3;
    const paddingX = 10;
    const paddingY = 8;
    const boxWidth = Math.max(contentWidth + paddingX * 2, 116);
    const boxHeight = contentHeight + paddingY * 2 + lineGap * Math.max(0, textObjects.length - 1);
    const boxLeft = -boxWidth / 2;
    const boxTop = -boxHeight / 2;

    const textLeft = boxLeft + paddingX;
    let cursorTop = boxTop + paddingY;
    textObjects.forEach((textObject, index) => {
        textObject.set({ left: textLeft, top: cursorTop });
        cursorTop += (lineHeights[index] ?? 0) + lineGap;
    });

    const background = new fabric.Rect({
        left: boxLeft,
        top: boxTop,
        width: boxWidth,
        height: boxHeight,
        rx: 6,
        ry: 6,
        fill: isSelected ? 'rgba(3, 37, 85, 0.92)' : 'rgba(15, 23, 42, 0.88)',
        stroke: isSelected ? '#60a5fa' : '#94a3b8',
        strokeWidth: isSelected ? 1.5 : 1,
        selectable: false,
        evented: false,
        objectCaching: false,
    });

    const safeZoom = Math.max(zoom, 0.01);
    const inverseZoom = (isSelected ? 1.08 : 1) / safeZoom;
    const group = new fabric.Group([background, ...textObjects], {
        left: anchor.x,
        top: anchor.y,
        originX: 'center',
        originY: 'center',
        selectable: false,
        evented: false,
        objectCaching: false,
        scaleX: inverseZoom,
        scaleY: inverseZoom,
    });
    (group as unknown as { name?: string }).name = 'room-tag';
    (group as unknown as { roomId?: string }).roomId = room.id;
    return group;
}

// =============================================================================
// Room Render Objects
// =============================================================================

export function createRoomRenderObjects(
    room: Room2D,
    zoom: number,
    unit: DisplayUnit,
    roomById: Map<string, Room2D>,
    occupiedTagBounds: TagBounds[],
    options: RoomRenderOptions = {}
): {
    roomFill: fabric.Object;
    roomTag: fabric.Group | null;
    tagBounds: TagBounds | null;
} {
    const isSelected = options.selected === true;
    const isHovered = options.hovered === true;
    const fillStyle = getRoomVisualStyle(room, isSelected, isHovered);
    const roomFill = new fabric.Polygon(room.vertices, {
        fill: fillStyle.fill,
        stroke: fillStyle.stroke,
        strokeWidth: fillStyle.strokeWidth,
        strokeDashArray: fillStyle.strokeDashArray,
        selectable: true,
        evented: true,
        objectCaching: false,
    });
    (roomFill as unknown as { name?: string }).name = 'room-region';
    (roomFill as unknown as { roomId?: string }).roomId = room.id;

    if (room.showTag === false) {
        return { roomFill, roomTag: null, tagBounds: null };
    }

    const preferredAnchor = getPreferredRoomTagAnchor(room, roomById);
    const roomTag = createRoomTagObject(room, zoom, unit, preferredAnchor, {
        selected: isSelected,
    });
    const tagBounds = resolveRoomTagPlacement(roomTag, room, roomById, occupiedTagBounds, zoom);
    return { roomFill, roomTag, tagBounds };
}

// =============================================================================
// Tag Placement
// =============================================================================

export function resolveRoomTagPlacement(
    roomTag: fabric.Group,
    room: Room2D,
    roomById: Map<string, Room2D>,
    occupiedTagBounds: TagBounds[],
    zoom: number
): TagBounds {
    const baseAnchor = {
        x: roomTag.left ?? 0,
        y: roomTag.top ?? 0,
    };
    const candidateAnchors = buildTagPlacementCandidates(baseAnchor, zoom);

    for (const candidate of candidateAnchors) {
        if (!isValidRoomTagPoint(candidate, room, roomById)) continue;

        roomTag.set({ left: candidate.x, top: candidate.y });
        roomTag.setCoords();
        const bounds = getTagBounds(roomTag);
        if (!occupiedTagBounds.some((occupied) => tagBoundsOverlap(bounds, occupied))) {
            return bounds;
        }
    }

    roomTag.set({ left: baseAnchor.x, top: baseAnchor.y });
    roomTag.setCoords();
    return getTagBounds(roomTag);
}

function buildTagPlacementCandidates(anchor: Point2D, zoom: number): Point2D[] {
    const candidates: Point2D[] = [{ x: anchor.x, y: anchor.y }];
    const step = Math.max(20 / Math.max(zoom, 0.01), 8);
    const rings = 6;
    const sectors = 12;

    for (let ring = 1; ring <= rings; ring++) {
        const radius = step * ring;
        for (let i = 0; i < sectors; i++) {
            const angle = (Math.PI * 2 * i) / sectors;
            candidates.push({
                x: anchor.x + Math.cos(angle) * radius,
                y: anchor.y + Math.sin(angle) * radius,
            });
        }
    }

    return candidates;
}

function getTagBounds(tag: fabric.Group): TagBounds {
    const width = tag.getScaledWidth();
    const height = tag.getScaledHeight();
    const cx = tag.left ?? 0;
    const cy = tag.top ?? 0;
    return {
        left: cx - width / 2,
        top: cy - height / 2,
        right: cx + width / 2,
        bottom: cy + height / 2,
    };
}

function tagBoundsOverlap(a: TagBounds, b: TagBounds): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// =============================================================================
// Room Preview Rendering
// =============================================================================

export function renderRoomRectanglePreview(canvas: fabric.Canvas, start: Point2D, end: Point2D): void {
    clearDrawingPreview(canvas, false);
    const vertices = buildRectangleVertices(start, end);
    const polygon = new fabric.Polygon(vertices, {
        fill: 'rgba(30, 64, 175, 0.12)',
        stroke: '#1d4ed8',
        strokeWidth: 1.5,
        strokeDashArray: [6, 4],
        selectable: false,
        evented: false,
        objectCaching: false,
    });
    (polygon as unknown as { name?: string }).name = 'drawing-preview';
    canvas.add(polygon);
    canvas.requestRenderAll();
}

export function renderRoomPolygonPreview(
    canvas: fabric.Canvas,
    vertices: Point2D[],
    hoverPoint: Point2D | null
): void {
    clearDrawingPreview(canvas, false);
    if (vertices.length === 0) {
        canvas.requestRenderAll();
        return;
    }

    if (vertices.length > 1) {
        const closedPreview = hoverPoint ? [...vertices, hoverPoint] : [...vertices];
        const polyline = new fabric.Polyline(closedPreview, {
            stroke: '#1d4ed8',
            strokeWidth: 1.5,
            strokeDashArray: [6, 4],
            fill: 'rgba(30, 64, 175, 0.08)',
            selectable: false,
            evented: false,
            objectCaching: false,
        });
        (polyline as unknown as { name?: string }).name = 'drawing-preview';
        canvas.add(polyline);
    }

    vertices.forEach((vertex) => {
        const marker = new fabric.Circle({
            left: vertex.x - 2.5,
            top: vertex.y - 2.5,
            radius: 2.5,
            fill: '#1d4ed8',
            stroke: '#ffffff',
            strokeWidth: 0.75,
            selectable: false,
            evented: false,
            objectCaching: false,
        });
        (marker as unknown as { name?: string }).name = 'drawing-preview';
        canvas.add(marker);
    });

    canvas.requestRenderAll();
}

function buildRectangleVertices(start: Point2D, end: Point2D): Point2D[] {
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);
    return [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
    ];
}

// =============================================================================
// Canvas Clearing Functions
// =============================================================================

export function clearRenderedRooms(canvas: fabric.Canvas): void {
    const roomObjects = canvas
        .getObjects()
        .filter((obj) => {
            const name = (obj as unknown as { name?: string }).name;
            return name === 'room-tag' || name === 'room-region';
        });
    roomObjects.forEach((obj) => canvas.remove(obj));
}
