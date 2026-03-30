/**
 * AC equipment library definitions for room-aware placement.
 */

import type {
  HvacElementCategory,
  HvacElementType,
  HvacMountType,
} from '../types';

export type AcEquipmentLibraryCategory =
  | 'indoor-units'
  | 'outdoor-units'
  | 'controls'
  | 'accessories';

export type AcEquipmentPlacementMode = 'room' | 'wall' | 'outdoor';

export interface AcEquipmentDefinition {
  id: string;
  name: string;
  category: AcEquipmentLibraryCategory;
  equipmentCategory: HvacElementCategory;
  type: HvacElementType;
  subtype: string;
  modelLabel: string;
  placementMode: AcEquipmentPlacementMode;
  mountType: HvacMountType;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  elevationMm: number;
  defaultRotationDeg?: number;
  supplyZoneRatio?: number;
  description: string;
  tags: string[];
  defaultProperties?: Record<string, unknown>;
}

const DEFAULT_CEILING_ELEVATION_MM = 2400;
const DEFAULT_CONTROL_ELEVATION_MM = 1400;

function equipment(
  definition: AcEquipmentDefinition,
): AcEquipmentDefinition {
  return definition;
}

export const AC_EQUIPMENT_CATEGORY_LABELS: Record<AcEquipmentLibraryCategory, string> = {
  'indoor-units': 'Indoor Units',
  'outdoor-units': 'Outdoor Units',
  controls: 'Controls',
  accessories: 'Accessories',
};

export const DEFAULT_AC_EQUIPMENT_LIBRARY: AcEquipmentDefinition[] = [
  equipment({
    id: 'ac-ceiling-cassette-4way',
    name: 'Ceiling Cassette AC',
    category: 'indoor-units',
    equipmentCategory: 'indoor-unit',
    type: 'ceiling-cassette-ac',
    subtype: '4-way cassette',
    modelLabel: 'Cassette 4-Way',
    placementMode: 'room',
    mountType: 'ceiling',
    widthMm: 840,
    depthMm: 840,
    heightMm: 245,
    elevationMm: DEFAULT_CEILING_ELEVATION_MM,
    supplyZoneRatio: 0.5,
    description: 'Free ceiling placement inside a valid room polygon.',
    tags: ['cassette', 'ceiling', 'indoor', 'vrf'],
    defaultProperties: {
      capacityKw: 5.6,
      airflowLps: 240,
      mountingType: 'ceiling-cassette',
    },
  }),
  equipment({
    id: 'ac-wall-mounted-standard',
    name: 'Wall Mounted AC',
    category: 'indoor-units',
    equipmentCategory: 'indoor-unit',
    type: 'wall-mounted-ac',
    subtype: 'high-wall',
    modelLabel: 'Wall Mounted',
    placementMode: 'wall',
    mountType: 'wall',
    widthMm: 960,
    depthMm: 240,
    heightMm: 320,
    elevationMm: 2200,
    supplyZoneRatio: 0.7,
    description: 'Snaps to the nearest valid internal room wall.',
    tags: ['wall', 'split', 'indoor', 'high-wall'],
    defaultProperties: {
      capacityKw: 3.5,
      airflowLps: 180,
      mountingType: 'wall-mounted',
    },
  }),
  equipment({
    id: 'ac-ceiling-suspended-standard',
    name: 'Ceiling Suspended AC',
    category: 'indoor-units',
    equipmentCategory: 'indoor-unit',
    type: 'ceiling-suspended-ac',
    subtype: 'ceiling-suspended',
    modelLabel: 'Ceiling Suspended',
    placementMode: 'room',
    mountType: 'ceiling',
    widthMm: 1280,
    depthMm: 690,
    heightMm: 235,
    elevationMm: DEFAULT_CEILING_ELEVATION_MM,
    supplyZoneRatio: 0.7,
    description: 'Ceiling-based indoor unit placed within a room.',
    tags: ['ceiling', 'suspended', 'indoor'],
    defaultProperties: {
      capacityKw: 10,
      airflowLps: 420,
      mountingType: 'ceiling-suspended',
    },
  }),
  equipment({
    id: 'ac-ducted-standard',
    name: 'Ducted AC',
    category: 'indoor-units',
    equipmentCategory: 'indoor-unit',
    type: 'ducted-ac',
    subtype: 'ducted',
    modelLabel: 'Ducted Indoor',
    placementMode: 'room',
    mountType: 'ceiling',
    widthMm: 1100,
    depthMm: 700,
    heightMm: 300,
    elevationMm: DEFAULT_CEILING_ELEVATION_MM,
    supplyZoneRatio: 0.5,
    description: 'Indoor ducted unit for service-space or room placement.',
    tags: ['ducted', 'ceiling', 'indoor'],
    defaultProperties: {
      capacityKw: 8,
      airflowLps: 360,
      mountingType: 'ducted',
      espPa: 50,
    },
  }),
  equipment({
    id: 'ac-outdoor-vrf-single',
    name: 'Outdoor Unit',
    category: 'outdoor-units',
    equipmentCategory: 'outdoor-unit',
    type: 'outdoor-unit',
    subtype: 'vrf-outdoor',
    modelLabel: 'Outdoor Unit',
    placementMode: 'outdoor',
    mountType: 'floor',
    widthMm: 940,
    depthMm: 370,
    heightMm: 1380,
    elevationMm: 0,
    supplyZoneRatio: 0.5,
    description: 'Must remain outside internal room zones.',
    tags: ['outdoor', 'condensing', 'vrf'],
    defaultProperties: {
      capacityKw: 22.4,
      airflowLps: 1200,
      mountingType: 'outdoor',
    },
  }),
  equipment({
    id: 'ac-return-filter-standard',
    name: 'Filter Unit',
    category: 'accessories',
    equipmentCategory: 'accessory',
    type: 'filter',
    subtype: 'return-filter',
    modelLabel: 'Filter',
    placementMode: 'room',
    mountType: 'ceiling',
    widthMm: 600,
    depthMm: 600,
    heightMm: 80,
    elevationMm: DEFAULT_CEILING_ELEVATION_MM,
    supplyZoneRatio: 0.5,
    description: 'Simple accessory placement inside a room.',
    tags: ['filter', 'accessory'],
    defaultProperties: {
      filterGrade: 'G4',
      mountingType: 'filter',
    },
  }),
  equipment({
    id: 'ac-remote-wall-standard',
    name: 'Remote Controller',
    category: 'controls',
    equipmentCategory: 'control',
    type: 'remote-controller',
    subtype: 'wired-remote',
    modelLabel: 'Wired Remote',
    placementMode: 'wall',
    mountType: 'wall',
    widthMm: 120,
    depthMm: 30,
    heightMm: 120,
    elevationMm: DEFAULT_CONTROL_ELEVATION_MM,
    defaultRotationDeg: 0,
    supplyZoneRatio: 0.5,
    description: 'Wall-based control point associated with a room.',
    tags: ['remote', 'controller', 'wall'],
    defaultProperties: {
      controlType: 'wired-remote',
      mountingType: 'wall-control',
    },
  }),
  equipment({
    id: 'ac-control-panel-standard',
    name: 'Control Panel',
    category: 'controls',
    equipmentCategory: 'control',
    type: 'control-panel',
    subtype: 'touch-panel',
    modelLabel: 'Touch Panel',
    placementMode: 'wall',
    mountType: 'wall',
    widthMm: 220,
    depthMm: 40,
    heightMm: 180,
    elevationMm: DEFAULT_CONTROL_ELEVATION_MM,
    supplyZoneRatio: 0.5,
    description: 'Larger wall-based control panel for grouped systems.',
    tags: ['control', 'panel', 'wall'],
    defaultProperties: {
      controlType: 'panel',
      mountingType: 'wall-control',
    },
  }),
  equipment({
    id: 'ac-accessory-generic',
    name: 'Accessory',
    category: 'accessories',
    equipmentCategory: 'accessory',
    type: 'accessory',
    subtype: 'generic-accessory',
    modelLabel: 'Accessory',
    placementMode: 'room',
    mountType: 'ceiling',
    widthMm: 280,
    depthMm: 180,
    heightMm: 120,
    elevationMm: DEFAULT_CEILING_ELEVATION_MM,
    supplyZoneRatio: 0.5,
    description: 'Generic HVAC accessory placeholder for planning layouts.',
    tags: ['accessory', 'generic'],
    defaultProperties: {
      mountingType: 'accessory',
    },
  }),
];

export function groupAcEquipmentByCategory(
  definitions: AcEquipmentDefinition[],
): Record<AcEquipmentLibraryCategory, AcEquipmentDefinition[]> {
  return definitions.reduce<Record<AcEquipmentLibraryCategory, AcEquipmentDefinition[]>>(
    (acc, definition) => {
      acc[definition.category].push(definition);
      return acc;
    },
    {
      'indoor-units': [],
      'outdoor-units': [],
      controls: [],
      accessories: [],
    },
  );
}
