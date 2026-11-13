import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  normalizeSettings,
  resetSettingsCacheForTest,
  getSettings,
  setSetting,
  onSettingChange,
} from "../src/common/settings.js";

test("DEFAULTS 包含 autoFull 与 hideGiftBar 且默认关闭", () => {
  assert.equal(DEFAULTS.autoWebFull, false);
  assert.equal(DEFAULTS.autoFull, false);
  assert.equal(DEFAULTS.hideGiftBar, false);
  assert.equal(DEFAULTS.fullscreenFoldChat, true);
});

test("normalizeSettings 在同时开启 autoFull 与 autoWebFull 时自动消解冲突", () => {
  const s = normalizeSettings({ autoFull: true, autoWebFull: true });
  assert.equal(s.autoFull, true);
  assert.equal(s.autoWebFull, false);
});

test("DEFAULTS 含弹幕显示与收藏默认值，normalizeSettings 夹取非法值", () => {
  assert.equal(DEFAULTS.dmFontSize, 20);
  assert.equal(DEFAULTS.dmOpacity, 80);
  assert.equal(DEFAULTS.dmSpeed, 5);
  assert.equal(DEFAULTS.dmArea, "half");
  assert.deepEqual(DEFAULTS.dmFavorites, []);

  const s = normalizeSettings({
    dmFontSize: 999,
    dmOpacity: 0,
    dmSpeed: 99,
    dmArea: "nope",
    dmFavorites: [" 收藏这条 ", "收藏这条", 3, ""],
  });
  assert.equal(s.dmFontSize, 40);
  assert.equal(s.dmOpacity, 20);
  assert.equal(s.dmSpeed, 10);
  assert.equal(s.dmArea, "half");
  assert.deepEqual(s.dmFavorites, ["收藏这条"]);
  assert.deepEqual(DEFAULTS.dmFavorites, []);

  const d = normalizeSettings();
  assert.equal(d.dmFontSize, 20);
  assert.equal(d.dmOpacity, 80);
  assert.equal(d.dmSpeed, 5);
  assert.equal(d.dmArea, "half");
});

test("setSetting 保证 autoFull 与 autoWebFull 双向互斥并触发变更通知", () => {
  resetSettingsCacheForTest();
  const events = [];
  const off = onSettingChange((k, v) => events.push([k, v]));

  try {
    setSetting("autoWebFull", true);
    assert.equal(getSettings().autoWebFull, true);
    assert.equal(getSettings().autoFull, false);

    events.length = 0;
    setSetting("autoFull", true);
    assert.equal(getSettings().autoFull, true);
    assert.equal(getSettings().autoWebFull, false);
    assert.deepEqual(events, [
      ["autoWebFull", false],
      ["autoFull", true],
    ]);

    events.length = 0;
    setSetting("autoWebFull", true);
    assert.equal(getSettings().autoWebFull, true);
    assert.equal(getSettings().autoFull, false);
    assert.deepEqual(events, [
      ["autoFull", false],
      ["autoWebFull", true],
    ]);

    setSetting("hideGiftBar", true);
    assert.equal(getSettings().hideGiftBar, true);
  } finally {
    off();
  }
});
