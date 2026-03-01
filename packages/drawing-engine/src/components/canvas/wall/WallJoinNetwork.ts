import type { JoinData, JoinType, Point2D, Wall, WallMaterial } from '../../../types';
import { DEFAULT_BEVEL_CONTROL, DEFAULT_WALL_3D } from '../../../types/wall';

import { computeOffsetLines, lineIntersection } from './WallGeometry';

type Endpoint = 'start' | 'end';
type FaceKind = 'interior' | 'exterior';
type NodeJoinType = Extract<JoinType, 'miter' | 'bevel'>;

interface EndpointFace {
  kind: FaceKind;
  anchor: Point2D;
}

interface WallEndpointRef {
  key: string;
  wall: Wall;
  endpoint: Endpoint;
  point: Point2D;
  direction: Point2D;
  length: number;
  angleDeg: number;
  left: EndpointFace;
  right: EndpointFace;
}

interface EndpointNode {
  point: Point2D;
  endpoints: WallEndpointRef[];
}

interface SegmentAttachment {
  endpoint: WallEndpointRef;
  hostWall: Wall;
  point: Point2D;
  angle: number;
}

interface SectorSolution {
  prev: WallEndpointRef;
  next: WallEndpointRef;
  angleDeg: number;
  joinType: NodeJoinType;
  prevVertex: Point2D;
  nextVertex: Point2D;
}

interface EndpointNodeResolution {
  endpointRef: WallEndpointRef;
  cwNeighbor: WallEndpointRef;
  ccwNeighbor: WallEndpointRef;
  leftVertex: Point2D;
  rightVertex: Point2D;
  leftSectorAngleDeg: number;
  rightSectorAngleDeg: number;
  leftSectorJoinType: NodeJoinType;
  rightSectorJoinType: NodeJoinType;
}

const NODE_TOLERANCE_MM = 2;
const SEGMENT_TOLERANCE_MM = 2;
const MIN_ENDPOINT_JOIN_ANGLE_DEG = 0.5;
const MAX_ENDPOINT_JOIN_ANGLE_DEG = 359.5;
const MIN_SEGMENT_JOIN_ANGLE_DEG = 3;
const ACUTE_BEVEL_THRESHOLD_DEG = 30;

function pointDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function copyPoint(point: Point2D): Point2D {
  return { x: point.x, y: point.y };
}

function normalize(vector: Point2D): Point2D {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.000001) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function add(a: Point2D, b: Point2D): Point2D {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

function lineFromAnchor(anchor: Point2D, direction: Point2D): Point2D {
  return {
    x: anchor.x + direction.x,
    y: anchor.y + direction.y,
  };
}

function normalizeAngleDeg(angleDeg: number): number {
  let normalized = angleDeg % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function ccwAngleDeg(fromDeg: number, toDeg: number): number {
  return normalizeAngleDeg(toDeg - fromDeg);
}

function signedAngleDegrees(from: Point2D, to: Point2D): number {
  const cross = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y;
  return Math.atan2(cross, dot) * (180 / Math.PI);
}

function computeBisector(a: Point2D, b: Point2D): Point2D {
  const bisector = normalize({
    x: a.x + b.x,
    y: a.y + b.y,
  });

  if (Math.hypot(bisector.x, bisector.y) < 0.000001) {
    return a;
  }

  return bisector;
}

function computeMaxBevelOffset(lengths: number[]): number {
  if (lengths.length === 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(...lengths.map((length) => Math.max(0, length / 2)))
  );
}

function projectPointToSegment(
  point: Point2D,
  start: Point2D,
  end: Point2D
): { point: Point2D; distance: number; t: number } {
  const segment = {
    x: end.x - start.x,
    y: end.y - start.y,
  };
  const lengthSq = segment.x * segment.x + segment.y * segment.y;

  if (lengthSq < 0.000001) {
    return {
      point: copyPoint(start),
      distance: pointDistance(point, start),
      t: 0,
    };
  }

  const tRaw =
    ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) / lengthSq;
  const t = Math.max(0, Math.min(1, tRaw));

  return {
    point: {
      x: start.x + segment.x * t,
      y: start.y + segment.y * t,
    },
    distance: pointDistance(point, {
      x: start.x + segment.x * t,
      y: start.y + segment.y * t,
    }),
    t,
  };
}

function endpointKey(wallId: string, endpoint: Endpoint): string {
  return `${wallId}:${endpoint}`;
}

function directionAwayFromEndpoint(wall: Wall, endpoint: Endpoint): Point2D {
  return endpoint === 'start'
    ? normalize({
      x: wall.endPoint.x - wall.startPoint.x,
      y: wall.endPoint.y - wall.startPoint.y,
    })
    : normalize({
      x: wall.startPoint.x - wall.endPoint.x,
      y: wall.startPoint.y - wall.endPoint.y,
    });
}

function wallLength(wall: Wall): number {
  return pointDistance(wall.startPoint, wall.endPoint);
}

function buildEndpointRef(wall: Wall, endpoint: Endpoint): WallEndpointRef {
  const direction = directionAwayFromEndpoint(wall, endpoint);
  const point = endpoint === 'start' ? wall.startPoint : wall.endPoint;
  const angleDeg = normalizeAngleDeg(Math.atan2(direction.y, direction.x) * (180 / Math.PI));

  if (endpoint === 'start') {
    return {
      key: endpointKey(wall.id, endpoint),
      wall,
      endpoint,
      point,
      direction,
      length: wallLength(wall),
      angleDeg,
      left: { kind: 'interior', anchor: wall.interiorLine.start },
      right: { kind: 'exterior', anchor: wall.exteriorLine.start },
    };
  }

  return {
    key: endpointKey(wall.id, endpoint),
    wall,
    endpoint,
    point,
    direction,
    length: wallLength(wall),
    angleDeg,
    left: { kind: 'exterior', anchor: wall.exteriorLine.end },
    right: { kind: 'interior', anchor: wall.interiorLine.end },
  };
}

function buildEndpointNodes(walls: Wall[]): {
  nodes: EndpointNode[];
  nodeByEndpointKey: Map<string, EndpointNode>;
} {
  const refs = walls.flatMap((wall) => [
    buildEndpointRef(wall, 'start'),
    buildEndpointRef(wall, 'end'),
  ]);
  const nodes: EndpointNode[] = [];
  const nodeByEndpointKey = new Map<string, EndpointNode>();

  for (const ref of refs) {
    let node = nodes.find((candidate) => pointDistance(candidate.point, ref.point) <= NODE_TOLERANCE_MM);
    if (!node) {
      node = {
        point: copyPoint(ref.point),
        endpoints: [],
      };
      nodes.push(node);
    } else if (node.endpoints.length > 0) {
      const count = node.endpoints.length + 1;
      node.point = {
        x: (node.point.x * node.endpoints.length + ref.point.x) / count,
        y: (node.point.y * node.endpoints.length + ref.point.y) / count,
      };
    }

    node.endpoints.push(ref);
    nodeByEndpointKey.set(ref.key, node);
  }

  return { nodes, nodeByEndpointKey };
}

function solveSector(prev: WallEndpointRef, next: WallEndpointRef): SectorSolution {
  const angleDeg = ccwAngleDeg(prev.angleDeg, next.angleDeg);
  const effectiveCornerAngleDeg = Math.min(angleDeg, 360 - angleDeg);
  const isExteriorReflexSector = angleDeg > 180;
  const shouldFlatBevel =
    Number.isFinite(effectiveCornerAngleDeg) &&
    effectiveCornerAngleDeg >= MIN_ENDPOINT_JOIN_ANGLE_DEG &&
    effectiveCornerAngleDeg < ACUTE_BEVEL_THRESHOLD_DEG &&
    isExteriorReflexSector;

  const miterPoint =
    lineIntersection(
      prev.left.anchor,
      lineFromAnchor(prev.left.anchor, prev.direction),
      next.right.anchor,
      lineFromAnchor(next.right.anchor, next.direction)
    ) ?? null;

  if (
    shouldFlatBevel ||
    !miterPoint ||
    !Number.isFinite(angleDeg) ||
    angleDeg <= MIN_ENDPOINT_JOIN_ANGLE_DEG ||
    angleDeg >= MAX_ENDPOINT_JOIN_ANGLE_DEG
  ) {
    return {
      prev,
      next,
      angleDeg: effectiveCornerAngleDeg,
      joinType: shouldFlatBevel ? 'bevel' : 'miter',
      prevVertex: copyPoint(prev.left.anchor),
      nextVertex: copyPoint(next.right.anchor),
    };
  }

  return {
    prev,
    next,
    angleDeg: effectiveCornerAngleDeg,
    joinType: 'miter',
    prevVertex: copyPoint(miterPoint),
    nextVertex: copyPoint(miterPoint),
  };
}

function sectorKey(prev: WallEndpointRef, next: WallEndpointRef): string {
  return `${prev.key}->${next.key}`;
}

function solveEndpointNode(node: EndpointNode): EndpointNodeResolution[] {
  const sorted = [...node.endpoints].sort((a, b) => a.angleDeg - b.angleDeg);
  const sectors = new Map<string, SectorSolution>();

  for (let index = 0; index < sorted.length; index += 1) {
    const prev = sorted[index];
    const next = sorted[(index + 1) % sorted.length];
    sectors.set(sectorKey(prev, next), solveSector(prev, next));
  }

  return sorted.map((endpointRef, index) => {
    const cwNeighbor = sorted[(index - 1 + sorted.length) % sorted.length];
    const ccwNeighbor = sorted[(index + 1) % sorted.length];
    const rightSector = sectors.get(sectorKey(cwNeighbor, endpointRef));
    const leftSector = sectors.get(sectorKey(endpointRef, ccwNeighbor));

    if (!rightSector || !leftSector) {
      throw new Error('Wall join sector resolution failed');
    }

    return {
      endpointRef,
      cwNeighbor,
      ccwNeighbor,
      leftVertex: copyPoint(leftSector.prevVertex),
      rightVertex: copyPoint(rightSector.nextVertex),
      leftSectorAngleDeg: leftSector.angleDeg,
      rightSectorAngleDeg: rightSector.angleDeg,
      leftSectorJoinType: leftSector.joinType,
      rightSectorJoinType: rightSector.joinType,
    };
  });
}

function endpointVertices(
  endpointRef: WallEndpointRef,
  leftVertex: Point2D,
  rightVertex: Point2D
): { interiorVertex: Point2D; exteriorVertex: Point2D } {
  return endpointRef.left.kind === 'interior'
    ? {
      interiorVertex: leftVertex,
      exteriorVertex: rightVertex,
    }
    : {
      interiorVertex: rightVertex,
      exteriorVertex: leftVertex,
    };
}

function selectPrimaryNeighbor(resolution: EndpointNodeResolution): WallEndpointRef {
  const leftPriority = resolution.leftSectorAngleDeg <= resolution.rightSectorAngleDeg;
  return leftPriority ? resolution.ccwNeighbor : resolution.cwNeighbor;
}

function computeNodeBevelDirection(resolution: EndpointNodeResolution): Point2D {
  const { endpointRef, cwNeighbor, ccwNeighbor } = resolution;
  const hasLeftBevel = resolution.leftSectorJoinType === 'bevel';
  const hasRightBevel = resolution.rightSectorJoinType === 'bevel';

  if (hasLeftBevel && !hasRightBevel) {
    return computeBisector(endpointRef.direction, ccwNeighbor.direction);
  }

  if (hasRightBevel && !hasLeftBevel) {
    return computeBisector(cwNeighbor.direction, endpointRef.direction);
  }

  if (cwNeighbor.key === ccwNeighbor.key) {
    return computeBisector(endpointRef.direction, cwNeighbor.direction);
  }

  return computeBisector(cwNeighbor.direction, ccwNeighbor.direction);
}

function buildNodeJoinData(
  node: EndpointNode,
  resolution: EndpointNodeResolution
): JoinData {
  const { endpointRef, cwNeighbor, ccwNeighbor } = resolution;
  const vertices = endpointVertices(endpointRef, resolution.leftVertex, resolution.rightVertex);
  const joinType: NodeJoinType =
    resolution.leftSectorJoinType === 'bevel' || resolution.rightSectorJoinType === 'bevel'
      ? 'bevel'
      : 'miter';
  const other = selectPrimaryNeighbor(resolution);

  return {
    wallId: endpointRef.wall.id,
    otherWallId: other.wall.id,
    endpoint: endpointRef.endpoint,
    joinPoint: copyPoint(node.point),
    joinType,
    angle: Math.min(resolution.leftSectorAngleDeg, resolution.rightSectorAngleDeg),
    interiorVertex: vertices.interiorVertex,
    exteriorVertex: vertices.exteriorVertex,
    bevelDirection: computeNodeBevelDirection(resolution),
    maxBevelOffset: computeMaxBevelOffset([
      endpointRef.length,
      cwNeighbor.length,
      ccwNeighbor.length,
    ]),
  };
}

function computeButtJoinVertices(
  endpointRef: WallEndpointRef,
  hostWall: Wall
): { interiorVertex: Point2D; exteriorVertex: Point2D } {
  const endpointPoint = endpointRef.point;
  const oppositePoint =
    endpointRef.endpoint === 'start' ? endpointRef.wall.endPoint : endpointRef.wall.startPoint;
  const interiorFallback =
    endpointRef.endpoint === 'start'
      ? endpointRef.wall.interiorLine.start
      : endpointRef.wall.interiorLine.end;
  const exteriorFallback =
    endpointRef.endpoint === 'start'
      ? endpointRef.wall.exteriorLine.start
      : endpointRef.wall.exteriorLine.end;

  const approachVector = {
    x: endpointPoint.x - oppositePoint.x,
    y: endpointPoint.y - oppositePoint.y,
  };
  const approachLength = Math.hypot(approachVector.x, approachVector.y);
  const hostVector = {
    x: hostWall.endPoint.x - hostWall.startPoint.x,
    y: hostWall.endPoint.y - hostWall.startPoint.y,
  };
  const hostLength = Math.hypot(hostVector.x, hostVector.y);

  if (approachLength < 0.0001 || hostLength < 0.0001) {
    return {
      interiorVertex: interiorFallback,
      exteriorVertex: exteriorFallback,
    };
  }

  const approachDir = {
    x: approachVector.x / approachLength,
    y: approachVector.y / approachLength,
  };
  const hostNormal = {
    x: -hostVector.y / hostLength,
    y: hostVector.x / hostLength,
  };
  const useInteriorFace =
    approachDir.x * hostNormal.x + approachDir.y * hostNormal.y < 0;
  const hostFace = useInteriorFace ? hostWall.interiorLine : hostWall.exteriorLine;

  return {
    interiorVertex:
      lineIntersection(
        endpointRef.wall.interiorLine.start,
        endpointRef.wall.interiorLine.end,
        hostFace.start,
        hostFace.end
      ) ?? interiorFallback,
    exteriorVertex:
      lineIntersection(
        endpointRef.wall.exteriorLine.start,
        endpointRef.wall.exteriorLine.end,
        hostFace.start,
        hostFace.end
      ) ?? exteriorFallback,
  };
}

function findSegmentAttachment(
  endpointRef: WallEndpointRef,
  walls: Wall[],
  nodeByEndpointKey: Map<string, EndpointNode>
): SegmentAttachment | null {
  const endpointNode = nodeByEndpointKey.get(endpointRef.key);
  if (endpointNode && endpointNode.endpoints.length > 1) {
    return null;
  }

  let best: SegmentAttachment | null = null;

  for (const otherWall of walls) {
    if (otherWall.id === endpointRef.wall.id) continue;

    const projection = projectPointToSegment(
      endpointRef.point,
      otherWall.startPoint,
      otherWall.endPoint
    );
    if (projection.distance > SEGMENT_TOLERANCE_MM) {
      continue;
    }
    if (
      pointDistance(projection.point, otherWall.startPoint) <= NODE_TOLERANCE_MM ||
      pointDistance(projection.point, otherWall.endPoint) <= NODE_TOLERANCE_MM
    ) {
      continue;
    }

    const hostDirection = normalize({
      x: otherWall.endPoint.x - otherWall.startPoint.x,
      y: otherWall.endPoint.y - otherWall.startPoint.y,
    });
    const alignment = Math.abs(
      endpointRef.direction.x * hostDirection.x + endpointRef.direction.y * hostDirection.y
    );
    const angle = Math.acos(Math.max(-1, Math.min(1, alignment))) * (180 / Math.PI);
    if (angle < MIN_SEGMENT_JOIN_ANGLE_DEG) {
      continue;
    }

    if (!best || projection.distance < pointDistance(endpointRef.point, best.point)) {
      best = {
        endpoint: endpointRef,
        hostWall: otherWall,
        point: projection.point,
        angle,
      };
    }
  }

  return best;
}

function mergeJoin(joinsMap: Map<string, JoinData[]>, join: JoinData): void {
  const joins = joinsMap.get(join.wallId) ?? [];
  const filtered = joins.filter((existing) => existing.endpoint !== join.endpoint);
  filtered.push(join);
  joinsMap.set(join.wallId, filtered);
}

export function computeWallJoinMap(walls: Wall[]): Map<string, JoinData[]> {
  const joinsMap = new Map<string, JoinData[]>();
  const { nodes, nodeByEndpointKey } = buildEndpointNodes(walls);

  for (const node of nodes) {
    if (node.endpoints.length < 2) {
      continue;
    }

    const resolutions = solveEndpointNode(node);
    for (const resolution of resolutions) {
      mergeJoin(joinsMap, buildNodeJoinData(node, resolution));
    }
  }

  const endpointRefs = walls.flatMap((wall) => [
    buildEndpointRef(wall, 'start'),
    buildEndpointRef(wall, 'end'),
  ]);

  for (const endpointRef of endpointRefs) {
    const existingJoin = (joinsMap.get(endpointRef.wall.id) ?? []).find(
      (join) => join.endpoint === endpointRef.endpoint
    );
    if (existingJoin) {
      continue;
    }

    const attachment = findSegmentAttachment(endpointRef, walls, nodeByEndpointKey);
    if (!attachment) {
      continue;
    }

    const vertices = computeButtJoinVertices(endpointRef, attachment.hostWall);
    mergeJoin(joinsMap, {
      wallId: endpointRef.wall.id,
      otherWallId: attachment.hostWall.id,
      endpoint: endpointRef.endpoint,
      joinPoint: copyPoint(attachment.point),
      joinType: 'butt',
      angle: attachment.angle,
      interiorVertex: vertices.interiorVertex,
      exteriorVertex: vertices.exteriorVertex,
    });
  }

  return joinsMap;
}

export function buildTemporaryWall(
  id: string,
  startPoint: Point2D,
  endPoint: Point2D,
  thickness: number,
  material: WallMaterial
): Wall {
  const { interiorLine, exteriorLine } = computeOffsetLines(startPoint, endPoint, thickness);

  return {
    id,
    startPoint: copyPoint(startPoint),
    endPoint: copyPoint(endPoint),
    thickness,
    material,
    layer: 'partition',
    interiorLine,
    exteriorLine,
    startBevel: { ...DEFAULT_BEVEL_CONTROL },
    endBevel: { ...DEFAULT_BEVEL_CONTROL },
    connectedWalls: [],
    openings: [],
    properties3D: { ...DEFAULT_WALL_3D },
  };
}
