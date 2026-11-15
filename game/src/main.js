// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// The simulation (player, bots, weapons, match) runs in fixed steps; the render reads the
// result. Shooting is resolved here, where the camera lives: a hitscan ray against the
// world's surfaces and the bots' head and torso meshes, with headshots worth more.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, clamp, tmpA, tmpB, tmpC } from './util.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch } from './match.js';
import { createEconomy, BUY_ITEMS } from './economy.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const BASE_FOV = 74;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color('#241a10'), 30, 85);
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
if (shot) audio.setEnabled(false);
const hud = createHud();
const player = createPlayer(world.colliders, world.spawns.attacker);
const weapons = createWeapons(camera, scene, world.shootables);
const bots = createBots(scene, world, effects, audio, random);
const economy = createEconomy(weapons);
const match = createMatch({ player, bots, weapons, economy, hud, audio, effects, world });
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 140;
const shootables = world.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let lastHealth = body.health;
let wasFiring = false;
let grenadeWasActive = false;
let fov = BASE_FOV;

match.startRound();

hud.onPlay(() => {
  if (shot) return;
  if (match.state.over) {
    match.resetMatch();
    hud.hideOverlay();
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (!match.state.over && (match.state.phase === 'buy' || match.state.phase === 'live' || match.state.phase === 'postplant')) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(clamp(dy / length, -1, 1));
  syncCamera();
}

function shoot(spread) {
  const def = weapons.def();
  if (!weapons.takeRound()) {
    audio.dryClick();
    weapons.reload();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position).addScaledVector(direction, 0.6);
  muzzle.y -= 0.12;
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const end = tmpA.copy(camera.position).addScaledVector(direction, def.range);
  if (hit) {
    end.copy(hit.point);
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const amount = Math.round(def.damage * (part === 'head' ? def.headMult : 1));
      const killed = bots.damage(bot, amount);
      if (killed) {
        match.onKill(bot);
        audio.kill();
      } else {
        audio.hit();
      }
      hud.hitMarker(killed, markerHoldMs);
    } else {
      effects.spawnSparks(hit.point, 6, 3);
    }
  }
  effects.spawnTracer(muzzle, end);
  weapons.pullTrigger();
  player.recoil(def.recoil * (0.85 + random() * 0.3), (random() * 2 - 1) * def.recoil * 0.4);
  audio.shot(def.kind);
  bots.onShotHeard(body.position);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, def.name);
  return true;
}

function explodeGrenade() {
  const grenade = weapons.grenadeState();
  const center = grenade.position;
  effects.spawnExplosion(center);
  audio.explosion();
  const radius = weapons.grenadeRadius();
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const distance = Math.hypot(bot.position.x - center.x, bot.position.z - center.z);
    if (distance > radius) continue;
    tmpB.set(bot.position.x, bot.position.y + 1.0, bot.position.z);
    tmpC.copy(tmpB).sub(center);
    const wallDistance = tmpC.length();
    tmpC.normalize();
    raycaster.set(center, tmpC);
    raycaster.far = wallDistance;
    if (raycaster.intersectObjects(world.shootables, false)[0]) continue;
    const killed = bots.damage(bot, weapons.grenadeDamage(distance));
    if (killed) match.onKill(bot);
  }
  const playerDistance = Math.hypot(body.position.x - center.x, body.position.z - center.z);
  if (playerDistance <= radius && player.state.alive) {
    player.damage(weapons.grenadeDamage(playerDistance));
  }
}

function buyMenuOpen() {
  return !document.getElementById('buy').hidden;
}

function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;
  const live = phase === 'live' || phase === 'postplant';

  // Buy menu and weapon keys, consumed once per press.
  if (input.wasPressed('KeyB') && (phase === 'buy' || phase === 'live')) {
    hud.showBuy(!buyMenuOpen());
  }
  if (buyMenuOpen()) {
    for (const item of BUY_ITEMS) {
      if (input.wasPressed(`Digit${item.key}`)) {
        const result = economy.buy(item.id, player.state);
        hud.markBuy(item.id, result);
        hud.setMoney(economy.state.money);
        if (result === 'bought') {
          audio.buy();
          hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name);
        }
      }
    }
  } else {
    const slots = ['pistol', 'rifle', 'smg', 'sniper'];
    for (let index = 0; index < slots.length; index += 1) {
      if (input.wasPressed(`Digit${index + 1}`) && weapons.has(slots[index])) weapons.switchTo(slots[index]);
    }
    if (input.wasPressed('KeyQ')) {
      const owned = slots.filter((id) => weapons.has(id));
      const at = owned.indexOf(weapons.state.current);
      weapons.switchTo(owned[(at + 1) % owned.length]);
    }
  }
  if (input.wasPressed('KeyR')) {
    const before = weapons.state.reloadLeft;
    weapons.reload();
    if (weapons.state.reloadLeft > before) audio.reload();
  }
  if (input.wasPressed('KeyG') && live && player.state.alive) {
    camera.getWorldDirection(direction);
    if (weapons.throwGrenade(camera.position, direction)) audio.shot('pistol');
  }

  player.step(dt, input.state.keys, input.state.aiming && live);
  weapons.setAds(input.state.aiming && live);
  weapons.step(dt);

  // Firing: automatic weapons hold, single-shot weapons fire once per press.
  const firing = input.state.firing && live && player.state.alive && !match.state.planting;
  const def = weapons.def();
  if (firing && weapons.ready()) {
    if (def.auto || !wasFiring) shoot(shot ? 0 : weapons.spread(player.groundSpeed(), player.state.crouching, input.state.aiming));
  } else if (firing && weapons.ammo().mag === 0 && !wasFiring) {
    audio.dryClick();
    weapons.reload();
  }
  wasFiring = firing;

  if (live && player.state.alive && !shot) bots.step(dt, player, match.state.plant, elapsed);
  match.step(dt, input, elapsed);
  effects.step(dt);

  const grenade = weapons.grenadeState();
  if (grenadeWasActive && !grenade.active) explodeGrenade();
  grenadeWasActive = grenade.active;

  if (body.health < lastHealth) hud.damageFlash();
  lastHealth = body.health;
  hud.setHealth(body.health, body.armor);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name);
  hud.setMoney(economy.state.money);
  hud.setCrosshairGap(4 + weapons.spread(player.groundSpeed(), player.state.crouching, input.state.aiming) * 1800);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    // Aim-down-sights zoom, eased.
    const targetFov = input.state.aiming && (match.state.phase === 'live' || match.state.phase === 'postplant')
      ? BASE_FOV / weapons.def().zoom
      : BASE_FOV;
    fov += (targetFov - fov) * Math.min(1, dt * 12);
    if (Math.abs(fov - camera.fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  body.pitch = 0;
  body.yaw = 0;
  match.state.phase = 'live';
  match.state.phaseLeft = 100;
  if (name === 'start') {
    body.position.set(0.6, 0, 8.6);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('start');
  } else if (name === 'play') {
    body.position.set(0, 0, 5);
    settle(20);
    const bot = bots.bots[0];
    bot.position.set(1.5, 0, -3.5);
    bot.yaw = Math.atan2(-(body.position.x - bot.position.x), -(body.position.z - bot.position.z));
    bot.group.rotation.y = bot.yaw;
    for (let round = 0; round < 2; round += 1) {
      aimAt(new THREE.Vector3(bot.position.x, 1.0, bot.position.z));
      shoot(0);
      settle(8);
    }
    settle(12);
    const second = bots.bots[1];
    second.position.set(-1, 0, -3);
    second.yaw = Math.atan2(-(body.position.x - second.position.x), -(body.position.z - second.position.z));
    second.group.rotation.y = second.yaw;
    aimAt(new THREE.Vector3(second.position.x, 1.0, second.position.z));
    shoot(0);
    // Four steps lets the muzzle flash (0.06 s) and the tracer (0.08 s) die
    // down, while the impact sparks and the hitmarker are still up for the frame.
    settle(4);
  } else {
    // end: all four Sentinels dropped in the open mid lane, round won.
    body.position.set(0, 0, 2);
    settle(20);
    const spots = [
      [-1.5, -4],
      [1.5, -5],
      [-2.5, -7],
      [2.5, -6.5],
    ];
    for (let index = 0; index < bots.bots.length; index += 1) {
      const bot = bots.bots[index];
      bot.position.set(spots[index][0], 0, spots[index][1]);
      bot.yaw = Math.atan2(-(body.position.x - bot.position.x), -(body.position.z - bot.position.z));
      bot.group.rotation.y = bot.yaw;
      // One headshot and one torso shot: 78 + 26 damage drops a Sentinel, and the
      // magazine still holds rounds for the frame.
      aimAt(new THREE.Vector3(bot.position.x, 1.53, bot.position.z));
      shoot(0);
      settle(6);
      aimAt(new THREE.Vector3(bot.position.x, 1.0, bot.position.z));
      shoot(0);
      settle(6);
    }
    settle(30);
    match.state.atkWins = 1;
    hud.setTimer(0, 1, 1, 0);
    hud.showOverlay('roundEnd', 'All Sentinels down — Vanguard 1 · Sentinels 0');
  }
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name);
  hud.hideBanner();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A read-only handle for playtesting: state, not a cheat — the game is single-player.
window.__dustline = { match, player, bots, weapons, economy, world };

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
