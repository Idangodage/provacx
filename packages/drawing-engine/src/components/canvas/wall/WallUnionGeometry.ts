import * as turf from '@turf/turf';

import type { JoinData, Point2D, Wall } from '../../../types';

import { computeWallBodyPolygon, computeWallPolygon } from './WallGeometry';
import { computeWallJoinMap } from './WallJoinNetwork';

const COMPONENT_TOLERANCE_MM = 2;
const COORDINATE_TOLERANCE_MM = 0.001;
const MIN_PATCH_AREA_MM2 = 0.1;

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

function wallPolygonFeature(wall: Wall, joins?: JoinData[]): PolygonFeature {
  return turf.polygon([closeRing(computeWallPolygon(wall, joins))]);
}

function patchPolygonFeature(vertices: Point2D[]): PolygonFeature | null {
  const ring = normalizeRing(vertices);
  if (ring.length < 3 || Math.abs(polygonArea(ring)) < MIN_PATCH_AREA_MM2) {
    return null;
  }

  return turf.polygon([closeRing(ring)]);
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

  for (const wall of walls) {
    graph.set(wall.id, new Set());
  }

  for (const wall of walls) {
    for (const connectedWallId of wall.connectedWalls) {
      if (graph.has(connectedWallId)) {
        addGraphEdge(graph, wall.id, connectedWallId);
      }
    }
  }

  joinsMap.forEach((joins, wallId) => {
    for (const join of joins) {
      if (graph.has(wallId) && graph.has(join.otherWallId)) {
        addGraphEdge(graph, wallId, join.otherWallId);
      }
    }
  });

  for (let index = 0; index < walls.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < walls.length; otherIndex += 1) {
      if (wallsTouch(walls[index], walls[otherIndex])) {
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
    ...walls.map((wall) => wallPolygonFeature(wall, joinsMap.get(wall.id))),
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

export function computeWallUnionRenderData(walls: Wall[]): WallUnionRenderData {
  const joinsMap = computeWallJoinMap(walls);
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
