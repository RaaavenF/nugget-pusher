/**
 * 离线调参：模拟“币落到推板 → 随推板运动 → 推板回撤撞到后方挡板 → 失去支撑落到币台 → 币台斜坡 → 出口”的完整过程。
 * 用法：npm run sim
 *
 * 说明：这是与游戏同一套 CONFIG / PusherWorld 的快速近似，不包含渲染；
 * 结果会随随机助攻/落点略有差异。
 */
import { CONFIG, pusherFrontAt } from '../src/config.js';
import { PusherWorld } from '../src/physics.js';

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(seed, insertEvery = 3, count = 24) {
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  const layoutRng = rngFrom(cfg.machine.physics.initialSeed);
  const rng = rngFrom(seed * 7919 + 17);
  const world = new PusherWorld(cfg, rngFrom(seed + 99));
  world.seedInitialCoins(layoutRng);

  const plate = [];
  const pending = [];
  let lastFront = null;
  let machineTime = 0;
  let active = false;
  let t = 0;
  let inserts = 0;
  let nextInsert = 0.8;
  let dropped = 0;
  let jackpotAt = null;
  let lastDropped = 0;
  const perInsert = [];
  const dt = 1 / 60;
  const baffle = cfg.machine.baffle;
  const dropCfg = cfg.machine.drop;
  const idleFront = cfg.machine.pusher.idleFrontZ ?? cfg.machine.pusher.frontMinZ;

  // 与 World.pusherStartTimeForIdle 一致：从静止位置对应的周期相位开始。
  function idleStartTime() {
    const p = cfg.machine.pusher;
    let bestT = 0;
    let bestDiff = Infinity;
    for (let i = 0; i <= 400; i++) {
      const phase = i / 400;
      if (phase < p.extendStart || phase > p.retractStart) continue;
      const tt = phase * p.cycleSec;
      const diff = Math.abs(pusherFrontAt(tt, cfg.machine) - idleFront);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestT = tt;
      }
    }
    return bestT;
  }

  // 先等推板伸展到投币落点下方，再释放币（对应游戏里的投币排队逻辑）。
  function releasePending() {
    if (!pending.length) return;
    const frontAtLanding = pusherFrontAt(machineTime + dropCfg.flightSec, cfg.machine);
    if (frontAtLanding < dropCfg.zRange[1] + 0.04) return;
    const next = pending.shift();
    plate.push({ ...next, age: 0, held: false, landAt: t + dropCfg.flightSec });
  }

  for (let i = 0; i < 60 * 150; i++) {
    t += dt;
    if (inserts < count && t >= nextInsert) {
      if (inserts > 0) perInsert.push(dropped - lastDropped);
      lastDropped = dropped;
      pending.push({
        z: dropCfg.zRange[0] + rng() * (dropCfg.zRange[1] - dropCfg.zRange[0]),
        x: (rng() - 0.5) * 2.04,
      });
      world.queueAssist();
      inserts++;
      if (!active) {
        active = true;
        world.prevFront = idleFront;
        machineTime = idleStartTime();
      }
      nextInsert = t + insertEvery;
    }

    if (active) machineTime += dt;
    const front = active ? pusherFrontAt(machineTime, cfg.machine) : cfg.machine.pusher.frontMinZ;
    const delta = lastFront === null ? 0 : front - lastFront;
    lastFront = front;

    if (active) releasePending();
    for (let j = plate.length - 1; j >= 0; j--) {
      const p = plate[j];
      if (p.landAt > t) continue;
      p.age += dt;
      // 币跟着推板前后一起动；回撤时被后方挡板拦住，
      // 推板继续回撤后币失去支撑，从推板前缘滑落到币台。
      if (delta !== 0 && !p.held) {
        p.z = Math.max(front - 1.04, Math.min(front - 0.02, p.z + delta * 0.95));
      }
      const stopZ = baffle ? baffle.z + cfg.machine.coin.radius + (baffle.holdOffset ?? 0.01) : -Infinity;
      if (baffle && !p.held && delta < 0 && p.z <= stopZ) {
        p.z = stopZ;
        p.held = true;
      }
      if (p.held) p.z = stopZ;
      if (front < p.z + 0.02) {
        plate.splice(j, 1);
        const z2 = Math.max(p.z, front + cfg.machine.coin.radius - 0.02);
        world.addCoin(p.x, z2);
      }
    }

    for (const ev of world.step(dt, front)) {
      if (ev.type === 'coin') dropped++;
      else if (ev.type === 'jackpot' && jackpotAt === null) jackpotAt = { t, inserts };
    }
    if (inserts >= count && plate.length === 0 && t > nextInsert + 5) break;
  }
  perInsert.push(dropped - lastDropped);
  return {
    seed,
    inserts,
    dropped,
    perInsert,
    jackpotAt,
    boxZ: world.box.z,
    coinsLeft: world.coins.length,
  };
}

const runs = [1, 2, 3, 4, 5].map((seed) => run(seed));
for (const r of runs) {
  console.log(
    `seed ${r.seed}: ${r.dropped} drops / ${r.inserts} inserts, jackpot ` +
    `${r.jackpotAt ? `${r.jackpotAt.inserts}i @ ${r.jackpotAt.t.toFixed(0)}s` : 'not yet'}, ` +
    `boxZ ${r.boxZ.toFixed(2)}`
  );
  console.log('  per insert:', r.perInsert.join(' '));
}
const avg = runs.reduce((a, r) => a + r.dropped, 0) / runs.length;
console.log(`\naverage: ${avg.toFixed(1)} drops / ${runs[0].inserts} inserts (${(avg / runs[0].inserts).toFixed(2)} per insert)`);
