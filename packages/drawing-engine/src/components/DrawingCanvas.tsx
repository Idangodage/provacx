/**
 * Drawing Canvas Component
 * 
 * Main Fabric.js canvas wrapper for HVAC smart drawing.
 * Handles canvas initialization, rendering, and user interactions.
 */

'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import * as fabric from 'fabric';
import { useSmartDrawingStore } from '../store';
import type { Point2D, DrawingTool, Wall2D, WallType, Room2D, DisplayUnit } from '../types';
import { Grid, PageLayout, Rulers } from './canvas';
import { MM_TO_PX, PX_TO_MM } from './canvas/scale';
import { generateId } from '../utils/geometry';
import { detectRoomsFromWallGraph } from '../utils/room-detection';

// =============================================================================
// Types
// =============================================================================

export interface DrawingCanvasProps {
  className?: string;
  gridSize?: number;
  snapToGrid?: boolean;
  showGrid?: boolean;
  showRulers?: boolean;
  backgroundColor?: string;
  onCanvasReady?: (canvas: fabric.Canvas) => void;
}

interface CanvasState {
  isPanning: boolean;
  lastPanPoint: Point2D | null;
  isDrawing: boolean;
  drawingPoints: Point2D[];
}

interface WallSnapTarget {
  point: Point2D;
  type: 'endpoint' | 'midpoint' | 'segment';
  wallId: string;
  distance: number;
}

interface SceneBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface WallSpatialIndexCell {
  walls: Wall2D[];
}

type RoomDrawMode = 'rectangle' | 'polygon';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const WALL_SNAP_THRESHOLD_PX = 10;
const WALL_DEFAULT_THICKNESS_MM = 1;
const WALL_DEFAULT_HEIGHT_MM = 2700;
const WALL_DEFAULT_MATERIAL = 'concrete';
const WALL_DEFAULT_COLOR = '#6b7280';
const WALL_ENDPOINT_TOLERANCE = 0.5;
const ROOM_EDGE_OVERLAP_TOLERANCE = 0.5;
const HANDLE_HIT_RADIUS = 7;
const WALL_SPATIAL_INDEX_CELL_PX = 400;
const WALL_VIEWPORT_MARGIN_PX = 200;

// =============================================================================
// Component
// =============================================================================

export function DrawingCanvas({
  className = '',
  gridSize,
  snapToGrid,
  showGrid,
  showRulers,
  backgroundColor = 'transparent',
  onCanvasReady,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const zoomRef = useRef(1);
  const panOffsetRef = useRef<Point2D>({ x: 0, y: 0 });
  const wallsRef = useRef<Wall2D[]>([]);
  const roomsRef = useRef<Room2D[]>([]);
  const middlePanRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const wallChainStartRef = useRef<Point2D | null>(null);
  const wallChainActiveRef = useRef(false);
  const snapTargetRef = useRef<WallSnapTarget | null>(null);
  const roomPolygonPointsRef = useRef<Point2D[]>([]);
  const roomPolygonHoverRef = useRef<Point2D | null>(null);
  const wallHandleDragRef = useRef<{
    wallId: string;
    handleType: 'start' | 'end' | 'mid';
    originalWalls: Wall2D[];
    originalStart: Point2D;
    originalEnd: Point2D;
  } | null>(null);
  const isWallHandleDraggingRef = useRef(false);
  const canvasStateRef = useRef<CanvasState>({
    isPanning: false,
    lastPanPoint: null,
    isDrawing: false,
    drawingPoints: [],
  });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [mousePosition, setMousePosition] = useState<Point2D>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [roomDrawMode, setRoomDrawMode] = useState<RoomDrawMode>('rectangle');

  const [canvasState, setCanvasState] = useState<CanvasState>({
    isPanning: false,
    lastPanPoint: null,
    isDrawing: false,
    drawingPoints: [],
  });

  const {
    activeTool: tool,
    zoom,
    panOffset,
    displayUnit,
    walls,
    rooms,
    selectedElementIds: selectedIds,
    activeLayerId,
    pageConfig,
    gridSize: storeGridSize,
    showGrid: storeShowGrid,
    showRulers: storeShowRulers,
    snapToGrid: storeSnapToGrid,
    setPanOffset,
    setViewTransform,
    setSelectedIds,
    setWalls,
    addSketch,
    deleteSelected,
  } = useSmartDrawingStore();

  const resolvedGridSize = gridSize ?? storeGridSize ?? 20;
  const resolvedShowGrid = showGrid ?? storeShowGrid ?? true;
  const resolvedShowRulers = showRulers ?? storeShowRulers ?? true;
  const resolvedSnapToGrid = snapToGrid ?? storeSnapToGrid ?? true;

  const rulerSize = 24;
  const leftRulerWidth = Math.round(rulerSize * 1.2);
  const originOffset = resolvedShowRulers ? { x: leftRulerWidth, y: rulerSize } : { x: 0, y: 0 };
  const hostWidth = Math.max(1, viewportSize.width - originOffset.x);
  const hostHeight = Math.max(1, viewportSize.height - originOffset.y);
  const visibleSceneBounds = useMemo<SceneBounds>(() => {
    const safeZoom = Math.max(zoom, 0.01);
    return {
      left: panOffset.x - WALL_VIEWPORT_MARGIN_PX / safeZoom,
      top: panOffset.y - WALL_VIEWPORT_MARGIN_PX / safeZoom,
      right: panOffset.x + hostWidth / safeZoom + WALL_VIEWPORT_MARGIN_PX / safeZoom,
      bottom: panOffset.y + hostHeight / safeZoom + WALL_VIEWPORT_MARGIN_PX / safeZoom,
    };
  }, [panOffset.x, panOffset.y, zoom, hostWidth, hostHeight]);

  const wallSpatialIndex = useMemo(
    () => buildWallSpatialIndex(walls, WALL_SPATIAL_INDEX_CELL_PX),
    [walls]
  );

  // ---------------------------------------------------------------------------
  // Canvas Initialization
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!canvasRef.current || !hostRef.current || !outerRef.current) return;

    const host = hostRef.current;
    const outer = outerRef.current;
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: host.clientWidth,
      height: host.clientHeight,
      backgroundColor,
      selection: tool === 'select',
      preserveObjectStacking: true,
      enableRetinaScaling: true,
    });

    fabricRef.current = canvas;
    onCanvasReady?.(canvas);
    setViewportSize({ width: outer.clientWidth, height: outer.clientHeight });

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (entry.target === host) {
          canvas.setDimensions({ width, height });
          canvas.renderAll();
        }
        if (entry.target === outer) {
          setViewportSize({ width, height });
        }
      }
    });

    resizeObserver.observe(host);
    resizeObserver.observe(outer);

    return () => {
      resizeObserver.disconnect();
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [onCanvasReady]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.set('backgroundColor', backgroundColor);
    canvas.renderAll();
  }, [backgroundColor]);

  // ---------------------------------------------------------------------------
  // Zoom and Pan
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const viewportTransform: fabric.TMat2D = [
      zoom,
      0,
      0,
      zoom,
      -panOffset.x * zoom,
      -panOffset.y * zoom,
    ];
    canvas.setViewportTransform(viewportTransform);
    canvas.requestRenderAll();

    zoomRef.current = zoom;
    panOffsetRef.current = panOffset;
  }, [zoom, panOffset]);

  useEffect(() => {
    canvasStateRef.current = canvasState;
  }, [canvasState]);

  useEffect(() => {
    wallsRef.current = walls;
  }, [walls]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  const clearWallTransientOverlays = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    clearDrawingPreview(canvas);
    clearSnapHighlight(canvas);
  }, []);

  const clearRoomPolygonState = useCallback(() => {
    roomPolygonPointsRef.current = [];
    roomPolygonHoverRef.current = null;
    const canvas = fabricRef.current;
    if (!canvas) return;
    clearDrawingPreview(canvas);
    clearSnapHighlight(canvas);
  }, []);

  const endWallChain = useCallback(() => {
    wallChainStartRef.current = null;
    wallChainActiveRef.current = false;
    snapTargetRef.current = null;
    clearWallTransientOverlays();
  }, [clearWallTransientOverlays]);

  const commitWallSegment = useCallback(
    (
      startPoint: Point2D,
      endPoint: Point2D,
      startSnap: WallSnapTarget | null,
      endSnap: WallSnapTarget | null
    ) => {
      if (distanceBetween(startPoint, endPoint) <= 0.001) return;

      let nextWalls = [...wallsRef.current];
      const processedSplitWallIds = new Set<string>();

      [startSnap, endSnap].forEach((snapTarget) => {
        if (!snapTarget || snapTarget.type === 'endpoint') return;
        if (processedSplitWallIds.has(snapTarget.wallId)) return;

        const wallIndex = nextWalls.findIndex((wall) => wall.id === snapTarget.wallId);
        if (wallIndex < 0) return;

        const sourceWall = nextWalls[wallIndex];
        if (!sourceWall) return;
        const splitResult = splitWallAtPoint(
          sourceWall,
          snapTarget.point,
          activeLayerId ?? 'default'
        );
        if (!splitResult) return;

        nextWalls.splice(wallIndex, 1, splitResult.first, splitResult.second);
        processedSplitWallIds.add(snapTarget.wallId);
      });

      const newWall = createWallSegment(startPoint, endPoint, {
        layer: activeLayerId ?? 'default',
      });
      nextWalls.push(newWall);
      nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);

      wallsRef.current = nextWalls;
      setWalls(nextWalls, 'Draw wall');
    },
    [activeLayerId, setWalls]
  );

  const commitRoomFromVertices = useCallback(
    (vertices: Point2D[]) => {
      const normalizedVertices = normalizeRoomVertices(vertices);
      if (normalizedVertices.length < 3) return;

      const roomEdges = buildClosedPolygonEdges(normalizedVertices);
      if (roomEdges.length === 0) return;

      let nextWalls = [...wallsRef.current];
      roomEdges.forEach((edge) => {
        nextWalls = addEdgeWithWallReuse(
          nextWalls,
          edge.start,
          edge.end,
          activeLayerId ?? 'default',
          ROOM_EDGE_OVERLAP_TOLERANCE
        );
      });

      nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);
      wallsRef.current = nextWalls;
      setWalls(nextWalls, 'Draw room');
    },
    [activeLayerId, setWalls]
  );

  const applyTransientWallGraph = useCallback((nextWalls: Wall2D[]) => {
    const nextRooms = detectRoomsFromWallGraph(nextWalls, roomsRef.current);
    wallsRef.current = nextWalls;
    roomsRef.current = nextRooms;
    useSmartDrawingStore.setState({ walls: nextWalls, rooms: nextRooms });
  }, []);

  // ---------------------------------------------------------------------------
  // Tool Change Handler
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const effectiveTool = isSpacePressed ? 'pan' : tool;
    const allowSelection = effectiveTool === 'select';
    const pointerCursor = canvasState.isPanning ? 'grabbing' : getToolCursor(effectiveTool);

    canvas.selection = allowSelection;
    canvas.defaultCursor = pointerCursor;
    canvas.hoverCursor = pointerCursor;

    // Disable object selection for drawing tools
    canvas.forEachObject((obj) => {
      const objectName = (obj as unknown as { name?: string }).name;
      const isNonInteractive =
        objectName === 'drawing-preview' ||
        objectName === 'wall-snap-highlight' ||
        objectName === 'wall-dimension' ||
        objectName === 'room-tag';
      if (isNonInteractive) {
        obj.selectable = false;
        obj.evented = false;
        return;
      }
      obj.selectable = allowSelection;
      obj.evented = allowSelection;
    });

    canvas.renderAll();
  }, [tool, isSpacePressed, canvasState.isPanning]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const allowSelection = (isSpacePressed ? 'pan' : tool) === 'select';
    const wallIdSet = new Set(walls.map((wall) => wall.id));
    const selectedWallIdSet = new Set(selectedIds.filter((id) => wallIdSet.has(id)));
    const selectedRoom = rooms.find((room) => selectedIds.includes(room.id));
    const selectedRoomBoundarySet = new Set(selectedRoom?.wallIds ?? []);
    const visibleWalls = queryWallsInBounds(wallSpatialIndex, visibleSceneBounds);

    clearRenderedWalls(canvas);
    visibleWalls.forEach((wall) => {
      const { wallBody, dimensionLabel } = createWallRenderObjects(wall, displayUnit, {
        selected: selectedWallIdSet.has(wall.id) || selectedRoomBoundarySet.has(wall.id),
      });
      wallBody.selectable = allowSelection;
      wallBody.evented = allowSelection;
      dimensionLabel.selectable = false;
      dimensionLabel.evented = false;
      canvas.add(wallBody);
      canvas.add(dimensionLabel);
    });

    bringTransientOverlaysToFront(canvas);
    canvas.requestRenderAll();
  }, [walls, rooms, selectedIds, displayUnit, tool, isSpacePressed, wallSpatialIndex, visibleSceneBounds]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const allowSelection = (isSpacePressed ? 'pan' : tool) === 'select';
    const selectedRoomId = rooms.find((room) => selectedIds.includes(room.id))?.id ?? null;
    const visibleRooms = rooms.filter(
      (room) => selectedRoomId === room.id || roomIntersectsBounds(room, visibleSceneBounds)
    );

    clearRenderedRooms(canvas);
    visibleRooms.forEach((room) => {
      const { roomFill, roomTag } = createRoomRenderObjects(room, zoom, displayUnit, {
        selected: selectedRoomId === room.id,
      });
      roomFill.selectable = allowSelection;
      roomFill.evented = allowSelection;
      canvas.add(roomFill);
      canvas.sendObjectToBack(roomFill);
      roomTag.selectable = false;
      roomTag.evented = false;
      canvas.add(roomTag);
    });

    bringTransientOverlaysToFront(canvas);
    canvas.requestRenderAll();
  }, [rooms, selectedIds, zoom, displayUnit, tool, isSpacePressed, visibleSceneBounds]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (isWallHandleDraggingRef.current) return;
    clearWallHandles(canvas);

    if (tool !== 'select') {
      canvas.requestRenderAll();
      return;
    }

    const selectedWall = walls.find((wall) => selectedIds.includes(wall.id));
    if (!selectedWall) {
      canvas.requestRenderAll();
      return;
    }

    const handles = createWallHandles(selectedWall, zoom);
    handles.forEach((handle) => {
      handle.selectable = true;
      handle.evented = true;
      canvas.add(handle);
    });
    bringTransientOverlaysToFront(canvas);
    canvas.requestRenderAll();
  }, [tool, walls, selectedIds, zoom]);

  useEffect(() => {
    if (tool !== 'wall') {
      endWallChain();
    }
    if (tool !== 'room') {
      clearRoomPolygonState();
    }
  }, [tool, endWallChain, clearRoomPolygonState]);

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
  }, []);

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

  useEffect(() => {
    if (tool !== 'room') return;
    if (roomDrawMode === 'rectangle') {
      clearRoomPolygonState();
      return;
    }
    // Keep rectangle drag state clean when entering polygon mode.
    const currentState = canvasStateRef.current;
    if (currentState.isDrawing) {
      const nextState: CanvasState = {
        ...currentState,
        isDrawing: false,
        drawingPoints: [],
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
      const canvas = fabricRef.current;
      if (canvas) {
        clearDrawingPreview(canvas);
      }
    }
  }, [tool, roomDrawMode, clearRoomPolygonState]);

  // ---------------------------------------------------------------------------
  // Mouse Event Handlers
  // ---------------------------------------------------------------------------

  const handleMouseDown = useCallback(
    (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const viewportPoint = canvas.getViewportPoint(e.e);
      const scenePoint = canvas.getScenePoint(e.e);
      const point = resolvedSnapToGrid
        ? snapPointToGrid({ x: scenePoint.x, y: scenePoint.y }, resolvedGridSize)
        : { x: scenePoint.x, y: scenePoint.y };
      setMousePosition({ x: scenePoint.x, y: scenePoint.y });

      const mouseEvent = e.e as MouseEvent;
      // Middle-button panning is handled by dedicated DOM listeners.
      if ('button' in mouseEvent && mouseEvent.button === 1) {
        mouseEvent.preventDefault();
        return;
      }
      const shouldPan = tool === 'pan' || isSpacePressed;

      if (shouldPan) {
        const nextState: CanvasState = {
          ...canvasStateRef.current,
          isPanning: true,
          lastPanPoint: { x: viewportPoint.x, y: viewportPoint.y },
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
        return;
      }

      if (tool === 'room') {
        const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
        const snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
        const targetPoint = snapTarget ? snapTarget.point : point;
        if (snapTarget) {
          renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
        } else {
          clearSnapHighlight(canvas);
        }

        if (roomDrawMode === 'rectangle') {
          const nextState: CanvasState = {
            ...canvasStateRef.current,
            isDrawing: true,
            drawingPoints: [targetPoint],
          };
          canvasStateRef.current = nextState;
          setCanvasState(nextState);
          return;
        }

        const polygonPoints = roomPolygonPointsRef.current;
        const closeThreshold = snapThresholdScene;

        if (mouseEvent.detail >= 2) {
          if (polygonPoints.length >= 2) {
            const finalVertices = [...polygonPoints];
            const lastVertex = finalVertices[finalVertices.length - 1];
            if (!lastVertex || !arePointsClose(lastVertex, targetPoint, closeThreshold)) {
              finalVertices.push(targetPoint);
            }
            commitRoomFromVertices(finalVertices);
          }
          clearRoomPolygonState();
          return;
        }

        if (polygonPoints.length === 0) {
          roomPolygonPointsRef.current = [targetPoint];
          roomPolygonHoverRef.current = targetPoint;
          renderRoomPolygonPreview(canvas, roomPolygonPointsRef.current, roomPolygonHoverRef.current);
          return;
        }

        const firstPoint = polygonPoints[0];
        if (firstPoint && polygonPoints.length >= 3 && arePointsClose(firstPoint, targetPoint, closeThreshold)) {
          commitRoomFromVertices(polygonPoints);
          clearRoomPolygonState();
          return;
        }

        const lastPoint = polygonPoints[polygonPoints.length - 1];
        if (lastPoint && arePointsClose(lastPoint, targetPoint, closeThreshold)) {
          return;
        }

        const nextPolygon = [...polygonPoints, targetPoint];
        roomPolygonPointsRef.current = nextPolygon;
        roomPolygonHoverRef.current = targetPoint;
        renderRoomPolygonPreview(canvas, nextPolygon, roomPolygonHoverRef.current);
        return;
      }

      if (tool === 'wall') {
        if (mouseEvent.detail >= 2) {
          endWallChain();
          return;
        }

        const chainStart = wallChainStartRef.current;
        const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
        let snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
        let targetPoint = snapTarget ? snapTarget.point : point;

        if (chainStart && mouseEvent.shiftKey) {
          const orthogonalPoint = applyOrthogonalConstraint(chainStart, targetPoint);
          const orthogonalSnapTarget = findWallSnapTarget(
            orthogonalPoint,
            wallsRef.current,
            snapThresholdScene
          );
          if (orthogonalSnapTarget) {
            snapTarget = orthogonalSnapTarget;
            targetPoint = orthogonalSnapTarget.point;
          } else {
            snapTarget = null;
            targetPoint = orthogonalPoint;
          }
        }

        if (!chainStart) {
          wallChainStartRef.current = targetPoint;
          wallChainActiveRef.current = true;
          snapTargetRef.current = snapTarget;
          clearDrawingPreview(canvas);
          if (snapTarget) {
            renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
          } else {
            clearSnapHighlight(canvas);
          }
          return;
        }

        const segmentLength = distanceBetween(chainStart, targetPoint);
        if (segmentLength > 0.001) {
          commitWallSegment(chainStart, targetPoint, snapTargetRef.current, snapTarget);
          wallChainStartRef.current = targetPoint;
          wallChainActiveRef.current = true;
          snapTargetRef.current = snapTarget;
          clearDrawingPreview(canvas);
          if (snapTarget) {
            renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
          } else {
            clearSnapHighlight(canvas);
          }
        }
        return;
      }

      if (isDrawingTool(tool)) {
        const nextState: CanvasState = {
          ...canvasStateRef.current,
          isDrawing: true,
          drawingPoints: [point],
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
      }
    },
    [
      tool,
      roomDrawMode,
      resolvedSnapToGrid,
      resolvedGridSize,
      isSpacePressed,
      commitWallSegment,
      endWallChain,
      commitRoomFromVertices,
      clearRoomPolygonState,
    ]
  );

  const handleMouseMove = useCallback(
    (e: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
      const canvas = fabricRef.current;
      if (!canvas) return;

      const viewportPoint = canvas.getViewportPoint(e.e);
      const scenePoint = canvas.getScenePoint(e.e);
      const point = resolvedSnapToGrid
        ? snapPointToGrid({ x: scenePoint.x, y: scenePoint.y }, resolvedGridSize)
        : { x: scenePoint.x, y: scenePoint.y };
      setMousePosition({ x: scenePoint.x, y: scenePoint.y });

      const currentState = canvasStateRef.current;
      if (middlePanRef.current.active) return;

      if (currentState.isPanning && currentState.lastPanPoint) {
        const dx = viewportPoint.x - currentState.lastPanPoint.x;
        const dy = viewportPoint.y - currentState.lastPanPoint.y;

        const nextPan = {
          x: panOffsetRef.current.x - dx / zoomRef.current,
          y: panOffsetRef.current.y - dy / zoomRef.current,
        };
        panOffsetRef.current = nextPan;
        setPanOffset(nextPan);

        const nextState: CanvasState = {
          ...currentState,
          lastPanPoint: { x: viewportPoint.x, y: viewportPoint.y },
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
        return;
      }

      if (tool === 'room') {
        const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
        const snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
        const targetPoint = snapTarget ? snapTarget.point : point;

        if (snapTarget) {
          renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
        } else {
          clearSnapHighlight(canvas);
        }

        if (roomDrawMode === 'rectangle') {
          if (!currentState.isDrawing || currentState.drawingPoints.length === 0) {
            return;
          }
          const startPoint = currentState.drawingPoints[0];
          if (!startPoint) return;
          const nextState: CanvasState = {
            ...currentState,
            drawingPoints: [startPoint, targetPoint],
          };
          canvasStateRef.current = nextState;
          setCanvasState(nextState);
          renderRoomRectanglePreview(canvas, startPoint, targetPoint);
          return;
        }

        const polygonPoints = roomPolygonPointsRef.current;
        roomPolygonHoverRef.current = targetPoint;
        renderRoomPolygonPreview(canvas, polygonPoints, targetPoint);
        return;
      }

      if (tool === 'wall') {
        const chainStart = wallChainStartRef.current;
        const snapThresholdScene = WALL_SNAP_THRESHOLD_PX / Math.max(zoomRef.current, 0.01);
        let snapTarget = findWallSnapTarget(point, wallsRef.current, snapThresholdScene);
        let targetPoint = snapTarget ? snapTarget.point : point;

        const mouseEvent = e.e as MouseEvent;
        if (chainStart && mouseEvent.shiftKey) {
          const orthogonalPoint = applyOrthogonalConstraint(chainStart, targetPoint);
          const orthogonalSnapTarget = findWallSnapTarget(
            orthogonalPoint,
            wallsRef.current,
            snapThresholdScene
          );
          if (orthogonalSnapTarget) {
            snapTarget = orthogonalSnapTarget;
            targetPoint = orthogonalSnapTarget.point;
          } else {
            snapTarget = null;
            targetPoint = orthogonalPoint;
          }
        }

        if (snapTarget) {
          renderSnapHighlight(canvas, snapTarget.point, zoomRef.current);
        } else {
          clearSnapHighlight(canvas);
        }

        if (chainStart && distanceBetween(chainStart, targetPoint) > 0.001) {
          renderWallPreview(
            canvas,
            chainStart,
            targetPoint,
            WALL_DEFAULT_THICKNESS_MM,
            displayUnit
          );
        } else {
          clearDrawingPreview(canvas);
        }

        return;
      }

      if (!currentState.isDrawing) return;

      const nextPoints = [...currentState.drawingPoints, point];
      const nextState: CanvasState = {
        ...currentState,
        drawingPoints: nextPoints,
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
      renderDrawingPreview(canvas, nextPoints, tool);
    },
    [tool, roomDrawMode, resolvedSnapToGrid, resolvedGridSize, setPanOffset, displayUnit]
  );

  const handleMouseUp = useCallback(
    () => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const currentState = canvasStateRef.current;

      if (currentState.isPanning) {
        const nextState: CanvasState = {
          ...currentState,
          isPanning: false,
          lastPanPoint: null,
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
        return;
      }

      if (tool === 'room' && roomDrawMode === 'rectangle') {
        if (currentState.isDrawing && currentState.drawingPoints.length > 1) {
          const startPoint = currentState.drawingPoints[0];
          const endPoint = currentState.drawingPoints[currentState.drawingPoints.length - 1];
          if (startPoint && endPoint) {
            const vertices = buildRectangleVertices(startPoint, endPoint);
            commitRoomFromVertices(vertices);
          }
          clearDrawingPreview(canvas);
        }

        const nextState: CanvasState = {
          ...currentState,
          isDrawing: false,
          drawingPoints: [],
        };
        canvasStateRef.current = nextState;
        setCanvasState(nextState);
        return;
      }

      if (currentState.isDrawing && currentState.drawingPoints.length > 1) {
        finalizeDrawing(currentState.drawingPoints, tool);
        clearDrawingPreview(canvas);
      }

      const nextState: CanvasState = {
        ...currentState,
        isDrawing: false,
        drawingPoints: [],
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
    },
    [tool, roomDrawMode, commitRoomFromVertices]
  );

  const handleWheel = useCallback(
    (e: fabric.TPointerEventInfo<WheelEvent>) => {
      e.e.preventDefault();
      const canvas = fabricRef.current;
      if (!canvas) return;

      // Get mouse position in screen coordinates
      const pointer = canvas.getViewportPoint(e.e);
      const scenePoint = canvas.getScenePoint(e.e);

      const currentZoom = zoomRef.current;
      const zoomFactor = Math.exp(-e.e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      const newZoom = Math.min(Math.max(currentZoom * zoomFactor, MIN_ZOOM), MAX_ZOOM);
      if (Math.abs(newZoom - currentZoom) < 0.0001) return;

      // Calculate new pan offset to keep the point under cursor fixed
      const nextPan = {
        x: scenePoint.x - pointer.x / newZoom,
        y: scenePoint.y - pointer.y / newZoom,
      };

      zoomRef.current = newZoom;
      panOffsetRef.current = nextPan;
      setViewTransform(newZoom, nextPan);
    },
    [setViewTransform]
  );

  // ---------------------------------------------------------------------------
  // Event Binding
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const upperCanvasEl = canvas.upperCanvasEl;
    const stopMiddlePan = () => {
      if (!middlePanRef.current.active) return;
      middlePanRef.current.active = false;
      const nextState: CanvasState = {
        ...canvasStateRef.current,
        isPanning: false,
        lastPanPoint: null,
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
    };

    const handleMiddleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      middlePanRef.current = {
        active: true,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      const nextState: CanvasState = {
        ...canvasStateRef.current,
        isPanning: true,
        lastPanPoint: { x: event.clientX, y: event.clientY },
      };
      canvasStateRef.current = nextState;
      setCanvasState(nextState);
    };

    const preventMiddleAuxClick = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };

    const handleWallDoubleClick = (event: MouseEvent) => {
      if (tool !== 'wall') return;
      event.preventDefault();
      endWallChain();
    };

    const getTargetMeta = (
      target: fabric.Object | undefined | null
    ): {
      name?: string;
      wallId?: string;
      roomId?: string;
      handleType?: 'start' | 'end' | 'mid';
    } => {
      const typed = target as unknown as {
        name?: string;
        wallId?: string;
        roomId?: string;
        handleType?: 'start' | 'end' | 'mid';
      };
      return {
        name: typed?.name,
        wallId: typed?.wallId,
        roomId: typed?.roomId,
        handleType: typed?.handleType,
      };
    };

    const updateSelectionFromTarget = (target: fabric.Object | undefined | null) => {
      if (tool !== 'select') return;
      const meta = getTargetMeta(target);
      if (meta.name === 'wall-render' && meta.wallId) {
        setSelectedIds([meta.wallId]);
        return;
      }
      if ((meta.name === 'room-region' || meta.name === 'room-tag') && meta.roomId) {
        setSelectedIds([meta.roomId]);
        return;
      }
      if (meta.name === 'wall-handle' && meta.wallId) {
        setSelectedIds([meta.wallId]);
        return;
      }
      if (!target) {
        setSelectedIds([]);
      }
    };

    const handleSelectionCreated = (event: fabric.CanvasEvents['selection:created']) => {
      updateSelectionFromTarget(event.selected?.[0] ?? null);
    };

    const handleSelectionUpdated = (event: fabric.CanvasEvents['selection:updated']) => {
      updateSelectionFromTarget(event.selected?.[0] ?? null);
    };

    const handleSelectionCleared = () => {
      if (!isWallHandleDraggingRef.current) {
        setSelectedIds([]);
      }
    };

    const handleCanvasMouseDown = (event: fabric.CanvasEvents['mouse:down']) => {
      if (tool !== 'select') return;
      updateSelectionFromTarget(event.target ?? null);
    };

    const handleObjectMoving = (event: fabric.CanvasEvents['object:moving']) => {
      const target = event.target;
      if (!target) return;
      const meta = getTargetMeta(target);
      if (meta.name !== 'wall-handle' || !meta.wallId || !meta.handleType) return;

      const wall = wallsRef.current.find((item) => item.id === meta.wallId);
      if (!wall) return;

      const center = target.getCenterPoint();
      const pointer = resolvedSnapToGrid
        ? snapPointToGrid({ x: center.x, y: center.y }, resolvedGridSize)
        : { x: center.x, y: center.y };

      const targetRadius = Number((target as fabric.Circle).get('radius')) || HANDLE_HIT_RADIUS;
      target.set({
        left: pointer.x - targetRadius,
        top: pointer.y - targetRadius,
      });
      target.setCoords();

      if (
        !wallHandleDragRef.current ||
        wallHandleDragRef.current.wallId !== meta.wallId ||
        wallHandleDragRef.current.handleType !== meta.handleType
      ) {
        wallHandleDragRef.current = {
          wallId: meta.wallId,
          handleType: meta.handleType,
          originalWalls: wallsRef.current.map((item) => ({
            ...item,
            start: { ...item.start },
            end: { ...item.end },
          })),
          originalStart: { ...wall.start },
          originalEnd: { ...wall.end },
        };
      }

      const dragSession = wallHandleDragRef.current;
      if (!dragSession) return;
      isWallHandleDraggingRef.current = true;

      let nextWalls = dragSession.originalWalls;
      if (dragSession.handleType === 'start') {
        nextWalls = moveConnectedNode(
          nextWalls,
          dragSession.originalStart,
          pointer,
          WALL_ENDPOINT_TOLERANCE
        );
      } else if (dragSession.handleType === 'end') {
        nextWalls = moveConnectedNode(
          nextWalls,
          dragSession.originalEnd,
          pointer,
          WALL_ENDPOINT_TOLERANCE
        );
      } else {
        const originalMid = {
          x: (dragSession.originalStart.x + dragSession.originalEnd.x) / 2,
          y: (dragSession.originalStart.y + dragSession.originalEnd.y) / 2,
        };
        const delta = {
          x: pointer.x - originalMid.x,
          y: pointer.y - originalMid.y,
        };
        nextWalls = moveConnectedNode(
          nextWalls,
          dragSession.originalStart,
          {
            x: dragSession.originalStart.x + delta.x,
            y: dragSession.originalStart.y + delta.y,
          },
          WALL_ENDPOINT_TOLERANCE
        );
        nextWalls = moveConnectedNode(
          nextWalls,
          dragSession.originalEnd,
          {
            x: dragSession.originalEnd.x + delta.x,
            y: dragSession.originalEnd.y + delta.y,
          },
          WALL_ENDPOINT_TOLERANCE
        );
      }

      nextWalls = nextWalls.filter(
        (candidate) => distanceBetween(candidate.start, candidate.end) > 0.001
      );
      nextWalls = rebuildWallAdjacency(nextWalls, WALL_ENDPOINT_TOLERANCE);
      applyTransientWallGraph(nextWalls);
      setSelectedIds([meta.wallId]);
    };

    const finalizeHandleDrag = () => {
      if (wallHandleDragRef.current) {
        useSmartDrawingStore.getState().saveToHistory('Edit wall');
      }
      wallHandleDragRef.current = null;
      isWallHandleDraggingRef.current = false;
    };

    const handleObjectModified = (event: fabric.CanvasEvents['object:modified']) => {
      const target = event.target;
      if (!target) return;
      const meta = getTargetMeta(target);
      if (meta.name !== 'wall-handle') return;
      finalizeHandleDrag();
    };

    const handleMiddleMouseMove = (event: MouseEvent) => {
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
    };

    const handleMiddleMouseUp = (event: MouseEvent) => {
      if (event.button !== 1 && !middlePanRef.current.active) return;
      stopMiddlePan();
    };

    const handleWindowBlur = () => {
      stopMiddlePan();
      finalizeHandleDrag();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:wheel', handleWheel);
    canvas.on('selection:created', handleSelectionCreated);
    canvas.on('selection:updated', handleSelectionUpdated);
    canvas.on('selection:cleared', handleSelectionCleared);
    canvas.on('mouse:down', handleCanvasMouseDown);
    canvas.on('object:moving', handleObjectMoving);
    canvas.on('object:modified', handleObjectModified);
    window.addEventListener('mouseup', handleMouseUp);

    upperCanvasEl?.addEventListener('mousedown', handleMiddleMouseDown);
    upperCanvasEl?.addEventListener('auxclick', preventMiddleAuxClick);
    upperCanvasEl?.addEventListener('dblclick', handleWallDoubleClick);
    window.addEventListener('mousemove', handleMiddleMouseMove, { passive: false });
    window.addEventListener('mouseup', handleMiddleMouseUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('mouse:wheel', handleWheel);
      canvas.off('selection:created', handleSelectionCreated);
      canvas.off('selection:updated', handleSelectionUpdated);
      canvas.off('selection:cleared', handleSelectionCleared);
      canvas.off('mouse:down', handleCanvasMouseDown);
      canvas.off('object:moving', handleObjectMoving);
      canvas.off('object:modified', handleObjectModified);
      window.removeEventListener('mouseup', handleMouseUp);
      upperCanvasEl?.removeEventListener('mousedown', handleMiddleMouseDown);
      upperCanvasEl?.removeEventListener('auxclick', preventMiddleAuxClick);
      upperCanvasEl?.removeEventListener('dblclick', handleWallDoubleClick);
      window.removeEventListener('mousemove', handleMiddleMouseMove);
      window.removeEventListener('mouseup', handleMiddleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      finalizeHandleDrag();
    };
  }, [
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    setPanOffset,
    tool,
    endWallChain,
    setSelectedIds,
    applyTransientWallGraph,
    resolvedSnapToGrid,
    resolvedGridSize,
  ]);

  // ---------------------------------------------------------------------------
  // Drawing Finalization
  // ---------------------------------------------------------------------------

  const finalizeDrawing = useCallback(
    (points: Point2D[], currentTool: DrawingTool) => {
      if (points.length < 2) return;

      switch (currentTool) {
        case 'pencil':
        case 'spline':
          addSketch({
            points,
            type: currentTool === 'spline' ? 'spline' : 'freehand',
          });
          break;
      }
    },
    [addSketch]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={outerRef}
      className={`relative w-full h-full overflow-hidden ${className}`}
    >
      <div
        ref={hostRef}
        className="absolute"
        style={{
          top: originOffset.y,
          left: originOffset.x,
          width: hostWidth,
          height: hostHeight,
          overflow: 'hidden',
        }}
      >
        <PageLayout
          pageWidth={pageConfig.width}
          pageHeight={pageConfig.height}
          zoom={zoom}
          panOffset={panOffset}
        />
        <Grid
          pageWidth={pageConfig.width}
          pageHeight={pageConfig.height}
          zoom={zoom}
          panOffset={panOffset}
          gridSize={resolvedGridSize}
          showGrid={resolvedShowGrid}
          viewportWidth={hostWidth}
          viewportHeight={hostHeight}
        />
        <canvas ref={canvasRef} className="relative z-[2] block" />
      </div>

      {tool === 'room' && (
        <div className="absolute left-3 top-3 z-[30] rounded-lg border border-slate-300/80 bg-white/95 p-1.5 shadow-sm">
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Room Mode
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setRoomDrawMode('rectangle')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                roomDrawMode === 'rectangle'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Rectangle
            </button>
            <button
              type="button"
              onClick={() => setRoomDrawMode('polygon')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                roomDrawMode === 'polygon'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Polygon
            </button>
          </div>
        </div>
      )}

      <Rulers
        pageWidth={pageConfig.width}
        pageHeight={pageConfig.height}
        zoom={zoom}
        panOffset={panOffset}
        viewportWidth={hostWidth}
        viewportHeight={hostHeight}
        showRulers={resolvedShowRulers}
        rulerSize={rulerSize}
        originOffset={originOffset}
        gridSize={resolvedGridSize}
        displayUnit={displayUnit}
        mousePosition={mousePosition}
      />
    </div>
  );
}

// =============================================================================
// Utility Functions
// =============================================================================

function snapPointToGrid(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable=""], [contenteditable="true"]'
    )
  );
}

function getToolCursor(tool: DrawingTool): string {
  switch (tool) {
    case 'select':
      return 'default';
    case 'pan':
      return 'grab';
    case 'wall':
    case 'room':
    case 'dimension':
      return 'crosshair';
    case 'pencil':
    case 'spline':
      return 'crosshair';
    case 'text':
      return 'text';
    case 'eraser':
      return 'not-allowed';
    default:
      return 'default';
  }
}

function isDrawingTool(tool: DrawingTool): boolean {
  return ['pencil', 'spline', 'dimension', 'rectangle', 'circle', 'line'].includes(
    tool
  );
}

function distanceBetween(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sceneBoundsIntersect(a: SceneBounds, b: SceneBounds): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function getWallBounds(wall: Wall2D): SceneBounds {
  const minX = Math.min(wall.start.x, wall.end.x);
  const minY = Math.min(wall.start.y, wall.end.y);
  const maxX = Math.max(wall.start.x, wall.end.x);
  const maxY = Math.max(wall.start.y, wall.end.y);
  const halfThickness = wallThicknessToCanvasPx(wall.thickness) / 2;
  return {
    left: minX - halfThickness,
    top: minY - halfThickness,
    right: maxX + halfThickness,
    bottom: maxY + halfThickness,
  };
}

function getRoomBounds(room: Room2D): SceneBounds {
  if (room.vertices.length === 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  room.vertices.forEach((vertex) => {
    left = Math.min(left, vertex.x);
    top = Math.min(top, vertex.y);
    right = Math.max(right, vertex.x);
    bottom = Math.max(bottom, vertex.y);
  });
  return { left, top, right, bottom };
}

function roomIntersectsBounds(room: Room2D, bounds: SceneBounds): boolean {
  return sceneBoundsIntersect(getRoomBounds(room), bounds);
}

function buildWallSpatialIndex(walls: Wall2D[], cellSize: number): Map<string, WallSpatialIndexCell> {
  const safeCell = Math.max(cellSize, 1);
  const index = new Map<string, WallSpatialIndexCell>();

  const keyOf = (x: number, y: number) => `${x}:${y}`;
  walls.forEach((wall) => {
    const bounds = getWallBounds(wall);
    const minCellX = Math.floor(bounds.left / safeCell);
    const maxCellX = Math.floor(bounds.right / safeCell);
    const minCellY = Math.floor(bounds.top / safeCell);
    const maxCellY = Math.floor(bounds.bottom / safeCell);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = keyOf(cx, cy);
        const cell = index.get(key);
        if (cell) {
          cell.walls.push(wall);
        } else {
          index.set(key, { walls: [wall] });
        }
      }
    }
  });

  return index;
}

function queryWallsInBounds(
  index: Map<string, WallSpatialIndexCell>,
  bounds: SceneBounds,
  cellSize = WALL_SPATIAL_INDEX_CELL_PX
): Wall2D[] {
  const safeCell = Math.max(cellSize, 1);
  const minCellX = Math.floor(bounds.left / safeCell);
  const maxCellX = Math.floor(bounds.right / safeCell);
  const minCellY = Math.floor(bounds.top / safeCell);
  const maxCellY = Math.floor(bounds.bottom / safeCell);
  const seen = new Set<string>();
  const visibleWalls: Wall2D[] = [];

  for (let cx = minCellX; cx <= maxCellX; cx++) {
    for (let cy = minCellY; cy <= maxCellY; cy++) {
      const cell = index.get(`${cx}:${cy}`);
      if (!cell) continue;
      cell.walls.forEach((wall) => {
        if (seen.has(wall.id)) return;
        if (!sceneBoundsIntersect(getWallBounds(wall), bounds)) return;
        seen.add(wall.id);
        visibleWalls.push(wall);
      });
    }
  }

  return visibleWalls;
}

function applyOrthogonalConstraint(start: Point2D, target: Point2D): Point2D {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: target.x, y: start.y };
  }
  return { x: start.x, y: target.y };
}

function findWallSnapTarget(
  point: Point2D,
  walls: Wall2D[],
  thresholdScene: number
): WallSnapTarget | null {
  let best: WallSnapTarget | null = null;

  walls.forEach((wall) => {
    const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
    const candidates: Array<Omit<WallSnapTarget, 'distance'>> = [
      { point: wall.start, type: 'endpoint', wallId: wall.id },
      { point: wall.end, type: 'endpoint', wallId: wall.id },
      { point: mid, type: 'midpoint', wallId: wall.id },
    ];

    const projection = projectPointToSegment(point, wall.start, wall.end);
    if (projection.t > 0.01 && projection.t < 0.99) {
      candidates.push({ point: projection.projection, type: 'segment', wallId: wall.id });
    }

    candidates.forEach((candidate) => {
      const d = distanceBetween(point, candidate.point);
      if (d > thresholdScene) return;
      if (!best || d < best.distance) {
        best = { ...candidate, distance: d };
        return;
      }
      if (best && Math.abs(d - best.distance) < 1e-6 && snapTypePriority(candidate.type) > snapTypePriority(best.type)) {
        best = { ...candidate, distance: d };
      }
    });
  });

  return best;
}

function snapTypePriority(type: WallSnapTarget['type']): number {
  switch (type) {
    case 'endpoint':
      return 3;
    case 'midpoint':
      return 2;
    default:
      return 1;
  }
}

function projectPointToSegment(
  point: Point2D,
  start: Point2D,
  end: Point2D
): { projection: Point2D; t: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-8) {
    return {
      projection: { ...start },
      t: 0,
      distance: distanceBetween(point, start),
    };
  }

  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
  const t = clamp(rawT, 0, 1);
  const projection = {
    x: start.x + dx * t,
    y: start.y + dy * t,
  };

  return {
    projection,
    t,
    distance: distanceBetween(point, projection),
  };
}

function wallThicknessToCanvasPx(thicknessMm: number): number {
  const resolvedThicknessMm = Number.isFinite(thicknessMm) && thicknessMm > 0
    ? thicknessMm
    : WALL_DEFAULT_THICKNESS_MM;
  // Cap keeps legacy data usable while still honoring the thickness property.
  return Math.max(2, Math.min(resolvedThicknessMm * MM_TO_PX, 80));
}

function createWallPolygonPoints(start: Point2D, end: Point2D, thicknessPx: number): Point2D[] | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return null;

  const half = thicknessPx / 2;
  const nx = (-dy / length) * half;
  const ny = (dx / length) * half;

  return [
    { x: start.x + nx, y: start.y + ny },
    { x: end.x + nx, y: end.y + ny },
    { x: end.x - nx, y: end.y - ny },
    { x: start.x - nx, y: start.y - ny },
  ];
}

function formatWallLength(lengthScenePx: number, unit: DisplayUnit = 'mm'): string {
  const mm = lengthScenePx * PX_TO_MM;
  return formatDistance(mm, unit);
}

interface WallRenderOptions {
  selected?: boolean;
}

function createWallRenderObjects(
  wall: Wall2D,
  unit: DisplayUnit,
  options: WallRenderOptions = {}
): {
  wallBody: fabric.Object;
  dimensionLabel: fabric.Object;
} {
  const thicknessPx = wallThicknessToCanvasPx(wall.thickness);
  const polygonPoints = createWallPolygonPoints(wall.start, wall.end, thicknessPx);
  const isSelected = options.selected === true;

  let wallBody: fabric.Object;
  if (polygonPoints) {
    wallBody = new fabric.Polygon(polygonPoints, {
      fill: wall.color || WALL_DEFAULT_COLOR,
      stroke: isSelected ? '#2563eb' : '#475569',
      strokeWidth: isSelected ? 2 : 1,
      objectCaching: false,
      selectable: true,
      evented: true,
    });
  } else {
    wallBody = new fabric.Circle({
      left: wall.start.x - thicknessPx / 2,
      top: wall.start.y - thicknessPx / 2,
      radius: thicknessPx / 2,
      fill: wall.color || WALL_DEFAULT_COLOR,
      stroke: isSelected ? '#2563eb' : '#475569',
      strokeWidth: isSelected ? 2 : 1,
      objectCaching: false,
      selectable: true,
      evented: true,
    });
  }
  (wallBody as unknown as { name?: string }).name = 'wall-render';
  (wallBody as unknown as { wallId?: string }).wallId = wall.id;

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  const midX = (wall.start.x + wall.end.x) / 2;
  const midY = (wall.start.y + wall.end.y) / 2;
  let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angleDeg > 90 || angleDeg < -90) {
    angleDeg += 180;
  }

  const dimensionLabel = new fabric.Text(formatWallLength(length, unit), {
    left: midX,
    top: midY,
    originX: 'center',
    originY: 'center',
    angle: angleDeg,
    fontSize: 11,
    fill: isSelected ? '#0b3b9e' : '#111827',
    backgroundColor: isSelected ? 'rgba(219,234,254,0.92)' : 'rgba(255,255,255,0.75)',
    selectable: false,
    evented: false,
    name: 'wall-dimension',
  });

  return { wallBody, dimensionLabel };
}

function clearRenderedWalls(canvas: fabric.Canvas): void {
  const wallObjects = canvas
    .getObjects()
    .filter((obj) => {
      const name = (obj as unknown as { name?: string }).name;
      return name === 'wall-render' || name === 'wall-dimension';
    });
  wallObjects.forEach((obj) => canvas.remove(obj));
}

function clearRenderedRooms(canvas: fabric.Canvas): void {
  const roomObjects = canvas
    .getObjects()
    .filter((obj) => {
      const name = (obj as unknown as { name?: string }).name;
      return name === 'room-tag' || name === 'room-region';
    });
  roomObjects.forEach((obj) => canvas.remove(obj));
}

function clearWallHandles(canvas: fabric.Canvas): void {
  const handles = canvas
    .getObjects()
    .filter((obj) => (obj as unknown as { name?: string }).name === 'wall-handle');
  handles.forEach((obj) => canvas.remove(obj));
}

function createWallHandles(wall: Wall2D, zoom: number): fabric.Circle[] {
  const radius = Math.max(HANDLE_HIT_RADIUS / Math.max(zoom, 0.01), 3);
  const midpoint = {
    x: (wall.start.x + wall.end.x) / 2,
    y: (wall.start.y + wall.end.y) / 2,
  };
  return [
    createWallHandleCircle(wall.id, 'start', wall.start, radius, '#2563eb'),
    createWallHandleCircle(wall.id, 'end', wall.end, radius, '#2563eb'),
    createWallHandleCircle(wall.id, 'mid', midpoint, radius, '#f59e0b'),
  ];
}

function createWallHandleCircle(
  wallId: string,
  handleType: 'start' | 'end' | 'mid',
  point: Point2D,
  radius: number,
  color: string
): fabric.Circle {
  const handle = new fabric.Circle({
    left: point.x - radius,
    top: point.y - radius,
    radius,
    fill: color,
    stroke: '#ffffff',
    strokeWidth: Math.max(radius * 0.18, 1),
    selectable: true,
    evented: true,
    hasControls: false,
    hasBorders: false,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    objectCaching: false,
    hoverCursor: 'grab',
  });
  (handle as unknown as { name?: string }).name = 'wall-handle';
  (handle as unknown as { wallId?: string }).wallId = wallId;
  (handle as unknown as { handleType?: string }).handleType = handleType;
  return handle;
}

interface RoomRenderOptions {
  selected?: boolean;
}

function createRoomRenderObjects(
  room: Room2D,
  zoom: number,
  unit: DisplayUnit,
  options: RoomRenderOptions = {}
): { roomFill: fabric.Object; roomTag: fabric.Group } {
  const isSelected = options.selected === true;
  const roomFill = new fabric.Polygon(room.vertices, {
    fill: room.color ? withAlpha(room.color, isSelected ? 0.22 : 0.14) : isSelected ? 'rgba(37,99,235,0.14)' : 'rgba(148,163,184,0.06)',
    stroke: isSelected ? '#2563eb' : 'rgba(100,116,139,0.25)',
    strokeWidth: isSelected ? 1.5 : 1,
    selectable: true,
    evented: true,
    objectCaching: false,
  });
  (roomFill as unknown as { name?: string }).name = 'room-region';
  (roomFill as unknown as { roomId?: string }).roomId = room.id;

  const roomTag = createRoomTagObject(room, zoom, unit, { selected: isSelected });
  return { roomFill, roomTag };
}

function createRoomTagObject(
  room: Room2D,
  zoom: number,
  unit: DisplayUnit,
  options: RoomRenderOptions = {}
): fabric.Group {
  const centroid = calculatePolygonCentroid(room.vertices);
  const areaText = formatRoomArea(room.area, unit);
  const perimeterText = formatRoomPerimeter(room.perimeter, unit);
  const isSelected = options.selected === true;

  const title = new fabric.Text(room.name, {
    fontFamily: 'Segoe UI',
    fontSize: 13,
    fontWeight: '700',
    fill: '#f8fafc',
    originX: 'left',
    originY: 'top',
    selectable: false,
    evented: false,
  });
  const area = new fabric.Text(areaText, {
    fontFamily: 'Segoe UI',
    fontSize: 11,
    fill: '#e2e8f0',
    originX: 'left',
    originY: 'top',
    selectable: false,
    evented: false,
  });
  const perimeter = new fabric.Text(perimeterText, {
    fontFamily: 'Segoe UI',
    fontSize: 11,
    fill: '#cbd5e1',
    originX: 'left',
    originY: 'top',
    selectable: false,
    evented: false,
  });

  const contentWidth = Math.max(title.width ?? 0, area.width ?? 0, perimeter.width ?? 0);
  const titleHeight = title.height ?? 0;
  const areaHeight = area.height ?? 0;
  const perimeterHeight = perimeter.height ?? 0;
  const lineGap = 3;
  const paddingX = 10;
  const paddingY = 8;
  const boxWidth = Math.max(contentWidth + paddingX * 2, 116);
  const boxHeight = titleHeight + areaHeight + perimeterHeight + paddingY * 2 + lineGap * 2;
  const boxLeft = -boxWidth / 2;
  const boxTop = -boxHeight / 2;

  const textLeft = boxLeft + paddingX;
  const titleTop = boxTop + paddingY;
  const areaTop = titleTop + titleHeight + lineGap;
  const perimeterTop = areaTop + areaHeight + lineGap;

  title.set({ left: textLeft, top: titleTop });
  area.set({ left: textLeft, top: areaTop });
  perimeter.set({ left: textLeft, top: perimeterTop });

  const background = new fabric.Rect({
    left: boxLeft,
    top: boxTop,
    width: boxWidth,
    height: boxHeight,
    rx: 6,
    ry: 6,
    fill: isSelected ? 'rgba(3, 37, 85, 0.92)' : 'rgba(15, 23, 42, 0.88)',
    stroke: isSelected ? '#60a5fa' : '#94a3b8',
    strokeWidth: isSelected ? 1.5 : 1,
    selectable: false,
    evented: false,
    objectCaching: false,
  });

  const safeZoom = Math.max(zoom, 0.01);
  const inverseZoom = (isSelected ? 1.08 : 1) / safeZoom;
  const group = new fabric.Group([background, title, area, perimeter], {
    left: centroid.x,
    top: centroid.y,
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
    objectCaching: false,
    scaleX: inverseZoom,
    scaleY: inverseZoom,
  });
  (group as unknown as { name?: string }).name = 'room-tag';
  (group as unknown as { roomId?: string }).roomId = room.id;
  return group;
}

function formatRoomArea(areaSqm: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'mm': {
      const value = Math.round(areaSqm * 1_000_000);
      return `${value.toLocaleString()} mm^2`;
    }
    case 'cm': {
      const value = areaSqm * 10_000;
      return `${value.toFixed(value >= 100 ? 0 : 1)} cm^2`;
    }
    case 'ft-in': {
      const value = areaSqm * 10.7639104;
      return `${value.toFixed(value >= 100 ? 0 : 1)} ft^2`;
    }
    default:
      return `${areaSqm >= 10 ? areaSqm.toFixed(1) : areaSqm.toFixed(2)} m^2`;
  }
}

function formatRoomPerimeter(perimeterM: number, unit: DisplayUnit): string {
  const mm = perimeterM * 1000;
  return formatDistance(mm, unit);
}

function formatDistance(mm: number, unit: DisplayUnit): string {
  if (!Number.isFinite(mm)) return '0 mm';
  switch (unit) {
    case 'cm':
      return `${(mm / 10).toFixed(mm >= 1000 ? 0 : 1)} cm`;
    case 'm':
      return `${(mm / 1000).toFixed(mm >= 10_000 ? 1 : 2)} m`;
    case 'ft-in': {
      const inchesTotal = mm / 25.4;
      const feet = Math.floor(inchesTotal / 12);
      const inches = inchesTotal - feet * 12;
      return `${feet}' ${inches.toFixed(1)}"`;
    }
    default:
      return `${Math.round(mm)} mm`;
  }
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function calculatePolygonCentroid(vertices: Point2D[]): Point2D {
  if (vertices.length === 0) return { x: 0, y: 0 };
  if (vertices.length < 3) {
    const sum = vertices.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 }
    );
    return {
      x: sum.x / vertices.length,
      y: sum.y / vertices.length,
    };
  }

  let signedArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    if (!current || !next) continue;
    const cross = current.x * next.y - next.x * current.y;
    signedArea += cross;
    cx += (current.x + next.x) * cross;
    cy += (current.y + next.y) * cross;
  }

  if (Math.abs(signedArea) < 1e-8) {
    const sum = vertices.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 }
    );
    return {
      x: sum.x / vertices.length,
      y: sum.y / vertices.length,
    };
  }

  const factor = 1 / (3 * signedArea);
  return {
    x: cx * factor,
    y: cy * factor,
  };
}

function bringTransientOverlaysToFront(canvas: fabric.Canvas): void {
  const transientObjects = canvas.getObjects().filter((obj) => {
    const name = (obj as unknown as { name?: string }).name;
    return name === 'drawing-preview' || name === 'wall-snap-highlight';
  });
  const canvasWithBring = canvas as unknown as { bringObjectToFront?: (obj: fabric.Object) => void };
  transientObjects.forEach((obj) => {
    if (canvasWithBring.bringObjectToFront) {
      canvasWithBring.bringObjectToFront(obj);
    }
  });
}

function clearSnapHighlight(canvas: fabric.Canvas, shouldRender = true): void {
  const highlights = canvas
    .getObjects()
    .filter((obj) => (obj as unknown as { name?: string }).name === 'wall-snap-highlight');
  highlights.forEach((obj) => canvas.remove(obj));
  if (shouldRender) {
    canvas.requestRenderAll();
  }
}

function renderSnapHighlight(canvas: fabric.Canvas, point: Point2D, zoom: number): void {
  clearSnapHighlight(canvas, false);

  const radius = Math.max(3 / Math.max(zoom, 0.01), 1.5);
  const highlight = new fabric.Circle({
    left: point.x - radius,
    top: point.y - radius,
    radius,
    fill: 'rgba(76, 175, 80, 0.45)',
    stroke: '#2e7d32',
    strokeWidth: 1 / Math.max(zoom, 0.01),
    selectable: false,
    evented: false,
    name: 'wall-snap-highlight',
  });
  canvas.add(highlight);
  const canvasWithBring = canvas as unknown as { bringObjectToFront?: (obj: fabric.Object) => void };
  canvasWithBring.bringObjectToFront?.(highlight);
  canvas.requestRenderAll();
}

function renderWallPreview(
  canvas: fabric.Canvas,
  start: Point2D,
  end: Point2D,
  thicknessMm: number,
  unit: DisplayUnit
): void {
  clearDrawingPreview(canvas, false);
  const thicknessPx = wallThicknessToCanvasPx(thicknessMm);
  const polygonPoints = createWallPolygonPoints(start, end, thicknessPx);
  if (!polygonPoints) {
    canvas.requestRenderAll();
    return;
  }

  const previewWall = new fabric.Polygon(polygonPoints, {
    fill: 'rgba(37, 99, 235, 0.35)',
    stroke: '#1d4ed8',
    strokeWidth: 1,
    selectable: false,
    evented: false,
    objectCaching: false,
  });
  (previewWall as unknown as { name?: string }).name = 'drawing-preview';
  canvas.add(previewWall);

  const length = distanceBetween(start, end);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  let angleDeg = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;

  const previewLabel = new fabric.Text(formatWallLength(length, unit), {
    left: midX,
    top: midY,
    originX: 'center',
    originY: 'center',
    angle: angleDeg,
    fontSize: 10,
    fill: '#1d4ed8',
    backgroundColor: 'rgba(255,255,255,0.75)',
    selectable: false,
    evented: false,
    name: 'drawing-preview',
  });
  canvas.add(previewLabel);
  canvas.requestRenderAll();
}

function createWallSegment(
  start: Point2D,
  end: Point2D,
  options: Partial<Pick<Wall2D, 'thickness' | 'height' | 'wallType' | 'material' | 'color' | 'layer' | 'openings'>> = {}
): Wall2D {
  const wallType: WallType = options.wallType ?? 'interior';
  return {
    id: generateId(),
    start,
    end,
    thickness: options.thickness ?? WALL_DEFAULT_THICKNESS_MM,
    height: options.height ?? WALL_DEFAULT_HEIGHT_MM,
    wallType,
    material: options.material ?? WALL_DEFAULT_MATERIAL,
    color: options.color ?? WALL_DEFAULT_COLOR,
    layer: options.layer ?? 'default',
    connectedWallIds: [],
    openings: options.openings ? [...options.openings] : [],
  };
}

function splitWallAtPoint(
  wall: Wall2D,
  splitPoint: Point2D,
  fallbackLayer: string
): { first: Wall2D; second: Wall2D } | null {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) return null;

  const t = ((splitPoint.x - wall.start.x) * dx + (splitPoint.y - wall.start.y) * dy) / lenSq;
  if (t <= 0.001 || t >= 0.999) return null;

  const layer = wall.layer ?? fallbackLayer;
  const firstId = generateId();
  const secondId = generateId();
  const firstOpenings: Wall2D['openings'] = [];
  const secondOpenings: Wall2D['openings'] = [];
  const safeT = Math.max(0.001, Math.min(0.999, t));

  (wall.openings ?? []).forEach((opening) => {
    if (opening.position <= safeT) {
      firstOpenings.push({
        ...opening,
        id: generateId(),
        wallId: firstId,
        position: clamp(opening.position / safeT, 0, 1),
      });
      return;
    }
    secondOpenings.push({
      ...opening,
      id: generateId(),
      wallId: secondId,
      position: clamp((opening.position - safeT) / (1 - safeT), 0, 1),
    });
  });

  const commonProps: Omit<Wall2D, 'id' | 'start' | 'end' | 'openings'> = {
    thickness: wall.thickness,
    height: wall.height,
    wallType: wall.wallType,
    material: wall.material ?? WALL_DEFAULT_MATERIAL,
    color: wall.color ?? WALL_DEFAULT_COLOR,
    layer,
    connectedWallIds: [],
  };

  const first: Wall2D = {
    id: firstId,
    start: { ...wall.start },
    end: { ...splitPoint },
    ...commonProps,
    openings: firstOpenings,
  };
  const second: Wall2D = {
    id: secondId,
    start: { ...splitPoint },
    end: { ...wall.end },
    ...commonProps,
    openings: secondOpenings,
  };

  return { first, second };
}

function endpointsTouch(a: Point2D, b: Point2D, tolerance: number): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function wallsShareEndpoint(a: Wall2D, b: Wall2D, tolerance: number): boolean {
  return (
    endpointsTouch(a.start, b.start, tolerance) ||
    endpointsTouch(a.start, b.end, tolerance) ||
    endpointsTouch(a.end, b.start, tolerance) ||
    endpointsTouch(a.end, b.end, tolerance)
  );
}

function rebuildWallAdjacency(walls: Wall2D[], tolerance: number): Wall2D[] {
  const adjacencyMap = new Map<string, Set<string>>();
  walls.forEach((wall) => adjacencyMap.set(wall.id, new Set<string>()));

  for (let i = 0; i < walls.length; i++) {
    const a = walls[i];
    if (!a) continue;
    for (let j = i + 1; j < walls.length; j++) {
      const b = walls[j];
      if (!b) continue;
      if (!wallsShareEndpoint(a, b, tolerance)) continue;
      adjacencyMap.get(a.id)?.add(b.id);
      adjacencyMap.get(b.id)?.add(a.id);
    }
  }

  return walls.map((wall) => ({
    ...wall,
    connectedWallIds: Array.from(adjacencyMap.get(wall.id) ?? []),
  }));
}

function moveConnectedNode(
  walls: Wall2D[],
  sourcePoint: Point2D,
  targetPoint: Point2D,
  tolerance: number
): Wall2D[] {
  return walls.map((wall) => {
    const nextWall: Wall2D = { ...wall };
    let changed = false;
    if (arePointsClose(wall.start, sourcePoint, tolerance)) {
      nextWall.start = { ...targetPoint };
      changed = true;
    }
    if (arePointsClose(wall.end, sourcePoint, tolerance)) {
      nextWall.end = { ...targetPoint };
      changed = true;
    }
    return changed ? nextWall : wall;
  });
}

interface WallEdge {
  start: Point2D;
  end: Point2D;
}

interface OverlapInterval {
  start: number;
  end: number;
}

interface ColinearOverlap {
  wallId: string;
  start: number;
  end: number;
}

function arePointsClose(a: Point2D, b: Point2D, tolerance: number): boolean {
  return distanceBetween(a, b) <= tolerance;
}

function buildRectangleVertices(start: Point2D, end: Point2D): Point2D[] {
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function normalizeRoomVertices(vertices: Point2D[], tolerance = 0.001): Point2D[] {
  const normalized: Point2D[] = [];
  vertices.forEach((vertex) => {
    const last = normalized[normalized.length - 1];
    if (!last || !arePointsClose(last, vertex, tolerance)) {
      normalized.push(vertex);
    }
  });
  if (normalized.length > 1) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (first && last && arePointsClose(first, last, tolerance)) {
      normalized.pop();
    }
  }
  return normalized;
}

function buildClosedPolygonEdges(vertices: Point2D[]): WallEdge[] {
  if (vertices.length < 3) return [];
  const edges: WallEdge[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const start = vertices[i];
    const end = vertices[(i + 1) % vertices.length];
    if (!start || !end) continue;
    if (distanceBetween(start, end) <= 0.001) continue;
    edges.push({ start, end });
  }
  return edges;
}

function renderRoomRectanglePreview(canvas: fabric.Canvas, start: Point2D, end: Point2D): void {
  clearDrawingPreview(canvas, false);
  const vertices = buildRectangleVertices(start, end);
  const polygon = new fabric.Polygon(vertices, {
    fill: 'rgba(30, 64, 175, 0.12)',
    stroke: '#1d4ed8',
    strokeWidth: 1.5,
    strokeDashArray: [6, 4],
    selectable: false,
    evented: false,
    objectCaching: false,
  });
  (polygon as unknown as { name?: string }).name = 'drawing-preview';
  canvas.add(polygon);
  canvas.requestRenderAll();
}

function renderRoomPolygonPreview(
  canvas: fabric.Canvas,
  vertices: Point2D[],
  hoverPoint: Point2D | null
): void {
  clearDrawingPreview(canvas, false);
  if (vertices.length === 0) {
    canvas.requestRenderAll();
    return;
  }

  if (vertices.length > 1) {
    const closedPreview = hoverPoint
      ? [...vertices, hoverPoint]
      : [...vertices];
    const polyline = new fabric.Polyline(closedPreview, {
      stroke: '#1d4ed8',
      strokeWidth: 1.5,
      strokeDashArray: [6, 4],
      fill: 'rgba(30, 64, 175, 0.08)',
      selectable: false,
      evented: false,
      objectCaching: false,
    });
    (polyline as unknown as { name?: string }).name = 'drawing-preview';
    canvas.add(polyline);
  }

  vertices.forEach((vertex) => {
    const marker = new fabric.Circle({
      left: vertex.x - 2.5,
      top: vertex.y - 2.5,
      radius: 2.5,
      fill: '#1d4ed8',
      stroke: '#ffffff',
      strokeWidth: 0.75,
      selectable: false,
      evented: false,
      objectCaching: false,
    });
    (marker as unknown as { name?: string }).name = 'drawing-preview';
    canvas.add(marker);
  });

  canvas.requestRenderAll();
}

function addEdgeWithWallReuse(
  sourceWalls: Wall2D[],
  start: Point2D,
  end: Point2D,
  layerId: string,
  tolerance: number
): Wall2D[] {
  if (distanceBetween(start, end) <= 0.001) return sourceWalls;

  let walls = [...sourceWalls];
  const lineVector = { x: end.x - start.x, y: end.y - start.y };
  const lineLength = Math.hypot(lineVector.x, lineVector.y);
  if (lineLength <= 0.001) return walls;

  const unit = { x: lineVector.x / lineLength, y: lineVector.y / lineLength };

  // Split existing walls at overlap boundaries to isolate shared segments.
  let overlaps = collectColinearOverlaps(walls, start, end, tolerance);
  overlaps.forEach((overlap) => {
    const startPoint = pointAtDistance(start, unit, overlap.start);
    const endPoint = pointAtDistance(start, unit, overlap.end);
    walls = splitWallsAtPointOnLine(walls, startPoint, start, end, layerId, tolerance);
    walls = splitWallsAtPointOnLine(walls, endPoint, start, end, layerId, tolerance);
  });

  overlaps = collectColinearOverlaps(walls, start, end, tolerance);
  const coveredIntervals = mergeIntervals(
    overlaps.map((overlap) => ({ start: overlap.start, end: overlap.end })),
    tolerance
  );
  const uncoveredIntervals = subtractIntervals(
    [{ start: 0, end: lineLength }],
    coveredIntervals,
    tolerance
  );

  uncoveredIntervals.forEach((segment) => {
    if (segment.end - segment.start <= tolerance) return;
    const segmentStart = pointAtDistance(start, unit, segment.start);
    const segmentEnd = pointAtDistance(start, unit, segment.end);
    walls.push(
      createWallSegment(segmentStart, segmentEnd, {
        layer: layerId,
      })
    );
  });

  return walls;
}

function collectColinearOverlaps(
  walls: Wall2D[],
  lineStart: Point2D,
  lineEnd: Point2D,
  tolerance: number
): ColinearOverlap[] {
  const lineLength = distanceBetween(lineStart, lineEnd);
  if (lineLength <= 0.001) return [];
  const unit = {
    x: (lineEnd.x - lineStart.x) / lineLength,
    y: (lineEnd.y - lineStart.y) / lineLength,
  };

  const overlaps: ColinearOverlap[] = [];
  walls.forEach((wall) => {
    if (!isWallColinearWithLine(wall, lineStart, lineEnd, tolerance)) return;

    const projectedStart = dotProduct(
      { x: wall.start.x - lineStart.x, y: wall.start.y - lineStart.y },
      unit
    );
    const projectedEnd = dotProduct(
      { x: wall.end.x - lineStart.x, y: wall.end.y - lineStart.y },
      unit
    );
    const overlapStart = Math.max(0, Math.min(projectedStart, projectedEnd));
    const overlapEnd = Math.min(lineLength, Math.max(projectedStart, projectedEnd));
    if (overlapEnd - overlapStart <= tolerance) return;

    overlaps.push({
      wallId: wall.id,
      start: overlapStart,
      end: overlapEnd,
    });
  });
  return overlaps;
}

function splitWallsAtPointOnLine(
  sourceWalls: Wall2D[],
  splitPoint: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D,
  fallbackLayer: string,
  tolerance: number
): Wall2D[] {
  let walls = [...sourceWalls];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      if (!wall) continue;
      if (!isWallColinearWithLine(wall, lineStart, lineEnd, tolerance)) continue;
      if (arePointsClose(wall.start, splitPoint, tolerance) || arePointsClose(wall.end, splitPoint, tolerance)) {
        continue;
      }
      if (!isPointOnSegment(splitPoint, wall.start, wall.end, tolerance)) continue;

      const splitResult = splitWallAtPoint(wall, splitPoint, fallbackLayer);
      if (!splitResult) continue;
      walls.splice(i, 1, splitResult.first, splitResult.second);
      changed = true;
      break;
    }
  }
  return walls;
}

function isWallColinearWithLine(
  wall: Wall2D,
  lineStart: Point2D,
  lineEnd: Point2D,
  tolerance: number
): boolean {
  return (
    pointLineDistance(wall.start, lineStart, lineEnd) <= tolerance &&
    pointLineDistance(wall.end, lineStart, lineEnd) <= tolerance
  );
}

function pointLineDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const lineDx = lineEnd.x - lineStart.x;
  const lineDy = lineEnd.y - lineStart.y;
  const length = Math.hypot(lineDx, lineDy);
  if (length <= 0.0001) return distanceBetween(point, lineStart);
  const cross = Math.abs(lineDx * (point.y - lineStart.y) - lineDy * (point.x - lineStart.x));
  return cross / length;
}

function isPointOnSegment(point: Point2D, segmentStart: Point2D, segmentEnd: Point2D, tolerance: number): boolean {
  const segmentLength = distanceBetween(segmentStart, segmentEnd);
  if (segmentLength <= tolerance) return false;
  const d1 = distanceBetween(segmentStart, point);
  const d2 = distanceBetween(point, segmentEnd);
  return Math.abs(d1 + d2 - segmentLength) <= tolerance * 2;
}

function dotProduct(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

function pointAtDistance(start: Point2D, unit: Point2D, distance: number): Point2D {
  return {
    x: start.x + unit.x * distance,
    y: start.y + unit.y * distance,
  };
}

function mergeIntervals(intervals: OverlapInterval[], tolerance: number): OverlapInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: OverlapInterval[] = [];

  sorted.forEach((interval) => {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end + tolerance) {
      merged.push({ ...interval });
      return;
    }
    last.end = Math.max(last.end, interval.end);
  });

  return merged;
}

function subtractIntervals(
  source: OverlapInterval[],
  remove: OverlapInterval[],
  tolerance: number
): OverlapInterval[] {
  let result = [...source];

  remove.forEach((cut) => {
    const next: OverlapInterval[] = [];
    result.forEach((segment) => {
      if (cut.end <= segment.start + tolerance || cut.start >= segment.end - tolerance) {
        next.push(segment);
        return;
      }
      if (cut.start > segment.start + tolerance) {
        next.push({ start: segment.start, end: Math.max(segment.start, cut.start) });
      }
      if (cut.end < segment.end - tolerance) {
        next.push({ start: Math.min(segment.end, cut.end), end: segment.end });
      }
    });
    result = next;
  });

  return result.filter((segment) => segment.end - segment.start > tolerance);
}

function renderDrawingPreview(
  canvas: fabric.Canvas,
  points: Point2D[],
  tool: DrawingTool
): void {
  clearDrawingPreview(canvas);

  if (points.length < 2) return;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return;

  let previewObject: fabric.Object | null = null;

  switch (tool) {
    case 'wall':
    case 'line':
      previewObject = new fabric.Line(
        [firstPoint.x, firstPoint.y, lastPoint.x, lastPoint.y],
        {
          stroke: '#2196F3',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          selectable: false,
          evented: false,
          name: 'drawing-preview',
        }
      );
      break;

    case 'room':
    case 'pencil':
    case 'spline':
      previewObject = new fabric.Polyline(
        points.map((p) => ({ x: p.x, y: p.y })),
        {
          stroke: '#2196F3',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          fill: 'transparent',
          selectable: false,
          evented: false,
          name: 'drawing-preview',
        }
      );
      break;

    case 'rectangle':
      if (points.length >= 2) {
        const start = points[0];
        const end = points[points.length - 1];
        if (!start || !end) break;
        previewObject = new fabric.Rect({
          left: Math.min(start.x, end.x),
          top: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
          stroke: '#2196F3',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          fill: 'transparent',
          selectable: false,
          evented: false,
          name: 'drawing-preview',
        });
      }
      break;

    case 'circle':
      if (points.length >= 2) {
        const center = points[0];
        const edge = points[points.length - 1];
        if (!center || !edge) break;
        const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
        previewObject = new fabric.Circle({
          left: center.x - radius,
          top: center.y - radius,
          radius,
          stroke: '#2196F3',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          fill: 'transparent',
          selectable: false,
          evented: false,
          name: 'drawing-preview',
        });
      }
      break;
  }

  if (previewObject) {
    canvas.add(previewObject);
    canvas.renderAll();
  }
}

function clearDrawingPreview(canvas: fabric.Canvas, shouldRender = true): void {
  const previewObjects = canvas.getObjects().filter((obj) => (obj as unknown as { name?: string }).name === 'drawing-preview');
  previewObjects.forEach((obj) => canvas.remove(obj));
  if (shouldRender) {
    canvas.requestRenderAll();
  }
}

export default DrawingCanvas;
