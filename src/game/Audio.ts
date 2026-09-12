/**
 * All sound in Sjottens is synthesized with the Web Audio API - no audio
 * files to fetch, nothing to preload, zero bytes of asset weight. A
 * continuous thrust hum uses a gain node that ramps up/down instead of
 * being retriggered, so holding the button doesn't spam the audio graph.
 */

class AudioEngine {
  private ctx: AudioContext | null = null;
  private thrustOsc: OscillatorNode | null = null;
  private thrustGain: GainNode | null = null;
  private muted = false;

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stopThrust();
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

  crash() {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const bufferSize = ctx.sampleRate * 0.4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    noise.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    noise.start();

    this.tone(90, 0.35, 0.2, "sawtooth");
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

  startThrust() {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx || this.thrustOsc) return;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 120;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;

    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.08);

    osc.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    osc.start();

    this.thrustOsc = osc;
    this.thrustGain = g;
  }

  stopThrust() {
    if (!this.thrustOsc || !this.thrustGain || !this.ctx) return;
    const ctx = this.ctx;
    this.thrustGain.gain.cancelScheduledValues(ctx.currentTime);
    this.thrustGain.gain.setValueAtTime(this.thrustGain.gain.value, ctx.currentTime);
    this.thrustGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
    const osc = this.thrustOsc;
    osc.stop(ctx.currentTime + 0.12);
    this.thrustOsc = null;
    this.thrustGain = null;
  }
}

export const audio = new AudioEngine();
