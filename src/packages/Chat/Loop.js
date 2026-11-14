import { getSettings } from "../../common/settings.js";
import { randomInt, toast } from "../../common/dom.js";
import { sendChat } from "./send.js";

let timer = null;
let stopTimer = null;
let offset = 0;
let running = false;
let onStateChange = () => {};

export function isLoopRunning() {
  return running;
}

export function onLoopState(fn) {
  onStateChange = fn;
}

function parseTexts() {
  return String(getSettings().loopTexts || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function tick() {
  if (!running) return;
  const s = getSettings();
  const texts = parseTexts();
  if (!texts.length) return stopLoop();
  const idx = s.loopRandom ? randomInt(0, texts.length - 1) : offset++ % texts.length;
  const ok = await sendChat(texts[idx], { record: false });
  if (!ok) {
    toast("发送失败：请确认已登录抖音，且聊天输入框可用，循环已停止", "error");
    return stopLoop();
  }
  timer = setTimeout(tick, randomInt(s.loopMin, s.loopMax));
}

export function startLoop() {
  if (running) return;
  const s = getSettings();
  if (!parseTexts().length) {
    toast("请先填写循环发送的弹幕（一行一条）", "error");
    return;
  }
  running = true;
  offset = 0;
  stopTimer = setTimeout(stopLoop, Math.max(1, s.loopLimitMin) * 60 * 1000);
  onStateChange(true);
  tick();
}

export function stopLoop() {
  running = false;
  clearTimeout(timer);
  clearTimeout(stopTimer);
  onStateChange(false);
}
