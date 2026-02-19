/**
 * WallSnapping
 *
 * Snapping utilities for wall drawing.
 * Grid snap, keypoint snap, and orthogonal locking.
 */

import type { Point2D, Wall, SnapResult, EndpointSnapResult, WallSettings } from '../../../types';
import { ANGLE_CONSTRAINTS } from '../../../types/wall';
import { MM_TO_PX } from '../scale';

// =============================================================================
// Grid Snapping
// =============================================================================

/**
 * Snap a point to the nearest grid point
 */
export function snapToGrid(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

// =============================================================================
// Endpoint Snapping
// =============================================================================

/**
 * Find the nearest wall endpoint within tolerance
 */
export function snapToEndpoint(
  point: Point2D,
  walls: Wall[],
  tolerancePx: number,
  zoom: number,
  excludeWallId?: string
): EndpointSnapResult | null {
  // Convert pixel tolerance to mm based on zoom
  const toleranceMm = tolerancePx / zoom / MM_TO_PX;

  let closest: EndpointSnapResult | null = null;
  let closestDistance = toleranceMm;

  for (const wall of walls) {
    if (wall.id === excludeWallId) continue;

    // Check start point
    const distToStart = distance(point, wall.startPoint);
    if (distToStart < closestDistance) {
      closestDistance = distToStart;
      closest = {
        snappedPoint: { ...wall.startPoint },
        wallId: wall.id,
        endpoint: 'start',
        distance: distToStart,
      };
    }

    // Check end point
    const distToEnd = distance(point, wall.endPoint);
    if (distToEnd < closestDistance) {
      closestDistance = distToEnd;
      closest = {
        snappedPoint: { ...wall.endPoint },
        wallId: wall.id,
        endpoint: 'end',
        distance: distToEnd,
      };
    }
  }

  return closest;
}

/**
 * Find the nearest wall midpoint within tolerance
 */
export function snapToMidpoint(
  point: Point2D,
  walls: Wall[],
  tolerancePx: number,
  zoom: number,
  excludeWallId?: string
): EndpointSnapResult | null {
  const toleranceMm = tolerancePx / zoom / MM_TO_PX;

  let closest: EndpointSnapResult | null = null;
  let closestDistance = toleranceMm;

  for (const wall of walls) {
    if (wall.id === excludeWallId) continue;

    const midpoint = {
      x: (wall.startPoint.x + wall.endPoint.x) / 2,
      y: (wall.startPoint.y + wall.endPoint.y) / 2,
    };

    const distToMidpoint = distance(point, midpoint);
    if (distToMidpoint < closestDistance) {
      closestDistance = distToMidpoint;
      closest = {
        snappedPoint: midpoint,
        wallId: wall.id,
        endpoint: 'midpoint',
        distance: distToMidpoint,
      };
    }
  }

  return closest;
}

/**
 * Euclidean distance between two points
 */
function distance(a: Point2D, b: Point2D): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// =============================================================================
// Angle Locking
// =============================================================================

/**
 * Apply angle locking when Shift key is pressed
 * Constrains the line to predefined angles.
 */
export function applyAngleLock(
  startPoint: Point2D,
  currentPoint: Point2D,
  angles: number[] = ANGLE_CONSTRAINTS
): Point2D {
  const dx = currentPoint.x - startPoint.x;
  const dy = currentPoint.y - startPoint.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length < 0.001) {
    return currentPoint;
  }

  // Calculate current angle in degrees
  const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);

  // Find nearest constrained angle
  let nearestAngle = angles[0];
  let minDiff = Math.abs(normalizeAngle(currentAngle - angles[0]));

  for (const angle of angles) {
    const diff = Math.abs(normalizeAngle(currentAngle - angle));
    if (diff < minDiff) {
      minDiff = diff;
      nearestAngle = angle;
    }
  }

  // Project point to constrained angle
  const radians = nearestAngle * (Math.PI / 180);
  return {
    x: startPoint.x + length * Math.cos(radians),
    y: startPoint.y + length * Math.sin(radians),
  };
}

/**
 * Normalize angle to -180 to 180 range
 */
function normalizeAngle(angle: number): number {
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

// =============================================================================
// Combined Snapping
// =============================================================================

/**
 * Apply all snapping rules to a point
 * Priority: endpoint snap > midpoint snap > orthogonal lock > grid snap
 */
export function snapWallPoint(
  point: Point2D,
  startPoint: Point2D | null,
  settings: WallSettings,
  walls: Wall[],
  shiftPressed: boolean,
  zoom: number,
  excludeWallId?: string
): SnapResult {
  let snappedPoint = { ...point };
  let snapType: SnapResult['snapType'] = 'none';
  let connectedWallId: string | undefined;
  let endpoint: 'start' | 'end' | 'midpoint' | undefined;

  // 1. Try endpoint snapping first (highest priority)
  const endpointSnap = snapToEndpoint(
    point,
    walls,
    settings.endpointSnapTolerance,
    zoom,
    excludeWallId
  );

  if (endpointSnap) {
    snappedPoint = endpointSnap.snappedPoint;
    snapType = 'endpoint';
    connectedWallId = endpointSnap.wallId;
    endpoint = endpointSnap.endpoint;
  }
  // 2. Try midpoint snapping
  else {
    const midpointSnap = snapToMidpoint(
      point,
      walls,
      settings.midpointSnapTolerance,
      zoom,
      excludeWallId
    );

    if (midpointSnap) {
      snappedPoint = midpointSnap.snappedPoint;
      snapType = 'midpoint';
      connectedWallId = midpointSnap.wallId;
      endpoint = midpointSnap.endpoint;
    }
  }

  // 3. Apply orthogonal locking if Shift is pressed and we're drawing from a start point
  if (snapType === 'none' && shiftPressed && startPoint) {
    snappedPoint = applyAngleLock(startPoint, point);
    snapType = 'angle';

    // After orthogonal lock, optionally snap to grid increments
    if (settings.snapToGrid) {
      const dx = snappedPoint.x - startPoint.x;
      const dy = snappedPoint.y - startPoint.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const snappedLength = Math.round(length / settings.gridSize) * settings.gridSize;

      if (length > 0.001) {
        const ratio = snappedLength / length;
        snappedPoint = {
          x: startPoint.x + dx * ratio,
          y: startPoint.y + dy * ratio,
        };
      }
    }
  }
  // 4. Apply grid snapping
  else if (snapType === 'none' && settings.snapToGrid) {
    snappedPoint = snapToGrid(point, settings.gridSize);
    snapType = 'grid';
  }

  return {
    snappedPoint,
    snapType,
    connectedWallId,
    endpoint,
  };
}

// =============================================================================
// Orthogonal Constraint
// =============================================================================

/**
 * Apply orthogonal constraint (horizontal or vertical)
 * Useful for drawing straight walls
 */
export function applyOrthogonalConstraint(startPoint: Point2D, currentPoint: Point2D): Point2D {
  const dx = Math.abs(currentPoint.x - startPoint.x);
  const dy = Math.abs(currentPoint.y - startPoint.y);

  // Constrain to dominant axis
  if (dx > dy) {
    // Horizontal
    return { x: currentPoint.x, y: startPoint.y };
  } else {
    // Vertical
    return { x: startPoint.x, y: currentPoint.y };
  }
}

// =============================================================================
// Intersection Snapping
// =============================================================================

/**
 * Find wall intersection points for potential snapping
 */
export function findWallIntersections(
  walls: Wall[],
  excludeWallIds: string[] = []
): Point2D[] {
  const intersections: Point2D[] = [];
  const excludeSet = new Set(excludeWallIds);

  for (let i = 0; i < walls.length; i++) {
    if (excludeSet.has(walls[i].id)) continue;

    for (let j = i + 1; j < walls.length; j++) {
      if (excludeSet.has(walls[j].id)) continue;

      const intersection = lineSegmentIntersection(
        walls[i].startPoint,
        walls[i].endPoint,
        walls[j].startPoint,
        walls[j].endPoint
      );

      if (intersection) {
        intersections.push(intersection);
      }
    }
  }

  return intersections;
}

/**
 * Find intersection of two line segments
 */
function lineSegmentIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): Point2D | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;

  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 0.0001) {
    return null; // Parallel
  }

  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;

  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;

  // Check if intersection is within both segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: a1.x + t * d1x,
      y: a1.y + t * d1y,
    };
  }

  return null;
}
