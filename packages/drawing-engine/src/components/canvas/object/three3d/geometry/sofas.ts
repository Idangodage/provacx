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
  const accentFabric = fabricMaterial(0x647189);

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

    const capGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.01, 8);
    const cap = new THREE.Mesh(capGeo, fabricMaterial(0x3f4a5f));
    cap.position.set(x, 0.085, z);
    group.add(cap);
  }

  // Base frame
  const baseGeo = roundedBoxGeometry(totalWidth, 0.10, depth, 0.03);
  const base = new THREE.Mesh(baseGeo, fabric);
  base.position.y = 0.13;
  group.add(base);

  const plinthGeo = roundedBoxGeometry(totalWidth - 0.06, 0.06, depth - 0.10, 0.02);
  const plinth = new THREE.Mesh(plinthGeo, accentFabric);
  plinth.position.y = 0.08;
  group.add(plinth);

  // Seat cushions (individual per seat)
  const cushionWidth = (totalWidth - 0.18) / seats;
  for (let i = 0; i < seats; i++) {
    const cx = -totalWidth / 2 + 0.09 + cushionWidth / 2 + i * cushionWidth;
    const cushionGeo = roundedBoxGeometry(cushionWidth - 0.02, 0.10, depth * 0.55, 0.03);
    const cushion = new THREE.Mesh(cushionGeo, cushionFabric);
    cushion.position.set(cx, seatH - 0.05, 0.06);
    group.add(cushion);

    const frontBandGeo = new THREE.BoxGeometry(cushionWidth - 0.08, 0.035, 0.025);
    const frontBand = new THREE.Mesh(frontBandGeo, accentFabric);
    frontBand.position.set(cx, seatH - 0.08, depth * 0.28);
    group.add(frontBand);

    const seamGeo = new THREE.BoxGeometry(cushionWidth - 0.08, 0.003, 0.003);
    for (const z of [-depth * 0.08, depth * 0.14]) {
      const seam = new THREE.Mesh(seamGeo, fabricMaterial(0x3f4f68));
      seam.position.set(cx, seatH - 0.005, z);
      group.add(seam);
    }
  }

  // Back cushions
  for (let i = 0; i < seats; i++) {
    const cx = -totalWidth / 2 + 0.09 + cushionWidth / 2 + i * cushionWidth;
    const backGeo = roundedBoxGeometry(cushionWidth - 0.02, 0.38, 0.12, 0.04);
    const back = new THREE.Mesh(backGeo, cushionFabric);
    back.position.set(cx, seatH + 0.16, -depth / 2 + 0.12);
    back.rotation.x = 0.06;
    group.add(back);

    const tuckGeo = new THREE.BoxGeometry(cushionWidth - 0.10, 0.02, 0.02);
    const tuck = new THREE.Mesh(tuckGeo, accentFabric);
    tuck.position.set(cx, seatH + 0.30, -depth / 2 + 0.18);
    group.add(tuck);
  }

  // Back frame
  const backFrameGeo = roundedBoxGeometry(totalWidth, 0.48, 0.06, 0.02);
  const backFrame = new THREE.Mesh(backFrameGeo, fabric);
  backFrame.position.set(0, seatH + 0.10, -depth / 2 + 0.03);
  group.add(backFrame);

  // Armrests and inner arm pads.
  for (const side of [-1, 1]) {
    const armGeo = roundedBoxGeometry(0.10, 0.28, depth * 0.8, 0.03);
    const arm = new THREE.Mesh(armGeo, fabric);
    arm.position.set(side * (totalWidth / 2 - 0.04), seatH - 0.02, 0.0);
    group.add(arm);

    const armPadGeo = roundedBoxGeometry(0.06, 0.18, depth * 0.55, 0.02);
    const armPad = new THREE.Mesh(armPadGeo, cushionFabric);
    armPad.position.set(side * (totalWidth / 2 - 0.08), seatH + 0.01, 0.02);
    group.add(armPad);
  }

  const lowerRailGeo = new THREE.BoxGeometry(totalWidth - 0.18, 0.05, 0.05);
  const lowerRail = new THREE.Mesh(lowerRailGeo, accentFabric);
  lowerRail.position.set(0, 0.19, -depth / 2 + 0.08);
  group.add(lowerRail);

  const pillowCount = seats === 3 ? 2 : 1;
  for (let i = 0; i < pillowCount; i++) {
    const px = pillowCount === 1 ? 0 : (i === 0 ? -0.22 : 0.22);
    const pillowGeo = roundedBoxGeometry(0.22, 0.08, 0.20, 0.025);
    const pillow = new THREE.Mesh(pillowGeo, fabricMaterial(0x70839f));
    pillow.position.set(px, seatH + 0.06, -0.05);
    pillow.rotation.y = i % 2 === 0 ? -0.25 : 0.22;
    group.add(pillow);
  }

  return group;
}
