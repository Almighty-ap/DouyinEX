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
