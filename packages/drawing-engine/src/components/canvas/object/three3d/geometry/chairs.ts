/**
 * 3D geometry builders for chair furniture types.
 */

import * as THREE from 'three';
import { woodMaterial, fabricMaterial, chromeMaterial, leatherMaterial } from '../materials';

function roundedBoxGeometry(w: number, h: number, d: number, r: number, segments = 2): THREE.BufferGeometry {
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

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: h,
    bevelEnabled: true,
    bevelThickness: Math.min(r * 0.5, 0.02),
    bevelSize: Math.min(r * 0.5, 0.02),
    bevelSegments: segments,
  };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, h / 2, 0);
  return geo;
}

export function buildDiningChair(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x7A5C30);
  const fabric = fabricMaterial(0x8B4513);

  // Seat
  const seatGeo = roundedBoxGeometry(0.42, 0.035, 0.42, 0.02);
  const seat = new THREE.Mesh(seatGeo, fabric);
  seat.position.y = 0.44;
  group.add(seat);

  // 4 legs
  const legGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.44, 8);
  const offsets = [
    [-0.17, -0.17],
    [0.17, -0.17],
    [-0.17, 0.17],
    [0.17, 0.17],
  ];
  for (const [x, z] of offsets) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, 0.22, z);
    group.add(leg);
  }

  // Backrest
  const backGeo = roundedBoxGeometry(0.40, 0.38, 0.025, 0.01);
  const back = new THREE.Mesh(backGeo, wood);
  back.position.set(0, 0.66, -0.19);
  group.add(back);

  // Back supports (2 vertical spindles)
  const spindleGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.38, 6);
  for (const x of [-0.12, 0.12]) {
    const spindle = new THREE.Mesh(spindleGeo, wood);
    spindle.position.set(x, 0.66, -0.19);
    group.add(spindle);
  }

  return group;
}

export function buildOfficeChair(): THREE.Group {
  const group = new THREE.Group();
  const chrome = chromeMaterial();
  const leather = leatherMaterial(0x1A1A2E);

  // 5-star base
  const baseRadius = 0.28;
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const armGeo = new THREE.CylinderGeometry(0.015, 0.015, baseRadius, 6);
    armGeo.rotateZ(Math.PI / 2);
    const arm = new THREE.Mesh(armGeo, chrome);
    arm.position.set(
      Math.cos(angle) * baseRadius / 2,
      0.03,
      Math.sin(angle) * baseRadius / 2
    );
    arm.rotation.y = -angle;
    group.add(arm);

    // Casters
    const casterGeo = new THREE.SphereGeometry(0.02, 8, 6);
    const caster = new THREE.Mesh(casterGeo, chrome);
    caster.position.set(
      Math.cos(angle) * baseRadius,
      0.02,
      Math.sin(angle) * baseRadius
    );
    group.add(caster);
  }

  // Gas lift column
  const columnGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.32, 8);
  const column = new THREE.Mesh(columnGeo, chrome);
  column.position.y = 0.22;
  group.add(column);

  // Seat
  const seatGeo = roundedBoxGeometry(0.48, 0.06, 0.46, 0.04);
  const seat = new THREE.Mesh(seatGeo, leather);
  seat.position.y = 0.42;
  group.add(seat);

  // Backrest (curved)
  const backGeo = roundedBoxGeometry(0.46, 0.42, 0.04, 0.03);
  const back = new THREE.Mesh(backGeo, leather);
  back.position.set(0, 0.68, -0.2);
  back.rotation.x = 0.1;
  group.add(back);

  // Armrests
  for (const side of [-1, 1]) {
    const armVertGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6);
    const armVert = new THREE.Mesh(armVertGeo, chrome);
    armVert.position.set(side * 0.24, 0.52, -0.05);
    group.add(armVert);

    const armPadGeo = roundedBoxGeometry(0.06, 0.025, 0.22, 0.01);
    const armPad = new THREE.Mesh(armPadGeo, leather);
    armPad.position.set(side * 0.24, 0.63, -0.05);
    group.add(armPad);
  }

  return group;
}

export function buildArmchair(): THREE.Group {
  const group = new THREE.Group();
  const wood = woodMaterial(0x6B4226);
  const fabric = fabricMaterial(0x5B7553);

  // 4 short legs
  const legGeo = new THREE.CylinderGeometry(0.025, 0.028, 0.15, 8);
  const offsets = [
    [-0.32, -0.32],
    [0.32, -0.32],
    [-0.32, 0.32],
    [0.32, 0.32],
  ];
  for (const [x, z] of offsets) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(x, 0.075, z);
    group.add(leg);
  }

  // Base frame
  const baseGeo = roundedBoxGeometry(0.78, 0.08, 0.78, 0.03);
  const base = new THREE.Mesh(baseGeo, fabric);
  base.position.y = 0.19;
  group.add(base);

  // Seat cushion
  const seatGeo = roundedBoxGeometry(0.60, 0.12, 0.58, 0.04);
  const seat = new THREE.Mesh(seatGeo, fabric);
  seat.position.set(0, 0.30, 0.03);
  group.add(seat);

  // Back cushion
  const backGeo = roundedBoxGeometry(0.58, 0.38, 0.10, 0.04);
  const back = new THREE.Mesh(backGeo, fabric);
  back.position.set(0, 0.54, -0.30);
  back.rotation.x = 0.08;
  group.add(back);

  // Armrests
  for (const side of [-1, 1]) {
    const armGeo = roundedBoxGeometry(0.10, 0.25, 0.65, 0.03);
    const arm = new THREE.Mesh(armGeo, fabric);
    arm.position.set(side * 0.36, 0.36, -0.02);
    group.add(arm);
  }

  return group;
}
