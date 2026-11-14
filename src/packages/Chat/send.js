import { sleep } from "../../common/dom.js";
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
 * 覆盖输入框内容（空文本即清空）。
 * Slate 会忽略直接改 textContent / 派发 beforeinput，
 * 只有 execCommand 这条输入管线会走它的输入逻辑，并使发送按钮解除 disable。
 * 写完后复核一次：Slate 偶发把新内容与尚未渲染的旧内容合并（表现为串字），此时重写一次。
 */
export function setEditorText(el, text) {
  if (!el) return false;
  const value = text == null ? "" : String(text);
  const write = () => {
    el.focus();
    document.execCommand("selectAll", false);
    return value ? document.execCommand("insertText", false, value) : document.execCommand("delete", false);
  };
  const ok = write();
  if (ok && getEditorText(el) !== value) write();
  return ok;
}

/** 仅把文本填进输入框，不发送（收藏列表点击填充用）；返回 false 表示未登录/无输入框/填充失败 */
export function fillChat(text) {
  const input = findChatInput();
  if (!input) return false;
  return setEditorText(input, text);
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
 * 发送一条弹幕；返回 false 表示未登录/无输入框/填充失败/发送按钮不可用。
 * record=false 用于循环发送：刷屏内容不该塞进上下键调取的历史。
 */
export async function sendChat(text, { record = true } = {}) {
  const input = findChatInput();
  if (!input) return false;
  if (!setEditorText(input, text)) return false;
  await sleep(80);
  const btn = document.querySelector(SEND_BTN);
  if (!btn || btn.classList.contains("disable")) return false;
  markSelfSend();
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  if (record && (await waitEditorCleared())) recordSent(text);
  return true;
}
