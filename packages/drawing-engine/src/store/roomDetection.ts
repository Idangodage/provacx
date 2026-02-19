/**
 * Room detection utilities.
 *
 * Detects closed wall loops using half-edge face traversal and derives
 * room geometry metadata used by store room synchronization.
 */

import type { Point2D, RoomType, Wall } from '../types';
import { GeometryEngine } from '../utils/geometry-engine';

// Keep this aligned with interactive snapping so near-closed loops still resolve.
const NODE_TOLERANCE_MM = 10;
const AREA_EPSILON_MM2 = 1;

interface Node {
  id: string;
  point: Point2D;
}

interface HalfEdge {
  id: string;
  from: string;
  to: string;
  wallId: string;
  angle: number;
  reverseId: string;
  visited: boolean;
}

interface RoomFace {
  vertices: Point2D[];
  wallIds: string[];
  area: number;
  perimeter: number;
  centroid: Point2D;
  signature: string;
}

export interface RoomDetectionResult {
  faces: RoomFace[];
  exteriorSignatures: Set<string>;
}

function distanceSquared(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function addUniquePoint(points: Point2D[], point: Point2D, tolerance: number = NODE_TOLERANCE_MM): void {
  const toleranceSq = tolerance * tolerance;
  const exists = points.some((existing) => distanceSquared(existing, point) <= toleranceSq);
  if (!exists) {
    points.push({ ...point });
  }
}

function projectPointParameter(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    return 0;
  }
  return ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
}

function pointOnSegment(
  point: Point2D,
  start: Point2D,
  end: Point2D,
  tolerance: number = NODE_TOLERANCE_MM
): boolean {
  const t = projectPointParameter(point, start, end);
  if (t < -0.001 || t > 1.001) {
    return false;
  }

  const projected = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
  return Math.hypot(point.x - projected.x, point.y - projected.y) <= tolerance;
}

function segmentIntersectionPoint(
  aStart: Point2D,
  aEnd: Point2D,
  bStart: Point2D,
  bEnd: Point2D
): Point2D | null {
  const r = { x: aEnd.x - aStart.x, y: aEnd.y - aStart.y };
  const s = { x: bEnd.x - bStart.x, y: bEnd.y - bStart.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) <= 0.000001) {
    return null;
  }

  const qp = { x: bStart.x - aStart.x, y: bStart.y - aStart.y };
  const t = (qp.x * s.y - qp.y * s.x) / denominator;
  const u = (qp.x * r.y - qp.y * r.x) / denominator;

  if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) {
    return null;
  }

  return {
    x: aStart.x + t * r.x,
    y: aStart.y + t * r.y,
  };
}

function pointKey(point: Point2D): string {
  return `${Math.round(point.x / NODE_TOLERANCE_MM)}:${Math.round(point.y / NODE_TOLERANCE_MM)}`;
}

function signedArea(vertices: Point2D[]): number {
  return GeometryEngine.calculateSignedArea(vertices);
}

function polygonCentroid(vertices: Point2D[]): Point2D {
  return GeometryEngine.findRoomCentroid({ vertices });
}

function polygonPerimeter(vertices: Point2D[]): number {
  return GeometryEngine.calculateRoomPerimeterMm({ vertices });
}

function normalizeVertexLoop(vertices: Point2D[]): Point2D[] {
  const cleaned: Point2D[] = [];
  for (const point of vertices) {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || Math.abs(previous.x - point.x) > 0.001 || Math.abs(previous.y - point.y) > 0.001) {
      cleaned.push(point);
    }
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first.x - last.x) <= 0.001 && Math.abs(first.y - last.y) <= 0.001) {
      cleaned.pop();
    }
  }
  return cleaned;
}

function canonicalLoopKey(vertices: Point2D[]): string {
  const rounded = vertices.map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`);
  if (rounded.length === 0) return '';

  let best = rounded.join('|');
  for (let offset = 1; offset < rounded.length; offset++) {
    const rotated = [...rounded.slice(offset), ...rounded.slice(0, offset)].join('|');
    if (rotated < best) {
      best = rotated;
    }
  }
  const reversed = [...rounded].reverse();
  for (let offset = 0; offset < reversed.length; offset++) {
    const rotated = [...reversed.slice(offset), ...reversed.slice(0, offset)].join('|');
    if (rotated < best) {
      best = rotated;
    }
  }
  return best;
}

function buildGraph(walls: Wall[]): {
  nodes: Map<string, Node>;
  halfEdges: Map<string, HalfEdge>;
  outgoing: Map<string, string[]>;
} {
  const nodes = new Map<string, Node>();
  const halfEdges = new Map<string, HalfEdge>();
  const outgoing = new Map<string, string[]>();
  const wallSplitPoints = new Map<string, Point2D[]>();

  walls.forEach((wall) => {
    wallSplitPoints.set(wall.id, [{ ...wall.startPoint }, { ...wall.endPoint }]);
  });

  for (let i = 0; i < walls.length; i += 1) {
    const wallA = walls[i];
    for (let j = i + 1; j < walls.length; j += 1) {
      const wallB = walls[j];
      const pointsA = wallSplitPoints.get(wallA.id);
      const pointsB = wallSplitPoints.get(wallB.id);
      if (!pointsA || !pointsB) continue;

      const intersection = segmentIntersectionPoint(
        wallA.startPoint,
        wallA.endPoint,
        wallB.startPoint,
        wallB.endPoint
      );
      if (intersection) {
        addUniquePoint(pointsA, intersection);
        addUniquePoint(pointsB, intersection);
      }

      const endpointsA = [wallA.startPoint, wallA.endPoint];
      const endpointsB = [wallB.startPoint, wallB.endPoint];

      endpointsA.forEach((endpoint) => {
        if (pointOnSegment(endpoint, wallB.startPoint, wallB.endPoint)) {
          addUniquePoint(pointsA, endpoint);
          addUniquePoint(pointsB, endpoint);
        }
      });
      endpointsB.forEach((endpoint) => {
        if (pointOnSegment(endpoint, wallA.startPoint, wallA.endPoint)) {
          addUniquePoint(pointsA, endpoint);
          addUniquePoint(pointsB, endpoint);
        }
      });
    }
  }

  const findNearbyNodeId = (point: Point2D): string | null => {
    const toleranceSq = NODE_TOLERANCE_MM * NODE_TOLERANCE_MM;
    let bestId: string | null = null;
    let bestDistanceSq = toleranceSq;

    for (const [nodeId, node] of nodes.entries()) {
      const dx = node.point.x - point.x;
      const dy = node.point.y - point.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestId = nodeId;
      }
    }

    return bestId;
  };

  const resolveNode = (point: Point2D): string => {
    const nearbyId = findNearbyNodeId(point);
    if (nearbyId) {
      return nearbyId;
    }

    const baseKey = pointKey(point);
    let key = baseKey;
    let suffix = 1;
    while (nodes.has(key)) {
      key = `${baseKey}:${suffix}`;
      suffix += 1;
    }
    nodes.set(key, { id: key, point: { ...point } });
    return key;
  };

  for (const wall of walls) {
    const splitPoints = wallSplitPoints.get(wall.id) ?? [wall.startPoint, wall.endPoint];
    const orderedSplitPoints = [...splitPoints].sort(
      (a, b) =>
        projectPointParameter(a, wall.startPoint, wall.endPoint) -
        projectPointParameter(b, wall.startPoint, wall.endPoint)
    );

    for (let segmentIndex = 0; segmentIndex < orderedSplitPoints.length - 1; segmentIndex += 1) {
      const segmentStart = orderedSplitPoints[segmentIndex];
      const segmentEnd = orderedSplitPoints[segmentIndex + 1];
      if (distanceSquared(segmentStart, segmentEnd) <= 0.000001) {
        continue;
      }

      const from = resolveNode(segmentStart);
      const to = resolveNode(segmentEnd);
      if (from === to) continue;

      const forwardId = `${wall.id}:${segmentIndex}:f`;
      const reverseId = `${wall.id}:${segmentIndex}:r`;

      const fromPoint = nodes.get(from)?.point ?? segmentStart;
      const toPoint = nodes.get(to)?.point ?? segmentEnd;

      const forward: HalfEdge = {
        id: forwardId,
        from,
        to,
        wallId: wall.id,
        angle: Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x),
        reverseId,
        visited: false,
      };
      const reverse: HalfEdge = {
        id: reverseId,
        from: to,
        to: from,
        wallId: wall.id,
        angle: Math.atan2(fromPoint.y - toPoint.y, fromPoint.x - toPoint.x),
        reverseId: forwardId,
        visited: false,
      };

      halfEdges.set(forwardId, forward);
      halfEdges.set(reverseId, reverse);
      outgoing.set(from, [...(outgoing.get(from) ?? []), forwardId]);
      outgoing.set(to, [...(outgoing.get(to) ?? []), reverseId]);
    }
  }

  outgoing.forEach((edgeIds, nodeId) => {
    const sorted = [...edgeIds].sort((a, b) => {
      const angleA = halfEdges.get(a)?.angle ?? 0;
      const angleB = halfEdges.get(b)?.angle ?? 0;
      return angleA - angleB;
    });
    outgoing.set(nodeId, sorted);
  });

  return { nodes, halfEdges, outgoing };
}

function walkFace(
  startEdgeId: string,
  nodes: Map<string, Node>,
  halfEdges: Map<string, HalfEdge>,
  outgoing: Map<string, string[]>
): { vertexIds: string[]; wallIds: string[] } | null {
  const startEdge = halfEdges.get(startEdgeId);
  if (!startEdge || startEdge.visited) return null;

  const vertexIds: string[] = [];
  const wallIds: string[] = [];
  const traversedEdgeIds: string[] = [];
  let currentEdgeId = startEdgeId;
  const maxSteps = halfEdges.size + 2;

  for (let steps = 0; steps < maxSteps; steps++) {
    const currentEdge = halfEdges.get(currentEdgeId);
    if (!currentEdge) return null;

    if (currentEdge.visited && currentEdgeId !== startEdgeId) {
      return null;
    }
    traversedEdgeIds.push(currentEdge.id);
    vertexIds.push(currentEdge.from);
    wallIds.push(currentEdge.wallId);

    const outgoingAtNode = outgoing.get(currentEdge.to);
    if (!outgoingAtNode || outgoingAtNode.length < 2) {
      return null;
    }

    const reverseIndex = outgoingAtNode.indexOf(currentEdge.reverseId);
    if (reverseIndex < 0) {
      return null;
    }

    const nextIndex = (reverseIndex - 1 + outgoingAtNode.length) % outgoingAtNode.length;
    const nextEdgeId = outgoingAtNode[nextIndex];
    if (nextEdgeId === startEdgeId) {
      break;
    }
    currentEdgeId = nextEdgeId;
  }

  const uniqueVertices = new Set(vertexIds);
  const uniqueWalls = new Set(wallIds);
  if (uniqueVertices.size < 3 || uniqueWalls.size < 3) {
    return null;
  }

  for (const vertexId of uniqueVertices) {
    if (!nodes.has(vertexId)) return null;
  }

  traversedEdgeIds.forEach((edgeId) => {
    const edge = halfEdges.get(edgeId);
    if (edge) {
      edge.visited = true;
    }
  });

  return {
    vertexIds,
    wallIds: [...uniqueWalls],
  };
}

function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  return GeometryEngine.pointInPolygon(point, polygon);
}

export function detectRoomPolygons(walls: Wall[]): RoomDetectionResult {
  const { nodes, halfEdges, outgoing } = buildGraph(walls);
  const faces: RoomFace[] = [];
  const seen = new Set<string>();

  for (const edgeId of halfEdges.keys()) {
    const traversal = walkFace(edgeId, nodes, halfEdges, outgoing);
    if (!traversal) continue;

    const vertices = normalizeVertexLoop(
      traversal.vertexIds
        .map((vertexId) => nodes.get(vertexId)?.point)
        .filter((point): point is Point2D => Boolean(point))
    );
    if (vertices.length < 3) continue;

    const areaSigned = signedArea(vertices);
    const area = Math.abs(areaSigned);
    if (area < AREA_EPSILON_MM2) continue;

    // Interior loops resolve with positive orientation in this traversal.
    if (areaSigned <= 0) continue;

    const loopKey = canonicalLoopKey(vertices);
    if (!loopKey || seen.has(loopKey)) continue;
    seen.add(loopKey);

    const uniqueWallIds = Array.from(new Set(traversal.wallIds));
    if (uniqueWallIds.length < 3) continue;

    const perimeter = polygonPerimeter(vertices);
    const centroid = polygonCentroid(vertices);
    const signature = [...uniqueWallIds].sort().join('|');

    faces.push({
      vertices,
      wallIds: uniqueWallIds,
      area,
      perimeter,
      centroid,
      signature,
    });
  }

  // Distinguish exterior by containment: faces that contain others are likely envelope.
  const exteriorSignatures = new Set<string>();
  for (const face of faces) {
    let containsOther = false;
    for (const other of faces) {
      if (face.signature === other.signature) continue;
      if (pointInPolygon(other.centroid, face.vertices)) {
        containsOther = true;
        break;
      }
    }
    if (containsOther) {
      exteriorSignatures.add(face.signature);
    }
  }

  return {
    faces,
    exteriorSignatures,
  };
}

export function inferRoomType(areaM2: number): RoomType {
  if (areaM2 < 5) return 'Bathroom/Closet';
  if (areaM2 < 15) return 'Bedroom';
  if (areaM2 < 25) return 'Living Room';
  return 'Open Space';
}

export function roomTypeFillColor(roomType: RoomType): string {
  switch (roomType) {
    case 'Bathroom/Closet':
      return '#7DD3FC';
    case 'Bedroom':
      return '#A7F3D0';
    case 'Living Room':
      return '#FDE68A';
    case 'Open Space':
      return '#D8B4FE';
    case 'Custom':
    default:
      return '#E2E8F0';
  }
}

export function roomTopologyHash(walls: Wall[]): string {
  const entries = walls
    .map((wall) => [
      wall.id,
      Math.round(wall.startPoint.x),
      Math.round(wall.startPoint.y),
      Math.round(wall.endPoint.x),
      Math.round(wall.endPoint.y),
      Math.round(wall.thickness),
      wall.openings.filter((opening) => opening.type === 'window').length,
    ].join(':'))
    .sort();
  return entries.join('|');
}

export function roomMinimumDimensionWarnings(
  roomType: RoomType,
  vertices: Point2D[]
): string[] {
  const xs = vertices.map((point) => point.x);
  const ys = vertices.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const minDim = Math.min(width, height);

  if (roomType === 'Bedroom' && minDim < 2400) {
    return ['Bedroom minimum dimension is below 2.4m.'];
  }
  if (roomType === 'Living Room' && minDim < 3000) {
    return ['Living room minimum dimension is below 3.0m.'];
  }
  if (roomType === 'Bathroom/Closet' && minDim < 1200) {
    return ['Bathroom/Closet minimum dimension is below 1.2m.'];
  }
  return [];
}
