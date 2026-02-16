/**
 * useWallTool Hook
 *
 * Handles wall drawing interactions: click to start, move to preview, click to commit.
 * Supports chain mode, snapping, and angle locking.
 */

import type { Canvas as FabricCanvas } from 'fabric';
import { useRef, useCallback, useEffect } from 'react';

import type { Point2D, Wall, WallSettings, WallDrawingState } from '../../../types';
import { WallManager } from '../wall/WallManager';
import { WallPreview } from '../wall/WallPreview';
import { WallRenderer } from '../wall/WallRenderer';
import { snapWallPoint } from '../wall/WallSnapping';

// =============================================================================
// Types
// =============================================================================

export interface UseWallToolOptions {
  fabricRef: React.RefObject<FabricCanvas | null>;
  canvas: FabricCanvas | null;  // Direct canvas reference for reactivity
  walls: Wall[];
  wallDrawingState: WallDrawingState;
  wallSettings: WallSettings;
  zoom: number;
  pageHeight: number;
  scaleRatio: number;  // scaleReal / scaleDrawing (e.g., 50 for 1:50 scale) - converts paper to real-world
  startWallDrawing: (startPoint: Point2D) => void;
  updateWallPreview: (currentPoint: Point2D) => void;
  commitWall: () => string | null;
  cancelWallDrawing: () => void;
  connectWalls: (wallId: string, otherWallId: string) => void;
  onWallCreated?: (wallId: string) => void;
}

export interface UseWallToolResult {
  wallRenderer: WallRenderer | null;
  wallPreview: WallPreview | null;
  wallManager: WallManager | null;
  handleMouseDown: (scenePoint: Point2D) => void;
  handleMouseMove: (scenePoint: Point2D) => void;
  handleDoubleClick: () => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  handleKeyUp: (e: KeyboardEvent) => void;
  isDrawing: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useWallTool({
  fabricRef,
  canvas,
  walls,
  wallDrawingState,
  wallSettings,
  zoom,
  pageHeight,
  scaleRatio,
  startWallDrawing,
  updateWallPreview,
  commitWall,
  cancelWallDrawing,
  connectWalls,
  onWallCreated,
}: UseWallToolOptions): UseWallToolResult {
  // Refs for instances
  const wallRendererRef = useRef<WallRenderer | null>(null);
  const wallPreviewRef = useRef<WallPreview | null>(null);
  const wallManagerRef = useRef<WallManager | null>(null);
  const shiftPressedRef = useRef(false);
  const lastSnappedWallRef = useRef<{ wallId: string; endpoint: 'start' | 'end' } | null>(null);

  // Initialize instances when canvas is available
  useEffect(() => {
    if (!canvas) return;

    // Create instances if not already created
    if (!wallRendererRef.current) {
      wallRendererRef.current = new WallRenderer(canvas, pageHeight, scaleRatio);
    }
    if (!wallPreviewRef.current) {
      wallPreviewRef.current = new WallPreview(canvas, pageHeight, scaleRatio);
    }
    if (!wallManagerRef.current) {
      wallManagerRef.current = new WallManager();
    }

    // Update page height and scale
    wallRendererRef.current.setPageHeight(pageHeight);
    wallRendererRef.current.setScaleRatio(scaleRatio);
    wallPreviewRef.current.setPageHeight(pageHeight);
    wallPreviewRef.current.setScaleRatio(scaleRatio);

    // Cleanup
    return () => {
      wallPreviewRef.current?.dispose();
      wallRendererRef.current?.dispose();
    };
  }, [canvas, pageHeight, scaleRatio]);

  // Update wall manager when walls change
  useEffect(() => {
    if (wallManagerRef.current) {
      wallManagerRef.current.setWalls(walls);
    }
  }, [walls]);

  // Update renderer when walls change
  useEffect(() => {
    if (wallRendererRef.current && fabricRef.current) {
      wallRendererRef.current.renderAllWalls(walls);
    }
  }, [walls, fabricRef]);

  // Update center lines visibility
  useEffect(() => {
    if (wallRendererRef.current) {
      wallRendererRef.current.setShowCenterLines(wallSettings.showCenterLines);
    }
  }, [wallSettings.showCenterLines]);

  // Clear preview when wall drawing is cancelled (e.g., via Escape key)
  useEffect(() => {
    if (!wallDrawingState.isDrawing && wallPreviewRef.current) {
      wallPreviewRef.current.clearPreview();
      lastSnappedWallRef.current = null;
    }
  }, [wallDrawingState.isDrawing]);

  /**
   * Handle mouse down - start wall or commit current wall
   */
  const handleMouseDown = useCallback(
    (scenePoint: Point2D) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      // Snap the point
      const snapResult = snapWallPoint(
        scenePoint,
        wallDrawingState.startPoint,
        wallSettings,
        walls,
        shiftPressedRef.current,
        zoom
      );

      if (!wallDrawingState.isDrawing) {
        // First click: start wall drawing
        startWallDrawing(snapResult.snappedPoint);

        // Track if we snapped to an endpoint
        if (snapResult.snapType === 'endpoint' && snapResult.connectedWallId) {
          lastSnappedWallRef.current = {
            wallId: snapResult.connectedWallId,
            endpoint: snapResult.endpoint!,
          };
        } else {
          lastSnappedWallRef.current = null;
        }

        // Start preview
        wallPreviewRef.current?.startPreview(
          snapResult.snappedPoint,
          wallSettings.defaultThickness,
          wallSettings.defaultMaterial
        );
      } else {
        // Second click: commit wall
        updateWallPreview(snapResult.snappedPoint);

        // Check for endpoint connection at end point
        const endSnapResult = snapWallPoint(
          scenePoint,
          wallDrawingState.startPoint,
          wallSettings,
          walls,
          shiftPressedRef.current,
          zoom
        );

        const newWallId = commitWall();

        if (newWallId) {
          // Connect to start-point snapped wall if any
          if (lastSnappedWallRef.current) {
            connectWalls(newWallId, lastSnappedWallRef.current.wallId);
          }

          // Connect to end-point snapped wall if any
          if (endSnapResult.snapType === 'endpoint' && endSnapResult.connectedWallId) {
            connectWalls(newWallId, endSnapResult.connectedWallId);
          }

          onWallCreated?.(newWallId);

          // If chain mode, update preview for next wall
          if (wallDrawingState.chainMode) {
            // In chain mode, the next wall will start from this wall's end point
            // Remember this wall so the next wall will be connected to it
            lastSnappedWallRef.current = {
              wallId: newWallId,
              endpoint: 'end',
            };

            wallPreviewRef.current?.startPreview(
              snapResult.snappedPoint,
              wallSettings.defaultThickness,
              wallSettings.defaultMaterial
            );
          } else {
            // Not in chain mode - clear the snap reference
            if (endSnapResult.snapType === 'endpoint' && endSnapResult.connectedWallId) {
              lastSnappedWallRef.current = {
                wallId: endSnapResult.connectedWallId,
                endpoint: endSnapResult.endpoint!,
              };
            } else {
              lastSnappedWallRef.current = null;
            }
            wallPreviewRef.current?.clearPreview();
          }
        }
      }
    },
    [
      fabricRef,
      wallDrawingState,
      wallSettings,
      walls,
      zoom,
      startWallDrawing,
      updateWallPreview,
      commitWall,
      connectWalls,
      onWallCreated,
    ]
  );

  /**
   * Handle mouse move - update preview
   */
  const handleMouseMove = useCallback(
    (scenePoint: Point2D) => {
      if (!wallDrawingState.isDrawing) return;

      // Snap the point
      const snapResult = snapWallPoint(
        scenePoint,
        wallDrawingState.startPoint,
        wallSettings,
        walls,
        shiftPressedRef.current,
        zoom
      );

      // Update state
      updateWallPreview(snapResult.snappedPoint);

      // Update visual preview
      wallPreviewRef.current?.updatePreview(snapResult.snappedPoint);
    },
    [wallDrawingState, wallSettings, walls, zoom, updateWallPreview]
  );

  /**
   * Handle double click - exit chain mode
   */
  const handleDoubleClick = useCallback(() => {
    if (wallDrawingState.isDrawing) {
      cancelWallDrawing();
      wallPreviewRef.current?.clearPreview();
      lastSnappedWallRef.current = null;
    }
  }, [wallDrawingState.isDrawing, cancelWallDrawing]);

  /**
   * Handle key down - Shift for angle lock, Escape to cancel
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftPressedRef.current = true;
      }
      if (e.key === 'Escape') {
        cancelWallDrawing();
        wallPreviewRef.current?.clearPreview();
        lastSnappedWallRef.current = null;
      }
    },
    [cancelWallDrawing]
  );

  /**
   * Handle key up - release Shift
   */
  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      shiftPressedRef.current = false;
    }
  }, []);

  return {
    wallRenderer: wallRendererRef.current,
    wallPreview: wallPreviewRef.current,
    wallManager: wallManagerRef.current,
    handleMouseDown,
    handleMouseMove,
    handleDoubleClick,
    handleKeyDown,
    handleKeyUp,
    isDrawing: wallDrawingState.isDrawing,
  };
}
