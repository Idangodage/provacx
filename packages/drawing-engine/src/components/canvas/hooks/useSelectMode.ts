/**
 * useSelectMode Hook
 *
 * Handles selection mode interactions for fabric objects on the canvas.
 */

import type { Canvas as FabricCanvas, Object as FabricObject } from 'fabric';
import { useRef, useCallback } from 'react';

export interface UseSelectModeOptions {
    fabricRef: React.RefObject<FabricCanvas | null>;
    setSelectedIds: (ids: string[]) => void;
    setHoveredElement: (id: string | null) => void;
    originOffset: { x: number; y: number };
}

interface TargetMeta {
    name?: string;
    id?: string;
    wallId?: string;   // Set by WallRenderer
    roomId?: string;   // Set by RoomRenderer
    handleId?: string; // Set by HandleRenderer
    elementId?: string; // Set by HandleRenderer (parent element ID)
}

export function useSelectMode({
    setSelectedIds,
    setHoveredElement,
}: UseSelectModeOptions) {
    const isWallHandleDraggingRef = useRef(false);

    const getTargetMeta = useCallback((target: FabricObject | undefined | null): TargetMeta => {
        if (!target) return {};
        const typed = target as unknown as TargetMeta;
        return {
            name: typed?.name,
            id: typed?.id,
            wallId: typed?.wallId,
            roomId: typed?.roomId,
            handleId: typed?.handleId,
            elementId: typed?.elementId,
        };
    }, []);

    const updateSelectionFromTarget = useCallback(
        (target: FabricObject | undefined | null) => {
            const meta = getTargetMeta(target);
            // Priority: handleId's elementId > wallId > roomId > id
            const elementId = meta.elementId || meta.wallId || meta.roomId || meta.id;
            if (elementId) {
                setSelectedIds([elementId]);
                return;
            }
            if (!target) {
                setSelectedIds([]);
            }
        },
        [getTargetMeta, setSelectedIds]
    );

    const finalizeHandleDrag = useCallback(() => {
        isWallHandleDraggingRef.current = false;
    }, []);

    const handleObjectMoving = useCallback(
        (_target: FabricObject) => {
            // No-op: wall handle drag logic removed
        },
        []
    );

    const handleDoubleClick = useCallback(
        (_event: MouseEvent) => {
            return false;
        },
        []
    );

    const handleMouseDown = useCallback(
        (target: FabricObject | undefined | null, _scenePoint: { x: number; y: number }) => {
            updateSelectionFromTarget(target);
        },
        [updateSelectionFromTarget]
    );

    const handleRoomHover = useCallback(
        (_point: { x: number; y: number }, _viewportPoint: { x: number; y: number }) => {
            setHoveredElement(null);
        },
        [setHoveredElement]
    );

    return {
        isWallHandleDraggingRef,
        getTargetMeta,
        updateSelectionFromTarget,
        finalizeHandleDrag,
        handleObjectMoving,
        handleDoubleClick,
        handleMouseDown,
        handleRoomHover,
    };
}
