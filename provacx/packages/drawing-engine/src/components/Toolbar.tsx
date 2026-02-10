/**
 * Toolbar Component
 * 
 * Drawing tools and controls for the smart drawing editor.
 */

'use client';

import {
  MousePointer2,
  Hand,
  Pencil,
  Square,
  Circle,
  Minus,
  Type,
  Eraser,
  Ruler,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Layers,
  Spline,
  Home,
  BoxSelect,
} from 'lucide-react';
import React from 'react';

import { useSmartDrawingStore } from '../store';
import type { DrawingTool } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface ToolbarProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  layout?: 'auto' | 'grid';
  variant?: 'default' | 'toolbox' | 'ribbon';
  showZoomControls?: boolean;
  showUndoRedo?: boolean;
  showLayerControls?: boolean;
  showDrawingTools?: boolean;
  showLabels?: boolean;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  shortLabel?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  shortcut?: string;
  variant?: 'default' | 'toolbox' | 'ribbon';
  showLabel?: boolean;
  fullWidth?: boolean;
  compact?: boolean;
}

// =============================================================================
// Tool Definitions
// =============================================================================

const DRAWING_TOOLS: {
  id: DrawingTool;
  icon: React.ReactNode;
  label: string;
  shortLabel?: string;
  shortcut?: string;
}[] = [
  { id: 'select', icon: <MousePointer2 size={18} />, label: 'Select', shortLabel: 'Select', shortcut: 'V' },
  { id: 'pan', icon: <Hand size={18} />, label: 'Pan', shortLabel: 'Pan', shortcut: 'H' },
  { id: 'wall', icon: <Minus size={18} />, label: 'Wall', shortLabel: 'Wall', shortcut: 'W' },
  { id: 'room', icon: <BoxSelect size={18} />, label: 'Room', shortLabel: 'Room', shortcut: 'R' },
  { id: 'pencil', icon: <Pencil size={18} />, label: 'Pencil', shortLabel: 'Pencil', shortcut: 'P' },
  { id: 'spline', icon: <Spline size={18} />, label: 'Spline', shortLabel: 'Spline', shortcut: 'S' },
  { id: 'line', icon: <Minus size={18} />, label: 'Line', shortLabel: 'Line', shortcut: 'L' },
  { id: 'rectangle', icon: <Square size={18} />, label: 'Rectangle', shortLabel: 'Rect' },
  { id: 'circle', icon: <Circle size={18} />, label: 'Circle', shortLabel: 'Circle' },
  { id: 'dimension', icon: <Ruler size={18} />, label: 'Dimension', shortLabel: 'Dim', shortcut: 'D' },
  { id: 'text', icon: <Type size={18} />, label: 'Text', shortLabel: 'Text', shortcut: 'T' },
  { id: 'eraser', icon: <Eraser size={18} />, label: 'Eraser', shortLabel: 'Erase', shortcut: 'E' },
];

// =============================================================================
// ToolButton Component
// =============================================================================

function ToolButton({
  icon,
  label,
  shortLabel,
  active = false,
  disabled = false,
  onClick,
  shortcut,
  variant = 'default',
  showLabel = false,
  fullWidth = false,
  compact = false,
}: ToolButtonProps) {
  const baseStyles =
    'flex items-center justify-center rounded-md border transition-colors duration-150';
  const sizeStyles = showLabel
    ? `${fullWidth ? 'w-full min-h-[42px] px-1.5 py-1' : 'w-12 h-10'} flex-col gap-1`
    : 'w-9 h-9';
  const variantStyles = {
    default: active
      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100',
    toolbox: active
      ? 'bg-amber-400 text-amber-950 border-amber-400 shadow-sm'
      : 'bg-white text-slate-700 border-amber-200 hover:bg-amber-50',
    ribbon: active
      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`
        ${baseStyles}
        ${sizeStyles}
        ${variantStyles[variant]}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span className={compact ? 'scale-[1.2] leading-none' : 'scale-[1.2] leading-none'}>{icon}</span>
      {showLabel && (
        <span className="text-[11px] font-medium leading-tight text-center px-0.5">
          {compact && shortLabel ? shortLabel : label}
        </span>
      )}
    </button>
  );
}

// =============================================================================
// Toolbar Separator
// =============================================================================

function ToolbarSeparator({
  orientation,
  variant = 'default',
}: {
  orientation: 'horizontal' | 'vertical';
  variant?: 'default' | 'toolbox' | 'ribbon';
}) {
  const tone =
    variant === 'toolbox'
      ? 'bg-amber-200'
      : variant === 'ribbon'
        ? 'bg-slate-200'
        : 'bg-gray-300';
  return (
    <div
      className={`
        ${orientation === 'horizontal' ? 'w-px h-6' : 'h-px w-6'}
        ${tone} mx-1
      `}
    />
  );
}

// =============================================================================
// Toolbar Component
// =============================================================================

export function Toolbar({
  className = '',
  orientation = 'vertical',
  layout = 'auto',
  variant = 'default',
  showZoomControls = true,
  showUndoRedo = true,
  showLayerControls = true,
  showDrawingTools = true,
  showLabels = false,
}: ToolbarProps) {
  const {
    activeTool,
    zoom,
    history,
    historyIndex,
    setTool,
    setZoom,
    undo,
    redo,
    resetView,
  } = useSmartDrawingStore();
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const handleZoomIn = () => {
    setZoom(Math.min(zoom * 1.2, 5));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom / 1.2, 0.1));
  };

  const isHorizontal = orientation === 'horizontal';
  const isGrid = layout === 'grid';
  const containerClass =
    isGrid
      ? 'grid grid-cols-2 gap-1 p-1.5 w-full'
      : isHorizontal
        ? 'flex flex-row items-center gap-1 px-2 py-1'
        : 'flex flex-col items-center gap-1 py-2 px-1';
  const isCompactGrid = isGrid && showLabels;
  const containerTone =
    variant === 'toolbox'
      ? 'bg-[#fffaf0] border-amber-200 shadow-sm'
      : variant === 'ribbon'
        ? 'bg-white border-slate-200'
        : 'bg-white border-gray-200 shadow-sm';

  return (
    <div
      className={`
        border rounded-lg
        ${containerTone}
        ${containerClass}
        ${className}
      `}
    >
      {/* Drawing Tools */}
      {showDrawingTools &&
        DRAWING_TOOLS.map((toolDef) => {
          const handleToolClick = () => {
            setTool(toolDef.id);
            if (toolDef.id === 'room' && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('smart-drawing:room-tool-activate'));
            }
          };

          return (
            <ToolButton
              key={toolDef.id}
              icon={toolDef.icon}
              label={toolDef.label}
              shortLabel={toolDef.shortLabel}
              active={activeTool === toolDef.id}
              onClick={handleToolClick}
              shortcut={toolDef.shortcut}
              variant={variant}
              showLabel={showLabels}
              fullWidth={isGrid}
              compact={isCompactGrid}
            />
          );
        })}

      {layout !== 'grid' &&
        showDrawingTools &&
        (showZoomControls || showUndoRedo || showLayerControls) && (
          <ToolbarSeparator orientation={orientation} variant={variant} />
        )}

      {/* Zoom Controls */}
      {showZoomControls && (
        <>
          <ToolButton
            icon={<ZoomIn size={18} />}
            label="Zoom In"
            onClick={handleZoomIn}
            shortcut="+"
            variant={variant}
            showLabel={showLabels}
            fullWidth={isGrid}
            compact={isCompactGrid}
          />
          <ToolButton
            icon={<ZoomOut size={18} />}
            label="Zoom Out"
            onClick={handleZoomOut}
            shortcut="-"
            variant={variant}
            showLabel={showLabels}
            fullWidth={isGrid}
            compact={isCompactGrid}
          />
          <ToolButton
            icon={<Home size={18} />}
            label="Reset View"
            onClick={resetView}
            shortcut="0"
            variant={variant}
            showLabel={showLabels}
            fullWidth={isGrid}
            compact={isCompactGrid}
          />
          {layout !== 'grid' && (showUndoRedo || showLayerControls) && (
            <ToolbarSeparator orientation={orientation} variant={variant} />
          )}
        </>
      )}

      {/* Undo/Redo */}
      {showUndoRedo && (
        <>
          <ToolButton
            icon={<RotateCcw size={18} />}
            label="Undo"
            onClick={undo}
            disabled={!canUndo}
            shortcut="Ctrl+Z"
            variant={variant}
            showLabel={showLabels}
            fullWidth={isGrid}
            compact={isCompactGrid}
          />
          <ToolButton
            icon={<RotateCw size={18} />}
            label="Redo"
            onClick={redo}
            disabled={!canRedo}
            shortcut="Ctrl+Y"
            variant={variant}
            showLabel={showLabels}
            fullWidth={isGrid}
            compact={isCompactGrid}
          />
          {layout !== 'grid' && showLayerControls && (
            <ToolbarSeparator orientation={orientation} variant={variant} />
          )}
        </>
      )}

      {/* Layer Controls */}
      {showLayerControls && (
        <ToolButton
          icon={<Layers size={18} />}
          label="Layers"
          onClick={() => {}}
          variant={variant}
          showLabel={showLabels}
          fullWidth={isGrid}
          compact={isCompactGrid}
        />
      )}
    </div>
  );
}

// =============================================================================
// Zoom Indicator
// =============================================================================

export function ZoomIndicator({ className = '' }: { className?: string }) {
  const { zoom, setZoom } = useSmartDrawingStore();
  const percentage = Math.round(zoom * 100);

  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-1.5
        bg-white border border-gray-200 rounded-md shadow-sm
        text-sm text-gray-600
        ${className}
      `}
    >
      <button
        onClick={() => setZoom(1)}
        className="hover:text-blue-600 transition-colors"
        title="Reset to 100%"
      >
        {percentage}%
      </button>
    </div>
  );
}

// =============================================================================
// Coordinates Display
// =============================================================================

export function CoordinatesDisplay({
  x,
  y,
  unit = 'm',
  className = '',
}: {
  x: number;
  y: number;
  unit?: string;
  className?: string;
}) {
  return (
    <div
      className={`
        flex items-center gap-3 px-3 py-1.5
        bg-white border border-gray-200 rounded-md shadow-sm
        text-sm font-mono text-gray-600
        ${className}
      `}
    >
      <span>X: {x.toFixed(2)} {unit}</span>
      <span>Y: {y.toFixed(2)} {unit}</span>
    </div>
  );
}

export default Toolbar;
