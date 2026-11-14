import { getSettings, setSetting } from "../../common/settings.js";
import { pushHistory } from "../../lib/history.js";

/**
 * 「我发送过的弹幕」历史：持久化在 settings.chatHistory，供输入框上下键调取。
 * 清洗与上限逻辑在 src/lib/history.js，本模块只负责读写 settings。
 */

// 脚本自己发送（+1 / 收藏发送 / 循环发送）时置位：那条清空不算「用户手动发送」，
// 是否入库由 sendChat 自己决定（循环发送不入库）。
let selfSendAt = 0;

export function markSelfSend() {
  selfSendAt = Date.now();
}

export function isSelfSendRecent(ms = 2000) {
  return Date.now() - selfSendAt < ms;
}

export function recordSent(text) {
  const cur = getSettings().chatHistory;
  const next = pushHistory(cur, text);
  if (next.length === cur.length && next.every((v, i) => v === cur[i])) return false;
  setSetting("chatHistory", next);
  return true;
}
