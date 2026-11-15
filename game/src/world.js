// The map: DUSTLINE Site 7, a dusk industrial yard, 38 x 30 m. Two bomb sites (A west,
// B east), three lanes through a cross-wall (A-long, mid doors, B corridor), and cover
// placed so every lane has a fight in it. Every box is a collider for the player and the
// bots and a surface a bullet stops on. Plain geometry only, no models and no textures:
// the site signs are drawn on a canvas at runtime, so the game ships no image files.
//
// Layout (x east, -z north; attackers spawn south, defenders hold north):
//   spawn (0, 12.5) -- mid (0, 0) -- defender base (0, -12.5)
//   site A (-14, -10), site B (14, -10)
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOUNDS = { x: 19, z: 15 };

export const SITES = {
  A: { name: 'A', center: new THREE.Vector3(-14, 0, -10), radius: 3.6 },
  B: { name: 'B', center: new THREE.Vector3(14, 0, -10), radius: 3.6 },
};

export const SPAWNS = {
  attacker: new THREE.Vector3(0, 0, 12.5),
  defenders: [
    new THREE.Vector3(-3, 0, -12.5),
    new THREE.Vector3(-1, 0, -13),
    new THREE.Vector3(1, 0, -13),
    new THREE.Vector3(3, 0, -12.5),
  ],
};

// Patrol loop: defender base -> A-long -> site A -> mid -> B -> site B -> mid -> base.
// Every edge is a straight, cover-free line, so a bot walking it never clips a box.
export const WAYPOINTS = [
  new THREE.Vector3(0, 0, -12.5), // 0 defender base
  new THREE.Vector3(-14, 0, -4), // 1 A-long north
  new THREE.Vector3(-14, 0, -10), // 2 site A
  new THREE.Vector3(0, 0, -6), // 3 mid north
  new THREE.Vector3(14, 0, -4), // 4 B north
  new THREE.Vector3(14, 0, -10), // 5 site B
];
export const PATROL_LOOP = [0, 1, 2, 1, 3, 4, 5, 4, 3];

function siteSignTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#241c16';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#ff7a1a';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.fillStyle = '#ff7a1a';
  ctx.font = '700 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function bannerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#241c16';
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = '#f2e8d5';
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('DUSTLINE', 36, 66);
  ctx.fillStyle = '#ff7a1a';
  ctx.font = '500 40px system-ui, sans-serif';
  ctx.fillText('// SITE 7', 470, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.6 : 0.94,
      metalness: name === 'surface' ? 0.12 : 0.03,
    });
  }
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8a6f4d'),
    roughness: 1,
    metalness: 0,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and outer walls.
  const ground = new THREE.Mesh(new THREE.BoxGeometry(38.4, 0.4, 30.4), groundMaterial);
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3().setFromObject(ground));
  shootables.push(ground);
  box(0.4, 4.6, 30.4, -19.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 30.4, 19.2, 2.3, 0, 'surface');
  box(38.4, 4.6, 0.4, 0, 2.3, -15.2, 'surface');
  box(38.4, 4.6, 0.4, 0, 2.3, 15.2, 'surface');

  // Cross-wall at z = 0 with three gaps: A-long, mid doors, B corridor.
  box(3.5, 3.4, 0.6, -17.25, 1.7, 0, 'surface');
  box(11, 3.4, 0.6, -7, 1.7, 0, 'surface');
  box(11, 3.4, 0.6, 7, 1.7, 0, 'surface');
  box(3.5, 3.4, 0.6, 17.25, 1.7, 0, 'surface');

  // Site A: container yard. One orange container marks the site.
  box(6, 2.6, 2.4, -17, 1.3, -11, 'accent');
  box(6, 2.6, 2.4, -10.5, 1.3, -13.2, 'surface');
  box(1.2, 1.1, 1.2, -11.5, 0.55, -7.5, 'muted');
  box(1.2, 1.1, 1.2, -16.5, 0.55, -6.5, 'muted');
  // Site B: warehouse annex, mirrored.
  box(6, 2.6, 2.4, 17, 1.3, -11, 'accent');
  box(6, 2.6, 2.4, 10.5, 1.3, -13.2, 'surface');
  box(1.2, 1.1, 1.2, 11.5, 0.55, -7.5, 'muted');
  box(1.2, 1.1, 1.2, 16.5, 0.55, -6.5, 'muted');

  // B corridor: two tall containers frame the east lane.
  box(2.4, 2.6, 6, 11.8, 1.3, 3, 'surface');
  box(2.4, 2.6, 6, 16.2, 1.3, -3, 'surface');
  // A-long corner cover.
  box(2.4, 2.6, 6, -16.2, 1.3, 3, 'surface');

  // Mid: a pillar pair and a crouch crate off the centre line.
  box(1, 3.2, 1, -4.5, 1.6, -9, 'surface');
  box(1, 3.2, 1, 4.5, 1.6, -9, 'surface');
  box(1.2, 1.1, 1.2, 2.8, 0.55, 3.5, 'muted');
  box(1.2, 1.1, 1.2, -2.8, 0.55, -3.5, 'muted');

  // Spawn cover: two low walls the attacker starts behind.
  box(2.4, 0.9, 1.2, -7.5, 0.45, 12.5, 'hairline');
  box(2.4, 0.9, 1.2, 7.5, 0.45, 12.5, 'hairline');
  // Defender base cover.
  box(2.4, 0.9, 1.2, -5, 0.45, -12.5, 'hairline');
  box(2.4, 0.9, 1.2, 5, 0.45, -12.5, 'hairline');

  // Site markers: glowing rings on the ground and letter signs on poles.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.28, site.radius, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center.x, 0.03, site.center.z);
    group.add(ring);

    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.4, 0.14), materials.surface);
    pole.position.set(site.center.x + 2.6, 1.7, site.center.z - 2.6);
    pole.castShadow = true;
    group.add(pole);
    colliders.push(new THREE.Box3().setFromObject(pole));

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: siteSignTexture(site.name), side: THREE.DoubleSide }),
    );
    sign.position.set(site.center.x + 2.6, 3.4, site.center.z - 2.6);
    sign.rotation.y = Math.PI / 4;
    group.add(sign);

    const glow = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 13, 1.6);
    glow.position.set(site.center.x, 2.6, site.center.z);
    scene.add(glow);
  }

  // Yard banner on the north wall.
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 1),
    new THREE.MeshBasicMaterial({ map: bannerTexture() }),
  );
  banner.position.set(0, 3.4, -14.95);
  group.add(banner);

  // Light: a low amber sun from the west, a cool dusk fill from the east, warm sky.
  const sky = new THREE.HemisphereLight(new THREE.Color('#ffd9a0'), new THREE.Color('#241a12'), 1.35);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb35c'), 3.2);
  sun.position.set(-20, 13, 12);
  sun.target.position.set(2, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86b8'), 0.5);
  fill.position.set(16, 11, -12);
  scene.add(fill);

  return { colliders, shootables, group, bounds: BOUNDS, sites: SITES, spawns: SPAWNS };
}
