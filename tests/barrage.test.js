import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBarrage,
  getLaneCount,
  createLaneAllocator,
  DM_AREAS,
  DM_AREA_DEFAULT,
  resolveArea,
  speedLevelToPps,
  DM_SPEED_DEFAULT,
  DM_SPEED_MIN,
  DM_SPEED_MAX,
  DM_SPEED_MS_MIN,
  DM_SPEED_MS_MAX,
  DM_SPEED_MS_DEFAULT,
  clampSpeedMs,
  pickLane,
  OVERLAP_WAIT_MS,
  OVERLAP_DROP_MS,
} from "../src/lib/barrage.js";

test("extractBarrage 拼接文字、识别图片与自己发的弹幕", () => {
  const b = extractBarrage({
    id: 123,
    content: [
      { type: "text", text: "不如" },
      { type: "text", text: "友人一根 " },
      { type: "image", src: "https://x/y.png" },
    ],
  });
  assert.equal(b.id, "123");
  assert.equal(b.text, "不如友人一根");
  assert.equal(b.hasImage, true);
  assert.equal(b.isSelf, false);
  assert.equal(b.isGift, false);
  assert.equal(extractBarrage({ content: [], borderWidth: 1 }).isSelf, true);
  assert.equal(
    extractBarrage({
      content: [
        { type: "image", src: "https://x/gift.png" },
        { type: "text", text: "Melody. 送出粉丝团灯牌 x 1" },
      ],
    }).isGift,
    true
  );
});

test("extractBarrage 容忍异常入参", () => {
  assert.equal(extractBarrage(undefined).text, "");
  assert.equal(extractBarrage({ content: "x" }).text, "");
  assert.equal(extractBarrage({ content: [null, { type: "text" }] }).text, "");
});

test("getLaneCount 按 maxHeightRate 限制轨道数", () => {
  assert.equal(getLaneCount({ height: 807, channelHeight: 40, maxHeightRate: 0.5 }), 10);
  assert.equal(getLaneCount({ height: 807, channelHeight: 40 }), 20);
  assert.equal(getLaneCount({ height: 30, channelHeight: 40, maxHeightRate: 0.5 }), 1);
  assert.equal(getLaneCount({}), 1);
});

test("resolveArea 返回预设比例，未知值与缺省一律回退上半屏", () => {
  assert.deepEqual(resolveArea("bottomHalf"), {
    key: "bottomHalf",
    label: "下半屏",
    start: 0.5,
    end: 1,
  });
  assert.equal(resolveArea(undefined).key, DM_AREA_DEFAULT);
  assert.equal(resolveArea("nope").key, "half");
  assert.equal(
    DM_AREAS.every((a) => a.start >= 0 && a.end <= 1 && a.end > a.start),
    true
  );
});

test("speedLevelToPps 档位越大越快，默认档等于抖音原生 240px/s", () => {
  assert.equal(speedLevelToPps(DM_SPEED_DEFAULT), 240);
  assert.equal(speedLevelToPps(1), 96);
  for (let lv = DM_SPEED_MIN; lv < DM_SPEED_MAX; lv++) {
    assert.ok(speedLevelToPps(lv) < speedLevelToPps(lv + 1));
  }
  assert.equal(speedLevelToPps(99), speedLevelToPps(DM_SPEED_MAX));
  assert.equal(speedLevelToPps(-3), speedLevelToPps(DM_SPEED_MIN));
  assert.equal(speedLevelToPps("abc"), 240);
});

test("clampSpeedMs 夹取原生速度（毫秒/整屏）并回退默认", () => {
  assert.equal(clampSpeedMs(14400), 14400);
  assert.equal(clampSpeedMs(1), DM_SPEED_MS_MIN);
  assert.equal(clampSpeedMs(999999), DM_SPEED_MS_MAX);
  assert.equal(clampSpeedMs("abc"), DM_SPEED_MS_DEFAULT);
  assert.equal(clampSpeedMs(null), DM_SPEED_MS_DEFAULT);
  assert.equal(clampSpeedMs(-5), DM_SPEED_MS_DEFAULT);
});

test("pickLane 优先用已空出的轨道，没有空轨道才排队", () => {
  const now = 10000;
  assert.deepEqual(pickLane({ lanes: [5000, 12000] , now }), { lane: 0, startAt: now, drop: false });
  assert.deepEqual(pickLane({ lanes: [12000, 9000], now }), { lane: 1, startAt: now, drop: false });
  // 全占用：排到最早空出的轨道，等得不久就等（默认策略下 1.5 秒以内）
  assert.deepEqual(pickLane({ lanes: [11000, 30000], now }), { lane: 0, startAt: 11000, drop: false });
  assert.deepEqual(pickLane({ lanes: [now + OVERLAP_WAIT_MS], now }), {
    lane: 0,
    startAt: now + OVERLAP_WAIT_MS,
    drop: false,
  });
  assert.deepEqual(pickLane({ lanes: [], now }), { lane: 0, startAt: now, drop: false });
});

test("pickLane 默认策略：等超过 1.5 秒就立刻出发（允许重叠），不丢弹幕", () => {
  const now = 10000;
  assert.deepEqual(pickLane({ lanes: [now + OVERLAP_WAIT_MS + 1, now + 99999], now }), {
    lane: 0,
    startAt: now,
    drop: false,
  });
  // 开启「优先减少重叠」时不会立刻出发，而是继续等到轨道空出
  assert.deepEqual(pickLane({ lanes: [now + OVERLAP_WAIT_MS + 1], now, avoidOverlap: true }), {
    lane: 0,
    startAt: now + OVERLAP_WAIT_MS + 1,
    drop: false,
  });
});

test("pickLane 优先减少重叠时，等超过 4 秒的这条丢弃", () => {
  const now = 10000;
  assert.deepEqual(pickLane({ lanes: [now + OVERLAP_DROP_MS], now, avoidOverlap: true }), {
    lane: 0,
    startAt: now + OVERLAP_DROP_MS,
    drop: false,
  });
  assert.deepEqual(pickLane({ lanes: [now + OVERLAP_DROP_MS + 1], now, avoidOverlap: true }), {
    lane: 0,
    startAt: now + OVERLAP_DROP_MS + 1,
    drop: true,
  });
});

test("同一时刻多条弹幕占用不同轨道，轨道满则放不下", () => {
  const a = createLaneAllocator({ laneCount: 2 });
  const p = { now: 0, screenW: 1000, width: 100, duration: 10000 };
  assert.equal(a.place(p), 0);
  assert.equal(a.place(p), 1);
  assert.equal(a.place(p), -1);
});

test("尾部进入屏幕并留出间隙后，同一轨道才能放下一条", () => {
  const a = createLaneAllocator({ laneCount: 1, gap: 30 });
  const base = { screenW: 1000, width: 100, duration: 10000 };
  assert.equal(a.place({ ...base, now: 0 }), 0);
  // v = (1000+100)/10000 = 0.11 px/ms，尾部进入屏幕并留间隙需 (100+30)/0.11 ≈ 1182ms
  assert.equal(a.place({ ...base, now: 1100 }), -1);
  assert.equal(a.place({ ...base, now: 1200 }), 0);
});

test("后一条更长（更快）时，要等到不会追尾才放入", () => {
  const a = createLaneAllocator({ laneCount: 1, gap: 30 });
  assert.equal(a.place({ now: 0, screenW: 1000, width: 100, duration: 10000 }), 0);
  // 长弹幕 v=(1000+800)/10000=0.18 > 0.11：条件 1 在约 1182ms 满足，
  // 但条件 2 要求更晚：10000 - 970/0.18 ≈ 4611ms
  const long = { screenW: 1000, width: 800, duration: 10000 };
  assert.equal(a.place({ ...long, now: 1200 }), -1);
  assert.equal(a.place({ ...long, now: 4500 }), -1);
  assert.equal(a.place({ ...long, now: 4700 }), 0);
});
