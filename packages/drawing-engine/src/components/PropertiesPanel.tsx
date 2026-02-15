/**
 * Properties Panel Component
 *
 * Displays and allows editing of selected element properties.
 */

'use client';

import { X } from 'lucide-react';
import React from 'react';

import { useSmartDrawingStore } from '../store';
import type { DisplayUnit } from '../types';

export interface PropertiesPanelProps {
  className?: string;
  onClose?: () => void;
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-amber-100/70 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function UnitSelector() {
  const { displayUnit, setDisplayUnit } = useSmartDrawingStore();
  return (
    <PropertyRow label="Display Unit">
      <select
        value={displayUnit}
        onChange={(e) => setDisplayUnit(e.target.value as DisplayUnit)}
        className="w-24 px-2 py-1 text-sm border border-amber-200/80 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white"
      >
        <option value="mm">mm</option>
        <option value="cm">cm</option>
        <option value="m">m</option>
        <option value="ft-in">ft</option>
      </select>
    </PropertyRow>
  );
}

export function PropertiesPanel({ className = '', onClose }: PropertiesPanelProps) {
  const { selectedElementIds, clearSelection } = useSmartDrawingStore();

  const handleClose = () => {
    clearSelection();
    onClose?.();
  };

  return (
    <div
      className={`flex flex-col bg-white/95 backdrop-blur-sm border border-amber-200/50 rounded-xl shadow-xl ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100/70">
        <h3 className="text-sm font-semibold text-slate-700">Properties</h3>
        <button
          onClick={handleClose}
          className="p-1 rounded hover:bg-amber-50 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {selectedElementIds.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No element selected</p>
        ) : (
          <>
            <PropertyRow label="Selected">
              <span className="text-sm text-slate-600">{selectedElementIds.length} element(s)</span>
            </PropertyRow>
            <UnitSelector />
          </>
        )}
      </div>
    </div>
  );
}
