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
const AUTO_SPACE_TYPES = new Set([
  'detected',
  'enclosed-space',
  'remaining-area',
  'surrounding-area',
  'sub room',
  'storage',
  'utility',
  'bathroom',
  'shaft',
  'net area',
  'general',
]);

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

export interface NestedRoomValidationResult {
  errors: string[];
  warnings: string[];
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

  const baseRooms = mapFacesToRooms(dedupedFaces, previousRooms);
  return applyNestedRoomHierarchy(baseRooms);
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
    const grossArea = face.areaM2;
    return {
      id: previousRoom?.id ?? generateId(),
      name: roomName,
      wallIds: [...face.wallIdsOrdered],
      vertices: [...face.vertices],
      manualParentRoomId: previousRoom?.manualParentRoomId ?? null,
      parentRoomId: null,
      childRoomIds: [] as string[],
      grossArea,
      netArea: grossArea,
      roomType: 'enclosed-space',
      area: grossArea,
      perimeter: face.perimeterM,
      spaceType: previousRoom?.spaceType ?? 'detected',
      floorHeight: previousRoom?.floorHeight ?? 0,
      ceilingHeight: previousRoom?.ceilingHeight ?? 3,
      color: previousRoom?.color,
      showTag: previousRoom?.showTag !== false,
    };
  });
}

export function applyNestedRoomHierarchy(sourceRooms: Room2D[]): Room2D[] {
  if (sourceRooms.length === 0) return [];

  const rooms = sourceRooms.map((room) => {
    const grossArea = Number.isFinite(room.grossArea) ? room.grossArea : room.area;
    return {
      ...room,
      manualParentRoomId: room.manualParentRoomId ?? null,
      parentRoomId: room.parentRoomId ?? null,
      childRoomIds: [] as string[],
      grossArea,
      netArea: Number.isFinite(room.netArea) ? room.netArea : grossArea,
      roomType: room.roomType ?? 'enclosed-space',
      area: room.area ?? grossArea,
      showTag: room.showTag !== false,
    };
  });

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const boundsByRoomId = new Map(rooms.map((room) => [room.id, calculatePolygonBounds(room.vertices)]));

  rooms.forEach((child) => {
    const childBounds = boundsByRoomId.get(child.id);
    if (!childBounds) return;

    let bestParent: Room2D | null = null;
    for (const candidate of rooms) {
      if (!isValidParentContainment(child, childBounds, candidate, boundsByRoomId)) continue;

      if (!bestParent || candidate.grossArea < bestParent.grossArea) {
        bestParent = candidate;
      }
    }

    const preferredParent = child.manualParentRoomId
      ? roomById.get(child.manualParentRoomId) ?? null
      : null;
    const preferredParentValid =
      preferredParent !== null &&
      isValidParentContainment(child, childBounds, preferredParent, boundsByRoomId);

    child.parentRoomId = preferredParentValid
      ? preferredParent.id
      : bestParent?.id ?? null;
    child.manualParentRoomId = child.parentRoomId;
  });

  rooms.forEach((room) => {
    room.childRoomIds = [];
  });

  rooms.forEach((room) => {
    if (!room.parentRoomId) return;
    const parent = roomById.get(room.parentRoomId);
    if (!parent) return;
    parent.childRoomIds.push(room.id);
  });

  assignNestedChildAutoNames(rooms, roomById);

  rooms.forEach((room) => {
    const childrenGrossArea = room.childRoomIds.reduce((sum, childId) => {
      const child = roomById.get(childId);
      return sum + (child?.grossArea ?? 0);
    }, 0);

    room.netArea = Math.max(0, room.grossArea - childrenGrossArea);
    room.area = room.netArea;
    room.roomType = classifyRoomType(room);
    room.spaceType = resolveRoomSpaceType(
      room.spaceType,
      suggestRoomSpaceType(room)
    );
  });

  return rooms;
}

function isValidParentContainment(
  child: Room2D,
  childBounds: { left: number; top: number; right: number; bottom: number },
  candidate: Room2D,
  boundsByRoomId: Map<string, { left: number; top: number; right: number; bottom: number }>
): boolean {
  if (candidate.id === child.id) return false;
  const candidateBounds = boundsByRoomId.get(candidate.id);
  if (!candidateBounds) return false;
  if (!boundsContains(candidateBounds, childBounds)) return false;

  const allInsideOrBoundary = child.vertices.every((vertex) =>
    isPointInsidePolygonInclusive(vertex, candidate.vertices)
  );
  if (!allInsideOrBoundary) return false;
  if (child.grossArea >= candidate.grossArea - 1e-8) return false;

  return true;
}

function classifyRoomType(room: Pick<Room2D, 'parentRoomId' | 'childRoomIds'>): Room2D['roomType'] {
  if (room.childRoomIds.length === 0) {
    return 'enclosed-space';
  }
  if (room.parentRoomId) {
    return 'remaining-area';
  }
  return 'surrounding-area';
}

function suggestRoomSpaceType(room: Pick<Room2D, 'parentRoomId' | 'childRoomIds' | 'netArea' | 'grossArea' | 'area'>): string {
  const effectiveArea = Math.max(
    Number.isFinite(room.netArea) ? room.netArea : Number.isFinite(room.area) ? room.area : 0,
    0
  );

  if (room.parentRoomId) {
    if (effectiveArea < 1.5) return 'Shaft';
    if (effectiveArea < 4) return 'Storage';
    if (effectiveArea < 8) return 'Closet';
    return 'Sub Room';
  }

  if (room.childRoomIds.length > 0) {
    return 'Net Area';
  }

  if (effectiveArea < 3) return 'Storage';
  if (effectiveArea < 8) return 'Bathroom';
  if (effectiveArea < 15) return 'Utility';
  return 'General';
}

function resolveRoomSpaceType(currentSpaceType: string | undefined, suggested: string): string {
  const normalized = (currentSpaceType ?? '').trim().toLowerCase();
  if (!normalized) return suggested;
  if (AUTO_SPACE_TYPES.has(normalized)) return suggested;
  return currentSpaceType ?? suggested;
}

function assignNestedChildAutoNames(rooms: Room2D[], roomById: Map<string, Room2D>): void {
  const parents = rooms
    .filter((room) => room.childRoomIds.length > 0)
    .sort((a, b) => getHierarchyDepth(a, roomById) - getHierarchyDepth(b, roomById));

  parents.forEach((parent) => {
    const children = parent.childRoomIds
      .map((childId) => roomById.get(childId))
      .filter((child): child is Room2D => Boolean(child))
      .sort((a, b) => {
        const ac = calculatePolygonCentroid(a.vertices);
        const bc = calculatePolygonCentroid(b.vertices);
        if (Math.abs(ac.y - bc.y) > 1e-6) return ac.y - bc.y;
        return ac.x - bc.x;
      });

    let autoIndex = 1;
    children.forEach((child) => {
      if (!shouldAutoRenameChildRoom(child, parent)) return;
      child.name = `${parent.name} - ${autoIndex}`;
      autoIndex += 1;
    });
  });
}

function getHierarchyDepth(room: Room2D, roomById: Map<string, Room2D>): number {
  let depth = 0;
  let cursor = room.parentRoomId ? roomById.get(room.parentRoomId) ?? null : null;
  let guard = 0;
  while (cursor && guard < 32) {
    depth += 1;
    cursor = cursor.parentRoomId ? roomById.get(cursor.parentRoomId) ?? null : null;
    guard += 1;
  }
  return depth;
}

function shouldAutoRenameChildRoom(child: Room2D, parent: Room2D): boolean {
  const name = (child.name ?? '').trim();
  if (!name) return true;
  if (/^Room\s+\d+(\s*-\s*\d+)?$/i.test(name)) return true;
  if (/^Sub\s*Room\s+\d+$/i.test(name)) return true;
  if (new RegExp(`^${escapeRegExp(parent.name)}\\s-\\s\\d+$`, 'i').test(name)) return true;
  if (/^.+\s-\s\d+$/i.test(name) && child.parentRoomId !== null) return true;
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calculatePolygonBounds(vertices: Point2D[]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  if (vertices.length === 0) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  vertices.forEach((vertex) => {
    left = Math.min(left, vertex.x);
    top = Math.min(top, vertex.y);
    right = Math.max(right, vertex.x);
    bottom = Math.max(bottom, vertex.y);
  });

  return { left, top, right, bottom };
}

function boundsContains(
  outer: { left: number; top: number; right: number; bottom: number },
  inner: { left: number; top: number; right: number; bottom: number },
  tolerance = 1e-6
): boolean {
  return (
    outer.left <= inner.left + tolerance &&
    outer.top <= inner.top + tolerance &&
    outer.right >= inner.right - tolerance &&
    outer.bottom >= inner.bottom - tolerance
  );
}

function isPointStrictlyInsidePolygon(
  point: Point2D,
  polygon: Point2D[],
  tolerance = 1e-6
): boolean {
  if (polygon.length < 3) return false;
  if (isPointOnPolygonBoundary(point, polygon, tolerance)) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (!pi || !pj) continue;

    const intersects =
      (pi.y > point.y) !== (pj.y > point.y) &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + Number.EPSILON) + pi.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function isPointInsidePolygonInclusive(point: Point2D, polygon: Point2D[], tolerance = 1e-6): boolean {
  return (
    isPointStrictlyInsidePolygon(point, polygon, tolerance) ||
    isPointOnPolygonBoundary(point, polygon, tolerance)
  );
}

function isPointOnPolygonBoundary(
  point: Point2D,
  polygon: Point2D[],
  tolerance: number
): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    if (!start || !end) continue;
    if (distancePointToSegment(point, start, end) <= tolerance) {
      return true;
    }
  }
  return false;
}

function distancePointToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-12) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq)
  );
  const px = start.x + t * dx;
  const py = start.y + t * dy;
  return Math.hypot(point.x - px, point.y - py);
}

export function validateNestedRooms(rooms: Room2D[]): NestedRoomValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const childrenByParent = new Map<string, Room2D[]>();

  rooms.forEach((room) => {
    if (!room.parentRoomId) return;
    const parentChildren = childrenByParent.get(room.parentRoomId) ?? [];
    parentChildren.push(room);
    childrenByParent.set(room.parentRoomId, parentChildren);
  });

  rooms.forEach((room) => {
    if (!room.parentRoomId) return;
    const parent = roomById.get(room.parentRoomId);
    if (!parent) return;

    if (room.grossArea > parent.grossArea + 1e-8) {
      errors.push(`"${room.name}" cannot be larger than parent "${parent.name}".`);
    } else if (room.grossArea >= parent.grossArea - 1e-8) {
      warnings.push(
        `"${room.name}" nearly fills "${parent.name}" (remaining area approaches zero).`
      );
    }
  });

  childrenByParent.forEach((children, parentId) => {
    const parent = roomById.get(parentId);
    for (let i = 0; i < children.length; i++) {
      const roomA = children[i];
      if (!roomA) continue;
      for (let j = i + 1; j < children.length; j++) {
        const roomB = children[j];
        if (!roomB) continue;
        if (!polygonsOverlapWithArea(roomA.vertices, roomB.vertices)) continue;
        errors.push(
          `Child rooms "${roomA.name}" and "${roomB.name}" overlap inside "${parent?.name ?? 'parent room'}".`
        );
      }
    }
  });

  rooms.forEach((room) => {
    if (room.childRoomIds.length === 0) return;
    if (room.netArea <= 1e-6) {
      warnings.push(`"${room.name}" has zero remaining net area.`);
    }
  });

  return { errors, warnings };
}

function polygonsOverlapWithArea(a: Point2D[], b: Point2D[]): boolean {
  if (a.length < 3 || b.length < 3) return false;

  const aBounds = calculatePolygonBounds(a);
  const bBounds = calculatePolygonBounds(b);
  if (!boundsOverlap(aBounds, bBounds)) return false;

  if (a.some((point) => isPointStrictlyInsidePolygon(point, b))) return true;
  if (b.some((point) => isPointStrictlyInsidePolygon(point, a))) return true;

  for (let i = 0; i < a.length; i++) {
    const aStart = a[i];
    const aEnd = a[(i + 1) % a.length];
    if (!aStart || !aEnd) continue;

    for (let j = 0; j < b.length; j++) {
      const bStart = b[j];
      const bEnd = b[(j + 1) % b.length];
      if (!bStart || !bEnd) continue;
      if (segmentsIntersectStrict(aStart, aEnd, bStart, bEnd)) {
        return true;
      }
    }
  }

  return false;
}

function boundsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
  tolerance = 1e-8
): boolean {
  return (
    a.left < b.right - tolerance &&
    a.right > b.left + tolerance &&
    a.top < b.bottom - tolerance &&
    a.bottom > b.top + tolerance
  );
}

function segmentsIntersectStrict(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
  tolerance = 1e-8
): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (
    Math.abs(o1) <= tolerance ||
    Math.abs(o2) <= tolerance ||
    Math.abs(o3) <= tolerance ||
    Math.abs(o4) <= tolerance
  ) {
    return false;
  }

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
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
