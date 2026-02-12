import { describe, expect, it } from 'vitest';
import { create } from 'zustand';

import type { Annotation2D, Dimension2D, Room2D, Sketch2D, SymbolInstance2D, Wall2D } from '../src/types';
import type { SelectionSlice } from '../src/store/slices/selectionSlice';
import { createSelectionSlice } from '../src/store/slices/selectionSlice';

interface SelectionDeps {
    walls: Wall2D[];
    rooms: Room2D[];
    dimensions: Dimension2D[];
    annotations: Annotation2D[];
    sketches: Sketch2D[];
    symbols: SymbolInstance2D[];
    saveToHistory: (action: string) => void;
}

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

describe('selection slice', () => {
    it('supports single and additive selection', () => {
        const useStore = create<SelectionSlice & SelectionDeps>()((set, get) => ({
            walls: [buildWall('w1'), buildWall('w2')],
            rooms: [],
            dimensions: [],
            annotations: [] as Annotation2D[],
            sketches: [],
            symbols: [],
            saveToHistory: () => {},
            ...createSelectionSlice(set, get),
        }));

        const { selectElement, selectedElementIds } = useStore.getState();
        selectElement('w1');
        expect(useStore.getState().selectedElementIds).toEqual(['w1']);
        selectElement('w2', true);
        expect(useStore.getState().selectedElementIds).toEqual(['w1', 'w2']);
        expect(selectedElementIds).not.toBeUndefined();
    });

    it('selects all elements', () => {
        const useStore = create<SelectionSlice & SelectionDeps>()((set, get) => ({
            walls: [buildWall('w1')],
            rooms: [{ id: 'r1', name: 'Room 1', wallIds: [], vertices: [], parentRoomId: null, childRoomIds: [], grossArea: 0, netArea: 0, roomType: 'enclosed-space', area: 0, perimeter: 0, spaceType: '', floorHeight: 0, ceilingHeight: 0 }],
            dimensions: [{ id: 'd1', type: 'linear', points: [], value: 0, unit: 'mm', textPosition: { x: 0, y: 0 }, visible: true }],
            annotations: [] as Annotation2D[],
            sketches: [{ id: 's1', type: 'line', points: [] }],
            symbols: [{ id: 'sym1', symbolId: 'sym', position: { x: 0, y: 0 }, rotation: 0, scale: 1, flipped: false, properties: {} }],
            saveToHistory: () => {},
            ...createSelectionSlice(set, get),
        }));

        useStore.getState().selectAll();
        expect(useStore.getState().selectedElementIds).toEqual(['w1', 'r1', 'd1', 's1', 'sym1']);
    });
});
