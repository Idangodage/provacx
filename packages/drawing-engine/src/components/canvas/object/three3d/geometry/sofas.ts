/**
 * 3D geometry builders for sofa furniture types.
 */

import * as THREE from 'three';
import { woodMaterial, fabricMaterial } from '../materials';

function roundedBoxGeometry(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hw = w / 2 - r;
  const hd = d / 2 - r;
  shape.moveTo(-hw, -hd - r);
  shape.lineTo(hw, -hd - r);
  shape.quadraticCurveTo(hw + r, -hd - r, hw + r, -hd);
  shape.lineTo(hw + r, hd);
  shape.quadraticCurveTo(hw + r, hd + r, hw, hd + r);
  shape.lineTo(-hw, hd + r);
  shape.quadraticCurveTo(-hw - r, hd + r, -hw - r, hd);
  shape.lineTo(-hw - r, -hd);
  shape.quadraticCurveTo(-hw - r, -hd - r, -hw, -hd - r);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: true,
    bevelThickness: Math.min(r * 0.4, 0.015),
    bevelSize: Math.min(r * 0.4, 0.015),
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, h / 2, 0);
  return geo;
}

export function buildSofa(seats: 2 | 3 = 3): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x5C4033);
  const fabric = fabricMaterial(0x4A5568);
  const cushionFabric = fabricMaterial(0x5A6578);

  const totalWidth = seats === 3 ? 2.1 : 1.4;
  const depth = 0.85;
  const seatH = 0.42;

  // 4 short feet
  const footGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.08, 8);
  const footOffsets = [
    [-totalWidth / 2 + 0.08, -depth / 2 + 0.08],
    [totalWidth / 2 - 0.08, -depth / 2 + 0.08],
    [-totalWidth / 2 + 0.08, depth / 2 - 0.08],
    [totalWidth / 2 - 0.08, depth / 2 - 0.08],
  ];
  for (const [x, z] of footOffsets) {
    const foot = new THREE.Mesh(footGeo, wood);
    foot.position.set(x, 0.04, z);
    group.add(foot);
  }

  // Base frame
  const baseGeo = roundedBoxGeometry(totalWidth, 0.10, depth, 0.03);
  const base = new THREE.Mesh(baseGeo, fabric);
  base.position.y = 0.13;
  group.add(base);

  // Seat cushions (individual per seat)
  const cushionWidth = (totalWidth - 0.18) / seats;
  for (let i = 0; i < seats; i++) {
    const cx = -totalWidth / 2 + 0.09 + cushionWidth / 2 + i * cushionWidth;
    const cushionGeo = roundedBoxGeometry(cushionWidth - 0.02, 0.10, depth * 0.55, 0.03);
    const cushion = new THREE.Mesh(cushionGeo, cushionFabric);
    cushion.position.set(cx, seatH - 0.05, 0.06);
    group.add(cushion);
  }

  // Back cushions
  for (let i = 0; i < seats; i++) {
    const cx = -totalWidth / 2 + 0.09 + cushionWidth / 2 + i * cushionWidth;
    const backGeo = roundedBoxGeometry(cushionWidth - 0.02, 0.38, 0.12, 0.04);
    const back = new THREE.Mesh(backGeo, cushionFabric);
    back.position.set(cx, seatH + 0.16, -depth / 2 + 0.12);
    back.rotation.x = 0.06;
    group.add(back);
  }

  // Back frame
  const backFrameGeo = roundedBoxGeometry(totalWidth, 0.48, 0.06, 0.02);
  const backFrame = new THREE.Mesh(backFrameGeo, fabric);
  backFrame.position.set(0, seatH + 0.10, -depth / 2 + 0.03);
  group.add(backFrame);

  // Armrests
  for (const side of [-1, 1]) {
    const armGeo = roundedBoxGeometry(0.10, 0.28, depth * 0.8, 0.03);
    const arm = new THREE.Mesh(armGeo, fabric);
    arm.position.set(side * (totalWidth / 2 - 0.04), seatH - 0.02, 0.0);
    group.add(arm);
  }

  return group;
}
