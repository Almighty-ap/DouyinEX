/**
 * 「发送过的弹幕」历史相关纯函数，便于单测。
 * 列表按时间由旧到新排列，最新一条在末尾。
 */

export const HISTORY_MAX = 50;

function capOf(max) {
  const n = Math.floor(Number(max));
  return Number.isFinite(n) && n > 0 ? n : HISTORY_MAX;
}

/** 统一压缩空白；非字符串视为空 */
function clean(text) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

/** 清洗历史：仅保留非空字符串，压缩空白，超出上限时丢弃最旧的 */
export function normalizeHistory(raw, max = HISTORY_MAX) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const text = clean(item);
    if (text) out.push(text);
  }
  return out.slice(-capOf(max));
}

/**
 * 追加一条「已发送」的弹幕：空文本忽略；与上一条完全相同也忽略（连发同款不刷屏）；
 * 超出上限丢弃最旧的。返回新数组，不修改入参。
 */
export function pushHistory(list, text, max = HISTORY_MAX) {
  const cap = capOf(max);
  const cur = normalizeHistory(list, cap);
  const value = clean(text);
  if (!value || (cur.length && cur[cur.length - 1] === value)) return cur;
  return [...cur, value].slice(-cap);
}

/**
 * 上下键浏览时的下标推进。
 * index 为当前浏览位置（null 表示没在浏览历史），dir = -1 向更旧、+1 向更新。
 * 返回 null 表示应退出浏览（此时输入框恢复成本次要发送的内容，即清空）。
 */
export function nextHistoryIndex(index, length, dir) {
  const n = Math.floor(Number(length));
  if (!Number.isFinite(n) || n <= 0) return null;
  const i = Number.isInteger(index) && index >= 0 && index < n ? index : null;
  if (dir < 0) {
    if (i === null) return n - 1;
    return Math.max(0, i - 1);
  }
  if (i === null) return null;
  const next = i + 1;
  return next >= n ? null : next;
}
