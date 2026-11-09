import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCountdownSeconds,
  extractCommentCommand,
  classifyConditionItem,
  parseConditionsFromText,
  evaluateLotteryEligibility,
  parseLotteryResultText,
} from "../src/lib/lottery.js";

test("parseCountdownSeconds 解析 MM:SS 与 HH:MM:SS 并过滤非法值", () => {
  assert.equal(parseCountdownSeconds("02:35"), 155);
  assert.equal(parseCountdownSeconds("倒计时 01:05"), 65);
  assert.equal(parseCountdownSeconds("01:00:00"), 3600);
  assert.equal(parseCountdownSeconds("--:--"), null);
  assert.equal(parseCountdownSeconds("00:00"), null);
  assert.equal(parseCountdownSeconds(""), null);
});

test("extractCommentCommand 提取口令并忽略泛指指令与尾部状态", () => {
  assert.equal(extractCommentCommand("发送评论：恭喜发财"), "恭喜发财");
  assert.equal(extractCommentCommand("发送口令「666」 未达成"), "666");
  assert.equal(extractCommentCommand("发表评论：“关注主播不迷路” 已达成"), "关注主播不迷路");
  assert.equal(extractCommentCommand("去发表评论"), "");
  assert.equal(extractCommentCommand("发送评论"), "");
});

test("classifyConditionItem 优先识别含敏感词的评论口令，准确区分粉丝团/关注/看播", () => {
  const commentWithKeyword = classifyConditionItem({
    requirement: "发送评论：加入粉丝团关注主播",
    status: "未达成",
  });
  assert.equal(commentWithKeyword.type, "comment");
  assert.equal(commentWithKeyword.command, "加入粉丝团关注主播");
  assert.equal(commentWithKeyword.completed, false);

  const fan = classifyConditionItem({ requirement: "加入主播粉丝团", status: "未达成" });
  assert.equal(fan.type, "fansclub");
  assert.equal(fan.completed, false);

  const watch = classifyConditionItem({ requirement: "观看直播 5 分钟", status: "已达成" });
  assert.equal(watch.type, "watch");
  assert.equal(watch.completed, true);
});

test("parseConditionsFromText 从弹窗纯文本提取条件列表", () => {
  const raw = "参与条件\n关注主播 已达成\n发送评论：好运连连 未达成\n";
  const list = parseConditionsFromText(raw);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { requirement: "关注主播", status: "已达成" });
  assert.deepEqual(list[1], { requirement: "发送评论：好运连连", status: "未达成" });
});

test("evaluateLotteryEligibility 覆盖纯评论、老粉已达成粉丝团、付费拦截、看播等待与可选关注", () => {
  // 1. 纯评论条件 -> join_comment
  const pureComment = evaluateLotteryEligibility({
    conditions: [{ requirement: "发送评论：666", status: "未达成" }],
    buttonText: "一键发评论参与福袋",
  });
  assert.equal(pureComment.action, "join_comment");
  assert.equal(pureComment.command, "666");

  // 2. 未达成粉丝团 -> skip
  const unpaidFan = evaluateLotteryEligibility({
    conditions: [
      { requirement: "加入粉丝团", status: "未达成" },
      { requirement: "发送评论：666", status: "未达成" },
    ],
    buttonText: "加入粉丝团(1钻石)",
  });
  assert.equal(unpaidFan.action, "skip");

  // 3. 粉丝团已达成 + 评论未达成 -> join_comment（老粉免费白嫖）
  const metFan = evaluateLotteryEligibility({
    conditions: [
      { requirement: "加入粉丝团", status: "已达成" },
      { requirement: "发送评论：大气", status: "未达成" },
    ],
    buttonText: "一键发评论参与福袋",
  });
  assert.equal(metFan.action, "join_comment");
  assert.equal(metFan.command, "大气");

  // 4. 看播时长未达成且剩余时间充足 -> wait_watch
  const waitWatch = evaluateLotteryEligibility({
    conditions: [
      { requirement: "观看直播 3 分钟", status: "未达成" },
      { requirement: "发送评论：中奖", status: "未达成" },
    ],
    remainingSeconds: 120,
  });
  assert.equal(waitWatch.action, "wait_watch");
  assert.equal(waitWatch.retryDelaySec, 60);

  // 5. 看播时长未达成但临近开奖（<=25s）-> skip
  const lateWatch = evaluateLotteryEligibility({
    conditions: [{ requirement: "观看直播 3 分钟", status: "未达成" }],
    remainingSeconds: 15,
  });
  assert.equal(lateWatch.action, "skip");

  // 6. 需关注主播：allowFollow=false 时跳过，allowFollow=true 时 follow_then_join
  const followConds = [
    { requirement: "关注主播", status: "未达成" },
    { requirement: "发送评论：支持主播", status: "未达成" },
  ];
  const skipFollow = evaluateLotteryEligibility({
    conditions: followConds,
    allowFollow: false,
  });
  assert.equal(skipFollow.action, "skip");

  const allowFollowRes = evaluateLotteryEligibility({
    conditions: followConds,
    allowFollow: true,
  });
  assert.equal(allowFollowRes.action, "follow_then_join");
  assert.equal(allowFollowRes.command, "支持主播");

  // 7. 无门槛手动参与 -> join_direct
  const manualJoin = evaluateLotteryEligibility({
    conditions: [{ requirement: "手动参与", status: "未达成" }],
    buttonText: "参与福袋",
  });
  assert.equal(manualJoin.action, "join_direct");
});

test("parseLotteryResultText 识别中奖与未中奖文案", () => {
  assert.equal(parseLotteryResultText("很遗憾，本次未抽中福袋").status, "lost");
  assert.equal(parseLotteryResultText("恭喜你获得福袋奖品").status, "won");
  assert.equal(parseLotteryResultText(""), null);
});
