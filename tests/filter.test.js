import test from "node:test";
import assert from "node:assert/strict";
import {
  parseKeywords,
  matchKeywords,
  parseLevelFromSrc,
  createRepeatFilter,
  isActionableChatText,
} from "../src/lib/filter.js";

test("parseKeywords 支持子串与正则，忽略空行与非法正则", () => {
  const rules = parseKeywords("刷屏\n\n/^6{3,}$/i\n/(/\n");
  assert.equal(rules.length, 3);
  assert.equal(rules[0].type, "str");
  assert.equal(rules[1].type, "re");
  assert.equal(rules[2].type, "str"); // 非法正则退化
});

test("matchKeywords 命中判断", () => {
  const rules = parseKeywords("刷屏\n/^6{3,}$/");
  assert.equal(matchKeywords("不要刷屏", rules), true);
  assert.equal(matchKeywords("6666", rules), true);
  assert.equal(matchKeywords("66", rules), false);
});

test("parseLevelFromSrc 提取用户等级", () => {
  const src = "https://p11.douyinpic.com/img/webcast/new_user_grade_level_v1_9.png~tplv-obj.image";
  assert.equal(parseLevelFromSrc(src), 9);
  assert.equal(parseLevelFromSrc("https://x/y.png"), null);
  assert.equal(parseLevelFromSrc(undefined), null);
});

test("isActionableChatText 只给正常聊天正文挂 +1 / 收藏", () => {
  assert.equal(isActionableChatText("小明：这波操作可以"), true);
  assert.equal(isActionableChatText("  来了 "), false); // 进场提示
  assert.equal(isActionableChatText("亚托狗史 来了"), false);
  assert.equal(isActionableChatText(""), false); // 空正文（系统占位条目）
  assert.equal(isActionableChatText("   "), false);
  assert.equal(isActionableChatText(null), false);
  assert.equal(isActionableChatText(undefined), false);
  assert.equal(isActionableChatText("来了就别走"), true); // 只在结尾判定进场
});

test("createRepeatFilter 窗口内重复判定，过期后重置", () => {
  const isRepeat = createRepeatFilter(1000);
  assert.equal(isRepeat("哈哈", 0), false);
  assert.equal(isRepeat("哈哈", 500), true);
  assert.equal(isRepeat("哈哈", 2000), false);
});
