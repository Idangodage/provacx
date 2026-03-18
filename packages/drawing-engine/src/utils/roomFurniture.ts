import type { Room, SymbolInstance2D } from '../types';

import { GeometryEngine } from './geometry-engine';

export const ROOM_ATTACHMENT_PROPERTY_KEY = 'roomAttachment';

export interface RoomAttachmentMetadata {
  version: 1;
  roomId: string;
  normalizedU: number;
  normalizedV: number;
  rotationOffsetDeg: number;
}

const ATTACHABLE_CATEGORIES = new Set([
  'furniture',
  'fixtures',
  'symbols',
  'my-library',
]);
const MIN_FRAME_SPAN_MM = 1;
const POSITION_EPSILON_MM = 0.01;
const ROTATION_EPSILON_DEG = 0.01;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngleDegrees(value: number): number {
  let angle = value % 360;
  if (angle <= -180) {
    angle += 360;
  }
  if (angle > 180) {
    angle -= 360;
  }
  return angle;
}

function canonicalizeAxisAngleRad(value: number): number {
  let angle = value % Math.PI;
  if (angle < 0) {
    angle += Math.PI;
  }
  return angle;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRoomPrimaryAxisAngleRad(vertices: Array<{ x: number; y: number }>): number {
  if (vertices.length < 2) {
    return 0;
  }

  const centroid = GeometryEngine.findRoomCentroid({ vertices });
  let covarianceXX = 0;
  let covarianceYY = 0;
  let covarianceXY = 0;

  vertices.forEach((vertex) => {
    const dx = vertex.x - centroid.x;
    const dy = vertex.y - centroid.y;
    covarianceXX += dx * dx;
    covarianceYY += dy * dy;
    covarianceXY += dx * dy;
  });

  if (Math.abs(covarianceXX - covarianceYY) > 0.001 || Math.abs(covarianceXY) > 0.001) {
    return canonicalizeAxisAngleRad(
      0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY)
    );
  }

  let longestEdgeAngle = 0;
  let longestEdgeLength = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (!current || !next) {
      continue;
    }
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const length = Math.hypot(dx, dy);
    if (length <= longestEdgeLength) {
      continue;
    }
    longestEdgeLength = length;
    longestEdgeAngle = Math.atan2(dy, dx);
  }

  return canonicalizeAxisAngleRad(longestEdgeAngle);
}

function computeRoomFrame(room: Pick<Room, 'vertices'>): {
  axisAngleRad: number;
  axis: { x: number; y: number };
  normal: { x: number; y: number };
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
} {
  const axisAngleRad = getRoomPrimaryAxisAngleRad(room.vertices);
  const axis = {
    x: Math.cos(axisAngleRad),
    y: Math.sin(axisAngleRad),
  };
  const normal = {
    x: -axis.y,
    y: axis.x,
  };

  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;

  room.vertices.forEach((vertex) => {
    const u = vertex.x * axis.x + vertex.y * axis.y;
    const v = vertex.x * normal.x + vertex.y * normal.y;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  });

  if (!Number.isFinite(minU) || !Number.isFinite(maxU) || !Number.isFinite(minV) || !Number.isFinite(maxV)) {
    return {
      axisAngleRad,
      axis,
      normal,
      minU: 0,
      maxU: MIN_FRAME_SPAN_MM,
      minV: 0,
      maxV: MIN_FRAME_SPAN_MM,
    };
  }

  if (maxU - minU < MIN_FRAME_SPAN_MM) {
    const centerU = (minU + maxU) / 2;
    minU = centerU - MIN_FRAME_SPAN_MM / 2;
    maxU = centerU + MIN_FRAME_SPAN_MM / 2;
  }
  if (maxV - minV < MIN_FRAME_SPAN_MM) {
    const centerV = (minV + maxV) / 2;
    minV = centerV - MIN_FRAME_SPAN_MM / 2;
    maxV = centerV + MIN_FRAME_SPAN_MM / 2;
  }

  return {
    axisAngleRad,
    axis,
    normal,
    minU,
    maxU,
    minV,
    maxV,
  };
}

function attachmentsEqual(
  left: RoomAttachmentMetadata | null,
  right: RoomAttachmentMetadata | null
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.version === right.version &&
    left.roomId === right.roomId &&
    Math.abs(left.normalizedU - right.normalizedU) <= 0.0001 &&
    Math.abs(left.normalizedV - right.normalizedV) <= 0.0001 &&
    Math.abs(left.rotationOffsetDeg - right.rotationOffsetDeg) <= 0.001
  );
}

export function readRoomAttachment(
  properties: Record<string, unknown> | null | undefined
): RoomAttachmentMetadata | null {
  const raw = properties?.[ROOM_ATTACHMENT_PROPERTY_KEY];
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const roomId = typeof candidate.roomId === 'string' ? candidate.roomId.trim() : '';
  const normalizedU = readNumber(candidate.normalizedU);
  const normalizedV = readNumber(candidate.normalizedV);
  const rotationOffsetDeg = readNumber(candidate.rotationOffsetDeg);
  const version = readNumber(candidate.version);

  if (
    roomId.length === 0 ||
    normalizedU === null ||
    normalizedV === null ||
    rotationOffsetDeg === null
  ) {
    return null;
  }

  return {
    version: version === 1 ? 1 : 1,
    roomId,
    normalizedU,
    normalizedV,
    rotationOffsetDeg,
  };
}

export function writeRoomAttachment(
  properties: Record<string, unknown> | null | undefined,
  attachment: RoomAttachmentMetadata | null
): Record<string, unknown> {
  const source = properties ?? {};
  const existing = readRoomAttachment(source);
  if (attachmentsEqual(existing, attachment)) {
    return source;
  }

  const nextProperties = { ...source };
  if (attachment) {
    nextProperties[ROOM_ATTACHMENT_PROPERTY_KEY] = attachment;
  } else {
    delete nextProperties[ROOM_ATTACHMENT_PROPERTY_KEY];
  }
  return nextProperties;
}

export function isRoomAttachmentEligibleCategory(category: string | null | undefined): boolean {
  return typeof category === 'string' && ATTACHABLE_CATEGORIES.has(category);
}

export function isRoomAttachmentEligible(
  symbol: Pick<SymbolInstance2D, 'properties'>,
  category: string | null | undefined
): boolean {
  const hostWallId =
    typeof symbol.properties?.hostWallId === 'string'
      ? symbol.properties.hostWallId.trim()
      : '';
  if (hostWallId.length > 0) {
    return false;
  }
  return isRoomAttachmentEligibleCategory(category);
}

export function createRoomAttachment(
  room: Pick<Room, 'id' | 'vertices'>,
  position: { x: number; y: number },
  rotationDeg: number
): RoomAttachmentMetadata {
  const frame = computeRoomFrame(room);
  const u = position.x * frame.axis.x + position.y * frame.axis.y;
  const v = position.x * frame.normal.x + position.y * frame.normal.y;
  const spanU = Math.max(frame.maxU - frame.minU, MIN_FRAME_SPAN_MM);
  const spanV = Math.max(frame.maxV - frame.minV, MIN_FRAME_SPAN_MM);

  return {
    version: 1,
    roomId: room.id,
    normalizedU: clamp((u - frame.minU) / spanU, 0, 1),
    normalizedV: clamp((v - frame.minV) / spanV, 0, 1),
    rotationOffsetDeg: normalizeAngleDegrees(
      rotationDeg - (frame.axisAngleRad * 180) / Math.PI
    ),
  };
}

export function resolveRoomAttachmentTransform(
  room: Pick<Room, 'vertices'>,
  attachment: RoomAttachmentMetadata
): {
  position: { x: number; y: number };
  rotation: number;
} {
  const frame = computeRoomFrame(room);
  const spanU = Math.max(frame.maxU - frame.minU, MIN_FRAME_SPAN_MM);
  const spanV = Math.max(frame.maxV - frame.minV, MIN_FRAME_SPAN_MM);
  const targetU = frame.minU + spanU * attachment.normalizedU;
  const targetV = frame.minV + spanV * attachment.normalizedV;

  return {
    position: {
      x: frame.axis.x * targetU + frame.normal.x * targetV,
      y: frame.axis.y * targetU + frame.normal.y * targetV,
    },
    rotation: normalizeAngleDegrees(
      (frame.axisAngleRad * 180) / Math.PI + attachment.rotationOffsetDeg
    ),
  };
}

export function findContainingRoom(
  point: { x: number; y: number },
  rooms: Room[]
): Room | null {
  let match: Room | null = null;
  rooms.forEach((room) => {
    if (!GeometryEngine.pointInRoom(point, room)) {
      return;
    }
    if (!match || room.area < match.area) {
      match = room;
    }
  });
  return match;
}

export function syncRoomAttachmentForSymbol(
  symbol: SymbolInstance2D,
  rooms: Room[],
  category: string | null | undefined
): SymbolInstance2D {
  const currentProperties = symbol.properties ?? {};
  if (!isRoomAttachmentEligible(symbol, category)) {
    const clearedProperties = writeRoomAttachment(currentProperties, null);
    return clearedProperties === currentProperties
      ? symbol
      : { ...symbol, properties: clearedProperties };
  }

  const containingRoom = findContainingRoom(symbol.position, rooms);
  const nextAttachment = containingRoom
    ? createRoomAttachment(containingRoom, symbol.position, symbol.rotation)
    : null;
  const nextProperties = writeRoomAttachment(currentProperties, nextAttachment);
  return nextProperties === currentProperties
    ? symbol
    : { ...symbol, properties: nextProperties };
}

export function reconcileRoomAttachedSymbols(params: {
  symbols: SymbolInstance2D[];
  rooms: Room[];
  resolveCategory: (symbol: SymbolInstance2D) => string | null;
}): SymbolInstance2D[] {
  const roomsById = new Map(params.rooms.map((room) => [room.id, room]));
  let didChange = false;

  const nextSymbols = params.symbols.map((symbol) => {
    const category = params.resolveCategory(symbol);
    if (!isRoomAttachmentEligible(symbol, category)) {
      const cleared = syncRoomAttachmentForSymbol(symbol, params.rooms, category);
      if (cleared !== symbol) {
        didChange = true;
      }
      return cleared;
    }

    const attachment = readRoomAttachment(symbol.properties);
    if (attachment) {
      const room = roomsById.get(attachment.roomId);
      if (room) {
        const nextTransform = resolveRoomAttachmentTransform(room, attachment);
        const positionChanged =
          Math.abs(symbol.position.x - nextTransform.position.x) > POSITION_EPSILON_MM ||
          Math.abs(symbol.position.y - nextTransform.position.y) > POSITION_EPSILON_MM;
        const rotationChanged =
          Math.abs(normalizeAngleDegrees(symbol.rotation - nextTransform.rotation)) > ROTATION_EPSILON_DEG;

        if (positionChanged || rotationChanged) {
          didChange = true;
          return {
            ...symbol,
            position: nextTransform.position,
            rotation: nextTransform.rotation,
          };
        }
        return symbol;
      }
    }

    const rebound = syncRoomAttachmentForSymbol(symbol, params.rooms, category);
    if (rebound !== symbol) {
      didChange = true;
    }
    return rebound;
  });

  return didChange ? nextSymbols : params.symbols;
}
