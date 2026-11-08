/**
 * 抖音直播流地址解析（纯函数，便于单测）。
 * 数据来源：页面 SSR 流式数据 window.__pace_f 中的 stream_url。
 */

export const QUALITY_ORDER = ["FULL_HD1", "HD1", "SD2", "SD1"];

export const QUALITY_LABEL = {
  FULL_HD1: "原画",
  HD1: "超清",
  SD2: "高清",
  SD1: "标清",
};

/** 从文本中按花括号配对截取 key 对应的 JSON 对象（忽略字符串内的括号） */
export function extractJsonObject(text, key) {
  const marker = `"${key}":`;
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  let i = text.indexOf("{", idx + marker.length);
  if (i === -1) return null;
  const start = i;
  let depth = 0;
  let inStr = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** 将 __pace_f 数组拼成可检索文本 */
export function paceToText(pace) {
  if (!Array.isArray(pace)) return "";
  return pace
    .map((item) => (Array.isArray(item) && typeof item[1] === "string" ? item[1] : ""))
    .join("");
}

/** 解析出 { flv: {FULL_HD1: url,...}, hls: {...} }，失败返回 null */
export function parseStreams(pace) {
  const text = paceToText(pace);
  const streamUrl = extractJsonObject(text, "stream_url");
  if (!streamUrl) return null;
  const flv = streamUrl.flv_pull_url || {};
  const hls = streamUrl.hls_pull_url_map || {};
  if (!Object.keys(flv).length && !Object.keys(hls).length) return null;
  return { flv, hls };
}

/** 按清晰度从高到低挑选可用档位，type: "flv" | "hls" */
export function pickUrl(streams, type = "flv", quality = null) {
  if (!streams) return null;
  const map = streams[type] || {};
  if (quality && map[quality]) return { quality, url: map[quality] };
  for (const q of QUALITY_ORDER) {
    if (map[q]) return { quality: q, url: map[q] };
  }
  return null;
}

/** 列出所有可用档位 */
export function listQualities(streams, type = "flv") {
  const map = (streams && streams[type]) || {};
  return QUALITY_ORDER.filter((q) => map[q]).map((q) => ({
    quality: q,
    label: QUALITY_LABEL[q],
    url: map[q],
  }));
}
