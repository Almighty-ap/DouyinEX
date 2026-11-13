import { sleep } from "../../common/dom.js";

const EDITOR = ".webcast-chatroom___input-container .editor-kit-container";
const SEND_BTN = ".webcast-chatroom___send-btn";

/** 聊天输入框是 Slate 富文本编辑器（contenteditable），登录后才有 */
export function findChatInput() {
  return document.querySelector(EDITOR);
}

function getEditorText(el) {
  return el.innerText.replace(/​/g, "").trim();
}

/**
 * Slate 会忽略直接改 textContent / 派发 beforeinput，
 * 只有 execCommand("insertText") 会走它的输入管线，并使发送按钮解除 disable。
 */
function fillEditor(el, text) {
  el.focus();
  document.execCommand("selectAll", false);
  return document.execCommand("insertText", false, text);
}

/** 仅把文本填进输入框，不发送（收藏列表点击填充用）；返回 false 表示未登录/无输入框/填充失败 */
export function fillChat(text) {
  const input = findChatInput();
  if (!input) return false;
  return fillEditor(input, text);
}

/** 发送一条弹幕；返回 false 表示未登录/无输入框/填充失败/发送按钮不可用 */
export async function sendChat(text) {
  const input = findChatInput();
  if (!input) return false;
  if (!fillEditor(input, text)) return false;
  await sleep(80);
  const btn = document.querySelector(SEND_BTN);
  if (!btn || btn.classList.contains("disable")) return false;
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await sleep(150);
  return true;
}

/** 发送后输入框应被清空，据此判断页面是否真的接受了本次发送 */
export function isEditorEmpty() {
  const input = findChatInput();
  return !input || getEditorText(input) === "";
}
