import { describe, expect, it } from 'vitest';
import { create } from 'zustand';

import type { HistorySlice } from '../src/store/slices/historySlice';
import { createHistorySlice } from '../src/store/slices/historySlice';
import type { Annotation2D, Dimension2D, DetectedElement, Room2D, Sketch2D, SymbolInstance2D, Wall2D } from '../src/types';

interface HistoryDeps {
    walls: Wall2D[];
    rooms: Room2D[];
    detectedElements: DetectedElement[];
    dimensions: Dimension2D[];
    annotations: Annotation2D[];
    sketches: Sketch2D[];
    symbols: SymbolInstance2D[];
}

function buildWall(id: string, endX: number): Wall2D {
    return {
        id,
        start: { x: 0, y: 0 },
        end: { x: endX, y: 0 },
        thickness: 100,
        height: 3000,
        wallType: 'interior',
        openings: [],
    };
}

describe('history slice', () => {
    it('supports undo/redo for wall changes', () => {
        const useStore = create<HistorySlice & HistoryDeps>()((set, get) => ({
            walls: [buildWall('w1', 10)],
            rooms: [],
            detectedElements: [],
            dimensions: [],
            annotations: [],
            sketches: [],
            symbols: [],
            ...createHistorySlice(set, get),
        }));

        useStore.getState().saveToHistory('Initial');
        useStore.setState({ walls: [buildWall('w1', 20)] });
        useStore.getState().saveToHistory('Move wall');

        expect(useStore.getState().history.length).toBe(2);
        useStore.getState().undo();
        expect(useStore.getState().walls[0]?.end.x).toBe(10);
        useStore.getState().redo();
        expect(useStore.getState().walls[0]?.end.x).toBe(20);
    });
});
