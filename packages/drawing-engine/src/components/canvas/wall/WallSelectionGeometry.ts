import type { Point2D, Room, Wall } from '../../../types';
import { GeometryEngine } from '../../../utils/geometry-engine';

import { lineIntersection } from './WallGeometry';
import { computeWallUnionRenderData } from './WallUnionGeometry';

export interface WallSelectionComponent {
  id: string;
  wallIds: string[];
  outerRings: Point2D[][];
  innerRings: Point2D[][];
}

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
    .filter((ring) => ring.length >= 3);
}

function normalizeInnerRings(polygons: Point2D[][][]): Point2D[][] {
  return polygons
    .flatMap((polygon) => polygon.slice(1))
    .map((ring) => normalizeRing(ring))
    .filter((ring) => ring.length >= 3);
}

function subtract(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

function magnitude(vector: Point2D): number {
  return Math.hypot(vector.x, vector.y);
}

function normalize(vector: Point2D): Point2D {
  const length = magnitude(vector);
  if (length < 0.000001) {
    return { x: 0, y: 0 };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
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

function projectPointToSegment(point: Point2D, start: Point2D, end: Point2D): Point2D {
  const segment = subtract(end, start);
  const lengthSq = segment.x * segment.x + segment.y * segment.y;
  if (lengthSq < 0.000001) {
    return { ...start };
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) / lengthSq
    )
  );
  return {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t,
  };
}

function pointToSegmentDistance(point: Point2D, start: Point2D, end: Point2D): number {
  return pointDistance(point, projectPointToSegment(point, start, end));
}

function pointOnEdge(edgeStart: Point2D, edgeEnd: Point2D, t: number): Point2D {
  return {
    x: edgeStart.x + (edgeEnd.x - edgeStart.x) * t,
    y: edgeStart.y + (edgeEnd.y - edgeStart.y) * t,
  };
}

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
  const direction = normalize(subtract(end, start));
  if (magnitude(direction) < 0.000001) {
    return {
      start: { ...start },
      end: { ...end },
    };
  }

  const normal = {
    x: -direction.y,
    y: direction.x,
  };

  return {
    start: {
      x: start.x + normal.x * offset,
      y: start.y + normal.y * offset,
    },
    end: {
      x: end.x + normal.x * offset,
      y: end.y + normal.y * offset,
    },
  };
}

function offsetPointFromEdge(midpoint: Point2D, direction: Point2D, offset: number): Point2D {
  const normal = {
    x: -direction.y,
    y: direction.x,
  };
  return {
    x: midpoint.x + normal.x * offset,
    y: midpoint.y + normal.y * offset,
  };
}

function pointProjectData(
  point: Point2D,
  start: Point2D,
  end: Point2D
): { point: Point2D; distance: number } {
  const projection = projectPointToSegment(point, start, end);
  return {
    point: projection,
    distance: pointDistance(point, projection),
  };
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
  if (magnitude(wallDirection) < 0.000001) {
    return Number.POSITIVE_INFINITY;
  }

  const wallLength = pointDistance(wall.startPoint, wall.endPoint);
  if (wallLength < 0.000001) {
    return Number.POSITIVE_INFINITY;
  }

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

  const search = (depth: number, cost: number): void => {
    if (cost >= bestCost) {
      return;
    }
    if (depth >= orderedEdgeIndexes.length) {
      bestCost = cost;
      bestAssignment = assignment.map((wall) => wall);
      return;
    }

    const edgeIndex = orderedEdgeIndexes[depth];
    const candidates = candidatesByEdge[edgeIndex];
    for (const candidate of candidates) {
      if (usedWallIds.has(candidate.wall.id)) {
        continue;
      }

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
  if (roomEdges.length < 3 || roomWalls.length === 0) {
    return null;
  }

  const candidatesByEdge = roomEdges.map((edge) => buildRoomEdgeCandidates(edge, roomWalls));
  if (candidatesByEdge.some((candidates) => candidates.length === 0)) {
    return null;
  }

  const uniqueAssignment = roomWalls.length >= roomEdges.length
    ? assignRoomEdgesUniquely(candidatesByEdge)
    : null;

  const assignedWalls = uniqueAssignment ??
    candidatesByEdge.map((candidates) => candidates[0]?.wall ?? null);

  if (assignedWalls.some((wall) => !wall)) {
    return null;
  }

  return roomEdges.map((edge, index) => ({
    edge,
    wall: assignedWalls[index] as Wall,
  }));
}

function chooseRoomEdgeOuterLine(
  room: Room,
  matchedEdge: MatchedRoomEdge
): { start: Point2D; end: Point2D } | null {
  const { edge, wall } = matchedEdge;
  if (magnitude(edge.direction) < 0.000001) {
    return null;
  }

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

  const projectedCenter = pointProjectData(edge.midpoint, wall.startPoint, wall.endPoint);
  const centerOffsetMagnitude = Math.min(projectedCenter.distance, wall.thickness / 2);
  const outerOffset = outsideSign * (centerOffsetMagnitude + wall.thickness / 2);

  return offsetLine(edge.start, edge.end, outerOffset);
}

function chooseRoomEdgeCenterLine(
  room: Room,
  matchedEdge: MatchedRoomEdge
): { start: Point2D; end: Point2D } | null {
  const { edge, wall } = matchedEdge;
  if (magnitude(edge.direction) < 0.000001) {
    return null;
  }

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

  const projectedCenter = pointProjectData(edge.midpoint, wall.startPoint, wall.endPoint);
  const centerOffset = outsideSign * Math.min(projectedCenter.distance, wall.thickness / 2);
  return offsetLine(edge.start, edge.end, centerOffset);
}

function traceOffsetRing(lines: Array<{ start: Point2D; end: Point2D }>): Point2D[] | null {
  if (lines.length < 3) {
    return null;
  }

  const ring: Point2D[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const previous = lines[(index - 1 + lines.length) % lines.length];
    const current = lines[index];
    const intersection = lineIntersection(previous.start, previous.end, current.start, current.end);
    ring.push(intersection ?? { ...current.start });
  }

  const normalized = normalizeRing(ring);
  return normalized.length >= 3 ? normalized : null;
}

function traceRoomOuterRing(room: Room, wallsById: Map<string, Wall>): Point2D[] | null {
  if (room.vertices.length < 3) {
    return null;
  }

  const roomWalls = room.wallIds
    .map((wallId) => wallsById.get(wallId))
    .filter((wall): wall is Wall => Boolean(wall));
  const matchedEdges = matchRoomEdgesToWalls(room, roomWalls);
  if (!matchedEdges) {
    return null;
  }

  const outerLines = matchedEdges.map((matchedEdge) =>
    chooseRoomEdgeOuterLine(room, matchedEdge)
  );

  if (outerLines.some((line) => !line)) {
    return null;
  }

  const resolvedLines = outerLines.filter(
    (line): line is { start: Point2D; end: Point2D } => Boolean(line)
  );
  return traceOffsetRing(resolvedLines);
}

function traceRoomCenterRing(room: Room, wallsById: Map<string, Wall>): Point2D[] | null {
  if (room.vertices.length < 3) {
    return null;
  }

  const roomWalls = room.wallIds
    .map((wallId) => wallsById.get(wallId))
    .filter((wall): wall is Wall => Boolean(wall));
  const matchedEdges = matchRoomEdgesToWalls(room, roomWalls);
  if (!matchedEdges) {
    return null;
  }

  const centerLines = matchedEdges.map((matchedEdge) =>
    chooseRoomEdgeCenterLine(room, matchedEdge)
  );

  if (centerLines.some((line) => !line)) {
    return null;
  }

  const resolvedLines = centerLines.filter(
    (line): line is { start: Point2D; end: Point2D } => Boolean(line)
  );
  return traceOffsetRing(resolvedLines);
}

export function computeWallSelectionComponents(
  walls: Wall[],
  rooms: Room[],
  selectedWallIds: string[]
): WallSelectionComponent[] {
  const selectedSet = new Set(selectedWallIds);
  if (selectedSet.size === 0) {
    return [];
  }

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
    if (roomWalls.length === 0) {
      return;
    }

    const roomRenderData = computeWallUnionRenderData(roomWalls);
    const tracedOuterRing = traceRoomOuterRing(room, wallsById);
    const tracedCenterRing = traceRoomCenterRing(room, wallsById);
    const roomOuterRings = tracedOuterRing
      ? [tracedOuterRing]
      : roomRenderData.components.flatMap((component) =>
        normalizeOuterRings(component.polygons)
      );
    const roomInnerRing = tracedCenterRing ?? normalizeRing(room.vertices);

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
  if (uncoveredSelectedWalls.length === 0) {
    return selectionComponents;
  }

  const uncoveredWallIds = new Set(uncoveredSelectedWalls.map((wall) => wall.id));
  const uncoveredWalls = walls.filter((wall) => !coveredWallIds.has(wall.id));
  const uncoveredRenderData = computeWallUnionRenderData(uncoveredWalls);

  uncoveredRenderData.components.forEach((component) => {
    if (!component.wallIds.some((wallId) => uncoveredWallIds.has(wallId))) {
      return;
    }

    selectionComponents.push({
      id: `component-selection-${component.id}`,
      wallIds: component.wallIds,
      outerRings: normalizeOuterRings(component.polygons),
      innerRings: normalizeInnerRings(component.polygons),
    });
  });

  return selectionComponents;
}
