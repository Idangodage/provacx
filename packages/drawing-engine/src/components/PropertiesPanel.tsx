/**
 * Properties Panel Component
 *
 * Displays and allows editing of selected element properties.
 */

'use client';

import React from 'react';
import { X, Trash2 } from 'lucide-react';
import { useSmartDrawingStore } from '../store';
import type { DisplayUnit, Room2D, Wall2D } from '../types';

const PX_TO_MM = 25.4 / 96;

export interface PropertiesPanelProps {
  className?: string;
  onClose?: () => void;
}

interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
}

function PropertyRow({ label, children }: PropertyRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-amber-100/70 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  className = '',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className="w-24 px-2 py-1 text-sm border border-amber-200/80 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
      />
      {unit && <span className="text-xs text-slate-500">{unit}</span>}
    </div>
  );
}

function toDisplayDistance(mm: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'cm':
      return mm / 10;
    case 'm':
      return mm / 1000;
    case 'ft-in':
      return mm / 304.8;
    default:
      return mm;
  }
}

function fromDisplayDistance(value: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'cm':
      return value * 10;
    case 'm':
      return value * 1000;
    case 'ft-in':
      return value * 304.8;
    default:
      return value;
  }
}

function unitSuffix(unit: DisplayUnit): string {
  switch (unit) {
    case 'cm':
      return 'cm';
    case 'm':
      return 'm';
    case 'ft-in':
      return 'ft';
    default:
      return 'mm';
  }
}

function displayStep(unit: DisplayUnit): number {
  switch (unit) {
    case 'cm':
      return 0.5;
    case 'm':
      return 0.01;
    case 'ft-in':
      return 0.1;
    default:
      return 10;
  }
}

function formatDistance(mm: number, unit: DisplayUnit): string {
  if (!Number.isFinite(mm)) return '0 mm';
  switch (unit) {
    case 'cm':
      return `${(mm / 10).toFixed(mm >= 1000 ? 0 : 1)} cm`;
    case 'm':
      return `${(mm / 1000).toFixed(mm >= 10_000 ? 1 : 2)} m`;
    case 'ft-in': {
      const totalInches = mm / 25.4;
      const feet = Math.floor(totalInches / 12);
      const inches = totalInches - feet * 12;
      return `${feet}' ${inches.toFixed(1)}"`;
    }
    default:
      return `${Math.round(mm)} mm`;
  }
}

function formatArea(areaSqm: number, unit: DisplayUnit): string {
  switch (unit) {
    case 'mm':
      return `${Math.round(areaSqm * 1_000_000).toLocaleString()} mm^2`;
    case 'cm':
      return `${(areaSqm * 10_000).toFixed(areaSqm >= 1 ? 0 : 1)} cm^2`;
    case 'ft-in':
      return `${(areaSqm * 10.7639104).toFixed(areaSqm >= 10 ? 1 : 2)} ft^2`;
    default:
      return `${areaSqm.toFixed(areaSqm >= 10 ? 1 : 2)} m^2`;
  }
}

function suggestRoomUsage(room: Room2D): string {
  const text = `${room.name} ${room.spaceType}`.toLowerCase();
  if (/corridor|hall|lobby|passage|circulation|foyer/.test(text)) {
    return 'Circulation';
  }
  if (/storage|closet|pantry|shaft/.test(text)) {
    return 'Storage';
  }
  if (/bath|wc|toilet|wash/.test(text)) {
    return 'Bathroom';
  }
  if (/utility|service|laundry|mechanical/.test(text)) {
    return 'Utility';
  }

  const area = Number.isFinite(room.netArea) ? room.netArea : room.area;
  if (room.parentRoomId && area < 8) return 'Storage';
  if (area < 8) return 'Bathroom';
  if (area < 15) return 'Utility';
  return 'General';
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

function WallProperties({ wall }: { wall: Wall2D }) {
  const { updateWall, displayUnit } = useSmartDrawingStore();
  const lengthPx = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const lengthMm = lengthPx * PX_TO_MM;
  const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * (180 / Math.PI);

  const setLengthMm = (nextLengthMm: number) => {
    if (!Number.isFinite(nextLengthMm) || nextLengthMm <= 1) return;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const currentLengthPx = Math.hypot(dx, dy);
    if (currentLengthPx <= 0.0001) return;
    const nextLengthPx = nextLengthMm / PX_TO_MM;
    const scale = nextLengthPx / currentLengthPx;
    updateWall(wall.id, {
      end: {
        x: wall.start.x + dx * scale,
        y: wall.start.y + dy * scale,
      },
    });
  };

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">Wall Properties</h3>
      <UnitSelector />

      <PropertyRow label="Length">
        <NumberInput
          value={toDisplayDistance(lengthMm, displayUnit)}
          onChange={(value) => setLengthMm(fromDisplayDistance(value, displayUnit))}
          min={0}
          step={displayStep(displayUnit)}
          unit={unitSuffix(displayUnit)}
        />
      </PropertyRow>

      <PropertyRow label="Angle">
        <span className="text-sm font-mono">{angle.toFixed(1)} deg</span>
      </PropertyRow>

      <PropertyRow label="Thickness">
        <NumberInput
          value={wall.thickness}
          onChange={(value) => updateWall(wall.id, { thickness: value })}
          min={10}
          max={1000}
          step={5}
          unit="mm"
        />
      </PropertyRow>

      <PropertyRow label="Height">
        <NumberInput
          value={wall.height}
          onChange={(value) => updateWall(wall.id, { height: value })}
          min={200}
          max={10000}
          step={50}
          unit="mm"
        />
      </PropertyRow>

      <PropertyRow label="Material">
        <input
          type="text"
          value={wall.material || 'concrete'}
          onChange={(e) => updateWall(wall.id, { material: e.target.value })}
          className="w-24 px-2 py-1 text-sm border border-amber-200/80 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </PropertyRow>

      <PropertyRow label="Start X">
        <NumberInput
          value={toDisplayDistance(wall.start.x * PX_TO_MM, displayUnit)}
          onChange={(value) =>
            updateWall(wall.id, {
              start: { ...wall.start, x: fromDisplayDistance(value, displayUnit) / PX_TO_MM },
            })
          }
          step={displayStep(displayUnit)}
          unit={unitSuffix(displayUnit)}
        />
      </PropertyRow>

      <PropertyRow label="Start Y">
        <NumberInput
          value={toDisplayDistance(wall.start.y * PX_TO_MM, displayUnit)}
          onChange={(value) =>
            updateWall(wall.id, {
              start: { ...wall.start, y: fromDisplayDistance(value, displayUnit) / PX_TO_MM },
            })
          }
          step={displayStep(displayUnit)}
          unit={unitSuffix(displayUnit)}
        />
      </PropertyRow>
    </div>
  );
}

function RoomProperties({ room }: { room: Room2D }) {
  const { updateRoom, displayUnit } = useSmartDrawingStore();
  const netArea = room.netArea ?? room.area ?? 0;
  const grossArea = room.grossArea ?? room.area ?? 0;
  const perimeter = room.perimeter ?? 0;
  const boundaryWalls = room.wallIds?.length ?? 0;
  const parentRoom = room.parentRoomId ?? 'None';
  const childCount = room.childRoomIds?.length ?? 0;
  const usageSuggestion = suggestRoomUsage(room);

  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">Room Properties</h3>
      <UnitSelector />

      <PropertyRow label="Name">
        <input
          type="text"
          value={room.name || ''}
          onChange={(e) => updateRoom(room.id, { name: e.target.value })}
          placeholder="Room name"
          className="w-32 px-2 py-1 text-sm border border-amber-200/80 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </PropertyRow>

      <PropertyRow label="Fill Color">
        <input
          type="color"
          value={room.color || '#cbd5e1'}
          onChange={(e) => updateRoom(room.id, { color: e.target.value })}
          className="w-20 h-8 border border-amber-200/80 rounded"
        />
      </PropertyRow>

      <PropertyRow label="Area">
        <span className="text-sm font-mono">{formatArea(netArea, displayUnit)}</span>
      </PropertyRow>

      <PropertyRow label="Gross Area">
        <span className="text-sm font-mono">{formatArea(grossArea, displayUnit)}</span>
      </PropertyRow>

      <PropertyRow label="Net Area">
        <span className="text-sm font-mono">{formatArea(netArea, displayUnit)}</span>
      </PropertyRow>

      <PropertyRow label="Perimeter">
        <span className="text-sm font-mono">{formatDistance(perimeter * 1000, displayUnit)}</span>
      </PropertyRow>

      <PropertyRow label="Room Type">
        <span className="text-sm font-mono">{room.roomType}</span>
      </PropertyRow>

      <PropertyRow label="Usage Type">
        <input
          type="text"
          value={room.spaceType || usageSuggestion}
          onChange={(e) => updateRoom(room.id, { spaceType: e.target.value })}
          placeholder={usageSuggestion}
          className="w-32 px-2 py-1 text-sm border border-amber-200/80 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </PropertyRow>

      <PropertyRow label="Suggested">
        <span className="text-sm font-mono">{usageSuggestion}</span>
      </PropertyRow>

      <PropertyRow label="Tag Visible">
        <input
          type="checkbox"
          checked={room.showTag !== false}
          onChange={(event) => updateRoom(room.id, { showTag: event.target.checked })}
          className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-400"
        />
      </PropertyRow>

      <PropertyRow label="Parent Room">
        <span className="text-sm font-mono">{parentRoom}</span>
      </PropertyRow>

      <PropertyRow label="Child Rooms">
        <span className="text-sm font-mono">{childCount}</span>
      </PropertyRow>

      <PropertyRow label="Vertices">
        <span className="text-sm font-mono">{room.vertices.length}</span>
      </PropertyRow>

      <PropertyRow label="Boundary Walls">
        <span className="text-sm font-mono">{boundaryWalls}</span>
      </PropertyRow>
    </div>
  );
}

function MultiSelectionProperties({ count }: { count: number }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-800">Multiple Selection</h3>
      <p className="text-sm text-slate-600">{count} objects selected</p>
    </div>
  );
}

function NoSelectionProperties() {
  return (
    <div className="text-center py-8">
      <p className="text-sm text-slate-500">Select an object to view its properties</p>
    </div>
  );
}

export function PropertiesPanel({ className = '', onClose }: PropertiesPanelProps) {
  const { selectedElementIds: selectedIds, walls, rooms, deleteSelected } = useSmartDrawingStore();
  const selectedWalls = walls.filter((wall) => selectedIds.includes(wall.id));
  const selectedRooms = rooms.filter((room) => selectedIds.includes(room.id));
  const totalSelected = selectedIds.length;

  return (
    <div className={`flex flex-col w-72 bg-[#fffaf0] border-l border-amber-200/70 ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-200/70">
        <h2 className="text-sm font-semibold text-slate-800">Properties</h2>
        <div className="flex items-center gap-1">
          {totalSelected > 0 && (
            <button
              onClick={deleteSelected}
              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Delete selected"
            >
              <Trash2 size={16} />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-amber-50 rounded transition-colors"
              title="Close panel"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {totalSelected === 0 && <NoSelectionProperties />}
        {totalSelected === 1 && selectedWalls.length === 1 && selectedWalls[0] && (
          <WallProperties wall={selectedWalls[0]} />
        )}
        {totalSelected === 1 && selectedRooms.length === 1 && selectedRooms[0] && (
          <RoomProperties room={selectedRooms[0]} />
        )}
        {totalSelected > 1 && <MultiSelectionProperties count={totalSelected} />}
      </div>
    </div>
  );
}

export default PropertiesPanel;
