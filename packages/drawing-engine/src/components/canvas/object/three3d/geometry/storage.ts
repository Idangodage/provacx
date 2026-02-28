/**
 * 3D geometry builders for storage furniture types.
 */

import * as THREE from 'three';
import { woodMaterial, chromeMaterial, metalMaterial } from '../materials';

export function buildNightstand(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x6B4226);
  const knob = chromeMaterial();

  // Main body
  const bodyGeo = new THREE.BoxGeometry(0.48, 0.52, 0.42);
  bodyGeo.translate(0, 0.26, 0);
  const body = new THREE.Mesh(bodyGeo, wood);
  group.add(body);

  // Top surface (slightly larger)
  const topGeo = new THREE.BoxGeometry(0.50, 0.02, 0.44);
  const top = new THREE.Mesh(topGeo, wood);
  top.position.y = 0.53;
  group.add(top);

  // Drawer lines
  const lineGeo = new THREE.BoxGeometry(0.44, 0.002, 0.002);
  for (const y of [0.26, 0.44]) {
    const line = new THREE.Mesh(lineGeo, metalMaterial(0x333333));
    line.position.set(0, y, 0.211);
    group.add(line);
  }

  // Drawer knobs
  const knobGeo = new THREE.SphereGeometry(0.012, 8, 6);
  for (const y of [0.18, 0.35]) {
    const k = new THREE.Mesh(knobGeo, knob);
    k.position.set(0, y, 0.215);
    group.add(k);
  }

  // Short legs
  const legGeo = new THREE.BoxGeometry(0.04, 0.06, 0.04);
  legGeo.translate(0, 0.03, 0);
  const offsets = [[-0.20, -0.17], [0.20, -0.17], [-0.20, 0.17], [0.20, 0.17]];
  for (const [x, z] of offsets) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, -0.01, z);
    group.add(leg);
  }

  return group;
}

export function buildDresser(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x7A5C30);
  const knob = chromeMaterial();

  // Main body
  const bodyGeo = new THREE.BoxGeometry(0.88, 0.82, 0.45);
  bodyGeo.translate(0, 0.41, 0);
  const body = new THREE.Mesh(bodyGeo, wood);
  group.add(body);

  // Top
  const topGeo = new THREE.BoxGeometry(0.90, 0.025, 0.47);
  const top = new THREE.Mesh(topGeo, wood);
  top.position.y = 0.835;
  group.add(top);

  // 4 drawer lines + knobs
  const lineGeo = new THREE.BoxGeometry(0.82, 0.002, 0.002);
  const knobGeo = new THREE.SphereGeometry(0.012, 8, 6);
  const drawerYs = [0.22, 0.40, 0.58, 0.74];
  for (const y of drawerYs) {
    const line = new THREE.Mesh(lineGeo, metalMaterial(0x333333));
    line.position.set(0, y, 0.226);
    group.add(line);

    for (const kx of [-0.18, 0.18]) {
      const k = new THREE.Mesh(knobGeo, knob);
      k.position.set(kx, y - 0.07, 0.228);
      group.add(k);
    }
  }

  return group;
}

export function buildWardrobe(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x6B4226);
  const knob = chromeMaterial();

  // Main body
  const bodyGeo = new THREE.BoxGeometry(0.96, 2.0, 0.56);
  bodyGeo.translate(0, 1.0, 0);
  const body = new THREE.Mesh(bodyGeo, wood);
  group.add(body);

  // Top
  const topGeo = new THREE.BoxGeometry(0.98, 0.025, 0.58);
  const top = new THREE.Mesh(topGeo, wood);
  top.position.y = 2.01;
  group.add(top);

  // Door split line (vertical)
  const splitGeo = new THREE.BoxGeometry(0.002, 1.8, 0.002);
  const split = new THREE.Mesh(splitGeo, metalMaterial(0x333333));
  split.position.set(0, 1.0, 0.281);
  group.add(split);

  // Door handles
  const handleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.10, 6);
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(handleGeo, knob);
    handle.position.set(side * 0.06, 1.0, 0.285);
    group.add(handle);
  }

  return group;
}

export function buildTvStand(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x3C3C3C);
  const metal = metalMaterial(0x666666);

  // Top shelf
  const topGeo = new THREE.BoxGeometry(1.40, 0.03, 0.42);
  const top = new THREE.Mesh(topGeo, wood);
  top.position.y = 0.50;
  group.add(top);

  // Middle shelf
  const midGeo = new THREE.BoxGeometry(1.30, 0.02, 0.38);
  const mid = new THREE.Mesh(midGeo, wood);
  mid.position.y = 0.28;
  group.add(mid);

  // Bottom shelf
  const botGeo = new THREE.BoxGeometry(1.30, 0.02, 0.38);
  const bot = new THREE.Mesh(botGeo, wood);
  bot.position.y = 0.08;
  group.add(bot);

  // 4 vertical supports
  const supportGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.50, 8);
  supportGeo.translate(0, 0.25, 0);
  const supports = [[-0.60, -0.16], [0.60, -0.16], [-0.60, 0.16], [0.60, 0.16]];
  for (const [x, z] of supports) {
    const s = new THREE.Mesh(supportGeo, metal);
    s.position.set(x, 0, z);
    group.add(s);
  }

  return group;
}

export function buildBookshelf(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x8B6914);
  const bookColors = [0x8B0000, 0x00008B, 0x006400, 0x8B8000, 0x4B0082];

  const width = 0.76;
  const depth = 0.28;
  const height = 2.0;
  const shelves = 5;
  const shelfSpacing = height / (shelves + 1);

  // Side panels
  const sideGeo = new THREE.BoxGeometry(0.025, height, depth);
  sideGeo.translate(0, height / 2, 0);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(sideGeo, wood);
    panel.position.set(side * (width / 2 - 0.012), 0, 0);
    group.add(panel);
  }

  // Back panel
  const backGeo = new THREE.BoxGeometry(width, height, 0.01);
  backGeo.translate(0, height / 2, 0);
  const back = new THREE.Mesh(backGeo, wood);
  back.position.z = -depth / 2 + 0.005;
  group.add(back);

  // Shelves + books
  const shelfGeo = new THREE.BoxGeometry(width - 0.05, 0.02, depth - 0.02);
  for (let i = 0; i <= shelves; i++) {
    const y = i * shelfSpacing;
    const shelf = new THREE.Mesh(shelfGeo, wood);
    shelf.position.y = y;
    group.add(shelf);

    // Books on shelf (except top shelf)
    if (i < shelves) {
      const bookCount = 4 + Math.floor(Math.random() * 3);
      let bx = -width / 2 + 0.06;
      for (let b = 0; b < bookCount && bx < width / 2 - 0.06; b++) {
        const bw = 0.02 + Math.random() * 0.03;
        const bh = shelfSpacing * (0.6 + Math.random() * 0.3);
        const bd = depth * 0.7;
        const bookGeo = new THREE.BoxGeometry(bw, bh, bd);
        const bookMat = new THREE.MeshStandardMaterial({
          color: bookColors[b % bookColors.length],
          roughness: 0.8,
          metalness: 0.0,
        });
        const book = new THREE.Mesh(bookGeo, bookMat);
        book.position.set(bx + bw / 2, y + 0.01 + bh / 2, 0.02);
        group.add(book);
        bx += bw + 0.005;
      }
    }
  }

  return group;
}

export function buildBuffet(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x7A5C30);
  const knob = chromeMaterial();

  // Main body
  const bodyGeo = new THREE.BoxGeometry(1.40, 0.78, 0.46);
  bodyGeo.translate(0, 0.39, 0);
  const body = new THREE.Mesh(bodyGeo, wood);
  group.add(body);

  // Top
  const topGeo = new THREE.BoxGeometry(1.44, 0.03, 0.48);
  const top = new THREE.Mesh(topGeo, wood);
  top.position.y = 0.795;
  group.add(top);

  // 3 door panels
  const doorGeo = new THREE.BoxGeometry(0.002, 0.60, 0.002);
  for (const x of [-0.23, 0.23]) {
    const door = new THREE.Mesh(doorGeo, metalMaterial(0x333333));
    door.position.set(x, 0.40, 0.231);
    group.add(door);
  }

  // Door knobs
  const knobGeo = new THREE.SphereGeometry(0.012, 8, 6);
  for (const x of [-0.35, 0, 0.35]) {
    const k = new THREE.Mesh(knobGeo, knob);
    k.position.set(x, 0.40, 0.235);
    group.add(k);
  }

  // Short legs
  const legGeo = new THREE.BoxGeometry(0.04, 0.06, 0.04);
  legGeo.translate(0, 0.03, 0);
  for (const [x, z] of [[-0.64, -0.19], [0.64, -0.19], [-0.64, 0.19], [0.64, 0.19]]) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, -0.01, z);
    group.add(leg);
  }

  return group;
}
