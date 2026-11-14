import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_MAX,
  normalizeHistory,
  pushHistory,
  nextHistoryIndex,
} from "../src/lib/history.js";

test("normalizeHistory 清洗非字符串与空串，压缩空白并保留顺序", () => {
  assert.deepEqual(normalizeHistory(null), []);
  assert.deepEqual(normalizeHistory("x"), []);
  assert.deepEqual(normalizeHistory(["a", "", "  ", 1, null, " b   c ", "\n6"]), ["a", "b c", "6"]);
});

test("normalizeHistory 超出上限时保留最新的", () => {
  const many = Array.from({ length: HISTORY_MAX + 10 }, (_, i) => `t${i}`);
  const out = normalizeHistory(many);
  assert.equal(out.length, HISTORY_MAX);
  assert.equal(out[out.length - 1], `t${HISTORY_MAX + 9}`);
  assert.equal(out.includes("t0"), false);
});

test("pushHistory 追加到末尾，空文本与连发同款不写入", () => {
  const base = ["a", "b"];
  assert.deepEqual(pushHistory(base, "c"), ["a", "b", "c"]);
  assert.deepEqual(pushHistory(base, "b"), ["a", "b"]);
  assert.deepEqual(pushHistory(base, "  "), ["a", "b"]);
  assert.deepEqual(pushHistory(base, null), ["a", "b"]);
  assert.deepEqual(base, ["a", "b"]);
});

test("pushHistory 超出上限时丢弃最旧的", () => {
  const full = Array.from({ length: HISTORY_MAX }, (_, i) => `t${i}`);
  const out = pushHistory(full, "new");
  assert.equal(out.length, HISTORY_MAX);
  assert.equal(out[out.length - 1], "new");
  assert.equal(out.includes("t0"), false);
});

test("nextHistoryIndex 向上翻到最旧后停在最旧一条", () => {
  assert.equal(nextHistoryIndex(null, 3, -1), 2);
  assert.equal(nextHistoryIndex(2, 3, -1), 1);
  assert.equal(nextHistoryIndex(1, 3, -1), 0);
  assert.equal(nextHistoryIndex(0, 3, -1), 0);
  assert.equal(nextHistoryIndex(null, 0, -1), null);
});

test("nextHistoryIndex 向下翻过最新一条后退出浏览", () => {
  assert.equal(nextHistoryIndex(0, 3, 1), 1);
  assert.equal(nextHistoryIndex(1, 3, 1), 2);
  assert.equal(nextHistoryIndex(2, 3, 1), null);
  assert.equal(nextHistoryIndex(null, 3, 1), null);
  assert.equal(nextHistoryIndex(0, 1, 1), null);
});

test("nextHistoryIndex 越界或非整数下标按未浏览处理", () => {
  assert.equal(nextHistoryIndex(5, 3, -1), 2);
  assert.equal(nextHistoryIndex(-1, 3, 1), null);
  assert.equal(nextHistoryIndex(NaN, 3, -1), 2);
});
