import { getSettings } from "../../common/settings.js";
import { waitFor } from "../../common/dom.js";
import { nextHistoryIndex } from "../../lib/history.js";
import { CHAT_EDITOR, findChatInput, setEditorText } from "./send.js";
import { isSelfSendRecent, recordSent } from "./historyStore.js";

/**
 * 输入框上下键调取「我发送过的弹幕」（键位习惯对齐命令行：↑ 向更旧、↓ 向更新，
 * ↓ 翻过最新一条即回到空白输入框；翻到的内容只填进输入框，不发送）。
 *
 * 三条约束：
 * 1. 只在输入框为空时接管 ↑：正在写内容时 ↑ 仍然是正常的光标移动，不抢方向键。
 * 2. **每次按键同步推进候选下标，写入输入框则合并成一次**：连按时逐个回填会与 Slate
 *    的异步渲染互相踩（实测连按三次只走一步或串字），所以把「算下标」与「写 DOM」拆开。
 * 3. **输入框被清空（或内容已不是我们写进去的那条）时，候选回到最新一条重新开始。**
 *
 * 「已发送」怎么判定：不能等 Enter 的 keydown——抖音在比自己更早的阶段就已把弹幕发出并清空
 * 输入框，而 Blink 会在同一个事件的不同监听器之间结算微任务（实测 MutationObserver 比我们的
 * keydown 监听器先跑，届时输入框已是空的）。因此改为跟踪输入框「有内容 → 空」的翻转，
 * 并排除脚本自己发送的（historyStore.markSelfSend）与用户手动删除草稿（keydown 打时间戳）。
 */

const ZERO_WIDTH = String.fromCharCode(0x200b);
const INPUT_BOX = ".webcast-chatroom___input-container";
// 用户手动删除与随后那次「清空」之间的最大间隔，超出即认为与删除无关
const USER_EDIT_MS = 300;
// 连按时把多次回填合并成一次写入的等待时间
const WRITE_DEBOUNCE_MS = 50;
// 长按方向键时每步的最短间隔。系统按键重复约 30 次/秒，不节流会一滑到底翻不出内容；
// 这里只对「系统重复」（e.repeat）限速，手动连点（每次都是新的按下）不受影响、不会掉步。
const REPEAT_MIN_MS = 150;

let bound = false;
let browseIndex = null; // 正在浏览的第几条（列表由旧到新），null = 没在浏览
let applied = null; // 最近一次由我们写进输入框的文本，用于识别内容是否还是我们写的
let tracked = ""; // 输入框里上一次读到的正文
let userDeletedAt = 0; // 最近一次用户手动删除（含全选删除）的时间
let writeTimer = null;
let lastStepAt = 0; // 最近一次因方向键推进候选的时间（长按节流用）

function editorText(el) {
  return el.innerText.split(ZERO_WIDTH).join("").replace(/\s+/g, " ").trim();
}

function resetBrowse() {
  browseIndex = null;
  applied = null;
}

/** 只算下标：↑ 向更旧（到头就停在最旧一条），↓ 向更新（越过最新一条即回到空白） */
function stepIndex(dir, length) {
  return nextHistoryIndex(browseIndex, length, dir);
}

/** 真正写 DOM 前复核一次：内容已经不是我们写的，就放弃接管，绝不覆盖用户自己写的东西 */
function flushWrite(el) {
  writeTimer = null;
  if (browseIndex === null) {
    const now = editorText(el);
    if (now === "" || now === applied) setEditorText(el, "");
    applied = null;
    return;
  }
  const list = getSettings().chatHistory;
  const target = list[browseIndex];
  const now = editorText(el);
  if (target === undefined || (now !== "" && now !== applied)) {
    resetBrowse();
    return;
  }
  setEditorText(el, target);
  applied = target;
}

function scheduleWrite(el) {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => flushWrite(el), WRITE_DEBOUNCE_MS);
}

/** 输入框正文由「有内容」变成「空」：抖音发送成功后会这样清空，据此记为已发送 */
function trackText() {
  const el = findChatInput();
  const now = el ? editorText(el) : "";
  if (now === tracked) return;
  const prev = tracked;
  tracked = now;
  if (!prev || now) return;
  if (isSelfSendRecent()) return;
  if (Date.now() - userDeletedAt < USER_EDIT_MS) return;
  recordSent(prev);
}

function onKeyDown(e) {
  if (e.isComposing || e.keyCode === 229) return;
  const target = e.target;
  const el = target && target.closest ? target.closest(CHAT_EDITOR) : null;
  if (!el) return;

  // 退格 / 删除 / 剪切：这次清空是用户自己删的，不是发送（放在 keydown 里判断，
  // 因为删除引起的 DOM 变更发生在本次按键派发之后，我们的监听器一定先于它执行）
  if (e.key === "Backspace" || e.key === "Delete" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x")) {
    userDeletedAt = Date.now();
  }

  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  if (!getSettings().chatHistoryKeys) return;
  const list = getSettings().chatHistory;
  if (!list.length) return;

  const dir = e.key === "ArrowUp" ? -1 : 1;
  const text = editorText(el);
  // 连按时上一次回填还没落地（writing），此时输入框仍是空的，但候选已经在推进中，
  // 必须算作「我们正在浏览」，否则每次按键都会把候选重新拉回最新一条。
  const writing = writeTimer !== null;
  const browsing = browseIndex !== null && (text === applied || (writing && text === ""));
  if (dir < 0) {
    if (!browsing && text !== "") return; // 正在写内容 → 交给原生光标移动
  } else if (!browsing) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  const now = Date.now();
  // 长按（系统重复）限速：吞掉这次重复，不推进候选，也不会让光标乱跑
  if (e.repeat && now - lastStepAt < REPEAT_MIN_MS) return;
  lastStepAt = now;
  // 输入框里已经不是我写进去的那条（被清空或被改过）→ 候选从最新一条重新开始
  if (!browsing) resetBrowse();
  browseIndex = stepIndex(dir, list.length);
  scheduleWrite(el);
}

async function startTracker() {
  const box = await waitFor(INPUT_BOX, 60000);
  if (!box) return;
  new MutationObserver(trackText).observe(box, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  trackText();
}

export function initChatHistory() {
  if (bound) return;
  bound = true;
  document.addEventListener("keydown", onKeyDown, true);
  startTracker();
}
