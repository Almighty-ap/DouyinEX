export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomInt(min, max) {
  if (max < min) [min, max] = [max, min];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 轮询等待选择器出现，超时返回 null */
export async function waitFor(selector, timeout = 15000, interval = 300) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(interval);
  }
  return null;
}

export function injectStyle(id, css) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

let toastTimer = null;
export function toast(msg, type = "info") {
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
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 2000);
}
