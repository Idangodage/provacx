import * as turf from '@turf/turf';

import type { JoinData, Point2D, Wall } from '../../../types';

import { computeWallBodyPolygon, computeWallPolygon } from './WallGeometry';
import { computeWallJoinMap, computeWallJoinMapWithShadows } from './WallJoinNetwork';

const COMPONENT_TOLERANCE_MM = 2;
const COORDINATE_TOLERANCE_MM = 0.001;
const MIN_PATCH_AREA_MM2 = 0.1;
const MIN_UNION_ENDPOINT_ANGLE_DEG = 15;
const SEGMENT_INTERIOR_TOLERANCE = 0.001;

type Endpoint = 'start' | 'end';
type RingCoordinate = number[];
type PolygonFeature = ReturnType<typeof turf.polygon>;
type PolygonGeometry = PolygonFeature['geometry'];
type MultiPolygonGeometry = ReturnType<typeof turf.multiPolygon>['geometry'];

interface EndpointFace {
  anchor: Point2D;
}

interface WallEndpointRef {
  key: string;
  wall: Wall;
  endpoint: Endpoint;
  point: Point2D;
  direction: Point2D;
  thickness: number;
  angleDeg: number;
  left: EndpointFace;
  right: EndpointFace;
}

interface EndpointNode {
  point: Point2D;
  endpoints: WallEndpointRef[];
}

export interface WallUnionComponent {
  id: string;
  wallIds: string[];
  polygons: Point2D[][][];
  junctionOverlays: Point2D[][][];
}

export interface WallUnionRenderData {
  joinsMap: Map<string, JoinData[]>;
  components: WallUnionComponent[];
}

function pointDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function copyPoint(point: Point2D): Point2D {
  return { x: point.x, y: point.y };
}

function add(a: Point2D, b: Point2D): Point2D {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

function subtract(a: Point2D, b: Point2D): Point2D {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

function scale(vector: Point2D, scalar: number): Point2D {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
  };
}

function normalize(vector: Point2D): Point2D {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.000001) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function normalizeAngleDeg(angleDeg: number): number {
  let normalized = angleDeg % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function directionAwayFromWallEndpoint(wall: Wall, endpoint: Endpoint): Point2D {
  return endpoint === 'start'
    ? normalize(subtract(wall.endPoint, wall.startPoint))
    : normalize(subtract(wall.startPoint, wall.endPoint));
}

function directionAlongWall(wall: Wall): Point2D {
  return normalize(subtract(wall.endPoint, wall.startPoint));
}

function angleBetweenDirectionsDeg(a: Point2D, b: Point2D): number {
  const clampedDot = Math.max(-1, Math.min(1, dot(a, b)));
  return Math.acos(clampedDot) * (180 / Math.PI);
}

function angleBetweenWallAxesDeg(wall: Wall, otherWall: Wall): number {
  const axisDot = Math.max(
    -1,
    Math.min(1, Math.abs(dot(directionAlongWall(wall), directionAlongWall(otherWall))))
  );
  return Math.acos(axisDot) * (180 / Math.PI);
}

function wallsShareAcuteEndpointContact(wall: Wall, otherWall: Wall): boolean {
  const endpointPairs: Array<[Point2D, Endpoint, Point2D, Endpoint]> = [
    [wall.startPoint, 'start', otherWall.startPoint, 'start'],
    [wall.startPoint, 'start', otherWall.endPoint, 'end'],
    [wall.endPoint, 'end', otherWall.startPoint, 'start'],
    [wall.endPoint, 'end', otherWall.endPoint, 'end'],
  ];

  for (const [wallPoint, wallEndpoint, otherPoint, otherEndpoint] of endpointPairs) {
    if (!arePointsNear(wallPoint, otherPoint)) {
      continue;
    }

    const angleDeg = angleBetweenDirectionsDeg(
      directionAwayFromWallEndpoint(wall, wallEndpoint),
      directionAwayFromWallEndpoint(otherWall, otherEndpoint)
    );
    if (angleDeg < MIN_UNION_ENDPOINT_ANGLE_DEG) {
      return true;
    }
  }

  return false;
}

function wallsShareAcuteSegmentContact(wall: Wall, otherWall: Wall): boolean {
  if (angleBetweenWallAxesDeg(wall, otherWall) >= MIN_UNION_ENDPOINT_ANGLE_DEG) {
    return false;
  }

  const hasAcuteInteriorProjection = (sourceWall: Wall, hostWall: Wall): boolean => {
    const projections = [
      projectPointToSegment(sourceWall.startPoint, hostWall.startPoint, hostWall.endPoint),
      projectPointToSegment(sourceWall.endPoint, hostWall.startPoint, hostWall.endPoint),
    ];

    return projections.some(
      (projection) =>
        projection.distance <= COMPONENT_TOLERANCE_MM &&
        projection.t > SEGMENT_INTERIOR_TOLERANCE &&
        projection.t < 1 - SEGMENT_INTERIOR_TOLERANCE
    );
  };

  return hasAcuteInteriorProjection(wall, otherWall) || hasAcuteInteriorProjection(otherWall, wall);
}

function canWallsShareUnionComponent(wall: Wall, otherWall: Wall): boolean {
  return !(
    wallsShareAcuteEndpointContact(wall, otherWall) ||
    wallsShareAcuteSegmentContact(wall, otherWall)
  );
}

function polygonArea(points: Point2D[]): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
}

function isFinitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function arePointsNear(a: Point2D, b: Point2D, tolerance = COMPONENT_TOLERANCE_MM): boolean {
  return pointDistance(a, b) <= tolerance;
}

function projectPointToSegment(
  point: Point2D,
  start: Point2D,
  end: Point2D
): { point: Point2D; distance: number; t: number } {
  const segment = subtract(end, start);
  const lengthSq = segment.x * segment.x + segment.y * segment.y;

  if (lengthSq < 0.000001) {
    return {
      point: { ...start },
      distance: pointDistance(point, start),
      t: 0,
    };
  }

  const tRaw =
    ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) / lengthSq;
  const t = Math.max(0, Math.min(1, tRaw));
  const projection = {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t,
  };

  return {
    point: projection,
    distance: pointDistance(point, projection),
    t,
  };
}

/**
 * Snap a coordinate to a fixed precision grid (0.01 mm) to prevent
 * floating-point noise from creating micro-notches in turf.js unions.
 * Miter vertices at a junction are computed from different line pairs
 * that should intersect at the same point, but floating-point arithmetic
 * can produce results that differ by a few ULPs.  Snapping eliminates
 * these micro-differences.
 */
const COORDINATE_SNAP_PRECISION = 100; // 1/100 mm = 0.01 mm

function snapCoordinate(value: number): number {
  return Math.round(value * COORDINATE_SNAP_PRECISION) / COORDINATE_SNAP_PRECISION;
}

function normalizeRing(ring: Point2D[]): Point2D[] {
  const cleaned: Point2D[] = [];

  for (const point of ring) {
    if (!isFinitePoint(point)) {
      continue;
    }
    const snapped = { x: snapCoordinate(point.x), y: snapCoordinate(point.y) };
    const previous = cleaned[cleaned.length - 1];
    if (!previous || pointDistance(previous, snapped) > COORDINATE_TOLERANCE_MM) {
      cleaned.push(snapped);
    }
  }

  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (pointDistance(first, last) <= COORDINATE_TOLERANCE_MM) {
      cleaned.pop();
    }
  }

  return cleaned;
}

function closeRing(points: Point2D[]): RingCoordinate[] {
  const ring = normalizeRing(points);
  if (ring.length === 0) {
    return [];
  }

  const closed = ring.map((point) => [point.x, point.y] as RingCoordinate);
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (!last || last[0] !== first[0] || last[1] !== first[1]) {
    closed.push([first[0], first[1]]);
  }

  return closed;
}

function openRing(ring: ReadonlyArray<RingCoordinate>): Point2D[] {
  return normalizeRing(
    ring.map((point) => ({
      x: point[0],
      y: point[1],
    }))
  );
}

function makePolygonFeature(vertices: Point2D[]): PolygonFeature | null {
  const ring = normalizeRing(vertices);
  if (ring.length < 3 || Math.abs(polygonArea(ring)) < MIN_PATCH_AREA_MM2) {
    return null;
  }

  const closedRing = closeRing(ring);
  if (closedRing.length < 4) {
    return null;
  }

  try {
    return turf.polygon([closedRing]);
  } catch {
    return null;
  }
}

function wallPolygonFeature(wall: Wall, joins?: JoinData[]): PolygonFeature | null {
  return (
    makePolygonFeature(computeWallPolygon(wall, joins)) ??
    makePolygonFeature(computeWallBodyPolygon(wall))
  );
}

function patchPolygonFeature(vertices: Point2D[]): PolygonFeature | null {
  return makePolygonFeature(vertices);
}

function wallsTouch(wall: Wall, otherWall: Wall): boolean {
  if (
    wall.connectedWalls.includes(otherWall.id) ||
    otherWall.connectedWalls.includes(wall.id)
  ) {
    return true;
  }

  const endpoints: Point2D[] = [wall.startPoint, wall.endPoint];
  const otherEndpoints: Point2D[] = [otherWall.startPoint, otherWall.endPoint];

  for (const point of endpoints) {
    if (otherEndpoints.some((otherPoint) => arePointsNear(point, otherPoint))) {
      return true;
    }

    const projection = projectPointToSegment(point, otherWall.startPoint, otherWall.endPoint);
    if (
      projection.distance <= COMPONENT_TOLERANCE_MM &&
      projection.t > 0.001 &&
      projection.t < 0.999
    ) {
      return true;
    }
  }

  for (const point of otherEndpoints) {
    const projection = projectPointToSegment(point, wall.startPoint, wall.endPoint);
    if (
      projection.distance <= COMPONENT_TOLERANCE_MM &&
      projection.t > 0.001 &&
      projection.t < 0.999
    ) {
      return true;
    }
  }

  return false;
}

function addGraphEdge(graph: Map<string, Set<string>>, a: string, b: string): void {
  if (a === b) {
    return;
  }

  if (!graph.has(a)) {
    graph.set(a, new Set());
  }
  if (!graph.has(b)) {
    graph.set(b, new Set());
  }

  graph.get(a)?.add(b);
  graph.get(b)?.add(a);
}

/**
 * Spatial grid for fast proximity lookups — replaces O(n²) all-pairs
 * wallsTouch checks with O(n) insert + O(k) per-cell neighbor queries.
 */
const SPATIAL_GRID_CELL_SIZE_MM = 500; // ~50 cm cells, tuned for typical wall lengths

function wallSpatialKeys(wall: Wall): string[] {
  const keys = new Set<string>();
  const points = [wall.startPoint, wall.endPoint];
  for (const point of points) {
    const cx = Math.floor(point.x / SPATIAL_GRID_CELL_SIZE_MM);
    const cy = Math.floor(point.y / SPATIAL_GRID_CELL_SIZE_MM);
    // Insert into cell and all 8 neighbors to handle walls near cell borders
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        keys.add(`${cx + dx},${cy + dy}`);
      }
    }
  }
  return Array.from(keys);
}

function buildComponentGraph(
  walls: Wall[],
  joinsMap: Map<string, JoinData[]>
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]));
  const pairCompatibilityCache = new Map<string, boolean>();

  const shouldLinkWalls = (wall: Wall, otherWall: Wall): boolean => {
    const pairKey = [wall.id, otherWall.id].sort().join('|');
    const cached = pairCompatibilityCache.get(pairKey);
    if (cached !== undefined) {
      return cached;
    }

    const compatible = canWallsShareUnionComponent(wall, otherWall);
    pairCompatibilityCache.set(pairKey, compatible);
    return compatible;
  };

  for (const wall of walls) {
    graph.set(wall.id, new Set());
  }

  for (const wall of walls) {
    for (const connectedWallId of wall.connectedWalls) {
      const connectedWall = wallsById.get(connectedWallId);
      if (connectedWall && shouldLinkWalls(wall, connectedWall)) {
        addGraphEdge(graph, wall.id, connectedWallId);
      }
    }
  }

  joinsMap.forEach((joins, wallId) => {
    const wall = wallsById.get(wallId);
    if (!wall) {
      return;
    }

    for (const join of joins) {
      const otherWall = wallsById.get(join.otherWallId);
      if (otherWall && shouldLinkWalls(wall, otherWall)) {
        addGraphEdge(graph, wallId, join.otherWallId);
      }
    }
  });

  // Spatial grid: only test wall pairs that share a grid cell — O(n·k)
  // instead of O(n²) where k is the average number of neighbors per cell.
  const spatialGrid = new Map<string, Wall[]>();
  for (const wall of walls) {
    for (const key of wallSpatialKeys(wall)) {
      let cell = spatialGrid.get(key);
      if (!cell) {
        cell = [];
        spatialGrid.set(key, cell);
      }
      cell.push(wall);
    }
  }

  const testedPairs = new Set<string>();
  for (const cell of spatialGrid.values()) {
    for (let i = 0; i < cell.length; i += 1) {
      for (let j = i + 1; j < cell.length; j += 1) {
        const pairKey = cell[i].id < cell[j].id
          ? `${cell[i].id}|${cell[j].id}`
          : `${cell[j].id}|${cell[i].id}`;
        if (testedPairs.has(pairKey)) continue;
        testedPairs.add(pairKey);

        if (
          shouldLinkWalls(cell[i], cell[j]) &&
          wallsTouch(cell[i], cell[j])
        ) {
          addGraphEdge(graph, cell[i].id, cell[j].id);
        }
      }
    }
  }

  return graph;
}

function buildConnectedComponents(
  walls: Wall[],
  joinsMap: Map<string, JoinData[]>
): string[][] {
  const graph = buildComponentGraph(walls, joinsMap);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const wall of walls) {
    if (visited.has(wall.id)) {
      continue;
    }

    const queue = [wall.id];
    const component: string[] = [];
    visited.add(wall.id);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      component.push(current);
      const neighbors = graph.get(current) ?? new Set<string>();
      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      });
    }

    components.push(component);
  }

  return components;
}

function extractPolygons(
  geometry: PolygonGeometry | MultiPolygonGeometry
): Point2D[][][] {
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates.map(openRing)];
  }

  return geometry.coordinates.map((polygon) => polygon.map(openRing));
}

function endpointKey(wallId: string, endpoint: Endpoint): string {
  return `${wallId}:${endpoint}`;
}

function directionAwayFromEndpoint(wall: Wall, endpoint: Endpoint): Point2D {
  return endpoint === 'start'
    ? normalize(subtract(wall.endPoint, wall.startPoint))
    : normalize(subtract(wall.startPoint, wall.endPoint));
}

function buildEndpointRef(wall: Wall, endpoint: Endpoint): WallEndpointRef {
  const point = endpoint === 'start' ? wall.startPoint : wall.endPoint;
  const direction = directionAwayFromEndpoint(wall, endpoint);
  const angleDeg = normalizeAngleDeg(Math.atan2(direction.y, direction.x) * (180 / Math.PI));

  if (endpoint === 'start') {
    return {
      key: endpointKey(wall.id, endpoint),
      wall,
      endpoint,
      point,
      direction,
      thickness: wall.thickness,
      angleDeg,
      left: { anchor: wall.interiorLine.start },
      right: { anchor: wall.exteriorLine.start },
    };
  }

  return {
    key: endpointKey(wall.id, endpoint),
    wall,
    endpoint,
    point,
    direction,
    thickness: wall.thickness,
    angleDeg,
    left: { anchor: wall.exteriorLine.end },
    right: { anchor: wall.interiorLine.end },
  };
}

function buildEndpointNodes(walls: Wall[]): EndpointNode[] {
  const refs = walls.flatMap((wall) => [
    buildEndpointRef(wall, 'start'),
    buildEndpointRef(wall, 'end'),
  ]);
  const nodes: EndpointNode[] = [];

  for (const ref of refs) {
    let node = nodes.find((candidate) => pointDistance(candidate.point, ref.point) <= COMPONENT_TOLERANCE_MM);
    if (!node) {
      node = {
        point: copyPoint(ref.point),
        endpoints: [],
      };
      nodes.push(node);
    } else if (node.endpoints.length > 0) {
      const count = node.endpoints.length + 1;
      node.point = scale(add(scale(node.point, node.endpoints.length), ref.point), 1 / count);
    }

    node.endpoints.push(ref);
  }

  return nodes;
}

function anchorAngleDeg(nodePoint: Point2D, anchor: Point2D): number {
  return normalizeAngleDeg(Math.atan2(anchor.y - nodePoint.y, anchor.x - nodePoint.x) * (180 / Math.PI));
}

function endpointRawCapVertices(endpointRef: WallEndpointRef): {
  interiorVertex: Point2D;
  exteriorVertex: Point2D;
} {
  if (endpointRef.endpoint === 'start') {
    return {
      interiorVertex: copyPoint(endpointRef.wall.interiorLine.start),
      exteriorVertex: copyPoint(endpointRef.wall.exteriorLine.start),
    };
  }

  return {
    interiorVertex: copyPoint(endpointRef.wall.interiorLine.end),
    exteriorVertex: copyPoint(endpointRef.wall.exteriorLine.end),
  };
}

function endpointJoinForRef(
  endpointRef: WallEndpointRef,
  joinsMap: Map<string, JoinData[]>
): JoinData | undefined {
  return (joinsMap.get(endpointRef.wall.id) ?? []).find(
    (join) => join.endpoint === endpointRef.endpoint
  );
}

function endpointResolvedCapVertices(
  endpointRef: WallEndpointRef,
  joinsMap: Map<string, JoinData[]>
): { leftVertex: Point2D; rightVertex: Point2D } {
  const join = endpointJoinForRef(endpointRef, joinsMap);
  if (!join) {
    const raw = endpointRawCapVertices(endpointRef);
    return endpointRef.endpoint === 'start'
      ? {
        leftVertex: raw.interiorVertex,
        rightVertex: raw.exteriorVertex,
      }
      : {
        leftVertex: raw.exteriorVertex,
        rightVertex: raw.interiorVertex,
      };
  }

  const resolved = resolveJoinEdgeVertices(endpointRef.wall, join);
  return endpointRef.endpoint === 'start'
    ? {
      leftVertex: resolved.interiorVertex,
      rightVertex: resolved.exteriorVertex,
    }
    : {
      leftVertex: resolved.exteriorVertex,
      rightVertex: resolved.interiorVertex,
    };
}

function resolveJoinEdgeVertices(wall: Wall, join: JoinData): {
  interiorVertex: Point2D;
  exteriorVertex: Point2D;
} {
  let interiorVertex = copyPoint(join.interiorVertex);
  let exteriorVertex = copyPoint(join.exteriorVertex);

  if (!join.bevelDirection) {
    return { interiorVertex, exteriorVertex };
  }

  const bevelDirection = normalize(join.bevelDirection);
  if (Math.hypot(bevelDirection.x, bevelDirection.y) < 0.0001) {
    return { interiorVertex, exteriorVertex };
  }

  const wallVector = subtract(wall.endPoint, wall.startPoint);
  const wallLen = Math.hypot(wallVector.x, wallVector.y);
  const maxOffset = Math.max(0, join.maxBevelOffset ?? wallLen / 2);
  const bevel =
    join.endpoint === 'start'
      ? wall.startBevel ?? { outerOffset: 0, innerOffset: 0 }
      : wall.endBevel ?? { outerOffset: 0, innerOffset: 0 };
  const innerOffset = Math.min(maxOffset, Math.max(0, bevel.innerOffset ?? 0));
  const outerOffset = Math.min(maxOffset, Math.max(0, bevel.outerOffset ?? 0));

  interiorVertex = add(interiorVertex, scale(bevelDirection, -innerOffset));
  exteriorVertex = add(exteriorVertex, scale(bevelDirection, -outerOffset));
  return { interiorVertex, exteriorVertex };
}

function buildEndpointJoinPatchFeature(wall: Wall, join: JoinData): PolygonFeature | null {
  if (!join.endpoint) {
    return null;
  }

  const endpointRef = buildEndpointRef(wall, join.endpoint);
  const rawCap = endpointRawCapVertices(endpointRef);
  const joined = resolveJoinEdgeVertices(wall, join);
  return patchPolygonFeature([
    rawCap.interiorVertex,
    joined.interiorVertex,
    joined.exteriorVertex,
    rawCap.exteriorVertex,
  ]);
}

function buildEndpointJoinPatchFeatures(
  walls: Wall[],
  joinsMap: Map<string, JoinData[]>,
  filter?: (join: JoinData) => boolean
): PolygonFeature[] {
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]));
  const features: PolygonFeature[] = [];

  joinsMap.forEach((joins, wallId) => {
    const wall = wallsById.get(wallId);
    if (!wall) {
      return;
    }

    joins.forEach((join) => {
      if (filter && !filter(join)) {
        return;
      }
      const feature = buildEndpointJoinPatchFeature(wall, join);
      if (feature) {
        features.push(feature);
      }
    });
  });

  return features;
}

function buildNodeCorePatchFeatures(
  walls: Wall[],
  joinsMap: Map<string, JoinData[]>,
  includeNode?: (node: EndpointNode) => boolean
): PolygonFeature[] {
  const nodes = buildEndpointNodes(walls);
  const features: PolygonFeature[] = [];

  for (const node of nodes) {
    if (node.endpoints.length < 2) {
      continue;
    }
    if (includeNode && !includeNode(node)) {
      continue;
    }

    const resolvedVertices = node.endpoints.flatMap((endpointRef) => {
      const vertices = endpointResolvedCapVertices(endpointRef, joinsMap);
      return [vertices.leftVertex, vertices.rightVertex];
    });
    const uniqueVertices: Point2D[] = [];
    resolvedVertices.forEach((vertex) => {
      if (!uniqueVertices.some((candidate) => pointDistance(candidate, vertex) <= COORDINATE_TOLERANCE_MM)) {
        uniqueVertices.push(copyPoint(vertex));
      }
    });

    if (uniqueVertices.length < 3) {
      continue;
    }

    const ring = uniqueVertices
      .sort((a, b) => anchorAngleDeg(node.point, a) - anchorAngleDeg(node.point, b));
    const patch = patchPolygonFeature(ring);
    if (patch) {
      features.push(patch);
    }
  }

  return features;
}

function featureUnionPolygons(features: PolygonFeature[]): Point2D[][][] {
  if (features.length === 0) {
    return [];
  }

  if (features.length === 1) {
    return [features[0].geometry.coordinates.map(openRing)];
  }

  try {
    const merged = turf.union(turf.featureCollection(features));
    if (merged && (merged.geometry.type === 'Polygon' || merged.geometry.type === 'MultiPolygon')) {
      return extractPolygons(merged.geometry);
    }
  } catch {
    // Fall through to the per-feature polygons below.
  }

  return features.map((feature) => feature.geometry.coordinates.map(openRing));
}

function unionWallComponent(
  walls: Wall[],
  joinsMap: Map<string, JoinData[]>
): { polygons: Point2D[][][]; junctionOverlays: Point2D[][][] } {
  if (walls.length === 0) {
    return { polygons: [], junctionOverlays: [] };
  }

  const features = [
    ...walls.flatMap((wall) => {
      const feature = wallPolygonFeature(wall, joinsMap.get(wall.id));
      return feature ? [feature] : [];
    }),
    ...buildNodeCorePatchFeatures(walls, joinsMap),
  ];
  const overlayFeatures = [
    ...buildNodeCorePatchFeatures(
      walls,
      joinsMap,
      (node) =>
        node.endpoints.length >= 2 &&
        !node.endpoints.some((endpointRef) => endpointJoinForRef(endpointRef, joinsMap)?.joinType === 'bevel')
    ),
    ...buildEndpointJoinPatchFeatures(
      walls,
      joinsMap,
      (join) => join.joinType !== 'bevel'
    ),
  ];

  return {
    polygons: featureUnionPolygons(features),
    junctionOverlays: featureUnionPolygons(overlayFeatures),
  };
}

export function computeWallUnionRenderData(
  walls: Wall[],
  precomputedJoinsMap?: Map<string, JoinData[]>
): WallUnionRenderData {
  // When no precomputed joins are provided, use the shadow-aware variant
  // so that coincident duplicate walls (e.g. shared room edges) are excluded
  // from the polygon union — preventing double-thickness artifacts.
  let joinsMap: Map<string, JoinData[]>;
  let shadowedWallIds: Set<string>;

  if (precomputedJoinsMap) {
    joinsMap = precomputedJoinsMap;
    shadowedWallIds = new Set<string>();
  } else {
    const result = computeWallJoinMapWithShadows(walls);
    joinsMap = result.joinsMap;
    shadowedWallIds = result.shadowedWallIds;
  }

  const wallsById = new Map(walls.map((wall) => [wall.id, wall]));
  const components = buildConnectedComponents(walls, joinsMap)
    .map((wallIds, index) => {
      // Exclude shadowed walls from the polygon union — the representative
      // wall already covers the same geometry.  Keep shadowed IDs in the
      // component's wallIds list so hit-testing / selection still works.
      const componentWalls = wallIds
        .map((wallId) => wallsById.get(wallId))
        .filter((wall): wall is Wall => Boolean(wall));

      const unionWalls = shadowedWallIds.size > 0
        ? componentWalls.filter((w) => !shadowedWallIds.has(w.id))
        : componentWalls;

      return {
        id: `wall-component-${index}`,
        wallIds,
        ...unionWallComponent(unionWalls, joinsMap),
      };
    })
    .filter((component) => component.polygons.length > 0 || component.junctionOverlays.length > 0);

  return {
    joinsMap,
    components,
  };
}

// =============================================================================
// Wall Union Cache — avoids recomputing turf.js unions from scratch every frame
// =============================================================================

/**
 * Fingerprint a wall's geometry-relevant properties.
 * If any of these change the union polygon for its component is stale.
 */
function wallGeometryFingerprint(wall: Wall): string {
  return `${wall.startPoint.x},${wall.startPoint.y}|${wall.endPoint.x},${wall.endPoint.y}|${wall.thickness}|${wall.centerlineOffset ?? 0}|${wall.connectedWalls.join(',')}|${wall.startBevel?.outerOffset ?? 0},${wall.startBevel?.innerOffset ?? 0}|${wall.endBevel?.outerOffset ?? 0},${wall.endBevel?.innerOffset ?? 0}`;
}

interface CachedUnionData {
  /** Fingerprints at time of last computation, keyed by wall id */
  fingerprints: Map<string, string>;
  /** The full render data result */
  renderData: WallUnionRenderData;
  /** Wall IDs that were in each component, indexed by component id */
  componentWallIds: Map<string, string[]>;
}

let unionCache: CachedUnionData | null = null;

/**
 * Invalidate the union cache.  Call this when walls are added or removed,
 * or when a full recomputation is explicitly needed.
 */
export function invalidateUnionCache(): void {
  unionCache = null;
}

/**
 * Compute wall union render data with caching.
 *
 * On the first call (or after invalidation) this does a full computation.
 * On subsequent calls it checks wall fingerprints and only recomputes
 * components that contain changed walls, reusing cached results for
 * unchanged components.
 */
export function computeWallUnionRenderDataCached(
  walls: Wall[],
  precomputedJoinsMap?: Map<string, JoinData[]>
): WallUnionRenderData {
  // Build current fingerprints
  const currentFingerprints = new Map<string, string>();
  for (const wall of walls) {
    currentFingerprints.set(wall.id, wallGeometryFingerprint(wall));
  }

  // Check if cache is usable: same set of wall IDs and no geometry changes
  if (unionCache) {
    const cached = unionCache;
    const wallIdsMatch =
      currentFingerprints.size === cached.fingerprints.size &&
      [...currentFingerprints.keys()].every((id) => cached.fingerprints.has(id));

    if (wallIdsMatch) {
      // Find which walls changed
      const changedWallIds = new Set<string>();
      for (const [id, fp] of currentFingerprints) {
        if (cached.fingerprints.get(id) !== fp) {
          changedWallIds.add(id);
        }
      }

      if (changedWallIds.size === 0) {
        // Nothing changed — return cached result directly
        return cached.renderData;
      }

      // Find which components are affected by the changed walls
      const dirtyComponentIds = new Set<string>();
      for (const component of cached.renderData.components) {
        if (component.wallIds.some((id) => changedWallIds.has(id))) {
          dirtyComponentIds.add(component.id);
        }
      }

      // If fewer than half of components are dirty, do a partial recompute
      if (dirtyComponentIds.size < cached.renderData.components.length / 2) {
        // Recompute joins for the full set (needed for correct geometry)
        let joinsMap: Map<string, JoinData[]>;
        let shadowedWallIds: Set<string>;
        if (precomputedJoinsMap) {
          joinsMap = precomputedJoinsMap;
          shadowedWallIds = new Set<string>();
        } else {
          const result = computeWallJoinMapWithShadows(walls);
          joinsMap = result.joinsMap;
          shadowedWallIds = result.shadowedWallIds;
        }

        const wallsById = new Map(walls.map((w) => [w.id, w]));

        // Rebuild only dirty components; keep clean ones from cache
        const freshComponents: WallUnionComponent[] = [];
        for (const component of cached.renderData.components) {
          if (!dirtyComponentIds.has(component.id)) {
            freshComponents.push(component);
            continue;
          }
          // Recompute this component
          const componentWalls = component.wallIds
            .map((id) => wallsById.get(id))
            .filter((w): w is Wall => Boolean(w));
          const unionWalls = shadowedWallIds.size > 0
            ? componentWalls.filter((w) => !shadowedWallIds.has(w.id))
            : componentWalls;
          const rebuilt = unionWallComponent(unionWalls, joinsMap);
          if (rebuilt.polygons.length > 0 || rebuilt.junctionOverlays.length > 0) {
            freshComponents.push({
              id: component.id,
              wallIds: component.wallIds,
              ...rebuilt,
            });
          }
        }

        const renderData: WallUnionRenderData = { joinsMap, components: freshComponents };
        // Update cache
        unionCache = {
          fingerprints: currentFingerprints,
          renderData,
          componentWallIds: new Map(freshComponents.map((c) => [c.id, c.wallIds])),
        };
        return renderData;
      }
    }
  }

  // Full computation (cache miss, wall set changed, or too many dirty components)
  const renderData = computeWallUnionRenderData(walls, precomputedJoinsMap);
  unionCache = {
    fingerprints: currentFingerprints,
    renderData,
    componentWallIds: new Map(renderData.components.map((c) => [c.id, c.wallIds])),
  };
  return renderData;
}

/**
 * Compute junction (corner) patch polygons for all nodes where 2+ walls meet.
 * Each patch is a 2D polygon that fills the gap between wall endpoints at a junction.
 * Returns the polygon vertices and the IDs of walls participating in each junction.
 */
export function computeJunctionPatchPolygons(
  walls: Wall[],
  precomputedJoinsMap?: Map<string, JoinData[]>
): { polygon: Point2D[]; wallIds: string[] }[] {
  const joinsMap = precomputedJoinsMap ?? computeWallJoinMap(walls);
  const nodes = buildEndpointNodes(walls);
  const patches: { polygon: Point2D[]; wallIds: string[] }[] = [];

  for (const node of nodes) {
    if (node.endpoints.length < 2) {
      continue;
    }

    const resolvedVertices = node.endpoints.flatMap((endpointRef) => {
      const vertices = endpointResolvedCapVertices(endpointRef, joinsMap);
      return [vertices.leftVertex, vertices.rightVertex];
    });
    const uniqueVertices: Point2D[] = [];
    resolvedVertices.forEach((vertex) => {
      if (!uniqueVertices.some((candidate) => pointDistance(candidate, vertex) <= COORDINATE_TOLERANCE_MM)) {
        uniqueVertices.push(copyPoint(vertex));
      }
    });

    if (uniqueVertices.length < 3) {
      continue;
    }

    const ring = uniqueVertices.sort(
      (a, b) => anchorAngleDeg(node.point, a) - anchorAngleDeg(node.point, b)
    );

    if (Math.abs(polygonArea(ring)) < MIN_PATCH_AREA_MM2) {
      continue;
    }

    patches.push({
      polygon: ring,
      wallIds: node.endpoints.map((ep) => ep.wall.id),
    });
  }

  return patches;
}
