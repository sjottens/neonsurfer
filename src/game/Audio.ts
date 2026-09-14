/**
 * All sound in Sjottens is synthesized with the Web Audio API - no audio
 * files to fetch, nothing to preload, zero bytes of asset weight.
 */

class AudioEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) this.ctx = new Ctor();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = "sine", delay = 0) {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;

    const t0 = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  coin() {
    this.tone(880, 0.09, 0.12, "sine");
    this.tone(1320, 0.12, 0.09, "sine", 0.03);
  }

  star() {
    [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.18, 0.1, "triangle", i * 0.05));
  }

  /** Layered explosion: a bright instant crack, a rumbling noise tail, and a pitch-dropping sub-bass boom. */
  crash() {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;

    // crack: a very short, bright noise burst - the initial "snap" of impact
    const crackDur = 0.05;
    const crackSize = Math.floor(ctx.sampleRate * crackDur);
    const crackBuffer = ctx.createBuffer(1, crackSize, ctx.sampleRate);
    const crackData = crackBuffer.getChannelData(0);
    for (let i = 0; i < crackSize; i++) crackData[i] = Math.random() * 2 - 1;
    const crack = ctx.createBufferSource();
    crack.buffer = crackBuffer;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.5, t0);
    crackGain.gain.exponentialRampToValueAtTime(0.001, t0 + crackDur);
    crack.connect(crackGain);
    crackGain.connect(ctx.destination);
    crack.start(t0);

    // rumble: the noise cloud of the blast, filtered from bright down to a dull thud
    const rumbleDur = 0.6;
    const rumbleSize = Math.floor(ctx.sampleRate * rumbleDur);
    const rumbleBuffer = ctx.createBuffer(1, rumbleSize, ctx.sampleRate);
    const rumbleData = rumbleBuffer.getChannelData(0);
    for (let i = 0; i < rumbleSize; i++) {
      rumbleData[i] = (Math.random() * 2 - 1) * (1 - i / rumbleSize);
    }
    const rumble = ctx.createBufferSource();
    rumble.buffer = rumbleBuffer;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.setValueAtTime(2400, t0);
    rumbleFilter.frequency.exponentialRampToValueAtTime(60, t0 + rumbleDur);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.4, t0);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, t0 + rumbleDur);
    rumble.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(ctx.destination);
    rumble.start(t0);

    // boom: a punchy sub-bass tone whose pitch collapses fast, for the felt "thump"
    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(180, t0);
    boom.frequency.exponentialRampToValueAtTime(35, t0 + 0.25);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.5, t0);
    boomGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start(t0);
    boom.stop(t0 + 0.45);

    this.tone(70, 0.3, 0.16, "sawtooth");
  }

  milestone() {
    this.tone(523.25, 0.12, 0.08, "triangle");
    this.tone(659.25, 0.12, 0.08, "triangle", 0.08);
  }

  uiClick() {
    this.tone(440, 0.06, 0.06, "square");
  }

  purchase() {
    this.tone(523.25, 0.1, 0.1, "sine");
    this.tone(783.99, 0.16, 0.1, "sine", 0.07);
  }

  /** Descending glide for the slow-mo power-up - the inverse of star()'s climb. */
  slowmo() {
    this.tone(900, 0.12, 0.09, "triangle");
    this.tone(600, 0.14, 0.09, "triangle", 0.08);
    this.tone(400, 0.2, 0.09, "triangle", 0.16);
  }

  /**
   * Airy swoosh for a steering input - a one-shot, not a held drone. Unlike a
   * cymbal/hi-hat tick (instant transient, static bright filter), this uses a
   * soft swell-in envelope and a filter that sweeps across a wide, low range
   * so the noise itself seems to move past, like air being carved.
   */
  swoosh() {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const duration = 0.3;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1; // flat noise; the envelope shapes it below
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(1800, t0);
    filter.frequency.exponentialRampToValueAtTime(220, t0 + duration);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + 0.06); // swell in, no hard hi-hat transient
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

    noise.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + duration + 0.02);
  }
}

export const audio = new AudioEngine();
