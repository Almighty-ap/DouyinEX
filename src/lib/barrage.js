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

/**
 * 密集时的取舍：轨道全被占用时有两种策略，互为代价，由面板开关交给用户选（见 D-23）。
 * - 默认（`avoidOverlap = false`）**优先不丢弹幕**：同轨道最多等 `OVERLAP_WAIT_MS`，
 *   超过就直接出发、允许与同轨道前一条适度重叠，一条都不会丢；
 * - `avoidOverlap = true` **优先减少重叠**：继续等到轨道空出（画面更干净），但等待超过
 *   `OVERLAP_DROP_MS` 的这条丢弃——再等下去它与发送时刻脱节太远，屏上也会积压动画。
 */
export const OVERLAP_WAIT_MS = 1500;
export const OVERLAP_DROP_MS = 4000;

/**
 * 选轨道：优先用已空出的轨道，全都被占用时挑最早空出的那条。
 * 返回 `{ lane, startAt, drop }`，`startAt` 是出发时刻（ms），`drop` 为 true 表示按当前策略丢弃这条。
 * 立刻出发的重叠场景下 `startAt` 就是 `now`，调用方据此只把轨道时间戳往前推、不回拨。
 */
export function pickLane({ lanes, now, avoidOverlap = false }) {
  if (!Array.isArray(lanes) || !lanes.length) return { lane: 0, startAt: now, drop: false };
  let lane = 0;
  let earliest = Infinity;
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i] <= now) return { lane: i, startAt: now, drop: false };
    if (lanes[i] < earliest) {
      earliest = lanes[i];
      lane = i;
    }
  }
  const wait = earliest - now;
  if (avoidOverlap) {
    return wait > OVERLAP_DROP_MS
      ? { lane, startAt: earliest, drop: true }
      : { lane, startAt: earliest, drop: false };
  }
  return wait > OVERLAP_WAIT_MS
    ? { lane, startAt: now, drop: false }
    : { lane, startAt: earliest, drop: false };
}

/**
 * 操作行（`+1` / `收藏`）相对弹幕的偏移量：把它夹回播放器可见区。
 *
 * 操作行与弹幕文字左对齐，于是弹幕**左端飘出画面**之后按钮跟着出了左边；
 * 反过来，弹幕**刚进画面**（左端还在画面右边缘外）时整排按钮又都还在右边——
 * 这两段时间里都点不到（实测宽度 538px 的弹幕，前一种状态持续约 4.7 秒、占一趟的 1/3）。
 * 另外显示区域选「全屏」时，最下面一条轨道的弹幕，操作行会被层底裁掉，需要翻到文字上方。
 *
 * 入参均为视口坐标（px）：`row*` 是操作行**未加偏移时**的自然矩形，`layer*` 是渲染层可见区，
 * `itemTop` 是弹幕盒子顶边。返回 `{ dx, dy }`，调用方据此设 `translate(dx, dy)`。
 */
export function clampActionsOffset({
  rowLeft,
  rowTop,
  rowWidth,
  rowHeight,
  rowBottom,
  layerLeft,
  layerRight,
  layerTop,
  layerBottom,
  itemTop,
}) {
  // 水平：把左端夹进 [可见区左, 可见区右 - 操作行宽]；操作行比可见区还宽时贴左边缘
  const maxLeft = Math.max(layerLeft, layerRight - rowWidth);
  const dx = Math.round(Math.min(Math.max(rowLeft, layerLeft), maxLeft)) - Math.round(rowLeft);
  // 垂直：下方放得下就维持下方；下方放不下但上方放得下就翻到文字上方；两边都放不下维持下方
  const fitsBelow = rowBottom <= layerBottom - 1;
  const aboveTop = itemTop - rowHeight - 2;
  const fitsAbove = aboveTop >= layerTop + 1;
  const dy = fitsBelow || !fitsAbove ? 0 : Math.round(aboveTop - rowTop);
  return { dx, dy };
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
