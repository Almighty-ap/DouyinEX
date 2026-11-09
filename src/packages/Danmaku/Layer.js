import { win } from "../../common/env.js";
import { getSettings, onSettingChange } from "../../common/settings.js";
import { parseKeywords, matchKeywords, createRepeatFilter } from "../../lib/filter.js";
import { extractBarrage } from "../../lib/barrage.js";
import { sendChat } from "../Chat/send.js";
import { toast, injectStyle } from "../../common/dom.js";

/**
 * 悬浮弹幕层接管。
 *
 * 抖音的悬浮弹幕是 canvas + Worker 绘制的，没有 DOM 节点，也就没有命中测试，
 * 无法直接在弹幕上挂 +1 按钮，也无法按条隐藏。这里改成：
 *   1. 包装弹幕插件的 send(payload)，在入绘制队列前截下每条弹幕；
 *   2. 过滤命中屏蔽规则的直接丢弃；
 *   3. 其余的用 DOM 自己渲染成悬浮弹幕，悬停出现 +1 按钮。
 * 接管成功后隐藏原生 canvas，纯图片 / 礼物流水也由 DOM 层复刻，避免双重渲染且不丢礼物信息；
 * 关闭接管或尚未成功包装插件时，恢复原生 canvas 渲染。
 */

const LAYER_ID = "dyex-dm-layer";
const ITEM_CLS = "dyex-dm-item";
const PLUS_CLS = "dyex-dm-plus1";
const PLUGIN = ".CanvasDanmakuPlugin";
const MAX_ITEMS = 80;
const NATIVE_STYLE_ID = "dyex-dm-native-off";
// 只隐藏 canvas，不隐藏 .CanvasDanmakuPlugin 容器本身：
// 容器可能同时承载我们的 #dyex-dm-layer，整层隐藏会把 DOM 复刻层一起藏掉。
const NATIVE_HIDDEN_CSS =
  ".CanvasDanmakuPlugin canvas, canvas.CanvasDanmakuPlugin, #DanmakuLayout canvas { visibility: hidden !important; pointer-events: none !important; }";

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
 * 接管时原生 canvas 已隐藏，文字 / 图片 / 礼物弹幕都由 DOM 层复刻。
 */
function accept(payload) {
  if (!getSettings().danmakuTakeover) return false;
  const b = extractBarrage(payload);
  if (!b.text && !b.hasImage) return false;

  // 原生 canvas 已被隐藏，礼物/纯图片弹幕也必须由 DOM 层接住，否则会直接丢失
  if (b.isGift) {
    if (getSettings().simpleMode) return true;
    return renderItem(payload, b.content, b.text, b.isSelf, false);
  }
  if (!b.text) {
    return renderItem(payload, b.content, "", b.isSelf, false);
  }

  refreshRules();
  const u = users.get(b.id);
  const level = u ? Number(u.level) : null;
  if (!b.isSelf && shouldHide(b.text, level)) return true;
  return renderItem(payload, b.content, b.text, b.isSelf, true);
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

function renderItem(payload, parts, text, isSelf = false, allowPlus1 = true) {
  const layer = ensureLayer();
  if (!layer) return false;
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
  if (allowPlus1 && text && getSettings().plus1) el.append(makePlusBtn(text));
  layer.append(el);

  const cw = layer.clientWidth || 1;
  const ch = layer.clientHeight || 1;
  // 图片弹幕在 img 加载完成前 offsetWidth 可能为 0，给一个兜底宽度避免轨道重叠
  const width = el.offsetWidth || 40;
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
  return true;
}

function clearLayer() {
  const layer = document.getElementById(LAYER_ID);
  if (layer) layer.replaceChildren();
  lanes = [];
  laneKey = "";
}

function setNativeHidden(hidden) {
  const el = document.getElementById(NATIVE_STYLE_ID);
  if (hidden) {
    if (!el || el.textContent !== NATIVE_HIDDEN_CSS) {
      injectStyle(NATIVE_STYLE_ID, NATIVE_HIDDEN_CSS);
    }
  } else if (el && el.textContent !== "") {
    // 关闭接管或无法包装插件时恢复原生 canvas
    el.textContent = "";
  }
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
    // 只有真正拿到插件实例并完成 send 包装后，才隐藏原生 canvas；
    // 否则保留原生渲染，避免插件改版时画面一条弹幕都没有。
    if (getSettings().danmakuTakeover && inst) {
      ensureLayer();
      setNativeHidden(true);
    } else {
      setNativeHidden(false);
    }
  } catch (e) {
    /* 页面结构变化时忽略，下次 tick 重试 */
  }
}

export function initDanmakuLayer() {
  tick();
  setInterval(tick, 1000);
  onSettingChange((key, value) => {
    if (key !== "danmakuTakeover") return;
    if (!value) {
      clearLayer();
      setNativeHidden(false);
    } else {
      tick();
    }
  });
}
