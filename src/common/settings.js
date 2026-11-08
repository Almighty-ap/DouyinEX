import { getValue, setValue } from "./env.js";

export const DEFAULTS = {
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
  loopMin: 3000,
  loopMax: 5000,
  loopLimitMin: 5,
  loopRandom: false,
};

const listeners = new Set();
let cache = null;

function load() {
  if (!cache) cache = { ...DEFAULTS, ...(getValue("settings", {}) || {}) };
  return cache;
}

export function getSettings() {
  return load();
}

export function setSetting(key, value) {
  load()[key] = value;
  setValue("settings", cache);
  listeners.forEach((fn) => fn(key, value));
}

export function onSettingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
