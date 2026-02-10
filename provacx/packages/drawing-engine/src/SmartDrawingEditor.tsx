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
  PropertiesPanel,
  SymbolPalette,
  LayersPanel,
  RoomHierarchyPanel,
  ZoomIndicator,
  CoordinatesDisplay,
} from './components';
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
      </div>

      <div className="flex-1" />

      <div className="hidden md:flex items-center gap-3 text-xs text-slate-500">
        {projectId && (
          <span>
            Project ID: <span className="font-medium text-slate-700">{projectId}</span>
          </span>
        )}
        {saveState === 'saving' && <span>Saving changes...</span>}
        {saveState === 'saved' && lastSavedAt && <span>Saved {lastSavedAt}</span>}
        {saveState === 'error' && <span className="text-red-600">Save failed</span>}
      </div>

      <RibbonButton
        icon={<Settings size={16} />}
        label="Settings"
        onClick={() => {}}
        tone="ghost"
      />
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
}: {
  mousePosition: Point2D;
  elementCount: number;
  areaSummary: {
    totalFloorArea: number;
    usableArea: number;
    circulationArea: number;
  };
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
          className="!px-0 !py-0 !border-0 !shadow-none !bg-transparent text-xs"
        />
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
    { id: 'a4-portrait', label: 'A4 Portrait (210×297 mm)', width: 794, height: 1123, orientation: 'portrait' },
    { id: 'a4-landscape', label: 'A4 Landscape (297×210 mm)', width: 1123, height: 794, orientation: 'landscape' },
    { id: 'a3-portrait', label: 'A3 Portrait (297×420 mm)', width: 1122, height: 1587, orientation: 'portrait' },
    { id: 'a3-landscape', label: 'A3 Landscape (420×297 mm)', width: 1587, height: 1122, orientation: 'landscape' },
    { id: 'a2-portrait', label: 'A2 Portrait (420×594 mm)', width: 1587, height: 2245, orientation: 'portrait' },
    { id: 'a2-landscape', label: 'A2 Landscape (594×420 mm)', width: 2245, height: 1587, orientation: 'landscape' },
  ];
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState<Point2D>({ x: 0, y: 0 });
  const [fabricCanvas, setFabricCanvas] = useState<fabric.Canvas | null>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const minLeftWidth = 96;
  const [maxLeftWidth, setMaxLeftWidth] = useState(360);
  const [leftPanelWidth, setLeftPanelWidth] = useState(minLeftWidth);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const compactThreshold = Math.max(minLeftWidth + 32, Math.min(190, maxLeftWidth - 40));
  const isLeftCompact = leftPanelWidth <= compactThreshold;

  const store = useSmartDrawingStore();
  const {
    walls,
    rooms,
    sketches,
    hvacLayout,
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
  } = store;

  const quickActions: { id: DrawingTool; label: string; icon: React.ReactNode }[] = [
    { id: 'wall', label: 'Add Wall', icon: <Minus size={14} /> },
    { id: 'room', label: 'Add Room', icon: <BoxSelect size={14} /> },
    { id: 'dimension', label: 'Dimension', icon: <Ruler size={14} /> },
    { id: 'text', label: 'Text', icon: <Type size={14} /> },
  ];

  // Calculate total element count
  type HVACLayoutType = { indoorUnits?: unknown[]; ductSegments?: unknown[] } | null;
  const layout = hvacLayout as HVACLayoutType;
  const elementCount =
    walls.length +
    rooms.length +
    sketches.length +
    (layout?.indoorUnits?.length || 0) +
    (layout?.ductSegments?.length || 0);

  const areaSummary = useMemo(() => {
    const topLevelRooms = rooms.filter((room) => !room.parentRoomId);
    const totalFloorArea = topLevelRooms.reduce((sum, room) => {
      const grossArea = Number.isFinite(room.grossArea) ? room.grossArea : room.area;
      return sum + Math.max(grossArea, 0);
    }, 0);
    const circulationPattern = /corridor|hall|lobby|passage|circulation|foyer/i;
    const circulationArea = topLevelRooms.reduce((sum, room) => {
      const label = `${room.name} ${room.spaceType}`;
      if (!circulationPattern.test(label)) return sum;
      const roomArea = Number.isFinite(room.netArea) ? room.netArea : room.area;
      return sum + Math.max(roomArea, 0);
    }, 0);
    const usableArea = Math.max(totalFloorArea - circulationArea, 0);
    return { totalFloorArea, usableArea, circulationArea };
  }, [rooms]);

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
  }, [walls, rooms, sketches, hvacLayout, exportData, onDataChange]);

  useEffect(() => {
    if (!onSave || saveState === 'saving' || saveState === 'idle') return;
    setSaveState('idle');
  }, [walls, rooms, sketches, hvacLayout, onSave, saveState]);

  useEffect(() => {
    const handleOpenRoomProperties = () => {
      setShowRightPanel(true);
    };

    window.addEventListener(
      'smart-drawing:open-room-properties',
      handleOpenRoomProperties as EventListener
    );
    return () => {
      window.removeEventListener(
        'smart-drawing:open-room-properties',
        handleOpenRoomProperties as EventListener
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
      setMousePosition({ x: pointer.x, y: pointer.y });
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

          <DrawingCanvas
            className="flex-1"
            onCanvasReady={handleCanvasReady}
            showGrid={showGrid}
            showRulers={showRulers}
            snapToGrid={snapToGrid}
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
              <div className="p-3">
                <RoomHierarchyPanel />
              </div>
              <div className="p-3">
                <LayersPanel className="h-64" />
              </div>
            </div>
          </aside>
        )}
      </div>

      <EditorFooter
        mousePosition={mousePosition}
        elementCount={elementCount}
        areaSummary={areaSummary}
      />
    </div>
  );
}

export default SmartDrawingEditor;
