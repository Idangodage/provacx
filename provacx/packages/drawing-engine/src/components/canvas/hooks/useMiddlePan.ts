/**
 * useMiddlePan Hook
 *
 * Handles middle mouse button panning for the canvas.
 */

import { useRef, useCallback } from 'react';

import type { Point2D } from '../../../types';

export interface MiddlePanState {
    active: boolean;
    lastX: number;
    lastY: number;
}

export interface UseMiddlePanOptions {
    zoomRef: React.MutableRefObject<number>;
    panOffsetRef: React.MutableRefObject<Point2D>;
    setPanOffset: (offset: Point2D) => void;
    setCanvasState: React.Dispatch<React.SetStateAction<{
        isPanning: boolean;
        lastPanPoint: Point2D | null;
        isDrawing: boolean;
        drawingPoints: Point2D[];
    }>>;
    canvasStateRef: React.MutableRefObject<{
        isPanning: boolean;
        lastPanPoint: Point2D | null;
        isDrawing: boolean;
        drawingPoints: Point2D[];
    }>;
}

export function useMiddlePan({
    zoomRef,
    panOffsetRef,
    setPanOffset,
    setCanvasState,
    canvasStateRef,
}: UseMiddlePanOptions) {
    const middlePanRef = useRef<MiddlePanState>({
        active: false,
        lastX: 0,
        lastY: 0,
    });

    const stopMiddlePan = useCallback(() => {
        if (!middlePanRef.current.active) return;
        middlePanRef.current.active = false;
        const nextState = {
            ...canvasStateRef.current,
            isPanning: false,
            lastPanPoint: null,
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
    }, [canvasStateRef, setCanvasState]);

    const handleMiddleMouseDown = useCallback(
        (event: MouseEvent) => {
            if (event.button !== 1) return;
            event.preventDefault();
            middlePanRef.current = {
                active: true,
                lastX: event.clientX,
                lastY: event.clientY,
            };
            const nextState = {
                ...canvasStateRef.current,
                isPanning: true,
                lastPanPoint: { x: event.clientX, y: event.clientY },
            };
            canvasStateRef.current = nextState;
            setCanvasState(nextState);
        },
        [canvasStateRef, setCanvasState]
    );

    const handleMiddleMouseMove = useCallback(
        (event: MouseEvent) => {
            if (!middlePanRef.current.active) return;
            if ((event.buttons & 4) !== 4) {
                stopMiddlePan();
                return;
            }
            event.preventDefault();

            const dx = event.clientX - middlePanRef.current.lastX;
            const dy = event.clientY - middlePanRef.current.lastY;

            middlePanRef.current.lastX = event.clientX;
            middlePanRef.current.lastY = event.clientY;

            const nextPan = {
                x: panOffsetRef.current.x - dx / zoomRef.current,
                y: panOffsetRef.current.y - dy / zoomRef.current,
            };
            panOffsetRef.current = nextPan;
            setPanOffset(nextPan);
        },
        [zoomRef, panOffsetRef, setPanOffset, stopMiddlePan]
    );

    const handleMiddleMouseUp = useCallback(
        (event: MouseEvent) => {
            if (event.button !== 1 && !middlePanRef.current.active) return;
            stopMiddlePan();
        },
        [stopMiddlePan]
    );

    const preventMiddleAuxClick = useCallback((event: MouseEvent) => {
        if (event.button === 1) {
            event.preventDefault();
        }
    }, []);

    return {
        middlePanRef,
        stopMiddlePan,
        handleMiddleMouseDown,
        handleMiddleMouseMove,
        handleMiddleMouseUp,
        preventMiddleAuxClick,
    };
}
