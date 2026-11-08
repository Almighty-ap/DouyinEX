import css from "./Panel.css";
import { injectStyle } from "../../common/dom.js";
import { getSettings, setSetting } from "../../common/settings.js";
import { copyStream, getStreamMenuItems, autoHighestQuality } from "../Stream/Stream.js";
import { startLoop, stopLoop, isLoopRunning, onLoopState } from "../Chat/Loop.js";

const BALL_SVG = `<svg viewBox="0 0 108 108" xmlns="http://www.w3.org/2000/svg">
<circle cx="54" cy="54" r="50" fill="#16161a"/><path d="M54 6a48 48 0 0 0-48 48h30a18 18 0 0 1 36 0h30A48 48 0 0 0 54 6z" fill="#fe2c55"/>
<circle cx="54" cy="54" r="18" fill="#fff" stroke="#16161a" stroke-width="6"/></svg>`;

const CHECKS = [
  ["autoQuality", "自动最高画质"],
  ["autoWebFull", "进房自动网页全屏"],
  ["wheelVolume", "播放器内滚轮调音量"],
  ["simpleMode", "简洁模式（隐藏横幅/小黄车/榜单入口）"],
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
  ${CHECKS.slice(0, 4).map(([k, l]) => checkRow(k, l)).join("")}
  <h4>弹幕（画面上漂浮的弹幕）</h4>
  ${CHECKS.slice(4).map(([k, l]) => checkRow(k, l)).join("")}
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

export function initPanel() {
  injectStyle("dyex-style", css);

  const ball = document.createElement("div");
  ball.id = "dyex-ball";
  ball.title = "DouyinEX";
  ball.innerHTML = BALL_SVG;

  const panel = document.createElement("div");
  panel.id = "dyex-panel";
  panel.innerHTML = buildHtml();

  document.body.append(ball, panel);
  syncInputs(panel);

  const toggle = () => {
    const open = panel.classList.toggle("is-open");
    if (open) {
      syncInputs(panel);
      renderStreamButtons(panel);
    }
  };
  ball.addEventListener("click", toggle);
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
  });

  const loopBtn = panel.querySelector("#dyex-loop-toggle");
  loopBtn.addEventListener("click", () => (isLoopRunning() ? stopLoop() : startLoop()));
  onLoopState((on) => (loopBtn.textContent = on ? "停止发送" : "开始发送"));

  panel.querySelector("#dyex-quality-now").addEventListener("click", () => autoHighestQuality());

  return { toggle };
}
