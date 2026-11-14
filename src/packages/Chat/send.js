import { sleep } from "../../common/dom.js";
import { ensureChatPanelOpen } from "../Player/Player.js";
import { markSelfSend, recordSent } from "./historyStore.js";

export const CHAT_EDITOR = ".webcast-chatroom___input-container .editor-kit-container";
const SEND_BTN = ".webcast-chatroom___send-btn";
// Slate 空行里塞的零宽空格，判断「输入框是否为空」时必须剔除
const ZERO_WIDTH = String.fromCharCode(0x200b);
// 发送后等页面清空输入框，据此判断这条真的发出去了才记进历史
const CLEAR_POLL_MS = 250;
const CLEAR_POLL_TIMES = 10;

/** 聊天输入框是 Slate 富文本编辑器（contenteditable），登录后才有 */
export function findChatInput() {
  return document.querySelector(CHAT_EDITOR);
}

function getEditorText(el) {
  return el.innerText.split(ZERO_WIDTH).join("").trim();
}

/**
 * 输入框此刻是否真的能用：存在、还在文档里、且已渲染出盒子。
 * 完全全屏会把整个评论区 `display: none`（输入框节点仍在 DOM 里，但没有盒子），
 * 这种状态下 focus() 无效、发送按钮也是 disable。
 */
export function isChatInputReady(el = findChatInput()) {
  if (!el || !el.isConnected) return false;
  return el.getClientRects().length > 0;
}

/** 输入框是否真的拿到了焦点（focus() 对未渲染的元素是静默失败的） */
function editorFocused(el) {
  const active = document.activeElement;
  return active === el || (!!active && el.contains(active));
}

/**
 * 覆盖输入框内容（空文本即清空）。
 * Slate 会忽略直接改 textContent / 派发 beforeinput，
 * 只有 execCommand 这条输入管线会走它的输入逻辑，并使发送按钮解除 disable。
 * 写完后复核一次：Slate 偶发把新内容与尚未渲染的旧内容合并（表现为串字），此时重写一次。
 *
 * 关键：`execCommand("selectAll")` 在输入框没拿到焦点时作用于**整个文档**——
 * 完全全屏下（评论区 display: none）就是这个情形：整页文字被选成蓝色，
 * 后续 insertText 也落不到输入框里，表现为「画面整片变蓝 + 发送失败」。
 * 因此先确认焦点落在输入框上再全选；拿不到焦点就直接失败，绝不碰文档选区。
 */
export function setEditorText(el, text) {
  if (!el) return false;
  const value = text == null ? "" : String(text);
  const write = () => {
    el.focus();
    if (!editorFocused(el)) return false;
    document.execCommand("selectAll", false);
    return value ? document.execCommand("insertText", false, value) : document.execCommand("delete", false);
  };
  let ok = write();
  if (ok && getEditorText(el) !== value) ok = write();
  if (!ok) clearPageSelection(el);
  return ok;
}

/** 输入框没吃到这次输入时，清掉可能落在整个文档上的选区（否则整页蓝色高亮会一直挂着） */
function clearPageSelection(el) {
  const sel = el.ownerDocument && el.ownerDocument.getSelection && el.ownerDocument.getSelection();
  if (!sel || !sel.rangeCount) return;
  if (sel.anchorNode === el || el.contains(sel.anchorNode)) return;
  sel.removeAllRanges();
}

/**
 * 仅把文本填进输入框，不发送（收藏列表点击填充用）；
 * 返回 false 表示未登录/两条输入路径都不可用/填充失败。
 * 完全全屏下优先填播放器底部输入条（用户在那里按回车即发送），避免为了填字去展开评论区。
 */
export async function fillChat(text) {
  if (isChatInputReady()) return setEditorText(findChatInput(), text);
  // 完全全屏下先填播放器底部输入条（用户在那里按回车就能发），不必为了填字去展开评论区
  if (setTextareaValue(findPlayerBarInput(), text)) return true;
  return withUnfoldedChat(() => {
    const input = findChatInput();
    return isChatInputReady(input) ? setEditorText(input, text) : false;
  });
}

/** 发送后输入框应被清空，据此判断页面是否真的接受了本次发送 */
export function isEditorEmpty() {
  const input = findChatInput();
  return !input || getEditorText(input) === "";
}

/** 等输入框被清空（= 页面确实把这条发出去了）；页面发送后会重建输入框，所以是轮询而不是单次延时 */
async function waitEditorCleared() {
  for (let i = 0; i < CLEAR_POLL_TIMES; i++) {
    await sleep(CLEAR_POLL_MS);
    if (isEditorEmpty()) return true;
  }
  return false;
}

/**
 * 抖音播放器自带的输入条（完全全屏下画面底部的「说点什么」）。
 * 完全全屏时抖音会把整个评论区从 DOM 里卸载，聊天编辑框随之消失，
 * 但这条输入条仍在（它是播放器控制层的一部分，鼠标靠近底部才滑上来），
 * 也是用户在完全全屏下唯一能打字发弹幕的地方。
 */
function findPlayerBarInput() {
  return (
    document.querySelector('.douyin-player textarea[placeholder="说点什么"]') ||
    [...document.querySelectorAll(".douyin-player textarea")].find((t) => t.isConnected) ||
    null
  );
}

/** 给 textarea 写值：必须走原生 setter + input 事件，React 才认这次输入 */
function setTextareaValue(el, value) {
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) return false;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** 输入条以「回车」发送 */
function pressEnter(el) {
  const opts = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  for (const type of ["keydown", "keypress", "keyup"]) {
    el.dispatchEvent(new KeyboardEvent(type, opts));
  }
}

/**
 * 用播放器底部输入条发送；返回 false 表示这条没能送出去
 * （抖音接受发送后会清空该输入条，据此判定）。
 */
async function sendViaPlayerBar(text) {
  const bar = findPlayerBarInput();
  if (!bar || !setTextareaValue(bar, text)) return false;
  await sleep(60);
  markSelfSend();
  pressEnter(bar);
  for (let i = 0; i < 8; i++) {
    await sleep(120);
    if (!bar.isConnected || bar.value === "") return true;
  }
  // 没送出去：把内容清掉，免得留在输入条里跟着一起显示出去
  if (bar.isConnected && bar.value) setTextareaValue(bar, "");
  return false;
}

/** 等聊天编辑框渲染出来（展开评论区后抖音要一拍才挂上） */
async function waitInputReady(timeout = 1500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (isChatInputReady()) return true;
    await sleep(100);
  }
  return false;
}

/**
 * 聊天编辑框不可用时的兜底：临时展开评论区，发完再还原成折叠态。
 * 正常路径不会走到这里（完全全屏下由播放器底部输入条兜住），
 * 只有在输入条也读不到（抖音改版）时才需要这一手。
 */
async function withUnfoldedChat(fn) {
  const restore = await ensureChatPanelOpen();
  if (!restore) return false;
  try {
    await waitInputReady();
    return await fn();
  } finally {
    await restore();
  }
}

/** 走聊天编辑框发送（正常路径）：填字 + 点原生发送按钮，并按输入框是否被清空判定结果 */
async function sendViaEditor(text, record) {
  const input = findChatInput();
  if (!isChatInputReady(input)) return false;
  if (!setEditorText(input, text)) return false;
  await sleep(80);
  const btn = document.querySelector(SEND_BTN);
  if (!btn || btn.classList.contains("disable")) return false;
  markSelfSend();
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  if (record && (await waitEditorCleared())) recordSent(text);
  return true;
}

/**
 * 发送一条弹幕；返回 false 表示未登录/无输入框/填充失败/发送按钮不可用。
 * record=false 用于循环发送：刷屏内容不该塞进上下键调取的历史。
 *
 * 三条路径，按「越不打扰画面越优先」排序：
 *   1. 聊天编辑框可用 → 直接发（正常模式）；
 *   2. 完全全屏把评论区整块卸载时 → 用播放器底部输入条发（画面不闪、用户也是这么发的）；
 *   3. 连输入条都读不到（抖音改版） → 临时展开评论区发完再折回。
 */
export async function sendChat(text, { record = true } = {}) {
  if (isChatInputReady()) {
    if (await sendViaEditor(text, record)) return true;
  } else if (await sendViaPlayerBar(text)) {
    if (record) recordSent(text);
    return true;
  }
  return withUnfoldedChat(() => sendViaEditor(text, record));
}
