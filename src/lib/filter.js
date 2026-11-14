/** 弹幕过滤规则（纯函数，便于单测） */

/** 解析关键词配置：每行一条；/regex/ 形式视为正则，否则按子串匹配 */
export function parseKeywords(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^\/(.+)\/([gimsuy]*)$/);
      if (m) {
        try {
          return { type: "re", re: new RegExp(m[1], m[2].replace("g", "")) };
        } catch {
          /* 非法正则退化为子串 */
        }
      }
      return { type: "str", text: s };
    });
}

export function matchKeywords(text, rules) {
  for (const r of rules) {
    if (r.type === "re" ? r.re.test(text) : text.includes(r.text)) return true;
  }
  return false;
}

/** 从用户等级图片地址提取等级，如 new_user_grade_level_v1_9.png → 9 */
export function parseLevelFromSrc(src) {
  const m = String(src || "").match(/user_grade_level_v\d+_(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * 聊天条目是否值得挂 +1 / 收藏：空正文与「xx 来了」进场提示都不挂。
 * 送礼流水按 DOM 结构另判（见 Chat/Shield.js 的 isGiftMessage）。
 */
export function isActionableChatText(text) {
  const t = String(text == null ? "" : text).trim();
  return !!t && !/来了$/.test(t);
}

/** 重复弹幕检测：窗口内同一内容出现过则判定重复 */
export function createRepeatFilter(windowMs = 10000, max = 200) {
  const seen = new Map();
  return function isRepeat(text, now = Date.now()) {
    for (const [k, t] of seen) {
      if (now - t > windowMs) seen.delete(k);
    }
    if (seen.size > max) seen.clear();
    const hit = seen.has(text);
    seen.set(text, now);
    return hit;
  };
}
