/**
 * Duct Plan Builder
 * 
 * Generates HVAC duct layouts from floor plan data.
 * Creates main trunk and branch lines with optimal routing.
 */

import type {
  Point2D,
  Room2D,
  Wall2D,
  IndoorUnit2D,
  DuctSegment2D,
  HVACLayout2D,
  OutdoorUnit2D,
  RefrigerantLine2D,
  DrainLine2D,
  ControlWiring2D,
  BoqSummary,
  BoqLineItem,
  DuctSystem,
  DuctShape,
  IndoorUnitType,
} from '../types';

import { generateId, distance, midpoint, normalOffset, calculatePolygonArea } from './geometry';

// =============================================================================
// Default Settings
// =============================================================================

export interface DuctDefaults {
  mainDuctWidthMm: number;
  mainDuctHeightMm: number;
  branchDuctWidthMm: number;
  branchDuctHeightMm: number;
  offsetFromWall: number;
  minBranchLength: number;
  defaultCapacityKW: number;
  mainDuctVelocity: number;
  branchDuctVelocity: number;
  ductShape: DuctShape;
}

export function buildDuctDefaults(): DuctDefaults {
  return {
    mainDuctWidthMm: 400,
    mainDuctHeightMm: 300,
    branchDuctWidthMm: 200,
    branchDuctHeightMm: 150,
    offsetFromWall: 0.5,
    minBranchLength: 0.3,
    defaultCapacityKW: 3.5, // kW
    mainDuctVelocity: 6, // m/s
    branchDuctVelocity: 4, // m/s
    ductShape: 'rectangular',
  };
}

// =============================================================================
// Route Planning
// =============================================================================

interface RoutePoint {
  point: Point2D;
  type: 'start' | 'junction' | 'end' | 'corner';
}

function planMainRoute(rooms: Room2D[], _walls: Wall2D[]): RoutePoint[] {
  if (rooms.length === 0) return [];

  // Find the centroid of all room centers
  const centers = rooms.map((room) => {
    const sum = room.vertices.reduce(
      (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }),
      { x: 0, y: 0 }
    );
    return {
      x: sum.x / room.vertices.length,
      y: sum.y / room.vertices.length,
    };
  });

  // Create a simple spine along the longest axis
  const minX = Math.min(...centers.map((c) => c.x));
  const maxX = Math.max(...centers.map((c) => c.x));
  const minY = Math.min(...centers.map((c) => c.y));
  const maxY = Math.max(...centers.map((c) => c.y));

  const route: RoutePoint[] = [];

  if (maxX - minX > maxY - minY) {
    // Horizontal main trunk
    const avgY = (minY + maxY) / 2;
    route.push({ point: { x: minX - 0.5, y: avgY }, type: 'start' });
    
    // Add junction points near each room
    centers.sort((a, b) => a.x - b.x);
    centers.forEach((center) => {
      route.push({ point: { x: center.x, y: avgY }, type: 'junction' });
    });
    
    route.push({ point: { x: maxX + 0.5, y: avgY }, type: 'end' });
  } else {
    // Vertical main trunk
    const avgX = (minX + maxX) / 2;
    route.push({ point: { x: avgX, y: minY - 0.5 }, type: 'start' });
    
    centers.sort((a, b) => a.y - b.y);
    centers.forEach((center) => {
      route.push({ point: { x: avgX, y: center.y }, type: 'junction' });
    });
    
    route.push({ point: { x: avgX, y: maxY + 0.5 }, type: 'end' });
  }

  return route;
}

// =============================================================================
// Branch Route Builder
// =============================================================================

export function buildBranchRoute(
  junctionPoint: Point2D,
  targetPoint: Point2D,
  _walls: Wall2D[]
): Point2D[] {
  // Simple L-shaped routing
  const dx = Math.abs(targetPoint.x - junctionPoint.x);
  const dy = Math.abs(targetPoint.y - junctionPoint.y);

  if (dx > dy) {
    // Go horizontal first, then vertical
    const midPoint = { x: targetPoint.x, y: junctionPoint.y };
    return [junctionPoint, midPoint, targetPoint];
  } else {
    // Go vertical first, then horizontal
    const midPoint = { x: junctionPoint.x, y: targetPoint.y };
    return [junctionPoint, midPoint, targetPoint];
  }
}

// =============================================================================
// Indoor Unit Placement
// =============================================================================

function calculateUnitCapacityKW(roomArea: number): number {
  // Rough estimate: 0.2 kW per square meter (200 W/m²)
  const kwPerSqm = 0.2;
  return Math.ceil(roomArea * kwPerSqm * 10) / 10;
}

function determineUnitType(roomArea: number): IndoorUnitType {
  if (roomArea > 40) return 'ducted';
  if (roomArea > 20) return 'ceiling-cassette';
  return 'wall-mounted';
}

function findBestWallForUnit(room: Room2D, walls: Wall2D[]): {
  position: Point2D;
  angle: number;
} | null {
  // Find the longest wall of the room
  let bestWall: Wall2D | null = null;
  let maxLength = 0;

  walls.forEach((wall) => {
    // Check if wall belongs to this room (simplified check)
    const inRoom = room.vertices.some(
      (v) => distance(v, wall.start) < 0.1 || distance(v, wall.end) < 0.1
    );

    if (inRoom) {
      const len = distance(wall.start, wall.end);
      if (len > maxLength) {
        maxLength = len;
        bestWall = wall;
      }
    }
  });

  if (bestWall === null) {
    // Fallback: use the first edge of the room
    if (room.vertices.length >= 2) {
      const v0 = room.vertices[0];
      const v1 = room.vertices[1];
      if (v0 && v1) {
        const mid = midpoint(v0, v1);
        return { position: mid, angle: 0 };
      }
    }
    return null;
  }

  const theWall = bestWall as Wall2D;
  const wallMid = midpoint(theWall.start, theWall.end);
  const angle = Math.atan2(
    theWall.end.y - theWall.start.y,
    theWall.end.x - theWall.start.x
  ) * (180 / Math.PI);

  // Offset from wall
  const offset = normalOffset(theWall.start, theWall.end, 0.3);
  const position = {
    x: wallMid.x + offset.x,
    y: wallMid.y + offset.y,
  };

  return { position, angle };
}

function createIndoorUnits(rooms: Room2D[], walls: Wall2D[]): IndoorUnit2D[] {
  return rooms
    .filter((room) => !room.name?.toLowerCase().includes('corridor'))
    .map((room) => {
      const area = calculatePolygonArea(room.vertices);
      let placement = findBestWallForUnit(room, walls);

      if (!placement) {
        // Fallback to room center
        const center = room.vertices.reduce(
          (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }),
          { x: 0, y: 0 }
        );
        placement = {
          position: {
            x: center.x / room.vertices.length,
            y: center.y / room.vertices.length,
          },
          angle: 0,
        };
      }

      return {
        id: generateId(),
        roomId: room.id,
        type: determineUnitType(area),
        position: placement.position,
        capacityKW: calculateUnitCapacityKW(area),
        servedDiffuserIds: [], // Will be populated when diffusers are created
      };
    });
}

// =============================================================================
// Duct Segment Creation
// =============================================================================

function calculateAirflowM3s(capacityKW: number): number {
  // Rough estimate: 0.05 m³/s per kW
  return capacityKW * 0.05;
}

function createDuctSegments(
  route: RoutePoint[],
  rooms: Room2D[],
  indoorUnits: IndoorUnit2D[],
  defaults: DuctDefaults
): DuctSegment2D[] {
  const segments: DuctSegment2D[] = [];

  // Main trunk segments
  for (let i = 0; i < route.length - 1; i++) {
    const totalAirflow = indoorUnits.reduce((sum, u) => sum + calculateAirflowM3s(u.capacityKW), 0);
    
    segments.push({
      id: generateId(),
      system: 'supply' as DuctSystem,
      shape: defaults.ductShape,
      path: [route[i].point, route[i + 1].point],
      airflowM3s: totalAirflow,
      widthMm: defaults.mainDuctWidthMm,
      heightMm: defaults.mainDuctHeightMm,
    });
  }

  // Branch segments to each indoor unit
  indoorUnits.forEach((unit) => {
    // Find nearest junction point
    const junctions = route.filter((r) => r.type === 'junction');
    let nearestJunction = junctions[0];
    let minDist = Infinity;

    junctions.forEach((j) => {
      const d = distance(j.point, unit.position);
      if (d < minDist) {
        minDist = d;
        nearestJunction = j;
      }
    });

    if (nearestJunction) {
      const branchRoute = buildBranchRoute(
        nearestJunction.point,
        unit.position,
        []
      );

      segments.push({
        id: generateId(),
        system: 'supply' as DuctSystem,
        shape: defaults.ductShape,
        path: branchRoute,
        airflowM3s: calculateAirflowM3s(unit.capacityKW),
        widthMm: defaults.branchDuctWidthMm,
        heightMm: defaults.branchDuctHeightMm,
      });
    }
  });

  return segments;
}

// =============================================================================
// Outdoor Unit Placement
// =============================================================================

function createOutdoorUnits(
  rooms: Room2D[],
  indoorUnits: IndoorUnit2D[]
): OutdoorUnit2D[] {
  // Calculate total capacity needed
  const totalCapacityKW = indoorUnits.reduce((sum, u) => sum + u.capacityKW, 0);

  // Place outdoor unit outside the building envelope
  const allVertices = rooms.flatMap((r) => r.vertices);
  const minX = Math.min(...allVertices.map((v) => v.x)) - 2;
  const maxY = Math.max(...allVertices.map((v) => v.y));
  const avgY = maxY / 2;

  return [
    {
      id: generateId(),
      position: { x: minX, y: avgY },
      capacityKW: totalCapacityKW,
      connectedIndoorIds: indoorUnits.map((u) => u.id),
    },
  ];
}

// =============================================================================
// Refrigerant Lines
// =============================================================================

function createRefrigerantLines(
  indoorUnits: IndoorUnit2D[],
  outdoorUnits: OutdoorUnit2D[]
): RefrigerantLine2D[] {
  const lines: RefrigerantLine2D[] = [];

  if (outdoorUnits.length === 0) return lines;

  const odu = outdoorUnits[0];

  indoorUnits.forEach((idu) => {
    // Create simple L-route for refrigerant line
    const route = buildBranchRoute(odu.position, idu.position, []);

    lines.push({
      id: generateId(),
      path: route,
      diameter: idu.capacityKW > 5 ? 12.7 : 9.52, // mm
      type: 'liquid',
      fromUnitId: odu.id,
      toUnitId: idu.id,
    });

    lines.push({
      id: generateId(),
      path: route.map((p) => ({ x: p.x + 0.05, y: p.y + 0.05 })),
      diameter: idu.capacityKW > 5 ? 19.05 : 15.88, // mm
      type: 'suction',
      fromUnitId: odu.id,
      toUnitId: idu.id,
    });
  });

  return lines;
}

// =============================================================================
// Drain Lines
// =============================================================================

function createDrainLines(indoorUnits: IndoorUnit2D[]): DrainLine2D[] {
  // Group units and route to nearest exterior
  return indoorUnits.map((unit) => ({
    id: generateId(),
    path: [
      unit.position,
      { x: unit.position.x, y: unit.position.y + 1 },
    ],
    diameter: 25, // mm
    slope: 1 / 100, // 1% slope
    fromUnitId: unit.id,
  }));
}

// =============================================================================
// Control Wiring
// =============================================================================

function createControlWiring(
  indoorUnits: IndoorUnit2D[],
  outdoorUnits: OutdoorUnit2D[]
): ControlWiring2D[] {
  const wiring: ControlWiring2D[] = [];

  if (outdoorUnits.length === 0) return wiring;

  const odu = outdoorUnits[0];

  // Communication bus from ODU to each IDU
  indoorUnits.forEach((idu, index) => {
    const prevPoint = index === 0 ? odu.position : indoorUnits[index - 1].position;
    wiring.push({
      id: generateId(),
      path: [prevPoint, idu.position],
      type: 'communication',
      fromId: index === 0 ? odu.id : indoorUnits[index - 1].id,
      toId: idu.id,
    });
  });

  return wiring;
}

// =============================================================================
// BOQ Generation
// =============================================================================

export function generateBoqSummary(layout: HVACLayout2D): BoqSummary {
  const items: BoqLineItem[] = [];
  const totals: Record<string, number> = {};

  // Calculate duct length
  const ductLength = layout.ductSegments.reduce(
    (sum, seg) => {
      let len = 0;
      for (let i = 0; i < seg.path.length - 1; i++) {
        len += distance(seg.path[i], seg.path[i + 1]);
      }
      return sum + len;
    },
    0
  );

  // Calculate refrigerant line length
  const refrigerantLength = layout.refrigerantLines.reduce(
    (sum, line) => {
      let len = 0;
      for (let i = 0; i < line.path.length - 1; i++) {
        len += distance(line.path[i], line.path[i + 1]);
      }
      return sum + len;
    },
    0
  );

  // Calculate drain line length
  const drainLength = layout.drainLines.reduce(
    (sum, line) => {
      let len = 0;
      for (let i = 0; i < line.path.length - 1; i++) {
        len += distance(line.path[i], line.path[i + 1]);
      }
      return sum + len;
    },
    0
  );

  // Calculate control wiring length
  const controlWireLength = layout.controlWiring.reduce(
    (sum, wire) => {
      let len = 0;
      for (let i = 0; i < wire.path.length - 1; i++) {
        len += distance(wire.path[i], wire.path[i + 1]);
      }
      return sum + len;
    },
    0
  );

  // Indoor units by type
  const unitsByType = layout.indoorUnits.reduce<Record<string, number>>((acc, unit) => {
    acc[unit.type] = (acc[unit.type] || 0) + 1;
    return acc;
  }, {});

  // Add items
  Object.entries(unitsByType).forEach(([type, count]) => {
    items.push({
      code: `IDU-${type.toUpperCase()}`,
      description: `Indoor Unit - ${type}`,
      unit: 'EA',
      quantity: count,
    });
  });

  items.push({
    code: 'ODU',
    description: 'Outdoor Unit',
    unit: 'EA',
    quantity: layout.outdoorUnits.length,
  });

  items.push({
    code: 'DUCT',
    description: 'Ductwork',
    unit: 'LM',
    quantity: Math.round(ductLength * 100) / 100,
  });

  items.push({
    code: 'REF-LINE',
    description: 'Refrigerant Line',
    unit: 'LM',
    quantity: Math.round(refrigerantLength * 100) / 100,
  });

  items.push({
    code: 'DRAIN',
    description: 'Drain Line',
    unit: 'LM',
    quantity: Math.round(drainLength * 100) / 100,
  });

  items.push({
    code: 'CTRL-WIRE',
    description: 'Control Wiring',
    unit: 'LM',
    quantity: Math.round(controlWireLength * 100) / 100,
  });

  // Calculate totals
  totals['indoorUnits'] = layout.indoorUnits.length;
  totals['outdoorUnits'] = layout.outdoorUnits.length;
  totals['totalCapacityKW'] = layout.indoorUnits.reduce((sum, u) => sum + u.capacityKW, 0);
  totals['ductLengthM'] = Math.round(ductLength * 100) / 100;
  totals['refrigerantLineLengthM'] = Math.round(refrigerantLength * 100) / 100;
  totals['drainLineLengthM'] = Math.round(drainLength * 100) / 100;
  totals['controlWiringLengthM'] = Math.round(controlWireLength * 100) / 100;

  return {
    items,
    totals,
  };
}

// =============================================================================
// Main Export
// =============================================================================

export function buildDuctPlan(
  rooms: Room2D[],
  walls: Wall2D[],
  options?: Partial<DuctDefaults>
): HVACLayout2D {
  const defaults = { ...buildDuctDefaults(), ...options };

  // Plan the main route
  const route = planMainRoute(rooms, walls);

  // Create indoor units for each room
  const indoorUnits = createIndoorUnits(rooms, walls);

  // Create outdoor units
  const outdoorUnits = createOutdoorUnits(rooms, indoorUnits);

  // Create duct segments
  const ductSegments = createDuctSegments(route, rooms, indoorUnits, defaults);

  // Create refrigerant lines
  const refrigerantLines = createRefrigerantLines(indoorUnits, outdoorUnits);

  // Create drain lines
  const drainLines = createDrainLines(indoorUnits);

  // Create control wiring
  const controlWiring = createControlWiring(indoorUnits, outdoorUnits);

  const layout: HVACLayout2D = {
    id: generateId(),
    indoorUnits,
    outdoorUnits,
    ductSegments,
    refrigerantLines,
    drainLines,
    controlWiring,
  };

  return layout;
}
