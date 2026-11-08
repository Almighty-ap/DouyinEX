import { win, copyText } from "../../common/env.js";
import { toast, waitFor, sleep } from "../../common/dom.js";
import { parseStreams, pickUrl, listQualities, QUALITY_LABEL } from "../../lib/stream.js";

/** 读取当前直播间流地址；SPA 切换房间后 __pace_f 会追加新数据，因此每次现取 */
export function getStreams() {
  return parseStreams(win.__pace_f);
}

/** 复制直播流。quality 为空时取最高档；type: flv | hls */
export async function copyStream(type = "flv", quality = null) {
  const streams = getStreams();
  const picked = pickUrl(streams, type, quality);
  if (!picked) {
    toast("未获取到直播流（房间未开播或页面数据未就绪）", "error");
    return false;
  }
  await copyText(picked.url);
  toast(`已复制 ${QUALITY_LABEL[picked.quality]} ${type.toUpperCase()} 地址`, "success");
  return true;
}

export function getStreamMenuItems() {
  const streams = getStreams();
  const items = [];
  for (const type of ["flv", "hls"]) {
    for (const q of listQualities(streams, type)) {
      items.push({ type, quality: q.quality, label: `${q.label} ${type.toUpperCase()}` });
    }
  }
  return items;
}

/** 自动切换到最高可用画质：从上到下依次点击，直到当前画质文案发生变化或到末尾 */
export async function autoHighestQuality() {
  const current = await waitFor('[data-e2e="quality"]', 20000);
  const selector = document.querySelector('[data-e2e="quality-selector"]');
  if (!current || !selector) return false;
  const before = current.textContent.trim();
  // 带「登录即享」角标的档位需要登录，点击会弹出登录框，必须跳过。
  // 注意不能看可见性：未登录时角标也是 visibility:hidden（悬停才显示）；
  // 已登录时角标节点不在 DOM 中，所以只判断节点是否存在
  const isLoginGated = (el) =>
    Array.from(el.parentElement?.children || []).some(
      (sib) => sib !== el && sib.textContent.includes("登录即享")
    );
  const options = Array.from(selector.querySelectorAll("div")).filter(
    (el) =>
      el.children.length === 0 &&
      /原画|蓝光|超清|高清|标清/.test(el.textContent) &&
      !isLoginGated(el)
  );
  if (!options.length) return false;
  if (options[0].textContent.trim() === before) return true; // 已是最高档
  for (const opt of options) {
    if (opt.textContent.trim() === before) return true;
    opt.click();
    await sleep(1200);
    const now = document.querySelector('[data-e2e="quality"]')?.textContent.trim();
    if (now && now !== before) return true;
  }
  return false;
}
