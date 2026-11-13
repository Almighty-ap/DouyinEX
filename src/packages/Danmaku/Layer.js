import { win } from "../../common/env.js";
import { getSettings, onSettingChange } from "../../common/settings.js";
import { parseKeywords, matchKeywords, createRepeatFilter } from "../../lib/filter.js";
import {
  extractBarrage,
  getLaneCount,
  resolveArea,
  speedLevelToPps,
  clampSpeedMs,
} from "../../lib/barrage.js";
import { sendChat } from "../Chat/send.js";
import { makeFavoriteButton } from "../Chat/collect.js";
import { toast, injectStyle } from "../../common/dom.js";

/**
 * 悬浮弹幕层接管。
 *
 * 抖音的悬浮弹幕是 canvas + Worker 绘制的，没有 DOM 节点，也就没有命中测试，
 * 无法直接在弹幕上挂 +1 按钮，也无法按条隐藏。这里改成：
 *   1. 包装弹幕插件的 send(payload)，在入绘制队列前截下每条弹幕；
 *   2. 过滤命中屏蔽规则的直接丢弃；
 *   3. 其余的用 DOM 自己渲染成悬浮弹幕，悬停出现 +1 / 收藏按钮。
 * 接管成功后隐藏原生 canvas，纯图片 / 礼物流水也由 DOM 层复刻，避免双重渲染且不丢礼物信息；
 * 关闭接管或尚未成功包装插件时，恢复原生 canvas 渲染。
 *
 * 字号 / 不透明度 / 速度 / 显示区域取自 DouyinEX 设置面板（见 settings.dm*），
 * 因为接管后画面由本层渲染，抖音自带弹幕设置面板的这几项已不再决定画面表现。
 */

const LAYER_ID = "dyex-dm-layer";
const ITEM_CLS = "dyex-dm-item";
const PLUS_CLS = "dyex-dm-plus1";
const FAV_CLS = "dyex-dm-fav";
const PLUGIN = ".CanvasDanmakuPlugin";
// 同时存在的弹幕上限（不再因为拥挤丢弹幕，且慢速档一条要飘十几秒，放宽上限避免误删画面上的弹幕）
const MAX_ITEMS = 300;
// 同轨道排队上限：只等这么久，超过就直接出发（允许与同轨道前一条重叠），
// 换取「不丢弹幕」。宽松场景下仍走串行出发、完全不重叠。
const MAX_DELAY_MS = 1500;
// 同轨道相邻两条之间的额外间隙（毫秒），避免宽度测量误差导致贴到一起
const LANE_GAP_MS = 300;
const NATIVE_STYLE_ID = "dyex-dm-native-off";
// 只隐藏 canvas，不隐藏 .CanvasDanmakuPlugin 容器本身：
// 容器可能同时承载我们的 #dyex-dm-layer，整层隐藏会把 DOM 复刻层一起藏掉。
const NATIVE_HIDDEN_CSS =
  ".CanvasDanmakuPlugin canvas, canvas.CanvasDanmakuPlugin, #DanmakuLayout canvas { visibility: hidden !important; pointer-events: none !important; }";

let hookedInst = null;
let hookedBus = null;
// 抖音原生弹幕设置（「弹幕设置」面板的取值对象），每个 tick 重读，接管层外观以它为准
let nativeCfg = null;
const users = new Map(); // msg_id -> { level, nickname }
const isRepeat = createRepeatFilter(10000);
let rules = [];
let rulesRaw = null;
let lanes = [];
let laneKey = "";
// 当前被悬停（已暂停）的弹幕元素：悬停期间其余弹幕不参与命中测试，
// 否则后飘来的弹幕会盖在它上面，把悬停目标抢走并让这一条继续飘走。
let hoverEl = null;

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
    // 抖音原生「弹幕设置」面板写的那个配置对象：{ area, opacity, fontSize, speed, maxHeightRate, ... }
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

function clampNum(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * 当前生效的弹幕外观：**以抖音原生「弹幕设置」面板为准**（字号 / 不透明度 / 显示区域 / 移动速度），
 * 原生对象读不到时（插件未挂载、结构改版）退回 DouyinEX 存的上一次取值，保证不会失控。
 */
function currentStyle() {
  const s = getSettings();
  const area = resolveArea(s.dmArea);
  const n = nativeCfg;

  const nativeFont = n && Number(n.fontSize);
  const fontSize = Number.isFinite(nativeFont) && nativeFont > 0
    ? Math.round(clampNum(nativeFont, 8, 80))
    : Math.round(clampNum(Number(s.dmFontSize) || 20, 8, 80));

  // 原生不透明度是 0~1；DouyinEX 存的旧值是 0~100 的百分比
  const nativeOpacity = n && Number(n.opacity);
  const opacity = Number.isFinite(nativeOpacity)
    ? clampNum(nativeOpacity, 0.05, 1)
    : clampNum((Number(s.dmOpacity) || 80) / 100, 0.05, 1);

  // 移动速度：直接用原生 speed，单位是「穿过整屏所需的毫秒数」
  // （原生「移动速度」三档：较慢 18000 / 适中 14400 / 较快 10800），数值越小越快
  const nativeMs = n && Number(n.speed);
  const speedMs = Number.isFinite(nativeMs) && nativeMs > 0 ? clampSpeedMs(nativeMs) : null;

  // 显示区域：原生用 maxHeightRate（占播放器高度的比例，面板上显示为百分比），起点固定贴顶
  const nativeStart = n && n.area && Number.isFinite(Number(n.area.start))
    ? clampNum(Number(n.area.start), 0, 0.9)
    : area.start;
  const nativeRate = n && Number(n.maxHeightRate);
  const hasNativeArea = (Number.isFinite(nativeRate) && nativeRate > 0) ||
    (n && n.area && Number.isFinite(Number(n.area.end)));
  const areaEnd = hasNativeArea
    ? clampNum(nativeStart + (Number.isFinite(nativeRate) && nativeRate > 0 ? nativeRate : Number(n.area.end)), 0.1, 1)
    : area.end;

  return { fontSize, opacity, speedMs, fallbackPps: speedLevelToPps(s.dmSpeed), areaStart: nativeStart, areaEnd };
}

/**
 * 悬停期间把这一条标记为唯一命中目标：
 * 其余弹幕 `pointer-events: none`，后飘来的弹幕既不能盖住它也不能抢走悬停，
 * 只有当鼠标真的移开这一条时（mouseleave）才交还悬停。
 */
function beginHover(layer, el, anim) {
  // hoverEl 已脱离文档（层被清空 / 被裁掉）时不再挡住新的悬停
  if (hoverEl && !hoverEl.isConnected) hoverEl = null;
  if (hoverEl && hoverEl !== el) return;
  hoverEl = el;
  el.classList.add("is-hover");
  layer.classList.add("is-hovering");
  anim.pause();
}

function endHover(layer, el, anim) {
  if (hoverEl !== el) return;
  hoverEl = null;
  el.classList.remove("is-hover");
  layer.classList.remove("is-hovering");
  if (anim.playState === "paused") anim.play();
}

function renderItem(payload, parts, text, isSelf = false, allowPlus1 = true) {
  const layer = ensureLayer();
  if (!layer) return false;
  if (layer.childElementCount >= MAX_ITEMS) {
    const oldest = layer.firstElementChild;
    if (oldest === hoverEl) {
      hoverEl = null;
      layer.classList.remove("is-hovering");
    }
    oldest?.remove();
  }

  const st = currentStyle();
  const fontSize = st.fontSize;
  const el = document.createElement("span");
  el.className = isSelf ? `${ITEM_CLS} is-self` : ITEM_CLS;
  el.style.fontSize = `${fontSize}px`;
  el.style.opacity = String(st.opacity);
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
  // 只有真正的观众弹幕挂交互按钮：礼物流水（allowPlus1 为 false）既不 +1 也不收藏
  if (allowPlus1 && text) {
    if (getSettings().plus1) el.append(makePlusBtn(text));
    el.append(makeFavoriteButton(FAV_CLS, text));
  }
  layer.append(el);

  const cw = layer.clientWidth || 1;
  const ch = layer.clientHeight || 1;
  // 图片弹幕（表情）在 img 加载完成前 offsetWidth 偏小甚至为 0，
  // 按图片数量补一个估算宽度，否则轨道会被过早判定为空闲、后一条提前出发造成重叠
  const width = el.offsetWidth || 40;
  const imgCount = el.querySelectorAll("img").length;
  const reserveWidth = width + imgCount * Math.ceil(fontSize * 1.2);
  const laneH = Math.round(fontSize * 1.5);
  const start = Math.max(0, st.areaStart * ch);
  const spanRate = Math.max(0.05, Math.min(1, st.areaEnd) - Math.max(0, st.areaStart));
  const laneCount = getLaneCount({ height: ch, channelHeight: laneH, maxHeightRate: spanRate });

  const key = `${cw}x${ch}x${fontSize}x${start}x${laneCount}`;
  if (key !== laneKey) {
    laneKey = key;
    lanes = new Array(laneCount).fill(0);
  }

  // 轨道分配：优先用已空出的轨道；全都被占用时按最早空出的轨道**延后出发**（不重叠）。
  // 等待超过 MAX_DELAY_MS 的（说明这条轨道已经排满）就改为立刻出发，允许与同轨道前一条重叠，
  // 以此保证任何一条弹幕都不会被丢掉。
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
  let startAt = Math.max(now, lanes[lane] || now);
  if (startAt - now > MAX_DELAY_MS) startAt = now;
  el.style.top = `${Math.round(start + lane * laneH)}px`;

  // speedMs 是「从右侧屏外到左侧屏外」的总时长，正好等于这条弹幕的动画时长；
  // 拿它反推像素速度只用于轨道占用计算
  const duration = st.speedMs ? Math.max(1000, st.speedMs) : Math.max(1500, ((cw + width) / st.fallbackPps) * 1000);
  const pps = (cw + width) / (duration / 1000);
  // 轨道占用 = 估算宽度横穿一个自身长度的时间 + 固定间隙：
  // 留出真实间隙后，即使宽度测量略有误差，同轨道两条也不会贴到一起
  // （立刻出发的重叠场景下，时间戳只前进不回拨）
  lanes[lane] = Math.max(lanes[lane] || 0, startAt + (reserveWidth / pps) * 1000 + LANE_GAP_MS);

  const anim = el.animate(
    [{ transform: `translateX(${cw}px)` }, { transform: `translateX(${-width}px)` }],
    // delay + fill: both：排队期间停在屏幕右侧外（layer 已 overflow: hidden），到点才出发
    { duration, delay: startAt - now, easing: "linear", fill: "both" }
  );
  anim.onfinish = () => {
    endHover(layer, el, anim);
    el.remove();
  };
  // 悬停暂停：否则弹幕飞得太快，+1 / 收藏 按钮根本点不到
  el.addEventListener("mouseenter", () => beginHover(layer, el, anim));
  el.addEventListener("mouseleave", () => endHover(layer, el, anim));
  return true;
}

function clearLayer() {
  const layer = document.getElementById(LAYER_ID);
  if (layer) {
    layer.replaceChildren();
    layer.classList.remove("is-hovering");
  }
  hoverEl = null;
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
    if (config) {
      nativeCfg = config;
    }
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
