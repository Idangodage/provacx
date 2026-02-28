/**
 * 3D geometry builders for bathroom fixture types.
 */

import * as THREE from 'three';
import { ceramicMaterial, chromeMaterial, glassMaterial, metalMaterial } from '../materials';

export function buildToilet(): THREE.Group {
  const group = new THREE.Group();
  const ceramic = ceramicMaterial(0xF5F5F0);
  const chrome = chromeMaterial();

  // Bowl base
  const bowlGeo = new THREE.CylinderGeometry(0.18, 0.16, 0.38, 16);
  bowlGeo.scale(1, 1, 1.4);
  const bowl = new THREE.Mesh(bowlGeo, ceramic);
  bowl.position.set(0, 0.19, 0.08);
  group.add(bowl);

  // Seat rim (torus)
  const seatGeo = new THREE.TorusGeometry(0.17, 0.025, 8, 24);
  seatGeo.scale(1, 1, 1.35);
  seatGeo.rotateX(Math.PI / 2);
  const seat = new THREE.Mesh(seatGeo, ceramic);
  seat.position.set(0, 0.39, 0.08);
  group.add(seat);

  // Lid
  const lidGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.02, 16);
  lidGeo.scale(1, 1, 1.35);
  const lid = new THREE.Mesh(lidGeo, ceramic);
  lid.position.set(0, 0.41, 0.06);
  group.add(lid);

  // Tank
  const tankGeo = new THREE.BoxGeometry(0.36, 0.32, 0.16);
  tankGeo.translate(0, 0.16, 0);
  const tank = new THREE.Mesh(tankGeo, ceramic);
  tank.position.set(0, 0.20, -0.26);
  group.add(tank);

  // Flush button
  const btnGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.01, 12);
  const btn = new THREE.Mesh(btnGeo, chrome);
  btn.position.set(0, 0.53, -0.26);
  group.add(btn);

  return group;
}

export function buildBathtub(): THREE.Group {
  const group = new THREE.Group();
  const ceramic = ceramicMaterial(0xF5F5F0);
  const chrome = chromeMaterial();

  // Outer shell (rounded box)
  const outerGeo = new THREE.BoxGeometry(1.60, 0.55, 0.75);
  outerGeo.translate(0, 0.275, 0);
  const outer = new THREE.Mesh(outerGeo, ceramic);
  group.add(outer);

  // Inner basin (darker, slightly smaller, raised)
  const innerGeo = new THREE.BoxGeometry(1.48, 0.42, 0.63);
  innerGeo.translate(0, 0.21, 0);
  const inner = new THREE.Mesh(innerGeo, ceramicMaterial(0xE8E8E0));
  inner.position.y = 0.10;
  group.add(inner);

  // Rim (top edge)
  const rimGeo = new THREE.BoxGeometry(1.62, 0.04, 0.77);
  const rim = new THREE.Mesh(rimGeo, ceramic);
  rim.position.y = 0.56;
  group.add(rim);

  // Faucet
  const faucetGeo = new THREE.CylinderGeometry(0.015, 0.02, 0.12, 8);
  const faucet = new THREE.Mesh(faucetGeo, chrome);
  faucet.position.set(0, 0.62, -0.30);
  group.add(faucet);

  // Spout
  const spoutGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8);
  spoutGeo.rotateZ(Math.PI / 2);
  const spout = new THREE.Mesh(spoutGeo, chrome);
  spout.position.set(0, 0.66, -0.26);
  group.add(spout);

  // 4 feet (claw foot style)
  const footGeo = new THREE.SphereGeometry(0.035, 8, 6);
  for (const [x, z] of [[-0.65, -0.28], [0.65, -0.28], [-0.65, 0.28], [0.65, 0.28]]) {
    const foot = new THREE.Mesh(footGeo, chrome);
    foot.position.set(x, 0.02, z);
    group.add(foot);
  }

  return group;
}

export function buildShower(): THREE.Group {
  const group = new THREE.Group();
  const ceramic = ceramicMaterial(0xF0F0F0);
  const chrome = chromeMaterial();
  const glass = glassMaterial();

  // Base tray
  const trayGeo = new THREE.BoxGeometry(0.86, 0.06, 0.86);
  trayGeo.translate(0, 0.03, 0);
  const tray = new THREE.Mesh(trayGeo, ceramic);
  group.add(tray);

  // Glass panels (2 walls — corner shower)
  const panelGeo = new THREE.BoxGeometry(0.86, 2.0, 0.01);
  panelGeo.translate(0, 1.0, 0);

  const frontPanel = new THREE.Mesh(panelGeo, glass);
  frontPanel.position.z = 0.43;
  group.add(frontPanel);

  const sidePanel = new THREE.Mesh(panelGeo.clone(), glass);
  sidePanel.rotation.y = Math.PI / 2;
  sidePanel.position.x = 0.43;
  group.add(sidePanel);

  // Chrome frame rails
  const railGeo = new THREE.CylinderGeometry(0.008, 0.008, 2.0, 6);
  railGeo.translate(0, 1.0, 0);
  const positions = [
    [0.43, 0.43],
    [-0.43, 0.43],
    [0.43, -0.43],
  ];
  for (const [x, z] of positions) {
    const rail = new THREE.Mesh(railGeo, chrome);
    rail.position.set(x, 0, z);
    group.add(rail);
  }

  // Shower head (mounted on back wall)
  const mountGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8);
  const mount = new THREE.Mesh(mountGeo, chrome);
  mount.position.set(0, 1.90, -0.40);
  group.add(mount);

  const headGeo = new THREE.CylinderGeometry(0.06, 0.04, 0.03, 12);
  headGeo.rotateX(0.3);
  const head = new THREE.Mesh(headGeo, chrome);
  head.position.set(0, 1.86, -0.35);
  group.add(head);

  // Drain
  const drainGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.005, 12);
  const drain = new THREE.Mesh(drainGeo, metalMaterial(0x666666));
  drain.position.set(0, 0.06, 0);
  group.add(drain);

  return group;
}
