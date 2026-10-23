/**
 * 轻量 2D 币台物理：
 * - 圆形鸡块之间的碰撞
 * - 鸡块与大奖盒（AABB）的碰撞
 * - 往复推板、前缘掉落、边缘“震动助攻”
 *
 * 故意不依赖物理引擎：数量小、可预测、移动端稳定，参数全部可配。
 */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class PusherWorld {
  constructor(config, rand = Math.random) {
    this.config = config;
    this.rand = rand;
    this.machine = config.machine;
    this.bed = this.machine.bed;
    this.phys = this.machine.physics;
    this.coinCfg = this.machine.coin;
    this.halfWidth = this.bed.width / 2;
    this.coins = [];
    this.nextId = 1;
    this.time = 0;
    this.prevFront = this.machine.pusher.frontMinZ;
    this.assistBudget = 0;
    this.box = this.createBox();
  }

  createBox() {
    const j = this.machine.jackpot;
    return {
      id: 'jackpot',
      kind: 'box',
      x: j.x,
      z: j.z,
      vx: 0,
      vz: 0,
      halfW: j.width / 2,
      halfD: j.depth / 2,
      mass: j.mass,
      invMass: 1 / j.mass,
      fallen: false,
    };
  }

  reset(config = this.config) {
    this.config = config;
    this.machine = config.machine;
    this.bed = this.machine.bed;
    this.phys = this.machine.physics;
    this.coinCfg = this.machine.coin;
    this.halfWidth = this.bed.width / 2;
    this.coins = [];
    this.nextId = 1;
    this.time = 0;
    this.prevFront = this.machine.pusher.frontMinZ;
    this.assistBudget = 0;
    this.box = this.createBox();
  }

  /** 每次投币可预约一次“机器震动”助攻，避免挂机无限掉币。 */
  queueAssist(n = 1) {
    this.assistBudget = Math.min(8, this.assistBudget + n);
  }

  addCoin(x, z, opts = {}) {
    const r = this.coinCfg.radius;
    const coin = {
      id: opts.id ?? this.nextId++,
      kind: 'coin',
      x: clamp(x, -this.halfWidth + r, this.halfWidth - r),
      z: Math.max(this.bed.backZ + r, z),
      vx: opts.vx ?? 0,
      vz: opts.vz ?? 0,
      r,
      mass: this.coinCfg.mass,
      invMass: 1 / this.coinCfg.mass,
      rot: opts.rot ?? 0,
      spin: opts.spin ?? 0,
      variant: opts.variant ?? 0,
      bornAt: this.time,
    };
    this.coins.push(coin);
    return coin;
  }

  /** 铺满一床“场内存币”，玩家投币前推板不启动，所以不会白送。 */
  seedInitialCoins(rand = Math.random) {
    const { initialCoins } = this.phys;
    const r = this.coinCfg.radius;
    const box = this.machine.jackpot;
    const positions = [];
    const rowGap = 0.33;
    const colGap = 0.42;
    let row = 0;
    for (let z = 1.10; z <= 2.20; z += rowGap, row++) {
      const offset = row % 2 ? colGap / 2 : 0;
      for (let x = -2.2 + offset; x <= 2.2; x += colGap) {
        const jx = x + (rand() - 0.5) * 0.035;
        const jz = z + (rand() - 0.5) * 0.035;
        positions.push({ x: jx, z: jz });
      }
    }

    // 避开大奖盒（含安全间距），洗牌后取配置数量，让空隙随机自然。
    const clear = positions.filter(({ x, z }) => {
      const nx = clamp(x, box.x - box.width / 2, box.x + box.width / 2);
      const nz = clamp(z, box.z - box.depth / 2, box.z + box.depth / 2);
      return Math.hypot(x - nx, z - nz) > r + 0.045;
    });
    for (let i = clear.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [clear[i], clear[j]] = [clear[j], clear[i]];
    }
    clear.slice(0, initialCoins).forEach(({ x, z }) => {
      this.addCoin(x, z, {
        rot: rand() * Math.PI * 2,
        spin: 0,
        variant: Math.floor(rand() * 3),
      });
    });

    // 让初始币床自然沉降，避免开局互相弹开。
    for (let i = 0; i < 90; i++) {
      this.step(1 / 60, this.machine.pusher.frontMinZ);
    }
    return this.coins.length;
  }

  /** 推板是否已经“开工”，由主循环决定；这里只处理被推到的物体。 */
  step(dt, frontZ, opts = {}) {
    this.time += dt;
    const events = [];
    if (this.box.fallen) {
      // 大奖盒已经掉落，之后只更新鸡块。
    }
    const pusherSpeed = dt > 0 ? (frontZ - this.prevFront) / dt : 0;
    const movingForward = pusherSpeed > 0.001;
    const { friction, restitution, iterations } = this.phys;

    for (const coin of this.coins) {
      coin.x += coin.vx * dt;
      coin.z += coin.vz * dt;
      const damp = Math.exp(-friction * dt);
      coin.vx *= damp;
      coin.vz *= damp;
      coin.rot += coin.spin * dt;
      coin.spin *= Math.exp(-2.4 * dt);
      if (Math.abs(coin.vx) < 0.004) coin.vx = 0;
      if (Math.abs(coin.vz) < 0.004) coin.vz = 0;
    }

    if (!this.box.fallen) {
      this.box.x += this.box.vx * dt;
      this.box.z += this.box.vz * dt;
      const damp = Math.exp(-this.machine.jackpot.friction * dt);
      this.box.vx *= damp;
      this.box.vz *= damp;
      if (Math.abs(this.box.vx) < 0.003) this.box.vx = 0;
      if (Math.abs(this.box.vz) < 0.003) this.box.vz = 0;
    }

    for (let iter = 0; iter < iterations; iter++) {
      this.solveCoinCollisions(iter === 0 ? restitution : 0);
      this.solveWalls();
      if (!this.box.fallen) this.solveCoinBox(iter === 0 ? 0.02 : 0);
      this.solvePusher(frontZ, movingForward ? pusherSpeed : 0);
    }

    // 推板推箱：正常情况下箱体离推板很远，仍保留以防被挤回。
    if (!this.box.fallen) {
      const boxBack = this.box.z - this.box.halfD;
      if (boxBack < frontZ && this.box.z > frontZ - 0.01 && movingForward) {
        this.box.z = frontZ + this.box.halfD;
        this.box.vz = Math.max(this.box.vz, pusherSpeed * 0.6);
      }
    }

    // 掉落判定
    // 币台末端的向上斜坡：币要额外克服一点坡面阻力才能被推出。
    const ramp = this.bed.ramp;
    if (ramp) {
      for (const c of this.coins) {
        if (c.z > ramp.startZ && c.z < ramp.endZ && c.vz > 0) {
          c.vz = Math.max(0, c.vz - ramp.climbGravity * dt);
          c.vx *= Math.exp(-ramp.climbDrag * dt);
        }
      }
      if (!this.box.fallen && this.box.z > ramp.startZ && this.box.z < ramp.endZ && this.box.vz > 0) {
        this.box.vz = Math.max(0, this.box.vz - ramp.climbGravity * 0.55 * dt);
      }
    }

    const fallZ = this.bed.frontZ + this.bed.fallMargin;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (c.z > fallZ) {
        this.coins.splice(i, 1);
        events.push({ type: 'coin', coin: c });
      }
    }
    if (!this.box.fallen && this.box.z > this.machine.jackpot.fallZ) {
      this.box.fallen = true;
      events.push({ type: 'jackpot', box: this.box });
    }

    this.prevFront = frontZ;
    if (opts.edgeAssist !== false) this.maybeAssist(frontZ, events);
    return events;
  }

  solveCoinCollisions(restitution) {
    const coins = this.coins;
    for (let i = 0; i < coins.length; i++) {
      const a = coins[i];
      for (let j = i + 1; j < coins.length; j++) {
        const b = coins[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const minDist = a.r + b.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minDist * minDist || d2 < 1e-9) {
          if (d2 < 1e-9) {
            b.x += 0.001;
          }
          continue;
        }
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const pen = minDist - d;
        const invSum = a.invMass + b.invMass;
        const push = pen / invSum * 0.86;
        a.x -= nx * push * a.invMass;
        a.z -= nz * push * a.invMass;
        b.x += nx * push * b.invMass;
        b.z += nz * push * b.invMass;

        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          const jimp = (-(1 + restitution) * vn) / invSum;
          a.vx -= jimp * nx * a.invMass;
          a.vz -= jimp * nz * a.invMass;
          b.vx += jimp * nx * b.invMass;
          b.vz += jimp * nz * b.invMass;
          const spin = (nx * rvz - nz * rvx) * 0.14;
          a.spin -= spin;
          b.spin += spin;
        }
      }
    }
  }

  solveWalls() {
    const r = this.coinCfg.radius;
    const minX = -this.halfWidth + r;
    const maxX = this.halfWidth - r;
    const back = this.bed.backZ + r;
    for (const c of this.coins) {
      if (c.x < minX) { c.x = minX; c.vx = Math.abs(c.vx) * 0.25; }
      if (c.x > maxX) { c.x = maxX; c.vx = -Math.abs(c.vx) * 0.25; }
      if (c.z < back) { c.z = back; c.vz = Math.abs(c.vz) * 0.2; }
    }
    if (!this.box.fallen) {
      const b = this.box;
      const minBX = -this.halfWidth + b.halfW;
      const maxBX = this.halfWidth - b.halfW;
      if (b.x < minBX) { b.x = minBX; b.vx = Math.abs(b.vx) * 0.2; }
      if (b.x > maxBX) { b.x = maxBX; b.vx = -Math.abs(b.vx) * 0.2; }
      const backB = this.bed.backZ + b.halfD;
      if (b.z < backB) { b.z = backB; b.vz = Math.abs(b.vz) * 0.2; }
    }
  }

  solveCoinBox(restitution) {
    const b = this.box;
    for (const c of this.coins) {
      const closestX = clamp(c.x, b.x - b.halfW, b.x + b.halfW);
      const closestZ = clamp(c.z, b.z - b.halfD, b.z + b.halfD);
      let dx = c.x - closestX;
      let dz = c.z - closestZ;
      let dist = Math.hypot(dx, dz);
      let nx;
      let nz;
      let pen;

      if (dist > 1e-6) {
        if (dist >= c.r) continue;
        nx = dx / dist;
        nz = dz / dist;
        pen = c.r - dist;
      } else {
        // 圆心在盒内：沿最短轴推出去。
        const left = c.x - (b.x - b.halfW);
        const right = (b.x + b.halfW) - c.x;
        const back = c.z - (b.z - b.halfD);
        const front = (b.z + b.halfD) - c.z;
        const min = Math.min(left, right, back, front);
        nx = 0; nz = 0;
        if (min === left) nx = -1;
        else if (min === right) nx = 1;
        else if (min === back) nz = -1;
        else nz = 1;
        pen = min + c.r;
        dist = 0;
      }

      const invSum = c.invMass + b.invMass;
      const correction = pen / invSum * 0.82;
      c.x += nx * correction * c.invMass;
      c.z += nz * correction * c.invMass;
      b.x -= nx * correction * b.invMass;
      b.z -= nz * correction * b.invMass;

      const rvx = c.vx - b.vx;
      const rvz = c.vz - b.vz;
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        const jimp = (-(1 + restitution) * vn) / invSum;
        c.vx += jimp * nx * c.invMass;
        c.vz += jimp * nz * c.invMass;
        b.vx -= jimp * nx * b.invMass;
        b.vz -= jimp * nz * b.invMass;
        c.spin += (nx * rvz - nz * rvx) * 0.1;
      }
    }
  }

  solvePusher(frontZ, speed) {
    const r = this.coinCfg.radius;
    const halfPusher = this.machine.pusher.width / 2;
    for (const c of this.coins) {
      if (Math.abs(c.x) > halfPusher) continue;
      if (c.z + r > frontZ && c.z < frontZ + r) {
        c.z = frontZ + r;
        if (speed > 0) c.vz = Math.max(c.vz, speed);
      }
    }
  }

  maybeAssist(frontZ, events) {
    const assist = this.phys.edgeAssist;
    if (!assist.enabled) return;
    const maxZ = this.machine.pusher.frontMaxZ;
    // 每个推程只触发一次：推板到最前端时给边缘币一点“机器震动”。
    if (frontZ < maxZ - 0.08) {
      this._assistReady = true;
      return;
    }
    if (frontZ < maxZ - 0.002 || !this._assistReady) return;
    this._assistReady = false;
    if (this.assistBudget <= 0) return;
    this.assistBudget--;
    if (this.rand() > assist.chancePerPush) return;

    const zone = this.bed.frontZ - assist.window;
    const candidates = this.coins.filter((c) => c.z > zone);
    if (!candidates.length) return;

    // 默认随机挑一枚，避免形成“每投必掉最前面一枚”的机械感。
    candidates.sort((a, b) => b.z - a.z);
    const pool = assist.selection === 'nearest'
      ? candidates.slice(0, assist.maxCoinsPerTrigger ?? 1)
      : [candidates[Math.floor(this.rand() * candidates.length)]];
    for (const c of pool) {
      if (!c) continue;
      c.vz += assist.impulse;
      c.spin += (this.rand() - 0.5) * 0.6;
      events.push({ type: 'assist', coin: c });
    }
  }
}
