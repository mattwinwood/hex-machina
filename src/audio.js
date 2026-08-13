// Music + SFX. Each stage streams its own track through a WebAudio graph so an
// analyser can drive the visual pulse; the sound effects stay synthesised.

// --- Onset detection --------------------------------------------------------
// Which bins carry the beat, at a 1024-point FFT (~47 Hz per bin): kick, bass
// and the body of a snare. Hats are deliberately excluded — they land on every
// subdivision and would fire the pulse continuously.
const FLUX_LOW = 1;    // ~47 Hz
const FLUX_HIGH = 24;  // ~1.1 kHz
const ONSET_RATIO = 1.5;   // how far above its own running average counts as a hit
const ONSET_FLOOR = 0.006; // absolute floor, so near-silence cannot self-trigger
const ONSET_GAP = 0.11;    // seconds; anything closer is the same hit
const PULSE_DECAY = 0.22;  // seconds to fall to 1/e — measured off the original
// The range a human reads as "the beat". A 200bpm track is tapped at ~100bpm.
const BEAT_MIN = 0.42;
const BEAT_MAX = 0.95;

const MUTE_KEY = 'hexmachina.muted';
const MUSIC_GAIN = 0.55;
const TRACK_DIR = 'audio';

const noteHz = (semi) => 55 * Math.pow(2, semi / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.elements = new Map(); // track id -> { el, node }
    this.current = null;
    this.bins = null;
    this.level = 0;
    this.beatClock = 0;
    this.prevBins = null;
    this.fluxAvg = 0;
    this.sinceOnset = 9;
    this.onsets = 0; // count of detected hits, for tuning
    this.lastOnsetAt = 0; // ctx time of the most recent hit
    this.gaps = []; // recent inter-onset intervals, for the grid estimate
    this.beatAnchor = 0; // ctx time of a grid point on the locked clock
    this.beatPeriod = 0; // the locked clock's period
    this.lockedTo = null; // track id the clock is locked to
  }

  /** Must be called from a user gesture before anything will make sound. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -10;
      this.comp.ratio.value = 6;
      this.comp.connect(this.ctx.destination);
      this.master.connect(this.comp);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = MUSIC_GAIN;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      // Barely any smoothing: this analyser feeds onset detection, and smoothing
      // is exactly what blurs an attack into a swell. 0.5 was hiding the hits.
      this.analyser.smoothingTimeConstant = 0.12;
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      this.prevBins = new Uint8Array(this.analyser.frequencyBinCount);
      // A filter on the music bus lets a phase change be *heard*, not just seen.
      this.tone = this.ctx.createBiquadFilter();
      this.tone.type = 'lowpass';
      this.tone.frequency.value = 20000;
      this.tone.Q.value = 0.8;
      this.musicGain.connect(this.tone);
      this.tone.connect(this.analyser);
      this.analyser.connect(this.master);

      this.noise = makeNoise(this.ctx);
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  /**
   * iOS suspends (and sometimes "interrupts") the AudioContext when the tab
   * goes to the background, and the media element stops with it. Coming back
   * needs an explicit resume *and* a re-play — without both, everything stays
   * silent until a reload.
   */
  async wake() {
    if (!this.ctx) return;
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
    } catch {
      /* the platform may refuse until the next gesture; the retry below covers it */
    }
    const el = this.current && this.current.el;
    if (el && el.paused && this.shouldPlay) {
      try {
        await el.play();
      } catch {
        /* blocked until a gesture — resumed again on the next tap */
      }
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Lazily build the <audio> element + graph node for a track. */
  trackFor(id) {
    if (!this.ctx) return null;
    let entry = this.elements.get(id);
    if (!entry) {
      const el = new Audio(`${TRACK_DIR}/${id}.mp3`);
      el.loop = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      // A media element can only ever be adopted by one source node.
      const node = this.ctx.createMediaElementSource(el);
      node.connect(this.musicGain);
      entry = { el, node };
      this.elements.set(id, entry);
    }
    return entry;
  }

  /**
   * Resolve once `id` can play without stalling. Always resolves — on error, on
   * a slow network, or on a browser that never fires canplaythrough — because a
   * silent failure here would otherwise leave the player stuck on a spinner.
   */
  prepare(id) {
    this.unlock();
    const entry = this.trackFor(id);
    if (!entry) return Promise.resolve();
    const el = entry.el;
    if (el.readyState >= 3) return Promise.resolve(); // HAVE_FUTURE_DATA
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        el.removeEventListener('canplaythrough', finish);
        el.removeEventListener('loadeddata', finish);
        el.removeEventListener('error', finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 6000);
      el.addEventListener('canplaythrough', finish);
      el.addEventListener('loadeddata', finish);
      el.addEventListener('error', finish);
      if (el.readyState === 0) el.load();
    });
  }

  playTrack(id) {
    this.unlock();
    this.shouldPlay = true;
    // The beat clock belongs to the track, not the run. Retrying the daily keeps
    // the lock — it only has to be relearned when the music actually changes,
    // which matters because locking takes a second or so of listening.
    if (this.lockedTo !== id) {
      this.lockedTo = id;
      this.gaps.length = 0;
      this.beatAnchor = 0;
      this.beatPeriod = 0;
      this.lastOnsetAt = 0;
    }
    const entry = this.trackFor(id);
    if (!entry) return;
    if (this.current && this.current !== entry) this.stopMusic();
    this.current = entry;
    entry.el.currentTime = 0;
    const p = entry.el.play();
    if (p && p.catch) p.catch(() => { /* blocked until a real gesture */ });
  }

  pauseMusic() {
    this.shouldPlay = false;
    this.current?.el.pause();
  }

  resumeMusic() {
    this.shouldPlay = true;
    const p = this.current?.el.play();
    if (p && p.catch) p.catch(() => {});
  }

  stopMusic() {
    this.shouldPlay = false;
    if (!this.current) return;
    this.current.el.pause();
    this.current.el.currentTime = 0;
    this.current = null;
  }

  /**
   * Beat pulse, 0..1. Read from the music's own low end so it locks to whatever
   * the track actually does — no BPM constant to get wrong. Falls back to a
   * plain metronome when muted or before any track is running.
   */
  /**
   * Beat pulse, driven by the track's *transients* rather than its loudness.
   *
   * This used to be an envelope follower on the bass band, which is a volume
   * meter: a sustained bass note held the pulse up, and a kick landing inside an
   * already-loud passage barely moved it. What we want is the attack, so this
   * measures spectral flux — the sum of per-bin *rises* between frames — and
   * fires when that jumps above a running average of itself. An adaptive
   * threshold means a quiet intro still registers its own hits and a dense
   * chorus does not trigger every frame.
   */
  pulse(dt, fallbackBpm) {
    const playing = this.analyser && this.current && !this.current.el.paused && !this.muted;
    if (!playing) {
      this.beatClock += (dt * fallbackBpm) / 60;
      return Math.pow(1 - (this.beatClock % 1), 3);
    }
    this.analyser.getByteFrequencyData(this.bins);

    let flux = 0;
    for (let i = FLUX_LOW; i <= FLUX_HIGH; i++) {
      const rise = this.bins[i] - this.prevBins[i];
      if (rise > 0) flux += rise;
      this.prevBins[i] = this.bins[i];
    }
    flux /= (FLUX_HIGH - FLUX_LOW + 1) * 255;

    this.fluxAvg += (flux - this.fluxAvg) * Math.min(1, dt * 4);
    this.sinceOnset += dt;
    const thresh = this.fluxAvg * ONSET_RATIO + ONSET_FLOOR;

    if (flux > thresh && this.sinceOnset >= ONSET_GAP) {
      this.noteOnset();
      this.sinceOnset = 0;
      this.onsets++;
      // Harder hits punch harder, but every hit registers at all.
      const strength = Math.max(0.45, Math.min(1, flux / (thresh * 1.7)));
      this.level = Math.max(this.level, strength);
    } else {
      // Exponential fall, time constant measured off the original's camera.
      this.level *= Math.exp(-dt / PULSE_DECAY);
    }
    return this.level;
  }

  // --- SFX ------------------------------------------------------------------

  death() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.55);
    const a = this.ctx.createGain();
    a.gain.setValueAtTime(0.5, t);
    a.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(a).connect(this.master);
    o.start(t);
    o.stop(t + 0.62);
    this.noiseHit(t, 1, 1400, 0.16);
  }

  rank() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12].forEach((semi, i) => this.blip(noteHz(semi + 48), 0.22, t + i * 0.06));
  }

  hyper() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 5, 12, 17, 24].forEach((semi, i) => this.blip(noteHz(semi + 48), 0.26, t + i * 0.07, 'sawtooth'));
    this.noiseHit(t, 0.7, 900, 0.5);
  }

  // --- UI cues -------------------------------------------------------------
  // Distinct shapes, not one blip reused: rising = affirmative, falling =
  // dismissive, so the menu is legible with your eyes shut.

  menuBlip() {
    if (!this.ctx) return;
    this.blip(noteHz(48), 0.14, this.ctx.currentTime);
  }

  /** Moving along a row of options. */
  uiMove(dir = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.blip(noteHz(dir > 0 ? 52 : 50), 0.12, t, 'triangle');
  }

  /** Committing: two notes up. */
  uiConfirm() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.blip(noteHz(52), 0.2, t, 'square');
    this.blip(noteHz(59), 0.2, t + 0.055, 'square');
  }

  /** Backing out: the same interval, inverted. */
  uiBack() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.blip(noteHz(52), 0.16, t, 'triangle');
    this.blip(noteHz(45), 0.16, t + 0.055, 'triangle');
  }

  /** A sheet sliding in. */
  uiOpen() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 5, 9].forEach((semi, i) => this.blip(noteHz(48 + semi), 0.14, t + i * 0.04, 'triangle'));
  }

  /** Switch flipped. Pitch encodes the new state. */
  uiToggle(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.blip(noteHz(on ? 55 : 48), 0.18, t, 'square');
    this.blip(noteHz(on ? 62 : 43), 0.14, t + 0.05, 'square');
  }

  /** Something refused — a locked stage, a dead control. */
  uiDeny() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.blip(noteHz(40), 0.18, t, 'sawtooth');
    this.blip(noteHz(37), 0.16, t + 0.07, 'sawtooth');
  }

  /** Sweep the music's filter to mark a phase change. */
  setTone(cutoff, seconds = 0.6) {
    if (!this.tone) return;
    const t = this.ctx.currentTime;
    this.tone.frequency.cancelScheduledValues(t);
    this.tone.frequency.setTargetAtTime(Math.max(200, cutoff), t, seconds / 3);
  }

  /**
   * Remember when hits land, and keep a running estimate of the grid they sit
   * on. Detected onsets are the *past*; obstacles have to be scheduled into the
   * future, so the period is estimated from recent intervals and projected
   * forward from the most recent hit.
   */
  noteOnset() {
    const now = this.ctx.currentTime;
    if (this.lastOnsetAt) {
      const gap = now - this.lastOnsetAt;
      // Ignore anything outside a musical range: dropouts and double-triggers
      // would otherwise drag the estimate off the grid.
      if (gap > 0.09 && gap < 0.75) {
        this.gaps.push(gap);
        if (this.gaps.length > 24) this.gaps.shift();
      }
    }
    this.lastOnsetAt = now;

    // Lock a free-running clock to the music instead of re-anchoring to the
    // latest hit. Obstacles are scheduled seconds ahead, so the grid they aim at
    // has to still be there when they land — anchoring to "the most recent
    // onset" moves the target after the shot is fired, and measured as no better
    // than random.
    const per = this.gridPeriod;
    if (!per) return;
    if (!this.beatAnchor) { this.beatAnchor = now; this.beatPeriod = per; return; }

    this.beatPeriod += (per - this.beatPeriod) * 0.08;
    const k = Math.round((now - this.beatAnchor) / this.beatPeriod);
    const err = now - (this.beatAnchor + k * this.beatPeriod);
    // Only trust hits near the predicted grid; syncopation and ghost notes must
    // not drag the phase around.
    if (Math.abs(err) < this.beatPeriod * 0.3) this.beatAnchor += err * 0.18;
  }

  /**
   * The period obstacles should be scheduled against — the pulse a listener
   * would tap, not the finest subdivision the detector can see.
   *
   * Detection locks onto eighths (150ms on a 200bpm track). Landing rings on an
   * arbitrary eighth is 400 events a minute and reads as no rhythm at all, so
   * the raw interval is doubled into a tapping range. Measured: a 150ms grid put
   * rings 2.94 grid-units apart — musically nowhere — while folding to 600ms put
   * them exactly 1.00 apart, one per beat.
   */
  get gridPeriod() {
    if (this.gaps.length < 8) return null;
    const g = [...this.gaps].sort((a, b) => a - b);
    let p = g[g.length >> 1];
    while (p < BEAT_MIN) p *= 2;
    while (p > BEAT_MAX) p /= 2;
    return p;
  }

  /**
   * The next grid point at or after `ahead` seconds from now, expressed in
   * seconds from now. Returns `ahead` unchanged when there is no reliable beat
   * yet, so the caller degrades to its own spacing rather than to nonsense.
   */
  nextGrid(ahead) {
    const p = this.beatPeriod;
    if (!p || !this.ctx || !this.beatAnchor) return ahead;
    const now = this.ctx.currentTime;
    const k = Math.ceil((now + ahead - this.beatAnchor) / p - 1e-6);
    return (this.beatAnchor + k * p) - now;
  }

  /**
   * Grazing: a real hit, not a tick. A transient plus a rising tone so a chain
   * is audible without looking, and the automatic slowdown has a sound to land on.
   */
  grazeTick(chain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const semi = 60 + Math.min(24, chain);
    this.blip(noteHz(semi), 0.16, t, 'triangle');
    this.blip(noteHz(semi + 7), 0.1, t + 0.035, 'triangle');
    this.noiseHit(t, 0.28, 3200, 0.06);
  }

  shiftSfx() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 7, 12].forEach((semi, i) => this.blip(noteHz(44 + semi), 0.2, t + i * 0.05, 'sawtooth'));
    this.noiseHit(t, 0.5, 600, 0.35);
  }

  /**
   * The second cursor arriving. Everything about it is doubled — two voices an
   * octave apart on every step — so the ear hears "one became two" without
   * needing the caption.
   */
  twinSfx(on = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Rising to arrive, falling to leave, so the direction is audible without
    // looking. Both stay short — this fires repeatedly through a run.
    const steps = on ? [0, 5, 12] : [12, 5, 0];
    steps.forEach((semi, i) => {
      const at = t + i * 0.07;
      this.blip(noteHz(45 + semi), 0.26, at, 'sawtooth');
      // Only the arrival doubles the voice; leaving drops back to one.
      if (on) this.blip(noteHz(57 + semi), 0.22, at, 'square');
    });
    this.noiseHit(t, on ? 0.45 : 0.3, on ? 1400 : 700, on ? 0.35 : 0.2);
  }

  breakSfx() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16, 19].forEach((semi, i) => this.blip(noteHz(36 + semi), 0.28, t + i * 0.06, 'sawtooth'));
    this.noiseHit(t, 1, 400, 0.9);
  }

  /** Drag the music down with the world during bullet time. */
  setRate(rate) {
    for (const { el } of this.elements.values()) {
      try {
        el.playbackRate = rate;
      } catch {
        /* some browsers refuse extreme rates — the visual effect carries it */
      }
    }
  }

  slowSfx() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(noteHz(56), t);
    o.frequency.exponentialRampToValueAtTime(noteHz(38), t + 0.22); // downward: time dilating
    const a = this.ctx.createGain();
    a.gain.setValueAtTime(0.0001, t);
    a.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    a.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(a).connect(this.master);
    o.start(t);
    o.stop(t + 0.28);
  }

  blip(hz, g, t, type = 'square') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const a = this.ctx.createGain();
    a.gain.setValueAtTime(0.0001, t);
    a.gain.exponentialRampToValueAtTime(g, t + 0.005);
    a.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(a).connect(this.master);
    o.start(t);
    o.stop(t + 0.14);
  }

  noiseHit(t, g, hz, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = hz;
    const a = this.ctx.createGain();
    a.gain.setValueAtTime(g * 0.5, t);
    a.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp).connect(a).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}

function makeNoise(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
