/**
 * Corner Control Factory
 *
 * Creates outer/inner/center corner control points for degree-2 wall intersections.
 */

import * as fabric from 'fabric';

import type { Point2D, Wall2D } from '../../types';

import { WALL_CONTROL_POINT_BASE_RADIUS_PX } from './control-point-factory';
import { resolveCornerControlGeometry, resolveCornerPair } from './corner-editing';

export type CornerControlHandleType = 'outer' | 'inner' | 'center';

export interface CornerControlPointMeta {
    name: 'wall-corner-handle';
    cornerHandleType: CornerControlHandleType;
    wallIds: string[];
    nodePoint: Point2D;
}

interface CornerNodeAccumulator {
    sx: number;
    sy: number;
    count: number;
    wallIds: Set<string>;
}

function toNodeKey(point: Point2D): string {
    return `${Math.round(point.x * 1000)}:${Math.round(point.y * 1000)}`;
}

function createCornerControlHandle(
    point: Point2D,
    radius: number,
    color: string,
    meta: CornerControlPointMeta
): fabric.Circle {
    const handle = new fabric.Circle({
        left: point.x - radius,
        top: point.y - radius,
        radius,
        fill: color,
        stroke: '#ffffff',
        strokeWidth: Math.max(1, radius * 0.2),
        selectable: true,
        evented: true,
        hasControls: false,
        hasBorders: false,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        objectCaching: false,
        hoverCursor: meta.cornerHandleType === 'center' ? 'move' : 'pointer',
    });
    (handle as unknown as CornerControlPointMeta).name = meta.name;
    (handle as unknown as CornerControlPointMeta).cornerHandleType = meta.cornerHandleType;
    (handle as unknown as CornerControlPointMeta).wallIds = meta.wallIds;
    (handle as unknown as CornerControlPointMeta).nodePoint = meta.nodePoint;

    const hoverScale = 1.2;
    handle.on('mouseover', () => {
        handle.set({
            scaleX: hoverScale,
            scaleY: hoverScale,
            shadow: new fabric.Shadow({
                color: 'rgba(37, 99, 235, 0.3)',
                blur: 10,
                offsetX: 0,
                offsetY: 0,
            }),
        });
    });
    handle.on('mouseout', () => {
        handle.set({
            scaleX: 1,
            scaleY: 1,
            shadow: undefined,
        });
    });

    return handle;
}

export function createWallCornerControlPoints(
    walls: Wall2D[],
    zoom: number,
    paperToRealRatio: number,
    selectedWallIds: Set<string> = new Set()
): fabric.Circle[] {
    if (walls.length < 2) return [];

    const safeZoom = Math.max(zoom, 0.01);
    const radius = Math.max(WALL_CONTROL_POINT_BASE_RADIUS_PX / safeZoom, 2.5 / safeZoom);
    const nodes = new Map<string, CornerNodeAccumulator>();
    walls.forEach((wall) => {
        [wall.start, wall.end].forEach((point) => {
            const key = toNodeKey(point);
            const existing = nodes.get(key);
            if (existing) {
                existing.sx += point.x;
                existing.sy += point.y;
                existing.count += 1;
                existing.wallIds.add(wall.id);
                return;
            }
            nodes.set(key, {
                sx: point.x,
                sy: point.y,
                count: 1,
                wallIds: new Set([wall.id]),
            });
        });
    });

    const output: fabric.Circle[] = [];
    nodes.forEach((node) => {
        const wallIds = Array.from(node.wallIds);
        if (wallIds.length !== 2) return;
        if (selectedWallIds.size > 0 && !wallIds.some((wallId) => selectedWallIds.has(wallId))) {
            return;
        }

        const nodePoint = { x: node.sx / node.count, y: node.sy / node.count };
        const pair = resolveCornerPair(walls, nodePoint, wallIds, 0.5);
        if (!pair) return;
        const geometry = resolveCornerControlGeometry(pair, paperToRealRatio);
        if (!geometry) return;

        const baseMeta = {
            name: 'wall-corner-handle' as const,
            wallIds: [pair.wallA.id, pair.wallB.id],
            nodePoint,
        };
        output.push(
            createCornerControlHandle(geometry.outerVertex, radius, '#2563eb', {
                ...baseMeta,
                cornerHandleType: 'outer',
            })
        );
        output.push(
            createCornerControlHandle(geometry.innerVertex, radius, '#16a34a', {
                ...baseMeta,
                cornerHandleType: 'inner',
            })
        );
        output.push(
            createCornerControlHandle(geometry.center, radius, '#f59e0b', {
                ...baseMeta,
                cornerHandleType: 'center',
            })
        );
    });

    return output;
}
