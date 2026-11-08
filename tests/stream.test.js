import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonObject,
  parseStreams,
  pickUrl,
  listQualities,
} from "../src/lib/stream.js";

// 模拟 window.__pace_f：数据被拆成多段，且 stream_url 内含带括号的字符串
const pace = [
  [1, 'a:["$","$L1",null,{"x":1}]'],
  [
    1,
    'd:["$","$L12",null,{"state":{"roomStore":{"roomInfo":{"room":{"stream_url":{' +
      '"flv_pull_url":{"FULL_HD1":"http://a/or4.flv?s=1}{","HD1":"http://a/hd.flv","SD1":"http://a/ld.flv"},' +
      '"default_resolution":"HD1",' +
      '"hls_pull_url_map":{"HD1":"http://a/hd.m3u8"}' +
      '}}}}}}]',
  ],
];

test("extractJsonObject 能处理字符串内的花括号", () => {
  const text = pace[1][1];
  const obj = extractJsonObject(text, "stream_url");
  assert.equal(obj.flv_pull_url.FULL_HD1, "http://a/or4.flv?s=1}{");
  assert.equal(obj.default_resolution, "HD1");
});

test("extractJsonObject 找不到 key 返回 null", () => {
  assert.equal(extractJsonObject("{}", "stream_url"), null);
});

test("parseStreams 解析 flv 与 hls", () => {
  const s = parseStreams(pace);
  assert.deepEqual(Object.keys(s.flv), ["FULL_HD1", "HD1", "SD1"]);
  assert.equal(s.hls.HD1, "http://a/hd.m3u8");
});

test("parseStreams 无数据返回 null", () => {
  assert.equal(parseStreams(undefined), null);
  assert.equal(parseStreams([[1, "nothing"]]), null);
});

test("pickUrl 默认取最高档，指定档位缺失时回退", () => {
  const s = parseStreams(pace);
  assert.equal(pickUrl(s, "flv").quality, "FULL_HD1");
  assert.equal(pickUrl(s, "flv", "SD2").quality, "FULL_HD1");
  assert.equal(pickUrl(s, "flv", "SD1").quality, "SD1");
  assert.equal(pickUrl(s, "hls").quality, "HD1");
  assert.equal(pickUrl(null), null);
});

test("listQualities 按清晰度从高到低", () => {
  const s = parseStreams(pace);
  assert.deepEqual(
    listQualities(s, "flv").map((q) => q.label),
    ["原画", "超清", "标清"]
  );
});
