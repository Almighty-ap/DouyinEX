import css from "./Panel.css";
import { injectStyle } from "../../common/dom.js";
import { getSettings, setSetting, onSettingChange } from "../../common/settings.js";
import { copyStream, getStreamMenuItems, autoHighestQuality } from "../Stream/Stream.js";
import { startLoop, stopLoop, isLoopRunning, onLoopState } from "../Chat/Loop.js";
import { isFullMode } from "../Player/Player.js";

const BALL_SVG = `<svg viewBox="0 0 108 108" xmlns="http://www.w3.org/2000/svg">
<circle cx="54" cy="54" r="50" fill="#16161a"/><path d="M54 6a48 48 0 0 0-48 48h30a18 18 0 0 1 36 0h30A48 48 0 0 0 54 6z" fill="#fe2c55"/>
<circle cx="54" cy="54" r="18" fill="#fff" stroke="#16161a" stroke-width="6"/></svg>`;

const CHECKS = [
  ["autoQuality", "自动最高画质"],
  ["autoWebFull", "进房自动网页全屏"],
  ["autoFull", "进房自动完全全屏"],
  ["fullscreenFoldChat", "全屏时自动折叠评论区"],
  ["hideGiftBar", "隐藏底部礼物栏"],
  ["wheelVolume", "播放器内滚轮调音量"],
  ["simpleMode", "简洁模式（隐藏横幅/小黄车/榜单入口）"],
  ["autoLottery", "自动抢免费福袋（评论/无门槛/看播达标，跳过付费粉丝团）"],
  ["autoLotteryFollow", "抢福袋时允许自动关注主播"],
  ["danmakuTakeover", "接管悬浮弹幕（画面弹幕 +1 与屏蔽）"],
  ["plus1", "弹幕 +1（悬停显示）"],
  ["shieldEnter", "屏蔽进场消息"],
  ["shieldRepeat", "屏蔽重复弹幕（10 秒内）"],
];

function checkRow(key, label) {
  return `<label><input type="checkbox" data-key="${key}"> ${label}</label>`;
}

function buildHtml() {
  return `
  <h4>直播流</h4>
  <div class="dyex-row" id="dyex-stream-btns"></div>
  <div class="dyex-tip">点击复制地址，可用 PotPlayer / VLC 打开</div>
  <h4>播放与界面</h4>
  ${CHECKS.slice(0, 9).map(([k, l]) => checkRow(k, l)).join("")}
  <h4>弹幕（画面上漂浮的弹幕）</h4>
  ${CHECKS.slice(9).map(([k, l]) => checkRow(k, l)).join("")}
  <div class="dyex-row">屏蔽等级低于
    <input type="number" min="0" max="80" data-key="shieldLevelBelow" data-num="1"> 的用户（0=不限）
  </div>
  <div class="dyex-tip">关键词屏蔽（一行一条，/正则/ 亦可）</div>
  <textarea data-key="shieldKeywords" placeholder="例如：刷屏&#10;/^6{3,}$/"></textarea>
  <div class="dyex-tip">以下屏蔽同时作用于画面悬浮弹幕与右侧聊天列表</div>
  <h4>循环发送弹幕（需登录）</h4>
  <textarea data-key="loopTexts" placeholder="一行一条"></textarea>
  <div class="dyex-row">间隔
    <input type="number" min="1000" step="500" data-key="loopMin" data-num="1">~
    <input type="number" min="1000" step="500" data-key="loopMax" data-num="1"> ms
  </div>
  <div class="dyex-row">限时 <input type="number" min="1" data-key="loopLimitMin" data-num="1"> 分钟
    <label><input type="checkbox" data-key="loopRandom"> 随机</label>
  </div>
  <div class="dyex-row"><button id="dyex-loop-toggle">开始发送</button>
    <button class="is-secondary" id="dyex-quality-now">立即切最高画质</button></div>`;
}

function syncInputs(panel) {
  const s = getSettings();
  panel.querySelectorAll("[data-key]").forEach((el) => {
    const v = s[el.dataset.key];
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  });
}

function renderStreamButtons(panel) {
  const box = panel.querySelector("#dyex-stream-btns");
  const items = getStreamMenuItems();
  if (!items.length) {
    box.innerHTML = '<span class="dyex-tip">暂未获取到流地址（未开播或数据未就绪）</span>';
    return;
  }
  box.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it.label;
    b.addEventListener("click", () => copyStream(it.type, it.quality));
    box.appendChild(b);
  }
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), Math.max(min, max));
}

function positionPanel(ball, panel) {
  if (!panel.classList.contains("is-open")) return;
  const br = ball.getBoundingClientRect();
  if (br.width === 0 && br.height === 0) return;
  const pw = panel.offsetWidth || 340;
  const ph = panel.offsetHeight || 420;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const placeLeft = br.left + br.width / 2 > vw / 2;
  const left = placeLeft
    ? clamp(br.left - pw - 10, 8, vw - pw - 8)
    : clamp(br.right + 10, 8, vw - pw - 8);
  const top = clamp(br.bottom - ph, 8, vh - ph - 8);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function applySavedBallPos(ball, panel) {
  const pos = getSettings().ballPos;
  if (!pos || typeof pos.left !== "number" || typeof pos.top !== "number") return;
  const bw = ball.offsetWidth || 40;
  const bh = ball.offsetHeight || 40;
  const left = clamp(pos.left, 8, window.innerWidth - bw - 8);
  const top = clamp(pos.top, 8, window.innerHeight - bh - 8);
  ball.style.left = `${Math.round(left)}px`;
  ball.style.top = `${Math.round(top)}px`;
  ball.style.right = "auto";
  ball.style.bottom = "auto";
  positionPanel(ball, panel);
}

function enableBallDrag(ball, panel, onToggle) {
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let pointerId = null;
  let dragging = false;

  ball.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = ball.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = r.left;
    startTop = r.top;
    pointerId = e.pointerId;
    dragging = false;
    try {
      ball.setPointerCapture(e.pointerId);
    } catch (_) {}
  });

  ball.addEventListener("pointermove", (e) => {
    if (pointerId !== e.pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 4) {
      dragging = true;
      ball.classList.add("is-dragging");
    }
    if (!dragging) return;
    const bw = ball.offsetWidth || 40;
    const bh = ball.offsetHeight || 40;
    const left = clamp(startLeft + dx, 8, window.innerWidth - bw - 8);
    const top = clamp(startTop + dy, 8, window.innerHeight - bh - 8);
    ball.style.left = `${Math.round(left)}px`;
    ball.style.top = `${Math.round(top)}px`;
    ball.style.right = "auto";
    ball.style.bottom = "auto";
    positionPanel(ball, panel);
  });

  const finishPointer = (e) => {
    if (pointerId !== e.pointerId) return;
    try {
      ball.releasePointerCapture(e.pointerId);
    } catch (_) {}
    pointerId = null;
    if (dragging) {
      ball.classList.remove("is-dragging");
      const r = ball.getBoundingClientRect();
      setSetting("ballPos", { left: Math.round(r.left), top: Math.round(r.top) });
      dragging = false;
    } else {
      onToggle();
    }
  };

  ball.addEventListener("pointerup", finishPointer);
  ball.addEventListener("pointercancel", (e) => {
    if (pointerId !== e.pointerId) return;
    pointerId = null;
    dragging = false;
    ball.classList.remove("is-dragging");
  });
}

function initFullscreenAutoHide(ball, panel) {
  let wasFull = isFullMode();

  const updateVisibility = () => {
    if (!ball.isConnected) return;
    const nowFull = isFullMode();
    if (nowFull && !wasFull) {
      panel.classList.remove("is-open");
    }
    wasFull = nowFull;

    // 进入全屏（H）沉浸式观看时自动收起面板并隐藏悬浮球，退出全屏后恢复显示
    if (nowFull) {
      panel.classList.remove("is-open");
      ball.classList.add("is-hidden");
    } else {
      ball.classList.remove("is-hidden");
    }
  };

  document.addEventListener("fullscreenchange", updateVisibility);
  document.addEventListener("webkitfullscreenchange", updateVisibility);
  const lc = document.querySelector('[data-e2e="living-container"]') || document.body;
  const obs = new MutationObserver(updateVisibility);
  obs.observe(lc, { attributes: true, attributeFilter: ["class"] });
  setInterval(updateVisibility, 400);
  updateVisibility();
}

export function initPanel() {
  document.getElementById("dyex-ball")?.remove();
  document.getElementById("dyex-panel")?.remove();
  injectStyle("dyex-style", css);

  const ball = document.createElement("div");
  ball.id = "dyex-ball";
  ball.title = "DouyinEX（可拖拽移动）";
  ball.innerHTML = BALL_SVG;

  const panel = document.createElement("div");
  panel.id = "dyex-panel";
  panel.innerHTML = buildHtml();

  document.body.append(ball, panel);
  syncInputs(panel);
  applySavedBallPos(ball, panel);

  const toggle = () => {
    const open = panel.classList.toggle("is-open");
    if (open) {
      syncInputs(panel);
      renderStreamButtons(panel);
      positionPanel(ball, panel);
    }
  };

  enableBallDrag(ball, panel, toggle);
  initFullscreenAutoHide(ball, panel);

  window.addEventListener("resize", () => {
    applySavedBallPos(ball, panel);
    positionPanel(ball, panel);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") panel.classList.remove("is-open");
  });

  panel.addEventListener("change", (e) => {
    const el = e.target;
    const key = el.dataset && el.dataset.key;
    if (!key) return;
    if (el.type === "checkbox") setSetting(key, el.checked);
    else if (el.dataset.num) setSetting(key, Number(el.value) || 0);
    else setSetting(key, el.value);
    syncInputs(panel);
  });

  onSettingChange((key) => {
    if (key === "autoFull" || key === "autoWebFull") {
      syncInputs(panel);
    }
  });

  const loopBtn = panel.querySelector("#dyex-loop-toggle");
  loopBtn.addEventListener("click", () => (isLoopRunning() ? stopLoop() : startLoop()));
  onLoopState((on) => (loopBtn.textContent = on ? "停止发送" : "开始发送"));

  panel.querySelector("#dyex-quality-now").addEventListener("click", () => autoHighestQuality());

  return { toggle };
}
