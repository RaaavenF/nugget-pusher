import { CONFIG } from './config.js';
import { formatClock, prefersReducedMotion } from './utils.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const formatPoints = (n) => {
  const value = Number(n) || 0;
  return value >= 100000 ? `${(value / 10000).toFixed(1)}万` : value.toLocaleString('zh-CN');
};

export class UI {
  constructor({ store, audio, confetti, config = CONFIG }) {
    this.store = store;
    this.audio = audio;
    this.confetti = confetti;
    this.config = config;
    this.world = null;
    this.activeModal = null;
    this.lastFocused = null;
    this.hasRendered = false;
    this.prevState = null;
    this.hintDismissed = false;
    this.hintMuted = false;
    this.labelsMuted = false;
    this.activeFlyers = 0;
    this.winConfettiToken = 0;
    this.jackpotRefreshTimer = null;
    this.resetArmed = false;
    this.resetTimer = null;

    this.el = {
      layer: $('#modalLayer'),
      viewport: $('.modal-viewport'),
      cards: {
        purchase: $('#purchaseModal'),
        exchange: $('#exchangeModal'),
        noCoin: $('#noCoinModal'),
        coupon: $('#couponModal'),
        rewards: $('#rewardsModal'),
        win: $('#winModal'),
        help: $('#helpModal'),
      },
      tokens: $('#statTokens'),
      dropped: $('#statDropped'),
      coupons: $('#statCoupons'),
      points: $('#statPoints'),
      memberPanel: $('#memberPanel'),
      mcpStatus: $('#mcpStatus'),
      mcpPill: $('#mcpPill'),
      mcpPillText: $('#mcpPillText'),
      buySpinner: $('#buySpinner'),
      walletTokens: $('#walletTokens'),
      walletDropped: $('#walletDropped'),
      exchangeProgressText: $('#exchangeProgressText'),
      exchangeBar: $('#exchangeBar'),
      exchangeReadyBadge: $('#exchangeReadyBadge'),
      exchangeBtn: $('#exchangeBtn'),
      buyBtn: $('#buyBtn'),
      buyBtnSub: $('#buyBtnSub'),
      insertBtn: $('#insertBtn'),
      insertBtnSub: $('#insertBtnSub'),
      insertTokenCount: $('#insertTokenCount'),
      rewardsDot: $('#rewardDot'),
      rewardsBtn: $('#rewardsBtn'),
      jackpotChip: $('#jackpotChip'),
      jackpotFoot: $('#jackpotFoot'),
      labelSlot: $('#labelSlot'),
      labelExit: $('#labelExit'),
      hintBubble: $('#hintBubble'),
      hintText: $('#hintText'),
      hintClose: $('#hintClose'),
      dragTip: $('#dragTip'),
      loader: $('#stageLoader'),
      toastStack: $('#toastStack'),
      flyLayer: $('#flyLayer'),
      soundBtn: $('#soundBtn'),
      helpBtn: $('#helpBtn'),
      rewardsLink: $('#rewardsLink'),
      rewardDropped: $('#rewardDropped'),
      rewardExchangeable: $('#rewardExchangeable'),
      rewardCoupons: $('#rewardCoupons'),
      rewardsJackpot: $('#rewardsJackpot'),
      rewardsJackpotText: $('#rewardsJackpotText'),
      rewardsJackpotState: $('#rewardsJackpotState'),
      recordsList: $('#recordsList'),
      recordsCount: $('#recordsCount'),
      claimNote: $('#claimNote'),
      capsNote: $('#capsNote'),
      resetDemoBtn: $('#resetDemoBtn'),
      refreshJackpotBtn: $('#refreshJackpotBtn'),
      confirmExchangeBtn: $('#confirmExchangeBtn'),
      exchangeCost: $('#exchangeCost'),
      exchangeModalSub: $('#exchangeModalSub'),
      exchangeCouponTitle: $('#exchangeCouponTitle'),
      noCoinCost: $('#noCoinCost'),
      noCoinBuyBtn: $('#noCoinBuyBtn'),
      couponCode: $('#couponCode'),
      couponOrder: $('#couponOrder'),
      purchaseTitle: $('#purchaseTitle'),
      winCode: $('#winCode'),
    };

    this.applyConfigCopy();
    this.bind();
    this.audio.setMuted(store.state.muted);
    this.syncSoundButton(store.state.muted);
  }

  attachWorld(world) {
    this.world = world;
    setTimeout(() => this.hideLoader(), 5000); // 兜底
    setTimeout(() => this.el.dragTip?.classList.add('is-hidden'), 9000);
    setTimeout(() => {
      this.labelsMuted = true;
      this.el.labelSlot?.classList.remove('is-visible');
      this.el.labelExit?.classList.remove('is-visible');
    }, 9000);
  }

  applyConfigCopy() {
    const eco = this.config.economy;
    const points = eco.pointsPerPack;
    const coins = eco.coinsPerPack;
    const rate = eco.exchangeRate;
    const coupons = this.config.rewards?.exchangeCoupons ?? 1;
    if (this.el.purchaseTitle) {
      this.el.purchaseTitle.innerHTML = `获得 ${coins} 枚<br />游戏代币！`;
    }
    const purchaseSub = $('#purchaseSub');
    if (purchaseSub) {
      purchaseSub.textContent = `${points} 积分已通过麦当劳 MCP 扣除，代币已放入投币余额。`;
    }
    const receipt = $('#purchaseReceipt');
    if (receipt) receipt.textContent = `${points} 积分 · ${coins} 枚游戏代币`;
    const receiptValue = $('#purchaseAmount');
    if (receiptValue) {
      receiptValue.innerHTML = `+${coins} <svg viewBox="0 0 40 40"><use href="#i-token"></use></svg>`;
    }
    const purchaseFineprint = $('#purchaseFineprint');
    if (purchaseFineprint) purchaseFineprint.textContent = '积分由麦当劳账户实时扣除 · 代币仅用于本游戏';
    const memberBuyTitle = $('#memberBuyTitle');
    if (memberBuyTitle) memberBuyTitle.textContent = `${points}积分兑${coins}代币`;
    const buySub = this.el.buyBtnSub;
    if (buySub) buySub.textContent = `立即兑换 · 今日余 ${this.store.remaining.purchases} 次`;
    const buyBadge = $('#buyBadge');
    if (buyBadge) buyBadge.textContent = `+${coins}`;
    if (this.el.noCoinCost) this.el.noCoinCost.textContent = `${points} 积分 = ${coins} 代币`;
    if (this.el.exchangeCost) this.el.exchangeCost.textContent = `${rate} 块`;
    if (this.el.exchangeModalSub) {
      this.el.exchangeModalSub.textContent = `用 ${rate} 块已掉落的虚拟鸡块，换 ${coupons} 张真实麦乐鸡券。`;
    }
    const virtualLabel = $('#exchangeModal .virtual-side b');
    if (virtualLabel) virtualLabel.textContent = `×${rate} 虚拟`;
    const couponLabel = $('#exchangeModal .physical-side b');
    if (couponLabel) couponLabel.textContent = `${coupons} 张券`;
    const exchangeFrom = $('#exchangeFrom');
    if (exchangeFrom) exchangeFrom.textContent = String(rate);
    const exchangeTo = $('#exchangeTo');
    if (exchangeTo) exchangeTo.textContent = String(coupons);
    if (this.el.exchangeCouponTitle) this.el.exchangeCouponTitle.textContent = String(coupons);
    const helpPoints = $('#helpPoints');
    if (helpPoints) helpPoints.textContent = String(points);
    const helpTokens = $('#helpTokens');
    if (helpTokens) helpTokens.textContent = String(coins);
    const helpRate = $('#helpRate');
    if (helpRate) helpRate.textContent = String(rate);
    const helpCoupons = $('#helpCoupons');
    if (helpCoupons) helpCoupons.textContent = String(coupons);
    const headerDropped = $('#walletDropped small');
    if (headerDropped) headerDropped.textContent = '已掉落';
    if (this.el.claimNote) this.el.claimNote.textContent = this.config.copy.claimNote;
    const dockRatio = $('#dockRatio');
    if (dockRatio) dockRatio.textContent = `${rate} 块已掉落 = ${coupons} 张麦乐鸡券`;
  }

  bind() {
    const onFirstGesture = () => {
      this.audio.unlock();
      document.removeEventListener('pointerdown', onFirstGesture);
      document.removeEventListener('keydown', onFirstGesture);
    };
    document.addEventListener('pointerdown', onFirstGesture, { passive: true });
    document.addEventListener('keydown', onFirstGesture);

    this.el.buyBtn.addEventListener('click', () => this.handleBuy());
    this.el.insertBtn.addEventListener('click', () => this.handleInsert());
    this.el.exchangeBtn.addEventListener('click', () => this.handleExchange());
    this.el.confirmExchangeBtn.addEventListener('click', () => this.confirmExchange());
    this.el.rewardsBtn.addEventListener('click', () => this.openRewards());
    this.el.rewardsLink.addEventListener('click', () => this.openRewards());
    this.el.helpBtn.addEventListener('click', () => this.openModal('help'));
    this.el.hintClose.addEventListener('click', () => this.dismissHint());
    this.el.soundBtn.addEventListener('click', () => this.toggleSound());
    this.el.resetDemoBtn.addEventListener('click', () => this.handleReset());
    this.el.refreshJackpotBtn.addEventListener('click', () => this.refreshJackpotNow(false));
    this.el.noCoinBuyBtn.addEventListener('click', () => {
      this.closeModal();
      setTimeout(() => this.handleBuy(), 0);
    });

    this.el.layer.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target.closest('[data-close]') : null;
      if (target) this.closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (!this.activeModal) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeModal();
        return;
      }
      if (e.key === 'Tab') this.trapFocus(e);
    });

    // 视口变化后同步画布尺寸（世界自己也有 ResizeObserver）
    window.addEventListener('orientationchange', () => {
      this.el.dragTip?.classList.add('is-hidden');
    });
  }

  start() {
    this.store.subscribe((state, meta) => this.render(state, meta));
    // 如果是上次会话遗留的“已中奖”状态，稍后自动补货。
    if (this.store.state.jackpotWon) this.scheduleJackpotRefresh();
  }

  /* ---------------- 主渲染 ---------------- */
  render(state, meta = {}) {
    const eco = this.config.economy;
    const prev = this.prevState;
    const rate = eco.exchangeRate;
    const dropped = state.droppedCoins ?? 0;
    const coins = state.virtualCoins ?? 0;
    const points = state.memberPoints ?? 0;
    const exchangeable = Math.floor(dropped / rate);
    const remainder = dropped % rate;
    const remaining = this.store.remaining;

    this.el.tokens.textContent = String(coins);
    this.el.dropped.textContent = String(dropped);
    this.el.coupons.textContent = String(state.coupons ?? 0);
    this.el.points.textContent = state.pointsLoaded ? formatPoints(points) : '—';
    this.el.memberPanel?.classList.toggle('is-loading', !state.pointsLoaded || state.isLoading);
    this.el.buySpinner?.classList.toggle('hidden', !state.isLoading);
    if (this.el.mcpStatus) {
      const isMock = Boolean(this.store.mcp?.isMock);
      this.el.mcpStatus.textContent = isMock
        ? '演示模式 · 本地模拟 MCP'
        : state.isLoading
          ? '正在连接麦当劳 MCP…'
          : state.pointsLoaded
            ? '麦当劳 MCP 已连接'
            : 'MCP 未连接 · 请检查代理和 Token';
      this.el.mcpStatus.classList.toggle('text-emerald-600', Boolean(!isMock && state.pointsLoaded && !state.isLoading));
      this.el.mcpStatus.classList.toggle('text-amber-600', Boolean(isMock || state.isLoading));
      this.el.mcpStatus.classList.toggle('text-rose-500', Boolean(!isMock && !state.isLoading && !state.pointsLoaded));
    }
    if (this.el.mcpPill) {
      const isMock = Boolean(this.store.mcp?.isMock);
      const connected = !isMock && state.pointsLoaded && !state.isLoading;
      const error = !isMock && !state.isLoading && !state.pointsLoaded;
      this.el.mcpPill.classList.toggle('is-connected', connected);
      this.el.mcpPill.classList.toggle('is-error', error);
      if (this.el.mcpPillText) {
        this.el.mcpPillText.textContent = isMock
          ? '演示模式'
          : state.isLoading
            ? 'MCP 连接中'
            : state.pointsLoaded
              ? 'MCP 已连接'
              : 'MCP 未连接';
      }
    }
    this.el.insertTokenCount.textContent = coins > 99 ? '99+' : String(coins);

    if (this.hasRendered) {
      if (prev && coins > (prev.virtualCoins ?? 0)) this.bump(this.el.tokens);
      if (prev && dropped > (prev.droppedCoins ?? 0)) this.bump(this.el.dropped);
      if (prev && points > (prev.memberPoints ?? 0)) this.bump(this.el.points);
      if (prev && (state.coupons ?? 0) > (prev.coupons ?? 0)) this.bump(this.el.coupons);
    }

    // 兑换进度
    let progressText;
    let percent;
    if (remainder === 0) {
      percent = exchangeable > 0 ? 100 : 0;
      progressText = exchangeable > 0
        ? `已可兑换 ${exchangeable} 张麦乐鸡券`
        : `再掉 ${rate} 块可兑换 1 张麦乐鸡券`;
    } else {
      percent = (remainder / rate) * 100;
      progressText = `再掉 ${rate - remainder} 块可兑换 1 张麦乐鸡券`;
    }
    this.el.exchangeProgressText.textContent = progressText;
    this.el.exchangeBar.style.width = `${percent}%`;
    this.el.exchangeReadyBadge.hidden = exchangeable <= 0;
    this.el.exchangeReadyBadge.textContent = `可兑 ${exchangeable} 张`;
    this.el.exchangeBtn.classList.toggle('is-ready', exchangeable > 0);
    this.el.exchangeBtn.classList.toggle('is-dim', exchangeable <= 0);

    // 操作按钮
    const buyCapped = remaining.purchases <= 0;
    const insertCapped = remaining.inserts <= 0;
    const noCoins = coins <= 0;
    if (state.isLoading) {
      this.el.buyBtnSub.textContent = '正在连接麦当劳 MCP…';
    } else if (!state.pointsLoaded) {
      this.el.buyBtnSub.textContent = `${eco.pointsPerPack} 积分 = ${eco.coinsPerPack} 代币 · 积分待加载`;
    } else if (buyCapped) {
      this.el.buyBtnSub.textContent = '今日兑换次数已达上限';
    } else if (points < eco.pointsPerPack) {
      this.el.buyBtnSub.textContent = `需要 ${eco.pointsPerPack} 积分 · 当前 ${formatPoints(points)}`;
    } else {
      this.el.buyBtnSub.textContent = `${eco.pointsPerPack} 积分 = ${eco.coinsPerPack} 枚代币 · 今日余 ${remaining.purchases} 次`;
    }
    if (insertCapped) {
      this.el.insertBtnSub.textContent = '今日投币次数已用完';
    } else if (noCoins) {
      this.el.insertBtnSub.textContent = '代币不足 · 先积分兑币';
    } else {
      this.el.insertBtnSub.textContent = `消耗 1 枚 · 剩 ${coins} 枚`;
    }
    this.el.insertBtn.classList.toggle('is-empty', noCoins || insertCapped);
    this.el.buyBtn.disabled = state.isLoading;
    this.el.insertBtn.disabled = state.isLoading;
    this.el.exchangeBtn.disabled = state.isLoading;
    this.el.buyBtn.setAttribute('aria-busy', String(Boolean(state.isLoading)));
    this.el.confirmExchangeBtn.disabled = state.isLoading;
    this.el.confirmExchangeBtn.textContent = state.isLoading ? '兑换中…' : '确认兑换';

    // 大奖状态
    const won = state.jackpotWon;
    this.el.jackpotChip.classList.toggle('is-won', won);
    $('.jackpot-chip strong', this.el.jackpotChip).textContent = won ? '已中奖' : '大奖待命';
    this.el.jackpotFoot.textContent = won ? '已获得' : '待命中';
    this.el.rewardsJackpot.classList.toggle('is-won', won);
    this.el.rewardsJackpotText.textContent = won ? '一整盒大奖已收入奖励记录' : '还在推币机里，等你推落';
    this.el.rewardsJackpotState.textContent = won ? '已获得' : '待命中';
    this.el.refreshJackpotBtn.hidden = !won;
    this.el.rewardsDot.hidden = !(exchangeable > 0 || won);

    // 奖励面板
    this.el.rewardDropped.textContent = String(dropped);
    this.el.rewardExchangeable.textContent = String(exchangeable);
    this.el.rewardCoupons.textContent = String(state.coupons ?? 0);
    this.el.recordsCount.textContent = `${state.records.length} 条`;
    this.el.capsNote.textContent = `今日额度：兑币 ${state.purchasesToday}/${eco.maxPurchasesPerDay} 次 · 投币 ${state.insertsToday}/${eco.maxInsertsPerDay} 次 · 兑换券 ${state.exchangesToday}/${eco.maxExchangesPerDay} 次`;
    this.el.claimNote.textContent = this.config.copy.claimNote;
    this.renderRecords(state.records);
    this.updateHint(state);

    this.syncSoundButton(state.muted);
    if (meta.type === 'reset') this.resetArmed = false;
    this.hasRendered = true;
    this.prevState = { ...state };
  }

  renderRecords(records) {
    if (!records.length) {
      this.el.recordsList.innerHTML = `<div class="record-empty">还没有兑换记录。<br />投币把鸡块推下出口，攒够 ${this.config.economy.exchangeRate} 块就能兑换真实麦乐鸡券。</div>`;
      return;
    }
    this.el.recordsList.innerHTML = records
      .slice(0, 20)
      .map((r) => {
        if (r.type === 'jackpot') {
          return `<div class="record-item type-jackpot">
            <span class="record-icon"><svg viewBox="0 0 40 40"><use href="#i-trophy"></use></svg></span>
            <div class="record-main"><b>JACKPOT · 一整盒麦乐鸡</b><small>${formatClock(r.at)} · 领取码 ${escapeHtml(r.code)}</small></div>
            <span class="record-status">${escapeHtml(r.status)}</span>
          </div>`;
        }
        return `<div class="record-item">
          <span class="record-icon"><svg viewBox="0 0 40 40"><use href="#i-box"></use></svg></span>
          <div class="record-main"><b>兑换 ${r.coupons ?? 1} 张麦乐鸡券</b><small>${formatClock(r.at)} · ${r.code ? `券码 ${escapeHtml(r.code)}` : `订单 ${escapeHtml(r.orderId || '处理中')}`}</small></div>
          <span class="record-status">${escapeHtml(r.status || '已发至麦当劳账户')}</span>
        </div>`;
      })
      .join('');
  }

  updateHint(state) {
    if (this.hintDismissed || this.hintMuted) {
      this.el.hintBubble.classList.add('is-hidden');
      return;
    }
    let text = '';
    if (state.totalDropped === 0) {
      text = (state.virtualCoins ?? 0) > 0
        ? '点击「投币」，让推板把鸡块推下去！'
        : `用 ${this.config.economy.pointsPerPack} 积分兑 ${this.config.economy.coinsPerPack} 枚代币，开始推币！`;
    } else if ((state.virtualCoins ?? 0) > 0 && state.totalDropped > 0 && (state.coupons ?? 0) === 0) {
      text = `攒够 ${this.config.economy.exchangeRate} 块已掉落，就能兑换 1 张麦乐鸡券！`;
    }
    if (!text) {
      this.el.hintBubble.classList.add('is-hidden');
      return;
    }
    this.el.hintText.textContent = text;
    this.el.hintBubble.classList.remove('is-hidden');
  }

  hideLoader() {
    this.el.loader?.classList.add('is-hidden');
  }

  dismissHint() {
    this.hintDismissed = true;
    this.el.hintBubble.classList.add('is-hidden');
  }

  /* ---------------- 玩家动作 ---------------- */
  async handleBuy() {
    if (this.activeModal || this.store.state.isLoading) return;
    this.audio.unlock();
    const res = await this.store.buyCoins();
    if (!res.ok) {
      this.toast(res.message, 'error');
      this.audio.error();
      this.shake(this.el.buyBtn);
      return;
    }
    this.audio.buy();
    this.openModal('purchase');
    this.confetti.fire({
      x: window.innerWidth / 2,
      y: window.innerHeight * 0.36,
      count: 42,
      power: 9,
      angle: -Math.PI / 2,
      spread: Math.PI * 1.4,
    });
    if (navigator.vibrate) navigator.vibrate(18);
  }

  handleInsert() {
    if (this.activeModal) return;
    if (this.store.state.isLoading) {
      this.toast('正在处理麦当劳请求，请稍候', 'info');
      return;
    }
    this.audio.unlock();
    const res = this.store.insertCoin();
    if (!res.ok) {
      if (res.code === 'NO_COINS') {
        this.openModal('noCoin');
      } else {
        this.toast(res.message, 'error');
      }
      this.audio.error();
      this.shake(this.el.insertBtn);
      return;
    }
    this.audio.insert();
    this.world?.queueDrop();
    this.hintMuted = true;
    this.el.hintBubble.classList.add('is-hidden');
    if (navigator.vibrate) navigator.vibrate(10);
  }

  handleExchange() {
    if (this.activeModal) return;
    this.audio.unlock();
    const rate = this.config.economy.exchangeRate;
    const state = this.store.state;
    if (state.droppedCoins < rate) {
      this.toast(`还差 ${rate - state.droppedCoins} 块已掉落鸡块才能兑换`, 'error');
      this.audio.error();
      this.shake(this.el.exchangeBtn);
      return;
    }
    if (this.store.remaining.exchanges <= 0) {
      this.toast(`今日兑换已达 ${this.config.economy.maxExchangesPerDay} 次上限`, 'error');
      this.audio.error();
      this.shake(this.el.exchangeBtn);
      return;
    }
    this.audio.click();
    this.openModal('exchange');
  }

  async confirmExchange() {
    if (this.store.state.isLoading) return;
    const res = await this.store.exchange();
    if (!res.ok) {
      this.toast(res.message, 'error');
      this.audio.error();
      this.shake(this.el.confirmExchangeBtn);
      return;
    }
    this.audio.exchange();
    this.el.couponCode.textContent = res.record.code || res.record.orderId || '已发放';
    this.el.couponOrder.textContent = res.record.orderId ? `订单号 ${res.record.orderId}` : '订单已记录';
    this.openModal('coupon');
    this.toast('券已发至麦当劳账户，可在“我的奖励”查看券码', 'success');
    this.confetti.fire({
      x: window.innerWidth / 2,
      y: window.innerHeight * 0.42,
      count: 34,
      power: 7,
      angle: -Math.PI / 2,
      spread: Math.PI * 1.3,
    });
    if (navigator.vibrate) navigator.vibrate([12, 30, 12]);
  }

  openRewards() {
    if (this.activeModal) return;
    this.audio.unlock();
    this.audio.click();
    this.openModal('rewards');
  }

  toggleSound() {
    const muted = !this.store.state.muted;
    this.store.setMuted(muted);
    this.audio.setMuted(muted);
    this.audio.unlock();
    if (!muted) this.audio.click();
    this.syncSoundButton(muted);
  }

  syncSoundButton(muted) {
    this.el.soundBtn.classList.toggle('is-muted', muted);
    this.el.soundBtn.setAttribute('aria-pressed', String(muted));
    this.el.soundBtn.setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
  }

  handleReset() {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.el.resetDemoBtn.classList.add('is-armed');
      this.el.resetDemoBtn.textContent = '再点一次，确认清空';
      clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => {
        this.resetArmed = false;
        this.el.resetDemoBtn.classList.remove('is-armed');
        this.el.resetDemoBtn.textContent = '重置游戏进度';
      }, 3200);
      return;
    }
    clearTimeout(this.resetTimer);
    this.resetArmed = false;
    this.el.resetDemoBtn.classList.remove('is-armed');
    this.el.resetDemoBtn.textContent = '重置游戏进度';
    this.store.resetDemo();
    this.world?.resetMachine();
    this.hintDismissed = false;
    this.hintMuted = false;
    this.confetti.clear();
    clearTimeout(this.jackpotRefreshTimer);
    this.jackpotRefreshTimer = null;
    this.closeModal();
    this.toast('游戏进度已重置，可以重新开玩', 'success');
    this.audio.click();
    window.scrollTo({ top: 0 });
  }

  /* ---------------- 世界回调 ---------------- */
  onCoinLanded() {
    this.audio.land();
  }

  onCoinDropped(screen) {
    const prevExchangeable = Math.floor(this.store.state.droppedCoins / this.config.economy.exchangeRate);
    this.store.coinDropped();
    const state = this.store.state;
    this.audio.fall();
    this.flyNugget(screen);
    this.bump(this.el.dropped);
    if (navigator.vibrate) navigator.vibrate(15);

    if (state.totalDropped === 1) {
      this.toast(`掉落成功！每 ${this.config.economy.exchangeRate} 块可兑换 1 张麦乐鸡券`, 'success');
    } else {
      const nowExchangeable = Math.floor(state.droppedCoins / this.config.economy.exchangeRate);
      if (nowExchangeable > prevExchangeable) {
        this.toast(`已攒够 ${this.config.economy.exchangeRate} 块，可以兑换麦乐鸡券啦！`, 'success');
      }
    }
    this.hintMuted = true;
    this.el.hintBubble.classList.add('is-hidden');
  }

  onJackpotStart() {
    this.hintMuted = true;
    this.el.hintBubble.classList.add('is-hidden');
  }

  showJackpotWin(record) {
    clearTimeout(this.jackpotRefreshTimer);
    this.jackpotRefreshTimer = null;
    const code = record?.code || 'BOX-DEMO';
    this.el.winCode.textContent = code;
    this.openModal('win');
    this.audio.jackpot();
    const token = ++this.winConfettiToken;
    setTimeout(() => {
      if (this.activeModal === 'win' && token === this.winConfettiToken) this.confetti.celebrate();
    }, 420);
    if (navigator.vibrate) navigator.vibrate([25, 45, 25, 45, 80]);
    this.el.rewardsDot.hidden = false;
  }

  /* ---------------- 大奖补货 ---------------- */
  scheduleJackpotRefresh() {
    clearTimeout(this.jackpotRefreshTimer);
    this.jackpotRefreshTimer = null;
    if (!this.store.state.jackpotWon) return;
    const seconds = this.config.economy.jackpotRefreshSec ?? 5;
    this.jackpotRefreshTimer = setTimeout(() => {
      this.jackpotRefreshTimer = null;
      if (this.store.state.jackpotWon) this.refreshJackpotNow(true);
    }, seconds * 1000);
    this.toast(`大奖补货中，约 ${seconds} 秒后刷新`, 'info');
  }

  refreshJackpotNow(auto = false) {
    clearTimeout(this.jackpotRefreshTimer);
    this.jackpotRefreshTimer = null;
    const res = this.store.refillJackpot();
    if (!res.ok) return;
    this.world?.respawnJackpot();
    this.audio.click();
    this.toast(auto ? '新的大奖已补货，继续挑战！' : '大奖已刷新，新的整盒大奖已就位', 'success');
    this.bump(this.el.rewardsJackpotState);
  }

  /* ---------------- 弹层管理 ---------------- */
  openModal(name) {
    const card = this.el.cards[name];
    if (!card) return;
    this.confetti.clear();
    if (this.activeModal) this.closeModal({ silent: true });
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.activeModal = name;
    for (const [key, el] of Object.entries(this.el.cards)) {
      el.hidden = key !== name;
      el.classList.remove('is-shown');
    }
    card.hidden = false;
    // 强制触发入场动画
    void card.offsetWidth;
    card.classList.add('is-shown');
    this.el.layer.classList.add('is-open');
    this.el.layer.setAttribute('aria-hidden', 'false');
    this.world?.setPaused(true);
    if (name === 'rewards') {
      this.resetArmed = false;
      this.el.resetDemoBtn.classList.remove('is-armed');
      this.el.resetDemoBtn.textContent = '重置游戏进度';
      this.render(this.store.state);
    }
    if (name === 'win') this.confetti.resize();
    setTimeout(() => {
      const focusTarget = card.querySelector('[data-autofocus], .modal-close, .cta-primary, button');
      focusTarget?.focus({ preventScroll: true });
    }, 60);
  }

  closeModal({ silent = false } = {}) {
    if (!this.activeModal) return;
    const name = this.activeModal;
    const card = this.el.cards[name];
    if (card) {
      card.hidden = true;
      card.classList.remove('is-shown');
    }
    this.activeModal = null;
    this.confetti.avoidRects = [];
    this.el.layer.classList.remove('is-open');
    this.el.layer.setAttribute('aria-hidden', 'true');
    if (!silent) {
      this.world?.setPaused(false);
      if (name === 'win') this.scheduleJackpotRefresh();
      if (this.lastFocused?.isConnected) {
        this.lastFocused.focus({ preventScroll: true });
      }
      this.audio.click();
    }
  }

  trapFocus(e) {
    const card = this.el.cards[this.activeModal];
    if (!card) return;
    const focusables = $$('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', card)
      .filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ---------------- 反馈 ---------------- */
  toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'is-error' : type === 'success' ? 'is-success' : ''}`;
    el.textContent = message;
    this.el.toastStack.appendChild(el);
    while (this.el.toastStack.children.length > 3) {
      this.el.toastStack.firstElementChild.remove();
    }
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 280);
    }, 2600);
  }

  bump(el) {
    if (!el) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 460);
  }

  shake(el) {
    if (!el || prefersReducedMotion()) return;
    const anim = el.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 260, easing: 'ease-out' }
    );
    anim.onfinish = () => anim.cancel();
  }

  flyNugget(screen) {
    if (prefersReducedMotion() || !screen || this.activeFlyers >= 4) {
      this.bump(this.el.dropped);
      return;
    }
    const targetEl = this.el.walletDropped;
    if (!targetEl) return;
    const target = targetEl.getBoundingClientRect();
    const startX = screen.clientX || window.innerWidth / 2;
    const startY = screen.clientY || window.innerHeight * 0.5;
    const dx = target.left + target.width / 2 - startX;
    const dy = target.top + target.height / 2 - startY;

    const el = document.createElement('div');
    el.className = 'fly-nugget';
    el.style.left = `${startX}px`;
    el.style.top = `${startY}px`;
    el.innerHTML = '<svg viewBox="0 0 64 64"><use href="#i-logo"></use></svg>';
    this.el.flyLayer.appendChild(el);
    this.activeFlyers++;

    const plus = document.createElement('div');
    plus.className = 'fly-plus';
    plus.textContent = '+1';
    plus.style.left = `${startX}px`;
    plus.style.top = `${startY - 12}px`;
    this.el.flyLayer.appendChild(plus);

    const anim = el.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1) rotate(-6deg)', opacity: 1 },
        { transform: `translate3d(${dx * 0.45}px, ${dy * 0.35 - 34}px, 0) scale(0.85) rotate(28deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.28) rotate(95deg)`, opacity: 0.85 },
      ],
      { duration: 700, easing: 'cubic-bezier(.25,.7,.25,1)', fill: 'forwards' }
    );
    anim.onfinish = () => {
      el.remove();
      plus.remove();
      this.activeFlyers = Math.max(0, this.activeFlyers - 1);
      this.bump(this.el.dropped);
    };

    plus.animate(
      [
        { transform: 'translate(-50%, -100%) translateY(0)', opacity: 0 },
        { transform: 'translate(-50%, -100%) translateY(-10px)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -100%) translateY(-42px)', opacity: 0 },
      ],
      { duration: 820, easing: 'ease-out', fill: 'forwards' }
    ).onfinish = () => plus.remove();
  }

  updateLabels(labels) {
    if (!labels) return;
    if (this.labelsMuted) {
      this.el.labelSlot?.classList.remove('is-visible');
      this.el.labelExit?.classList.remove('is-visible');
      return;
    }
    this.setLabel(this.el.labelSlot, labels.slot);
    this.setLabel(this.el.labelExit, labels.exit);
  }

  setLabel(el, pos) {
    if (!el || !pos) return;
    el.classList.toggle('is-visible', Boolean(pos.visible));
    if (pos.visible) {
      el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -100%)`;
    }
  }
}
