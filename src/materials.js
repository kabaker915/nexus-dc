import * as THREE from 'three';

export const MAT = {};

export function initMaterials() {
  MAT.frame = new THREE.MeshStandardMaterial({ color: 0x161c22, metalness: 0.9, roughness: 0.38 });
  MAT.frameLight = new THREE.MeshStandardMaterial({ color: 0x222a33, metalness: 0.85, roughness: 0.42 });
  MAT.side = new THREE.MeshStandardMaterial({ color: 0x151b22, metalness: 0.55, roughness: 0.66 });
  MAT.chassis = new THREE.MeshStandardMaterial({ color: 0x262d35, metalness: 0.55, roughness: 0.5 });
  MAT.chassisDark = new THREE.MeshStandardMaterial({ color: 0x151a1f, metalness: 0.6, roughness: 0.55 });
  MAT.blank = new THREE.MeshStandardMaterial({ color: 0x0c1015, metalness: 0.4, roughness: 0.85 });
  MAT.handle = new THREE.MeshStandardMaterial({ color: 0x323b45, metalness: 0.95, roughness: 0.3 });
  MAT.glass = new THREE.MeshBasicMaterial({
    color: 0x7fb4d8, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false,
  });
  MAT.dark = new THREE.MeshStandardMaterial({ color: 0x070a0d, metalness: 0.3, roughness: 0.9 });
  MAT.floorTile = new THREE.MeshStandardMaterial({ color: 0x1b2229, metalness: 0.45, roughness: 0.72 });
  MAT.wall = new THREE.MeshStandardMaterial({ color: 0x0a0e12, metalness: 0.2, roughness: 0.92 });
  MAT.tray = new THREE.MeshStandardMaterial({ color: 0x1a222a, metalness: 0.75, roughness: 0.48 });
  MAT.led = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  MAT.ledDim = new THREE.MeshBasicMaterial({ color: 0x101820 });
  MAT.portBody = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.6 });
  MAT.fan = new THREE.MeshStandardMaterial({ color: 0x0b0f13, metalness: 0.5, roughness: 0.7, side: THREE.DoubleSide });

  MAT.ghostOk = new THREE.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.22, depthWrite: false });
  MAT.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff4d63, transparent: true, opacity: 0.22, depthWrite: false });
}

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
export const UNIT_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
