/**
 * Wall Type Registry and Layer Management
 *
 * Centralizes wall assemblies, thermal data, core-resize rules, and
 * wall-instance layer override operations.
 */

import type {
  MaterialProperties,
  MaterialType,
  Wall2D,
  WallLayer,
  WallLayerThicknessConstraint,
  WallTypeDefinition,
} from '../types';

import { generateId } from './geometry';

const DEFAULT_WALL_HEIGHT_MM = 2700;
const R_SI = 0.13;
const R_SE = 0.04;

export const MATERIAL_LIBRARY: Record<MaterialType, MaterialProperties> = {
  'cement-block': {
    material: 'cement-block',
    name: 'Cement Block',
    thermalConductivity: 0.72,
    density: 1900,
    specificHeatCapacity: 840,
  },
  'clay-brick': {
    material: 'clay-brick',
    name: 'Clay Brick',
    thermalConductivity: 0.84,
    density: 1700,
    specificHeatCapacity: 800,
  },
  concrete: {
    material: 'concrete',
    name: 'Concrete',
    thermalConductivity: 1.63,
    density: 2400,
    specificHeatCapacity: 880,
  },
  'concrete-block': {
    material: 'concrete-block',
    name: 'Concrete Block',
    thermalConductivity: 1.2,
    density: 2000,
    specificHeatCapacity: 880,
  },
  'gypsum-board': {
    material: 'gypsum-board',
    name: 'Gypsum Board',
    thermalConductivity: 0.17,
    density: 800,
    specificHeatCapacity: 1090,
  },
  plaster: {
    material: 'plaster',
    name: 'Plaster',
    thermalConductivity: 0.72,
    density: 1680,
    specificHeatCapacity: 840,
  },
  'putty-skim': {
    material: 'putty-skim',
    name: 'Putty / Skim Coat',
    thermalConductivity: 0.72,
    density: 1600,
    specificHeatCapacity: 840,
  },
  'eps-insulation': {
    material: 'eps-insulation',
    name: 'EPS Insulation',
    thermalConductivity: 0.035,
    density: 20,
    specificHeatCapacity: 1450,
  },
  'xps-insulation': {
    material: 'xps-insulation',
    name: 'XPS Insulation',
    thermalConductivity: 0.034,
    density: 35,
    specificHeatCapacity: 1450,
  },
  'mineral-wool': {
    material: 'mineral-wool',
    name: 'Mineral Wool',
    thermalConductivity: 0.038,
    density: 100,
    specificHeatCapacity: 840,
  },
  'air-cavity': {
    material: 'air-cavity',
    name: 'Air Cavity',
    thermalConductivity: 0.025,
    density: 1.2,
    specificHeatCapacity: 1005,
  },
  'stud-air-gap': {
    material: 'stud-air-gap',
    name: 'Stud Air Gap',
    thermalConductivity: 0.025,
    density: 1.2,
    specificHeatCapacity: 1005,
  },
  'vapor-barrier': {
    material: 'vapor-barrier',
    name: 'Vapor Barrier',
    thermalConductivity: 0.19,
    density: 940,
    specificHeatCapacity: 1900,
  },
  waterproofing: {
    material: 'waterproofing',
    name: 'Waterproofing',
    thermalConductivity: 0.2,
    density: 1200,
    specificHeatCapacity: 1400,
  },
  generic: {
    material: 'generic',
    name: 'Generic',
    thermalConductivity: 0.5,
    density: 1200,
    specificHeatCapacity: 900,
  },
};

interface CoreThicknessRule {
  min: number;
  step: number;
  snap: 'linear' | 'concrete-block';
  defaultThickness: number;
}

const CORE_THICKNESS_RULES: Partial<Record<MaterialType, CoreThicknessRule>> = {
  'cement-block': { min: 100, step: 50, snap: 'linear', defaultThickness: 150 },
  'clay-brick': { min: 115, step: 115, snap: 'linear', defaultThickness: 230 },
  concrete: { min: 100, step: 25, snap: 'linear', defaultThickness: 200 },
  'concrete-block': { min: 90, step: 90, snap: 'concrete-block', defaultThickness: 190 },
  'gypsum-board': { min: 12.5, step: 12.5, snap: 'linear', defaultThickness: 12.5 },
};

const LAYER_THICKNESS_RULES: Partial<Record<MaterialType, WallLayerThicknessConstraint>> = {
  plaster: { min: 5, max: 25, step: 1 },
  'putty-skim': { min: 1, max: 5, step: 0.5 },
  'eps-insulation': { min: 25, max: 200, step: 5 },
  'xps-insulation': { min: 25, max: 200, step: 5 },
  'mineral-wool': { min: 25, max: 200, step: 5 },
  'air-cavity': { min: 10, max: 100, step: 5 },
  'stud-air-gap': { min: 10, max: 100, step: 5 },
};

interface LayerSeed {
  name: string;
  material: MaterialType;
  thickness: number;
  isCore?: boolean;
  color: string;
  hatchPattern: string;
}

function createLayer(seed: LayerSeed, order: number): WallLayer {
  const material = MATERIAL_LIBRARY[seed.material] ?? MATERIAL_LIBRARY.generic;
  return {
    id: generateId(),
    name: seed.name,
    material: seed.material,
    thickness: seed.thickness,
    isCore: seed.isCore === true,
    color: seed.color,
    hatchPattern: seed.hatchPattern,
    thermalConductivity: material.thermalConductivity,
    density: material.density,
    specificHeatCapacity: material.specificHeatCapacity,
    order,
  };
}

function cloneLayer(layer: WallLayer, regenerateId = false): WallLayer {
  return {
    ...layer,
    id: regenerateId ? generateId() : layer.id,
  };
}

function withIndexedLayers(layers: WallLayer[]): WallLayer[] {
  return layers.map((layer, index) => ({ ...layer, order: index }));
}

function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function snapConcreteBlockThickness(value: number): number {
  if (value <= 140) return 90;
  if (value <= 235) return 190;
  const stepped = 190 + roundToStep(value - 190, 90);
  return Math.max(190, stepped);
}

export function snapCoreThickness(material: MaterialType, rawThickness: number): number {
  const rule = CORE_THICKNESS_RULES[material];
  if (!rule) return Math.max(1, rawThickness);
  const normalized = Math.max(rule.min, rawThickness);
  if (rule.snap === 'concrete-block') {
    return snapConcreteBlockThickness(normalized);
  }
  const snapped = roundToStep(normalized - rule.min, rule.step) + rule.min;
  return Number(snapped.toFixed(4));
}

function computeTotalThickness(layers: WallLayer[]): number {
  return layers.reduce((sum, layer) => sum + Math.max(layer.thickness, 0), 0);
}

function computeRValue(layers: WallLayer[]): number {
  const conductiveR = layers.reduce((sum, layer) => {
    const conductivity = Math.max(layer.thermalConductivity, 0.0001);
    const thicknessM = Math.max(layer.thickness, 0) / 1000;
    return sum + thicknessM / conductivity;
  }, 0);
  return R_SI + conductiveR + R_SE;
}

function computeUValue(layers: WallLayer[]): number {
  const rValue = computeRValue(layers);
  return rValue <= 0 ? 0 : 1 / rValue;
}

function createWallType(definition: {
  id: string;
  name: string;
  category: WallTypeDefinition['category'];
  planTextureId: string;
  sectionTextureId: string;
  coreColor: string;
  layers: LayerSeed[];
  defaultHeight?: number;
}): WallTypeDefinition {
  const layers = withIndexedLayers(definition.layers.map((seed, idx) => createLayer(seed, idx)));
  return {
    id: definition.id,
    name: definition.name,
    category: definition.category,
    layers,
    totalThickness: computeTotalThickness(layers),
    uValue: computeUValue(layers),
    defaultHeight: definition.defaultHeight ?? DEFAULT_WALL_HEIGHT_MM,
    planTextureId: definition.planTextureId,
    sectionTextureId: definition.sectionTextureId,
    coreColor: definition.coreColor,
  };
}

export const BUILT_IN_WALL_TYPES: WallTypeDefinition[] = [
  createWallType({
    id: 'cement-block-wall',
    name: 'Cement Block Wall',
    category: 'structural',
    planTextureId: 'block-diagonal-crosshatch',
    sectionTextureId: 'block-section',
    coreColor: '#B8B8B8',
    layers: [
      { name: 'External Plaster', material: 'plaster', thickness: 15, color: '#D8D8D8', hatchPattern: 'plaster-fine' },
      { name: 'Cement Block', material: 'cement-block', thickness: 150, isCore: true, color: '#B8B8B8', hatchPattern: 'block-diagonal-crosshatch' },
      { name: 'Internal Plaster', material: 'plaster', thickness: 12, color: '#E0E0E0', hatchPattern: 'plaster-fine' },
      { name: 'Putty/Skim Coat', material: 'putty-skim', thickness: 3, color: '#EFEFEF', hatchPattern: 'putty-fine' },
    ],
  }),
  createWallType({
    id: 'brick-wall',
    name: 'Brick Wall',
    category: 'structural',
    planTextureId: 'brick-staggered',
    sectionTextureId: 'brick-section',
    coreColor: '#C4714A',
    layers: [
      { name: 'External Plaster', material: 'plaster', thickness: 15, color: '#D8D8D8', hatchPattern: 'plaster-fine' },
      { name: 'Clay Brick', material: 'clay-brick', thickness: 230, isCore: true, color: '#C4714A', hatchPattern: 'brick-staggered' },
      { name: 'Internal Plaster', material: 'plaster', thickness: 12, color: '#E0E0E0', hatchPattern: 'plaster-fine' },
      { name: 'Putty', material: 'putty-skim', thickness: 3, color: '#EFEFEF', hatchPattern: 'putty-fine' },
    ],
  }),
  createWallType({
    id: 'concrete-wall-cast-insitu',
    name: 'Concrete Wall (Cast in-situ)',
    category: 'structural',
    planTextureId: 'concrete-stipple',
    sectionTextureId: 'concrete-section',
    coreColor: '#A0A0A0',
    layers: [
      { name: 'External Render', material: 'plaster', thickness: 15, color: '#D8D8D8', hatchPattern: 'render-fine' },
      { name: 'Reinforced Concrete', material: 'concrete', thickness: 200, isCore: true, color: '#A0A0A0', hatchPattern: 'concrete-stipple' },
      { name: 'Internal Plaster', material: 'plaster', thickness: 12, color: '#E0E0E0', hatchPattern: 'plaster-fine' },
      { name: 'Putty', material: 'putty-skim', thickness: 3, color: '#EFEFEF', hatchPattern: 'putty-fine' },
    ],
  }),
  createWallType({
    id: 'concrete-block-wall',
    name: 'Concrete Block Wall',
    category: 'structural',
    planTextureId: 'block-diagonal-dots',
    sectionTextureId: 'block-section',
    coreColor: '#9E9E9E',
    layers: [
      { name: 'External Plaster', material: 'plaster', thickness: 15, color: '#D8D8D8', hatchPattern: 'plaster-fine' },
      { name: 'Concrete Block', material: 'concrete-block', thickness: 190, isCore: true, color: '#9E9E9E', hatchPattern: 'block-diagonal-dots' },
      { name: 'Internal Plaster', material: 'plaster', thickness: 12, color: '#E0E0E0', hatchPattern: 'plaster-fine' },
      { name: 'Putty', material: 'putty-skim', thickness: 3, color: '#EFEFEF', hatchPattern: 'putty-fine' },
    ],
  }),
  createWallType({
    id: 'partition-wall-lightweight',
    name: 'Partition Wall (Lightweight)',
    category: 'partition',
    planTextureId: 'partition-parallel-lines',
    sectionTextureId: 'partition-section',
    coreColor: '#D9D2C5',
    layers: [
      { name: 'Gypsum Board', material: 'gypsum-board', thickness: 12.5, color: '#E6DFD4', hatchPattern: 'gypsum-lines' },
      { name: 'Stud Air Gap', material: 'stud-air-gap', thickness: 75, isCore: true, color: '#D9D2C5', hatchPattern: 'partition-parallel-lines' },
      { name: 'Gypsum Board', material: 'gypsum-board', thickness: 12.5, color: '#E6DFD4', hatchPattern: 'gypsum-lines' },
    ],
  }),
  createWallType({
    id: 'insulated-cavity-wall',
    name: 'Insulated Cavity Wall',
    category: 'structural',
    planTextureId: 'cavity-block-insulation',
    sectionTextureId: 'cavity-section',
    coreColor: '#B8B8B8',
    layers: [
      { name: 'External Plaster', material: 'plaster', thickness: 15, color: '#D8D8D8', hatchPattern: 'plaster-fine' },
      { name: 'Outer Block', material: 'cement-block', thickness: 100, isCore: true, color: '#B8B8B8', hatchPattern: 'block-diagonal-crosshatch' },
      { name: 'Insulation', material: 'eps-insulation', thickness: 50, color: '#FFE066', hatchPattern: 'insulation-zigzag' },
      { name: 'Air Cavity', material: 'air-cavity', thickness: 25, color: '#F5F5F5', hatchPattern: 'air-gap-dots' },
      { name: 'Inner Block', material: 'cement-block', thickness: 100, isCore: true, color: '#B8B8B8', hatchPattern: 'block-diagonal-crosshatch' },
      { name: 'Internal Plaster', material: 'plaster', thickness: 12, color: '#E0E0E0', hatchPattern: 'plaster-fine' },
      { name: 'Putty', material: 'putty-skim', thickness: 3, color: '#EFEFEF', hatchPattern: 'putty-fine' },
    ],
  }),
];

export const BUILT_IN_WALL_TYPE_IDS = BUILT_IN_WALL_TYPES.map((wallType) => wallType.id);
export const DEFAULT_WALL_TYPE_ID = BUILT_IN_WALL_TYPES[0]?.id ?? 'cement-block-wall';

const FALLBACK_WALL_TYPE: WallTypeDefinition = createWallType({
  id: 'fallback-wall-type',
  name: 'Fallback Wall',
  category: 'structural',
  planTextureId: 'block-diagonal-crosshatch',
  sectionTextureId: 'block-section',
  coreColor: '#9E9E9E',
  layers: [
    {
      name: 'Generic Core',
      material: 'generic',
      thickness: 150,
      isCore: true,
      color: '#9E9E9E',
      hatchPattern: 'generic-core',
    },
  ],
});

export type LayerPresetType =
  | 'insulation'
  | 'plaster'
  | 'vapor-barrier'
  | 'air-gap'
  | 'waterproofing';

const DEFAULT_LAYER_PRESET_SEEDS: Record<LayerPresetType, LayerSeed> = {
  insulation: {
    name: 'Insulation',
    material: 'eps-insulation',
    thickness: 50,
    color: '#FFE066',
    hatchPattern: 'insulation-zigzag',
  },
  plaster: {
    name: 'Plaster',
    material: 'plaster',
    thickness: 12,
    color: '#E0E0E0',
    hatchPattern: 'plaster-fine',
  },
  'vapor-barrier': {
    name: 'Vapor Barrier',
    material: 'vapor-barrier',
    thickness: 0.2,
    color: '#93C5FD',
    hatchPattern: 'vapor-line',
  },
  'air-gap': {
    name: 'Air Gap',
    material: 'air-cavity',
    thickness: 25,
    color: '#F5F5F5',
    hatchPattern: 'air-gap-dots',
  },
  waterproofing: {
    name: 'Waterproofing',
    material: 'waterproofing',
    thickness: 3,
    color: '#60A5FA',
    hatchPattern: 'waterproof-wave',
  },
};

function normalizeWallTypeRegistry(
  customWallTypes: WallTypeDefinition[] = []
): WallTypeDefinition[] {
  const merged = [...BUILT_IN_WALL_TYPES, ...customWallTypes];
  return merged.map((wallType) => {
    const indexedLayers = withIndexedLayers(wallType.layers.map((layer) => cloneLayer(layer)));
    return {
      ...wallType,
      layers: indexedLayers,
      totalThickness: computeTotalThickness(indexedLayers),
      uValue: computeUValue(indexedLayers),
    };
  });
}

export function getWallTypeRegistry(customWallTypes: WallTypeDefinition[] = []): WallTypeDefinition[] {
  return normalizeWallTypeRegistry(customWallTypes);
}

export function getWallTypeById(
  wallTypeId: string | undefined,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallTypeDefinition {
  const fallback = registry[0] ?? BUILT_IN_WALL_TYPES[0] ?? FALLBACK_WALL_TYPE;
  if (!wallTypeId) return fallback;
  return registry.find((wallType) => wallType.id === wallTypeId) ?? fallback;
}

export function getWallLayersForType(
  wallTypeId: string | undefined,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayer[] {
  const wallType = getWallTypeById(wallTypeId, registry);
  return withIndexedLayers(wallType.layers.map((layer) => cloneLayer(layer, true)));
}

export function getDefaultLayerPreset(preset: LayerPresetType, order = 0): WallLayer {
  return createLayer(DEFAULT_LAYER_PRESET_SEEDS[preset], order);
}

function layerFingerprint(layer: WallLayer): string {
  return [
    layer.name,
    layer.material,
    Number(layer.thickness).toFixed(4),
    layer.isCore ? 'core' : 'finish',
    layer.hatchPattern,
  ].join('|');
}

function layersFingerprint(layers: WallLayer[]): string {
  return withIndexedLayers(layers).map(layerFingerprint).join('::');
}

export function isWallUsingTypeDefault(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): boolean {
  const wallType = getWallTypeById(wall.wallTypeId, registry);
  const effectiveLayers = resolveWallLayers(wall, registry);
  return layersFingerprint(effectiveLayers) === layersFingerprint(wallType.layers);
}

export function resolveWallLayers(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayer[] {
  if (wall.wallLayers && wall.wallLayers.length > 0) {
    return withIndexedLayers(wall.wallLayers.map((layer) => cloneLayer(layer, false)));
  }
  return getWallLayersForType(wall.wallTypeId, registry);
}

function getCoreLayerIndices(layers: WallLayer[]): number[] {
  const indices: number[] = [];
  layers.forEach((layer, index) => {
    if (layer.isCore) indices.push(index);
  });
  return indices;
}

function getPrimaryCoreLayerIndex(layers: WallLayer[]): number {
  const coreIndices = getCoreLayerIndices(layers);
  return coreIndices[0] ?? 0;
}

function markOverrideState(wall: Wall2D, layers: WallLayer[], registry: WallTypeDefinition[]): Wall2D {
  const resolvedLayers = withIndexedLayers(layers);
  return {
    ...wall,
    wallLayers: resolvedLayers,
    thickness: computeTotalThickness(resolvedLayers),
    isWallTypeOverride: !isWallUsingTypeDefault({ ...wall, wallLayers: resolvedLayers }, registry),
  };
}

export interface WallLayerOperationResult {
  wall: Wall2D;
  warnings: string[];
}

export function resizeWallTotalThickness(
  wall: Wall2D,
  requestedTotalThickness: number,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayerOperationResult {
  const layers = resolveWallLayers(wall, registry);
  const coreIndex = getPrimaryCoreLayerIndex(layers);
  const coreLayer = layers[coreIndex];
  if (!coreLayer) {
    return {
      wall: { ...wall, thickness: Math.max(1, requestedTotalThickness) },
      warnings: ['Wall has no valid core layer.'],
    };
  }

  const finishThickness = layers.reduce((sum, layer, index) => {
    if (index === coreIndex) return sum;
    return sum + Math.max(layer.thickness, 0);
  }, 0);

  const requestedCore = Math.max(0, requestedTotalThickness - finishThickness);
  const snappedCore = snapCoreThickness(coreLayer.material, requestedCore);
  const nextLayers = layers.map((layer, index) =>
    index === coreIndex ? { ...layer, thickness: snappedCore } : { ...layer }
  );
  const nextWall = markOverrideState(wall, nextLayers, registry);

  return {
    wall: nextWall,
    warnings: [],
  };
}

function validateLayerStack(layers: WallLayer[]): string[] {
  const warnings: string[] = [];
  const coreIndex = getPrimaryCoreLayerIndex(layers);
  layers.forEach((layer, index) => {
    if (layer.material !== 'plaster') return;
    const isOutermost = index === 0 || index === layers.length - 1;
    const isAdjacentToCore = Math.abs(index - coreIndex) === 1;
    if (!isOutermost && !isAdjacentToCore) {
      warnings.push(`Layer "${layer.name}" is plaster/render but is not outermost or adjacent to core.`);
    }
  });
  return warnings;
}

export function addWallLayer(
  wall: Wall2D,
  layer: WallLayer,
  index: number,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayerOperationResult {
  const layers = resolveWallLayers(wall, registry);
  const boundedIndex = Math.max(0, Math.min(index, layers.length));
  const before = boundedIndex > 0 ? layers[boundedIndex - 1] : null;
  const after = boundedIndex < layers.length ? layers[boundedIndex] : null;
  if (before?.isCore && after?.isCore) {
    return {
      wall,
      warnings: ['Cannot add a layer inside the structural core stack.'],
    };
  }
  const nextLayers = [...layers];
  nextLayers.splice(boundedIndex, 0, { ...layer, id: generateId() });
  const indexedLayers = withIndexedLayers(nextLayers);
  return {
    wall: markOverrideState(wall, indexedLayers, registry),
    warnings: validateLayerStack(indexedLayers),
  };
}

export function removeWallLayer(
  wall: Wall2D,
  layerId: string,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayerOperationResult {
  const layers = resolveWallLayers(wall, registry);
  const target = layers.find((layer) => layer.id === layerId);
  if (!target) return { wall, warnings: [] };
  if (target.isCore) {
    return {
      wall,
      warnings: ['Core layer cannot be removed.'],
    };
  }

  const warnings: string[] = [];
  if (target.material === 'eps-insulation' || target.material === 'xps-insulation' || target.material === 'mineral-wool') {
    warnings.push('Removing insulation will affect thermal performance.');
  }

  const nextLayers = withIndexedLayers(layers.filter((layer) => layer.id !== layerId));
  return {
    wall: markOverrideState(wall, nextLayers, registry),
    warnings,
  };
}

export function reorderWallLayers(
  wall: Wall2D,
  fromIndex: number,
  toIndex: number,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayerOperationResult {
  const layers = resolveWallLayers(wall, registry);
  if (fromIndex < 0 || fromIndex >= layers.length || toIndex < 0 || toIndex >= layers.length) {
    return { wall, warnings: [] };
  }
  const nextLayers = [...layers];
  const [moved] = nextLayers.splice(fromIndex, 1);
  if (!moved) return { wall, warnings: [] };
  nextLayers.splice(toIndex, 0, moved);
  const indexedLayers = withIndexedLayers(nextLayers);
  return {
    wall: markOverrideState(wall, indexedLayers, registry),
    warnings: validateLayerStack(indexedLayers),
  };
}

function applyThicknessRule(
  layer: WallLayer,
  requestedThickness: number
): number {
  const rule = LAYER_THICKNESS_RULES[layer.material];
  let next = requestedThickness;
  if (rule?.min !== undefined) next = Math.max(rule.min, next);
  if (rule?.max !== undefined) next = Math.min(rule.max, next);
  if (rule?.step !== undefined && rule.step > 0) {
    const base = rule.min ?? 0;
    next = roundToStep(next - base, rule.step) + base;
  }
  return Number(next.toFixed(4));
}

export function updateWallLayerThickness(
  wall: Wall2D,
  layerId: string,
  requestedThickness: number,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayerOperationResult {
  const layers = resolveWallLayers(wall, registry);
  const nextLayers = layers.map((layer) => {
    if (layer.id !== layerId) return { ...layer };
    if (layer.isCore) {
      return {
        ...layer,
        thickness: snapCoreThickness(layer.material, requestedThickness),
      };
    }
    return {
      ...layer,
      thickness: applyThicknessRule(layer, requestedThickness),
    };
  });

  const indexedLayers = withIndexedLayers(nextLayers);
  return {
    wall: markOverrideState(wall, indexedLayers, registry),
    warnings: validateLayerStack(indexedLayers),
  };
}

export function convertWallCoreMaterial(
  wall: Wall2D,
  coreMaterial: MaterialType,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayerOperationResult {
  const layers = resolveWallLayers(wall, registry);
  const coreIndex = getPrimaryCoreLayerIndex(layers);
  const core = layers[coreIndex];
  if (!core) return { wall, warnings: ['Wall has no core layer.'] };
  const material = MATERIAL_LIBRARY[coreMaterial] ?? MATERIAL_LIBRARY.generic;
  const rule = CORE_THICKNESS_RULES[coreMaterial];
  const defaultThickness = rule?.defaultThickness ?? core.thickness;

  const nextCore: WallLayer = {
    ...core,
    material: coreMaterial,
    name: material.name,
    thickness: snapCoreThickness(coreMaterial, defaultThickness),
    thermalConductivity: material.thermalConductivity,
    density: material.density,
    specificHeatCapacity: material.specificHeatCapacity,
    hatchPattern: `${coreMaterial}-core`,
  };
  const nextLayers = layers.map((layer, index) => (index === coreIndex ? nextCore : { ...layer }));
  const indexedLayers = withIndexedLayers(nextLayers);
  return {
    wall: markOverrideState(wall, indexedLayers, registry),
    warnings: [],
  };
}

export function resetWallToTypeDefault(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): Wall2D {
  const wallType = getWallTypeById(wall.wallTypeId, registry);
  const layers = getWallLayersForType(wallType.id, registry);
  return {
    ...wall,
    wallTypeId: wallType.id,
    wallLayers: layers,
    thickness: wallType.totalThickness,
    material: layers.find((layer) => layer.isCore)?.name ?? wall.material,
    color: wallType.coreColor,
    height: wall.height || wallType.defaultHeight,
    isWallTypeOverride: false,
  };
}

export function createWallFromTypeDefaults(
  wallTypeId: string,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): Pick<Wall2D, 'wallTypeId' | 'wallLayers' | 'thickness' | 'height' | 'material' | 'color' | 'isWallTypeOverride'> {
  const wallType = getWallTypeById(wallTypeId, registry);
  const layers = getWallLayersForType(wallType.id, registry);
  return {
    wallTypeId: wallType.id,
    wallLayers: layers,
    thickness: wallType.totalThickness,
    height: wallType.defaultHeight,
    material: layers.find((layer) => layer.isCore)?.name ?? wallType.name,
    color: wallType.coreColor,
    isWallTypeOverride: false,
  };
}

export function normalizeWallForTypeSystem(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): Wall2D {
  const wallType = getWallTypeById(wall.wallTypeId ?? DEFAULT_WALL_TYPE_ID, registry);
  const layers = resolveWallLayers(
    {
      ...wall,
      wallTypeId: wall.wallTypeId ?? wallType.id,
    },
    registry
  );
  const nextWall: Wall2D = {
    ...wall,
    wallTypeId: wall.wallTypeId ?? wallType.id,
    wallLayers: withIndexedLayers(layers),
    thickness: wall.thickness > 0 ? wall.thickness : computeTotalThickness(layers),
    height: wall.height > 0 ? wall.height : wallType.defaultHeight,
    color: wall.color ?? wallType.coreColor,
    material: wall.material ?? layers.find((layer) => layer.isCore)?.name ?? wallType.name,
  };
  return {
    ...nextWall,
    isWallTypeOverride: !isWallUsingTypeDefault(nextWall, registry),
  };
}

export function getWallTotalThickness(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): number {
  return computeTotalThickness(resolveWallLayers(wall, registry));
}

export function getWallRValue(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): number {
  return computeRValue(resolveWallLayers(wall, registry));
}

export function getWallUValue(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): number {
  return computeUValue(resolveWallLayers(wall, registry));
}

export function getWallCoreThickness(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): number {
  const layers = resolveWallLayers(wall, registry);
  return layers.filter((layer) => layer.isCore).reduce((sum, layer) => sum + layer.thickness, 0);
}

export function getWallFinishThickness(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): number {
  const total = getWallTotalThickness(wall, registry);
  return total - getWallCoreThickness(wall, registry);
}

export function getWallLayerAtDepth(
  wall: Wall2D,
  depthMm: number,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): WallLayer | null {
  if (!Number.isFinite(depthMm) || depthMm < 0) return null;
  const layers = resolveWallLayers(wall, registry);
  let cursor = 0;
  for (const layer of layers) {
    const nextCursor = cursor + layer.thickness;
    if (depthMm >= cursor && depthMm <= nextCursor + 1e-6) {
      return layer;
    }
    cursor = nextCursor;
  }
  return null;
}

export function createWallComputationFacade(
  wall: Wall2D,
  registry: WallTypeDefinition[] = BUILT_IN_WALL_TYPES
): {
  getTotalThickness: () => number;
  getUValue: () => number;
  getRValue: () => number;
  getCoreThickness: () => number;
  getFinishThickness: () => number;
  getLayerAtDepth: (depthMm: number) => WallLayer | null;
} {
  return {
    getTotalThickness: () => getWallTotalThickness(wall, registry),
    getUValue: () => getWallUValue(wall, registry),
    getRValue: () => getWallRValue(wall, registry),
    getCoreThickness: () => getWallCoreThickness(wall, registry),
    getFinishThickness: () => getWallFinishThickness(wall, registry),
    getLayerAtDepth: (depthMm: number) => getWallLayerAtDepth(wall, depthMm, registry),
  };
}
