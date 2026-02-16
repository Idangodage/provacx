/**
 * WallGeometry
 *
 * Pure geometry functions for wall calculations.
 * All coordinates are in millimeters.
 */

import type { Point2D, Wall, Line, JoinType, JoinData } from '../../../types';

// =============================================================================
// Vector Operations
// =============================================================================

export const GEOMETRY_EPSILON = 1e-6;
const JUNCTION_PARALLEL_EPSILON = 1e-4;
const JUNCTION_MAX_TRIM_BY_THICKNESS_FACTOR = 6;
const JUNCTION_MAX_TRIM_BY_LENGTH_FACTOR = 1.5;
const JUNCTION_MAX_CAP_STRETCH_FACTOR = 6;
const NODE_MERGE_EPSILON = 1e-3;

/**
 * Normalize a vector to unit length
 */
export function normalize(v: Point2D): Point2D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 0.0001) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Get perpendicular vector (rotated 90 degrees counterclockwise)
 */
export function perpendicular(v: Point2D): Point2D {
  return { x: -v.y, y: v.x };
}

/**
 * Get direction vector from start to end
 */
export function direction(start: Point2D, end: Point2D): Point2D {
  return normalize({ x: end.x - start.x, y: end.y - start.y });
}

/**
 * Scale a vector by a scalar
 */
export function scale(v: Point2D, s: number): Point2D {
  return { x: v.x * s, y: v.y * s };
}

/**
 * Add two vectors
 */
export function add(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * Subtract vector b from a
 */
export function subtract(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Dot product of two vectors
 */
export function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Cross product (z-component) of two 2D vectors
 */
export function cross(a: Point2D, b: Point2D): number {
  return a.x * b.y - a.y * b.x;
}

// =============================================================================
// Line Operations
// =============================================================================

/**
 * Find intersection point of two infinite lines
 * Returns null if lines are parallel
 */
export function lineIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): Point2D | null {
  const d1 = subtract(a2, a1);
  const d2 = subtract(b2, b1);
  const result = intersectInfiniteLinesWithParams(a1, d1, b1, d2, GEOMETRY_EPSILON);
  return result?.point ?? null;
}

// =============================================================================
// Offset Line Computation
// =============================================================================

/**
 * Compute interior and exterior offset lines from center-line
 */
export function computeOffsetLines(
  startPoint: Point2D,
  endPoint: Point2D,
  thickness: number
): { interiorLine: Line; exteriorLine: Line } {
  const dir = direction(startPoint, endPoint);
  const perp = perpendicular(dir);
  const halfThickness = thickness / 2;

  // Interior line (offset in positive perpendicular direction)
  const interiorLine: Line = {
    start: add(startPoint, scale(perp, halfThickness)),
    end: add(endPoint, scale(perp, halfThickness)),
  };

  // Exterior line (offset in negative perpendicular direction)
  const exteriorLine: Line = {
    start: add(startPoint, scale(perp, -halfThickness)),
    end: add(endPoint, scale(perp, -halfThickness)),
  };

  return { interiorLine, exteriorLine };
}

// =============================================================================
// Junction Cleanup
// =============================================================================

type EndpointType = 'start' | 'end';
type FaceSide = 'interior' | 'exterior';

interface SharedNodeIncident {
  wallId: string;
  endpoint: EndpointType;
}

interface SharedNode {
  position: Point2D;
  incidents: SharedNodeIncident[];
}

interface FaceRay {
  wallId: string;
  endpoint: EndpointType;
  side: FaceSide;
  origin: Point2D;
  direction: Point2D;
}

interface LineIntersectionResult {
  point: Point2D;
  t: number;
  u: number;
}

function distanceSquared(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function intersectInfiniteLinesWithParams(
  aPoint: Point2D,
  aDirection: Point2D,
  bPoint: Point2D,
  bDirection: Point2D,
  epsilon: number
): LineIntersectionResult | null {
  const denom = cross(aDirection, bDirection);
  if (Math.abs(denom) <= epsilon) return null;

  const delta = subtract(bPoint, aPoint);
  const t = cross(delta, bDirection) / denom;
  const u = cross(delta, aDirection) / denom;
  const point = add(aPoint, scale(aDirection, t));

  return { point, t, u };
}

function isFinitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function getMaxJunctionTrimDistance(wall: Wall, epsilon: number): number {
  const centerLength = Math.sqrt(distanceSquared(wall.startPoint, wall.endPoint));
  const byThickness = wall.thickness * JUNCTION_MAX_TRIM_BY_THICKNESS_FACTOR;
  const byLength = centerLength * JUNCTION_MAX_TRIM_BY_LENGTH_FACTOR;
  return Math.max(epsilon * 10, Math.min(byThickness, byLength));
}

function restoreEndpointFromBase(
  wall: Wall,
  baseFaces: { interiorLine: Line; exteriorLine: Line },
  endpoint: EndpointType
): void {
  if (endpoint === 'start') {
    wall.interiorLine.start = { ...baseFaces.interiorLine.start };
    wall.exteriorLine.start = { ...baseFaces.exteriorLine.start };
    return;
  }

  wall.interiorLine.end = { ...baseFaces.interiorLine.end };
  wall.exteriorLine.end = { ...baseFaces.exteriorLine.end };
}

function buildSharedEndpointNodes(walls: Wall[], epsilon: number): SharedNode[] {
  const nodes: SharedNode[] = [];
  const epsilonSq = epsilon * epsilon;

  for (const wall of walls) {
    const endpoints: Array<{ point: Point2D; endpoint: EndpointType }> = [
      { point: wall.startPoint, endpoint: 'start' },
      { point: wall.endPoint, endpoint: 'end' },
    ];

    for (const { point, endpoint } of endpoints) {
      const existing = nodes.find((node) => distanceSquared(node.position, point) <= epsilonSq);
      if (existing) {
        existing.incidents.push({ wallId: wall.id, endpoint });
      } else {
        nodes.push({
          position: { ...point },
          incidents: [{ wallId: wall.id, endpoint }],
        });
      }
    }
  }

  return nodes.filter((node) => node.incidents.length > 1);
}

function getFaceRay(wall: Wall, endpoint: EndpointType, side: FaceSide): FaceRay {
  if (endpoint === 'start') {
    if (side === 'interior') {
      return {
        wallId: wall.id,
        endpoint,
        side,
        origin: wall.interiorLine.start,
        direction: direction(wall.interiorLine.start, wall.interiorLine.end),
      };
    }
    return {
      wallId: wall.id,
      endpoint,
      side,
      origin: wall.exteriorLine.start,
      direction: direction(wall.exteriorLine.start, wall.exteriorLine.end),
    };
  }

  if (side === 'interior') {
    return {
      wallId: wall.id,
      endpoint,
      side,
      origin: wall.interiorLine.end,
      direction: direction(wall.interiorLine.end, wall.interiorLine.start),
    };
  }
  return {
    wallId: wall.id,
    endpoint,
    side,
    origin: wall.exteriorLine.end,
    direction: direction(wall.exteriorLine.end, wall.exteriorLine.start),
  };
}

/**
 * Rebuild wall faces from center-lines and apply endpoint-junction cleanup.
 *
 * The cleanup trims interior/exterior face rays against neighboring face rays
 * at every shared endpoint node. This removes overlaps and closes small gaps
 * for L/T style junctions without mutating center-lines or wall thickness.
 */
export function rebuildWallFacesWithJunctionCleanup(
  walls: Wall[],
  epsilon: number = GEOMETRY_EPSILON
): Wall[] {
  if (walls.length === 0) return [];

  const baseFacesByWallId = new Map<string, { interiorLine: Line; exteriorLine: Line }>();
  const rebuiltWalls = walls.map((wall) => {
    const baseFaces = computeOffsetLines(wall.startPoint, wall.endPoint, wall.thickness);
    baseFacesByWallId.set(wall.id, baseFaces);
    return {
      ...wall,
      interiorLine: baseFaces.interiorLine,
      exteriorLine: baseFaces.exteriorLine,
    };
  });

  const wallsById = new Map(rebuiltWalls.map((wall) => [wall.id, wall]));
  const nodes = buildSharedEndpointNodes(rebuiltWalls, Math.max(epsilon, NODE_MERGE_EPSILON));

  type TrimKey = `${string}:${EndpointType}:${FaceSide}`;
  const trimmedPoints = new Map<TrimKey, Point2D>();

  for (const node of nodes) {
    if (node.incidents.length === 2) {
      const [incidentA, incidentB] = node.incidents;
      const wallA = wallsById.get(incidentA.wallId);
      const wallB = wallsById.get(incidentB.wallId);

      if (wallA && wallB && wallA.id !== wallB.id) {
        for (const side of ['interior', 'exterior'] as const) {
          const rayA = getFaceRay(wallA, incidentA.endpoint, side);
          const rayB = getFaceRay(wallB, incidentB.endpoint, side);
          const maxTrimA = getMaxJunctionTrimDistance(wallA, epsilon);
          const maxTrimB = getMaxJunctionTrimDistance(wallB, epsilon);

          const intersection = intersectInfiniteLinesWithParams(
            rayA.origin,
            rayA.direction,
            rayB.origin,
            rayB.direction,
            Math.max(epsilon, JUNCTION_PARALLEL_EPSILON)
          );

          let joinPoint: Point2D | null = null;
          if (
            intersection &&
            isFinitePoint(intersection.point) &&
            intersection.t >= -epsilon &&
            intersection.u >= -epsilon &&
            intersection.t <= maxTrimA + epsilon &&
            intersection.u <= maxTrimB + epsilon
          ) {
            joinPoint = intersection.point;
          } else {
            // Near-collinear continuation: avoid miter spikes and close seam.
            joinPoint = midpoint(rayA.origin, rayB.origin);
          }

          trimmedPoints.set(`${rayA.wallId}:${rayA.endpoint}:${rayA.side}` as TrimKey, joinPoint);
          trimmedPoints.set(`${rayB.wallId}:${rayB.endpoint}:${rayB.side}` as TrimKey, joinPoint);
        }

        continue;
      }
    }

    const faceRays: FaceRay[] = [];

    for (const incident of node.incidents) {
      const wall = wallsById.get(incident.wallId);
      if (!wall) continue;

      faceRays.push(
        getFaceRay(wall, incident.endpoint, 'interior'),
        getFaceRay(wall, incident.endpoint, 'exterior')
      );
    }

    for (const current of faceRays) {
      const currentWall = wallsById.get(current.wallId);
      if (!currentWall) continue;

      const currentMaxTrimDistance = getMaxJunctionTrimDistance(currentWall, epsilon);
      let bestSidePenalty = Number.POSITIVE_INFINITY;
      let bestDistance = Number.POSITIVE_INFINITY;
      let bestPoint: Point2D | null = null;

      for (const candidate of faceRays) {
        if (candidate.wallId === current.wallId) continue;
        const candidateWall = wallsById.get(candidate.wallId);
        if (!candidateWall) continue;
        const candidateMaxTrimDistance = getMaxJunctionTrimDistance(candidateWall, epsilon);

        const intersection = intersectInfiniteLinesWithParams(
          current.origin,
          current.direction,
          candidate.origin,
          candidate.direction,
          Math.max(epsilon, JUNCTION_PARALLEL_EPSILON)
        );

        if (!intersection) continue;
        // Trim only in the forward ray direction from the shared node.
        if (intersection.t < -epsilon) continue;
        if (intersection.u < -epsilon) continue;
        if (intersection.t > currentMaxTrimDistance + epsilon) continue;
        if (intersection.u > candidateMaxTrimDistance + epsilon) continue;

        const sidePenalty = candidate.side === current.side ? 0 : 1;
        const distanceAlongCurrent = Math.abs(intersection.t);

        const isBetterPenalty = sidePenalty < bestSidePenalty;
        const isSamePenalty = sidePenalty === bestSidePenalty;
        const isBetterDistance = distanceAlongCurrent + epsilon < bestDistance;

        if (isBetterPenalty || (isSamePenalty && isBetterDistance)) {
          bestSidePenalty = sidePenalty;
          bestDistance = distanceAlongCurrent;
          bestPoint = intersection.point;
        }
      }

      if (!bestPoint) continue;
      if (!isFinitePoint(bestPoint)) continue;

      const key = `${current.wallId}:${current.endpoint}:${current.side}` as TrimKey;
      trimmedPoints.set(key, bestPoint);
    }
  }

  for (const [key, point] of trimmedPoints) {
    const [wallId, endpoint, side] = key.split(':') as [string, EndpointType, FaceSide];
    const wall = wallsById.get(wallId);
    if (!wall) continue;

    if (endpoint === 'start' && side === 'interior') wall.interiorLine.start = point;
    if (endpoint === 'start' && side === 'exterior') wall.exteriorLine.start = point;
    if (endpoint === 'end' && side === 'interior') wall.interiorLine.end = point;
    if (endpoint === 'end' && side === 'exterior') wall.exteriorLine.end = point;
  }

  const epsilonSq = epsilon * epsilon;
  for (const wall of rebuiltWalls) {
    const baseFaces = baseFacesByWallId.get(wall.id);
    if (!baseFaces) continue;

    const maxCapLength = wall.thickness * JUNCTION_MAX_CAP_STRETCH_FACTOR;
    const maxCapLengthSq = maxCapLength * maxCapLength;
    const maxTrimDistance = getMaxJunctionTrimDistance(wall, epsilon);

    for (const endpoint of ['start', 'end'] as const) {
      const interiorPoint = endpoint === 'start' ? wall.interiorLine.start : wall.interiorLine.end;
      const exteriorPoint = endpoint === 'start' ? wall.exteriorLine.start : wall.exteriorLine.end;
      const baseInteriorPoint = endpoint === 'start' ? baseFaces.interiorLine.start : baseFaces.interiorLine.end;
      const baseExteriorPoint = endpoint === 'start' ? baseFaces.exteriorLine.start : baseFaces.exteriorLine.end;

      if (!isFinitePoint(interiorPoint) || !isFinitePoint(exteriorPoint)) {
        restoreEndpointFromBase(wall, baseFaces, endpoint);
        continue;
      }

      const capLenSq = distanceSquared(interiorPoint, exteriorPoint);
      const interiorExtension = Math.sqrt(distanceSquared(interiorPoint, baseInteriorPoint));
      const exteriorExtension = Math.sqrt(distanceSquared(exteriorPoint, baseExteriorPoint));

      const capCollapsed = capLenSq <= epsilonSq;
      const capStretched = capLenSq > maxCapLengthSq;
      const interiorOverExtended = interiorExtension > maxTrimDistance + epsilon;
      const exteriorOverExtended = exteriorExtension > maxTrimDistance + epsilon;

      if (capCollapsed || capStretched || interiorOverExtended || exteriorOverExtended) {
        restoreEndpointFromBase(wall, baseFaces, endpoint);
      }
    }

    const interiorLenSq = distanceSquared(wall.interiorLine.start, wall.interiorLine.end);
    const exteriorLenSq = distanceSquared(wall.exteriorLine.start, wall.exteriorLine.end);

    if (interiorLenSq <= epsilonSq || exteriorLenSq <= epsilonSq) {
      wall.interiorLine = {
        start: { ...baseFaces.interiorLine.start },
        end: { ...baseFaces.interiorLine.end },
      };
      wall.exteriorLine = {
        start: { ...baseFaces.exteriorLine.start },
        end: { ...baseFaces.exteriorLine.end },
      };
    }
  }

  return rebuiltWalls;
}

// =============================================================================
// Wall Angle Calculations
// =============================================================================

/**
 * Get angle of wall in degrees (from start to end)
 */
export function wallAngle(wall: Wall): number {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

/**
 * Get angle between two walls at a shared endpoint
 * Returns angle in degrees (0-180)
 */
export function angleBetweenWalls(wall1: Wall, wall2: Wall, sharedEndpoint: Point2D): number {
  // Determine directions pointing away from shared endpoint
  let dir1: Point2D;
  let dir2: Point2D;

  // For wall1, find direction pointing away from shared endpoint
  const isWall1Start = Math.abs(wall1.startPoint.x - sharedEndpoint.x) < 0.1 &&
                       Math.abs(wall1.startPoint.y - sharedEndpoint.y) < 0.1;
  if (isWall1Start) {
    dir1 = direction(wall1.startPoint, wall1.endPoint);
  } else {
    dir1 = direction(wall1.endPoint, wall1.startPoint);
  }

  // For wall2, find direction pointing away from shared endpoint
  const isWall2Start = Math.abs(wall2.startPoint.x - sharedEndpoint.x) < 0.1 &&
                       Math.abs(wall2.startPoint.y - sharedEndpoint.y) < 0.1;
  if (isWall2Start) {
    dir2 = direction(wall2.startPoint, wall2.endPoint);
  } else {
    dir2 = direction(wall2.endPoint, wall2.startPoint);
  }

  // Calculate angle between directions
  const dotProduct = dot(dir1, dir2);
  const clampedDot = Math.max(-1, Math.min(1, dotProduct));
  const angleRad = Math.acos(clampedDot);
  return angleRad * (180 / Math.PI);
}

/**
 * Calculate the actual angle from dir1 to dir2 (signed, -180 to 180)
 */
export function signedAngleBetween(dir1: Point2D, dir2: Point2D): number {
  const angle = Math.atan2(cross(dir1, dir2), dot(dir1, dir2));
  return angle * (180 / Math.PI);
}

// =============================================================================
// Join Type Determination
// =============================================================================

/**
 * Determine join type based on angle between walls
 * Miter if angle > 30 degrees, butt if <= 30 degrees
 */
export function determineJoinType(angleDegrees: number): JoinType {
  return angleDegrees > 30 ? 'miter' : 'butt';
}

// =============================================================================
// Miter Join Computation
// =============================================================================

export interface MiterJoinResult {
  interiorVertex: Point2D;
  exteriorVertex: Point2D;
}

/**
 * Compute miter join vertices for two walls meeting at a point
 */
export function computeMiterJoin(
  wall1: Wall,
  wall2: Wall,
  joinPoint: Point2D
): MiterJoinResult {
  // Get directions pointing away from join point for each wall
  const isWall1Start = Math.abs(wall1.startPoint.x - joinPoint.x) < 0.1 &&
                       Math.abs(wall1.startPoint.y - joinPoint.y) < 0.1;
  const isWall2Start = Math.abs(wall2.startPoint.x - joinPoint.x) < 0.1 &&
                       Math.abs(wall2.startPoint.y - joinPoint.y) < 0.1;

  // Get offset line endpoints at the join
  let w1Interior: Point2D, w1InteriorDir: Point2D;
  let w1Exterior: Point2D, w1ExteriorDir: Point2D;
  let w2Interior: Point2D, w2InteriorDir: Point2D;
  let w2Exterior: Point2D, w2ExteriorDir: Point2D;

  if (isWall1Start) {
    w1Interior = wall1.interiorLine.start;
    w1InteriorDir = direction(wall1.interiorLine.start, wall1.interiorLine.end);
    w1Exterior = wall1.exteriorLine.start;
    w1ExteriorDir = direction(wall1.exteriorLine.start, wall1.exteriorLine.end);
  } else {
    w1Interior = wall1.interiorLine.end;
    w1InteriorDir = direction(wall1.interiorLine.end, wall1.interiorLine.start);
    w1Exterior = wall1.exteriorLine.end;
    w1ExteriorDir = direction(wall1.exteriorLine.end, wall1.exteriorLine.start);
  }

  if (isWall2Start) {
    w2Interior = wall2.interiorLine.start;
    w2InteriorDir = direction(wall2.interiorLine.start, wall2.interiorLine.end);
    w2Exterior = wall2.exteriorLine.start;
    w2ExteriorDir = direction(wall2.exteriorLine.start, wall2.exteriorLine.end);
  } else {
    w2Interior = wall2.interiorLine.end;
    w2InteriorDir = direction(wall2.interiorLine.end, wall2.interiorLine.start);
    w2Exterior = wall2.exteriorLine.end;
    w2ExteriorDir = direction(wall2.exteriorLine.end, wall2.exteriorLine.start);
  }

  // Find intersection of interior lines
  const interiorVertex = lineIntersection(
    w1Interior,
    add(w1Interior, w1InteriorDir),
    w2Interior,
    add(w2Interior, w2InteriorDir)
  ) || joinPoint;

  // Find intersection of exterior lines
  const exteriorVertex = lineIntersection(
    w1Exterior,
    add(w1Exterior, w1ExteriorDir),
    w2Exterior,
    add(w2Exterior, w2ExteriorDir)
  ) || joinPoint;

  return { interiorVertex, exteriorVertex };
}

// =============================================================================
// Wall Polygon Computation
// =============================================================================

/**
 * Compute wall polygon vertices for rendering
 * Returns vertices in order: interior start, interior end, exterior end, exterior start
 */
export function computeWallPolygon(wall: Wall, joins?: JoinData[]): Point2D[] {
  // Start with basic rectangle from offset lines
  let interiorStart = wall.interiorLine.start;
  let interiorEnd = wall.interiorLine.end;
  let exteriorStart = wall.exteriorLine.start;
  let exteriorEnd = wall.exteriorLine.end;

  // Apply join modifications if provided
  if (joins && joins.length > 0) {
    for (const join of joins) {
      // Check if this join affects the start point
      const isStart = Math.abs(wall.startPoint.x - join.joinPoint.x) < 0.1 &&
                      Math.abs(wall.startPoint.y - join.joinPoint.y) < 0.1;

      if (isStart) {
        interiorStart = join.interiorVertex;
        exteriorStart = join.exteriorVertex;
      } else {
        interiorEnd = join.interiorVertex;
        exteriorEnd = join.exteriorVertex;
      }
    }
  }

  // Return vertices in order for polygon rendering
  return [
    interiorStart,
    interiorEnd,
    exteriorEnd,
    exteriorStart,
  ];
}

/**
 * Compute wall length (center-line length)
 */
export function wallLength(wall: Wall): number {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get wall center point
 */
export function wallCenter(wall: Wall): Point2D {
  return {
    x: (wall.startPoint.x + wall.endPoint.x) / 2,
    y: (wall.startPoint.y + wall.endPoint.y) / 2,
  };
}

/**
 * Get wall bounding box
 */
export function wallBounds(wall: Wall): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  const points = [
    wall.interiorLine.start,
    wall.interiorLine.end,
    wall.exteriorLine.start,
    wall.exteriorLine.end,
  ];

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Check if a point is inside the wall polygon
 */
export function isPointInsideWall(point: Point2D, wall: Wall): boolean {
  const polygon = computeWallPolygon(wall);
  return isPointInPolygon(point, polygon);
}

/**
 * Ray casting algorithm for point in polygon
 */
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

/**
 * Distance from point to wall center-line
 */
export function distanceToWallCenterLine(point: Point2D, wall: Wall): number {
  return distancePointToSegment(point, wall.startPoint, wall.endPoint);
}

/**
 * Distance from point to line segment
 */
function distancePointToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    // Start and end are the same point
    return Math.sqrt(
      (point.x - start.x) ** 2 + (point.y - start.y) ** 2
    );
  }

  // Calculate projection parameter
  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  // Find closest point on segment
  const closestX = start.x + t * dx;
  const closestY = start.y + t * dy;

  return Math.sqrt(
    (point.x - closestX) ** 2 + (point.y - closestY) ** 2
  );
}
