import { getValue, setValue } from "./env.js";

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
  shieldKeywords: "",
  shieldLevelBelow: 0,
  shieldEnter: false,
  shieldRepeat: false,
  loopTexts: "",
  loopMin: 3000,
  loopMax: 5000,
  loopLimitMin: 5,
  loopRandom: false,
};

const MUTEX_KEY = {
  autoFull: "autoWebFull",
  autoWebFull: "autoFull",
};

const listeners = new Set();
let cache = null;

export function normalizeSettings(raw = {}) {
  const merged = { ...DEFAULTS, ...(raw || {}) };
  if (merged.autoFull && merged.autoWebFull) {
    merged.autoWebFull = false;
  }
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
