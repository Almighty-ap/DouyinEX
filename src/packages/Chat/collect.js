import { getSettings, setSetting } from "../../common/settings.js";
import { toast } from "../../common/dom.js";
import { addFavorite, hasFavorite } from "../../lib/favorites.js";

/**
 * 弹幕收藏：画面悬浮弹幕与右侧聊天列表共用同一份收藏列表（settings.dmFavorites）。
 * 存储与清洗逻辑在 src/lib/favorites.js，本模块只负责交互与提示。
 */
export function collectDanmaku(text) {
  const value = String(text == null ? "" : text).trim();
  if (!value) return false;
  const list = getSettings().dmFavorites;
  if (hasFavorite(list, value)) {
    toast("这条弹幕已在收藏中");
    return false;
  }
  setSetting("dmFavorites", addFavorite(list, value));
  toast("已收藏弹幕", "success");
  return true;
}

/**
 * 收藏按钮：className 由调用方决定（画面弹幕层与聊天列表样式不同）。
 * text 可以是字符串，也可以是 (event) => string —— 聊天列表的虚拟列表会复用条目节点，
 * 需要在点击那一刻按当前 DOM 重新取正文。
 */
export function makeFavoriteButton(className, text) {
  const btn = document.createElement("span");
  btn.className = className;
  btn.setAttribute("data-dyex-btn", "fav");
  btn.textContent = "收藏";
  btn.title = "收藏这条弹幕（可在 DouyinEX 面板的弹幕收藏中查看）";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    collectDanmaku(typeof text === "function" ? text(e) : text);
  });
  return btn;
}
