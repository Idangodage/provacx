import { describe, expect, it } from 'vitest';

import type { Wall2D } from '../src/types';
import { wallThicknessToCanvasPx } from '../src/components/canvas/spatial-index';
import {
    resolveCornerControlGeometry,
    resolveCornerPair,
} from '../src/components/canvas/corner-editing';
import { projectDeltaOnNormal } from '../src/components/canvas/wall-handle-geometry';
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

describe('geometry calculations', () => {
    it('computes perpendicular outer/inner intersection points for a right-angle corner', () => {
        const wallA = buildWall('a', toPoint(0, 0), toPoint(100, 0));
        const wallB = buildWall('b', toPoint(0, 0), toPoint(0, 100));
        const pair = resolveCornerPair([wallA, wallB], toPoint(0, 0), ['a', 'b'], 0.5);
        expect(pair).not.toBeNull();
        if (!pair) return;

        const geometry = resolveCornerControlGeometry(pair, 1);
        expect(geometry).not.toBeNull();
        if (!geometry) return;

        const halfThickness = wallThicknessToCanvasPx(wallA.thickness, 1) / 2;
        expectPointClose(geometry.outerVertex, toPoint(-halfThickness, halfThickness));
        expectPointClose(geometry.innerVertex, toPoint(halfThickness, -halfThickness));
    });

    it('projects deltas correctly on normals', () => {
        expect(projectDeltaOnNormal(toPoint(10, 0), toPoint(1, 0))).toBeCloseTo(10, 6);
        expect(projectDeltaOnNormal(toPoint(10, 0), toPoint(0, 1))).toBeCloseTo(0, 6);
    });
});
