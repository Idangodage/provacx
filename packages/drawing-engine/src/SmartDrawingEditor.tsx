/**
 * Smart Drawing Editor
 * 
 * Main editor component that combines all smart drawing features
 * into a complete HVAC CAD application.
 */

'use client';

import * as fabric from 'fabric';
import {
  PanelLeftClose,
  PanelRightClose,
  Settings,
  Download,
  Upload,
  FileJson,
  Image,
  Printer,
  Save,
  Grid3X3,
  Ruler,
  Move,
  Minus,
  BoxSelect,
  Type,
} from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';

import {
  DrawingCanvas,
  Toolbar,
  AttributeQuickToolbar,
  PropertiesPanel,
  ObjectLibraryPanel,
  SymbolPalette,
  ZoomIndicator,
  CoordinatesDisplay,
} from './components';
import { MM_TO_PX } from './components/canvas';
import {
  DEFAULT_ARCHITECTURAL_OBJECT_LIBRARY,
  type ArchitecturalObjectDefinition,
} from './data';
import type { SymbolDefinition } from './data/symbol-library';
import { useSmartDrawingStore } from './store';
import type { Point2D, DrawingTool, PageLayout } from './types';


// =============================================================================
// Types
// =============================================================================

export interface SmartDrawingEditorProps {
  /** Unique identifier for the project/drawing */
  projectId?: string;
  /** Initial drawing data to load */
  initialData?: unknown;
  /** Callback when drawing data changes */
  onDataChange?: (data: unknown) => void;
  /** Callback when saving is requested */
  onSave?: (data: unknown) => Promise<void>;
  /** Whether the editor is in read-only mode */
  readOnly?: boolean;
  /** Custom class name */
  className?: string;
}

// =============================================================================
// Ribbon Controls
// =============================================================================

type RibbonTone = 'default' | 'accent' | 'ghost';
const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
type PaperUnit = 'mm' | 'cm' | 'in' | 'm';
type MeasurementMode = 'paper' | 'real';
const mmToPx = (mm: number) => (mm / MM_PER_INCH) * PX_PER_INCH;

const SCALE_PRESETS = [
  '1:1',
  '1:2',
  '1:5',
  '1:10',
  '1:20',
  '1:25',
  '1:50',
  '1:100',
  '1:200',
  '1:500',
  '1:1000',
  '2:1',
  '5:1',
  '10:1',
] as const;

function parseScaleRatio(input: string): { drawing: number; real: number } | null {
  const parts = input.split(':');
  if (parts.length !== 2) return null;
  const drawingRaw = parts[0];
  const realRaw = parts[1];
  if (!drawingRaw || !realRaw) return null;
  const drawing = Number.parseInt(drawingRaw, 10);
  const real = Number.parseInt(realRaw, 10);
  if (!Number.isFinite(drawing) || !Number.isFinite(real) || drawing <= 0 || real <= 0) return null;
  return { drawing, real };
}

function RibbonButton({
  icon,
  label,
  onClick,
  disabled,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: RibbonTone;
}) {
  const toneClasses: Record<RibbonTone, string> = {
    default: 'bg-white border-amber-200/80 text-slate-700 hover:bg-amber-50',
    accent: 'bg-amber-400 border-amber-400 text-amber-950 hover:bg-amber-300',
    ghost: 'bg-transparent border-transparent text-slate-600 hover:bg-amber-50',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        `inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ` +
        `${toneClasses[tone]} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ToggleChip({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ` +
        `${active ? 'bg-amber-200 text-amber-900 border-amber-300' : 'bg-white text-slate-600 border-amber-200/80 hover:bg-amber-50'} ` +
        `${disabled ? 'opacity-60 cursor-not-allowed' : ''}`
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function QuickActionButton({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        `flex items-center gap-1.5 px-2 py-1.5 min-h-[38px] rounded-md border text-10 font-medium transition-colors ` +
        `${active ? 'bg-amber-200 text-amber-900 border-amber-300' : 'bg-white text-slate-600 border-amber-200/80 hover:bg-amber-50'} ` +
        `${disabled ? 'opacity-60 cursor-not-allowed' : ''}`
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function EditorRibbon({
  projectId,
  onExport,
  onImport,
  onSave,
  saveState,
  lastSavedAt,
  showGrid,
  showRulers,
  snapToGrid,
  onToggleGrid,
  onToggleRulers,
  onToggleSnap,
  pageConfig,
  pageLayouts,
  onPageChange,
  scalePreset,
  onScaleChange,
  readOnly,
}: {
  projectId?: string;
  onExport: () => void;
  onImport: () => void;
  onSave?: () => void;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: string | null;
  showGrid: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  onToggleGrid: () => void;
  onToggleRulers: () => void;
  onToggleSnap: () => void;
  pageConfig: { width: number; height: number; orientation: 'portrait' | 'landscape' };
  pageLayouts: PageLayout[];
  onPageChange: (layoutId: string) => void;
  scalePreset: string;
  onScaleChange: (value: string) => void;
  readOnly: boolean;
}) {
  const currentLayoutId =
    pageLayouts.find(
      (layout) =>
        layout.width === pageConfig.width &&
        layout.height === pageConfig.height &&
        layout.orientation === pageConfig.orientation
    )?.id ?? 'custom';
  const pageWidthMm = Math.round((pageConfig.width / PX_PER_INCH) * MM_PER_INCH);
  const pageHeightMm = Math.round((pageConfig.height / PX_PER_INCH) * MM_PER_INCH);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-[#fff3d6] border-b border-amber-200/70">
      <div className="flex items-center gap-2">
        <RibbonButton
          icon={<Upload size={16} />}
          label="Import"
          onClick={onImport}
        />
        <RibbonButton
          icon={<Download size={16} />}
          label="Export"
          onClick={onExport}
        />
        {onSave && (
          <RibbonButton
            icon={<Save size={16} />}
            label={saveState === 'saving' ? 'Saving' : 'Save'}
            onClick={onSave}
            disabled={readOnly || saveState === 'saving'}
            tone="accent"
          />
        )}
      </div>

      <div className="w-px h-6 bg-amber-200/80" />

      <div className="flex items-center gap-2">
        <ToggleChip
          icon={<Grid3X3 size={14} />}
          label="Grid"
          active={showGrid}
          onClick={onToggleGrid}
        />
        <ToggleChip
          icon={<Move size={14} />}
          label="Snap"
          active={snapToGrid}
          onClick={onToggleSnap}
        />
        <ToggleChip
          icon={<Ruler size={14} />}
          label="Rulers"
          active={showRulers}
          onClick={onToggleRulers}
        />
        <div className="flex items-center gap-2 ml-2">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Page</span>
          <select
            value={currentLayoutId}
            onChange={(e) => onPageChange(e.target.value)}
            className="h-7 rounded-md border border-amber-200/80 bg-white px-2 text-[10px] font-medium text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-300"
          >
            {pageLayouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.label}
              </option>
            ))}
            <option value="custom">Custom ({pageWidthMm}×{pageHeightMm} mm)</option>
          </select>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Scale</span>
          <select
            value={scalePreset}
            onChange={(e) => onScaleChange(e.target.value)}
            className="h-7 rounded-md border border-amber-200/80 bg-white px-2 text-[10px] font-medium text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-300"
          >
            {SCALE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1" />

      <div className="hidden md:flex items-center gap-3 text-xs text-slate-500">
        <span>
          Scale: <span className="font-medium text-slate-700">{scalePreset}</span>
        </span>
        {projectId && (
          <span>
            Project ID: <span className="font-medium text-slate-700">{projectId}</span>
          </span>
        )}
        {saveState === 'saving' && <span>Saving changes...</span>}
        {saveState === 'saved' && lastSavedAt && <span>Saved {lastSavedAt}</span>}
        {saveState === 'error' && <span className="text-red-600">Save failed</span>}
      </div>

    </div>
  );
}

// =============================================================================
// Editor Footer
// =============================================================================

function EditorFooter({
  mousePosition,
  elementCount,
  areaSummary,
  statusMessage,
}: {
  mousePosition: Point2D;
  elementCount: number;
  areaSummary: {
    totalFloorArea: number;
    usableArea: number;
    circulationArea: number;
  };
  statusMessage: string;
}) {
  return (
    <div className="flex items-center justify-between h-8 px-4 bg-[#fffaf0] border-t border-amber-200/70 text-xs text-slate-600">
      <div className="flex items-center gap-4">
        <span>Elements: {elementCount}</span>
        <span>|</span>
        <span>
          Total Floor Area: {areaSummary.totalFloorArea.toFixed(1)} m² | Usable: {areaSummary.usableArea.toFixed(1)} m² | Circulation: {areaSummary.circulationArea.toFixed(1)} m²
        </span>
        <span>|</span>
        <CoordinatesDisplay
          x={mousePosition.x}
          y={mousePosition.y}
          unit="mm"
          className="!px-0 !py-0 !border-0 !shadow-none !bg-transparent text-xs"
        />
        {statusMessage && (
          <>
            <span>|</span>
            <span className="text-blue-700">{statusMessage}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        <ZoomIndicator className="!px-0 !py-0 !border-0 !shadow-none !bg-transparent text-xs" />
      </div>
    </div>
  );
}

// =============================================================================
// Main Editor Component
// =============================================================================

export function SmartDrawingEditor({
  projectId,
  initialData,
  onDataChange,
  onSave,
  readOnly = false,
  className = '',
}: SmartDrawingEditorProps) {
  const PAGE_LAYOUTS: PageLayout[] = [
    { id: 'a4-portrait', label: 'A4 Portrait (210 x 297 mm)', width: mmToPx(210), height: mmToPx(297), orientation: 'portrait' },
    { id: 'a4-landscape', label: 'A4 Landscape (297 x 210 mm)', width: mmToPx(297), height: mmToPx(210), orientation: 'landscape' },
    { id: 'a3-portrait', label: 'A3 Portrait (297 x 420 mm)', width: mmToPx(297), height: mmToPx(420), orientation: 'portrait' },
    { id: 'a3-landscape', label: 'A3 Landscape (420 x 297 mm)', width: mmToPx(420), height: mmToPx(297), orientation: 'landscape' },
    { id: 'a2-portrait', label: 'A2 Portrait (420 x 594 mm)', width: mmToPx(420), height: mmToPx(594), orientation: 'portrait' },
    { id: 'a2-landscape', label: 'A2 Landscape (594 x 420 mm)', width: mmToPx(594), height: mmToPx(420), orientation: 'landscape' },
  ];
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState<Point2D>({ x: 0, y: 0 });
  const [fabricCanvas, setFabricCanvas] = useState<fabric.Canvas | null>(null);
  const [scaleDrawing, setScaleDrawing] = useState(1);
  const [scaleReal, setScaleReal] = useState(50);
  const paperUnit: PaperUnit = 'mm';
  const rulerMode: MeasurementMode = 'paper';
  const gridMode: MeasurementMode = 'paper';
  const majorTickInterval = 10;
  const tickSubdivisions = 10;
  const majorGridSize = 10;
  const gridSubdivisions = 10;
  const showRulerLabels = true;
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const minLeftWidth = 96;
  const [maxLeftWidth, setMaxLeftWidth] = useState(360);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [pendingPlacementObjectId, setPendingPlacementObjectId] = useState<string | null>(null);
  const [customLibraryObjects, setCustomLibraryObjects] = useState<ArchitecturalObjectDefinition[]>([]);
  const [recentObjectUsage, setRecentObjectUsage] = useState<Record<string, number>>({});
  const compactThreshold = Math.max(minLeftWidth + 32, Math.min(190, maxLeftWidth - 40));
  const isLeftCompact = leftPanelWidth <= compactThreshold;

  const store = useSmartDrawingStore();
  const {
    sketches,
    annotations,
    dimensions,
    symbols,
    walls,
    rooms,
    loadData,
    exportData,
    setTool,
    activeTool,
    showGrid,
    showRulers,
    snapToGrid,
    setShowGrid,
    setShowRulers,
    setSnapToGrid,
    setPageConfig,
    pageConfig,
    setZoom,
    setPanOffset,
    displayUnit,
    processingStatus,
  } = store;

  const quickActions: { id: DrawingTool; label: string; icon: React.ReactNode }[] = [
    { id: 'wall', label: 'Add Wall', icon: <Minus size={14} /> },
    { id: 'room', label: 'Add Room', icon: <BoxSelect size={14} /> },
    { id: 'dimension', label: 'Dimension', icon: <Ruler size={14} /> },
    { id: 'text', label: 'Text', icon: <Type size={14} /> },
  ];
  const currentScaleRatio = `${scaleDrawing}:${scaleReal}`;
  const currentScalePreset = SCALE_PRESETS.includes(currentScaleRatio as (typeof SCALE_PRESETS)[number])
    ? currentScaleRatio
    : '1:50';
  const applyScaleRatio = useCallback((ratio: string) => {
    const parsed = parseScaleRatio(ratio);
    if (!parsed) return;
    setScaleDrawing(parsed.drawing);
    setScaleReal(parsed.real);
  }, []);
  const architecturalObjects = useMemo(
    () => [...DEFAULT_ARCHITECTURAL_OBJECT_LIBRARY, ...customLibraryObjects],
    [customLibraryObjects]
  );

  // Calculate total element count
  const elementCount = sketches.length + annotations.length + dimensions.length + symbols.length + walls.length + rooms.length;

  const areaSummary = useMemo(() => {
    return { totalFloorArea: 0, usableArea: 0, circulationArea: 0 };
  }, []);

  // Load initial data
  useEffect(() => {
    if (initialData) {
      loadData(initialData as Parameters<typeof loadData>[0]);
    }
  }, [initialData, loadData]);

  // Notify parent of data changes
  useEffect(() => {
    if (onDataChange) {
      const data = exportData();
      onDataChange(data);
    }
  }, [sketches, dimensions, symbols, walls, rooms, exportData, onDataChange]);

  useEffect(() => {
    if (!onSave || saveState === 'saving' || saveState === 'idle') return;
    setSaveState('idle');
  }, [sketches, dimensions, walls, rooms, onSave, saveState]);

  useEffect(() => {
    if (activeTool !== 'select' && pendingPlacementObjectId) {
      setPendingPlacementObjectId(null);
    }
  }, [activeTool, pendingPlacementObjectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const rawCustom = window.localStorage.getItem('drawing-library-custom');
      if (rawCustom) {
        const parsed = JSON.parse(rawCustom);
        if (Array.isArray(parsed)) {
          setCustomLibraryObjects(
            parsed.filter((entry): entry is ArchitecturalObjectDefinition => Boolean(entry) && typeof entry === 'object')
          );
        }
      }
      const rawRecent = window.localStorage.getItem('drawing-library-recent');
      if (rawRecent) {
        const parsedRecent = JSON.parse(rawRecent);
        if (parsedRecent && typeof parsedRecent === 'object') {
          setRecentObjectUsage(parsedRecent as Record<string, number>);
        }
      }
    } catch {
      // Ignore malformed persisted values.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('drawing-library-custom', JSON.stringify(customLibraryObjects));
  }, [customLibraryObjects]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('drawing-library-recent', JSON.stringify(recentObjectUsage));
  }, [recentObjectUsage]);

  useEffect(() => {
    const handleOpenRoomProperties = () => {
      setShowRightPanel(true);
    };
    const handleOpenPropertiesPanel = () => {
      setShowRightPanel(true);
    };

    window.addEventListener(
      'smart-drawing:open-room-properties',
      handleOpenRoomProperties as EventListener
    );
    window.addEventListener(
      'smart-drawing:open-properties-panel',
      handleOpenPropertiesPanel as EventListener
    );
    return () => {
      window.removeEventListener(
        'smart-drawing:open-room-properties',
        handleOpenRoomProperties as EventListener
      );
      window.removeEventListener(
        'smart-drawing:open-properties-panel',
        handleOpenPropertiesPanel as EventListener
      );
    };
  }, []);

  useEffect(() => {
    const updateBounds = () => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : maxLeftWidth;
      const nextMax = Math.max(minLeftWidth, Math.min(420, Math.floor(viewport * 0.35)));
      setMaxLeftWidth(nextMax);
      setLeftPanelWidth((current) => Math.min(current, nextMax));
    };

    updateBounds();
    window.addEventListener('resize', updateBounds);

    return () => {
      window.removeEventListener('resize', updateBounds);
    };
  }, [minLeftWidth, maxLeftWidth]);

  useEffect(() => {
    if (!isResizingLeft || !showLeftPanel) return;

    const handleMove = (event: PointerEvent) => {
      const rect = leftPanelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = Math.min(Math.max(event.clientX - rect.left, minLeftWidth), maxLeftWidth);
      setLeftPanelWidth(next);
    };

    const handleUp = () => {
      setIsResizingLeft(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingLeft, showLeftPanel, minLeftWidth, maxLeftWidth]);

  const handleSave = useCallback(async () => {
    if (!onSave || readOnly) return;
    try {
      setSaveState('saving');
      await onSave(exportData());
      setLastSavedAt(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
      setSaveState('saved');
    } catch (err) {
      console.error('Failed to save drawing:', err);
      setSaveState('error');
    }
  }, [onSave, exportData, readOnly]);

  // Handle canvas ready
  const handleCanvasReady = useCallback((canvas: fabric.Canvas) => {
    setFabricCanvas(canvas);

    // Track mouse position
    canvas.on('mouse:move', (e) => {
      const pointer = canvas.getScenePoint(e.e);
      setMousePosition({ x: pointer.x / MM_TO_PX, y: pointer.y / MM_TO_PX });
    });
  }, []);

  // Handle symbol selection from palette
  const handleSymbolSelect = useCallback(
    (symbol: SymbolDefinition) => {
      if (!fabricCanvas || readOnly) return;

      // Add symbol to canvas at center
      const center = fabricCanvas.getCenterPoint();
      const path = new fabric.Path(symbol.svgPath, {
        left: center.x,
        top: center.y,
        fill: 'transparent',
        stroke: '#333',
        strokeWidth: 1,
        scaleX: symbol.defaultWidth * 50,
        scaleY: symbol.defaultHeight * 50,
        originX: 'center',
        originY: 'center',
      });

      fabricCanvas.add(path);
      fabricCanvas.setActiveObject(path);
      fabricCanvas.renderAll();
    },
    [fabricCanvas, readOnly]
  );

  const handleStartObjectPlacement = useCallback((definition: ArchitecturalObjectDefinition) => {
    if (readOnly) return;
    setPendingPlacementObjectId(definition.id);
    setTool('select');
  }, [readOnly, setTool]);

  const handleCancelObjectPlacement = useCallback(() => {
    setPendingPlacementObjectId(null);
  }, []);

  const handleObjectPlaced = useCallback((definitionId: string) => {
    setRecentObjectUsage((prev) => ({
      ...prev,
      [definitionId]: Date.now(),
    }));
  }, []);

  const handleAddCustomObject = useCallback((definition: ArchitecturalObjectDefinition) => {
    setCustomLibraryObjects((prev) => {
      if (prev.some((entry) => entry.id === definition.id)) {
        return prev.map((entry) => (entry.id === definition.id ? definition : entry));
      }
      return [...prev, definition];
    });
  }, []);

  const handleImportCustomObjects = useCallback((definitions: ArchitecturalObjectDefinition[]) => {
    setCustomLibraryObjects((prev) => {
      const merged = new Map(prev.map((entry) => [entry.id, entry]));
      definitions.forEach((definition) => {
        const normalized = {
          ...definition,
          category: 'my-library' as const,
        };
        merged.set(normalized.id, normalized);
      });
      return Array.from(merged.values());
    });
  }, []);

  // Export handlers
  const handleExportJSON = useCallback(() => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawing-${projectId || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportData, projectId]);

  const handleExportSVG = useCallback(() => {
    if (!fabricCanvas) return;

    const svg = fabricCanvas.toSVG();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawing-${projectId || 'export'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fabricCanvas, projectId]);

  const handleExportPNG = useCallback(() => {
    if (!fabricCanvas) return;

    const dataURL = fabricCanvas.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 2,
    });
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = `drawing-${projectId || 'export'}.png`;
    a.click();
  }, [fabricCanvas, projectId]);

  // Import handler
  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      try {
        const data = JSON.parse(text);
        loadData(data);
      } catch (err) {
        console.error('Failed to parse imported file:', err);
        alert('Failed to import file. Please ensure it is a valid JSON file.');
      }
    };
    input.click();
  }, [loadData]);

  return (
    <div className={`flex flex-col h-full overflow-hidden bg-[#f6f1e7] ${className}`}>
      <EditorRibbon
        projectId={projectId}
        onExport={handleExportJSON}
        onImport={handleImport}
        onSave={onSave ? handleSave : undefined}
        saveState={saveState}
        lastSavedAt={lastSavedAt}
        showGrid={showGrid}
        showRulers={showRulers}
        snapToGrid={snapToGrid}
        onToggleGrid={() => setShowGrid(!showGrid)}
        onToggleRulers={() => setShowRulers(!showRulers)}
        onToggleSnap={() => setSnapToGrid(!snapToGrid)}
        pageConfig={pageConfig}
        pageLayouts={PAGE_LAYOUTS}
        onPageChange={(layoutId) => {
          const layout = PAGE_LAYOUTS.find((item) => item.id === layoutId);
          if (!layout) return;
          setPageConfig({
            width: layout.width,
            height: layout.height,
            orientation: layout.orientation,
          });
          setZoom(1);
          setPanOffset({ x: 0, y: 0 });
        }}
        scalePreset={currentScalePreset}
        onScaleChange={applyScaleRatio}
        readOnly={readOnly}
      />

      <div className="flex flex-1 overflow-hidden">
        {showLeftPanel && (
          <aside
            ref={leftPanelRef}
            className={`relative shrink-0 bg-[#fbf7ee] border-r border-amber-200/70 ${
              isResizingLeft ? 'transition-none' : 'transition-[width] duration-200'
            }`}
            style={{ width: leftPanelWidth }}
          >
            {isLeftCompact ? (
              <div className="flex h-full flex-col items-center justify-between py-4">
                <div className="flex flex-col items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-amber-950 text-sm font-bold">
                    PX
                  </div>
                  <div className="flex flex-col items-center gap-3 text-slate-600">
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200/80 bg-white/80">
                      <Grid3X3 size={18} />
                    </button>
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200/80 bg-white/80">
                      <Ruler size={18} />
                    </button>
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200/80 bg-white/80">
                      <BoxSelect size={18} />
                    </button>
                    <button type="button" className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200/80 bg-white/80">
                      <Settings size={18} />
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLeftPanel(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-200/80 bg-white/80 text-slate-600 hover:bg-amber-50"
                  title="Hide ribbon"
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
            ) : (
              <div className="flex h-full flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-200/70 shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Toolbox</p>
                      <h2 className="text-sm font-semibold text-slate-800">Drawing Tools</h2>
                    </div>
                    <div className="text-xs text-slate-500">{elementCount} elements</div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-thumb-amber-300">
                  <div className="p-3 space-y-3">
                  <div className="rounded-xl border border-amber-200/80 bg-white/80 p-3">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Core Tools</p>
                    <div className="mt-3">
                      <Toolbar
                        orientation="vertical"
                        layout="grid"
                        variant="toolbox"
                        showLabels
                        showZoomControls={false}
                        showUndoRedo={false}
                        showLayerControls={false}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-amber-200/80 bg-white/80 p-3">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Quick Actions</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {quickActions.map((action) => (
                        <QuickActionButton
                          key={action.id}
                          icon={action.icon}
                          label={action.label}
                          active={activeTool === action.id}
                          onClick={() => {
                            setTool(action.id);
                            if (action.id === 'room' && typeof window !== 'undefined') {
                              window.dispatchEvent(
                                new CustomEvent('smart-drawing:room-tool-activate')
                              );
                            }
                          }}
                          disabled={readOnly}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="min-h-0">
                    <SymbolPalette
                      variant="embedded"
                      onSymbolSelect={handleSymbolSelect}
                      className="h-full"
                    />
                  </div>

                  <div className="h-[420px] rounded-xl border border-amber-200/80 bg-white/80 overflow-hidden">
                    <ObjectLibraryPanel
                      objects={architecturalObjects}
                      recentUsage={recentObjectUsage}
                      pendingObjectId={pendingPlacementObjectId}
                      onStartPlacement={handleStartObjectPlacement}
                      onCancelPlacement={handleCancelObjectPlacement}
                      onAddCustomObject={handleAddCustomObject}
                      onImportCustomObjects={handleImportCustomObjects}
                    />
                  </div>
                  </div>
                </div>

                <div className="p-3 shrink-0 border-t border-amber-200/70">
                  <button
                    type="button"
                    onClick={() => setShowLeftPanel(false)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200/80 bg-white/80 py-2 text-sm font-medium text-slate-600 hover:bg-amber-50"
                    title="Hide ribbon"
                  >
                    <PanelLeftClose size={16} />
                    Hide ribbon
                  </button>
                </div>
              </div>
            )}

            <div
              className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-amber-200/40 hover:bg-amber-200 z-20"
              onPointerDown={(event) => {
                event.preventDefault();
                setIsResizingLeft(true);
              }}
              title="Resize toolbox"
            />
          </aside>
        )}

        {!showLeftPanel && (
          <button
            onClick={() => setShowLeftPanel(true)}
            className="flex items-center justify-center w-6 bg-[#f2e3c3] hover:bg-amber-200 border-r border-amber-200/70 transition-colors"
            title="Show ribbon"
          >
            <PanelLeftClose size={16} className="text-slate-700 rotate-180" />
          </button>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-[#fff7e6] border-b border-amber-200/70">
            <Toolbar
              orientation="horizontal"
              variant="ribbon"
              showDrawingTools={false}
              showLayerControls={false}
            />

            <div className="flex-1" />

            <div className="flex items-center gap-1">
              <button
                onClick={handleExportJSON}
                className="p-2 text-slate-600 hover:bg-amber-50 rounded transition-colors"
                title="Export as JSON"
              >
                <FileJson size={18} />
              </button>
              <button
                onClick={handleExportSVG}
                className="p-2 text-slate-600 hover:bg-amber-50 rounded transition-colors"
                title="Export as SVG"
              >
                <Image size={18} />
              </button>
              <button
                onClick={handleExportPNG}
                className="p-2 text-slate-600 hover:bg-amber-50 rounded transition-colors"
                title="Export as PNG"
              >
                <Printer size={18} />
              </button>
            </div>
          </div>
          <AttributeQuickToolbar />

          <DrawingCanvas
            className="flex-1"
            onCanvasReady={handleCanvasReady}
            showGrid={showGrid}
            showRulers={showRulers}
            snapToGrid={snapToGrid}
            paperUnit={paperUnit}
            realWorldUnit={displayUnit}
            scaleDrawing={scaleDrawing}
            scaleReal={scaleReal}
            rulerMode={rulerMode}
            majorTickInterval={majorTickInterval}
            tickSubdivisions={tickSubdivisions}
            showRulerLabels={showRulerLabels}
            gridMode={gridMode}
            majorGridSize={majorGridSize}
            gridSubdivisions={gridSubdivisions}
            objectDefinitions={architecturalObjects}
            pendingPlacementObjectId={pendingPlacementObjectId}
            onObjectPlaced={handleObjectPlaced}
            onCancelObjectPlacement={handleCancelObjectPlacement}
          />
        </div>

        <button
          onClick={() => setShowRightPanel(!showRightPanel)}
          className="flex items-center justify-center w-7 bg-[#f2e3c3] hover:bg-amber-200 border-l border-amber-200/70 transition-colors"
          title={showRightPanel ? 'Hide properties' : 'Show properties'}
        >
          <PanelRightClose
            size={16}
            className={`text-slate-700 transition-transform ${showRightPanel ? '' : 'rotate-180'}`}
          />
        </button>

        {showRightPanel && (
          <aside className="flex flex-col w-80 bg-[#fbf7ee] border-l border-amber-200/70 overflow-hidden">
            <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin scrollbar-thumb-amber-300">
              <PropertiesPanel className="!w-full !border-l-0" />
            </div>
          </aside>
        )}
      </div>

      <EditorFooter
        mousePosition={mousePosition}
        elementCount={elementCount}
        areaSummary={areaSummary}
        statusMessage={processingStatus}
      />
    </div>
  );
}

export default SmartDrawingEditor;
