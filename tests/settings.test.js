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
