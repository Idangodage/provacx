import * as turf from '@turf/turf';

import type { JoinData, Point2D, Wall } from '../../../types';

import { computeWallBodyPolygon, computeWallPolygon, isPolygonSelfIntersecting } from './WallGeometry';
import { computeWallJoinMap } from './WallJoinNetwork';

const COMPONENT_TOLERANCE_MM = 2;
const COORDINATE_TOLERANCE_MM = 0.001;
const MIN_PATCH_AREA_MM2 = 0.1;
const MIN_NODE_PATCH_AREA_MM2 = 0.001;
const MIN_RENDER_HOLE_AREA_MM2 = 200;
const ACUTE_NODE_CENTER_PATCH_RADIUS_FACTOR = 0.55;
const ACUTE_NODE_CENTER_PATCH_MIN_RADIUS_MM = 6;
const ACUTE_NODE_HOLE_GUARD_RADIUS_FACTOR = 1.2;
const ACUTE_NODE_HOLE_GUARD_RADIUS_PADDING_MM = 2;
const ACUTE_NODE_HOLE_GUARD_MAX_RADIUS_MM = 32;
const ACUTE_NODE_HOLE_GUARD_MAX_AREA_MM2 = 250_000;
const ACUTE_NODE_PATCH_MAX_EXTENSION_FACTOR = 0.5;
const ACUTE_NODE_PATCH_MIN_EXTENSION_MM = 2;
const NODE_PATCH_ANGLE_MERGE_DEG = 0.75;
const NODE_PATCH_MIN_EDGE_MM = 0.5;
const NODE_PATCH_COLLINEAR_SINE = 0.01;
const MIN_UNION_SEGMENT_ANGLE_DEG = 3;
const SEGMENT_INTERIOR_TOLERANCE = 0.001;

type Endpoint = 'start' | 'end';
type RingCoordinate = number[];
type PolygonFeature = ReturnType<typeof turf.polygon>;
type MultiPolygonFeature = ReturnType<typeof turf.multiPolygon>;
type AreaFeature = PolygonFeature | MultiPolygonFeature;
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

interface NodeHoleGuard {
  point: Point2D;
  radius: number;
  maxHoleArea: number;
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

function directionAlongWall(wall: Wall): Point2D {
  return normalize(subtract(wall.endPoint, wall.startPoint));
}

function angleBetweenWallAxesDeg(wall: Wall, otherWall: Wall): number {
  const axisDot = Math.max(
    -1,
    Math.min(1, Math.abs(dot(directionAlongWall(wall), directionAlongWall(otherWall))))
  );
  return Math.acos(axisDot) * (180 / Math.PI);
}

function wallsShareAcuteSegmentContact(wall: Wall, otherWall: Wall): boolean {
  if (angleBetweenWallAxesDeg(wall, otherWall) >= MIN_UNION_SEGMENT_ANGLE_DEG) {
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
  // Keep endpoint-connected walls in the same union component so dense
  // node fans render as one smooth junction. Only split near-collinear
  // segment-to-segment contacts to avoid unstable strip unions.
  return !wallsShareAcuteSegmentContact(wall, otherWall);
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

function normalizeRing(ring: Point2D[]): Point2D[] {
  const cleaned: Point2D[] = [];

  for (const point of ring) {
    if (!isFinitePoint(point)) {
      continue;
    }
    const previous = cleaned[cleaned.length - 1];
    if (!previous || pointDistance(previous, point) > COORDINATE_TOLERANCE_MM) {
      cleaned.push({ x: point.x, y: point.y });
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

function makePolygonFeature(
  vertices: Point2D[],
  minAreaMm2: number = MIN_PATCH_AREA_MM2
): PolygonFeature | null {
  const ring = normalizeRing(vertices);
  if (ring.length < 3 || Math.abs(polygonArea(ring)) < minAreaMm2) {
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

function patchPolygonFeature(
  vertices: Point2D[],
  minAreaMm2: number = MIN_PATCH_AREA_MM2
): PolygonFeature | null {
  return makePolygonFeature(vertices, minAreaMm2);
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

  for (let index = 0; index < walls.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < walls.length; otherIndex += 1) {
      if (
        shouldLinkWalls(walls[index], walls[otherIndex]) &&
        wallsTouch(walls[index], walls[otherIndex])
      ) {
        addGraphEdge(graph, walls[index].id, walls[otherIndex].id);
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
  const normalizePolygonRings = (rings: RingCoordinate[][]): Point2D[][] | null => {
    if (rings.length === 0) {
      return null;
    }

    const outer = openRing(rings[0]);
    if (outer.length < 3 || Math.abs(polygonArea(outer)) < MIN_PATCH_AREA_MM2) {
      return null;
    }

    const holes = rings
      .slice(1)
      .map(openRing)
      .filter(
        (ring) =>
          ring.length >= 3 &&
          Math.abs(polygonArea(ring)) >= MIN_RENDER_HOLE_AREA_MM2
      );

    return [outer, ...holes];
  };

  if (geometry.type === 'Polygon') {
    const polygon = normalizePolygonRings(geometry.coordinates as RingCoordinate[][]);
    return polygon ? [polygon] : [];
  }

  return geometry.coordinates
    .map((polygon) => normalizePolygonRings(polygon as RingCoordinate[][]))
    .filter((polygon): polygon is Point2D[][] => Boolean(polygon));
}

function suppressAcuteNodeHoleArtifacts(
  polygons: Point2D[][][],
  holeGuards: NodeHoleGuard[]
): Point2D[][][] {
  if (holeGuards.length === 0) {
    return polygons;
  }

  return polygons.map((polygon) => {
    if (polygon.length <= 1) {
      return polygon;
    }

    const holes = polygon.slice(1).filter((hole) => {
      const holeArea = Math.abs(polygonArea(hole));
      const holeFullyInsideGuard = (guard: NodeHoleGuard): boolean =>
        hole.every(
          (point) =>
            pointDistance(point, guard.point) <= guard.radius + COORDINATE_TOLERANCE_MM
        );
      const shouldSuppress = holeGuards.some(
        (guard) =>
          holeArea <= guard.maxHoleArea &&
          holeFullyInsideGuard(guard)
      );
      return !shouldSuppress;
    });

    return [polygon[0], ...holes];
  });
}

function normalizePolygonFeaturesForUnion(feature: AreaFeature): PolygonFeature[] {
  const cleaned = turf.cleanCoords(feature, { mutate: false }) as AreaFeature;

  if (cleaned.geometry.type === 'Polygon') {
    try {
      const unkinked = turf.unkinkPolygon(cleaned as PolygonFeature);
      if (unkinked.features.length > 0) {
        return unkinked.features.map(
          (piece) => turf.cleanCoords(piece, { mutate: false }) as PolygonFeature
        );
      }
    } catch {
      // Fall back to the cleaned polygon below.
    }

    return [cleaned as PolygonFeature];
  }

  return cleaned.geometry.coordinates.flatMap((polygon) => {
    const polygonFeature = turf.cleanCoords(
      turf.polygon(polygon as RingCoordinate[][]),
      { mutate: false }
    ) as PolygonFeature;

    try {
      const unkinked = turf.unkinkPolygon(polygonFeature);
      if (unkinked.features.length > 0) {
        return unkinked.features.map(
          (piece) => turf.cleanCoords(piece, { mutate: false }) as PolygonFeature
        );
      }
    } catch {
      // Keep original polygon piece.
    }

    return [polygonFeature];
  });
}

function tryUnionAreaFeatures(first: AreaFeature, second: AreaFeature): AreaFeature | null {
  try {
    const forward = turf.union(
      turf.featureCollection<PolygonGeometry | MultiPolygonGeometry>([first, second])
    );
    if (forward) {
      return turf.cleanCoords(forward, { mutate: false }) as AreaFeature;
    }
  } catch {
    // Retry with reverse ordering below.
  }

  try {
    const reverse = turf.union(
      turf.featureCollection<PolygonGeometry | MultiPolygonGeometry>([second, first])
    );
    if (reverse) {
      return turf.cleanCoords(reverse, { mutate: false }) as AreaFeature;
    }
  } catch {
    // Keep both polygons when union fails in both directions.
  }

  return null;
}

function areaFeaturePolygons(feature: AreaFeature): RingCoordinate[][][] {
  if (feature.geometry.type === 'Polygon') {
    return [feature.geometry.coordinates as RingCoordinate[][]];
  }

  return feature.geometry.coordinates as RingCoordinate[][][];
}

function combineAreaFeatures(first: AreaFeature, second: AreaFeature): AreaFeature {
  const polygons = [
    ...areaFeaturePolygons(first),
    ...areaFeaturePolygons(second),
  ];

  if (polygons.length === 1) {
    return turf.polygon(polygons[0]) as PolygonFeature;
  }

  return turf.multiPolygon(polygons) as MultiPolygonFeature;
}

function unionPolygonFeaturesIncremental(features: PolygonFeature[]): AreaFeature | null {
  if (features.length === 0) {
    return null;
  }

  const normalizedInput = features.flatMap((feature) =>
    normalizePolygonFeaturesForUnion(feature as AreaFeature)
  );
  if (normalizedInput.length === 0) {
    return null;
  }

  let merged: AreaFeature = normalizedInput[0] as AreaFeature;

  for (let index = 1; index < normalizedInput.length; index += 1) {
    const unioned = tryUnionAreaFeatures(merged, normalizedInput[index] as AreaFeature);
    if (unioned) {
      merged = unioned;
    } else {
      merged = combineAreaFeatures(merged, normalizedInput[index] as AreaFeature);
    }
  }

  return merged;
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

function comparePointLex(a: Point2D, b: Point2D): number {
  if (a.x !== b.x) {
    return a.x - b.x;
  }
  return a.y - b.y;
}

function compareEndpointRefsDeterministic(a: WallEndpointRef, b: WallEndpointRef): number {
  if (a.angleDeg !== b.angleDeg) {
    return a.angleDeg - b.angleDeg;
  }

  const directionCmp = comparePointLex(a.direction, b.direction);
  if (directionCmp !== 0) {
    return directionCmp;
  }

  const leftCmp = comparePointLex(a.left.anchor, b.left.anchor);
  if (leftCmp !== 0) {
    return leftCmp;
  }

  const rightCmp = comparePointLex(a.right.anchor, b.right.anchor);
  if (rightCmp !== 0) {
    return rightCmp;
  }

  if (a.thickness !== b.thickness) {
    return a.thickness - b.thickness;
  }

  if (a.endpoint !== b.endpoint) {
    return a.endpoint === 'start' ? -1 : 1;
  }

  return a.key.localeCompare(b.key);
}

function buildEndpointNodes(walls: Wall[]): EndpointNode[] {
  const refs = walls.flatMap((wall) => [
    buildEndpointRef(wall, 'start'),
    buildEndpointRef(wall, 'end'),
  ]);
  const nodes: EndpointNode[] = [];
  const visited = new Array<boolean>(refs.length).fill(false);

  for (let index = 0; index < refs.length; index += 1) {
    if (visited[index]) {
      continue;
    }

    const queue: number[] = [index];
    const componentIndexes: number[] = [];
    visited[index] = true;

    while (queue.length > 0) {
      const currentIndex = queue.shift();
      if (currentIndex === undefined) {
        continue;
      }

      componentIndexes.push(currentIndex);
      for (let otherIndex = 0; otherIndex < refs.length; otherIndex += 1) {
        if (visited[otherIndex]) {
          continue;
        }
        if (pointDistance(refs[currentIndex].point, refs[otherIndex].point) <= COMPONENT_TOLERANCE_MM) {
          visited[otherIndex] = true;
          queue.push(otherIndex);
        }
      }
    }

    const componentRefs = componentIndexes
      .map((componentIndex) => refs[componentIndex])
      .sort(compareEndpointRefsDeterministic);
    const sum = componentRefs.reduce(
      (acc, ref) => ({
        x: acc.x + ref.point.x,
        y: acc.y + ref.point.y,
      }),
      { x: 0, y: 0 }
    );
    nodes.push({
      point: {
        x: sum.x / componentRefs.length,
        y: sum.y / componentRefs.length,
      },
      endpoints: componentRefs,
    });
  }

  return nodes.sort((a, b) => comparePointLex(a.point, b.point));
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

function sortedNodeEndpointsByAngle(node: EndpointNode): WallEndpointRef[] {
  return [...node.endpoints].sort(compareEndpointRefsDeterministic);
}

function clampNodePatchVertex(
  nodePoint: Point2D,
  rawVertex: Point2D,
  resolvedVertex: Point2D,
  thickness: number
): Point2D {
  const rawDistance = pointDistance(nodePoint, rawVertex);
  const resolvedDistance = pointDistance(nodePoint, resolvedVertex);
  const extensionLimit = Math.max(
    ACUTE_NODE_PATCH_MIN_EXTENSION_MM,
    Math.max(0, thickness) * ACUTE_NODE_PATCH_MAX_EXTENSION_FACTOR
  );
  const maxAllowedDistance = Math.max(
    rawDistance + extensionLimit,
    rawDistance + COORDINATE_TOLERANCE_MM
  );

  // Acute-node patch should not retreat inside the raw wall cap because that
  // creates center holes when many walls converge.
  if (resolvedDistance <= rawDistance + COORDINATE_TOLERANCE_MM) {
    return copyPoint(rawVertex);
  }

  if (resolvedDistance <= maxAllowedDistance + COORDINATE_TOLERANCE_MM) {
    return copyPoint(resolvedVertex);
  }

  const direction = normalize(subtract(resolvedVertex, nodePoint));
  if (Math.hypot(direction.x, direction.y) < 0.000001) {
    return copyPoint(rawVertex);
  }

  return add(nodePoint, scale(direction, maxAllowedDistance));
}

function endpointNodePatchCapVertices(
  endpointRef: WallEndpointRef,
  joinsMap: Map<string, JoinData[]>,
  nodePoint: Point2D
): { leftVertex: Point2D; rightVertex: Point2D } {
  const resolved = endpointResolvedCapVertices(endpointRef, joinsMap);
  const raw = endpointRawCapVertices(endpointRef);
  const rawSideVertices =
    endpointRef.endpoint === 'start'
      ? {
        leftVertex: raw.interiorVertex,
        rightVertex: raw.exteriorVertex,
      }
      : {
        leftVertex: raw.exteriorVertex,
        rightVertex: raw.interiorVertex,
      };

  return {
    leftVertex: clampNodePatchVertex(
      nodePoint,
      rawSideVertices.leftVertex,
      resolved.leftVertex,
      endpointRef.thickness
    ),
    rightVertex: clampNodePatchVertex(
      nodePoint,
      rawSideVertices.rightVertex,
      resolved.rightVertex,
      endpointRef.thickness
    ),
  };
}

function collapsePatchVerticesByAngle(nodePoint: Point2D, vertices: Point2D[]): Point2D[] {
  const bucketCount = Math.max(180, Math.round(360 / NODE_PATCH_ANGLE_MERGE_DEG));
  const buckets = new Map<number, { point: Point2D; angleDeg: number; distance: number }>();

  for (const vertex of vertices) {
    const distance = pointDistance(nodePoint, vertex);
    if (distance <= COORDINATE_TOLERANCE_MM) {
      continue;
    }

    const angleDeg = normalizeAngleDeg(
      Math.atan2(vertex.y - nodePoint.y, vertex.x - nodePoint.x) * (180 / Math.PI)
    );
    const bucket = ((Math.round((angleDeg / 360) * bucketCount) % bucketCount) + bucketCount) % bucketCount;
    const existing = buckets.get(bucket);
    if (!existing || distance < existing.distance) {
      buckets.set(bucket, {
        point: copyPoint(vertex),
        angleDeg,
        distance,
      });
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.angleDeg - b.angleDeg || a.distance - b.distance)
    .map((entry) => entry.point);
}

function simplifyPatchRingVertices(vertices: Point2D[]): Point2D[] {
  if (vertices.length < 3) {
    return vertices.map((vertex) => copyPoint(vertex));
  }

  let current = vertices.map((vertex) => copyPoint(vertex));
  let changed = true;

  while (changed && current.length > 3) {
    changed = false;
    const next: Point2D[] = [];

    for (let index = 0; index < current.length; index += 1) {
      const previous = current[(index - 1 + current.length) % current.length];
      const vertex = current[index];
      const after = current[(index + 1) % current.length];
      const prevEdgeLength = pointDistance(previous, vertex);
      const nextEdgeLength = pointDistance(vertex, after);

      if (prevEdgeLength < NODE_PATCH_MIN_EDGE_MM || nextEdgeLength < NODE_PATCH_MIN_EDGE_MM) {
        changed = true;
        continue;
      }

      const prevVector = subtract(vertex, previous);
      const nextVector = subtract(after, vertex);
      const denominator =
        Math.hypot(prevVector.x, prevVector.y) * Math.hypot(nextVector.x, nextVector.y);

      if (denominator > 0) {
        const sine =
          Math.abs(prevVector.x * nextVector.y - prevVector.y * nextVector.x) / denominator;
        if (sine < NODE_PATCH_COLLINEAR_SINE) {
          changed = true;
          continue;
        }
      }

      next.push(vertex);
    }

    if (next.length < 3 || next.length === current.length) {
      break;
    }

    current = next;
  }

  return current;
}

function convexHullPatchVertices(vertices: Point2D[]): Point2D[] {
  const sorted = [...vertices].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique: Point2D[] = [];

  for (const vertex of sorted) {
    if (!unique.some((candidate) => pointDistance(candidate, vertex) <= COORDINATE_TOLERANCE_MM)) {
      unique.push(copyPoint(vertex));
    }
  }

  if (unique.length <= 3) {
    return unique;
  }

  const cross = (origin: Point2D, a: Point2D, b: Point2D): number =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);

  const lower: Point2D[] = [];
  for (const vertex of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], vertex) <= 0) {
      lower.pop();
    }
    lower.push(vertex);
  }

  const upper: Point2D[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const vertex = unique[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], vertex) <= 0) {
      upper.pop();
    }
    upper.push(vertex);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function stableAcuteNodePatchRing(nodePoint: Point2D, vertices: Point2D[]): Point2D[] {
  const collapsed = collapsePatchVerticesByAngle(nodePoint, vertices);
  if (collapsed.length < 3) {
    return collapsed;
  }

  const simplified = simplifyPatchRingVertices(collapsed);
  if (simplified.length < 3) {
    return simplified;
  }

  if (!isPolygonSelfIntersecting(simplified)) {
    return simplified;
  }

  return convexHullPatchVertices(simplified);
}

function buildAcuteNodeHullPatchFeature(node: EndpointNode): PolygonFeature | null {
  if (node.endpoints.length < 2) {
    return null;
  }

  const rawVertices = node.endpoints.flatMap((endpointRef) => {
    const raw = endpointRawCapVertices(endpointRef);
    return endpointRef.endpoint === 'start'
      ? [raw.interiorVertex, raw.exteriorVertex]
      : [raw.exteriorVertex, raw.interiorVertex];
  });
  const uniqueVertices: Point2D[] = [];
  rawVertices.forEach((vertex) => {
    if (!uniqueVertices.some((candidate) => pointDistance(candidate, vertex) <= COORDINATE_TOLERANCE_MM)) {
      uniqueVertices.push(copyPoint(vertex));
    }
  });

  if (uniqueVertices.length < 3) {
    return null;
  }

  const hull = convexHullPatchVertices(uniqueVertices);
  if (hull.length < 3) {
    return null;
  }

  return patchPolygonFeature(hull, MIN_NODE_PATCH_AREA_MM2);
}

function buildAcuteNodeUnifiedPatchFeature(
  node: EndpointNode,
  joinsMap: Map<string, JoinData[]>
): PolygonFeature | null {
  const sortedEndpoints = sortedNodeEndpointsByAngle(node);
  if (sortedEndpoints.length < 2) {
    return null;
  }

  const patchVertices = sortedEndpoints.flatMap((endpointRef) => {
    const vertices = endpointNodePatchCapVertices(endpointRef, joinsMap, node.point);
    return [vertices.rightVertex, vertices.leftVertex];
  });
  const uniqueVertices: Point2D[] = [];
  patchVertices.forEach((vertex) => {
    if (!uniqueVertices.some((candidate) => pointDistance(candidate, vertex) <= COORDINATE_TOLERANCE_MM)) {
      uniqueVertices.push(copyPoint(vertex));
    }
  });

  if (uniqueVertices.length < 3) {
    return null;
  }

  const ring = stableAcuteNodePatchRing(node.point, uniqueVertices);
  if (ring.length < 3) {
    return null;
  }

  return patchPolygonFeature(ring, MIN_NODE_PATCH_AREA_MM2);
}

function shouldUseAcuteNodePatch(
  node: EndpointNode,
  joinsMap: Map<string, JoinData[]>
): boolean {
  return node.endpoints.some((endpointRef) => {
    const join = endpointJoinForRef(endpointRef, joinsMap);
    return Boolean(join && (join.joinType === 'bevel' || join.angle < 30));
  });
}

function endpointCapVerticesForUnion(
  endpointRef: WallEndpointRef,
  joinsMap: Map<string, JoinData[]>,
  acuteEndpointCaps: Map<string, { interiorVertex: Point2D; exteriorVertex: Point2D }>
): { interiorVertex: Point2D; exteriorVertex: Point2D } {
  const acuteCap = acuteEndpointCaps.get(endpointRef.key);
  if (acuteCap) {
    return {
      interiorVertex: copyPoint(acuteCap.interiorVertex),
      exteriorVertex: copyPoint(acuteCap.exteriorVertex),
    };
  }

  const resolved = endpointResolvedCapVertices(endpointRef, joinsMap);
  return endpointRef.endpoint === 'start'
    ? {
      interiorVertex: resolved.leftVertex,
      exteriorVertex: resolved.rightVertex,
    }
    : {
      interiorVertex: resolved.rightVertex,
      exteriorVertex: resolved.leftVertex,
    };
}

function buildAcuteEndpointCapMap(
  walls: Wall[],
  joinsMap: Map<string, JoinData[]>
): Map<string, { interiorVertex: Point2D; exteriorVertex: Point2D }> {
  const caps = new Map<string, { interiorVertex: Point2D; exteriorVertex: Point2D }>();
  const nodes = buildEndpointNodes(walls);

  for (const node of nodes) {
    if (node.endpoints.length < 2 || !shouldUseAcuteNodePatch(node, joinsMap)) {
      continue;
    }

    for (const endpointRef of node.endpoints) {
      const raw = endpointRawCapVertices(endpointRef);
      caps.set(endpointRef.key, {
        interiorVertex: copyPoint(raw.interiorVertex),
        exteriorVertex: copyPoint(raw.exteriorVertex),
      });
    }
  }

  return caps;
}

function buildAcuteNodeHoleGuards(
  walls: Wall[],
  joinsMap: Map<string, JoinData[]>
): NodeHoleGuard[] {
  const nodes = buildEndpointNodes(walls);

  return nodes
    .filter((node) => node.endpoints.length >= 2 && shouldUseAcuteNodePatch(node, joinsMap))
    .map((node) => {
      const minThickness = Math.min(...node.endpoints.map((endpoint) => Math.max(0, endpoint.thickness)));
      const centerPatchRadius = Math.max(
        ACUTE_NODE_CENTER_PATCH_MIN_RADIUS_MM,
        minThickness * ACUTE_NODE_CENTER_PATCH_RADIUS_FACTOR
      );
      const radius = Math.min(
        ACUTE_NODE_HOLE_GUARD_MAX_RADIUS_MM,
        centerPatchRadius * ACUTE_NODE_HOLE_GUARD_RADIUS_FACTOR + ACUTE_NODE_HOLE_GUARD_RADIUS_PADDING_MM
      );
      const maxHoleArea = Math.min(
        ACUTE_NODE_HOLE_GUARD_MAX_AREA_MM2,
        Math.max(MIN_RENDER_HOLE_AREA_MM2 * 2, Math.PI * radius * radius * 1.25)
      );

      return {
        point: copyPoint(node.point),
        radius,
        maxHoleArea,
      };
    });
}

function wallPolygonFeatureForUnion(
  wall: Wall,
  joinsMap: Map<string, JoinData[]>,
  acuteEndpointCaps: Map<string, { interiorVertex: Point2D; exteriorVertex: Point2D }>
): PolygonFeature | null {
  const startRef = buildEndpointRef(wall, 'start');
  const endRef = buildEndpointRef(wall, 'end');
  const startCap = endpointCapVerticesForUnion(startRef, joinsMap, acuteEndpointCaps);
  const endCap = endpointCapVerticesForUnion(endRef, joinsMap, acuteEndpointCaps);
  const stablePolygon = makePolygonFeature([
    startCap.interiorVertex,
    endCap.interiorVertex,
    endCap.exteriorVertex,
    startCap.exteriorVertex,
  ]);

  if (stablePolygon) {
    return stablePolygon;
  }

  return wallPolygonFeature(wall, joinsMap.get(wall.id));
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

    if (shouldUseAcuteNodePatch(node, joinsMap)) {
      const hullPatch = buildAcuteNodeHullPatchFeature(node);
      if (hullPatch) {
        features.push(hullPatch);
      } else {
        const nodePatch = buildAcuteNodeUnifiedPatchFeature(node, joinsMap);
        if (nodePatch) {
          features.push(nodePatch);
        }
      }
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

function featureUnionPolygons(
  features: PolygonFeature[],
  holeGuards: NodeHoleGuard[] = []
): Point2D[][][] {
  if (features.length === 0) {
    return [];
  }

  if (features.length === 1) {
    return suppressAcuteNodeHoleArtifacts(
      [features[0].geometry.coordinates.map(openRing)],
      holeGuards
    );
  }

  const merged = unionPolygonFeaturesIncremental(features);
  if (!merged) {
    return [];
  }

  return suppressAcuteNodeHoleArtifacts(extractPolygons(merged.geometry), holeGuards);
}

function unionWallComponent(
  walls: Wall[],
  joinsMap: Map<string, JoinData[]>
): { polygons: Point2D[][][]; junctionOverlays: Point2D[][][] } {
  if (walls.length === 0) {
    return { polygons: [], junctionOverlays: [] };
  }

  const acuteEndpointCaps = buildAcuteEndpointCapMap(walls, joinsMap);
  const acuteNodeHoleGuards = buildAcuteNodeHoleGuards(walls, joinsMap);
  const features = [
    ...walls.flatMap((wall) => {
      const feature = wallPolygonFeatureForUnion(wall, joinsMap, acuteEndpointCaps);
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
    polygons: featureUnionPolygons(features, acuteNodeHoleGuards),
    junctionOverlays: featureUnionPolygons(overlayFeatures, acuteNodeHoleGuards),
  };
}

export function computeWallUnionRenderData(
  walls: Wall[],
  precomputedJoinsMap?: Map<string, JoinData[]>
): WallUnionRenderData {
  const joinsMap = precomputedJoinsMap ?? computeWallJoinMap(walls);
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]));
  const components = buildConnectedComponents(walls, joinsMap)
    .map((wallIds, index) => {
      const componentWalls = wallIds
        .map((wallId) => wallsById.get(wallId))
        .filter((wall): wall is Wall => Boolean(wall));

      return {
        id: `wall-component-${index}`,
        wallIds,
        ...unionWallComponent(componentWalls, joinsMap),
      };
    })
    .filter((component) => component.polygons.length > 0 || component.junctionOverlays.length > 0);

  return {
    joinsMap,
    components,
  };
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
