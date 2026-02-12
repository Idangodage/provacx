/**
 * Selection Slice
 * 
 * Domain-specific slice for selection and tool state.
 * Uses Zustand slice pattern for composition.
 */

import type { StateCreator } from 'zustand';

import type {
    DrawingTool,
    Wall2D,
    Room2D,
    Dimension2D,
    Annotation2D,
    Sketch2D,
    SymbolInstance2D,
} from '../../types';

// =============================================================================
// Types
// =============================================================================

export interface SelectionSliceState {
    activeTool: DrawingTool;
    activeLayerId: string | null;
    selectedElementIds: string[];
    hoveredElementId: string | null;
    // Aliases for backward compatibility
    tool: DrawingTool;
    selectedIds: string[];
}

export interface SelectionSliceActions {
    selectElement: (id: string, addToSelection?: boolean) => void;
    deselectElement: (id: string) => void;
    clearSelection: () => void;
    selectAll: () => void;
    setHoveredElement: (id: string | null) => void;
    deleteSelectedElements: () => void;
    setActiveTool: (tool: DrawingTool) => void;
    setActiveLayer: (id: string | null) => void;
    // Aliases
    setSelectedIds: (ids: string[]) => void;
    deleteSelected: () => void;
    setTool: (tool: DrawingTool) => void;
}

export type SelectionSlice = SelectionSliceState & SelectionSliceActions;

// =============================================================================
// Slice Dependencies Interface
// =============================================================================

interface SliceDependencies {
    walls: Wall2D[];
    rooms: Room2D[];
    dimensions: Dimension2D[];
    annotations: Annotation2D[];
    sketches: Sketch2D[];
    symbols: SymbolInstance2D[];
    saveToHistory: (action: string) => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createSelectionSlice: StateCreator<
    SelectionSlice & SliceDependencies,
    [],
    [],
    SelectionSlice
> = (set, get) => ({
    // Initial State
    activeTool: 'select',
    activeLayerId: 'default',
    selectedElementIds: [],
    hoveredElementId: null,
    // Aliases
    tool: 'select',
    selectedIds: [],

    // Actions
    selectElement: (id, addToSelection = false) =>
        set((state) => ({
            selectedElementIds: addToSelection
                ? [...state.selectedElementIds, id]
                : [id],
            selectedIds: addToSelection
                ? [...state.selectedElementIds, id]
                : [id],
        })),

    deselectElement: (id) =>
        set((state) => ({
            selectedElementIds: state.selectedElementIds.filter((eid) => eid !== id),
            selectedIds: state.selectedElementIds.filter((eid) => eid !== id),
        })),

    clearSelection: () => set({ selectedElementIds: [], selectedIds: [] }),

    selectAll: () =>
        set((state) => {
            const allIds = [
                ...state.walls.map((w) => w.id),
                ...state.rooms.map((r) => r.id),
                ...state.dimensions.map((d) => d.id),
                ...state.annotations.map((a) => a.id),
                ...state.sketches.map((s) => s.id),
                ...state.symbols.map((s) => s.id),
            ];
            return {
                selectedElementIds: allIds,
                selectedIds: allIds,
            };
        }),

    setHoveredElement: (id) => set({ hoveredElementId: id }),

    deleteSelectedElements: () => {
        const { selectedElementIds, walls, rooms, dimensions, annotations, sketches, symbols } = get();
        const wallIdSet = new Set(walls.map((wall) => wall.id));
        const roomById = new Map(rooms.map((room) => [room.id, room]));
        const wallUsageCount = new Map<string, number>();

        rooms.forEach((room) => {
            room.wallIds.forEach((wallId) => {
                wallUsageCount.set(wallId, (wallUsageCount.get(wallId) ?? 0) + 1);
            });
        });

        const explicitlySelectedWallIds = new Set(
            selectedElementIds.filter((id) => wallIdSet.has(id))
        );
        const selectedRoomIds = selectedElementIds.filter((id) => roomById.has(id));
        const roomDerivedWallIds = new Set<string>();

        selectedRoomIds.forEach((roomId) => {
            const room = roomById.get(roomId);
            if (!room) return;
            room.wallIds.forEach((wallId) => {
                if (explicitlySelectedWallIds.has(wallId)) {
                    roomDerivedWallIds.add(wallId);
                    return;
                }
                const usageCount = wallUsageCount.get(wallId) ?? 0;
                if (usageCount <= 1) {
                    roomDerivedWallIds.add(wallId);
                }
            });
        });

        const wallIdsToRemove = new Set([...explicitlySelectedWallIds, ...roomDerivedWallIds]);

        set({
            walls: walls.filter((wall) => !wallIdsToRemove.has(wall.id)),
            rooms: rooms.filter((room) => !selectedElementIds.includes(room.id)),
            dimensions: dimensions.filter((d) => !selectedElementIds.includes(d.id)),
            annotations: annotations.filter((a) => !selectedElementIds.includes(a.id)),
            sketches: sketches.filter((s) => !selectedElementIds.includes(s.id)),
            symbols: symbols.filter((s) => !selectedElementIds.includes(s.id)),
            selectedElementIds: [],
            selectedIds: [],
        });
        get().saveToHistory('Delete selected elements');
    },

    setActiveTool: (tool) =>
        set({
            activeTool: tool,
            tool,
            selectedElementIds: [],
            selectedIds: [],
        }),

    setActiveLayer: (id) => set({ activeLayerId: id }),

    // Aliases
    setSelectedIds: (ids) => set({ selectedElementIds: ids, selectedIds: ids }),
    deleteSelected: () => get().deleteSelectedElements(),
    setTool: (tool) => get().setActiveTool(tool),
});
