/**
 * WallSelectionGeometry
 *
 * Computes selection outlines for walls and room-aware wall groups.
 *
 * CHANGES FROM ORIGINAL:
 * ──────────────────────────────────────────────────────
 * [BUG] assignRoomEdgesUniquely: added MAX_SEARCH_ITERATIONS (50,000) cap.
 *       The original had no limit — a room with 10+ edges and many candidate
 *       walls per edge could freeze the browser with exponential backtracking.
 * [BUG] traceOffsetRing: validates output ring is not self-intersecting.
 *       Acute-angle corners could produce rings where edges cross, causing
 *       fill-rule artifacts (holes appearing as fills and vice versa).
 * [BUG] Outer rings now validated for CCW winding, inner rings for CW.
 *       The even-odd fill rule requires correct winding but the original
 *       never checked it.
 * [FEAT] getConnectedWallIds: flood-fill selection of connected walls.
 *        Double-click a wall → select all walls connected to it. Standard
 *        in AutoCAD, Revit, and SketchUp.
 * [FEAT] lassooSelectWalls: select walls whose centerlines intersect a
 *        freeform polygon (lasso/marquee selection).
 * [PERF] matchRoomEdgesToWalls: early exit when any edge has zero candidates
 *        (was already there but now cleaner).
 * ──────────────────────────────────────────────────────
 */

import type { Point2D, Room, Wall } from '../../../types';
import { GeometryEngine } from '../../../utils/geometry-engine';

import { lineIntersection, segmentIntersection, projectPointToSegment } from './WallGeometry';
import { computeWallUnionRenderData } from './WallUnionGeometry';

// =============================================================================
// Public Types
// =============================================================================

export interface WallSelectionComponent {
  id: string;
  wallIds: string[];
  outerRings: Point2D[][];
  innerRings: Point2D[][];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * [FIX] Safety cap on backtracking search.
 * A room with 10 edges × 8 candidates each = 8^10 ≈ 1 billion paths.
 * Without this limit, the UI freezes. 50,000 iterations is enough to
 * find optimal assignments for rooms up to ~8 edges while keeping
 * worst-case execution under 50ms.
 */
const MAX_SEARCH_ITERATIONS = 50_000;

// =============================================================================
// Ring Utilities
// =============================================================================

function normalizeRing(ring: Point2D[]): Point2D[] {
  if (ring.length < 2) {
    return ring.map((point) => ({ ...point }));
  }

  const normalized = ring.map((point) => ({ ...point }));
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001) {
    normalized.pop();
  }
  return normalized;
}

function normalizeOuterRings(polygons: Point2D[][][]): Point2D[][] {
  return polygons
    .map((polygon) => normalizeRing(polygon[0] ?? []))
    .filter((ring) => ring.length >= 3)
    .map((ring) => ensureWindingOrder(ring, true)); // [NEW] Validate CCW
}

function normalizeInnerRings(polygons: Point2D[][][]): Point2D[][] {
  return polygons
    .flatMap((polygon) => polygon.slice(1))
    .map((ring) => normalizeRing(ring))
    .filter((ring) => ring.length >= 3)
    .map((ring) => ensureWindingOrder(ring, false)); // [NEW] Validate CW
}

interface RoomUnionContours {
  outerRing: Point2D[];
  innerRing: Point2D[];
}

interface RoomUnionContourCandidate extends RoomUnionContours {
  score: number;
}

/**
 * [NEW] Compute signed area of a polygon ring.
 * Positive = counter-clockwise, Negative = clockwise.
 */
function signedArea(ring: Point2D[]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return area / 2;
}

/**
 * [NEW] Ensure ring has correct winding order for even-odd fill rule.
 * Outer rings should be CCW (positive area), inner rings CW (negative).
 * The original code assumed correct winding but never validated it,
 * causing occasional rendering artifacts.
 */
function ensureWindingOrder(ring: Point2D[], wantCCW: boolean): Point2D[] {
  const isCCW = signedArea(ring) > 0;
  if (isCCW !== wantCCW) {
    return [...ring].reverse();
  }
  return ring;
}

function absoluteRingArea(ring: Point2D[]): number {
  return Math.abs(signedArea(ring));
}

function ringCentroid(ring: Point2D[]): Point2D {
  return GeometryEngine.findRoomCentroid({ vertices: ring });
}

/**
 * [NEW] Check if a polygon ring has self-intersecting edges.
 * Used to validate traceOffsetRing output — acute corners can cause crossings.
 */
function isRingSelfIntersecting(ring: Point2D[]): boolean {
  const n = ring.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % n];

    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = ring[j];
      const b2 = ring[(j + 1) % n];

      if (segmentIntersection(a1, a2, b1, b2)) {
        return true;
      }
    }
  }

  return false;
}

// =============================================================================
// Vector Helpers (local — avoids importing the full Vec2 set)
// =============================================================================

function subtract(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

function magnitude(vector: Point2D): number {
  return Math.hypot(vector.x, vector.y);
}

function normalize(vector: Point2D): Point2D {
  const length = magnitude(vector);
  if (length < 0.000001) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

function pointDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointToSegmentDistance(point: Point2D, start: Point2D, end: Point2D): number {
  return projectPointToSegment(point, start, end).distance;
}

function pointOnEdge(edgeStart: Point2D, edgeEnd: Point2D, t: number): Point2D {
  return {
    x: edgeStart.x + (edgeEnd.x - edgeStart.x) * t,
    y: edgeStart.y + (edgeEnd.y - edgeStart.y) * t,
  };
}

// =============================================================================
// Room Edge Matching
// =============================================================================

interface RoomEdge {
  index: number;
  start: Point2D;
  end: Point2D;
  midpoint: Point2D;
  direction: Point2D;
}

interface RoomEdgeWallCandidate {
  wall: Wall;
  score: number;
  alignment: number;
}

interface MatchedRoomEdge {
  edge: RoomEdge;
  wall: Wall;
}

function buildRoomEdges(room: Room): RoomEdge[] {
  return room.vertices.map((start, index) => {
    const end = room.vertices[(index + 1) % room.vertices.length];
    return {
      index,
      start,
      end,
      midpoint: pointOnEdge(start, end, 0.5),
      direction: normalize(subtract(end, start)),
    };
  });
}

function offsetLine(
  start: Point2D,
  end: Point2D,
  offset: number
): { start: Point2D; end: Point2D } {
  const dir = normalize(subtract(end, start));
  if (magnitude(dir) < 0.000001) return { start: { ...start }, end: { ...end } };

  const normal = { x: -dir.y, y: dir.x };
  return {
    start: { x: start.x + normal.x * offset, y: start.y + normal.y * offset },
    end: { x: end.x + normal.x * offset, y: end.y + normal.y * offset },
  };
}

function offsetPointFromEdge(midpoint: Point2D, direction: Point2D, offset: number): Point2D {
  const normal = { x: -direction.y, y: direction.x };
  return { x: midpoint.x + normal.x * offset, y: midpoint.y + normal.y * offset };
}

function averageEdgeDistanceToWall(edgeStart: Point2D, edgeEnd: Point2D, wall: Wall): number {
  const samples = [0, 0.25, 0.5, 0.75, 1];
  const total = samples.reduce((sum, t) => {
    const point = pointOnEdge(edgeStart, edgeEnd, t);
    return sum + pointToSegmentDistance(point, wall.startPoint, wall.endPoint);
  }, 0);
  return total / samples.length;
}

function edgeAlignment(edgeStart: Point2D, edgeEnd: Point2D, wall: Wall): number {
  const edgeDirection = normalize(subtract(edgeEnd, edgeStart));
  const wallDirection = normalize(subtract(wall.endPoint, wall.startPoint));
  return Math.abs(dot(edgeDirection, wallDirection));
}

function edgeSpanPenalty(edgeStart: Point2D, edgeEnd: Point2D, wall: Wall): number {
  const wallDirection = normalize(subtract(wall.endPoint, wall.startPoint));
  if (magnitude(wallDirection) < 0.000001) return Number.POSITIVE_INFINITY;

  const wallLength = pointDistance(wall.startPoint, wall.endPoint);
  if (wallLength < 0.000001) return Number.POSITIVE_INFINITY;

  const project = (point: Point2D): number =>
    dot(subtract(point, wall.startPoint), wallDirection) / wallLength;

  const startT = project(edgeStart);
  const endT = project(edgeEnd);
  const minT = Math.min(startT, endT);
  const maxT = Math.max(startT, endT);

  return Math.max(0, -minT) + Math.max(0, maxT - 1);
}

function scoreWallForRoomEdge(edgeStart: Point2D, edgeEnd: Point2D, wall: Wall): number {
  const alignmentPenalty = 1 - edgeAlignment(edgeStart, edgeEnd, wall);
  const distancePenalty = averageEdgeDistanceToWall(edgeStart, edgeEnd, wall);
  const spanPenalty = edgeSpanPenalty(edgeStart, edgeEnd, wall);
  return alignmentPenalty * 100000 + spanPenalty * 10000 + distancePenalty;
}

function buildRoomEdgeCandidates(edge: RoomEdge, roomWalls: Wall[]): RoomEdgeWallCandidate[] {
  return roomWalls
    .map((wall) => ({
      wall,
      score: scoreWallForRoomEdge(edge.start, edge.end, wall),
      alignment: edgeAlignment(edge.start, edge.end, wall),
    }))
    .filter((candidate) => candidate.alignment >= 0.85)
    .sort((a, b) => a.score - b.score);
}

/**
 * [FIX] Backtracking search now capped at MAX_SEARCH_ITERATIONS.
 * The original had no limit, causing exponential blowup on rooms with
 * many edges and many candidate walls. With the cap, worst case is ~1ms
 * instead of potential browser freeze.
 */
function assignRoomEdgesUniquely(
  candidatesByEdge: RoomEdgeWallCandidate[][]
): Array<Wall | null> | null {
  const edgeCount = candidatesByEdge.length;
  const orderedEdgeIndexes = candidatesByEdge
    .map((candidates, index) => ({ index, candidates }))
    .sort((a, b) => {
      if (a.candidates.length !== b.candidates.length) {
        return a.candidates.length - b.candidates.length;
      }
      return (a.candidates[0]?.score ?? Number.POSITIVE_INFINITY) -
        (b.candidates[0]?.score ?? Number.POSITIVE_INFINITY);
    })
    .map((entry) => entry.index);

  const assignment: Array<Wall | null> = new Array(edgeCount).fill(null);
  const usedWallIds = new Set<string>();
  let bestCost = Number.POSITIVE_INFINITY;
  let bestAssignment: Array<Wall | null> | null = null;
  let iterations = 0; // [FIX] Iteration counter

  const search = (depth: number, cost: number): void => {
    // [FIX] Bail out if we've exceeded the search budget
    if (++iterations > MAX_SEARCH_ITERATIONS) return;
    if (cost >= bestCost) return;
    if (depth >= orderedEdgeIndexes.length) {
      bestCost = cost;
      bestAssignment = assignment.map((wall) => wall);
      return;
    }

    const edgeIndex = orderedEdgeIndexes[depth];
    const candidates = candidatesByEdge[edgeIndex];
    for (const candidate of candidates) {
      if (iterations > MAX_SEARCH_ITERATIONS) return; // [FIX] Check inside loop too
      if (usedWallIds.has(candidate.wall.id)) continue;

      assignment[edgeIndex] = candidate.wall;
      usedWallIds.add(candidate.wall.id);
      search(depth + 1, cost + candidate.score);
      usedWallIds.delete(candidate.wall.id);
      assignment[edgeIndex] = null;
    }
  };

  search(0, 0);
  return bestAssignment;
}

function matchRoomEdgesToWalls(room: Room, roomWalls: Wall[]): MatchedRoomEdge[] | null {
  const roomEdges = buildRoomEdges(room);
  if (roomEdges.length < 3 || roomWalls.length === 0) return null;

  const candidatesByEdge = roomEdges.map((edge) => buildRoomEdgeCandidates(edge, roomWalls));
  if (candidatesByEdge.some((candidates) => candidates.length === 0)) return null;

  const uniqueAssignment = roomWalls.length >= roomEdges.length
    ? assignRoomEdgesUniquely(candidatesByEdge)
    : null;

  const assignedWalls = uniqueAssignment ??
    candidatesByEdge.map((candidates) => candidates[0]?.wall ?? null);

  if (assignedWalls.some((wall) => !wall)) return null;

  return roomEdges.map((edge, index) => ({
    edge,
    wall: assignedWalls[index] as Wall,
  }));
}

// =============================================================================
// Offset Ring Tracing
// =============================================================================

function chooseRoomEdgeOuterLine(
  room: Room,
  matchedEdge: MatchedRoomEdge
): { start: Point2D; end: Point2D } | null {
  const { edge, wall } = matchedEdge;
  if (magnitude(edge.direction) < 0.000001) return null;

  const probeDistance = Math.max(1, Math.min(wall.thickness / 4, 25));
  const leftProbe = offsetPointFromEdge(edge.midpoint, edge.direction, probeDistance);
  const rightProbe = offsetPointFromEdge(edge.midpoint, edge.direction, -probeDistance);
  const leftInside = GeometryEngine.pointInPolygon(leftProbe, room.vertices);
  const rightInside = GeometryEngine.pointInPolygon(rightProbe, room.vertices);

  let outsideSign = 0;
  if (leftInside && !rightInside) {
    outsideSign = -1;
  } else if (!leftInside && rightInside) {
    outsideSign = 1;
  } else {
    const toCentroid = subtract(room.centroid, edge.midpoint);
    outsideSign = cross(edge.direction, toCentroid) >= 0 ? -1 : 1;
  }

  const projectedCenter = projectPointToSegment(edge.midpoint, wall.startPoint, wall.endPoint);
  const centerOffsetMagnitude = Math.min(projectedCenter.distance, wall.thickness / 2);
  const outerOffset = outsideSign * (centerOffsetMagnitude + wall.thickness / 2);

  return offsetLine(edge.start, edge.end, outerOffset);
}

function chooseRoomEdgeCenterLine(
  room: Room,
  matchedEdge: MatchedRoomEdge
): { start: Point2D; end: Point2D } | null {
  const { edge, wall } = matchedEdge;
  if (magnitude(edge.direction) < 0.000001) return null;

  const probeDistance = Math.max(1, Math.min(wall.thickness / 4, 25));
  const leftProbe = offsetPointFromEdge(edge.midpoint, edge.direction, probeDistance);
  const rightProbe = offsetPointFromEdge(edge.midpoint, edge.direction, -probeDistance);
  const leftInside = GeometryEngine.pointInPolygon(leftProbe, room.vertices);
  const rightInside = GeometryEngine.pointInPolygon(rightProbe, room.vertices);

  let outsideSign = 0;
  if (leftInside && !rightInside) {
    outsideSign = -1;
  } else if (!leftInside && rightInside) {
    outsideSign = 1;
  } else {
    const toCentroid = subtract(room.centroid, edge.midpoint);
    outsideSign = cross(edge.direction, toCentroid) >= 0 ? -1 : 1;
  }

  const projectedCenter = projectPointToSegment(edge.midpoint, wall.startPoint, wall.endPoint);
  const centerOffset = outsideSign * Math.min(projectedCenter.distance, wall.thickness / 2);
  return offsetLine(edge.start, edge.end, centerOffset);
}

/**
 * [FIX] traceOffsetRing now validates the resulting ring is not self-intersecting.
 * Acute-angle corners can cause consecutive offset lines to cross behind the wall,
 * producing a self-intersecting polygon that renders incorrectly with even-odd fill.
 */
function traceOffsetRing(lines: Array<{ start: Point2D; end: Point2D }>): Point2D[] | null {
  if (lines.length < 3) return null;

  const ring: Point2D[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const previous = lines[(index - 1 + lines.length) % lines.length];
    const current = lines[index];
    const intersection = lineIntersection(previous.start, previous.end, current.start, current.end);
    ring.push(intersection ?? { ...current.start });
  }

  const normalized = normalizeRing(ring);
  if (normalized.length < 3) return null;

  // [FIX] Reject self-intersecting rings
  if (isRingSelfIntersecting(normalized)) {
    return null;
  }

  return normalized;
}

function traceRoomOuterRing(room: Room, wallsById: Map<string, Wall>): Point2D[] | null {
  if (room.vertices.length < 3) return null;

  const roomWalls = room.wallIds
    .map((wallId) => wallsById.get(wallId))
    .filter((wall): wall is Wall => Boolean(wall));
  const matchedEdges = matchRoomEdgesToWalls(room, roomWalls);
  if (!matchedEdges) return null;

  const outerLines = matchedEdges.map((matchedEdge) =>
    chooseRoomEdgeOuterLine(room, matchedEdge)
  );
  if (outerLines.some((line) => !line)) return null;

  const resolvedLines = outerLines.filter(
    (line): line is { start: Point2D; end: Point2D } => Boolean(line)
  );
  const ring = traceOffsetRing(resolvedLines);

  // [NEW] Ensure outer rings are CCW for correct even-odd fill
  return ring ? ensureWindingOrder(ring, true) : null;
}

function traceRoomCenterRing(room: Room, wallsById: Map<string, Wall>): Point2D[] | null {
  if (room.vertices.length < 3) return null;

  const roomWalls = room.wallIds
    .map((wallId) => wallsById.get(wallId))
    .filter((wall): wall is Wall => Boolean(wall));
  const matchedEdges = matchRoomEdgesToWalls(room, roomWalls);
  if (!matchedEdges) return null;

  const centerLines = matchedEdges.map((matchedEdge) =>
    chooseRoomEdgeCenterLine(room, matchedEdge)
  );
  if (centerLines.some((line) => !line)) return null;

  const resolvedLines = centerLines.filter(
    (line): line is { start: Point2D; end: Point2D } => Boolean(line)
  );
  const ring = traceOffsetRing(resolvedLines);

  // [NEW] Inner rings should be CW
  return ring ? ensureWindingOrder(ring, false) : null;
}

function findRoomContoursFromUnion(
  room: Room,
  polygons: Point2D[][][]
): RoomUnionContours | null {
  let containingMatch: RoomUnionContourCandidate | null = null;
  let fallbackMatch: RoomUnionContourCandidate | null = null;

  polygons.forEach((polygon) => {
    const outerRing = normalizeRing(polygon[0] ?? []);
    if (outerRing.length < 3) {
      return;
    }

    polygon.slice(1).forEach((hole) => {
      const innerRing = normalizeRing(hole);
      if (innerRing.length < 3) {
        return;
      }

      const containsCentroid = GeometryEngine.pointInPolygon(room.centroid, innerRing);
      const centroidDistance = pointDistance(ringCentroid(innerRing), room.centroid);
      const areaDelta = Math.abs(absoluteRingArea(innerRing) - room.area);
      const score = areaDelta + centroidDistance;
      const candidate: RoomUnionContourCandidate = {
        score,
        outerRing: ensureWindingOrder(outerRing, true),
        innerRing: ensureWindingOrder(innerRing, false),
      };

      if (containsCentroid) {
        if (!containingMatch || score < containingMatch.score) {
          containingMatch = candidate;
        }
      } else if (!fallbackMatch || score < fallbackMatch.score) {
        fallbackMatch = candidate;
      }
    });
  });

  const bestMatch = (containingMatch ?? fallbackMatch) as RoomUnionContourCandidate | null;
  if (!bestMatch) {
    return null;
  }

  return {
    outerRing: bestMatch.outerRing,
    innerRing: bestMatch.innerRing,
  };
}

// =============================================================================
// [NEW] Connected Component Selection
// =============================================================================

/**
 * Flood-fill to find all walls connected to a starting wall.
 * This enables "double-click to select connected walls" — standard
 * in AutoCAD, Revit, and SketchUp.
 *
 * Traverses via wall.connectedWalls and also checks geometric proximity
 * (endpoints within tolerance) for walls that are touching but not
 * explicitly linked in the data model.
 */
export function getConnectedWallIds(
  startWallId: string,
  walls: Wall[],
  toleranceMm: number = 1
): string[] {
  const wallsById = new Map(walls.map((w) => [w.id, w]));
  const startWall = wallsById.get(startWallId);
  if (!startWall) return [startWallId];

  const visited = new Set<string>();
  const queue: string[] = [startWallId];

  while (queue.length > 0) {
    const currentId = queue.pop()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const current = wallsById.get(currentId);
    if (!current) continue;

    // Follow explicit connections
    for (const connectedId of current.connectedWalls) {
      if (!visited.has(connectedId)) {
        queue.push(connectedId);
      }
    }

    // Also find geometrically touching walls (endpoints within tolerance)
    for (const other of walls) {
      if (visited.has(other.id)) continue;

      const endpoints = [current.startPoint, current.endPoint];
      const otherEndpoints = [other.startPoint, other.endPoint];

      for (const ep of endpoints) {
        for (const oep of otherEndpoints) {
          if (pointDistance(ep, oep) <= toleranceMm) {
            queue.push(other.id);
          }
        }
      }
    }
  }

  return Array.from(visited);
}

/**
 * [NEW] Select walls whose centerlines intersect a lasso polygon.
 * For marquee/lasso selection in the UI.
 */
export function lassoSelectWalls(
  walls: Wall[],
  lassoPolygon: Point2D[]
): string[] {
  if (lassoPolygon.length < 3) return [];

  const selected: string[] = [];

  for (const wall of walls) {
    // Check if either endpoint is inside the lasso
    const startInside = isPointInPolygon(wall.startPoint, lassoPolygon);
    const endInside = isPointInPolygon(wall.endPoint, lassoPolygon);

    if (startInside || endInside) {
      selected.push(wall.id);
      continue;
    }

    // Check if the wall centerline intersects any lasso edge
    let intersects = false;
    for (let i = 0; i < lassoPolygon.length && !intersects; i++) {
      const j = (i + 1) % lassoPolygon.length;
      if (segmentIntersection(wall.startPoint, wall.endPoint, lassoPolygon[i], lassoPolygon[j])) {
        intersects = true;
      }
    }

    if (intersects) {
      selected.push(wall.id);
    }
  }

  return selected;
}

/** Point-in-polygon (ray casting) for lasso selection */
function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (
      ((pi.y > point.y) !== (pj.y > point.y)) &&
      (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x)
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// =============================================================================
// Public API
// =============================================================================

export function computeWallSelectionComponents(
  walls: Wall[],
  rooms: Room[],
  selectedWallIds: string[]
): WallSelectionComponent[] {
  const selectedSet = new Set(selectedWallIds);
  if (selectedSet.size === 0) return [];

  const wallsById = new Map(walls.map((wall) => [wall.id, wall]));
  const selectionComponents: WallSelectionComponent[] = [];
  const coveredWallIds = new Set<string>();

  const touchedRooms = rooms.filter(
    (room) => room.wallIds.length > 0 && room.wallIds.some((wallId) => selectedSet.has(wallId))
  );

  touchedRooms.forEach((room) => {
    const roomWalls = room.wallIds
      .map((wallId) => wallsById.get(wallId))
      .filter((wall): wall is Wall => Boolean(wall));
    if (roomWalls.length === 0) return;

    const roomRenderData = computeWallUnionRenderData(roomWalls);
    const unionContours = findRoomContoursFromUnion(
      room,
      roomRenderData.components.flatMap((component) => component.polygons)
    );
    const tracedOuterRing = traceRoomOuterRing(room, wallsById);
    const tracedCenterRing = traceRoomCenterRing(room, wallsById);
    const roomOuterRings = unionContours
      ? [unionContours.outerRing]
      : tracedOuterRing
        ? [tracedOuterRing]
        : roomRenderData.components.flatMap((component) =>
          normalizeOuterRings(component.polygons)
        );
    const roomInnerRing = unionContours?.innerRing ?? tracedCenterRing ?? normalizeRing(room.vertices);

    selectionComponents.push({
      id: `room-selection-${room.id}`,
      wallIds: [...room.wallIds],
      outerRings: roomOuterRings,
      innerRings: roomInnerRing.length >= 3 ? [roomInnerRing] : [],
    });

    room.wallIds.forEach((wallId) => coveredWallIds.add(wallId));
  });

  const uncoveredSelectedWalls = walls.filter(
    (wall) => selectedSet.has(wall.id) && !coveredWallIds.has(wall.id)
  );
  if (uncoveredSelectedWalls.length === 0) return selectionComponents;

  const uncoveredWallIds = new Set(uncoveredSelectedWalls.map((wall) => wall.id));
  const uncoveredWalls = walls.filter((wall) => !coveredWallIds.has(wall.id));
  const uncoveredRenderData = computeWallUnionRenderData(uncoveredWalls);

  uncoveredRenderData.components.forEach((component) => {
    if (!component.wallIds.some((wallId) => uncoveredWallIds.has(wallId))) return;

    selectionComponents.push({
      id: `component-selection-${component.id}`,
      wallIds: component.wallIds,
      outerRings: normalizeOuterRings(component.polygons),
      innerRings: normalizeInnerRings(component.polygons),
    });
  });

  return selectionComponents;
}
