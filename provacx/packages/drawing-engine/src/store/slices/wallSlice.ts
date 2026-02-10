/**
 * Wall Slice
 * 
 * Domain-specific slice for wall state and actions.
 * Uses Zustand slice pattern for composition.
 */

import type { StateCreator } from 'zustand';

import type {
    Wall2D,
    WallLayer,
    WallTypeDefinition,
    MaterialType,
    Opening2D,
    Room2D,
} from '../../types';
import { generateId } from '../../utils/geometry';
import {
    DEFAULT_WALL_TYPE_ID,
    addWallLayer,
    convertWallCoreMaterial,
    getWallTypeRegistry,
    normalizeWallForTypeSystem,
    removeWallLayer,
    reorderWallLayers,
    resetWallToTypeDefault,
    resizeWallTotalThickness,
    updateWallLayerThickness,
} from '../../utils/wall-types';
import { detectRoomsIncremental, withRebuiltAdjacency } from '../helpers';

// =============================================================================
// Types
// =============================================================================

export interface WallSliceState {
    walls: Wall2D[];
    activeWallTypeId: string;
    wallTypeRegistry: WallTypeDefinition[];
}

export interface WallSliceActions {
    setWalls: (walls: Wall2D[], historyAction?: string) => void;
    addWall: (wall: Omit<Wall2D, 'id' | 'openings'>) => string;
    updateWall: (id: string, data: Partial<Wall2D>) => void;
    deleteWall: (id: string) => void;
    setActiveWallTypeId: (wallTypeId: string) => void;
    setWallTypeRegistry: (customWallTypes: WallTypeDefinition[]) => void;
    setWallTotalThickness: (wallId: string, totalThickness: number) => string[];
    addWallLayerToWall: (wallId: string, layer: WallLayer, index: number) => string[];
    removeWallLayerFromWall: (wallId: string, layerId: string) => string[];
    reorderWallLayerInWall: (wallId: string, fromIndex: number, toIndex: number) => string[];
    updateWallLayerThicknessInWall: (wallId: string, layerId: string, thickness: number) => string[];
    convertWallCoreMaterialForWall: (wallId: string, material: MaterialType) => string[];
    resetWallLayerOverrides: (wallId: string) => void;
    addOpeningToWall: (wallId: string, opening: Omit<Opening2D, 'id' | 'wallId'>) => string;
    updateOpening: (wallId: string, openingId: string, data: Partial<Opening2D>) => void;
    deleteOpening: (wallId: string, openingId: string) => void;
}

export type WallSlice = WallSliceState & WallSliceActions;

// =============================================================================
// Slice Dependencies Interface
// =============================================================================

interface SliceDependencies {
    rooms: Room2D[];
    saveToHistory: (action: string) => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createWallSlice: StateCreator<
    WallSlice & SliceDependencies,
    [],
    [],
    WallSlice
> = (set, get) => ({
    // Initial State
    walls: [],
    activeWallTypeId: DEFAULT_WALL_TYPE_ID,
    wallTypeRegistry: getWallTypeRegistry(),

    // Actions
    setWalls: (walls, historyAction = 'Update walls') => {
        set((state) => {
            const normalizedWalls = withRebuiltAdjacency(walls, state.wallTypeRegistry);
            return {
                walls: normalizedWalls,
                rooms: detectRoomsIncremental(state.walls, normalizedWalls, state.rooms),
            };
        });
        get().saveToHistory(historyAction);
    },

    addWall: (wall) => {
        const id = generateId();
        set((state) => {
            const normalizedNewWall = normalizeWallForTypeSystem(
                { ...wall, id, openings: [] },
                state.wallTypeRegistry
            );
            const nextWalls = withRebuiltAdjacency(
                [...state.walls, normalizedNewWall],
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Add wall');
        return id;
    },

    updateWall: (id, data) => {
        set((state) => {
            const nextWalls = withRebuiltAdjacency(
                state.walls.map((w) => (w.id === id ? { ...w, ...data } : w)),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Update wall');
    },

    deleteWall: (id) => {
        set((state) => {
            const nextWalls = withRebuiltAdjacency(
                state.walls.filter((w) => w.id !== id),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Delete wall');
    },

    setActiveWallTypeId: (wallTypeId) =>
        set((state) => ({
            activeWallTypeId: state.wallTypeRegistry.some((wallType) => wallType.id === wallTypeId)
                ? wallTypeId
                : state.activeWallTypeId,
        })),

    setWallTypeRegistry: (customWallTypes) => {
        set((state) => {
            const wallTypeRegistry = getWallTypeRegistry(customWallTypes);
            const activeWallTypeId = wallTypeRegistry.some(
                (wallType) => wallType.id === state.activeWallTypeId
            )
                ? state.activeWallTypeId
                : DEFAULT_WALL_TYPE_ID;
            const nextWalls = withRebuiltAdjacency(state.walls, wallTypeRegistry);
            return {
                wallTypeRegistry,
                activeWallTypeId,
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
    },

    setWallTotalThickness: (wallId, totalThickness) => {
        let warnings: string[] = [];
        set((state) => {
            const wall = state.walls.find((candidate) => candidate.id === wallId);
            if (!wall) return state;
            const result = resizeWallTotalThickness(wall, totalThickness, state.wallTypeRegistry);
            warnings = result.warnings;
            const nextWalls = withRebuiltAdjacency(
                state.walls.map((candidate) => (candidate.id === wallId ? result.wall : candidate)),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Resize wall thickness');
        return warnings;
    },

    addWallLayerToWall: (wallId, layer, index) => {
        let warnings: string[] = [];
        set((state) => {
            const wall = state.walls.find((candidate) => candidate.id === wallId);
            if (!wall) return state;
            const result = addWallLayer(wall, layer, index, state.wallTypeRegistry);
            warnings = result.warnings;
            const nextWalls = withRebuiltAdjacency(
                state.walls.map((candidate) => (candidate.id === wallId ? result.wall : candidate)),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Add wall layer');
        return warnings;
    },

    removeWallLayerFromWall: (wallId, layerId) => {
        let warnings: string[] = [];
        set((state) => {
            const wall = state.walls.find((candidate) => candidate.id === wallId);
            if (!wall) return state;
            const result = removeWallLayer(wall, layerId, state.wallTypeRegistry);
            warnings = result.warnings;
            const nextWalls = withRebuiltAdjacency(
                state.walls.map((candidate) => (candidate.id === wallId ? result.wall : candidate)),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Remove wall layer');
        return warnings;
    },

    reorderWallLayerInWall: (wallId, fromIndex, toIndex) => {
        let warnings: string[] = [];
        set((state) => {
            const wall = state.walls.find((candidate) => candidate.id === wallId);
            if (!wall) return state;
            const result = reorderWallLayers(wall, fromIndex, toIndex, state.wallTypeRegistry);
            warnings = result.warnings;
            const nextWalls = withRebuiltAdjacency(
                state.walls.map((candidate) => (candidate.id === wallId ? result.wall : candidate)),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Reorder wall layers');
        return warnings;
    },

    updateWallLayerThicknessInWall: (wallId, layerId, thickness) => {
        let warnings: string[] = [];
        set((state) => {
            const wall = state.walls.find((candidate) => candidate.id === wallId);
            if (!wall) return state;
            const result = updateWallLayerThickness(wall, layerId, thickness, state.wallTypeRegistry);
            warnings = result.warnings;
            const nextWalls = withRebuiltAdjacency(
                state.walls.map((candidate) => (candidate.id === wallId ? result.wall : candidate)),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Update wall layer thickness');
        return warnings;
    },

    convertWallCoreMaterialForWall: (wallId, material) => {
        let warnings: string[] = [];
        set((state) => {
            const wall = state.walls.find((candidate) => candidate.id === wallId);
            if (!wall) return state;
            const result = convertWallCoreMaterial(wall, material, state.wallTypeRegistry);
            warnings = result.warnings;
            const nextWalls = withRebuiltAdjacency(
                state.walls.map((candidate) => (candidate.id === wallId ? result.wall : candidate)),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Convert wall core material');
        return warnings;
    },

    resetWallLayerOverrides: (wallId) => {
        set((state) => {
            const wall = state.walls.find((candidate) => candidate.id === wallId);
            if (!wall) return state;
            const resetWall = resetWallToTypeDefault(wall, state.wallTypeRegistry);
            const nextWalls = withRebuiltAdjacency(
                state.walls.map((candidate) => (candidate.id === wallId ? resetWall : candidate)),
                state.wallTypeRegistry
            );
            return {
                walls: nextWalls,
                rooms: detectRoomsIncremental(state.walls, nextWalls, state.rooms),
            };
        });
        get().saveToHistory('Reset wall to type default');
    },

    addOpeningToWall: (wallId, opening) => {
        const id = generateId();
        set((state) => ({
            walls: state.walls.map((w) =>
                w.id === wallId
                    ? { ...w, openings: [...w.openings, { ...opening, id, wallId }] }
                    : w
            ),
        }));
        get().saveToHistory('Add opening');
        return id;
    },

    updateOpening: (wallId, openingId, data) => {
        set((state) => ({
            walls: state.walls.map((w) =>
                w.id === wallId
                    ? {
                        ...w,
                        openings: w.openings.map((o) =>
                            o.id === openingId ? { ...o, ...data } : o
                        ),
                    }
                    : w
            ),
        }));
        get().saveToHistory('Update opening');
    },

    deleteOpening: (wallId, openingId) => {
        set((state) => ({
            walls: state.walls.map((w) =>
                w.id === wallId
                    ? { ...w, openings: w.openings.filter((o) => o.id !== openingId) }
                    : w
            ),
        }));
        get().saveToHistory('Delete opening');
    },
});
