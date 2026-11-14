// ==UserScript==
// @name         DouyinEX-抖音直播间增强插件
// @namespace    https://github.com/Almighty-ap/DouyinEX
// @version      0.1.5
// @description  抖音直播间增强：复制直播流(原画/超清/高清) 自动最高画质 网页全屏/完全全屏 全屏净化 同步时间 滚轮调音量 弹幕接管与屏蔽 弹幕+1 弹幕收藏 循环发送弹幕 自动抢免费福袋 简洁模式
// @author       DouyinEX
// @license      MIT
// @homepageURL  https://github.com/Almighty-ap/DouyinEX
// @supportURL   https://github.com/Almighty-ap/DouyinEX/issues
// @updateURL    https://raw.githubusercontent.com/Almighty-ap/DouyinEX/main/dist/douyinex.user.js
// @downloadURL  https://raw.githubusercontent.com/Almighty-ap/DouyinEX/main/dist/douyinex.user.js
// @match        *://live.douyin.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  // src/common/env.js
  var hasGM = typeof GM_getValue === "function";
  var PREFIX = "dyex_";
  var win = typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis;
  function getValue(key, def) {
    if (hasGM) return GM_getValue(key, def);
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? def : JSON.parse(raw);
    } catch {
      return def;
    }
  }
  function setValue(key, value) {
    if (hasGM) return GM_setValue(key, value);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      }
    } catch {
    }
  }
  function copyText(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text);
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text);
  }

  // src/lib/barrage.js
  function extractBarrage(params) {
    const content = Array.isArray(params && params.content) ? params.content : [];
    const text = content.filter((c) => c && c.type === "text").map((c) => String(c.text == null ? "" : c.text)).join("").trim();
    const hasImage = content.some((c) => c && c.type === "image");
    return {
      id: String(params && params.id || ""),
      text,
      hasImage,
      // 自己发的弹幕带边框，不应被屏蔽规则误伤
      isSelf: !!(params && params.borderWidth),
      // 画面上的送礼流水弹幕（如「xxx 送出粉丝团灯牌 x 1」），不应挂 +1 跟发按钮
      isGift: hasImage && /\s*送出.+\sx\s*\d+$/i.test(text),
      content
    };
  }
  var DM_AREAS = [
    { key: "top", label: "\u9876\u90E8 1/4", start: 0, end: 0.25 },
    { key: "half", label: "\u4E0A\u534A\u5C4F", start: 0, end: 0.5 },
    { key: "upper75", label: "\u4E0A 3/4", start: 0, end: 0.75 },
    { key: "full", label: "\u5168\u5C4F", start: 0, end: 1 },
    { key: "bottomHalf", label: "\u4E0B\u534A\u5C4F", start: 0.5, end: 1 }
  ];
  var DM_AREA_DEFAULT = "half";
  function resolveArea(key) {
    return DM_AREAS.find((a) => a.key === key) || DM_AREAS.find((a) => a.key === DM_AREA_DEFAULT);
  }
  var DM_SPEED_DEFAULT = 5;
  var DM_SPEED_MIN = 1;
  var DM_SPEED_MAX = 10;
  var DM_SPEED_MS_MIN = 2e3;
  var DM_SPEED_MS_MAX = 6e4;
  var DM_SPEED_MS_DEFAULT = 14400;
  function clampSpeedMs(ms, fallback = DM_SPEED_MS_DEFAULT) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(DM_SPEED_MS_MAX, Math.max(DM_SPEED_MS_MIN, Math.round(n)));
  }
  var SPEED_PPS = [96, 132, 168, 204, 240, 288, 348, 420, 504, 600];
  function speedLevelToPps(level) {
    const n = Math.round(Number(level));
    const lv = Number.isFinite(n) ? Math.min(DM_SPEED_MAX, Math.max(DM_SPEED_MIN, n)) : DM_SPEED_DEFAULT;
    return SPEED_PPS[lv - 1];
  }
  var OVERLAP_WAIT_MS = 1500;
  var OVERLAP_DROP_MS = 4e3;
  function pickLane({ lanes: lanes2, now, avoidOverlap = false }) {
    if (!Array.isArray(lanes2) || !lanes2.length) return { lane: 0, startAt: now, drop: false };
    let lane = 0;
    let earliest = Infinity;
    for (let i = 0; i < lanes2.length; i++) {
      if (lanes2[i] <= now) return { lane: i, startAt: now, drop: false };
      if (lanes2[i] < earliest) {
        earliest = lanes2[i];
        lane = i;
      }
    }
    const wait = earliest - now;
    if (avoidOverlap) {
      return wait > OVERLAP_DROP_MS ? { lane, startAt: earliest, drop: true } : { lane, startAt: earliest, drop: false };
    }
    return wait > OVERLAP_WAIT_MS ? { lane, startAt: now, drop: false } : { lane, startAt: earliest, drop: false };
  }
  function getLaneCount({ height, channelHeight, maxHeightRate }) {
    if (!height || !channelHeight) return 1;
    const usable = Math.min(height, (maxHeightRate || 1) * height);
    return Math.max(1, Math.floor(usable / channelHeight));
  }

  // src/lib/favorites.js
  var FAV_MAX = 300;
  function normalizeFavorites(raw) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of Array.isArray(raw) ? raw : []) {
      if (typeof item !== "string") continue;
      const text = item.replace(/\s+/g, " ").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= FAV_MAX) break;
    }
    return out;
  }
  function hasFavorite(list, text) {
    return normalizeFavorites(list).includes(String(text == null ? "" : text).trim());
  }
  function addFavorite(list, text) {
    const cur = normalizeFavorites(list);
    const value = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!value || cur.includes(value)) return cur;
    return [value, ...cur].slice(0, FAV_MAX);
  }
  function removeFavorite(list, text) {
    const value = String(text == null ? "" : text).trim();
    return normalizeFavorites(list).filter((t) => t !== value);
  }
  function filterFavorites(list, query) {
    const cur = normalizeFavorites(list);
    const q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q) return cur;
    return cur.filter((t) => t.toLowerCase().includes(q));
  }

  // src/lib/history.js
  var HISTORY_MAX = 50;
  function capOf(max) {
    const n = Math.floor(Number(max));
    return Number.isFinite(n) && n > 0 ? n : HISTORY_MAX;
  }
  function clean(text) {
    return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  }
  function normalizeHistory(raw, max = HISTORY_MAX) {
    const out = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      const text = clean(item);
      if (text) out.push(text);
    }
    return out.slice(-capOf(max));
  }
  function pushHistory(list, text, max = HISTORY_MAX) {
    const cap = capOf(max);
    const cur = normalizeHistory(list, cap);
    const value = clean(text);
    if (!value || cur.length && cur[cur.length - 1] === value) return cur;
    return [...cur, value].slice(-cap);
  }
  function nextHistoryIndex(index, length, dir) {
    const n = Math.floor(Number(length));
    if (!Number.isFinite(n) || n <= 0) return null;
    const i = Number.isInteger(index) && index >= 0 && index < n ? index : null;
    if (dir < 0) {
      if (i === null) return n - 1;
      return Math.max(0, i - 1);
    }
    if (i === null) return null;
    const next = i + 1;
    return next >= n ? null : next;
  }

  // src/common/settings.js
  var DEFAULTS = {
    autoQuality: true,
    autoWebFull: false,
    autoFull: false,
    fullscreenFoldChat: true,
    hideGiftBar: false,
    wheelVolume: true,
    simpleMode: false,
    simpleRestore: null,
    autoLottery: false,
    autoLotteryFollow: false,
    ballPos: null,
    plus1: true,
    danmakuTakeover: true,
    // 画面悬浮弹幕外观（接管渲染时生效，默认值与抖音原生一致）
    dmFontSize: 20,
    dmOpacity: 80,
    dmSpeed: DM_SPEED_DEFAULT,
    dmArea: DM_AREA_DEFAULT,
    dmFavorites: [],
    // 密集时优先减少重叠（挤不下的弹幕直接丢弃）；关闭则优先不丢弹幕（允许同轨道适度重叠）
    dmAvoidOverlap: false,
    shieldKeywords: "",
    shieldLevelBelow: 0,
    shieldEnter: false,
    shieldRepeat: false,
    loopTexts: "",
    loopMin: 3e3,
    loopMax: 5e3,
    loopLimitMin: 5,
    loopRandom: false,
    // 输入框上下键调取「我发送过的弹幕」
    chatHistoryKeys: true,
    chatHistory: []
  };
  var MUTEX_KEY = {
    autoFull: "autoWebFull",
    autoWebFull: "autoFull"
  };
  var listeners = /* @__PURE__ */ new Set();
  var cache = null;
  var AREA_KEYS = new Set(DM_AREAS.map((a) => a.key));
  function clampNum(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  function normalizeSettings(raw = {}) {
    const merged = { ...DEFAULTS, ...raw || {} };
    if (merged.autoFull && merged.autoWebFull) {
      merged.autoWebFull = false;
    }
    merged.dmFontSize = clampNum(merged.dmFontSize, 12, 40, DEFAULTS.dmFontSize);
    merged.dmOpacity = clampNum(merged.dmOpacity, 20, 100, DEFAULTS.dmOpacity);
    merged.dmSpeed = clampNum(merged.dmSpeed, DM_SPEED_MIN, DM_SPEED_MAX, DM_SPEED_DEFAULT);
    if (!AREA_KEYS.has(merged.dmArea)) merged.dmArea = DM_AREA_DEFAULT;
    merged.dmAvoidOverlap = !!merged.dmAvoidOverlap;
    merged.dmFavorites = normalizeFavorites(merged.dmFavorites);
    merged.chatHistory = normalizeHistory(merged.chatHistory);
    return merged;
  }
  function load() {
    if (!cache) cache = normalizeSettings(getValue("settings", {}));
    return cache;
  }
  function getSettings() {
    return load();
  }
  function setSetting(key, value) {
    const s = load();
    s[key] = value;
    const peer = value ? MUTEX_KEY[key] : null;
    const peerChanged = !!(peer && s[peer]);
    if (peerChanged) {
      s[peer] = false;
    }
    setValue("settings", cache);
    if (peerChanged) {
      listeners.forEach((fn) => fn(peer, false));
    }
    listeners.forEach((fn) => fn(key, value));
  }
  function onSettingChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // src/packages/Panel/Panel.css
  var Panel_default = '#dyex-ball {\n  position: fixed; right: 16px; bottom: 200px; width: 40px; height: 40px;\n  border-radius: 50%; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.35);\n  cursor: grab; touch-action: none; z-index: 2147483000; display: flex; align-items: center;\n  justify-content: center; user-select: none; transition: transform .15s, opacity .2s;\n}\n#dyex-ball:hover { transform: scale(1.1); }\n#dyex-ball.is-dragging { cursor: grabbing; transition: none; transform: scale(1.08); }\n#dyex-ball.is-hidden { opacity: 0 !important; pointer-events: none !important; transform: scale(.75); }\n#dyex-ball svg { width: 30px; height: 30px; pointer-events: none; }\n\n#dyex-panel {\n  position: fixed; right: 64px; bottom: 80px; width: 340px; max-height: 70vh;\n  overflow-y: auto; background: rgba(22,22,26,.96); color: #eee; font-size: 13px;\n  border-radius: 10px; padding: 12px 14px; z-index: 2147483000;\n  box-shadow: 0 6px 24px rgba(0,0,0,.5); display: none; line-height: 1.6;\n}\n#dyex-panel.is-open { display: block; }\n#dyex-panel h4 { margin: 10px 0 6px; font-size: 13px; color: #fe2c55; }\n#dyex-panel h4:first-child { margin-top: 0; }\n#dyex-panel h4.dyex-fold { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }\n#dyex-panel .dyex-fold-arrow { display: inline-block; transition: transform .15s; }\n#dyex-panel h4.dyex-fold.is-open .dyex-fold-arrow { transform: rotate(90deg); }\n#dyex-panel .dyex-fold-body { display: none; }\n#dyex-panel .dyex-fold-body.is-open { display: block; }\n#dyex-panel label { display: flex; align-items: center; gap: 6px; cursor: pointer; }\n#dyex-panel input[type="text"], #dyex-panel input[type="number"], #dyex-panel textarea {\n  background: #2a2a30; color: #eee; border: 1px solid #444; border-radius: 4px;\n  padding: 3px 6px; font-size: 12px; box-sizing: border-box;\n}\n#dyex-panel textarea { width: 100%; resize: vertical; min-height: 56px; }\n#dyex-panel input[type="number"] { width: 64px; }\n#dyex-panel button {\n  background: #fe2c55; color: #fff; border: 0; border-radius: 4px;\n  padding: 3px 10px; font-size: 12px; cursor: pointer; margin: 2px 4px 2px 0;\n}\n#dyex-panel button.is-secondary { background: #3a3a42; }\n#dyex-panel .dyex-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; flex-wrap: wrap; }\n#dyex-panel .dyex-tip { color: #999; font-size: 12px; }\n#dyex-panel .dyex-grow { flex: 1; min-width: 0; }\n#dyex-panel input[type="range"] { width: 108px; accent-color: #fe2c55; }\n#dyex-panel .dyex-val { color: #fe2c55; min-width: 76px; font-size: 12px; }\n#dyex-panel select {\n  background: #2a2a30; color: #eee; border: 1px solid #444; border-radius: 4px;\n  padding: 3px 6px; font-size: 12px; box-sizing: border-box;\n}\n#dyex-panel .dyex-fav-list { max-height: 168px; overflow-y: auto; margin: 4px 0; }\n#dyex-panel .dyex-fav-item {\n  display: flex; align-items: center; gap: 6px; padding: 2px 0;\n  border-bottom: 1px solid #333;\n}\n#dyex-panel .dyex-fav-text {\n  flex: 1; min-width: 0; cursor: pointer; overflow: hidden;\n  text-overflow: ellipsis; white-space: nowrap;\n}\n#dyex-panel .dyex-fav-text:hover { color: #fe2c55; }\n#dyex-panel .dyex-fav-item button { padding: 1px 6px; font-size: 11px; margin: 0; }\n\n/* \u804A\u5929\u6761\u76EE\u7684\u60AC\u505C\u6309\u94AE\uFF1A\u7EDD\u5BF9\u5B9A\u4F4D\uFF0C\u4E0D\u53C2\u4E0E\u6761\u76EE\u6392\u7248\u3002\n   \u82E5\u6309\u884C\u5185\u5143\u7D20\u63D2\u5165\uFF0C\u6BCF\u6761\u6D88\u606F\u4F1A\u88AB\u6491\u9AD8\u4E00\u884C\uFF08\u5B9E\u6D4B\u5355\u884C\u6761\u76EE 34px \u2192 56px\uFF09\uFF0C\n   \u811A\u672C\u9010\u6761\u6CE8\u5165\u65F6\u5217\u8868\u5185\u5BB9\u4F1A\u6301\u7EED\u8DF3\u52A8\uFF0C\u53EF\u89C6\u6761\u6570\u4E5F\u51E0\u4E4E\u5C11\u4E00\u534A\u3002 */\n.webcast-chatroom___item { position: relative; }\n.dyex-plus1, .dyex-fav {\n  position: absolute; top: 50%; transform: translateY(-50%);\n  margin: 0; padding: 0 6px; border-radius: 8px; font-size: 12px; line-height: 18px;\n  white-space: nowrap; background: #fff;\n  border: 1px solid #fe2c55; color: #fe2c55; cursor: pointer; opacity: 0;\n  transition: opacity .15s; user-select: none;\n}\n.dyex-plus1 { right: 48px; }\n.dyex-fav { right: 4px; border-color: #f5a623; color: #f5a623; }\n.webcast-chatroom___item:hover .dyex-plus1, .webcast-chatroom___item:hover .dyex-fav {\n  opacity: 1;\n}\n\n/* \u63A5\u7BA1\u540E\u7684\u60AC\u6D6E\u5F39\u5E55\u5C42 */\n#dyex-dm-layer {\n  position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1;\n}\n/* \u6587\u5B57\u5728\u4E0A\u3001\u64CD\u4F5C\u884C\u5728\u4E0B\uFF1A\u5185\u8FB9\u8DDD\u6052\u5B9A\uFF0C\u60AC\u505C\u5C55\u5F00\u64CD\u4F5C\u884C\u65F6\u6587\u5B57\u4E0D\u4F1A\u8DF3\u4F4D */\n.dyex-dm-item {\n  position: absolute; left: 0; top: 0; display: flex; flex-direction: column;\n  align-items: flex-start; padding: 0 6px; pointer-events: auto;\n  user-select: none; line-height: 1.35; cursor: default;\n  text-shadow: -1px -1px 0 rgba(0,0,0,.8), 1px -1px 0 rgba(0,0,0,.8),\n    -1px 1px 0 rgba(0,0,0,.8), 1px 1px 0 rgba(0,0,0,.8), 0 0 2px rgba(0,0,0,.8);\n}\n.dyex-dm-text { white-space: nowrap; }\n.dyex-dm-item img { height: 1.15em; vertical-align: -.2em; }\n.dyex-dm-item.is-self { border: 1px solid rgba(255,255,255,.85); border-radius: 6px; }\n/* \u60AC\u505C\u4E2D\u7684\u5F39\u5E55\uFF1A\u7F6E\u9876\u5E76\u52A0\u5E95\u8272\uFF0C\u4FDD\u8BC1 +1 / \u6536\u85CF \u59CB\u7EC8\u70B9\u5728\u6700\u521D\u60F3\u64CD\u4F5C\u7684\u90A3\u4E00\u6761\u4E0A\u3002\n   \u60AC\u505C\u671F\u95F4\u5176\u4F59\u5F39\u5E55\u4E0D\u53C2\u4E0E\u547D\u4E2D\u6D4B\u8BD5\uFF0C\u540E\u98D8\u6765\u7684\u5F39\u5E55\u65E2\u76D6\u4E0D\u4F4F\u5B83\u4E5F\u62A2\u4E0D\u8D70\u60AC\u505C\u3002 */\n.dyex-dm-item.is-hover { z-index: 2; background: rgba(0,0,0,.55); border-radius: 6px; }\n#dyex-dm-layer.is-hovering .dyex-dm-item { pointer-events: none; }\n#dyex-dm-layer.is-hovering .dyex-dm-item.is-hover { pointer-events: auto; }\n/* +1 / \u6536\u85CF \u4E0B\u7F6E\u5728\u6587\u5B57\u4E0B\u65B9\u4E00\u884C\uFF1A\u9ED8\u8BA4\u4E0D\u5360\u4F4D\uFF08\u5BBD\u5EA6\u6D4B\u91CF\u4E0E\u8F68\u9053\u95F4\u8DDD\u4ECD\u6309\u6587\u5B57\u7B97\uFF09\uFF0C\u60AC\u505C\u624D\u5C55\u5F00\u3002\n   \u5DE6\u5BF9\u9F50\uFF0C\u5F39\u5E55\u53EA\u98D8\u8FDB\u753B\u9762\u534A\u622A\u65F6\u6309\u94AE\u4E5F\u4E00\u5B9A\u8DDF\u5728\u53EF\u89C1\u7684\u6587\u5B57\u4E0B\u9762\u3002 */\n.dyex-dm-actions { display: none; }\n.dyex-dm-item.is-hover .dyex-dm-actions {\n  display: flex; gap: 6px; margin-top: 2px; padding-bottom: 2px;\n}\n.dyex-dm-plus1, .dyex-dm-fav {\n  padding: 0 8px; border-radius: 9px; color: #fff; font-size: 12px; line-height: 18px;\n  white-space: nowrap; text-shadow: none; cursor: pointer;\n}\n.dyex-dm-plus1 { background: #fe2c55; }\n.dyex-dm-fav { background: #f5a623; }\n.dyex-dm-plus1:hover, .dyex-dm-fav:hover { filter: brightness(1.15); }\n\n#dyex-toast {\n  position: fixed; left: 50%; top: 80px; transform: translateX(-50%);\n  padding: 8px 16px; border-radius: 6px; background: rgba(0,0,0,.85); color: #fff;\n  font-size: 13px; z-index: 2147483647; opacity: 0; pointer-events: none;\n  transition: opacity .2s;\n}\n#dyex-toast.is-show { opacity: 1; }\n#dyex-toast[data-type="success"] { background: rgba(22,163,74,.92); }\n#dyex-toast[data-type="error"] { background: rgba(220,38,38,.92); }\n';

  // src/common/dom.js
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function randomInt(min, max) {
    if (max < min) [min, max] = [max, min];
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  async function waitFor(selector, timeout = 15e3, interval = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }
  function injectStyle(id, css) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }
  var toastTimer = null;
  function toast(msg, type = "info") {
    let el = document.getElementById("dyex-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "dyex-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.dataset.type = type;
    el.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-show"), 2e3);
  }

  // src/lib/stream.js
  var QUALITY_ORDER = ["FULL_HD1", "HD1", "SD2", "SD1"];
  var QUALITY_LABEL = {
    FULL_HD1: "\u539F\u753B",
    HD1: "\u8D85\u6E05",
    SD2: "\u9AD8\u6E05",
    SD1: "\u6807\u6E05"
  };
  function extractJsonObject(text, key) {
    const marker = `"${key}":`;
    const idx = text.indexOf(marker);
    if (idx === -1) return null;
    let i = text.indexOf("{", idx + marker.length);
    if (i === -1) return null;
    const start = i;
    let depth = 0;
    let inStr = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
    return null;
  }
  function paceToText(pace) {
    if (!Array.isArray(pace)) return "";
    return pace.map((item) => Array.isArray(item) && typeof item[1] === "string" ? item[1] : "").join("");
  }
  function parseStreams(pace) {
    const text = paceToText(pace);
    const streamUrl = extractJsonObject(text, "stream_url");
    if (!streamUrl) return null;
    const flv = streamUrl.flv_pull_url || {};
    const hls = streamUrl.hls_pull_url_map || {};
    if (!Object.keys(flv).length && !Object.keys(hls).length) return null;
    return { flv, hls };
  }
  function pickUrl(streams, type = "flv", quality = null) {
    if (!streams) return null;
    const map = streams[type] || {};
    if (quality && map[quality]) return { quality, url: map[quality] };
    for (const q of QUALITY_ORDER) {
      if (map[q]) return { quality: q, url: map[q] };
    }
    return null;
  }
  function listQualities(streams, type = "flv") {
    const map = streams && streams[type] || {};
    return QUALITY_ORDER.filter((q) => map[q]).map((q) => ({
      quality: q,
      label: QUALITY_LABEL[q],
      url: map[q]
    }));
  }

  // src/packages/Stream/Stream.js
  function getStreams() {
    return parseStreams(win.__pace_f);
  }
  async function copyStream(type = "flv", quality = null) {
    const streams = getStreams();
    const picked = pickUrl(streams, type, quality);
    if (!picked) {
      toast("\u672A\u83B7\u53D6\u5230\u76F4\u64AD\u6D41\uFF08\u623F\u95F4\u672A\u5F00\u64AD\u6216\u9875\u9762\u6570\u636E\u672A\u5C31\u7EEA\uFF09", "error");
      return false;
    }
    await copyText(picked.url);
    toast(`\u5DF2\u590D\u5236 ${QUALITY_LABEL[picked.quality]} ${type.toUpperCase()} \u5730\u5740`, "success");
    return true;
  }
  function getStreamMenuItems() {
    const streams = getStreams();
    const items = [];
    for (const type of ["flv", "hls"]) {
      for (const q of listQualities(streams, type)) {
        items.push({ type, quality: q.quality, label: `${q.label} ${type.toUpperCase()}` });
      }
    }
    return items;
  }
  async function autoHighestQuality() {
    const current = await waitFor('[data-e2e="quality"]', 2e4);
    const selector = document.querySelector('[data-e2e="quality-selector"]');
    if (!current || !selector) return false;
    const before = current.textContent.trim();
    const isLoginGated = (el) => Array.from(el.parentElement?.children || []).some(
      (sib) => sib !== el && sib.textContent.includes("\u767B\u5F55\u5373\u4EAB")
    );
    const options = Array.from(selector.querySelectorAll("div")).filter(
      (el) => el.children.length === 0 && /原画|蓝光|超清|高清|标清/.test(el.textContent) && !isLoginGated(el)
    );
    if (!options.length) return false;
    if (options[0].textContent.trim() === before) return true;
    for (const opt of options) {
      if (opt.textContent.trim() === before) return true;
      opt.click();
      await sleep(1200);
      const now = document.querySelector('[data-e2e="quality"]')?.textContent.trim();
      if (now && now !== before) return true;
    }
    return false;
  }

  // src/packages/Chat/historyStore.js
  var selfSendAt = 0;
  function markSelfSend() {
    selfSendAt = Date.now();
  }
  function isSelfSendRecent(ms = 2e3) {
    return Date.now() - selfSendAt < ms;
  }
  function recordSent(text) {
    const cur = getSettings().chatHistory;
    const next = pushHistory(cur, text);
    if (next.length === cur.length && next.every((v, i) => v === cur[i])) return false;
    setSetting("chatHistory", next);
    return true;
  }

  // src/packages/Chat/send.js
  var CHAT_EDITOR = ".webcast-chatroom___input-container .editor-kit-container";
  var SEND_BTN = ".webcast-chatroom___send-btn";
  var ZERO_WIDTH = String.fromCharCode(8203);
  var CLEAR_POLL_MS = 250;
  var CLEAR_POLL_TIMES = 10;
  function findChatInput() {
    return document.querySelector(CHAT_EDITOR);
  }
  function getEditorText(el) {
    return el.innerText.split(ZERO_WIDTH).join("").trim();
  }
  function setEditorText(el, text) {
    if (!el) return false;
    const value = text == null ? "" : String(text);
    const write = () => {
      el.focus();
      document.execCommand("selectAll", false);
      return value ? document.execCommand("insertText", false, value) : document.execCommand("delete", false);
    };
    const ok = write();
    if (ok && getEditorText(el) !== value) write();
    return ok;
  }
  function fillChat(text) {
    const input = findChatInput();
    if (!input) return false;
    return setEditorText(input, text);
  }
  function isEditorEmpty() {
    const input = findChatInput();
    return !input || getEditorText(input) === "";
  }
  async function waitEditorCleared() {
    for (let i = 0; i < CLEAR_POLL_TIMES; i++) {
      await sleep(CLEAR_POLL_MS);
      if (isEditorEmpty()) return true;
    }
    return false;
  }
  async function sendChat(text, { record = true } = {}) {
    const input = findChatInput();
    if (!input) return false;
    if (!setEditorText(input, text)) return false;
    await sleep(80);
    const btn = document.querySelector(SEND_BTN);
    if (!btn || btn.classList.contains("disable")) return false;
    markSelfSend();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    if (record && await waitEditorCleared()) recordSent(text);
    return true;
  }

  // src/packages/Chat/Loop.js
  var timer = null;
  var stopTimer = null;
  var offset = 0;
  var running = false;
  var onStateChange = () => {
  };
  function isLoopRunning() {
    return running;
  }
  function onLoopState(fn) {
    onStateChange = fn;
  }
  function parseTexts() {
    return String(getSettings().loopTexts || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  async function tick() {
    if (!running) return;
    const s = getSettings();
    const texts = parseTexts();
    if (!texts.length) return stopLoop();
    const idx = s.loopRandom ? randomInt(0, texts.length - 1) : offset++ % texts.length;
    const ok = await sendChat(texts[idx], { record: false });
    if (!ok) {
      toast("\u53D1\u9001\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u6296\u97F3\uFF0C\u4E14\u804A\u5929\u8F93\u5165\u6846\u53EF\u7528\uFF0C\u5FAA\u73AF\u5DF2\u505C\u6B62", "error");
      return stopLoop();
    }
    timer = setTimeout(tick, randomInt(s.loopMin, s.loopMax));
  }
  function startLoop() {
    if (running) return;
    const s = getSettings();
    if (!parseTexts().length) {
      toast("\u8BF7\u5148\u586B\u5199\u5FAA\u73AF\u53D1\u9001\u7684\u5F39\u5E55\uFF08\u4E00\u884C\u4E00\u6761\uFF09", "error");
      return;
    }
    running = true;
    offset = 0;
    stopTimer = setTimeout(stopLoop, Math.max(1, s.loopLimitMin) * 60 * 1e3);
    onStateChange(true);
    tick();
  }
  function stopLoop() {
    running = false;
    clearTimeout(timer);
    clearTimeout(stopTimer);
    onStateChange(false);
  }

  // src/packages/Player/Player.js
  var SIMPLE_CSS = `
[data-e2e="exhibition-banner"],
[data-e2e="yellowCart-container"],
[data-e2e*="cart" i],
[data-e2e="hour-rank-entrance"],
#GiftTrayLayout,
#GiftEffectLayout,
.GiftTrayPlugin,
.GiftEffectPlugin,
/* \u753B\u9762\u5185\u7684\u63A8\u5E7F / \u77ED\u89E6\u5361\u7247\uFF08\u53F3\u4E0B\u89D2\u6E38\u620F\u94FE\u63A5\u3001\u6D3B\u52A8\u5361\u7247\u7B49\uFF09\uFF0C\u90E8\u5206\u7531 iframe \u5BB9\u5668\u6E32\u67D3 */
#EcmoCardLayout,
#ShortTouchLayout,
#__living_right_panel_id,
iframe[data-container-id^="@annie/"],
.tab-microgame,
.douyin-player-controls > :not(.douyin-player-controls-inner) { display: none !important; }
`;
  var HIDE_GIFT_BAR_CSS = `
#BottomLayout,
[data-e2e="gifts-container"],
#giftPanelEntrance,
[data-e2e="recharge-btn"],
.douyin-player-controls > :not(.douyin-player-controls-inner) { display: none !important; }
`;
  var SYNC_TIME_CSS = `
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
  /* \u539F\u751F\u63A7\u5236\u680F\u6574\u4F53\u4E3A pointer-events:none\uFF0C\u4EA4\u4E92\u9879\u5404\u81EA\u7F6E\u4E3A auto */
  pointer-events: auto;
  transition: opacity .15s, transform .1s;
  -webkit-tap-highlight-color: transparent;
}
.dyex-sync-time:hover { opacity: 1; }
.dyex-sync-time:active { transform: scale(.9); }
.dyex-sync-time svg { width: 22px; height: 22px; display: block; }
.dyex-sync-time::after {
  content: "\u540C\u6B65\u65F6\u95F4";
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
  var hiddenCart = /* @__PURE__ */ new Set();
  function hideCartNodes() {
    if (!getSettings().simpleMode) return;
    document.querySelectorAll('[data-e2e="yellowCart-container"], [data-e2e*="cart" i]').forEach((el) => {
      if (el.style.display !== "none") el.style.display = "none";
      hiddenCart.add(el);
    });
    document.querySelectorAll('.douyin-player [class*="ToolbarPlugin"] > div').forEach((item) => {
      if (item.textContent.includes("\u5168\u90E8\u5546\u54C1") && item.style.display !== "none") {
        item.style.display = "none";
        hiddenCart.add(item);
      }
    });
  }
  function unhideCartNodes() {
    hiddenCart.forEach((el) => {
      el.style.display = "";
    });
    hiddenCart.clear();
  }
  var cartTimer = null;
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
  var softFullActive = false;
  var nativeRequestFull = null;
  function getPlayerProxy() {
    const doc = win.document || document;
    const el = doc.querySelector(".douyin-player");
    if (!el) return null;
    const raw = el.wrappedJSObject || el;
    return raw._player?.proxy || null;
  }
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
        }
      });
    } catch (_) {
    }
    if (typeof origReq === "function") {
      nativeRequestFull = origReq;
      proto.requestFullscreen = function(...args) {
        const p = origReq.apply(this, args);
        if (p && typeof p.then === "function") {
          return p.then((res) => {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
              softFullActive = true;
              try {
                this.emit("fullscreenchange", true);
              } catch (_) {
              }
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
      proto.exitFullscreen = function(...args) {
        if (softFullActive) {
          softFullActive = false;
          try {
            this.emit("fullscreenchange", false);
          } catch (_) {
          }
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
  function findFullButton() {
    if (isNativeFullscreen()) return null;
    const root = document.querySelector(".douyin-player-fullscreen");
    if (root) {
      const pop = root.querySelector(".douyin-player-popup");
      if (pop && pop.textContent.includes("\u9000\u51FA\u5168\u5C4F")) return null;
      return root.querySelector("svg") || root.querySelector(".douyin-player-icon") || root;
    }
    const tips = Array.from(document.querySelectorAll(".douyin-player *")).filter(
      (el) => el.children.length === 0 && /^(进入)?全屏(\s*\(H\))?$/i.test(el.textContent.trim())
    );
    const tip = tips[0];
    if (!tip) return null;
    const slot = tip.closest("slot") || tip.parentElement?.parentElement?.parentElement;
    return slot && slot.querySelector("svg") || tip.closest("div[class*='douyin-player'], div");
  }
  function triggerClick(el) {
    if (!el) return false;
    try {
      el.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: win
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
  function isNativeFullscreen() {
    if (softFullActive) return true;
    if (document.fullscreenElement || document.webkitFullscreenElement) return true;
    const tip = document.querySelector(".douyin-player-fullscreen .douyin-player-popup");
    if (tip && tip.textContent.includes("\u9000\u51FA\u5168\u5C4F")) return true;
    return false;
  }
  function isFullMode() {
    return isNativeFullscreen();
  }
  function isChatFolded() {
    if (document.querySelector('.chat_room_fold, [class*="chat_room_fold"]')) return true;
    const rightBg = document.getElementById("RightBackgroundLayout") || document.getElementById("chatroom");
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
  var chatFoldedByUs = false;
  var lastFullState = false;
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
  var fullChatTimer = null;
  function applyHideGiftBarStyle() {
    const on = !!getSettings().hideGiftBar;
    injectStyle("dyex-hide-gift-bar", on ? HIDE_GIFT_BAR_CSS : "");
  }
  function initHideGiftBar() {
    applyHideGiftBarStyle();
    onSettingChange((key) => {
      if (key === "hideGiftBar") applyHideGiftBarStyle();
    });
  }
  function initFullscreenFoldChat() {
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
        }).catch(() => {
        });
      }
    } catch (_) {
    }
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
      document.exitFullscreen().catch(() => {
      });
    }
  }
  async function autoWebFull(opts = {}) {
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
    const player = await waitFor(".douyin-player", 2e4);
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
  async function waitUntil(fn, timeout = 15e3, interval = 200) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (fn()) return true;
      await sleep(interval);
    }
    return false;
  }
  async function tryEnterFull() {
    const proxy = ensurePlayerFullPatch();
    const btn = findFullButton();
    if (btn) triggerClick(btn);
    else if (proxy && typeof proxy.requestFullscreen === "function") proxy.requestFullscreen();
    await sleep(300);
    return isNativeFullscreen();
  }
  var fullGuardToken = 0;
  var lastUserInputAt = 0;
  function recentUserInput(ms = 1500) {
    return Date.now() - lastUserInputAt < ms;
  }
  async function autoFull(opts = {}) {
    const token = ++fullGuardToken;
    const alive = () => token === fullGuardToken && !!getSettings().autoFull;
    if (isNativeFullscreen()) return true;
    if (opts.immediate) {
      if (await tryEnterFull()) {
        checkFullscreenChatFold();
        return true;
      }
    }
    if (!await waitFor(".douyin-player", 2e4) || !alive()) return false;
    const pluginReady = () => !!(findWebFullButton(false) || findWebFullButton(true));
    await waitUntil(pluginReady, 15e3);
    if (!opts.immediate) await sleep(800);
    let entered = false;
    for (let i = 0; i < 6 && alive(); i++) {
      if (isNativeFullscreen() || await tryEnterFull()) {
        entered = true;
        break;
      }
      await sleep(400);
    }
    if (!entered) return false;
    checkFullscreenChatFold();
    let retries = 0;
    const guardEnd = Date.now() + 8e3;
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
  var escBound = false;
  function initAutoFullMode() {
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
  var wheelBound = false;
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
  function initWheelVolume() {
    if (wheelBound) return;
    wheelBound = true;
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
  }
  var SYNC_ICON = `
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M938.1888 534.016h-80.7936c0.4096-7.3728 0.6144-14.6432 0.6144-22.016 0-218.624-176.8448-400.7936-389.12-400.7936C257.024 111.2064 80.6912 293.1712 80.6912 512c0 218.7264 176.4352 400.7936 388.1984 400.7936 74.752 0 149.0944-22.016 208.1792-60.0064l42.7008 68.608c-75.0592 48.9472-161.9968 74.8544-250.7776 74.752C209.8176 996.1472 0 779.264 0 512S209.8176 27.8528 468.8896 27.8528C728.3712 27.8528 938.7008 244.736 938.7008 512c0 7.3728-0.2048 14.6432-0.512 22.016z m-26.4192-158.1056L426.7008 556.032V291.9424h64v226.5088L689.5616 635.904l-38.912 58.7776z m245.3504-6.656L768 512h256L896 688.0256z" fill="#fff"/>
</svg>`;
  function findRefreshSlot(left) {
    if (!left) return null;
    const byText = Array.from(left.children).find(
      (el) => (el.textContent || "").trim().startsWith("\u5237\u65B0")
    );
    if (byText) return byText;
    const second = left.children[1];
    return second && second.querySelector("svg") ? second : null;
  }
  function createSyncTimeButton() {
    const btn = document.createElement("div");
    btn.className = "dyex-sync-time";
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", "\u540C\u6B65\u65F6\u95F4");
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
      if (existing.previousElementSibling !== slot) slot.insertAdjacentElement("afterend", existing);
      return true;
    }
    slot.insertAdjacentElement("afterend", createSyncTimeButton());
    return true;
  }
  var lastSyncAt = 0;
  function syncToLive() {
    if (Date.now() - lastSyncAt < 1500) return false;
    lastSyncAt = Date.now();
    const proxy = getPlayerProxy();
    if (proxy && typeof proxy.refresh === "function") {
      try {
        proxy.refresh();
        return true;
      } catch (_) {
      }
    }
    const slot = findRefreshSlot(document.querySelector(".douyin-player-controls-left"));
    const refreshIcon = slot && (slot.querySelector("svg") || slot);
    if (refreshIcon && triggerClick(refreshIcon)) return true;
    const video = document.querySelector(".douyin-player video");
    if (video && video.buffered && video.buffered.length) {
      try {
        video.currentTime = video.buffered.end(video.buffered.length - 1);
        return true;
      } catch (_) {
      }
    }
    return false;
  }
  var syncTimer = null;
  function initSyncTime() {
    injectStyle("dyex-sync-time", SYNC_TIME_CSS);
    ensureSyncTimeButton();
    clearInterval(syncTimer);
    syncTimer = setInterval(ensureSyncTimeButton, 1200);
  }
  var DANMAKU_ICON = '[data-e2e="danmaku-setting-icon"]';
  var GIFT_ICON = '[data-e2e="gift-setting"]';
  var ON_COLOR = "rgb(254, 44, 85)";
  function hover(el, type) {
    const isEnter = type === "mouseover";
    const fire = (Ctor, eventType, opts) => {
      try {
        el.dispatchEvent(new Ctor(eventType, opts));
      } catch (_) {
      }
    };
    const base = { bubbles: true, cancelable: true, view: win };
    fire(PointerEvent, isEnter ? "pointerover" : "pointerout", base);
    fire(MouseEvent, type, base);
    fire(MouseEvent, isEnter ? "mouseenter" : "mouseleave", {
      bubbles: false,
      cancelable: false,
      view: win
    });
  }
  async function withPopup(selector, fn) {
    const icon = await waitFor(selector, 1e4);
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
  var isOn = (sw) => !!sw && getComputedStyle(sw).backgroundColor === ON_COLOR;
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
  async function waitForDanmakuSwitch(text, timeout = 2e3) {
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
  async function applyDanmakuSwitches(wantGift, wantLucky) {
    const only = async (text, want) => want === null || want === void 0 ? null : setSwitch(await waitForDanmakuSwitch(text), want);
    return withPopup(DANMAKU_ICON, async () => ({
      gift: await only("\u9001\u793C\u4FE1\u606F", wantGift),
      lucky: await only("\u798F\u888B\u53E3\u4EE4", wantLucky)
    }));
  }
  async function applyEffectSwitch(want) {
    return withPopup(
      GIFT_ICON,
      async () => setSwitch(await waitFor('[data-e2e="effect-switch"] > div', 2e3, 100), want)
    );
  }
  var simpleBusy = false;
  async function syncSimpleSwitches() {
    if (simpleBusy || !getSettings().simpleMode) return;
    if (!await waitFor(DANMAKU_ICON, 15e3)) return;
    simpleBusy = true;
    try {
      const dm = await applyDanmakuSwitches(false, false);
      const fx = await applyEffectSwitch(true);
      const changed = dm && (dm.gift && dm.gift.before !== dm.gift.after || dm.lucky && dm.lucky.before !== dm.lucky.after) || fx && fx.before !== fx.after;
      if (changed && !getSettings().simpleRestore) {
        setSetting("simpleRestore", {
          gift: dm && dm.gift ? dm.gift.before : null,
          lucky: dm && dm.lucky ? dm.lucky.before : null,
          effect: fx ? fx.before : null
        });
      }
    } finally {
      simpleBusy = false;
    }
  }
  async function restoreSimpleSwitches() {
    const prev = getSettings().simpleRestore;
    if (!prev) return;
    if (!await waitFor(DANMAKU_ICON, 15e3)) return;
    await applyDanmakuSwitches(prev.gift, prev.lucky);
    if (prev.effect !== null && prev.effect !== void 0) await applyEffectSwitch(!!prev.effect);
    setSetting("simpleRestore", null);
  }
  function applySimpleMode() {
    const on = getSettings().simpleMode;
    injectStyle("dyex-simple-mode", on ? SIMPLE_CSS : "");
    syncCartHider();
    if (on) syncSimpleSwitches();
    else restoreSimpleSwitches();
  }
  function initSimpleMode() {
    applySimpleMode();
    onSettingChange((key) => {
      if (key === "simpleMode") applySimpleMode();
    });
  }

  // src/packages/Panel/Panel.js
  var BALL_SVG = `<svg viewBox="0 0 108 108" xmlns="http://www.w3.org/2000/svg">
<circle cx="54" cy="54" r="50" fill="#16161a"/><path d="M54 6a48 48 0 0 0-48 48h30a18 18 0 0 1 36 0h30A48 48 0 0 0 54 6z" fill="#fe2c55"/>
<circle cx="54" cy="54" r="18" fill="#fff" stroke="#16161a" stroke-width="6"/></svg>`;
  var CHECKS = [
    ["autoQuality", "\u81EA\u52A8\u6700\u9AD8\u753B\u8D28"],
    ["autoWebFull", "\u8FDB\u623F\u81EA\u52A8\u7F51\u9875\u5168\u5C4F"],
    ["autoFull", "\u8FDB\u623F\u81EA\u52A8\u5B8C\u5168\u5168\u5C4F"],
    ["fullscreenFoldChat", "\u5168\u5C4F\u65F6\u81EA\u52A8\u6298\u53E0\u8BC4\u8BBA\u533A"],
    ["hideGiftBar", "\u9690\u85CF\u5E95\u90E8\u793C\u7269\u680F"],
    ["wheelVolume", "\u64AD\u653E\u5668\u5185\u6EDA\u8F6E\u8C03\u97F3\u91CF"],
    ["simpleMode", "\u7B80\u6D01\u6A21\u5F0F\uFF08\u9690\u85CF\u6A2A\u5E45/\u5C0F\u9EC4\u8F66/\u699C\u5355\u5165\u53E3\uFF09"],
    ["autoLottery", "\u81EA\u52A8\u62A2\u514D\u8D39\u798F\u888B\uFF08\u8BC4\u8BBA/\u65E0\u95E8\u69DB/\u770B\u64AD\u8FBE\u6807\uFF0C\u8DF3\u8FC7\u4ED8\u8D39\u7C89\u4E1D\u56E2\uFF09"],
    ["autoLotteryFollow", "\u62A2\u798F\u888B\u65F6\u5141\u8BB8\u81EA\u52A8\u5173\u6CE8\u4E3B\u64AD"],
    ["danmakuTakeover", "\u63A5\u7BA1\u60AC\u6D6E\u5F39\u5E55\uFF08\u753B\u9762\u5F39\u5E55 +1 \u4E0E\u5C4F\u853D\uFF09"],
    ["plus1", "\u5F39\u5E55 +1\uFF08\u60AC\u505C\u663E\u793A\uFF09"],
    ["shieldEnter", "\u5C4F\u853D\u8FDB\u573A\u6D88\u606F"],
    ["shieldRepeat", "\u5C4F\u853D\u91CD\u590D\u5F39\u5E55\uFF0810 \u79D2\u5185\uFF09"],
    ["chatHistoryKeys", "\u8F93\u5165\u6846\u4E0A\u4E0B\u952E\u8C03\u53D6\u5DF2\u53D1\u9001\u7684\u5F39\u5E55"]
  ];
  function checkRow(key, label) {
    return `<label><input type="checkbox" data-key="${key}"> ${label}</label>`;
  }
  var favOpen = false;
  function buildHtml() {
    return `
  <h4>\u76F4\u64AD\u6D41</h4>
  <div class="dyex-row" id="dyex-stream-btns"></div>
  <div class="dyex-tip">\u70B9\u51FB\u590D\u5236\u5730\u5740\uFF0C\u53EF\u7528 PotPlayer / VLC \u6253\u5F00</div>
  <h4>\u64AD\u653E\u4E0E\u754C\u9762</h4>
  ${CHECKS.slice(0, 9).map(([k, l]) => checkRow(k, l)).join("")}
  <h4>\u5F39\u5E55\uFF08\u753B\u9762\u4E0A\u6F02\u6D6E\u7684\u5F39\u5E55\uFF09</h4>
  ${CHECKS.slice(9).map(([k, l]) => checkRow(k, l)).join("")}
  ${checkRow("dmAvoidOverlap", "\u5BC6\u96C6\u65F6\u4F18\u5148\u51CF\u5C11\u91CD\u53E0\uFF08\u6324\u4E0D\u4E0B\u7684\u5F39\u5E55\u76F4\u63A5\u4E22\u5F03\uFF09")}
  <div class="dyex-row">\u5C4F\u853D\u7B49\u7EA7\u4F4E\u4E8E
    <input type="number" min="0" max="80" data-key="shieldLevelBelow" data-num="1"> \u7684\u7528\u6237\uFF080=\u4E0D\u9650\uFF09
  </div>
  <div class="dyex-tip">\u5173\u952E\u8BCD\u5C4F\u853D\uFF08\u4E00\u884C\u4E00\u6761\uFF0C/\u6B63\u5219/ \u4EA6\u53EF\uFF09</div>
  <textarea data-key="shieldKeywords" placeholder="\u4F8B\u5982\uFF1A\u5237\u5C4F&#10;/^6{3,}$/"></textarea>
  <div class="dyex-tip">\u4EE5\u4E0B\u5C4F\u853D\u540C\u65F6\u4F5C\u7528\u4E8E\u753B\u9762\u60AC\u6D6E\u5F39\u5E55\u4E0E\u53F3\u4FA7\u804A\u5929\u5217\u8868</div>
  <h4 class="dyex-fold" id="dyex-fav-toggle">
    <span class="dyex-fold-arrow">\u25B8</span>\u5F39\u5E55\u6536\u85CF
    <span class="dyex-tip" id="dyex-fav-count"></span>
  </h4>
  <div class="dyex-fold-body" id="dyex-fav-body">
    <div class="dyex-row"><input type="text" class="dyex-grow" id="dyex-fav-search" placeholder="\u641C\u7D22\u6536\u85CF"></div>
    <div class="dyex-row">
      <input type="text" class="dyex-grow" id="dyex-fav-new" placeholder="\u624B\u52A8\u6DFB\u52A0\u4E00\u6761\u6536\u85CF">
      <button id="dyex-fav-add">\u6DFB\u52A0</button>
    </div>
    <div class="dyex-fav-list" id="dyex-fav-list"></div>
    <div class="dyex-row"><button class="is-secondary" id="dyex-fav-clear">\u6E05\u7A7A\u6536\u85CF</button></div>
    <div class="dyex-tip">\u60AC\u505C\u753B\u9762\u5F39\u5E55\u6216\u53F3\u4FA7\u804A\u5929\u6761\u76EE\u70B9\u300C\u6536\u85CF\u300D\u5373\u53EF\u52A0\u5165\uFF1B\u70B9\u5217\u8868\u6587\u5B57\u586B\u5145\u5230\u53D1\u9001\u6846</div>
  </div>
  <h4>\u5FAA\u73AF\u53D1\u9001\u5F39\u5E55\uFF08\u9700\u767B\u5F55\uFF09</h4>
  <textarea data-key="loopTexts" placeholder="\u4E00\u884C\u4E00\u6761"></textarea>
  <div class="dyex-row">\u95F4\u9694
    <input type="number" min="1000" step="500" data-key="loopMin" data-num="1">~
    <input type="number" min="1000" step="500" data-key="loopMax" data-num="1"> ms
  </div>
  <div class="dyex-row">\u9650\u65F6 <input type="number" min="1" data-key="loopLimitMin" data-num="1"> \u5206\u949F
    <label><input type="checkbox" data-key="loopRandom"> \u968F\u673A</label>
  </div>
  <div class="dyex-row"><button id="dyex-loop-toggle">\u5F00\u59CB\u53D1\u9001</button>
    <button class="is-secondary" id="dyex-quality-now">\u7ACB\u5373\u5207\u6700\u9AD8\u753B\u8D28</button></div>`;
  }
  function syncInputs(panel) {
    const s = getSettings();
    panel.querySelectorAll("[data-key]").forEach((el) => {
      const v = s[el.dataset.key];
      if (el.type === "checkbox") el.checked = !!v;
      else el.value = v ?? "";
    });
  }
  function favoriteRow(text) {
    const row = document.createElement("div");
    row.className = "dyex-fav-item";
    const label = document.createElement("span");
    label.className = "dyex-fav-text";
    label.textContent = text;
    label.title = "\u70B9\u51FB\u586B\u5145\u5230\u53D1\u9001\u6846";
    label.addEventListener("click", () => {
      const ok = fillChat(text);
      toast(ok ? "\u5DF2\u586B\u5145\u5230\u53D1\u9001\u6846" : "\u586B\u5145\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u6296\u97F3\uFF0C\u4E14\u804A\u5929\u8F93\u5165\u6846\u53EF\u7528", ok ? "success" : "error");
    });
    const send = document.createElement("button");
    send.textContent = "\u53D1\u9001";
    send.title = "\u76F4\u63A5\u53D1\u9001\u8FD9\u6761\u6536\u85CF";
    send.addEventListener("click", async () => {
      const ok = await sendChat(text);
      if (!ok) toast("\u53D1\u9001\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u6296\u97F3\uFF0C\u4E14\u804A\u5929\u8F93\u5165\u6846\u53EF\u7528", "error");
    });
    const del = document.createElement("button");
    del.className = "is-secondary";
    del.textContent = "\u5220\u9664";
    del.title = "\u4ECE\u6536\u85CF\u4E2D\u5220\u9664";
    del.addEventListener("click", () => {
      setSetting("dmFavorites", removeFavorite(getSettings().dmFavorites, text));
    });
    row.append(label, send, del);
    return row;
  }
  function renderFavorites(panel) {
    const list = getSettings().dmFavorites;
    const box = panel.querySelector("#dyex-fav-list");
    const shown = filterFavorites(list, panel.querySelector("#dyex-fav-search").value);
    box.replaceChildren();
    if (!shown.length) {
      const tip = document.createElement("div");
      tip.className = "dyex-tip";
      tip.textContent = list.length ? "\u6CA1\u6709\u5339\u914D\u7684\u6536\u85CF" : "\u6682\u65E0\u6536\u85CF";
      box.append(tip);
    } else {
      for (const text of shown) box.append(favoriteRow(text));
    }
    panel.querySelector("#dyex-fav-count").textContent = list.length ? `\u5171 ${list.length} \u6761` : "";
  }
  function addFavoriteFromInput(panel) {
    const input = panel.querySelector("#dyex-fav-new");
    const text = input.value;
    const list = getSettings().dmFavorites;
    if (!text.trim()) return;
    if (hasFavorite(list, text)) {
      input.value = "";
      toast("\u8FD9\u6761\u5F39\u5E55\u5DF2\u5728\u6536\u85CF\u4E2D");
      return;
    }
    setSetting("dmFavorites", addFavorite(list, text));
    input.value = "";
    toast("\u5DF2\u6DFB\u52A0\u5230\u6536\u85CF", "success");
  }
  function clearFavorites() {
    const list = getSettings().dmFavorites;
    if (!list.length) return;
    if (typeof confirm === "function" && !confirm(`\u786E\u5B9A\u6E05\u7A7A\u5168\u90E8 ${list.length} \u6761\u5F39\u5E55\u6536\u85CF\uFF1F`)) return;
    setSetting("dmFavorites", []);
    toast("\u5DF2\u6E05\u7A7A\u6536\u85CF");
  }
  function renderStreamButtons(panel) {
    const box = panel.querySelector("#dyex-stream-btns");
    const items = getStreamMenuItems();
    if (!items.length) {
      box.innerHTML = '<span class="dyex-tip">\u6682\u672A\u83B7\u53D6\u5230\u6D41\u5730\u5740\uFF08\u672A\u5F00\u64AD\u6216\u6570\u636E\u672A\u5C31\u7EEA\uFF09</span>';
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
    const left = placeLeft ? clamp(br.left - pw - 10, 8, vw - pw - 8) : clamp(br.right + 10, 8, vw - pw - 8);
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
      } catch (_) {
      }
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
      } catch (_) {
      }
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
  function initPanel() {
    document.getElementById("dyex-ball")?.remove();
    document.getElementById("dyex-panel")?.remove();
    injectStyle("dyex-style", Panel_default);
    const ball = document.createElement("div");
    ball.id = "dyex-ball";
    ball.title = "DouyinEX\uFF08\u53EF\u62D6\u62FD\u79FB\u52A8\uFF09";
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
        renderFavorites(panel);
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
      if (key === "dmFavorites" && panel.classList.contains("is-open")) {
        renderFavorites(panel);
      }
    });
    const loopBtn = panel.querySelector("#dyex-loop-toggle");
    loopBtn.addEventListener("click", () => isLoopRunning() ? stopLoop() : startLoop());
    onLoopState((on) => loopBtn.textContent = on ? "\u505C\u6B62\u53D1\u9001" : "\u5F00\u59CB\u53D1\u9001");
    panel.querySelector("#dyex-quality-now").addEventListener("click", () => autoHighestQuality());
    const favToggle = panel.querySelector("#dyex-fav-toggle");
    const favBody = panel.querySelector("#dyex-fav-body");
    const applyFavOpen = () => {
      favToggle.classList.toggle("is-open", favOpen);
      favBody.classList.toggle("is-open", favOpen);
    };
    favToggle.addEventListener("click", () => {
      favOpen = !favOpen;
      applyFavOpen();
      if (panel.classList.contains("is-open")) positionPanel(ball, panel);
    });
    applyFavOpen();
    panel.querySelector("#dyex-fav-search").addEventListener("input", () => renderFavorites(panel));
    panel.querySelector("#dyex-fav-add").addEventListener("click", () => addFavoriteFromInput(panel));
    panel.querySelector("#dyex-fav-new").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      addFavoriteFromInput(panel);
    });
    panel.querySelector("#dyex-fav-clear").addEventListener("click", clearFavorites);
    renderFavorites(panel);
    return { toggle };
  }

  // src/lib/filter.js
  function parseKeywords(raw) {
    return String(raw || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^\/(.+)\/([gimsuy]*)$/);
      if (m) {
        try {
          return { type: "re", re: new RegExp(m[1], m[2].replace("g", "")) };
        } catch {
        }
      }
      return { type: "str", text: s };
    });
  }
  function matchKeywords(text, rules3) {
    for (const r of rules3) {
      if (r.type === "re" ? r.re.test(text) : text.includes(r.text)) return true;
    }
    return false;
  }
  function parseLevelFromSrc(src) {
    const m = String(src || "").match(/user_grade_level_v\d+_(\d+)/);
    return m ? Number(m[1]) : null;
  }
  function createRepeatFilter(windowMs = 1e4, max = 200) {
    const seen = /* @__PURE__ */ new Map();
    return function isRepeat3(text, now = Date.now()) {
      for (const [k, t] of seen) {
        if (now - t > windowMs) seen.delete(k);
      }
      if (seen.size > max) seen.clear();
      const hit = seen.has(text);
      seen.set(text, now);
      return hit;
    };
  }

  // src/packages/Chat/collect.js
  function collectDanmaku(text) {
    const value = String(text == null ? "" : text).trim();
    if (!value) return false;
    const list = getSettings().dmFavorites;
    if (hasFavorite(list, value)) {
      toast("\u8FD9\u6761\u5F39\u5E55\u5DF2\u5728\u6536\u85CF\u4E2D");
      return false;
    }
    setSetting("dmFavorites", addFavorite(list, value));
    toast("\u5DF2\u6536\u85CF\u5F39\u5E55", "success");
    return true;
  }
  function makeFavoriteButton(className, text) {
    const btn = document.createElement("span");
    btn.className = className;
    btn.setAttribute("data-dyex-btn", "fav");
    btn.textContent = "\u6536\u85CF";
    btn.title = "\u6536\u85CF\u8FD9\u6761\u5F39\u5E55\uFF08\u53EF\u5728 DouyinEX \u9762\u677F\u7684\u5F39\u5E55\u6536\u85CF\u4E2D\u67E5\u770B\uFF09";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      collectDanmaku(typeof text === "function" ? text(e) : text);
    });
    return btn;
  }

  // src/packages/Chat/Shield.js
  var ITEM = ".webcast-chatroom___item";
  var SYSTEM_MSG = ".webcast-chatroom__room-message";
  var PLUS_CLASS = "dyex-plus1";
  var FAV_CLASS = "dyex-fav";
  var BTN_ATTR = "data-dyex-btn";
  var rules = [];
  var rulesRaw = null;
  var isRepeat = createRepeatFilter(1e4);
  function refreshRules() {
    const raw = getSettings().shieldKeywords;
    if (raw !== rulesRaw) {
      rulesRaw = raw;
      rules = parseKeywords(raw);
    }
  }
  function getItemText(item) {
    const clone = item.cloneNode(true);
    clone.querySelectorAll(`[${BTN_ATTR}]`).forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }
  function getContentOnly(text) {
    const m = text.match(/^[^：:]{1,40}[：:]\s*(.+)$/);
    return m ? m[1] : text;
  }
  function isGiftMessage(item) {
    if (item.querySelector(".webcast-chatroom___content-with-emoji-text")) return false;
    return /[：:]\s*(送出了|赠送了|送给)/.test(getItemText(item));
  }
  function hideItem(item) {
    item.style.display = "none";
    item.setAttribute(HIDDEN_ATTR, "1");
  }
  function shouldHide(item) {
    if (item.matches(SYSTEM_MSG) || item.querySelector(SYSTEM_MSG)) return false;
    const s = getSettings();
    const text = getItemText(item);
    if (s.simpleMode && isGiftMessage(item)) return true;
    if (s.shieldEnter && /来了$/.test(text)) return true;
    if (s.shieldLevelBelow > 0) {
      const img = item.querySelector('img[src*="user_grade_level"]');
      const level = img ? parseLevelFromSrc(img.getAttribute("src")) : null;
      if (level !== null && level < s.shieldLevelBelow) return true;
    }
    const content = getContentOnly(text);
    if (rules.length && matchKeywords(content, rules)) return true;
    if (s.shieldRepeat && isRepeat(content)) return true;
    return false;
  }
  function textAtEvent(e, fallback) {
    const node = e && e.currentTarget;
    const item = node && node.closest ? node.closest(ITEM) : null;
    if (!item) return fallback;
    const text = getContentOnly(getItemText(item));
    return text || fallback;
  }
  function addButtons(item) {
    if (item.querySelector(`[${BTN_ATTR}]`)) return;
    if (isGiftMessage(item)) return;
    const itemText = getItemText(item);
    const text = getContentOnly(itemText);
    if (!text || /来了$/.test(itemText)) return;
    if (getSettings().plus1) {
      const plus = document.createElement("span");
      plus.className = PLUS_CLASS;
      plus.setAttribute(BTN_ATTR, "plus");
      plus.textContent = "+1";
      plus.title = "\u8DDF\u53D1\u8FD9\u6761\u5F39\u5E55";
      plus.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await sendChat(textAtEvent(e, text));
        if (!ok) toast("\u53D1\u9001\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u6296\u97F3\uFF0C\u4E14\u804A\u5929\u8F93\u5165\u6846\u53EF\u7528", "error");
      });
      item.appendChild(plus);
    }
    item.appendChild(makeFavoriteButton(FAV_CLASS, (e) => textAtEvent(e, text)));
  }
  var HIDDEN_ATTR = "data-dyex-hidden";
  var handled = /* @__PURE__ */ new WeakSet();
  function processItem(item) {
    if (handled.has(item)) return;
    handled.add(item);
    refreshRules();
    if (shouldHide(item)) {
      hideItem(item);
      return;
    }
    addButtons(item);
  }
  function rescanAll() {
    handled = /* @__PURE__ */ new WeakSet();
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
      el.style.display = "";
      el.removeAttribute(HIDDEN_ATTR);
    });
    document.querySelectorAll(`[${BTN_ATTR}]`).forEach((el) => el.remove());
    document.querySelectorAll(ITEM).forEach(processItem);
  }
  var RESCAN_KEYS = /* @__PURE__ */ new Set([
    "shieldKeywords",
    "shieldLevelBelow",
    "shieldEnter",
    "shieldRepeat",
    "plus1",
    "simpleMode"
  ]);
  function scan(node) {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(ITEM)) processItem(node);
    node.querySelectorAll?.(ITEM).forEach(processItem);
  }
  async function initChatShield() {
    const list = await waitFor(".webcast-chatroom___list", 3e4);
    if (!list) return;
    list.querySelectorAll(ITEM).forEach(processItem);
    onSettingChange((key) => {
      if (RESCAN_KEYS.has(key)) rescanAll();
    });
    new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach(scan);
    }).observe(list, { childList: true, subtree: true });
  }

  // src/packages/Chat/History.js
  var ZERO_WIDTH2 = String.fromCharCode(8203);
  var INPUT_BOX = ".webcast-chatroom___input-container";
  var USER_EDIT_MS = 300;
  var WRITE_DEBOUNCE_MS = 50;
  var REPEAT_MIN_MS = 150;
  var bound = false;
  var browseIndex = null;
  var applied = null;
  var tracked = "";
  var userDeletedAt = 0;
  var writeTimer = null;
  var lastStepAt = 0;
  function editorText(el) {
    return el.innerText.split(ZERO_WIDTH2).join("").replace(/\s+/g, " ").trim();
  }
  function resetBrowse() {
    browseIndex = null;
    applied = null;
  }
  function stepIndex(dir, length) {
    return nextHistoryIndex(browseIndex, length, dir);
  }
  function flushWrite(el) {
    writeTimer = null;
    if (browseIndex === null) {
      const now2 = editorText(el);
      if (now2 === "" || now2 === applied) setEditorText(el, "");
      applied = null;
      return;
    }
    const list = getSettings().chatHistory;
    const target = list[browseIndex];
    const now = editorText(el);
    if (target === void 0 || now !== "" && now !== applied) {
      resetBrowse();
      return;
    }
    setEditorText(el, target);
    applied = target;
  }
  function scheduleWrite(el) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => flushWrite(el), WRITE_DEBOUNCE_MS);
  }
  function trackText() {
    const el = findChatInput();
    const now = el ? editorText(el) : "";
    if (now === tracked) return;
    const prev = tracked;
    tracked = now;
    if (!prev || now) return;
    if (isSelfSendRecent()) return;
    if (Date.now() - userDeletedAt < USER_EDIT_MS) return;
    recordSent(prev);
  }
  function onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    const target = e.target;
    const el = target && target.closest ? target.closest(CHAT_EDITOR) : null;
    if (!el) return;
    if (e.key === "Backspace" || e.key === "Delete" || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
      userDeletedAt = Date.now();
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (!getSettings().chatHistoryKeys) return;
    const list = getSettings().chatHistory;
    if (!list.length) return;
    const dir = e.key === "ArrowUp" ? -1 : 1;
    const text = editorText(el);
    const writing = writeTimer !== null;
    const browsing = browseIndex !== null && (text === applied || writing && text === "");
    if (dir < 0) {
      if (!browsing && text !== "") return;
    } else if (!browsing) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (e.repeat && now - lastStepAt < REPEAT_MIN_MS) return;
    lastStepAt = now;
    if (!browsing) resetBrowse();
    browseIndex = stepIndex(dir, list.length);
    scheduleWrite(el);
  }
  async function startTracker() {
    const box = await waitFor(INPUT_BOX, 6e4);
    if (!box) return;
    new MutationObserver(trackText).observe(box, {
      childList: true,
      subtree: true,
      characterData: true
    });
    trackText();
  }
  function initChatHistory() {
    if (bound) return;
    bound = true;
    document.addEventListener("keydown", onKeyDown, true);
    startTracker();
  }

  // src/packages/Danmaku/Layer.js
  var LAYER_ID = "dyex-dm-layer";
  var ITEM_CLS = "dyex-dm-item";
  var TEXT_CLS = "dyex-dm-text";
  var ACTIONS_CLS = "dyex-dm-actions";
  var PLUS_CLS = "dyex-dm-plus1";
  var FAV_CLS = "dyex-dm-fav";
  var PLUGIN = ".CanvasDanmakuPlugin";
  var MAX_ITEMS = 300;
  var LANE_GAP_MS = 300;
  var HOVER_GRACE_MS = 180;
  var NATIVE_STYLE_ID = "dyex-dm-native-off";
  var NATIVE_HIDDEN_CSS = ".CanvasDanmakuPlugin canvas, canvas.CanvasDanmakuPlugin, #DanmakuLayout canvas { visibility: hidden !important; pointer-events: none !important; }";
  var hookedInst = null;
  var hookedBus = null;
  var nativeCfg = null;
  var users = /* @__PURE__ */ new Map();
  var isRepeat2 = createRepeatFilter(1e4);
  var rules2 = [];
  var rulesRaw2 = null;
  var lanes = [];
  var laneKey = "";
  var hoverEl = null;
  var leaveTimer = null;
  function refreshRules2() {
    const raw = getSettings().shieldKeywords;
    if (raw !== rulesRaw2) {
      rulesRaw2 = raw;
      rules2 = parseKeywords(raw);
    }
  }
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
    inst.send = function(payload) {
      if (!getSettings().danmakuTakeover) return orig.call(this, payload);
      queueMicrotask(() => {
        let handled2 = false;
        try {
          handled2 = accept(payload);
        } catch (e) {
          handled2 = false;
        }
        if (!handled2) {
          try {
            orig.call(inst, payload);
          } catch (e) {
          }
        }
      });
    };
  }
  function shouldHide2(text, level) {
    const s = getSettings();
    if (s.shieldLevelBelow > 0 && level !== null && Number.isFinite(level) && level < s.shieldLevelBelow) {
      return true;
    }
    if (rules2.length && matchKeywords(text, rules2)) return true;
    if (s.shieldRepeat && isRepeat2(text)) return true;
    return false;
  }
  function accept(payload) {
    if (!getSettings().danmakuTakeover) return false;
    const b = extractBarrage(payload);
    if (!b.text && !b.hasImage) return false;
    if (b.isGift) {
      if (getSettings().simpleMode) return true;
      return renderItem(payload, b.content, b.text, b.isSelf, false);
    }
    if (!b.text) {
      return renderItem(payload, b.content, "", b.isSelf, false);
    }
    refreshRules2();
    const u = users.get(b.id);
    const level = u ? Number(u.level) : null;
    if (!b.isSelf && shouldHide2(b.text, level)) return true;
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
    btn.title = "\u8DDF\u53D1\u8FD9\u6761\u5F39\u5E55";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await sendChat(text);
      if (!ok) toast("\u53D1\u9001\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u6296\u97F3\uFF0C\u4E14\u804A\u5929\u8F93\u5165\u6846\u53EF\u7528", "error");
    });
    return btn;
  }
  function clampNum2(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }
  function currentStyle() {
    const s = getSettings();
    const area = resolveArea(s.dmArea);
    const n = nativeCfg;
    const nativeFont = n && Number(n.fontSize);
    const fontSize = Number.isFinite(nativeFont) && nativeFont > 0 ? Math.round(clampNum2(nativeFont, 8, 80)) : Math.round(clampNum2(Number(s.dmFontSize) || 20, 8, 80));
    const nativeOpacity = n && Number(n.opacity);
    const opacity = Number.isFinite(nativeOpacity) ? clampNum2(nativeOpacity, 0.05, 1) : clampNum2((Number(s.dmOpacity) || 80) / 100, 0.05, 1);
    const nativeMs = n && Number(n.speed);
    const speedMs = Number.isFinite(nativeMs) && nativeMs > 0 ? clampSpeedMs(nativeMs) : null;
    const nativeStart = n && n.area && Number.isFinite(Number(n.area.start)) ? clampNum2(Number(n.area.start), 0, 0.9) : area.start;
    const nativeRate = n && Number(n.maxHeightRate);
    const hasNativeArea = Number.isFinite(nativeRate) && nativeRate > 0 || n && n.area && Number.isFinite(Number(n.area.end));
    const areaEnd = hasNativeArea ? clampNum2(nativeStart + (Number.isFinite(nativeRate) && nativeRate > 0 ? nativeRate : Number(n.area.end)), 0.1, 1) : area.end;
    return { fontSize, opacity, speedMs, fallbackPps: speedLevelToPps(s.dmSpeed), areaStart: nativeStart, areaEnd };
  }
  function cancelLeave() {
    if (!leaveTimer) return;
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  function beginHover(layer, el, anim) {
    if (hoverEl && !hoverEl.isConnected) hoverEl = null;
    if (hoverEl === el) {
      cancelLeave();
      return;
    }
    if (hoverEl) return;
    cancelLeave();
    hoverEl = el;
    el.classList.add("is-hover");
    layer.classList.add("is-hovering");
    anim.pause();
  }
  function endHover(layer, el, anim) {
    cancelLeave();
    if (hoverEl !== el) return;
    hoverEl = null;
    el.classList.remove("is-hover");
    layer.classList.remove("is-hovering");
    if (anim.playState === "paused") anim.play();
  }
  function scheduleEndHover(layer, el, anim) {
    if (hoverEl !== el) return;
    cancelLeave();
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      endHover(layer, el, anim);
    }, HOVER_GRACE_MS);
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
    const body = document.createElement("span");
    body.className = TEXT_CLS;
    for (const p of parts) {
      if (p.type === "text" && p.text) body.append(document.createTextNode(p.text));
      else if (p.type === "image" && p.src) {
        const img = document.createElement("img");
        img.src = p.src;
        img.alt = "";
        body.append(img);
      }
    }
    el.append(body);
    if (allowPlus1 && text) {
      const actions = document.createElement("span");
      actions.className = ACTIONS_CLS;
      if (getSettings().plus1) actions.append(makePlusBtn(text));
      actions.append(makeFavoriteButton(FAV_CLS, text));
      el.append(actions);
    }
    layer.append(el);
    const cw = layer.clientWidth || 1;
    const ch = layer.clientHeight || 1;
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
    const now = Date.now();
    const { lane, startAt, drop } = pickLane({
      lanes,
      now,
      avoidOverlap: !!getSettings().dmAvoidOverlap
    });
    if (drop) {
      el.remove();
      return true;
    }
    el.style.top = `${Math.round(start + lane * laneH)}px`;
    const duration = st.speedMs ? Math.max(1e3, st.speedMs) : Math.max(1500, (cw + width) / st.fallbackPps * 1e3);
    const pps = (cw + width) / (duration / 1e3);
    lanes[lane] = Math.max(lanes[lane] || 0, startAt + reserveWidth / pps * 1e3 + LANE_GAP_MS);
    const anim = el.animate(
      [{ transform: `translateX(${cw}px)` }, { transform: `translateX(${-width}px)` }],
      // delay + fill: both：排队期间停在屏幕右侧外（layer 已 overflow: hidden），到点才出发
      { duration, delay: startAt - now, easing: "linear", fill: "both" }
    );
    anim.onfinish = () => {
      endHover(layer, el, anim);
      el.remove();
    };
    el.addEventListener("mouseenter", () => beginHover(layer, el, anim));
    el.addEventListener("mouseleave", () => scheduleEndHover(layer, el, anim));
    return true;
  }
  function clearLayer() {
    const layer = document.getElementById(LAYER_ID);
    if (layer) {
      layer.replaceChildren();
      layer.classList.remove("is-hovering");
    }
    cancelLeave();
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
      el.textContent = "";
    }
  }
  function tick2() {
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
      if (getSettings().danmakuTakeover && inst) {
        ensureLayer();
        setNativeHidden(true);
      } else {
        setNativeHidden(false);
      }
    } catch (e) {
    }
  }
  function initDanmakuLayer() {
    tick2();
    setInterval(tick2, 1e3);
    onSettingChange((key, value) => {
      if (key !== "danmakuTakeover") return;
      if (!value) {
        clearLayer();
        setNativeHidden(false);
      } else {
        tick2();
      }
    });
  }

  // src/lib/lottery.js
  var COMMENT_BTN_RE = /^(?:点击|立即)?(?:发送口令|一键发送|一键评论|发表评论|发送评论|评论参与|评论并参与|一键评论参与|去发表评论|一键发评论|一键发表评论|发评论参与|发送评论参与|发评论参与福袋|一键发评论参与福袋)(?:并参与|参与福袋|参与抽奖|参与)?(?:[（(](?:自动发送|自动评论|发送口令)[）)])?[>›»]?$/;
  var DIRECT_JOIN_BTN_RE = /^(?:手动参与|立即参与|参与福袋|参与抽奖|一键参与|立即抽奖|免费参与|抢福袋|报名)$/;
  var FOLLOW_BTN_RE = /^(?:关注|去关注|关注主播|关注参与|关注并参与|立即关注)(?:参与福袋|参与)?$/;
  var JOINED_BTN_RE = /^(?:已参与|已成功参与|等待开奖|参与成功|报名成功)$/;
  var PAID_BTN_RE = /粉丝团|灯牌|钻石|钻|抖币|付费|充值|升级|亲密度/;
  function compact(text) {
    return String(text || "").replace(/\s+/g, "").trim();
  }
  function parseCountdownSeconds(text) {
    if (!text) return null;
    const s = String(text).trim();
    if (!s || s.includes("--:--")) return null;
    const m = s.match(/(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)/);
    if (!m) return null;
    const hours = m[1] ? parseInt(m[1], 10) : 0;
    const mins = parseInt(m[2], 10);
    const secs = parseInt(m[3], 10);
    if ([hours, mins, secs].some(Number.isNaN)) return null;
    const total = hours * 3600 + mins * 60 + secs;
    return total > 0 && total <= 7200 ? total : null;
  }
  function extractCommentCommand(text) {
    if (!text) return "";
    const raw = String(text).replace(/\s*(?:未达成|已达成|未完成|已完成)\s*$/, "").trim();
    const quoted = raw.match(/(?:发送|发表|评论|口令)[^\n“「"']{0,8}[“「"']([^”」"'\n]{1,100})[”」"']/);
    if (quoted) return quoted[1].trim();
    const labelled = raw.match(/(?:发送评论|发表评论|发送口令|评论内容|口令|评论)\s*[：:]\s*([^\n]{1,100})/);
    if (labelled) return labelled[1].trim();
    return "";
  }
  function classifyConditionItem(item = {}) {
    const requirement = String(item.requirement || "").replace(/\s*(?:未达成|已达成|未完成|已完成)\s*$/, "").trim();
    const status = String(item.status || "").trim();
    const completed = status === "\u5DF2\u8FBE\u6210" || status === "\u5DF2\u5B8C\u6210";
    const cleanReq = compact(requirement);
    if (!cleanReq || cleanReq === "\u53C2\u4E0E\u6761\u4EF6") {
      return { type: "ignore", requirement, status, completed: true, command: "" };
    }
    if (cleanReq === "\u624B\u52A8\u53C2\u4E0E") {
      return { type: "manual", requirement, status, completed: true, command: "" };
    }
    if (/^(?:发送|发表|一键|去发表)?(?:评论|口令)|^发送[“「"':：]/.test(cleanReq)) {
      return {
        type: "comment",
        requirement,
        status,
        completed,
        command: extractCommentCommand(requirement)
      };
    }
    if (/粉丝团|灯牌|钻石|钻|抖币|亲密度|会员/.test(cleanReq)) {
      return { type: "fansclub", requirement, status, completed, command: "" };
    }
    if (/分享|转发/.test(cleanReq)) {
      return { type: "share", requirement, status, completed, command: "" };
    }
    if (/关注/.test(cleanReq)) {
      return { type: "follow", requirement, status, completed, command: "" };
    }
    if (/观看|看播|停留/.test(cleanReq)) {
      return { type: "watch", requirement, status, completed, command: "" };
    }
    return { type: "unknown", requirement, status, completed, command: "" };
  }
  function parseConditionsFromText(text) {
    if (!text) return [];
    const items = [];
    const re = /([^\n]+?)\s*(未达成|已达成|未完成|已完成)(?=\s|$)/g;
    for (const m of String(text).matchAll(re)) {
      const req = m[1].replace(/^[\s•·\-*]+/, "").trim();
      if (!req || req === "\u53C2\u4E0E\u6761\u4EF6") continue;
      items.push({ requirement: req, status: m[2] });
    }
    return items;
  }
  function isCommentJoinButtonText(text) {
    return COMMENT_BTN_RE.test(compact(text));
  }
  function isDirectJoinButtonText(text) {
    return DIRECT_JOIN_BTN_RE.test(compact(text));
  }
  function isFollowButtonText(text) {
    return FOLLOW_BTN_RE.test(compact(text));
  }
  function isPaidButtonText(text) {
    return PAID_BTN_RE.test(compact(text));
  }
  function evaluateLotteryEligibility({
    conditions = [],
    alreadyJoined = false,
    buttonText = "",
    allowFollow = false,
    remainingSeconds = null
  } = {}) {
    const cleanBtn = compact(buttonText);
    if (alreadyJoined || JOINED_BTN_RE.test(cleanBtn)) {
      return { action: "already_joined", command: "", reason: "\u672C\u8F6E\u5DF2\u53C2\u4E0E" };
    }
    if (isPaidButtonText(cleanBtn)) {
      return { action: "skip", command: "", reason: "\u6309\u94AE\u542B\u7C89\u4E1D\u56E2\u6216\u4ED8\u8D39\u5B57\u6837" };
    }
    const classified = conditions.map(classifyConditionItem).filter((c) => c.type !== "ignore" && c.type !== "manual");
    const blocked = classified.find(
      (c) => !c.completed && (c.type === "fansclub" || c.type === "share" || c.type === "unknown")
    );
    if (blocked) {
      const label = blocked.type === "fansclub" ? "\u9700\u4ED8\u8D39\u7C89\u4E1D\u56E2/\u706F\u724C" : blocked.type === "share" ? "\u9700\u5206\u4EAB\u76F4\u64AD\u95F4" : `\u542B\u672A\u652F\u6301\u6761\u4EF6\uFF08${blocked.requirement}\uFF09`;
      return { action: "skip", command: "", reason: label };
    }
    const needsFollow = classified.some((c) => c.type === "follow" && !c.completed);
    if (needsFollow && !allowFollow) {
      return { action: "skip", command: "", reason: "\u9700\u5173\u6CE8\u4E3B\u64AD\uFF08\u672A\u5F00\u542F\u81EA\u52A8\u5173\u6CE8\uFF09" };
    }
    const needsWatch = classified.some((c) => c.type === "watch" && !c.completed);
    if (needsWatch) {
      if (remainingSeconds !== null && remainingSeconds <= 25) {
        return { action: "skip", command: "", reason: "\u770B\u64AD\u65F6\u957F\u672A\u8FBE\u6210\u4E14\u4E34\u8FD1\u5F00\u5956" };
      }
      const retryDelaySec = remainingSeconds !== null ? Math.max(5, Math.min(60, remainingSeconds - 25)) : 30;
      return {
        action: "wait_watch",
        command: "",
        retryDelaySec,
        reason: "\u7B49\u5F85\u770B\u64AD\u65F6\u957F\u8FBE\u6807"
      };
    }
    const commentItem = classified.find((c) => c.type === "comment" && !c.completed) || classified.find((c) => c.type === "comment");
    const command = commentItem ? commentItem.command : "";
    if (needsFollow || classified.length === 0 && isFollowButtonText(cleanBtn)) {
      if (!allowFollow) {
        return { action: "skip", command: "", reason: "\u9700\u5173\u6CE8\u4E3B\u64AD\uFF08\u672A\u5F00\u542F\u81EA\u52A8\u5173\u6CE8\uFF09" };
      }
      return { action: "follow_then_join", command, reason: "\u5148\u81EA\u52A8\u5173\u6CE8\u4E3B\u64AD\u518D\u53C2\u4E0E" };
    }
    const needsComment = classified.some((c) => c.type === "comment" && !c.completed);
    if (needsComment || isCommentJoinButtonText(cleanBtn)) {
      return { action: "join_comment", command, reason: "\u6EE1\u8DB3\u53D1\u8BC4\u8BBA\u53C2\u4E0E\u6761\u4EF6" };
    }
    if (classified.length > 0 && classified.every((c) => c.completed) || isDirectJoinButtonText(cleanBtn)) {
      return { action: "join_direct", command: "", reason: "\u65E0\u9650\u5236\u6216\u6761\u4EF6\u5DF2\u5168\u90E8\u8FBE\u6210" };
    }
    return { action: "skip", command: "", reason: "\u672A\u8BC6\u522B\u5230\u5B89\u5168\u7684\u514D\u8D39\u53C2\u4E0E\u5165\u53E3" };
  }
  function parseLotteryResultText(text) {
    const s = String(text || "").trim();
    if (!s) return null;
    if (/没抽中|未中奖|没中奖|未抽中|没中|遗憾|下次|好运|未能|空手/.test(s)) {
      return { status: "lost", text: s };
    }
    if (/中奖|恭喜|获得|抽中|幸运|赢得了|领取/.test(s)) {
      return { status: "won", text: s };
    }
    return { status: "unknown", text: s };
  }

  // src/packages/Lottery/Lottery.js
  var SELECTORS = {
    shortTouch: '#ShortTouchLayout, .ShortTouchContainer, [class*="ShortTouch"]',
    icon: '.dVxrjT_h, .LMUtLyr9, [aria-label*="\u798F\u888B"], img[alt*="\u798F\u888B"]',
    timer: ".ycjwPFJI, .VWPnhGkt, .qR53KhLu",
    dialog: '#short_touch_land_lottery_land_userMain, [data-short-touch-landing="short_touch_land_lottery_land_userMain"], #lottery_close_cotainer, [id*="lottery_close"]',
    closeBtn: '.hJ3SHYaQ, #lottery_close_cotainer [class*="close"], [id*="lottery_close"] .hJ3SHYaQ',
    alreadyJoined: ".UU67CvI1",
    actionBtn: '.QOARtY3v, [class*="QOARtY3v"], [role="button"], button',
    reqItem: '.aMOCkQGL, [class*="aMOCkQGL"], .oojA302O',
    statusItem: '.q6Dj7eFU, [class*="q6Dj7eFU"]',
    resultDialog: '#short_touch_land_lottery_land_result, [data-short-touch-landing="short_touch_land_lottery_land_result"], .HHKLyVbA.lotteryDialog, .HHkLyvba.lotteryDialog, [class*="lotteryDialog"], .lotteryDialog',
    resultText: '.EJpzW6yC, [class*="EJpzW6yC"]',
    resultBtn: '.QOARtY3v.VA93rNkB.U8EWGi24, [class*="lotteryDialog"] .QOARtY3v, #short_touch_land_lottery_land_result [role="button"]'
  };
  var POLL_MS = 3e3;
  var pollTimer = null;
  var processing = false;
  var cooldownUntil = 0;
  var lastPathname = "";
  var lastResultSig = "";
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) <= 0.05) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8;
  }
  function queryVisible(selector, root = document) {
    for (const el of root.querySelectorAll(selector)) {
      if (isVisible(el)) return el;
    }
    return null;
  }
  function dispatchClick(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      // 油猴沙箱里的 window 不是页面真实 Window，直接传给 view 会让构造器抛
      // `Failed to convert value to 'Window'`，导致整段点击失效。必须用 unsafeWindow。
      view: win,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2
    };
    const fire = (Ctor, type) => {
      try {
        el.dispatchEvent(new Ctor(type, opts));
      } catch (_) {
      }
    };
    fire(PointerEvent, "pointerdown");
    fire(MouseEvent, "mousedown");
    fire(PointerEvent, "pointerup");
    fire(MouseEvent, "mouseup");
    el.click();
    return true;
  }
  function getCountdownSec(root = document) {
    for (const el of root.querySelectorAll(SELECTORS.timer)) {
      if (!isVisible(el)) continue;
      const sec = parseCountdownSeconds(el.textContent);
      if (sec !== null) return sec;
    }
    const m = String(root.textContent || "").match(/\b(\d{1,2}):([0-5]\d)\b/);
    return m ? parseCountdownSeconds(m[0]) : null;
  }
  function findLotteryEntry() {
    const containers = [...document.querySelectorAll(SELECTORS.shortTouch)].filter(isVisible);
    const scopes = containers.length > 0 ? [...containers, document] : [document];
    for (const scope of scopes) {
      for (const rawEl of scope.querySelectorAll(SELECTORS.icon)) {
        if (!isVisible(rawEl)) continue;
        const el = queryVisible(".dVxrjT_h", rawEl) || rawEl;
        const sec = getCountdownSec(el) ?? (scope !== document ? getCountdownSec(scope) : null);
        if (sec !== null) return { el, remainingSeconds: sec };
      }
    }
    return null;
  }
  function isAlreadyJoinedModal(dialog) {
    if (!dialog) return false;
    const joinedEl = queryVisible(SELECTORS.alreadyJoined, dialog);
    if (joinedEl && /已参与|等待开奖|参与成功/.test(joinedEl.textContent || "")) return true;
    for (const el of dialog.querySelectorAll("div, span, button")) {
      const t = (el.textContent || "").trim();
      if ((t === "\u5DF2\u53C2\u4E0E" || t === "\u7B49\u5F85\u5F00\u5956" || t === "\u5DF2\u6210\u529F\u53C2\u4E0E") && isVisible(el)) {
        return true;
      }
    }
    return false;
  }
  function findParticipationDialog() {
    for (const el of document.querySelectorAll(SELECTORS.dialog)) {
      if (!isVisible(el)) continue;
      if (el.id === "short_touch_land_lottery_land_result" || el.closest("#short_touch_land_lottery_land_result") || el.querySelector(".lotteryDialog, [class*='lotteryDialog']")) {
        continue;
      }
      return el;
    }
    return null;
  }
  function extractModalConditions(dialog) {
    if (!dialog) return [];
    const list = [];
    const seen = /* @__PURE__ */ new Set();
    for (const reqEl of dialog.querySelectorAll(SELECTORS.reqItem)) {
      if (!isVisible(reqEl)) continue;
      const statusEl = reqEl.querySelector(SELECTORS.statusItem) || (reqEl.parentElement ? reqEl.parentElement.querySelector(SELECTORS.statusItem) : null);
      if (statusEl) {
        const status = (statusEl.textContent || "").trim();
        const requirement = (reqEl.textContent || "").replace(status, "").trim();
        const key = `${requirement}|${status}`;
        if (requirement && !seen.has(key)) {
          seen.add(key);
          list.push({ requirement, status });
        }
      }
    }
    if (list.length > 0) return list;
    return parseConditionsFromText(dialog.innerText || dialog.textContent || "");
  }
  function findModalActionButton(dialog) {
    if (!dialog) return null;
    const candidates = [...dialog.querySelectorAll(SELECTORS.actionBtn)].filter(isVisible);
    for (const btn of candidates) {
      const t = (btn.textContent || "").trim();
      if (isCommentJoinButtonText(t) || isDirectJoinButtonText(t) || isFollowButtonText(t)) {
        return btn;
      }
    }
    const primary = queryVisible(".QOARtY3v", dialog);
    if (primary && !isVisible(primary.querySelector("button, [role='button']"))) {
      return primary;
    }
    return null;
  }
  function closeLotteryDialog(dialog) {
    const closeBtn = dialog && queryVisible(SELECTORS.closeBtn, dialog) || queryVisible(SELECTORS.closeBtn);
    if (closeBtn) {
      dispatchClick(closeBtn);
      return true;
    }
    for (const el of (dialog || document).querySelectorAll('div, span, button, [role="button"]')) {
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim();
      if (/^(?:关闭|×|✕|✖)$/.test(label) && isVisible(el)) {
        dispatchClick(el);
        return true;
      }
    }
    return false;
  }
  async function handleResultModal() {
    const resultDialog = queryVisible(SELECTORS.resultDialog);
    if (!resultDialog) return false;
    const textEl = queryVisible(SELECTORS.resultText, resultDialog) || resultDialog;
    const parsed = parseLotteryResultText(textEl.textContent || "");
    if (!parsed) return false;
    const sig = `${parsed.status}:${parsed.text.slice(0, 30)}`;
    if (sig !== lastResultSig) {
      lastResultSig = sig;
      if (parsed.status === "won") {
        toast("\u{1F389} \u606D\u559C\u62BD\u4E2D\u798F\u888B\uFF01\u8BF7\u7559\u610F\u76F4\u64AD\u95F4\u9886\u5956\u63D0\u793A");
      }
    }
    cooldownUntil = 0;
    if (parsed.status === "lost") {
      const knowBtn = queryVisible(SELECTORS.resultBtn, resultDialog) || [...resultDialog.querySelectorAll("div, button, span")].find(
        (el) => (el.textContent || "").trim() === "\u77E5\u9053\u4E86" && isVisible(el)
      );
      if (knowBtn) dispatchClick(knowBtn);
      else closeLotteryDialog(resultDialog);
      await sleep(200);
    }
    return true;
  }
  async function waitForDialog(timeout = 3500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const d = findParticipationDialog();
      if (d) {
        await sleep(350);
        return d;
      }
      await sleep(200);
    }
    return null;
  }
  async function executeJoin(dialog, decision) {
    const actionBtn = findModalActionButton(dialog);
    const btnText = actionBtn ? (actionBtn.textContent || "").trim() : "";
    if (isPaidButtonText(btnText)) return false;
    if (decision.action === "follow_then_join") {
      if (!actionBtn) return false;
      dispatchClick(actionBtn);
      await sleep(700);
      const refreshedDialog = findParticipationDialog() || dialog;
      if (isAlreadyJoinedModal(refreshedDialog)) return true;
      const nextBtn = findModalActionButton(refreshedDialog);
      const nextText = nextBtn ? (nextBtn.textContent || "").trim() : "";
      if (nextBtn && !isPaidButtonText(nextText)) {
        dispatchClick(nextBtn);
        await sleep(500);
      }
      if (isAlreadyJoinedModal(refreshedDialog)) return true;
      if (decision.command) {
        return await sendChat(decision.command);
      }
      return false;
    }
    if (actionBtn) {
      dispatchClick(actionBtn);
      await sleep(550);
      const currentDialog = findParticipationDialog();
      if (!currentDialog || isAlreadyJoinedModal(currentDialog)) {
        return true;
      }
    }
    if (decision.action === "join_comment" && decision.command) {
      const sent = await sendChat(decision.command);
      if (!sent) return false;
      await sleep(450);
      const currentDialog = findParticipationDialog();
      if (currentDialog && !isAlreadyJoinedModal(currentDialog)) {
        const retryBtn = findModalActionButton(currentDialog);
        if (retryBtn && !isPaidButtonText(retryBtn.textContent || "")) {
          dispatchClick(retryBtn);
          await sleep(400);
        }
      }
      return true;
    }
    return false;
  }
  async function runTick() {
    const s = getSettings();
    if (!s.autoLottery || processing) return;
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      cooldownUntil = 0;
      lastResultSig = "";
    }
    processing = true;
    try {
      if (await handleResultModal()) return;
      if (Date.now() < cooldownUntil) return;
      let dialog = findParticipationDialog();
      let entrySec = null;
      if (!dialog) {
        const entry = findLotteryEntry();
        if (!entry) return;
        entrySec = entry.remainingSeconds;
        dispatchClick(entry.el);
        dialog = await waitForDialog();
        if (!dialog) return;
      }
      const modalSec = getCountdownSec(dialog) ?? entrySec;
      const alreadyJoined = isAlreadyJoinedModal(dialog);
      const conditions = extractModalConditions(dialog);
      const actionBtn = findModalActionButton(dialog);
      const buttonText = actionBtn ? (actionBtn.textContent || "").trim() : "";
      const decision = evaluateLotteryEligibility({
        conditions,
        alreadyJoined,
        buttonText,
        allowFollow: !!s.autoLotteryFollow,
        remainingSeconds: modalSec
      });
      const lockRound = (sec) => {
        const waitSec = sec && sec > 0 ? sec + 2 : 45;
        cooldownUntil = Date.now() + waitSec * 1e3;
      };
      if (decision.action === "already_joined") {
        closeLotteryDialog(dialog);
        lockRound(modalSec);
        return;
      }
      if (decision.action === "skip") {
        closeLotteryDialog(dialog);
        lockRound(modalSec);
        return;
      }
      if (decision.action === "wait_watch") {
        closeLotteryDialog(dialog);
        cooldownUntil = Date.now() + (decision.retryDelaySec || 30) * 1e3;
        return;
      }
      if (decision.action === "join_comment" || decision.action === "join_direct" || decision.action === "follow_then_join") {
        const ok = await executeJoin(dialog, decision);
        const afterDialog = findParticipationDialog();
        if (afterDialog) closeLotteryDialog(afterDialog);
        lockRound(modalSec);
        if (ok) {
          toast(
            decision.command ? `\u5DF2\u81EA\u52A8\u53C2\u4E0E\u798F\u888B\uFF08\u53E3\u4EE4\uFF1A${decision.command}\uFF09` : "\u5DF2\u81EA\u52A8\u53C2\u4E0E\u514D\u8D39\u798F\u888B"
          );
        }
      }
    } catch (_) {
    } finally {
      processing = false;
    }
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(runTick, POLL_MS);
    setTimeout(runTick, 3500);
  }
  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
    cooldownUntil = 0;
  }
  function initLottery() {
    lastPathname = location.pathname;
    if (getSettings().autoLottery) startPolling();
    onSettingChange((key, val) => {
      if (key === "autoLottery") {
        if (val) startPolling();
        else stopPolling();
      } else if (key === "autoLotteryFollow" && val) {
        cooldownUntil = 0;
      }
    });
  }

  // src/main.js
  function registerMenu(panel) {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("DouyinEX \u8BBE\u7F6E\u9762\u677F", panel.toggle);
    GM_registerMenuCommand("\u590D\u5236\u76F4\u64AD\u6D41\uFF08\u6700\u9AD8\u753B\u8D28 FLV\uFF09", () => copyStream("flv"));
  }
  function main() {
    const panel = initPanel();
    registerMenu(panel);
    initSimpleMode();
    initFullscreenFoldChat();
    initHideGiftBar();
    initAutoFullMode();
    initWheelVolume();
    initSyncTime();
    initChatShield();
    initChatHistory();
    initDanmakuLayer();
    initLottery();
    const s = getSettings();
    if (s.autoQuality) autoHighestQuality();
    if (s.autoFull) autoFull();
    else if (s.autoWebFull) autoWebFull();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
