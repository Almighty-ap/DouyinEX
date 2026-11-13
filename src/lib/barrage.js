/** 画面弹幕（抖音 CanvasDanmakuPlugin）相关纯函数，便于单测 */

/** 从 addBarrage 的 params 提取文本与特征 */
export function extractBarrage(params) {
  const content = Array.isArray(params && params.content) ? params.content : [];
  const text = content
    .filter((c) => c && c.type === "text")
    .map((c) => String(c.text == null ? "" : c.text))
    .join("")
    .trim();
  const hasImage = content.some((c) => c && c.type === "image");
  return {
    id: String((params && params.id) || ""),
    text,
    hasImage,
    // 自己发的弹幕带边框，不应被屏蔽规则误伤
    isSelf: !!(params && params.borderWidth),
    // 画面上的送礼流水弹幕（如「xxx 送出粉丝团灯牌 x 1」），不应挂 +1 跟发按钮
    isGift: hasImage && /\s*送出.+\sx\s*\d+$/i.test(text),
    content,
  };
}

/** 弹幕显示区域预设：起点与终点均为播放器高度的比例（0 = 顶部，1 = 底部） */
export const DM_AREAS = [
  { key: "top", label: "顶部 1/4", start: 0, end: 0.25 },
  { key: "half", label: "上半屏", start: 0, end: 0.5 },
  { key: "upper75", label: "上 3/4", start: 0, end: 0.75 },
  { key: "full", label: "全屏", start: 0, end: 1 },
  { key: "bottomHalf", label: "下半屏", start: 0.5, end: 1 },
];

export const DM_AREA_DEFAULT = "half";

/** 取显示区域预设；未知值一律回退默认（上半屏） */
export function resolveArea(key) {
  return (
    DM_AREAS.find((a) => a.key === key) ||
    DM_AREAS.find((a) => a.key === DM_AREA_DEFAULT)
  );
}

/** 弹幕速度档位 1（最慢）~ 10（最快），5 与抖音原生默认一致 */
export const DM_SPEED_DEFAULT = 5;
export const DM_SPEED_MIN = 1;
export const DM_SPEED_MAX = 10;

// 抖音原生 speed 的单位是「穿过整屏所需的毫秒数」：数值越小越快
// （原生「移动速度」只有 3 档：较慢 18000 / 适中 14400 / 较快 10800）
export const DM_SPEED_MS_MIN = 2000;
export const DM_SPEED_MS_MAX = 60000;
export const DM_SPEED_MS_DEFAULT = 14400;

/** 把任意 speed 值夹到可用区间；非法值回退默认（适中） */
export function clampSpeedMs(ms, fallback = DM_SPEED_MS_DEFAULT) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(DM_SPEED_MS_MAX, Math.max(DM_SPEED_MS_MIN, Math.round(n)));
}

// 档位对应的移动速度 px/秒；14400 px/分钟（抖音原生默认）÷ 60 = 240
const SPEED_PPS = [96, 132, 168, 204, 240, 288, 348, 420, 504, 600];

/** 速度档位 → 弹幕移动速度（px/秒）；越界与非法值一律夹取到合法档位 */
export function speedLevelToPps(level) {
  const n = Math.round(Number(level));
  const lv = Number.isFinite(n)
    ? Math.min(DM_SPEED_MAX, Math.max(DM_SPEED_MIN, n))
    : DM_SPEED_DEFAULT;
  return SPEED_PPS[lv - 1];
}

/** 可用轨道数：按 maxHeightRate 限制占用高度 */
export function getLaneCount({ height, channelHeight, maxHeightRate }) {
  if (!height || !channelHeight) return 1;
  const usable = Math.min(height, (maxHeightRate || 1) * height);
  return Math.max(1, Math.floor(usable / channelHeight));
}

/**
 * 轨道分配：弹幕匀速右→左，速度 v = (屏宽 + 弹幕宽) / 时长，
 * 所以长弹幕更快，必须保证后一条既不与前一条重叠，也不会在途中追尾。
 * 位置/时间均为 ms 与 px。
 */
export function createLaneAllocator({ laneCount, gap = 30 }) {
  const lanes = Array.from({ length: laneCount }, () => null);

  function canFollow(prev, now, screenW, v) {
    // 条件 1：前一条的尾部已完全进入屏幕，并留出间隙
    if (now < prev.start + (prev.width + gap) / prev.v) return false;
    // 条件 2：前一条尾部离开屏幕时，新的这条头部仍落后至少一个间隙
    const prevExitAt = prev.start + prev.duration;
    const latest = prevExitAt - Math.max(0, screenW - gap) / v;
    return now >= latest;
  }

  return {
    laneCount,
    /** 尝试放入一条弹幕，返回轨道下标，放不下返回 -1 */
    place({ now, screenW, width, duration }) {
      const v = (screenW + width) / duration;
      for (let i = 0; i < lanes.length; i++) {
        const prev = lanes[i];
        if (!prev || canFollow(prev, now, screenW, v)) {
          lanes[i] = { start: now, v, width, duration };
          return i;
        }
      }
      return -1;
    },
  };
}
