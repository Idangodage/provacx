/**
 * useCanvasKeyboard Hook
 *
 * Handles keyboard events for the drawing canvas including:
 * - Space key for panning mode
 * - Escape for canceling current operation
 * - Delete/Backspace for deleting selected elements
 * - Alt+number shortcuts for wall types
 */

import { useEffect } from 'react';

import type { DrawingTool } from '../../../types';
import { BUILT_IN_WALL_TYPE_IDS } from '../../../utils/wall-types';
import { isEditableElement } from '../toolUtils';

export interface UseCanvasKeyboardOptions {
    tool: DrawingTool;
    roomDrawMode: 'rectangle' | 'polygon';
    selectedIds: string[];
    endWallChain: () => void;
    clearRoomPolygonState: () => void;
    deleteSelected: () => void;
    setActiveWallTypeId: (id: string) => void;
    setIsSpacePressed: (pressed: boolean) => void;
}

export function useCanvasKeyboard({
    tool,
    roomDrawMode,
    selectedIds,
    endWallChain,
    clearRoomPolygonState,
    deleteSelected,
    setActiveWallTypeId,
    setIsSpacePressed,
}: UseCanvasKeyboardOptions) {
    // Space key for panning
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== 'Space' || event.repeat || isEditableElement(event.target)) return;
            event.preventDefault();
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === 'Space') {
                setIsSpacePressed(false);
            }
        };

        const clearSpacePan = () => setIsSpacePressed(false);

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', clearSpacePan);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', clearSpacePan);
        };
    }, [setIsSpacePressed]);

    // Escape key handler
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (tool === 'wall') {
                event.preventDefault();
                endWallChain();
                return;
            }
            if (tool === 'room' && roomDrawMode === 'polygon') {
                event.preventDefault();
                clearRoomPolygonState();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => {
            window.removeEventListener('keydown', handleEscape);
        };
    }, [tool, roomDrawMode, endWallChain, clearRoomPolygonState]);

    // Delete/Backspace key handler
    useEffect(() => {
        const handleDeleteKey = (event: KeyboardEvent) => {
            if (event.key !== 'Delete' && event.key !== 'Backspace') return;
            if (isEditableElement(event.target)) return;
            if (selectedIds.length === 0) return;
            event.preventDefault();
            deleteSelected();
        };

        window.addEventListener('keydown', handleDeleteKey);
        return () => {
            window.removeEventListener('keydown', handleDeleteKey);
        };
    }, [selectedIds, deleteSelected]);

    // Alt+number wall type shortcuts
    useEffect(() => {
        const handleWallTypeShortcut = (event: KeyboardEvent) => {
            if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (isEditableElement(event.target)) return;
            const keyIndex = Number.parseInt(event.key, 10);
            if (!Number.isFinite(keyIndex) || keyIndex < 1 || keyIndex > BUILT_IN_WALL_TYPE_IDS.length) {
                return;
            }
            const wallTypeId = BUILT_IN_WALL_TYPE_IDS[keyIndex - 1];
            if (!wallTypeId) return;
            event.preventDefault();
            setActiveWallTypeId(wallTypeId);
        };

        window.addEventListener('keydown', handleWallTypeShortcut);
        return () => {
            window.removeEventListener('keydown', handleWallTypeShortcut);
        };
    }, [setActiveWallTypeId]);
}
