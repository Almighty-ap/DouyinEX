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
/* 画面内的推广 / 短触卡片（右下角游戏链接、活动卡片等），部分由 iframe 容器渲染 */
#EcmoCardLayout,
#ShortTouchLayout,
#__living_right_panel_id,
iframe[data-container-id^="@annie/"],
.tab-microgame,
.douyin-player-controls > :not(.douyin-player-controls-inner) { display: none !important; }
`;

const HIDE_GIFT_BAR_CSS = `
#BottomLayout,
[data-e2e="gifts-container"],
#giftPanelEntrance,
[data-e2e="recharge-btn"],
.douyin-player-controls > :not(.douyin-player-controls-inner) { display: none !important; }
`;

/** 同步时间按钮：紧贴原生「刷新」右侧，样式与原生控制栏图标保持一致 */
const SYNC_TIME_CSS = `
.dyex-sync-time {
  position: relative;
  width: 32px;
  height: 32px;
  margin-left: 8px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: .88;
  /* 原生控制栏整体为 pointer-events:none，交互项各自置为 auto */
  pointer-events: auto;
  transition: opacity .15s, transform .1s;
  -webkit-tap-highlight-color: transparent;
}
.dyex-sync-time:hover { opacity: 1; }
.dyex-sync-time:active { transform: scale(.9); }
.dyex-sync-time svg { width: 22px; height: 22px; display: block; }
.dyex-sync-time::after {
  content: "同步时间";
  position: absolute;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, .78);
  color: #fff;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s;
}
.dyex-sync-time:hover::after { opacity: 1; }
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

let softFullActive = false;
/** 播放器原型上未被软全屏包装的原生 requestFullscreen，用于有手势时把软全屏升级为真全屏 */
let nativeRequestFull = null;

function getPlayerProxy() {
  const doc = win.document || document;
  const el = doc.querySelector(".douyin-player");
  if (!el) return null;
  const raw = el.wrappedJSObject || el;
  return raw._player?.proxy || null;
}

/**
 * 抖音完全全屏（H）底层依赖 player._player.proxy.requestFullscreen()。
 * 在进房自动触发（无用户手势）时，浏览器原生 Element.requestFullscreen() 会被拦截，
 * 而抖音内部直接吞掉了 reject 导致毫无反应。
 * 这里对播放器原型挂载软全屏兜底：
 * - 若有手势（如面板内点击勾选），直接进入浏览器原生全屏；
 * - 若无手势被浏览器拦截，自动置位 softFullActive 并派发 fullscreenchange(true)，
 *   使抖音直播间立即进入铺满视口的完全全屏态（顶栏/左栏收起、按钮变为「退出全屏 H」、评论区自动折叠）；
 * - 点击「退出全屏」、按 H 或按 Esc 时均能正常退出并还原。
 */
function ensurePlayerFullPatch() {
  const proxy = getPlayerProxy();
  if (!proxy) return null;
  const proto = Object.getPrototypeOf(proxy);
  if (!proto || proto.__dyexFullPatched) return proxy;

  const origDesc = Object.getOwnPropertyDescriptor(proto, "fullscreen");
  const origReq = proto.requestFullscreen;
  const origExit = proto.exitFullscreen;

  try {
    Object.defineProperty(proto, "fullscreen", {
      configurable: true,
      get() {
        if (softFullActive) return true;
        return origDesc?.get ? origDesc.get.call(this) : !!(document.fullscreenElement || document.webkitFullscreenElement);
      },
    });
  } catch (_) {}

  if (typeof origReq === "function") {
    nativeRequestFull = origReq;
    proto.requestFullscreen = function (...args) {
      const p = origReq.apply(this, args);
      if (p && typeof p.then === "function") {
        return p.then((res) => {
          if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            softFullActive = true;
            try {
              this.emit("fullscreenchange", true);
            } catch (_) {}
          } else {
            softFullActive = false;
          }
          return res;
        });
      }
      return p;
    };
  }

  if (typeof origExit === "function") {
    proto.exitFullscreen = function (...args) {
      if (softFullActive) {
        softFullActive = false;
        try {
          this.emit("fullscreenchange", false);
        } catch (_) {}
      }
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        return origExit.apply(this, args);
      }
      return Promise.resolve();
    };
  }

  proto.__dyexFullPatched = true;
  return proxy;
}

/** 通过 tooltip 文案查找「网页全屏」按钮（原生类名带哈希，文案更稳定） */
function findWebFullButton(wantExit = false) {
  const pattern = wantExit ? /^退出网页全屏$/ : /^网页全屏$/;
  const tips = Array.from(document.querySelectorAll(".douyin-player *")).filter(
    (el) => el.children.length === 0 && pattern.test(el.textContent.trim())
  );
  const tip = tips[0];
  if (!tip) return null;
  const slot = tip.closest("slot") || tip.parentElement?.parentElement?.parentElement;
  const svgIcon = slot ? slot.querySelector("svg")?.parentElement : null;
  return svgIcon || tip.closest("div[class*='douyin-player'], div");
}

/**
 * 查找「进入全屏」按钮。
 * 注意：抖音 .douyin-player-fullscreen 的 React onClick 绑定在 <svg> 自身而非外层 div，
 * 且 SVGElement 没有原生 .click()，触发时必须对 svg 派发冒泡 MouseEvent("click")。
 */
function findFullButton() {
  if (isNativeFullscreen()) return null;
  const root = document.querySelector(".douyin-player-fullscreen");
  if (root) {
    const pop = root.querySelector(".douyin-player-popup");
    if (pop && pop.textContent.includes("退出全屏")) return null;
    return root.querySelector("svg") || root.querySelector(".douyin-player-icon") || root;
  }
  const tips = Array.from(document.querySelectorAll(".douyin-player *")).filter(
    (el) => el.children.length === 0 && /^(进入)?全屏(\s*\(H\))?$/i.test(el.textContent.trim())
  );
  const tip = tips[0];
  if (!tip) return null;
  const slot = tip.closest("slot") || tip.parentElement?.parentElement?.parentElement;
  return (slot && slot.querySelector("svg")) || tip.closest("div[class*='douyin-player'], div");
}

function triggerClick(el) {
  if (!el) return false;
  try {
    el.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: win,
      })
    );
    return true;
  } catch (_) {
    if (typeof el.click === "function") {
      el.click();
      return true;
    }
  }
  return false;
}

export function isNativeFullscreen() {
  if (softFullActive) return true;
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

export function isChatFolded() {
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

/** 点原生「折叠评论区」按钮（不带全屏/开关前置条件）；返回是否确实折叠上了 */
async function clickFoldChatBtn() {
  for (let i = 0; i < 5; i++) {
    if (isChatFolded()) return true;
    const btn = findFoldChatBtn();
    if (btn) {
      btn.click();
      chatFoldedByUs = true;
      await sleep(250);
      if (isChatFolded()) return true;
    }
    await sleep(200);
  }
  return false;
}

async function foldChatWithRetry() {
  if (!isFullMode() || !getSettings().fullscreenFoldChat) return;
  await clickFoldChatBtn();
}

/**
 * 临时展开评论区，返回一个「折回去」的还原函数。
 * 完全全屏下抖音会把整个评论区卸载（`#chatroom` display: none），聊天输入框随之不可用，
 * 画面弹幕的 `+1` 就发不出去——这时先展开、发完再还原成折叠态（见 Chat/send.js）。
 * 评论区本来就展开、或找不到展开按钮时返回 null。
 */
export async function ensureChatPanelOpen() {
  if (!isChatFolded()) return null;
  const btn = findUnfoldChatBtn();
  if (!btn) return null;
  btn.click();
  for (let i = 0; i < 10; i++) {
    await sleep(150);
    if (!isChatFolded()) break;
  }
  if (isChatFolded()) return null;
  return async () => {
    await clickFoldChatBtn();
  };
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

function applyHideGiftBarStyle() {
  const on = !!getSettings().hideGiftBar;
  injectStyle("dyex-hide-gift-bar", on ? HIDE_GIFT_BAR_CSS : "");
}

export function initHideGiftBar() {
  applyHideGiftBarStyle();
  onSettingChange((key) => {
    if (key === "hideGiftBar") applyHideGiftBarStyle();
  });
}

export function initFullscreenFoldChat() {
  if (window.__dyexFullChatTimer) clearInterval(window.__dyexFullChatTimer);
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
    if (isFullMode()) {
      if (val && !isChatFolded()) foldChatWithRetry();
      else if (!val) unfoldChatIfNeeded();
    }
  });
}

/**
 * 软全屏只是页面铺满视口，浏览器标签页/任务栏仍在。
 * 用户在软全屏期间的第一次可信点击/按键携带手势，此时可以真正调用原生全屏，把软全屏升级为真全屏。
 * 排除 Esc（退出软全屏）、H 与「退出全屏」按钮（用户本意是退出），避免请求与退出竞态。
 */
function upgradeSoftFull(e) {
  if (!softFullActive || !e.isTrusted || !nativeRequestFull) return;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  if (e.type === "keydown" && (e.key === "Escape" || /^h$/i.test(e.key))) return;
  if (e.target instanceof Element && e.target.closest(".douyin-player-fullscreen")) return;
  const proxy = getPlayerProxy();
  if (!proxy) return;
  try {
    const p = nativeRequestFull.call(proxy);
    if (p && typeof p.then === "function") {
      p.then(() => {
        if (document.fullscreenElement || document.webkitFullscreenElement) softFullActive = false;
      }).catch(() => {});
    }
  } catch (_) {}
}

function exitFullIfNeeded() {
  const proxy = ensurePlayerFullPatch();
  if (proxy && isNativeFullscreen() && typeof proxy.exitFullscreen === "function") {
    proxy.exitFullscreen();
    return;
  }
  if (softFullActive) {
    softFullActive = false;
  }
  if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
    document.exitFullscreen().catch(() => {});
  }
}

export async function autoWebFull(opts = {}) {
  if (isNativeFullscreen()) {
    exitFullIfNeeded();
  }
  if (opts.immediate) {
    const immediateBtn = findWebFullButton(false);
    if (immediateBtn) {
      immediateBtn.click();
      return true;
    }
  }
  const player = await waitFor(".douyin-player", 20000);
  if (!player || !getSettings().autoWebFull) return false;
  if (!opts.immediate) await sleep(1500);
  if (!getSettings().autoWebFull) return false;
  const btn = findWebFullButton(false);
  if (btn) {
    btn.click();
    return true;
  }
  return false;
}

async function waitUntil(fn, timeout = 15000, interval = 200) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(interval);
  }
  return false;
}

/** 单次尝试进入完全全屏：优先点原生按钮，找不到再直接调播放器 requestFullscreen */
async function tryEnterFull() {
  const proxy = ensurePlayerFullPatch();
  const btn = findFullButton();
  if (btn) triggerClick(btn);
  else if (proxy && typeof proxy.requestFullscreen === "function") proxy.requestFullscreen();
  await sleep(300);
  return isNativeFullscreen();
}

let fullGuardToken = 0;
let lastUserInputAt = 0;

/** 看门狗要区分「抖音自己退出」和「用户点按钮 / 按 H / 按 Esc 主动退出」，后者不能再拉回全屏 */
function recentUserInput(ms = 1500) {
  return Date.now() - lastUserInputAt < ms;
}

/**
 * 抖音的「网页全屏」插件（TheaterPlugin）是懒加载的，挂载时会按上次保存的开关状态恢复剧场模式，
 * 其 onSwitch 在 player.fullscreen 为真时会调用 exitFullscreen()，把刚进入的完全全屏立刻退掉
 * （实测约在进房 4~5 秒后发生）。所以：
 * 1. 先等网页全屏按钮出现（插件已挂载）再触发；
 * 2. 进入后开看门狗，数秒内若被意外退出且选项仍开启，则重试。
 */
export async function autoFull(opts = {}) {
  const token = ++fullGuardToken;
  const alive = () => token === fullGuardToken && !!getSettings().autoFull;

  if (isNativeFullscreen()) return true;

  if (opts.immediate) {
    if (await tryEnterFull()) {
      checkFullscreenChatFold();
      return true;
    }
  }

  if (!(await waitFor(".douyin-player", 20000)) || !alive()) return false;
  const pluginReady = () => !!(findWebFullButton(false) || findWebFullButton(true));
  await waitUntil(pluginReady, 15000);
  if (!opts.immediate) await sleep(800);

  let entered = false;
  for (let i = 0; i < 6 && alive(); i++) {
    if (isNativeFullscreen() || (await tryEnterFull())) {
      entered = true;
      break;
    }
    await sleep(400);
  }
  if (!entered) return false;
  checkFullscreenChatFold();

  // 看门狗：8 秒内被抖音自己退出全屏则重试（最多 3 次）
  let retries = 0;
  const guardEnd = Date.now() + 8000;
  while (Date.now() < guardEnd && alive()) {
    await sleep(300);
    if (isNativeFullscreen()) continue;
    if (recentUserInput()) break;
    if (retries >= 3) break;
    retries++;
    await sleep(600);
    if (!alive() || recentUserInput()) break;
    if (await tryEnterFull()) checkFullscreenChatFold();
  }
  return isNativeFullscreen();
}

let escBound = false;

export function initAutoFullMode() {
  if (!escBound) {
    escBound = true;
    for (const type of ["pointerdown", "keydown"]) {
      document.addEventListener(
        type,
        (e) => {
          if (e.isTrusted) lastUserInputAt = Date.now();
          upgradeSoftFull(e);
        },
        true
      );
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && softFullActive) {
        exitFullIfNeeded();
      }
    });
  }
  onSettingChange((key, val) => {
    if (key === "autoFull") {
      if (val) autoFull({ immediate: true });
      else if (!getSettings().autoWebFull) exitFullIfNeeded();
    } else if (key === "autoWebFull") {
      if (val) autoWebFull({ immediate: true });
      else {
        const exitBtn = findWebFullButton(true);
        if (exitBtn) exitBtn.click();
      }
    }
  });
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

/* ---------------- 同步时间：跳到直播最新画面 ----------------
 * 抖音现行播放器是 WebCodecs + MediaStream（video.srcObject），<video>.buffered 恒为空，
 * DouyuEx 的 currentTime = buffered.end(0) 无法复用；这里调用播放器原生 refresh()，
 * 与原生「刷新（R）」同源，重新拉流并从直播最新关键帧开始播放。
 */
const SYNC_ICON = `
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M938.1888 534.016h-80.7936c0.4096-7.3728 0.6144-14.6432 0.6144-22.016 0-218.624-176.8448-400.7936-389.12-400.7936C257.024 111.2064 80.6912 293.1712 80.6912 512c0 218.7264 176.4352 400.7936 388.1984 400.7936 74.752 0 149.0944-22.016 208.1792-60.0064l42.7008 68.608c-75.0592 48.9472-161.9968 74.8544-250.7776 74.752C209.8176 996.1472 0 779.264 0 512S209.8176 27.8528 468.8896 27.8528C728.3712 27.8528 938.7008 244.736 938.7008 512c0 7.3728-0.2048 14.6432-0.512 22.016z m-26.4192-158.1056L426.7008 556.032V291.9424h64v226.5088L689.5616 635.904l-38.912 58.7776z m245.3504-6.656L768 512h256L896 688.0256z" fill="#fff"/>
</svg>`;

/** 原生「刷新」是控制栏左侧第二个元素（含「刷新 / R」文案的 slot），同步按钮插到它右边 */
function findRefreshSlot(left) {
  if (!left) return null;
  const byText = Array.from(left.children).find((el) =>
    (el.textContent || "").trim().startsWith("刷新")
  );
  if (byText) return byText;
  // A/B 或文案变化时兜底：原生刷新通常是左侧第二个带图标的控件
  const second = left.children[1];
  return second && second.querySelector("svg") ? second : null;
}

function createSyncTimeButton() {
  const btn = document.createElement("div");
  btn.className = "dyex-sync-time";
  btn.setAttribute("role", "button");
  btn.setAttribute("aria-label", "同步时间");
  btn.innerHTML = SYNC_ICON;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    syncToLive();
  });
  return btn;
}

function ensureSyncTimeButton() {
  const left = document.querySelector(".douyin-player-controls-left");
  if (!left) return false;
  const slot = findRefreshSlot(left);
  if (!slot) return false;
  const existing = left.querySelector(".dyex-sync-time");
  if (existing) {
    // 原生重渲染可能改变顺序，保持在刷新右侧
    if (existing.previousElementSibling !== slot) slot.insertAdjacentElement("afterend", existing);
    return true;
  }
  slot.insertAdjacentElement("afterend", createSyncTimeButton());
  return true;
}

let lastSyncAt = 0;

function syncToLive() {
  if (Date.now() - lastSyncAt < 1500) return false;
  lastSyncAt = Date.now();

  const proxy = getPlayerProxy();
  if (proxy && typeof proxy.refresh === "function") {
    try {
      proxy.refresh();
      return true;
    } catch (_) {}
  }

  // 兜底 1：直接点原生刷新按钮（与 R 键同源）
  const slot = findRefreshSlot(document.querySelector(".douyin-player-controls-left"));
  const refreshIcon = slot && (slot.querySelector("svg") || slot);
  if (refreshIcon && triggerClick(refreshIcon)) return true;

  // 兜底 2：旧版 MSE 播放器仍可用 buffered 末端跳转
  const video = document.querySelector(".douyin-player video");
  if (video && video.buffered && video.buffered.length) {
    try {
      video.currentTime = video.buffered.end(video.buffered.length - 1);
      return true;
    } catch (_) {}
  }
  return false;
}

let syncTimer = null;

export function initSyncTime() {
  injectStyle("dyex-sync-time", SYNC_TIME_CSS);
  ensureSyncTimeButton();
  clearInterval(syncTimer);
  syncTimer = setInterval(ensureSyncTimeButton, 1200);
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
