import { waitFor, injectStyle, sleep } from "../../common/dom.js";
import { getSettings, setSetting, onSettingChange } from "../../common/settings.js";
import { win } from "../../common/env.js";

const SIMPLE_CSS = `
[data-e2e="exhibition-banner"],
[data-e2e="yellowCart-container"],
[data-e2e*="cart" i],
[data-e2e="hour-rank-entrance"],
#GiftTrayLayout,
#GiftEffectLayout,
.GiftTrayPlugin,
.GiftEffectPlugin,
.douyin-player-controls > :not(.douyin-player-controls-inner) { display: none !important; }
`;

const FULLSCREEN_CLEAN_CSS = `
.douyin-player-controls > :not(.douyin-player-controls-inner),
.douyin-player-controls [data-e2e="gifts-container"],
.douyin-player-controls #giftPanelEntrance,
.douyin-player-controls [data-e2e="recharge-btn"] { display: none !important; }
`;

/** 小黄车在播放器工具条里是动态挂载的，data-e2e 也可能随 A/B 变化，
 *  所以除了 CSS 再按文案兜底隐藏一遍 */
const hiddenCart = new Set();

function hideCartNodes() {
  if (!getSettings().simpleMode) return;
  document.querySelectorAll('[data-e2e="yellowCart-container"], [data-e2e*="cart" i]').forEach((el) => {
    if (el.style.display !== "none") el.style.display = "none";
    hiddenCart.add(el);
  });
  document.querySelectorAll('.douyin-player [class*="ToolbarPlugin"] > div').forEach((item) => {
    if (item.textContent.includes("全部商品") && item.style.display !== "none") {
      item.style.display = "none";
      hiddenCart.add(item);
    }
  });
}

/** 关闭简洁模式时把内联样式还原（CSS 规则同时会被清空） */
function unhideCartNodes() {
  hiddenCart.forEach((el) => {
    el.style.display = "";
  });
  hiddenCart.clear();
}

let cartTimer = null;
function syncCartHider() {
  clearInterval(cartTimer);
  if (!getSettings().simpleMode) {
    unhideCartNodes();
    return;
  }
  hideCartNodes();
  cartTimer = setInterval(hideCartNodes, 1200);
}

function findPlayer() {
  return document.querySelector(".douyin-player");
}

/** 通过 tooltip 文案查找「网页全屏」按钮（原生类名带哈希，文案更稳定） */
function findWebFullButton() {
  const tips = Array.from(document.querySelectorAll(".douyin-player *")).filter(
    (el) => el.children.length === 0 && /^网页全屏$/.test(el.textContent.trim())
  );
  const tip = tips[0];
  if (!tip) return null;
  const slot = tip.closest("slot") || tip.parentElement?.parentElement?.parentElement;
  const svgIcon = slot ? slot.querySelector("svg")?.parentElement : null;
  return svgIcon || tip.closest("div[class*='douyin-player'], div");
}

export function isNativeFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) return true;
  // 注意：不要用 living-container 的 __roomInfoBarInner 判断全屏。
  // 抖音在竖屏直播（stream_orientation=1）、已结束/无流房间也会常驻这个类，
  // 一旦误判会让悬浮球被全屏自动隐藏逻辑永久置为 is-hidden。
  const tip = document.querySelector(".douyin-player-fullscreen .douyin-player-popup");
  if (tip && tip.textContent.includes("退出全屏")) return true;
  return false;
}

export function isFullMode() {
  return isNativeFullscreen();
}

function isChatFolded() {
  if (document.querySelector('.chat_room_fold, [class*="chat_room_fold"]')) return true;
  const rightBg =
    document.getElementById("RightBackgroundLayout") || document.getElementById("chatroom");
  if (!rightBg) return false;
  return rightBg.getBoundingClientRect().width < 20;
}

function findFoldChatBtn() {
  const direct = document.querySelector("#RightBackgroundLayout .KH9DQgyz, #chatroom .KH9DQgyz");
  if (direct) return direct;
  const aud = document.querySelector(
    '#RightBackgroundLayout [data-e2e="live-room-audience"], #chatroom [data-e2e="live-room-audience"]'
  );
  if (aud && aud.parentElement) {
    const firstSvgBox = Array.from(aud.parentElement.children).find((el) => el.querySelector("svg"));
    if (firstSvgBox) return firstSvgBox;
  }
  return null;
}

function findUnfoldChatBtn() {
  const foldBox = document.querySelector('.chat_room_fold, [class*="chat_room_fold"]');
  if (!foldBox) return null;
  return foldBox.querySelector("svg")?.parentElement || foldBox;
}

let chatFoldedByUs = false;
let lastFullState = false;

async function foldChatWithRetry() {
  for (let i = 0; i < 5; i++) {
    if (!isFullMode() || !getSettings().fullscreenFoldChat) return;
    if (isChatFolded()) return;
    const btn = findFoldChatBtn();
    if (btn) {
      btn.click();
      chatFoldedByUs = true;
      await sleep(250);
      if (isChatFolded()) return;
    }
    await sleep(200);
  }
}

async function unfoldChatIfNeeded() {
  if (!chatFoldedByUs) return;
  chatFoldedByUs = false;
  for (let i = 0; i < 4; i++) {
    if (!isChatFolded()) return;
    const btn = findUnfoldChatBtn();
    if (btn) {
      btn.click();
      await sleep(250);
      if (!isChatFolded()) return;
    }
    await sleep(200);
  }
}

function checkFullscreenChatFold() {
  const nowFull = isFullMode();
  if (nowFull && !lastFullState) {
    lastFullState = true;
    if (getSettings().fullscreenFoldChat && !isChatFolded()) {
      foldChatWithRetry();
    }
  } else if (!nowFull && lastFullState) {
    lastFullState = false;
    unfoldChatIfNeeded();
  }
}

let fullChatTimer = null;

function applyFullscreenCleanStyle() {
  const on = !!getSettings().fullscreenFoldChat;
  injectStyle("dyex-fullscreen-clean", on ? FULLSCREEN_CLEAN_CSS : "");
}

export function initFullscreenFoldChat() {
  if (window.__dyexFullChatTimer) clearInterval(window.__dyexFullChatTimer);
  applyFullscreenCleanStyle();
  lastFullState = isFullMode();
  if (lastFullState && getSettings().fullscreenFoldChat && !isChatFolded()) {
    foldChatWithRetry();
  }
  document.addEventListener("fullscreenchange", checkFullscreenChatFold);
  document.addEventListener("webkitfullscreenchange", checkFullscreenChatFold);
  fullChatTimer = setInterval(checkFullscreenChatFold, 500);
  window.__dyexFullChatTimer = fullChatTimer;

  onSettingChange((key, val) => {
    if (key !== "fullscreenFoldChat") return;
    applyFullscreenCleanStyle();
    if (isFullMode()) {
      if (val && !isChatFolded()) foldChatWithRetry();
      else if (!val) unfoldChatIfNeeded();
    }
  });
}

export async function autoWebFull() {
  const player = await waitFor(".douyin-player", 20000);
  if (!player) return false;
  await sleep(1500);
  const btn = findWebFullButton();
  if (btn) {
    btn.click();
    return true;
  }
  return false;
}

let wheelBound = false;
function onWheel(e) {
  if (!getSettings().wheelVolume) return;
  const player = findPlayer();
  const video = document.querySelector(".douyin-player video");
  if (!player || !video || !player.contains(e.target)) return;
  e.preventDefault();
  const step = e.deltaY < 0 ? 0.05 : -0.05;
  video.muted = false;
  video.volume = Math.min(1, Math.max(0, Math.round((video.volume + step) * 100) / 100));
}

export function initWheelVolume() {
  if (wheelBound) return;
  wheelBound = true;
  document.addEventListener("wheel", onWheel, { passive: false, capture: true });
}

/* ---------------- 简洁模式：同步抖音自己的弹幕/礼物开关 ----------------
 * 送礼信息、福袋口令在「弹幕设置」浮层里，屏蔽礼物特效在「礼物设置」浮层里。
 * 两个浮层都是悬停打开、离开关闭，且开关是自绘 div（类名带构建哈希），
 * 因此用 hover 打开浮层 + 背景色判断开/关。
 */
const DANMAKU_ICON = '[data-e2e="danmaku-setting-icon"]';
const GIFT_ICON = '[data-e2e="gift-setting"]';
const ON_COLOR = "rgb(254, 44, 85)"; // 开关打开时的品牌红；关闭为 rgba(255,255,255,.34)

function hover(el, type) {
  const isEnter = type === "mouseover";
  // 同 Lottery：油猴沙箱里必须用 unsafeWindow（win），否则 PointerEvent 构造会抛错，
  // 而且这里没有外层 catch，会变成 Uncaught (in promise)。
  const fire = (Ctor, eventType, opts) => {
    try {
      el.dispatchEvent(new Ctor(eventType, opts));
    } catch (_) {}
  };
  const base = { bubbles: true, cancelable: true, view: win };
  fire(PointerEvent, isEnter ? "pointerover" : "pointerout", base);
  fire(MouseEvent, type, base);
  fire(MouseEvent, isEnter ? "mouseenter" : "mouseleave", {
    bubbles: false,
    cancelable: false,
    view: win,
  });
}

async function withPopup(selector, fn) {
  const icon = await waitFor(selector, 10000);
  if (!icon) return null;
  hover(icon, "mouseover");
  await sleep(450);
  try {
    return await fn();
  } catch (e) {
    return null;
  } finally {
    hover(icon, "mouseout");
  }
}

const isOn = (sw) => !!sw && getComputedStyle(sw).backgroundColor === ON_COLOR;

function danmakuRow(text) {
  const label = Array.from(document.querySelectorAll("span")).find(
    (e) => e.children.length === 0 && e.textContent.trim() === text
  );
  return label ? label.parentElement : null;
}

function danmakuSwitch(text) {
  const row = danmakuRow(text);
  return row && row.children[1] ? row.children[1].firstElementChild : null;
}

async function waitForDanmakuSwitch(text, timeout = 2000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const sw = danmakuSwitch(text);
    if (sw) return sw;
    await sleep(100);
  }
  return null;
}

async function setSwitch(sw, want) {
  if (!sw) return null;
  const before = isOn(sw);
  if (before !== want) {
    sw.click();
    await sleep(400);
  }
  return { before, after: isOn(sw) };
}

/** 一次性设置「送礼信息 / 福袋口令」；传 null 表示该项不处理；返回点击前后的状态 */
async function applyDanmakuSwitches(wantGift, wantLucky) {
  const only = async (text, want) =>
    want === null || want === undefined ? null : setSwitch(await waitForDanmakuSwitch(text), want);
  return withPopup(DANMAKU_ICON, async () => ({
    gift: await only("送礼信息", wantGift),
    lucky: await only("福袋口令", wantLucky),
  }));
}

/** 设置「屏蔽礼物特效」 */
async function applyEffectSwitch(want) {
  return withPopup(GIFT_ICON, async () =>
    setSwitch(await waitFor('[data-e2e="effect-switch"] > div', 2000, 100), want)
  );
}

let simpleBusy = false;

async function syncSimpleSwitches() {
  if (simpleBusy || !getSettings().simpleMode) return;
  if (!(await waitFor(DANMAKU_ICON, 15000))) return;
  simpleBusy = true;
  try {
    const dm = await applyDanmakuSwitches(false, false);
    const fx = await applyEffectSwitch(true);
    const changed =
      (dm && ((dm.gift && dm.gift.before !== dm.gift.after) || (dm.lucky && dm.lucky.before !== dm.lucky.after))) ||
      (fx && fx.before !== fx.after);
    // 只在真的改动了、且还没记录过原始值时存一份，供关闭简洁模式时还原
    if (changed && !getSettings().simpleRestore) {
      setSetting("simpleRestore", {
        gift: dm && dm.gift ? dm.gift.before : null,
        lucky: dm && dm.lucky ? dm.lucky.before : null,
        effect: fx ? fx.before : null,
      });
    }
  } finally {
    simpleBusy = false;
  }
}

async function restoreSimpleSwitches() {
  const prev = getSettings().simpleRestore;
  if (!prev) return;
  if (!(await waitFor(DANMAKU_ICON, 15000))) return;
  await applyDanmakuSwitches(prev.gift, prev.lucky);
  if (prev.effect !== null && prev.effect !== undefined) await applyEffectSwitch(!!prev.effect);
  setSetting("simpleRestore", null);
}

function applySimpleMode() {
  const on = getSettings().simpleMode;
  injectStyle("dyex-simple-mode", on ? SIMPLE_CSS : "");
  syncCartHider();
  if (on) syncSimpleSwitches();
  else restoreSimpleSwitches();
}

export function initSimpleMode() {
  applySimpleMode();
  onSettingChange((key) => {
    if (key === "simpleMode") applySimpleMode();
  });
}
