/**
 * useRoomTool Hook
 *
 * Handles room drawing shortcut: click to set corner, configure, create 4 walls.
 */

import { useState, useCallback } from 'react';

import type { Point2D, RoomConfig } from '../../../types';
import { DEFAULT_ROOM_CONFIG } from '../../../types/wall';
import { snapToGrid } from '../wall/WallSnapping';

// =============================================================================
// Types
// =============================================================================

export interface UseRoomToolOptions {
  gridSize: number;
  createRoomWalls: (config: RoomConfig, startCorner: Point2D) => string[];
  onRoomCreated?: (wallIds: string[]) => void;
}

export interface UseRoomToolResult {
  showConfigPopup: boolean;
  roomConfig: RoomConfig;
  startCorner: Point2D | null;
  handleMouseDown: (scenePoint: Point2D) => void;
  setRoomConfig: (config: Partial<RoomConfig>) => void;
  confirmRoomCreation: () => void;
  cancelRoomCreation: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useRoomTool({
  gridSize,
  createRoomWalls,
  onRoomCreated,
}: UseRoomToolOptions): UseRoomToolResult {
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [startCorner, setStartCorner] = useState<Point2D | null>(null);
  const [roomConfig, setRoomConfigState] = useState<RoomConfig>({
    ...DEFAULT_ROOM_CONFIG,
  });

  /**
   * Handle mouse down - set starting corner
   */
  const handleMouseDown = useCallback(
    (scenePoint: Point2D) => {
      // Snap to grid
      const snapped = snapToGrid(scenePoint, gridSize);
      setStartCorner(snapped);
      setShowConfigPopup(true);
    },
    [gridSize]
  );

  /**
   * Update room configuration
   */
  const setRoomConfig = useCallback((config: Partial<RoomConfig>) => {
    setRoomConfigState((prev) => ({ ...prev, ...config }));
  }, []);

  /**
   * Confirm and create room walls
   */
  const confirmRoomCreation = useCallback(() => {
    if (!startCorner) return;

    const wallIds = createRoomWalls(roomConfig, startCorner);

    if (wallIds.length === 4) {
      onRoomCreated?.(wallIds);
    }

    // Reset state
    setShowConfigPopup(false);
    setStartCorner(null);
  }, [startCorner, roomConfig, createRoomWalls, onRoomCreated]);

  /**
   * Cancel room creation
   */
  const cancelRoomCreation = useCallback(() => {
    setShowConfigPopup(false);
    setStartCorner(null);
  }, []);

  return {
    showConfigPopup,
    roomConfig,
    startCorner,
    handleMouseDown,
    setRoomConfig,
    confirmRoomCreation,
    cancelRoomCreation,
  };
}
