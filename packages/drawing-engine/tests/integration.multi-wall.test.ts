import { describe, expect, it } from 'vitest';

import type { Wall2D } from '../src/types';
import { moveConnectedNode, rebuildWallAdjacency } from '../src/components/canvas/wallOperations';

function buildWall(id: string, start: { x: number; y: number }, end: { x: number; y: number }): Wall2D {
    return {
        id,
        start,
        end,
        thickness: 100,
        height: 3000,
        wallType: 'interior',
        openings: [],
    };
}

describe('multi-wall operations', () => {
    it('moves a shared node across multiple walls and rebuilds adjacency', () => {
        const shared = { x: 0, y: 0 };
        const walls: Wall2D[] = [
            buildWall('w1', shared, { x: 10, y: 0 }),
            buildWall('w2', shared, { x: 0, y: 10 }),
            buildWall('w3', shared, { x: -10, y: 0 }),
        ];

        const moved = moveConnectedNode(walls, shared, { x: 2, y: 3 }, 0.5);
        const rebuilt = rebuildWallAdjacency(moved, 0.5);

        rebuilt.forEach((wall) => {
            expect(wall.start.x === 2 && wall.start.y === 3 || wall.end.x === 2 && wall.end.y === 3).toBe(true);
        });

        const w1 = rebuilt.find((wall) => wall.id === 'w1');
        expect(w1?.connectedWallIds?.sort()).toEqual(['w2', 'w3']);
    });
});
