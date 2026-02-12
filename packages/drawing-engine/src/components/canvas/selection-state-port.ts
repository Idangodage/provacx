/**
 * Selection State Port
 *
 * Dependency-inversion boundary used by interaction hooks.
 * Keeps store implementation details outside interaction logic.
 */

import type { Room2D, Wall2D } from '../../types';

export interface SelectionStatePort {
    getSelectedIds: () => string[];
    setSelectedIds: (ids: string[]) => void;
    setWallRoomState: (walls: Wall2D[], rooms: Room2D[]) => void;
    saveToHistory: (action: string) => void;
}
