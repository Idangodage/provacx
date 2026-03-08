/**
 * Singleton Three.js renderer for 3D furniture previews.
 *
 * Uses a single offscreen WebGLRenderer to avoid GPU context exhaustion.
 * Geometry is built once per renderType and cached.
 */

import * as THREE from 'three';
import { createLightingRig } from './lighting';
import { buildDiningChair, buildOfficeChair, buildArmchair } from './geometry/chairs';
import { buildDiningTable, buildRoundTable, buildCoffeeTable } from './geometry/tables';
import { buildSofa } from './geometry/sofas';
import { buildBed } from './geometry/beds';
import {
  buildNightstand,
  buildDresser,
  buildWardrobe,
  buildTvStand,
  buildBookshelf,
  buildBuffet,
} from './geometry/storage';
import { buildSink, buildStove, buildFridge } from './geometry/kitchen';
import { buildToilet, buildBathtub, buildShower } from './geometry/bathroom';

const SHARED_GEOMETRY_CACHE = new Map<string, THREE.Group>();

function buildFurnitureGeometry(renderType: string): THREE.Group {
  switch (renderType) {
    case 'dining-chair':
      return buildDiningChair();
    case 'office-chair':
      return buildOfficeChair();
    case 'armchair':
      return buildArmchair();
    case 'sofa-2':
      return buildSofa(2);
    case 'sofa-3':
      return buildSofa(3);
    case 'dining-table':
      return buildDiningTable();
    case 'round-table':
      return buildRoundTable();
    case 'coffee-table':
      return buildCoffeeTable();
    case 'bed-single':
      return buildBed('single');
    case 'bed-double':
      return buildBed('double');
    case 'bed-queen':
      return buildBed('queen');
    case 'bed-king':
      return buildBed('king');
    case 'nightstand':
      return buildNightstand();
    case 'dresser':
      return buildDresser();
    case 'wardrobe':
      return buildWardrobe();
    case 'tv-stand':
      return buildTvStand();
    case 'bookshelf':
      return buildBookshelf();
    case 'buffet':
      return buildBuffet();
    case 'sink':
      return buildSink();
    case 'stove':
      return buildStove();
    case 'fridge':
      return buildFridge();
    case 'toilet':
      return buildToilet();
    case 'bathtub':
      return buildBathtub();
    case 'shower':
      return buildShower();
    default: {
      const group = new THREE.Group();
      const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const mat = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, roughness: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.25;
      group.add(mesh);
      return group;
    }
  }
}

/**
 * Shared furniture model getter for in-scene 3D usage.
 * Returned groups are cloned so each placed instance can be transformed independently.
 */
export function createFurnitureModel3D(renderType: string): THREE.Group {
  const key = renderType || '__default__';
  let cached = SHARED_GEOMETRY_CACHE.get(key);
  if (!cached) {
    cached = buildFurnitureGeometry(renderType);
    SHARED_GEOMETRY_CACHE.set(key, cached);
  }
  return cached.clone(true);
}

export class Furniture3DRenderer {
  private static instance: Furniture3DRenderer | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private lights: THREE.Group;
  private geometryCache = new Map<string, THREE.Group>();

  private constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    this.camera.position.set(3, 3, 3);
    this.camera.lookAt(0, 0, 0);

    this.lights = createLightingRig();
    this.scene.add(this.lights);
  }

  static getInstance(): Furniture3DRenderer {
    if (!Furniture3DRenderer.instance) {
      Furniture3DRenderer.instance = new Furniture3DRenderer();
    }
    return Furniture3DRenderer.instance;
  }

  /**
   * Render a furniture type to a data URL string.
   */
  renderToDataURL(renderType: string, width: number, height: number): string {
    this.renderer.setSize(width, height);

    // Clear scene objects (keep lights)
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((child) => {
      if (child !== this.scene && child !== this.lights && !this.lights.children.includes(child)) {
        toRemove.push(child);
      }
    });
    // Only remove direct children that aren't the lights group
    for (const child of [...this.scene.children]) {
      if (child !== this.lights) {
        this.scene.remove(child);
      }
    }

    const model = this.getGeometry(renderType);
    this.scene.add(model);

    this.fitCameraToObject(model, width / height);

    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * Render a furniture type onto a provided canvas element.
   */
  renderToCanvas(renderType: string, targetCanvas: HTMLCanvasElement): void {
    const width = targetCanvas.width;
    const height = targetCanvas.height;
    const dataURL = this.renderToDataURL(renderType, width, height);

    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
    };
    img.src = dataURL;
  }

  private getGeometry(renderType: string): THREE.Group {
    let cached = this.geometryCache.get(renderType);
    if (cached) return cached.clone();

    const built = this.buildGeometry(renderType);
    this.geometryCache.set(renderType, built);
    return built.clone();
  }

  private buildGeometry(renderType: string): THREE.Group {
    return buildFurnitureGeometry(renderType);
  }

  private fitCameraToObject(object: THREE.Group, aspect: number): void {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const padding = 1.3;
    const halfSize = (maxDim * padding) / 2;

    if (aspect >= 1) {
      this.camera.left = -halfSize * aspect;
      this.camera.right = halfSize * aspect;
      this.camera.top = halfSize;
      this.camera.bottom = -halfSize;
    } else {
      this.camera.left = -halfSize;
      this.camera.right = halfSize;
      this.camera.top = halfSize / aspect;
      this.camera.bottom = -halfSize / aspect;
    }

    this.camera.near = 0.01;
    this.camera.far = maxDim * 20;
    this.camera.updateProjectionMatrix();

    // Isometric viewing angle
    const dist = maxDim * 3;
    this.camera.position.set(
      center.x + dist,
      center.y + dist,
      center.z + dist
    );
    this.camera.lookAt(center);
  }

  dispose(): void {
    this.geometryCache.forEach((group) => {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    });
    this.geometryCache.clear();
    this.renderer.dispose();
    Furniture3DRenderer.instance = null;
  }
}
