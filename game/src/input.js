// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain browser
// APIs only: the game asks the canvas for pointer lock and reads movementX/Y while it holds
// it. Keys are exposed as a Set of codes; edge presses (buy, grenade, interact) are queued
// so the fixed-step simulation can consume each press exactly once.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  // When pointer lock engages, the browser can deliver one mousemove carrying the
  // whole pre-lock cursor travel as movementX/Y (the click that locked it travelled
  // from wherever the cursor was to the button). That is not a look: ignore look
  // input for the first 100 ms after the lock, and drop any single event larger
  // than a human flick could produce in one frame.
  let lockTime = 0;
  const state = {
    keys,
    locked: false,
    firing: false,
    aiming: false,
    lookX: 0,
    lookY: 0,
  };

  function setKey(event, down) {
    if (event.repeat) return;
    if (down) {
      keys.add(event.code);
      pressed.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    if (performance.now() - lockTime < 100) return;
    if (Math.abs(event.movementX) > 300 || Math.abs(event.movementY) > 300) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  window.addEventListener('contextmenu', (event) => {
    if (state.locked) event.preventDefault();
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (state.locked) lockTime = performance.now();
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // True once per physical press; the simulation drains it each step.
    wasPressed(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    clearPresses() {
      pressed.clear();
    },
  };
}
