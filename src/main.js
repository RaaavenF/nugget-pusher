import { CONFIG } from './config.js';
import { Store } from './store.js';
import { SoundEngine } from './audio.js';
import { Confetti } from './confetti.js';
import { UI } from './ui.js';
import { GameWorld } from './three/World.js';

const store = new Store(CONFIG);
const audio = new SoundEngine(store.state.muted);
const confetti = new Confetti(document.getElementById('confettiCanvas'));
const ui = new UI({ store, audio, confetti, config: CONFIG });
const container = document.getElementById('canvasWrap');

let world = null;

function showFatalError(error) {
  console.error(error);
  const loader = document.getElementById('stageLoader');
  if (loader) {
    loader.classList.remove('is-hidden');
    loader.innerHTML = `
      <div style="font-size:44px;line-height:1">🍗</div>
      <p style="max-width:280px;text-align:center;line-height:1.6">3D 场景加载失败。请使用支持 WebGL 的现代浏览器，或刷新页面重试。</p>
    `;
  }
  ui.toast('3D 场景加载失败，请刷新重试', 'error');
}

try {
  world = new GameWorld(container, CONFIG, {
    jackpotAlreadyWon: store.state.jackpotWon,
    onReady: () => ui.hideLoader(),
    onCoinLanded: () => ui.onCoinLanded(),
    onCoinDropped: ({ screen }) => ui.onCoinDropped(screen),
    onJackpotStart: () => ui.onJackpotStart(),
    onJackpot: () => {
      const result = store.winJackpot();
      if (result.ok) {
        ui.showJackpotWin(store.state.records[0]);
      }
    },
    onAssist: () => {},
    onLabels: (labels) => ui.updateLabels(labels),
  });
  ui.attachWorld(world);
} catch (error) {
  showFatalError(error);
}

ui.start();

// 启动时从麦当劳 MCP 拉取真实积分；没有 Token 时给出明确提示，不伪造余额。
void store.refreshMemberPoints().then((result) => {
  if (!result.ok) ui.toast(result.message, 'error');
});

// 页面切回时避免物理时间跳跃
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && world) {
    world.lastTime = performance.now();
  }
});

// 调试入口：?debug=1 时暴露，仅供验收 / 调参使用
const params = new URLSearchParams(location.search);
if (import.meta.env.DEV && params.has('debug')) {
  window.__NUGGET_GAME__ = {
    store,
    world,
    ui,
    audio,
    config: CONFIG,
    state: () => JSON.parse(JSON.stringify(store.state)),
    addTokens(n = 5) {
      store.state.virtualCoins += Math.max(0, Math.floor(n));
      store.emit({ type: 'debug' });
    },
    addDropped(n = 5) {
      store.state.droppedCoins += Math.max(0, Math.floor(n));
      store.state.totalDropped += Math.max(0, Math.floor(n));
      store.emit({ type: 'debug' });
    },
    addPoints(n = 1000) {
      store.state.memberPoints = Math.max(0, Math.floor(n));
      store.state.pointsLoaded = true;
      store.emit({ type: 'debug' });
    },
    forceJackpot() {
      world?.forceJackpot();
    },
    fastForward(seconds = 20) {
      world?.fastForward(seconds);
    },
    simulate(seconds = 30) {
      return world?.simulateFor(seconds);
    },
    insert(n = 1) {
      for (let i = 0; i < n; i++) {
        const res = store.insertCoin();
        if (!res.ok) return false;
        world?.queueDrop();
      }
      return true;
    },
    closeModal() {
      ui.closeModal();
    },
    reset() {
      store.resetDemo();
      world?.resetMachine();
      ui.hintDismissed = false;
      ui.hintMuted = false;
    },
  };
  console.info('[NUGGET PUSHER] debug API ready at window.__NUGGET_GAME__');
}
