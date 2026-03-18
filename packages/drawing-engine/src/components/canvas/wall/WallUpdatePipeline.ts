/**
 * WallUpdatePipeline
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * THIS FILE IS THE FIX for the two bugs visible in the screenshots:
 *
 * BUG 1: Interior/exterior lines rendering on the centerline
 *   → interiorLine and exteriorLine on the Wall object were computed ONCE when
 *     the wall was created, and NEVER recomputed when the wall was moved or
 *     resized. This meant that during drag, the offset lines were stale —
 *     they pointed in the old direction with the old thickness offset.
 *
 * BUG 2: Wall fill polygons becoming massive diagonal stripes during drag
 *   → Join computation uses interiorLine/exteriorLine to find miter vertices.
 *     With stale offset lines, the line intersections produce garbage vertices,
 *     causing the wall polygon to span the entire room.
 *
 * The fix is a pipeline that runs every time wall geometry changes:
 *   1. refreshOffsetLines(wall) — recompute interior/exterior from current centerline
 *   2. recomputeJoins(wall + neighbors) — find new join vertices
 *   3. validatePolygons() — reject self-intersecting polygons
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import type { Point2D, Wall, JoinData } from '../../../types';

import {
  normalize,
  perpendicular,
  direction,
  add,
  subtract,
  dot,
  cross,
  distance,
  lineIntersection,
  segmentIntersection,
  computeOffsetLines,
  computeWallBodyPolygon,
  wallLength,
} from './WallGeometry';

// =============================================================================
// Constants
// =============================================================================

/** Maximum miter extension as multiple of half-thickness */
const MITER_LIMIT = 2.5;

/** Minimum angle (degrees) for miter join — below this, use butt */
const MIN_ENDPOINT_JOIN_ANGLE = 0.5;
const MIN_ENDPOINT_MITER_ANGLE = 15;
const MIN_SEGMENT_JOIN_ANGLE = 3;

/** Maximum fraction of wall length the miter can extend */
const MAX_MITER_LENGTH_FRACTION = 0.35;

/** Endpoint proximity tolerance (mm) */
const ENDPOINT_TOLERANCE = 2;

/** Connected wall proximity tolerance (mm) */
const CONNECTED_TOLERANCE = 6;

// =============================================================================
// Step 1: Refresh Offset Lines
// =============================================================================

/**
 * Recompute a wall's interiorLine and exteriorLine from its current
 * centerline (startPoint, endPoint) and thickness.
 *
 * THIS IS THE CRITICAL FIX: this function must be called EVERY TIME a wall's
 * startPoint, endPoint, or thickness changes. Previously this was only called
 * once at wall creation time, causing stale offset lines during drag.
 *
 * @mutates wall — updates wall.interiorLine and wall.exteriorLine in place
 */
export function refreshOffsetLines(wall: Wall): void {
  const len = distance(wall.startPoint, wall.endPoint);
  if (len < 0.001) {
    // Degenerate wall — set offset lines to the same point
    wall.interiorLine = {
      start: { ...wall.startPoint },
      end: { ...wall.endPoint },
    };
    wall.exteriorLine = {
      start: { ...wall.startPoint },
      end: { ...wall.endPoint },
    };
    return;
  }

  const { interiorLine, exteriorLine } = computeOffsetLines(
    wall.startPoint,
    wall.endPoint,
    wall.thickness,
    wall.centerlineOffset ?? 0,
  );

  wall.interiorLine = interiorLine;
  wall.exteriorLine = exteriorLine;
}

// =============================================================================
// Step 2: Compute Joins
// =============================================================================

interface JoinMatch {
  endpoint: 'start' | 'end';
  joinPoint: Point2D;
  otherWall: Wall;
  otherEndpoint: 'start' | 'end' | null;
  matchType: 'endpoint' | 'segment';
  angle: number;
}

/**
 * Find all join matches for a single wall against all other walls.
 */
function findJoinMatchesForWall(
  wall: Wall,
  allWalls: Wall[],
): JoinMatch[] {
  const matches: JoinMatch[] = [];

  for (const other of allWalls) {
    if (other.id === wall.id) continue;

    const connected = wall.connectedWalls.includes(other.id) ||
      other.connectedWalls.includes(wall.id);
    const tolerance = connected ? CONNECTED_TOLERANCE : ENDPOINT_TOLERANCE;

    // Check wall start against other endpoints
    const dStartToOtherStart = distance(wall.startPoint, other.startPoint);
    const dStartToOtherEnd = distance(wall.startPoint, other.endPoint);

    if (dStartToOtherStart <= tolerance) {
      const angle = computeAngle(wall, 'start', other, 'start');
      if (angle >= MIN_ENDPOINT_JOIN_ANGLE) {
        matches.push({
          endpoint: 'start',
          joinPoint: midpoint2(wall.startPoint, other.startPoint),
          otherWall: other,
          otherEndpoint: 'start',
          matchType: 'endpoint',
          angle,
        });
      }
    } else if (dStartToOtherEnd <= tolerance) {
      const angle = computeAngle(wall, 'start', other, 'end');
      if (angle >= MIN_ENDPOINT_JOIN_ANGLE) {
        matches.push({
          endpoint: 'start',
          joinPoint: midpoint2(wall.startPoint, other.endPoint),
          otherWall: other,
          otherEndpoint: 'end',
          matchType: 'endpoint',
          angle,
        });
      }
    }

    // Check wall end against other endpoints
    const dEndToOtherStart = distance(wall.endPoint, other.startPoint);
    const dEndToOtherEnd = distance(wall.endPoint, other.endPoint);

    if (dEndToOtherStart <= tolerance) {
      const angle = computeAngle(wall, 'end', other, 'start');
      if (angle >= MIN_ENDPOINT_JOIN_ANGLE) {
        matches.push({
          endpoint: 'end',
          joinPoint: midpoint2(wall.endPoint, other.startPoint),
          otherWall: other,
          otherEndpoint: 'start',
          matchType: 'endpoint',
          angle,
        });
      }
    } else if (dEndToOtherEnd <= tolerance) {
      const angle = computeAngle(wall, 'end', other, 'end');
      if (angle >= MIN_ENDPOINT_JOIN_ANGLE) {
        matches.push({
          endpoint: 'end',
          joinPoint: midpoint2(wall.endPoint, other.endPoint),
          otherWall: other,
          otherEndpoint: 'end',
          matchType: 'endpoint',
          angle,
        });
      }
    }

    // Check T-junctions (wall endpoint hits other's segment)
    for (const ep of ['start', 'end'] as const) {
      const pt = ep === 'start' ? wall.startPoint : wall.endPoint;

      // Skip if already matched as endpoint-to-endpoint
      if (matches.some(m => m.endpoint === ep)) continue;

      const proj = projectToSegment(pt, other.startPoint, other.endPoint);
      if (proj.distance <= tolerance && proj.t > 0.02 && proj.t < 0.98) {
        const angle = computeTJunctionAngle(wall, ep, other);
        if (angle >= MIN_SEGMENT_JOIN_ANGLE) {
          matches.push({
            endpoint: ep,
            joinPoint: proj.point,
            otherWall: other,
            otherEndpoint: null,
            matchType: 'segment',
            angle,
          });
        }
      }
    }
  }

  return matches;
}

/**
 * Compute the angle between two walls at a join.
 * Uses atan2 for numerical stability.
 */
function computeAngle(
  wall: Wall, wallEp: 'start' | 'end',
  other: Wall, otherEp: 'start' | 'end',
): number {
  const wallDir = wallEp === 'start'
    ? direction(wall.startPoint, wall.endPoint)
    : direction(wall.endPoint, wall.startPoint);
  const otherDir = otherEp === 'start'
    ? direction(other.startPoint, other.endPoint)
    : direction(other.endPoint, other.startPoint);

  const angleRad = Math.abs(Math.atan2(cross(wallDir, otherDir), dot(wallDir, otherDir)));
  return angleRad * (180 / Math.PI);
}

/**
 * Compute the angle between a wall endpoint and a host wall's segment.
 */
function computeTJunctionAngle(wall: Wall, ep: 'start' | 'end', host: Wall): number {
  const wallDir = ep === 'start'
    ? direction(wall.startPoint, wall.endPoint)
    : direction(wall.endPoint, wall.startPoint);
  const hostDir = direction(host.startPoint, host.endPoint);

  const perpComponent = Math.abs(cross(wallDir, hostDir));
  const parallelComponent = Math.abs(dot(wallDir, hostDir));
  return Math.atan2(perpComponent, parallelComponent) * (180 / Math.PI);
}

// =============================================================================
// Step 3: Compute Join Geometry (with aggressive clamping)
// =============================================================================

/**
 * Compute miter join vertices with AGGRESSIVE clamping.
 *
 * This is the key fix for the "wall fill extending to infinity" bug.
 * The miter vertex is clamped to a distance that is the minimum of:
 *   1. miterLimit × halfThickness (absolute limit)
 *   2. halfThickness / sin(angle/2) × 1.05 (geometric limit with small margin)
 *   3. shortestWallLength × MAX_MITER_LENGTH_FRACTION (don't extend past wall)
 *
 * If even the clamped vertex produces a self-intersecting polygon, the join
 * falls back to a butt join (flat cap at the join point).
 */
function computeJoinGeometry(
  wall: Wall,
  match: JoinMatch,
): JoinData | null {
  const { endpoint: ep, otherWall: other, otherEndpoint: otherEp, joinPoint, angle } = match;

  // For T-junctions, use butt join
  if (match.matchType === 'segment') {
    return computeButtJoin(wall, other, ep, joinPoint);
  }

  // For corner joins, compute miter with aggressive clamping
  if (otherEp === null) return null;

  const wFaces = getEndpointFaces(wall, ep);
  const oFaces = getEndpointFaces(other, otherEp);
  const shortestLen = Math.min(wallLength(wall), wallLength(other));
  const bevelDirection = computeBevelDirection(wall, other, ep, joinPoint);
  const maxBevelOffset = shortestLen * 0.4;

  // Intersect offset lines to find miter vertices
  const intersect = (a: Point2D, aDir: Point2D, b: Point2D, bDir: Point2D): Point2D =>
    lineIntersection(a, add(a, aDir), b, add(b, bDir)) ?? joinPoint;

  const leftV = intersect(wFaces.left, wFaces.dir, oFaces.right, oFaces.dir);
  const rightV = intersect(wFaces.right, wFaces.dir, oFaces.left, oFaces.dir);

  const rightKind: 'interior' | 'exterior' =
    wFaces.leftKind === 'interior' ? 'exterior' : 'interior';
  const intV = wFaces.leftKind === 'interior' ? leftV : rightV;
  const extV = wFaces.leftKind === 'exterior' ? leftV : rightV;
  const leftReach = distance(joinPoint, leftV);
  const rightReach = distance(joinPoint, rightV);
  const outerKind = leftReach >= rightReach ? wFaces.leftKind : rightKind;
  const outerReach = Math.max(leftReach, rightReach);

  const buildBevelJoin = (): JoinData => {
    const anchors = endpointAnchors(wall, ep);
    return {
      wallId: wall.id,
      otherWallId: other.id,
      endpoint: ep,
      joinPoint,
      joinType: 'bevel',
      angle,
      interiorVertex: outerKind === 'interior' ? anchors.interiorVertex : intV,
      exteriorVertex: outerKind === 'exterior' ? anchors.exteriorVertex : extV,
      bevelDirection,
      maxBevelOffset,
    };
  };

  // === AGGRESSIVE CLAMPING ===
  const halfThickness = Math.max(wall.thickness, other.thickness) / 2;

  // Compute maximum allowed reach from join point
  const halfAngleRad = Math.max(0.05, (angle / 2) * (Math.PI / 180));
  const geometricReach = halfThickness / Math.sin(halfAngleRad);

  const maxReach = Math.min(
    halfThickness * MITER_LIMIT,
    geometricReach * 1.05,
    shortestLen * MAX_MITER_LENGTH_FRACTION,
  );

  if (!Number.isFinite(maxReach) || maxReach <= 0.0001) {
    return buildBevelJoin();
  }

  if (angle < MIN_ENDPOINT_MITER_ANGLE || outerReach > maxReach) {
    return buildBevelJoin();
  }

  // Validate the resulting polygon won't self-intersect
  const testPolygon = buildTestPolygon(wall, ep, intV, extV);
  if (testPolygon && isPolygonSelfIntersecting(testPolygon)) {
    // Miter failed — fall back to basic offset vertices
    return {
      wallId: wall.id,
      otherWallId: other.id,
      endpoint: ep,
      joinPoint,
      joinType: 'bevel',
      angle,
      interiorVertex: outerKind === 'interior' ? endpointAnchors(wall, ep).interiorVertex : intV,
      exteriorVertex: outerKind === 'exterior' ? endpointAnchors(wall, ep).exteriorVertex : extV,
      bevelDirection,
      maxBevelOffset,
    };
  }

  return {
    wallId: wall.id,
    otherWallId: other.id,
    endpoint: ep,
    joinPoint,
    joinType: 'miter',
    angle,
    interiorVertex: intV,
    exteriorVertex: extV,
    bevelDirection,
    maxBevelOffset,
  };
}

/**
 * Clamp a vertex to maxReach distance from the join point.
 */
function clampVertex(vertex: Point2D, joinPoint: Point2D, maxReach: number): Point2D {
  const dist = distance(vertex, joinPoint);
  if (dist <= maxReach || dist < 0.001) return vertex;

  const ratio = maxReach / dist;
  return {
    x: joinPoint.x + (vertex.x - joinPoint.x) * ratio,
    y: joinPoint.y + (vertex.y - joinPoint.y) * ratio,
  };
}

/**
 * Build a test polygon to check for self-intersection before committing.
 */
function buildTestPolygon(
  wall: Wall,
  ep: 'start' | 'end',
  intV: Point2D,
  extV: Point2D,
): Point2D[] | null {
  if (ep === 'start') {
    return [intV, wall.interiorLine.end, wall.exteriorLine.end, extV];
  } else {
    return [wall.interiorLine.start, intV, extV, wall.exteriorLine.start];
  }
}

function endpointAnchors(
  wall: Wall,
  ep: 'start' | 'end',
): { interiorVertex: Point2D; exteriorVertex: Point2D } {
  return ep === 'start'
    ? { interiorVertex: wall.interiorLine.start, exteriorVertex: wall.exteriorLine.start }
    : { interiorVertex: wall.interiorLine.end, exteriorVertex: wall.exteriorLine.end };
}

/**
 * Get the offset line anchors and direction for a wall endpoint.
 */
function getEndpointFaces(
  wall: Wall,
  ep: 'start' | 'end',
): { dir: Point2D; left: Point2D; right: Point2D; leftKind: 'interior' | 'exterior' } {
  const dir = ep === 'start'
    ? direction(wall.startPoint, wall.endPoint)
    : direction(wall.endPoint, wall.startPoint);

  if (ep === 'start') {
    return {
      dir,
      left: wall.interiorLine.start,
      right: wall.exteriorLine.start,
      leftKind: 'interior',
    };
  }

  return {
    dir,
    left: wall.exteriorLine.end,
    right: wall.interiorLine.end,
    leftKind: 'exterior',
  };
}

/**
 * Compute butt join vertices for a T-junction.
 */
function computeButtJoin(
  wall: Wall,
  host: Wall,
  ep: 'start' | 'end',
  joinPoint: Point2D,
): JoinData | null {
  const epPt = ep === 'start' ? wall.startPoint : wall.endPoint;
  const oppPt = ep === 'start' ? wall.endPoint : wall.startPoint;
  const intFallback = ep === 'start' ? wall.interiorLine.start : wall.interiorLine.end;
  const extFallback = ep === 'start' ? wall.exteriorLine.start : wall.exteriorLine.end;

  const approachLen = distance(epPt, oppPt);
  if (approachLen < 0.001) return null;

  const approachDir = direction(oppPt, epPt);
  const hostVec = subtract(host.endPoint, host.startPoint);
  const hostNormal = normalize({ x: -hostVec.y, y: hostVec.x });
  const dotProduct = dot(approachDir, hostNormal);

  // Pick the host face. Use distance-based fallback in the dead zone.
  let useInterior: boolean;
  if (Math.abs(dotProduct) < 0.1) {
    const wallMid = midpoint2(epPt, oppPt);
    const intMid = midpoint2(host.interiorLine.start, host.interiorLine.end);
    const extMid = midpoint2(host.exteriorLine.start, host.exteriorLine.end);
    useInterior = distance(wallMid, intMid) < distance(wallMid, extMid);
  } else {
    useInterior = dotProduct < 0;
  }

  const hostFace = useInterior ? host.interiorLine : host.exteriorLine;

  const intV = lineIntersection(
    wall.interiorLine.start, wall.interiorLine.end,
    hostFace.start, hostFace.end,
  ) ?? intFallback;

  const extV = lineIntersection(
    wall.exteriorLine.start, wall.exteriorLine.end,
    hostFace.start, hostFace.end,
  ) ?? extFallback;

  // Validate — if the computed vertices are too far, fall back
  const maxReach = Math.min(wallLength(wall) * 0.4, wall.thickness * MITER_LIMIT);
  const clampedInt = clampVertex(intV, joinPoint, maxReach);
  const clampedExt = clampVertex(extV, joinPoint, maxReach);

  return {
    wallId: wall.id,
    otherWallId: host.id,
    endpoint: ep,
    joinPoint,
    joinType: 'butt',
    angle: computeTJunctionAngle(wall, ep, host),
    interiorVertex: clampedInt,
    exteriorVertex: clampedExt,
    bevelDirection: computeBevelDirection(wall, host, ep, joinPoint),
    maxBevelOffset: wallLength(wall) * 0.4,
  };
}

/**
 * Compute bevel direction (bisector of the two wall directions).
 */
function computeBevelDirection(
  wall: Wall, other: Wall,
  ep: 'start' | 'end', joinPoint: Point2D,
): Point2D {
  const wallDir = ep === 'start'
    ? direction(wall.startPoint, wall.endPoint)
    : direction(wall.endPoint, wall.startPoint);

  const otherEp = distance(other.startPoint, joinPoint) <= distance(other.endPoint, joinPoint)
    ? 'start' : 'end';
  const otherDir = otherEp === 'start'
    ? direction(other.startPoint, other.endPoint)
    : direction(other.endPoint, other.startPoint);

  const bisector = add(wallDir, otherDir);
  const bisectorLen = Math.hypot(bisector.x, bisector.y);

  // Near-antiparallel: use perpendicular as stable fallback
  if (bisectorLen < 0.05) {
    return perpendicular(wallDir);
  }

  return normalize(bisector);
}

// =============================================================================
// Step 4: Polygon Validation
// =============================================================================

/**
 * Check if a 4-vertex polygon has self-intersecting edges.
 */
function isPolygonSelfIntersecting(polygon: Point2D[]): boolean {
  const n = polygon.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];

    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // skip adjacent
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];

      if (segmentIntersection(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

/**
 * Additional validation: check the polygon area is reasonable.
 * A wall polygon should have an area approximately equal to
 * wallLength × thickness. If it's more than 3× that, something is wrong.
 */
function isPolygonAreaReasonable(polygon: Point2D[], wall: Wall): boolean {
  const area = Math.abs(polygonSignedArea(polygon));
  const expectedArea = wallLength(wall) * wall.thickness;
  return area < expectedArea * 3;
}

function polygonSignedArea(polygon: Point2D[]): number {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return area / 2;
}

// =============================================================================
// Local Helpers
// =============================================================================

function midpoint2(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function projectToSegment(
  point: Point2D, start: Point2D, end: Point2D,
): { point: Point2D; distance: number; t: number } {
  const seg = subtract(end, start);
  const lenSq = seg.x * seg.x + seg.y * seg.y;
  if (lenSq < 1e-10) {
    return { point: { ...start }, distance: distance(point, start), t: 0 };
  }
  const t = Math.max(0, Math.min(1, dot(subtract(point, start), seg) / lenSq));
  const proj = { x: start.x + seg.x * t, y: start.y + seg.y * t };
  return { point: proj, distance: distance(point, proj), t };
}

// =============================================================================
// PUBLIC API: The Pipeline
// =============================================================================

/**
 * Refresh all wall geometry after a wall's points or thickness changed.
 *
 * CALL THIS every time:
 *   - A wall endpoint is dragged
 *   - A wall's thickness is changed
 *   - A wall is rotated
 *   - A new wall is created
 *   - A wall is deleted (call for all remaining walls)
 *
 * @param changedWallIds - IDs of walls that changed (their geometry will be refreshed)
 * @param allWalls - All walls in the scene (mutable — offset lines will be updated in place)
 * @returns Map from wallId → JoinData[] for rendering
 */
export function refreshAllWallGeometry(
  changedWallIds: Set<string>,
  allWalls: Wall[],
): Map<string, JoinData[]> {
  // Step 1: Refresh offset lines for changed walls AND their neighbors
  const wallsToRefresh = new Set<string>(changedWallIds);
  for (const wall of allWalls) {
    if (changedWallIds.has(wall.id)) {
      for (const connectedId of wall.connectedWalls) {
        wallsToRefresh.add(connectedId);
      }
    }
  }

  for (const wall of allWalls) {
    if (wallsToRefresh.has(wall.id)) {
      refreshOffsetLines(wall);
    }
  }

  return computeJoinMapForWalls(new Set(allWalls.map((wall) => wall.id)), allWalls);
}

/**
 * Refresh offset lines for changed walls and compute joins only for a target subset.
 * Useful during interactive dragging where only a few walls are re-rendered.
 */
export function refreshPartialWallGeometry(
  changedWallIds: Set<string>,
  targetWallIds: Set<string>,
  allWalls: Wall[],
): Map<string, JoinData[]> {
  if (targetWallIds.size === 0 || allWalls.length === 0) {
    return new Map<string, JoinData[]>();
  }

  const wallsToRefresh = new Set<string>(changedWallIds);
  for (const wall of allWalls) {
    if (changedWallIds.has(wall.id)) {
      for (const connectedId of wall.connectedWalls) {
        wallsToRefresh.add(connectedId);
      }
    }
  }

  for (const wall of allWalls) {
    if (wallsToRefresh.has(wall.id)) {
      refreshOffsetLines(wall);
    }
  }

  return computeJoinMapForWalls(targetWallIds, allWalls);
}

function computeJoinMapForWalls(
  targetWallIds: Set<string>,
  allWalls: Wall[],
): Map<string, JoinData[]> {
  const joinsMap = new Map<string, JoinData[]>();

  for (const wall of allWalls) {
    if (!targetWallIds.has(wall.id)) {
      continue;
    }

    const matches = findJoinMatchesForWall(wall, allWalls);

    // Pick best match per endpoint (highest angle wins)
    const bestByEndpoint = new Map<'start' | 'end', JoinMatch>();
    for (const match of matches) {
      const existing = bestByEndpoint.get(match.endpoint);
      if (!existing || match.angle > existing.angle) {
        bestByEndpoint.set(match.endpoint, match);
      }
    }

    // Compute geometry for each best match
    const joins: JoinData[] = [];
    for (const match of bestByEndpoint.values()) {
      const joinData = computeJoinGeometry(wall, match);
      if (joinData) {
        joins.push(joinData);
      }
    }

    joinsMap.set(wall.id, joins);
  }

  return joinsMap;
}

/**
 * Convenience: refresh everything (e.g., on initial load or full redraw).
 */
export function refreshAllWalls(allWalls: Wall[]): Map<string, JoinData[]> {
  const allIds = new Set(allWalls.map(w => w.id));
  return refreshAllWallGeometry(allIds, allWalls);
}

/**
 * Convenience: refresh after a single wall's point was moved.
 * Also refreshes all connected walls.
 */
export function refreshAfterPointMove(
  movedWallId: string,
  allWalls: Wall[],
): Map<string, JoinData[]> {
  return refreshAllWallGeometry(new Set([movedWallId]), allWalls);
}

/**
 * Validate a wall polygon and return either the polygon or a safe fallback.
 * Call this AFTER computing the polygon with joins.
 */
export function validateWallPolygon(
  polygon: Point2D[],
  wall: Wall,
): Point2D[] {
  if (polygon.length !== 4) return computeWallBodyPolygon(wall);

  if (isPolygonSelfIntersecting(polygon)) {
    return computeWallBodyPolygon(wall);
  }

  if (!isPolygonAreaReasonable(polygon, wall)) {
    return computeWallBodyPolygon(wall);
  }

  return polygon;
}
