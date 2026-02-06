/**
 * Smart Drawing Store
 * 
 * Zustand store for managing drawing state with history support.
 * Follows industrial-standard patterns for CAD applications.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  Point2D,
  Wall2D,
  Room2D,
  Opening2D,
  Dimension2D,
  Annotation2D,
  Sketch2D,
  Guide,
  SymbolInstance2D,
  DrawingLayer,
  DrawingTool,
  ImportedDrawing,
  DetectedElement,
  PageConfig,
  HistoryEntry,
  FloorPlanData,
  SplineSettings,
  SplineMethod,
} from '../types';
import { DEFAULT_SPLINE_SETTINGS } from '../utils/spline';
import { generateId, calculatePolygonArea } from '../utils/geometry';

// =============================================================================
// Default Settings
// =============================================================================

const DEFAULT_PAGE_CONFIG: PageConfig = {
  // A3 landscape at 96 DPI
  width: 1587,
  height: 1122,
  orientation: 'landscape',
};

const DEFAULT_ELEMENT_SETTINGS = {
  defaultWallThickness: 0.2,
  defaultWallHeight: 3.0,
  defaultWindowHeight: 1.2,
  defaultWindowSillHeight: 0.9,
  defaultDoorHeight: 2.1,
};

const DEFAULT_LAYERS: DrawingLayer[] = [
  { id: 'default', name: 'Default', visible: true, locked: false, opacity: 1, elements: [] },
  { id: 'imported', name: 'Imported Drawing', visible: true, locked: true, opacity: 0.5, elements: [] },
  { id: 'detected', name: 'AI Detected', visible: true, locked: false, opacity: 0.8, elements: [] },
];

// =============================================================================
// Store Interface
// =============================================================================

export interface DrawingState {
  // Drawing Elements
  walls: Wall2D[];
  rooms: Room2D[];
  dimensions: Dimension2D[];
  annotations: Annotation2D[];
  sketches: Sketch2D[];
  guides: Guide[];
  symbols: SymbolInstance2D[];
  layers: DrawingLayer[];
  
  // Import State
  importedDrawing: ImportedDrawing | null;
  importProgress: number;
  isProcessing: boolean;
  processingStatus: string;
  detectedElements: DetectedElement[];
  
  // Tool State
  activeTool: DrawingTool;
  activeLayerId: string | null;
  selectedElementIds: string[];
  hoveredElementId: string | null;
  
  // Aliases for backward compatibility
  tool: DrawingTool;
  selectedIds: string[];
  
  // View State
  zoom: number;
  zoomToFitRequestId: number;
  resetViewRequestId: number;
  panOffset: Point2D;
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;
  showRulers: boolean;
  pageConfig: PageConfig;
  
  // Preview State
  previewHeight: number;
  show3DPreview: boolean;
  autoSync3D: boolean;
  
  // Calibration State
  isCalibrating: boolean;
  calibrationStep: number;
  
  // History State
  history: HistoryEntry[];
  historyIndex: number;
  
  // Element Defaults
  defaultWallThickness: number;
  defaultWallHeight: number;
  defaultWindowHeight: number;
  defaultWindowSillHeight: number;
  defaultDoorHeight: number;
  
  // Spline Settings
  splineSettings: SplineSettings;
  splineEditMode: 'draw' | 'edit-points' | 'add-point' | 'remove-point';
  editingSplineId: string | null;
  
  // Actions - Import
  setImportedDrawing: (drawing: ImportedDrawing | null) => void;
  updateImportedDrawing: (data: Partial<ImportedDrawing>) => void;
  setImportProgress: (progress: number) => void;
  setProcessingStatus: (status: string, isProcessing: boolean) => void;
  clearImportedDrawing: () => void;
  
  // Actions - Detection
  setDetectedElements: (elements: DetectedElement[]) => void;
  acceptDetectedElement: (id: string) => void;
  rejectDetectedElement: (id: string) => void;
  acceptAllDetectedElements: () => void;
  clearDetectedElements: () => void;
  
  // Actions - Walls
  addWall: (wall: Omit<Wall2D, 'id' | 'openings'>) => string;
  updateWall: (id: string, data: Partial<Wall2D>) => void;
  deleteWall: (id: string) => void;
  addOpeningToWall: (wallId: string, opening: Omit<Opening2D, 'id' | 'wallId'>) => string;
  updateOpening: (wallId: string, openingId: string, data: Partial<Opening2D>) => void;
  deleteOpening: (wallId: string, openingId: string) => void;
  
  // Actions - Rooms
  addRoom: (room: Omit<Room2D, 'id' | 'area'>) => string;
  updateRoom: (id: string, data: Partial<Room2D>) => void;
  deleteRoom: (id: string) => void;
  detectRoomsFromWalls: () => void;
  
  // Actions - Dimensions
  addDimension: (dimension: Omit<Dimension2D, 'id'>) => string;
  updateDimension: (id: string, data: Partial<Dimension2D>) => void;
  deleteDimension: (id: string) => void;
  
  // Actions - Annotations
  addAnnotation: (annotation: Omit<Annotation2D, 'id'>) => string;
  updateAnnotation: (id: string, data: Partial<Annotation2D>) => void;
  deleteAnnotation: (id: string) => void;
  
  // Actions - Sketches
  addSketch: (sketch: Omit<Sketch2D, 'id'>) => string;
  updateSketch: (id: string, data: Partial<Sketch2D>) => void;
  deleteSketch: (id: string) => void;
  
  // Actions - Guides
  addGuide: (guide: Guide) => void;
  removeGuide: (id: string) => void;
  clearGuides: () => void;
  
  // Actions - Symbols
  addSymbol: (symbol: Omit<SymbolInstance2D, 'id'>) => string;
  updateSymbol: (id: string, data: Partial<SymbolInstance2D>) => void;
  deleteSymbol: (id: string) => void;
  
  // Actions - Selection
  selectElement: (id: string, addToSelection?: boolean) => void;
  deselectElement: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setHoveredElement: (id: string | null) => void;
  deleteSelectedElements: () => void;
  
  // Aliases for backward compatibility
  setSelectedIds: (ids: string[]) => void;
  deleteSelected: () => void;
  
  // Actions - Tools
  setActiveTool: (tool: DrawingTool) => void;
  
  // Alias for backward compatibility
  setTool: (tool: DrawingTool) => void;
  
  // Computed properties for history
  canUndo: boolean;
  canRedo: boolean;
  
  // Actions - View
  setZoom: (zoom: number) => void;
  setPanOffset: (offset: Point2D) => void;
  setGridSize: (size: number) => void;
  setSnapToGrid: (snap: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setShowRulers: (show: boolean) => void;
  toggleRulers: () => void;
  setPageConfig: (config: Partial<PageConfig>) => void;
  resetView: () => void;
  zoomToFit: () => void;
  
  // Actions - Preview
  setPreviewHeight: (height: number) => void;
  setShow3DPreview: (show: boolean) => void;
  setAutoSync3D: (sync: boolean) => void;
  
  // Actions - Calibration
  startCalibration: () => void;
  addCalibrationPoint: (point: Point2D) => void;
  setCalibrationDistance: (distance: number) => void;
  finishCalibration: () => void;
  cancelCalibration: () => void;
  
  // Actions - Layers
  addLayer: (name: string) => string;
  updateLayer: (id: string, data: Partial<DrawingLayer>) => void;
  deleteLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  moveElementToLayer: (elementId: string, layerId: string) => void;
  toggleLayerVisibility: (id: string) => void;
  toggleLayerLock: (id: string) => void;
  
  // Actions - History
  saveToHistory: (action: string) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  
  // Actions - Export/Import
  exportToJSON: () => string;
  importFromJSON: (json: string) => void;
  getFloorPlanData: () => FloorPlanData;
  
  // Data management aliases
  hvacLayout: unknown | null;
  loadData: (data: unknown) => void;
  exportData: () => unknown;
  
  // Actions - Spline
  setSplineSettings: (settings: Partial<SplineSettings>) => void;
  setSplineEditMode: (mode: 'draw' | 'edit-points' | 'add-point' | 'remove-point') => void;
  setEditingSpline: (id: string | null) => void;
  addSplineControlPoint: (sketchId: string, point: Point2D, index?: number) => void;
  updateSplineControlPoint: (sketchId: string, pointIndex: number, position: Point2D) => void;
  removeSplineControlPoint: (sketchId: string, pointIndex: number) => void;
  toggleSplineClosed: (sketchId: string) => void;
  convertSplineMethod: (sketchId: string, method: SplineMethod) => void;
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useDrawingStore = create<DrawingState>()(
  devtools(
    (set, get) => ({
      // Initial State
      walls: [],
      rooms: [],
      dimensions: [],
      annotations: [],
      sketches: [],
      guides: [],
      symbols: [],
      layers: [...DEFAULT_LAYERS],
      importedDrawing: null,
      importProgress: 0,
      isProcessing: false,
      processingStatus: '',
      detectedElements: [],
      activeTool: 'select',
      activeLayerId: 'default',
      selectedElementIds: [],
      hoveredElementId: null,
      
      // Aliases for backward compatibility (computed from main properties)
      get tool() { return get().activeTool; },
      get selectedIds() { return get().selectedElementIds; },
      get canUndo() { return get().historyIndex > 0; },
      get canRedo() { return get().historyIndex < get().history.length - 1; },
      hvacLayout: null,
      
      zoom: 1,
      zoomToFitRequestId: 0,
      resetViewRequestId: 0,
      panOffset: { x: 0, y: 0 },
      gridSize: 20,
      snapToGrid: true,
      showGrid: true,
      showRulers: true,
      pageConfig: { ...DEFAULT_PAGE_CONFIG },
      previewHeight: 3.0,
      show3DPreview: true,
      autoSync3D: true,
      isCalibrating: false,
      calibrationStep: 0,
      history: [],
      historyIndex: -1,
      ...DEFAULT_ELEMENT_SETTINGS,
      splineSettings: { ...DEFAULT_SPLINE_SETTINGS },
      splineEditMode: 'draw',
      editingSplineId: null,

      // Import Actions
      setImportedDrawing: (drawing) => set({ importedDrawing: drawing }),
      
      updateImportedDrawing: (data) => set((state) => ({
        importedDrawing: state.importedDrawing 
          ? { ...state.importedDrawing, ...data } 
          : null,
      })),
      
      setImportProgress: (progress) => set({ importProgress: progress }),
      
      setProcessingStatus: (status, isProcessing) => set({ 
        processingStatus: status, 
        isProcessing 
      }),
      
      clearImportedDrawing: () => set({ 
        importedDrawing: null, 
        importProgress: 0, 
        detectedElements: [] 
      }),

      // Detection Actions
      setDetectedElements: (elements) => set({ detectedElements: elements }),
      
      acceptDetectedElement: (id) => set((state) => ({
        detectedElements: state.detectedElements.map((el) => 
          el.id === id ? { ...el, accepted: true } : el
        ),
      })),
      
      rejectDetectedElement: (id) => set((state) => ({
        detectedElements: state.detectedElements.filter((el) => el.id !== id),
      })),
      
      acceptAllDetectedElements: () => set((state) => ({
        detectedElements: state.detectedElements.map((el) => ({ ...el, accepted: true })),
      })),
      
      clearDetectedElements: () => set({ detectedElements: [] }),

      // Guide Actions
      addGuide: (guide) => set((state) => ({ guides: [...state.guides, guide] })),
      removeGuide: (id) => set((state) => ({ guides: state.guides.filter((g) => g.id !== id) })),
      clearGuides: () => set({ guides: [] }),

      // Wall Actions
      addWall: (wall) => {
        const id = generateId();
        set((state) => ({ 
          walls: [...state.walls, { ...wall, id, openings: [] }] 
        }));
        get().saveToHistory('Add wall');
        return id;
      },
      
      updateWall: (id, data) => {
        set((state) => ({ 
          walls: state.walls.map((w) => w.id === id ? { ...w, ...data } : w) 
        }));
        get().saveToHistory('Update wall');
      },
      
      deleteWall: (id) => {
        set((state) => ({ walls: state.walls.filter((w) => w.id !== id) }));
        get().saveToHistory('Delete wall');
      },
      
      addOpeningToWall: (wallId, opening) => {
        const id = generateId();
        set((state) => ({
          walls: state.walls.map((w) =>
            w.id === wallId 
              ? { ...w, openings: [...w.openings, { ...opening, id, wallId }] } 
              : w
          ),
        }));
        get().saveToHistory('Add opening');
        return id;
      },
      
      updateOpening: (wallId, openingId, data) => {
        set((state) => ({
          walls: state.walls.map((w) =>
            w.id === wallId
              ? { 
                  ...w, 
                  openings: w.openings.map((o) => 
                    o.id === openingId ? { ...o, ...data } : o
                  ) 
                }
              : w
          ),
        }));
        get().saveToHistory('Update opening');
      },
      
      deleteOpening: (wallId, openingId) => {
        set((state) => ({
          walls: state.walls.map((w) =>
            w.id === wallId 
              ? { ...w, openings: w.openings.filter((o) => o.id !== openingId) } 
              : w
          ),
        }));
        get().saveToHistory('Delete opening');
      },

      // Room Actions
      addRoom: (room) => {
        const id = generateId();
        const area = calculatePolygonArea(room.vertices);
        set((state) => ({ rooms: [...state.rooms, { ...room, id, area }] }));
        get().saveToHistory('Add room');
        return id;
      },
      
      updateRoom: (id, data) => {
        set((state) => ({
          rooms: state.rooms.map((r) => {
            if (r.id !== id) return r;
            const updated = { ...r, ...data };
            if (data.vertices) {
              updated.area = calculatePolygonArea(data.vertices);
            }
            return updated;
          }),
        }));
        get().saveToHistory('Update room');
      },
      
      deleteRoom: (id) => {
        set((state) => ({ rooms: state.rooms.filter((r) => r.id !== id) }));
        get().saveToHistory('Delete room');
      },
      
      detectRoomsFromWalls: () => {
        const { walls, rooms, setProcessingStatus } = get();
        if (walls.length < 3) {
          setProcessingStatus('Add at least 3 walls to detect rooms.', false);
          return;
        }

        const points: Point2D[] = [];
        walls.forEach((wall) => {
          points.push(wall.start);
          points.push(wall.end);
        });

        const uniquePoints: Point2D[] = [];
        const tolerance = 6;
        points.forEach((point) => {
          const exists = uniquePoints.some(
            (p) => Math.abs(p.x - point.x) < tolerance && Math.abs(p.y - point.y) < tolerance
          );
          if (!exists) uniquePoints.push(point);
        });

        if (uniquePoints.length < 3) {
          setProcessingStatus('Unable to detect a room outline.', false);
          return;
        }

        const centroid = {
          x: uniquePoints.reduce((sum, p) => sum + p.x, 0) / uniquePoints.length,
          y: uniquePoints.reduce((sum, p) => sum + p.y, 0) / uniquePoints.length,
        };
        
        const sorted = [...uniquePoints].sort((a, b) => {
          const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
          const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
          return angleA - angleB;
        });

        const area = Math.abs(calculatePolygonArea(sorted));
        if (area < 1) {
          setProcessingStatus('Detected room is too small.', false);
          return;
        }

        const newCentroid = {
          x: sorted.reduce((sum, p) => sum + p.x, 0) / sorted.length,
          y: sorted.reduce((sum, p) => sum + p.y, 0) / sorted.length,
        };
        
        const isDuplicate = rooms.some((room) => {
          const roomCentroid = {
            x: room.vertices.reduce((sum, p) => sum + p.x, 0) / room.vertices.length,
            y: room.vertices.reduce((sum, p) => sum + p.y, 0) / room.vertices.length,
          };
          return Math.hypot(roomCentroid.x - newCentroid.x, roomCentroid.y - newCentroid.y) < 10;
        });

        if (isDuplicate) {
          setProcessingStatus('Room already detected.', false);
          return;
        }

        const roomName = `Room ${rooms.length + 1}`;
        const newRoom: Room2D = {
          id: generateId(),
          name: roomName,
          vertices: sorted,
          area,
          spaceType: 'office',
          floorHeight: 0,
          ceilingHeight: 3,
        };

        set((state) => ({ rooms: [...state.rooms, newRoom] }));
        get().saveToHistory('Detect rooms');
        setProcessingStatus(`Detected ${roomName}.`, false);
      },

      // Dimension Actions
      addDimension: (dimension) => {
        const id = generateId();
        set((state) => ({ dimensions: [...state.dimensions, { ...dimension, id }] }));
        get().saveToHistory('Add dimension');
        return id;
      },
      
      updateDimension: (id, data) => {
        set((state) => ({ 
          dimensions: state.dimensions.map((d) => d.id === id ? { ...d, ...data } : d) 
        }));
        get().saveToHistory('Update dimension');
      },
      
      deleteDimension: (id) => {
        set((state) => ({ dimensions: state.dimensions.filter((d) => d.id !== id) }));
        get().saveToHistory('Delete dimension');
      },

      // Annotation Actions
      addAnnotation: (annotation) => {
        const id = generateId();
        set((state) => ({ annotations: [...state.annotations, { ...annotation, id }] }));
        get().saveToHistory('Add annotation');
        return id;
      },
      
      updateAnnotation: (id, data) => {
        set((state) => ({ 
          annotations: state.annotations.map((a) => a.id === id ? { ...a, ...data } : a) 
        }));
        get().saveToHistory('Update annotation');
      },
      
      deleteAnnotation: (id) => {
        set((state) => ({ annotations: state.annotations.filter((a) => a.id !== id) }));
        get().saveToHistory('Delete annotation');
      },

      // Sketch Actions
      addSketch: (sketch) => {
        const id = generateId();
        set((state) => ({ sketches: [...state.sketches, { ...sketch, id }] }));
        get().saveToHistory('Add sketch');
        return id;
      },
      
      updateSketch: (id, data) => {
        set((state) => ({ 
          sketches: state.sketches.map((s) => s.id === id ? { ...s, ...data } : s) 
        }));
        get().saveToHistory('Update sketch');
      },
      
      deleteSketch: (id) => {
        set((state) => ({ sketches: state.sketches.filter((s) => s.id !== id) }));
        get().saveToHistory('Delete sketch');
      },

      // Symbol Actions
      addSymbol: (symbol) => {
        const id = generateId();
        set((state) => ({ symbols: [...state.symbols, { ...symbol, id }] }));
        get().saveToHistory('Add symbol');
        return id;
      },
      
      updateSymbol: (id, data) => {
        set((state) => ({ 
          symbols: state.symbols.map((s) => s.id === id ? { ...s, ...data } : s) 
        }));
        get().saveToHistory('Update symbol');
      },
      
      deleteSymbol: (id) => {
        set((state) => ({ symbols: state.symbols.filter((s) => s.id !== id) }));
        get().saveToHistory('Delete symbol');
      },

      // Selection Actions
      selectElement: (id, addToSelection = false) => set((state) => ({
        selectedElementIds: addToSelection 
          ? [...state.selectedElementIds, id] 
          : [id],
      })),
      
      deselectElement: (id) => set((state) => ({
        selectedElementIds: state.selectedElementIds.filter((eid) => eid !== id),
      })),
      
      clearSelection: () => set({ selectedElementIds: [] }),
      
      selectAll: () => set((state) => ({
        selectedElementIds: [
          ...state.walls.map((w) => w.id),
          ...state.rooms.map((r) => r.id),
          ...state.dimensions.map((d) => d.id),
          ...state.annotations.map((a) => a.id),
          ...state.sketches.map((s) => s.id),
          ...state.symbols.map((s) => s.id),
        ],
      })),
      
      setHoveredElement: (id) => set({ hoveredElementId: id }),
      
      deleteSelectedElements: () => {
        const { selectedElementIds, walls, rooms, dimensions, annotations, sketches, symbols } = get();
        set({
          walls: walls.filter((w) => !selectedElementIds.includes(w.id)),
          rooms: rooms.filter((r) => !selectedElementIds.includes(r.id)),
          dimensions: dimensions.filter((d) => !selectedElementIds.includes(d.id)),
          annotations: annotations.filter((a) => !selectedElementIds.includes(a.id)),
          sketches: sketches.filter((s) => !selectedElementIds.includes(s.id)),
          symbols: symbols.filter((s) => !selectedElementIds.includes(s.id)),
          selectedElementIds: [],
        });
        get().saveToHistory('Delete selected');
      },
      
      // Alias methods for backward compatibility
      setSelectedIds: (ids) => set({ selectedElementIds: ids }),
      deleteSelected: () => get().deleteSelectedElements(),
      setTool: (tool) => set({ activeTool: tool }),
      loadData: (data) => { /* TODO: Implement data loading */ console.log('loadData:', data); },
      exportData: () => get().getFloorPlanData(),

      // Tool Actions
      setActiveTool: (tool) => set({ activeTool: tool }),

      // View Actions
      setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
      setPanOffset: (offset) => set({ panOffset: offset }),
      setGridSize: (size) => set({ gridSize: size }),
      setSnapToGrid: (snap) => set({ snapToGrid: snap }),
      setShowGrid: (show) => set({ showGrid: show }),
      setShowRulers: (show) => set({ showRulers: show }),
      toggleRulers: () => set((state) => ({ showRulers: !state.showRulers })),
      setPageConfig: (config) => set((state) => ({ 
        pageConfig: { ...state.pageConfig, ...config } 
      })),
      resetView: () => set({ zoom: 1, panOffset: { x: 0, y: 0 }, resetViewRequestId: Date.now() }),
      zoomToFit: () => set({ zoomToFitRequestId: Date.now() }),

      // Preview Actions
      setPreviewHeight: (height) => set({ previewHeight: height }),
      setShow3DPreview: (show) => set({ show3DPreview: show }),
      setAutoSync3D: (sync) => set({ autoSync3D: sync }),

      // Calibration Actions
      startCalibration: () => set({ 
        isCalibrating: true, 
        calibrationStep: 1, 
        activeTool: 'calibrate' 
      }),
      
      addCalibrationPoint: (point) => set((state) => {
        if (!state.importedDrawing) return state;
        const points = state.importedDrawing.calibrationPoints || [];
        const newPoint = { id: generateId(), pixelPoint: point };
        return {
          importedDrawing: { 
            ...state.importedDrawing, 
            calibrationPoints: [...points, newPoint] 
          },
          calibrationStep: state.calibrationStep + 1,
        };
      }),
      
      setCalibrationDistance: (distance) => set((state) => {
        if (!state.importedDrawing?.calibrationPoints || 
            state.importedDrawing.calibrationPoints.length < 2) {
          return state;
        }
        const [p1, p2] = state.importedDrawing.calibrationPoints;
        const pixelDistance = Math.sqrt(
          Math.pow(p2.pixelPoint.x - p1.pixelPoint.x, 2) + 
          Math.pow(p2.pixelPoint.y - p1.pixelPoint.y, 2)
        );
        const scale = pixelDistance / distance;
        return { 
          importedDrawing: { ...state.importedDrawing, scale }, 
          isCalibrating: false, 
          calibrationStep: 0, 
          activeTool: 'select' 
        };
      }),
      
      finishCalibration: () => set({ 
        isCalibrating: false, 
        calibrationStep: 0, 
        activeTool: 'select' 
      }),
      
      cancelCalibration: () => set((state) => ({
        isCalibrating: false,
        calibrationStep: 0,
        activeTool: 'select',
        importedDrawing: state.importedDrawing 
          ? { ...state.importedDrawing, calibrationPoints: [] } 
          : null,
      })),

      // Layer Actions
      addLayer: (name) => {
        const id = generateId();
        set((state) => ({
          layers: [...state.layers, { 
            id, 
            name, 
            visible: true, 
            locked: false, 
            opacity: 1, 
            elements: [] 
          }],
        }));
        return id;
      },
      
      updateLayer: (id, data) => set((state) => ({
        layers: state.layers.map((l) => l.id === id ? { ...l, ...data } : l),
      })),
      
      deleteLayer: (id) => set((state) => ({
        layers: state.layers.filter((l) => l.id !== id),
        activeLayerId: state.activeLayerId === id ? 'default' : state.activeLayerId,
      })),
      
      setActiveLayer: (id) => set({ activeLayerId: id }),
      
      moveElementToLayer: (elementId, layerId) => set((state) => ({
        layers: state.layers.map((l) => ({
          ...l,
          elements: l.id === layerId 
            ? [...l.elements.filter((e) => e !== elementId), elementId] 
            : l.elements.filter((e) => e !== elementId),
        })),
      })),
      
      toggleLayerVisibility: (id) => set((state) => ({
        layers: state.layers.map((l) => 
          l.id === id ? { ...l, visible: !l.visible } : l
        ),
      })),
      
      toggleLayerLock: (id) => set((state) => ({
        layers: state.layers.map((l) => 
          l.id === id ? { ...l, locked: !l.locked } : l
        ),
      })),

      // History Actions
      saveToHistory: (action) => set((state) => {
        const entry: HistoryEntry = {
          id: generateId(),
          timestamp: Date.now(),
          action,
          snapshot: {
            walls: JSON.parse(JSON.stringify(state.walls)),
            rooms: JSON.parse(JSON.stringify(state.rooms)),
            detectedElements: JSON.parse(JSON.stringify(state.detectedElements)),
            dimensions: JSON.parse(JSON.stringify(state.dimensions)),
            annotations: JSON.parse(JSON.stringify(state.annotations)),
            sketches: JSON.parse(JSON.stringify(state.sketches)),
            symbols: JSON.parse(JSON.stringify(state.symbols)),
          },
        };
        const newHistory = state.history.slice(0, state.historyIndex + 1);
        newHistory.push(entry);
        if (newHistory.length > 50) {
          newHistory.shift();
        }
        return { history: newHistory, historyIndex: newHistory.length - 1 };
      }),
      
      undo: () => set((state) => {
        if (state.historyIndex <= 0) return state;
        const prevEntry = state.history[state.historyIndex - 1];
        return {
          walls: prevEntry.snapshot.walls,
          rooms: prevEntry.snapshot.rooms,
          detectedElements: prevEntry.snapshot.detectedElements,
          dimensions: prevEntry.snapshot.dimensions,
          annotations: prevEntry.snapshot.annotations,
          sketches: prevEntry.snapshot.sketches,
          symbols: prevEntry.snapshot.symbols,
          historyIndex: state.historyIndex - 1,
        };
      }),
      
      redo: () => set((state) => {
        if (state.historyIndex >= state.history.length - 1) return state;
        const nextEntry = state.history[state.historyIndex + 1];
        return {
          walls: nextEntry.snapshot.walls,
          rooms: nextEntry.snapshot.rooms,
          detectedElements: nextEntry.snapshot.detectedElements,
          dimensions: nextEntry.snapshot.dimensions,
          annotations: nextEntry.snapshot.annotations,
          sketches: nextEntry.snapshot.sketches,
          symbols: nextEntry.snapshot.symbols,
          historyIndex: state.historyIndex + 1,
        };
      }),
      
      clearHistory: () => set({ history: [], historyIndex: -1 }),

      // Export/Import Actions
      exportToJSON: () => {
        const { walls, rooms, importedDrawing, dimensions, annotations, sketches, symbols, guides } = get();
        return JSON.stringify({
          version: '1.0',
          walls,
          rooms,
          dimensions,
          annotations,
          sketches,
          guides,
          symbols,
          scale: importedDrawing?.scale || 100,
          exportedAt: new Date().toISOString(),
        }, null, 2);
      },
      
      importFromJSON: (json) => {
        try {
          const data = JSON.parse(json);
          set({
            walls: data.walls || [],
            rooms: data.rooms || [],
            dimensions: data.dimensions || [],
            annotations: data.annotations || [],
            sketches: data.sketches || [],
            guides: data.guides || [],
            symbols: data.symbols || [],
          });
          get().setProcessingStatus('Imported drawing JSON.', false);
        } catch (error) {
          console.error('Failed to import JSON:', error);
          get().setProcessingStatus('Failed to import drawing JSON.', false);
        }
      },
      
      getFloorPlanData: () => {
        const { walls, rooms, importedDrawing, pageConfig } = get();
        return {
          walls,
          rooms,
          scale: importedDrawing?.scale || 100,
          width: importedDrawing?.originalWidth || pageConfig.width,
          height: importedDrawing?.originalHeight || pageConfig.height,
        };
      },

      // Spline Actions
      setSplineSettings: (settings) => set((state) => ({
        splineSettings: { ...state.splineSettings, ...settings },
      })),
      
      setSplineEditMode: (mode) => set({ splineEditMode: mode }),
      
      setEditingSpline: (id) => set({ editingSplineId: id }),
      
      addSplineControlPoint: (sketchId, point, index) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            const newPoints = [...s.points];
            if (index !== undefined && index >= 0 && index <= newPoints.length) {
              newPoints.splice(index, 0, point);
            } else {
              newPoints.push(point);
            }
            return { ...s, points: newPoints };
          }),
        }));
        get().saveToHistory('Add spline point');
      },
      
      updateSplineControlPoint: (sketchId, pointIndex, position) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            const newPoints = [...s.points];
            if (pointIndex >= 0 && pointIndex < newPoints.length) {
              newPoints[pointIndex] = position;
            }
            return { ...s, points: newPoints };
          }),
        }));
        get().saveToHistory('Move spline point');
      },
      
      removeSplineControlPoint: (sketchId, pointIndex) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            if (s.points.length <= 2) return s;
            const newPoints = s.points.filter((_, i) => i !== pointIndex);
            return { ...s, points: newPoints };
          }),
        }));
        get().saveToHistory('Remove spline point');
      },
      
      toggleSplineClosed: (sketchId) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            const currentSettings = s.splineSettings || DEFAULT_SPLINE_SETTINGS;
            return {
              ...s,
              closed: !currentSettings.closed,
              splineSettings: { ...currentSettings, closed: !currentSettings.closed },
            };
          }),
        }));
        get().saveToHistory('Toggle spline closed');
      },
      
      convertSplineMethod: (sketchId, method) => {
        set((state) => ({
          sketches: state.sketches.map((s) => {
            if (s.id !== sketchId || s.type !== 'spline') return s;
            const currentSettings = s.splineSettings || DEFAULT_SPLINE_SETTINGS;
            return {
              ...s,
              splineSettings: { ...currentSettings, method },
            };
          }),
        }));
        get().saveToHistory('Change spline method');
      },
    }),
    { name: 'smart-drawing-store' }
  )
);

// Alias for backwards compatibility
export const useSmartDrawingStore = useDrawingStore;
export type SmartDrawingState = DrawingState;

export default useDrawingStore;
