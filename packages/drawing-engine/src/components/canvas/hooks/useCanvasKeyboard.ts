/**
 * useCanvasKeyboard Hook
 *
 * Handles keyboard events for the drawing canvas including:
 * - Space key for panning mode
 * - Escape for canceling current operation
 * - Delete/Backspace for deleting selected elements
 */

import { useEffect } from 'react';

import type { DrawingTool } from '../../../types';
import { isEditableElement } from '../toolUtils';

export interface UseCanvasKeyboardOptions {
    tool: DrawingTool;
    selectedIds: string[];
    deleteSelected: () => void;
    setIsSpacePressed: (pressed: boolean) => void;
}

export function useCanvasKeyboard({
    selectedIds,
    deleteSelected,
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
}
