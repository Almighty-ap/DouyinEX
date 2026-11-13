import test from "node:test";
import assert from "node:assert/strict";
import {
  FAV_MAX,
  normalizeFavorites,
  hasFavorite,
  addFavorite,
  removeFavorite,
  filterFavorites,
} from "../src/lib/favorites.js";

test("normalizeFavorites 清洗非字符串、空串与重复项并保留首次顺序", () => {
  assert.deepEqual(normalizeFavorites(null), []);
  assert.deepEqual(normalizeFavorites("x"), []);
  assert.deepEqual(normalizeFavorites(["a", "", "   ", 1, null, "a", " b ", "c"]), ["a", "b", "c"]);
});

test("normalizeFavorites 截断到上限", () => {
  const many = Array.from({ length: FAV_MAX + 10 }, (_, i) => `t${i}`);
  const out = normalizeFavorites(many);
  assert.equal(out.length, FAV_MAX);
  assert.equal(out[FAV_MAX - 1], `t${FAV_MAX - 1}`);
});

test("addFavorite 新条目置顶、已存在的保持原位且不修改入参", () => {
  const base = ["b", "a"];
  assert.deepEqual(addFavorite(base, "c"), ["c", "b", "a"]);
  assert.deepEqual(addFavorite(base, " a "), ["b", "a"]);
  assert.deepEqual(addFavorite(base, "   "), ["b", "a"]);
  assert.deepEqual(addFavorite(base, null), ["b", "a"]);
  assert.deepEqual(base, ["b", "a"]);
});

test("addFavorite 超出上限时丢弃最旧的", () => {
  const full = Array.from({ length: FAV_MAX }, (_, i) => `t${i}`);
  const out = addFavorite(full, "new");
  assert.equal(out.length, FAV_MAX);
  assert.equal(out[0], "new");
  assert.equal(out.includes(`t${FAV_MAX - 1}`), false);
});

test("hasFavorite 与 removeFavorite 按清洗后的文本匹配", () => {
  const list = [" b ", "a"];
  assert.equal(hasFavorite(list, "b"), true);
  assert.equal(hasFavorite(list, " c "), false);
  assert.deepEqual(removeFavorite(list, " b "), ["a"]);
  assert.deepEqual(removeFavorite(list, "zzz"), ["b", "a"]);
});

test("filterFavorites 关键词大小写不敏感，空关键词返回全部", () => {
  const list = ["Hello World", "弹幕", "hello 抖音"];
  assert.deepEqual(filterFavorites(list, "HELLO"), ["Hello World", "hello 抖音"]);
  assert.deepEqual(filterFavorites(list, "弹幕"), ["弹幕"]);
  assert.deepEqual(filterFavorites(list, "  "), list);
  assert.deepEqual(filterFavorites(list, "zzz"), []);
  assert.deepEqual(filterFavorites(list, null), list);
});
