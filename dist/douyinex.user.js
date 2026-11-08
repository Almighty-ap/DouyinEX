// ==UserScript==
// @name         DouyinEX-抖音直播间增强插件
// @namespace    https://github.com/Almighty-ap/DouyinEX
// @version      0.1.0
// @description  抖音直播间增强：复制直播流(原画/超清/高清) 自动最高画质 自动网页全屏 滚轮调音量 弹幕屏蔽(关键词/等级/进场) 弹幕+1 循环发送弹幕 简洁模式
// @author       DouyinEX
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
  var win = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
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
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }
  function copyText(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text);
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text);
  }

  // src/common/settings.js
  var DEFAULTS = {
    autoQuality: true,
    autoWebFull: false,
    wheelVolume: true,
    simpleMode: false,
    simpleRestore: null,
    plus1: true,
    danmakuTakeover: true,
    shieldKeywords: "",
    shieldLevelBelow: 0,
    shieldEnter: false,
    shieldRepeat: false,
    loopTexts: "",
    loopMin: 3e3,
    loopMax: 5e3,
    loopLimitMin: 5,
    loopRandom: false
  };
  var listeners = /* @__PURE__ */ new Set();
  var cache = null;
  function load() {
    if (!cache) cache = { ...DEFAULTS, ...getValue("settings", {}) || {} };
    return cache;
  }
  function getSettings() {
    return load();
  }
  function setSetting(key, value) {
    load()[key] = value;
    setValue("settings", cache);
    listeners.forEach((fn) => fn(key, value));
  }
  function onSettingChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // src/packages/Panel/Panel.css
  var Panel_default = '#dyex-ball {\n  position: fixed; right: 16px; bottom: 120px; width: 40px; height: 40px;\n  border-radius: 50%; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.35);\n  cursor: pointer; z-index: 2147483000; display: flex; align-items: center;\n  justify-content: center; user-select: none; transition: transform .15s;\n}\n#dyex-ball:hover { transform: scale(1.1); }\n#dyex-ball svg { width: 30px; height: 30px; }\n\n#dyex-panel {\n  position: fixed; right: 64px; bottom: 80px; width: 340px; max-height: 70vh;\n  overflow-y: auto; background: rgba(22,22,26,.96); color: #eee; font-size: 13px;\n  border-radius: 10px; padding: 12px 14px; z-index: 2147483000;\n  box-shadow: 0 6px 24px rgba(0,0,0,.5); display: none; line-height: 1.6;\n}\n#dyex-panel.is-open { display: block; }\n#dyex-panel h4 { margin: 10px 0 6px; font-size: 13px; color: #fe2c55; }\n#dyex-panel h4:first-child { margin-top: 0; }\n#dyex-panel label { display: flex; align-items: center; gap: 6px; cursor: pointer; }\n#dyex-panel input[type="text"], #dyex-panel input[type="number"], #dyex-panel textarea {\n  background: #2a2a30; color: #eee; border: 1px solid #444; border-radius: 4px;\n  padding: 3px 6px; font-size: 12px; box-sizing: border-box;\n}\n#dyex-panel textarea { width: 100%; resize: vertical; min-height: 56px; }\n#dyex-panel input[type="number"] { width: 64px; }\n#dyex-panel button {\n  background: #fe2c55; color: #fff; border: 0; border-radius: 4px;\n  padding: 3px 10px; font-size: 12px; cursor: pointer; margin: 2px 4px 2px 0;\n}\n#dyex-panel button.is-secondary { background: #3a3a42; }\n#dyex-panel .dyex-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; flex-wrap: wrap; }\n#dyex-panel .dyex-tip { color: #999; font-size: 12px; }\n\n.dyex-plus1 {\n  margin-left: 8px; padding: 0 6px; border-radius: 8px; font-size: 12px;\n  color: #fe2c55; border: 1px solid #fe2c55; cursor: pointer; opacity: 0;\n  transition: opacity .15s; user-select: none; display: inline-block;\n}\n.webcast-chatroom___item:hover .dyex-plus1 { opacity: 1; }\n\n/* \u63A5\u7BA1\u540E\u7684\u60AC\u6D6E\u5F39\u5E55\u5C42 */\n#dyex-dm-layer {\n  position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1;\n}\n.dyex-dm-item {\n  position: absolute; left: 0; top: 0; white-space: nowrap; pointer-events: auto;\n  user-select: none; line-height: 1.35; opacity: .85; cursor: default;\n  text-shadow: -1px -1px 0 rgba(0,0,0,.8), 1px -1px 0 rgba(0,0,0,.8),\n    -1px 1px 0 rgba(0,0,0,.8), 1px 1px 0 rgba(0,0,0,.8), 0 0 2px rgba(0,0,0,.8);\n}\n.dyex-dm-item img { height: 1.15em; vertical-align: -.2em; }\n.dyex-dm-item.is-self {\n  border: 1px solid rgba(255,255,255,.85); border-radius: 6px; padding: 0 6px;\n}\n.dyex-dm-plus1 {\n  display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px;\n  background: #fe2c55; color: #fff; font-size: 12px; line-height: 18px;\n  vertical-align: 2px; text-shadow: none; cursor: pointer; opacity: 0;\n  transition: opacity .15s;\n}\n.dyex-dm-item:hover .dyex-dm-plus1 { opacity: 1; }\n\n#dyex-toast {\n  position: fixed; left: 50%; top: 80px; transform: translateX(-50%);\n  padding: 8px 16px; border-radius: 6px; background: rgba(0,0,0,.85); color: #fff;\n  font-size: 13px; z-index: 2147483647; opacity: 0; pointer-events: none;\n  transition: opacity .2s;\n}\n#dyex-toast.is-show { opacity: 1; }\n#dyex-toast[data-type="success"] { background: rgba(22,163,74,.92); }\n#dyex-toast[data-type="error"] { background: rgba(220,38,38,.92); }\n';

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

  // src/packages/Chat/send.js
  var EDITOR = ".webcast-chatroom___input-container .editor-kit-container";
  var SEND_BTN = ".webcast-chatroom___send-btn";
  function findChatInput() {
    return document.querySelector(EDITOR);
  }
  function fillEditor(el, text) {
    el.focus();
    document.execCommand("selectAll", false);
    return document.execCommand("insertText", false, text);
  }
  async function sendChat(text) {
    const input = findChatInput();
    if (!input) return false;
    if (!fillEditor(input, text)) return false;
    await sleep(80);
    const btn = document.querySelector(SEND_BTN);
    if (!btn || btn.classList.contains("disable")) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(150);
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
    const ok = await sendChat(texts[idx]);
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

  // src/packages/Panel/Panel.js
  var BALL_SVG = `<svg viewBox="0 0 108 108" xmlns="http://www.w3.org/2000/svg">
<circle cx="54" cy="54" r="50" fill="#16161a"/><path d="M54 6a48 48 0 0 0-48 48h30a18 18 0 0 1 36 0h30A48 48 0 0 0 54 6z" fill="#fe2c55"/>
<circle cx="54" cy="54" r="18" fill="#fff" stroke="#16161a" stroke-width="6"/></svg>`;
  var CHECKS = [
    ["autoQuality", "\u81EA\u52A8\u6700\u9AD8\u753B\u8D28"],
    ["autoWebFull", "\u8FDB\u623F\u81EA\u52A8\u7F51\u9875\u5168\u5C4F"],
    ["wheelVolume", "\u64AD\u653E\u5668\u5185\u6EDA\u8F6E\u8C03\u97F3\u91CF"],
    ["simpleMode", "\u7B80\u6D01\u6A21\u5F0F\uFF08\u9690\u85CF\u6A2A\u5E45/\u5C0F\u9EC4\u8F66/\u699C\u5355\u5165\u53E3\uFF09"],
    ["danmakuTakeover", "\u63A5\u7BA1\u60AC\u6D6E\u5F39\u5E55\uFF08\u753B\u9762\u5F39\u5E55 +1 \u4E0E\u5C4F\u853D\uFF09"],
    ["plus1", "\u5F39\u5E55 +1\uFF08\u60AC\u505C\u663E\u793A\uFF09"],
    ["shieldEnter", "\u5C4F\u853D\u8FDB\u573A\u6D88\u606F"],
    ["shieldRepeat", "\u5C4F\u853D\u91CD\u590D\u5F39\u5E55\uFF0810 \u79D2\u5185\uFF09"]
  ];
  function checkRow(key, label) {
    return `<label><input type="checkbox" data-key="${key}"> ${label}</label>`;
  }
  function buildHtml() {
    return `
  <h4>\u76F4\u64AD\u6D41</h4>
  <div class="dyex-row" id="dyex-stream-btns"></div>
  <div class="dyex-tip">\u70B9\u51FB\u590D\u5236\u5730\u5740\uFF0C\u53EF\u7528 PotPlayer / VLC \u6253\u5F00</div>
  <h4>\u64AD\u653E\u4E0E\u754C\u9762</h4>
  ${CHECKS.slice(0, 4).map(([k, l]) => checkRow(k, l)).join("")}
  <h4>\u5F39\u5E55\uFF08\u753B\u9762\u4E0A\u6F02\u6D6E\u7684\u5F39\u5E55\uFF09</h4>
  ${CHECKS.slice(4).map(([k, l]) => checkRow(k, l)).join("")}
  <div class="dyex-row">\u5C4F\u853D\u7B49\u7EA7\u4F4E\u4E8E
    <input type="number" min="0" max="80" data-key="shieldLevelBelow" data-num="1"> \u7684\u7528\u6237\uFF080=\u4E0D\u9650\uFF09
  </div>
  <div class="dyex-tip">\u5173\u952E\u8BCD\u5C4F\u853D\uFF08\u4E00\u884C\u4E00\u6761\uFF0C/\u6B63\u5219/ \u4EA6\u53EF\uFF09</div>
  <textarea data-key="shieldKeywords" placeholder="\u4F8B\u5982\uFF1A\u5237\u5C4F&#10;/^6{3,}$/"></textarea>
  <div class="dyex-tip">\u4EE5\u4E0B\u5C4F\u853D\u540C\u65F6\u4F5C\u7528\u4E8E\u753B\u9762\u60AC\u6D6E\u5F39\u5E55\u4E0E\u53F3\u4FA7\u804A\u5929\u5217\u8868</div>
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
  function initPanel() {
    injectStyle("dyex-style", Panel_default);
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
    loopBtn.addEventListener("click", () => isLoopRunning() ? stopLoop() : startLoop());
    onLoopState((on) => loopBtn.textContent = on ? "\u505C\u6B62\u53D1\u9001" : "\u5F00\u59CB\u53D1\u9001");
    panel.querySelector("#dyex-quality-now").addEventListener("click", () => autoHighestQuality());
    return { toggle };
  }

  // src/packages/Player/Player.js
  var SIMPLE_CSS = `
[data-e2e="exhibition-banner"],
[data-e2e="yellowCart-container"],
[data-e2e*="cart" i],
[data-e2e="hour-rank-entrance"] { display: none !important; }
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
  function findWebFullButton() {
    const tips = Array.from(document.querySelectorAll(".douyin-player *")).filter(
      (el) => el.children.length === 0 && /^网页全屏$/.test(el.textContent.trim())
    );
    const tip = tips[0];
    return tip ? tip.closest("div[class*='douyin-player'], div") : null;
  }
  async function autoWebFull() {
    const player = await waitFor(".douyin-player", 2e4);
    if (!player) return false;
    await sleep(1500);
    const btn = findWebFullButton();
    if (btn) {
      btn.click();
      return true;
    }
    return false;
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
  var DANMAKU_ICON = '[data-e2e="danmaku-setting-icon"]';
  var GIFT_ICON = '[data-e2e="gift-setting"]';
  var ON_COLOR = "rgb(254, 44, 85)";
  function hover(el, type) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  async function withPopup(selector, fn) {
    const icon = document.querySelector(selector);
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
    const only = (text, want) => want === null || want === void 0 ? null : setSwitch(danmakuSwitch(text), want);
    return withPopup(DANMAKU_ICON, async () => ({
      gift: await only("\u9001\u793C\u4FE1\u606F", wantGift),
      lucky: await only("\u798F\u888B\u53E3\u4EE4", wantLucky)
    }));
  }
  async function applyEffectSwitch(want) {
    return withPopup(
      GIFT_ICON,
      async () => setSwitch(document.querySelector('[data-e2e="effect-switch"] > div'), want)
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

  // src/packages/Chat/Shield.js
  var ITEM = ".webcast-chatroom___item";
  var SYSTEM_MSG = ".webcast-chatroom__room-message";
  var PLUS_CLASS = "dyex-plus1";
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
    clone.querySelectorAll(`.${PLUS_CLASS}`).forEach((n) => n.remove());
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
  function addPlus1(item) {
    if (!getSettings().plus1 || item.querySelector(`.${PLUS_CLASS}`)) return;
    if (isGiftMessage(item)) return;
    const text = getContentOnly(getItemText(item));
    if (!text || /来了$/.test(getItemText(item))) return;
    const btn = document.createElement("span");
    btn.className = PLUS_CLASS;
    btn.textContent = "+1";
    btn.title = "\u8DDF\u53D1\u8FD9\u6761\u5F39\u5E55";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await sendChat(text);
      if (!ok) toast("\u53D1\u9001\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u6296\u97F3\uFF0C\u4E14\u804A\u5929\u8F93\u5165\u6846\u53EF\u7528", "error");
    });
    item.appendChild(btn);
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
    addPlus1(item);
  }
  function rescanAll() {
    handled = /* @__PURE__ */ new WeakSet();
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
      el.style.display = "";
      el.removeAttribute(HIDDEN_ATTR);
    });
    document.querySelectorAll(`.${PLUS_CLASS}`).forEach((el) => el.remove());
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

  // src/packages/Danmaku/Layer.js
  var LAYER_ID = "dyex-dm-layer";
  var ITEM_CLS = "dyex-dm-item";
  var PLUS_CLS = "dyex-dm-plus1";
  var PLUGIN = ".CanvasDanmakuPlugin";
  var MAX_ITEMS = 80;
  var hookedInst = null;
  var hookedBus = null;
  var cfg = { fontSize: 20, speed: 14400, opacity: 0.8, area: { start: 0.01, end: 0.5 } };
  var users = /* @__PURE__ */ new Map();
  var isRepeat2 = createRepeatFilter(1e4);
  var rules2 = [];
  var rulesRaw2 = null;
  var lanes = [];
  var laneKey = "";
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
    if (!b.text) return false;
    if (b.isGift) return !!getSettings().simpleMode;
    refreshRules2();
    const u = users.get(b.id);
    const level = u ? Number(u.level) : null;
    if (!b.isSelf && shouldHide2(b.text, level)) return true;
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
    btn.title = "\u8DDF\u53D1\u8FD9\u6761\u5F39\u5E55";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await sendChat(text);
      if (!ok) toast("\u53D1\u9001\u5931\u8D25\uFF1A\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u6296\u97F3\uFF0C\u4E14\u804A\u5929\u8F93\u5165\u6846\u53EF\u7528", "error");
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
    const pps = Math.max(40, (Number(cfg.speed) || 14400) / 60);
    lanes[lane] = now + width / pps * 1e3;
    const duration = Math.max(1500, (cw + width) / pps * 1e3);
    const anim = el.animate(
      [{ transform: `translateX(${cw}px)` }, { transform: `translateX(${-width}px)` }],
      { duration, easing: "linear", fill: "forwards" }
    );
    anim.onfinish = () => el.remove();
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
  function tick2() {
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
    }
  }
  function initDanmakuLayer() {
    tick2();
    setInterval(tick2, 1e3);
    onSettingChange((key, value) => {
      if (key === "danmakuTakeover" && !value) clearLayer();
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
    initWheelVolume();
    initChatShield();
    initDanmakuLayer();
    const s = getSettings();
    if (s.autoQuality) autoHighestQuality();
    if (s.autoWebFull) autoWebFull();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
