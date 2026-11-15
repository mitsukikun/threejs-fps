// The defenders: four SENTINEL bots that hold the sites, patrol the lanes, and react to
// what they see and hear. Each bot is a small state machine — hold, patrol, investigate,
// engage, defuse — driven by line of sight, hearing and the bomb state. They shoot with
// a reaction delay and an aim error that shrinks the longer they hold a sightline, so a
// player who peeks, fires and vanishes beats one who stands in the open trading shots.
// Bots move with the same box-versus-collider resolution as the player, so they never
// clip through the map. All hot-loop math reuses scratch vectors; nothing is allocated
// per frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp, angleDelta, tmpA, tmpB, tmpC, tmpD, tmpE, tmpF, tmpRay } from './util.js';
import { WAYPOINTS, PATROL_LOOP } from './world.js';

const BOT_COUNT = 4;
const BOT_SPEED = 3.6;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const REACTION_MIN = 0.5;
const REACTION_MAX = 0.8;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.11;
const BURST_PAUSE_MIN = 1.2;
const BURST_PAUSE_MAX = 2.0;
const AIM_ERROR_START = 0.075;
const AIM_ERROR_AIMING = 0.032;
const BOT_DAMAGE = 18;
const DEFUSE_SECONDS = 5;

function rayHitsSphere(origin, direction, center, radius) {
  // Returns the ray distance to the sphere, or -1. Uses its own scratch vector so
  // the caller's direction vector survives the call.
  tmpF.copy(center).sub(origin);
  const along = tmpF.dot(direction);
  if (along < 0) return -1;
  const closestSq = tmpF.lengthSq() - along * along;
  const radiusSq = radius * radius;
  if (closestSq > radiusSq) return -1;
  return along - Math.sqrt(radiusSq - closestSq);
}

export function createBots(scene, world, effects, audio, random) {
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f46'), roughness: 0.6, metalness: 0.15 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23262b'), roughness: 0.55, metalness: 0.2 });
  const visorMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.35, metalness: 0.1, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.5 });

  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.16, 14, 10);
  const visorGeometry = new THREE.BoxGeometry(0.22, 0.05, 0.05);
  const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.5);
  const legGeometry = new THREE.BoxGeometry(0.2, 0.7, 0.22);

  const bots = [];
  const hitMeshes = [];
  for (let index = 0; index < BOT_COUNT; index += 1) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeometry, bodyMaterial);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.53;
    const visor = new THREE.Mesh(visorGeometry, visorMaterial);
    visor.position.set(0, 1.55, -0.14);
    const gun = new THREE.Mesh(gunGeometry, headMaterial);
    gun.position.set(0.2, 1.05, -0.35);
    const legL = new THREE.Mesh(legGeometry, headMaterial);
    legL.position.set(-0.14, 0.35, 0);
    const legR = new THREE.Mesh(legGeometry, headMaterial);
    legR.position.set(0.14, 0.35, 0);
    group.add(torso, head, visor, gun, legL, legR);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      index,
      group,
      torso,
      head,
      position: group.position,
      yaw: 0,
      health: 100,
      alive: true,
      state: 'hold',
      patrolAt: index * 2,
      holdUntil: 0,
      target: new THREE.Vector3(),
      lastSeen: new THREE.Vector3(),
      lastSeenAt: -99,
      reactionLeft: 0,
      aimError: AIM_ERROR_START,
      burstLeft: 0,
      shotTimer: 0,
      pauseLeft: 0,
      defuseLeft: 0,
      stuckTimer: 0,
      stuckPos: new THREE.Vector3(),
      strafeDir: index % 2 === 0 ? 1 : -1,
      strafeTimer: 0,
      speed: BOT_SPEED * (0.92 + random() * 0.16),
      reaction: REACTION_MIN + random() * (REACTION_MAX - REACTION_MIN),
    };
    // Hit meshes: the raycaster reads these to resolve headshots. The torso and head
    // carry their bot and part, so a shot knows what it hit.
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
  }

  const probe = new THREE.Box3();
  function overlaps(x, y, z) {
    probe.min.set(x - BOT_RADIUS, y + 0.04, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, y + BOT_HEIGHT - 0.04, z + BOT_RADIUS);
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function moveToward(bot, destination, dt, now) {
    tmpA.copy(destination).sub(bot.position);
    tmpA.y = 0;
    const distance = tmpA.length();
    if (distance < 0.15) return true;
    tmpA.normalize();
    const step = bot.speed * dt;
    const nextX = bot.position.x + tmpA.x * step;
    if (!overlaps(nextX, bot.position.y, bot.position.z)) bot.position.x = nextX;
    const nextZ = bot.position.z + tmpA.z * step;
    if (!overlaps(bot.position.x, bot.position.y, nextZ)) bot.position.z = nextZ;
    bot.yaw = Math.atan2(-tmpA.x, -tmpA.z);
    // Stuck detection: if the bot barely moved for 1.5 s, it repaths via the patrol loop.
    if (bot.position.distanceToSquared(bot.stuckPos) > 0.09) {
      bot.stuckPos.copy(bot.position);
      bot.stuckTimer = 0;
    } else {
      bot.stuckTimer += dt;
      if (bot.stuckTimer > 1.5) {
        bot.stuckTimer = 0;
        bot.patrolAt = (bot.patrolAt + 1) % PATROL_LOOP.length;
        bot.target.copy(WAYPOINTS[PATROL_LOOP[bot.patrolAt]]);
        bot.state = 'patrol';
      }
    }
    return distance < 0.4;
  }

  function canSee(bot, playerPosition, playerEye) {
    tmpA.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    tmpB.set(playerPosition.x, playerPosition.y + playerEye - 0.15, playerPosition.z);
    const distance = tmpA.distanceTo(tmpB);
    if (distance > 55) return -1;
    tmpC.copy(tmpB).sub(tmpA).normalize();
    tmpRay.set(tmpA, tmpC);
    tmpRay.far = distance;
    const hit = tmpRay.intersectObjects(world.shootables, false)[0];
    if (hit) return -1;
    // Field of view: the bot must be roughly facing the player, unless very close.
    const facing = Math.atan2(-(tmpB.x - tmpA.x), -(tmpB.z - tmpA.z));
    const delta = Math.abs(angleDelta(bot.yaw, facing));
    if (distance > 6 && delta > 1.15) return -1;
    return distance;
  }

  function fireAt(bot, player, now, dt) {
    const ps = player.state;
    bot.shotTimer -= dt;
    if (bot.shotTimer > 0) return;
    if (bot.burstLeft <= 0) {
      bot.pauseLeft -= dt;
      if (bot.pauseLeft > 0) return;
      bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
      bot.pauseLeft = BURST_PAUSE_MIN + random() * (BURST_PAUSE_MAX - BURST_PAUSE_MIN);
    }
    bot.shotTimer = SHOT_GAP;
    bot.burstLeft -= 1;
    // Aim at the player's chest with the current error cone. A moving player is
    // harder to track: the error grows with the player's ground speed.
    tmpA.set(bot.position.x, bot.position.y + 1.45, bot.position.z);
    tmpB.set(ps.position.x, ps.position.y + 1.0, ps.position.z);
    const distance = tmpA.distanceTo(tmpB);
    tmpC.copy(tmpB).sub(tmpA).normalize();
    const error = bot.aimError * (1 + distance / 40) * (1 + player.groundSpeed() / 6);
    tmpC.x += (random() * 2 - 1) * error;
    tmpC.y += (random() * 2 - 1) * error;
    tmpC.z += (random() * 2 - 1) * error;
    tmpC.normalize();
    // A wall between bot and player eats the shot.
    tmpRay.set(tmpA, tmpC);
    tmpRay.far = distance + 2;
    const wall = tmpRay.intersectObjects(world.shootables, false)[0];
    const wallDistance = wall ? wall.distance : Infinity;
    // Player approximated as two spheres: head and torso.
    const headCenter = tmpD.set(ps.position.x, ps.position.y + ps.eye - 0.08, ps.position.z);
    const headHit = rayHitsSphere(tmpA, tmpC, headCenter, 0.2);
    const bodyCenter = tmpE.set(ps.position.x, ps.position.y + 0.95, ps.position.z);
    const bodyHit = rayHitsSphere(tmpA, tmpC, bodyCenter, 0.42);
    let hitDistance = -1;
    let part = null;
    if (headHit >= 0 && headHit < wallDistance) {
      hitDistance = headHit;
      part = 'head';
    }
    if (bodyHit >= 0 && bodyHit < wallDistance && (hitDistance < 0 || bodyHit < hitDistance)) {
      hitDistance = bodyHit;
      part = 'torso';
    }
    const end = tmpB.copy(tmpA).addScaledVector(tmpC, hitDistance >= 0 ? hitDistance : Math.min(distance + 4, 60));
    effects.spawnTracer(tmpA, end);
    if (hitDistance >= 0) {
      const falloff = clamp(1 - (distance - 10) / 50, 0.55, 1);
      const damage = Math.round(BOT_DAMAGE * falloff * (part === 'head' ? 2 : 1));
      player.damage(damage);
      audio.hurt();
    } else {
      audio.distantShot();
    }
  }

  function reset(spawnPoints) {
    for (let index = 0; index < bots.length; index += 1) {
      const bot = bots[index];
      bot.position.copy(spawnPoints[index % spawnPoints.length]);
      bot.position.y = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      bot.yaw = Math.PI;
      bot.health = 100;
      bot.alive = true;
      bot.state = 'hold';
      bot.patrolAt = index * 2;
      bot.holdUntil = 0;
      bot.aimError = AIM_ERROR_START;
      bot.burstLeft = 0;
      bot.shotTimer = 0;
      bot.pauseLeft = 0;
      bot.defuseLeft = 0;
      bot.group.visible = true;
    }
  }

  return {
    bots,
    hitMeshes,
    reset,
    aliveCount() {
      let count = 0;
      for (const bot of bots) if (bot.alive) count += 1;
      return count;
    },
    damage(bot, amount) {
      if (!bot.alive) return false;
      bot.health -= amount;
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.group.rotation.x = -Math.PI / 2 + 0.12;
      bot.group.position.y = 0.12;
      return true;
    },
    onShotHeard(position) {
      for (const bot of bots) {
        if (!bot.alive || bot.state === 'engage' || bot.state === 'defuse') continue;
        if (bot.position.distanceTo(position) > 34) continue;
        bot.target.set(
          position.x + (random() * 2 - 1) * 2,
          0,
          position.z + (random() * 2 - 1) * 2,
        );
        bot.state = 'investigate';
        bot.holdUntil = 0;
      }
    },
    step(dt, player, plant, now) {
      const ps = player.state;
      for (const bot of bots) {
        if (!bot.alive) continue;
        const seen = ps.alive ? canSee(bot, ps.position, ps.eye) : -1;

        if (seen >= 0) {
          bot.lastSeen.copy(ps.position);
          bot.lastSeenAt = now;
          if (bot.state !== 'engage') {
            bot.state = 'engage';
            bot.reactionLeft = bot.reaction;
            bot.aimError = AIM_ERROR_START;
            bot.burstLeft = 0;
            bot.shotTimer = 0;
          }
        }

        if (bot.state === 'engage') {
          // Face the player (or the last seen spot) and hold the angle.
          const aimAt = seen >= 0 ? ps.position : bot.lastSeen;
          const targetYaw = Math.atan2(-(aimAt.x - bot.position.x), -(aimAt.z - bot.position.z));
          bot.yaw += clamp(angleDelta(bot.yaw, targetYaw), -dt * 4, dt * 4);
          bot.group.rotation.y = bot.yaw;
          if (seen >= 0) {
            bot.aimError = Math.max(AIM_ERROR_AIMING, bot.aimError - dt * 0.09);
            bot.reactionLeft -= dt;
            if (bot.reactionLeft <= 0) {
              // Strafe while shooting, so the player must track a moving target.
              bot.strafeTimer -= dt;
              if (bot.strafeTimer <= 0) {
                bot.strafeTimer = 0.9 + random() * 0.9;
                bot.strafeDir = random() < 0.5 ? -1 : 1;
              }
              tmpA.set(Math.cos(bot.yaw) * bot.strafeDir, 0, -Math.sin(bot.yaw) * bot.strafeDir);
              const nextX = bot.position.x + tmpA.x * bot.speed * 0.45 * dt;
              if (!overlaps(nextX, bot.position.y, bot.position.z)) bot.position.x = nextX;
              const nextZ = bot.position.z + tmpA.z * bot.speed * 0.45 * dt;
              if (!overlaps(bot.position.x, bot.position.y, nextZ)) bot.position.z = nextZ;
              fireAt(bot, player, now, dt);
            }
          } else if (now - bot.lastSeenAt > 2) {
            // Lost the player: push to the last seen spot, then resume the patrol.
            bot.target.copy(bot.lastSeen);
            bot.state = 'investigate';
          }
          continue;
        }

        if (plant.active && plant.site) {
          // The bomb is down: converge on the site; the closest bot defuses.
          const site = plant.site.center;
          const distance = Math.hypot(bot.position.x - site.x, bot.position.z - site.z);
          if (bot.state !== 'defuse' && distance < 2.2) {
            bot.state = 'defuse';
            bot.defuseLeft = DEFUSE_SECONDS;
          }
          if (bot.state === 'defuse') {
            bot.yaw += clamp(angleDelta(bot.yaw, 0), -dt * 3, dt * 3);
            bot.group.rotation.y = bot.yaw;
            bot.defuseLeft -= dt;
            if (bot.defuseLeft <= 0) {
              plant.defused = true;
              bot.state = 'hold';
            }
            continue;
          }
          bot.target.copy(site);
          moveToward(bot, bot.target, dt, now);
          bot.group.rotation.y = bot.yaw;
          continue;
        }

        if (bot.state === 'investigate') {
          if (moveToward(bot, bot.target, dt, now)) {
            if (bot.holdUntil === 0) bot.holdUntil = now + 2;
            bot.yaw += dt * 1.6;
            if (now >= bot.holdUntil) {
              bot.state = 'patrol';
              bot.holdUntil = 0;
            }
          }
          bot.group.rotation.y = bot.yaw;
          continue;
        }

        if (bot.state === 'hold') {
          bot.holdUntil -= dt;
          bot.yaw += Math.sin(now * 0.5 + bot.index * 2.1) * dt * 0.35;
          bot.group.rotation.y = bot.yaw;
          if (bot.holdUntil <= 0) {
            bot.state = 'patrol';
            bot.target.copy(WAYPOINTS[PATROL_LOOP[bot.patrolAt % PATROL_LOOP.length]]);
          }
          continue;
        }

        // patrol
        if (moveToward(bot, bot.target, dt, now)) {
          bot.patrolAt = (bot.patrolAt + 1) % PATROL_LOOP.length;
          bot.target.copy(WAYPOINTS[PATROL_LOOP[bot.patrolAt]]);
          bot.state = 'hold';
          bot.holdUntil = 1.2 + random() * 2.4;
        }
        bot.group.rotation.y = bot.yaw;
      }
    },
  };
}
