import { getSettings, onSettingChange } from "../../common/settings.js";
import {
  parseKeywords,
  matchKeywords,
  parseLevelFromSrc,
  createRepeatFilter,
  isActionableChatText,
} from "../../lib/filter.js";
import { sendChat } from "./send.js";
import { makeFavoriteButton } from "./collect.js";
import { toast } from "../../common/dom.js";

const ITEM = ".webcast-chatroom___item";
const SYSTEM_MSG = ".webcast-chatroom__room-message";
const PLUS_CLASS = "dyex-plus1";
const FAV_CLASS = "dyex-fav";
const LIST = ".webcast-chatroom___list";
// 我们注入的按钮都带这个属性：提取正文前需要先剔除，重扫时也据此清理
const BTN_ATTR = "data-dyex-btn";

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

/** 提取消息正文：去掉 +1 / 收藏 按钮文案；用户名与正文无稳定类名，取整条文本 */
function getItemText(item) {
  const clone = item.cloneNode(true);
  clone.querySelectorAll(`[${BTN_ATTR}]`).forEach((n) => n.remove());
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

/**
 * 读取按钮所在条目「此刻」的正文。
 * 抖音的虚拟列表会复用条目节点（同一条目 DOM 换显示另一条消息），按钮里存的是创建时的
 * 文本，直接用它会出现「点这条、发出的是别的条」；所以点击那一刻重新按当前 DOM 读一遍。
 */
function textAtEvent(e, fallback) {
  const node = e && e.currentTarget;
  const item = node && node.closest ? node.closest(ITEM) : null;
  if (!item) return fallback;
  const text = getContentOnly(getItemText(item));
  return text || fallback;
}

/**
 * 悬停浮出 +1（可关）与 收藏 按钮；按钮都带 data-dyex-btn 便于正文提取与重扫清理。
 * 按钮**不复用**创建时的正文闭包，点击那一刻按当前 DOM 重取（见 textAtEvent / D-22）。
 */
function addButtons(item) {
  if (item.querySelector(`[${BTN_ATTR}]`)) return;
  if (isGiftMessage(item)) return; // 送礼流水跟发与收藏都没有意义
  const itemText = getItemText(item);
  if (!isActionableChatText(itemText)) return; // 空正文与「xx 来了」
  const text = getContentOnly(itemText);
  if (!text) return;
  if (getSettings().plus1) {
    const plus = document.createElement("span");
    plus.className = PLUS_CLASS;
    plus.setAttribute(BTN_ATTR, "plus");
    plus.textContent = "+1";
    plus.title = "跟发这条弹幕";
    plus.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await sendChat(textAtEvent(e, text));
      if (!ok) toast("发送失败：请确认已登录抖音，且聊天输入框可用", "error");
    });
    item.appendChild(plus);
  }
  item.appendChild(makeFavoriteButton(FAV_CLASS, (e) => textAtEvent(e, text)));
}

/**
 * 鼠标移进某条消息时按需补上按钮。
 *
 * 不能只在条目首次出现时注入一次：抖音的虚拟列表会把条目 DOM 复用给别的消息、
 * React 重渲染也会把不在它管辖内的子节点一起换掉，注入的按钮过一阵子就被清空
 * （实测停留一分钟后 17 条里只剩 2 条还有按钮，用户看到的就是「评论区的 +1 / 收藏 消失了」）。
 * 改成鼠标移到哪条就给哪条补一次，正文也顺带按当下 DOM 取，节点复用后也不会串文本。
 */
function ensureButtonsOnHover(e) {
  const node = e.target;
  const item = node && node.closest ? node.closest(ITEM) : null;
  if (!item) return;
  if (item.hasAttribute(HIDDEN_ATTR)) return;
  if (item.querySelector(`[${BTN_ATTR}]`)) return;
  addButtons(item);
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
  addButtons(item);
}

/** 过滤类设置变更后，撤销已隐藏的条目并对现有条目重新判定 */
function rescanAll() {
  handled = new WeakSet();
  document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => {
    el.style.display = "";
    el.removeAttribute(HIDDEN_ATTR);
  });
  document.querySelectorAll(`[${BTN_ATTR}]`).forEach((el) => el.remove());
  resolveList();
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

// 不用 `node instanceof HTMLElement`：油猴沙箱下构造器可能来自不同的 realm，
// 误判会让所有新消息都收不到屏蔽判定
function isElement(node) {
  return !!node && node.nodeType === 1 && typeof node.matches === "function";
}

function scan(node) {
  if (!isElement(node)) return;
  if (node.matches(ITEM)) processItem(node);
  node.querySelectorAll?.(ITEM).forEach(processItem);
}

let listEl = null;
let observer = null;
let listTimer = null;

/**
 * 找到聊天列表并挂上观察者；列表被抖音卸载重建（完全全屏折叠评论区、切换全屏）时重新挂，
 * 否则新消息永远不会再走一遍屏蔽判定。
 */
function resolveList() {
  const found = document.querySelector(LIST);
  if (found && found === listEl && found.isConnected) return listEl;
  observer?.disconnect();
  observer = null;
  listEl = found || null;
  if (!listEl) return null;
  listEl.querySelectorAll(ITEM).forEach(processItem);
  observer = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) scan(n);
  });
  observer.observe(listEl, { childList: true, subtree: true });
  return listEl;
}

export function initChatShield() {
  resolveList();
  // 列表可能晚于脚本出现，也可能被卸载重建：定期核对一次（找不到就等下一轮）
  clearInterval(listTimer);
  listTimer = setInterval(resolveList, 2000);
  // 悬停补按钮用事件委托挂在 document 上，列表重建也不受影响
  document.addEventListener("mouseover", ensureButtonsOnHover);
  onSettingChange((key) => {
    if (RESCAN_KEYS.has(key)) rescanAll();
  });
}
