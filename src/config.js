/**
 * 全部玩法参数集中在这里，方便活动运营调整。
 * 单位：场景单位（约 1 单位 ≈ 10cm）、秒。
 */
export const CONFIG = {
  economy: {
    pointsPerPack: 100,        // 100 会员积分 -> 1 份游戏代币包
    coinsPerPack: 5,           // 每份代币包包含 5 枚游戏代币
    exchangeRate: 3,           // 3 块已掉落虚拟鸡块 -> 1 张真实麦乐鸡券
    startCoins: 0,
    maxPurchasesPerDay: 12,   // 每日积分兑币次数上限
    maxInsertsPerDay: 80,
    maxExchangesPerDay: 20,
    jackpotOnce: true,
    jackpotRefreshSec: 5,
    demo: false,
  },

  machine: {
    bed: {
      width: 5.0,              // 币台内宽
      backZ: -2.2,
      frontZ: 2.55,            // 前缘（掉落线）
      topY: 1.55,
      fallMargin: 0.06,        // 币心越过前缘多少后判定掉落
      ramp: {
        startZ: 2.24,          // 币台末端的向上斜坡
        endZ: 2.55,
        rise: 0.18,
        climbGravity: 0.05,    // 坡面轻微阻力，不是不可翻越的墙
        climbDrag: 0.15,       // 额外的坡面摩擦
      },
    },

    pusher: {
      width: 4.9,
      depth: 1.1,
      height: 0.5,
      idleFrontZ: 0.85,
      frontMinZ: 0.6,
      frontMaxZ: 1.14,
      cycleSec: 3.2,
      extendStart: 0.10,       // 周期内时间比例
      extendEnd: 0.72,
      retractStart: 0.82,
    },

    drop: {
      slotZ: 0.75,             // 投币槽中心：位于推板上方、固定挡板前侧，币会先落到推板顶
      xRange: [-1.02, 1.02],
      zRange: [0.72, 0.78],
      flightSec: 0.55,
      queueGapMs: 280,
    },

    coin: {
      radius: 0.2,
      mass: 1,
    },

    baffle: {
      z: 0.45,                 // 固定挡板：在币的“后方”，推板回撤时拦住币
      width: 4.76,
      height: 0.16,
      bottomY: 2.05,           // 贴着推板顶面，做成低挡板，币从上方可见
      holdOffset: 0.01,        // 币被挡板挡住时与挡板的间距
    },

    jackpot: {
      x: 0,
      z: 2.0,
      width: 1.45,
      depth: 0.8,
      height: 0.52,
      mass: 8,
      friction: 4.5,
      fallZ: 2.58,
    },

    physics: {
      fixedDt: 1 / 60,
      friction: 1.3,           // 每秒指数衰减
      restitution: 0.04,
      iterations: 5,
      initialCoins: 38,
      initialSeed: 20261022,
      edgeAssist: {
        enabled: true,
        window: 0.5,           // 距前缘多近开始“震动助攻”
        chancePerPush: 0.5,    // 低概率助攻，避免出现“投一掉一”
        impulse: 0.45,
        selection: 'random',   // 随机挑边缘币，而不是每次都推最前面那枚
        maxCoinsPerTrigger: 1,
      },
    },

    camera: {
      fov: 38,
      elevationDeg: 47.5,
      azimuthDeg: 24,
      fitWidth: 7.9,
      fitHeight: 8.35,
      target: [0, 2.02, 0.25],
      minAzimuthDeg: 9,
      maxAzimuthDeg: 39,
      minElevationDeg: 34,
      maxElevationDeg: 52,
    },
  },

  rewards: {
    exchangeCoupons: 1,           // 每次兑换得到的真实麦乐鸡券数量
    jackpotEnabled: true,
    jackpotLabel: '一整盒麦乐鸡',
    jackpotQuantity: 1,
  },

  copy: {
    title: '麦乐鸡块推币机',
    subtitle: 'NUGGET PUSHER · 麦当劳 MCP 积分生态',
    demoNote: '会员积分由麦当劳 MCP 实时处理；游戏代币与掉落物只在本游戏内使用。',
    exchangeHint: (n) => `再掉 ${n} 块可兑换 1 张麦乐鸡券`,
    exchangeReady: (n) => `已可兑换 ${n} 张麦乐鸡券`,
    claimNote: '兑换成功后，麦乐鸡券将由麦当劳 MCP 发放至你的麦当劳账户，请留意麦当劳 App / 小程序。',
  },
};

export function pusherFrontAt(tSec, cfg = CONFIG.machine) {
  const p = ((tSec % cfg.pusher.cycleSec) + cfg.pusher.cycleSec) % cfg.pusher.cycleSec / cfg.pusher.cycleSec;
  const { frontMinZ, frontMaxZ, extendStart, extendEnd, retractStart } = cfg.pusher;
  const smooth = (x) => x * x * (3 - 2 * x);
  if (p < extendStart) return frontMinZ;
  if (p < extendEnd) {
    const k = (p - extendStart) / (extendEnd - extendStart);
    return frontMinZ + (frontMaxZ - frontMinZ) * smooth(k);
  }
  if (p < retractStart) return frontMaxZ;
  const k = (p - retractStart) / (1 - retractStart);
  return frontMaxZ - (frontMaxZ - frontMinZ) * smooth(k);
}

export function pusherPhase(tSec, cfg = CONFIG.machine) {
  return ((tSec % cfg.pusher.cycleSec) + cfg.pusher.cycleSec) % cfg.pusher.cycleSec / cfg.pusher.cycleSec;
}
