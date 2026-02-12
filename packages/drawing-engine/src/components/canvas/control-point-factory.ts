/**
 * Control Point Factory
 *
 * Factory helpers for creating wall thickness/translation control handles.
 */

import * as fabric from 'fabric';

import type { Point2D, Wall2D } from '../../types';

import { resolveWallHandleGeometry } from './wall-handle-geometry';

export type WallControlPointType = 'exterior' | 'interior' | 'center';

export interface WallControlPointOptions {
    wallId: string;
    handleType: WallControlPointType;
    point: Point2D;
    radius: number;
    color: string;
}

// 10px handle diameter in screen space.
export const WALL_CONTROL_POINT_BASE_RADIUS_PX = 5;

function withHoverAnimation(handle: fabric.Circle, baseRadius: number): void {
    const hoverScale = 1.2;
    handle.on('mouseover', () => {
        handle.set({
            scaleX: hoverScale,
            scaleY: hoverScale,
            shadow: new fabric.Shadow({
                color: 'rgba(59, 130, 246, 0.35)',
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
            radius: baseRadius,
        });
    });
}

export function createWallControlPoint(options: WallControlPointOptions): fabric.Circle {
    const { wallId, handleType, point, radius, color } = options;
    const handle = new fabric.Circle({
        left: point.x - radius,
        top: point.y - radius,
        radius,
        fill: color,
        stroke: '#ffffff',
        strokeWidth: Math.max(radius * 0.2, 1),
        selectable: true,
        evented: true,
        hasControls: false,
        hasBorders: false,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        objectCaching: false,
        hoverCursor: handleType === 'center' ? 'move' : 'ns-resize',
    });
    (handle as unknown as { name?: string }).name = 'wall-handle';
    (handle as unknown as { wallId?: string }).wallId = wallId;
    (handle as unknown as { handleType?: WallControlPointType }).handleType = handleType;
    withHoverAnimation(handle, radius);
    return handle;
}

export function createWallControlPointsForWall(
    wall: Wall2D,
    zoom: number,
    paperToRealRatio: number
): fabric.Circle[] {
    const geometry = resolveWallHandleGeometry(wall, paperToRealRatio);
    if (!geometry) return [];

    const safeZoom = Math.max(zoom, 0.01);
    const radius = Math.max(WALL_CONTROL_POINT_BASE_RADIUS_PX / safeZoom, 2.5 / safeZoom);

    return [
        createWallControlPoint({
            wallId: wall.id,
            handleType: 'exterior',
            point: geometry.exteriorMid,
            radius,
            color: '#2563eb',
        }),
        createWallControlPoint({
            wallId: wall.id,
            handleType: 'interior',
            point: geometry.interiorMid,
            radius,
            color: '#16a34a',
        }),
        createWallControlPoint({
            wallId: wall.id,
            handleType: 'center',
            point: geometry.centerMid,
            radius,
            color: '#f59e0b',
        }),
    ];
}
