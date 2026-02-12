import { describe, expect, it } from 'vitest';

import type { Wall2D } from '../src/types';
import {
    getWallIdsInRange,
    mergeSelectionIds,
    normalizeSelectionIds,
    toggleSelectionId,
} from '../src/components/canvas/selection-utils';

function buildWall(id: string): Wall2D {
    return {
        id,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        thickness: 100,
        height: 3000,
        wallType: 'interior',
        openings: [],
    };
}

describe('selection logic', () => {
    it('normalizes and merges selection ids', () => {
        expect(normalizeSelectionIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
        expect(mergeSelectionIds(['a'], ['b', 'a'])).toEqual(['a', 'b']);
    });

    it('toggles selection ids', () => {
        expect(toggleSelectionId(['a'], 'a')).toEqual([]);
        expect(toggleSelectionId(['a'], 'b')).toEqual(['a', 'b']);
    });

    it('selects wall ranges based on order', () => {
        const walls = ['a', 'b', 'c', 'd'].map(buildWall);
        expect(getWallIdsInRange(walls, 'b', 'd')).toEqual(['b', 'c', 'd']);
        expect(getWallIdsInRange(walls, 'd', 'b')).toEqual(['b', 'c', 'd']);
    });
});
