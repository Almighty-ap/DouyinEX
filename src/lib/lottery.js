const COMMENT_BTN_RE =
  /^(?:点击|立即)?(?:发送口令|一键发送|一键评论|发表评论|发送评论|评论参与|评论并参与|一键评论参与|去发表评论|一键发评论|一键发表评论|发评论参与|发送评论参与|发评论参与福袋|一键发评论参与福袋)(?:并参与|参与福袋|参与抽奖|参与)?(?:[（(](?:自动发送|自动评论|发送口令)[）)])?[>›»]?$/;

const DIRECT_JOIN_BTN_RE =
  /^(?:手动参与|立即参与|参与福袋|参与抽奖|一键参与|立即抽奖|免费参与|抢福袋|报名)$/;

const FOLLOW_BTN_RE =
  /^(?:关注|去关注|关注主播|关注参与|关注并参与|立即关注)(?:参与福袋|参与)?$/;

const JOINED_BTN_RE = /^(?:已参与|已成功参与|等待开奖|参与成功|报名成功)$/;

const PAID_BTN_RE = /粉丝团|灯牌|钻石|钻|抖币|付费|充值|升级|亲密度/;

function compact(text) {
  return String(text || "").replace(/\s+/g, "").trim();
}

/** 解析倒计时文本（MM:SS 或 HH:MM:SS）为秒数，无效返回 null */
export function parseCountdownSeconds(text) {
  if (!text) return null;
  const s = String(text).trim();
  if (!s || s.includes("--:--")) return null;
  const m = s.match(/(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)/);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const mins = parseInt(m[2], 10);
  const secs = parseInt(m[3], 10);
  if ([hours, mins, secs].some(Number.isNaN)) return null;
  const total = hours * 3600 + mins * 60 + secs;
  return total > 0 && total <= 7200 ? total : null;
}

/** 从评论条件描述中提取口令正文；若仅是泛指指令（如“去发表评论”）则返回空串 */
export function extractCommentCommand(text) {
  if (!text) return "";
  const raw = String(text)
    .replace(/\s*(?:未达成|已达成|未完成|已完成)\s*$/, "")
    .trim();
  const quoted = raw.match(/(?:发送|发表|评论|口令)[^\n“「"']{0,8}[“「"']([^”」"'\n]{1,100})[”」"']/);
  if (quoted) return quoted[1].trim();
  const labelled = raw.match(/(?:发送评论|发表评论|发送口令|评论内容|口令|评论)\s*[：:]\s*([^\n]{1,100})/);
  if (labelled) return labelled[1].trim();
  return "";
}

/** 对单条参与条件进行分类与完成态归一 */
export function classifyConditionItem(item = {}) {
  const requirement = String(item.requirement || "")
    .replace(/\s*(?:未达成|已达成|未完成|已完成)\s*$/, "")
    .trim();
  const status = String(item.status || "").trim();
  const completed = status === "已达成" || status === "已完成";
  const cleanReq = compact(requirement);

  if (!cleanReq || cleanReq === "参与条件") {
    return { type: "ignore", requirement, status, completed: true, command: "" };
  }
  if (cleanReq === "手动参与") {
    return { type: "manual", requirement, status, completed: true, command: "" };
  }
  // 评论口令本身可能包含“关注”“粉丝团”等文字，因此优先判定是否为评论类条件
  if (/^(?:发送|发表|一键|去发表)?(?:评论|口令)|^发送[“「"':：]/.test(cleanReq)) {
    return {
      type: "comment",
      requirement,
      status,
      completed,
      command: extractCommentCommand(requirement),
    };
  }
  if (/粉丝团|灯牌|钻石|钻|抖币|亲密度|会员/.test(cleanReq)) {
    return { type: "fansclub", requirement, status, completed, command: "" };
  }
  if (/分享|转发/.test(cleanReq)) {
    return { type: "share", requirement, status, completed, command: "" };
  }
  if (/关注/.test(cleanReq)) {
    return { type: "follow", requirement, status, completed, command: "" };
  }
  if (/观看|看播|停留/.test(cleanReq)) {
    return { type: "watch", requirement, status, completed, command: "" };
  }
  return { type: "unknown", requirement, status, completed, command: "" };
}

/** 从弹窗纯文本中兜底提取「条件描述 + 已达成/未达成」列表 */
export function parseConditionsFromText(text) {
  if (!text) return [];
  const items = [];
  const re = /([^\n]+?)\s*(未达成|已达成|未完成|已完成)(?=\s|$)/g;
  for (const m of String(text).matchAll(re)) {
    const req = m[1].replace(/^[\s•·\-*]+/, "").trim();
    if (!req || req === "参与条件") continue;
    items.push({ requirement: req, status: m[2] });
  }
  return items;
}

export function isCommentJoinButtonText(text) {
  return COMMENT_BTN_RE.test(compact(text));
}

export function isDirectJoinButtonText(text) {
  return DIRECT_JOIN_BTN_RE.test(compact(text));
}

export function isFollowButtonText(text) {
  return FOLLOW_BTN_RE.test(compact(text));
}

export function isPaidButtonText(text) {
  return PAID_BTN_RE.test(compact(text));
}

/**
 * 评估当前福袋弹窗是否可免费代抢及下一步动作：
 * - already_joined: 本轮已参与，关闭弹窗等待开奖
 * - skip: 含未达成付费/分享/未知条件，或需关注但未开启自动关注，本轮跳过
 * - wait_watch: 含未达成看播时长且剩余时间充足，先关弹窗稍后复查
 * - follow_then_join: 需关注主播且已开启自动关注，先点关注再点参与
 * - join_comment: 触发一键发评论参与（或配合 sendChat 兜底）
 * - join_direct: 无门槛或条件已全部达成，直接点击参与
 */
export function evaluateLotteryEligibility({
  conditions = [],
  alreadyJoined = false,
  buttonText = "",
  allowFollow = false,
  remainingSeconds = null,
} = {}) {
  const cleanBtn = compact(buttonText);

  if (alreadyJoined || JOINED_BTN_RE.test(cleanBtn)) {
    return { action: "already_joined", command: "", reason: "本轮已参与" };
  }

  // 安全闸门：无论条件如何解析，只要主按钮带粉丝团/钻石等付费字样一律跳过
  if (isPaidButtonText(cleanBtn)) {
    return { action: "skip", command: "", reason: "按钮含粉丝团或付费字样" };
  }

  const classified = conditions
    .map(classifyConditionItem)
    .filter((c) => c.type !== "ignore" && c.type !== "manual");

  const blocked = classified.find(
    (c) => !c.completed && (c.type === "fansclub" || c.type === "share" || c.type === "unknown"),
  );
  if (blocked) {
    const label =
      blocked.type === "fansclub"
        ? "需付费粉丝团/灯牌"
        : blocked.type === "share"
          ? "需分享直播间"
          : `含未支持条件（${blocked.requirement}）`;
    return { action: "skip", command: "", reason: label };
  }

  const needsFollow = classified.some((c) => c.type === "follow" && !c.completed);
  if (needsFollow && !allowFollow) {
    return { action: "skip", command: "", reason: "需关注主播（未开启自动关注）" };
  }

  const needsWatch = classified.some((c) => c.type === "watch" && !c.completed);
  if (needsWatch) {
    if (remainingSeconds !== null && remainingSeconds <= 25) {
      return { action: "skip", command: "", reason: "看播时长未达成且临近开奖" };
    }
    const retryDelaySec =
      remainingSeconds !== null ? Math.max(5, Math.min(60, remainingSeconds - 25)) : 30;
    return {
      action: "wait_watch",
      command: "",
      retryDelaySec,
      reason: "等待看播时长达标",
    };
  }

  const commentItem =
    classified.find((c) => c.type === "comment" && !c.completed) ||
    classified.find((c) => c.type === "comment");
  const command = commentItem ? commentItem.command : "";

  if (needsFollow || (classified.length === 0 && isFollowButtonText(cleanBtn))) {
    if (!allowFollow) {
      return { action: "skip", command: "", reason: "需关注主播（未开启自动关注）" };
    }
    return { action: "follow_then_join", command, reason: "先自动关注主播再参与" };
  }

  const needsComment = classified.some((c) => c.type === "comment" && !c.completed);
  if (needsComment || isCommentJoinButtonText(cleanBtn)) {
    return { action: "join_comment", command, reason: "满足发评论参与条件" };
  }

  if (
    (classified.length > 0 && classified.every((c) => c.completed)) ||
    isDirectJoinButtonText(cleanBtn)
  ) {
    return { action: "join_direct", command: "", reason: "无限制或条件已全部达成" };
  }

  return { action: "skip", command: "", reason: "未识别到安全的免费参与入口" };
}

/** 解析开奖结果弹窗文本 */
export function parseLotteryResultText(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (/没抽中|未中奖|没中奖|未抽中|没中|遗憾|下次|好运|未能|空手/.test(s)) {
    return { status: "lost", text: s };
  }
  if (/中奖|恭喜|获得|抽中|幸运|赢得了|领取/.test(s)) {
    return { status: "won", text: s };
  }
  return { status: "unknown", text: s };
}
