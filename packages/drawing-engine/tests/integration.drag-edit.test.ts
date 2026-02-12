import { describe, expect, it } from 'vitest';

import type { Room2D, Wall2D } from '../src/types';
import { ApplyTransientWallGraphCommand, FinalizeWallEditCommand } from '../src/components/canvas/wall-edit-commands';
import { applyCornerBevel, resolveCornerControlGeometry, resolveCornerPair } from '../src/components/canvas/corner-editing';

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

describe('drag-to-edit workflow', () => {
    it('applies transient edits and finalizes with history', () => {
        const wallA = buildWall('a', { x: 0, y: 0 }, { x: 100, y: 0 });
        const wallB = buildWall('b', { x: 0, y: 0 }, { x: 0, y: 100 });
        let walls: Wall2D[] = [wallA, wallB];
        let rooms: Room2D[] = [];
        let historyAction = '';

        const context = {
            getWalls: () => walls,
            getRooms: () => rooms,
            setGraphState: (nextWalls: Wall2D[], nextRooms: Room2D[]) => {
                walls = nextWalls;
                rooms = nextRooms;
            },
            setSelectedIds: () => {},
            saveToHistory: (action: string) => {
                historyAction = action;
            },
            notifyValidation: () => {},
        };

        const pair = resolveCornerPair(walls, { x: 0, y: 0 }, ['a', 'b'], 0.5);
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
        const nextWalls = applyCornerBevel(walls, pair, geometry, 'outer', pointer, 0.5);
        expect(nextWalls).not.toBeNull();
        if (!nextWalls) return;

        new ApplyTransientWallGraphCommand(context, nextWalls, ['a', 'b']).execute();
        expect(walls.some((wall) => wall.isBevelSegment)).toBe(true);

        new FinalizeWallEditCommand(context, {
            wallId: 'a',
            selectionIds: ['a', 'b'],
            action: 'Bevel wall corner',
            originalWalls: [wallA, wallB],
            originalRooms: [],
        }).execute();

        expect(historyAction).toBe('Bevel wall corner');
    });
});
