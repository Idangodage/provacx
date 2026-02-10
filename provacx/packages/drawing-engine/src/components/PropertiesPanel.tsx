/**
 * Properties Panel Component
 *
 * Displays and allows editing of selected element properties.
 */

'use client';

import { X, Trash2, ArrowUp, ArrowDown, RotateCcw, Plus } from 'lucide-react';
import React from 'react';

import { useSmartDrawingStore } from '../store';
import type { DisplayUnit, MaterialType, Room2D, Wall2D } from '../types';
import {
  MATERIAL_LIBRARY,
  createWallFromTypeDefaults,
  getDefaultLayerPreset,
  getWallCoreThickness,
  getWallFinishThickness,
  getWallRValue,
  getWallTotalThickness,
  getWallTypeById,
  getWallUValue,
  resolveWallLayers,
} from '../utils/wall-types';

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

const CORE_MATERIAL_OPTIONS: Array<{ value: MaterialType; label: string }> = [
  { value: 'cement-block', label: 'Cement Block' },
  { value: 'clay-brick', label: 'Clay Brick' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'concrete-block', label: 'Concrete Block' },
  { value: 'gypsum-board', label: 'Gypsum Board' },
];

const LAYER_PRESET_OPTIONS = [
  { value: 'insulation', label: 'Insulation 50mm' },
  { value: 'plaster', label: 'Plaster 12mm' },
  { value: 'vapor-barrier', label: 'Vapor Barrier 0.2mm' },
  { value: 'air-gap', label: 'Air Gap 25mm' },
  { value: 'waterproofing', label: 'Waterproofing 3mm' },
] as const;

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
  const {
    updateWall,
    displayUnit,
    wallTypeRegistry,
    setWallTotalThickness,
    addWallLayerToWall,
    removeWallLayerFromWall,
    reorderWallLayerInWall,
    updateWallLayerThicknessInWall,
    convertWallCoreMaterialForWall,
    resetWallLayerOverrides,
  } = useSmartDrawingStore();

  const [layerPreset, setLayerPreset] = React.useState<(typeof LAYER_PRESET_OPTIONS)[number]['value']>('insulation');
  const lengthPx = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const lengthMm = lengthPx * PX_TO_MM;
  const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * (180 / Math.PI);
  const wallType = getWallTypeById(wall.wallTypeId, wallTypeRegistry);
  const layers = resolveWallLayers(wall, wallTypeRegistry);
  const totalThickness = getWallTotalThickness(wall, wallTypeRegistry);
  const coreThickness = getWallCoreThickness(wall, wallTypeRegistry);
  const finishThickness = getWallFinishThickness(wall, wallTypeRegistry);
  const rValue = getWallRValue(wall, wallTypeRegistry);
  const uValue = getWallUValue(wall, wallTypeRegistry);
  const coreLayer = layers.find((layer) => layer.isCore) ?? null;

  const showWarnings = (warnings: string[]) => {
    if (warnings.length === 0 || typeof window === 'undefined') return;
    window.alert(warnings.join('\n'));
  };

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

  const applyWallType = (nextWallTypeId: string) => {
    const defaults = createWallFromTypeDefaults(nextWallTypeId, wallTypeRegistry);
    updateWall(wall.id, {
      wallTypeId: defaults.wallTypeId,
      wallLayers: defaults.wallLayers,
      thickness: defaults.thickness,
      height: defaults.height,
      material: defaults.material,
      color: defaults.color,
      isWallTypeOverride: false,
    });
  };

  const handleCoreMaterialChange = (material: MaterialType) => {
    const warnings = convertWallCoreMaterialForWall(wall.id, material);
    showWarnings(warnings);
  };

  const addLayerPreset = () => {
    const presetLayer = getDefaultLayerPreset(layerPreset, layers.length);
    const warnings = addWallLayerToWall(wall.id, presetLayer, layers.length);
    showWarnings(warnings);
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

      <PropertyRow label="Wall Type">
        <select
          value={wall.wallTypeId ?? wallType.id}
          onChange={(event) => applyWallType(event.target.value)}
          className="w-44 px-2 py-1 text-sm border border-amber-200/80 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white"
        >
          {wallTypeRegistry.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </PropertyRow>

      <PropertyRow label="Thickness">
        <NumberInput
          value={totalThickness}
          onChange={(value) => showWarnings(setWallTotalThickness(wall.id, value))}
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

      <PropertyRow label="Core Material">
        <select
          value={coreLayer?.material ?? 'cement-block'}
          onChange={(event) => handleCoreMaterialChange(event.target.value as MaterialType)}
          className="w-44 px-2 py-1 text-sm border border-amber-200/80 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white"
        >
          {CORE_MATERIAL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </PropertyRow>

      <PropertyRow label="Assembly">
        <span className="text-xs font-mono text-slate-600">
          Core {coreThickness.toFixed(1)} mm | Finish {finishThickness.toFixed(1)} mm
        </span>
      </PropertyRow>

      <PropertyRow label="R / U Value">
        <span className="text-xs font-mono text-slate-600">
          R {rValue.toFixed(3)} | U {uValue.toFixed(3)}
        </span>
      </PropertyRow>

      <PropertyRow label="Override">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold ${
              wall.isWallTypeOverride ? 'text-orange-600' : 'text-emerald-600'
            }`}
          >
            {wall.isWallTypeOverride ? 'Custom' : 'Type Default'}
          </span>
          {wall.isWallTypeOverride && (
            <button
              type="button"
              onClick={() => resetWallLayerOverrides(wall.id)}
              className="inline-flex items-center gap-1 rounded border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-50"
              title="Reset wall layers to selected type defaults"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          )}
        </div>
      </PropertyRow>

      <PropertyRow label="Material">
        <input
          type="text"
          value={wall.material || MATERIAL_LIBRARY.generic.name}
          onChange={(e) => updateWall(wall.id, { material: e.target.value })}
          className="w-32 px-2 py-1 text-sm border border-amber-200/80 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
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

      <div className="mt-3 rounded-md border border-amber-200/70 bg-white/70 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Layers
          </span>
          <div className="flex items-center gap-1">
            <select
              value={layerPreset}
              onChange={(event) =>
                setLayerPreset(event.target.value as (typeof LAYER_PRESET_OPTIONS)[number]['value'])
              }
              className="h-7 rounded border border-amber-200/80 bg-white px-1 text-[11px] text-slate-700"
            >
              {LAYER_PRESET_OPTIONS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addLayerPreset}
              className="inline-flex h-7 items-center gap-1 rounded border border-amber-300 px-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
              title="Add layer preset"
            >
              <Plus size={11} />
              Add
            </button>
          </div>
        </div>
        <div className="space-y-1">
          {layers.map((layer, index) => (
            <div
              key={layer.id}
              className="rounded border border-amber-100/80 bg-white p-1.5"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-700">
                    {layer.name}
                    {layer.isCore ? ' (Core)' : ''}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">
                    {MATERIAL_LIBRARY[layer.material]?.name ?? layer.material}
                  </div>
                </div>
                <div
                  className="h-4 w-4 rounded border border-slate-300"
                  style={{ backgroundColor: layer.color || '#d1d5db' }}
                  title={layer.hatchPattern}
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <NumberInput
                  value={layer.thickness}
                  onChange={(value) =>
                    showWarnings(updateWallLayerThicknessInWall(wall.id, layer.id, value))
                  }
                  min={0.2}
                  max={400}
                  step={0.5}
                  unit="mm"
                  className="text-[11px]"
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      showWarnings(reorderWallLayerInWall(wall.id, index, Math.max(0, index - 1)))
                    }
                    className="rounded border border-amber-200 p-1 text-slate-600 hover:bg-amber-50 disabled:opacity-40"
                    disabled={index === 0}
                    title="Move layer up"
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      showWarnings(
                        reorderWallLayerInWall(wall.id, index, Math.min(layers.length - 1, index + 1))
                      )
                    }
                    className="rounded border border-amber-200 p-1 text-slate-600 hover:bg-amber-50 disabled:opacity-40"
                    disabled={index === layers.length - 1}
                    title="Move layer down"
                  >
                    <ArrowDown size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => showWarnings(removeWallLayerFromWall(wall.id, layer.id))}
                    className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    disabled={layer.isCore}
                    title={layer.isCore ? 'Core layer cannot be removed' : 'Remove layer'}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
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
