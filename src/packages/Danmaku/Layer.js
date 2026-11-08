import { win } from "../../common/env.js";
import { getSettings, onSettingChange } from "../../common/settings.js";
import { parseKeywords, matchKeywords, createRepeatFilter } from "../../lib/filter.js";
import { extractBarrage } from "../../lib/barrage.js";
import { sendChat } from "../Chat/send.js";
import { toast } from "../../common/dom.js";

/**
 * 悬浮弹幕层接管。
 *
 * 抖音的悬浮弹幕是 canvas + Worker 绘制的，没有 DOM 节点，也就没有命中测试，
 * 无法直接在弹幕上挂 +1 按钮，也无法按条隐藏。这里改成：
 *   1. 包装弹幕插件的 send(payload)，在入绘制队列前截下每条弹幕；
 *   2. 过滤命中屏蔽规则的直接丢弃；
 *   3. 其余的用 DOM 自己渲染成悬浮弹幕，悬停出现 +1 按钮。
 * 非文字内容（纯图片 / 礼物流水）原样交回原生 canvas 渲染，保证礼物信息不丢。
 */

const LAYER_ID = "dyex-dm-layer";
const ITEM_CLS = "dyex-dm-item";
const PLUS_CLS = "dyex-dm-plus1";
const PLUGIN = ".CanvasDanmakuPlugin";
const MAX_ITEMS = 80;

let hookedInst = null;
let hookedBus = null;
let cfg = { fontSize: 20, speed: 14400, opacity: 0.8, area: { start: 0.01, end: 0.5 } };
const users = new Map(); // msg_id -> { level, nickname }
const isRepeat = createRepeatFilter(10000);
let rules = [];
let rulesRaw = null;
let lanes = [];
let laneKey = "";

function refreshRules() {
  const raw = getSettings().shieldKeywords;
  if (raw !== rulesRaw) {
    rulesRaw = raw;
    rules = parseKeywords(raw);
  }
}

/** 弹幕插件是 React 组件，从 DOM 反查 fiber 拿到插件实例与绘制配置 */
function findComponent() {
  const el = document.querySelector(PLUGIN);
  if (!el) return null;
  const key = Object.keys(el).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
  );
  if (!key) return null;
  let fiber = el[key];
  for (let i = 0; i < 6 && fiber; i++) {
    const props = fiber.memoizedProps;
    if (props && props.store && props.player) return fiber;
    fiber = fiber.return;
  }
  return null;
}

function readPluginState(fiber) {
  let inst = null;
  let config = null;
  let hook = fiber.memoizedState;
  while (hook) {
    const st = hook.memoizedState;
    if (st && st.current && typeof st.current.send === "function" && st.current.danmakuManagerInMainThread) {
      inst = st.current;
    }
    if (st && typeof st === "object" && "fontSize" in st && "speed" in st) config = st;
    hook = hook.next;
  }
  return { inst, config };
}

/** 订阅 IM 消息，用 msg_id 反查发送者等级（悬浮弹幕 payload 本身不含用户信息） */
function hookBus() {
  const mi = win.__MESSAGE_INSTANCE__;
  if (!mi || typeof mi.on !== "function" || mi === hookedBus) return;
  hookedBus = mi;
  mi.on("ChatMessage", (msgs) => {
    for (const m of Array.isArray(msgs) ? msgs : [msgs]) {
      const u = m && m.payload && m.payload.user;
      if (u && m.msg_id) users.set(m.msg_id, { level: u.level, nickname: u.nickname });
    }
    while (users.size > 600) users.delete(users.keys().next().value);
  });
}

function hookSend(inst) {
  const orig = inst.send;
  inst.send = function (payload) {
    if (!getSettings().danmakuTakeover) return orig.call(this, payload);
    // 延迟到微任务：IM 的 ChatMessage 回调在本插件回调之后才轮到我们登记用户信息
    queueMicrotask(() => {
      let handled = false;
      try {
        handled = accept(payload);
      } catch (e) {
        handled = false;
      }
      if (!handled) {
        try {
          orig.call(inst, payload);
        } catch (e) {
          /* 插件已销毁 */
        }
      }
    });
  };
}

function shouldHide(text, level) {
  const s = getSettings();
  if (s.shieldLevelBelow > 0 && level !== null && Number.isFinite(level) && level < s.shieldLevelBelow) {
    return true;
  }
  if (rules.length && matchKeywords(text, rules)) return true;
  if (s.shieldRepeat && isRepeat(text)) return true;
  return false;
}

/**
 * 处理一条弹幕；返回 true 表示由我们接管（原生不再绘制）。
 * 纯图片/礼物流水没有正文，交回原生。
 */
function accept(payload) {
  if (!getSettings().danmakuTakeover) return false;
  const b = extractBarrage(payload);
  if (!b.text) return false;
  if (b.isGift) return !!getSettings().simpleMode;
  refreshRules();
  const u = users.get(b.id);
  const level = u ? Number(u.level) : null;
  if (!b.isSelf && shouldHide(b.text, level)) return true;
  renderItem(payload, b.content, b.text, b.isSelf);
  return true;
}

function ensureLayer() {
  const existing = document.getElementById(LAYER_ID);
  if (existing && existing.isConnected) return existing;
  const host = document.getElementById("DanmakuLayout") || document.querySelector(".douyin-player");
  if (!host) return null;
  const layer = document.createElement("div");
  layer.id = LAYER_ID;
  host.append(layer);
  laneKey = "";
  return layer;
}

function makePlusBtn(text) {
  const btn = document.createElement("span");
  btn.className = PLUS_CLS;
  btn.textContent = "+1";
  btn.title = "跟发这条弹幕";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await sendChat(text);
    if (!ok) toast("发送失败：请确认已登录抖音，且聊天输入框可用", "error");
  });
  return btn;
}

function renderItem(payload, parts, text, isSelf = false) {
  const layer = ensureLayer();
  if (!layer) return;
  if (layer.childElementCount >= MAX_ITEMS) layer.firstElementChild?.remove();

  const fontSize = Number(cfg.fontSize) || 20;
  const el = document.createElement("span");
  el.className = isSelf ? `${ITEM_CLS} is-self` : ITEM_CLS;
  el.style.fontSize = `${fontSize}px`;
  el.style.color = payload.color || "#fff";
  for (const p of parts) {
    if (p.type === "text" && p.text) el.append(document.createTextNode(p.text));
    else if (p.type === "image" && p.src) {
      const img = document.createElement("img");
      img.src = p.src;
      img.alt = "";
      el.append(img);
    }
  }
  if (getSettings().plus1) el.append(makePlusBtn(text));
  layer.append(el);

  const cw = layer.clientWidth || 1;
  const ch = layer.clientHeight || 1;
  const width = el.offsetWidth;
  const laneH = Math.round(fontSize * 1.5);
  const start = Math.max(0, (Number(cfg.area?.start) || 0.01) * ch);
  const end = Math.min(1, Number(cfg.area?.end) || 0.5) * ch;
  const laneCount = Math.max(1, Math.floor((end - start) / laneH));

  const key = `${cw}x${ch}x${fontSize}`;
  if (key !== laneKey) {
    laneKey = key;
    lanes = new Array(laneCount).fill(0);
  }

  const now = Date.now();
  let lane = 0;
  let earliest = Infinity;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i] <= now) {
      lane = i;
      break;
    }
    if (lanes[i] < earliest) {
      earliest = lanes[i];
      lane = i;
    }
  }
  el.style.top = `${Math.round(start + lane * laneH)}px`;

  // 原生 speed 的单位是 px/分钟
  const pps = Math.max(40, (Number(cfg.speed) || 14400) / 60);
  lanes[lane] = now + (width / pps) * 1000;
  const duration = Math.max(1500, ((cw + width) / pps) * 1000);

  const anim = el.animate(
    [{ transform: `translateX(${cw}px)` }, { transform: `translateX(${-width}px)` }],
    { duration, easing: "linear", fill: "forwards" }
  );
  anim.onfinish = () => el.remove();
  // 悬停暂停：否则弹幕飞得太快，+1 按钮根本点不到
  el.addEventListener("mouseenter", () => anim.pause());
  el.addEventListener("mouseleave", () => {
    if (anim.playState === "paused") anim.play();
  });
}

function clearLayer() {
  const layer = document.getElementById(LAYER_ID);
  if (layer) layer.replaceChildren();
  lanes = [];
  laneKey = "";
}

function tick() {
  try {
    const fiber = findComponent();
    if (!fiber) return;
    const { inst, config } = readPluginState(fiber);
    if (config) cfg = { ...cfg, ...config };
    if (inst && inst !== hookedInst) {
      hookSend(inst);
      hookedInst = inst;
    }
    hookBus();
    if (getSettings().danmakuTakeover) ensureLayer();
  } catch (e) {
    /* 页面结构变化时忽略，下次 tick 重试 */
  }
}

export function initDanmakuLayer() {
  tick();
  setInterval(tick, 1000);
  onSettingChange((key, value) => {
    if (key === "danmakuTakeover" && !value) clearLayer();
  });
}
