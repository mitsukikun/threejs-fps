// Procedural sound: every effect is synthesised with the Web Audio API, so the game ships
// no audio files and makes no network request. The context is created lazily on the first
// user gesture (browsers block audio before one); in a scripted capture it stays silent.
// One shared noise buffer feeds the gunshots and the explosion; tones are plain oscillators.
export function createAudio() {
  let context = null;
  let noise = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (context) return context;
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) {
      enabled = false;
      return null;
    }
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.32;
    master.connect(context.destination);
    const length = Math.floor(context.sampleRate * 0.5);
    noise = context.createBuffer(1, length, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return context;
  }

  // Unlock on the first gesture anywhere; a no-op in captures (no gesture happens).
  window.addEventListener('pointerdown', () => {
    const ctx = ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  });
  window.addEventListener('keydown', () => {
    const ctx = ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  });

  function burst(when, duration, filterFreq, gainValue, type = 'lowpass') {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when, Math.random() * 0.2, duration);
    source.stop(when + duration);
  }

  function tone(when, frequency, duration, gainValue, type = 'sine', slideTo = 0) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    if (slideTo > 0) oscillator.frequency.exponentialRampToValueAtTime(slideTo, when + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(when);
    oscillator.stop(when + duration);
  }

  return {
    setEnabled(value) {
      enabled = value;
    },
    // kind: 'rifle' | 'smg' | 'sniper' | 'pistol'. Louder and lower the bigger the gun.
    shot(kind) {
      if (!enabled || !ensure()) return;
      const now = context.currentTime;
      if (kind === 'sniper') {
        burst(now, 0.22, 900, 0.9);
        tone(now, 150, 0.14, 0.5, 'sine', 55);
      } else if (kind === 'rifle') {
        burst(now, 0.12, 1800, 0.7);
        tone(now, 190, 0.08, 0.32, 'sine', 70);
      } else if (kind === 'smg') {
        burst(now, 0.08, 2600, 0.5);
        tone(now, 240, 0.05, 0.22, 'sine', 90);
      } else {
        burst(now, 0.09, 2200, 0.55);
        tone(now, 210, 0.06, 0.26, 'sine', 80);
      }
    },
    distantShot() {
      if (!enabled || !ensure()) return;
      burst(context.currentTime, 0.18, 500, 0.28);
    },
    dryClick() {
      if (!enabled || !ensure()) return;
      tone(context.currentTime, 1400, 0.03, 0.2, 'square');
    },
    reload() {
      if (!enabled || !ensure()) return;
      const now = context.currentTime;
      tone(now, 900, 0.04, 0.22, 'square');
      tone(now + 0.28, 620, 0.04, 0.22, 'square');
    },
    hit() {
      if (!enabled || !ensure()) return;
      tone(context.currentTime, 2100, 0.05, 0.3, 'sine');
    },
    kill() {
      if (!enabled || !ensure()) return;
      const now = context.currentTime;
      tone(now, 1560, 0.06, 0.3, 'sine');
      tone(now + 0.07, 2100, 0.08, 0.3, 'sine');
    },
    hurt() {
      if (!enabled || !ensure()) return;
      tone(context.currentTime, 120, 0.16, 0.4, 'sawtooth', 60);
    },
    plantBeep(final) {
      if (!enabled || !ensure()) return;
      tone(context.currentTime, final ? 1800 : 1200, final ? 0.3 : 0.12, 0.3, 'square');
    },
    explosion() {
      if (!enabled || !ensure()) return;
      const now = context.currentTime;
      burst(now, 0.9, 320, 1.0);
      tone(now, 90, 0.7, 0.7, 'sine', 32);
    },
    roundWin() {
      if (!enabled || !ensure()) return;
      const now = context.currentTime;
      tone(now, 523, 0.12, 0.28, 'sine');
      tone(now + 0.12, 659, 0.12, 0.28, 'sine');
      tone(now + 0.24, 784, 0.22, 0.3, 'sine');
    },
    roundLose() {
      if (!enabled || !ensure()) return;
      const now = context.currentTime;
      tone(now, 392, 0.14, 0.28, 'sine');
      tone(now + 0.14, 311, 0.14, 0.28, 'sine');
      tone(now + 0.28, 233, 0.26, 0.3, 'sine');
    },
    buy() {
      if (!enabled || !ensure()) return;
      const now = context.currentTime;
      tone(now, 880, 0.05, 0.25, 'sine');
      tone(now + 0.06, 1320, 0.07, 0.25, 'sine');
    },
  };
}
