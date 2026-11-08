import { getSettings, onSettingChange } from "../../common/settings.js";
import { waitFor } from "../../common/dom.js";
import {
  parseKeywords,
  matchKeywords,
  parseLevelFromSrc,
  createRepeatFilter,
} from "../../lib/filter.js";
import { sendChat } from "./send.js";
import { toast } from "../../common/dom.js";

const ITEM = ".webcast-chatroom___item";
const SYSTEM_MSG = ".webcast-chatroom__room-message";
const PLUS_CLASS = "dyex-plus1";

let rules = [];
let rulesRaw = null;
const isRepeat = createRepeatFilter(10000);

function refreshRules() {
  const raw = getSettings().shieldKeywords;
  if (raw !== rulesRaw) {
    rulesRaw = raw;
    rules = parseKeywords(raw);
  }
}

/** 提取消息正文：去掉 +1 按钮文案；用户名与正文无稳定类名，取整条文本 */
function getItemText(item) {
  const clone = item.cloneNode(true);
  clone.querySelectorAll(`.${PLUS_CLASS}`).forEach((n) => n.remove());
  return clone.textContent.replace(/\s+/g, " ").trim();
}

/** 拆出「用户名：正文」中的正文，拿不到分隔符时返回整条 */
function getContentOnly(text) {
  const m = text.match(/^[^：:]{1,40}[：:]\s*(.+)$/);
  return m ? m[1] : text;
}

/** 送礼消息：正文不是普通文本节点，且「昵称：」后紧跟「送出了/赠送了」 */
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

  // 福袋/口令类消息在 DOM 里和普通聊天完全一样，按正文匹配会误杀正常弹幕，故不处理
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
  if (isGiftMessage(item)) return; // 送礼流水跟发没有意义
  const text = getContentOnly(getItemText(item));
  if (!text || /来了$/.test(getItemText(item))) return;
  const btn = document.createElement("span");
  btn.className = PLUS_CLASS;
  btn.textContent = "+1";
  btn.title = "跟发这条弹幕";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await sendChat(text);
    if (!ok) toast("发送失败：请确认已登录抖音，且聊天输入框可用", "error");
  });
  item.appendChild(btn);
}

const HIDDEN_ATTR = "data-dyex-hidden";
let handled = new WeakSet();

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

/** 过滤类设置变更后，撤销已隐藏的条目并对现有条目重新判定 */
function rescanAll() {
  handled = new WeakSet();
  document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
    el.style.display = "";
    el.removeAttribute(HIDDEN_ATTR);
  });
  document.querySelectorAll(`.${PLUS_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(ITEM).forEach(processItem);
}

const RESCAN_KEYS = new Set([
  "shieldKeywords",
  "shieldLevelBelow",
  "shieldEnter",
  "shieldRepeat",
  "plus1",
  "simpleMode",
]);

function scan(node) {
  if (!(node instanceof HTMLElement)) return;
  if (node.matches(ITEM)) processItem(node);
  node.querySelectorAll?.(ITEM).forEach(processItem);
}

export async function initChatShield() {
  const list = await waitFor(".webcast-chatroom___list", 30000);
  if (!list) return;
  list.querySelectorAll(ITEM).forEach(processItem);
  onSettingChange((key) => {
    if (RESCAN_KEYS.has(key)) rescanAll();
  });
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(scan);
  }).observe(list, { childList: true, subtree: true });
}
