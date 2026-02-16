/**
 * useEditMode Hook
 *
 * Handles interactive editing mode for walls and rooms.
 * Extends selection functionality with drag editing capabilities.
 */

import { useRef, useCallback, useEffect } from 'react';
import type { Canvas as FabricCanvas, Object as FabricObject } from 'fabric';
import type { Point2D, Wall, Room } from '../../../types';
import { EditingManager } from '../editing';
import { MM_TO_PX } from '../scale';

// =============================================================================
// Types
// =============================================================================

export interface UseEditModeOptions {
  fabricRef: React.RefObject<FabricCanvas | null>;
  editingManager: EditingManager | null;
  setSelectedIds: (ids: string[]) => void;
  setHoveredElement: (id: string | null) => void;
  getSelectedIds: () => string[];
  pageHeight: number;
  scaleRatio: number;
  walls: Wall[];
  rooms: Room[];
  saveToHistory: (action: string) => void;
  detectRooms: () => void;
}

interface TargetMeta {
  name?: string;
  id?: string;
  wallId?: string;
  roomId?: string;
}

// =============================================================================
// Hook
// =============================================================================

export function useEditMode(options: UseEditModeOptions) {
  const {
    fabricRef,
    editingManager,
    setSelectedIds,
    setHoveredElement,
    getSelectedIds,
    pageHeight,
    scaleRatio,
    walls,
    rooms,
    saveToHistory,
    detectRooms,
  } = options;

  const isDraggingRef = useRef(false);
  const dragStartPointRef = useRef<Point2D | null>(null);

  // ==========================================================================
  // Coordinate Conversion
  // ==========================================================================

  const canvasToRealWorld = useCallback((canvasPoint: Point2D): Point2D => {
    const paperX = canvasPoint.x / MM_TO_PX;
    const paperY = pageHeight - canvasPoint.y / MM_TO_PX;
    return {
      x: paperX * scaleRatio,
      y: paperY * scaleRatio,
    };
  }, [pageHeight, scaleRatio]);

  // ==========================================================================
  // Target Metadata
  // ==========================================================================

  const getTargetMeta = useCallback((target: FabricObject | undefined | null): TargetMeta => {
    if (!target) return {};

    const typed = target as unknown as TargetMeta;
    return {
      name: typed?.name,
      id: typed?.id,
      wallId: typed?.wallId,
      roomId: typed?.roomId,
    };
  }, []);

  // ==========================================================================
  // Selection Handling
  // ==========================================================================

  const updateSelectionFromTarget = useCallback(
    (target: FabricObject | undefined | null, addToSelection: boolean = false) => {
      const meta = getTargetMeta(target);
      const elementId = meta.wallId || meta.roomId || meta.id;

      if (elementId) {
        if (addToSelection) {
          // Toggle selection for shift+click
          const currentIds = getSelectedIds();
          if (currentIds.includes(elementId)) {
            setSelectedIds(currentIds.filter(id => id !== elementId));
          } else {
            setSelectedIds([...currentIds, elementId]);
          }
        } else {
          setSelectedIds([elementId]);
        }

        // Update handles
        editingManager?.updateSelection(addToSelection ? getSelectedIds() : [elementId]);
        return;
      }

      if (!target) {
        setSelectedIds([]);
        editingManager?.hideAllHandles();
      }
    },
    [getTargetMeta, setSelectedIds, getSelectedIds, editingManager]
  );

  // ==========================================================================
  // Mouse Event Handlers
  // ==========================================================================

  const handleMouseDown = useCallback(
    (target: FabricObject | undefined | null, scenePoint: Point2D, shiftKey: boolean = false) => {
      if (!editingManager) {
        updateSelectionFromTarget(target, shiftKey);
        return;
      }

      const realPoint = canvasToRealWorld(scenePoint);

      // Check for handle hit first
      const hitResult = editingManager.hitTestAtPoint(scenePoint);

      if (hitResult) {
        // Start drag operation
        editingManager.startDrag(hitResult, realPoint);
        isDraggingRef.current = true;
        dragStartPointRef.current = realPoint;
        return;
      }

      // Otherwise, handle normal selection
      updateSelectionFromTarget(target, shiftKey);
    },
    [editingManager, canvasToRealWorld, updateSelectionFromTarget]
  );

  const handleMouseMove = useCallback(
    (scenePoint: Point2D) => {
      if (!editingManager || !isDraggingRef.current) return;

      const realPoint = canvasToRealWorld(scenePoint);
      editingManager.updateDrag(realPoint);
    },
    [editingManager, canvasToRealWorld]
  );

  const handleMouseUp = useCallback(() => {
    if (!editingManager || !isDraggingRef.current) return;

    editingManager.endDrag();
    isDraggingRef.current = false;
    dragStartPointRef.current = null;
  }, [editingManager]);

  const handleDoubleClick = useCallback(
    (_event: MouseEvent, _target: FabricObject | undefined | null): boolean => {
      // Future: Handle double-click for room renaming
      return false;
    },
    []
  );

  // ==========================================================================
  // Hover Handling
  // ==========================================================================

  const handleRoomHover = useCallback(
    (_point: Point2D, _viewportPoint: Point2D) => {
      setHoveredElement(null);
    },
    [setHoveredElement]
  );

  const handleObjectMoving = useCallback(
    (_target: FabricObject) => {
      // Handle Fabric.js native object moving if needed
    },
    []
  );

  // ==========================================================================
  // Keyboard Operations
  // ==========================================================================

  const nudgeSelected = useCallback(
    (delta: Point2D) => {
      if (!editingManager) return;
      editingManager.nudgeSelected(delta);
    },
    [editingManager]
  );

  const duplicateSelected = useCallback(() => {
    if (!editingManager) return [];
    return editingManager.duplicateSelected();
  }, [editingManager]);

  const deleteSelected = useCallback(() => {
    if (!editingManager) return;
    editingManager.deleteSelected();
  }, [editingManager]);

  const cancelDrag = useCallback(() => {
    if (!editingManager) return;
    editingManager.cancelDrag();
    isDraggingRef.current = false;
    dragStartPointRef.current = null;
  }, [editingManager]);

  // ==========================================================================
  // Selection Change Effect
  // ==========================================================================

  useEffect(() => {
    if (!editingManager) return;

    const selectedIds = getSelectedIds();
    editingManager.updateSelection(selectedIds);
  }, [editingManager, getSelectedIds]);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    // State refs
    isDraggingRef,

    // Selection
    getTargetMeta,
    updateSelectionFromTarget,

    // Mouse handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
    handleRoomHover,
    handleObjectMoving,

    // Keyboard operations
    nudgeSelected,
    duplicateSelected,
    deleteSelected,
    cancelDrag,
  };
}
