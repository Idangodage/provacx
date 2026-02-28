/**
 * 3D geometry builders for table furniture types.
 */

import * as THREE from 'three';
import { woodMaterial, chromeMaterial } from '../materials';

export function buildDiningTable(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x8B6914);

  // Table top
  const topGeo = new THREE.BoxGeometry(1.4, 0.04, 0.78);
  topGeo.translate(0, 0.04 / 2, 0);
  const top = new THREE.Mesh(topGeo, wood);
  top.position.y = 0.72;
  group.add(top);

  // 4 legs
  const legGeo = new THREE.BoxGeometry(0.06, 0.72, 0.06);
  legGeo.translate(0, 0.36, 0);
  const offsets = [
    [-0.62, -0.32],
    [0.62, -0.32],
    [-0.62, 0.32],
    [0.62, 0.32],
  ];
  for (const [x, z] of offsets) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, 0, z);
    group.add(leg);
  }

  // Apron (cross beams under top)
  const apronLongGeo = new THREE.BoxGeometry(1.16, 0.08, 0.025);
  for (const z of [-0.32, 0.32]) {
    const apron = new THREE.Mesh(apronLongGeo, wood);
    apron.position.set(0, 0.68, z);
    group.add(apron);
  }
  const apronShortGeo = new THREE.BoxGeometry(0.025, 0.08, 0.60);
  for (const x of [-0.62, 0.62]) {
    const apron = new THREE.Mesh(apronShortGeo, wood);
    apron.position.set(x, 0.68, 0);
    group.add(apron);
  }

  return group;
}

export function buildRoundTable(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x8B6914);

  // Circular top
  const topGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.035, 32);
  const top = new THREE.Mesh(topGeo, wood);
  top.position.y = 0.735;
  group.add(top);

  // Pedestal column
  const columnGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.55, 12);
  const column = new THREE.Mesh(columnGeo, wood);
  column.position.y = 0.40;
  group.add(column);

  // Base plate
  const baseGeo = new THREE.CylinderGeometry(0.28, 0.30, 0.04, 24);
  const base = new THREE.Mesh(baseGeo, wood);
  base.position.y = 0.02;
  group.add(base);

  // 4 feet extending from base
  const footGeo = new THREE.BoxGeometry(0.04, 0.025, 0.18);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const foot = new THREE.Mesh(footGeo, wood);
    foot.position.set(
      Math.cos(angle) * 0.22,
      0.012,
      Math.sin(angle) * 0.22
    );
    foot.rotation.y = -angle;
    group.add(foot);
  }

  return group;
}

export function buildCoffeeTable(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x6B4226);
  const chrome = chromeMaterial();

  // Table top
  const topGeo = new THREE.BoxGeometry(1.0, 0.03, 0.50);
  const top = new THREE.Mesh(topGeo, wood);
  top.position.y = 0.40;
  group.add(top);

  // 4 tapered legs (chrome/metal)
  const legGeo = new THREE.CylinderGeometry(0.012, 0.018, 0.38, 8);
  legGeo.translate(0, 0.19, 0);
  const offsets = [
    [-0.44, -0.20],
    [0.44, -0.20],
    [-0.44, 0.20],
    [0.44, 0.20],
  ];
  for (const [x, z] of offsets) {
    const leg = new THREE.Mesh(legGeo, chrome);
    leg.position.set(x, 0, z);
    group.add(leg);
  }

  // Bottom shelf
  const shelfGeo = new THREE.BoxGeometry(0.82, 0.015, 0.38);
  const shelf = new THREE.Mesh(shelfGeo, wood);
  shelf.position.y = 0.12;
  group.add(shelf);

  return group;
}
