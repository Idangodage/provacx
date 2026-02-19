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
  const crossD = cross(d1, d2);

  // Parallel lines
  if (Math.abs(crossD) < 0.0001) {
    return null;
  }

  const d = subtract(b1, a1);
  const t = cross(d, d2) / crossD;

  return {
    x: a1.x + d1.x * t,
    y: a1.y + d1.y * t,
  };
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
  const JOIN_ENDPOINT_TOLERANCE = 2;

  // Start with basic rectangle from offset lines
  let interiorStart = wall.interiorLine.start;
  let interiorEnd = wall.interiorLine.end;
  let exteriorStart = wall.exteriorLine.start;
  let exteriorEnd = wall.exteriorLine.end;

  // Apply join modifications if provided
  if (joins && joins.length > 0) {
    for (const join of joins) {
      const startDistance = Math.hypot(
        wall.startPoint.x - join.joinPoint.x,
        wall.startPoint.y - join.joinPoint.y
      );
      const endDistance = Math.hypot(
        wall.endPoint.x - join.joinPoint.x,
        wall.endPoint.y - join.joinPoint.y
      );

      if (Math.min(startDistance, endDistance) > JOIN_ENDPOINT_TOLERANCE) {
        continue;
      }

      // Apply the join to whichever endpoint is closer to the join point.
      const isStart = startDistance <= endDistance;

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
