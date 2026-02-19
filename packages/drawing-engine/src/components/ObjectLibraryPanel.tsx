/**
 * Architectural object library panel.
 */

'use client';

import {
  ArrowDownAZ,
  Box,
  Download,
  Grid2X2,
  Import,
  List,
  Search,
  Star,
  Upload,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import {
  ARCHITECTURAL_OBJECT_CATEGORIES,
  type ArchitecturalObjectCategory,
  type ArchitecturalObjectDefinition,
  searchArchitecturalObjects,
  sortArchitecturalObjects,
  type ObjectSortMode,
} from '../data';

export interface ObjectLibraryPanelProps {
  className?: string;
  objects: ArchitecturalObjectDefinition[];
  recentUsage: Record<string, number>;
  pendingObjectId: string | null;
  onStartPlacement: (definition: ArchitecturalObjectDefinition) => void;
  onCancelPlacement: () => void;
  onAddCustomObject: (definition: ArchitecturalObjectDefinition) => void;
  onImportCustomObjects: (definitions: ArchitecturalObjectDefinition[]) => void;
}

function formatSize(definition: ArchitecturalObjectDefinition): string {
  return `${Math.round(definition.widthMm)} x ${Math.round(definition.depthMm)} mm`;
}

function objectPreviewPath(definition: ArchitecturalObjectDefinition): string {
  if (definition.symbolPath) return definition.symbolPath;
  if (definition.category === 'doors') {
    return 'M 10 75 L 90 75 M 10 75 L 75 10 M 10 75 C 32 50 52 28 75 10';
  }
  if (definition.category === 'windows') {
    return 'M 10 45 L 90 45 M 10 55 L 90 55 M 50 45 L 50 55';
  }
  return 'M 15 20 L 85 20 L 85 80 L 15 80 Z';
}

function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function ObjectLibraryPanel({
  className = '',
  objects,
  recentUsage,
  pendingObjectId,
  onStartPlacement,
  onCancelPlacement,
  onAddCustomObject,
  onImportCustomObjects,
}: ObjectLibraryPanelProps) {
  const [activeCategory, setActiveCategory] = useState<ArchitecturalObjectCategory>('doors');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<ObjectSortMode>('name');
  const [viewMode, setViewMode] = useState<'thumbnail' | 'list'>('thumbnail');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('drawing-library-favorites');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setFavorites(new Set(parsed.filter((entry): entry is string => typeof entry === 'string')));
      }
    } catch {
      // Ignore malformed persisted values.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('drawing-library-favorites', JSON.stringify(Array.from(favorites)));
  }, [favorites]);

  const filteredObjects = useMemo(() => {
    const byCategory = objects.filter((entry) =>
      query.trim().length > 0 ? true : entry.category === activeCategory
    );
    const searched = searchArchitecturalObjects(byCategory, query);
    return sortArchitecturalObjects(searched, sortMode, recentUsage);
  }, [objects, activeCategory, query, sortMode, recentUsage]);

  const selectedDefinition = useMemo(() => {
    const resolved = objects.find((entry) => entry.id === selectedId) ?? null;
    if (resolved) return resolved;
    if (filteredObjects.length > 0) return filteredObjects[0];
    return null;
  }, [objects, selectedId, filteredObjects]);

  const toggleFavorite = (definitionId: string): void => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(definitionId)) {
        next.delete(definitionId);
      } else {
        next.add(definitionId);
      }
      return next;
    });
  };

  const handleAddCustomObject = () => {
    if (typeof window === 'undefined') return;
    const name = window.prompt('Custom object name');
    if (!name || !name.trim()) return;
    const widthRaw = window.prompt('Width in mm', '900');
    const depthRaw = window.prompt('Depth in mm', '600');
    const heightRaw = window.prompt('Height in mm', '900');
    const width = Number.parseFloat(widthRaw ?? '');
    const depth = Number.parseFloat(depthRaw ?? '');
    const height = Number.parseFloat(heightRaw ?? '');
    if (!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(height)) return;

    const customDefinition: ArchitecturalObjectDefinition = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      category: 'my-library',
      type: 'custom',
      widthMm: Math.max(50, width),
      depthMm: Math.max(50, depth),
      heightMm: Math.max(10, height),
      tags: ['custom', 'my-library'],
      symbolPath: 'M 12 12 L 88 12 L 88 88 L 12 88 Z M 12 50 L 88 50 M 50 12 L 50 88',
      view: 'plan-2d',
      material: 'composite',
      hardware: 'none',
      metadata: {
        createdAt: new Date().toISOString(),
      },
    };
    onAddCustomObject(customDefinition);
    setActiveCategory('my-library');
    setSelectedId(customDefinition.id);
  };

  const handleExportCustomObjects = () => {
    const custom = objects.filter((entry) => entry.category === 'my-library');
    downloadTextFile('architectural-library.custom.json', JSON.stringify(custom, null, 2));
  };

  const handleImportCustomObjects = () => {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        const rawItems = Array.isArray(parsed) ? parsed : [];
        const imported = rawItems
          .filter((entry): entry is ArchitecturalObjectDefinition => Boolean(entry) && typeof entry === 'object')
          .map((entry, index) => ({
            ...entry,
            id: entry.id || `custom-import-${Date.now()}-${index}`,
            category: 'my-library' as const,
            tags: Array.isArray(entry.tags) ? entry.tags : ['custom', 'imported'],
            widthMm: Math.max(50, Number(entry.widthMm) || 900),
            depthMm: Math.max(50, Number(entry.depthMm) || 600),
            heightMm: Math.max(10, Number(entry.heightMm) || 900),
            view: 'plan-2d' as const,
          }));
        if (imported.length > 0) {
          onImportCustomObjects(imported);
          setActiveCategory('my-library');
        }
      } catch {
        // Ignore malformed imports.
      }
    };
    input.click();
  };

  return (
    <div className={`flex h-full flex-col overflow-hidden bg-[#fbf7ee] ${className}`}>
      <div className="border-b border-amber-200/70 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Object Library</h3>
            <p className="text-[11px] text-slate-500">Doors, windows, furniture, fixtures</p>
          </div>
          <button
            type="button"
            onClick={pendingObjectId ? onCancelPlacement : () => selectedDefinition && onStartPlacement(selectedDefinition)}
            className={`rounded border px-2 py-1 text-[11px] ${
              pendingObjectId
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : 'border-amber-200 bg-white text-slate-700 hover:bg-amber-50'
            }`}
          >
            {pendingObjectId ? 'Cancel' : 'Place'}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-6 gap-1">
          {ARCHITECTURAL_OBJECT_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategory(category.id)}
              className={`rounded border px-1 py-1 text-[10px] ${
                activeCategory === category.id
                  ? 'border-amber-400 bg-amber-200 text-amber-900'
                  : 'border-amber-200 bg-white text-slate-600 hover:bg-amber-50'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-1">
          <label className="relative flex-1">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search objects"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded border border-amber-200/80 bg-white py-1.5 pl-7 pr-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </label>
          <button
            type="button"
            onClick={() => setViewMode((mode) => (mode === 'thumbnail' ? 'list' : 'thumbnail'))}
            className="rounded border border-amber-200/80 bg-white px-2 text-slate-600 hover:bg-amber-50"
            title="Toggle browser view"
          >
            {viewMode === 'thumbnail' ? <List size={14} /> : <Grid2X2 size={14} />}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="inline-flex rounded border border-amber-200/80 bg-white">
            <ArrowDownAZ size={14} className="ml-2 mt-1.5 text-slate-400" />
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as ObjectSortMode)}
              className="rounded-r bg-transparent py-1 pl-1 pr-2 text-xs text-slate-700 focus:outline-none"
            >
              <option value="name">Name</option>
              <option value="type">Type</option>
              <option value="size">Size</option>
              <option value="recent">Recently Used</option>
            </select>
          </div>
          <span className="text-[11px] text-slate-500">{filteredObjects.length} items</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className={`grid gap-2 ${viewMode === 'thumbnail' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {filteredObjects.map((definition) => {
            const favorite = favorites.has(definition.id);
            const isSelected = selectedDefinition?.id === definition.id;
            const isPending = pendingObjectId === definition.id;
            return (
              <button
                key={definition.id}
                type="button"
                onClick={() => {
                  setSelectedId(definition.id);
                  onStartPlacement(definition);
                }}
                className={`rounded border px-2 py-2 text-left transition-colors ${
                  isPending
                    ? 'border-blue-400 bg-blue-50'
                    : isSelected
                      ? 'border-amber-400 bg-amber-100/70'
                      : 'border-amber-200/80 bg-white hover:bg-amber-50'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded border border-amber-100 bg-[#fff7e6]">
                    <svg width="30" height="30" viewBox="0 0 100 100" className="text-slate-700">
                      <path d={objectPreviewPath(definition)} fill="none" stroke="currentColor" strokeWidth="5" />
                    </svg>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(definition.id);
                    }}
                    className="rounded p-0.5 hover:bg-amber-50"
                    title={favorite ? 'Remove favorite' : 'Add favorite'}
                  >
                    <Star size={13} className={favorite ? 'fill-amber-400 text-amber-500' : 'text-slate-400'} />
                  </button>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-slate-800">{definition.name}</p>
                <p className="text-[11px] text-slate-500">{formatSize(definition)}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-amber-200/70 px-3 py-2">
        <div className="rounded border border-amber-200/80 bg-white/80 p-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Box size={13} />
            Preview
          </div>
          {selectedDefinition ? (
            <div className="mt-2 space-y-1 text-[11px] text-slate-600">
              <div className="font-medium text-slate-800">{selectedDefinition.name}</div>
              <div>Type: {selectedDefinition.type}</div>
              <div>Size: {formatSize(selectedDefinition)}</div>
              <div>Height: {Math.round(selectedDefinition.heightMm)} mm</div>
              {selectedDefinition.openingWidthMm ? <div>Opening: {Math.round(selectedDefinition.openingWidthMm)} mm</div> : null}
              {selectedDefinition.sillHeightMm ? <div>Sill: {Math.round(selectedDefinition.sillHeightMm)} mm</div> : null}
              {selectedDefinition.uValue ? <div>U-Value: {selectedDefinition.uValue.toFixed(2)}</div> : null}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">Select an object to preview details.</p>
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleAddCustomObject}
            className="rounded border border-amber-200/80 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-amber-50"
          >
            Add Custom
          </button>
          <button
            type="button"
            onClick={handleExportCustomObjects}
            className="inline-flex items-center justify-center gap-1 rounded border border-amber-200/80 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-amber-50"
          >
            <Download size={12} />
            Export
          </button>
          <button
            type="button"
            onClick={handleImportCustomObjects}
            className="inline-flex items-center justify-center gap-1 rounded border border-amber-200/80 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-amber-50"
          >
            <Upload size={12} />
            Import
          </button>
          <button
            type="button"
            onClick={() => setSortMode('recent')}
            className="inline-flex items-center justify-center gap-1 rounded border border-amber-200/80 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-amber-50"
          >
            <Import size={12} />
            Recent
          </button>
        </div>
      </div>
    </div>
  );
}

export default ObjectLibraryPanel;
