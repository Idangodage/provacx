/**
 * Room Detection Utilities
 *
 * Detects minimal enclosed wall loops from a wall centerline graph and
 * maps them to Room2D objects.
 */

import type { Point2D, Room2D, Wall2D } from '../types';
import { generateId } from './geometry';

const NODE_SNAP_TOLERANCE_PX = 0.5;
const MIN_ROOM_AREA_PX2 = 4;
const PX_TO_MM = 25.4 / 96;
const PX_TO_M = PX_TO_MM / 1000;

interface GraphNodeAccumulator {
  id: string;
  sx: number;
  sy: number;
  count: number;
}

interface GraphNode {
  id: string;
  point: Point2D;
}

interface GraphEdge {
  wallId: string;
  from: string;
  to: string;
}

interface HalfEdge {
  id: string;
  reverseId: string;
  wallId: string;
  from: string;
  to: string;
  angle: number;
}

interface DetectedFace {
  wallIdsOrdered: string[];
  vertices: Point2D[];
  signedAreaPx2: number;
  areaM2: number;
  perimeterM: number;
  centroid: Point2D;
}

interface GraphBuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function detectRoomsFromWallGraph(walls: Wall2D[], previousRooms: Room2D[] = []): Room2D[] {
  if (walls.length < 3) return [];

  const graph = buildWallGraph(walls, NODE_SNAP_TOLERANCE_PX);
  if (graph.edges.length < 3) return [];

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, HalfEdge[]>();
  const halfEdges: HalfEdge[] = [];

  graph.edges.forEach((edge) => {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) return;

    const forwardId = `${edge.wallId}::f`;
    const reverseId = `${edge.wallId}::r`;
    const forward: HalfEdge = {
      id: forwardId,
      reverseId,
      wallId: edge.wallId,
      from: edge.from,
      to: edge.to,
      angle: Math.atan2(toNode.point.y - fromNode.point.y, toNode.point.x - fromNode.point.x),
    };
    const reverse: HalfEdge = {
      id: reverseId,
      reverseId: forwardId,
      wallId: edge.wallId,
      from: edge.to,
      to: edge.from,
      angle: Math.atan2(fromNode.point.y - toNode.point.y, fromNode.point.x - toNode.point.x),
    };

    halfEdges.push(forward, reverse);
    const fromList = adjacency.get(forward.from) ?? [];
    fromList.push(forward);
    adjacency.set(forward.from, fromList);

    const toList = adjacency.get(reverse.from) ?? [];
    toList.push(reverse);
    adjacency.set(reverse.from, toList);
  });

  adjacency.forEach((edgesAtNode) => {
    edgesAtNode.sort((a, b) => a.angle - b.angle);
  });

  const visited = new Set<string>();
  const faces: DetectedFace[] = [];

  halfEdges.forEach((startEdge) => {
    if (visited.has(startEdge.id)) return;

    const traced = traceFace(startEdge, adjacency, visited);
    if (!traced || traced.length < 3) return;

    const vertices = traced
      .map((edge) => nodeById.get(edge.from)?.point)
      .filter((point): point is Point2D => Boolean(point));
    const normalizedVertices = normalizePolygonVertices(vertices);
    if (normalizedVertices.length < 3) return;

    const signedAreaPx2 = calculateSignedArea(normalizedVertices);
    if (signedAreaPx2 <= MIN_ROOM_AREA_PX2) return;

    const wallIdsOrdered = normalizeWallSequence(traced.map((edge) => edge.wallId));
    if (wallIdsOrdered.length < 3) return;

    const areaM2 = signedAreaPx2 * PX_TO_M * PX_TO_M;
    const perimeterM = calculatePerimeter(normalizedVertices) * PX_TO_M;
    const centroid = calculatePolygonCentroid(normalizedVertices);

    faces.push({
      wallIdsOrdered,
      vertices: normalizedVertices,
      signedAreaPx2,
      areaM2,
      perimeterM,
      centroid,
    });
  });

  if (faces.length === 0) return [];

  const dedupedFaces = dedupeFaces(faces);
  if (dedupedFaces.length === 0) return [];

  dedupedFaces.sort((a, b) => {
    if (Math.abs(a.centroid.y - b.centroid.y) > 1e-6) return a.centroid.y - b.centroid.y;
    return a.centroid.x - b.centroid.x;
  });

  return mapFacesToRooms(dedupedFaces, previousRooms);
}

function buildWallGraph(walls: Wall2D[], snapTolerancePx: number): GraphBuildResult {
  const nodeByKey = new Map<string, GraphNodeAccumulator>();
  const edges: GraphEdge[] = [];

  const getNodeId = (point: Point2D): string => {
    const key = pointToGridKey(point, snapTolerancePx);
    const existing = nodeByKey.get(key);
    if (existing) {
      existing.sx += point.x;
      existing.sy += point.y;
      existing.count += 1;
      return existing.id;
    }
    const id = `n:${key}`;
    nodeByKey.set(key, { id, sx: point.x, sy: point.y, count: 1 });
    return id;
  };

  walls.forEach((wall) => {
    const fromId = getNodeId(wall.start);
    const toId = getNodeId(wall.end);
    if (fromId === toId) return;
    edges.push({
      wallId: wall.id,
      from: fromId,
      to: toId,
    });
  });

  const nodes: GraphNode[] = Array.from(nodeByKey.values()).map((acc) => ({
    id: acc.id,
    point: {
      x: acc.sx / acc.count,
      y: acc.sy / acc.count,
    },
  }));

  return { nodes, edges };
}

function pointToGridKey(point: Point2D, step: number): string {
  const safeStep = Math.max(step, 0.0001);
  const gx = Math.round(point.x / safeStep);
  const gy = Math.round(point.y / safeStep);
  return `${gx}:${gy}`;
}

function traceFace(
  startEdge: HalfEdge,
  adjacency: Map<string, HalfEdge[]>,
  visited: Set<string>
): HalfEdge[] | null {
  const faceEdges: HalfEdge[] = [];
  const localSeen = new Set<string>();
  let current = startEdge;
  const maxSteps = 2048;

  for (let step = 0; step < maxSteps; step++) {
    if (localSeen.has(current.id)) {
      if (current.id === startEdge.id) break;
      return null;
    }

    localSeen.add(current.id);
    faceEdges.push(current);

    const outgoing = adjacency.get(current.to);
    if (!outgoing || outgoing.length === 0) return null;

    const reverseIndex = outgoing.findIndex((edge) => edge.id === current.reverseId);
    if (reverseIndex < 0) return null;

    const nextIndex = (reverseIndex - 1 + outgoing.length) % outgoing.length;
    const nextEdge = outgoing[nextIndex];
    if (!nextEdge) return null;

    current = nextEdge;
    if (current.id === startEdge.id) break;
  }

  if (current.id !== startEdge.id) return null;

  faceEdges.forEach((edge) => visited.add(edge.id));
  return faceEdges;
}

function normalizePolygonVertices(vertices: Point2D[]): Point2D[] {
  if (vertices.length === 0) return [];
  const cleaned: Point2D[] = [];
  const epsilon = 1e-6;

  vertices.forEach((vertex) => {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || Math.abs(prev.x - vertex.x) > epsilon || Math.abs(prev.y - vertex.y) > epsilon) {
      cleaned.push(vertex);
    }
  });

  if (cleaned.length < 2) return cleaned;
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first && last && Math.abs(first.x - last.x) <= epsilon && Math.abs(first.y - last.y) <= epsilon) {
    cleaned.pop();
  }

  return cleaned;
}

function normalizeWallSequence(wallIds: string[]): string[] {
  if (wallIds.length === 0) return [];
  const sequence: string[] = [];
  wallIds.forEach((wallId) => {
    const prev = sequence[sequence.length - 1];
    if (prev !== wallId) sequence.push(wallId);
  });
  if (sequence.length > 1 && sequence[0] === sequence[sequence.length - 1]) {
    sequence.pop();
  }
  return sequence;
}

function calculateSignedArea(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    if (!current || !next) continue;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function calculatePerimeter(vertices: Point2D[]): number {
  if (vertices.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    if (!current || !next) continue;
    total += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return total;
}

function calculatePolygonCentroid(vertices: Point2D[]): Point2D {
  if (vertices.length === 0) return { x: 0, y: 0 };
  if (vertices.length < 3) return averagePoint(vertices);

  let areaFactor = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    if (!current || !next) continue;
    const cross = current.x * next.y - next.x * current.y;
    areaFactor += cross;
    cx += (current.x + next.x) * cross;
    cy += (current.y + next.y) * cross;
  }

  if (Math.abs(areaFactor) < 1e-8) return averagePoint(vertices);
  const factor = 1 / (3 * areaFactor);
  return {
    x: cx * factor,
    y: cy * factor,
  };
}

function averagePoint(points: Point2D[]): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

function dedupeFaces(faces: DetectedFace[]): DetectedFace[] {
  const byCycleKey = new Map<string, DetectedFace>();
  faces.forEach((face) => {
    const key = canonicalCycleKey(face.wallIdsOrdered);
    const existing = byCycleKey.get(key);
    if (!existing || face.areaM2 < existing.areaM2) {
      byCycleKey.set(key, face);
    }
  });
  return Array.from(byCycleKey.values());
}

function canonicalCycleKey(wallIds: string[]): string {
  const source = wallIds.filter(Boolean);
  if (source.length === 0) return '';

  const normalizedForward = normalizeRotations(source);
  const reversed = [...source].reverse();
  const normalizedReverse = normalizeRotations(reversed);
  return normalizedForward < normalizedReverse ? normalizedForward : normalizedReverse;
}

function normalizeRotations(items: string[]): string {
  if (items.length === 0) return '';
  let best = '';

  for (let i = 0; i < items.length; i++) {
    const rotated = items.slice(i).concat(items.slice(0, i)).join('|');
    if (best === '' || rotated < best) {
      best = rotated;
    }
  }

  return best;
}

function mapFacesToRooms(faces: DetectedFace[], previousRooms: Room2D[]): Room2D[] {
  const previousByBoundary = new Map<string, Room2D[]>();
  previousRooms.forEach((room) => {
    const key = canonicalCycleKey(room.wallIds ?? []);
    const bucket = previousByBoundary.get(key) ?? [];
    bucket.push(room);
    previousByBoundary.set(key, bucket);
  });

  let nextRoomNumber = nextRoomNameIndex(previousRooms);
  return faces.map((face) => {
    const boundaryKey = canonicalCycleKey(face.wallIdsOrdered);
    const previousBucket = previousByBoundary.get(boundaryKey) ?? [];
    const previousRoom = previousBucket.shift();
    previousByBoundary.set(boundaryKey, previousBucket);

    const roomName = previousRoom?.name ?? `Room ${nextRoomNumber++}`;
    return {
      id: previousRoom?.id ?? generateId(),
      name: roomName,
      wallIds: [...face.wallIdsOrdered],
      vertices: [...face.vertices],
      area: face.areaM2,
      perimeter: face.perimeterM,
      spaceType: previousRoom?.spaceType ?? 'detected',
      floorHeight: previousRoom?.floorHeight ?? 0,
      ceilingHeight: previousRoom?.ceilingHeight ?? 3,
      color: previousRoom?.color,
    };
  });
}

function nextRoomNameIndex(rooms: Room2D[]): number {
  let max = 0;
  rooms.forEach((room) => {
    const name = typeof room.name === 'string' ? room.name : '';
    const match = name.match(/^Room\s+(\d+)$/i);
    if (!match) return;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  });
  return max + 1;
}
