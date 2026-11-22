// Procedural soundscape: everything is synthesised with Web Audio from noise
// and oscillators, so the app ships no audio files and works offline.
//
//   bed      – constant soft low ocean rumble
//   wash     – rushing noise that swells as water runs up the beach
//   backwash – fizzing hiss as it drains back
//   scrape   – granular sand scraping while digging
//   gulls    – rare, distant, panned
//   music    – optional sparse pentatonic pad (off by default)

export interface AmbienceInput {
  /** rate of change of water on the beach face (m^3/s, + = running up) */
  swashRate: number;
  /** 0..1 how hard the player is digging */
  dig: number;
  /** -1..1 where the sea is, left/right, from the camera's view */
  seaPan: number;
  /** 0..1, 1 = fully zoomed out */
  zoomOut: number;
  /** 0..1 how calm the waves are */
  calm: number;
  /** 0 at night .. 1 in daylight (gulls sleep at night) */
  daylight?: number;
}

function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // Paul Kellet's pink noise filter
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    // crossfade the loop seam
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[i] = d[i] * t + d[len - fade + i] * (1 - t);
    }
  }
  return buf;
}

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

const PENTA = [0, 2, 4, 7, 9];

export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private bedGain!: GainNode;
  private washGain!: GainNode;
  private washFilter!: BiquadFilterNode;
  private backGain!: GainNode;
  private scrapeGain!: GainNode;
  private scrapeFilter!: BiquadFilterNode;
  private seaPanner!: StereoPannerNode;
  private washLevel = 0;
  private backLevel = 0;
  private nextGull = 0;
  private nextChord = 0;
  private soundOn = true;
  private musicOn = false;

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.noise = makeNoise(ctx, 6);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(this.soundOn ? 0.9 : 0, ctx.currentTime, 1.5);
    this.master.connect(comp);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);

    this.seaPanner = ctx.createStereoPanner();
    this.seaPanner.connect(this.sfx);
    this.seaPanner.connect(this.reverb);

    // bed
    const bed = this.loop(0);
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = 'lowpass';
    bedLp.frequency.value = 380;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0.32;
    bed.connect(bedLp).connect(this.bedGain).connect(this.seaPanner);

    // wash
    const wash = this.loop(1.7);
    this.washFilter = ctx.createBiquadFilter();
    this.washFilter.type = 'lowpass';
    this.washFilter.frequency.value = 600;
    this.washFilter.Q.value = 0.4;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    wash.connect(this.washFilter).connect(this.washGain).connect(this.seaPanner);

    // backwash fizz
    const back = this.loop(3.1);
    const backHp = ctx.createBiquadFilter();
    backHp.type = 'highpass';
    backHp.frequency.value = 2600;
    this.backGain = ctx.createGain();
    this.backGain.gain.value = 0;
    back.connect(backHp).connect(this.backGain).connect(this.seaPanner);

    // scrape
    const scrape = this.loop(4.4);
    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'bandpass';
    this.scrapeFilter.frequency.value = 1700;
    this.scrapeFilter.Q.value = 1.1;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    scrape.connect(this.scrapeFilter).connect(this.scrapeGain).connect(this.sfx);

    this.nextGull = ctx.currentTime + 12 + Math.random() * 20;
    this.nextChord = ctx.currentTime + 1;
    this.setMusic(this.musicOn);
  }

  private loop(offset: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, offset % this.noise.duration);
    return src;
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.3);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 1.2);
  }

  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Soft whoosh for undo/redo. */
  whoosh(reverse = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(reverse ? 2200 : 500, t);
    bp.frequency.exponentialRampToValueAtTime(reverse ? 500 : 2200, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    src.connect(bp).connect(g);
    g.connect(this.sfx);
    g.connect(this.reverb);
    src.start(t, Math.random() * 4, 0.45);
  }

  /** A dull thud for setting something down on the sand (heavier for rocks). */
  thunk(heavy = true): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(heavy ? 420 : 900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(heavy ? 0.9 : 0.5, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.22 : 0.14));
    src.connect(lp).connect(g);
    g.connect(this.sfx);
    src.start(t, Math.random() * 4, 0.3);
  }

  private gull(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.05 + Math.random() * 0.03;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 2;
    bp.connect(g).connect(pan);
    pan.connect(this.sfx);
    pan.connect(this.reverb);
    const cries = 2 + Math.floor(Math.random() * 3);
    for (let c = 0; c < cries; c++) {
      const t = t0 + c * (0.32 + Math.random() * 0.12);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const base = 1350 + Math.random() * 300;
      o.frequency.setValueAtTime(base * 0.75, t);
      o.frequency.linearRampToValueAtTime(base, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.62, t + 0.26);
      const vib = ctx.createOscillator();
      vib.frequency.value = 28;
      const vibG = ctx.createGain();
      vibG.gain.value = 40;
      vib.connect(vibG).connect(o.frequency);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(env).connect(bp);
      o.start(t);
      vib.start(t);
      o.stop(t + 0.3);
      vib.stop(t + 0.3);
    }
  }

  private chord(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const root = 220 * Math.pow(2, [0, -2, -4, 3, 5][Math.floor(Math.random() * 5)] / 12);
    const notes = [0, 2, 4].map((q) => {
      const step = PENTA[(q + Math.floor(Math.random() * 2)) % PENTA.length];
      return root * Math.pow(2, step / 12) * (Math.random() < 0.3 ? 2 : 1);
    });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(this.musicBus);
    for (const f of notes) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = Math.random() * 8 - 4;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.05, t + 2.5);
      env.gain.linearRampToValueAtTime(0.035, t + 6);
      env.gain.linearRampToValueAtTime(0, t + 10);
      o.connect(env).connect(lp);
      o.start(t);
      o.stop(t + 10.2);
    }
  }

  /** Called every frame with the current state of the beach. */
  update(dt: number, s: AmbienceInput): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const k = Math.min(1, dt * 4);
    const near = 1 - s.zoomOut * 0.35;
    const energy = 1 - s.calm * 0.6;

    const up = Math.max(0, s.swashRate);
    const down = Math.max(0, -s.swashRate);
    this.washLevel += (Math.min(1, up / 1.6) - this.washLevel) * k;
    this.backLevel += (Math.min(1, down / 1.6) - this.backLevel) * k;

    const hush = 0.8 + 0.2 * (s.daylight ?? 1);
    this.bedGain.gain.setTargetAtTime((0.22 + this.washLevel * 0.12) * near * hush, now, 0.4);
    this.washGain.gain.setTargetAtTime(this.washLevel * 0.55 * near * energy, now, 0.15);
    this.washFilter.frequency.setTargetAtTime(500 + this.washLevel * 1600, now, 0.2);
    this.backGain.gain.setTargetAtTime(this.backLevel * 0.16 * near * energy, now, 0.25);
    this.seaPanner.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, s.seaPan * 0.6)), now, 0.3);

    // granular scrape: jitter the gain so it sounds like grains, not hiss
    const jitter = 0.65 + Math.random() * 0.7;
    this.scrapeGain.gain.setTargetAtTime(s.dig * 0.35 * jitter, now, 0.03);
    this.scrapeFilter.frequency.setTargetAtTime(1300 + s.dig * 900 + Math.random() * 300, now, 0.05);

    if (now > this.nextGull) {
      if (this.soundOn && (s.daylight ?? 1) > 0.4) this.gull();
      this.nextGull = now + 25 + Math.random() * 45;
    }
    if (this.musicOn && now > this.nextChord) {
      this.chord();
      this.nextChord = now + 7 + Math.random() * 3;
    }
  }
}
