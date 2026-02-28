/**
 * PBR materials for 3D furniture rendering.
 */

import * as THREE from 'three';

export function woodMaterial(color = 0x8B6914): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0.05,
  });
}

export function fabricMaterial(color = 0x4A6FA5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0.0,
  });
}

export function leatherMaterial(color = 0x3B2F2F): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.02,
  });
}

export function chromeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xCCCCCC,
    roughness: 0.15,
    metalness: 0.9,
  });
}

export function glassMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xCCDDEE,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.35,
    transmission: 0.8,
    ior: 1.5,
  });
}

export function ceramicMaterial(color = 0xF5F5F0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.3,
    metalness: 0.02,
  });
}

export function metalMaterial(color = 0x888888): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.4,
    metalness: 0.6,
  });
}

export function mattressMaterial(color = 0xF0EDE5): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.0,
  });
}

export function counterTopMaterial(color = 0xD0C8B8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.08,
  });
}
