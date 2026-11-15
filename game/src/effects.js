// Combat effects, all pooled: tracers, impact sparks and explosion flashes. Nothing is
// created or destroyed per frame — the pools are built once and reused, which is what
// keeps the frame time steady when a firefight fills the air with lead.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 24;
const TRACER_LIFE = 0.08;
const SPARK_COUNT = 240;
const SPARK_LIFE = 0.45;

export function createEffects(scene) {
  const tracerGeometry = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.ink),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mesh = new THREE.Mesh(tracerGeometry, tracerMaterial.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerAt = 0;

  // One Points cloud for every impact spark in the game.
  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  const sparkColors = new Float32Array(SPARK_COUNT * 3);
  const sparkVelocity = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  for (let i = 0; i < SPARK_COUNT; i += 1) sparkPositions[i * 3 + 1] = -100;
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
  const sparkMaterial = new THREE.PointsMaterial({
    size: 0.09,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkAt = 0;

  // Explosion flashes: two expanding additive spheres, reused.
  const blasts = [];
  for (let i = 0; i < 2; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    blasts.push({ mesh, life: 0 });
  }
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 22, 1.5);
  scene.add(blastLight);

  const mid = new THREE.Vector3();

  return {
    spawnTracer(from, to) {
      const tracer = tracers[tracerAt];
      tracerAt = (tracerAt + 1) % TRACER_COUNT;
      const length = from.distanceTo(to);
      if (length < 0.1) return;
      mid.copy(from).add(to).multiplyScalar(0.5);
      tracer.mesh.position.copy(mid);
      tracer.mesh.lookAt(to);
      tracer.mesh.scale.set(1, 1, length);
      tracer.mesh.material.opacity = 0.9;
      tracer.mesh.visible = true;
      tracer.life = TRACER_LIFE;
    },
    spawnSparks(point, count, speed = 4) {
      for (let n = 0; n < count; n += 1) {
        const i = sparkAt;
        sparkAt = (sparkAt + 1) % SPARK_COUNT;
        sparkPositions[i * 3] = point.x;
        sparkPositions[i * 3 + 1] = point.y;
        sparkPositions[i * 3 + 2] = point.z;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        const v = speed * (0.4 + Math.random() * 0.8);
        sparkVelocity[i * 3] = Math.sin(phi) * Math.cos(theta) * v;
        sparkVelocity[i * 3 + 1] = Math.cos(phi) * v * 0.7 + 1.2;
        sparkVelocity[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * v;
        sparkColors[i * 3] = 1.0;
        sparkColors[i * 3 + 1] = 0.72;
        sparkColors[i * 3 + 2] = 0.25;
        sparkLife[i] = SPARK_LIFE;
      }
      sparkGeometry.attributes.position.needsUpdate = true;
      sparkGeometry.attributes.color.needsUpdate = true;
    },
    spawnExplosion(point) {
      const blast = blasts.find((b) => b.life <= 0) ?? blasts[0];
      blast.mesh.position.copy(point);
      blast.mesh.scale.setScalar(0.5);
      blast.mesh.material.opacity = 0.9;
      blast.mesh.visible = true;
      blast.life = 0.5;
      blastLight.position.copy(point);
      blastLight.position.y += 1;
      blastLight.intensity = 60;
      this.spawnSparks(point, 60, 7);
    },
    step(dt) {
      for (const tracer of tracers) {
        if (tracer.life <= 0) continue;
        tracer.life -= dt;
        tracer.mesh.material.opacity = Math.max(0, tracer.life / TRACER_LIFE) * 0.9;
        if (tracer.life <= 0) tracer.mesh.visible = false;
      }
      let anySpark = false;
      for (let i = 0; i < SPARK_COUNT; i += 1) {
        if (sparkLife[i] <= 0) continue;
        anySpark = true;
        sparkLife[i] -= dt;
        sparkVelocity[i * 3 + 1] -= 9 * dt;
        sparkPositions[i * 3] += sparkVelocity[i * 3] * dt;
        sparkPositions[i * 3 + 1] += sparkVelocity[i * 3 + 1] * dt;
        sparkPositions[i * 3 + 2] += sparkVelocity[i * 3 + 2] * dt;
        if (sparkPositions[i * 3 + 1] < 0.02) {
          sparkPositions[i * 3 + 1] = 0.02;
          sparkVelocity[i * 3 + 1] *= -0.3;
        }
        const fade = Math.max(0, sparkLife[i] / SPARK_LIFE);
        sparkColors[i * 3] = fade;
        sparkColors[i * 3 + 1] = fade * 0.72;
        sparkColors[i * 3 + 2] = fade * 0.25;
        if (sparkLife[i] <= 0) sparkPositions[i * 3 + 1] = -100;
      }
      if (anySpark) {
        sparkGeometry.attributes.position.needsUpdate = true;
        sparkGeometry.attributes.color.needsUpdate = true;
      }
      for (const blast of blasts) {
        if (blast.life <= 0) continue;
        blast.life -= dt;
        const t = 1 - blast.life / 0.5;
        blast.mesh.scale.setScalar(0.5 + t * 6);
        blast.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
        if (blast.life <= 0) blast.mesh.visible = false;
      }
      blastLight.intensity = Math.max(0, blastLight.intensity - dt * 220);
    },
  };
}
