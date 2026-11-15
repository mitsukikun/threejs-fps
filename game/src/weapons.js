// Weapons: four guns and a frag grenade. Each definition owns its numbers — damage,
// headshot multiplier, magazine, fire rate, reload time, spread and recoil — so the
// buy menu and the HUD read the same table the simulation shoots with. The module also
// owns the view models (one small box-built gun per weapon, attached to the camera),
// the reload and kick animation, and the grenade projectile with its bounce and fuse.
// main.js owns the ray and the damage; this module owns the numbers and the feel.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp } from './util.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'P9 SIDEARM',
    price: 0,
    mag: 12,
    reserve: 48,
    damage: 26,
    headMult: 3,
    gap: 0.14,
    reloadTime: 1.4,
    spreadStill: 0.004,
    spreadMoving: 0.03,
    recoil: 0.006,
    auto: false,
    zoom: 1.35,
    range: 60,
    kind: 'pistol',
  },
  rifle: {
    id: 'rifle',
    name: 'VK-47',
    price: 2700,
    mag: 30,
    reserve: 90,
    damage: 34,
    headMult: 4,
    gap: 0.098,
    reloadTime: 2.0,
    spreadStill: 0.0022,
    spreadMoving: 0.028,
    recoil: 0.011,
    auto: true,
    zoom: 1.35,
    range: 90,
    kind: 'rifle',
  },
  smg: {
    id: 'smg',
    name: 'RAPTOR-9',
    price: 1500,
    mag: 32,
    reserve: 96,
    damage: 26,
    headMult: 3,
    gap: 0.07,
    reloadTime: 1.7,
    spreadStill: 0.004,
    spreadMoving: 0.034,
    recoil: 0.007,
    auto: true,
    zoom: 1.35,
    range: 45,
    kind: 'smg',
  },
  sniper: {
    id: 'sniper',
    name: 'LONGSHOT',
    price: 4750,
    mag: 5,
    reserve: 15,
    damage: 88,
    headMult: 4,
    gap: 1.1,
    reloadTime: 2.6,
    spreadStill: 0.0004,
    spreadMoving: 0.05,
    recoil: 0.045,
    auto: false,
    zoom: 2.6,
    range: 120,
    kind: 'sniper',
    scopedSpread: 0.03,
  },
};

const GRENADE_FUSE = 1.6;
const GRENADE_RADIUS = 6.5;
const GRENADE_MAX_DAMAGE = 120;

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.55, metalness: 0.1 });
  const model = new THREE.Group();
  if (def.id === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.24), body);
    const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.07), grip);
    gripMesh.position.set(0, -0.07, 0.08);
    model.add(slide, gripMesh);
  } else if (def.id === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), grip);
    barrel.position.set(0, 0.02, -0.3);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), grip);
    mag.position.set(0, -0.1, -0.02);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
    sight.position.set(0, 0.07, 0.02);
    model.add(receiver, barrel, mag, sight);
  } else if (def.id === 'sniper') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.55), grip);
    barrel.position.set(0, 0.02, -0.5);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 12), grip);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.075, -0.05);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.24), grip);
    stock.position.set(0, -0.02, 0.34);
    model.add(receiver, barrel, scope, stock);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
    barrel.position.set(0, 0.025, -0.38);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), accent);
    sight.position.set(0, 0.075, -0.08);
    model.add(receiver, barrel, stock, sight);
  }
  model.position.set(0.24, -0.2, -0.42);
  return model;
}

export function createWeapons(camera, scene, shootables) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  // The muzzle flash is a starburst drawn on a canvas at runtime (no image file):
  // a hot white core fading to orange, with four thin spikes, additively blended
  // so it reads as light, not as a flat orange billboard.
  function flashTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.25, 'rgba(255,190,80,0.9)');
    grad.addColorStop(0.6, 'rgba(249,115,22,0.35)');
    grad.addColorStop(1, 'rgba(249,115,22,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,220,140,0.85)';
    for (const angle of [0, Math.PI / 2]) {
      ctx.save();
      ctx.translate(64, 64);
      ctx.rotate(angle);
      ctx.fillRect(-64, -3, 128, 6);
      ctx.restore();
    }
    return new THREE.CanvasTexture(canvas);
  }

  const FLASH_LIFE = 0.06;
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const owned = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
  const state = {
    current: 'pistol',
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    grenades: 0,
    switching: 0,
  };
  models.pistol.visible = true;

  const grenade = {
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    fuse: 0,
    bounced: false,
    mesh: null,
  };
  const grenadeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.4 }),
  );
  grenadeMesh.visible = false;
  scene.add(grenadeMesh);
  grenade.mesh = grenadeMesh;

  // Grenade wall bounce: one raycaster, reused, from the previous position along the
  // step. A wall hit reflects the velocity and arms the fuse to blow shortly after.
  const wallRay = new THREE.Raycaster();
  const wallDir = new THREE.Vector3();
  const wallPrev = new THREE.Vector3();
  const wallNormal = new THREE.Vector3();

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.028);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.switching = Math.max(0, state.switching - dt);
    const model = models[state.current];
    const d = def();
    const ads = model.userData.ads ? 1 : 0;
    model.position.z = -0.42 + state.kick;
    model.position.x = 0.24 - ads * 0.24;
    model.position.y = -0.2 + ads * 0.055;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.material.opacity = 0.9 * Math.max(0, state.flash / FLASH_LIFE);
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (d.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = owned[state.current];
        const need = d.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
    if (grenade.active) {
      grenade.fuse -= dt;
      grenade.velocity.y -= 12 * dt;
      wallPrev.copy(grenade.position);
      const stepLength = grenade.velocity.length() * dt;
      wallDir.copy(grenade.velocity).normalize();
      wallRay.set(wallPrev, wallDir);
      wallRay.far = Math.max(stepLength, 0.05);
      const wallHit = wallRay.intersectObjects(shootables, false)[0];
      if (wallHit) {
        grenade.position.copy(wallHit.point);
        wallNormal.copy(wallHit.face.normal).transformDirection(wallHit.object.matrixWorld);
        const dot = grenade.velocity.dot(wallNormal);
        grenade.velocity.addScaledVector(wallNormal, -2 * dot).multiplyScalar(0.45);
        grenade.fuse = Math.min(grenade.fuse, 0.4);
        grenade.bounced = true;
      } else {
        grenade.position.addScaledVector(grenade.velocity, dt);
      }
      if (grenade.position.y < 0.09) {
        grenade.position.y = 0.09;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4;
        grenade.velocity.x *= 0.6;
        grenade.velocity.z *= 0.6;
        grenade.bounced = true;
      }
      grenadeMesh.position.copy(grenade.position);
      if (grenade.fuse <= 0) {
        grenade.active = false;
        grenadeMesh.visible = false;
      }
    }
  }

  return {
    state,
    owned,
    def,
    step,
    ready() {
      const slot = owned[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switching === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = FLASH_LIFE;
      state.kick = 0.055;
      state.bloom = Math.min(0.03, state.bloom + 0.004);
    },
    takeRound() {
      const slot = owned[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const slot = owned[state.current];
      const d = def();
      if (state.reloadLeft > 0 || slot.mag === d.mag || slot.reserve === 0) return;
      state.reloadLeft = d.reloadTime;
    },
    spread(speed, crouching, aiming) {
      const d = def();
      let base = d.spreadStill + Math.min(1, speed / 5.4) * d.spreadMoving;
      if (crouching) base *= 0.7;
      // A sniper fired from the hip is a gamble; scoped, it is a laser that still
      // punishes movement, because the movement term survives the ADS multiplier.
      if (d.id === 'sniper' && !aiming) return d.scopedSpread + state.bloom;
      if (aiming) base *= d.id === 'sniper' ? 0.08 : 0.45;
      return base + state.bloom;
    },
    switchTo(id) {
      if (!owned[id] || id === state.current || state.reloadLeft > 0) return false;
      models[state.current].visible = false;
      state.current = id;
      models[id].visible = true;
      state.switching = 0.35;
      state.cooldown = Math.max(state.cooldown, 0.35);
      return true;
    },
    buy(id) {
      if (owned[id]) return false;
      owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return true;
    },
    has(id) {
      return Boolean(owned[id]);
    },
    ammo() {
      const slot = owned[state.current];
      return { mag: slot.mag, reserve: slot.reserve };
    },
    refillAmmo() {
      for (const id of Object.keys(owned)) {
        owned[id].mag = WEAPONS[id].mag;
        owned[id].reserve = WEAPONS[id].reserve;
      }
      state.grenades = 0;
    },
    setAds(value) {
      for (const model of Object.values(models)) model.userData.ads = value;
    },
    throwGrenade(origin, direction) {
      if (state.grenades <= 0 || grenade.active) return false;
      state.grenades -= 1;
      grenade.active = true;
      grenade.fuse = GRENADE_FUSE;
      grenade.bounced = false;
      grenade.position.copy(origin).addScaledVector(direction, 0.5);
      grenade.velocity.copy(direction).multiplyScalar(13);
      grenade.velocity.y += 3.5;
      grenadeMesh.visible = true;
      grenadeMesh.position.copy(grenade.position);
      return true;
    },
    grenadeState() {
      return grenade;
    },
    grenadeDamage(distance) {
      const t = clamp(1 - distance / GRENADE_RADIUS, 0, 1);
      return Math.round(20 + (GRENADE_MAX_DAMAGE - 20) * t);
    },
    grenadeRadius() {
      return GRENADE_RADIUS;
    },
  };
}
