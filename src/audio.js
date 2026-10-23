/**
 * 纯 WebAudio 合成音效，不依赖外部音频文件。
 * 第一次用户手势时才创建 AudioContext，符合移动端自动播放策略。
 */
export class SoundEngine {
  constructor(muted = false) {
    this.muted = muted;
    this.ctx = null;
    this.master = null;
  }

  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.noise = this.buildNoise();
  }

  buildNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.55, this.ctx.currentTime + 0.08);
    }
  }

  tone({ freq, freqEnd = freq, type = 'sine', dur = 0.15, gain = 0.07, at = 0, attack = 0.006, curve = 'exp' }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) {
      if (curve === 'linear') osc.frequency.linearRampToValueAtTime(freqEnd, t0 + dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  thud({ gain = 0.11, at = 0, freq = 150 } = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, t0);
    filter.frequency.exponentialRampToValueAtTime(120, t0 + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.3);
    this.tone({ freq, freqEnd: 55, type: 'sine', dur: 0.18, gain: gain * 0.8, at });
  }

  click() {
    this.tone({ freq: 680, freqEnd: 560, type: 'triangle', dur: 0.06, gain: 0.035 });
  }

  insert() {
    this.tone({ freq: 540, freqEnd: 920, type: 'triangle', dur: 0.1, gain: 0.06 });
    this.tone({ freq: 1240, freqEnd: 1480, type: 'sine', dur: 0.09, gain: 0.035, at: 0.07 });
    this.thud({ gain: 0.045, at: 0.4, freq: 210 });
  }

  land() {
    this.thud({ gain: 0.075, freq: 175 });
    this.tone({ freq: 320, freqEnd: 190, type: 'triangle', dur: 0.08, gain: 0.03 });
  }

  fall() {
    [740, 988, 1318].forEach((f, i) => {
      this.tone({ freq: f, freqEnd: f * 1.03, type: 'sine', dur: 0.16, gain: 0.045, at: i * 0.055 });
    });
    this.thud({ gain: 0.04, at: 0.02, freq: 260 });
  }

  buy() {
    [523.25, 659.25, 783.99].forEach((f, i) => {
      this.tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.06, at: i * 0.09 });
      this.tone({ freq: f * 2, type: 'sine', dur: 0.24, gain: 0.02, at: i * 0.09 });
    });
    this.thud({ gain: 0.035, at: 0.55, freq: 190 });
  }

  exchange() {
    this.tone({ freq: 660, freqEnd: 880, type: 'triangle', dur: 0.12, gain: 0.05 });
    this.tone({ freq: 990, freqEnd: 1320, type: 'sine', dur: 0.2, gain: 0.04, at: 0.1 });
    this.tone({ freq: 1760, type: 'sine', dur: 0.18, gain: 0.022, at: 0.2 });
  }

  error() {
    this.tone({ freq: 190, freqEnd: 135, type: 'square', dur: 0.16, gain: 0.03, curve: 'linear' });
    this.tone({ freq: 150, freqEnd: 110, type: 'sine', dur: 0.16, gain: 0.04, at: 0.03 });
  }

  jackpot() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093];
    notes.forEach((f, i) => {
      this.tone({ freq: f, type: 'triangle', dur: 0.35, gain: 0.06, at: i * 0.095 });
      this.tone({ freq: f * 2, type: 'sine', dur: 0.28, gain: 0.02, at: i * 0.095 });
    });
    [0.05, 0.22, 0.39, 0.58, 0.75].forEach((at, i) => {
      this.tone({ freq: 2200 + i * 220, type: 'sine', dur: 0.18, gain: 0.018, at });
    });
    this.thud({ gain: 0.09, at: 0.7, freq: 120 });
    this.tone({ freq: 130.81, type: 'sawtooth', dur: 0.8, gain: 0.016, at: 0.3 });
  }
}
