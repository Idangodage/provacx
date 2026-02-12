import { describe, expect, it } from 'vitest';

import type { Wall2D } from '../src/types';
import { clampWallThicknessMm } from '../src/components/canvas/wall-handle-geometry';
import {
    applyCornerCenterDrag,
    CORNER_MIN_ANGLE_DEG,
    CORNER_MAX_ANGLE_DEG,
    resolveCornerControlGeometry,
    resolveCornerPair,
} from '../src/components/canvas/corner-editing';
import { moveConnectedNode } from '../src/components/canvas/wallOperations';
import { expectPointClose, toPoint } from './test-utils';

function buildWall(id: string, start: { x: number; y: number }, end: { x: number; y: number }): Wall2D {
    return {
        id,
        start,
        end,
        thickness: 100,
        height: 3000,
        wallType: 'interior',
        wallTypeId: 'test',
        openings: [],
        interiorSide: 'right',
        exteriorSide: 'left',
    };
}

function angleDeg(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dot = a.x * b.x + a.y * b.y;
    const magA = Math.hypot(a.x, a.y);
    const magB = Math.hypot(b.x, b.y);
    if (magA <= 1e-9 || magB <= 1e-9) return 0;
    const clamped = Math.max(-1, Math.min(1, dot / (magA * magB)));
    return (Math.acos(clamped) * 180) / Math.PI;
}

describe('validation rules', () => {
    it('clamps wall thickness to min/max bounds', () => {
        expect(clampWallThicknessMm(10)).toBeGreaterThanOrEqual(101.6);
        expect(clampWallThicknessMm(10000)).toBeLessThanOrEqual(609.6);
    });

    it('rejects corner angle edits outside the allowed range', () => {
        const wallA = buildWall('a', toPoint(0, 0), toPoint(10, 0));
        const wallB = buildWall('b', toPoint(0, 0), toPoint(0, 10));
        const pair = resolveCornerPair([wallA, wallB], toPoint(0, 0), ['a', 'b'], 0.5);
        expect(pair).not.toBeNull();
        if (!pair) return;
        const geometry = resolveCornerControlGeometry(pair, 1);
        expect(geometry).not.toBeNull();
        if (!geometry || !geometry.centerRadial) return;

        const radial = geometry.centerRadial;
        let rejectedDistance: number | null = null;

        for (let distance = -2000; distance <= 2000; distance += 20) {
            if (Math.abs(distance) < 1e-6) {
                continue;
            }
            const nextNode = {
                x: pair.node.x + radial.x * distance,
                y: pair.node.y + radial.y * distance,
            };
            const movedWalls = moveConnectedNode([wallA, wallB], pair.node, nextNode, 0.5);
            const movedPair = resolveCornerPair(movedWalls, nextNode, ['a', 'b'], 0.5);
            if (!movedPair) continue;
            const nextAngle = angleDeg(movedPair.awayA, movedPair.awayB);
            if (nextAngle > CORNER_MAX_ANGLE_DEG || nextAngle < CORNER_MIN_ANGLE_DEG) {
                rejectedDistance = distance;
                break;
            }
        }

        expect(rejectedDistance).not.toBeNull();
        if (rejectedDistance === null) return;

        const pointer = {
            x: geometry.center.x + radial.x * rejectedDistance,
            y: geometry.center.y + radial.y * rejectedDistance,
        };
        const rejected = applyCornerCenterDrag(
            [wallA, wallB],
            pair,
            geometry,
            pointer,
            moveConnectedNode,
            0.5
        );
        expect(rejected).toBeNull();

        const acceptedPointer = {
            x: geometry.center.x + radial.x * 0,
            y: geometry.center.y + radial.y * 0,
        };
        const accepted = applyCornerCenterDrag(
            [wallA, wallB],
            pair,
            geometry,
            acceptedPointer,
            moveConnectedNode,
            0.5
        );
        expect(accepted).not.toBeNull();
        if (accepted) {
            const movedPair = resolveCornerPair(accepted, pair.node, ['a', 'b'], 0.5);
            expect(movedPair).not.toBeNull();
            if (movedPair) {
                expectPointClose(movedPair.node, pair.node);
            }
        }
    });
});
