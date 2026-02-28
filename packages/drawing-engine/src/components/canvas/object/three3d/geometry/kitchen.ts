/**
 * 3D geometry builders for kitchen fixture types.
 */

import * as THREE from 'three';
import { metalMaterial, counterTopMaterial, chromeMaterial, ceramicMaterial } from '../materials';

export function buildSink(): THREE.Group {
  const group = new THREE.Group();
  const counter = counterTopMaterial(0xD0C8B8);
  const basin = metalMaterial(0xBBBBBB);
  const chrome = chromeMaterial();

  // Counter top
  const topGeo = new THREE.BoxGeometry(0.58, 0.04, 0.46);
  const top = new THREE.Mesh(topGeo, counter);
  top.position.y = 0.86;
  group.add(top);

  // Cabinet body
  const cabinetGeo = new THREE.BoxGeometry(0.56, 0.80, 0.44);
  cabinetGeo.translate(0, 0.40, 0);
  const cabinet = new THREE.Mesh(cabinetGeo, ceramicMaterial(0xE8E0D0));
  group.add(cabinet);

  // Basin (inset box — negative space represented by darker box)
  const basinGeo = new THREE.BoxGeometry(0.42, 0.16, 0.32);
  const basinMesh = new THREE.Mesh(basinGeo, basin);
  basinMesh.position.set(0, 0.80, 0.02);
  group.add(basinMesh);

  // Faucet base
  const faucetBaseGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.04, 8);
  const faucetBase = new THREE.Mesh(faucetBaseGeo, chrome);
  faucetBase.position.set(0, 0.90, -0.15);
  group.add(faucetBase);

  // Faucet neck (curved via segments)
  const neckGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.14, 8);
  const neck = new THREE.Mesh(neckGeo, chrome);
  neck.position.set(0, 0.98, -0.15);
  group.add(neck);

  // Faucet spout
  const spoutGeo = new THREE.CylinderGeometry(0.01, 0.008, 0.10, 8);
  spoutGeo.rotateZ(Math.PI / 2);
  const spout = new THREE.Mesh(spoutGeo, chrome);
  spout.position.set(0, 1.04, -0.10);
  spout.rotation.x = -0.3;
  group.add(spout);

  return group;
}

export function buildStove(): THREE.Group {
  const group = new THREE.Group();
  const body = metalMaterial(0xE0E0E0);
  const dark = metalMaterial(0x2A2A2A);
  const chrome = chromeMaterial();

  // Main body
  const bodyGeo = new THREE.BoxGeometry(0.58, 0.86, 0.56);
  bodyGeo.translate(0, 0.43, 0);
  const bodyMesh = new THREE.Mesh(bodyGeo, body);
  group.add(bodyMesh);

  // Top surface (dark)
  const topGeo = new THREE.BoxGeometry(0.58, 0.015, 0.56);
  const top = new THREE.Mesh(topGeo, dark);
  top.position.y = 0.868;
  group.add(top);

  // 4 burners (torus rings)
  const burnerPositions = [
    [-0.15, -0.14],
    [0.15, -0.14],
    [-0.15, 0.14],
    [0.15, 0.14],
  ];
  for (const [x, z] of burnerPositions) {
    const burnerGeo = new THREE.TorusGeometry(0.07, 0.008, 8, 24);
    burnerGeo.rotateX(Math.PI / 2);
    const burner = new THREE.Mesh(burnerGeo, chrome);
    burner.position.set(x, 0.88, z);
    group.add(burner);

    // Grate lines
    for (let i = -1; i <= 1; i += 2) {
      const grateGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.12, 4);
      grateGeo.rotateZ(Math.PI / 2);
      const grate = new THREE.Mesh(grateGeo, dark);
      grate.position.set(x, 0.895, z + i * 0.03);
      group.add(grate);
    }
  }

  // Oven door handle
  const handleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.40, 6);
  handleGeo.rotateZ(Math.PI / 2);
  const handle = new THREE.Mesh(handleGeo, chrome);
  handle.position.set(0, 0.62, 0.285);
  group.add(handle);

  // Knobs
  const knobGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.01, 8);
  knobGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const knob = new THREE.Mesh(knobGeo, chrome);
    knob.position.set(-0.22 + i * 0.145, 0.80, 0.29);
    group.add(knob);
  }

  return group;
}

export function buildFridge(): THREE.Group {
  const group = new THREE.Group();
  const body = metalMaterial(0xE8E8E8);
  const chrome = chromeMaterial();
  const dark = metalMaterial(0x333333);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(0.68, 1.75, 0.66);
  bodyGeo.translate(0, 0.875, 0);
  const bodyMesh = new THREE.Mesh(bodyGeo, body);
  group.add(bodyMesh);

  // Freezer door (top section)
  const freezerLineGeo = new THREE.BoxGeometry(0.64, 0.002, 0.002);
  const freezerLine = new THREE.Mesh(freezerLineGeo, dark);
  freezerLine.position.set(0, 1.30, 0.331);
  group.add(freezerLine);

  // Handles
  const handleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.20, 6);
  // Freezer handle
  const fHandle = new THREE.Mesh(handleGeo, chrome);
  fHandle.position.set(0.26, 1.50, 0.345);
  group.add(fHandle);
  // Fridge handle
  const rHandle = new THREE.Mesh(handleGeo, chrome);
  rHandle.position.set(0.26, 0.85, 0.345);
  group.add(rHandle);

  return group;
}
