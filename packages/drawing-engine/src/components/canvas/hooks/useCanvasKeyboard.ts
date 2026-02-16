/**
 * useCanvasKeyboard Hook
 *
 * Handles keyboard events for the drawing canvas including:
 * - Space key for panning mode
 * - Escape for canceling current operation
 * - Delete/Backspace for deleting selected elements
 * - Arrow keys for nudging selected elements
 * - Ctrl+D for duplicating selected elements
 */

import { useEffect } from 'react';

import type { DrawingTool, Point2D } from '../../../types';
import { isEditableElement } from '../toolUtils';

export interface UseCanvasKeyboardOptions {
    tool: DrawingTool;
    selectedIds: string[];
    deleteSelected: () => void;
    setIsSpacePressed: (pressed: boolean) => void;
    nudgeSelected?: (delta: Point2D) => void;
    duplicateSelected?: () => void;
    cancelOperation?: () => void;
    gridSize?: number;
}

export function useCanvasKeyboard({
    selectedIds,
    deleteSelected,
    setIsSpacePressed,
    nudgeSelected,
    duplicateSelected,
    cancelOperation,
    gridSize = 100,
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

    // Combined key handler for Delete, Arrow keys, Ctrl+D, Escape
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (isEditableElement(event.target)) return;

            // Delete/Backspace - delete selected
            if (event.key === 'Delete' || event.key === 'Backspace') {
                if (selectedIds.length === 0) return;
                event.preventDefault();
                deleteSelected();
                return;
            }

            // Escape - cancel operation
            if (event.key === 'Escape') {
                event.preventDefault();
                cancelOperation?.();
                return;
            }

            // Ctrl+D - duplicate selected
            if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
                if (selectedIds.length === 0) return;
                event.preventDefault();
                duplicateSelected?.();
                return;
            }

            // Arrow keys - nudge selected
            if (event.key.startsWith('Arrow') && selectedIds.length > 0 && nudgeSelected) {
                event.preventDefault();

                // Shift modifier for larger nudge
                const nudgeAmount = event.shiftKey ? gridSize : gridSize / 10;

                let delta: Point2D;
                switch (event.key) {
                    case 'ArrowUp':
                        delta = { x: 0, y: nudgeAmount };
                        break;
                    case 'ArrowDown':
                        delta = { x: 0, y: -nudgeAmount };
                        break;
                    case 'ArrowLeft':
                        delta = { x: -nudgeAmount, y: 0 };
                        break;
                    case 'ArrowRight':
                        delta = { x: nudgeAmount, y: 0 };
                        break;
                    default:
                        return;
                }

                nudgeSelected(delta);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectedIds, deleteSelected, nudgeSelected, duplicateSelected, cancelOperation, gridSize]);
}
