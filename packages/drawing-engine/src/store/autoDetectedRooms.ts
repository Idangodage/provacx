import { bindRoomGeometryTo3D } from '../attributes';
import type { Point2D, Room, Room3D, RoomType, Wall } from '../types';
import { DEFAULT_ROOM_3D } from '../types/wall';
import { generateId } from '../utils/geometry';
import { GeometryEngine } from '../utils/geometry-engine';

import {
  detectRoomPolygons,
  inferRoomType,
  inferRoomTypeFromLayout,
  roomMinimumDimensionWarnings,
  roomTypeFillColor,
} from './roomDetection';

function polygonArea(vertices: Point2D[]): number {
  return GeometryEngine.calculateRoomAreaMm2({ vertices });
}

function polygonPerimeter(vertices: Point2D[]): number {
  return GeometryEngine.calculateRoomPerimeterMm({ vertices });
}

function polygonCentroid(vertices: Point2D[]): Point2D {
  return GeometryEngine.findRoomCentroid({ vertices });
}

function roomSignatureFromWallIds(wallIds: string[]): string {
  return [...new Set(wallIds)].sort().join('|');
}

function bindRoomAttributes(room: Room, defaults?: Partial<Room3D>): Room {
  const computedArea = polygonArea(room.vertices);
  const computedPerimeter = polygonPerimeter(room.vertices);
  const computedCentroid = polygonCentroid(room.vertices);
  const bound = bindRoomGeometryTo3D(
    {
      ...room,
      area: computedArea,
    },
    defaults
  );
  return {
    ...room,
    properties3D: bound.value,
    area: computedArea,
    perimeter: computedPerimeter,
    centroid: computedCentroid,
  };
}

export function createRoomModel(params: {
  vertices: Point2D[];
  wallIds: string[];
  name?: string;
  roomType?: RoomType;
  perimeter?: number;
  centroid?: Point2D;
  finishes?: string;
  notes?: string;
  fillColor?: string;
  showLabel?: boolean;
  adjacentRoomIds?: string[];
  hasWindows?: boolean;
  validationWarnings?: string[];
  isExterior?: boolean;
  properties3D?: Partial<Room3D>;
}): Room {
  const area = polygonArea(params.vertices);
  const areaM2 = area / 1_000_000;
  const roomType = params.roomType ?? inferRoomType(areaM2);
  const roomBase: Room = {
    id: generateId(),
    name: params.name ?? `${roomType} ${new Date().toISOString().slice(11, 16)}`,
    roomType,
    vertices: params.vertices.map((vertex) => ({ ...vertex })),
    wallIds: [...params.wallIds],
    area,
    perimeter: params.perimeter ?? polygonPerimeter(params.vertices),
    centroid: params.centroid ? { ...params.centroid } : polygonCentroid(params.vertices),
    finishes: params.finishes ?? '',
    notes: params.notes ?? '',
    fillColor: params.fillColor ?? roomTypeFillColor(roomType),
    showLabel: params.showLabel ?? true,
    adjacentRoomIds: params.adjacentRoomIds ?? [],
    hasWindows: params.hasWindows ?? false,
    validationWarnings: params.validationWarnings ?? [],
    isExterior: params.isExterior ?? false,
    properties3D: { ...DEFAULT_ROOM_3D },
  };
  return bindRoomAttributes(roomBase, params.properties3D);
}

function buildRoomValidationWarnings(params: {
  areaM2: number;
  roomType: RoomType;
  vertices: Point2D[];
  hasWindows: boolean;
}): string[] {
  const warnings: string[] = [];
  if (params.areaM2 < 2) {
    warnings.push('Room area is below 2m² (possible drawing error).');
  }
  if (!params.hasWindows) {
    warnings.push('No windows detected for this room.');
  }
  warnings.push(...roomMinimumDimensionWarnings(params.roomType, params.vertices));
  return warnings;
}

export function buildAutoDetectedRooms(
  walls: Wall[],
  existingRooms: Room[]
): Room[] {
  if (walls.length < 3) return [];

  const detection = detectRoomPolygons(walls);
  if (detection.faces.length === 0) return [];
  const interiorFaces = detection.faces.filter(
    (face) => face.wallIds.length >= 3 && !detection.exteriorSignatures.has(face.signature)
  );
  if (interiorFaces.length === 0) return [];

  const existingBySignature = new Map<string, Room>();
  existingRooms.forEach((room) => {
    existingBySignature.set(roomSignatureFromWallIds(room.wallIds), room);
  });

  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const usedNames = new Set(existingRooms.map((room) => room.name));
  const nextTypeOrdinal = new Map<RoomType, number>();
  const faceIndicesByWallId = new Map<string, number[]>();
  const adjacencyByFaceIndex = interiorFaces.map(() => new Set<number>());

  interiorFaces.forEach((face, faceIndex) => {
    face.wallIds.forEach((wallId) => {
      faceIndicesByWallId.set(wallId, [...(faceIndicesByWallId.get(wallId) ?? []), faceIndex]);
    });
  });

  faceIndicesByWallId.forEach((indices) => {
    if (indices.length < 2) return;
    for (let i = 0; i < indices.length - 1; i += 1) {
      for (let j = i + 1; j < indices.length; j += 1) {
        const left = indices[i];
        const right = indices[j];
        adjacencyByFaceIndex[left]?.add(right);
        adjacencyByFaceIndex[right]?.add(left);
      }
    }
  });

  const reserveAutoName = (roomType: RoomType): string => {
    let ordinal = nextTypeOrdinal.get(roomType) ?? 1;
    let candidate = `${roomType} ${ordinal}`;
    while (usedNames.has(candidate)) {
      ordinal += 1;
      candidate = `${roomType} ${ordinal}`;
    }
    nextTypeOrdinal.set(roomType, ordinal + 1);
    return candidate;
  };

  const nextRooms: Room[] = [];

  interiorFaces.forEach((face, index) => {
    const signature = roomSignatureFromWallIds(face.wallIds);
    const existing = existingBySignature.get(signature);
    const areaM2 = face.area / 1_000_000;
    const hasWindows = face.wallIds.some((wallId) => {
      const wall = wallById.get(wallId);
      if (!wall) return false;
      return wall.openings.some((opening) => opening.type === 'window');
    });
    const adjacencyCount = adjacencyByFaceIndex[index]?.size ?? 0;
    const exteriorWallCount = face.wallIds.reduce((count, wallId) => (
      (faceIndicesByWallId.get(wallId)?.length ?? 0) <= 1 ? count + 1 : count
    ), 0);
    const exteriorWallRatio = face.wallIds.length > 0
      ? exteriorWallCount / face.wallIds.length
      : 0;
    const inferredType = inferRoomTypeFromLayout({
      areaM2,
      perimeterMm: face.perimeter,
      vertices: face.vertices,
      adjacencyCount,
      exteriorWallRatio,
      hasWindows,
    });
    const resolvedRoomType = existing?.roomType ?? inferredType;
    const validationWarnings = buildRoomValidationWarnings({
      areaM2,
      roomType: resolvedRoomType,
      vertices: face.vertices,
      hasWindows,
    });

    let roomName = existing?.name;
    if (!roomName) {
      roomName = reserveAutoName(resolvedRoomType);
    }
    usedNames.add(roomName);

    const room = createRoomModel({
      vertices: face.vertices,
      wallIds: face.wallIds,
      name: roomName,
      roomType: resolvedRoomType,
      perimeter: face.perimeter,
      centroid: face.centroid,
      finishes: existing?.finishes ?? '',
      notes: existing?.notes ?? '',
      fillColor: existing?.fillColor ?? roomTypeFillColor(resolvedRoomType),
      showLabel: existing?.showLabel ?? true,
      adjacentRoomIds: existing?.adjacentRoomIds ?? [],
      hasWindows,
      validationWarnings,
      isExterior: existing?.isExterior ?? false,
      properties3D: existing?.properties3D,
    });

    if (existing) {
      room.id = existing.id;
    }

    nextRooms.push(room);
  });

  const roomIdsByWall = new Map<string, string[]>();
  nextRooms.forEach((room) => {
    room.wallIds.forEach((wallId) => {
      roomIdsByWall.set(wallId, [...(roomIdsByWall.get(wallId) ?? []), room.id]);
    });
  });
  nextRooms.forEach((room) => {
    const adjacent = new Set<string>();
    room.wallIds.forEach((wallId) => {
      const linked = roomIdsByWall.get(wallId) ?? [];
      linked.forEach((roomId) => {
        if (roomId !== room.id) adjacent.add(roomId);
      });
    });
    room.adjacentRoomIds = [...adjacent];
  });

  return nextRooms;
}
