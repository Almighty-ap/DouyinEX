const hasGM = typeof GM_getValue === "function";
const PREFIX = "dyex_";

export const win =
  typeof unsafeWindow !== "undefined"
    ? unsafeWindow
    : typeof window !== "undefined"
      ? window
      : globalThis;

export function getValue(key, def) {
  if (hasGM) return GM_getValue(key, def);
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? def : JSON.parse(raw);
  } catch {
    return def;
  }
}

export function setValue(key, value) {
  if (hasGM) return GM_setValue(key, value);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  } catch {}
}

export function copyText(text) {
  if (typeof GM_setClipboard === "function") {
    GM_setClipboard(text);
    return Promise.resolve();
  }
  return navigator.clipboard.writeText(text);
}
