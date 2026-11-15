// Small shared helpers. One seeded RNG so a capture seed reproduces a frame exactly, a
// few number helpers, and the preallocated scratch vectors the hot loops reuse instead of
// allocating a new Vector3 every frame.
import * as THREE from 'three';

// mulberry32: a tiny deterministic generator. Same seed, same stream, every run.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Shortest signed difference between two yaw angles, in (-PI, PI].
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Scratch vectors: one per hot-loop site, never written to the heap per frame.
export const tmpA = new THREE.Vector3();
export const tmpB = new THREE.Vector3();
export const tmpC = new THREE.Vector3();
export const tmpD = new THREE.Vector3();
export const tmpE = new THREE.Vector3();
export const tmpF = new THREE.Vector3();
export const tmpRay = new THREE.Raycaster();
