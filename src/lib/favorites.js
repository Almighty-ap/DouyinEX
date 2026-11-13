/** 弹幕收藏相关纯函数，便于单测 */

export const FAV_MAX = 300;

/** 清洗收藏列表：仅保留非空字符串，去重（保留首次出现的顺序），并截断到上限 */
export function normalizeFavorites(raw) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= FAV_MAX) break;
  }
  return out;
}

export function hasFavorite(list, text) {
  return normalizeFavorites(list).includes(String(text == null ? "" : text).trim());
}

/** 新增一条收藏：已存在则原样返回（不重复、不换位），新条目置于最前，超出上限丢弃最旧的 */
export function addFavorite(list, text) {
  const cur = normalizeFavorites(list);
  const value = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (!value || cur.includes(value)) return cur;
  return [value, ...cur].slice(0, FAV_MAX);
}

/** 删除一条收藏（按清洗后的文本精确匹配） */
export function removeFavorite(list, text) {
  const value = String(text == null ? "" : text).trim();
  return normalizeFavorites(list).filter((t) => t !== value);
}

/** 按关键词过滤收藏列表（大小写不敏感的子串匹配，空关键词返回全部） */
export function filterFavorites(list, query) {
  const cur = normalizeFavorites(list);
  const q = String(query == null ? "" : query).trim().toLowerCase();
  if (!q) return cur;
  return cur.filter((t) => t.toLowerCase().includes(q));
}
