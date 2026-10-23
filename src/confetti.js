import { prefersReducedMotion } from './utils.js';

const COLORS = ['#e33b2e', '#ffc533', '#fff0c0', '#f27a32', '#8dd6b8', '#ffdf6e'];

export class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.raf = null;
    this.timers = [];
    this.dpr = 1;
    this.avoidRects = [];
    this.resize = this.resize.bind(this);
    this.tick = this.tick.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  fire({ x = window.innerWidth / 2, y = window.innerHeight * 0.45, count = 70, power = 11, angle = -Math.PI / 2, spread = Math.PI * 1.6, colors = COLORS } = {}) {
    if (prefersReducedMotion()) return;
    // 弹层打开时，彩带避开文字/按钮区域；大奖卡允许落在插画周围。
    const card = document.querySelector('.modal-layer.is-open .modal-card:not([hidden])');
    this.avoidRects = [];
    if (card) {
      if (card.id === 'winModal') {
        const sels = ['.win-kicker', '#winTitle', '.win-modal .modal-sub', '.win-code', '.cta-win', '.win-later'];
        for (const sel of sels) {
          const el = card.querySelector(sel);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0) {
            this.avoidRects.push({ left: r.left - 8, right: r.right + 8, top: r.top - 8, bottom: r.bottom + 8 });
          }
        }
      } else {
        const r = card.getBoundingClientRect();
        const pad = 26;
        this.avoidRects.push({ left: r.left - pad, right: r.right + pad, top: r.top - pad, bottom: r.bottom + pad });
      }
    }
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const speed = power * (0.45 + Math.random() * 0.9);
      const w = 5 + Math.random() * 7;
      const h = 3 + Math.random() * 8;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        w,
        h,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35,
        life: 0,
        max: 1.9 + Math.random() * 1.5,
        shape: Math.random() < 0.28 ? 'circle' : 'rect',
        wobble: Math.random() * Math.PI * 2,
      });
    }
    this.start();
  }

  celebrate() {
    if (prefersReducedMotion()) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.fire({ x: w * 0.08, y: h * 0.7, count: 55, power: 15, angle: -Math.PI / 3.2, spread: 1.2 });
    this.fire({ x: w * 0.92, y: h * 0.7, count: 55, power: 15, angle: -Math.PI + Math.PI / 3.2, spread: 1.2 });
    this.timers.push(setTimeout(() => {
      this.fire({ x: w * 0.5, y: h * 0.3, count: 70, power: 13, angle: -Math.PI / 2, spread: Math.PI * 2 });
    }, 220));
    this.timers.push(setTimeout(() => {
      this.fire({ x: w * 0.2, y: h * 0.25, count: 32, power: 8, angle: Math.PI / 2.4, spread: 1.1 });
      this.fire({ x: w * 0.8, y: h * 0.25, count: 32, power: 8, angle: Math.PI - Math.PI / 2.4, spread: 1.1 });
    }, 700));
  }

  start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  tick(now) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    const dt = 1 / 60;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.vy += 17 * dt;
      p.vx *= 0.992;
      p.vy *= 0.992;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.rot += p.vr;
      p.wobble += 0.15;
      p.x += Math.sin(p.wobble) * 0.3;

      const hiddenByCard = this.avoidRects.some((a) => p.x > a.left && p.x < a.right && p.y > a.top && p.y < a.bottom);
      if (hiddenByCard) continue;

      const fade = Math.min(1, Math.max(0, (p.max - p.life) / 0.5));
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w * 0.42, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.55 + Math.abs(Math.sin(p.wobble)) * 0.5));
      }
      ctx.restore();

      if (p.life >= p.max || p.y > h + 40) this.particles.splice(i, 1);
    }

    if (this.particles.length) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.raf = null;
      ctx.clearRect(0, 0, w, h);
    }
  }

  clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.particles = [];
    this.avoidRects = [];
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}
