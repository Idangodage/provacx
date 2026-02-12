/**
 * Wall Edit Commands
 *
 * Command pattern utilities for wall/room graph editing operations.
 */

import type { Room2D, Wall2D } from '../../types';
import { detectRoomsFromWallGraph, validateNestedRooms } from '../../utils/room-detection';

import { deriveNestedRelationWarnings } from './geometry';
import { validateRoomPolygonTopology } from './room-polygon-validation';

export interface WallEditCommand {
    execute: () => void;
}

export interface WallEditCommandContext {
    getWalls: () => Wall2D[];
    getRooms: () => Room2D[];
    setGraphState: (walls: Wall2D[], rooms: Room2D[]) => void;
    setSelectedIds: (ids: string[]) => void;
    saveToHistory: (action: string) => void;
    notifyValidation: (messages: string[], title: string, blocking?: boolean) => void;
}

export interface WallEditFinalizePayload {
    wallId: string;
    selectionIds?: string[];
    action?: string;
    originalWalls: Wall2D[];
    originalRooms: Room2D[];
}

function cloneWalls(walls: Wall2D[]): Wall2D[] {
    return walls.map((wall) => ({
        ...wall,
        start: { ...wall.start },
        end: { ...wall.end },
        openings: wall.openings.map((opening) => ({ ...opening })),
        connectedWallIds: wall.connectedWallIds ? [...wall.connectedWallIds] : undefined,
        wallLayers: wall.wallLayers?.map((layer) => ({ ...layer })),
    }));
}

function cloneRooms(rooms: Room2D[]): Room2D[] {
    return rooms.map((room) => ({
        ...room,
        vertices: room.vertices.map((vertex) => ({ ...vertex })),
        wallIds: [...room.wallIds],
        childRoomIds: [...room.childRoomIds],
    }));
}

export class ApplyTransientWallGraphCommand implements WallEditCommand {
    public constructor(
        private readonly context: WallEditCommandContext,
        private readonly nextWalls: Wall2D[],
        private readonly selectedIds: string[] = []
    ) {}

    public execute(): void {
        const nextRooms = detectRoomsFromWallGraph(this.nextWalls, this.context.getRooms());
        const clonedWalls = cloneWalls(this.nextWalls);
        const clonedRooms = cloneRooms(nextRooms);
        this.context.setGraphState(clonedWalls, clonedRooms);
        if (this.selectedIds.length > 0) {
            this.context.setSelectedIds(this.selectedIds);
        }
    }
}

export class RevertWallEditCommand implements WallEditCommand {
    public constructor(
        private readonly context: WallEditCommandContext,
        private readonly originalWalls: Wall2D[],
        private readonly originalRooms: Room2D[],
        private readonly selectionIds: string[]
    ) {}

    public execute(): void {
        this.context.setGraphState(cloneWalls(this.originalWalls), cloneRooms(this.originalRooms));
        this.context.setSelectedIds([...this.selectionIds]);
    }
}

export class FinalizeWallEditCommand implements WallEditCommand {
    public constructor(
        private readonly context: WallEditCommandContext,
        private readonly payload: WallEditFinalizePayload
    ) {}

    public execute(): void {
        const currentRooms = this.context.getRooms();
        const topologyValidation = validateRoomPolygonTopology(currentRooms);
        if (topologyValidation.errors.length > 0) {
            this.context.notifyValidation(
                topologyValidation.errors,
                'Invalid room topology. Reverting changes:',
                true
            );
            const rollbackCommand = new RevertWallEditCommand(
                this.context,
                this.payload.originalWalls,
                this.payload.originalRooms,
                this.payload.selectionIds && this.payload.selectionIds.length > 0
                    ? this.payload.selectionIds
                    : [this.payload.wallId]
            );
            rollbackCommand.execute();
            return;
        }

        const validation = validateNestedRooms(currentRooms);
        if (validation.errors.length > 0) {
            this.context.notifyValidation(
                validation.errors,
                'Invalid room edit. Reverting changes:',
                true
            );
            const rollbackCommand = new RevertWallEditCommand(
                this.context,
                this.payload.originalWalls,
                this.payload.originalRooms,
                this.payload.selectionIds && this.payload.selectionIds.length > 0
                    ? this.payload.selectionIds
                    : [this.payload.wallId]
            );
            rollbackCommand.execute();
            return;
        }

        const relationWarnings = deriveNestedRelationWarnings(this.payload.originalRooms, currentRooms);
        const warnings = [...topologyValidation.warnings, ...validation.warnings, ...relationWarnings];
        if (warnings.length > 0) {
            this.context.notifyValidation(warnings, 'Room warning:');
        }

        this.context.saveToHistory(this.payload.action ?? 'Edit wall');
    }
}
