import { describe, expect, it } from 'vitest';

import type { Wall2D } from '../src/types';
import {
    applyCornerBevel,
    resolveCornerControlGeometry,
    resolveCornerPair,
} from '../src/components/canvas/corner-editing';
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

describe('bevel generation algorithm', () => {
    it('creates bevel segment and trims adjacent walls', () => {
        const wallA = buildWall('a', toPoint(0, 0), toPoint(100, 0));
        const wallB = buildWall('b', toPoint(0, 0), toPoint(0, 100));
        const pair = resolveCornerPair([wallA, wallB], toPoint(0, 0), ['a', 'b'], 0.5);
        expect(pair).not.toBeNull();
        if (!pair) return;
        const geometry = resolveCornerControlGeometry(pair, 1);
        expect(geometry).not.toBeNull();
        if (!geometry || !geometry.outerRadial) return;

        const bevelLength = geometry.maxBevelLength / 2;
        const pointer = {
            x: geometry.outerVertex.x + geometry.outerRadial.x * bevelLength,
            y: geometry.outerVertex.y + geometry.outerRadial.y * bevelLength,
        };

        const nextWalls = applyCornerBevel([wallA, wallB], pair, geometry, 'outer', pointer, 0.5);
        expect(nextWalls).not.toBeNull();
        if (!nextWalls) return;

        const nextA = nextWalls.find((wall) => wall.id === 'a');
        const nextB = nextWalls.find((wall) => wall.id === 'b');
        const bevelWall = nextWalls.find((wall) => wall.isBevelSegment);
        expect(nextA).toBeTruthy();
        expect(nextB).toBeTruthy();
        expect(bevelWall).toBeTruthy();

        if (nextA && nextB && bevelWall) {
            expectPointClose(nextA.start, toPoint(bevelLength, 0));
            expectPointClose(nextB.start, toPoint(0, bevelLength));
            expectPointClose(bevelWall.start, toPoint(bevelLength, 0));
            expectPointClose(bevelWall.end, toPoint(0, bevelLength));
        }
    });

    it('clamps bevel length to the maximum allowed', () => {
        const wallA = buildWall('a', toPoint(0, 0), toPoint(100, 0));
        const wallB = buildWall('b', toPoint(0, 0), toPoint(0, 100));
        const pair = resolveCornerPair([wallA, wallB], toPoint(0, 0), ['a', 'b'], 0.5);
        expect(pair).not.toBeNull();
        if (!pair) return;
        const geometry = resolveCornerControlGeometry(pair, 1);
        expect(geometry).not.toBeNull();
        if (!geometry || !geometry.outerRadial) return;

        const pointer = {
            x: geometry.outerVertex.x + geometry.outerRadial.x * geometry.maxBevelLength * 2,
            y: geometry.outerVertex.y + geometry.outerRadial.y * geometry.maxBevelLength * 2,
        };

        const nextWalls = applyCornerBevel([wallA, wallB], pair, geometry, 'outer', pointer, 0.5);
        expect(nextWalls).not.toBeNull();
        if (!nextWalls) return;

        const nextA = nextWalls.find((wall) => wall.id === 'a');
        const nextB = nextWalls.find((wall) => wall.id === 'b');
        if (nextA && nextB) {
            expectPointClose(nextA.start, toPoint(geometry.maxBevelLength, 0));
            expectPointClose(nextB.start, toPoint(0, geometry.maxBevelLength));
        }
    });
});
