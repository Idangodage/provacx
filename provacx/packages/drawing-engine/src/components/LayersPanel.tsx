/**
 * Layers Panel Component
 * 
 * Manages drawing layers and visibility.
 */

'use client';

import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Layers,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import React from 'react';

import { useSmartDrawingStore } from '../store';

// =============================================================================
// Types
// =============================================================================

export interface LayersPanelProps {
  className?: string;
}

// =============================================================================
// Layer Item Component
// =============================================================================

function LayerItem({
  name,
  visible,
  locked,
  active,
  color,
  onToggleVisibility,
  onToggleLock,
  onSelect,
  onRename,
}: {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  active: boolean;
  color?: string;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onSelect: () => void;
  onRename: (name: string) => void;
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editName, setEditName] = React.useState(name);

  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditName(name);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editName.trim() && editName !== name) {
      onRename(editName.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(name);
    }
  };

  return (
    <div
      onClick={onSelect}
      className={`
        flex items-center gap-2 px-3 py-2
        cursor-pointer transition-colors
        ${active ? 'bg-amber-50 border-l-2 border-amber-400' : 'hover:bg-amber-50 border-l-2 border-transparent'}
      `}
    >
      {/* Color Indicator */}
      <div
        className="w-3 h-3 rounded-full border border-amber-200"
        style={{ backgroundColor: color }}
      />

      {/* Layer Name */}
      <div className="flex-1 min-w-0" onDoubleClick={handleDoubleClick}>
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full px-1 py-0.5 text-sm border border-amber-300 rounded focus:outline-none"
          />
        ) : (
          <span className={`text-sm truncate ${!visible ? 'text-slate-400' : 'text-slate-700'}`}>
            {name}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          className="p-1 hover:bg-amber-100 rounded transition-colors"
          title={visible ? 'Hide layer' : 'Show layer'}
        >
          {visible ? (
            <Eye size={14} className="text-slate-600" />
          ) : (
            <EyeOff size={14} className="text-slate-400" />
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          className="p-1 hover:bg-amber-100 rounded transition-colors"
          title={locked ? 'Unlock layer' : 'Lock layer'}
        >
          {locked ? (
            <Lock size={14} className="text-slate-600" />
          ) : (
            <Unlock size={14} className="text-slate-400" />
          )}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// LayersPanel Component
// =============================================================================

export function LayersPanel({ className = '' }: LayersPanelProps) {
  const { layers, activeLayerId, setActiveLayer, toggleLayerVisibility, toggleLayerLock, addLayer, deleteLayer, updateLayer } =
    useSmartDrawingStore();

  const handleAddLayer = () => {
    addLayer(`Layer ${layers.length + 1}`);
  };

  const handleDeleteLayer = () => {
    if (activeLayerId && layers.length > 1) {
      deleteLayer(activeLayerId);
    }
  };

  const moveLayer = (direction: 'up' | 'down') => {
    // Layer reordering would be implemented in the store
    console.log(`Move layer ${direction}`);
  };

  return (
    <div
      className={`
        flex flex-col
        bg-white border border-amber-200/80 rounded-lg shadow-sm
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200/70">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-800">Layers</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleAddLayer}
            className="p-1 hover:bg-amber-50 rounded transition-colors"
            title="Add layer"
          >
            <Plus size={14} className="text-slate-600" />
          </button>
          <button
            onClick={handleDeleteLayer}
            disabled={layers.length <= 1}
            className="p-1 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
            title="Delete layer"
          >
            <Trash2 size={14} className="text-slate-600" />
          </button>
        </div>
      </div>

      {/* Layer List */}
      <div className="flex-1 overflow-y-auto">
        {layers.map((layer) => (
          <LayerItem
            key={layer.id}
            id={layer.id}
            name={layer.name}
            visible={layer.visible}
            locked={layer.locked}
            active={layer.id === (activeLayerId || '')}
            color={layer.color}
            onToggleVisibility={() => toggleLayerVisibility(layer.id)}
            onToggleLock={() => toggleLayerLock(layer.id)}
            onSelect={() => setActiveLayer(layer.id)}
            onRename={(name) => updateLayer(layer.id, { name })}
          />
        ))}
      </div>

      {/* Footer Controls */}
      <div className="flex items-center justify-center gap-2 px-3 py-2 border-t border-amber-200/70">
        <button
          onClick={() => moveLayer('up')}
          className="p-1.5 hover:bg-amber-50 rounded transition-colors"
          title="Move layer up"
        >
          <ChevronUp size={16} className="text-slate-600" />
        </button>
        <button
          onClick={() => moveLayer('down')}
          className="p-1.5 hover:bg-amber-50 rounded transition-colors"
          title="Move layer down"
        >
          <ChevronDown size={16} className="text-slate-600" />
        </button>
      </div>
    </div>
  );
}

export default LayersPanel;
