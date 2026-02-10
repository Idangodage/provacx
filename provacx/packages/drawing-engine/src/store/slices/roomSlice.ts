/**
 * Room Slice
 * 
 * Domain-specific slice for room state and actions.
 * Uses Zustand slice pattern for composition.
 */

import type { StateCreator } from 'zustand';

import type { Room2D, Wall2D } from '../../types';
import { applyNestedRoomHierarchy, detectRoomsFromWallGraph } from '../../utils/room-detection';
import { sortRoomsForDisplay } from '../helpers';

// =============================================================================
// Types
// =============================================================================

export interface RoomSliceState {
    rooms: Room2D[];
}

export interface RoomSliceActions {
    addRoom: (
        room: Omit<
            Room2D,
            | 'id'
            | 'area'
            | 'perimeter'
            | 'grossArea'
            | 'netArea'
            | 'parentRoomId'
            | 'childRoomIds'
            | 'roomType'
        >
    ) => string;
    updateRoom: (id: string, data: Partial<Room2D>) => void;
    reparentRoom: (roomId: string, parentRoomId: string | null) => boolean;
    deleteRoom: (id: string) => void;
    detectRoomsFromWalls: () => void;
}

export type RoomSlice = RoomSliceState & RoomSliceActions;

// =============================================================================
// Slice Dependencies Interface
// =============================================================================

interface SliceDependencies {
    walls: Wall2D[];
    saveToHistory: (action: string) => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createRoomSlice: StateCreator<
    RoomSlice & SliceDependencies,
    [],
    [],
    RoomSlice
> = (set, get) => ({
    // Initial State
    rooms: [],

    // Actions
    addRoom: (_room) => {
        const { walls, rooms } = get();
        const derivedRooms = detectRoomsFromWallGraph(walls, rooms);
        set({ rooms: derivedRooms });
        return derivedRooms[0]?.id ?? '';
    },

    updateRoom: (id, data) => {
        // Extract derived properties that shouldn't be manually updated
        const {
            vertices: _v,
            wallIds: _w,
            area: _a,
            perimeter: _p,
            grossArea: _g,
            netArea: _n,
            parentRoomId: _pr,
            childRoomIds: _c,
            roomType: _r,
            ...allowed
        } = data;

        set((state) => {
            const updatedRooms = state.rooms.map((room): Room2D =>
                room.id === id ? { ...room, ...allowed } : room
            );
            return {
                rooms: sortRoomsForDisplay(applyNestedRoomHierarchy(updatedRooms)),
            };
        });
        get().saveToHistory('Update room');
    },

    reparentRoom: (roomId, parentRoomId) => {
        const { rooms } = get();
        const room = rooms.find((r) => r.id === roomId);
        if (!room) return false;

        if (parentRoomId) {
            const parent = rooms.find((r) => r.id === parentRoomId);
            if (!parent) return false;
            if (room.childRoomIds.includes(parentRoomId)) return false;
        }

        set((state) => {
            // First pass: remove from old parent
            let updatedRooms: Room2D[] = state.rooms.map((r): Room2D => {
                if (r.id === room.parentRoomId) {
                    return {
                        ...r,
                        childRoomIds: r.childRoomIds.filter((cid) => cid !== roomId),
                    };
                }
                return r;
            });

            // Second pass: update target room and add to new parent
            updatedRooms = updatedRooms.map((r): Room2D => {
                if (r.id === roomId) {
                    return { ...r, parentRoomId: parentRoomId };
                }
                if (parentRoomId && r.id === parentRoomId) {
                    return {
                        ...r,
                        childRoomIds: [...r.childRoomIds, roomId],
                    };
                }
                return r;
            });

            return {
                rooms: sortRoomsForDisplay(applyNestedRoomHierarchy(updatedRooms)),
            };
        });
        get().saveToHistory('Reparent room');
        return true;
    },

    deleteRoom: (id) => {
        set((state) => {
            const targetRoom = state.rooms.find((r) => r.id === id);
            if (!targetRoom) return state;

            let updatedRooms: Room2D[] = state.rooms.filter((r) => r.id !== id);

            // Remove from parent's children
            if (targetRoom.parentRoomId) {
                updatedRooms = updatedRooms.map((r): Room2D =>
                    r.id === targetRoom.parentRoomId
                        ? { ...r, childRoomIds: r.childRoomIds.filter((cid) => cid !== id) }
                        : r
                );
            }

            // Clear parent from children
            updatedRooms = updatedRooms.map((r): Room2D =>
                targetRoom.childRoomIds.includes(r.id)
                    ? { ...r, parentRoomId: null }
                    : r
            );

            return {
                rooms: sortRoomsForDisplay(applyNestedRoomHierarchy(updatedRooms)),
            };
        });
        get().saveToHistory('Delete room');
    },

    detectRoomsFromWalls: () => {
        const { walls, rooms } = get();
        const derivedRooms = detectRoomsFromWallGraph(walls, rooms);
        set({ rooms: sortRoomsForDisplay(derivedRooms) });
        get().saveToHistory('Detect rooms');
    },
});
