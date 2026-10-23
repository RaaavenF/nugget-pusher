import { CONFIG } from './config.js';
import { clamp, dayKey, uid } from './utils.js';
import { mcp as defaultMcp } from './services/mcp';

/**
 * 参赛版的全局状态。
 *
 * 现有项目没有 Zustand/Context/Redux，使用的是自定义 Store + 订阅；
 * 这里保留同一套渲染机制，只把“购买/兑换”从本地演示改成真实的 MCP 异步动作。
 *
 * 真实会员积分是服务端数据，localStorage 只做缓存展示；
 * 页面启动时 main.js 会调用 refreshMemberPoints() 重新拉取。
 */
const STORAGE_KEY = 'nugget-pusher-contest-v1';
const STATE_VERSION = 2;

function initialState(config = CONFIG) {
  return {
    version: STATE_VERSION,
    dayKey: dayKey(),

    // 需求指定的四个核心字段
    memberPoints: 0,
    virtualCoins: config.economy.startCoins ?? 0,
    droppedCoins: 0,
    isLoading: false,

    // 真实积分是否已经从 MCP 拉到；UI 用它区分“0 分”和“还没加载”
    pointsLoaded: false,

    totalDropped: 0,
    coupons: 0,
    jackpotWon: false,
    jackpotWonAt: null,
    boxesPurchased: 0,
    purchasesToday: 0,
    insertsToday: 0,
    exchangesToday: 0,
    records: [],
    muted: false,
  };
}

const int = (v, fallback = 0, max = 99999) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(Math.floor(n), 0, max) : fallback;
};

function sanitize(raw, config = CONFIG) {
  const base = initialState(config);
  if (!raw || typeof raw !== 'object') return base;
  const state = { ...base };
  state.dayKey = typeof raw.dayKey === 'string' ? raw.dayKey : base.dayKey;
  state.memberPoints = int(raw.memberPoints, 0, 99999999);
  state.virtualCoins = int(raw.virtualCoins ?? raw.tokens, 0, 9999);
  state.droppedCoins = int(raw.droppedCoins ?? raw.dropped, 0, 99999);
  state.totalDropped = Math.max(int(raw.totalDropped, 0, 999999), state.droppedCoins);
  state.coupons = int(raw.coupons ?? raw.physical, 0, 99999);
  state.jackpotWon = raw.jackpotWon === true;
  state.jackpotWonAt = typeof raw.jackpotWonAt === 'string' ? raw.jackpotWonAt : null;
  state.boxesPurchased = int(raw.boxesPurchased, 0, 99999);
  state.purchasesToday = int(raw.purchasesToday, 0, 999);
  state.insertsToday = int(raw.insertsToday, 0, 9999);
  state.exchangesToday = int(raw.exchangesToday, 0, 9999);
  state.muted = raw.muted === true;
  // 积分必须重新从 MCP 拉取，不能因为本地缓存显示成功；加载态也不持久化。
  state.pointsLoaded = false;
  state.isLoading = false;
  state.records = Array.isArray(raw.records)
    ? raw.records
        .filter((r) => r && typeof r === 'object' && ['exchange', 'jackpot'].includes(r.type))
        .slice(0, 60)
        .map((r) => ({
          id: typeof r.id === 'string' ? r.id : uid('r'),
          type: r.type,
          at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
          virtual: int(r.virtual, 0, 9999),
          coupons: int(r.coupons ?? r.physical, 0, 999),
          orderId: typeof r.orderId === 'string' ? r.orderId.slice(0, 80) : null,
          code: typeof r.code === 'string' ? r.code.slice(0, 80) : '',
          status: typeof r.status === 'string' ? r.status.slice(0, 24) : '已发至麦当劳账户',
        }))
    : [];
  return state;
}

export class Store {
  /**
   * @param {typeof CONFIG} config
   * @param {{ mcp?: typeof defaultMcp }} deps 允许注入 mock，便于测试
   */
  constructor(config = CONFIG, deps = {}) {
    this.config = config;
    this.mcp = deps.mcp ?? defaultMcp;
    this.state = this.load();
    this.listeners = new Set();
    this.ensureDay();
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return sanitize(raw, this.config);
    } catch {
      return initialState(this.config);
    }
  }

  save() {
    try {
      // isLoading 与 pointsLoaded 是会话级状态，不写入持久化数据。
      const { isLoading, pointsLoaded, ...persisted } = this.state;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...persisted, isLoading: false, pointsLoaded: false })
      );
    } catch {
      // 隐私模式/存储已满时不影响游戏本身。
    }
  }

  ensureDay() {
    const today = dayKey();
    if (this.state.dayKey !== today) {
      this.state.dayKey = today;
      this.state.purchasesToday = 0;
      this.state.insertsToday = 0;
      this.state.exchangesToday = 0;
      this.save();
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  emit(meta = {}) {
    this.ensureDay();
    this.save();
    for (const fn of this.listeners) fn(this.state, meta);
  }

  get exchangeable() {
    return Math.floor(this.state.droppedCoins / this.config.economy.exchangeRate);
  }

  get remaining() {
    const e = this.config.economy;
    return {
      purchases: Math.max(0, e.maxPurchasesPerDay - this.state.purchasesToday),
      inserts: Math.max(0, e.maxInsertsPerDay - this.state.insertsToday),
      exchanges: Math.max(0, e.maxExchangesPerDay - this.state.exchangesToday),
    };
  }

  async _withLoading(task) {
    if (this.state.isLoading) {
      return { ok: false, code: 'BUSY', message: '操作进行中，请稍候' };
    }
    this.state.isLoading = true;
    this.emit({ type: 'loading', loading: true });
    try {
      return await task();
    } catch (error) {
      return this._errorResult(error);
    } finally {
      this.state.isLoading = false;
      this.emit({ type: 'loading', loading: false });
    }
  }

  _errorResult(error) {
    const message =
      error && typeof error === 'object' && typeof error.message === 'string' && error.message
        ? error.message
        : '麦当劳 MCP 服务暂时不可用，请稍后再试';
    return {
      ok: false,
      code:
        error && typeof error === 'object' && typeof error.code === 'string'
          ? error.code
          : 'MCP_ERROR',
      message,
    };
  }

  /** 从麦当劳账户拉取真实可用积分。启动时调用一次，兑币前再校准一次。 */
  async refreshMemberPoints({ silent = false } = {}) {
    return this._withLoading(async () => {
      const result = await this.mcp.getPoints();
      this.state.memberPoints = int(result.points, 0, 99999999);
      this.state.pointsLoaded = true;
      this.emit({ type: 'points', silent, points: this.state.memberPoints });
      return { ok: true, points: this.state.memberPoints };
    });
  }

  /**
   * 100 积分 -> 5 代币。
   * 真实积分扣减由麦当劳积分商城完成；只有 mall-create-order 成功后才加代币。
   */
  async buyCoins() {
    const result = await this._withLoading(async () => {
      this.ensureDay();
      const eco = this.config.economy;
      if (this.state.purchasesToday >= eco.maxPurchasesPerDay) {
        return {
          ok: false,
          code: 'PURCHASE_CAP',
          message: `今日兑换已达 ${eco.maxPurchasesPerDay} 次上限，明天再来吧`,
        };
      }

      // 每次兑币前以 MCP 余额为准，避免本地缓存的积分过期；
      // 同时确保 Token/网络异常时不会先下订单。
      const account = await this.mcp.getPoints();
      this.state.memberPoints = int(account.points, 0, 99999999);
      this.state.pointsLoaded = true;
      this.emit({ type: 'points-before-buy', points: this.state.memberPoints });

      if (this.state.memberPoints < eco.pointsPerPack) {
        const need = eco.pointsPerPack - this.state.memberPoints;
        return {
          ok: false,
          code: 'POINTS_NOT_ENOUGH',
          message: `积分不足，还差 ${need} 积分（当前 ${this.state.memberPoints} 积分）`,
        };
      }

      // 写操作只调用一次；绝不自动重试，避免重复扣积分/重复下单。
      const order = await this.mcp.buyCoins();
      const pointsAfter = Number.isFinite(order.pointsAfter)
        ? order.pointsAfter
        : this.state.memberPoints - eco.pointsPerPack;

      this.state.memberPoints = int(pointsAfter, 0, 99999999);
      this.state.virtualCoins += eco.coinsPerPack;
      this.state.boxesPurchased += 1;
      this.state.purchasesToday += 1;
      this.emit({
        type: 'buy',
        amount: eco.coinsPerPack,
        points: this.state.memberPoints,
        orderId: order.orderId,
      });
      return {
        ok: true,
        amount: eco.coinsPerPack,
        points: this.state.memberPoints,
        order,
      };
    });

    // 不在下单后立刻再做一次 query：部分服务/网关存在读延迟，可能用旧余额覆盖
    // 刚刚的本地扣减。真实余额在下次启动或手动刷新时校准。
    return result;
  }

  /** 兼容旧调用名；新代码请使用 buyCoins()。 */
  async buyBox() {
    return this.buyCoins();
  }

  insertCoin() {
    this.ensureDay();
    const eco = this.config.economy;
    if (this.state.isLoading) {
      return { ok: false, code: 'BUSY', message: '正在处理麦当劳请求，请稍候' };
    }
    if (this.state.virtualCoins <= 0) {
      return { ok: false, code: 'NO_COINS', message: '游戏代币不足，先积分兑币吧' };
    }
    if (this.state.insertsToday >= eco.maxInsertsPerDay) {
      return { ok: false, code: 'INSERT_CAP', message: `今日投币已达 ${eco.maxInsertsPerDay} 次上限` };
    }
    this.state.virtualCoins -= 1;
    this.state.insertsToday += 1;
    this.emit({ type: 'insert' });
    return { ok: true };
  }

  coinDropped() {
    this.state.droppedCoins += 1;
    this.state.totalDropped += 1;
    this.emit({ type: 'drop' });
  }

  winJackpot() {
    if (!(this.config.rewards?.jackpotEnabled ?? true)) return { ok: false };
    if (this.state.jackpotWon && this.config.economy.jackpotOnce) {
      return { ok: false };
    }
    this.state.jackpotWon = true;
    this.state.jackpotWonAt = new Date().toISOString();
    this.state.records.unshift({
      id: uid('jackpot'),
      type: 'jackpot',
      at: this.state.jackpotWonAt,
      virtual: 0,
      coupons: 0,
      orderId: null,
      code: `BOX-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      status: '待领取',
    });
    this.emit({ type: 'jackpot' });
    return { ok: true };
  }

  refillJackpot() {
    if (!this.state.jackpotWon) return { ok: false };
    this.state.jackpotWon = false;
    this.state.jackpotWonAt = null;
    this.emit({ type: 'jackpot-refill' });
    return { ok: true };
  }

  /**
   * 3 个掉落虚拟鸡块 -> 1 张真实麦乐鸡券。
   * 只有 mall-create-order 成功返回后，才扣掉落物并写入记录。
   */
  async exchange() {
    return this._withLoading(async () => {
      this.ensureDay();
      const eco = this.config.economy;
      if (this.state.droppedCoins < eco.exchangeRate) {
        const need = eco.exchangeRate - this.state.droppedCoins;
        return {
          ok: false,
          code: 'NOT_ENOUGH',
          message: `还差 ${need} 块已掉落鸡块才能兑换`,
        };
      }
      if (this.state.exchangesToday >= eco.maxExchangesPerDay) {
        return {
          ok: false,
          code: 'EXCHANGE_CAP',
          message: `今日兑换已达 ${eco.maxExchangesPerDay} 次上限`,
        };
      }

      const order = await this.mcp.exchangeCoupon();
      const coupons = this.config.rewards?.exchangeCoupons ?? 1;
      const couponCode = order.couponCodes?.[0] || order.orderId || '';
      // 若券 SKU 同时消耗积分，服务端返回了余额就同步；没返回则等下次启动校准。
      if (Number.isFinite(order.pointsAfter)) {
        this.state.memberPoints = int(order.pointsAfter, 0, 99999999);
      }
      this.state.droppedCoins -= eco.exchangeRate;
      this.state.coupons += coupons;
      this.state.exchangesToday += 1;
      const record = {
        id: uid('exchange'),
        type: 'exchange',
        at: new Date().toISOString(),
        virtual: eco.exchangeRate,
        coupons,
        orderId: order.orderId,
        code: couponCode,
        status: '已发至麦当劳账户',
      };
      this.state.records.unshift(record);
      this.emit({ type: 'exchange', record, orderId: order.orderId });
      return { ok: true, record, order, message: '券已发至麦当劳账户' };
    });
  }

  setMuted(muted) {
    this.state.muted = Boolean(muted);
    this.emit({ type: 'mute' });
  }

  resetDemo() {
    const muted = this.state.muted;
    const memberPoints = this.state.memberPoints;
    const pointsLoaded = this.state.pointsLoaded;
    this.state = initialState(this.config);
    this.state.muted = muted;
    // 真实积分不随游戏进度重置；否则会让用户误以为积分被清空。
    this.state.memberPoints = memberPoints;
    this.state.pointsLoaded = pointsLoaded;
    this.emit({ type: 'reset' });
  }
}

export { STORAGE_KEY };
