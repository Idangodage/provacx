/**
 * Store Helper Functions
 *
 * Shared utility functions used by store actions.
 * Extracted for better organization and testability.
 */

import type {
    DetectedElement,
    Dimension2D,
    Annotation2D,
    Sketch2D,
    SymbolInstance2D,
    HistoryEntry,
    Wall,
    Room,
} from '../types';
import { generateId } from '../utils/geometry';

// =============================================================================
// Deep Clone
// =============================================================================

export function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

// =============================================================================
// History Helpers
// =============================================================================

export function createEmptyHistorySnapshot(): HistoryEntry['snapshot'] {
    return {
        detectedElements: [],
        dimensions: [],
        annotations: [],
        sketches: [],
        symbols: [],
        walls: [],
        rooms: [],
    };
}

export function createHistoryEntry(action: string, snapshot: HistoryEntry['snapshot']): HistoryEntry {
    return {
        id: generateId(),
        timestamp: Date.now(),
        action,
        snapshot,
    };
}

export function createHistorySnapshot(state: {
    detectedElements: DetectedElement[];
    dimensions: Dimension2D[];
    annotations: Annotation2D[];
    sketches: Sketch2D[];
    symbols: SymbolInstance2D[];
    walls: Wall[];
    rooms: Room[];
}): HistoryEntry['snapshot'] {
    return {
        detectedElements: deepClone(state.detectedElements),
        dimensions: deepClone(state.dimensions),
        annotations: deepClone(state.annotations),
        sketches: deepClone(state.sketches),
        symbols: deepClone(state.symbols),
        walls: deepClone(state.walls),
        rooms: deepClone(state.rooms),
    };
}
