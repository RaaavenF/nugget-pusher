/**
 * 端到端验收：使用本机 Chrome + playwright-core。
 * 运行前先启动 dev server；建议使用 mock：
 *   VITE_MCD_MOCK=1 npm run dev
 * 真实 Token 验收时去掉 mock 并把 .env 配好。
 * 用法：npm run test:e2e
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SHOTS = process.env.SHOT_DIR || path.join(process.cwd(), '.artifacts');
fs.mkdirSync(SHOTS, { recursive: true });
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const failures = [];
const check = (cond, message) => {
  if (!cond) failures.push(message);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${message}`);
};

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--hide-scrollbars'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
});

await page.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

check(await page.evaluate(() => Boolean(window.__NUGGET_GAME__)), 'debug API 可用');
check(await page.isVisible('#buyBtn'), '购买按钮可见');

// --- 1. 购买 ---
await page.click('#buyBtn');
await page.waitForTimeout(700);
check(await page.isVisible('#purchaseModal'), '购买成功弹层出现');
let s = await page.evaluate(() => window.__NUGGET_GAME__.state());
check(s.virtualCoins === 5, `购买后游戏代币 = 5（实际 ${s.virtualCoins}）`);
check(s.memberPoints === 900 && s.pointsLoaded, `购买后 MCP 积分扣除 100（实际 ${s.memberPoints}）`);
check((await page.textContent('#statPoints')).replace(/,/g, '') === '900', '顶栏会员积分同步更新');
await page.waitForTimeout(1100);
await page.screenshot({ path: path.join(SHOTS, '01-purchase.png') });
await page.click('#purchaseModal .cta');
await page.waitForTimeout(500);
await page.click('#soundBtn');
await page.waitForTimeout(250);
const muted = await page.evaluate(() => window.__NUGGET_GAME__.store.state.muted);
check(muted, '静音按钮切换音效状态');
await page.click('#soundBtn');
await page.waitForTimeout(250);
check(!(await page.evaluate(() => window.__NUGGET_GAME__.store.state.muted)), '再次点击恢复音效');

// --- 2. 投币 ---
const before = s.virtualCoins;
await page.click('#insertBtn');
await page.waitForTimeout(900);
s = await page.evaluate(() => window.__NUGGET_GAME__.state());
check(s.virtualCoins === before - 1, `投币扣除 1 枚，余额 ${s.virtualCoins}`);
check(await page.isVisible('canvas.game-canvas'), '3D 推币机画布可见');
await page.screenshot({ path: path.join(SHOTS, '02-inserted.png') });

// --- 3. 真实物理掉落 ---
// 用开发接口以固定 60fps 快进整台机器（落板/挡板/斜坡/推板/物理），
// 避免无头 SwiftShader 低帧率把“游戏时间”拖慢，导致误判为没有掉落。
for (let i = 0; i < 12; i++) {
  const d = await page.evaluate(() => {
    const g = window.__NUGGET_GAME__;
    if (g.state().virtualCoins < 1) g.addTokens(1);
    g.insert(1);
    g.simulate(3);
    return g.state().droppedCoins;
  });
  if (d >= 1) break;
}
for (let i = 0; i < 4; i++) {
  const d = await page.evaluate(() => {
    const g = window.__NUGGET_GAME__;
    g.simulate(6);
    return g.state().droppedCoins;
  });
  if (d >= 1) break;
}
s = await page.evaluate(() => window.__NUGGET_GAME__.state());
console.log('state after simulated play:', JSON.stringify(s));
check(s.droppedCoins >= 1, `至少掉落 1 块虚拟鸡块（droppedCoins=${s.droppedCoins}）`);
await page.screenshot({ path: path.join(SHOTS, '03-after-drop.png') });

// --- 4. 兑换 ---
if (s.droppedCoins < 3) {
  await page.evaluate(() => {
    const g = window.__NUGGET_GAME__;
    g.addDropped(3 - g.state().droppedCoins);
  });
  await page.waitForTimeout(300);
}
await page.click('#exchangeBtn');
await page.waitForTimeout(400);
check(await page.isVisible('#exchangeModal'), '兑换确认弹层出现');
await page.screenshot({ path: path.join(SHOTS, '04-exchange-modal.png') });
const dropBefore = await page.evaluate(() => window.__NUGGET_GAME__.state().droppedCoins);
await page.click('#confirmExchangeBtn');
await page.waitForTimeout(1000);
s = await page.evaluate(() => window.__NUGGET_GAME__.state());
check(s.droppedCoins === dropBefore - 3, `兑换扣除 3 块（${dropBefore} -> ${s.droppedCoins}）`);
check(s.coupons === 1, `获得 1 张麦乐鸡券（实际 ${s.coupons}）`);
check(s.records.some((r) => r.type === 'exchange' && r.code), '生成带券码的兑换记录');
check((await page.textContent('#toastStack')).includes('券已发至麦当劳账户'), '提示券已发至麦当劳账户');
check(await page.isVisible('#couponModal'), '兑换成功弹窗出现');
await page.click('#couponModal .cta');
await page.waitForTimeout(400);

// --- 5. 奖励面板 ---
await page.click('#rewardsBtn');
await page.waitForTimeout(500);
check(await page.isVisible('#rewardsModal'), '奖励面板可打开');
check((await page.textContent('#recordsList')).includes('兑换'), '奖励面板显示兑换记录');
await page.screenshot({ path: path.join(SHOTS, '05-rewards.png') });
await page.click('#rewardsModal .modal-close');
await page.waitForTimeout(400);

// --- 6. 大奖 ---
await page.evaluate(() => window.__NUGGET_GAME__.forceJackpot());
await page.waitForSelector('#winModal', { state: 'visible', timeout: 15000 });
check(await page.isVisible('#winModal'), '大奖弹层出现');
s = await page.evaluate(() => window.__NUGGET_GAME__.state());
check(s.jackpotWon === true, '大奖状态已记录');
check(s.records.some((r) => r.type === 'jackpot'), '大奖记录已生成');
await page.screenshot({ path: path.join(SHOTS, '06-jackpot.png') });
await page.click('#winModal .cta-win');
await page.waitForTimeout(500);
check((await page.textContent('#jackpotChip')).includes('已中奖'), '大奖状态显示为已中奖');

// --- 6b. 大奖刷新 ---
await page.click('#rewardsBtn');
await page.waitForTimeout(350);
check(await page.isVisible('#refreshJackpotBtn'), '中奖后奖励页出现「刷新大奖」按钮');
await page.click('#refreshJackpotBtn');
await page.waitForTimeout(450);
s = await page.evaluate(() => window.__NUGGET_GAME__.state());
const refreshedBox = await page.evaluate(() => {
  const w = window.__NUGGET_GAME__.world;
  return { visible: w.jackpotGroup.visible, fallen: w.physics.box.fallen };
});
check(s.jackpotWon === false, '刷新后大奖状态复位');
check(refreshedBox.visible && !refreshedBox.fallen, '刷新后新的大奖盒回到机台');
check((await page.textContent('#jackpotChip')).includes('待命'), '刷新后顶栏状态恢复为待命');
await page.click('#rewardsModal .modal-close');
await page.waitForTimeout(300);

// --- 7. 余额不足提示 ---
await page.evaluate(() => {
  const g = window.__NUGGET_GAME__;
  g.store.state.virtualCoins = 0;
  g.store.emit({ type: 'debug' });
});
await page.click('#insertBtn');
await page.waitForTimeout(300);
check(await page.isVisible('#noCoinModal'), '代币不足时弹窗提示');
check((await page.textContent('#noCoinModal')).includes('积分不足，请先去兑换代币'), '弹窗文案明确');
await page.click('#noCoinModal [data-close]');
await page.waitForTimeout(250);

// --- 8. 移动端布局 ---
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await mobile.newPage();
await mp.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle' });
await mp.waitForTimeout(3500);
check(await mp.isVisible('#buyBtn'), '移动端购买按钮可见');
check(await mp.isVisible('#insertBtn'), '移动端投币按钮可见');
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, `移动端无横向溢出（${overflow}px）`);
await mp.screenshot({ path: path.join(SHOTS, '07-mobile.png') });

console.log('page errors:', errors);
check(errors.length === 0, '无页面 JS / 资源错误');

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} 项失败：`);
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('\nALL E2E CHECKS PASSED');
