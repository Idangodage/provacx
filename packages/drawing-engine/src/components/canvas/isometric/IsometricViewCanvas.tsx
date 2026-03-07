'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { ArchitecturalObjectDefinition } from '../../../data';
import type { HvacElement, Point2D, Room, SymbolInstance2D, Wall } from '../../../types';
import { computeWallUnionRenderData } from '../wall/WallUnionGeometry';
import { createWallOpenings3D } from './Opening3DRenderer';

const VIEW_MARGIN = 1.14;
const EPSILON = 0.001;
const DEFAULT_EMPTY_SIZE = { width: 800, height: 600 };
const ISO_CAMERA_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();
const CAMERA_FOV_DEGREES = 40;
const MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(20);
const MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(88);
const MIN_CAMERA_DISTANCE = 250;
const MAX_CAMERA_DISTANCE = 160000;
const OPENING_SURFACE_INSET_MM = 2;

type WallPalette = {
  top: string;
  side: string;
  outline: string;
};

type SolidPalette = {
  color: string;
  opacity?: number;
};

type WallAssembly = {
  polygons: Point2D[][][];
  baseElevation: number;
  height: number;
  palette: WallPalette;
};

type OpeningSpan = {
  id: string;
  start: number;
  end: number;
  bottom: number;
  top: number;
};

type LabelAnchor = {
  key: string;
  position: THREE.Vector3;
  text: string;
  color: string;
};

type ScreenLabel = {
  key: string;
  x: number;
  y: number;
  text: string;
  color: string;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  contentRoot: THREE.Group;
  geometryRoot: THREE.Group;
};

export interface IsometricViewCanvasProps {
  className?: string;
  walls: Wall[];
  rooms: Room[];
  symbols: SymbolInstance2D[];
  hvacElements: HvacElement[];
  objectDefinitions: ArchitecturalObjectDefinition[];
  viewLabel?: string;
}

function polygonSignedArea(points: Point2D[]): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function sanitizeRing(points: Point2D[]): Point2D[] {
  const cleaned: Point2D[] = [];

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }

    const previous = cleaned[cleaned.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > EPSILON) {
      cleaned.push({ x: point.x, y: point.y });
    }
  }

  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON) {
      cleaned.pop();
    }
  }

  return cleaned;
}

function orientRing(points: Point2D[], clockwise: boolean): Point2D[] {
  const ring = sanitizeRing(points);
  if (ring.length < 3) {
    return ring;
  }

  const isClockwise = polygonSignedArea(ring) < 0;
  if (isClockwise === clockwise) {
    return ring;
  }

  return [...ring].reverse();
}

function buildShapeFromPolygon(polygon: Point2D[][]): THREE.Shape | null {
  const [outerRing, ...holeRings] = polygon;
  const outer = orientRing(outerRing ?? [], false);
  if (outer.length < 3 || Math.abs(polygonSignedArea(outer)) <= EPSILON) {
    return null;
  }

  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (let index = 1; index < outer.length; index += 1) {
    shape.lineTo(outer[index].x, outer[index].y);
  }
  shape.closePath();

  holeRings.forEach((ring) => {
    const hole = orientRing(ring, true);
    if (hole.length < 3 || Math.abs(polygonSignedArea(hole)) <= EPSILON) {
      return;
    }

    const path = new THREE.Path();
    path.moveTo(hole[0].x, hole[0].y);
    for (let index = 1; index < hole.length; index += 1) {
      path.lineTo(hole[index].x, hole[index].y);
    }
    path.closePath();
    shape.holes.push(path);
  });

  return shape;
}

function readNumberProperty(properties: Record<string, unknown>, key: string): number | null {
  const value = properties[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
      return;
    }

    if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function clearGroup(group: THREE.Group): void {
  const children = [...group.children];
  children.forEach((child) => {
    group.remove(child);
    disposeObject(child);
  });
}

function niceStep(target: number): number {
  if (!Number.isFinite(target) || target <= 0) {
    return 1000;
  }

  const exponent = Math.floor(Math.log10(target));
  const base = 10 ** exponent;
  const fraction = target / base;
  if (fraction <= 1) return base;
  if (fraction <= 2) return 2 * base;
  if (fraction <= 5) return 5 * base;
  return 10 * base;
}

function ensurePlanBounds(points: Point2D[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (points.length === 0) {
    return { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 };
  }

  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function fitCameraToBox(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  width: number,
  height: number,
  viewDirection: THREE.Vector3 = ISO_CAMERA_DIRECTION
): THREE.Vector3 {
  const aspect = Math.max(width / Math.max(height, 1), 0.1);
  camera.aspect = aspect;

  if (box.isEmpty()) {
    camera.fov = CAMERA_FOV_DEGREES;
    camera.near = 1;
    camera.far = 50000;
    camera.position.set(6000, 6000, 6000);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return new THREE.Vector3(0, 0, 0);
  }

  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center.clone();
  const radius = Math.max(sphere.radius, 1000);
  const safeDirection = viewDirection.clone().normalize();
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const limitingHalfFov = Math.max(
    Math.min(verticalHalfFov, horizontalHalfFov),
    THREE.MathUtils.degToRad(5)
  );
  const distance = Math.max(
    (radius / Math.sin(limitingHalfFov)) * VIEW_MARGIN,
    radius * 2.25
  );

  camera.up.set(0, 0, 1);
  camera.position.copy(center).addScaledVector(safeDirection, distance);
  camera.near = Math.max(1, distance - radius * 3);
  camera.far = distance + radius * 6;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return center;
}

function resizeCameraFrustum(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number
): void {
  camera.aspect = Math.max(width / Math.max(height, 1), 0.1);
  camera.updateProjectionMatrix();
}

function updateCameraClipping(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3
): void {
  if (box.isEmpty()) {
    return;
  }

  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1000);
  const distance = Math.max(camera.position.distanceTo(sphere.center), radius * 0.5);
  const near = Math.max(1, distance - radius * 3);
  const far = distance + radius * 6;

  if (Math.abs(camera.near - near) > 0.5 || Math.abs(camera.far - far) > 1) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

function updateControlDistanceLimits(controls: OrbitControls, box: THREE.Box3): void {
  if (box.isEmpty()) {
    controls.minDistance = MIN_CAMERA_DISTANCE;
    controls.maxDistance = MAX_CAMERA_DISTANCE;
    return;
  }

  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1000);
  controls.minDistance = Math.max(MIN_CAMERA_DISTANCE, radius * 0.3);
  controls.maxDistance = Math.max(MAX_CAMERA_DISTANCE / 16, radius * 18);
}

function projectLabels(
  anchors: LabelAnchor[],
  camera: THREE.Camera,
  width: number,
  height: number
): ScreenLabel[] {
  return anchors.flatMap((anchor) => {
    const projected = anchor.position.clone().project(camera);
    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      !Number.isFinite(projected.z) ||
      projected.z < -1 ||
      projected.z > 1
    ) {
      return [];
    }

    return [{
      key: anchor.key,
      x: ((projected.x + 1) / 2) * width,
      y: ((1 - projected.y) / 2) * height,
      text: anchor.text,
      color: anchor.color,
    }];
  });
}

function wallPalette(material: Wall['material']): WallPalette {
  switch (material) {
    case 'brick':
      return { top: '#d9b8a4', side: '#b7866b', outline: '#7a5643' };
    case 'concrete':
      return { top: '#d7dde5', side: '#b6c0cb', outline: '#6c7783' };
    case 'partition':
    default:
      return { top: '#e4d2c2', side: '#ba8a6d', outline: '#8a654d' };
  }
}

function solidPalette(category: ArchitecturalObjectDefinition['category'] | 'hvac' | 'unknown'): SolidPalette {
  switch (category) {
    case 'doors':
      return { color: '#c79d74' };
    case 'windows':
      return { color: '#9ecdf5', opacity: 0.55 };
    case 'fixtures':
      return { color: '#96b8a8' };
    case 'symbols':
      return { color: '#c3b4db', opacity: 0.9 };
    case 'furniture':
      return { color: '#8db5c6' };
    case 'my-library':
      return { color: '#aab8c8' };
    case 'hvac':
      return { color: '#7fa5ef' };
    case 'unknown':
    default:
      return { color: '#aab8c8' };
  }
}

function wallStyleKey(wall: Wall): string {
  return [
    wall.material,
    Math.round(wall.properties3D.baseElevation ?? 0),
    Math.round(wall.properties3D.height ?? 2700),
  ].join('|');
}

function buildWallAssemblies(walls: Wall[]): WallAssembly[] {
  const groups = new Map<string, Wall[]>();
  walls.forEach((wall) => {
    const key = wallStyleKey(wall);
    groups.set(key, [...(groups.get(key) ?? []), wall]);
  });

  const assemblies: WallAssembly[] = [];
  groups.forEach((groupWalls) => {
    if (groupWalls.length === 0) {
      return;
    }

    const renderData = computeWallUnionRenderData(groupWalls);
    const baseElevation = groupWalls[0].properties3D.baseElevation ?? 0;
    const height = Math.max(1, groupWalls[0].properties3D.height ?? 2700);
    const palette = wallPalette(groupWalls[0].material);

    renderData.components.forEach((component) => {
      if (component.polygons.length === 0) {
        return;
      }

      assemblies.push({
        polygons: component.polygons,
        baseElevation,
        height,
        palette,
      });
    });
  });

  return assemblies;
}

function wallPlanRing(wall: Wall): Point2D[] {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const len = Math.hypot(dx, dy);
  if (len <= EPSILON) {
    return [];
  }

  const ux = dx / len;
  const uy = dy / len;
  const halfT = Math.max(1, wall.thickness) / 2;
  const px = -uy * halfT;
  const py = ux * halfT;

  return [
    { x: wall.startPoint.x + px, y: wall.startPoint.y + py },
    { x: wall.endPoint.x + px, y: wall.endPoint.y + py },
    { x: wall.endPoint.x - px, y: wall.endPoint.y - py },
    { x: wall.startPoint.x - px, y: wall.startPoint.y - py },
  ];
}

function createWallSegmentMesh(
  segmentLength: number,
  wallThickness: number,
  bottomZ: number,
  topZ: number,
  centerX: number,
  palette: WallPalette,
  options: { showTopOutline?: boolean } = {}
): THREE.Group | null {
  const length = Math.max(0, segmentLength);
  const height = topZ - bottomZ;
  if (length <= EPSILON || height <= EPSILON) {
    return null;
  }

  const group = new THREE.Group();
  const wallBody = new THREE.Mesh(
    new THREE.BoxGeometry(length, wallThickness, height),
    new THREE.MeshStandardMaterial({
      color: palette.side,
      roughness: 0.98,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -0.5,
    })
  );
  wallBody.position.set(centerX, 0, bottomZ + height / 2);
  group.add(wallBody);

  const topCap = new THREE.Mesh(
    new THREE.PlaneGeometry(length, wallThickness),
    new THREE.MeshStandardMaterial({
      color: palette.top,
      roughness: 0.95,
      metalness: 0.01,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  topCap.position.set(centerX, 0, topZ + 0.4);
  group.add(topCap);

  if (options.showTopOutline) {
    const capOutline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(centerX - length / 2, -wallThickness / 2, topZ + 1.2),
        new THREE.Vector3(centerX + length / 2, -wallThickness / 2, topZ + 1.2),
        new THREE.Vector3(centerX + length / 2, wallThickness / 2, topZ + 1.2),
        new THREE.Vector3(centerX - length / 2, wallThickness / 2, topZ + 1.2),
        new THREE.Vector3(centerX - length / 2, -wallThickness / 2, topZ + 1.2),
      ]),
      new THREE.LineBasicMaterial({
        color: palette.outline,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
      })
    );
    group.add(capOutline);
  }

  return group;
}

function openingSpansForWall(wall: Wall): OpeningSpan[] {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const wallLength = Math.hypot(dx, dy);
  if (wallLength <= EPSILON) {
    return [];
  }

  const wallBase = wall.properties3D.baseElevation ?? 0;
  const wallTop = wallBase + Math.max(1, wall.properties3D.height ?? 2700);

  const spans = wall.openings
    .map((opening) => {
      const halfWidth = Math.max(10, opening.width / 2);
      const start = THREE.MathUtils.clamp(opening.position - halfWidth, 0, wallLength);
      const end = THREE.MathUtils.clamp(opening.position + halfWidth, 0, wallLength);
      const bottom = opening.type === 'window'
        ? wallBase + (opening.sillHeight ?? 900)
        : wallBase;
      const top = Math.min(
        wallTop,
        bottom + Math.max(100, opening.height || (opening.type === 'door' ? 2100 : 1200))
      );
      if (end - start <= EPSILON || top - bottom <= EPSILON) {
        return null;
      }
      return {
        id: opening.id,
        start,
        end,
        bottom,
        top,
      } as OpeningSpan;
    })
    .filter((span): span is OpeningSpan => span !== null)
    .sort((left, right) => left.start - right.start);

  return spans;
}

function createWallMeshWithOpenings(
  wall: Wall,
  palette: WallPalette
): THREE.Group | null {
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const wallLength = Math.hypot(dx, dy);
  if (wallLength <= EPSILON) {
    return null;
  }

  const spans = openingSpansForWall(wall);
  if (spans.length === 0) {
    return null;
  }

  const group = new THREE.Group();
  const wallBase = wall.properties3D.baseElevation ?? 0;
  const wallTop = wallBase + Math.max(1, wall.properties3D.height ?? 2700);
  const wallThickness = Math.max(1, wall.thickness);

  // Horizontal gaps with full-height wall body (left/right of openings)
  const occupiedRanges: Array<{ start: number; end: number }> = [];
  spans.forEach((span) => {
    if (occupiedRanges.length === 0) {
      occupiedRanges.push({ start: span.start, end: span.end });
      return;
    }
    const previous = occupiedRanges[occupiedRanges.length - 1];
    if (span.start <= previous.end + EPSILON) {
      previous.end = Math.max(previous.end, span.end);
      return;
    }
    occupiedRanges.push({ start: span.start, end: span.end });
  });

  let cursor = 0;
  occupiedRanges.forEach((range) => {
    if (range.start > cursor + EPSILON) {
      const segment = createWallSegmentMesh(
        range.start - cursor,
        wallThickness,
        wallBase,
        wallTop,
        (cursor + range.start) / 2,
        palette,
        { showTopOutline: true }
      );
      if (segment) {
        group.add(segment);
      }
    }
    cursor = Math.max(cursor, range.end);
  });
  if (cursor < wallLength - EPSILON) {
    const segment = createWallSegmentMesh(
      wallLength - cursor,
      wallThickness,
      wallBase,
      wallTop,
      (cursor + wallLength) / 2,
      palette,
      { showTopOutline: true }
    );
    if (segment) {
      group.add(segment);
    }
  }

  // Lintel and sill segments inside opening widths.
  spans.forEach((span) => {
    if (span.bottom > wallBase + EPSILON) {
      const sillSegment = createWallSegmentMesh(
        span.end - span.start,
        wallThickness,
        wallBase,
        span.bottom,
        (span.start + span.end) / 2,
        palette,
        { showTopOutline: false }
      );
      if (sillSegment) {
        group.add(sillSegment);
      }
    }
    if (span.top < wallTop - EPSILON) {
      const lintelSegment = createWallSegmentMesh(
        span.end - span.start,
        wallThickness,
        span.top,
        wallTop,
        (span.start + span.end) / 2,
        palette,
        { showTopOutline: true }
      );
      if (lintelSegment) {
        group.add(lintelSegment);
      }
    }
  });

  group.position.set(wall.startPoint.x, wall.startPoint.y, 0);
  group.rotation.z = Math.atan2(dy, dx);
  group.name = `wall-with-openings-${wall.id}`;
  return group;
}

function createWallMesh(
  polygon: Point2D[][],
  baseElevation: number,
  height: number,
  palette: WallPalette
): THREE.Group | null {
  const shape = buildShapeFromPolygon(polygon);
  if (!shape || height <= EPSILON) {
    return null;
  }

  const group = new THREE.Group();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, baseElevation);
  geometry.computeVertexNormals();

  const capMaterial = new THREE.MeshStandardMaterial({
    color: palette.top,
    roughness: 0.96,
    metalness: 0.01,
  });
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: palette.side,
    roughness: 0.98,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, [capMaterial, sideMaterial]);
  group.add(mesh);

  polygon.forEach((ring, ringIndex) => {
    const points = sanitizeRing(ring);
    if (points.length < 3) {
      return;
    }

    const outlinePoints = points.map((point) => new THREE.Vector3(point.x, point.y, baseElevation + height + 4));
    outlinePoints.push(outlinePoints[0].clone());

    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: palette.outline,
      transparent: true,
      opacity: ringIndex === 0 ? 0.6 : 0.42,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    });
    group.add(new THREE.Line(outlineGeometry, outlineMaterial));
  });

  return group;
}

function createRoomFloor(room: Room): THREE.Mesh | null {
  const shape = buildShapeFromPolygon([room.vertices]);
  if (!shape) {
    return null;
  }

  const geometry = new THREE.ShapeGeometry(shape);
  const material = new THREE.MeshStandardMaterial({
    color: room.fillColor || '#dbe6d9',
    transparent: true,
    opacity: 0.88,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = (room.properties3D.floorElevation ?? 0) + 2;
  return mesh;
}

function createBoxMesh(
  center: THREE.Vector3,
  width: number,
  depth: number,
  height: number,
  palette: SolidPalette,
  rotationDeg: number
): THREE.Mesh {
  const isTransparent = palette.opacity !== undefined && palette.opacity < 1;
  const geometry = new THREE.BoxGeometry(width, depth, height);
  const material = new THREE.MeshStandardMaterial({
    color: palette.color,
    transparent: palette.opacity !== undefined,
    opacity: palette.opacity ?? 1,
    roughness: 0.92,
    metalness: 0.03,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: isTransparent ? -2 : -1,
    polygonOffsetUnits: isTransparent ? -2 : -1,
    alphaToCoverage: isTransparent,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.rotation.z = THREE.MathUtils.degToRad(rotationDeg);
  mesh.renderOrder = isTransparent ? 24 : 12;
  return mesh;
}

function createPlanGrid(points: Point2D[], elevation: number): THREE.GridHelper {
  const bounds = ensurePlanBounds(points);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const span = Math.max(spanX, spanY, 1000);
  const step = niceStep(span / 10);
  const size = Math.ceil(span / step) * step + step * 2;
  const divisions = Math.max(2, Math.round(size / step));
  const grid = new THREE.GridHelper(size, divisions, 0xd8cec0, 0xd8cec0);
  grid.rotation.x = Math.PI / 2;
  grid.position.set((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, elevation);

  const material = grid.material;
  if (Array.isArray(material)) {
    material.forEach((entry) => {
      entry.transparent = true;
      entry.opacity = 0.18;
      entry.depthWrite = false;
      entry.depthTest = true;
      entry.toneMapped = false;
    });
  } else {
    material.transparent = true;
    material.opacity = 0.18;
    material.depthWrite = false;
    material.depthTest = true;
    material.toneMapped = false;
  }
  // Keep grid behind scene geometry; do not overlay it through walls/objects.
  grid.renderOrder = -10;

  return grid;
}

function definitionFallback(definitionId: string): ArchitecturalObjectDefinition {
  return {
    id: definitionId,
    name: 'Object',
    category: 'my-library',
    type: 'custom',
    widthMm: 900,
    depthMm: 600,
    heightMm: 900,
    tags: ['custom'],
    view: 'plan-2d',
  };
}

export function IsometricViewCanvas({
  className = '',
  walls,
  rooms,
  symbols,
  hvacElements,
  objectDefinitions,
  viewLabel = 'ISOMETRIC VIEW',
}: IsometricViewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const labelAnchorsRef = useRef<LabelAnchor[]>([]);
  const boundsRef = useRef<THREE.Box3 | null>(null);
  const sizeRef = useRef(DEFAULT_EMPTY_SIZE);
  const renderRequestedRef = useRef(true);
  const hasAutoFitRef = useRef(false);
  const [containerSize, setContainerSize] = useState(DEFAULT_EMPTY_SIZE);
  const [screenLabels, setScreenLabels] = useState<ScreenLabel[]>([]);
  const [isEmpty, setIsEmpty] = useState(false);
  const [webglInitError, setWebglInitError] = useState<string | null>(null);

  const definitionsById = useMemo(
    () => new Map(objectDefinitions.map((definition) => [definition.id, definition])),
    [objectDefinitions]
  );
  const wallsById = useMemo(() => new Map(walls.map((wall) => [wall.id, wall])), [walls]);
  const wallsWithoutOpenings = useMemo(
    () => walls.filter((wall) => wall.openings.length === 0),
    [walls]
  );
  const wallsWithOpenings = useMemo(
    () => walls.filter((wall) => wall.openings.length > 0),
    [walls]
  );
  const wallAssemblies = useMemo(() => buildWallAssemblies(wallsWithoutOpenings), [wallsWithoutOpenings]);

  const renderViewport = useCallback(() => {
    const sceneState = sceneRef.current;
    if (!sceneState) {
      return;
    }

    const { renderer, scene, camera } = sceneState;
    const { width, height } = sizeRef.current;
    const box = boundsRef.current;
    if (box) {
      updateCameraClipping(camera, box);
    }
    renderer.render(scene, camera);
    setScreenLabels(projectLabels(labelAnchorsRef.current, camera, width, height));
  }, []);

  const resetView = useCallback(() => {
    const sceneState = sceneRef.current;
    const box = boundsRef.current;
    if (!sceneState || !box) {
      return;
    }

    const { camera, controls } = sceneState;
    const { width, height } = sizeRef.current;
    const target = fitCameraToBox(camera, box, width, height);
    controls.target.copy(target);
    controls.update();
    renderRequestedRef.current = true;
    renderViewport();
  }, [renderViewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas) {
      return;
    }

    setWebglInitError(null);

    const rendererConfigs: Array<
      Pick<THREE.WebGLRendererParameters, 'antialias' | 'alpha' | 'powerPreference' | 'logarithmicDepthBuffer'>
    > = [
      { antialias: true, alpha: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true },
      { antialias: false, alpha: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true },
      { antialias: false, alpha: false, powerPreference: 'default', logarithmicDepthBuffer: true },
      { antialias: false, alpha: true, powerPreference: 'default', logarithmicDepthBuffer: false },
    ];

    let renderer: THREE.WebGLRenderer | null = null;
    let rendererInitError: unknown = null;
    for (const config of rendererConfigs) {
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          ...config,
        });
        break;
      } catch (error) {
        rendererInitError = error;
      }
    }

    if (!renderer) {
      console.error('Isometric renderer initialization failed:', rendererInitError);
      sceneRef.current = null;
      boundsRef.current = null;
      labelAnchorsRef.current = [];
      setScreenLabels([]);
      setIsEmpty(true);
      setWebglInitError(
        'Unable to create WebGL context. Close other 3D tabs or check browser hardware acceleration settings.'
      );
      return;
    }

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      setWebglInitError('WebGL context was lost. Reload the page to restore the isometric view.');
      setScreenLabels([]);
    };

    const handleContextRestored = () => {
      setWebglInitError(null);
      renderRequestedRef.current = true;
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    renderer.setPixelRatio(typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor('#f5efe1', 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f5efe1');

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 1, 50000);
    camera.up.set(0, 0, 1);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.zoomSpeed = 1.1;
    controls.rotateSpeed = 0.72;
    controls.panSpeed = 1.1;
    controls.minPolarAngle = MIN_POLAR_ANGLE;
    controls.maxPolarAngle = MAX_POLAR_ANGLE;
    controls.minDistance = MIN_CAMERA_DISTANCE;
    controls.maxDistance = MAX_CAMERA_DISTANCE;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.cursorStyle = 'grab';
    if (container) {
      controls.listenToKeyEvents(container);
    }
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    const keyLight = new THREE.DirectionalLight(0xfff6ee, 1.15);
    keyLight.position.set(7000, 5000, 9000);
    const fillLight = new THREE.DirectionalLight(0xd9e5f2, 0.55);
    fillLight.position.set(-5000, 4000, 3500);

    scene.add(ambientLight, keyLight, fillLight);

    const contentRoot = new THREE.Group();
    const geometryRoot = new THREE.Group();
    contentRoot.add(geometryRoot);
    scene.add(contentRoot);

    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener('contextmenu', preventContextMenu);

    controls.addEventListener('start', () => {
      canvas.style.cursor = 'grabbing';
      renderRequestedRef.current = true;
    });
    controls.addEventListener('end', () => {
      canvas.style.cursor = 'grab';
      renderRequestedRef.current = true;
    });

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      contentRoot,
      geometryRoot,
    };

    let frameId = 0;
    const animate = () => {
      const changed = controls.update();
      if (changed || renderRequestedRef.current) {
        renderRequestedRef.current = false;
        renderViewport();
      }
      frameId = window.requestAnimationFrame(animate);
    };
    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      controls.stopListenToKeyEvents();
      controls.dispose();
      canvas.removeEventListener('contextmenu', preventContextMenu);
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
      clearGroup(contentRoot);
      renderer.dispose();
      sceneRef.current = null;
    };
  }, [renderViewport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({
          width: Math.max(1, Math.floor(width)),
          height: Math.max(1, Math.floor(height)),
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    sizeRef.current = containerSize;

    const sceneState = sceneRef.current;
    if (!sceneState) {
      return;
    }

    const { renderer, camera, controls } = sceneState;
    const width = Math.max(1, containerSize.width);
    const height = Math.max(1, containerSize.height);
    renderer.setPixelRatio(typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    renderer.setSize(width, height, false);
    resizeCameraFrustum(camera, width, height);
    controls.update();
    renderRequestedRef.current = true;
  }, [containerSize]);

  useEffect(() => {
    const sceneState = sceneRef.current;
    if (!sceneState) {
      return;
    }

    const { camera, controls, contentRoot, geometryRoot } = sceneState;
    clearGroup(geometryRoot);
    [...contentRoot.children].forEach((child) => {
      if (child === geometryRoot) {
        return;
      }

      contentRoot.remove(child);
      disposeObject(child);
    });

    const width = Math.max(1, sizeRef.current.width);
    const height = Math.max(1, sizeRef.current.height);

    const labelAnchors: LabelAnchor[] = [];
    const planPoints: Point2D[] = [];
    let lowestElevation = 0;

    rooms.forEach((room) => {
      const floor = createRoomFloor(room);
      if (floor) {
        geometryRoot.add(floor);
        planPoints.push(...sanitizeRing(room.vertices));
      }

      const floorElevation = room.properties3D.floorElevation ?? 0;
      lowestElevation = Math.min(lowestElevation, floorElevation);
      labelAnchors.push({
        key: `room-${room.id}`,
        position: new THREE.Vector3(room.centroid.x, room.centroid.y, floorElevation + 12),
        text: `${room.name} ${(room.area / 1_000_000).toFixed(1)}m2`,
        color: '#334155',
      });
    });

    wallAssemblies.forEach((assembly, assemblyIndex) => {
      lowestElevation = Math.min(lowestElevation, assembly.baseElevation);

      assembly.polygons.forEach((polygon, polygonIndex) => {
        const wallMesh = createWallMesh(
          polygon,
          assembly.baseElevation,
          assembly.height,
          assembly.palette
        );
        if (!wallMesh) {
          return;
        }

        wallMesh.name = `wall-assembly-${assemblyIndex}-${polygonIndex}`;
        geometryRoot.add(wallMesh);
        polygon.forEach((ring) => {
          planPoints.push(...sanitizeRing(ring));
        });
      });
    });

    wallsWithOpenings.forEach((wall) => {
      const wallMesh = createWallMeshWithOpenings(wall, wallPalette(wall.material));
      if (wallMesh) {
        geometryRoot.add(wallMesh);
      }
      const ring = wallPlanRing(wall);
      if (ring.length >= 3) {
        planPoints.push(...ring);
      }
      lowestElevation = Math.min(lowestElevation, wall.properties3D.baseElevation ?? 0);
    });

    const renderedOpeningIds = new Set<string>();
    walls.forEach((wall) => {
      if (!wall.openings || wall.openings.length === 0) {
        return;
      }

      const openingsGroup = createWallOpenings3D(wall);
      if (openingsGroup.children.length === 0) {
        return;
      }

      openingsGroup.name = `wall-openings-${wall.id}`;
      openingsGroup.renderOrder = 14;
      geometryRoot.add(openingsGroup);
      wall.openings.forEach((opening) => renderedOpeningIds.add(opening.id));
    });

    hvacElements.forEach((element) => {
      const center = new THREE.Vector3(
        element.position.x + element.width / 2,
        element.position.y + element.depth / 2,
        element.elevation + Math.max(80, element.height) / 2
      );
      const mesh = createBoxMesh(
        center,
        Math.max(60, element.width),
        Math.max(60, element.depth),
        Math.max(80, element.height),
        solidPalette('hvac'),
        0
      );
      geometryRoot.add(mesh);

      lowestElevation = Math.min(lowestElevation, element.elevation);
      planPoints.push(
        { x: element.position.x, y: element.position.y },
        { x: element.position.x + element.width, y: element.position.y },
        { x: element.position.x + element.width, y: element.position.y + element.depth },
        { x: element.position.x, y: element.position.y + element.depth }
      );
      labelAnchors.push({
        key: `hvac-${element.id}`,
        position: new THREE.Vector3(
          element.position.x + element.width / 2,
          element.position.y + element.depth / 2,
          element.elevation + Math.max(80, element.height) + 30
        ),
        text: element.label || element.type,
        color: '#1e3a8a',
      });
    });

    symbols.forEach((instance) => {
      const definition = definitionsById.get(instance.symbolId) ?? definitionFallback(instance.symbolId);
      const scaleFactor = Number.isFinite(instance.scale) && instance.scale > 0 ? instance.scale : 1;
      const baseWidth = readNumberProperty(instance.properties, 'widthMm') ?? definition.widthMm;
      const baseDepth = readNumberProperty(instance.properties, 'depthMm') ?? definition.depthMm;
      const baseHeight = readNumberProperty(instance.properties, 'heightMm') ?? definition.heightMm;
      const widthMm = Math.max(
        60,
        baseWidth * scaleFactor
      );
      let depthMm = Math.max(
        40,
        baseDepth * scaleFactor
      );
      const heightMm = Math.max(
        definition.category === 'symbols' ? 140 : 240,
        baseHeight * scaleFactor
      );
      const isOpeningCategory = definition.category === 'doors' || definition.category === 'windows';
      const baseElevationFromProps = readNumberProperty(instance.properties, 'baseElevationMm');
      const baseElevation = baseElevationFromProps ?? (
        definition.category === 'windows'
          ? definition.sillHeightMm ?? 900
          : 0
      );

      // If this door/window is already rendered via wall opening geometry,
      // skip the simplified symbol box to avoid losing detail.
      if (isOpeningCategory && renderedOpeningIds.has(instance.id)) {
        lowestElevation = Math.min(lowestElevation, baseElevation);
        if (definition.category !== 'symbols') {
          labelAnchors.push({
            key: `object-${instance.id}`,
            position: new THREE.Vector3(instance.position.x, instance.position.y, baseElevation + heightMm + 30),
            text: definition.name,
            color: '#334155',
          });
        }
        return;
      }

      if (isOpeningCategory) {
        const hostWallId = typeof instance.properties.hostWallId === 'string'
          ? instance.properties.hostWallId
          : null;
        const hostWallThickness = readNumberProperty(instance.properties, 'hostWallThicknessMm')
          ?? (hostWallId ? wallsById.get(hostWallId)?.thickness : null);
        const targetThickness = hostWallThickness ?? depthMm;
        const inset = Math.min(OPENING_SURFACE_INSET_MM, Math.max(0.8, targetThickness * 0.05));
        depthMm = Math.max(10, targetThickness - inset * 2);
      }
      const mesh = createBoxMesh(
        new THREE.Vector3(instance.position.x, instance.position.y, baseElevation + heightMm / 2),
        widthMm,
        depthMm,
        heightMm,
        solidPalette(definition.category),
        instance.rotation
      );
      geometryRoot.add(mesh);

      lowestElevation = Math.min(lowestElevation, baseElevation);
      const halfWidth = widthMm / 2;
      const halfDepth = depthMm / 2;
      planPoints.push(
        { x: instance.position.x - halfWidth, y: instance.position.y - halfDepth },
        { x: instance.position.x + halfWidth, y: instance.position.y - halfDepth },
        { x: instance.position.x + halfWidth, y: instance.position.y + halfDepth },
        { x: instance.position.x - halfWidth, y: instance.position.y + halfDepth }
      );

      if (definition.category !== 'symbols') {
        labelAnchors.push({
          key: `object-${instance.id}`,
          position: new THREE.Vector3(instance.position.x, instance.position.y, baseElevation + heightMm + 30),
          text: definition.name,
          color: '#334155',
        });
      }
    });

    const hasGeometry = geometryRoot.children.length > 0;
    setIsEmpty(!hasGeometry);
    labelAnchorsRef.current = labelAnchors;

    if (!hasGeometry) {
      boundsRef.current = null;
      hasAutoFitRef.current = false;
      controls.enabled = false;
      setScreenLabels([]);
      fitCameraToBox(camera, new THREE.Box3(), width, height);
      controls.target.set(0, 0, 0);
      controls.update();
      renderRequestedRef.current = true;
      return;
    }

    const grid = createPlanGrid(planPoints, lowestElevation - 1);
    contentRoot.add(grid);

    const box = new THREE.Box3().setFromObject(geometryRoot);
    boundsRef.current = box.clone();
    controls.enabled = true;
    updateControlDistanceLimits(controls, box);
    if (!hasAutoFitRef.current || !box.containsPoint(controls.target)) {
      const target = fitCameraToBox(camera, box, width, height);
      controls.target.copy(target);
      hasAutoFitRef.current = true;
    } else {
      updateCameraClipping(camera, box);
    }
    controls.update();
    renderRequestedRef.current = true;
  }, [definitionsById, hvacElements, rooms, symbols, wallAssemblies, walls, wallsById, wallsWithOpenings]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      tabIndex={0}
      onPointerDown={() => containerRef.current?.focus()}
      style={{
        minHeight: 220,
        background: 'linear-gradient(180deg, #faf5ea 0%, #f1eadf 100%)',
        outline: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        onDoubleClick={resetView}
      />
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-1 -translate-x-1/2 text-[12px] tracking-[0.18em] text-slate-600"
          style={{ fontFamily: 'monospace' }}
        >
          {viewLabel}
        </div>
        {webglInitError && (
          <div
            className="absolute left-1/2 top-1/2 w-[min(92%,680px)] -translate-x-1/2 -translate-y-1/2 rounded border border-rose-300/70 bg-white/90 px-4 py-3 text-center text-sm text-rose-700 shadow"
            style={{ fontFamily: 'monospace' }}
          >
            {webglInitError}
          </div>
        )}
        {isEmpty && !webglInitError && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm text-slate-500"
            style={{ fontFamily: 'monospace' }}
          >
            No plan geometry available for isometric view
          </div>
        )}
        {screenLabels.map((label) => (
          <div
            key={label.key}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border border-slate-300/60 bg-white/82 px-2 py-0.5 text-[11px] shadow-sm"
            style={{
              left: `${label.x}px`,
              top: `${label.y}px`,
              color: label.color,
              fontFamily: 'monospace',
            }}
          >
            {label.text}
          </div>
        ))}
        {!isEmpty && !webglInitError && (
          <div
            className="absolute bottom-3 left-3 rounded border border-slate-300/55 bg-white/76 px-3 py-1.5 text-[11px] text-slate-600 shadow-sm"
            style={{ fontFamily: 'monospace' }}
          >
            Drag rotate | Right-drag pan | Wheel zoom | Double-click reset
          </div>
        )}
      </div>
      <div className="absolute right-3 top-3 flex gap-2">
        <button
          type="button"
          onClick={resetView}
          disabled={isEmpty || Boolean(webglInitError)}
          className="rounded border border-amber-300/80 bg-white/88 px-3 py-1.5 text-xs text-slate-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ fontFamily: 'monospace' }}
        >
          Reset View
        </button>
      </div>
    </div>
  );
}
