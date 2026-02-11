/**
 * Wall Orientation Utilities
 *
 * Computes wall relationship graph + interior/exterior orientation metadata.
 * Keeps geometry logic isolated from rendering to avoid code smell.
 */

import type { Point2D, Wall2D } from '../types';

export type WallSide = 'left' | 'right';
export type WallOrientationSource = 'auto-cycle' | 'auto-chain' | 'manual';

export interface WallOrientationNode {
  key: string;
  point: Point2D;
  wallIds: string[];
}

export interface WallOrientationComponent {
  id: string;
  wallIds: string[];
  nodeKeys: string[];
  isClosed: boolean;
  winding: 'clockwise' | 'counter-clockwise' | 'open';
  crossSum: number;
}

export interface WallOrientationGraph {
  nodes: WallOrientationNode[];
  components: WallOrientationComponent[];
}

export interface WallOrientationData {
  wallId: string;
  componentId: string;
  interiorSide: WallSide;
  exteriorSide: WallSide;
  interiorNormal: Point2D;
  exteriorNormal: Point2D;
  source: WallOrientationSource;
  confidence: number;
}

export interface WallOrientationComputeResult {
  byWallId: Map<string, WallOrientationData>;
  graph: WallOrientationGraph;
}

export interface WallOrientationOptions {
  nodeTolerancePx?: number;
  defaultInteriorSideForOpenChains?: WallSide;
  probeOffsetPx?: number;
}

interface RuntimeNode {
  key: string;
  sx: number;
  sy: number;
  count: number;
  wallIds: Set<string>;
}

interface RuntimeEdge {
  wallId: string;
  startKey: string;
  endKey: string;
}

interface RuntimeGraph {
  nodes: Map<string, RuntimeNode>;
  nodePointByKey: Map<string, Point2D>;
  edgesByWallId: Map<string, RuntimeEdge>;
}

const DEFAULT_NODE_TOLERANCE_PX = 0.5;
const DEFAULT_INTERIOR_SIDE: WallSide = 'right';
const DEFAULT_PROBE_OFFSET_PX = 6;
const EPSILON = 1e-8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNodeKey(point: Point2D, tolerance: number): string {
  const safeTolerance = Math.max(tolerance, 0.0001);
  const gx = Math.round(point.x / safeTolerance);
  const gy = Math.round(point.y / safeTolerance);
  return `${gx}:${gy}`;
}

function normalize(vector: Point2D): Point2D | null {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= EPSILON) return null;
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

function flipSide(side: WallSide): WallSide {
  return side === 'left' ? 'right' : 'left';
}

function sideToNormal(direction: Point2D, side: WallSide): Point2D {
  // Canvas uses screen coordinates (Y grows downward), so geometric "right"
  // is a clockwise normal and "left" is counter-clockwise in this space.
  const right = { x: -direction.y, y: direction.x };
  const left = { x: direction.y, y: -direction.x };
  return side === 'left' ? left : right;
}

function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;
    const intersects =
      (pi.y > point.y) !== (pj.y > point.y) &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + Number.EPSILON) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function signedArea(polygon: Point2D[]): number {
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    if (!current || !next) continue;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function buildRuntimeGraph(walls: Wall2D[], tolerance: number): RuntimeGraph {
  const nodes = new Map<string, RuntimeNode>();
  const edgesByWallId = new Map<string, RuntimeEdge>();

  walls.forEach((wall) => {
    const startKey = toNodeKey(wall.start, tolerance);
    const endKey = toNodeKey(wall.end, tolerance);
    if (startKey === endKey) return;

    const startNode = nodes.get(startKey) ?? {
      key: startKey,
      sx: 0,
      sy: 0,
      count: 0,
      wallIds: new Set<string>(),
    };
    startNode.sx += wall.start.x;
    startNode.sy += wall.start.y;
    startNode.count += 1;
    startNode.wallIds.add(wall.id);
    nodes.set(startKey, startNode);

    const endNode = nodes.get(endKey) ?? {
      key: endKey,
      sx: 0,
      sy: 0,
      count: 0,
      wallIds: new Set<string>(),
    };
    endNode.sx += wall.end.x;
    endNode.sy += wall.end.y;
    endNode.count += 1;
    endNode.wallIds.add(wall.id);
    nodes.set(endKey, endNode);

    edgesByWallId.set(wall.id, {
      wallId: wall.id,
      startKey,
      endKey,
    });
  });

  const nodePointByKey = new Map<string, Point2D>();
  nodes.forEach((node, key) => {
    nodePointByKey.set(key, {
      x: node.sx / Math.max(node.count, 1),
      y: node.sy / Math.max(node.count, 1),
    });
  });

  return { nodes, nodePointByKey, edgesByWallId };
}

function getComponentWallIds(
  seedWallId: string,
  edgesByWallId: Map<string, RuntimeEdge>,
  nodeByKey: Map<string, RuntimeNode>,
  visited: Set<string>
): string[] {
  const queue = [seedWallId];
  const component: string[] = [];

  while (queue.length > 0) {
    const wallId = queue.shift();
    if (!wallId || visited.has(wallId)) continue;
    visited.add(wallId);
    component.push(wallId);

    const edge = edgesByWallId.get(wallId);
    if (!edge) continue;
    const startWalls = nodeByKey.get(edge.startKey)?.wallIds ?? new Set<string>();
    const endWalls = nodeByKey.get(edge.endKey)?.wallIds ?? new Set<string>();
    [...startWalls, ...endWalls].forEach((neighborWallId) => {
      if (!visited.has(neighborWallId)) {
        queue.push(neighborWallId);
      }
    });
  }

  return component;
}

function buildNodeDegreeMap(componentWallIds: string[], edgesByWallId: Map<string, RuntimeEdge>): Map<string, number> {
  const degreeMap = new Map<string, number>();
  componentWallIds.forEach((wallId) => {
    const edge = edgesByWallId.get(wallId);
    if (!edge) return;
    degreeMap.set(edge.startKey, (degreeMap.get(edge.startKey) ?? 0) + 1);
    degreeMap.set(edge.endKey, (degreeMap.get(edge.endKey) ?? 0) + 1);
  });
  return degreeMap;
}

function adjacencyForComponent(componentWallIds: string[], edgesByWallId: Map<string, RuntimeEdge>): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  componentWallIds.forEach((wallId) => {
    const edge = edgesByWallId.get(wallId);
    if (!edge) return;
    const startList = adjacency.get(edge.startKey) ?? [];
    startList.push(wallId);
    adjacency.set(edge.startKey, startList);
    const endList = adjacency.get(edge.endKey) ?? [];
    endList.push(wallId);
    adjacency.set(edge.endKey, endList);
  });
  return adjacency;
}

function orderClosedCycle(componentWallIds: string[], edgesByWallId: Map<string, RuntimeEdge>, degreeMap: Map<string, number>): {
  nodeOrder: string[];
  wallOrder: string[];
} | null {
  if (componentWallIds.length < 3) return null;
  if (Array.from(degreeMap.values()).some((degree) => degree !== 2)) return null;

  const adjacency = adjacencyForComponent(componentWallIds, edgesByWallId);
  const startWallId = componentWallIds[0];
  const startEdge = startWallId ? edgesByWallId.get(startWallId) : null;
  if (!startWallId || !startEdge) return null;

  const startNode = startEdge.startKey;
  const nodeOrder: string[] = [startNode];
  const wallOrder: string[] = [];

  let currentNode = startNode;
  let currentWallId = startWallId;
  let previousWallId: string | null = null;
  const maxSteps = componentWallIds.length + 4;

  for (let step = 0; step < maxSteps; step += 1) {
    const currentEdge = edgesByWallId.get(currentWallId);
    if (!currentEdge) return null;
    wallOrder.push(currentWallId);

    const nextNode = currentEdge.startKey === currentNode ? currentEdge.endKey : currentEdge.startKey;
    nodeOrder.push(nextNode);

    if (nextNode === startNode) {
      if (wallOrder.length !== componentWallIds.length) return null;
      return { nodeOrder, wallOrder };
    }

    const incidentWalls = adjacency.get(nextNode) ?? [];
    const candidate = incidentWalls.find((wallId) => wallId !== currentWallId && wallId !== previousWallId);
    if (!candidate) return null;
    previousWallId = currentWallId;
    currentWallId = candidate;
    currentNode = nextNode;
  }

  return null;
}

function orderOpenChain(componentWallIds: string[], edgesByWallId: Map<string, RuntimeEdge>, degreeMap: Map<string, number>): {
  nodeOrder: string[];
  wallOrder: string[];
} | null {
  const endpoints = Array.from(degreeMap.entries()).filter(([, degree]) => degree === 1).map(([key]) => key);
  if (endpoints.length !== 2) return null;
  if (Array.from(degreeMap.values()).some((degree) => degree > 2)) return null;

  const startNode = endpoints[0];
  if (!startNode) return null;
  const adjacency = adjacencyForComponent(componentWallIds, edgesByWallId);
  const nodeOrder: string[] = [startNode];
  const wallOrder: string[] = [];

  let currentNode = startNode;
  let previousWallId: string | null = null;
  let previousNode: string | null = null;
  const maxSteps = componentWallIds.length + 4;

  for (let step = 0; step < maxSteps; step += 1) {
    const incidentWalls = adjacency.get(currentNode) ?? [];
    const nextWallId = incidentWalls.find((wallId) => wallId !== previousWallId);
    if (!nextWallId) break;
    wallOrder.push(nextWallId);
    const edge = edgesByWallId.get(nextWallId);
    if (!edge) return null;
    const nextNode = edge.startKey === currentNode ? edge.endKey : edge.startKey;
    nodeOrder.push(nextNode);
    previousWallId = nextWallId;
    previousNode = currentNode;
    currentNode = nextNode;

    const isTerminal = (adjacency.get(currentNode)?.length ?? 0) <= 1;
    if (isTerminal && previousNode !== null) {
      break;
    }
  }

  if (wallOrder.length !== componentWallIds.length) return null;
  return { nodeOrder, wallOrder };
}

function chooseCycleInteriorSide(
  segmentStart: Point2D,
  segmentEnd: Point2D,
  polygon: Point2D[],
  fallback: WallSide,
  probeOffsetPx: number
): WallSide {
  const direction = normalize({ x: segmentEnd.x - segmentStart.x, y: segmentEnd.y - segmentStart.y });
  if (!direction) return fallback;
  const midpoint = {
    x: (segmentStart.x + segmentEnd.x) / 2,
    y: (segmentStart.y + segmentEnd.y) / 2,
  };
  const leftNormal = sideToNormal(direction, 'left');
  const rightNormal = sideToNormal(direction, 'right');
  const leftProbe = {
    x: midpoint.x + leftNormal.x * probeOffsetPx,
    y: midpoint.y + leftNormal.y * probeOffsetPx,
  };
  const rightProbe = {
    x: midpoint.x + rightNormal.x * probeOffsetPx,
    y: midpoint.y + rightNormal.y * probeOffsetPx,
  };
  const leftInside = isPointInPolygon(leftProbe, polygon);
  const rightInside = isPointInPolygon(rightProbe, polygon);
  if (leftInside !== rightInside) {
    return leftInside ? 'left' : 'right';
  }
  return fallback;
}

function createOrientationData(
  wall: Wall2D,
  componentId: string,
  interiorSide: WallSide,
  source: WallOrientationSource
): WallOrientationData | null {
  const direction = normalize({
    x: wall.end.x - wall.start.x,
    y: wall.end.y - wall.start.y,
  });
  if (!direction) return null;
  const interiorNormal = sideToNormal(direction, interiorSide);
  const exteriorSide = flipSide(interiorSide);
  const exteriorNormal = sideToNormal(direction, exteriorSide);
  return {
    wallId: wall.id,
    componentId,
    interiorSide,
    exteriorSide,
    interiorNormal,
    exteriorNormal,
    source,
    confidence: source === 'manual' ? 1 : 0.85,
  };
}

function orientationForOrderedComponent(
  wallsById: Map<string, Wall2D>,
  nodePointByKey: Map<string, Point2D>,
  componentId: string,
  nodeOrder: string[],
  wallOrder: string[],
  isClosed: boolean,
  options: Required<WallOrientationOptions>
): {
  byWallId: Map<string, WallOrientationData>;
  winding: WallOrientationComponent['winding'];
  crossSum: number;
} {
  const byWallId = new Map<string, WallOrientationData>();
  const vectors: Point2D[] = [];
  for (let i = 0; i < wallOrder.length; i += 1) {
    const start = nodePointByKey.get(nodeOrder[i] ?? '');
    const end = nodePointByKey.get(nodeOrder[i + 1] ?? '');
    if (!start || !end) continue;
    const direction = normalize({ x: end.x - start.x, y: end.y - start.y });
    if (!direction) continue;
    vectors.push(direction);
  }

  const crosses: number[] = [];
  for (let i = 0; i < vectors.length - 1; i += 1) {
    const a = vectors[i];
    const b = vectors[i + 1];
    if (!a || !b) continue;
    crosses.push(cross(a, b));
  }
  const crossSum = crosses.reduce((sum, value) => sum + value, 0);

  let winding: WallOrientationComponent['winding'] = 'open';
  if (isClosed) {
    const polygon = nodeOrder
      .slice(0, Math.max(0, nodeOrder.length - 1))
      .map((nodeKey) => nodePointByKey.get(nodeKey))
      .filter((point): point is Point2D => Boolean(point));
    const area = signedArea(polygon);
    winding = area >= 0 ? 'clockwise' : 'counter-clockwise';
  }

  const fallbackCycleInterior: WallSide = winding === 'counter-clockwise' ? 'left' : 'right';
  // For open chains, keep one consistent interior side across the component.
  // Using accumulated cross sum can flip orientation while the user is still drawing,
  // which causes temporary corner/offset jumps. First meaningful turn is more stable.
  const firstTurn = crosses.find((value) => Math.abs(value) > EPSILON);
  const fallbackChainInterior: WallSide =
    firstTurn === undefined
      ? options.defaultInteriorSideForOpenChains
      : firstTurn > 0
        ? 'right'
        : 'left';

  for (let i = 0; i < wallOrder.length; i += 1) {
    const wallId = wallOrder[i];
    if (!wallId) continue;
    const wall = wallsById.get(wallId);
    if (!wall) continue;

    const traversalStart = nodePointByKey.get(nodeOrder[i] ?? '');
    const traversalEnd = nodePointByKey.get(nodeOrder[i + 1] ?? '');
    if (!traversalStart || !traversalEnd) continue;

    let interiorInTraversal: WallSide;
    let source: WallOrientationSource = isClosed ? 'auto-cycle' : 'auto-chain';

    if (wall.interiorSideOverride) {
      interiorInTraversal = wall.interiorSideOverride;
      source = 'manual';
    } else if (isClosed) {
      const polygon = nodeOrder
        .slice(0, Math.max(0, nodeOrder.length - 1))
        .map((nodeKey) => nodePointByKey.get(nodeKey))
        .filter((point): point is Point2D => Boolean(point));
      interiorInTraversal = chooseCycleInteriorSide(
        traversalStart,
        traversalEnd,
        polygon,
        fallbackCycleInterior,
        options.probeOffsetPx
      );
    } else {
      // Open-chain components use a single side selection for all segments to
      // avoid per-segment side flips before polygon closure.
      interiorInTraversal = fallbackChainInterior;
    }

    const traversalDirection = normalize({
      x: traversalEnd.x - traversalStart.x,
      y: traversalEnd.y - traversalStart.y,
    });
    const wallDirection = normalize({ x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y });
    if (!traversalDirection || !wallDirection) continue;

    const sameDirection = traversalDirection.x * wallDirection.x + traversalDirection.y * wallDirection.y >= 0;
    const interiorForWall = sameDirection ? interiorInTraversal : flipSide(interiorInTraversal);
    const orientation = createOrientationData(wall, componentId, interiorForWall, source);
    if (!orientation) continue;
    byWallId.set(wall.id, orientation);
  }

  return { byWallId, winding, crossSum };
}

export function computeWallOrientation(
  walls: Wall2D[],
  options: WallOrientationOptions = {}
): WallOrientationComputeResult {
  const resolvedOptions: Required<WallOrientationOptions> = {
    nodeTolerancePx: clamp(options.nodeTolerancePx ?? DEFAULT_NODE_TOLERANCE_PX, 0.05, 20),
    defaultInteriorSideForOpenChains: options.defaultInteriorSideForOpenChains ?? DEFAULT_INTERIOR_SIDE,
    probeOffsetPx: clamp(options.probeOffsetPx ?? DEFAULT_PROBE_OFFSET_PX, 1, 100),
  };

  if (walls.length === 0) {
    return { byWallId: new Map<string, WallOrientationData>(), graph: { nodes: [], components: [] } };
  }

  const runtime = buildRuntimeGraph(walls, resolvedOptions.nodeTolerancePx);
  const wallsById = new Map(walls.map((wall) => [wall.id, wall]));
  const visited = new Set<string>();
  const byWallId = new Map<string, WallOrientationData>();
  const components: WallOrientationComponent[] = [];

  let componentCounter = 1;
  runtime.edgesByWallId.forEach((_edge, wallId) => {
    if (visited.has(wallId)) return;
    const componentWallIds = getComponentWallIds(wallId, runtime.edgesByWallId, runtime.nodes, visited);
    if (componentWallIds.length === 0) return;

    const degreeMap = buildNodeDegreeMap(componentWallIds, runtime.edgesByWallId);
    const componentNodeKeys = Array.from(degreeMap.keys());
    const isClosed = componentWallIds.length >= 3 && Array.from(degreeMap.values()).every((degree) => degree === 2);
    const ordered = isClosed
      ? orderClosedCycle(componentWallIds, runtime.edgesByWallId, degreeMap)
      : orderOpenChain(componentWallIds, runtime.edgesByWallId, degreeMap);
    const componentId = `orientation-component-${componentCounter++}`;

    if (!ordered) {
      componentWallIds.forEach((componentWallId) => {
        const wall = wallsById.get(componentWallId);
        if (!wall) return;
        const interiorSide = wall.interiorSideOverride ?? resolvedOptions.defaultInteriorSideForOpenChains;
        const source: WallOrientationSource = wall.interiorSideOverride ? 'manual' : 'auto-chain';
        const orientation = createOrientationData(wall, componentId, interiorSide, source);
        if (!orientation) return;
        byWallId.set(componentWallId, orientation);
      });
      components.push({
        id: componentId,
        wallIds: componentWallIds,
        nodeKeys: componentNodeKeys,
        isClosed: false,
        winding: 'open',
        crossSum: 0,
      });
      return;
    }

    const oriented = orientationForOrderedComponent(
      wallsById,
      runtime.nodePointByKey,
      componentId,
      ordered.nodeOrder,
      ordered.wallOrder,
      isClosed,
      resolvedOptions
    );
    oriented.byWallId.forEach((value, key) => byWallId.set(key, value));
    components.push({
      id: componentId,
      wallIds: componentWallIds,
      nodeKeys: componentNodeKeys,
      isClosed,
      winding: oriented.winding,
      crossSum: oriented.crossSum,
    });
  });

  const nodes: WallOrientationNode[] = Array.from(runtime.nodes.values()).map((node) => ({
    key: node.key,
    point: {
      x: node.sx / Math.max(node.count, 1),
      y: node.sy / Math.max(node.count, 1),
    },
    wallIds: Array.from(node.wallIds),
  }));

  return {
    byWallId,
    graph: {
      nodes,
      components,
    },
  };
}

export function applyWallOrientationMetadata(
  walls: Wall2D[],
  options: WallOrientationOptions = {}
): Wall2D[] {
  const orientation = computeWallOrientation(walls, options);
  return walls.map((wall) => {
    const data = orientation.byWallId.get(wall.id);
    if (!data) return wall;
    const midpoint = {
      x: (wall.start.x + wall.end.x) / 2,
      y: (wall.start.y + wall.end.y) / 2,
    };
    return {
      ...wall,
      interiorSide: data.interiorSide,
      exteriorSide: data.exteriorSide,
      interiorNormal: data.interiorNormal,
      exteriorNormal: data.exteriorNormal,
      orientationSource: data.source,
      orientationComponentId: data.componentId,
      dimensionAnchor: {
        x: midpoint.x + data.exteriorNormal.x,
        y: midpoint.y + data.exteriorNormal.y,
      },
    };
  });
}

export function flipWallInteriorExteriorOverride(wall: Wall2D): Wall2D {
  const base = wall.interiorSideOverride ?? wall.interiorSide ?? DEFAULT_INTERIOR_SIDE;
  return {
    ...wall,
    interiorSideOverride: flipSide(base),
  };
}
