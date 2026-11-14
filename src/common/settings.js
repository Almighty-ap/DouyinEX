import { getValue, setValue } from "./env.js";
import {
  DM_AREAS,
  DM_AREA_DEFAULT,
  DM_SPEED_MIN,
  DM_SPEED_MAX,
  DM_SPEED_DEFAULT,
} from "../lib/barrage.js";
import { normalizeFavorites } from "../lib/favorites.js";
import { normalizeHistory } from "../lib/history.js";

export const DEFAULTS = {
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
  loopMin: 3000,
  loopMax: 5000,
  loopLimitMin: 5,
  loopRandom: false,
  // 输入框上下键调取「我发送过的弹幕」
  chatHistoryKeys: true,
  chatHistory: [],
};

const MUTEX_KEY = {
  autoFull: "autoWebFull",
  autoWebFull: "autoFull",
};

const listeners = new Set();
let cache = null;
const AREA_KEYS = new Set(DM_AREAS.map((a) => a.key));

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeSettings(raw = {}) {
  const merged = { ...DEFAULTS, ...(raw || {}) };
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

export function resetSettingsCacheForTest(initial = {}) {
  cache = normalizeSettings(initial);
  return cache;
}

export function getSettings() {
  return load();
}

export function setSetting(key, value) {
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

export function onSettingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
